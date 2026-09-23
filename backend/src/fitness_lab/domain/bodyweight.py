"""Daily bodyweight: exact grams, 7-day averages and the chart series.

A 7-day average is the mean of the entries actually recorded in the seven calendar days
ending on the reference date — never interpolated — and it always travels with its entry
count, so a mean of two weigh-ins is never mistaken for a full week. Arithmetic is exact
(Decimal over integer grams); rounding is a display concern only.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from fitness_lab.domain.units import g_to_kg, kg_to_g

MIN_BODYWEIGHT_G = 20_000
MAX_BODYWEIGHT_G = 300_000
WINDOW_DAYS = 7
# Plain digits with at most two decimals (a scale reads 0.1 or 0.05 kg).
BODYWEIGHT_PATTERN = re.compile(r"[0-9]{1,3}(\.[0-9]{1,2})?")


@dataclass(frozen=True, slots=True)
class WeightEntry:
    measured_on: date
    grams: int


@dataclass(frozen=True, slots=True)
class BodyweightSummary:
    reference_on: date
    latest: WeightEntry | None
    current_avg_kg: Decimal | None
    current_count: int
    previous_avg_kg: Decimal | None
    previous_count: int
    change_kg: Decimal | None
    change_pct: Decimal | None


@dataclass(frozen=True, slots=True)
class SeriesPoint:
    day: date
    grams: int | None
    avg7_kg: Decimal | None


def parse_bodyweight_kg(text: str) -> int:
    """A plausible bodyweight in kilograms, as exact integer grams."""
    if not BODYWEIGHT_PATTERN.fullmatch(text):
        raise ValueError(f"bodyweight must be kilograms like 72.4: {text!r}")
    grams = kg_to_g(text)
    assert grams is not None
    if not MIN_BODYWEIGHT_G <= grams <= MAX_BODYWEIGHT_G:
        raise ValueError(f"bodyweight must be between 20 and 300 kg: {text!r}")
    return grams


def _mean_kg(grams: Sequence[int]) -> Decimal | None:
    if not grams:
        return None
    kilograms = g_to_kg(sum(grams))
    assert kilograms is not None
    return kilograms / len(grams)


def _window(entries: Iterable[WeightEntry], last: date) -> list[int]:
    first = last - timedelta(days=WINDOW_DAYS - 1)
    return [entry.grams for entry in entries if first <= entry.measured_on <= last]


def summarize(entries: Sequence[WeightEntry], reference: date) -> BodyweightSummary:
    """Latest weigh-in, this 7-day mean, the previous 7-day mean, and the change."""
    known = [entry for entry in entries if entry.measured_on <= reference]
    latest = max(known, key=lambda entry: entry.measured_on, default=None)
    current = _window(known, reference)
    previous = _window(known, reference - timedelta(days=WINDOW_DAYS))
    current_avg = _mean_kg(current)
    previous_avg = _mean_kg(previous)
    change = None
    change_pct = None
    if current_avg is not None and previous_avg is not None:
        change = current_avg - previous_avg
        change_pct = change / previous_avg * 100
    return BodyweightSummary(
        reference_on=reference,
        latest=latest,
        current_avg_kg=current_avg,
        current_count=len(current),
        previous_avg_kg=previous_avg,
        previous_count=len(previous),
        change_kg=change,
        change_pct=change_pct,
    )


def rolling_series(entries: Sequence[WeightEntry], first: date, last: date) -> list[SeriesPoint]:
    """Every calendar day from ``first`` to ``last``: its weight and trailing 7-day mean."""
    by_day = {entry.measured_on: entry.grams for entry in entries}
    points: list[SeriesPoint] = []
    day = first
    while day <= last:
        points.append(
            SeriesPoint(day=day, grams=by_day.get(day), avg7_kg=_mean_kg(_window(entries, day)))
        )
        day += timedelta(days=1)
    return points
