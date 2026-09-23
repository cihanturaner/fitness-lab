"""The Workout Entry HTTP API against a real temporary SQLite file."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from fitness_lab.api.app import create_app
from fitness_lab.storage import db
from fitness_lab.storage.programs import activate_program_version, import_program_package
from program_fixtures import package, seed_exercises

DAY = "2026-10-05"


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
        "exercises": {name: exercise.id for name, exercise in exercises.items()},
        "upper": active["planned_workouts"][0]["id"],
        "lower": active["planned_workouts"][1]["id"],
    }


def count(db_file: Path, table: str) -> int:
    with db.connection_scope(db_file) as connection:
        return int(connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def open_upper(client: TestClient, seeded: dict[str, Any]) -> str:
    response = client.post(
        f"/api/planned-workouts/{seeded['upper']}/open", json={"performed_on": DAY}
    )
    assert response.status_code == 200
    return str(response.json()["workout_id"])


def add(client: TestClient, workout_id: str, exercise_id: str, **fields: object) -> dict[str, Any]:
    body: dict[str, object] = {"exercise_id": exercise_id, "set_type": "working"}
    body |= {"load_kg": "80", "reps": 5, "rir": 2}
    body.update(fields)
    response = client.post(f"/api/workouts/{workout_id}/sets", json=body)
    assert response.status_code == 201, response.text
    return dict(response.json())


# --- program ---------------------------------------------------------------------------


def test_no_active_program(client: TestClient) -> None:
    body = client.get("/api/program/active").json()
    assert body == {
        "version": None,
        "activated_at_utc": None,
        "notes_text": None,
        "planned_workouts": [],
    }


def test_active_program_lists_planned_workouts(client: TestClient, seeded: dict[str, Any]) -> None:
    body = client.get("/api/program/active").json()
    assert body["version"]["name"] == "Test Program"
    assert body["version"]["duration_weeks"] == 12
    planned = body["planned_workouts"]
    assert [(p["workout_key"], p["name"], p["day_label"]) for p in planned] == [
        ("upper_a", "Upper A", "Monday"),
        ("lower_a", "Lower A", "Tuesday"),
    ]
    assert planned[0]["slot_count"] == 3
    assert planned[0]["set_count"] == 4
    assert planned[0]["open_draft_id"] is None
    assert planned[0]["completed_count"] == 0


def test_planned_prescription(client: TestClient, seeded: dict[str, Any]) -> None:
    response = client.get(f"/api/planned-workouts/{seeded['upper']}")
    assert response.status_code == 200
    body = response.json()
    assert body["planned_workout"]["name"] == "Upper A"
    first = body["slots"][0]
    assert first["exercise_id"] == seeded["exercises"]["Bench Press"]
    assert first["sets"][0] == {
        "id": first["sets"][0]["id"],
        "position": 1,
        "set_type": "working",
        "reps_min": 5,
        "reps_max": 8,
        "target_rir_min": 2,
        "target_rir_max": 2,
        "target_load_kg": "82.5",
        "notes": None,
    }
    assert body["exercises"][seeded["exercises"]["Bench Press"]]["name"] == "Bench Press"
    assert client.get("/api/planned-workouts/nope").status_code == 404


# --- open / create ---------------------------------------------------------------------------


def test_open_creates_an_empty_draft_and_resumes(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    first = client.post(f"/api/planned-workouts/{seeded['upper']}/open", json={"performed_on": DAY})
    assert first.status_code == 200
    body = first.json()
    assert body["created"] is True
    assert body["workout"]["status"] == "draft"
    assert body["origin"]["planned_workout_id"] == seeded["upper"]
    assert count(db_file, "performed_set") == 0

    again = client.post(f"/api/planned-workouts/{seeded['upper']}/open", json={}).json()
    assert again["created"] is False
    assert again["workout_id"] == body["workout_id"]
    assert count(db_file, "workout") == 1

    active = client.get("/api/program/active").json()
    assert active["planned_workouts"][0]["open_draft_id"] == body["workout_id"]
    # The draft's own date travels with it, so resuming an older draft is never silent.
    assert active["planned_workouts"][0]["open_draft_performed_on"] == DAY
    assert active["planned_workouts"][1]["open_draft_performed_on"] is None


def test_open_ignores_any_client_supplied_provenance(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    response = client.post(
        f"/api/planned-workouts/{seeded['upper']}/open",
        json={"performed_on": DAY, "planned_workout_id": seeded["lower"]},
    )
    assert response.status_code == 422


def test_open_unknown_is_404_and_bad_date_is_422(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    assert client.post("/api/planned-workouts/nope/open", json={}).status_code == 404
    bad = client.post(
        f"/api/planned-workouts/{seeded['upper']}/open", json={"performed_on": "2026-02-30"}
    )
    assert bad.status_code == 422


def test_unplanned_workout(client: TestClient, seeded: dict[str, Any]) -> None:
    response = client.post(
        "/api/workouts", json={"performed_on": DAY, "performed_time_local": "18:30"}
    )
    assert response.status_code == 201
    workout_id = response.json()["id"]
    entry = client.get(f"/api/workouts/{workout_id}/entry").json()
    assert entry["origin"] is None
    assert entry["slots"] == []
    assert entry["workout"]["performed_time_local"] == "18:30"


# --- entry aggregate and sets ----------------------------------------------------------------


def test_entry_aggregate(client: TestClient, seeded: dict[str, Any]) -> None:
    workout_id = open_upper(client, seeded)
    entry = client.get(f"/api/workouts/{workout_id}/entry").json()
    assert entry["workout"]["id"] == workout_id
    assert entry["origin"]["workout_key"] == "upper_a"
    assert [slot["slot_key"] for slot in entry["slots"]] == [
        "upper_a.01",
        "upper_a.02",
        "upper_a.03",
    ]
    assert entry["slots"][0]["substitute_exercise_id"] is None
    assert entry["slots"][0]["effective_exercise_id"] == seeded["exercises"]["Bench Press"]
    assert entry["sets"] == []
    assert entry["last_performance"][seeded["exercises"]["Bench Press"]] is None
    assert client.get("/api/workouts/nope/entry").status_code == 404


def test_set_lifecycle_over_http(client: TestClient, seeded: dict[str, Any]) -> None:
    workout_id = open_upper(client, seeded)
    bench = seeded["exercises"]["Bench Press"]
    first = add(client, workout_id, bench, load_kg="82.5")
    second = add(client, workout_id, bench)
    third = add(client, workout_id, seeded["exercises"]["Squat"], load_kg=None, reps=None, rir=None)
    assert first["load_kg"] == "82.5"
    assert (first["set_order"], second["set_order"], third["set_order"]) == (1, 2, 3)

    patched = client.patch(f"/api/sets/{first['id']}", json={"reps": 6, "rir": None})
    assert patched.status_code == 200
    assert patched.json()["reps"] == 6 and patched.json()["rir"] is None
    assert patched.json()["load_kg"] == "82.5"

    reordered = client.put(
        f"/api/workouts/{workout_id}/set-order",
        json={"set_ids": [third["id"], first["id"], second["id"]]},
    )
    assert reordered.status_code == 200
    assert [s["id"] for s in reordered.json()] == [third["id"], first["id"], second["id"]]

    assert client.delete(f"/api/sets/{third['id']}").status_code == 204
    entry = client.get(f"/api/workouts/{workout_id}/entry").json()
    assert [(s["id"], s["set_order"]) for s in entry["sets"]] == [
        (first["id"], 1),
        (second["id"], 2),
    ]


@pytest.mark.parametrize(
    "fields",
    [
        {"load_kg": 80},
        {"load_kg": "0.0001"},
        {"load_kg": "-5"},
        {"load_kg": "abc"},
        {"reps": -1},
        {"reps": "5"},
        {"reps": 5.5},
        {"rir": 1.5},
        {"set_type": "amrap"},
        {"extra": 1},
        {"reps": 10**20},
        {"rir": 10**20},
        {"rir": -(10**20)},
        {"load_kg": "1e30"},
        {"load_kg": "1e2"},
        {"load_kg": "1_0"},
        {"load_kg": " 80 "},
        {"load_kg": "99999999999999999999"},
    ],
)
def test_invalid_set_input_is_422(
    client: TestClient, seeded: dict[str, Any], fields: dict[str, Any]
) -> None:
    workout_id = open_upper(client, seeded)
    body = {"exercise_id": seeded["exercises"]["Bench Press"]} | fields
    assert client.post(f"/api/workouts/{workout_id}/sets", json=body).status_code == 422


def test_bad_reorder_is_422_and_unknown_set_is_404(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    workout_id = open_upper(client, seeded)
    only = add(client, workout_id, seeded["exercises"]["Bench Press"])
    assert (
        client.put(f"/api/workouts/{workout_id}/set-order", json={"set_ids": []}).status_code == 422
    )
    assert client.patch("/api/sets/nope", json={"reps": 1}).status_code == 404
    assert client.delete("/api/sets/nope").status_code == 404
    assert only


# --- lifecycle -------------------------------------------------------------------------------


def test_complete_blocked_then_complete_then_reopen(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    workout_id = open_upper(client, seeded)
    blocked = client.post(f"/api/workouts/{workout_id}/complete")
    assert blocked.status_code == 409
    assert [b["rule"] for b in blocked.json()["blockers"]] == ["C1"]

    set_row = add(client, workout_id, seeded["exercises"]["Bench Press"], rir=None)
    done = client.post(f"/api/workouts/{workout_id}/complete")
    assert done.status_code == 200
    assert done.json()["workout"]["status"] == "complete"
    assert [a["rule"] for a in done.json()["advisories"]] == ["A-RIR"]

    locked = client.patch(f"/api/sets/{set_row['id']}", json={"reps": 7})
    assert locked.status_code == 409
    assert client.post(f"/api/workouts/{workout_id}/complete").status_code == 409

    reopened = client.post(f"/api/workouts/{workout_id}/reopen")
    assert reopened.status_code == 200 and reopened.json()["status"] == "draft"
    assert client.patch(f"/api/sets/{set_row['id']}", json={"reps": 7}).status_code == 200


def test_workout_metadata_and_discard(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    workout_id = open_upper(client, seeded)
    patched = client.patch(
        f"/api/workouts/{workout_id}", json={"performed_on": "2026-10-04", "notes": "Gym B"}
    )
    assert patched.status_code == 200
    assert patched.json()["performed_on"] == "2026-10-04"
    assert (
        client.patch(f"/api/workouts/{workout_id}", json={"status": "complete"}).status_code == 422
    )
    assert client.delete(f"/api/workouts/{workout_id}").status_code == 204
    assert count(db_file, "workout") == 0
    assert count(db_file, "workout_plan_origin") == 0


def test_recent_workouts(client: TestClient, seeded: dict[str, Any]) -> None:
    workout_id = open_upper(client, seeded)
    add(client, workout_id, seeded["exercises"]["Bench Press"])
    recent = client.get("/api/workouts").json()
    assert recent[0]["id"] == workout_id
    assert recent[0]["origin_name"] == "Upper A"
    assert recent[0]["set_count"] == 1


# --- substitution and last performance -------------------------------------------------------


def test_substitution_over_http(client: TestClient, seeded: dict[str, Any]) -> None:
    workout_id = open_upper(client, seeded)
    entry = client.get(f"/api/workouts/{workout_id}/entry").json()
    slot_id = entry["slots"][0]["id"]
    squat = seeded["exercises"]["Squat"]

    response = client.put(
        f"/api/workouts/{workout_id}/slots/{slot_id}/exercise", json={"exercise_id": squat}
    )
    assert response.status_code == 200
    slot = response.json()["slots"][0]
    assert slot["substitute_exercise_id"] == squat
    assert slot["effective_exercise_id"] == squat

    cleared = client.put(
        f"/api/workouts/{workout_id}/slots/{slot_id}/exercise",
        json={"exercise_id": seeded["exercises"]["Bench Press"]},
    ).json()
    assert cleared["slots"][0]["substitute_exercise_id"] is None

    lower_entry = client.post(f"/api/planned-workouts/{seeded['lower']}/open", json={}).json()
    foreign = client.put(
        f"/api/workouts/{lower_entry['workout_id']}/slots/{slot_id}/exercise",
        json={"exercise_id": squat},
    )
    assert foreign.status_code == 409


def test_last_performance_over_http(client: TestClient, seeded: dict[str, Any]) -> None:
    bench = seeded["exercises"]["Bench Press"]
    earlier = open_upper(client, seeded)
    add(client, earlier, bench, load_kg="80")
    add(client, earlier, bench, load_kg="82.5")
    assert client.post(f"/api/workouts/{earlier}/complete").status_code == 200

    later = open_upper(client, seeded)
    assert later != earlier
    entry = client.get(f"/api/workouts/{later}/entry").json()
    performance = entry["last_performance"][bench]
    assert performance["workout_id"] == earlier
    assert [s["load_kg"] for s in performance["sets"]] == ["80", "82.5"]

    direct = client.get(f"/api/exercises/{bench}/last-performance").json()
    assert direct["workout_id"] == earlier
    excluded = client.get(
        f"/api/exercises/{bench}/last-performance", params={"exclude_workout_id": earlier}
    )
    assert excluded.json() is None


# --- exercises ---------------------------------------------------------------------------------


def test_exercise_catalogue(client: TestClient, seeded: dict[str, Any]) -> None:
    created = client.post(
        "/api/exercises", json={"name": "Cable Fly", "equipment_label": "Low pulley"}
    )
    assert created.status_code == 201
    names = [(e["name"], e["equipment_label"]) for e in client.get("/api/exercises").json()]
    assert ("Cable Fly", "Low pulley") in names
    duplicate = client.post(
        "/api/exercises", json={"name": " cable fly ", "equipment_label": "LOW PULLEY"}
    )
    assert duplicate.status_code == 409
    assert client.post("/api/exercises", json={"name": "  "}).status_code == 422


@pytest.mark.parametrize("fields", [{"reps": 10**20}, {"load_kg": "1e30"}, {"rir": 10**20}])
def test_huge_values_on_edit_are_422(
    client: TestClient, seeded: dict[str, Any], fields: dict[str, Any]
) -> None:
    workout_id = open_upper(client, seeded)
    row = add(client, workout_id, seeded["exercises"]["Bench Press"])
    assert client.patch(f"/api/sets/{row['id']}", json=fields).status_code == 422


def test_dates_are_strict(client: TestClient, seeded: dict[str, Any]) -> None:
    assert client.post("/api/workouts", json={"performed_on": 0}).status_code == 422
    opened = client.post(f"/api/planned-workouts/{seeded['upper']}/open", json={"performed_on": 0})
    assert opened.status_code == 422


def test_discarding_a_draft_with_sets_keeps_a_snapshot(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    workout_id = open_upper(client, seeded)
    add(client, workout_id, seeded["exercises"]["Bench Press"])
    assert client.post(f"/api/workouts/{workout_id}/complete").status_code == 200
    assert client.post(f"/api/workouts/{workout_id}/reopen").status_code == 200
    assert client.delete(f"/api/workouts/{workout_id}").status_code == 204
    snapshots = list((db_file.parent / "snapshots").glob(f"*-pre-discard-workout-{workout_id}.db"))
    assert len(snapshots) == 1


# --- final council ------------------------------------------------------------------------


def test_last_performance_names_the_session_it_came_from(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    workout_id = open_upper(client, seeded)
    add(client, workout_id, bench)
    assert client.post(f"/api/workouts/{workout_id}/complete").status_code == 200
    body = client.get(f"/api/exercises/{bench}/last-performance").json()
    assert body["planned_workout_name"] == "Upper A"

    unplanned = client.post("/api/workouts", json={"performed_on": "2026-10-06"}).json()["id"]
    add(client, unplanned, bench)
    assert client.post(f"/api/workouts/{unplanned}/complete").status_code == 200
    body = client.get(f"/api/exercises/{bench}/last-performance").json()
    assert body["workout_id"] == unplanned
    assert body["planned_workout_name"] is None


def test_requests_for_a_foreign_host_are_refused(client: TestClient) -> None:
    """DNS rebinding: a page on another origin that resolves to 127.0.0.1 gets nothing."""
    assert client.get("/api/workouts", headers={"host": "evil.example:8000"}).status_code == 400
    assert client.get("/api/workouts", headers={"host": "127.0.0.1:8000"}).status_code == 200
    assert client.get("/api/workouts", headers={"host": "localhost:5173"}).status_code == 200


def test_health_carries_the_launch_identity(db_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FITNESS_LAB_LAUNCH_ID", "launch-123")
    with TestClient(create_app()) as launched:
        assert launched.get("/api/health").json()["launch_id"] == "launch-123"
    monkeypatch.delenv("FITNESS_LAB_LAUNCH_ID")
    with TestClient(create_app()) as plain:
        assert plain.get("/api/health").json()["launch_id"] is None


def test_new_exercise_names_and_labels_are_trimmed(client: TestClient) -> None:
    created = client.post(
        "/api/exercises", json={"name": " Cable Fly ", "equipment_label": "  Low pulley "}
    ).json()
    assert (created["name"], created["equipment_label"]) == ("Cable Fly", "Low pulley")
