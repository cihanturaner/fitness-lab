"""Pure domain entities.

IDs are generated here, not by the database, so a retried write collides on the primary
key instead of creating a duplicate. Loads are kilograms as ``Decimal``; the grams
representation belongs to storage and must never appear in this package.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import uuid4


class WorkoutStatus(StrEnum):
    DRAFT = "draft"
    COMPLETE = "complete"


class SetTypeCode(StrEnum):
    WARMUP = "warmup"
    WORKING = "working"
    BACKOFF = "backoff"


def new_id() -> str:
    """An opaque, immutable, domain-generated identifier."""
    return uuid4().hex


def utc_now_iso() -> str:
    """A system-event timestamp. Training facts use civil time instead."""
    return datetime.now(UTC).isoformat(timespec="seconds")


def normalize_identity(name: str, equipment_label: str | None) -> tuple[str, str]:
    """The same normalization ux_exercise_identity applies: lower(trim(...)), NULL -> ''."""
    label = "" if equipment_label is None else equipment_label
    return name.strip().lower(), label.strip().lower()


@dataclass(frozen=True, slots=True)
class Exercise:
    id: str
    name: str
    equipment_label: str | None
    notes: str | None
    is_active: bool
    created_at_utc: str
    updated_at_utc: str


@dataclass(frozen=True, slots=True)
class Workout:
    id: str
    performed_on: str
    performed_time_local: str | None
    status: WorkoutStatus
    notes: str | None
    entered_at_utc: str
    updated_at_utc: str


@dataclass(frozen=True, slots=True)
class PerformedSet:
    id: str
    workout_id: str
    exercise_id: str
    set_order: int
    set_type: SetTypeCode | None
    load_kg: Decimal | None
    reps: int | None
    rir: int | None
    notes: str | None
    entered_at_utc: str
    updated_at_utc: str


def _validated_name(name: str) -> str:
    if not name.strip():
        raise ValueError("exercise name must not be blank")
    return name


def _validated_label(equipment_label: str | None) -> str | None:
    if equipment_label is not None and not equipment_label.strip():
        raise ValueError("equipment_label must be absent or non-blank, never ''")
    return equipment_label


def create_exercise(
    name: str,
    equipment_label: str | None = None,
    *,
    notes: str | None = None,
    now: str | None = None,
) -> Exercise:
    """Establish a NEW identity. Training on a different machine goes through here."""
    stamp = now if now is not None else utc_now_iso()
    return Exercise(
        id=new_id(),
        name=_validated_name(name),
        equipment_label=_validated_label(equipment_label),
        notes=notes,
        is_active=True,
        created_at_utc=stamp,
        updated_at_utc=stamp,
    )


def rename_exercise(
    exercise: Exercise, name: str, equipment_label: str | None, *, now: str | None = None
) -> Exercise:
    """Correct the labels of an EXISTING identity — a typo, or a more precise label.

    This is never the mechanism for switching machines: that is create_exercise().
    History stays attached because no row anywhere stores an exercise name.
    """
    return replace(
        exercise,
        name=_validated_name(name),
        equipment_label=_validated_label(equipment_label),
        updated_at_utc=now if now is not None else utc_now_iso(),
    )


def deactivate_exercise(exercise: Exercise, *, now: str | None = None) -> Exercise:
    """Retirement, never deletion: history keeps resolving."""
    return replace(
        exercise, is_active=False, updated_at_utc=now if now is not None else utc_now_iso()
    )


def new_draft_workout(
    performed_on: str,
    *,
    performed_time_local: str | None = None,
    notes: str | None = None,
    now: str | None = None,
) -> Workout:
    """Retrospective entry starts here: a date, a draft, and nothing else required."""
    stamp = now if now is not None else utc_now_iso()
    return Workout(
        id=new_id(),
        performed_on=performed_on,
        performed_time_local=performed_time_local,
        status=WorkoutStatus.DRAFT,
        notes=notes,
        entered_at_utc=stamp,
        updated_at_utc=stamp,
    )
