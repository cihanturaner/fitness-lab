"""Completion preconditions, evaluated only on the draft -> complete transition.

The database guarantees what must be true of any row; this module guarantees what must
additionally be true before a workout may be called evidence. reps and set_type block
because a set without them cannot be interpreted; load and RIR only advise, because
forcing a lifter to supply a load they do not remember writes a falsehood into
permanent history.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

from fitness_lab.domain.models import PerformedSet, Workout, WorkoutStatus, utc_now_iso


@dataclass(frozen=True, slots=True)
class CompletionIssue:
    rule: str
    message: str
    set_orders: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class CompletionReport:
    ok: bool
    blockers: tuple[CompletionIssue, ...]
    advisories: tuple[CompletionIssue, ...]
    sets: tuple[PerformedSet, ...]
    renumbered: bool


def renumber_sets(sets: Sequence[PerformedSet]) -> tuple[PerformedSet, ...]:
    """Rule C3's repair: a dense 1..n sequence in the recorded chronological order."""
    ordered = sorted(sets, key=lambda performed: performed.set_order)
    return tuple(
        performed if performed.set_order == position else replace(performed, set_order=position)
        for position, performed in enumerate(ordered, start=1)
    )


def evaluate_completion(sets: Sequence[PerformedSet]) -> CompletionReport:
    """Apply C1-C4 and the advisories. C3 repairs first, then everything is re-verified."""
    ordered = renumber_sets(sets)
    original_positions = [
        performed.set_order for performed in sorted(sets, key=lambda s: s.set_order)
    ]
    renumbered = original_positions != [performed.set_order for performed in ordered]

    blockers: list[CompletionIssue] = []
    advisories: list[CompletionIssue] = []

    if not ordered:
        blockers.append(
            CompletionIssue("C1", "a workout with no sets is not evidence of training", ())
        )

    missing_reps = tuple(performed.set_order for performed in ordered if performed.reps is None)
    if missing_reps:
        blockers.append(
            CompletionIssue("C2", f"sets missing reps: {list(missing_reps)}", missing_reps)
        )

    missing_type = tuple(performed.set_order for performed in ordered if performed.set_type is None)
    if missing_type:
        blockers.append(
            CompletionIssue("C4", f"sets missing set_type: {list(missing_type)}", missing_type)
        )

    missing_load = tuple(performed.set_order for performed in ordered if performed.load_kg is None)
    if missing_load:
        advisories.append(
            CompletionIssue(
                "A-LOAD", f"sets with no recorded load: {list(missing_load)}", missing_load
            )
        )

    missing_rir = tuple(performed.set_order for performed in ordered if performed.rir is None)
    if missing_rir:
        advisories.append(
            CompletionIssue("A-RIR", f"sets with no recorded RIR: {list(missing_rir)}", missing_rir)
        )

    return CompletionReport(
        ok=not blockers,
        blockers=tuple(blockers),
        advisories=tuple(advisories),
        sets=ordered,
        renumbered=renumbered,
    )


def complete_workout(
    workout: Workout, sets: Sequence[PerformedSet], *, now: str | None = None
) -> tuple[Workout, CompletionReport]:
    """Promote draft -> complete when C1-C4 pass. Returns the workout unchanged if not.

    NOT PERSISTED: ``report.sets`` carries C3's renumbering repair computed in memory
    only. This function is pure domain logic and touches no database. A caller that
    promotes this workout to ``complete`` (e.g. via ``storage.workouts.update_workout``)
    MUST ALSO persist the renumbering in the same transaction — call
    ``storage.workouts.renumber_workout_sets`` alongside the status update. Otherwise the
    workout is marked complete while the database still holds the sparse, pre-repair
    ``set_order`` sequence that C3 declared repaired, and the two diverge silently.
    """
    report = evaluate_completion(sets)
    if not report.ok:
        return workout, report
    return (
        replace(
            workout,
            status=WorkoutStatus.COMPLETE,
            updated_at_utc=now if now is not None else utc_now_iso(),
        ),
        report,
    )


def reopen_workout(workout: Workout, *, now: str | None = None) -> Workout:
    """complete -> draft, to correct a record. Always permitted; re-runs nothing."""
    return replace(
        workout,
        status=WorkoutStatus.DRAFT,
        updated_at_utc=now if now is not None else utc_now_iso(),
    )
