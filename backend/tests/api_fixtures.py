"""HTTP-level fixtures shared by the V2 and V3 API tests (registered from conftest)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from fitness_lab.api.app import create_app
from fitness_lab.domain.models import create_exercise
from fitness_lab.domain.program import parse_program_package
from fitness_lab.storage import db
from fitness_lab.storage.exercises import insert_exercise
from fitness_lab.storage.programs import activate_program_version, import_program_package
from program_fixtures import package, seed_exercises


@pytest.fixture
def db_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "api.db"
    monkeypatch.setenv("FITNESS_LAB_DB", str(path))
    return path


@pytest.fixture
def client(db_file: Path) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def seeded(client: TestClient, db_file: Path) -> dict[str, Any]:
    with db.connection_scope(db_file) as connection:
        exercises = seed_exercises(connection)
        version = import_program_package(connection, package()).version
        activate_program_version(connection, version.id)
    active = client.get("/api/program/active").json()
    return {
        "version": version.id,
        "exercises": {name: exercise.id for name, exercise in exercises.items()},
        "upper": active["planned_workouts"][0]["id"],
        "lower": active["planned_workouts"][1]["id"],
    }


def session(
    client: TestClient, planned_id: str, day: str, sets: list[tuple[str, str, int, int]]
) -> str:
    opened = client.post(f"/api/planned-workouts/{planned_id}/open", json={"performed_on": day})
    workout_id = str(opened.json()["workout_id"])
    for exercise_id, load, reps, rir in sets:
        response = client.post(
            f"/api/workouts/{workout_id}/sets",
            json={
                "exercise_id": exercise_id,
                "set_type": "working",
                "load_lb": load,
                "reps": reps,
                "rir": rir,
            },
        )
        assert response.status_code == 201, response.text
    assert client.post(f"/api/workouts/{workout_id}/complete").status_code == 200
    return workout_id


LOCKED_PACKAGE = db.REPO_ROOT / "programs" / "advanced-natural-12w" / "package"


@pytest.fixture
def locked(client: TestClient, db_file: Path) -> dict[str, Any]:
    """The real locked package, imported and activated exactly as the CLI does."""
    manifest = json.loads((LOCKED_PACKAGE / "exercises.json").read_text(encoding="utf-8"))
    package = parse_program_package(
        (LOCKED_PACKAGE / "program.json").read_bytes(),
        (LOCKED_PACKAGE / "program-notes.md").read_bytes(),
    )
    with db.connection_scope(db_file) as connection:
        for item in manifest["exercises"]:
            insert_exercise(connection, create_exercise(item["name"], item["equipment_label"]))
        version = import_program_package(connection, package).version
        activate_program_version(connection, version.id)
    active = client.get("/api/program/active").json()
    return {
        "version": version.id,
        "planned": {item["name"]: item["id"] for item in active["planned_workouts"]},
        "exercises": {item["name"]: item["id"] for item in client.get("/api/exercises").json()},
    }
