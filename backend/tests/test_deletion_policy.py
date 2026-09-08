"""The smallest policy that is still safe: no audit table, one guarded path."""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from fitness_lab.domain.models import (
    PerformedSet,
    SetTypeCode,
    Workout,
    WorkoutStatus,
    create_exercise,
    new_draft_workout,
    new_id,
)
from fitness_lab.storage.exercises import insert_exercise
from fitness_lab.storage.snapshots import SnapshotError, snapshot_directory
from fitness_lab.storage.workouts import (
    DeletionRefused,
    delete_complete_workout,
    delete_draft_workout,
    delete_performed_set,
    get_workout,
    insert_performed_set,
    insert_workout,
    list_sets_for_workout,
    renumber_workout_sets,
    update_workout,
)

STAMP = "2026-10-01T19:00:00+00:00"


@pytest.fixture
def exercise_id(migrated_db: sqlite3.Connection) -> str:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)
    return exercise.id


@pytest.fixture
def workout(migrated_db: sqlite3.Connection) -> Workout:
    created = new_draft_workout("2026-10-01", now=STAMP)
    insert_workout(migrated_db, created)
    return created


def add_set(
    connection: sqlite3.Connection, workout_id: str, exercise_id: str, set_order: int
) -> PerformedSet:
    performed = PerformedSet(
        id=new_id(),
        workout_id=workout_id,
        exercise_id=exercise_id,
        set_order=set_order,
        set_type=SetTypeCode.WORKING,
        load_kg=Decimal("60"),
        reps=8,
        rir=2,
        notes=None,
        entered_at_utc=STAMP,
        updated_at_utc=STAMP,
    )
    insert_performed_set(connection, performed)
    return performed


def test_removing_a_set_renumbers_the_rest_to_a_dense_sequence(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    first = add_set(migrated_db, workout.id, exercise_id, 1)
    second = add_set(migrated_db, workout.id, exercise_id, 2)
    third = add_set(migrated_db, workout.id, exercise_id, 3)

    remaining = delete_performed_set(migrated_db, second.id)

    assert [performed.id for performed in remaining] == [first.id, third.id]
    assert [performed.set_order for performed in remaining] == [1, 2]
    assert list_sets_for_workout(migrated_db, workout.id) == remaining


def test_removing_the_first_set_does_not_collide_on_the_unique_position(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    first = add_set(migrated_db, workout.id, exercise_id, 1)
    add_set(migrated_db, workout.id, exercise_id, 2)
    add_set(migrated_db, workout.id, exercise_id, 3)

    remaining = delete_performed_set(migrated_db, first.id)

    assert [performed.set_order for performed in remaining] == [1, 2]


def test_removing_the_only_set_leaves_an_empty_but_valid_draft(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    only = add_set(migrated_db, workout.id, exercise_id, 1)

    assert delete_performed_set(migrated_db, only.id) == ()


def test_deleting_an_unknown_set_is_refused(migrated_db: sqlite3.Connection) -> None:
    with pytest.raises(DeletionRefused, match="no set"):
        delete_performed_set(migrated_db, "nope")


def test_renumber_repairs_a_sparse_sequence_left_by_earlier_edits(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)
    add_set(migrated_db, workout.id, exercise_id, 4)
    add_set(migrated_db, workout.id, exercise_id, 9)

    repaired = renumber_workout_sets(migrated_db, workout.id)

    assert [performed.set_order for performed in repaired] == [1, 2, 3]
    assert [
        performed.set_order for performed in list_sets_for_workout(migrated_db, workout.id)
    ] == [
        1,
        2,
        3,
    ]


def test_renumbering_an_already_dense_workout_changes_nothing(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)
    add_set(migrated_db, workout.id, exercise_id, 2)
    before = list_sets_for_workout(migrated_db, workout.id)

    assert renumber_workout_sets(migrated_db, workout.id) == before


def test_deleting_a_draft_workout_cascades_to_its_sets(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)

    delete_draft_workout(migrated_db, workout.id)

    assert list_sets_for_workout(migrated_db, workout.id) == ()
    assert migrated_db.execute("SELECT count(*) AS n FROM workout").fetchone()["n"] == 0


def test_deleting_a_complete_workout_through_the_draft_path_is_refused(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)
    update_workout(migrated_db, replace(workout, status=WorkoutStatus.COMPLETE))

    with pytest.raises(DeletionRefused, match="complete"):
        delete_draft_workout(migrated_db, workout.id)

    assert migrated_db.execute("SELECT count(*) AS n FROM workout").fetchone()["n"] == 1


def test_deleting_a_complete_workout_without_the_confirming_argument_is_refused(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str, db_path: Path
) -> None:
    """No ordinary code path supplies this argument by accident."""
    add_set(migrated_db, workout.id, exercise_id, 1)
    update_workout(migrated_db, replace(workout, status=WorkoutStatus.COMPLETE))

    with pytest.raises(DeletionRefused, match="confirm"):
        delete_complete_workout(migrated_db, workout.id, db_path=db_path)

    assert migrated_db.execute("SELECT count(*) AS n FROM workout").fetchone()["n"] == 1


def test_deleting_a_complete_workout_snapshots_first_then_deletes(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str, db_path: Path
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)
    update_workout(migrated_db, replace(workout, status=WorkoutStatus.COMPLETE))
    before = len(list(snapshot_directory(db_path).glob("*.db")))

    snapshot = delete_complete_workout(
        migrated_db, workout.id, db_path=db_path, i_understand_this_deletes_evidence=True
    )

    assert len(list(snapshot_directory(db_path).glob("*.db"))) == before + 1
    assert migrated_db.execute("SELECT count(*) AS n FROM workout").fetchone()["n"] == 0
    raw = sqlite3.connect(snapshot)
    try:
        assert raw.execute("SELECT count(*) FROM workout").fetchone()[0] == 1
        assert raw.execute("SELECT count(*) FROM performed_set").fetchone()[0] == 1
    finally:
        raw.close()


def test_deleting_a_draft_through_the_complete_path_is_refused(
    migrated_db: sqlite3.Connection, workout: Workout, db_path: Path
) -> None:
    with pytest.raises(DeletionRefused, match="draft"):
        delete_complete_workout(
            migrated_db, workout.id, db_path=db_path, i_understand_this_deletes_evidence=True
        )


def test_deleting_an_unknown_workout_is_refused(
    migrated_db: sqlite3.Connection, db_path: Path
) -> None:
    with pytest.raises(DeletionRefused, match="no workout"):
        delete_draft_workout(migrated_db, "nope")
    with pytest.raises(DeletionRefused, match="no workout"):
        delete_complete_workout(
            migrated_db, "nope", db_path=db_path, i_understand_this_deletes_evidence=True
        )


def test_deleting_a_workout_never_deletes_its_exercises(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)

    delete_draft_workout(migrated_db, workout.id)

    assert migrated_db.execute("SELECT count(*) AS n FROM exercise").fetchone()["n"] == 1


def test_the_connection_is_left_without_an_open_transaction(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    performed = add_set(migrated_db, workout.id, exercise_id, 1)
    add_set(migrated_db, workout.id, exercise_id, 2)

    delete_performed_set(migrated_db, performed.id)

    assert not migrated_db.in_transaction


def test_a_failure_between_delete_and_renumber_rolls_the_whole_thing_back(
    migrated_db: sqlite3.Connection,
    workout: Workout,
    exercise_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Failure injected between the DELETE and the renumbering: nothing may survive it."""
    add_set(migrated_db, workout.id, exercise_id, 1)
    second = add_set(migrated_db, workout.id, exercise_id, 2)
    add_set(migrated_db, workout.id, exercise_id, 3)
    before = list_sets_for_workout(migrated_db, workout.id)

    def explode(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("renumbering failed midway")

    monkeypatch.setattr("fitness_lab.storage.workouts._write_renumbering", explode)

    with pytest.raises(RuntimeError, match="renumbering failed midway"):
        delete_performed_set(migrated_db, second.id)

    after = list_sets_for_workout(migrated_db, workout.id)
    assert after == before, "the deleted set must come back with the rolled-back transaction"
    assert [performed.set_order for performed in after] == [1, 2, 3]
    assert not migrated_db.in_transaction


def test_a_failed_safety_snapshot_deletes_nothing(
    migrated_db: sqlite3.Connection,
    workout: Workout,
    exercise_id: str,
    db_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fail-safe ordering: no snapshot, no delete. The snapshot is not best-effort."""
    add_set(migrated_db, workout.id, exercise_id, 1)
    update_workout(migrated_db, replace(workout, status=WorkoutStatus.COMPLETE))

    def explode(*_args: object, **_kwargs: object) -> Path:
        raise SnapshotError("VACUUM INTO failed")

    monkeypatch.setattr("fitness_lab.storage.workouts.create_snapshot", explode)

    with pytest.raises(SnapshotError):
        delete_complete_workout(
            migrated_db, workout.id, db_path=db_path, i_understand_this_deletes_evidence=True
        )

    assert get_workout(migrated_db, workout.id) is not None
    assert len(list_sets_for_workout(migrated_db, workout.id)) == 1


def test_a_snapshot_that_cannot_be_written_leaves_the_workout_and_its_sets_intact(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str, db_path: Path
) -> None:
    """The same guarantee against a real OS-level failure, not a patched one."""
    add_set(migrated_db, workout.id, exercise_id, 1)
    update_workout(migrated_db, replace(workout, status=WorkoutStatus.COMPLETE))
    directory = snapshot_directory(db_path)
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o500)

    try:
        with pytest.raises(SnapshotError):
            delete_complete_workout(
                migrated_db, workout.id, db_path=db_path, i_understand_this_deletes_evidence=True
            )
    finally:
        directory.chmod(0o700)

    assert get_workout(migrated_db, workout.id) is not None
    assert migrated_db.execute("SELECT count(*) AS n FROM performed_set").fetchone()["n"] == 1
