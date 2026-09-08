"""Pure domain entities and the two distinct exercise operations."""

from __future__ import annotations

from decimal import Decimal

import pytest

from fitness_lab.domain.models import (
    Exercise,
    PerformedSet,
    SetTypeCode,
    Workout,
    WorkoutStatus,
    create_exercise,
    deactivate_exercise,
    new_draft_workout,
    new_id,
    normalize_identity,
    rename_exercise,
    utc_now_iso,
)


def test_new_id_is_an_opaque_stable_hex_id() -> None:
    identifier = new_id()

    assert len(identifier) == 32
    assert identifier.isalnum()
    assert identifier != new_id()


def test_utc_now_iso_is_utc_and_second_precision() -> None:
    stamp = utc_now_iso()

    assert stamp.endswith("+00:00")
    assert len(stamp) == len("2026-10-01T18:30:00+00:00")


@pytest.mark.parametrize(
    ("name", "label", "expected"),
    [
        ("Incline Chest Press", "Hammer Strength", ("incline chest press", "hammer strength")),
        (
            "  Incline Chest Press ",
            "  Hammer Strength ",
            ("incline chest press", "hammer strength"),
        ),
        ("Incline Chest Press", None, ("incline chest press", "")),
    ],
)
def test_normalize_identity_matches_the_unique_index_rule(
    name: str, label: str | None, expected: tuple[str, str]
) -> None:
    assert normalize_identity(name, label) == expected


def test_create_exercise_establishes_a_new_identity() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    assert exercise.name == "Incline Chest Press"
    assert exercise.equipment_label == "Hammer Strength"
    assert exercise.is_active is True
    assert exercise.created_at_utc == exercise.updated_at_utc
    assert exercise.notes is None


def test_create_exercise_allows_no_equipment_label() -> None:
    exercise = create_exercise("Incline dumbbell press")

    assert exercise.equipment_label is None


def test_create_exercise_refuses_a_blank_name() -> None:
    with pytest.raises(ValueError, match="name"):
        create_exercise("   ")


def test_create_exercise_refuses_a_blank_equipment_label() -> None:
    """'' must never become a third state alongside NULL and a real label."""
    with pytest.raises(ValueError, match="equipment_label"):
        create_exercise("Incline Chest Press", "   ")


def test_two_exercises_created_with_the_same_name_get_different_ids() -> None:
    first = create_exercise("Incline Chest Press", "Hammer Strength")
    second = create_exercise("Incline Chest Press", "Technogym Pure Strength")

    assert first.id != second.id


def test_rename_exercise_corrects_labels_and_keeps_the_id() -> None:
    """Renaming corrects the label of the same identity; it never switches machines."""
    exercise = create_exercise(
        "Incline Chest Pres", "Hammer Strength", now="2026-10-01T10:00:00+00:00"
    )

    renamed = rename_exercise(
        exercise,
        "Incline Chest Press",
        "Hammer Strength Iso-Lateral",
        now="2026-10-02T10:00:00+00:00",
    )

    assert renamed.id == exercise.id
    assert renamed.name == "Incline Chest Press"
    assert renamed.equipment_label == "Hammer Strength Iso-Lateral"
    assert renamed.created_at_utc == exercise.created_at_utc
    assert renamed.updated_at_utc == "2026-10-02T10:00:00+00:00"


def test_rename_exercise_can_clear_the_equipment_label() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    renamed = rename_exercise(exercise, "Incline Chest Press", None)

    assert renamed.equipment_label is None


def test_rename_exercise_refuses_a_blank_name() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    with pytest.raises(ValueError, match="name"):
        rename_exercise(exercise, "  ", "Hammer Strength")


def test_deactivate_exercise_retires_rather_than_deletes() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    retired = deactivate_exercise(exercise, now="2026-10-03T10:00:00+00:00")

    assert retired.id == exercise.id
    assert retired.is_active is False
    assert retired.updated_at_utc == "2026-10-03T10:00:00+00:00"


def test_new_draft_workout_starts_as_a_draft_with_only_a_date() -> None:
    workout = new_draft_workout("2026-10-01")

    assert workout.status is WorkoutStatus.DRAFT
    assert workout.performed_on == "2026-10-01"
    assert workout.performed_time_local is None
    assert workout.notes is None


def test_entities_are_frozen() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    with pytest.raises(AttributeError):
        exercise.name = "changed"  # type: ignore[misc]


def test_a_draft_set_may_carry_nothing_but_its_anchors() -> None:
    """Field-level autosave means a row exists before reps, load or type are known."""
    performed_set = PerformedSet(
        id=new_id(),
        workout_id=new_id(),
        exercise_id=new_id(),
        set_order=1,
        set_type=None,
        load_kg=None,
        reps=None,
        rir=None,
        notes=None,
        entered_at_utc=utc_now_iso(),
        updated_at_utc=utc_now_iso(),
    )

    assert performed_set.reps is None
    assert performed_set.set_type is None
    assert performed_set.load_kg is None
    assert performed_set.rir is None


def test_a_set_speaks_kilograms_as_decimal() -> None:
    performed_set = PerformedSet(
        id=new_id(),
        workout_id=new_id(),
        exercise_id=new_id(),
        set_order=1,
        set_type=SetTypeCode.WORKING,
        load_kg=Decimal("102.5"),
        reps=8,
        rir=-1,
        notes=None,
        entered_at_utc=utc_now_iso(),
        updated_at_utc=utc_now_iso(),
    )

    assert performed_set.load_kg == Decimal("102.5")
    assert performed_set.rir == -1


def test_the_status_and_set_type_vocabularies_are_closed() -> None:
    assert [status.value for status in WorkoutStatus] == ["draft", "complete"]
    assert [code.value for code in SetTypeCode] == ["warmup", "working", "backoff"]


def test_entity_field_names_are_the_ones_storage_expects() -> None:
    assert set(Exercise.__dataclass_fields__) == {
        "id",
        "name",
        "equipment_label",
        "notes",
        "is_active",
        "created_at_utc",
        "updated_at_utc",
    }
    assert set(Workout.__dataclass_fields__) == {
        "id",
        "performed_on",
        "performed_time_local",
        "status",
        "notes",
        "entered_at_utc",
        "updated_at_utc",
    }
    assert set(PerformedSet.__dataclass_fields__) == {
        "id",
        "workout_id",
        "exercise_id",
        "set_order",
        "set_type",
        "load_kg",
        "reps",
        "rir",
        "notes",
        "entered_at_utc",
        "updated_at_utc",
    }
