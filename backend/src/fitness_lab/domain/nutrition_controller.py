"""The locked nutrition controller: decision support, never an actor.

Authoritative source: ``programs/advanced-natural-12w-nutrition/artifact/
locked_nutrition_tracker.json`` (``controller_rules``, ``controller_timing``,
``measurement_protocol.trend_method``, ``diagnostic_gate``). Everything here is pure: it
reads bodyweights, the lifter's macro targets and earlier review decisions and says what the
plan recommends. It cannot store anything; a target changes only when the lifter explicitly
applies a recommendation (``automatic_apply: false`` on every rule). A recommendation is in
calories; the source adjusts carbohydrate for it (``primary_macro_adjusted``), so the
proposed target keeps protein and fat and moves carbohydrate by the change / 4 kcal per gram,
rounded half-up to whole grams (+150 kcal -> +38 g, -100 kcal -> -25 g).

Three rules are not defined by the source and are fixed here as APP CHOICES, consistent for
the whole block (the source locks estimator consistency, not the estimator):

- a qualified 14-day trend needs at least ``MIN_WEIGH_INS_PER_HALF`` weigh-ins in each
  7-day half of the window;
- over-gain is *sustained* when this review week's and the previous week's qualified trends
  both round above the band, the previous week being week 3 or later;
- underfeeding may be confirmed at the diagnostic gate only when every input check says the
  data is reliable (``RELIABILITY_CHECKS`` true, ``illness_travel`` false).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, localcontext
from fractions import Fraction
from typing import Literal

from fitness_lab.domain.bodyweight import WeightEntry
from fitness_lab.domain.nutrition import (
    KCAL_PER_G_CARBOHYDRATE,
    MacroTargets,
    check_calorie_target,
)
from fitness_lab.domain.week import block_phase, week_bounds

# Quoted from the source.
BAND_MIN = Decimal("0.10")  # controller_rules UNDER_GAIN / IN_RANGE
BAND_MAX = Decimal("0.25")  # controller_rules IN_RANGE / OVER_GAIN
VERY_RAPID = Decimal("0.30")  # VERY_RAPID_GAIN_WITH_COMPOSITION_CONCERN
UNDER_GAIN_DELTA_KCAL = 150
OVER_GAIN_DELTA_KCAL = -100
STARTING_DELTA_KCAL = 150  # starting_controller_rule: recent_stable_intake_plus_150
TREND_WINDOW_DAYS = 14  # trend_method.default: 14_day_linear_regression
FIRST_DECISION_WEEK = 3  # first_routine_decision: end_of_week_3
DECISION_INTERVAL_WEEKS = 2  # subsequent_decision_interval_days_approx: 14
FAILED_CORRECTIONS_FOR_GATE = 2  # diagnostic_gate.trigger
WEEK_1_2_EXCEPTIONS = (
    "GI intolerance",
    "obvious logging error",
    "illness",
    "clearly falling trend",
    "implementation mistake",
)
GATE_CHECKS = (
    "tracking_method_consistent",
    "food_logging_consistent",
    "restaurant_unlogged_intake_reviewed",
    "weighing_protocol_consistent",
    "activity_NEAT_changed",
    "training_workload_changed",
    "sleep_recovery_changed",
    "illness_travel",
    "adherence_consistent",
)
# APP CHOICES (see the module docstring).
MIN_WEIGH_INS_PER_HALF = 6
RELIABILITY_CHECKS = (
    "tracking_method_consistent",
    "food_logging_consistent",
    "restaurant_unlogged_intake_reviewed",
    "weighing_protocol_consistent",
    "adherence_consistent",
)

Status = Literal[
    "INSUFFICIENT_DATA",
    "UNDER_GAIN",
    "IN_RANGE",
    "OVER_GAIN",
    "DIAGNOSTIC_GATE",
    "COMPOSITION_REASSESSMENT",
    "UNKNOWN",
]
Action = Literal[
    "ADD_CALORIES",
    "NO_CHANGE",
    "REDUCE_CALORIES",
    "STRONGER_REASSESSMENT",
    "AUDIT_BEFORE_CONTINUING",
    "FIX_INPUT_PROBLEM_FIRST",
]
Choice = Literal["APPLIED", "KEPT"]
GateResult = Literal["GENUINE_UNDERFEEDING_CONFIRMED", "INPUTS_UNRELIABLE"]
GATE_RESULTS: tuple[GateResult, ...] = ("GENUINE_UNDERFEEDING_CONFIRMED", "INPUTS_UNRELIABLE")
TrendReason = Literal["OK", "TOO_FEW_WEIGH_INS", "WAITING_FOR_NEW_TREND"]
ReviewPhase = Literal["pre_block", "early", "decision", "post_block"]
# Statuses a lifter may record a decision on; the others have nothing to decide.
DECIDABLE: frozenset[str] = frozenset(
    {"UNDER_GAIN", "IN_RANGE", "OVER_GAIN", "DIAGNOSTIC_GATE", "COMPOSITION_REASSESSMENT"}
)
CENT = Decimal("0.01")


@dataclass(frozen=True, slots=True)
class TargetDecision:
    """One recorded target, effective from ``effective_on``."""

    effective_on: date
    macros: MacroTargets
    set_at_utc: str

    @property
    def calories_kcal(self) -> int:
        return self.macros.calories_kcal


@dataclass(frozen=True, slots=True)
class PriorDecision:
    """A review decision the lifter recorded (``delta_kcal`` 0 when kept)."""

    block_week: int
    status: Status
    user_choice: Choice
    delta_kcal: int


@dataclass(frozen=True, slots=True)
class GateRecord:
    block_week: int
    result: GateResult


@dataclass(frozen=True, slots=True)
class Trend:
    window_first: date
    window_last: date
    weigh_ins: int
    first_half: int
    second_half: int
    # % bodyweight per week, rounded half-up to 0.01; None when not qualified.
    pct: Decimal | None
    reason: TrendReason


@dataclass(frozen=True, slots=True)
class Review:
    """The plan's reading of the last finished block week, and what it recommends."""

    phase: ReviewPhase
    block_week: int | None
    week_start: date | None
    week_end: date | None
    trend: Trend | None
    status: Status
    sustained: bool | None
    decision_due: bool
    already_decided: bool
    next_decision_week: int | None
    next_decision_on: date | None
    recommended_action: Action | None
    recommended_delta_kcal: int | None
    current_target_kcal: int | None
    recommended_target_kcal: int | None
    recommended_carbs_g: int | None
    current_macros: MacroTargets | None
    # What Apply would record: the current target with carbohydrate moved by the change.
    recommended_macros: MacroTargets | None
    failed_corrections: int
    note: str | None


# --- starting rule and targets ------------------------------------------------------------


def starting_target(recent_stable_intake_kcal: int) -> int:
    """The source's starting rule: recent stable intake + 150 (never an invented TDEE)."""
    return check_calorie_target(recent_stable_intake_kcal + STARTING_DELTA_KCAL)


def adjust_carbohydrate(current: MacroTargets, delta_kcal: int) -> MacroTargets | None:
    """The source's adjustment: protein and fat kept, carbohydrate moved by delta / 4.

    None when the change would take carbohydrate below zero.
    """
    grams = (Decimal(delta_kcal) / KCAL_PER_G_CARBOHYDRATE).quantize(
        Decimal(1), rounding=ROUND_HALF_UP
    )
    carbs = current.carbs_g + int(grams)
    if carbs < 0:
        return None
    return MacroTargets(protein_g=current.protein_g, carbs_g=carbs, fat_g=current.fat_g)


def _ordered(targets: Sequence[TargetDecision]) -> list[TargetDecision]:
    return sorted(targets, key=lambda item: (item.effective_on, item.set_at_utc))


def target_in_force(targets: Sequence[TargetDecision], day: date) -> TargetDecision | None:
    """The latest decision effective on or before ``day`` (ties: the latest recorded)."""
    found = [item for item in _ordered(targets) if item.effective_on <= day]
    return found[-1] if found else None


def _value_on(targets: Sequence[TargetDecision], day: date) -> int | None:
    found = target_in_force(targets, day)
    return None if found is None else found.calories_kcal


def adjustment_dates(targets: Sequence[TargetDecision], day: date) -> list[date]:
    """Every date up to ``day`` on which the calorie target in force changed, ascending."""
    return [
        effective
        for effective in sorted({item.effective_on for item in targets if item.effective_on <= day})
        if _value_on(targets, effective) != _value_on(targets, effective - timedelta(days=1))
    ]


def latest_adjustment_on(targets: Sequence[TargetDecision], day: date) -> date | None:
    """The latest date up to ``day`` on which the calorie target in force changed."""
    found = adjustment_dates(targets, day)
    return found[-1] if found else None


# --- trend --------------------------------------------------------------------------------


def trend_pct(entries: Sequence[WeightEntry]) -> Decimal:
    """Least-squares slope of the weigh-ins as % bodyweight per week (exact, then rounded).

    % BW/week = slope (g/day) x 7 / mean weight (g) x 100, rounded half-up to 0.01.
    """
    if len(entries) < 2:
        raise ValueError("a trend needs at least two weigh-ins")
    origin = min(entry.measured_on for entry in entries)
    xs = [Fraction((entry.measured_on - origin).days) for entry in entries]
    ys = [Fraction(entry.grams) for entry in entries]
    mean_x = sum(xs, Fraction(0)) / len(xs)
    mean_y = sum(ys, Fraction(0)) / len(ys)
    spread = sum(((x - mean_x) ** 2 for x in xs), Fraction(0))
    if spread == 0:
        raise ValueError("a trend needs weigh-ins on at least two different days")
    slope = sum(((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True)), Fraction(0))
    pct = slope / spread * 7 / mean_y * 100
    with localcontext() as context:
        context.prec = 40
        exact = Decimal(pct.numerator) / Decimal(pct.denominator)
    return exact.quantize(CENT, rounding=ROUND_HALF_UP)


def qualified_trend(
    entries: Sequence[WeightEntry], window_last: date, adjustments: Sequence[date]
) -> Trend:
    """The 14-day trend ending on ``window_last``, or why it does not qualify.

    Weigh-ins are taken in the morning before food, so a target effective on day D moves only
    the weights after D. A window with an adjustment strictly inside it mixes two targets and
    does not qualify (after_any_adjustment: wait for a new qualified trend); one starting on
    the adjustment day is the new trend, one ending on it is still wholly the old one.
    """
    first = window_last - timedelta(days=TREND_WINDOW_DAYS - 1)
    middle = first + timedelta(days=TREND_WINDOW_DAYS // 2)
    inside = [entry for entry in entries if first <= entry.measured_on <= window_last]
    first_half = sum(1 for entry in inside if entry.measured_on < middle)
    second_half = len(inside) - first_half

    def shaped(pct: Decimal | None, reason: TrendReason) -> Trend:
        return Trend(first, window_last, len(inside), first_half, second_half, pct, reason)

    if any(first < adjusted < window_last for adjusted in adjustments):
        return shaped(None, "WAITING_FOR_NEW_TREND")
    if min(first_half, second_half) < MIN_WEIGH_INS_PER_HALF:
        return shaped(None, "TOO_FEW_WEIGH_INS")
    return shaped(trend_pct(inside), "OK")


def classify_trend(pct: Decimal) -> Status:
    """The band of a (rounded) qualified trend: under, in range, or over."""
    if pct < BAND_MIN:
        return "UNDER_GAIN"
    if pct <= BAND_MAX:
        return "IN_RANGE"
    return "OVER_GAIN"


# --- diagnostic gate ----------------------------------------------------------------------


def failed_under_gain_corrections(prior: Sequence[PriorDecision], *, current_is_under: bool) -> int:
    """Applied +150 corrections that were followed by under-gain again, consecutively.

    An in-range or over-gain decision resets the count; a kept under-gain decision is not a
    correction. The review being evaluated counts as one more follower when it is under.
    """
    count = 0
    previous_applied_increase = False
    for item in sorted(prior, key=lambda decision: decision.block_week):
        if item.status in ("UNDER_GAIN", "DIAGNOSTIC_GATE"):
            if previous_applied_increase:
                count += 1
            previous_applied_increase = item.user_choice == "APPLIED" and item.delta_kcal > 0
        elif item.status in ("IN_RANGE", "OVER_GAIN", "COMPOSITION_REASSESSMENT"):
            count = 0
            previous_applied_increase = False
    if current_is_under and previous_applied_increase:
        count += 1
    return count


def gate_result_allowed(checks: Mapping[str, bool], result: str) -> bool:
    """Every check answered; underfeeding confirmable only on reliable inputs (APP CHOICE)."""
    if result not in GATE_RESULTS or set(checks) != set(GATE_CHECKS):
        return False
    if result == "INPUTS_UNRELIABLE":
        return True
    return all(checks[name] for name in RELIABILITY_CHECKS) and not checks["illness_travel"]


# --- the review ---------------------------------------------------------------------------


def _week_end(week1_monday: date, week: int) -> date:
    return week1_monday + timedelta(days=7 * week - 1)


def evaluate_review(
    *,
    block_start: date,
    weeks: int,
    today: date,
    entries: Sequence[WeightEntry],
    targets: Sequence[TargetDecision],
    prior: Sequence[PriorDecision],
    gates: Sequence[GateRecord],
    composition_concern: bool = False,
) -> Review:
    """Read the last finished block week the way the locked controller does.

    ``gates`` are in the order they were recorded; ``composition_concern`` is the lifter's
    own report (waist or photos worse), used only above ``VERY_RAPID``.
    """
    week1_monday = week_bounds(block_start)[0]
    finished = ((today - week1_monday).days + 1) // 7
    phase_today = block_phase(block_start, weeks, today)
    decided = {item.block_week for item in prior}
    last_decided = max(decided, default=None)
    current = target_in_force(targets, today)
    current_kcal = None if current is None else current.calories_kcal

    def next_week_after(week: int | None) -> int | None:
        candidate = FIRST_DECISION_WEEK
        if last_decided is not None:
            candidate = max(candidate, last_decided + DECISION_INTERVAL_WEEKS)
        if week is not None:
            candidate = max(candidate, week + 1)
        return candidate if candidate <= weeks else None

    if phase_today == "pre_block" or finished < 1:
        upcoming = next_week_after(None)
        return Review(
            phase="pre_block" if phase_today == "pre_block" else "early",
            block_week=None,
            week_start=None,
            week_end=None,
            trend=None,
            status="UNKNOWN" if current is None else "INSUFFICIENT_DATA",
            sustained=None,
            decision_due=False,
            already_decided=False,
            next_decision_week=upcoming,
            next_decision_on=None if upcoming is None else _week_end(week1_monday, upcoming),
            recommended_action=None,
            recommended_delta_kcal=None,
            current_target_kcal=current_kcal,
            recommended_target_kcal=None,
            recommended_carbs_g=None,
            current_macros=None if current is None else current.macros,
            recommended_macros=None,
            failed_corrections=0,
            note=None if current is not None else "No macro target recorded yet.",
        )

    week = min(finished, weeks)
    week_end = _week_end(week1_monday, week)
    adjustments = adjustment_dates(targets, today)
    trend = qualified_trend(entries, week_end, adjustments)
    already = week in decided
    # The week-12 review stays open until week 13 has finished, like any other review week.
    post = finished > weeks
    early = week < FIRST_DECISION_WEEK
    interval_ok = last_decided is None or week >= last_decided + DECISION_INTERVAL_WEEKS
    # A target changed on or after the week's Sunday was decided without this review; a
    # routine decision now would compound it, so the next one waits for a new trend.
    changed_since = not already and any(adjusted >= week_end for adjusted in adjustments)
    due = not post and not early and not already and interval_ok and not changed_since

    status: Status
    sustained: bool | None = None
    action: Action | None = None
    delta: int | None = None
    notes: list[str] = []
    failed = 0
    if current is None:
        status = "UNKNOWN"
        notes.append("No macro target recorded yet.")
    elif trend.pct is None:
        status = "INSUFFICIENT_DATA"
    else:
        band = classify_trend(trend.pct)
        if band == "UNDER_GAIN":
            failed = failed_under_gain_corrections(prior, current_is_under=True)
            # The latest audit recorded for this review week decides (an audit may be redone).
            gate = next((item for item in reversed(gates) if item.block_week == week), None)
            if failed < FAILED_CORRECTIONS_FOR_GATE or (
                gate is not None and gate.result == "GENUINE_UNDERFEEDING_CONFIRMED"
            ):
                status, action, delta = "UNDER_GAIN", "ADD_CALORIES", UNDER_GAIN_DELTA_KCAL
            else:
                status, delta = "DIAGNOSTIC_GATE", None
                action = (
                    "FIX_INPUT_PROBLEM_FIRST"
                    if gate is not None and gate.result == "INPUTS_UNRELIABLE"
                    else "AUDIT_BEFORE_CONTINUING"
                )
        elif band == "IN_RANGE":
            status, action, delta = "IN_RANGE", "NO_CHANGE", 0
        elif trend.pct > VERY_RAPID and composition_concern:
            status, action, delta = "COMPOSITION_REASSESSMENT", "STRONGER_REASSESSMENT", None
        else:
            status = "OVER_GAIN"
            previous = qualified_trend(entries, week_end - timedelta(days=7), adjustments)
            sustained = (
                week - 1 >= FIRST_DECISION_WEEK
                and previous.pct is not None
                and previous.pct > BAND_MAX
            )
            if sustained:
                action, delta = "REDUCE_CALORIES", OVER_GAIN_DELTA_KCAL
            else:
                action, delta = "NO_CHANGE", 0
                notes.append("Above the band once; a reduction needs a sustained trend.")

    if changed_since:
        notes.append(
            "The calorie target changed after this week ended; the next routine decision waits "
            "for a new qualified trend."
        )
    if status not in DECIDABLE:
        due = False
    if early:
        notes.append(
            "Weeks 1-2: no routine bodyweight-driven changes (glycogen, water and gut content "
            "distort the scale). Exceptions: " + ", ".join(WEEK_1_2_EXCEPTIONS) + "."
        )
    if not due:
        action, delta = None, None
    recommended: MacroTargets | None = None
    if due and current is not None and delta is not None:
        recommended = adjust_carbohydrate(current.macros, delta)
    upcoming = None if post else (next_week_after(week) if not due else week)
    return Review(
        phase="post_block" if post else "early" if early else "decision",
        block_week=week,
        week_start=week_end - timedelta(days=6),
        week_end=week_end,
        trend=trend,
        status=status,
        sustained=sustained,
        decision_due=due,
        already_decided=already,
        next_decision_week=upcoming,
        next_decision_on=None if upcoming is None else _week_end(week1_monday, upcoming),
        recommended_action=action,
        recommended_delta_kcal=delta,
        current_target_kcal=current_kcal,
        recommended_target_kcal=None if recommended is None else recommended.calories_kcal,
        recommended_carbs_g=None if recommended is None else recommended.carbs_g,
        current_macros=None if current is None else current.macros,
        recommended_macros=recommended,
        failed_corrections=failed,
        note=" ".join(notes) if notes else None,
    )
