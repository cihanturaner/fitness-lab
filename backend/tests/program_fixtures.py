"""Shared builders for program-package and planned-workout tests."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from fitness_lab.domain.models import Exercise, create_exercise
from fitness_lab.domain.program import ProgramPackage, parse_program_package
from fitness_lab.storage.exercises import insert_exercise

EXERCISE_NAMES = ("Bench Press", "Row", "Squat")


def document(program_key: str = "test-program", *, bench_reps_max: int = 8) -> dict[str, Any]:
    """Two sessions. upper_a is A/B/A: Bench, Row, Bench again as a distinct slot."""
    return {
        "format": "fitness-lab.program",
        "format_version": 1,
        "program": {
            "key": program_key,
            "name": "Test Program",
            "version_label": "1.0.0",
            "duration_weeks": 12,
        },
        "workouts": [
            {
                "key": "upper_a",
                "name": "Upper A",
                "day_label": "Monday",
                "slots": [
                    {
                        "key": "upper_a.01",
                        "exercise": {"name": "Bench Press"},
                        "notes": "Marker lift",
                        "sets": [
                            {
                                "set_type": "working",
                                "reps_min": 5,
                                "reps_max": bench_reps_max,
                                "target_rir_min": 2,
                                "target_rir_max": 2,
                                "target_load_kg": "82.5",
                            },
                            {
                                "set_type": "working",
                                "reps_min": 5,
                                "reps_max": bench_reps_max,
                                "target_rir_min": 0,
                                "target_rir_max": 1,
                            },
                        ],
                    },
                    {
                        "key": "upper_a.02",
                        "exercise": {"name": "Row"},
                        "sets": [{"set_type": "working", "reps_min": 10, "reps_max": None}],
                    },
                    {
                        "key": "upper_a.03",
                        "exercise": {"name": "Bench Press"},
                        "sets": [{"set_type": "backoff", "reps_min": 10, "reps_max": 12}],
                    },
                ],
            },
            {
                "key": "lower_a",
                "name": "Lower A",
                "day_label": "Tuesday",
                "slots": [
                    {
                        "key": "lower_a.01",
                        "exercise": {"name": "Squat"},
                        "sets": [{"set_type": "working", "reps_min": 6, "reps_max": 10}],
                    }
                ],
            },
        ],
    }


def encode(doc: object) -> bytes:
    return (json.dumps(doc, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def package(doc: dict[str, Any] | None = None, notes: bytes | None = None) -> ProgramPackage:
    return parse_program_package(encode(doc if doc is not None else document()), notes)


def seed_exercises(
    connection: sqlite3.Connection, names: tuple[str, ...] = EXERCISE_NAMES
) -> dict[str, Exercise]:
    created: dict[str, Exercise] = {}
    for name in names:
        exercise = create_exercise(name)
        insert_exercise(connection, exercise)
        created[name] = exercise
    return created
