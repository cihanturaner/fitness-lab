"""Program import (append-only, idempotent) and single active version."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

import pytest

from fitness_lab.domain.models import create_exercise, deactivate_exercise
from fitness_lab.storage.exercises import insert_exercise, update_exercise
from fitness_lab.storage.programs import (
    ImportRefused,
    ProgramStateError,
    activate_program_version,
    deactivate_program,
    get_active_version,
    get_planned_workout,
    import_program_package,
    list_planned_workouts,
    list_program_versions,
    list_slots,
    read_program_texts,
)
from program_fixtures import document, encode, package, seed_exercises


def test_import_writes_the_program_in_order(migrated_db: sqlite3.Connection) -> None:
    exercises = seed_exercises(migrated_db)

    result = import_program_package(migrated_db, package())

    assert result.created is True
    version = result.version
    assert (version.program_key, version.name, version.version_label) == (
        "test-program",
        "Test Program",
        "1.0.0",
    )
    assert version.duration_weeks == 12
    workouts = list_planned_workouts(migrated_db, version.id)
    assert [(w.workout_key, w.sequence, w.name, w.day_label) for w in workouts] == [
        ("upper_a", 1, "Upper A", "Monday"),
        ("lower_a", 2, "Lower A", "Tuesday"),
    ]
    slots = list_slots(migrated_db, workouts[0].id)
    assert [(s.slot_key, s.position) for s in slots] == [
        ("upper_a.01", 1),
        ("upper_a.02", 2),
        ("upper_a.03", 3),
    ]
    assert slots[0].exercise_id == exercises["Bench Press"].id
    assert slots[2].exercise_id == exercises["Bench Press"].id
    assert slots[0].id != slots[2].id
    assert slots[0].notes == "Marker lift"
    first, second = slots[0].sets
    assert (first.position, first.set_type, first.reps_min, first.reps_max) == (
        1,
        "working",
        5,
        8,
    )
    assert (first.target_rir_min, first.target_rir_max) == (2, 2)
    assert first.target_load_kg == Decimal("82.5")
    assert (second.target_rir_min, second.target_rir_max, second.target_load_kg) == (0, 1, None)
    assert slots[1].sets[0].reps_max is None
    assert slots[2].sets[0].set_type == "backoff"


def test_stored_texts_re_encode_to_the_original_bytes(migrated_db: sqlite3.Connection) -> None:
    seed_exercises(migrated_db)
    raw = encode(document()).replace(b"\n", b"\r\n")
    notes = "# Notlar\r\nAğırlık — çalış\n".encode()
    from fitness_lab.domain.program import parse_program_package

    result = import_program_package(migrated_db, parse_program_package(raw, notes))

    program_text, notes_text = read_program_texts(migrated_db, result.version.id)
    assert program_text.encode("utf-8") == raw
    assert notes_text is not None and notes_text.encode("utf-8") == notes


def test_exact_duplicate_import_returns_the_existing_version_without_writes(
    migrated_db: sqlite3.Connection,
) -> None:
    seed_exercises(migrated_db)
    first = import_program_package(migrated_db, package())
    changes_before = migrated_db.total_changes

    second = import_program_package(migrated_db, package())

    assert second.created is False
    assert second.version == first.version
    assert migrated_db.total_changes == changes_before
    assert len(list_program_versions(migrated_db)) == 1


def test_same_json_with_different_notes_is_a_new_inactive_version(
    migrated_db: sqlite3.Connection,
) -> None:
    seed_exercises(migrated_db)
    first = import_program_package(migrated_db, package())
    activate_program_version(migrated_db, first.version.id)

    second = import_program_package(migrated_db, package(notes=b"changed notes\n"))

    assert second.created is True
    assert second.version.id != first.version.id
    assert second.version.program_json_sha256 == first.version.program_json_sha256
    active = get_active_version(migrated_db)
    assert active is not None and active.id == first.version.id


def test_missing_exercises_refuse_the_whole_import(migrated_db: sqlite3.Connection) -> None:
    seed_exercises(migrated_db, ("Bench Press",))

    with pytest.raises(ImportRefused) as caught:
        import_program_package(migrated_db, package())

    message = str(caught.value)
    assert "Row" in message and "Squat" in message
    assert list_program_versions(migrated_db) == ()
    assert migrated_db.execute("SELECT count(*) FROM planned_workout").fetchone()[0] == 0


def test_equipment_label_is_part_of_the_identity(migrated_db: sqlite3.Connection) -> None:
    seed_exercises(migrated_db, ("Row", "Squat"))
    insert_exercise(migrated_db, create_exercise("Bench Press", "Smith machine"))

    with pytest.raises(ImportRefused, match="Bench Press"):
        import_program_package(migrated_db, package())


def test_retired_exercises_are_refused(migrated_db: sqlite3.Connection) -> None:
    exercises = seed_exercises(migrated_db)
    update_exercise(migrated_db, deactivate_exercise(exercises["Row"]))

    with pytest.raises(ImportRefused, match="retired"):
        import_program_package(migrated_db, package())


def test_import_does_not_activate(migrated_db: sqlite3.Connection) -> None:
    seed_exercises(migrated_db)
    import_program_package(migrated_db, package())
    assert get_active_version(migrated_db) is None


def test_activation_switches_and_deactivation_allows_zero(
    migrated_db: sqlite3.Connection,
) -> None:
    seed_exercises(migrated_db)
    first = import_program_package(migrated_db, package()).version
    second = import_program_package(migrated_db, package(document(bench_reps_max=10))).version

    activate_program_version(migrated_db, first.id)
    active = get_active_version(migrated_db)
    assert active is not None and active.id == first.id

    activate_program_version(migrated_db, second.id)
    active = get_active_version(migrated_db)
    assert active is not None and active.id == second.id
    assert migrated_db.execute("SELECT count(*) FROM active_program_version").fetchone()[0] == 1

    deactivate_program(migrated_db)
    assert get_active_version(migrated_db) is None


def test_activating_an_unknown_version_is_refused(migrated_db: sqlite3.Connection) -> None:
    with pytest.raises(ProgramStateError):
        activate_program_version(migrated_db, "nope")


def test_planned_workout_lookup(migrated_db: sqlite3.Connection) -> None:
    seed_exercises(migrated_db)
    version = import_program_package(migrated_db, package()).version
    planned = list_planned_workouts(migrated_db, version.id)[0]
    assert get_planned_workout(migrated_db, planned.id) == planned
    assert get_planned_workout(migrated_db, "nope") is None
