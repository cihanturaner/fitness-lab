"""V2 routes: the week, bodyweight, nutrition and exercise history.

Same boundary rules as the workout routes: kilograms cross as decimal strings, integers are
strict, unknown request fields are refused, and each route opens its own connection. Dates
are civil YYYY-MM-DD strings; ``date`` defaults to the machine's local day.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field

from fitness_lab.api.schemas import (
    DATE_PATTERN,
    ExerciseOut,
    PerformedSetOut,
    RequestModel,
    StrictDate,
)
from fitness_lab.domain.bodyweight import (
    WeightEntry,
    parse_bodyweight_kg,
    rolling_series,
    summarize,
)
from fitness_lab.domain.nutrition import targets_for
from fitness_lab.domain.units import format_kg, g_to_kg
from fitness_lab.domain.week import (
    WEEKDAYS,
    block_week,
    session_status,
    week_bounds,
    weekday_index,
)
from fitness_lab.storage import db, history, programs, tracking
from fitness_lab.storage.entry import NotFound
from fitness_lab.storage.exercises import get_exercise

router = APIRouter()

StrictCount = Annotated[int, Field(strict=True)]
# ?date=YYYY-MM-DD; named `on` in Python so it never shadows datetime.date.
OnDate = Annotated[str | None, Query(alias="date")]
CENT = Decimal("0.01")
RECENT_NUTRITION_DAYS = 14


@contextmanager
def _connection() -> Iterator[sqlite3.Connection]:
    with db.connection_scope() as connection:
        yield connection


def _day(value: str | None) -> date:
    """A civil date from the URL, or today. Anything but canonical YYYY-MM-DD is refused."""
    if value is None:
        return date.today()
    if not DATE_PATTERN.fullmatch(value):
        raise ValueError(f"dates must be YYYY-MM-DD: {value!r}")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"not a calendar date: {value!r}") from exc


def _cents(value: Decimal | None) -> str | None:
    """Display rounding (half-up to 0.01) applied once, at the boundary."""
    return None if value is None else str(value.quantize(CENT, rounding=ROUND_HALF_UP))


def _kg(grams: int) -> str:
    value = format_kg(g_to_kg(grams))
    assert value is not None
    return value


# --- week ------------------------------------------------------------------------------


class ProgramBriefOut(BaseModel):
    id: str
    name: str
    version_label: str | None
    duration_weeks: int | None


class BlockOut(BaseModel):
    start_on: str
    week: int
    weeks: int | None


class WeekSessionOut(BaseModel):
    planned_workout_id: str
    workout_key: str
    name: str
    day_label: str | None
    slot_count: int
    set_count: int
    status: Literal["complete", "draft", "not_started"]
    workout_id: str | None
    workout_on: str | None


class UnplannedOut(BaseModel):
    workout_id: str
    status: str


class WeekDayOut(BaseModel):
    date: str
    weekday: str
    sessions: list[WeekSessionOut]
    unplanned: list[UnplannedOut]


class WeekOut(BaseModel):
    date: str
    week_start: str
    week_end: str
    program: ProgramBriefOut | None
    block: BlockOut | None
    days: list[WeekDayOut]
    unscheduled: list[WeekSessionOut]


@router.get("/api/week")
def week(on: OnDate = None) -> WeekOut:
    today = _day(on)
    monday, sunday = week_bounds(today)
    days = [
        WeekDayOut(
            date=(monday + timedelta(days=offset)).isoformat(),
            weekday=WEEKDAYS[offset].capitalize(),
            sessions=[],
            unplanned=[],
        )
        for offset in range(7)
    ]
    unscheduled: list[WeekSessionOut] = []
    program_out: ProgramBriefOut | None = None
    block_out: BlockOut | None = None
    with _connection() as connection, db.transaction(connection):
        version = programs.get_active_version(connection)
        if version is not None:
            program_out = ProgramBriefOut(
                id=version.id,
                name=version.name,
                version_label=version.version_label,
                duration_weeks=version.duration_weeks,
            )
            start = programs.get_block_start(connection, version.id)
            if start is not None:
                block_out = BlockOut(
                    start_on=start,
                    week=block_week(date_from(start), today),
                    weeks=version.duration_weeks,
                )
            facts = history.week_facts(
                connection, version.id, monday.isoformat(), sunday.isoformat()
            )
            for planned in programs.list_planned_workouts(connection, version.id):
                slots = programs.list_slots(connection, planned.id)
                status, workout_id, workout_on = session_status(facts[planned.id])
                item = WeekSessionOut(
                    planned_workout_id=planned.id,
                    workout_key=planned.workout_key,
                    name=planned.name,
                    day_label=planned.day_label,
                    slot_count=len(slots),
                    set_count=sum(len(slot.sets) for slot in slots),
                    status=status,
                    workout_id=workout_id,
                    workout_on=workout_on,
                )
                index = weekday_index(planned.day_label)
                if index is None:
                    unscheduled.append(item)
                else:
                    days[index].sessions.append(item)
        for workout in history.unplanned_between(
            connection, monday.isoformat(), sunday.isoformat()
        ):
            offset = (date_from(workout.performed_on) - monday).days
            days[offset].unplanned.append(
                UnplannedOut(workout_id=workout.id, status=workout.status.value)
            )
    return WeekOut(
        date=today.isoformat(),
        week_start=monday.isoformat(),
        week_end=sunday.isoformat(),
        program=program_out,
        block=block_out,
        days=days,
        unscheduled=unscheduled,
    )


def date_from(text: str) -> date:
    return date.fromisoformat(text)


# --- bodyweight ------------------------------------------------------------------------


class BodyweightIn(RequestModel):
    bodyweight_kg: str
    notes: str | None = None


class BodyweightEntryOut(BaseModel):
    measured_on: str
    bodyweight_kg: str
    notes: str | None


class LatestOut(BaseModel):
    measured_on: str
    bodyweight_kg: str


class BodyweightSummaryOut(BaseModel):
    reference_on: str
    latest: LatestOut | None
    current_avg_kg: str | None
    current_count: int
    previous_avg_kg: str | None
    previous_count: int
    change_kg: str | None
    change_pct: str | None


class SeriesPointOut(BaseModel):
    date: str
    bodyweight_kg: str | None
    avg7_kg: str | None


class BodyweightOut(BaseModel):
    entries: list[BodyweightEntryOut]
    summary: BodyweightSummaryOut
    series: list[SeriesPointOut]


def _entry_out(row: tracking.BodyweightRow) -> BodyweightEntryOut:
    return BodyweightEntryOut(
        measured_on=row.measured_on, bodyweight_kg=_kg(row.grams), notes=row.notes
    )


@router.get("/api/bodyweight")
def bodyweight(on: OnDate = None, days: int = 90) -> BodyweightOut:
    reference = _day(on)
    span = max(14, min(days, 3650))
    first = reference - timedelta(days=span - 1)
    with _connection() as connection:
        # Two extra weeks before the range feed the first days' 7-day windows.
        rows = tracking.list_bodyweight(
            connection,
            first=(first - timedelta(days=13)).isoformat(),
            last=reference.isoformat(),
        )
    weights = [WeightEntry(date_from(row.measured_on), row.grams) for row in rows]
    summary = summarize(weights, reference)
    shown = [row for row in rows if row.measured_on >= first.isoformat()]
    series_start = date_from(shown[0].measured_on) if shown else None
    series = (
        []
        if series_start is None
        else [
            SeriesPointOut(
                date=point.day.isoformat(),
                bodyweight_kg=None if point.grams is None else _kg(point.grams),
                avg7_kg=_cents(point.avg7_kg),
            )
            for point in rolling_series(weights, series_start, reference)
        ]
    )
    latest = summary.latest
    return BodyweightOut(
        entries=[_entry_out(row) for row in reversed(shown)],
        summary=BodyweightSummaryOut(
            reference_on=reference.isoformat(),
            latest=None
            if latest is None
            else LatestOut(
                measured_on=latest.measured_on.isoformat(), bodyweight_kg=_kg(latest.grams)
            ),
            current_avg_kg=_cents(summary.current_avg_kg),
            current_count=summary.current_count,
            previous_avg_kg=_cents(summary.previous_avg_kg),
            previous_count=summary.previous_count,
            change_kg=_cents(summary.change_kg),
            change_pct=_cents(summary.change_pct),
        ),
        series=series,
    )


@router.put("/api/bodyweight/{day}")
def put_bodyweight(day: str, body: BodyweightIn) -> BodyweightEntryOut:
    measured_on = _day(day).isoformat()
    grams = parse_bodyweight_kg(body.bodyweight_kg)
    with _connection() as connection:
        return _entry_out(tracking.put_bodyweight(connection, measured_on, grams, body.notes))


@router.delete("/api/bodyweight/{day}", status_code=204)
def delete_bodyweight(day: str) -> Response:
    with _connection() as connection:
        tracking.delete_bodyweight(connection, _day(day).isoformat())
    return Response(status_code=204)


# --- nutrition -------------------------------------------------------------------------


class NutritionDayIn(RequestModel):
    calories_kcal: StrictCount | None = None
    protein_g: StrictCount | None = None
    carbs_g: StrictCount | None = None
    fat_g: StrictCount | None = None
    notes: str | None = None


class CalorieTargetIn(RequestModel):
    effective_on: StrictDate
    calories_kcal: StrictCount
    notes: str | None = None


class NutritionDayOut(BaseModel):
    logged_on: str
    calories_kcal: int | None
    protein_g: int | None
    carbs_g: int | None
    fat_g: int | None
    notes: str | None

    @classmethod
    def of(cls, row: tracking.NutritionDayRow) -> NutritionDayOut:
        return cls(
            logged_on=row.logged_on,
            calories_kcal=row.calories_kcal,
            protein_g=row.protein_g,
            carbs_g=row.carbs_g,
            fat_g=row.fat_g,
            notes=row.notes,
        )


class TargetsOut(BaseModel):
    protein_g: int
    fat_g: int
    calories_kcal: int | None
    carbs_g: int | None
    calorie_target_effective_on: str | None


class CalorieTargetOut(BaseModel):
    id: str
    effective_on: str
    calories_kcal: int
    notes: str | None
    set_at_utc: str

    @classmethod
    def of(cls, row: tracking.CalorieTargetRow) -> CalorieTargetOut:
        return cls(
            id=row.id,
            effective_on=row.effective_on,
            calories_kcal=row.calories_kcal,
            notes=row.notes,
            set_at_utc=row.set_at_utc,
        )


class NutritionOut(BaseModel):
    date: str
    day: NutritionDayOut | None
    targets: TargetsOut
    recent: list[NutritionDayOut]
    target_history: list[CalorieTargetOut]


@router.get("/api/nutrition")
def nutrition(on: OnDate = None) -> NutritionOut:
    day = _day(on)
    first = day - timedelta(days=RECENT_NUTRITION_DAYS - 1)
    with _connection() as connection, db.transaction(connection):
        logged = tracking.get_nutrition_day(connection, day.isoformat())
        target = tracking.calorie_target_on(connection, day.isoformat())
        recent = tracking.list_nutrition_days(
            connection, first=first.isoformat(), last=day.isoformat()
        )
        decisions = tracking.list_calorie_targets(connection)
    targets = targets_for(None if target is None else target.calories_kcal)
    return NutritionOut(
        date=day.isoformat(),
        day=None if logged is None else NutritionDayOut.of(logged),
        targets=TargetsOut(
            protein_g=targets.protein_g,
            fat_g=targets.fat_g,
            calories_kcal=targets.calories_kcal,
            carbs_g=targets.carbs_g,
            calorie_target_effective_on=None if target is None else target.effective_on,
        ),
        recent=[NutritionDayOut.of(row) for row in reversed(recent)],
        target_history=[CalorieTargetOut.of(row) for row in decisions],
    )


@router.put("/api/nutrition/{day}")
def put_nutrition(day: str, body: NutritionDayIn) -> NutritionDayOut:
    logged_on = _day(day).isoformat()
    with _connection() as connection:
        row = tracking.put_nutrition_day(
            connection,
            logged_on,
            calories_kcal=body.calories_kcal,
            protein_g=body.protein_g,
            carbs_g=body.carbs_g,
            fat_g=body.fat_g,
            notes=body.notes,
        )
    return NutritionDayOut.of(row)


@router.delete("/api/nutrition/{day}", status_code=204)
def delete_nutrition(day: str) -> Response:
    with _connection() as connection:
        tracking.delete_nutrition_day(connection, _day(day).isoformat())
    return Response(status_code=204)


@router.post("/api/nutrition/calorie-targets", status_code=201)
def add_calorie_target(body: CalorieTargetIn) -> CalorieTargetOut:
    with _connection() as connection:
        row = tracking.add_calorie_target(
            connection, body.effective_on.isoformat(), body.calories_kcal, body.notes
        )
    return CalorieTargetOut.of(row)


# --- history ---------------------------------------------------------------------------


class HistoryExerciseOut(BaseModel):
    exercise: ExerciseOut
    exposures: int
    last_performed_on: str


class ExposureOut(BaseModel):
    workout_id: str
    performed_on: str
    performed_time_local: str | None
    planned_workout_name: str | None
    block_week: int | None
    sets: list[PerformedSetOut]


class ExerciseHistoryOut(BaseModel):
    exercise: ExerciseOut
    block_start_on: str | None
    exposures: list[ExposureOut]


class ExerciseSetsOut(BaseModel):
    exercise: ExerciseOut
    sets: list[PerformedSetOut]


class RecentSessionOut(BaseModel):
    workout_id: str
    performed_on: str
    performed_time_local: str | None
    planned_workout_name: str | None
    exercises: list[ExerciseSetsOut]


def _active_block_start(connection: sqlite3.Connection) -> str | None:
    version = programs.get_active_version(connection)
    return None if version is None else programs.get_block_start(connection, version.id)


@router.get("/api/history/exercises")
def history_exercises() -> list[HistoryExerciseOut]:
    with _connection() as connection:
        return [
            HistoryExerciseOut(
                exercise=ExerciseOut.of(item.exercise),
                exposures=item.exposures,
                last_performed_on=item.last_performed_on,
            )
            for item in history.exercises_with_history(connection)
        ]


@router.get("/api/exercises/{exercise_id}/history")
def exercise_history(exercise_id: str) -> ExerciseHistoryOut:
    with _connection() as connection, db.transaction(connection):
        exercise = get_exercise(connection, exercise_id)
        if exercise is None:
            raise NotFound(f"no exercise with id {exercise_id!r}")
        start = _active_block_start(connection)
        exposures = history.exercise_history(connection, exercise_id)
    return ExerciseHistoryOut(
        exercise=ExerciseOut.of(exercise),
        block_start_on=start,
        exposures=[
            ExposureOut(
                workout_id=item.workout_id,
                performed_on=item.performed_on,
                performed_time_local=item.performed_time_local,
                planned_workout_name=item.planned_workout_name,
                block_week=None
                if start is None
                else block_week(date_from(start), date_from(item.performed_on)),
                sets=[PerformedSetOut.of(performed) for performed in item.sets],
            )
            for item in exposures
        ],
    )


@router.get("/api/history/recent")
def recent_training(limit: int = 3) -> list[RecentSessionOut]:
    with _connection() as connection, db.transaction(connection):
        sessions = history.recent_sessions(connection, limit=max(1, min(limit, 20)))
        exercises = {
            group.exercise_id: get_exercise(connection, group.exercise_id)
            for item in sessions
            for group in item.exercises
        }
    return [
        RecentSessionOut(
            workout_id=item.workout_id,
            performed_on=item.performed_on,
            performed_time_local=item.performed_time_local,
            planned_workout_name=item.planned_workout_name,
            exercises=[
                ExerciseSetsOut(
                    exercise=ExerciseOut.of(found),
                    sets=[PerformedSetOut.of(performed) for performed in group.sets],
                )
                for group in item.exercises
                if (found := exercises[group.exercise_id]) is not None
            ],
        )
        for item in sessions
    ]
