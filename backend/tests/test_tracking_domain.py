"""Pure V2 rules: bodyweight averages, nutrition targets, block weeks, session status."""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from fitness_lab.domain.bodyweight import (
    WeightEntry,
    parse_bodyweight_kg,
    rolling_series,
    summarize,
)
from fitness_lab.domain.nutrition import (
    FAT_G_PER_DAY,
    FIXED_PROTEIN_FAT_KCAL,
    PROTEIN_G_PER_DAY,
    carbohydrate_target_g,
    check_calorie_target,
    check_day_values,
    targets_for,
)
from fitness_lab.domain.week import (
    SessionFacts,
    block_week,
    session_status,
    week_bounds,
    weekday_index,
)

ARTIFACT = (
    Path(__file__).resolve().parents[2]
    / "programs/advanced-natural-12w-nutrition/artifact/locked_nutrition_tracker.json"
)


def entries(start: date, grams: Sequence[int | None]) -> list[WeightEntry]:
    result = []
    for offset, value in enumerate(grams):
        if value is not None:
            day = date.fromordinal(start.toordinal() + offset)
            result.append(WeightEntry(measured_on=day, grams=value))
    return result


# --- bodyweight input -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "grams"), [("72", 72000), ("72.4", 72400), ("72.45", 72450), ("100.05", 100050)]
)
def test_bodyweight_is_exact_grams(text: str, grams: int) -> None:
    assert parse_bodyweight_kg(text) == grams


@pytest.mark.parametrize(
    "text", ["", "72.456", "1e2", "-72", " 72", "72,4", "abc", "19.99", "300.01", "7200"]
)
def test_bodyweight_refuses_anything_not_a_plain_plausible_kg(text: str) -> None:
    with pytest.raises(ValueError):
        parse_bodyweight_kg(text)


# --- 7-day averages ---------------------------------------------------------------------


def test_seven_day_average_and_change_against_the_previous_seven_days() -> None:
    reference = date(2026, 10, 14)
    previous = [71300, 71400, 71500, 71600, 71700, 71800, 71900]  # Oct 1..7 -> 71.6
    current = [72000, 72100, 72200, 72300, 72400, 72500, 72600]  # Oct 8..14 -> 72.3
    summary = summarize(entries(date(2026, 10, 1), previous + current), reference)

    assert summary.latest == WeightEntry(date(2026, 10, 14), 72600)
    assert summary.current_avg_kg == Decimal("72.3")
    assert summary.current_count == 7
    assert summary.previous_avg_kg == Decimal("71.6")
    assert summary.previous_count == 7
    assert summary.change_kg == Decimal("0.7")
    # 0.7 / 71.6 * 100 = 0.97765... -> 0.98 when displayed
    assert summary.change_pct is not None
    assert summary.change_pct.quantize(Decimal("0.01")) == Decimal("0.98")


def test_averages_use_only_the_days_that_were_weighed() -> None:
    # Oct 8, 10, 14 weighed in the current window; nothing is interpolated.
    grams: list[int | None] = [72000, None, 72300, None, None, None, 72600]
    summary = summarize(entries(date(2026, 10, 8), grams), date(2026, 10, 14))
    assert summary.current_count == 3
    assert summary.current_avg_kg == Decimal("72.3")
    assert summary.previous_avg_kg is None
    assert summary.previous_count == 0
    assert summary.change_kg is None
    assert summary.change_pct is None


def test_entries_after_the_reference_date_are_ignored() -> None:
    data = entries(date(2026, 10, 13), [72000, 99000])
    summary = summarize(data, date(2026, 10, 13))
    assert summary.latest == WeightEntry(date(2026, 10, 13), 72000)
    assert summary.current_avg_kg == Decimal("72")


def test_an_empty_history_has_no_summary_values() -> None:
    summary = summarize([], date(2026, 10, 13))
    assert summary.latest is None
    assert summary.current_avg_kg is None
    assert summary.current_count == 0


def test_the_window_boundaries_are_exactly_seven_calendar_days() -> None:
    # Oct 7 belongs to the previous window of Oct 14; Oct 8 to the current one.
    data = [WeightEntry(date(2026, 10, 7), 70000), WeightEntry(date(2026, 10, 8), 72000)]
    summary = summarize(data, date(2026, 10, 14))
    assert (summary.current_avg_kg, summary.current_count) == (Decimal("72"), 1)
    assert (summary.previous_avg_kg, summary.previous_count) == (Decimal("70"), 1)
    # Oct 1..7 is the previous window, Sep 30 is outside both.
    outside = summarize([WeightEntry(date(2026, 9, 30), 70000)], date(2026, 10, 14))
    assert outside.previous_count == 0


def test_average_is_exact_before_display_rounding() -> None:
    data = entries(date(2026, 10, 12), [72000, 72100, 72100])  # 72.0666...
    summary = summarize(data, date(2026, 10, 14))
    assert summary.current_avg_kg is not None
    assert summary.current_avg_kg.quantize(Decimal("0.01")) == Decimal("72.07")


def test_rolling_series_gives_each_day_its_weight_and_trailing_average() -> None:
    data = entries(date(2026, 10, 1), [72000, None, 73000])
    series = rolling_series(data, date(2026, 10, 1), date(2026, 10, 9))
    assert [point.day for point in series][:3] == [
        date(2026, 10, 1),
        date(2026, 10, 2),
        date(2026, 10, 3),
    ]
    assert series[0].grams == 72000 and series[0].avg7_kg == Decimal("72")
    assert series[1].grams is None and series[1].avg7_kg == Decimal("72")
    assert series[2].avg7_kg == Decimal("72.5")
    # Oct 9: window Oct 3..9 holds only Oct 3.
    assert series[8].avg7_kg == Decimal("73")
    assert len(series) == 9


def test_rolling_series_window_empties_out() -> None:
    data = entries(date(2026, 10, 1), [72000])
    series = rolling_series(data, date(2026, 10, 1), date(2026, 10, 8))
    assert series[6].avg7_kg == Decimal("72")  # Oct 7 still sees Oct 1
    assert series[7].avg7_kg is None  # Oct 8 does not


# --- nutrition targets ------------------------------------------------------------------


def test_locked_targets_match_the_authoritative_source() -> None:
    source = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    locked = source["locked_targets"]
    assert locked["protein_g_per_day"] == PROTEIN_G_PER_DAY == 145
    assert locked["fat_g_per_day"] == FAT_G_PER_DAY == 60
    assert locked["carbohydrate"]["fixed_protein_plus_fat_kcal"] == FIXED_PROTEIN_FAT_KCAL
    assert locked["carbohydrate"]["formula"] == "(daily_calorie_target - 1120) / 4"
    assert source["maintenance_and_starting_calories"]["current_calorie_target_kcal"] is None


def test_unknown_calorie_target_leaves_carbohydrate_unknown() -> None:
    targets = targets_for(None)
    assert targets.protein_g == 145
    assert targets.fat_g == 60
    assert targets.calories_kcal is None
    assert targets.carbs_g is None


def test_the_sources_own_example_2650_kcal_gives_383_g_carbohydrate() -> None:
    # (2650 - 1120) / 4 = 382.5 -> 383, as the source's stable_intake_2500 example states.
    assert carbohydrate_target_g(2650) == 383
    assert targets_for(2650).carbs_g == 383


@pytest.mark.parametrize(("kcal", "carbs"), [(1120, 0), (2400, 320), (2401, 320), (2402, 321)])
def test_carbohydrate_is_the_remainder_rounded_half_up(kcal: int, carbs: int) -> None:
    assert carbohydrate_target_g(kcal) == carbs


@pytest.mark.parametrize("kcal", [1119, 0, -5, 10001])
def test_a_calorie_target_must_leave_room_for_protein_and_fat(kcal: int) -> None:
    with pytest.raises(ValueError):
        check_calorie_target(kcal)


def test_a_day_needs_at_least_one_number() -> None:
    with pytest.raises(ValueError):
        check_day_values(calories_kcal=None, protein_g=None, carbs_g=None, fat_g=None)
    check_day_values(calories_kcal=None, protein_g=150, carbs_g=None, fat_g=None)


@pytest.mark.parametrize(
    "values",
    [
        {"calories_kcal": 15001},
        {"calories_kcal": -1},
        {"protein_g": 1501},
        {"carbs_g": -1},
        {"fat_g": 2000},
    ],
)
def test_a_day_refuses_impossible_values(values: dict[str, int]) -> None:
    fields: dict[str, int | None] = {
        "calories_kcal": None,
        "protein_g": None,
        "carbs_g": None,
        "fat_g": None,
    }
    fields.update(values)
    with pytest.raises(ValueError):
        check_day_values(**fields)


# --- weeks ------------------------------------------------------------------------------


def test_week_bounds_are_monday_to_sunday() -> None:
    assert week_bounds(date(2026, 9, 23)) == (date(2026, 9, 21), date(2026, 9, 27))
    assert week_bounds(date(2026, 9, 21)) == (date(2026, 9, 21), date(2026, 9, 27))
    assert week_bounds(date(2026, 9, 27)) == (date(2026, 9, 21), date(2026, 9, 27))


def test_block_week_one_is_the_week_containing_the_start() -> None:
    start = date(2026, 10, 1)  # a Thursday
    assert block_week(start, date(2026, 9, 28)) == 1
    assert block_week(start, date(2026, 10, 4)) == 1
    assert block_week(start, date(2026, 10, 5)) == 2
    assert block_week(start, date(2026, 12, 20)) == 12
    assert block_week(start, date(2026, 12, 21)) == 13
    assert block_week(start, date(2026, 9, 27)) == 0
    assert block_week(start, date(2026, 9, 20)) == -1


@pytest.mark.parametrize(
    ("label", "index"),
    [
        ("Monday", 0),
        ("tuesday", 1),
        (" Thursday ", 3),
        ("Sunday", 6),
        (None, None),
        ("Day 1", None),
    ],
)
def test_weekday_from_the_planned_day_label(label: str | None, index: int | None) -> None:
    assert weekday_index(label) == index


def test_an_open_draft_wins_over_a_completion() -> None:
    facts = SessionFacts(
        open_draft_id="d1", open_draft_on="2026-09-21", completed_in_week=(("c1", "2026-09-21"),)
    )
    assert session_status(facts) == ("draft", "d1", "2026-09-21")


def test_the_latest_completion_in_the_week_is_shown() -> None:
    facts = SessionFacts(
        open_draft_id=None,
        open_draft_on=None,
        completed_in_week=(("c1", "2026-09-21"), ("c2", "2026-09-22")),
    )
    assert session_status(facts) == ("complete", "c2", "2026-09-22")


def test_nothing_this_week_is_not_started() -> None:
    facts = SessionFacts(open_draft_id=None, open_draft_on=None, completed_in_week=())
    assert session_status(facts) == ("not_started", None, None)
