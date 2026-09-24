"""Migration 0004 and the V2 repositories against real SQLite files."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from fitness_lab.domain.models import SetTypeCode
from fitness_lab.domain.units import format_kg
from fitness_lab.storage import db, history, tracking
from fitness_lab.storage.entry import NotFound, add_set, complete, open_planned_workout
from fitness_lab.storage.migrations import MIGRATIONS_DIR, migrate_to_head
from fitness_lab.storage.programs import (
    ProgramStateError,
    activate_program_version,
    get_block_start,
    import_program_package,
    list_planned_workouts,
    set_block_start,
)
from program_fixtures import package, seed_exercises

STAMP = "2026-09-23T10:00:00+00:00"


# --- migration ------------------------------------------------------------------------


def test_0004_is_additive_over_a_database_with_training_evidence(tmp_path: Path) -> None:
    before_dir = tmp_path / "m2-migrations"
    before_dir.mkdir()
    for path in sorted(MIGRATIONS_DIR.glob("000[123]_*.sql")):
        shutil.copyfile(path, before_dir / path.name)
    db_path = tmp_path / "fitness_lab.db"
    migrate_to_head(db_path, directory=before_dir)
    with db.connection_scope(db_path) as connection:
        exercises = seed_exercises(connection)
        version = import_program_package(connection, package()).version
        activate_program_version(connection, version.id)
        upper = list_planned_workouts(connection, version.id)[0]
        workout = open_planned_workout(connection, upper.id, performed_on="2026-09-21").workout
        add_set(
            connection,
            workout.id,
            exercise_id=exercises["Bench Press"].id,
            set_type=SetTypeCode.WORKING,
            load_kg=None,
            reps=5,
            rir=2,
            notes=None,
        )
        complete(connection, workout.id)
        tables = [
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        before = {
            table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY 1")]
            for table in tables
            if table != "schema_migrations"
        }

    result = migrate_to_head(db_path)

    assert result.applied == (4, 5)
    assert result.snapshot is not None and result.snapshot.name.endswith("-pre-0004.db")
    with db.connection_scope(db_path) as connection:
        after = {
            table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY 1")]
            for table in before
        }
        assert after == before
        for table in ("bodyweight_entry", "nutrition_day", "calorie_target", "training_block"):
            assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert migrate_to_head(db_path).applied == ()


# --- bodyweight -----------------------------------------------------------------------


def test_one_bodyweight_entry_per_date_and_a_second_save_replaces_it(
    migrated_db: sqlite3.Connection,
) -> None:
    first = tracking.put_bodyweight(migrated_db, "2026-10-01", 72400, None, now=STAMP)
    second = tracking.put_bodyweight(
        migrated_db, "2026-10-01", 72300, "after travel", now="2026-10-01T09:00:00+00:00"
    )
    rows = tracking.list_bodyweight(migrated_db)
    assert len(rows) == 1
    assert rows[0].grams == 72300
    assert rows[0].notes == "after travel"
    # performed/entered distinction: the first entry time survives a correction.
    assert second.entered_at_utc == first.entered_at_utc == STAMP
    assert second.updated_at_utc == "2026-10-01T09:00:00+00:00"


def test_bodyweight_lists_chronologically_within_a_range(migrated_db: sqlite3.Connection) -> None:
    for day, grams in (("2026-10-03", 72300), ("2026-10-01", 72100), ("2026-10-02", 72200)):
        tracking.put_bodyweight(migrated_db, day, grams, None)
    assert [row.measured_on for row in tracking.list_bodyweight(migrated_db)] == [
        "2026-10-01",
        "2026-10-02",
        "2026-10-03",
    ]
    ranged = tracking.list_bodyweight(migrated_db, first="2026-10-02", last="2026-10-02")
    assert [row.grams for row in ranged] == [72200]


def test_a_mistaken_bodyweight_day_can_be_removed(migrated_db: sqlite3.Connection) -> None:
    tracking.put_bodyweight(migrated_db, "2026-10-01", 72400, None)
    tracking.delete_bodyweight(migrated_db, "2026-10-01")
    assert tracking.list_bodyweight(migrated_db) == ()
    with pytest.raises(NotFound):
        tracking.delete_bodyweight(migrated_db, "2026-10-01")


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT INTO bodyweight_entry VALUES ('2026-10-01', 19999, NULL, 'x', 'x')",
        "INSERT INTO bodyweight_entry VALUES ('2026-10-01', 300001, NULL, 'x', 'x')",
        "INSERT INTO bodyweight_entry VALUES ('2026-10-01', 72.4, NULL, 'x', 'x')",
        "INSERT INTO bodyweight_entry VALUES ('2026-10-1', 72400, NULL, 'x', 'x')",
        "INSERT INTO bodyweight_entry VALUES ('2026-02-30', 72400, NULL, 'x', 'x')",
        "INSERT INTO bodyweight_entry VALUES ('2026-10-01', 72400, '  ', 'x', 'x')",
    ],
)
def test_the_schema_refuses_invalid_bodyweight_rows(
    migrated_db: sqlite3.Connection, statement: str
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        migrated_db.execute(statement)


# --- nutrition ------------------------------------------------------------------------


def test_one_nutrition_log_per_date_replaced_on_save(migrated_db: sqlite3.Connection) -> None:
    tracking.put_nutrition_day(
        migrated_db,
        "2026-10-01",
        calories_kcal=2400,
        protein_g=150,
        carbs_g=300,
        fat_g=62,
        notes=None,
        now=STAMP,
    )
    updated = tracking.put_nutrition_day(
        migrated_db,
        "2026-10-01",
        calories_kcal=2500,
        protein_g=148,
        carbs_g=None,
        fat_g=61,
        notes="restaurant",
        now="2026-10-02T08:00:00+00:00",
    )
    day = tracking.get_nutrition_day(migrated_db, "2026-10-01")
    assert day == updated
    assert (day.calories_kcal, day.protein_g, day.carbs_g, day.fat_g) == (2500, 148, None, 61)
    assert day.notes == "restaurant"
    assert day.entered_at_utc == STAMP
    assert tracking.get_nutrition_day(migrated_db, "2026-10-02") is None


def test_nutrition_days_list_and_remove(migrated_db: sqlite3.Connection) -> None:
    for day in ("2026-10-02", "2026-10-01"):
        tracking.put_nutrition_day(
            migrated_db,
            day,
            calories_kcal=2400,
            protein_g=None,
            carbs_g=None,
            fat_g=None,
            notes=None,
        )
    assert [row.logged_on for row in tracking.list_nutrition_days(migrated_db)] == [
        "2026-10-01",
        "2026-10-02",
    ]
    tracking.delete_nutrition_day(migrated_db, "2026-10-01")
    assert [row.logged_on for row in tracking.list_nutrition_days(migrated_db)] == ["2026-10-02"]
    with pytest.raises(NotFound):
        tracking.delete_nutrition_day(migrated_db, "2026-10-01")


def test_an_empty_nutrition_log_is_refused(migrated_db: sqlite3.Connection) -> None:
    with pytest.raises(ValueError):
        tracking.put_nutrition_day(
            migrated_db,
            "2026-10-01",
            calories_kcal=None,
            protein_g=None,
            carbs_g=None,
            fat_g=None,
            notes="x",
        )
    with pytest.raises(sqlite3.IntegrityError):
        migrated_db.execute(
            "INSERT INTO nutrition_day VALUES ('2026-10-01', NULL, NULL, NULL, NULL, 'x', 'x', 'x')"
        )


# --- calorie target -------------------------------------------------------------------


def test_no_calorie_target_until_one_is_set(migrated_db: sqlite3.Connection) -> None:
    assert tracking.calorie_target_on(migrated_db, "2026-10-01") is None


def test_the_target_in_force_is_the_latest_effective_on_or_before_the_date(
    migrated_db: sqlite3.Connection,
) -> None:
    tracking.add_calorie_target(migrated_db, "2026-10-01", 2650, None, now=STAMP)
    tracking.add_calorie_target(migrated_db, "2026-10-22", 2800, "UNDER_GAIN review", now=STAMP)
    assert tracking.calorie_target_on(migrated_db, "2026-09-30") is None
    target = tracking.calorie_target_on(migrated_db, "2026-10-21")
    assert target is not None and target.calories_kcal == 2650
    later = tracking.calorie_target_on(migrated_db, "2026-10-22")
    assert later is not None and later.calories_kcal == 2800


def test_a_same_day_correction_is_a_new_decision_that_wins(migrated_db: sqlite3.Connection) -> None:
    tracking.add_calorie_target(migrated_db, "2026-10-01", 2560, None, now=STAMP)
    tracking.add_calorie_target(
        migrated_db, "2026-10-01", 2650, "typo", now="2026-09-23T10:05:00+00:00"
    )
    target = tracking.calorie_target_on(migrated_db, "2026-10-01")
    assert target is not None and target.calories_kcal == 2650
    assert len(tracking.list_calorie_targets(migrated_db)) == 2


def test_calorie_target_history_is_append_only(migrated_db: sqlite3.Connection) -> None:
    tracking.add_calorie_target(migrated_db, "2026-10-01", 2650, None)
    with pytest.raises(sqlite3.IntegrityError):
        migrated_db.execute("UPDATE calorie_target SET calories_kcal = 3000")
    with pytest.raises(sqlite3.IntegrityError):
        migrated_db.execute("DELETE FROM calorie_target")
    with pytest.raises(ValueError):
        tracking.add_calorie_target(migrated_db, "2026-10-02", 1000, None)
    with pytest.raises(sqlite3.IntegrityError):
        migrated_db.execute(
            "INSERT INTO calorie_target VALUES ('x', '2026-10-01', 1119, NULL, 'x')"
        )


# --- training block -------------------------------------------------------------------


def test_block_start_is_state_per_program_version(migrated_db: sqlite3.Connection) -> None:
    seed_exercises(migrated_db)
    version = import_program_package(migrated_db, package()).version
    assert get_block_start(migrated_db, version.id) is None
    set_block_start(migrated_db, version.id, "2026-10-01")
    assert get_block_start(migrated_db, version.id) == "2026-10-01"
    set_block_start(migrated_db, version.id, "2026-10-05")
    assert get_block_start(migrated_db, version.id) == "2026-10-05"
    with pytest.raises(ProgramStateError):
        set_block_start(migrated_db, "missing", "2026-10-05")
    with pytest.raises(ValueError):
        set_block_start(migrated_db, version.id, "2026-13-01")


# --- history --------------------------------------------------------------------------


def _session(
    connection: sqlite3.Connection,
    planned_id: str,
    day: str,
    sets: list[tuple[str, str | None, int, int | None, SetTypeCode]],
    *,
    finish: bool = True,
) -> str:
    from decimal import Decimal

    workout = open_planned_workout(connection, planned_id, performed_on=day).workout
    for exercise_id, load, reps, rir, set_type in sets:
        add_set(
            connection,
            workout.id,
            exercise_id=exercise_id,
            set_type=set_type,
            load_kg=None if load is None else Decimal(load),
            reps=reps,
            rir=rir,
            notes=None,
        )
    if finish:
        complete(connection, workout.id)
    return workout.id


def test_exercise_history_is_completed_exposures_in_chronological_order(
    migrated_db: sqlite3.Connection,
) -> None:
    exercises = seed_exercises(migrated_db)
    bench, row = exercises["Bench Press"].id, exercises["Row"].id
    version = import_program_package(migrated_db, package()).version
    activate_program_version(migrated_db, version.id)
    upper = list_planned_workouts(migrated_db, version.id)[0]
    w = SetTypeCode.WORKING
    second = _session(
        migrated_db, upper.id, "2026-09-30", [(bench, "85", 6, 2, w), (row, "60", 10, 2, w)]
    )
    first = _session(
        migrated_db,
        upper.id,
        "2026-09-23",
        [
            (bench, "40", 8, None, SetTypeCode.WARMUP),
            (bench, "82.5", 6, 2, w),
            (row, "60", 10, 2, w),
            (bench, "82.5", 5, 1, w),
        ],
    )
    # A draft is not yet evidence.
    _session(migrated_db, upper.id, "2026-10-07", [(bench, "87.5", 6, 2, w)], finish=False)

    exposures = history.exercise_history(migrated_db, bench)

    assert [exposure.workout_id for exposure in exposures] == [first, second]
    assert exposures[0].planned_workout_name == "Upper A"
    assert [
        (format_kg(item.load_kg), item.reps, item.rir, item.set_type) for item in exposures[0].sets
    ] == [
        ("40", 8, None, SetTypeCode.WARMUP),
        ("82.5", 6, 2, w),
        ("82.5", 5, 1, w),
    ]
    assert [item.reps for item in exposures[1].sets] == [6]

    listed = {item.exercise.id: item for item in history.exercises_with_history(migrated_db)}
    assert set(listed) == {bench, row}
    assert listed[bench].exposures == 2
    assert listed[bench].last_performed_on == "2026-09-30"


def test_recent_sessions_group_sets_by_exercise_in_first_appearance_order(
    migrated_db: sqlite3.Connection,
) -> None:
    exercises = seed_exercises(migrated_db)
    bench, row = exercises["Bench Press"].id, exercises["Row"].id
    version = import_program_package(migrated_db, package()).version
    activate_program_version(migrated_db, version.id)
    upper = list_planned_workouts(migrated_db, version.id)[0]
    w = SetTypeCode.WORKING
    older = _session(migrated_db, upper.id, "2026-09-21", [(row, "60", 10, 2, w)])
    newer = _session(
        migrated_db,
        upper.id,
        "2026-09-28",
        [(row, "62.5", 10, 2, w), (bench, "85", 6, 2, w), (row, "62.5", 9, 1, w)],
    )
    sessions = history.recent_sessions(migrated_db, limit=5)
    assert [session.workout_id for session in sessions] == [newer, older]
    groups = sessions[0].exercises
    assert [group.exercise_id for group in groups] == [row, bench]
    assert [item.reps for item in groups[0].sets] == [10, 9]
    assert sessions[0].planned_workout_name == "Upper A"
    assert len(history.recent_sessions(migrated_db, limit=1)) == 1


def test_week_facts_per_planned_workout(migrated_db: sqlite3.Connection) -> None:
    exercises = seed_exercises(migrated_db)
    bench = exercises["Bench Press"].id
    version = import_program_package(migrated_db, package()).version
    activate_program_version(migrated_db, version.id)
    upper, lower = list_planned_workouts(migrated_db, version.id)
    w = SetTypeCode.WORKING
    _session(migrated_db, upper.id, "2026-09-14", [(bench, "80", 6, 2, w)])  # last week
    done = _session(migrated_db, upper.id, "2026-09-21", [(bench, "82.5", 6, 2, w)])
    draft = _session(migrated_db, lower.id, "2026-09-15", [], finish=False)

    facts = history.week_facts(migrated_db, version.id, "2026-09-21", "2026-09-27")

    assert facts[upper.id].open_draft_id is None
    assert facts[upper.id].completed_in_week == ((done, "2026-09-21"),)
    assert facts[lower.id].open_draft_id == draft
    assert facts[lower.id].open_draft_on == "2026-09-15"
    assert facts[lower.id].completed_in_week == ()


def test_unplanned_workouts_in_a_week(migrated_db: sqlite3.Connection) -> None:
    from fitness_lab.storage.entry import create_unplanned_workout

    inside = create_unplanned_workout(migrated_db, performed_on="2026-09-22")
    create_unplanned_workout(migrated_db, performed_on="2026-09-28")
    found = history.unplanned_between(migrated_db, "2026-09-21", "2026-09-27")
    assert [workout.id for workout in found] == [inside.id]
