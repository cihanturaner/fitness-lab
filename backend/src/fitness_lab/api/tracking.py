"""V2 routes: the week, bodyweight, nutrition and exercise history.

Same boundary rules as the workout routes: bodyweight kilograms and workout pounds cross as
decimal strings, integers are strict, unknown request fields are refused, and each route
opens its own connection. Dates are civil YYYY-MM-DD strings; ``date`` defaults to the
machine's local day.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator, Sequence
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
from fitness_lab.domain.nutrition import FAT_G_PER_DAY, PROTEIN_G_PER_DAY, day_calories
from fitness_lab.domain.nutrition_controller import classify_trend, qualified_trend
from fitness_lab.domain.units import format_kg, g_to_kg
from fitness_lab.domain.week import (
    WEEKDAYS,
    BlockPhase,
    block_phase,
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
    # The current week: today's phase. Another week: "block" if any of its days is.
    phase: BlockPhase


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
    planned_work_sets: int
    # Non-warm-up sets recorded in the workout shown (None when nothing is shown).
    actual_work_sets: int | None
    # The planned workout's open draft whatever its date: Start resumes it.
    open_draft_id: str | None
    open_draft_on: str | None


class OpenDraftOut(BaseModel):
    """An open draft of a planned workout dated outside the week being shown."""

    workout_id: str
    planned_workout_id: str
    name: str
    performed_on: str
    block_week: int | None


class UnplannedOut(BaseModel):
    workout_id: str
    status: str


class WeekDayOut(BaseModel):
    date: str
    weekday: str
    phase: BlockPhase | None
    sessions: list[WeekSessionOut]
    unplanned: list[UnplannedOut]


class WeekOut(BaseModel):
    date: str
    today: str
    is_current_week: bool
    week_start: str
    week_end: str
    program: ProgramBriefOut | None
    block: BlockOut | None
    days: list[WeekDayOut]
    unscheduled: list[WeekSessionOut]
    open_drafts: list[OpenDraftOut]


@router.get("/api/week")
def week(
    on: OnDate = None, today_text: Annotated[str | None, Query(alias="today")] = None
) -> WeekOut:
    """The Monday-Sunday week containing ``date``; ``today`` says which week is current."""
    shown = _day(on)
    today = _day(today_text)
    monday, sunday = week_bounds(shown)
    first, last = monday.isoformat(), sunday.isoformat()
    days = [
        WeekDayOut(
            date=(monday + timedelta(days=offset)).isoformat(),
            weekday=WEEKDAYS[offset].capitalize(),
            phase=None,
            sessions=[],
            unplanned=[],
        )
        for offset in range(7)
    ]
    unscheduled: list[WeekSessionOut] = []
    open_drafts: list[OpenDraftOut] = []
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
            start_text = programs.get_block_start(connection, version.id)
            start = None if start_text is None else date_from(start_text)
            if start is not None and start_text is not None:
                for day in days:
                    day.phase = block_phase(start, version.duration_weeks, date_from(day.date))
                # The current week reads as today does; any other week is in the block if any
                # of its days is (week 1 of a mid-week start is a block week once viewed later).
                phases = {day.phase for day in days}
                phase: BlockPhase
                if week_bounds(today)[0] == monday:
                    phase = block_phase(start, version.duration_weeks, today)
                elif "block" in phases:
                    phase = "block"
                else:
                    phase = "pre_block" if "pre_block" in phases else "post_block"
                block_out = BlockOut(
                    start_on=start_text,
                    week=block_week(start, shown),
                    weeks=version.duration_weeks,
                    phase=phase,
                )
            facts = history.week_facts(connection, version.id, first, last)
            for planned in programs.list_planned_workouts(connection, version.id):
                slots = programs.list_slots(connection, planned.id)
                fact = facts[planned.id]
                status, workout_id, workout_on = session_status(fact, first, last)
                draft_on = fact.open_draft_on
                if fact.open_draft_id is not None and draft_on is not None and status != "draft":
                    open_drafts.append(
                        OpenDraftOut(
                            workout_id=fact.open_draft_id,
                            planned_workout_id=planned.id,
                            name=planned.name,
                            performed_on=draft_on,
                            block_week=None
                            if start is None
                            else block_week(start, date_from(draft_on)),
                        )
                    )
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
                    planned_work_sets=history.planned_work_set_count(connection, planned.id),
                    actual_work_sets=None
                    if workout_id is None
                    else history.work_set_count(connection, workout_id),
                    open_draft_id=fact.open_draft_id,
                    open_draft_on=fact.open_draft_on,
                )
                index = weekday_index(planned.day_label)
                if index is None:
                    unscheduled.append(item)
                else:
                    days[index].sessions.append(item)
        for workout in history.unplanned_between(connection, first, last):
            offset = (date_from(workout.performed_on) - monday).days
            days[offset].unplanned.append(
                UnplannedOut(workout_id=workout.id, status=workout.status.value)
            )
    return WeekOut(
        date=shown.isoformat(),
        today=today.isoformat(),
        is_current_week=week_bounds(today)[0] == monday,
        week_start=first,
        week_end=last,
        program=program_out,
        block=block_out,
        days=days,
        unscheduled=unscheduled,
        open_drafts=sorted(open_drafts, key=lambda item: item.performed_on),
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


class BodyweightTrendOut(BaseModel):
    """The source's decision metric for display: the 14-day regression, when qualified."""

    window_first: str
    window_last: str
    weigh_ins: int
    first_half: int
    second_half: int
    pct_bw_per_week: str | None
    qualified: bool
    band: str | None


class BodyweightOut(BaseModel):
    entries: list[BodyweightEntryOut]
    summary: BodyweightSummaryOut
    series: list[SeriesPointOut]
    trend: BodyweightTrendOut


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
    trend = qualified_trend(weights, reference, ())
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
        trend=BodyweightTrendOut(
            window_first=trend.window_first.isoformat(),
            window_last=trend.window_last.isoformat(),
            weigh_ins=trend.weigh_ins,
            first_half=trend.first_half,
            second_half=trend.second_half,
            pct_bw_per_week=None if trend.pct is None else str(trend.pct),
            qualified=trend.pct is not None,
            band=None if trend.pct is None else classify_trend(trend.pct),
        ),
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
    """Macros only: a request carrying calories is refused (extra fields are forbidden)."""

    protein_g: StrictCount | None = None
    carbs_g: StrictCount | None = None
    fat_g: StrictCount | None = None
    notes: str | None = None


class MacroTargetIn(RequestModel):
    """A target is grams of protein, carbohydrate and fat; its calories are derived."""

    effective_on: StrictDate
    protein_g: StrictCount
    carbs_g: StrictCount
    fat_g: StrictCount
    notes: str | None = None


class MacroTargetOut(BaseModel):
    id: str
    effective_on: str
    protein_g: int
    carbs_g: int
    fat_g: int
    # Derived: protein x 4 + carbs x 4 + fat x 9. Read-only; never stored.
    calories_kcal: int
    # Pre-V3.3 targets only: the calorie number the lifter recorded then (converted by the
    # source rule protein 145 g, fat 60 g, carbohydrate the remainder).
    legacy_calories_kcal: int | None
    notes: str | None
    set_at_utc: str

    @classmethod
    def of(cls, row: tracking.MacroTargetRow) -> MacroTargetOut:
        return cls(
            id=row.id,
            effective_on=row.effective_on,
            protein_g=row.macros.protein_g,
            carbs_g=row.macros.carbs_g,
            fat_g=row.macros.fat_g,
            calories_kcal=row.macros.calories_kcal,
            legacy_calories_kcal=row.legacy_calories_kcal,
            notes=row.notes,
            set_at_utc=row.set_at_utc,
        )


def target_on(
    targets: Sequence[tracking.MacroTargetRow], day: str
) -> tracking.MacroTargetRow | None:
    """The target in force on ``day`` from a newest-first list (list_macro_targets order)."""
    return next((row for row in targets if row.effective_on <= day), None)


class NutritionDayOut(BaseModel):
    logged_on: str
    # Derived: protein x 4 + carbs x 4 + fat x 9. Read-only; never stored.
    calories_kcal: int
    # False when a macro is unrecorded, so the total covers only the recorded ones.
    calories_complete: bool
    protein_g: int | None
    carbs_g: int | None
    fat_g: int | None
    notes: str | None
    # The target in force on this day — an earlier day keeps the target it had then.
    target: MacroTargetOut | None

    @classmethod
    def of(
        cls, row: tracking.NutritionDayRow, target: tracking.MacroTargetRow | None
    ) -> NutritionDayOut:
        energy = day_calories(protein_g=row.protein_g, carbs_g=row.carbs_g, fat_g=row.fat_g)
        return cls(
            logged_on=row.logged_on,
            calories_kcal=energy.calories_kcal,
            calories_complete=energy.complete,
            protein_g=row.protein_g,
            carbs_g=row.carbs_g,
            fat_g=row.fat_g,
            notes=row.notes,
            target=None if target is None else MacroTargetOut.of(target),
        )


class TargetDefaultsOut(BaseModel):
    """The locked source's protein and fat, offered when a first target is recorded."""

    protein_g: int
    fat_g: int


class NutritionOut(BaseModel):
    date: str
    day: NutritionDayOut | None
    target: MacroTargetOut | None
    defaults: TargetDefaultsOut
    recent: list[NutritionDayOut]
    target_history: list[MacroTargetOut]


@router.get("/api/nutrition")
def nutrition(on: OnDate = None) -> NutritionOut:
    day = _day(on)
    first = day - timedelta(days=RECENT_NUTRITION_DAYS - 1)
    with _connection() as connection, db.transaction(connection):
        logged = tracking.get_nutrition_day(connection, day.isoformat())
        recent = tracking.list_nutrition_days(
            connection, first=first.isoformat(), last=day.isoformat()
        )
        targets = tracking.list_macro_targets(connection)
    current = target_on(targets, day.isoformat())
    return NutritionOut(
        date=day.isoformat(),
        day=None if logged is None else NutritionDayOut.of(logged, current),
        target=None if current is None else MacroTargetOut.of(current),
        defaults=TargetDefaultsOut(protein_g=PROTEIN_G_PER_DAY, fat_g=FAT_G_PER_DAY),
        recent=[
            NutritionDayOut.of(row, target_on(targets, row.logged_on)) for row in reversed(recent)
        ],
        target_history=[MacroTargetOut.of(row) for row in targets],
    )


@router.put("/api/nutrition/{day}")
def put_nutrition(day: str, body: NutritionDayIn) -> NutritionDayOut:
    logged_on = _day(day).isoformat()
    with _connection() as connection:
        row = tracking.put_nutrition_day(
            connection,
            logged_on,
            protein_g=body.protein_g,
            carbs_g=body.carbs_g,
            fat_g=body.fat_g,
            notes=body.notes,
        )
        target = tracking.macro_target_on(connection, logged_on)
    return NutritionDayOut.of(row, target)


@router.delete("/api/nutrition/{day}", status_code=204)
def delete_nutrition(day: str) -> Response:
    with _connection() as connection:
        tracking.delete_nutrition_day(connection, _day(day).isoformat())
    return Response(status_code=204)


@router.post("/api/nutrition/targets", status_code=201)
def add_macro_target(body: MacroTargetIn) -> MacroTargetOut:
    """The lifter's explicit target, effective from its date; earlier days keep theirs."""
    with _connection() as connection:
        row = tracking.add_macro_target(
            connection,
            body.effective_on.isoformat(),
            protein_g=body.protein_g,
            carbs_g=body.carbs_g,
            fat_g=body.fat_g,
            notes=body.notes,
        )
    return MacroTargetOut.of(row)


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
    # When this exercise was performed in place of a planned one in that workout.
    replaced: ExerciseOut | None
    # The planned slot it was performed in (None: extra work). Two slots of one workout
    # performed as this exercise are two exposures.
    slot_id: str | None
    block_week: int | None
    phase: BlockPhase | None
    sets: list[PerformedSetOut]


class ExerciseHistoryOut(BaseModel):
    exercise: ExerciseOut
    block_start_on: str | None
    exposures: list[ExposureOut]


class ExerciseSetsOut(BaseModel):
    exercise: ExerciseOut
    # The planned exercise when its slot was performed as this one, else None.
    planned_exercise: ExerciseOut | None = None
    sets: list[PerformedSetOut]


class RecentSessionOut(BaseModel):
    workout_id: str
    performed_on: str
    performed_time_local: str | None
    planned_workout_name: str | None
    planned_work_sets: int | None
    actual_work_sets: int
    exercises: list[ExerciseSetsOut]


Block = tuple[date, int | None]


def _active_block_start(connection: sqlite3.Connection) -> str | None:
    version = programs.get_active_version(connection)
    return None if version is None else programs.get_block_start(connection, version.id)


def _version_block(connection: sqlite3.Connection, version_id: str | None) -> Block | None:
    """(start, duration) of a version's block; None: the active version's."""
    version = (
        programs.get_active_version(connection)
        if version_id is None
        else programs.get_program_version(connection, version_id)
    )
    if version is None:
        return None
    start = programs.get_block_start(connection, version.id)
    return None if start is None else (date_from(start), version.duration_weeks)


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
        replaced: dict[str, ExerciseOut | None] = {}
        for item in exposures:
            planned_id = item.replaced_exercise_id
            planned = None if planned_id is None else get_exercise(connection, planned_id)
            replaced[planned_id or ""] = None if planned is None else ExerciseOut.of(planned)
        # Each exposure is numbered in the block of its own program version, so activating
        # a later program (or its block) never renumbers earlier training.
        blocks = {
            version_id: _version_block(connection, version_id)
            for version_id in {item.program_version_id for item in exposures}
        }
    shaped: list[ExposureOut] = []
    for item in exposures:
        own = blocks[item.program_version_id]
        performed_on = date_from(item.performed_on)
        shaped.append(
            ExposureOut(
                workout_id=item.workout_id,
                performed_on=item.performed_on,
                performed_time_local=item.performed_time_local,
                planned_workout_name=item.planned_workout_name,
                replaced=replaced[item.replaced_exercise_id or ""],
                slot_id=item.slot_id,
                block_week=None if own is None else block_week(own[0], performed_on),
                phase=None if own is None else block_phase(own[0], own[1], performed_on),
                sets=[PerformedSetOut.of(performed) for performed in item.sets],
            )
        )
    return ExerciseHistoryOut(
        exercise=ExerciseOut.of(exercise), block_start_on=start, exposures=shaped
    )


@router.get("/api/history/recent")
def recent_training(limit: int = 3) -> list[RecentSessionOut]:
    with _connection() as connection, db.transaction(connection):
        sessions = history.recent_sessions(connection, limit=max(1, min(limit, 20)))
        exercises = {
            exercise_id: get_exercise(connection, exercise_id)
            for item in sessions
            for group in item.exercises
            for exercise_id in (group.exercise_id, group.planned_exercise_id)
            if exercise_id is not None
        }
        planned_counts = {
            item.planned_workout_id: history.planned_work_set_count(
                connection, item.planned_workout_id
            )
            for item in sessions
            if item.planned_workout_id is not None
        }
        actual_counts = {
            item.workout_id: history.work_set_count(connection, item.workout_id)
            for item in sessions
        }
    return [
        RecentSessionOut(
            workout_id=item.workout_id,
            performed_on=item.performed_on,
            performed_time_local=item.performed_time_local,
            planned_workout_name=item.planned_workout_name,
            planned_work_sets=None
            if item.planned_workout_id is None
            else planned_counts[item.planned_workout_id],
            actual_work_sets=actual_counts[item.workout_id],
            exercises=[
                ExerciseSetsOut(
                    exercise=ExerciseOut.of(found),
                    planned_exercise=None
                    if group.planned_exercise_id is None
                    or (planned := exercises.get(group.planned_exercise_id)) is None
                    else ExerciseOut.of(planned),
                    sets=[PerformedSetOut.of(performed) for performed in group.sets],
                )
                for group in item.exercises
                if (found := exercises[group.exercise_id]) is not None
            ],
        )
        for item in sessions
    ]


# --- day-by-day history (V3.3) -----------------------------------------------------------


class DayExerciseOut(BaseModel):
    """One planned slot (or extra exercise) of a workout: the performed exercise, and the
    planned one when the slot was performed as another exercise."""

    exercise: ExerciseOut
    # The planned exercise this one replaced in this workout (a substitution), if any.
    planned_exercise: ExerciseOut | None
    # The planned slot (None: extra work); two slots of one exercise stay two entries.
    slot_id: str | None
    sets: list[PerformedSetOut]


class DayWorkoutOut(BaseModel):
    workout_id: str
    performed_time_local: str | None
    planned_workout_name: str | None
    planned_work_sets: int | None
    actual_work_sets: int
    # Fewer non-warm-up sets recorded than planned (totals only, never set by set).
    shortened: bool
    exercises: list[DayExerciseOut]


class DayNutritionOut(BaseModel):
    calories_kcal: int
    calories_complete: bool
    protein_g: int | None
    carbs_g: int | None
    fat_g: int | None
    # The target in force on that date, not today's.
    target: MacroTargetOut | None


class HistoryDayOut(BaseModel):
    date: str
    workouts: list[DayWorkoutOut]
    bodyweight_kg: str | None
    nutrition: DayNutritionOut | None


class HistoryDaysOut(BaseModel):
    days: list[HistoryDayOut]
    # Pass as ?before= to read the next, older page; None when there is nothing older.
    next_before: str | None


HistoryKind = Literal["all", "training", "bodyweight", "nutrition"]


@router.get("/api/history/days")
def history_days(
    kind: HistoryKind = "all",
    before: str | None = None,
    limit: int = 21,
) -> HistoryDaysOut:
    """A newest-first timeline: one entry per date holding training, bodyweight or nutrition.

    Training is complete workouts only; a date shows only what was recorded on it.
    """
    kinds = history.TIMELINE_KINDS if kind == "all" else (kind,)
    before = None if before is None else _day(before).isoformat()
    size = max(1, min(limit, 90))
    with _connection() as connection, db.transaction(connection):
        dates = history.timeline_dates(connection, kinds, before=before, limit=size + 1)
        page = dates[:size]
        days = [history.timeline_day(connection, day, kinds) for day in page]
        targets = tracking.list_macro_targets(connection)
        exercise_ids = {
            exercise_id
            for day in days
            for workout in day.workouts
            for item in workout.exercises
            for exercise_id in (item.exercise_id, item.planned_exercise_id)
            if exercise_id is not None
        }
        exercises = {
            exercise_id: found
            for exercise_id in exercise_ids
            if (found := get_exercise(connection, exercise_id)) is not None
        }
        planned_ids = {
            workout.planned_workout_id
            for day in days
            for workout in day.workouts
            if workout.planned_workout_id is not None
        }
        planned_counts = {
            planned_id: history.planned_work_set_count(connection, planned_id)
            for planned_id in planned_ids
        }
        actual_counts = {
            workout.workout_id: history.work_set_count(connection, workout.workout_id)
            for day in days
            for workout in day.workouts
        }

    def shaped_workout(workout: history.DayWorkout) -> DayWorkoutOut:
        planned = (
            None
            if workout.planned_workout_id is None
            else planned_counts[workout.planned_workout_id]
        )
        actual = actual_counts[workout.workout_id]
        return DayWorkoutOut(
            workout_id=workout.workout_id,
            performed_time_local=workout.performed_time_local,
            planned_workout_name=workout.planned_workout_name,
            planned_work_sets=planned,
            actual_work_sets=actual,
            shortened=planned is not None and actual < planned,
            exercises=[
                DayExerciseOut(
                    exercise=ExerciseOut.of(exercises[item.exercise_id]),
                    planned_exercise=None
                    if item.planned_exercise_id is None or item.planned_exercise_id not in exercises
                    else ExerciseOut.of(exercises[item.planned_exercise_id]),
                    slot_id=item.slot_id,
                    sets=[PerformedSetOut.of(performed) for performed in item.sets],
                )
                for item in workout.exercises
                if item.exercise_id in exercises
            ],
        )

    def shaped_nutrition(day: history.TimelineDay) -> DayNutritionOut | None:
        if day.nutrition is None:
            return None
        protein, carbs, fat = day.nutrition
        energy = day_calories(protein_g=protein, carbs_g=carbs, fat_g=fat)
        target = target_on(targets, day.day)
        return DayNutritionOut(
            calories_kcal=energy.calories_kcal,
            calories_complete=energy.complete,
            protein_g=protein,
            carbs_g=carbs,
            fat_g=fat,
            target=None if target is None else MacroTargetOut.of(target),
        )

    return HistoryDaysOut(
        days=[
            HistoryDayOut(
                date=day.day,
                workouts=[shaped_workout(workout) for workout in day.workouts],
                bodyweight_kg=None if day.bodyweight_g is None else _kg(day.bodyweight_g),
                nutrition=shaped_nutrition(day),
            )
            for day in days
        ],
        next_before=page[-1] if len(dates) > size else None,
    )
