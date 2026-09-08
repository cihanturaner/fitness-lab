"""Workout and performed-set rows <-> domain entities.

This is the only place where kilograms become integer grams. The domain never sees the
gram representation, and load_kg in the database is a read-only generated column that
exists so hand-written SQL reads in kilograms.
"""

from __future__ import annotations

import sqlite3

from fitness_lab.domain.models import PerformedSet, SetTypeCode, Workout, WorkoutStatus
from fitness_lab.domain.units import g_to_kg, kg_to_g

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
