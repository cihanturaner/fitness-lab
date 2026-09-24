"""Tier 2: what must additionally be true before a workout may be called evidence."""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

from fitness_lab.domain.completion import (
    CompletionIssue,
    complete_workout,
    evaluate_completion,
    renumber_sets,
    reopen_workout,
    work_set_totals,
)
from fitness_lab.domain.models import (
    PerformedSet,
    SetTypeCode,
    Workout,
    WorkoutStatus,
    new_draft_workout,
    new_id,
)

WORKOUT_ID = "workout-1"
EXERCISE_ID = "exercise-1"


def make_set(
    set_order: int,
    *,
    reps: int | None = 8,
    set_type: SetTypeCode | None = SetTypeCode.WORKING,
    load_kg: Decimal | None = Decimal("60"),
    rir: int | None = 2,
) -> PerformedSet:
    return PerformedSet(
        id=new_id(),
        workout_id=WORKOUT_ID,
        exercise_id=EXERCISE_ID,
        set_order=set_order,
        set_type=set_type,
        load_kg=load_kg,
        reps=reps,
        rir=rir,
        notes=None,
        entered_at_utc="2026-10-01T19:00:00+00:00",
        updated_at_utc="2026-10-01T19:00:00+00:00",
    )


def rules(issues: Sequence[CompletionIssue]) -> list[str]:
    return [issue.rule for issue in issues]


def test_c1_an_empty_workout_cannot_be_completed() -> None:
    report = evaluate_completion([])

    assert report.ok is False
    assert "C1" in rules(report.blockers)


def test_c2_missing_reps_blocks_and_names_the_offending_positions() -> None:
    sets = [make_set(1), make_set(2, reps=None), make_set(3, reps=None)]

    report = evaluate_completion(sets)

    assert report.ok is False
    blocker = next(issue for issue in report.blockers if issue.rule == "C2")
    assert blocker.set_orders == (2, 3)
    assert "2" in blocker.message and "3" in blocker.message


def test_c2_zero_reps_is_evidence_not_absence() -> None:
    """0 is a recorded failed attempt; it must not be treated as missing."""
    report = evaluate_completion([make_set(1, reps=0)])

    assert report.ok is True


def test_c3_a_sparse_sequence_is_repaired_then_accepted() -> None:
    sets = [make_set(1), make_set(3), make_set(7)]

    report = evaluate_completion(sets)

    assert report.ok is True
    assert report.renumbered is True
    assert [performed.set_order for performed in report.sets] == [1, 2, 3]


def test_c3_a_dense_sequence_is_left_alone() -> None:
    report = evaluate_completion([make_set(1), make_set(2)])

    assert report.renumbered is False
    assert [performed.set_order for performed in report.sets] == [1, 2]


def test_c3_repair_preserves_chronological_order_and_identity() -> None:
    first, second, third = make_set(2), make_set(5), make_set(9)

    report = evaluate_completion([third, first, second])

    assert [performed.id for performed in report.sets] == [first.id, second.id, third.id]


def test_c3_repair_is_revalidated_and_can_still_block() -> None:
    sets = [make_set(1), make_set(4, reps=None)]

    report = evaluate_completion(sets)

    assert report.ok is False
    blocker = next(issue for issue in report.blockers if issue.rule == "C2")
    assert blocker.set_orders == (2,), "offending positions are reported after renumbering"


def test_c4_missing_set_type_blocks_and_names_the_offending_positions() -> None:
    sets = [make_set(1), make_set(2, set_type=None)]

    report = evaluate_completion(sets)

    assert report.ok is False
    blocker = next(issue for issue in report.blockers if issue.rule == "C4")
    assert blocker.set_orders == (2,)


def test_missing_load_is_an_advisory_not_a_blocker() -> None:
    """Forcing a load at completion would make a lifter type a guess into permanent history."""
    report = evaluate_completion([make_set(1, load_kg=None)])

    assert report.ok is True
    advisory = next(issue for issue in report.advisories if issue.rule == "A-LOAD")
    assert advisory.set_orders == (1,)


def test_missing_rir_is_an_advisory_not_a_blocker() -> None:
    report = evaluate_completion([make_set(1, rir=None)])

    assert report.ok is True
    assert "A-RIR" in rules(report.advisories)


def test_zero_load_and_zero_rir_raise_no_advisory() -> None:
    """0 kg is a bodyweight set; 0 RIR is failure. Neither is a missing measurement."""
    report = evaluate_completion([make_set(1, load_kg=Decimal("0"), rir=0)])

    assert report.advisories == ()


def test_a_draft_with_null_reps_and_null_set_type_is_a_valid_draft() -> None:
    """Tier 1 allows partial; only the transition to complete is gated."""
    sets = [make_set(1, reps=None, set_type=None, load_kg=None, rir=None)]

    report = evaluate_completion(sets)

    assert sorted(rules(report.blockers)) == ["C2", "C4"]


def test_complete_workout_promotes_when_every_rule_passes() -> None:
    workout = new_draft_workout("2026-10-01", now="2026-10-01T19:00:00+00:00")

    promoted, report = complete_workout(
        workout, [make_set(1), make_set(2)], now="2026-10-01T20:00:00+00:00"
    )

    assert report.ok is True
    assert promoted.status is WorkoutStatus.COMPLETE
    assert promoted.updated_at_utc == "2026-10-01T20:00:00+00:00"
    assert promoted.id == workout.id


def test_complete_workout_leaves_the_workout_alone_when_blocked() -> None:
    workout = new_draft_workout("2026-10-01")

    unchanged, report = complete_workout(workout, [make_set(1, reps=None)])

    assert report.ok is False
    assert unchanged == workout


def test_reopening_a_complete_workout_is_always_permitted() -> None:
    workout = new_draft_workout("2026-10-01", now="2026-10-01T19:00:00+00:00")
    promoted, _ = complete_workout(workout, [make_set(1)], now="2026-10-01T20:00:00+00:00")

    reopened = reopen_workout(promoted, now="2026-10-02T09:00:00+00:00")

    assert reopened.status is WorkoutStatus.DRAFT
    assert reopened.id == workout.id
    assert reopened.updated_at_utc == "2026-10-02T09:00:00+00:00"


def test_renumber_sets_on_an_empty_list_is_empty() -> None:
    assert renumber_sets([]) == ()


def test_completion_needs_no_database() -> None:
    """Tier 2 is pure logic over in-memory objects; the autosave path never pays for it."""
    workout = Workout(
        id=WORKOUT_ID,
        performed_on="2026-10-01",
        performed_time_local=None,
        status=WorkoutStatus.DRAFT,
        notes=None,
        entered_at_utc="2026-10-01T19:00:00+00:00",
        updated_at_utc="2026-10-01T19:00:00+00:00",
    )

    promoted, report = complete_workout(workout, [make_set(1)])

    assert report.ok is True
    assert promoted.status is WorkoutStatus.COMPLETE


# --- planned vs recorded working-set totals (no per-set provenance) ---------------------


def test_work_set_totals_compare_counts_and_ignore_warm_ups() -> None:
    totals = work_set_totals(
        planned_types=["working", "working", "backoff", "warmup"],
        performed_types=["warmup", "working", None],
    )
    assert (totals.planned, totals.actual) == (3, 2)
    assert totals.short


def test_a_session_at_or_over_the_plan_is_not_short() -> None:
    assert not work_set_totals(["working"], ["working"]).short
    assert not work_set_totals(["working"], ["working", "working"]).short


def test_the_known_case_two_of_twenty_three_is_short() -> None:
    totals = work_set_totals(["working"] * 23, ["working", "working"])
    assert (totals.planned, totals.actual, totals.short) == (23, 2, True)
