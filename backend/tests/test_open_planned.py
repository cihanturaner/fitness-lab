"""Opening a planned workout: one empty draft, immutable origin, resume, concurrency."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

import pytest

from fitness_lab.domain.models import WorkoutStatus, new_draft_workout
from fitness_lab.storage import db
from fitness_lab.storage.entry import (
    Conflict,
    NotFound,
    complete,
    create_unplanned_workout,
    get_origin,
    open_planned_workout,
)
from fitness_lab.storage.programs import (
    PlannedWorkoutRow,
    activate_program_version,
    deactivate_program,
    import_program_package,
    list_planned_workouts,
)
from fitness_lab.storage.workouts import get_workout, insert_workout
from program_fixtures import document, package, seed_exercises

DAY = "2026-10-05"


def setup_active(connection: sqlite3.Connection) -> tuple[PlannedWorkoutRow, PlannedWorkoutRow]:
    seed_exercises(connection)
    version = import_program_package(connection, package()).version
    activate_program_version(connection, version.id)
    upper, lower = list_planned_workouts(connection, version.id)
    return upper, lower


def count(connection: sqlite3.Connection, table: str) -> int:
    return int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def test_open_creates_one_empty_draft_with_origin(migrated_db: sqlite3.Connection) -> None:
    upper, _ = setup_active(migrated_db)

    result = open_planned_workout(migrated_db, upper.id, performed_on=DAY)

    assert result.created is True
    assert result.workout.status is WorkoutStatus.DRAFT
    assert result.workout.performed_on == DAY
    assert count(migrated_db, "workout") == 1
    assert count(migrated_db, "performed_set") == 0
    origin = get_origin(migrated_db, result.workout.id)
    assert origin is not None
    assert origin.planned_workout_id == upper.id
    assert origin.planned_workout_name == "Upper A"
    assert origin.workout_key == "upper_a"
    assert origin.program_name == "Test Program"


def test_opening_again_resumes_the_same_draft(migrated_db: sqlite3.Connection) -> None:
    upper, _ = setup_active(migrated_db)
    first = open_planned_workout(migrated_db, upper.id, performed_on=DAY)

    second = open_planned_workout(migrated_db, upper.id, performed_on="2026-10-09")

    assert second.created is False
    assert second.workout.id == first.workout.id
    assert second.workout.performed_on == DAY
    assert count(migrated_db, "workout") == 1


def test_each_planned_workout_has_its_own_draft(migrated_db: sqlite3.Connection) -> None:
    upper, lower = setup_active(migrated_db)
    first = open_planned_workout(migrated_db, upper.id, performed_on=DAY)
    second = open_planned_workout(migrated_db, lower.id, performed_on=DAY)
    assert first.workout.id != second.workout.id


def test_a_completed_occurrence_allows_a_new_one(migrated_db: sqlite3.Connection) -> None:
    upper, _ = setup_active(migrated_db)
    first = open_planned_workout(migrated_db, upper.id, performed_on=DAY)
    migrated_db.execute("UPDATE workout SET status = 'complete' WHERE id = ?", (first.workout.id,))

    second = open_planned_workout(migrated_db, upper.id, performed_on="2026-10-12")

    assert second.created is True
    assert second.workout.id != first.workout.id
    assert count(migrated_db, "performed_set") == 0


def test_unknown_planned_workout_is_not_found(migrated_db: sqlite3.Connection) -> None:
    setup_active(migrated_db)
    with pytest.raises(NotFound):
        open_planned_workout(migrated_db, "nope", performed_on=DAY)


def test_opening_needs_the_active_version(migrated_db: sqlite3.Connection) -> None:
    upper, _ = setup_active(migrated_db)
    deactivate_program(migrated_db)

    with pytest.raises(Conflict, match="active"):
        open_planned_workout(migrated_db, upper.id, performed_on=DAY)
    assert count(migrated_db, "workout") == 0


def test_an_existing_draft_resumes_even_after_the_active_version_changes(
    migrated_db: sqlite3.Connection,
) -> None:
    upper, _ = setup_active(migrated_db)
    draft = open_planned_workout(migrated_db, upper.id, performed_on=DAY).workout
    other = import_program_package(migrated_db, package(document("other-program"))).version
    activate_program_version(migrated_db, other.id)

    resumed = open_planned_workout(migrated_db, upper.id, performed_on=DAY)

    assert resumed.created is False
    assert resumed.workout.id == draft.id
    origin = get_origin(migrated_db, draft.id)
    assert origin is not None and origin.planned_workout_id == upper.id
    assert origin.program_version_id == upper.program_version_id


def test_a_planned_workout_of_an_inactive_version_cannot_start_a_new_draft(
    migrated_db: sqlite3.Connection,
) -> None:
    upper, _ = setup_active(migrated_db)
    other = import_program_package(migrated_db, package(document("other-program"))).version
    activate_program_version(migrated_db, other.id)

    with pytest.raises(Conflict):
        open_planned_workout(migrated_db, upper.id, performed_on=DAY)


def test_m1_and_unplanned_workouts_have_no_origin(migrated_db: sqlite3.Connection) -> None:
    setup_active(migrated_db)
    legacy = new_draft_workout("2026-09-30")
    insert_workout(migrated_db, legacy)

    unplanned = create_unplanned_workout(migrated_db, performed_on=DAY)

    assert get_origin(migrated_db, legacy.id) is None
    assert get_origin(migrated_db, unplanned.id) is None
    stored = get_workout(migrated_db, unplanned.id)
    assert stored is not None and stored.status is WorkoutStatus.DRAFT
    assert count(migrated_db, "workout_plan_origin") == 0


def test_the_origin_survives_completion_and_reopening(migrated_db: sqlite3.Connection) -> None:
    upper, _ = setup_active(migrated_db)
    workout = open_planned_workout(migrated_db, upper.id, performed_on=DAY).workout
    migrated_db.execute(
        "INSERT INTO performed_set (id, workout_id, exercise_id, set_order, set_type, load_g, "
        "reps, rir, notes, entered_at_utc, updated_at_utc) "
        "SELECT 'ps', ?, exercise_id, 1, 'working', 80000, 5, 2, NULL, 'x', 'x' "
        "FROM planned_exercise_slot LIMIT 1",
        (workout.id,),
    )
    complete(migrated_db, workout.id)
    origin = get_origin(migrated_db, workout.id)
    assert origin is not None and origin.planned_workout_id == upper.id


def test_concurrent_opens_create_exactly_one_draft(db_path: Path) -> None:
    from fitness_lab.storage.migrations import migrate_to_head

    migrate_to_head(db_path)
    with db.connection_scope(db_path) as connection:
        upper, _ = setup_active(connection)

    workers = 6
    barrier = threading.Barrier(workers)
    results: list[str] = []
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            with db.connection_scope(db_path) as connection:
                barrier.wait()
                results.append(
                    open_planned_workout(connection, upper.id, performed_on=DAY).workout.id
                )
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert len(set(results)) == 1
    with db.connection_scope(db_path) as connection:
        assert count(connection, "workout") == 1
        assert count(connection, "workout_plan_origin") == 1
        assert count(connection, "performed_set") == 0


def test_an_invalid_date_is_refused_without_writes(migrated_db: sqlite3.Connection) -> None:
    upper, _ = setup_active(migrated_db)
    with pytest.raises(ValueError, match="date"):
        open_planned_workout(migrated_db, upper.id, performed_on="2026-02-30")
    assert count(migrated_db, "workout") == 0
