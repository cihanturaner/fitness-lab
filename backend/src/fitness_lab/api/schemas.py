"""HTTP request and response models.

Loads cross the boundary as decimal strings ("82.5"), never JSON numbers: a JSON number
becomes a binary float somewhere along the way, which is exactly what M1 §16 forbids.
Integers are strict (``"5"`` and ``5.5`` are refused, not coerced), and unknown request
fields are refused, so a client can never smuggle in state such as provenance.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from typing import Annotated

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)

from fitness_lab.domain.completion import CompletionIssue, CompletionReport
from fitness_lab.domain.models import Exercise, PerformedSet, SetTypeCode, Workout
from fitness_lab.domain.units import format_kg, kg_to_g
from fitness_lab.storage.entry import (
    EntryAggregate,
    EntrySlot,
    LastPerformance,
    Origin,
    PlannedWorkoutUsage,
    WorkoutSummary,
)
from fitness_lab.storage.programs import (
    PlannedSetRow,
    PlannedWorkoutRow,
    ProgramVersionRow,
    SlotRow,
)

TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
LOAD_PATTERN = re.compile(r"^\d+(\.\d{1,3})?$")
# SQLite INTEGER is a signed 64-bit value. These are storage limits, not fitness policy.
INT64_MAX = 2**63 - 1
StrictInt = Annotated[int, Field(strict=True, ge=-INT64_MAX, le=INT64_MAX)]
NonNegativeInt = Annotated[int, Field(strict=True, ge=0, le=INT64_MAX)]
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _iso_date_only(value: object) -> object:
    """Dates cross the boundary as YYYY-MM-DD text; 0 is not 1970-01-01."""
    if value is not None and not (isinstance(value, str) and DATE_PATTERN.match(value)):
        raise ValueError("performed_on must be a YYYY-MM-DD date")
    return value


StrictDate = Annotated[date, BeforeValidator(_iso_date_only)]
NonBlank = Annotated[str, StringConstraints(min_length=1, pattern=r"\S")]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def parse_load(value: str | None) -> Decimal | None:
    """Validate a decimal-string load exactly as storage will convert it.

    Plain digits with at most gram precision only: Decimal() alone would also accept
    exponents ("1e2"), underscores ("1_0") and surrounding spaces.
    """
    if value is None:
        return None
    if not LOAD_PATTERN.match(value):
        raise ValueError(f"load_kg must be a plain decimal like 82.5: {value!r}")
    grams = kg_to_g(value)
    if grams is not None and grams > INT64_MAX:
        raise ValueError(f"load_kg is out of range: {value!r}")
    return Decimal(value)


def _check_time(value: str | None) -> str | None:
    if value is not None and not TIME_PATTERN.match(value):
        raise ValueError("performed_time_local must be HH:MM")
    return value


# --- requests ------------------------------------------------------------------------------


class OpenPlannedIn(RequestModel):
    performed_on: StrictDate | None = None


class CreateWorkoutIn(RequestModel):
    performed_on: StrictDate | None = None
    performed_time_local: str | None = None
    notes: str | None = None

    @field_validator("performed_time_local")
    @classmethod
    def _time(cls, value: str | None) -> str | None:
        return _check_time(value)


class WorkoutPatchIn(RequestModel):
    performed_on: StrictDate | None = None
    performed_time_local: str | None = None
    notes: str | None = None

    @field_validator("performed_time_local")
    @classmethod
    def _time(cls, value: str | None) -> str | None:
        return _check_time(value)


class SetFieldsIn(RequestModel):
    set_type: SetTypeCode | None = None
    load_kg: str | None = None
    reps: NonNegativeInt | None = None
    rir: StrictInt | None = None
    notes: str | None = None

    @field_validator("load_kg")
    @classmethod
    def _load(cls, value: str | None) -> str | None:
        parse_load(value)
        return value


class SetCreateIn(SetFieldsIn):
    exercise_id: str


class SetPatchIn(SetFieldsIn):
    exercise_id: str | None = None


class SetOrderIn(RequestModel):
    set_ids: Annotated[list[str], Field(min_length=1)]


class SlotExerciseIn(RequestModel):
    exercise_id: str


class ExerciseCreateIn(RequestModel):
    name: NonBlank
    equipment_label: NonBlank | None = None
    notes: str | None = None


# --- responses -----------------------------------------------------------------------------


class ExerciseOut(BaseModel):
    id: str
    name: str
    equipment_label: str | None
    notes: str | None
    is_active: bool

    @classmethod
    def of(cls, exercise: Exercise) -> ExerciseOut:
        return cls(
            id=exercise.id,
            name=exercise.name,
            equipment_label=exercise.equipment_label,
            notes=exercise.notes,
            is_active=exercise.is_active,
        )


class WorkoutOut(BaseModel):
    id: str
    performed_on: str
    performed_time_local: str | None
    status: str
    notes: str | None
    entered_at_utc: str
    updated_at_utc: str

    @classmethod
    def of(cls, workout: Workout) -> WorkoutOut:
        return cls(
            id=workout.id,
            performed_on=workout.performed_on,
            performed_time_local=workout.performed_time_local,
            status=workout.status.value,
            notes=workout.notes,
            entered_at_utc=workout.entered_at_utc,
            updated_at_utc=workout.updated_at_utc,
        )


class PerformedSetOut(BaseModel):
    id: str
    workout_id: str
    exercise_id: str
    set_order: int
    set_type: str | None
    load_kg: str | None
    reps: int | None
    rir: int | None
    notes: str | None
    entered_at_utc: str
    updated_at_utc: str

    @classmethod
    def of(cls, performed: PerformedSet) -> PerformedSetOut:
        return cls(
            id=performed.id,
            workout_id=performed.workout_id,
            exercise_id=performed.exercise_id,
            set_order=performed.set_order,
            set_type=None if performed.set_type is None else performed.set_type.value,
            load_kg=format_kg(performed.load_kg),
            reps=performed.reps,
            rir=performed.rir,
            notes=performed.notes,
            entered_at_utc=performed.entered_at_utc,
            updated_at_utc=performed.updated_at_utc,
        )


class OriginOut(BaseModel):
    planned_workout_id: str
    planned_workout_name: str
    workout_key: str
    day_label: str | None
    program_version_id: str
    program_name: str
    version_label: str | None

    @classmethod
    def of(cls, origin: Origin | None) -> OriginOut | None:
        if origin is None:
            return None
        return cls(
            planned_workout_id=origin.planned_workout_id,
            planned_workout_name=origin.planned_workout_name,
            workout_key=origin.workout_key,
            day_label=origin.day_label,
            program_version_id=origin.program_version_id,
            program_name=origin.program_name,
            version_label=origin.version_label,
        )


class PlannedSetOut(BaseModel):
    id: str
    position: int
    set_type: str
    reps_min: int
    reps_max: int | None
    target_rir_min: int | None
    target_rir_max: int | None
    target_load_kg: str | None
    notes: str | None

    @classmethod
    def of(cls, planned: PlannedSetRow) -> PlannedSetOut:
        return cls(
            id=planned.id,
            position=planned.position,
            set_type=planned.set_type,
            reps_min=planned.reps_min,
            reps_max=planned.reps_max,
            target_rir_min=planned.target_rir_min,
            target_rir_max=planned.target_rir_max,
            target_load_kg=format_kg(planned.target_load_kg),
            notes=planned.notes,
        )


class SlotOut(BaseModel):
    id: str
    slot_key: str
    position: int
    exercise_id: str
    notes: str | None
    sets: list[PlannedSetOut]

    @classmethod
    def of(cls, slot: SlotRow) -> SlotOut:
        return cls(
            id=slot.id,
            slot_key=slot.slot_key,
            position=slot.position,
            exercise_id=slot.exercise_id,
            notes=slot.notes,
            sets=[PlannedSetOut.of(planned) for planned in slot.sets],
        )


class EntrySlotOut(SlotOut):
    substitute_exercise_id: str | None
    effective_exercise_id: str

    @classmethod
    def of_entry(cls, entry_slot: EntrySlot) -> EntrySlotOut:
        base = SlotOut.of(entry_slot.slot)
        return cls(
            **base.model_dump(exclude={"sets"}),
            sets=base.sets,
            substitute_exercise_id=entry_slot.substitute_exercise_id,
            effective_exercise_id=entry_slot.effective_exercise_id,
        )


class LastPerformanceOut(BaseModel):
    workout_id: str
    performed_on: str
    performed_time_local: str | None
    planned_workout_name: str | None
    sets: list[PerformedSetOut]

    @classmethod
    def of(cls, performance: LastPerformance | None) -> LastPerformanceOut | None:
        if performance is None:
            return None
        return cls(
            workout_id=performance.workout_id,
            performed_on=performance.performed_on,
            performed_time_local=performance.performed_time_local,
            planned_workout_name=performance.planned_workout_name,
            sets=[PerformedSetOut.of(performed) for performed in performance.sets],
        )


class EntryOut(BaseModel):
    workout: WorkoutOut
    origin: OriginOut | None
    slots: list[EntrySlotOut]
    sets: list[PerformedSetOut]
    exercises: dict[str, ExerciseOut]
    last_performance: dict[str, LastPerformanceOut | None]

    @classmethod
    def of(cls, entry: EntryAggregate) -> EntryOut:
        return cls(
            workout=WorkoutOut.of(entry.workout),
            origin=OriginOut.of(entry.origin),
            slots=[EntrySlotOut.of_entry(slot) for slot in entry.slots],
            sets=[PerformedSetOut.of(performed) for performed in entry.sets],
            exercises={key: ExerciseOut.of(value) for key, value in entry.exercises.items()},
            last_performance={
                key: LastPerformanceOut.of(value) for key, value in entry.last_performance.items()
            },
        )


class ProgramVersionOut(BaseModel):
    id: str
    program_key: str
    name: str
    version_label: str | None
    duration_weeks: int | None
    package_sha256: str
    imported_at_utc: str

    @classmethod
    def of(cls, version: ProgramVersionRow) -> ProgramVersionOut:
        return cls(
            id=version.id,
            program_key=version.program_key,
            name=version.name,
            version_label=version.version_label,
            duration_weeks=version.duration_weeks,
            package_sha256=version.package_sha256,
            imported_at_utc=version.imported_at_utc,
        )


class PlannedWorkoutOut(BaseModel):
    id: str
    workout_key: str
    sequence: int
    name: str
    day_label: str | None
    notes: str | None

    @classmethod
    def of(cls, planned: PlannedWorkoutRow) -> PlannedWorkoutOut:
        return cls(
            id=planned.id,
            workout_key=planned.workout_key,
            sequence=planned.sequence,
            name=planned.name,
            day_label=planned.day_label,
            notes=planned.notes,
        )


class PlannedWorkoutSummaryOut(PlannedWorkoutOut):
    slot_count: int
    set_count: int
    open_draft_id: str | None
    open_draft_performed_on: str | None
    completed_count: int
    last_completed_on: str | None

    @classmethod
    def summarise(
        cls, planned: PlannedWorkoutRow, slots: tuple[SlotRow, ...], usage: PlannedWorkoutUsage
    ) -> PlannedWorkoutSummaryOut:
        return cls(
            **PlannedWorkoutOut.of(planned).model_dump(),
            slot_count=len(slots),
            set_count=sum(len(slot.sets) for slot in slots),
            open_draft_id=usage.open_draft_id,
            open_draft_performed_on=usage.open_draft_performed_on,
            completed_count=usage.completed_count,
            last_completed_on=usage.last_completed_on,
        )


class ActiveProgramOut(BaseModel):
    version: ProgramVersionOut | None
    activated_at_utc: str | None
    notes_text: str | None
    planned_workouts: list[PlannedWorkoutSummaryOut]


class PlannedWorkoutDetailOut(BaseModel):
    planned_workout: PlannedWorkoutOut
    version: ProgramVersionOut
    slots: list[SlotOut]
    exercises: dict[str, ExerciseOut]


class OpenOut(BaseModel):
    workout_id: str
    created: bool
    workout: WorkoutOut
    origin: OriginOut | None


class IssueOut(BaseModel):
    rule: str
    message: str
    set_orders: list[int]

    @classmethod
    def of(cls, issue: CompletionIssue) -> IssueOut:
        return cls(rule=issue.rule, message=issue.message, set_orders=list(issue.set_orders))


class CompleteOut(BaseModel):
    workout: WorkoutOut
    advisories: list[IssueOut]
    renumbered: bool


def completion_body(message: str, report: CompletionReport | None) -> dict[str, object]:
    if report is None:
        return {"detail": message}
    return {
        "detail": message,
        "blockers": [IssueOut.of(issue).model_dump() for issue in report.blockers],
        "advisories": [IssueOut.of(issue).model_dump() for issue in report.advisories],
    }


class WorkoutSummaryOut(WorkoutOut):
    planned_workout_id: str | None
    origin_name: str | None
    set_count: int

    @classmethod
    def summarise(cls, summary: WorkoutSummary) -> WorkoutSummaryOut:
        return cls(
            **WorkoutOut.of(summary.workout).model_dump(),
            planned_workout_id=summary.planned_workout_id,
            origin_name=summary.origin_name,
            set_count=summary.set_count,
        )
