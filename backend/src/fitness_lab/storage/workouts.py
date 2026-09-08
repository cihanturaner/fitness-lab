"""Workout and performed-set rows <-> domain entities.

This is the only place where kilograms become integer grams. The domain never sees the
gram representation, and load_kg in the database is a read-only generated column that
exists so hand-written SQL reads in kilograms.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from pathlib import Path

from fitness_lab.domain.completion import renumber_sets
from fitness_lab.domain.models import PerformedSet, SetTypeCode, Workout, WorkoutStatus
from fitness_lab.domain.units import g_to_kg, kg_to_g
from fitness_lab.storage import db
from fitness_lab.storage.snapshots import create_snapshot

WORKOUT_COLUMNS = (
    "id, performed_on, performed_time_local, status, notes, entered_at_utc, updated_at_utc"
)
SET_COLUMNS = (
    "id, workout_id, exercise_id, set_order, set_type, load_g, reps, rir, notes, "
    "entered_at_utc, updated_at_utc"
)


def row_to_workout(row: sqlite3.Row) -> Workout:
    return Workout(
        id=str(row["id"]),
        performed_on=str(row["performed_on"]),
        performed_time_local=(
            None if row["performed_time_local"] is None else str(row["performed_time_local"])
        ),
        status=WorkoutStatus(str(row["status"])),
        notes=None if row["notes"] is None else str(row["notes"]),
        entered_at_utc=str(row["entered_at_utc"]),
        updated_at_utc=str(row["updated_at_utc"]),
    )


def row_to_performed_set(row: sqlite3.Row) -> PerformedSet:
    return PerformedSet(
        id=str(row["id"]),
        workout_id=str(row["workout_id"]),
        exercise_id=str(row["exercise_id"]),
        set_order=int(row["set_order"]),
        set_type=None if row["set_type"] is None else SetTypeCode(str(row["set_type"])),
        load_kg=g_to_kg(None if row["load_g"] is None else int(row["load_g"])),
        reps=None if row["reps"] is None else int(row["reps"]),
        rir=None if row["rir"] is None else int(row["rir"]),
        notes=None if row["notes"] is None else str(row["notes"]),
        entered_at_utc=str(row["entered_at_utc"]),
        updated_at_utc=str(row["updated_at_utc"]),
    )


def insert_workout(connection: sqlite3.Connection, workout: Workout) -> None:
    connection.execute(
        f"INSERT INTO workout ({WORKOUT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            workout.id,
            workout.performed_on,
            workout.performed_time_local,
            workout.status.value,
            workout.notes,
            workout.entered_at_utc,
            workout.updated_at_utc,
        ),
    )


def update_workout(connection: sqlite3.Connection, workout: Workout) -> None:
    connection.execute(
        "UPDATE workout SET performed_on = ?, performed_time_local = ?, status = ?, "
        "notes = ?, updated_at_utc = ? WHERE id = ?",
        (
            workout.performed_on,
            workout.performed_time_local,
            workout.status.value,
            workout.notes,
            workout.updated_at_utc,
            workout.id,
        ),
    )


def get_workout(connection: sqlite3.Connection, workout_id: str) -> Workout | None:
    row = connection.execute(
        f"SELECT {WORKOUT_COLUMNS} FROM workout WHERE id = ?", (workout_id,)
    ).fetchone()
    return None if row is None else row_to_workout(row)


def list_workouts_on(connection: sqlite3.Connection, performed_on: str) -> tuple[Workout, ...]:
    """Several sessions may share a calendar date; the date is not unique by design."""
    rows = connection.execute(
        f"SELECT {WORKOUT_COLUMNS} FROM workout WHERE performed_on = ? "
        "ORDER BY coalesce(performed_time_local, ''), entered_at_utc",
        (performed_on,),
    ).fetchall()
    return tuple(row_to_workout(row) for row in rows)


def insert_performed_set(connection: sqlite3.Connection, performed_set: PerformedSet) -> None:
    connection.execute(
        f"INSERT INTO performed_set ({SET_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            performed_set.id,
            performed_set.workout_id,
            performed_set.exercise_id,
            performed_set.set_order,
            None if performed_set.set_type is None else performed_set.set_type.value,
            kg_to_g(performed_set.load_kg),
            performed_set.reps,
            performed_set.rir,
            performed_set.notes,
            performed_set.entered_at_utc,
            performed_set.updated_at_utc,
        ),
    )


def update_performed_set(connection: sqlite3.Connection, performed_set: PerformedSet) -> None:
    """In-place correction. Prior values are not retained; the snapshot is the mitigation."""
    connection.execute(
        "UPDATE performed_set SET exercise_id = ?, set_order = ?, set_type = ?, load_g = ?, "
        "reps = ?, rir = ?, notes = ?, updated_at_utc = ? WHERE id = ?",
        (
            performed_set.exercise_id,
            performed_set.set_order,
            None if performed_set.set_type is None else performed_set.set_type.value,
            kg_to_g(performed_set.load_kg),
            performed_set.reps,
            performed_set.rir,
            performed_set.notes,
            performed_set.updated_at_utc,
            performed_set.id,
        ),
    )


def list_sets_for_workout(
    connection: sqlite3.Connection, workout_id: str
) -> tuple[PerformedSet, ...]:
    """The stored order is the true chronological order of the whole session."""
    rows = connection.execute(
        f"SELECT {SET_COLUMNS} FROM performed_set WHERE workout_id = ? ORDER BY set_order",
        (workout_id,),
    ).fetchall()
    return tuple(row_to_performed_set(row) for row in rows)


class DeletionRefused(RuntimeError):
    """A deletion was refused because it would destroy evidence unguarded."""


_RENUMBER_OFFSET = 1_000_000


def _write_renumbering(
    connection: sqlite3.Connection, workout_id: str, target: Sequence[PerformedSet]
) -> None:
    """Assign the target positions. Caller must already hold a transaction.

    The offset pass exists because UNIQUE (workout_id, set_order) would otherwise be
    violated mid-update while positions are being reassigned.
    """
    connection.execute(
        "UPDATE performed_set SET set_order = set_order + ? WHERE workout_id = ?",
        (_RENUMBER_OFFSET, workout_id),
    )
    for performed in target:
        connection.execute(
            "UPDATE performed_set SET set_order = ? WHERE id = ?",
            (performed.set_order, performed.id),
        )


def renumber_workout_sets(
    connection: sqlite3.Connection, workout_id: str
) -> tuple[PerformedSet, ...]:
    """Compact this workout's sets to a dense 1..n (rule C3's repair), persisted."""
    current = list_sets_for_workout(connection, workout_id)
    target = renumber_sets(current)
    if [performed.set_order for performed in current] == [
        performed.set_order for performed in target
    ]:
        return current
    with db.transaction(connection):
        _write_renumbering(connection, workout_id, target)
    return target


def delete_performed_set(connection: sqlite3.Connection, set_id: str) -> tuple[PerformedSet, ...]:
    """Hard DELETE, then renumber the workout's remaining sets. Returns what is left.

    Both halves run in one transaction: a set removed but not renumbered would leave the
    workout in a state rule C3 exists to prevent.
    """
    row = connection.execute(
        "SELECT workout_id FROM performed_set WHERE id = ?", (set_id,)
    ).fetchone()
    if row is None:
        raise DeletionRefused(f"no set with id {set_id!r}")
    workout_id = str(row["workout_id"])
    with db.transaction(connection):
        connection.execute("DELETE FROM performed_set WHERE id = ?", (set_id,))
        remaining = renumber_sets(list_sets_for_workout(connection, workout_id))
        _write_renumbering(connection, workout_id, remaining)
    return remaining


def _require_workout(connection: sqlite3.Connection, workout_id: str) -> Workout:
    workout = get_workout(connection, workout_id)
    if workout is None:
        raise DeletionRefused(f"no workout with id {workout_id!r}")
    return workout


def delete_draft_workout(connection: sqlite3.Connection, workout_id: str) -> None:
    """A draft is not evidence; nothing is lost. Sets cascade."""
    workout = _require_workout(connection, workout_id)
    if workout.status is not WorkoutStatus.DRAFT:
        raise DeletionRefused(f"workout {workout_id!r} is complete; use delete_complete_workout()")
    connection.execute("DELETE FROM workout WHERE id = ?", (workout_id,))


def delete_complete_workout(
    connection: sqlite3.Connection,
    workout_id: str,
    *,
    db_path: Path,
    i_understand_this_deletes_evidence: bool = False,
) -> Path:
    """The only guarded path. Takes a safety snapshot first and returns its location.

    Ordering is fail-safe and must not be rearranged: create_snapshot() raises rather
    than returning a partial file, so a failed snapshot propagates before the DELETE is
    ever issued and the database is left exactly as it was.
    """
    workout = _require_workout(connection, workout_id)
    if workout.status is not WorkoutStatus.COMPLETE:
        raise DeletionRefused(f"workout {workout_id!r} is a draft; use delete_draft_workout()")
    if not i_understand_this_deletes_evidence:
        raise DeletionRefused(
            "deleting a complete workout requires confirm via "
            "i_understand_this_deletes_evidence=True"
        )
    snapshot = create_snapshot(connection, db_path, f"pre-delete-workout-{workout_id}")
    connection.execute("DELETE FROM workout WHERE id = ?", (workout_id,))
    return snapshot
