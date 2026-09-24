"""V3.3 over HTTP with the real locked program: change an exercise for one workout only,
discard drafts, macro targets that survive a restart, and the day-by-day History."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from fitness_lab.api.app import create_app
from fitness_lab.domain.models import create_exercise
from fitness_lab.domain.substitutes import ApprovedSubstitute, approved_substitutes
from fitness_lab.storage import db
from fitness_lab.storage.exercises import insert_exercise

PACKAGE = db.REPO_ROOT / "programs" / "advanced-natural-12w" / "package"
PROGRAM_TABLES = ("program_version", "planned_workout", "planned_exercise_slot", "planned_set")


@pytest.fixture
def db_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "v33.db"
    monkeypatch.setenv("FITNESS_LAB_DB", str(path))
    return path


@pytest.fixture
def client(db_file: Path) -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def program_rows(db_file: Path) -> dict[str, list[tuple[object, ...]]]:
    with db.connection_scope(db_file) as connection:
        return {
            table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY id")]
            for table in PROGRAM_TABLES
        }


def open_session(client: TestClient, planned_id: str, day: str) -> dict[str, Any]:
    opened = client.post(f"/api/planned-workouts/{planned_id}/open", json={"performed_on": day})
    assert opened.status_code == 200, opened.text
    entry: dict[str, Any] = client.get(f"/api/workouts/{opened.json()['workout_id']}/entry").json()
    return entry


def slot_named(entry: dict[str, Any], exercise_name: str) -> dict[str, Any]:
    names = {key: value["name"] for key, value in entry["exercises"].items()}
    return next(slot for slot in entry["slots"] if names[slot["exercise_id"]] == exercise_name)


def add_set(client: TestClient, workout_id: str, exercise_id: str, lb: str, reps: int) -> None:
    response = client.post(
        f"/api/workouts/{workout_id}/sets",
        json={"exercise_id": exercise_id, "load_lb": lb, "reps": reps, "rir": 2},
    )
    assert response.status_code == 201, response.text


def complete(client: TestClient, workout_id: str) -> None:
    response = client.post(f"/api/workouts/{workout_id}/complete")
    assert response.status_code == 200, response.text


# --- approved substitutes from the locked notes ------------------------------------------


def test_approved_substitutes_are_read_verbatim_from_the_slot_notes() -> None:
    notes = (
        "Failure: permitted on the final set only.\nRest: 120 s.\n"
        "Approved substitutes: Another Seated/Hip-Flexed Leg Curl, "
        "Lying Leg Curl if unavailable/intolerant."
    )
    assert approved_substitutes(notes) == (
        ApprovedSubstitute("Another Seated/Hip-Flexed Leg Curl", None),
        ApprovedSubstitute("Lying Leg Curl", "if unavailable/intolerant"),
    )
    assert approved_substitutes("Rest: 90 s.") == ()
    assert approved_substitutes(None) == ()


def test_every_locked_slot_offers_its_source_substitutes(
    client: TestClient, locked: dict[str, Any]
) -> None:
    source = json.loads(
        (
            db.REPO_ROOT / "programs/advanced-natural-12w/artifact/locked_workout_program.json"
        ).read_text(encoding="utf-8")
    )["substitution_matrix"]
    entry = open_session(client, locked["planned"]["Lower B"], "2026-10-02")
    thrust = slot_named(entry, "Smith Hip Thrust")
    assert [item["name"] for item in thrust["approved_substitutes"]] == source[
        "Smith/Machine Hip Thrust"
    ]
    curl = slot_named(entry, "Seated Leg Curl")
    assert [(item["name"], item["condition"]) for item in curl["approved_substitutes"]] == [
        ("Another Seated/Hip-Flexed Leg Curl", None),
        ("Lying Leg Curl", "if unavailable/intolerant"),
    ]


# --- change an exercise for this workout only --------------------------------------------


def test_an_approved_substitute_changes_only_this_workout(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    before = program_rows(db_file)
    entry = open_session(client, locked["planned"]["Lower B"], "2026-10-02")
    workout_id = entry["workout"]["id"]
    slot = slot_named(entry, "Smith Hip Thrust")
    assert slot["approved_substitutes"][0] == {
        "name": "Glute Drive",
        "condition": None,
        "exercise_id": None,  # not an exercise identity yet
    }

    changed = client.put(
        f"/api/workouts/{workout_id}/slots/{slot['id']}/approved-substitute",
        json={"name": "Glute Drive"},
    )
    assert changed.status_code == 200, changed.text
    after = slot_named(changed.json(), "Smith Hip Thrust")
    performed = after["effective_exercise_id"]
    assert after["substitute_exercise_id"] == performed
    assert changed.json()["exercises"][performed]["name"] == "Glute Drive"
    assert after["exercise_id"] == slot["exercise_id"]  # the plan still says Hip Thrust
    add_set(client, workout_id, performed, "225", 10)
    complete(client, workout_id)

    # The next Lower B is back on the planned exercise; the program itself never changed.
    following = open_session(client, locked["planned"]["Lower B"], "2026-10-09")
    again = slot_named(following, "Smith Hip Thrust")
    assert again["substitute_exercise_id"] is None
    assert again["effective_exercise_id"] == slot["exercise_id"]
    # The identity now exists, so it is offered by id next time.
    assert again["approved_substitutes"][0]["exercise_id"] == performed
    assert program_rows(db_file) == before
    planned = client.get(f"/api/planned-workouts/{locked['planned']['Lower B']}").json()
    assert [item["exercise_id"] for item in planned["slots"]] == [
        item["exercise_id"] for item in following["slots"]
    ]


def test_any_existing_exercise_can_replace_a_slot_and_the_plan_clears_it(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    before = program_rows(db_file)
    entry = open_session(client, locked["planned"]["Upper A"], "2026-10-05")
    workout_id = entry["workout"]["id"]
    slot = slot_named(entry, "Smith Flat Bench Press")
    other = locked["exercises"]["Incline Converging Machine Press"]
    changed = client.put(
        f"/api/workouts/{workout_id}/slots/{slot['id']}/exercise", json={"exercise_id": other}
    )
    assert changed.status_code == 200, changed.text
    assert slot_named(changed.json(), "Smith Flat Bench Press")["effective_exercise_id"] == other
    # Choosing the planned exercise again undoes the change.
    back = client.put(
        f"/api/workouts/{workout_id}/slots/{slot['id']}/exercise",
        json={"exercise_id": slot["exercise_id"]},
    )
    assert slot_named(back.json(), "Smith Flat Bench Press")["substitute_exercise_id"] is None
    assert program_rows(db_file) == before


def test_only_the_slots_own_approved_substitutes_are_accepted(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    entry = open_session(client, locked["planned"]["Lower B"], "2026-10-02")
    workout_id = entry["workout"]["id"]
    slot = slot_named(entry, "Smith Hip Thrust")
    url = f"/api/workouts/{workout_id}/slots/{slot['id']}/approved-substitute"
    exercises_before = len(client.get("/api/exercises").json())
    assert client.put(url, json={"name": "Hack Squat"}).status_code == 422
    assert client.put(url, json={"name": ""}).status_code == 422
    assert len(client.get("/api/exercises").json()) == exercises_before
    # A retired identity is refused, never revived.
    with db.connection_scope(db_file) as connection:
        retired = create_exercise("Smith Glute Bridge")
        insert_exercise(connection, retired)
        connection.execute("UPDATE exercise SET is_active = 0 WHERE id = ?", (retired.id,))
    assert client.put(url, json={"name": "Smith Glute Bridge"}).status_code == 409
    # A complete workout is reopened before anything changes.
    add_set(client, workout_id, slot["exercise_id"], "135", 10)
    complete(client, workout_id)
    assert client.put(url, json={"name": "Glute Drive"}).status_code == 409


# --- discard -----------------------------------------------------------------------------


def test_discarding_drafts_removes_only_the_workout(
    client: TestClient, locked: dict[str, Any], db_file: Path
) -> None:
    before = program_rows(db_file)
    planned_id = locked["planned"]["Upper B"]
    empty = open_session(client, planned_id, "2026-10-01")["workout"]["id"]
    assert client.delete(f"/api/workouts/{empty}").status_code == 204
    snapshots = db_file.parent / "snapshots"
    assert not snapshots.exists() or not list(snapshots.glob("*pre-discard*"))

    entry = open_session(client, planned_id, "2026-10-01")
    workout_id = entry["workout"]["id"]
    assert workout_id != empty
    add_set(client, workout_id, entry["slots"][0]["exercise_id"], "100", 8)
    assert client.delete(f"/api/workouts/{workout_id}").status_code == 204
    assert len(list(snapshots.glob(f"*pre-discard-workout-{workout_id}.db"))) == 1
    assert client.get(f"/api/workouts/{workout_id}/entry").status_code == 404

    active = client.get("/api/program/active").json()
    upper_b = next(item for item in active["planned_workouts"] if item["id"] == planned_id)
    assert (upper_b["open_draft_id"], upper_b["completed_count"]) == (None, 0)
    assert program_rows(db_file) == before
    assert open_session(client, planned_id, "2026-10-01")["sets"] == []


# --- macro targets survive a restart -------------------------------------------------------


def test_macro_targets_and_their_history_survive_a_restart(db_file: Path) -> None:
    with TestClient(create_app()) as first:
        for day, carbs in (("2026-10-01", 300), ("2026-10-08", 340)):
            response = first.post(
                "/api/nutrition/targets",
                json={"effective_on": day, "protein_g": 150, "carbs_g": carbs, "fat_g": 70},
            )
            assert response.status_code == 201
    with TestClient(create_app()) as second:
        old = second.get("/api/nutrition", params={"date": "2026-10-07"}).json()
        new = second.get("/api/nutrition", params={"date": "2026-10-08"}).json()
    assert (old["target"]["carbs_g"], old["target"]["calories_kcal"]) == (300, 2430)
    assert (new["target"]["carbs_g"], new["target"]["calories_kcal"]) == (340, 2590)
    assert [item["effective_on"] for item in new["target_history"]] == ["2026-10-08", "2026-10-01"]


# --- day-by-day history --------------------------------------------------------------------


def test_history_is_one_entry_per_date_newest_first_with_everything_recorded(
    client: TestClient, locked: dict[str, Any]
) -> None:
    client.post(
        "/api/nutrition/targets",
        json={"effective_on": "2026-09-20", "protein_g": 150, "carbs_g": 300, "fat_g": 70},
    )
    entry = open_session(client, locked["planned"]["Lower B"], "2026-09-24")
    workout_id = entry["workout"]["id"]
    thrust = slot_named(entry, "Smith Hip Thrust")
    client.put(
        f"/api/workouts/{workout_id}/slots/{thrust['id']}/approved-substitute",
        json={"name": "Glute Drive"},
    )
    hack = locked["exercises"]["Hack Squat"]
    add_set(client, workout_id, hack, "44", 3)
    glute = client.get(f"/api/workouts/{workout_id}/entry").json()
    performed = slot_named(glute, "Smith Hip Thrust")["effective_exercise_id"]
    add_set(client, workout_id, performed, "11", 11)
    complete(client, workout_id)
    client.put("/api/bodyweight/2026-09-24", json={"bodyweight_kg": "72.00"})
    client.put("/api/nutrition/2026-09-24", json={"protein_g": 150, "carbs_g": 200, "fat_g": 50})
    client.put("/api/bodyweight/2026-09-23", json={"bodyweight_kg": "71.80"})
    client.put("/api/nutrition/2026-09-22", json={"protein_g": 140})
    # A draft is not history yet.
    open_session(client, locked["planned"]["Upper A"], "2026-09-25")

    body = client.get("/api/history/days").json()
    assert [day["date"] for day in body["days"]] == ["2026-09-24", "2026-09-23", "2026-09-22"]
    assert body["next_before"] is None
    thursday = body["days"][0]
    assert thursday["bodyweight_kg"] == "72"
    assert thursday["nutrition"]["calories_kcal"] == 1850
    assert thursday["nutrition"]["target"]["calories_kcal"] == 2430
    (workout,) = thursday["workouts"]
    assert workout["planned_workout_name"] == "Lower B"
    assert (workout["actual_work_sets"], workout["planned_work_sets"]) == (2, 19)
    assert workout["shortened"] is True
    exercises = {item["exercise"]["name"]: item for item in workout["exercises"]}
    assert exercises["Glute Drive"]["planned_exercise"]["name"] == "Smith Hip Thrust"
    assert exercises["Hack Squat"]["planned_exercise"] is None
    assert [s["load_lb"] for s in exercises["Hack Squat"]["sets"]] == ["44"]
    wednesday, tuesday = body["days"][1], body["days"][2]
    assert (wednesday["workouts"], wednesday["nutrition"], wednesday["bodyweight_kg"]) == (
        [],
        None,
        "71.8",
    )
    assert tuesday["nutrition"]["calories_complete"] is False

    training = client.get("/api/history/days", params={"kind": "training"}).json()
    assert [day["date"] for day in training["days"]] == ["2026-09-24"]
    assert training["days"][0]["bodyweight_kg"] is None
    weights = client.get("/api/history/days", params={"kind": "bodyweight"}).json()
    assert [day["date"] for day in weights["days"]] == ["2026-09-24", "2026-09-23"]
    assert weights["days"][0]["workouts"] == [] and weights["days"][0]["nutrition"] is None
    food = client.get("/api/history/days", params={"kind": "nutrition"}).json()
    assert [day["date"] for day in food["days"]] == ["2026-09-24", "2026-09-22"]

    # Exercise history stays available and names what a substitute replaced.
    glute_history = client.get(f"/api/exercises/{performed}/history").json()
    assert glute_history["exposures"][0]["replaced"]["name"] == "Smith Hip Thrust"


def test_history_pages_by_date(client: TestClient) -> None:
    for day in range(1, 6):
        client.put(f"/api/bodyweight/2026-10-0{day}", json={"bodyweight_kg": "72.00"})
    first = client.get("/api/history/days", params={"limit": 2}).json()
    assert [day["date"] for day in first["days"]] == ["2026-10-05", "2026-10-04"]
    second = client.get(
        "/api/history/days", params={"limit": 2, "before": first["next_before"]}
    ).json()
    assert [day["date"] for day in second["days"]] == ["2026-10-03", "2026-10-02"]
    last = client.get("/api/history/days", params={"limit": 2, "before": "2026-10-02"}).json()
    assert ([day["date"] for day in last["days"]], last["next_before"]) == (["2026-10-01"], None)
    assert client.get("/api/history/days", params={"before": "2026-13-01"}).status_code == 422
    assert client.get("/api/history/days", params={"kind": "sleep"}).status_code == 422
