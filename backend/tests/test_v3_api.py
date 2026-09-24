"""V3: block phases, week navigation, truthful partial sessions, history weeks, settings."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from api_fixtures import session
from fitness_lab.storage import db
from fitness_lab.storage.programs import (
    activate_program_version,
    import_program_package,
    set_block_start,
)
from program_fixtures import document, package


def week(client: TestClient, day: str, **extra: str) -> dict[str, Any]:
    response = client.get("/api/week", params={"date": day, **extra})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def block(db_file: Path, version: str, start_on: str) -> None:
    with db.connection_scope(db_file) as connection:
        set_block_start(connection, version, start_on)


# --- block phases -----------------------------------------------------------------------


def test_days_before_a_mid_week_start_are_pre_block(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    block(db_file, seeded["version"], "2026-10-01")  # a Thursday
    body = week(client, "2026-09-30", today="2026-09-30")
    assert body["block"] == {"start_on": "2026-10-01", "week": 1, "weeks": 12, "phase": "pre_block"}
    assert [day["phase"] for day in body["days"]] == ["pre_block"] * 3 + ["block"] * 4
    assert week(client, "2026-10-01", today="2026-10-01")["block"]["phase"] == "block"


def test_a_week_viewed_from_elsewhere_is_in_the_block_if_any_day_is(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    block(db_file, seeded["version"], "2026-10-01")  # a Thursday
    later = week(client, "2026-09-28", today="2026-10-20")
    assert (later["block"]["week"], later["block"]["phase"]) == (1, "block")
    earlier = week(client, "2026-09-21", today="2026-10-20")
    assert earlier["block"]["phase"] == "pre_block"


def test_week_twelve_ends_the_block_and_week_thirteen_is_post_block(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    block(db_file, seeded["version"], "2026-09-28")
    last = week(client, "2026-12-20")
    assert (last["block"]["week"], last["block"]["phase"]) == (12, "block")
    assert {day["phase"] for day in last["days"]} == {"block"}
    after = week(client, "2026-12-21")
    assert (after["block"]["week"], after["block"]["phase"]) == (13, "post_block")
    assert {day["phase"] for day in after["days"]} == {"post_block"}


def test_without_a_block_start_days_have_no_phase(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    body = week(client, "2026-09-23")
    assert body["block"] is None
    assert {day["phase"] for day in body["days"]} == {None}


# --- week navigation --------------------------------------------------------------------


def test_the_week_knows_whether_it_is_the_current_one(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    current = week(client, "2026-09-25", today="2026-09-23")
    assert (current["today"], current["is_current_week"]) == ("2026-09-23", True)
    other = week(client, "2026-10-05", today="2026-09-23")
    assert (other["week_start"], other["is_current_week"]) == ("2026-10-05", False)
    assert client.get("/api/week", params={"date": "2026-10-05", "today": "x"}).status_code == 422


def test_a_reopened_old_workout_does_not_take_over_a_later_week(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    block(db_file, seeded["version"], "2026-09-21")
    bench = seeded["exercises"]["Bench Press"]
    first = session(client, seeded["upper"], "2026-09-21", [(bench, "80", 6, 2)])
    second = session(client, seeded["upper"], "2026-09-28", [(bench, "82.5", 6, 2)])
    assert client.post(f"/api/workouts/{first}/reopen").status_code == 200

    later = week(client, "2026-09-28")["days"][0]["sessions"][0]
    assert (later["status"], later["workout_id"]) == ("complete", second)
    assert (later["open_draft_id"], later["open_draft_on"]) == (first, "2026-09-21")
    drafts = week(client, "2026-09-28")["open_drafts"]
    assert drafts == [
        {
            "workout_id": first,
            "planned_workout_id": seeded["upper"],
            "name": "Upper A",
            "performed_on": "2026-09-21",
            "block_week": 1,
        }
    ]

    own = week(client, "2026-09-21")
    assert own["days"][0]["sessions"][0]["status"] == "draft"
    assert own["open_drafts"] == []


# --- partial sessions: planned vs recorded working sets ----------------------------------


def test_week_reports_planned_and_recorded_working_sets(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    session(client, seeded["upper"], "2026-09-21", [(bench, "80", 6, 2)])
    days = week(client, "2026-09-23")["days"]
    upper = days[0]["sessions"][0]
    # Upper A plans 2 working bench + 1 row + 1 back-off bench = 4 non-warm-up sets.
    assert (upper["status"], upper["planned_work_sets"], upper["actual_work_sets"]) == (
        "complete",
        4,
        1,
    )
    lower = days[1]["sessions"][0]
    assert (lower["planned_work_sets"], lower["actual_work_sets"]) == (1, None)


def test_entry_counts_working_sets_against_the_plan(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    workout_id = client.post(
        f"/api/planned-workouts/{seeded['upper']}/open", json={"performed_on": "2026-09-21"}
    ).json()["workout_id"]
    for set_type in ("warmup", "working"):
        client.post(
            f"/api/workouts/{workout_id}/sets",
            json={"exercise_id": bench, "set_type": set_type, "load_lb": "60", "reps": 5},
        )
    entry = client.get(f"/api/workouts/{workout_id}/entry").json()
    assert entry["work_sets"] == {"planned": 4, "actual": 1, "short": True}

    unplanned = client.post("/api/workouts", json={"performed_on": "2026-09-21"}).json()["id"]
    assert client.get(f"/api/workouts/{unplanned}/entry").json()["work_sets"] is None


def test_sessions_and_recent_training_carry_the_working_set_totals(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    workout_id = session(client, seeded["upper"], "2026-09-21", [(bench, "80", 6, 2)])
    listed = {item["id"]: item for item in client.get("/api/workouts").json()}
    assert (listed[workout_id]["planned_work_sets"], listed[workout_id]["work_set_count"]) == (4, 1)
    recent = client.get("/api/history/recent").json()[0]
    assert (recent["planned_work_sets"], recent["actual_work_sets"]) == (4, 1)


# --- history weeks come from the workout's own block ------------------------------------


def test_exposure_weeks_use_the_block_of_the_workouts_own_program(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    block(db_file, seeded["version"], "2026-09-07")
    bench = seeded["exercises"]["Bench Press"]
    session(client, seeded["upper"], "2026-09-21", [(bench, "80", 6, 2)])
    unplanned = client.post("/api/workouts", json={"performed_on": "2026-09-22"}).json()["id"]
    client.post(
        f"/api/workouts/{unplanned}/sets",
        json={"exercise_id": bench, "set_type": "working", "load_lb": "70", "reps": 8},
    )
    client.post(f"/api/workouts/{unplanned}/complete")

    with db.connection_scope(db_file) as connection:
        other = import_program_package(connection, package(document("other-program"))).version
        activate_program_version(connection, other.id)
        set_block_start(connection, other.id, "2026-10-01")

    exposures = client.get(f"/api/exercises/{bench}/history").json()["exposures"]
    assert [(item["block_week"], item["phase"]) for item in exposures] == [
        (3, "block"),  # the old program's own block, not renumbered by the new one
        (0, "pre_block"),  # unplanned: the active block
    ]


# --- settings: block start and backups ---------------------------------------------------


def test_the_block_start_is_set_in_the_app(client: TestClient, seeded: dict[str, Any]) -> None:
    response = client.put("/api/program/block-start", json={"start_on": "2026-10-01"})
    assert response.status_code == 200, response.text
    assert response.json() == {
        "version_id": seeded["version"],
        "start_on": "2026-10-01",
        "week_1_start": "2026-09-28",
        "week_1_end": "2026-10-04",
    }
    assert week(client, "2026-10-05")["block"]["week"] == 2
    client.put("/api/program/block-start", json={"start_on": "2026-10-05"})
    assert week(client, "2026-10-05")["block"]["week"] == 1


def test_the_block_start_refuses_bad_input(client: TestClient, seeded: dict[str, Any]) -> None:
    for body in ({"start_on": "2026-02-30"}, {"start_on": "2026-9-1"}, {}, {"start_on": 1}):
        assert client.put("/api/program/block-start", json=body).status_code == 422
    extra = {"start_on": "2026-10-01", "version_id": seeded["version"]}
    assert client.put("/api/program/block-start", json=extra).status_code == 422


def test_the_block_start_cannot_move_under_recorded_review_decisions(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    from fitness_lab.storage import controller

    with db.connection_scope(db_file) as connection:
        set_block_start(connection, seeded["version"], "2026-09-28")
        controller.record_decision(
            connection,
            program_version_id=seeded["version"],
            block_week=3,
            decided_on="2026-10-18",
            window_first="2026-10-05",
            window_last="2026-10-18",
            weigh_ins=14,
            trend_pct="0.15",
            status="IN_RANGE",
            recommended_action="NO_CHANGE",
            recommended_delta_kcal=0,
            previous_calorie_target_kcal=2650,
            user_choice="KEPT",
            new_target=None,
            composition_concern=False,
            notes=None,
        )
    refused = client.put("/api/program/block-start", json={"start_on": "2026-10-12"})
    assert refused.status_code == 409
    assert "review decision" in refused.json()["detail"]
    assert week(client, "2026-10-12")["block"]["start_on"] == "2026-09-28"


def test_the_block_start_needs_an_active_program(client: TestClient) -> None:
    response = client.put("/api/program/block-start", json={"start_on": "2026-10-01"})
    assert response.status_code == 409


def test_a_backup_is_a_verified_snapshot_listed_newest_first(
    client: TestClient, db_file: Path
) -> None:
    # Migrating the fresh database already took its pre-migration snapshot.
    assert [item["kind"] for item in client.get("/api/backups").json()] == ["pre-migration"]
    # A body-less (simple, cross-site) POST is refused: a backup needs the app's JSON request.
    assert client.post("/api/backup").status_code == 422
    first = client.post("/api/backup", json={})
    assert first.status_code == 201, first.text
    second = client.post("/api/backup", json={}).json()
    name = first.json()["name"]
    assert name.endswith("-manual-backup.db")
    assert (db_file.parent / "snapshots" / name).is_file()
    listed = client.get("/api/backups").json()
    assert [item["name"] for item in listed][:2] == [second["name"], name]
    assert listed[0]["kind"] == "manual"
    assert set(listed[0]) == {"name", "kind", "created_at_utc", "size_bytes"}
