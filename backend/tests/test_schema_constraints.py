"""The §10 DDL, asserted against a real migrated database."""

from __future__ import annotations

import sqlite3

import pytest

STAMP = "2026-10-01T19:00:00+00:00"


def insert_exercise(
    connection: sqlite3.Connection,
    exercise_id: str,
    name: str,
    equipment_label: str | None = None,
) -> None:
    connection.execute(
        "INSERT INTO exercise (id, name, equipment_label, notes, is_active, "
        "created_at_utc, updated_at_utc) VALUES (?, ?, ?, NULL, 1, ?, ?)",
        (exercise_id, name, equipment_label, STAMP, STAMP),
    )


def insert_workout(
    connection: sqlite3.Connection,
    workout_id: str,
    performed_on: str = "2026-10-01",
    performed_time_local: str | None = "19:45",
    status: str = "draft",
) -> None:
    connection.execute(
        "INSERT INTO workout (id, performed_on, performed_time_local, status, notes, "
        "entered_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, NULL, ?, ?)",
        (workout_id, performed_on, performed_time_local, status, STAMP, STAMP),
    )


def insert_set(connection: sqlite3.Connection, set_id: str, **columns: object) -> None:
    values: dict[str, object] = {
        "id": set_id,
        "workout_id": "w1",
        "exercise_id": "e1",
        "set_order": 1,
        "set_type": None,
        "load_g": None,
        "reps": None,
        "rir": None,
        "notes": None,
        "entered_at_utc": STAMP,
        "updated_at_utc": STAMP,
    }
    values.update(columns)
    names = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    connection.execute(
        f"INSERT INTO performed_set ({names}) VALUES ({placeholders})", tuple(values.values())
    )


@pytest.fixture
def seeded(migrated_db: sqlite3.Connection) -> sqlite3.Connection:
    insert_exercise(migrated_db, "e1", "Incline Chest Press", "Hammer Strength")
    insert_workout(migrated_db, "w1")
    return migrated_db


def test_every_m1_table_is_strict(migrated_db: sqlite3.Connection) -> None:
    rows = migrated_db.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN "
        "('schema_migrations', 'set_type', 'exercise', 'workout', 'performed_set')"
    ).fetchall()
    assert len(rows) == 5
    for row in rows:
        assert "STRICT" in str(row["sql"]).upper(), row["name"]


def test_set_type_is_seeded_in_display_order(migrated_db: sqlite3.Connection) -> None:
    rows = migrated_db.execute(
        "SELECT code, description, sort_order FROM set_type ORDER BY sort_order"
    ).fetchall()

    assert [str(row["code"]) for row in rows] == ["warmup", "working", "backoff"]
    assert [int(row["sort_order"]) for row in rows] == [1, 2, 3]
    assert all(str(row["description"]) for row in rows)


def test_the_expected_indexes_exist(migrated_db: sqlite3.Connection) -> None:
    names = {
        str(row["name"])
        for row in migrated_db.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
    }

    assert {"ux_exercise_identity", "ix_workout_performed_on", "ix_performed_set_exercise"} <= names


def test_workout_has_no_unique_constraint_on_the_date(migrated_db: sqlite3.Connection) -> None:
    """Two sessions on one calendar date are allowed."""
    insert_workout(migrated_db, "w1", performed_on="2026-10-01")
    insert_workout(migrated_db, "w2", performed_on="2026-10-01")

    count = migrated_db.execute(
        "SELECT count(*) AS n FROM workout WHERE performed_on = '2026-10-01'"
    ).fetchone()["n"]
    assert count == 2


def test_a_blank_exercise_name_is_rejected(migrated_db: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_exercise(migrated_db, "e9", "   ")


@pytest.mark.parametrize("label", ["", "   "])
def test_a_blank_equipment_label_is_unstorable(migrated_db: sqlite3.Connection, label: str) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_exercise(migrated_db, "e9", "Incline Chest Press", label)


def test_the_same_name_on_different_equipment_is_two_identities(
    migrated_db: sqlite3.Connection,
) -> None:
    insert_exercise(migrated_db, "e1", "Incline Chest Press", "Technogym Pure Strength")
    insert_exercise(migrated_db, "e2", "Incline Chest Press", "Hammer Strength")

    rows = migrated_db.execute("SELECT id FROM exercise ORDER BY id").fetchall()
    assert [str(row["id"]) for row in rows] == ["e1", "e2"]


def test_case_and_whitespace_variants_are_the_same_identity(
    migrated_db: sqlite3.Connection,
) -> None:
    insert_exercise(migrated_db, "e1", "Incline Chest Press", "Hammer Strength")

    with pytest.raises(sqlite3.IntegrityError, match="ux_exercise_identity"):
        insert_exercise(migrated_db, "e2", "incline chest press", "  hammer strength ")


def test_two_rows_with_the_same_name_and_both_labels_null_are_rejected(
    migrated_db: sqlite3.Connection,
) -> None:
    """The coalesce() in ux_exercise_identity is load-bearing: UNIQUE treats NULLs as distinct."""
    insert_exercise(migrated_db, "e1", "Incline Chest Press", None)

    with pytest.raises(sqlite3.IntegrityError, match="ux_exercise_identity"):
        insert_exercise(migrated_db, "e2", "incline chest press", None)


def test_a_null_equipment_label_does_not_collide_with_a_real_one(
    migrated_db: sqlite3.Connection,
) -> None:
    insert_exercise(migrated_db, "e1", "Incline Chest Press", None)
    insert_exercise(migrated_db, "e2", "Incline Chest Press", "Hammer Strength")

    assert migrated_db.execute("SELECT count(*) AS n FROM exercise").fetchone()["n"] == 2


@pytest.mark.parametrize(
    "performed_on", ["2026-02-31", "2026-13-01", "2026-10-1", "1 Oct 2026", ""]
)
def test_malformed_dates_are_rejected(migrated_db: sqlite3.Connection, performed_on: str) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_workout(migrated_db, "w9", performed_on=performed_on)


@pytest.mark.parametrize("performed_on", ["2026-10-01", "2028-02-29"])
def test_real_dates_are_accepted(migrated_db: sqlite3.Connection, performed_on: str) -> None:
    insert_workout(migrated_db, f"w-{performed_on}", performed_on=performed_on)


@pytest.mark.parametrize("performed_time_local", ["25:00", "7:45", "19:45:30", ""])
def test_malformed_times_are_rejected(
    migrated_db: sqlite3.Connection, performed_time_local: str
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_workout(migrated_db, "w9", performed_time_local=performed_time_local)


def test_a_missing_time_is_not_midnight(migrated_db: sqlite3.Connection) -> None:
    insert_workout(migrated_db, "w1", performed_time_local=None)

    row = migrated_db.execute("SELECT performed_time_local FROM workout WHERE id = 'w1'").fetchone()
    assert row["performed_time_local"] is None


def test_only_draft_and_complete_are_valid_statuses(migrated_db: sqlite3.Connection) -> None:
    insert_workout(migrated_db, "w1", status="draft")
    insert_workout(migrated_db, "w2", status="complete")

    with pytest.raises(sqlite3.IntegrityError):
        insert_workout(migrated_db, "w3", status="abandoned")


def test_strict_rejects_text_in_the_gram_column(seeded: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="TEXT value in INTEGER column"):
        insert_set(seeded, "s1", load_g="heavy")


def test_negative_load_and_negative_reps_are_rejected(seeded: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_set(seeded, "s1", load_g=-1)
    with pytest.raises(sqlite3.IntegrityError):
        insert_set(seeded, "s2", set_order=2, reps=-1)


def test_set_order_is_one_based(seeded: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_set(seeded, "s1", set_order=0)


def test_duplicate_set_positions_are_rejected(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1)

    with pytest.raises(sqlite3.IntegrityError, match="workout_id"):
        insert_set(seeded, "s2", set_order=1)


def test_rir_has_no_database_bound(seeded: sqlite3.Connection) -> None:
    """A methodology assumption must not live in the table most expensive to rebuild."""
    insert_set(seeded, "s1", set_order=1, rir=-1)

    row = seeded.execute("SELECT rir FROM performed_set WHERE id = 's1'").fetchone()
    assert row["rir"] == -1


def test_null_is_distinguishable_from_zero_for_every_nullable_measurement(
    seeded: sqlite3.Connection,
) -> None:
    insert_set(seeded, "s1", set_order=1, load_g=None, reps=None, rir=None)
    insert_set(seeded, "s2", set_order=2, load_g=0, reps=0, rir=0)

    null_row = seeded.execute(
        "SELECT id FROM performed_set WHERE load_g IS NULL AND reps IS NULL AND rir IS NULL"
    ).fetchone()
    zero_row = seeded.execute(
        "SELECT id FROM performed_set WHERE load_g = 0 AND reps = 0 AND rir = 0"
    ).fetchone()

    assert str(null_row["id"]) == "s1"
    assert str(zero_row["id"]) == "s2"


def test_set_type_may_be_null_but_never_invalid(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1, set_type=None)
    insert_set(seeded, "s2", set_order=2, set_type="warmup")

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_set(seeded, "s3", set_order=3, set_type="nope")


def test_set_type_has_no_default(seeded: sqlite3.Connection) -> None:
    """A row autosaved before classification must not silently acquire 'working'."""
    seeded.execute(
        "INSERT INTO performed_set (id, workout_id, exercise_id, set_order, "
        "entered_at_utc, updated_at_utc) VALUES ('s1', 'w1', 'e1', 1, ?, ?)",
        (STAMP, STAMP),
    )

    row = seeded.execute("SELECT set_type FROM performed_set WHERE id = 's1'").fetchone()
    assert row["set_type"] is None


def test_a_referenced_set_type_cannot_be_deleted(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1, set_type="working")

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        seeded.execute("DELETE FROM set_type WHERE code = 'working'")


def test_deleting_a_workout_cascades_to_its_sets(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1)

    seeded.execute("DELETE FROM workout WHERE id = 'w1'")

    assert seeded.execute("SELECT count(*) AS n FROM performed_set").fetchone()["n"] == 0


def test_deleting_a_referenced_exercise_is_blocked(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1)

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        seeded.execute("DELETE FROM exercise WHERE id = 'e1'")


def test_deleting_an_unused_exercise_is_permitted(seeded: sqlite3.Connection) -> None:
    insert_exercise(seeded, "e2", "Never Performed")

    seeded.execute("DELETE FROM exercise WHERE id = 'e2'")

    assert seeded.execute("SELECT count(*) AS n FROM exercise").fetchone()["n"] == 1


def test_load_kg_is_generated_and_read_only(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1, load_g=102500)

    row = seeded.execute("SELECT load_g, load_kg FROM performed_set WHERE id = 's1'").fetchone()
    assert row["load_g"] == 102500
    assert row["load_kg"] == 102.5

    with pytest.raises(sqlite3.OperationalError, match="generated column"):
        seeded.execute("UPDATE performed_set SET load_kg = 5 WHERE id = 's1'")
    with pytest.raises(sqlite3.OperationalError, match="generated column"):
        seeded.execute(
            "INSERT INTO performed_set (id, workout_id, exercise_id, set_order, load_kg, "
            "entered_at_utc, updated_at_utc) VALUES ('s2', 'w1', 'e1', 2, 10.0, ?, ?)",
            (STAMP, STAMP),
        )


def test_load_kg_is_null_when_no_load_is_recorded(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1, load_g=None)

    row = seeded.execute("SELECT load_kg FROM performed_set WHERE id = 's1'").fetchone()
    assert row["load_kg"] is None


def test_a_set_cannot_reference_a_missing_workout_or_exercise(
    seeded: sqlite3.Connection,
) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_set(seeded, "s1", workout_id="nope")
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_set(seeded, "s2", set_order=2, exercise_id="nope")


def test_the_schema_carries_no_deferred_or_future_columns(
    migrated_db: sqlite3.Connection,
) -> None:
    """No movement_family, no group_key, no side, no duration, no program reference."""
    exercise_columns = {
        str(row["name"]) for row in migrated_db.execute("PRAGMA table_info(exercise)")
    }
    set_columns = {
        str(row["name"]) for row in migrated_db.execute("PRAGMA table_info(performed_set)")
    }

    assert "movement_family_id" not in exercise_columns
    assert {"group_key", "side", "duration_seconds", "e1rm", "volume"} & set_columns == set()


def test_foreign_key_check_is_clean_at_head(migrated_db: sqlite3.Connection) -> None:
    assert migrated_db.execute("PRAGMA foreign_key_check").fetchall() == []
