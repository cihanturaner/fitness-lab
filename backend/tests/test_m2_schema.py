"""The 0003 schema: append-only program content, provenance and substitution structure."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from fitness_lab.storage import db
from fitness_lab.storage.migrations import MIGRATIONS_DIR, migrate_to_head
from fitness_lab.storage.snapshots import snapshot_directory

STAMP = "2026-10-01T19:00:00+00:00"
HASH_A = "a" * 64
HASH_B = "b" * 64


def insert_exercise(connection: sqlite3.Connection, exercise_id: str, name: str) -> None:
    connection.execute(
        "INSERT INTO exercise (id, name, equipment_label, notes, is_active, "
        "created_at_utc, updated_at_utc) VALUES (?, ?, NULL, NULL, 1, ?, ?)",
        (exercise_id, name, STAMP, STAMP),
    )


def insert_version(connection: sqlite3.Connection, version_id: str, package_hash: str) -> None:
    connection.execute(
        "INSERT INTO program_version (id, program_key, name, version_label, duration_weeks, "
        "package_format, package_sha256, program_json_sha256, program_json_text, "
        "notes_sha256, notes_text, imported_at_utc) "
        "VALUES (?, 'prog', 'Program', NULL, 12, 1, ?, ?, '{}', NULL, NULL, ?)",
        (version_id, package_hash, HASH_A, STAMP),
    )


def insert_planned_workout(
    connection: sqlite3.Connection, planned_id: str, version_id: str, sequence: int
) -> None:
    connection.execute(
        "INSERT INTO planned_workout (id, program_version_id, workout_key, sequence, name, "
        "day_label, notes) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
        (planned_id, version_id, f"w{sequence}", sequence, f"Workout {sequence}"),
    )


def insert_slot(
    connection: sqlite3.Connection,
    slot_id: str,
    planned_id: str,
    position: int,
    exercise_id: str,
) -> None:
    connection.execute(
        "INSERT INTO planned_exercise_slot (id, planned_workout_id, slot_key, position, "
        "exercise_id, notes) VALUES (?, ?, ?, ?, ?, NULL)",
        (slot_id, planned_id, f"s{position}", position, exercise_id),
    )


def insert_planned_set(connection: sqlite3.Connection, set_id: str, **columns: object) -> None:
    values: dict[str, object] = {
        "id": set_id,
        "slot_id": "s1",
        "position": 1,
        "set_type": "working",
        "reps_min": 5,
        "reps_max": 8,
        "target_rir_min": None,
        "target_rir_max": None,
        "target_load_g": None,
        "notes": None,
    }
    values.update(columns)
    names = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    connection.execute(
        f"INSERT INTO planned_set ({names}) VALUES ({placeholders})", tuple(values.values())
    )


def insert_workout(connection: sqlite3.Connection, workout_id: str, status: str = "draft") -> None:
    connection.execute(
        "INSERT INTO workout (id, performed_on, performed_time_local, status, notes, "
        "entered_at_utc, updated_at_utc) VALUES (?, '2026-10-01', NULL, ?, NULL, ?, ?)",
        (workout_id, status, STAMP, STAMP),
    )


def insert_origin(connection: sqlite3.Connection, workout_id: str, planned_id: str) -> None:
    connection.execute(
        "INSERT INTO workout_plan_origin (workout_id, planned_workout_id, created_at_utc) "
        "VALUES (?, ?, ?)",
        (workout_id, planned_id, STAMP),
    )


def insert_substitution(
    connection: sqlite3.Connection,
    workout_id: str,
    planned_id: str,
    slot_id: str,
    exercise_id: str,
) -> None:
    connection.execute(
        "INSERT INTO workout_slot_substitution (workout_id, planned_workout_id, slot_id, "
        "exercise_id, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?)",
        (workout_id, planned_id, slot_id, exercise_id, STAMP, STAMP),
    )


@pytest.fixture
def plan(migrated_db: sqlite3.Connection) -> sqlite3.Connection:
    """Version v1 with planned workouts p1 (slots s1: e1, s2: e2, s3: e1 — A/B/A) and p2."""
    connection = migrated_db
    for exercise_id, name in (("e1", "Bench"), ("e2", "Row"), ("e3", "Press")):
        insert_exercise(connection, exercise_id, name)
    insert_version(connection, "v1", HASH_A)
    insert_planned_workout(connection, "p1", "v1", 1)
    insert_planned_workout(connection, "p2", "v1", 2)
    insert_slot(connection, "s1", "p1", 1, "e1")
    insert_slot(connection, "s2", "p1", 2, "e2")
    insert_slot(connection, "s3", "p1", 3, "e1")
    insert_slot(connection, "q1", "p2", 1, "e2")
    insert_planned_set(connection, "ps1")
    insert_workout(connection, "w1")
    insert_origin(connection, "w1", "p1")
    return connection


# --- append-only content -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("table", "key_column", "key", "column", "value"),
    [
        ("program_version", "id", "v1", "name", "Changed"),
        ("planned_workout", "id", "p1", "name", "Changed"),
        ("planned_exercise_slot", "id", "s1", "notes", "Changed"),
        ("planned_set", "id", "ps1", "reps_min", 6),
    ],
)
def test_program_content_refuses_update(
    plan: sqlite3.Connection, table: str, key_column: str, key: str, column: str, value: object
) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        plan.execute(f"UPDATE {table} SET {column} = ? WHERE {key_column} = ?", (value, key))


@pytest.mark.parametrize(
    ("table", "key"),
    [
        ("planned_set", "ps1"),
        ("planned_exercise_slot", "s2"),
        ("planned_workout", "p2"),
        ("program_version", "v1"),
    ],
)
def test_program_content_refuses_delete(plan: sqlite3.Connection, table: str, key: str) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        plan.execute(f"DELETE FROM {table} WHERE id = ?", (key,))


def test_package_hash_is_unique(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="already exists"):
        insert_version(plan, "v2", HASH_A)


def test_package_hash_must_be_lowercase_hex(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        insert_version(plan, "v2", "A" * 64)


def test_notes_hash_and_text_travel_together(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        plan.execute(
            "INSERT INTO program_version (id, program_key, name, package_format, "
            "package_sha256, program_json_sha256, program_json_text, notes_sha256, notes_text, "
            "imported_at_utc) VALUES ('v2', 'prog', 'P', 1, ?, ?, '{}', ?, NULL, ?)",
            (HASH_B, HASH_A, HASH_A, STAMP),
        )


def test_slot_positions_are_unique_within_a_planned_workout(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="already exists"):
        insert_slot(plan, "s9", "p1", 1, "e3")


def test_slot_exercise_must_exist(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_slot(plan, "s9", "p1", 9, "nope")


def test_exact_range_and_open_ended_reps_are_storable(plan: sqlite3.Connection) -> None:
    insert_planned_set(plan, "ps2", position=2, reps_min=8, reps_max=8)
    insert_planned_set(plan, "ps3", position=3, reps_min=8, reps_max=None)


@pytest.mark.parametrize(
    "columns",
    [
        {"reps_min": 0},
        {"reps_min": None},
        {"reps_min": 8, "reps_max": 5},
        {"target_rir_min": 1, "target_rir_max": None},
        {"target_rir_min": None, "target_rir_max": 1},
        {"target_rir_min": 2, "target_rir_max": 1},
        {"target_load_g": -1},
        {"position": 0},
    ],
)
def test_planned_set_checks(plan: sqlite3.Connection, columns: dict[str, object]) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_planned_set(plan, "psx", **({"position": 2} | columns))


def test_planned_set_type_must_be_a_known_code(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_planned_set(plan, "psx", position=2, set_type="amrap")


def test_planned_set_type_is_required(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="NOT NULL"):
        insert_planned_set(plan, "psx", position=2, set_type=None)


# --- activation --------------------------------------------------------------------------


def test_at_most_one_active_version(plan: sqlite3.Connection) -> None:
    plan.execute(
        "INSERT INTO active_program_version (singleton, program_version_id, activated_at_utc) "
        "VALUES (1, 'v1', ?)",
        (STAMP,),
    )
    with pytest.raises(sqlite3.IntegrityError):
        plan.execute(
            "INSERT INTO active_program_version (singleton, program_version_id, "
            "activated_at_utc) VALUES (2, 'v1', ?)",
            (STAMP,),
        )


def test_active_version_must_exist(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        plan.execute(
            "INSERT INTO active_program_version (singleton, program_version_id, "
            "activated_at_utc) VALUES (1, 'nope', ?)",
            (STAMP,),
        )


# --- provenance --------------------------------------------------------------------------


def test_origin_cannot_be_rebound(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        plan.execute("UPDATE workout_plan_origin SET planned_workout_id = 'p2'")


def test_origin_cannot_be_cleared_while_the_workout_exists(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        plan.execute("DELETE FROM workout_plan_origin WHERE workout_id = 'w1'")


def test_a_workout_has_at_most_one_origin(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        insert_origin(plan, "w1", "p2")


def test_deleting_the_workout_removes_origin_and_substitutions(plan: sqlite3.Connection) -> None:
    insert_substitution(plan, "w1", "p1", "s1", "e3")
    plan.execute("DELETE FROM workout WHERE id = 'w1'")
    assert plan.execute("SELECT count(*) FROM workout_plan_origin").fetchone()[0] == 0
    assert plan.execute("SELECT count(*) FROM workout_slot_substitution").fetchone()[0] == 0


def test_a_referenced_planned_workout_cannot_disappear(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        plan.execute("DELETE FROM planned_workout WHERE id = 'p1'")


# --- substitution ------------------------------------------------------------------------


def test_repeated_slots_substitute_independently(plan: sqlite3.Connection) -> None:
    insert_substitution(plan, "w1", "p1", "s1", "e3")
    insert_substitution(plan, "w1", "p1", "s3", "e2")
    rows = plan.execute(
        "SELECT slot_id, exercise_id FROM workout_slot_substitution ORDER BY slot_id"
    ).fetchall()
    assert [tuple(row) for row in rows] == [("s1", "e3"), ("s3", "e2")]


def test_one_substitution_per_slot_per_workout(plan: sqlite3.Connection) -> None:
    insert_substitution(plan, "w1", "p1", "s1", "e3")
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        insert_substitution(plan, "w1", "p1", "s1", "e2")


def test_substituting_a_slot_of_another_planned_workout_fails(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_substitution(plan, "w1", "p1", "q1", "e3")


def test_claiming_a_different_origin_fails(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_substitution(plan, "w1", "p2", "q1", "e3")


def test_unplanned_workouts_cannot_hold_substitutions(plan: sqlite3.Connection) -> None:
    insert_workout(plan, "w2")
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_substitution(plan, "w2", "p1", "s1", "e3")


def test_substituting_the_planned_exercise_is_refused(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="planned exercise"):
        insert_substitution(plan, "w1", "p1", "s1", "e1")
    insert_substitution(plan, "w1", "p1", "s1", "e3")
    with pytest.raises(sqlite3.IntegrityError, match="planned exercise"):
        plan.execute("UPDATE workout_slot_substitution SET exercise_id = 'e1'")


def test_complete_workouts_cannot_change_substitution(plan: sqlite3.Connection) -> None:
    insert_substitution(plan, "w1", "p1", "s1", "e3")
    plan.execute("UPDATE workout SET status = 'complete' WHERE id = 'w1'")
    with pytest.raises(sqlite3.IntegrityError, match="complete"):
        insert_substitution(plan, "w1", "p1", "s2", "e3")
    with pytest.raises(sqlite3.IntegrityError, match="complete"):
        plan.execute("UPDATE workout_slot_substitution SET exercise_id = 'e2'")
    with pytest.raises(sqlite3.IntegrityError, match="complete"):
        plan.execute("DELETE FROM workout_slot_substitution")
    plan.execute("UPDATE workout SET status = 'draft' WHERE id = 'w1'")
    plan.execute("DELETE FROM workout_slot_substitution")


def test_a_complete_workout_can_still_be_deleted_whole(plan: sqlite3.Connection) -> None:
    insert_substitution(plan, "w1", "p1", "s1", "e3")
    plan.execute("UPDATE workout SET status = 'complete' WHERE id = 'w1'")
    plan.execute("DELETE FROM workout WHERE id = 'w1'")
    assert plan.execute("SELECT count(*) FROM workout_slot_substitution").fetchone()[0] == 0


# --- database health and migration behaviour ---------------------------------------------


def test_integrity_and_foreign_keys_are_clean(plan: sqlite3.Connection) -> None:
    insert_substitution(plan, "w1", "p1", "s1", "e3")
    assert plan.execute("PRAGMA foreign_key_check").fetchall() == []
    assert plan.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    assert plan.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_m1_database_is_migrated_additively(tmp_path: Path) -> None:
    m1_dir = tmp_path / "m1-migrations"
    m1_dir.mkdir()
    for name in ("0001_baseline.sql", "0002_performed_training.sql"):
        shutil.copyfile(MIGRATIONS_DIR / name, m1_dir / name)
    db_path = tmp_path / "fitness_lab.db"
    migrate_to_head(db_path, directory=m1_dir)
    with db.connection_scope(db_path) as connection:
        insert_exercise(connection, "e1", "Bench")
        insert_workout(connection, "w1", status="complete")
        connection.execute(
            "INSERT INTO performed_set (id, workout_id, exercise_id, set_order, set_type, load_g, "
            "reps, rir, notes, entered_at_utc, updated_at_utc) "
            "VALUES ('ps', 'w1', 'e1', 1, 'working', 82500, 5, 2, NULL, ?, ?)",
            (STAMP, STAMP),
        )
        before = {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
            for table in ("exercise", "workout", "performed_set", "m0_technical_check")
        }
        before = {table: [tuple(row) for row in rows] for table, rows in before.items()}

    # Head moves on (0004); this test is about the M1 -> M2 step, so it stops at 0003.
    shutil.copyfile(
        MIGRATIONS_DIR / "0003_planned_program.sql", m1_dir / "0003_planned_program.sql"
    )
    result = migrate_to_head(db_path, directory=m1_dir)

    assert result.applied == (3,)
    assert result.snapshot is not None and result.snapshot.name.endswith("-pre-0003.db")
    with db.connection_scope(db_path) as connection:
        after = {
            table: [
                tuple(row)
                for row in connection.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
            ]
            for table in before
        }
        assert after == before
        assert connection.execute("SELECT count(*) FROM workout_plan_origin").fetchone()[0] == 0
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        versions = [row[0] for row in connection.execute("SELECT version FROM schema_migrations")]
        assert versions == [1, 2, 3]

    snapshots_before = sorted(snapshot_directory(db_path).iterdir())
    second = migrate_to_head(db_path, directory=m1_dir)
    assert second.applied == ()
    assert second.snapshot is None
    assert sorted(snapshot_directory(db_path).iterdir()) == snapshots_before


# --- review findings: REPLACE bypass, late attachment, M1 deletion paths -------------------


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT OR REPLACE INTO planned_set (id, slot_id, position, set_type, reps_min, "
        "reps_max) VALUES ('ps1', 's1', 1, 'working', 99, NULL)",
        "REPLACE INTO planned_set (id, slot_id, position, set_type, reps_min, reps_max) "
        "VALUES ('new', 's1', 1, 'working', 99, NULL)",
        "INSERT OR REPLACE INTO planned_exercise_slot (id, planned_workout_id, slot_key, "
        "position, exercise_id) VALUES ('s2', 'p1', 's2', 2, 'e3')",
        "REPLACE INTO planned_exercise_slot (id, planned_workout_id, slot_key, position, "
        "exercise_id) VALUES ('new', 'p1', 'other', 2, 'e3')",
        "INSERT OR REPLACE INTO planned_workout (id, program_version_id, workout_key, sequence, "
        "name) VALUES ('p2', 'v1', 'w2', 2, 'Renamed')",
        "INSERT OR REPLACE INTO program_version (id, program_key, name, package_format, "
        "package_sha256, program_json_sha256, program_json_text, imported_at_utc) "
        f"VALUES ('v9', 'prog', 'P', 1, '{HASH_A}', '{HASH_A}', '{{}}', 'x')",
    ],
)
def test_replace_cannot_rewrite_program_content(plan: sqlite3.Connection, statement: str) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        plan.execute(statement)


def test_upsert_cannot_rewrite_program_content(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        plan.execute(
            "INSERT INTO planned_set (id, slot_id, position, set_type, reps_min, reps_max) "
            "VALUES ('ps1', 's1', 1, 'working', 99, NULL) "
            "ON CONFLICT (id) DO UPDATE SET reps_min = excluded.reps_min"
        )


def test_replace_cannot_rebind_an_origin(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        plan.execute(
            "INSERT OR REPLACE INTO workout_plan_origin (workout_id, planned_workout_id, "
            "created_at_utc) VALUES ('w1', 'p2', 'x')"
        )


def test_replace_cannot_recreate_a_workout(plan: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="already exists"):
        plan.execute(
            "INSERT OR REPLACE INTO workout (id, performed_on, status, entered_at_utc, "
            "updated_at_utc) VALUES ('w1', '2026-10-02', 'draft', 'x', 'x')"
        )
    assert plan.execute("SELECT count(*) FROM workout_plan_origin").fetchone()[0] == 1


def test_an_origin_cannot_be_attached_to_a_complete_workout(plan: sqlite3.Connection) -> None:
    insert_workout(plan, "w2", status="complete")
    with pytest.raises(sqlite3.IntegrityError, match="creation"):
        insert_origin(plan, "w2", "p1")


def test_an_origin_cannot_be_attached_to_a_workout_with_sets(plan: sqlite3.Connection) -> None:
    insert_workout(plan, "w2")
    plan.execute(
        "INSERT INTO performed_set (id, workout_id, exercise_id, set_order, entered_at_utc, "
        "updated_at_utc) VALUES ('x', 'w2', 'e1', 1, 'x', 'x')"
    )
    with pytest.raises(sqlite3.IntegrityError, match="creation"):
        insert_origin(plan, "w2", "p1")


def test_m1_deletion_paths_still_work_for_planned_workouts(
    plan: sqlite3.Connection, db_path: Path
) -> None:
    from fitness_lab.storage.workouts import delete_complete_workout, delete_draft_workout

    insert_substitution(plan, "w1", "p1", "s1", "e3")
    delete_draft_workout(plan, "w1")

    insert_workout(plan, "w2")
    insert_origin(plan, "w2", "p1")
    insert_substitution(plan, "w2", "p1", "s1", "e3")
    plan.execute("UPDATE workout SET status = 'complete' WHERE id = 'w2'")
    snapshot = delete_complete_workout(
        plan, "w2", db_path=db_path, i_understand_this_deletes_evidence=True
    )

    assert snapshot.exists()
    assert plan.execute("SELECT count(*) FROM workout_plan_origin").fetchone()[0] == 0
    assert plan.execute("SELECT count(*) FROM workout_slot_substitution").fetchone()[0] == 0
    assert plan.execute("PRAGMA foreign_key_check").fetchall() == []


def test_an_exercise_used_by_a_plan_cannot_be_deleted(plan: sqlite3.Connection) -> None:
    from fitness_lab.storage.exercises import delete_exercise

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        delete_exercise(plan, "e2")


# --- final council: REPLACE and id rewrites on the M1 evidence tables -----------------------


def test_update_or_replace_cannot_rewrite_a_workout_id(plan: sqlite3.Connection) -> None:
    insert_workout(plan, "w2")
    with pytest.raises(sqlite3.IntegrityError, match="never changes"):
        plan.execute("UPDATE OR REPLACE workout SET id = 'w1' WHERE id = 'w2'")
    assert plan.execute("SELECT count(*) FROM workout_plan_origin").fetchone()[0] == 1


def performed_sql(set_id: str, order: int, reps: int, verb: str = "INSERT") -> str:
    return (
        f"{verb} INTO performed_set (id, workout_id, exercise_id, set_order, set_type, load_g, "
        "reps, rir, notes, entered_at_utc, updated_at_utc) "
        f"VALUES ('{set_id}', 'w1', 'e1', {order}, 'working', 80000, {reps}, 2, NULL, "
        f"'{STAMP}', '{STAMP}')"
    )


@pytest.mark.parametrize(
    "statement",
    [
        performed_sql("evil", 1, 99, verb="INSERT OR REPLACE"),  # collides on (workout, order)
        performed_sql("k1", 7, 99, verb="INSERT OR REPLACE"),  # collides on id
        performed_sql("evil", 1, 99, verb="REPLACE"),
    ],
)
def test_replace_cannot_overwrite_a_performed_set(plan: sqlite3.Connection, statement: str) -> None:
    plan.execute(performed_sql("k1", 1, 5))
    with pytest.raises(sqlite3.IntegrityError, match="never replaced"):
        plan.execute(statement)
    rows = plan.execute("SELECT id, reps FROM performed_set").fetchall()
    assert [tuple(row) for row in rows] == [("k1", 5)]


def test_a_performed_set_id_never_changes(plan: sqlite3.Connection) -> None:
    plan.execute(performed_sql("k1", 1, 5))
    with pytest.raises(sqlite3.IntegrityError, match="never changes"):
        plan.execute("UPDATE performed_set SET id = 'k2' WHERE id = 'k1'")


def test_set_order_renumbering_still_works(plan: sqlite3.Connection) -> None:
    plan.execute(performed_sql("k1", 1, 5))
    plan.execute(performed_sql("k2", 2, 6))
    plan.execute("UPDATE performed_set SET set_order = set_order + 1000 WHERE workout_id = 'w1'")
    plan.execute(
        "UPDATE performed_set SET set_order = 3 - (set_order - 1000) WHERE workout_id = 'w1'"
    )
    rows = plan.execute("SELECT id, set_order FROM performed_set ORDER BY set_order").fetchall()
    assert [tuple(row) for row in rows] == [("k2", 1), ("k1", 2)]


def test_update_or_replace_cannot_overwrite_a_performed_set(plan: sqlite3.Connection) -> None:
    plan.execute(performed_sql("k1", 1, 5))
    plan.execute(performed_sql("k2", 2, 6))
    with pytest.raises(sqlite3.IntegrityError, match="never replaced"):
        plan.execute("UPDATE OR REPLACE performed_set SET set_order = 1 WHERE id = 'k2'")
    assert plan.execute("SELECT count(*) FROM performed_set").fetchone()[0] == 2
