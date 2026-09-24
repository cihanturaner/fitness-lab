"""Read-only views over recorded training: exercise history, recent sessions, a week.

Evidence is complete workouts' performed sets, read as recorded. No aggregation tables,
no derived numbers: an exposure is one complete workout's sets of one exact exercise in one
planned slot (or as extra work) — two slots performed as the same exercise are two exposures
(V3.3.1, ``domain.placement``).
Workouts are ordered as everywhere else: performed_on, then start time (unknown last),
then entry time, then id.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from fitness_lab.domain.completion import work_set_totals
from fitness_lab.domain.models import Exercise, PerformedSet, Workout
from fitness_lab.domain.placement import group_sets
from fitness_lab.domain.week import SessionFacts
from fitness_lab.storage.entry import recorded_placements, set_facts, slot_facts
from fitness_lab.storage.exercises import get_exercise
from fitness_lab.storage.programs import list_planned_workouts, list_slots
from fitness_lab.storage.workouts import SET_COLUMNS, row_to_performed_set, row_to_workout

CHRONOLOGICAL = (
    "w.performed_on, w.performed_time_local IS NOT NULL, w.performed_time_local, "
    "w.entered_at_utc, w.id"
)
NEWEST_FIRST = (
    "w.performed_on DESC, w.performed_time_local IS NULL, w.performed_time_local DESC, "
    "w.entered_at_utc DESC, w.id DESC"
)


@dataclass(frozen=True, slots=True)
class Exposure:
    workout_id: str
    performed_on: str
    performed_time_local: str | None
    planned_workout_name: str | None
    program_version_id: str | None
    sets: tuple[PerformedSet, ...]
    # The planned slot it was performed in (None: extra work) and, when that slot planned
    # another exercise, the planned one it replaced.
    slot_id: str | None = None
    replaced_exercise_id: str | None = None


@dataclass(frozen=True, slots=True)
class SlotSets:
    """One slot's recorded sets in a workout (``slot_id`` None: extra work)."""

    exercise_id: str
    slot_id: str | None
    # The planned exercise when the slot was performed as another one, else None.
    planned_exercise_id: str | None
    sets: tuple[PerformedSet, ...]


def workout_groups(connection: sqlite3.Connection, workout_id: str) -> tuple[SlotSets, ...]:
    """A workout's sets by planned slot (and extra exercise), in the order trained."""
    sets = [
        row_to_performed_set(item)
        for item in connection.execute(
            f"SELECT {SET_COLUMNS} FROM performed_set WHERE workout_id = ? ORDER BY set_order",
            (workout_id,),
        ).fetchall()
    ]
    origin = connection.execute(
        "SELECT planned_workout_id FROM workout_plan_origin WHERE workout_id = ?", (workout_id,)
    ).fetchone()
    slots = () if origin is None else list_slots(connection, str(origin[0]))
    substitutions = {
        str(row[0]): str(row[1])
        for row in connection.execute(
            "SELECT slot_id, exercise_id FROM workout_slot_substitution WHERE workout_id = ?",
            (workout_id,),
        ).fetchall()
    }
    by_id = {item.id: item for item in sets}
    return tuple(
        SlotSets(
            exercise_id=group.exercise_id,
            slot_id=None if group.slot is None else group.slot.slot_id,
            planned_exercise_id=group.planned_exercise_id,
            sets=tuple(by_id[set_id] for set_id in group.set_ids),
        )
        for group in group_sets(
            slot_facts(slots, substitutions),
            set_facts(sets),
            recorded_placements(connection, workout_id),
        )
    )


@dataclass(frozen=True, slots=True)
class ExerciseHistorySummary:
    exercise: Exercise
    exposures: int
    last_performed_on: str


@dataclass(frozen=True, slots=True)
class ExerciseSets:
    exercise_id: str
    sets: tuple[PerformedSet, ...]
    planned_exercise_id: str | None = None


@dataclass(frozen=True, slots=True)
class RecentSession:
    workout_id: str
    performed_on: str
    performed_time_local: str | None
    planned_workout_name: str | None
    planned_workout_id: str | None
    exercises: tuple[ExerciseSets, ...]


def _opt(value: object) -> str | None:
    return None if value is None else str(value)


def exercise_history(connection: sqlite3.Connection, exercise_id: str) -> tuple[Exposure, ...]:
    """Every complete workout holding this exact exercise, oldest first, with its sets.

    One exposure per slot (or extra work) it was performed in within a workout.
    """
    workouts = connection.execute(
        "SELECT w.id, w.performed_on, w.performed_time_local, pw.name AS planned_name, "
        "pw.program_version_id AS version_id FROM workout w "
        "LEFT JOIN workout_plan_origin o ON o.workout_id = w.id "
        "LEFT JOIN planned_workout pw ON pw.id = o.planned_workout_id "
        "WHERE w.status = 'complete' AND EXISTS (SELECT 1 FROM performed_set s "
        "WHERE s.workout_id = w.id AND s.exercise_id = ?) "
        f"ORDER BY {CHRONOLOGICAL}",
        (exercise_id,),
    ).fetchall()
    exposures: list[Exposure] = []
    for row in workouts:
        for group in workout_groups(connection, str(row["id"])):
            if group.exercise_id != exercise_id:
                continue
            exposures.append(
                Exposure(
                    workout_id=str(row["id"]),
                    performed_on=str(row["performed_on"]),
                    performed_time_local=_opt(row["performed_time_local"]),
                    planned_workout_name=_opt(row["planned_name"]),
                    program_version_id=_opt(row["version_id"]),
                    sets=group.sets,
                    slot_id=group.slot_id,
                    replaced_exercise_id=group.planned_exercise_id,
                )
            )
    return tuple(exposures)


def exercises_with_history(connection: sqlite3.Connection) -> tuple[ExerciseHistorySummary, ...]:
    """Exercises that appear in at least one complete workout, most recently trained first."""
    rows = connection.execute(
        "SELECT s.exercise_id, count(DISTINCT w.id) AS exposures, "
        "max(w.performed_on) AS last_on "
        "FROM performed_set s JOIN workout w ON w.id = s.workout_id "
        "WHERE w.status = 'complete' GROUP BY s.exercise_id "
        "ORDER BY last_on DESC, s.exercise_id"
    ).fetchall()
    summaries: list[ExerciseHistorySummary] = []
    for row in rows:
        exercise = get_exercise(connection, str(row["exercise_id"]))
        if exercise is not None:
            summaries.append(
                ExerciseHistorySummary(
                    exercise=exercise,
                    exposures=int(row["exposures"]),
                    last_performed_on=str(row["last_on"]),
                )
            )
    return tuple(summaries)


def recent_sessions(connection: sqlite3.Connection, *, limit: int) -> tuple[RecentSession, ...]:
    """The latest complete workouts, their sets grouped by slot in the order trained."""
    workouts = connection.execute(
        "SELECT w.id, w.performed_on, w.performed_time_local, pw.name AS planned_name, "
        "o.planned_workout_id FROM workout w "
        "LEFT JOIN workout_plan_origin o ON o.workout_id = w.id "
        "LEFT JOIN planned_workout pw ON pw.id = o.planned_workout_id "
        f"WHERE w.status = 'complete' ORDER BY {NEWEST_FIRST} LIMIT ?",
        (limit,),
    ).fetchall()
    sessions: list[RecentSession] = []
    for row in workouts:
        groups = workout_groups(connection, str(row["id"]))
        sessions.append(
            RecentSession(
                workout_id=str(row["id"]),
                performed_on=str(row["performed_on"]),
                performed_time_local=_opt(row["performed_time_local"]),
                planned_workout_name=_opt(row["planned_name"]),
                planned_workout_id=_opt(row["planned_workout_id"]),
                exercises=tuple(
                    ExerciseSets(
                        exercise_id=group.exercise_id,
                        sets=group.sets,
                        planned_exercise_id=group.planned_exercise_id,
                    )
                    for group in groups
                ),
            )
        )
    return tuple(sessions)


def week_facts(
    connection: sqlite3.Connection, version_id: str, first: str, last: str
) -> dict[str, SessionFacts]:
    """For each planned workout of a version: its open draft and completions in the week."""
    facts: dict[str, SessionFacts] = {}
    for planned in list_planned_workouts(connection, version_id):
        draft = connection.execute(
            "SELECT w.id, w.performed_on FROM workout w "
            "JOIN workout_plan_origin o ON o.workout_id = w.id "
            "WHERE o.planned_workout_id = ? AND w.status = 'draft' "
            "ORDER BY w.entered_at_utc DESC, w.id DESC LIMIT 1",
            (planned.id,),
        ).fetchone()
        completed = connection.execute(
            "SELECT w.id, w.performed_on FROM workout w "
            "JOIN workout_plan_origin o ON o.workout_id = w.id "
            "WHERE o.planned_workout_id = ? AND w.status = 'complete' "
            f"AND w.performed_on BETWEEN ? AND ? ORDER BY {CHRONOLOGICAL}",
            (planned.id, first, last),
        ).fetchall()
        facts[planned.id] = SessionFacts(
            open_draft_id=None if draft is None else str(draft["id"]),
            open_draft_on=None if draft is None else str(draft["performed_on"]),
            completed_in_week=tuple(
                (str(item["id"]), str(item["performed_on"])) for item in completed
            ),
        )
    return facts


def unplanned_between(connection: sqlite3.Connection, first: str, last: str) -> tuple[Workout, ...]:
    """Workouts with no planned origin performed in the date range, chronologically."""
    rows = connection.execute(
        "SELECT w.id, w.performed_on, w.performed_time_local, w.status, w.notes, "
        "w.entered_at_utc, w.updated_at_utc FROM workout w "
        "WHERE NOT EXISTS (SELECT 1 FROM workout_plan_origin o WHERE o.workout_id = w.id) "
        f"AND w.performed_on BETWEEN ? AND ? ORDER BY {CHRONOLOGICAL}",
        (first, last),
    ).fetchall()
    return tuple(row_to_workout(row) for row in rows)


def planned_work_set_count(connection: sqlite3.Connection, planned_workout_id: str) -> int:
    """Non-warm-up planned sets of one planned workout (the prescription's total)."""
    kinds = [
        planned.set_type
        for slot in list_slots(connection, planned_workout_id)
        for planned in slot.sets
    ]
    return work_set_totals(kinds, ()).planned


def work_set_count(connection: sqlite3.Connection, workout_id: str) -> int:
    """Non-warm-up sets recorded in one workout, extra exercises included."""
    rows = connection.execute(
        "SELECT set_type FROM performed_set WHERE workout_id = ?", (workout_id,)
    ).fetchall()
    return work_set_totals((), [None if row[0] is None else str(row[0]) for row in rows]).actual


# --- day timeline (V3.3) -------------------------------------------------------------------

TimelineKind = str  # "training" | "bodyweight" | "nutrition"
TIMELINE_KINDS = ("training", "bodyweight", "nutrition")


@dataclass(frozen=True, slots=True)
class DayExercise:
    """One slot (or extra exercise) of a day's workout; ``planned_exercise_id`` when the slot
    was performed as another exercise."""

    exercise_id: str
    planned_exercise_id: str | None
    sets: tuple[PerformedSet, ...]
    slot_id: str | None = None


@dataclass(frozen=True, slots=True)
class DayWorkout:
    workout_id: str
    performed_time_local: str | None
    planned_workout_id: str | None
    planned_workout_name: str | None
    exercises: tuple[DayExercise, ...]
    # Slots performed as another exercise in this workout: (planned, performed) ids.
    substitutions: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class TimelineDay:
    day: str
    workouts: tuple[DayWorkout, ...]
    bodyweight_g: int | None
    nutrition: tuple[int | None, int | None, int | None] | None  # protein, carbs, fat


def timeline_dates(
    connection: sqlite3.Connection,
    kinds: tuple[TimelineKind, ...],
    *,
    before: str | None,
    limit: int,
) -> tuple[str, ...]:
    """The newest dates (before ``before``, exclusive) holding any of ``kinds``."""
    sources = {
        "training": "SELECT performed_on AS day FROM workout WHERE status = 'complete'",
        "bodyweight": "SELECT measured_on AS day FROM bodyweight_entry",
        "nutrition": "SELECT logged_on AS day FROM nutrition_day",
    }
    union = " UNION ".join(sources[kind] for kind in kinds)
    rows = connection.execute(
        f"SELECT day FROM ({union}) WHERE ? IS NULL OR day < ? ORDER BY day DESC LIMIT ?",
        (before, before, limit),
    ).fetchall()
    return tuple(str(row[0]) for row in rows)


def _day_workouts(connection: sqlite3.Connection, day: str) -> tuple[DayWorkout, ...]:
    rows = connection.execute(
        "SELECT w.id, w.performed_time_local, o.planned_workout_id, pw.name AS planned_name "
        "FROM workout w LEFT JOIN workout_plan_origin o ON o.workout_id = w.id "
        "LEFT JOIN planned_workout pw ON pw.id = o.planned_workout_id "
        f"WHERE w.status = 'complete' AND w.performed_on = ? ORDER BY {CHRONOLOGICAL}",
        (day,),
    ).fetchall()
    workouts: list[DayWorkout] = []
    for row in rows:
        workout_id = str(row["id"])
        substitutions = tuple(
            (str(item["planned"]), str(item["performed"]))
            for item in connection.execute(
                "SELECT ps.exercise_id AS planned, sub.exercise_id AS performed "
                "FROM workout_slot_substitution sub "
                "JOIN planned_exercise_slot ps ON ps.id = sub.slot_id "
                "WHERE sub.workout_id = ? ORDER BY ps.position",
                (workout_id,),
            ).fetchall()
        )
        groups = workout_groups(connection, workout_id)
        workouts.append(
            DayWorkout(
                workout_id=workout_id,
                performed_time_local=_opt(row["performed_time_local"]),
                planned_workout_id=_opt(row["planned_workout_id"]),
                planned_workout_name=_opt(row["planned_name"]),
                exercises=tuple(
                    DayExercise(
                        exercise_id=group.exercise_id,
                        planned_exercise_id=group.planned_exercise_id,
                        sets=group.sets,
                        slot_id=group.slot_id,
                    )
                    for group in groups
                ),
                substitutions=substitutions,
            )
        )
    return tuple(workouts)


def timeline_day(
    connection: sqlite3.Connection, day: str, kinds: tuple[TimelineKind, ...]
) -> TimelineDay:
    """Everything recorded on one civil date, limited to ``kinds``."""
    bodyweight = (
        connection.execute(
            "SELECT bodyweight_g FROM bodyweight_entry WHERE measured_on = ?", (day,)
        ).fetchone()
        if "bodyweight" in kinds
        else None
    )
    nutrition = (
        connection.execute(
            "SELECT protein_g, carbs_g, fat_g FROM nutrition_day WHERE logged_on = ?", (day,)
        ).fetchone()
        if "nutrition" in kinds
        else None
    )

    def grams(value: object) -> int | None:
        return None if value is None else int(str(value))

    return TimelineDay(
        day=day,
        workouts=_day_workouts(connection, day) if "training" in kinds else (),
        bodyweight_g=None if bodyweight is None else int(bodyweight[0]),
        nutrition=None
        if nutrition is None
        else (grams(nutrition[0]), grams(nutrition[1]), grams(nutrition[2])),
    )
