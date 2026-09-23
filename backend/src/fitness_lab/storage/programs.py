"""Program versions: append-only import, single active version, planned reads.

Import never creates exercises. Every planned slot resolves to an existing, active exercise
by its exact normalised identity (M1 §5.3); anything missing or retired refuses the whole
package, so a partially imported program cannot exist.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from decimal import Decimal

from fitness_lab.domain.models import new_id, utc_now_iso
from fitness_lab.domain.program import PACKAGE_FORMAT, ExerciseRef, ProgramPackage
from fitness_lab.domain.units import g_to_kg, kg_to_g
from fitness_lab.storage import db
from fitness_lab.storage.exercises import find_exercise_by_identity


class ImportRefused(RuntimeError):
    """The package cannot be imported into this database as it stands."""


class ProgramStateError(RuntimeError):
    """An activation request names a version that does not exist."""


@dataclass(frozen=True, slots=True)
class ProgramVersionRow:
    id: str
    program_key: str
    name: str
    version_label: str | None
    duration_weeks: int | None
    package_sha256: str
    program_json_sha256: str
    notes_sha256: str | None
    imported_at_utc: str


@dataclass(frozen=True, slots=True)
class ImportResult:
    version: ProgramVersionRow
    created: bool


@dataclass(frozen=True, slots=True)
class PlannedWorkoutRow:
    id: str
    program_version_id: str
    workout_key: str
    sequence: int
    name: str
    day_label: str | None
    notes: str | None


@dataclass(frozen=True, slots=True)
class PlannedSetRow:
    id: str
    position: int
    set_type: str
    reps_min: int
    reps_max: int | None
    target_rir_min: int | None
    target_rir_max: int | None
    target_load_kg: Decimal | None
    notes: str | None


@dataclass(frozen=True, slots=True)
class SlotRow:
    id: str
    planned_workout_id: str
    slot_key: str
    position: int
    exercise_id: str
    notes: str | None
    sets: tuple[PlannedSetRow, ...]


VERSION_COLUMNS = (
    "id, program_key, name, version_label, duration_weeks, package_sha256, "
    "program_json_sha256, notes_sha256, imported_at_utc"
)
PLANNED_WORKOUT_COLUMNS = "id, program_version_id, workout_key, sequence, name, day_label, notes"


def _optional_str(value: object) -> str | None:
    return None if value is None else str(value)


def _optional_int(value: object) -> int | None:
    return None if value is None else int(str(value))


def _row_to_version(row: sqlite3.Row) -> ProgramVersionRow:
    return ProgramVersionRow(
        id=str(row["id"]),
        program_key=str(row["program_key"]),
        name=str(row["name"]),
        version_label=_optional_str(row["version_label"]),
        duration_weeks=_optional_int(row["duration_weeks"]),
        package_sha256=str(row["package_sha256"]),
        program_json_sha256=str(row["program_json_sha256"]),
        notes_sha256=_optional_str(row["notes_sha256"]),
        imported_at_utc=str(row["imported_at_utc"]),
    )


def _row_to_planned_workout(row: sqlite3.Row) -> PlannedWorkoutRow:
    return PlannedWorkoutRow(
        id=str(row["id"]),
        program_version_id=str(row["program_version_id"]),
        workout_key=str(row["workout_key"]),
        sequence=int(row["sequence"]),
        name=str(row["name"]),
        day_label=_optional_str(row["day_label"]),
        notes=_optional_str(row["notes"]),
    )


def get_program_version(
    connection: sqlite3.Connection, version_id: str
) -> ProgramVersionRow | None:
    row = connection.execute(
        f"SELECT {VERSION_COLUMNS} FROM program_version WHERE id = ?", (version_id,)
    ).fetchone()
    return None if row is None else _row_to_version(row)


def _find_by_package_hash(
    connection: sqlite3.Connection, package_sha256: str
) -> ProgramVersionRow | None:
    row = connection.execute(
        f"SELECT {VERSION_COLUMNS} FROM program_version WHERE package_sha256 = ?",
        (package_sha256,),
    ).fetchone()
    return None if row is None else _row_to_version(row)


def _describe(reference: ExerciseRef) -> str:
    if reference.equipment_label is None:
        return repr(reference.name)
    return f"{reference.name!r} on {reference.equipment_label!r}"


def _resolve_exercises(
    connection: sqlite3.Connection, package: ProgramPackage
) -> dict[ExerciseRef, str]:
    resolved: dict[ExerciseRef, str] = {}
    missing: list[str] = []
    retired: list[str] = []
    for workout in package.spec.workouts:
        for slot in workout.slots:
            reference = slot.exercise
            if reference in resolved:
                continue
            exercise = find_exercise_by_identity(
                connection, reference.name, reference.equipment_label
            )
            if exercise is None:
                if _describe(reference) not in missing:
                    missing.append(_describe(reference))
                continue
            if not exercise.is_active:
                retired.append(_describe(reference))
                continue
            resolved[reference] = exercise.id
    problems: list[str] = []
    if missing:
        listed = ", ".join(missing)
        problems.append(f"exercises not in the catalogue (create them first): {listed}")
    if retired:
        problems.append("exercises are retired: " + ", ".join(retired))
    if problems:
        raise ImportRefused("; ".join(problems))
    return resolved


def import_program_package(
    connection: sqlite3.Connection, package: ProgramPackage, *, now: str | None = None
) -> ImportResult:
    """Append one immutable program version. An exact duplicate writes nothing."""
    stamp = now if now is not None else utc_now_iso()
    spec = package.spec
    with db.immediate_transaction(connection):
        existing = _find_by_package_hash(connection, package.package_sha256)
        if existing is not None:
            return ImportResult(version=existing, created=False)

        exercise_ids = _resolve_exercises(connection, package)
        version_id = new_id()
        connection.execute(
            "INSERT INTO program_version (id, program_key, name, version_label, "
            "duration_weeks, package_format, package_sha256, program_json_sha256, "
            "program_json_text, notes_sha256, notes_text, imported_at_utc) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                version_id,
                spec.key,
                spec.name,
                spec.version_label,
                spec.duration_weeks,
                PACKAGE_FORMAT,
                package.package_sha256,
                package.program_json_sha256,
                package.program_json_text,
                package.notes_sha256,
                package.notes_text,
                stamp,
            ),
        )
        for sequence, workout in enumerate(spec.workouts, start=1):
            planned_id = new_id()
            connection.execute(
                "INSERT INTO planned_workout (id, program_version_id, workout_key, sequence, "
                "name, day_label, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    planned_id,
                    version_id,
                    workout.key,
                    sequence,
                    workout.name,
                    workout.day_label,
                    workout.notes,
                ),
            )
            for position, slot in enumerate(workout.slots, start=1):
                slot_id = new_id()
                connection.execute(
                    "INSERT INTO planned_exercise_slot (id, planned_workout_id, slot_key, "
                    "position, exercise_id, notes) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        slot_id,
                        planned_id,
                        slot.key,
                        position,
                        exercise_ids[slot.exercise],
                        slot.notes,
                    ),
                )
                for set_position, planned in enumerate(slot.sets, start=1):
                    connection.execute(
                        "INSERT INTO planned_set (id, slot_id, position, set_type, reps_min, "
                        "reps_max, target_rir_min, target_rir_max, target_load_g, notes) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            new_id(),
                            slot_id,
                            set_position,
                            planned.set_type.value,
                            planned.reps_min,
                            planned.reps_max,
                            planned.target_rir_min,
                            planned.target_rir_max,
                            kg_to_g(planned.target_load_kg),
                            planned.notes,
                        ),
                    )
        created = get_program_version(connection, version_id)
    assert created is not None
    return ImportResult(version=created, created=True)


def activate_program_version(
    connection: sqlite3.Connection, version_id: str, *, now: str | None = None
) -> None:
    """Make ``version_id`` the one active version. Existing drafts are unaffected."""
    stamp = now if now is not None else utc_now_iso()
    with db.immediate_transaction(connection):
        if get_program_version(connection, version_id) is None:
            raise ProgramStateError(f"no program version with id {version_id!r}")
        connection.execute(
            "INSERT INTO active_program_version (singleton, program_version_id, "
            "activated_at_utc) VALUES (1, ?, ?) "
            "ON CONFLICT (singleton) DO UPDATE SET "
            "program_version_id = excluded.program_version_id, "
            "activated_at_utc = excluded.activated_at_utc",
            (version_id, stamp),
        )


def deactivate_program(connection: sqlite3.Connection) -> None:
    """Zero active versions is a legal state."""
    connection.execute("DELETE FROM active_program_version")


def get_active_version(connection: sqlite3.Connection) -> ProgramVersionRow | None:
    row = connection.execute(
        f"SELECT {', '.join('v.' + c for c in VERSION_COLUMNS.split(', '))} "
        "FROM active_program_version a JOIN program_version v ON v.id = a.program_version_id"
    ).fetchone()
    return None if row is None else _row_to_version(row)


def get_activated_at(connection: sqlite3.Connection) -> str | None:
    row = connection.execute("SELECT activated_at_utc FROM active_program_version").fetchone()
    return None if row is None else str(row["activated_at_utc"])


def list_program_versions(connection: sqlite3.Connection) -> tuple[ProgramVersionRow, ...]:
    rows = connection.execute(
        f"SELECT {VERSION_COLUMNS} FROM program_version ORDER BY imported_at_utc, id"
    ).fetchall()
    return tuple(_row_to_version(row) for row in rows)


def read_program_texts(connection: sqlite3.Connection, version_id: str) -> tuple[str, str | None]:
    row = connection.execute(
        "SELECT program_json_text, notes_text FROM program_version WHERE id = ?", (version_id,)
    ).fetchone()
    if row is None:
        raise ProgramStateError(f"no program version with id {version_id!r}")
    return str(row["program_json_text"]), _optional_str(row["notes_text"])


def list_planned_workouts(
    connection: sqlite3.Connection, version_id: str
) -> tuple[PlannedWorkoutRow, ...]:
    rows = connection.execute(
        f"SELECT {PLANNED_WORKOUT_COLUMNS} FROM planned_workout "
        "WHERE program_version_id = ? ORDER BY sequence",
        (version_id,),
    ).fetchall()
    return tuple(_row_to_planned_workout(row) for row in rows)


def get_planned_workout(
    connection: sqlite3.Connection, planned_workout_id: str
) -> PlannedWorkoutRow | None:
    row = connection.execute(
        f"SELECT {PLANNED_WORKOUT_COLUMNS} FROM planned_workout WHERE id = ?",
        (planned_workout_id,),
    ).fetchone()
    return None if row is None else _row_to_planned_workout(row)


def list_slots(connection: sqlite3.Connection, planned_workout_id: str) -> tuple[SlotRow, ...]:
    slot_rows = connection.execute(
        "SELECT id, planned_workout_id, slot_key, position, exercise_id, notes "
        "FROM planned_exercise_slot WHERE planned_workout_id = ? ORDER BY position",
        (planned_workout_id,),
    ).fetchall()
    set_rows = connection.execute(
        "SELECT s.id, s.slot_id, s.position, s.set_type, s.reps_min, s.reps_max, "
        "s.target_rir_min, s.target_rir_max, s.target_load_g, s.notes "
        "FROM planned_set s JOIN planned_exercise_slot slot ON slot.id = s.slot_id "
        "WHERE slot.planned_workout_id = ? ORDER BY slot.position, s.position",
        (planned_workout_id,),
    ).fetchall()
    sets_by_slot: dict[str, list[PlannedSetRow]] = {}
    for row in set_rows:
        sets_by_slot.setdefault(str(row["slot_id"]), []).append(
            PlannedSetRow(
                id=str(row["id"]),
                position=int(row["position"]),
                set_type=str(row["set_type"]),
                reps_min=int(row["reps_min"]),
                reps_max=_optional_int(row["reps_max"]),
                target_rir_min=_optional_int(row["target_rir_min"]),
                target_rir_max=_optional_int(row["target_rir_max"]),
                target_load_kg=g_to_kg(_optional_int(row["target_load_g"])),
                notes=_optional_str(row["notes"]),
            )
        )
    return tuple(
        SlotRow(
            id=str(row["id"]),
            planned_workout_id=str(row["planned_workout_id"]),
            slot_key=str(row["slot_key"]),
            position=int(row["position"]),
            exercise_id=str(row["exercise_id"]),
            notes=_optional_str(row["notes"]),
            sets=tuple(sets_by_slot.get(str(row["id"]), ())),
        )
        for row in slot_rows
    )


def get_slot(connection: sqlite3.Connection, slot_id: str) -> SlotRow | None:
    row = connection.execute(
        "SELECT planned_workout_id FROM planned_exercise_slot WHERE id = ?", (slot_id,)
    ).fetchone()
    if row is None:
        return None
    for slot in list_slots(connection, str(row["planned_workout_id"])):
        if slot.id == slot_id:
            return slot
    return None
