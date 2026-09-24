"""V3.3.1 migration 0008 over a V3.3 database: additive only, nothing recorded changes, and
sets recorded before it keep exactly the slots they were shown in."""

from __future__ import annotations

import shutil
import sqlite3
from decimal import Decimal
from pathlib import Path

from fitness_lab.domain.models import SetTypeCode
from fitness_lab.storage import db, entry, history
from fitness_lab.storage.migrations import MIGRATIONS_DIR, migrate_to_head
from fitness_lab.storage.programs import activate_program_version, import_program_package
from program_fixtures import package, seed_exercises

DAY = "2026-10-05"
TABLES = (
    "exercise",
    "workout",
    "performed_set",
    "workout_plan_origin",
    "workout_slot_substitution",
    "program_version",
    "planned_exercise_slot",
    "planned_set",
    "macro_target",
)


def _v33_database(tmp_path: Path) -> tuple[Path, str, dict[str, str]]:
    """A database at 0007: an A/B/A session completed with legacy (unplaced) sets, its Row
    slot performed as Squat for that workout only."""
    before = tmp_path / "v33-migrations"
    before.mkdir()
    for path in sorted(MIGRATIONS_DIR.glob("000[1234567]_*.sql")):
        shutil.copyfile(path, before / path.name)
    db_path = tmp_path / "fitness_lab.db"
    migrate_to_head(db_path, directory=before)
    with db.connection_scope(db_path) as connection:
        exercises = {name: item.id for name, item in seed_exercises(connection).items()}
        version = import_program_package(connection, package()).version
        activate_program_version(connection, version.id)
        upper = connection.execute(
            "SELECT id FROM planned_workout WHERE workout_key = 'upper_a'"
        ).fetchone()[0]
        workout = entry.open_planned_workout(connection, upper, performed_on=DAY).workout
        row_slot = connection.execute(
            "SELECT id FROM planned_exercise_slot WHERE slot_key = 'upper_a.02'"
        ).fetchone()[0]
        with db.transaction(connection):
            connection.execute(
                "INSERT INTO workout_slot_substitution VALUES (?, ?, ?, ?, 'x', 'x')",
                (workout.id, upper, row_slot, exercises["Squat"]),
            )
        for name, load in (("Bench Press", "80"), ("Squat", "100"), ("Bench Press", "60")):
            entry.add_set(
                connection,
                workout.id,
                exercise_id=exercises[name],
                set_type=SetTypeCode.WORKING,
                load_kg=Decimal(load),
                reps=8,
                rir=2,
                notes=None,
            )
        entry.complete(connection, workout.id)
    return db_path, workout.id, exercises


def _rows(connection: sqlite3.Connection) -> dict[str, list[tuple[object, ...]]]:
    return {
        table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY rowid")]
        for table in TABLES
    }


def test_0008_is_additive_and_legacy_sets_keep_their_slots(tmp_path: Path) -> None:
    db_path, workout_id, exercises = _v33_database(tmp_path)
    with db.connection_scope(db_path) as connection:
        before = _rows(connection)

    result = migrate_to_head(db_path)

    assert result.applied == (8,)
    assert result.snapshot is not None and result.snapshot.name.endswith("-pre-0008.db")
    with db.connection_scope(db_path) as connection:
        assert _rows(connection) == before
        assert connection.execute("SELECT count(*) FROM performed_set_slot").fetchone()[0] == 0
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"

        # Shown exactly as before 0008: both Bench sets under the first Bench slot, the Squat
        # set under the Row slot it replaced.
        loaded = entry.load_entry(connection, workout_id)
        keys = {item.slot.id: item.slot.slot_key for item in loaded.slots}
        assert sorted(
            (keys[slot] if slot else None, performed_id)
            for performed_id, slot in loaded.set_slots.items()
        ) == sorted(
            (
                "upper_a.02" if item.exercise_id == exercises["Squat"] else "upper_a.01",
                item.id,
            )
            for item in loaded.sets
        )
        groups = history.workout_groups(connection, workout_id)
        assert [(len(group.sets), group.planned_exercise_id) for group in groups] == [
            (2, None),
            (1, exercises["Row"]),
        ]


def test_after_0008_the_repeated_slot_of_an_a_b_a_session_records_its_own_sets(
    tmp_path: Path,
) -> None:
    db_path, _, exercises = _v33_database(tmp_path)
    migrate_to_head(db_path)
    with db.connection_scope(db_path) as connection:
        upper = connection.execute(
            "SELECT id FROM planned_workout WHERE workout_key = 'upper_a'"
        ).fetchone()[0]
        workout = entry.open_planned_workout(connection, upper, performed_on="2026-10-12").workout
        slots = {
            row[0]: row[1]
            for row in connection.execute(
                "SELECT slot_key, id FROM planned_exercise_slot WHERE planned_workout_id = ?",
                (upper,),
            )
        }
        for slot_key, load in (("upper_a.01", "80"), ("upper_a.03", "60"), ("upper_a.03", "60")):
            entry.add_set(
                connection,
                workout.id,
                exercise_id=exercises["Bench Press"],
                set_type=SetTypeCode.WORKING,
                load_kg=Decimal(load),
                reps=10,
                rir=2,
                notes=None,
                slot_id=slots[slot_key],
            )
        loaded = entry.load_entry(connection, workout.id)
        per_slot = {
            key: sum(1 for slot in loaded.set_slots.values() if slot == slot_id)
            for key, slot_id in slots.items()
        }
        assert per_slot == {"upper_a.01": 1, "upper_a.02": 0, "upper_a.03": 2}
