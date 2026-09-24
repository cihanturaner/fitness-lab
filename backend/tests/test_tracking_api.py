"""V2 HTTP API: week, bodyweight, nutrition and history, against a real SQLite file."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api_fixtures import session
from fitness_lab.storage import db
from fitness_lab.storage.programs import set_block_start

# --- week -----------------------------------------------------------------------------


def test_week_without_a_program(client: TestClient) -> None:
    body = client.get("/api/week", params={"date": "2026-09-23"}).json()
    assert body["program"] is None
    assert body["block"] is None
    assert (body["week_start"], body["week_end"]) == ("2026-09-21", "2026-09-27")
    assert [day["date"] for day in body["days"]][0] == "2026-09-21"
    assert all(day["sessions"] == [] for day in body["days"])


def test_week_places_sessions_on_their_weekdays_with_status(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    done = session(client, seeded["upper"], "2026-09-21", [(bench, "80", 6, 2)])
    draft = client.post(
        f"/api/planned-workouts/{seeded['lower']}/open", json={"performed_on": "2026-09-23"}
    ).json()["workout_id"]
    unplanned = client.post("/api/workouts", json={"performed_on": "2026-09-24"}).json()["id"]
    with db.connection_scope(db_file) as connection:
        set_block_start(connection, seeded["version"], "2026-09-10")

    body = client.get("/api/week", params={"date": "2026-09-23"}).json()

    assert body["program"]["name"] == "Test Program"
    assert body["block"] == {
        "start_on": "2026-09-10",
        "week": 3,
        "weeks": 12,
        "phase": "block",
    }
    days = {day["weekday"]: day for day in body["days"]}
    assert list(days) == [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ]
    upper = days["Monday"]["sessions"][0]
    assert (upper["name"], upper["status"], upper["workout_id"]) == ("Upper A", "complete", done)
    assert upper["workout_on"] == "2026-09-21"
    assert (upper["slot_count"], upper["set_count"]) == (3, 4)
    lower = days["Tuesday"]["sessions"][0]
    assert (lower["status"], lower["workout_id"], lower["workout_on"]) == (
        "draft",
        draft,
        "2026-09-23",
    )
    assert days["Wednesday"]["sessions"] == []
    assert days["Thursday"]["unplanned"] == [{"workout_id": unplanned, "status": "draft"}]

    # The following week the completion no longer counts, and the draft dated in the
    # previous week does not take over the tile: it is listed as an open draft instead.
    later = client.get("/api/week", params={"date": "2026-09-28"}).json()
    upper_next = later["days"][0]["sessions"][0]
    assert (upper_next["status"], upper_next["workout_id"]) == ("not_started", None)
    lower_next = later["days"][1]["sessions"][0]
    assert (lower_next["status"], lower_next["open_draft_id"]) == ("not_started", draft)
    assert [item["workout_id"] for item in later["open_drafts"]] == [draft]
    assert later["block"]["week"] == 4


def test_week_rejects_a_malformed_date(client: TestClient) -> None:
    assert client.get("/api/week", params={"date": "2026-9-23"}).status_code == 422


# --- bodyweight -----------------------------------------------------------------------


def test_bodyweight_round_trip_summary_and_series(client: TestClient) -> None:
    for offset, kg in enumerate(["71.3", "71.4", "71.5", "71.6", "71.7", "71.8", "71.9"]):
        day = f"2026-10-{offset + 1:02d}"
        assert client.put(f"/api/bodyweight/{day}", json={"bodyweight_kg": kg}).status_code == 200
    for offset, kg in enumerate(["72", "72.1", "72.2", "72.3", "72.4", "72.5", "72.6"]):
        day = f"2026-10-{offset + 8:02d}"
        client.put(f"/api/bodyweight/{day}", json={"bodyweight_kg": kg, "notes": "am"})

    body = client.get("/api/bodyweight", params={"date": "2026-10-14"}).json()

    assert body["summary"] == {
        "reference_on": "2026-10-14",
        "latest": {"measured_on": "2026-10-14", "bodyweight_kg": "72.6"},
        "current_avg_kg": "72.30",
        "current_count": 7,
        "previous_avg_kg": "71.60",
        "previous_count": 7,
        "change_kg": "0.70",
        "change_pct": "0.98",
    }
    assert body["entries"][0] == {
        "measured_on": "2026-10-14",
        "bodyweight_kg": "72.6",
        "notes": "am",
    }
    assert len(body["entries"]) == 14
    series = body["series"]
    assert series[0] == {"date": "2026-10-01", "bodyweight_kg": "71.3", "avg7_kg": "71.30"}
    assert series[-1] == {"date": "2026-10-14", "bodyweight_kg": "72.6", "avg7_kg": "72.30"}


def test_bodyweight_is_stored_as_exact_grams_and_replaced_per_day(
    client: TestClient, db_file: Path
) -> None:
    client.put("/api/bodyweight/2026-10-01", json={"bodyweight_kg": "72.45"})
    client.put("/api/bodyweight/2026-10-01", json={"bodyweight_kg": "72.35"})
    with db.connection_scope(db_file) as connection:
        rows = connection.execute(
            "SELECT measured_on, bodyweight_g FROM bodyweight_entry"
        ).fetchall()
    assert [tuple(row) for row in rows] == [("2026-10-01", 72350)]


@pytest.mark.parametrize(
    "body",
    [
        {"bodyweight_kg": 72.4},
        {"bodyweight_kg": "72.456"},
        {"bodyweight_kg": "7240"},
        {"bodyweight_kg": "72,4"},
        {},
        {"bodyweight_kg": "72", "extra": 1},
    ],
)
def test_bodyweight_refuses_invalid_input(client: TestClient, body: dict[str, object]) -> None:
    assert client.put("/api/bodyweight/2026-10-01", json=body).status_code == 422
    assert client.get("/api/bodyweight", params={"date": "2026-10-01"}).json()["entries"] == []


def test_bodyweight_refuses_a_bad_date_and_deletes_a_day(client: TestClient) -> None:
    assert client.put("/api/bodyweight/2026-02-30", json={"bodyweight_kg": "72"}).status_code == 422
    client.put("/api/bodyweight/2026-10-01", json={"bodyweight_kg": "72"})
    assert client.delete("/api/bodyweight/2026-10-01").status_code == 204
    assert client.delete("/api/bodyweight/2026-10-01").status_code == 404


def test_empty_bodyweight_history(client: TestClient) -> None:
    body = client.get("/api/bodyweight", params={"date": "2026-10-01"}).json()
    assert body["entries"] == [] and body["series"] == []
    assert body["summary"]["latest"] is None
    assert body["summary"]["current_avg_kg"] is None


# --- nutrition ------------------------------------------------------------------------


def test_nutrition_day_round_trip_and_uncalibrated_targets(client: TestClient) -> None:
    saved = client.put(
        "/api/nutrition/2026-10-01",
        json={"calories_kcal": 2410, "protein_g": 150, "carbs_g": 290, "fat_g": 62},
    )
    assert saved.status_code == 200, saved.text
    body = client.get("/api/nutrition", params={"date": "2026-10-01"}).json()
    assert body["day"] == {
        "logged_on": "2026-10-01",
        "calories_kcal": 2410,
        "protein_g": 150,
        "carbs_g": 290,
        "fat_g": 62,
        "notes": None,
    }
    assert body["targets"] == {
        "protein_g": 145,
        "fat_g": 60,
        "calories_kcal": None,
        "carbs_g": None,
        "calorie_target_effective_on": None,
    }
    assert [day["logged_on"] for day in body["recent"]] == ["2026-10-01"]


def test_an_explicit_calorie_target_derives_carbohydrate(client: TestClient) -> None:
    created = client.post(
        "/api/nutrition/calorie-targets",
        json={"effective_on": "2026-10-01", "calories_kcal": 2650},
    )
    assert created.status_code == 201, created.text
    before = client.get("/api/nutrition", params={"date": "2026-09-30"}).json()
    assert before["targets"]["calories_kcal"] is None
    body = client.get("/api/nutrition", params={"date": "2026-10-02"}).json()
    assert body["targets"] == {
        "protein_g": 145,
        "fat_g": 60,
        "calories_kcal": 2650,
        "carbs_g": 383,
        "calorie_target_effective_on": "2026-10-01",
    }
    assert [item["calories_kcal"] for item in body["target_history"]] == [2650]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"calories_kcal": "2400"},
        {"calories_kcal": 2400.5},
        {"protein_g": -1},
        {"calories_kcal": 99999},
        {"calories_kcal": 2400, "sugar_g": 10},
    ],
)
def test_nutrition_refuses_invalid_input(client: TestClient, body: dict[str, object]) -> None:
    assert client.put("/api/nutrition/2026-10-01", json=body).status_code == 422
    assert client.get("/api/nutrition", params={"date": "2026-10-01"}).json()["day"] is None


def test_a_calorie_target_below_protein_and_fat_is_refused(client: TestClient) -> None:
    response = client.post(
        "/api/nutrition/calorie-targets", json={"effective_on": "2026-10-01", "calories_kcal": 1000}
    )
    assert response.status_code == 422


def test_a_nutrition_day_can_be_removed(client: TestClient) -> None:
    client.put("/api/nutrition/2026-10-01", json={"protein_g": 150})
    assert client.delete("/api/nutrition/2026-10-01").status_code == 204
    assert client.delete("/api/nutrition/2026-10-01").status_code == 404


# --- history --------------------------------------------------------------------------


def test_exercise_history_is_chronological_with_exact_sets_and_block_weeks(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    with db.connection_scope(db_file) as connection:
        set_block_start(connection, seeded["version"], "2026-09-21")
    second = session(
        client, seeded["upper"], "2026-09-30", [(bench, "85", 6, 2), (bench, "85", 5, 1)]
    )
    first = session(
        client,
        seeded["upper"],
        "2026-09-23",
        [(bench, "82.5", 6, 2), (bench, "82.5", 6, 2), (bench, "82.5", 5, 1)],
    )

    listed = client.get("/api/history/exercises").json()
    assert [(item["exercise"]["name"], item["exposures"]) for item in listed] == [
        ("Bench Press", 2)
    ]

    body = client.get(f"/api/exercises/{bench}/history").json()
    assert body["exercise"]["name"] == "Bench Press"
    exposures = body["exposures"]
    assert [item["workout_id"] for item in exposures] == [first, second]
    assert [item["block_week"] for item in exposures] == [1, 2]
    assert [(s["load_kg"], s["reps"], s["rir"]) for s in exposures[0]["sets"]] == [
        ("82.5", 6, 2),
        ("82.5", 6, 2),
        ("82.5", 5, 1),
    ]
    assert exposures[1]["planned_workout_name"] == "Upper A"

    assert client.get("/api/exercises/missing/history").status_code == 404


def test_recent_training_for_the_home_screen(client: TestClient, seeded: dict[str, Any]) -> None:
    bench, row = seeded["exercises"]["Bench Press"], seeded["exercises"]["Row"]
    workout = session(
        client, seeded["upper"], "2026-09-23", [(bench, "80", 6, 2), (row, "60", 10, 2)]
    )
    recent = client.get("/api/history/recent", params={"limit": 3}).json()
    assert len(recent) == 1
    assert recent[0]["workout_id"] == workout
    assert recent[0]["planned_workout_name"] == "Upper A"
    assert [group["exercise"]["name"] for group in recent[0]["exercises"]] == ["Bench Press", "Row"]
    assert recent[0]["exercises"][1]["sets"][0]["load_kg"] == "60"
