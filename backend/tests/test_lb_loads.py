"""V3.1: every workout load is entered and shown in pounds; storage stays integer grams."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api_fixtures import session
from fitness_lab.domain.units import format_lb, g_to_lb, lb_to_g
from fitness_lab.storage import db

# --- the unit layer ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("pounds", "grams"),
    [
        ("0", 0),
        ("1", 454),  # 453.59237
        ("2.5", 1134),  # 1133.980925
        ("45", 20412),  # 20411.65665
        ("225", 102058),  # 102058.28325
        ("72.75", 32999),  # 32998.84491...
        ("315.5", 143108),  # 143108.39274
    ],
)
def test_pounds_become_whole_grams(pounds: str, grams: int) -> None:
    assert lb_to_g(pounds) == grams


def test_every_hundredth_of_a_pound_reads_back_exactly() -> None:
    # 0.00 to 1000.00 lb in 0.01 steps: rounding to the gram never shows through.
    for hundredths in range(0, 100_001):
        pounds = Decimal(hundredths).scaleb(-2)
        assert g_to_lb(lb_to_g(pounds)) == pounds


@pytest.mark.parametrize("bad", ["72.755", "0.001", "-5", "abc", "NaN", "Infinity"])
def test_a_bad_pound_value_is_refused(bad: str) -> None:
    with pytest.raises(ValueError):
        lb_to_g(bad)


def test_floats_never_cross_the_pound_boundary() -> None:
    with pytest.raises(TypeError):
        lb_to_g(72.5)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("grams", "shown"),
    [
        (None, None),
        (0, "0"),
        (102058, "225"),
        (1134, "2.5"),
        (33000, "72.75"),  # a set recorded as 33 kg before V3.1
        (44000, "97"),  # 97.0034...
        (100000, "220.46"),
    ],
)
def test_stored_grams_are_shown_in_pounds(grams: int | None, shown: str | None) -> None:
    assert format_lb(grams) == shown


# --- HTTP -------------------------------------------------------------------------------


def _stored_grams(db_file: Path) -> list[int | None]:
    with db.connection_scope(db_file) as connection:
        rows = connection.execute("SELECT load_g FROM performed_set ORDER BY set_order").fetchall()
    return [None if row[0] is None else int(row[0]) for row in rows]


def test_a_pound_load_is_stored_as_grams_and_read_back_in_pounds(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    workout = session(
        client, seeded["upper"], "2026-10-01", [(bench, "225", 5, 2), (bench, "2.5", 20, 3)]
    )
    assert _stored_grams(db_file) == [102058, 1134]
    entry = client.get(f"/api/workouts/{workout}/entry").json()
    assert [item["load_lb"] for item in entry["sets"]] == ["225", "2.5"]
    assert all("load_kg" not in item for item in entry["sets"])


def test_an_edit_in_pounds_replaces_the_grams(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    workout = session(client, seeded["upper"], "2026-10-01", [(bench, "185", 5, 2)])
    set_id = client.get(f"/api/workouts/{workout}/entry").json()["sets"][0]["id"]
    assert client.post(f"/api/workouts/{workout}/reopen").status_code == 200
    patched = client.patch(f"/api/sets/{set_id}", json={"load_lb": "190"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["load_lb"] == "190"
    assert _stored_grams(db_file) == [86183]  # 190 x 453.59237 = 86182.5503


def test_a_kilogram_field_is_refused_so_no_number_is_misread(
    client: TestClient, seeded: dict[str, Any]
) -> None:
    bench = seeded["exercises"]["Bench Press"]
    workout = session(client, seeded["upper"], "2026-10-01", [(bench, "185", 5, 2)])
    refused = client.post(
        f"/api/workouts/{workout}/sets",
        json={"exercise_id": bench, "set_type": "working", "load_kg": "80", "reps": 5},
    )
    assert refused.status_code == 422


def test_sets_recorded_in_kilograms_before_v3_1_read_as_their_true_pounds(
    client: TestClient, seeded: dict[str, Any], db_file: Path
) -> None:
    # The canonical database holds two such sets: 33 kg and 44 kg, saved on 2026-09-24.
    bench = seeded["exercises"]["Bench Press"]
    workout = session(client, seeded["upper"], "2026-09-24", [(bench, "1", 5, 2)] * 2)
    with db.connection_scope(db_file) as connection, db.transaction(connection):
        connection.execute("UPDATE performed_set SET load_g = 33000 WHERE set_order = 1")
        connection.execute("UPDATE performed_set SET load_g = 44000 WHERE set_order = 2")
    entry = client.get(f"/api/workouts/{workout}/entry").json()
    assert [item["load_lb"] for item in entry["sets"]] == ["72.75", "97"]
    history = client.get(f"/api/exercises/{bench}/history").json()
    assert [item["load_lb"] for item in history["exposures"][0]["sets"]] == ["72.75", "97"]
    recent = client.get("/api/history/recent").json()
    assert [item["load_lb"] for item in recent[0]["exercises"][0]["sets"]] == ["72.75", "97"]
    # Reading never rewrites: the grams are exactly what was recorded.
    assert _stored_grams(db_file) == [33000, 44000]
