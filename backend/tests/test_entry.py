"""Workout entry operations: actual sets, lifecycle, substitution, last performance."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Callable
from decimal import Decimal
from pathlib import Path

import pytest

from fitness_lab.domain.models import (
    Exercise,
    SetTypeCode,
    WorkoutStatus,
    create_exercise,
)
from fitness_lab.storage import db
from fitness_lab.storage.entry import (
    Conflict,
    NotFound,
    add_set,
    complete,
    create_unplanned_workout,
    discard_draft,
    edit_set,
    edit_workout,
    last_performance,
    list_recent_workouts,
    load_entry,
    open_planned_workout,
    remove_set,
    reopen,
    reorder_sets,
    set_slot_exercise,
)
from fitness_lab.storage.exercises import insert_exercise
from fitness_lab.storage.migrations import migrate_to_head
from fitness_lab.storage.programs import (
    activate_program_version,
    import_program_package,
    list_planned_workouts,
    list_slots,
)
from fitness_lab.storage.snapshots import snapshot_directory
from fitness_lab.storage.workouts import get_workout, list_sets_for_workout
from program_fixtures import package, seed_exercises

DAY = "2026-10-05"


@pytest.fixture
def exercises(migrated_db: sqlite3.Connection) -> dict[str, Exercise]:
    created = seed_exercises(migrated_db)
    for name, label in (("Incline Press", None), ("Bench Press", "Smith machine")):
        exercise = create_exercise(name, label)
        insert_exercise(migrated_db, exercise)
        created[name if label is None else f"{name} ({label})"] = exercise
    version = import_program_package(migrated_db, package()).version
    activate_program_version(migrated_db, version.id)
    return created


def upper_id(connection: sqlite3.Connection) -> str:
    version_id = connection.execute(
        "SELECT program_version_id FROM active_program_version"
    ).fetchone()[0]
    return list_planned_workouts(connection, str(version_id))[0].id


def open_upper(connection: sqlite3.Connection, day: str = DAY) -> str:
    return open_planned_workout(connection, upper_id(connection), performed_on=day).workout.id


def working(
    connection: sqlite3.Connection,
    workout_id: str,
    exercise: Exercise,
    load: str | None = "80",
    reps: int | None = 5,
    rir: int | None = 2,
) -> str:
    return add_set(
        connection,
        workout_id,
        exercise_id=exercise.id,
        set_type=SetTypeCode.WORKING,
        load_kg=None if load is None else Decimal(load),
        reps=reps,
        rir=rir,
        notes=None,
    ).id


# --- actual sets -------------------------------------------------------------------------


def test_add_appends_in_chronological_order(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    first = working(migrated_db, workout_id, exercises["Bench Press"])
    second = working(migrated_db, workout_id, exercises["Row"])
    third = working(migrated_db, workout_id, exercises["Squat"], load=None, reps=None, rir=None)

    stored = list_sets_for_workout(migrated_db, workout_id)
    assert [(s.id, s.set_order) for s in stored] == [(first, 1), (second, 2), (third, 3)]
    assert stored[0].load_kg == Decimal("80")
    assert stored[2].load_kg is None and stored[2].reps is None


def test_edit_changes_only_the_supplied_fields(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    set_id = working(migrated_db, workout_id, exercises["Bench Press"])

    edited = edit_set(migrated_db, set_id, {"load_kg": Decimal("82.5"), "rir": None})

    assert edited.load_kg == Decimal("82.5")
    assert edited.rir is None
    assert edited.reps == 5
    assert edited.set_type is SetTypeCode.WORKING


def test_edit_refuses_unknown_fields(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    set_id = working(migrated_db, workout_id, exercises["Bench Press"])
    with pytest.raises(ValueError, match="set_order"):
        edit_set(migrated_db, set_id, {"set_order": 4})


def test_unknown_set_and_workout_are_not_found(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    with pytest.raises(NotFound):
        edit_set(migrated_db, "nope", {"reps": 1})
    with pytest.raises(NotFound):
        remove_set(migrated_db, "nope")
    with pytest.raises(NotFound):
        add_set(
            migrated_db,
            "nope",
            exercise_id=exercises["Row"].id,
            set_type=None,
            load_kg=None,
            reps=None,
            rir=None,
            notes=None,
        )


def test_unknown_exercise_is_not_found(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    with pytest.raises(NotFound):
        add_set(
            migrated_db,
            workout_id,
            exercise_id="nope",
            set_type=None,
            load_kg=None,
            reps=None,
            rir=None,
            notes=None,
        )


def test_remove_renumbers(migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]) -> None:
    workout_id = open_upper(migrated_db)
    ids = [working(migrated_db, workout_id, exercises["Bench Press"]) for _ in range(3)]

    remove_set(migrated_db, ids[0])

    stored = list_sets_for_workout(migrated_db, workout_id)
    assert [(s.id, s.set_order) for s in stored] == [(ids[1], 1), (ids[2], 2)]


def test_reorder_applies_a_full_permutation(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    ids = [working(migrated_db, workout_id, exercises["Bench Press"]) for _ in range(3)]

    reordered = reorder_sets(migrated_db, workout_id, [ids[2], ids[0], ids[1]])

    assert [s.id for s in reordered] == [ids[2], ids[0], ids[1]]
    assert [s.set_order for s in list_sets_for_workout(migrated_db, workout_id)] == [1, 2, 3]
    assert [s.id for s in list_sets_for_workout(migrated_db, workout_id)] == [
        ids[2],
        ids[0],
        ids[1],
    ]


@pytest.mark.parametrize("shape", ["missing", "duplicate", "foreign"])
def test_reorder_refuses_anything_but_a_permutation(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise], shape: str
) -> None:
    workout_id = open_upper(migrated_db)
    ids = [working(migrated_db, workout_id, exercises["Bench Press"]) for _ in range(2)]
    proposal = {
        "missing": [ids[0]],
        "duplicate": [ids[0], ids[0]],
        "foreign": [ids[0], "other"],
    }[shape]
    with pytest.raises(ValueError, match="permutation"):
        reorder_sets(migrated_db, workout_id, proposal)


def test_set_mutations_on_a_complete_workout_are_refused(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    set_id = working(migrated_db, workout_id, exercises["Bench Press"])
    complete(migrated_db, workout_id)

    with pytest.raises(Conflict, match="reopen"):
        working(migrated_db, workout_id, exercises["Bench Press"])
    with pytest.raises(Conflict, match="reopen"):
        edit_set(migrated_db, set_id, {"reps": 6})
    with pytest.raises(Conflict, match="reopen"):
        remove_set(migrated_db, set_id)
    with pytest.raises(Conflict, match="reopen"):
        reorder_sets(migrated_db, workout_id, [set_id])


# --- lifecycle -----------------------------------------------------------------------------


def test_complete_is_blocked_without_evidence(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    with pytest.raises(Conflict) as caught:
        complete(migrated_db, workout_id)
    assert caught.value.report is not None
    assert [issue.rule for issue in caught.value.report.blockers] == ["C1"]

    add_set(
        migrated_db,
        workout_id,
        exercise_id=exercises["Row"].id,
        set_type=None,
        load_kg=None,
        reps=None,
        rir=None,
        notes=None,
    )
    with pytest.raises(Conflict) as caught:
        complete(migrated_db, workout_id)
    assert caught.value.report is not None
    assert [issue.rule for issue in caught.value.report.blockers] == ["C2", "C4"]
    stored = get_workout(migrated_db, workout_id)
    assert stored is not None and stored.status is WorkoutStatus.DRAFT


def test_complete_persists_status_and_reports_advisories(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    working(migrated_db, workout_id, exercises["Bench Press"], load=None, rir=None)

    report = complete(migrated_db, workout_id)

    assert report.ok
    assert {issue.rule for issue in report.advisories} == {"A-LOAD", "A-RIR"}
    stored = get_workout(migrated_db, workout_id)
    assert stored is not None and stored.status is WorkoutStatus.COMPLETE


def test_complete_persists_the_c3_renumbering(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    working(migrated_db, workout_id, exercises["Bench Press"])
    working(migrated_db, workout_id, exercises["Bench Press"])
    migrated_db.execute("UPDATE performed_set SET set_order = set_order * 10")

    complete(migrated_db, workout_id)

    assert [s.set_order for s in list_sets_for_workout(migrated_db, workout_id)] == [1, 2]


def test_reopen_returns_to_draft(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    working(migrated_db, workout_id, exercises["Bench Press"])
    complete(migrated_db, workout_id)

    reopened = reopen(migrated_db, workout_id)

    assert reopened.status is WorkoutStatus.DRAFT
    set_id = working(migrated_db, workout_id, exercises["Bench Press"])
    assert set_id


def test_reopen_and_complete_check_the_current_state(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    with pytest.raises(Conflict):
        reopen(migrated_db, workout_id)
    working(migrated_db, workout_id, exercises["Bench Press"])
    complete(migrated_db, workout_id)
    with pytest.raises(Conflict):
        complete(migrated_db, workout_id)


def test_edit_workout_corrects_metadata(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    edited = edit_workout(
        migrated_db,
        workout_id,
        {"performed_on": "2026-10-04", "performed_time_local": "18:30", "notes": "Gym B"},
    )
    assert (edited.performed_on, edited.performed_time_local, edited.notes) == (
        "2026-10-04",
        "18:30",
        "Gym B",
    )
    with pytest.raises(ValueError, match="status"):
        edit_workout(migrated_db, workout_id, {"status": "complete"})


def test_discard_draft_removes_it_and_refuses_complete(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise], db_path: Path
) -> None:
    workout_id = open_upper(migrated_db)
    working(migrated_db, workout_id, exercises["Bench Press"])
    discard_draft(migrated_db, workout_id, db_path=db_path)
    assert get_workout(migrated_db, workout_id) is None

    kept = open_upper(migrated_db)
    working(migrated_db, kept, exercises["Bench Press"])
    complete(migrated_db, kept)
    with pytest.raises(Conflict):
        discard_draft(migrated_db, kept, db_path=db_path)


def test_discarding_an_empty_draft_takes_no_snapshot(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise], db_path: Path
) -> None:
    workout_id = open_upper(migrated_db)
    before = sorted(snapshot_directory(db_path).glob("*discard*"))
    assert discard_draft(migrated_db, workout_id, db_path=db_path) is None
    assert sorted(snapshot_directory(db_path).glob("*discard*")) == before


def test_discarding_a_reopened_workout_keeps_a_snapshot_of_its_sets(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise], db_path: Path
) -> None:
    workout_id = open_upper(migrated_db)
    working(migrated_db, workout_id, exercises["Bench Press"], load="100")
    complete(migrated_db, workout_id)
    reopen(migrated_db, workout_id)

    snapshot = discard_draft(migrated_db, workout_id, db_path=db_path)

    assert get_workout(migrated_db, workout_id) is None
    assert snapshot is not None and snapshot.name.endswith(f"pre-discard-workout-{workout_id}.db")
    with db.connection_scope(snapshot) as saved:
        rows = saved.execute(
            "SELECT load_g FROM performed_set WHERE workout_id = ?", (workout_id,)
        ).fetchall()
        assert [row[0] for row in rows] == [100000]


# --- substitution --------------------------------------------------------------------------


def test_repeated_slots_substitute_independently_and_clear(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    first, _, third = list_slots(migrated_db, upper_id(migrated_db))

    set_slot_exercise(migrated_db, workout_id, first.id, exercises["Incline Press"].id)
    set_slot_exercise(
        migrated_db, workout_id, third.id, exercises["Bench Press (Smith machine)"].id
    )
    entry = load_entry(migrated_db, workout_id)
    substitutes = {slot.slot.id: slot.substitute_exercise_id for slot in entry.slots}
    assert substitutes[first.id] == exercises["Incline Press"].id
    assert substitutes[third.id] == exercises["Bench Press (Smith machine)"].id

    set_slot_exercise(migrated_db, workout_id, first.id, exercises["Bench Press"].id)
    entry = load_entry(migrated_db, workout_id)
    substitutes = {slot.slot.id: slot.substitute_exercise_id for slot in entry.slots}
    assert substitutes[first.id] is None
    assert substitutes[third.id] == exercises["Bench Press (Smith machine)"].id

    set_slot_exercise(migrated_db, workout_id, first.id, exercises["Row"].id)
    set_slot_exercise(migrated_db, workout_id, first.id, exercises["Squat"].id)
    entry = load_entry(migrated_db, workout_id)
    assert {s.slot.id: s.substitute_exercise_id for s in entry.slots}[first.id] == (
        exercises["Squat"].id
    )


def test_substitution_needs_a_slot_of_the_workouts_own_plan(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    version_id = migrated_db.execute(
        "SELECT program_version_id FROM active_program_version"
    ).fetchone()[0]
    lower = list_planned_workouts(migrated_db, str(version_id))[1]
    foreign_slot = list_slots(migrated_db, lower.id)[0]

    with pytest.raises(Conflict):
        set_slot_exercise(migrated_db, workout_id, foreign_slot.id, exercises["Row"].id)
    with pytest.raises(NotFound):
        set_slot_exercise(migrated_db, workout_id, "nope", exercises["Row"].id)


def test_unplanned_workouts_have_no_slots_to_substitute(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout = create_unplanned_workout(migrated_db, performed_on=DAY)
    slot = list_slots(migrated_db, upper_id(migrated_db))[0]
    with pytest.raises(Conflict):
        set_slot_exercise(migrated_db, workout.id, slot.id, exercises["Row"].id)


def test_substitution_on_a_complete_workout_is_refused(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    slot = list_slots(migrated_db, upper_id(migrated_db))[0]
    working(migrated_db, workout_id, exercises["Bench Press"])
    complete(migrated_db, workout_id)
    with pytest.raises(Conflict, match="reopen"):
        set_slot_exercise(migrated_db, workout_id, slot.id, exercises["Row"].id)


# --- last exact performance -------------------------------------------------------------


def finished(
    connection: sqlite3.Connection,
    exercises: dict[str, Exercise],
    day: str,
    loads: list[str],
    exercise: str = "Bench Press",
    time_local: str | None = None,
) -> str:
    workout = create_unplanned_workout(
        connection, performed_on=day, performed_time_local=time_local
    )
    working(connection, workout.id, exercises["Row"], load="50")
    for load in loads:
        working(connection, workout.id, exercises[exercise], load=load)
    complete(connection, workout.id)
    return workout.id


def test_last_performance_is_the_most_recent_complete_workout(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    finished(migrated_db, exercises, "2026-10-01", ["70"])
    latest = finished(migrated_db, exercises, "2026-10-03", ["80", "82.5"])
    finished(migrated_db, exercises, "2026-10-02", ["75"])
    draft = create_unplanned_workout(migrated_db, performed_on="2026-10-04")
    working(migrated_db, draft.id, exercises["Bench Press"], load="100")

    result = last_performance(migrated_db, exercises["Bench Press"].id)

    assert result is not None
    assert result.workout_id == latest
    assert result.performed_on == "2026-10-03"
    assert [s.load_kg for s in result.sets] == [Decimal("80"), Decimal("82.5")]
    assert all(s.exercise_id == exercises["Bench Press"].id for s in result.sets)


def test_last_performance_orders_same_day_sessions_by_time(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    evening = finished(migrated_db, exercises, "2026-10-03", ["90"], time_local="19:00")
    finished(migrated_db, exercises, "2026-10-03", ["60"], time_local="07:00")
    result = last_performance(migrated_db, exercises["Bench Press"].id)
    assert result is not None and result.workout_id == evening


def test_last_performance_excludes_the_workout_being_edited(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    earlier = finished(migrated_db, exercises, "2026-10-01", ["70"])
    latest = finished(migrated_db, exercises, "2026-10-03", ["80"])
    result = last_performance(migrated_db, exercises["Bench Press"].id, exclude_workout_id=latest)
    assert result is not None and result.workout_id == earlier


def test_last_performance_never_matches_other_equipment(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    finished(migrated_db, exercises, "2026-10-03", ["60"], exercise="Bench Press (Smith machine)")
    assert last_performance(migrated_db, exercises["Bench Press"].id) is None


def test_last_performance_is_none_without_history(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    assert last_performance(migrated_db, exercises["Squat"].id) is None


# --- aggregate ---------------------------------------------------------------------------


def test_entry_aggregate_separates_planned_from_actual(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    finished(migrated_db, exercises, "2026-09-28", ["77.5"])
    workout_id = open_upper(migrated_db)

    entry = load_entry(migrated_db, workout_id)

    assert entry.workout.id == workout_id
    assert entry.origin is not None and entry.origin.workout_key == "upper_a"
    assert [slot.slot.slot_key for slot in entry.slots] == [
        "upper_a.01",
        "upper_a.02",
        "upper_a.03",
    ]
    assert len(entry.slots[0].slot.sets) == 2
    assert entry.sets == ()
    bench = exercises["Bench Press"].id
    assert bench in entry.exercises
    performance = entry.last_performance[bench]
    assert performance is not None
    assert [s.load_kg for s in performance.sets] == [Decimal("77.5")]
    assert exercises["Squat"].id not in entry.last_performance


def test_entry_aggregate_includes_extra_exercises(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    working(migrated_db, workout_id, exercises["Squat"])
    entry = load_entry(migrated_db, workout_id)
    assert exercises["Squat"].id in entry.exercises
    assert exercises["Squat"].id in entry.last_performance


def test_entry_for_unknown_workout_is_not_found(migrated_db: sqlite3.Connection) -> None:
    with pytest.raises(NotFound):
        load_entry(migrated_db, "nope")


def test_recent_workouts_lists_status_origin_and_set_count(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    finished(migrated_db, exercises, "2026-10-01", ["70"])
    workout_id = open_upper(migrated_db, day="2026-10-05")
    working(migrated_db, workout_id, exercises["Bench Press"])

    recent = list_recent_workouts(migrated_db, limit=10)

    assert [item.workout.performed_on for item in recent] == ["2026-10-05", "2026-10-01"]
    assert recent[0].origin_name == "Upper A"
    assert recent[0].set_count == 1
    assert recent[1].origin_name is None
    assert recent[1].workout.status is WorkoutStatus.COMPLETE


# --- review findings: races between a status check and the write -----------------------


def _race_against_completion(
    db_path: Path, workout_id: str, action: Callable[[sqlite3.Connection], object]
) -> BaseException | None:
    """Hold a completion open on connection B while ``action`` runs on connection A."""
    outcome: list[BaseException | None] = []
    with db.connection_scope(db_path) as holder:
        holder.execute("BEGIN IMMEDIATE")
        holder.execute("UPDATE workout SET status = 'complete' WHERE id = ?", (workout_id,))

        def run() -> None:
            with db.connection_scope(db_path) as connection:
                try:
                    action(connection)
                    outcome.append(None)
                except BaseException as exc:
                    outcome.append(exc)

        thread = threading.Thread(target=run)
        thread.start()
        thread.join(timeout=0.3)
        holder.execute("COMMIT")
        thread.join()
    return outcome[0]


def _seeded_file(db_path: Path) -> tuple[str, str, str]:
    migrate_to_head(db_path)
    with db.connection_scope(db_path) as connection:
        exercises = seed_exercises(connection)
        workout = create_unplanned_workout(connection, performed_on=DAY)
        first = working(connection, workout.id, exercises["Bench Press"])
        second = working(connection, workout.id, exercises["Bench Press"])
    return workout.id, first, second


def test_discard_cannot_delete_a_workout_completed_meanwhile(db_path: Path) -> None:
    workout_id, _, _ = _seeded_file(db_path)

    error = _race_against_completion(
        db_path,
        workout_id,
        lambda connection: discard_draft(connection, workout_id, db_path=db_path),
    )

    assert isinstance(error, Conflict)
    with db.connection_scope(db_path) as connection:
        assert get_workout(connection, workout_id) is not None
        assert len(list_sets_for_workout(connection, workout_id)) == 2


def test_remove_cannot_delete_from_a_workout_completed_meanwhile(db_path: Path) -> None:
    workout_id, first, _ = _seeded_file(db_path)

    error = _race_against_completion(
        db_path, workout_id, lambda connection: remove_set(connection, first)
    )

    assert isinstance(error, Conflict)
    with db.connection_scope(db_path) as connection:
        assert len(list_sets_for_workout(connection, workout_id)) == 2


def test_a_float_load_is_a_value_error(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout_id = open_upper(migrated_db)
    with pytest.raises(ValueError):
        add_set(
            migrated_db,
            workout_id,
            exercise_id=exercises["Row"].id,
            set_type=None,
            load_kg=80.5,  # type: ignore[arg-type]
            reps=None,
            rir=None,
            notes=None,
        )
    assert not migrated_db.in_transaction


def test_open_resumes_the_most_recently_started_of_two_drafts(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    older = open_upper(migrated_db, day="2026-10-05")
    working(migrated_db, older, exercises["Bench Press"])
    complete(migrated_db, older)
    newer = open_planned_workout(
        migrated_db,
        upper_id(migrated_db),
        performed_on="2026-10-12",
        now="2026-10-12T18:00:00+00:00",
    ).workout.id
    reopen(migrated_db, older, now="2026-10-13T08:00:00+00:00")

    resumed = open_planned_workout(migrated_db, upper_id(migrated_db), performed_on=DAY)

    assert resumed.created is False
    assert resumed.workout.id == newer


def test_last_performance_returns_interleaved_sets_in_order(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    workout = create_unplanned_workout(migrated_db, performed_on="2026-10-01")
    working(migrated_db, workout.id, exercises["Bench Press"], load="60")
    working(migrated_db, workout.id, exercises["Row"], load="50")
    working(migrated_db, workout.id, exercises["Bench Press"], load="70")
    complete(migrated_db, workout.id)

    result = last_performance(migrated_db, exercises["Bench Press"].id)

    assert result is not None
    assert [(s.set_order, s.load_kg) for s in result.sets] == [
        (1, Decimal("60")),
        (3, Decimal("70")),
    ]


def test_last_performance_prefers_a_recorded_time_over_none_on_the_same_day(
    migrated_db: sqlite3.Connection, exercises: dict[str, Exercise]
) -> None:
    timed = finished(migrated_db, exercises, "2026-10-03", ["90"], time_local="06:00")
    finished(migrated_db, exercises, "2026-10-03", ["60"])
    result = last_performance(migrated_db, exercises["Bench Press"].id)
    assert result is not None and result.workout_id == timed
