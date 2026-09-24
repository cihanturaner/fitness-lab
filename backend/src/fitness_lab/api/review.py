"""The weekly nutrition review: what the locked controller recommends, and the lifter's choice.

GET never writes. A target changes only through ``POST /api/nutrition/review/decision``
with ``choice = APPLIED``, and only when the recomputed review still says exactly what the
lifter saw (status and delta); anything stale or untimely is refused with 409.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from fitness_lab.api.schemas import RequestModel, StrictDate
from fitness_lab.api.tracking import CENT, OnDate, _day
from fitness_lab.domain.bodyweight import WeightEntry, summarize
from fitness_lab.domain.nutrition import MacroTargets
from fitness_lab.domain.nutrition_controller import (
    DECIDABLE,
    GATE_CHECKS,
    RELIABILITY_CHECKS,
    WEEK_1_2_EXCEPTIONS,
    GateRecord,
    GateResult,
    PriorDecision,
    Review,
    TargetDecision,
    Trend,
    adjustment_dates,
    classify_trend,
    evaluate_review,
    gate_result_allowed,
    qualified_trend,
    target_in_force,
)
from fitness_lab.domain.week import week_bounds
from fitness_lab.storage import controller, db, programs, tracking
from fitness_lab.storage.entry import Conflict

router = APIRouter()

StrictCount = Annotated[int, Field(strict=True)]
StrictBool = Annotated[bool, Field(strict=True)]
DEFAULT_WEEKS = 12


class TrendOut(BaseModel):
    window_first: str
    window_last: str
    weigh_ins: int
    first_half: int
    second_half: int
    pct_bw_per_week: str | None
    reason: str
    band: str | None

    @classmethod
    def of(cls, trend: Trend) -> TrendOut:
        return cls(
            window_first=trend.window_first.isoformat(),
            window_last=trend.window_last.isoformat(),
            weigh_ins=trend.weigh_ins,
            first_half=trend.first_half,
            second_half=trend.second_half,
            pct_bw_per_week=None if trend.pct is None else str(trend.pct),
            reason=trend.reason,
            band=None if trend.pct is None else classify_trend(trend.pct),
        )


class MacrosOut(BaseModel):
    protein_g: int
    carbs_g: int
    fat_g: int
    # Derived: protein x 4 + carbs x 4 + fat x 9.
    calories_kcal: int

    @classmethod
    def of(cls, macros: MacroTargets | None) -> MacrosOut | None:
        if macros is None:
            return None
        return cls(
            protein_g=macros.protein_g,
            carbs_g=macros.carbs_g,
            fat_g=macros.fat_g,
            calories_kcal=macros.calories_kcal,
        )


class DecisionOut(BaseModel):
    id: str
    block_week: int
    decided_on: str
    trend_pct_bw_per_week: str
    weigh_ins: int
    status: str
    recommended_action: str
    recommended_delta_kcal: int | None
    previous_calorie_target_kcal: int
    user_choice: str
    new_calorie_target_kcal: int | None
    new_target: MacrosOut | None
    composition_concern: bool
    notes: str | None
    recorded_at_utc: str

    @classmethod
    def of(cls, row: controller.DecisionRow) -> DecisionOut:
        return cls(
            id=row.id,
            block_week=row.block_week,
            decided_on=row.decided_on,
            trend_pct_bw_per_week=row.trend_pct,
            weigh_ins=row.weigh_ins,
            status=row.status,
            recommended_action=row.recommended_action,
            recommended_delta_kcal=row.recommended_delta_kcal,
            previous_calorie_target_kcal=row.previous_calorie_target_kcal,
            user_choice=row.user_choice,
            new_calorie_target_kcal=None
            if row.new_target is None
            else row.new_target.calories_kcal,
            new_target=MacrosOut.of(row.new_target),
            composition_concern=row.composition_concern,
            notes=row.notes,
            recorded_at_utc=row.recorded_at_utc,
        )


class GateOut(BaseModel):
    id: str
    block_week: int
    decided_on: str
    checks: dict[str, bool]
    result: str
    notes: str | None
    recorded_at_utc: str

    @classmethod
    def of(cls, row: controller.GateRow) -> GateOut:
        return cls(
            id=row.id,
            block_week=row.block_week,
            decided_on=row.decided_on,
            checks=row.checks,
            result=row.result,
            notes=row.notes,
            recorded_at_utc=row.recorded_at_utc,
        )


class ReviewOut(BaseModel):
    phase: str
    block_week: int | None
    week_start: str | None
    week_end: str | None
    trend: TrendOut | None
    status: str
    sustained: bool | None
    decision_due: bool
    already_decided: bool
    next_decision_week: int | None
    next_decision_on: str | None
    recommended_action: str | None
    recommended_delta_kcal: int | None
    current_target_kcal: int | None
    recommended_target_kcal: int | None
    recommended_carbs_g: int | None
    current_macros: MacrosOut | None
    # What Apply records: the current target with carbohydrate moved by the change (source:
    # primary_macro_adjusted = carbohydrate). Shown before the lifter decides.
    recommended_macros: MacrosOut | None
    failed_corrections: int
    note: str | None
    decision: DecisionOut | None

    @classmethod
    def of(cls, review: Review, decision: DecisionOut | None) -> ReviewOut:
        def text(day: date | None) -> str | None:
            return None if day is None else day.isoformat()

        return cls(
            phase=review.phase,
            block_week=review.block_week,
            week_start=text(review.week_start),
            week_end=text(review.week_end),
            trend=None if review.trend is None else TrendOut.of(review.trend),
            status=review.status,
            sustained=review.sustained,
            decision_due=review.decision_due,
            already_decided=review.already_decided,
            next_decision_week=review.next_decision_week,
            next_decision_on=text(review.next_decision_on),
            recommended_action=review.recommended_action,
            recommended_delta_kcal=review.recommended_delta_kcal,
            current_target_kcal=review.current_target_kcal,
            recommended_target_kcal=review.recommended_target_kcal,
            recommended_carbs_g=review.recommended_carbs_g,
            current_macros=MacrosOut.of(review.current_macros),
            recommended_macros=MacrosOut.of(review.recommended_macros),
            failed_corrections=review.failed_corrections,
            note=review.note,
            decision=decision,
        )


class WeekRowOut(BaseModel):
    """One row of the weekly review ledger (source: weekly_review_template)."""

    block_week: int
    week_end: str
    avg7_kg: str | None
    avg7_count: int
    trend: TrendOut
    target_kcal: int | None
    decision: DecisionOut | None


class NutritionReviewOut(BaseModel):
    available: bool
    reason: Literal["no_program", "no_block"] | None
    today: str
    block_start_on: str | None
    weeks_in_block: int | None
    review: ReviewOut | None
    weeks: list[WeekRowOut]
    decisions: list[DecisionOut]
    gates: list[GateOut]
    gate_checks: list[str]
    reliability_checks: list[str]
    week_1_2_exceptions: list[str]


@dataclass(frozen=True, slots=True)
class _Context:
    version_id: str
    start: date
    weeks: int
    entries: list[WeightEntry]
    targets: list[TargetDecision]
    decisions: tuple[controller.DecisionRow, ...]
    gates: tuple[controller.GateRow, ...]
    review: Review


def _context(
    connection: sqlite3.Connection, today: date, composition_concern: bool
) -> _Context | Literal["no_program", "no_block"]:
    version = programs.get_active_version(connection)
    if version is None:
        return "no_program"
    start_text = programs.get_block_start(connection, version.id)
    if start_text is None:
        return "no_block"
    start = date.fromisoformat(start_text)
    weeks = version.duration_weeks or DEFAULT_WEEKS
    first = week_bounds(start)[0] - timedelta(days=35)
    entries = [
        WeightEntry(date.fromisoformat(row.measured_on), row.grams)
        for row in tracking.list_bodyweight(
            connection, first=first.isoformat(), last=today.isoformat()
        )
    ]
    targets = [
        TargetDecision(
            effective_on=date.fromisoformat(row.effective_on),
            macros=row.macros,
            set_at_utc=row.set_at_utc,
        )
        for row in tracking.list_macro_targets(connection)
    ]
    decisions = controller.list_decisions(connection, version.id)
    gates = controller.list_gates(connection, version.id)
    review = evaluate_review(
        block_start=start,
        weeks=weeks,
        today=today,
        entries=entries,
        targets=targets,
        prior=[
            PriorDecision(
                block_week=row.block_week,
                status=row.status,  # type: ignore[arg-type]
                user_choice=row.user_choice,  # type: ignore[arg-type]
                delta_kcal=0
                if row.new_target is None
                else row.new_target.calories_kcal - row.previous_calorie_target_kcal,
            )
            for row in decisions
        ],
        gates=[GateRecord(block_week=row.block_week, result=row.result) for row in gates],  # type: ignore[arg-type]
        composition_concern=composition_concern,
    )
    return _Context(version.id, start, weeks, entries, targets, decisions, gates, review)


def _week_rows(context: _Context) -> list[WeekRowOut]:
    decided = {row.block_week: DecisionOut.of(row) for row in context.decisions}
    last = context.review.block_week or 0
    monday = week_bounds(context.start)[0]
    rows: list[WeekRowOut] = []
    for week in range(last, 0, -1):
        week_end = monday + timedelta(days=7 * week - 1)
        summary = summarize(context.entries, week_end)
        trend = qualified_trend(
            context.entries, week_end, adjustment_dates(context.targets, week_end)
        )
        target = target_in_force(context.targets, week_end)
        rows.append(
            WeekRowOut(
                block_week=week,
                week_end=week_end.isoformat(),
                avg7_kg=None
                if summary.current_avg_kg is None
                else str(summary.current_avg_kg.quantize(CENT, rounding=ROUND_HALF_UP)),
                avg7_count=summary.current_count,
                trend=TrendOut.of(trend),
                target_kcal=None if target is None else target.calories_kcal,
                decision=decided.get(week),
            )
        )
    return rows


@router.get("/api/nutrition/review")
def nutrition_review(
    on: OnDate = None,
    composition_concern: bool = False,
) -> NutritionReviewOut:
    today = _day(on)
    with db.connection_scope() as connection, db.transaction(connection):
        context = _context(connection, today, composition_concern)
    if isinstance(context, str):
        return NutritionReviewOut(
            available=False,
            reason=context,
            today=today.isoformat(),
            block_start_on=None,
            weeks_in_block=None,
            review=None,
            weeks=[],
            decisions=[],
            gates=[],
            gate_checks=list(GATE_CHECKS),
            reliability_checks=list(RELIABILITY_CHECKS),
            week_1_2_exceptions=list(WEEK_1_2_EXCEPTIONS),
        )
    decided = {row.block_week: DecisionOut.of(row) for row in context.decisions}
    current_week = context.review.block_week
    return NutritionReviewOut(
        available=True,
        reason=None,
        today=today.isoformat(),
        block_start_on=context.start.isoformat(),
        weeks_in_block=context.weeks,
        review=ReviewOut.of(
            context.review, None if current_week is None else decided.get(current_week)
        ),
        weeks=_week_rows(context),
        decisions=[DecisionOut.of(row) for row in context.decisions],
        gates=[GateOut.of(row) for row in context.gates],
        gate_checks=list(GATE_CHECKS),
        reliability_checks=list(RELIABILITY_CHECKS),
        week_1_2_exceptions=list(WEEK_1_2_EXCEPTIONS),
    )


class ExpectedMacrosIn(RequestModel):
    protein_g: StrictCount
    carbs_g: StrictCount
    fat_g: StrictCount


class DecisionIn(RequestModel):
    block_week: StrictCount
    choice: Literal["APPLIED", "KEPT"]
    expected_status: str
    expected_delta_kcal: StrictCount | None
    # The target the lifter saw: Apply writes exactly that number or nothing.
    expected_target_kcal: StrictCount | None
    # ... and exactly those macros (a same-calorie change in between is refused too).
    expected_macros: ExpectedMacrosIn | None = None
    composition_concern: StrictBool = False
    notes: str | None = None
    date: StrictDate | None = None


@router.post("/api/nutrition/review/decision", status_code=201)
def record_decision(body: DecisionIn) -> DecisionOut:
    """The lifter's explicit choice on the review they were shown, re-checked first."""
    today = body.date or date.today()
    with db.connection_scope() as connection:
        context = _context(connection, today, body.composition_concern)
        if isinstance(context, str):
            raise Conflict("there is no training block to review")
        review = context.review
        if review.block_week != body.block_week:
            raise Conflict(f"the review now covers week {review.block_week}, not {body.block_week}")
        if not review.decision_due or review.status not in DECIDABLE:
            raise Conflict("no routine decision is due for this week")
        if (review.status, review.recommended_delta_kcal, review.recommended_target_kcal) != (
            body.expected_status,
            body.expected_delta_kcal,
            body.expected_target_kcal,
        ):
            raise Conflict("the review changed since it was shown; reload it")
        assert review.trend is not None and review.trend.pct is not None
        assert review.current_target_kcal is not None and review.recommended_action is not None
        new_target: MacroTargets | None = None
        if body.choice == "APPLIED":
            if not review.recommended_delta_kcal or review.recommended_macros is None:
                raise Conflict("this review recommends no calorie change to apply")
            shown = body.expected_macros
            if (
                shown is not None
                and MacroTargets(
                    protein_g=shown.protein_g, carbs_g=shown.carbs_g, fat_g=shown.fat_g
                )
                != review.recommended_macros
            ):
                raise Conflict("the review changed since it was shown; reload it")
            new_target = review.recommended_macros
        row = controller.record_decision(
            connection,
            program_version_id=context.version_id,
            block_week=body.block_week,
            decided_on=today.isoformat(),
            window_first=review.trend.window_first.isoformat(),
            window_last=review.trend.window_last.isoformat(),
            weigh_ins=review.trend.weigh_ins,
            trend_pct=str(review.trend.pct),
            status=review.status,
            recommended_action=review.recommended_action,
            recommended_delta_kcal=review.recommended_delta_kcal,
            previous_calorie_target_kcal=review.current_target_kcal,
            user_choice=body.choice,
            new_target=new_target,
            composition_concern=body.composition_concern,
            notes=body.notes,
        )
    return DecisionOut.of(row)


class GateIn(RequestModel):
    block_week: StrictCount
    checks: dict[str, StrictBool]
    result: GateResult
    notes: str | None = None
    date: StrictDate | None = None


@router.post("/api/nutrition/review/gate", status_code=201)
def record_gate(body: GateIn) -> GateOut:
    """A diagnostic-gate audit of the week whose review opened the gate."""
    if not gate_result_allowed(body.checks, body.result):
        raise ValueError(
            "answer all nine checks; underfeeding can be confirmed only when tracking, food "
            "logging, restaurant review, weighing protocol and adherence were consistent and "
            "illness or travel did not disrupt the data"
        )
    today = body.date or date.today()
    with db.connection_scope() as connection:
        context = _context(connection, today, False)
        if isinstance(context, str):
            raise Conflict("there is no training block to review")
        review = context.review
        gated = review.status == "DIAGNOSTIC_GATE" or review.failed_corrections >= 2
        if review.block_week != body.block_week or not gated or not review.decision_due:
            raise Conflict("no diagnostic gate is open for this week")
        row = controller.record_gate(
            connection,
            program_version_id=context.version_id,
            block_week=body.block_week,
            decided_on=today.isoformat(),
            checks=body.checks,
            result=body.result,
            notes=body.notes,
        )
    return GateOut.of(row)
