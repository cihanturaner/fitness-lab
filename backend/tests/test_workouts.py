"""Workout and performed-set persistence: the canonical evidence path."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

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
from fitness_lab.storage.workouts import (
    get_workout,
    insert_performed_set,
    insert_workout,
    list_sets_for_workout,
    list_workouts_on,
    update_performed_set,
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
    created = new_draft_workout(
        "2026-10-01", performed_time_local="18:30", notes="first logged session", now=STAMP
    )
    insert_workout(migrated_db, created)
    return created


def make_set(
    workout_id: str,
    exercise_id: str,
    set_order: int,
    *,
    set_type: SetTypeCode | None = SetTypeCode.WORKING,
    load_kg: Decimal | None = Decimal("102.5"),
    reps: int | None = 8,
    rir: int | None = 2,
    notes: str | None = None,
) -> PerformedSet:
    return PerformedSet(
        id=new_id(),
        workout_id=workout_id,
        exercise_id=exercise_id,
        set_order=set_order,
        set_type=set_type,
        load_kg=load_kg,
        reps=reps,
        rir=rir,
        notes=notes,
        entered_at_utc=STAMP,
        updated_at_utc=STAMP,
    )


def test_a_workout_round_trips(migrated_db: sqlite3.Connection, workout: Workout) -> None:
    assert get_workout(migrated_db, workout.id) == workout


def test_a_workout_with_no_time_recorded_round_trips(migrated_db: sqlite3.Connection) -> None:
    created = new_draft_workout("2026-10-01", now=STAMP)
    insert_workout(migrated_db, created)

    stored = get_workout(migrated_db, created.id)

    assert stored is not None
    assert stored.performed_time_local is None


def test_two_workouts_on_the_same_date_are_allowed(migrated_db: sqlite3.Connection) -> None:
    morning = new_draft_workout("2026-10-01", performed_time_local="07:00", now=STAMP)
    evening = new_draft_workout("2026-10-01", performed_time_local="18:30", now=STAMP)
    insert_workout(migrated_db, morning)
    insert_workout(migrated_db, evening)

    found = list_workouts_on(migrated_db, "2026-10-01")

    assert {item.id for item in found} == {morning.id, evening.id}


def test_updating_a_workout_persists_the_status_transition(
    migrated_db: sqlite3.Connection, workout: Workout
) -> None:
    from dataclasses import replace

    promoted = replace(
        workout, status=WorkoutStatus.COMPLETE, updated_at_utc="2026-10-01T20:00:00+00:00"
    )

    update_workout(migrated_db, promoted)

    stored = get_workout(migrated_db, workout.id)
    assert stored is not None
    assert stored.status is WorkoutStatus.COMPLETE
    assert stored.entered_at_utc == STAMP


def test_a_full_workout_of_mixed_sets_round_trips(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    sets = [
        make_set(
            workout.id,
            exercise_id,
            1,
            set_type=SetTypeCode.WARMUP,
            load_kg=Decimal("40"),
            reps=10,
            rir=None,
        ),
        make_set(workout.id, exercise_id, 2, load_kg=Decimal("102.5"), reps=8, rir=2),
        make_set(workout.id, exercise_id, 3, set_type=None, load_kg=None, reps=None, rir=None),
        make_set(
            workout.id,
            exercise_id,
            4,
            set_type=SetTypeCode.BACKOFF,
            load_kg=Decimal("0"),
            reps=0,
            rir=0,
        ),
    ]
    for performed in sets:
        insert_performed_set(migrated_db, performed)

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert stored == tuple(sets)


def test_sets_come_back_in_global_chronological_order(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    for position in (3, 1, 2):
        insert_performed_set(migrated_db, make_set(workout.id, exercise_id, position))

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert [performed.set_order for performed in stored] == [1, 2, 3]


def test_kilograms_are_stored_as_exact_integer_grams(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    performed = make_set(workout.id, exercise_id, 1, load_kg=Decimal("102.5"))
    insert_performed_set(migrated_db, performed)

    row = migrated_db.execute(
        "SELECT load_g, load_kg FROM performed_set WHERE id = ?", (performed.id,)
    ).fetchone()

    assert row["load_g"] == 102500
    assert row["load_kg"] == 102.5
    stored = list_sets_for_workout(migrated_db, workout.id)[0]
    assert stored.load_kg == Decimal("102.5")


def test_a_null_load_is_not_zero(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    unrecorded = make_set(workout.id, exercise_id, 1, load_kg=None)
    bodyweight = make_set(workout.id, exercise_id, 2, load_kg=Decimal("0"))
    insert_performed_set(migrated_db, unrecorded)
    insert_performed_set(migrated_db, bodyweight)

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert stored[0].load_kg is None
    assert stored[1].load_kg == Decimal("0")


def test_a_null_reps_is_not_zero_reps(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1, reps=None))
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 2, reps=0))

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert stored[0].reps is None
    assert stored[1].reps == 0


def test_a_null_rir_is_not_zero_rir(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1, rir=None))
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 2, rir=0))

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert stored[0].rir is None
    assert stored[1].rir == 0


def test_a_negative_rir_persists(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    """Forced or assisted reps must remain recordable without a migration."""
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1, rir=-1))

    assert list_sets_for_workout(migrated_db, workout.id)[0].rir == -1


def test_a_negative_load_is_refused_before_it_reaches_the_database(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    performed = make_set(workout.id, exercise_id, 1, load_kg=Decimal("-1"))

    with pytest.raises(ValueError, match="negative"):
        insert_performed_set(migrated_db, performed)


def test_sub_gram_precision_is_refused_before_it_reaches_the_database(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    performed = make_set(workout.id, exercise_id, 1, load_kg=Decimal("0.0005"))

    with pytest.raises(ValueError, match="sub-gram"):
        insert_performed_set(migrated_db, performed)


def test_two_sets_cannot_claim_the_same_position(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))

    with pytest.raises(sqlite3.IntegrityError):
        insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))


def test_the_same_position_in_two_workouts_is_fine(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    other = new_draft_workout("2026-10-02", now=STAMP)
    insert_workout(migrated_db, other)

    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))
    insert_performed_set(migrated_db, make_set(other.id, exercise_id, 1))

    assert len(list_sets_for_workout(migrated_db, other.id)) == 1


def test_an_alternating_interleave_is_visible_as_an_interleave(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    other = create_exercise("Seated Row", "Technogym")
    insert_exercise(migrated_db, other)
    for position, target in enumerate([exercise_id, other.id, exercise_id, other.id], start=1):
        insert_performed_set(migrated_db, make_set(workout.id, target, position))

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert [performed.exercise_id for performed in stored] == [
        exercise_id,
        other.id,
        exercise_id,
        other.id,
    ]


def test_correcting_a_set_updates_in_place_and_moves_updated_at(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    from dataclasses import replace

    performed = make_set(workout.id, exercise_id, 1, reps=8)
    insert_performed_set(migrated_db, performed)

    corrected = replace(performed, reps=9, updated_at_utc="2026-10-01T20:00:00+00:00")
    update_performed_set(migrated_db, corrected)

    stored = list_sets_for_workout(migrated_db, workout.id)[0]
    assert stored.reps == 9
    assert stored.entered_at_utc == STAMP
    assert stored.updated_at_utc == "2026-10-01T20:00:00+00:00"


def test_correcting_an_exercise_label_leaves_every_set_row_untouched(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    """No row anywhere stores an exercise name, so a rename cannot disturb history."""
    from fitness_lab.domain.models import rename_exercise
    from fitness_lab.storage.exercises import get_exercise, update_exercise

    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))
    before = list_sets_for_workout(migrated_db, workout.id)

    exercise = get_exercise(migrated_db, exercise_id)
    assert exercise is not None
    update_exercise(
        migrated_db, rename_exercise(exercise, "Incline Press", "Hammer Strength Iso-Lateral")
    )

    assert list_sets_for_workout(migrated_db, workout.id) == before


def test_history_stays_readable_after_the_exercise_is_retired(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    from fitness_lab.domain.models import deactivate_exercise
    from fitness_lab.storage.exercises import get_exercise, update_exercise

    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))
    exercise = get_exercise(migrated_db, exercise_id)
    assert exercise is not None

    update_exercise(migrated_db, deactivate_exercise(exercise))

    stored = list_sets_for_workout(migrated_db, workout.id)
    assert stored[0].exercise_id == exercise_id
