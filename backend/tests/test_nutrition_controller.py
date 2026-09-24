"""The locked nutrition controller: decision support that never changes calories itself.

Every case of the source's ``app_logic_examples`` appears here, with the timing, trend
qualification, sustained over-gain and diagnostic-gate rules around them.
"""

from __future__ import annotations

import inspect
import json
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from fitness_lab.domain.bodyweight import WeightEntry
from fitness_lab.domain.nutrition import carbohydrate_target_g
from fitness_lab.domain.nutrition_controller import (
    BAND_MAX,
    BAND_MIN,
    GATE_CHECKS,
    MIN_WEIGH_INS_PER_HALF,
    GateRecord,
    PriorDecision,
    Review,
    TargetDecision,
    adjustment_dates,
    classify_trend,
    evaluate_review,
    failed_under_gain_corrections,
    gate_result_allowed,
    latest_adjustment_on,
    qualified_trend,
    starting_target,
    target_in_force,
    trend_pct,
)

ARTIFACT = (
    Path(__file__).resolve().parents[2]
    / "programs/advanced-natural-12w-nutrition/artifact/locked_nutrition_tracker.json"
)
START = date(2026, 9, 28)  # a Monday: week 1 = 28 Sep - 4 Oct


def sunday(week: int) -> date:
    return START + timedelta(days=7 * week - 1)


def linear(pct: str, first: date, last: date, base: int = 72_000) -> list[WeightEntry]:
    """Daily weigh-ins rising at ``pct`` % BW/week (integer grams, as a scale records)."""
    rate = Decimal(pct) / 100 / 7 * base
    days = (last - first).days
    return [
        WeightEntry(first + timedelta(days=offset), round(base + rate * offset))
        for offset in range(days + 1)
    ]


def target(day: date, kcal: int, stamp: str = "2026-09-01T00:00:00Z") -> TargetDecision:
    return TargetDecision(effective_on=day, calories_kcal=kcal, set_at_utc=stamp)


CALIBRATED = [target(START - timedelta(days=10), 2650)]


def review(
    today: date,
    entries: list[WeightEntry],
    *,
    targets: list[TargetDecision] | None = None,
    prior: list[PriorDecision] | None = None,
    gates: list[GateRecord] | None = None,
    composition_concern: bool = False,
) -> Review:
    return evaluate_review(
        block_start=START,
        weeks=12,
        today=today,
        entries=entries,
        targets=CALIBRATED if targets is None else targets,
        prior=prior or [],
        gates=gates or [],
        composition_concern=composition_concern,
    )


# --- constants are the source's -----------------------------------------------------------


def test_constants_match_the_locked_source() -> None:
    source = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    rules = {rule["id"]: rule for rule in source["controller_rules"]}
    assert rules["UNDER_GAIN"]["condition"] == "qualified_trend_pct_bw_per_week < 0.10"
    assert rules["IN_RANGE"]["condition"] == "0.10 <= qualified_trend_pct_bw_per_week <= 0.25"
    assert (Decimal("0.10"), Decimal("0.25")) == (BAND_MIN, BAND_MAX)
    assert rules["UNDER_GAIN"]["delta_kcal_per_day"] == 150
    assert rules["OVER_GAIN"]["delta_kcal_per_day"] == -100
    assert all(rule["automatic_apply"] is False for rule in rules.values())
    assert source["measurement_protocol"]["trend_method"]["default"] == "14_day_linear_regression"
    assert source["controller_timing"]["first_routine_decision"] == "end_of_week_3"
    assert len(GATE_CHECKS) == len(source["diagnostic_gate"]["checks"]) == 9
    assert MIN_WEIGH_INS_PER_HALF == 6  # APP CHOICE: the source sets no minimum


# --- app_logic_examples --------------------------------------------------------------------


def test_example_baseline_unknown() -> None:
    result = review(sunday(3), linear("0.07", START - timedelta(days=14), sunday(3)), targets=[])
    assert result.status == "UNKNOWN"
    assert result.current_target_kcal is None
    assert result.recommended_action is None
    assert result.recommended_carbs_g is None
    assert result.note == "Starting calories not calibrated yet."


def test_example_stable_intake_2500() -> None:
    assert starting_target(2500) == 2650
    assert carbohydrate_target_g(2650) == 383


def test_example_week_1_fast_scale_jump_changes_nothing() -> None:
    result = review(sunday(1), linear("0.8", START - timedelta(days=14), sunday(1)))
    assert result.block_week == 1
    assert result.phase == "early"
    assert result.decision_due is False
    assert result.recommended_action is None
    assert result.next_decision_week == 3


def test_example_under_gain_week_3() -> None:
    result = review(sunday(3), linear("0.07", START - timedelta(days=7), sunday(3)))
    assert result.trend is not None and result.trend.pct == Decimal("0.07")
    assert (result.status, result.decision_due) == ("UNDER_GAIN", True)
    assert (result.recommended_action, result.recommended_delta_kcal) == ("ADD_CALORIES", 150)
    assert (result.recommended_target_kcal, result.recommended_carbs_g) == (2800, 420)


def test_example_in_range_week_5() -> None:
    result = review(sunday(5), linear("0.17", START, sunday(5)))
    assert result.status == "IN_RANGE"
    assert (result.recommended_action, result.recommended_delta_kcal) == ("NO_CHANGE", 0)
    assert result.recommended_target_kcal == 2650


def test_example_sustained_over_gain_week_5() -> None:
    result = review(sunday(5), linear("0.27", START, sunday(5)))
    assert (result.status, result.sustained) == ("OVER_GAIN", True)
    assert (result.recommended_action, result.recommended_delta_kcal) == ("REDUCE_CALORIES", -100)
    assert result.recommended_target_kcal == 2550


def test_example_two_failed_under_gain_corrections_open_the_gate() -> None:
    prior = [
        PriorDecision(block_week=3, status="UNDER_GAIN", user_choice="APPLIED", delta_kcal=150),
        PriorDecision(block_week=5, status="UNDER_GAIN", user_choice="APPLIED", delta_kcal=150),
    ]
    targets = [
        *CALIBRATED,
        target(sunday(3) - timedelta(days=13), 2800),  # adjustments far enough back
        target(sunday(5) - timedelta(days=14), 2950),
    ]
    result = review(sunday(7), linear("0.05", START, sunday(7)), targets=targets, prior=prior)
    assert result.status == "DIAGNOSTIC_GATE"
    assert result.recommended_action == "AUDIT_BEFORE_CONTINUING"
    assert result.recommended_delta_kcal is None  # automatic_third_increase: false
    assert result.recommended_target_kcal is None


def test_example_bodyfat_is_never_an_input() -> None:
    names = set(inspect.signature(evaluate_review).parameters)
    assert not any("fat" in name or "bf" in name for name in names)


# --- trend ---------------------------------------------------------------------------------


@pytest.mark.parametrize("pct", ["0.07", "0.10", "0.17", "0.25", "0.27", "-0.20"])
def test_the_14_day_regression_recovers_a_linear_rate(pct: str) -> None:
    window = linear(pct, date(2026, 10, 5), date(2026, 10, 18))
    assert trend_pct(window) == Decimal(pct)


def test_a_constant_weight_has_a_zero_trend() -> None:
    flat = [WeightEntry(date(2026, 10, 5) + timedelta(days=offset), 72_000) for offset in range(14)]
    assert trend_pct(flat) == Decimal("0.00")


@pytest.mark.parametrize(
    ("pct", "status"),
    [
        ("0.09", "UNDER_GAIN"),
        ("0.10", "IN_RANGE"),
        ("0.25", "IN_RANGE"),
        ("0.26", "OVER_GAIN"),
        ("-0.30", "UNDER_GAIN"),
    ],
)
def test_the_band_boundaries_use_the_rounded_trend(pct: str, status: str) -> None:
    assert classify_trend(Decimal(pct)) == status


def test_a_trend_needs_six_weigh_ins_in_each_half() -> None:
    full = linear("0.10", date(2026, 10, 5), date(2026, 10, 18))
    ok = qualified_trend(full[:1] + full[2:], date(2026, 10, 18), ())
    assert (ok.weigh_ins, ok.reason, ok.pct is not None) == (13, "OK", True)
    thin = [entry for index, entry in enumerate(full) if index not in (0, 1)]
    missing = qualified_trend(thin, date(2026, 10, 18), ())
    assert (missing.first_half, missing.second_half) == (5, 7)
    assert (missing.reason, missing.pct) == ("TOO_FEW_WEIGH_INS", None)
    empty = qualified_trend([], date(2026, 10, 18), ())
    assert (empty.weigh_ins, empty.reason) == (0, "TOO_FEW_WEIGH_INS")


def test_entries_outside_the_window_are_ignored() -> None:
    long = linear("0.40", date(2026, 9, 1), date(2026, 10, 4)) + linear(
        "0.10", date(2026, 10, 5), date(2026, 10, 18), base=73_000
    )
    trend = qualified_trend(long, date(2026, 10, 18), ())
    assert (trend.window_first, trend.window_last) == (date(2026, 10, 5), date(2026, 10, 18))
    assert (trend.weigh_ins, trend.pct) == (14, Decimal("0.10"))


def test_a_window_straddling_an_adjustment_is_not_qualified() -> None:
    window = linear("0.10", date(2026, 10, 5), date(2026, 10, 18))
    waiting = qualified_trend(window, date(2026, 10, 18), [date(2026, 10, 6)])
    assert (waiting.reason, waiting.pct) == ("WAITING_FOR_NEW_TREND", None)
    # Weigh-ins are morning, before food: a change effective on day D moves weights after D.
    # On the window's first day the whole window is the new trend; on its last day, the old.
    assert qualified_trend(window, date(2026, 10, 18), [date(2026, 10, 5)]).reason == "OK"
    assert qualified_trend(window, date(2026, 10, 18), [date(2026, 10, 18)]).reason == "OK"
    assert (
        qualified_trend(window, date(2026, 10, 18), [date(2026, 10, 1), date(2026, 10, 25)]).reason
        == "OK"
    )


def test_adjustment_dates_are_the_days_the_target_in_force_changed() -> None:
    targets = [
        target(date(2026, 10, 1), 2650),
        target(date(2026, 10, 10), 2650),
        target(date(2026, 10, 12), 2800),
    ]
    assert adjustment_dates(targets, date(2026, 10, 20)) == [date(2026, 10, 1), date(2026, 10, 12)]
    assert adjustment_dates(targets, date(2026, 10, 11)) == [date(2026, 10, 1)]


def test_insufficient_weigh_ins_mean_insufficient_data() -> None:
    sparse = linear("0.07", START, sunday(3))[::3]
    result = review(sunday(3), sparse)
    assert (result.status, result.recommended_action) == ("INSUFFICIENT_DATA", None)
    # Nothing to decide on thin data: the next finished week is the next chance.
    assert (result.decision_due, result.next_decision_week) == (False, 4)


# --- targets and adjustments --------------------------------------------------------------


def test_the_target_in_force_is_the_latest_decision_on_or_before_the_day() -> None:
    targets = [
        target(date(2026, 10, 1), 2650, "2026-10-01T08:00:00Z"),
        target(date(2026, 10, 1), 2700, "2026-10-01T09:00:00Z"),  # same-day correction
        target(date(2026, 10, 20), 2850),
    ]
    assert target_in_force(targets, date(2026, 9, 30)) is None
    found = target_in_force(targets, date(2026, 10, 19))
    assert found is not None and found.calories_kcal == 2700
    later = target_in_force(targets, date(2026, 10, 20))
    assert later is not None and later.calories_kcal == 2850


def test_re_recording_the_same_value_is_not_an_adjustment() -> None:
    targets = [target(date(2026, 10, 1), 2650), target(date(2026, 10, 10), 2650)]
    assert latest_adjustment_on(targets, date(2026, 10, 20)) == date(2026, 10, 1)
    changed = [*targets, target(date(2026, 10, 12), 2800)]
    assert latest_adjustment_on(changed, date(2026, 10, 20)) == date(2026, 10, 12)
    assert latest_adjustment_on(changed, date(2026, 10, 11)) == date(2026, 10, 1)


def test_after_an_adjustment_the_next_review_waits_for_a_new_trend() -> None:
    targets = [*CALIBRATED, target(sunday(5) - timedelta(days=3), 2800)]
    result = review(sunday(5), linear("0.07", START, sunday(5)), targets=targets)
    assert result.status == "INSUFFICIENT_DATA"
    assert result.trend is not None and result.trend.reason == "WAITING_FOR_NEW_TREND"


def test_applying_does_not_rewrite_the_reading_of_the_week_it_decided() -> None:
    applied = [*CALIBRATED, target(sunday(3) + timedelta(days=1), 2800)]
    prior = [
        PriorDecision(block_week=3, status="UNDER_GAIN", user_choice="APPLIED", delta_kcal=150)
    ]
    entries = linear("0.07", START - timedelta(days=7), sunday(3) + timedelta(days=1))
    result = review(sunday(3) + timedelta(days=1), entries, targets=applied, prior=prior)
    assert (result.status, result.already_decided, result.decision_due) == (
        "UNDER_GAIN",
        True,
        False,
    )
    assert result.trend is not None and result.trend.pct == Decimal("0.07")


def test_a_manual_change_after_the_week_blocks_its_routine_decision() -> None:
    changed = [*CALIBRATED, target(sunday(3) + timedelta(days=1), 2700)]
    entries = linear("0.07", START - timedelta(days=7), sunday(3) + timedelta(days=1))
    result = review(sunday(3) + timedelta(days=1), entries, targets=changed)
    assert result.status == "UNDER_GAIN"
    assert (result.decision_due, result.recommended_action) == (False, None)
    assert result.note is not None and "changed after" in result.note


def test_a_starting_target_leaves_room_for_protein_and_fat() -> None:
    with pytest.raises(ValueError, match="1120"):
        starting_target(900)


# --- timing ----------------------------------------------------------------------------------


def test_before_the_block_there_is_no_review() -> None:
    result = review(START - timedelta(days=1), linear("0.07", START - timedelta(days=20), START))
    assert (result.phase, result.block_week, result.decision_due) == ("pre_block", None, False)
    assert result.next_decision_week == 3
    assert result.next_decision_on == sunday(3)


def test_the_review_week_is_the_last_finished_week() -> None:
    entries = linear("0.07", START - timedelta(days=7), sunday(4))
    assert review(sunday(3) - timedelta(days=1), entries).block_week == 2  # Saturday of week 3
    assert review(sunday(3), entries).block_week == 3  # its Sunday counts
    assert review(sunday(3) + timedelta(days=3), entries).block_week == 3


def test_weeks_1_and_2_allow_no_routine_change() -> None:
    result = review(sunday(2), linear("0.02", START - timedelta(days=14), sunday(2)))
    assert (result.phase, result.decision_due, result.recommended_action) == ("early", False, None)
    assert result.status == "UNDER_GAIN"  # shown, never acted on
    assert result.note is not None and "no routine" in result.note


def test_a_decision_makes_the_next_week_wait_and_the_one_after_due() -> None:
    prior = [PriorDecision(block_week=3, status="IN_RANGE", user_choice="KEPT", delta_kcal=0)]
    entries = linear("0.15", START, sunday(6))
    decided = review(sunday(3), entries, prior=prior)
    assert (decided.decision_due, decided.already_decided) == (False, True)
    assert decided.next_decision_week == 5
    waiting = review(sunday(4), entries, prior=prior)
    assert (waiting.decision_due, waiting.recommended_action) == (False, None)
    assert (waiting.next_decision_week, waiting.next_decision_on) == (5, sunday(5))
    due = review(sunday(5), entries, prior=prior)
    assert (due.decision_due, due.recommended_action) == (True, "NO_CHANGE")


def test_the_week_12_review_stays_open_in_the_week_after() -> None:
    entries = linear("0.15", START, sunday(12) + timedelta(days=3))
    result = review(sunday(12) + timedelta(days=3), entries)
    assert (result.block_week, result.decision_due) == (12, True)


def test_after_week_12_there_is_no_routine_decision() -> None:
    entries = linear("0.15", START, sunday(13) + timedelta(days=3))
    result = review(sunday(13) + timedelta(days=3), entries)
    assert (result.phase, result.block_week, result.decision_due) == ("post_block", 12, False)
    assert result.next_decision_week is None


# --- over-gain must be sustained ------------------------------------------------------------


def test_a_single_week_above_the_band_is_not_sustained() -> None:
    entries = linear("0.15", START, sunday(4)) + linear(
        "0.60", sunday(4) + timedelta(days=1), sunday(5), base=72_600
    )
    result = review(sunday(5), entries)
    assert result.status == "OVER_GAIN"
    assert result.sustained is False
    assert (result.recommended_action, result.recommended_delta_kcal) == ("NO_CHANGE", 0)
    assert result.note is not None and "sustained" in result.note


def test_over_gain_in_week_3_cannot_be_sustained_yet() -> None:
    result = review(sunday(3), linear("0.40", START - timedelta(days=7), sunday(3)))
    assert (result.status, result.sustained, result.recommended_delta_kcal) == (
        "OVER_GAIN",
        False,
        0,
    )


def test_very_rapid_gain_with_a_composition_concern_asks_for_reassessment() -> None:
    entries = linear("0.31", START, sunday(5))
    concerned = review(sunday(5), entries, composition_concern=True)
    assert concerned.status == "COMPOSITION_REASSESSMENT"
    assert concerned.recommended_action == "STRONGER_REASSESSMENT"
    assert concerned.recommended_delta_kcal is None
    assert review(sunday(5), entries).status == "OVER_GAIN"
    # Below 0.30 a composition concern changes nothing.
    assert review(sunday(5), linear("0.27", START, sunday(5)), composition_concern=True).status == (
        "OVER_GAIN"
    )


# --- diagnostic gate ------------------------------------------------------------------------


def decision(week: int, status: str, choice: str, delta: int) -> PriorDecision:
    return PriorDecision(
        block_week=week,
        status=status,  # type: ignore[arg-type]
        user_choice=choice,  # type: ignore[arg-type]
        delta_kcal=delta,
    )


@pytest.mark.parametrize(
    ("history", "expected"),
    [
        ([], 0),
        ([("UNDER_GAIN", "APPLIED", 150)], 1),
        ([("UNDER_GAIN", "APPLIED", 150), ("UNDER_GAIN", "APPLIED", 150)], 2),
        ([("UNDER_GAIN", "APPLIED", 150), ("UNDER_GAIN", "KEPT", 0)], 1),
        (
            [
                ("UNDER_GAIN", "APPLIED", 150),
                ("IN_RANGE", "KEPT", 0),
                ("UNDER_GAIN", "APPLIED", 150),
            ],
            1,
        ),
        (
            [
                ("UNDER_GAIN", "APPLIED", 150),
                ("UNDER_GAIN", "APPLIED", 150),
                ("UNDER_GAIN", "APPLIED", 150),  # applied after the gate cleared
            ],
            3,
        ),
    ],
)
def test_failed_corrections_are_counted_from_consecutive_applied_increases(
    history: list[tuple[str, str, int]], expected: int
) -> None:
    prior = [decision(3 + 2 * index, *item) for index, item in enumerate(history)]
    assert failed_under_gain_corrections(prior, current_is_under=True) == expected


def gate_case(gates: list[GateRecord], history_len: int = 2) -> Review:
    prior = [decision(3 + 2 * index, "UNDER_GAIN", "APPLIED", 150) for index in range(history_len)]
    targets = [
        *CALIBRATED,
        target(sunday(3) - timedelta(days=13), 2800),
        target(sunday(5) - timedelta(days=14), 2950),
    ]
    week = 3 + 2 * history_len
    return review(
        sunday(week), linear("0.05", START, sunday(week)), targets=targets, prior=prior, gates=gates
    )


def test_confirmed_underfeeding_permits_another_increase() -> None:
    result = gate_case([GateRecord(block_week=7, result="GENUINE_UNDERFEEDING_CONFIRMED")])
    assert (result.status, result.recommended_delta_kcal) == ("UNDER_GAIN", 150)
    assert result.recommended_target_kcal == 3100


def test_unreliable_inputs_must_be_fixed_first() -> None:
    result = gate_case([GateRecord(block_week=7, result="INPUTS_UNRELIABLE")])
    assert (result.status, result.recommended_action) == (
        "DIAGNOSTIC_GATE",
        "FIX_INPUT_PROBLEM_FIRST",
    )
    assert result.recommended_delta_kcal is None


def test_the_latest_audit_of_the_week_decides() -> None:
    redone = [
        GateRecord(block_week=7, result="INPUTS_UNRELIABLE"),
        GateRecord(block_week=7, result="GENUINE_UNDERFEEDING_CONFIRMED"),
    ]
    assert gate_case(redone).status == "UNDER_GAIN"


def test_a_gate_of_another_week_does_not_clear_this_one() -> None:
    result = gate_case([GateRecord(block_week=5, result="GENUINE_UNDERFEEDING_CONFIRMED")])
    assert result.status == "DIAGNOSTIC_GATE"


def test_every_check_must_be_answered_and_reliable_inputs_confirmed() -> None:
    reliable = dict.fromkeys(GATE_CHECKS, False)
    for name in (
        "tracking_method_consistent",
        "food_logging_consistent",
        "restaurant_unlogged_intake_reviewed",
        "weighing_protocol_consistent",
        "adherence_consistent",
    ):
        reliable[name] = True
    assert gate_result_allowed(reliable, "GENUINE_UNDERFEEDING_CONFIRMED")
    assert gate_result_allowed(reliable, "INPUTS_UNRELIABLE")
    assert not gate_result_allowed(
        {**reliable, "adherence_consistent": False}, ("GENUINE_UNDERFEEDING_CONFIRMED")
    )
    assert not gate_result_allowed(
        {**reliable, "illness_travel": True}, ("GENUINE_UNDERFEEDING_CONFIRMED")
    )
    partial = {key: value for key, value in reliable.items() if key != "sleep_recovery_changed"}
    assert not gate_result_allowed(partial, "INPUTS_UNRELIABLE")
    assert not gate_result_allowed(reliable, "SOMETHING_ELSE")


# --- the controller never writes -------------------------------------------------------------


def test_the_controller_module_has_no_way_to_store_anything() -> None:
    import fitness_lab.domain.nutrition_controller as controller

    source = inspect.getsource(controller)
    for forbidden in ("sqlite3", "fitness_lab.storage", "fastapi", "open("):
        assert forbidden not in source
