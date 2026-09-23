"""Read-only views over recorded training: exercise history, recent sessions, a week.

Evidence is complete workouts' performed sets, read as recorded. No aggregation tables,
no derived numbers: an exposure is one complete workout's sets of one exact exercise.
Workouts are ordered as everywhere else: performed_on, then start time (unknown last),
then entry time, then id.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from fitness_lab.domain.models import Exercise, PerformedSet, Workout
from fitness_lab.domain.week import SessionFacts
from fitness_lab.storage.exercises import get_exercise
from fitness_lab.storage.programs import list_planned_workouts
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
    sets: tuple[PerformedSet, ...]


@dataclass(frozen=True, slots=True)
class ExerciseHistorySummary:
    exercise: Exercise
    exposures: int
    last_performed_on: str


@dataclass(frozen=True, slots=True)
class ExerciseSets:
    exercise_id: str
    sets: tuple[PerformedSet, ...]


@dataclass(frozen=True, slots=True)
class RecentSession:
    workout_id: str
    performed_on: str
    performed_time_local: str | None
    planned_workout_name: str | None
    exercises: tuple[ExerciseSets, ...]


def _opt(value: object) -> str | None:
    return None if value is None else str(value)


def exercise_history(connection: sqlite3.Connection, exercise_id: str) -> tuple[Exposure, ...]:
    """Every complete workout holding this exact exercise, oldest first, with its sets."""
    workouts = connection.execute(
        "SELECT w.id, w.performed_on, w.performed_time_local, pw.name AS planned_name "
        "FROM workout w "
        "LEFT JOIN workout_plan_origin o ON o.workout_id = w.id "
        "LEFT JOIN planned_workout pw ON pw.id = o.planned_workout_id "
        "WHERE w.status = 'complete' AND EXISTS (SELECT 1 FROM performed_set s "
        "WHERE s.workout_id = w.id AND s.exercise_id = ?) "
        f"ORDER BY {CHRONOLOGICAL}",
        (exercise_id,),
    ).fetchall()
    exposures: list[Exposure] = []
    for row in workouts:
        sets = connection.execute(
            f"SELECT {SET_COLUMNS} FROM performed_set "
            "WHERE workout_id = ? AND exercise_id = ? ORDER BY set_order",
            (str(row["id"]), exercise_id),
        ).fetchall()
        exposures.append(
            Exposure(
                workout_id=str(row["id"]),
                performed_on=str(row["performed_on"]),
                performed_time_local=_opt(row["performed_time_local"]),
                planned_workout_name=_opt(row["planned_name"]),
                sets=tuple(row_to_performed_set(item) for item in sets),
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
    """The latest complete workouts, their sets grouped by exercise in the order trained."""
    workouts = connection.execute(
        "SELECT w.id, w.performed_on, w.performed_time_local, pw.name AS planned_name "
        "FROM workout w "
        "LEFT JOIN workout_plan_origin o ON o.workout_id = w.id "
        "LEFT JOIN planned_workout pw ON pw.id = o.planned_workout_id "
        f"WHERE w.status = 'complete' ORDER BY {NEWEST_FIRST} LIMIT ?",
        (limit,),
    ).fetchall()
    sessions: list[RecentSession] = []
    for row in workouts:
        grouped: dict[str, list[PerformedSet]] = {}
        for item in connection.execute(
            f"SELECT {SET_COLUMNS} FROM performed_set WHERE workout_id = ? ORDER BY set_order",
            (str(row["id"]),),
        ).fetchall():
            performed = row_to_performed_set(item)
            grouped.setdefault(performed.exercise_id, []).append(performed)
        sessions.append(
            RecentSession(
                workout_id=str(row["id"]),
                performed_on=str(row["performed_on"]),
                performed_time_local=_opt(row["performed_time_local"]),
                planned_workout_name=_opt(row["planned_name"]),
                exercises=tuple(
                    ExerciseSets(exercise_id=key, sets=tuple(value))
                    for key, value in grouped.items()
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
