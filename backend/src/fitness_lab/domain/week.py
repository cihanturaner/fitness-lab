"""Calendar weeks, block weeks and the status of a planned session in a week.

Weeks run Monday to Sunday. Week 1 of a block is the week that contains its start date,
so the Monday-Sunday strip and the block count always agree.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

SessionStatus = Literal["complete", "draft", "not_started"]


@dataclass(frozen=True, slots=True)
class SessionFacts:
    """What the record holds for one planned workout, as seen from one week."""

    open_draft_id: str | None
    open_draft_on: str | None
    # (workout_id, performed_on) of complete workouts with this origin inside the week.
    completed_in_week: tuple[tuple[str, str], ...]


def week_bounds(day: date) -> tuple[date, date]:
    monday = day - timedelta(days=day.weekday())
    return monday, monday + timedelta(days=6)


def block_week(start_on: date, day: date) -> int:
    """1 for the week containing ``start_on``; 0 and below before it."""
    return (week_bounds(day)[0] - week_bounds(start_on)[0]).days // 7 + 1


def weekday_index(day_label: str | None) -> int | None:
    """Monday = 0 … Sunday = 6, from a planned workout's day label; None if not a weekday."""
    if day_label is None:
        return None
    label = day_label.strip().lower()
    return WEEKDAYS.index(label) if label in WEEKDAYS else None


def session_status(facts: SessionFacts) -> tuple[SessionStatus, str | None, str | None]:
    """(status, workout to open, its date). An open draft is what Open would resume."""
    if facts.open_draft_id is not None:
        return "draft", facts.open_draft_id, facts.open_draft_on
    if facts.completed_in_week:
        # Stable sort: among completions on one date, the last recorded one is shown.
        workout_id, performed_on = sorted(facts.completed_in_week, key=lambda item: item[1])[-1]
        return "complete", workout_id, performed_on
    return "not_started", None, None
