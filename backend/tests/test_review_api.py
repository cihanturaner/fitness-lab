"""V3 HTTP: the weekly nutrition review. Every change of calories is an explicit POST."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from fitness_lab.domain.nutrition_controller import GATE_CHECKS, RELIABILITY_CHECKS
from fitness_lab.storage import db
from fitness_lab.storage.programs import set_block_start

START = date(2026, 9, 28)


def sunday(week: int) -> str:
    return (START + timedelta(days=7 * week - 1)).isoformat()


def weigh(client: TestClient, first: date, last: date, per_day_g: float) -> None:
    day = first
    while day <= last:
        # A scale reads to 0.01 kg, so weights are whole tens of grams.
        grams = 72_000 + round(per_day_g * (day - first).days / 10) * 10
        kg = f"{grams / 1000:.2f}"
        response = client.put(f"/api/bodyweight/{day.isoformat()}", json={"bodyweight_kg": kg})
        assert response.status_code == 200, response.text
        day += timedelta(days=1)


@pytest.fixture
def block(client: TestClient, seeded: dict[str, Any], db_file: Path) -> dict[str, Any]:
    with db.connection_scope(db_file) as connection:
        set_block_start(connection, seeded["version"], START.isoformat())
    response = client.post(
        "/api/nutrition/targets",
        json={
            "effective_on": "2026-09-18",
            "protein_g": 150,
            "carbs_g": 300,
            "fat_g": 70,
            "notes": "calibration",
        },
    )
    assert response.status_code == 201, response.text  # 150 x 4 + 300 x 4 + 70 x 9 = 2430 kcal
    return seeded


def review(client: TestClient, day: str, **extra: str) -> dict[str, Any]:
    response = client.get("/api/nutrition/review", params={"date": day, **extra})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def decide(
    client: TestClient,
    day: str,
    week: int,
    choice: str,
    status: str,
    delta: int | None,
    target: int | None = None,
) -> tuple[int, dict[str, Any]]:
    """Decide exactly what the review showed (its recommended target unless one is given)."""
    shown = review(client, day)["review"]
    response = client.post(
        "/api/nutrition/review/decision",
        json={
            "date": day,
            "block_week": week,
            "choice": choice,
            "expected_status": status,
            "expected_delta_kcal": delta,
            "expected_target_kcal": shown["recommended_target_kcal"] if target is None else target,
        },
    )
    return response.status_code, response.json()


def test_without_a_block_there_is_no_review(client: TestClient, seeded: dict[str, Any]) -> None:
    body = review(client, "2026-10-18")
    assert (body["available"], body["reason"], body["review"]) == (False, "no_block", None)
    assert body["gate_checks"] == list(GATE_CHECKS)


def test_weeks_1_and_2_show_the_trend_but_decide_nothing(
    client: TestClient, block: dict[str, Any]
) -> None:
    weigh(client, START - timedelta(days=14), START + timedelta(days=13), 7.2)
    body = review(client, sunday(2))
    current = body["review"]
    assert (current["phase"], current["block_week"], current["decision_due"]) == ("early", 2, False)
    assert current["recommended_action"] is None
    assert current["next_decision_week"] == 3
    assert current["next_decision_on"] == sunday(3)
    assert [row["block_week"] for row in body["weeks"]] == [2, 1]


def test_under_gain_is_applied_only_by_an_explicit_choice(
    client: TestClient, block: dict[str, Any]
) -> None:
    weigh(client, START - timedelta(days=7), date.fromisoformat(sunday(3)), 7.2)
    current = review(client, sunday(3))["review"]
    assert current["trend"]["pct_bw_per_week"] == "0.07"
    assert current["trend"]["weigh_ins"] == 14
    assert (current["status"], current["decision_due"]) == ("UNDER_GAIN", True)
    # +150 kcal moves carbohydrate only (source: primary_macro_adjusted), +38 g half-up.
    assert (current["recommended_delta_kcal"], current["recommended_target_kcal"]) == (150, 2582)
    assert current["current_macros"] == {
        "protein_g": 150,
        "carbs_g": 300,
        "fat_g": 70,
        "calories_kcal": 2430,
    }
    assert current["recommended_macros"] == {
        "protein_g": 150,
        "carbs_g": 338,
        "fat_g": 70,
        "calories_kcal": 2582,
    }
    assert current["recommended_carbs_g"] == 338
    # Reading the review never changes the target.
    assert (
        client.get("/api/nutrition", params={"date": sunday(3)}).json()["target"]["calories_kcal"]
        == 2430
    )

    applied = decide(client, sunday(3), 3, "APPLIED", "UNDER_GAIN", 150)
    assert applied[0] == 201, applied
    decision = applied[1]
    assert (decision["user_choice"], decision["new_calorie_target_kcal"]) == ("APPLIED", 2582)
    assert decision["new_target"]["carbs_g"] == 338
    targets = client.get("/api/nutrition", params={"date": sunday(3)}).json()
    assert (targets["target"]["calories_kcal"], targets["target"]["carbs_g"]) == (2582, 338)
    assert [item["calories_kcal"] for item in targets["target_history"]] == [2582, 2430]
    # The day before the decision keeps the target it had.
    before = client.get("/api/nutrition", params={"date": sunday(3)[:8] + "17"}).json()
    assert before["target"]["calories_kcal"] == 2430

    after = review(client, sunday(3))
    assert (after["review"]["already_decided"], after["review"]["decision_due"]) == (True, False)
    # Applying never rewrites the reading of the week it decided.
    assert (after["review"]["status"], after["review"]["trend"]["pct_bw_per_week"]) == (
        "UNDER_GAIN",
        "0.07",
    )
    assert after["review"]["next_decision_week"] == 5
    assert after["weeks"][0]["decision"]["user_choice"] == "APPLIED"
    assert decide(client, sunday(3), 3, "KEPT", "UNDER_GAIN", 150)[0] == 409


def test_apply_records_exactly_the_macros_that_were_shown(
    client: TestClient, block: dict[str, Any]
) -> None:
    weigh(client, START - timedelta(days=7), date.fromisoformat(sunday(3)), 7.2)
    shown = review(client, sunday(3))["review"]["recommended_macros"]
    # A manual target with the same calories but other macros lands before Apply is pressed.
    same_kcal = client.post(
        "/api/nutrition/targets",
        json={"effective_on": sunday(3), "protein_g": 160, "carbs_g": 290, "fat_g": 70},
    )
    assert same_kcal.status_code == 201
    body = {
        "date": sunday(3),
        "block_week": 3,
        "choice": "APPLIED",
        "expected_status": "UNDER_GAIN",
        "expected_delta_kcal": 150,
        "expected_target_kcal": 2582,
        "expected_macros": {key: shown[key] for key in ("protein_g", "carbs_g", "fat_g")},
    }
    stale = client.post("/api/nutrition/review/decision", json=body)
    assert stale.status_code == 409, stale.text
    fresh = review(client, sunday(3))["review"]["recommended_macros"]
    assert (fresh["protein_g"], fresh["carbs_g"], fresh["calories_kcal"]) == (160, 328, 2582)
    body["expected_macros"] = {key: fresh[key] for key in ("protein_g", "carbs_g", "fat_g")}
    applied = client.post("/api/nutrition/review/decision", json=body)
    assert applied.status_code == 201, applied.text
    assert applied.json()["new_target"]["carbs_g"] == 328


def test_keeping_records_the_decision_without_a_target(
    client: TestClient, block: dict[str, Any]
) -> None:
    weigh(client, START - timedelta(days=7), date.fromisoformat(sunday(3)), 7.2)
    kept = decide(client, sunday(3), 3, "KEPT", "UNDER_GAIN", 150)
    assert kept[0] == 201, kept
    assert kept[1]["new_calorie_target_kcal"] is None
    history = client.get("/api/nutrition", params={"date": sunday(3)}).json()["target_history"]
    assert [item["calories_kcal"] for item in history] == [2430]


def test_apply_is_refused_when_the_target_shown_is_stale(
    client: TestClient, block: dict[str, Any]
) -> None:
    weigh(client, START - timedelta(days=7), date.fromisoformat(sunday(3)), 7.2)
    assert decide(client, sunday(3), 3, "APPLIED", "UNDER_GAIN", 150, target=2750)[0] == 409
    assert len(client.get("/api/nutrition").json()["target_history"]) == 1


@pytest.mark.parametrize(
    ("week_day", "week", "choice", "status", "delta"),
    [
        (sunday(3), 3, "APPLIED", "IN_RANGE", 150),  # stale status
        (sunday(3), 3, "APPLIED", "UNDER_GAIN", 100),  # stale delta
        (sunday(3), 4, "APPLIED", "UNDER_GAIN", 150),  # not the review week
        (sunday(2), 2, "KEPT", "UNDER_GAIN", None),  # weeks 1-2: nothing to decide
    ],
)
def test_a_stale_or_untimely_decision_is_refused(
    client: TestClient,
    block: dict[str, Any],
    week_day: str,
    week: int,
    choice: str,
    status: str,
    delta: int | None,
) -> None:
    weigh(client, START - timedelta(days=14), date.fromisoformat(sunday(3)), 7.2)
    assert decide(client, week_day, week, choice, status, delta)[0] == 409
    assert len(client.get("/api/nutrition").json()["target_history"]) == 1


def test_two_failed_increases_open_the_gate_and_an_audit_decides(
    client: TestClient, block: dict[str, Any]
) -> None:
    weigh(client, START - timedelta(days=7), date.fromisoformat(sunday(7)), 3.6)  # ~0.035 %/wk
    assert decide(client, sunday(3), 3, "APPLIED", "UNDER_GAIN", 150)[0] == 201
    assert decide(client, sunday(5), 5, "APPLIED", "UNDER_GAIN", 150)[0] == 201

    gate = review(client, sunday(7))["review"]
    assert (gate["status"], gate["recommended_action"]) == (
        "DIAGNOSTIC_GATE",
        "AUDIT_BEFORE_CONTINUING",
    )
    assert gate["recommended_delta_kcal"] is None
    assert decide(client, sunday(7), 7, "APPLIED", "DIAGNOSTIC_GATE", None)[0] == 409

    unanswered = {name: True for name in GATE_CHECKS if name != "illness_travel"}
    refused = client.post(
        "/api/nutrition/review/gate",
        json={
            "date": sunday(7),
            "block_week": 7,
            "checks": unanswered,
            "result": "INPUTS_UNRELIABLE",
        },
    )
    assert refused.status_code == 422
    reliable = {name: name in RELIABILITY_CHECKS for name in GATE_CHECKS}
    audit = client.post(
        "/api/nutrition/review/gate",
        json={
            "date": sunday(7),
            "block_week": 7,
            "checks": reliable,
            "result": "GENUINE_UNDERFEEDING_CONFIRMED",
            "notes": "logged everything",
        },
    )
    assert audit.status_code == 201, audit.text

    cleared = review(client, sunday(7))
    assert (cleared["review"]["status"], cleared["review"]["recommended_delta_kcal"]) == (
        "UNDER_GAIN",
        150,
    )
    assert cleared["review"]["recommended_target_kcal"] == 2886  # 2430 + 3 x 38 g carbs
    assert [item["result"] for item in cleared["gates"]] == ["GENUINE_UNDERFEEDING_CONFIRMED"]


def test_a_gate_audit_is_refused_when_no_gate_is_open(
    client: TestClient, block: dict[str, Any]
) -> None:
    weigh(client, START - timedelta(days=7), date.fromisoformat(sunday(3)), 7.2)
    response = client.post(
        "/api/nutrition/review/gate",
        json={
            "date": sunday(3),
            "block_week": 3,
            "checks": dict.fromkeys(GATE_CHECKS, True),
            "result": "INPUTS_UNRELIABLE",
        },
    )
    assert response.status_code == 409


def test_bodyweight_reports_the_qualified_14_day_trend(
    client: TestClient, block: dict[str, Any]
) -> None:
    weigh(client, date(2026, 10, 5), date(2026, 10, 18), 7.2)
    trend = client.get("/api/bodyweight", params={"date": "2026-10-18"}).json()["trend"]
    assert trend == {
        "window_first": "2026-10-05",
        "window_last": "2026-10-18",
        "weigh_ins": 14,
        "first_half": 7,
        "second_half": 7,
        "pct_bw_per_week": "0.07",
        "qualified": True,
        "band": "UNDER_GAIN",
    }
    thin = client.get("/api/bodyweight", params={"date": "2026-10-10"}).json()["trend"]
    assert (thin["weigh_ins"], thin["qualified"], thin["pct_bw_per_week"]) == (6, False, None)
