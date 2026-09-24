"""Workout entry: the transactional operations behind the Workout Entry screen.

Planned is never performed. Opening a planned workout writes exactly one ``workout`` row and
its immutable origin — never a performed set. Actual sets are only ever what the lifter
entered; they carry no link to a prescription.

Lifecycle follows M1 §6: sets and substitutions change only while a workout is a draft;
a complete workout is corrected by reopening it first.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from decimal import Decimal
from pathlib import Path

from fitness_lab.domain.completion import (
    CompletionReport,
    complete_workout,
    renumber_sets,
    reopen_workout,
)
from fitness_lab.domain.models import (
    Exercise,
    PerformedSet,
    SetTypeCode,
    Workout,
    WorkoutStatus,
    create_exercise,
    new_draft_workout,
    new_id,
    utc_now_iso,
)
from fitness_lab.domain.substitutes import approved_substitutes
from fitness_lab.storage import db
from fitness_lab.storage.exercises import find_exercise_by_identity, get_exercise, insert_exercise
from fitness_lab.storage.programs import (
    SlotRow,
    get_active_version,
    get_planned_workout,
    get_slot,
    list_slots,
)
from fitness_lab.storage.snapshots import create_snapshot
from fitness_lab.storage.workouts import (
    _write_renumbering,
    get_workout,
    insert_performed_set,
    insert_workout,
    list_sets_for_workout,
    row_to_performed_set,
    row_to_workout,
    update_performed_set,
    update_workout,
)

SET_FIELDS = frozenset({"exercise_id", "set_type", "load_kg", "reps", "rir", "notes"})
WORKOUT_FIELDS = frozenset({"performed_on", "performed_time_local", "notes"})
REOPEN_FIRST = "workout is complete; reopen it before correcting it"


class NotFound(LookupError):
    """A referenced workout, set, slot, planned workout or exercise does not exist."""


class Conflict(RuntimeError):
    """The request is valid but the current state forbids it."""

    def __init__(self, message: str, report: CompletionReport | None = None) -> None:
        super().__init__(message)
        self.report = report


@dataclass(frozen=True, slots=True)
class Origin:
    """A workout's persisted planned origin, read back from workout_plan_origin."""

    planned_workout_id: str
    planned_workout_name: str
    workout_key: str
    day_label: str | None
    program_version_id: str
    program_name: str
    version_label: str | None


@dataclass(frozen=True, slots=True)
class OpenResult:
    workout: Workout
    created: bool


@dataclass(frozen=True, slots=True)
class LastPerformance:
    workout_id: str
    performed_on: str
    performed_time_local: str | None
    planned_workout_name: str | None  # the session it came from; None when unplanned
    sets: tuple[PerformedSet, ...]


@dataclass(frozen=True, slots=True)
class ApprovedOption:
    """An approved substitute of a slot; ``exercise_id`` once it is an active identity."""

    name: str
    condition: str | None
    exercise_id: str | None


@dataclass(frozen=True, slots=True)
class EntrySlot:
    slot: SlotRow
    substitute_exercise_id: str | None
    approved: tuple[ApprovedOption, ...] = ()

    @property
    def effective_exercise_id(self) -> str:
        return self.substitute_exercise_id or self.slot.exercise_id


@dataclass(frozen=True, slots=True)
class EntryAggregate:
    workout: Workout
    origin: Origin | None
    slots: tuple[EntrySlot, ...]
    sets: tuple[PerformedSet, ...]
    exercises: dict[str, Exercise]
    last_performance: dict[str, LastPerformance | None]


@dataclass(frozen=True, slots=True)
class WorkoutSummary:
    workout: Workout
    planned_workout_id: str | None
    origin_name: str | None
    set_count: int
    work_set_count: int


@dataclass(frozen=True, slots=True)
class PlannedWorkoutUsage:
    open_draft_id: str | None
    open_draft_performed_on: str | None
    completed_count: int
    last_completed_on: str | None


# --- reads ---------------------------------------------------------------------------------


def get_origin(connection: sqlite3.Connection, workout_id: str) -> Origin | None:
    row = connection.execute(
        "SELECT o.planned_workout_id, pw.name AS planned_name, pw.workout_key, pw.day_label, "
        "pv.id AS version_id, pv.name AS program_name, pv.version_label "
        "FROM workout_plan_origin o "
        "JOIN planned_workout pw ON pw.id = o.planned_workout_id "
        "JOIN program_version pv ON pv.id = pw.program_version_id "
        "WHERE o.workout_id = ?",
        (workout_id,),
    ).fetchone()
    if row is None:
        return None
    return Origin(
        planned_workout_id=str(row["planned_workout_id"]),
        planned_workout_name=str(row["planned_name"]),
        workout_key=str(row["workout_key"]),
        day_label=None if row["day_label"] is None else str(row["day_label"]),
        program_version_id=str(row["version_id"]),
        program_name=str(row["program_name"]),
        version_label=None if row["version_label"] is None else str(row["version_label"]),
    )


def _require_workout(connection: sqlite3.Connection, workout_id: str) -> Workout:
    workout = get_workout(connection, workout_id)
    if workout is None:
        raise NotFound(f"no workout with id {workout_id!r}")
    return workout


def _require_draft(connection: sqlite3.Connection, workout_id: str) -> Workout:
    workout = _require_workout(connection, workout_id)
    if workout.status is not WorkoutStatus.DRAFT:
        raise Conflict(REOPEN_FIRST)
    return workout


def _require_exercise(connection: sqlite3.Connection, exercise_id: str) -> Exercise:
    exercise = get_exercise(connection, exercise_id)
    if exercise is None:
        raise NotFound(f"no exercise with id {exercise_id!r}")
    if not exercise.is_active:
        raise Conflict(f"exercise {exercise.name!r} is retired")
    return exercise


def _find_open_draft(connection: sqlite3.Connection, planned_workout_id: str) -> Workout | None:
    row = connection.execute(
        "SELECT w.id, w.performed_on, w.performed_time_local, w.status, w.notes, "
        "w.entered_at_utc, w.updated_at_utc "
        "FROM workout w JOIN workout_plan_origin o ON o.workout_id = w.id "
        "WHERE o.planned_workout_id = ? AND w.status = 'draft' "
        "ORDER BY w.entered_at_utc DESC, w.id DESC LIMIT 1",
        (planned_workout_id,),
    ).fetchone()
    return None if row is None else row_to_workout(row)


def planned_workout_usage(
    connection: sqlite3.Connection, planned_workout_id: str
) -> PlannedWorkoutUsage:
    draft = _find_open_draft(connection, planned_workout_id)
    row = connection.execute(
        "SELECT count(*) AS n, max(w.performed_on) AS last_on "
        "FROM workout w JOIN workout_plan_origin o ON o.workout_id = w.id "
        "WHERE o.planned_workout_id = ? AND w.status = 'complete'",
        (planned_workout_id,),
    ).fetchone()
    return PlannedWorkoutUsage(
        open_draft_id=None if draft is None else draft.id,
        open_draft_performed_on=None if draft is None else draft.performed_on,
        completed_count=int(row["n"]),
        last_completed_on=None if row["last_on"] is None else str(row["last_on"]),
    )


# --- creation ------------------------------------------------------------------------------


def open_planned_workout(
    connection: sqlite3.Connection,
    planned_workout_id: str,
    *,
    performed_on: str,
    now: str | None = None,
) -> OpenResult:
    """Resume this planned workout's draft, or create one empty draft with its origin.

    One BEGIN IMMEDIATE transaction: concurrent or retried openers serialise on the write
    lock, and whoever comes second finds the draft the first one committed.
    """
    with db.immediate_transaction(connection):
        planned = get_planned_workout(connection, planned_workout_id)
        if planned is None:
            raise NotFound(f"no planned workout with id {planned_workout_id!r}")
        existing = _find_open_draft(connection, planned_workout_id)
        if existing is not None:
            return OpenResult(workout=existing, created=False)
        active = get_active_version(connection)
        if active is None or active.id != planned.program_version_id:
            raise Conflict(
                f"planned workout {planned.name!r} is not part of the active program; "
                "only an existing draft of it can be resumed"
            )
        workout = _new_draft(performed_on, None, None, now)
        try:
            insert_workout(connection, workout)
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"invalid workout date: {exc}") from exc
        connection.execute(
            "INSERT INTO workout_plan_origin (workout_id, planned_workout_id, created_at_utc) "
            "VALUES (?, ?, ?)",
            (workout.id, planned_workout_id, workout.entered_at_utc),
        )
    return OpenResult(workout=workout, created=True)


def _new_draft(
    performed_on: str, performed_time_local: str | None, notes: str | None, now: str | None
) -> Workout:
    return new_draft_workout(
        performed_on, performed_time_local=performed_time_local, notes=notes, now=now
    )


def create_unplanned_workout(
    connection: sqlite3.Connection,
    *,
    performed_on: str,
    performed_time_local: str | None = None,
    notes: str | None = None,
    now: str | None = None,
) -> Workout:
    """An unplanned session is first-class: a draft with no origin row."""
    workout = _new_draft(performed_on, performed_time_local, notes, now)
    try:
        insert_workout(connection, workout)
    except sqlite3.IntegrityError as exc:
        raise ValueError(f"invalid workout date or time: {exc}") from exc
    return workout


# --- actual sets ---------------------------------------------------------------------------


def _get_set(connection: sqlite3.Connection, set_id: str) -> PerformedSet:
    row = connection.execute(
        "SELECT id, workout_id, exercise_id, set_order, set_type, load_g, reps, rir, notes, "
        "entered_at_utc, updated_at_utc FROM performed_set WHERE id = ?",
        (set_id,),
    ).fetchone()
    if row is None:
        raise NotFound(f"no set with id {set_id!r}")
    return row_to_performed_set(row)


def add_set(
    connection: sqlite3.Connection,
    workout_id: str,
    *,
    exercise_id: str,
    set_type: SetTypeCode | None,
    load_kg: Decimal | None,
    reps: int | None,
    rir: int | None,
    notes: str | None,
    now: str | None = None,
) -> PerformedSet:
    """Append one actual set at the end of the session's chronological order."""
    stamp = now if now is not None else utc_now_iso()
    with db.immediate_transaction(connection):
        _require_draft(connection, workout_id)
        _require_exercise(connection, exercise_id)
        next_order = int(
            connection.execute(
                "SELECT coalesce(max(set_order), 0) + 1 FROM performed_set WHERE workout_id = ?",
                (workout_id,),
            ).fetchone()[0]
        )
        performed = PerformedSet(
            id=new_id(),
            workout_id=workout_id,
            exercise_id=exercise_id,
            set_order=next_order,
            set_type=set_type,
            load_kg=load_kg,
            reps=reps,
            rir=rir,
            notes=notes,
            entered_at_utc=stamp,
            updated_at_utc=stamp,
        )
        try:
            insert_performed_set(connection, performed)
        except (sqlite3.IntegrityError, ValueError, TypeError, OverflowError) as exc:
            raise ValueError(f"invalid set: {exc}") from exc
    return performed


def _optional(value: object, kind: type, field: str) -> object:
    if value is None:
        return None
    if kind is int and (not isinstance(value, int) or isinstance(value, bool)):
        raise ValueError(f"{field} must be an integer or null")
    if not isinstance(value, kind):
        raise ValueError(f"{field} must be {kind.__name__} or null")
    return value


def edit_set(
    connection: sqlite3.Connection,
    set_id: str,
    changes: Mapping[str, object],
    *,
    now: str | None = None,
) -> PerformedSet:
    """Replace the supplied fields only. An explicit ``None`` clears a field."""
    unknown = sorted(set(changes) - SET_FIELDS)
    if unknown:
        raise ValueError(f"fields cannot be edited here: {unknown}")
    with db.immediate_transaction(connection):
        current = _get_set(connection, set_id)
        _require_draft(connection, current.workout_id)
        updated = current
        if "exercise_id" in changes:
            exercise_id = changes["exercise_id"]
            if not isinstance(exercise_id, str):
                raise ValueError("exercise_id must be a string")
            _require_exercise(connection, exercise_id)
            updated = replace(updated, exercise_id=exercise_id)
        if "set_type" in changes:
            code = changes["set_type"]
            if code is not None and not isinstance(code, SetTypeCode):
                raise ValueError("set_type must be a known set type or null")
            updated = replace(updated, set_type=code)
        if "load_kg" in changes:
            load = _optional(changes["load_kg"], Decimal, "load_kg")
            assert load is None or isinstance(load, Decimal)
            updated = replace(updated, load_kg=load)
        if "reps" in changes:
            reps = _optional(changes["reps"], int, "reps")
            assert reps is None or isinstance(reps, int)
            updated = replace(updated, reps=reps)
        if "rir" in changes:
            rir = _optional(changes["rir"], int, "rir")
            assert rir is None or isinstance(rir, int)
            updated = replace(updated, rir=rir)
        if "notes" in changes:
            notes = _optional(changes["notes"], str, "notes")
            assert notes is None or isinstance(notes, str)
            updated = replace(updated, notes=notes)
        updated = replace(updated, updated_at_utc=now if now is not None else utc_now_iso())
        try:
            update_performed_set(connection, updated)
        except (sqlite3.IntegrityError, ValueError, TypeError, OverflowError) as exc:
            raise ValueError(f"invalid set: {exc}") from exc
    return updated


def remove_set(connection: sqlite3.Connection, set_id: str) -> None:
    """Hard delete (a draft's set is not yet evidence), then renumber — M1 §14.

    The status check, the DELETE and the renumbering share one BEGIN IMMEDIATE
    transaction, so a completion committed by another request cannot slip in between
    the check and the delete. (M1's delete_performed_set opens its own transaction and
    therefore cannot be called inside this one; its two steps are repeated here.)
    """
    with db.immediate_transaction(connection):
        current = _get_set(connection, set_id)
        _require_draft(connection, current.workout_id)
        connection.execute("DELETE FROM performed_set WHERE id = ?", (set_id,))
        remaining = renumber_sets(list_sets_for_workout(connection, current.workout_id))
        _write_renumbering(connection, current.workout_id, remaining)


def reorder_sets(
    connection: sqlite3.Connection, workout_id: str, set_ids: Sequence[str]
) -> tuple[PerformedSet, ...]:
    """Rewrite the chronological order. ``set_ids`` must be a permutation of the sets."""
    with db.immediate_transaction(connection):
        _require_draft(connection, workout_id)
        current = {
            performed.id: performed for performed in list_sets_for_workout(connection, workout_id)
        }
        if len(set_ids) != len(current) or set(set_ids) != set(current):
            raise ValueError("set order must be a permutation of exactly this workout's sets")
        target = tuple(
            replace(current[set_id], set_order=position)
            for position, set_id in enumerate(set_ids, start=1)
        )
        _write_renumbering(connection, workout_id, target)
    return target


# --- lifecycle -----------------------------------------------------------------------------


def complete(
    connection: sqlite3.Connection, workout_id: str, *, now: str | None = None
) -> CompletionReport:
    """M1 completion (C1–C4). Status and C3's renumbering persist in one transaction."""
    with db.immediate_transaction(connection):
        workout = _require_workout(connection, workout_id)
        if workout.status is not WorkoutStatus.DRAFT:
            raise Conflict("workout is already complete")
        completed, report = complete_workout(
            workout, list_sets_for_workout(connection, workout_id), now=now
        )
        if not report.ok:
            raise Conflict("workout cannot be completed yet", report)
        if report.renumbered:
            _write_renumbering(connection, workout_id, report.sets)
        update_workout(connection, completed)
    return report


def reopen(connection: sqlite3.Connection, workout_id: str, *, now: str | None = None) -> Workout:
    """M1 reopening: complete -> draft, to correct the record."""
    with db.immediate_transaction(connection):
        workout = _require_workout(connection, workout_id)
        if workout.status is not WorkoutStatus.COMPLETE:
            raise Conflict("only a complete workout can be reopened")
        reopened = reopen_workout(workout, now=now)
        update_workout(connection, reopened)
    return reopened


def edit_workout(
    connection: sqlite3.Connection,
    workout_id: str,
    changes: Mapping[str, object],
    *,
    now: str | None = None,
) -> Workout:
    """Correct date, time or notes of a draft. Status changes go through complete/reopen."""
    unknown = sorted(set(changes) - WORKOUT_FIELDS)
    if unknown:
        raise ValueError(f"fields cannot be edited here: {unknown}")
    with db.immediate_transaction(connection):
        workout = _require_draft(connection, workout_id)
        updated = workout
        if "performed_on" in changes:
            performed_on = changes["performed_on"]
            if not isinstance(performed_on, str):
                raise ValueError("performed_on must be YYYY-MM-DD")
            updated = replace(updated, performed_on=performed_on)
        if "performed_time_local" in changes:
            time_local = _optional(changes["performed_time_local"], str, "performed_time_local")
            assert time_local is None or isinstance(time_local, str)
            updated = replace(updated, performed_time_local=time_local)
        if "notes" in changes:
            notes = _optional(changes["notes"], str, "notes")
            assert notes is None or isinstance(notes, str)
            updated = replace(updated, notes=notes)
        updated = replace(updated, updated_at_utc=now if now is not None else utc_now_iso())
        try:
            update_workout(connection, updated)
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"invalid workout date or time: {exc}") from exc
    return updated


def _set_ids(connection: sqlite3.Connection, workout_id: str) -> frozenset[str]:
    rows = connection.execute(
        "SELECT id FROM performed_set WHERE workout_id = ?", (workout_id,)
    ).fetchall()
    return frozenset(str(row[0]) for row in rows)


def discard_draft(connection: sqlite3.Connection, workout_id: str, *, db_path: Path) -> Path | None:
    """Delete a draft. Returns the safety snapshot taken first, if any.

    An empty draft holds nothing and is deleted outright. A draft with sets may be a
    completed workout reopened for correction — the schema keeps no record that it was
    once evidence — so a ``VACUUM INTO`` snapshot is taken before it is deleted, exactly
    as M1's guarded path does for complete workouts; a failed snapshot raises before
    anything is deleted. The DELETE itself stays conditional on ``status = 'draft'``
    inside one BEGIN IMMEDIATE transaction, so a workout completed by another request in
    the meantime is never removed through this path.
    """
    _require_draft(connection, workout_id)
    before = _set_ids(connection, workout_id)
    snapshot = (
        create_snapshot(connection, db_path, f"pre-discard-workout-{workout_id}")
        if before
        else None
    )
    with db.immediate_transaction(connection):
        _require_draft(connection, workout_id)
        # The snapshot (or the decision to take none) predates the write lock: a set
        # recorded in between would be deleted without being in any snapshot.
        if _set_ids(connection, workout_id) != before:
            raise Conflict("the draft changed while it was being discarded; try again")
        deleted = connection.execute(
            "DELETE FROM workout WHERE id = ? AND status = 'draft'", (workout_id,)
        ).rowcount
        if deleted != 1:
            raise Conflict(REOPEN_FIRST)
    return snapshot


# --- substitution --------------------------------------------------------------------------


def set_slot_exercise(
    connection: sqlite3.Connection,
    workout_id: str,
    slot_id: str,
    exercise_id: str,
    *,
    now: str | None = None,
) -> None:
    """Substitute a whole planned slot in this workout; the planned exercise clears it.

    Only this workout changes: the planned slot, its program version and every other
    workout (earlier or later occurrences of the same session) are untouched.
    """
    with db.immediate_transaction(connection):
        slot = _require_slot_of_draft(connection, workout_id, slot_id)
        _substitute(connection, workout_id, slot, exercise_id, now)


def use_approved_substitute(
    connection: sqlite3.Connection,
    workout_id: str,
    slot_id: str,
    name: str,
    *,
    now: str | None = None,
) -> Exercise:
    """Perform this slot, in this workout only, as one of its approved substitutes.

    ``name`` must be on the slot's own approved list. The substitute's exercise identity
    is found by the M1 identity rule (name, no equipment) or created once; a retired identity
    is refused, never revived. Check, creation and substitution share one transaction.
    """
    with db.immediate_transaction(connection):
        slot = _require_slot_of_draft(connection, workout_id, slot_id)
        wanted = name.strip().casefold()
        option = next(
            (item for item in approved_substitutes(slot.notes) if item.name.casefold() == wanted),
            None,
        )
        if option is None:
            raise ValueError(f"{name!r} is not an approved substitute for this exercise")
        exercise = find_exercise_by_identity(connection, option.name, None)
        if exercise is None:
            exercise = create_exercise(option.name, None, now=now)
            insert_exercise(connection, exercise)
        _substitute(connection, workout_id, slot, exercise.id, now)
    return exercise


def _require_slot_of_draft(
    connection: sqlite3.Connection, workout_id: str, slot_id: str
) -> SlotRow:
    _require_draft(connection, workout_id)
    slot = get_slot(connection, slot_id)
    if slot is None:
        raise NotFound(f"no planned slot with id {slot_id!r}")
    origin = get_origin(connection, workout_id)
    if origin is None or origin.planned_workout_id != slot.planned_workout_id:
        raise Conflict("that slot does not belong to this workout's planned workout")
    return slot


def _substitute(
    connection: sqlite3.Connection,
    workout_id: str,
    slot: SlotRow,
    exercise_id: str,
    now: str | None,
) -> None:
    stamp = now if now is not None else utc_now_iso()
    slot_id = slot.id
    if exercise_id == slot.exercise_id:
        connection.execute(
            "DELETE FROM workout_slot_substitution WHERE workout_id = ? AND slot_id = ?",
            (workout_id, slot_id),
        )
        return
    _require_exercise(connection, exercise_id)
    connection.execute(
        "INSERT INTO workout_slot_substitution (workout_id, planned_workout_id, slot_id, "
        "exercise_id, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (workout_id, slot_id) DO UPDATE SET "
        "exercise_id = excluded.exercise_id, updated_at_utc = excluded.updated_at_utc",
        (workout_id, slot.planned_workout_id, slot_id, exercise_id, stamp, stamp),
    )


def _substitutions(connection: sqlite3.Connection, workout_id: str) -> dict[str, str]:
    rows = connection.execute(
        "SELECT slot_id, exercise_id FROM workout_slot_substitution WHERE workout_id = ?",
        (workout_id,),
    ).fetchall()
    return {str(row["slot_id"]): str(row["exercise_id"]) for row in rows}


# --- last exact performance ------------------------------------------------------------


def last_performance(
    connection: sqlite3.Connection, exercise_id: str, *, exclude_workout_id: str | None = None
) -> LastPerformance | None:
    """The most recent complete workout with this exact exercise, and its sets of it.

    Exact identity only: no name matching, no substitution families, no calculation.
    """
    row = connection.execute(
        "SELECT w.id, w.performed_on, w.performed_time_local, pw.name AS planned_name "
        "FROM workout w "
        "LEFT JOIN workout_plan_origin o ON o.workout_id = w.id "
        "LEFT JOIN planned_workout pw ON pw.id = o.planned_workout_id "
        "WHERE w.status = 'complete' AND w.id IS NOT ? "
        "AND EXISTS (SELECT 1 FROM performed_set s "
        "            WHERE s.workout_id = w.id AND s.exercise_id = ?) "
        "ORDER BY w.performed_on DESC, w.performed_time_local IS NULL, "
        "w.performed_time_local DESC, w.entered_at_utc DESC, w.id DESC LIMIT 1",
        (exclude_workout_id, exercise_id),
    ).fetchone()
    if row is None:
        return None
    sets = connection.execute(
        "SELECT id, workout_id, exercise_id, set_order, set_type, load_g, reps, rir, notes, "
        "entered_at_utc, updated_at_utc FROM performed_set "
        "WHERE workout_id = ? AND exercise_id = ? ORDER BY set_order",
        (str(row["id"]), exercise_id),
    ).fetchall()
    return LastPerformance(
        workout_id=str(row["id"]),
        performed_on=str(row["performed_on"]),
        performed_time_local=(
            None if row["performed_time_local"] is None else str(row["performed_time_local"])
        ),
        planned_workout_name=None if row["planned_name"] is None else str(row["planned_name"]),
        sets=tuple(row_to_performed_set(item) for item in sets),
    )


# --- aggregate -----------------------------------------------------------------------------


def load_entry(connection: sqlite3.Connection, workout_id: str) -> EntryAggregate:
    """Everything the Workout Entry screen needs, planned and actual kept apart.

    All reads share one read transaction, so the aggregate is a single consistent snapshot.
    """
    with db.transaction(connection):
        return _load_entry(connection, workout_id)


def _approved_options(connection: sqlite3.Connection, slot: SlotRow) -> tuple[ApprovedOption, ...]:
    options: list[ApprovedOption] = []
    for item in approved_substitutes(slot.notes):
        exercise = find_exercise_by_identity(connection, item.name, None)
        if exercise is not None and exercise.id == slot.exercise_id:
            continue  # the planned exercise itself ("Cable/Machine Lateral Raise")
        active = exercise is not None and exercise.is_active
        options.append(
            ApprovedOption(
                name=item.name,
                condition=item.condition,
                exercise_id=exercise.id if active and exercise is not None else None,
            )
        )
    return tuple(options)


def _load_entry(connection: sqlite3.Connection, workout_id: str) -> EntryAggregate:
    workout = _require_workout(connection, workout_id)
    origin = get_origin(connection, workout_id)
    slots: tuple[EntrySlot, ...] = ()
    if origin is not None:
        substitutes = _substitutions(connection, workout_id)
        slots = tuple(
            EntrySlot(
                slot=slot,
                substitute_exercise_id=substitutes.get(slot.id),
                approved=_approved_options(connection, slot),
            )
            for slot in list_slots(connection, origin.planned_workout_id)
        )
    sets = list_sets_for_workout(connection, workout_id)

    referenced: list[str] = []
    for entry_slot in slots:
        referenced.append(entry_slot.slot.exercise_id)
        if entry_slot.substitute_exercise_id is not None:
            referenced.append(entry_slot.substitute_exercise_id)
    referenced.extend(performed.exercise_id for performed in sets)

    exercises: dict[str, Exercise] = {}
    performance: dict[str, LastPerformance | None] = {}
    for exercise_id in dict.fromkeys(referenced):
        exercise = get_exercise(connection, exercise_id)
        if exercise is not None:
            exercises[exercise_id] = exercise
        performance[exercise_id] = last_performance(
            connection, exercise_id, exclude_workout_id=workout_id
        )
    return EntryAggregate(
        workout=workout,
        origin=origin,
        slots=slots,
        sets=sets,
        exercises=exercises,
        last_performance=performance,
    )


def list_recent_workouts(
    connection: sqlite3.Connection, *, limit: int = 20
) -> tuple[WorkoutSummary, ...]:
    rows = connection.execute(
        "SELECT w.id, w.performed_on, w.performed_time_local, w.status, w.notes, "
        "w.entered_at_utc, w.updated_at_utc, o.planned_workout_id, pw.name AS origin_name, "
        "(SELECT count(*) FROM performed_set s WHERE s.workout_id = w.id) AS set_count, "
        "(SELECT count(*) FROM performed_set s WHERE s.workout_id = w.id "
        "AND s.set_type IS NOT 'warmup') AS work_set_count "
        "FROM workout w "
        "LEFT JOIN workout_plan_origin o ON o.workout_id = w.id "
        "LEFT JOIN planned_workout pw ON pw.id = o.planned_workout_id "
        "ORDER BY w.performed_on DESC, w.performed_time_local IS NULL, "
        "w.performed_time_local DESC, w.entered_at_utc DESC, w.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return tuple(
        WorkoutSummary(
            workout=row_to_workout(row),
            planned_workout_id=(
                None if row["planned_workout_id"] is None else str(row["planned_workout_id"])
            ),
            origin_name=None if row["origin_name"] is None else str(row["origin_name"]),
            set_count=int(row["set_count"]),
            work_set_count=int(row["work_set_count"]),
        )
        for row in rows
    )
