"""Exercise persistence: identity that survives renaming, retirement and time."""

from __future__ import annotations

import sqlite3

import pytest

from fitness_lab.domain.models import create_exercise, deactivate_exercise, rename_exercise
from fitness_lab.storage.exercises import (
    delete_exercise,
    find_exercise_by_identity,
    get_exercise,
    insert_exercise,
    list_exercises,
    update_exercise,
)

STAMP = "2026-10-01T19:00:00+00:00"


def test_an_exercise_round_trips(migrated_db: sqlite3.Connection) -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength", notes="left of rack")

    insert_exercise(migrated_db, exercise)

    assert get_exercise(migrated_db, exercise.id) == exercise


def test_an_exercise_without_an_equipment_label_round_trips(
    migrated_db: sqlite3.Connection,
) -> None:
    exercise = create_exercise("Incline dumbbell press")

    insert_exercise(migrated_db, exercise)

    stored = get_exercise(migrated_db, exercise.id)
    assert stored is not None
    assert stored.equipment_label is None


def test_get_exercise_returns_none_when_absent(migrated_db: sqlite3.Connection) -> None:
    assert get_exercise(migrated_db, "nope") is None


def test_the_same_name_on_two_machines_is_two_ids(migrated_db: sqlite3.Connection) -> None:
    hammer = create_exercise("Incline Chest Press", "Hammer Strength")
    technogym = create_exercise("Incline Chest Press", "Technogym Pure Strength")

    insert_exercise(migrated_db, hammer)
    insert_exercise(migrated_db, technogym)

    assert hammer.id != technogym.id
    assert len(list_exercises(migrated_db)) == 2


def test_a_duplicate_normalized_identity_is_refused(migrated_db: sqlite3.Connection) -> None:
    insert_exercise(migrated_db, create_exercise("Incline Chest Press", "Hammer Strength"))

    with pytest.raises(sqlite3.IntegrityError):
        insert_exercise(migrated_db, create_exercise("incline chest press", " hammer strength "))


def test_a_duplicate_identity_with_both_labels_null_is_refused(
    migrated_db: sqlite3.Connection,
) -> None:
    insert_exercise(migrated_db, create_exercise("Incline Chest Press"))

    with pytest.raises(sqlite3.IntegrityError):
        insert_exercise(migrated_db, create_exercise("incline chest press"))


def test_find_by_identity_normalizes_case_and_whitespace(
    migrated_db: sqlite3.Connection,
) -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)

    found = find_exercise_by_identity(migrated_db, "  incline chest press ", "HAMMER STRENGTH")

    assert found is not None
    assert found.id == exercise.id


def test_find_by_identity_treats_a_missing_label_as_its_own_identity(
    migrated_db: sqlite3.Connection,
) -> None:
    without = create_exercise("Incline Chest Press")
    with_label = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, without)
    insert_exercise(migrated_db, with_label)

    found = find_exercise_by_identity(migrated_db, "Incline Chest Press", None)

    assert found is not None
    assert found.id == without.id


def test_find_by_identity_returns_none_when_nothing_matches(
    migrated_db: sqlite3.Connection,
) -> None:
    assert find_exercise_by_identity(migrated_db, "Nothing", None) is None


def test_renaming_keeps_the_id_and_moves_only_updated_at(
    migrated_db: sqlite3.Connection,
) -> None:
    exercise = create_exercise("Incline Chest Pres", "Hammer Strength", now=STAMP)
    insert_exercise(migrated_db, exercise)

    corrected = rename_exercise(
        exercise,
        "Incline Chest Press",
        "Hammer Strength Iso-Lateral",
        now="2026-10-02T09:00:00+00:00",
    )
    update_exercise(migrated_db, corrected)

    stored = get_exercise(migrated_db, exercise.id)
    assert stored == corrected
    assert stored is not None
    assert stored.created_at_utc == STAMP


def test_deactivating_hides_from_pickers_but_keeps_the_row(
    migrated_db: sqlite3.Connection,
) -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)

    update_exercise(migrated_db, deactivate_exercise(exercise))

    assert list_exercises(migrated_db) == ()
    retired = list_exercises(migrated_db, include_inactive=True)
    assert len(retired) == 1
    assert retired[0].is_active is False


def test_list_exercises_is_ordered_by_name_then_label(migrated_db: sqlite3.Connection) -> None:
    insert_exercise(migrated_db, create_exercise("Squat", "Rack 2"))
    insert_exercise(migrated_db, create_exercise("Incline Chest Press", "Technogym"))
    insert_exercise(migrated_db, create_exercise("Incline Chest Press", "Hammer Strength"))

    listed = list_exercises(migrated_db)

    assert [(item.name, item.equipment_label) for item in listed] == [
        ("Incline Chest Press", "Hammer Strength"),
        ("Incline Chest Press", "Technogym"),
        ("Squat", "Rack 2"),
    ]


def test_deleting_an_unused_exercise_is_permitted(migrated_db: sqlite3.Connection) -> None:
    exercise = create_exercise("Never Performed")
    insert_exercise(migrated_db, exercise)

    delete_exercise(migrated_db, exercise.id)

    assert get_exercise(migrated_db, exercise.id) is None


def test_is_active_round_trips_as_a_bool_not_an_int(migrated_db: sqlite3.Connection) -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)

    stored = get_exercise(migrated_db, exercise.id)

    assert stored is not None
    assert stored.is_active is True
