"""V3.1: a day's calories are derived from its macros; migration 0006 keeps what was typed."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fitness_lab.domain.nutrition import (
    FIXED_PROTEIN_FAT_KCAL,
    day_calories,
    targets_for,
)
from fitness_lab.storage import db, tracking
from fitness_lab.storage.migrations import MIGRATIONS_DIR, migrate_to_head

STAMP = "2026-09-24T10:25:49+00:00"


# --- domain -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("protein", "carbs", "fat", "kcal"),
    [
        (None, None, 10, 90),  # fat only: 9 kcal/g
        (10, None, None, 40),  # protein only: 4 kcal/g
        (None, 10, None, 40),  # carbs only: 4 kcal/g
        (76, 210, 70, 1774),  # mixed: 304 + 840 + 630
        (145, 383, 60, 2652),
        (0, 0, 0, 0),  # a recorded zero is a value, not a gap
        (0, None, None, 0),
    ],
)
def test_calories_are_atwater_sums_of_the_macros(
    protein: int | None, carbs: int | None, fat: int | None, kcal: int
) -> None:
    assert day_calories(protein_g=protein, carbs_g=carbs, fat_g=fat).calories_kcal == kcal


def test_a_total_is_complete_only_when_every_macro_is_recorded() -> None:
    assert day_calories(protein_g=150, carbs_g=300, fat_g=60).complete
    assert day_calories(protein_g=0, carbs_g=0, fat_g=0).complete
    assert not day_calories(protein_g=150, carbs_g=None, fat_g=60).complete


def test_a_day_without_any_macro_has_no_calories() -> None:
    with pytest.raises(ValueError):
        day_calories(protein_g=None, carbs_g=None, fat_g=None)


def test_locked_protein_and_fat_alone_are_1120_kcal() -> None:
    assert FIXED_PROTEIN_FAT_KCAL == 1120
    assert day_calories(protein_g=145, carbs_g=0, fat_g=60).calories_kcal == 1120


def test_eating_the_macro_targets_lands_on_the_calorie_target() -> None:
    # The carbohydrate target is rounded to whole grams, so the macros land within 2 kcal.
    targets = targets_for(2650)
    assert targets.carbs_g is not None
    eaten = day_calories(protein_g=targets.protein_g, carbs_g=targets.carbs_g, fat_g=targets.fat_g)
    assert abs(eaten.calories_kcal - 2650) <= 2


# --- HTTP -------------------------------------------------------------------------------


def test_an_edit_rederives_the_calories(client: TestClient) -> None:
    first = client.put("/api/nutrition/2026-10-01", json={"protein_g": 150, "fat_g": 60})
    assert first.json()["calories_kcal"] == 1140
    assert first.json()["calories_complete"] is False
    edited = client.put(
        "/api/nutrition/2026-10-01", json={"protein_g": 150, "carbs_g": 300, "fat_g": 60}
    )
    assert edited.json()["calories_kcal"] == 2340
    assert edited.json()["calories_complete"] is True
    day = client.get("/api/nutrition", params={"date": "2026-10-01"}).json()["day"]
    assert day["calories_kcal"] == 2340


def test_history_shows_calories_derived_from_each_days_macros(client: TestClient) -> None:
    client.put("/api/nutrition/2026-10-01", json={"fat_g": 10})
    client.put("/api/nutrition/2026-10-02", json={"protein_g": 10})
    client.put("/api/nutrition/2026-10-03", json={"carbs_g": 10, "protein_g": 0, "fat_g": 0})
    recent = client.get("/api/nutrition", params={"date": "2026-10-03"}).json()["recent"]
    assert [(day["logged_on"], day["calories_kcal"]) for day in recent] == [
        ("2026-10-03", 40),
        ("2026-10-02", 40),
        ("2026-10-01", 90),
    ]


def test_logged_calories_compare_against_an_untouched_target(client: TestClient) -> None:
    client.post(
        "/api/nutrition/calorie-targets", json={"effective_on": "2026-10-01", "calories_kcal": 2650}
    )
    client.put("/api/nutrition/2026-10-02", json={"protein_g": 145, "carbs_g": 383, "fat_g": 60})
    body = client.get("/api/nutrition", params={"date": "2026-10-02"}).json()
    assert body["targets"]["calories_kcal"] == 2650
    assert body["day"]["calories_kcal"] == 2652
    # Logging never writes a target.
    assert [item["calories_kcal"] for item in body["target_history"]] == [2650]


# --- migration 0006 ---------------------------------------------------------------------


def _v3_database(tmp_path: Path) -> Path:
    before = tmp_path / "v3-migrations"
    before.mkdir()
    for path in sorted(MIGRATIONS_DIR.glob("000[12345]_*.sql")):
        shutil.copyfile(path, before / path.name)
    db_path = tmp_path / "fitness_lab.db"
    migrate_to_head(db_path, directory=before)
    rows = [
        # The real canonical row at the time of 0006: typed 1222 kcal, macros say 469.
        ("2026-09-24", 1222, 22, 21, 33, None),
        ("2026-09-25", 2400, 150, None, 60, "restaurant"),
        ("2026-09-26", 2100, None, None, None, "calories only"),
        ("2026-09-27", None, 140, 300, 55, None),
    ]
    with db.connection_scope(db_path) as connection, db.transaction(connection):
        for logged_on, kcal, protein, carbs, fat, notes in rows:
            connection.execute(
                "INSERT INTO nutrition_day (logged_on, calories_kcal, protein_g, carbs_g, fat_g, "
                "notes, entered_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (logged_on, kcal, protein, carbs, fat, notes, STAMP, STAMP),
            )
    return db_path


def test_0006_archives_every_typed_calorie_value_before_the_rebuild(tmp_path: Path) -> None:
    db_path = _v3_database(tmp_path)

    result = migrate_to_head(db_path)

    assert result.applied == (6,)
    assert result.snapshot is not None and result.snapshot.name.endswith("-pre-0006.db")
    with db.connection_scope(db_path) as connection:
        archived = connection.execute(
            "SELECT logged_on, entered_calories_kcal, protein_g, carbs_g, fat_g, derived_kcal, "
            "entered_at_utc FROM nutrition_entered_calories ORDER BY logged_on"
        ).fetchall()
        assert [tuple(row) for row in archived] == [
            ("2026-09-24", 1222, 22, 21, 33, 469, STAMP),
            ("2026-09-25", 2400, 150, None, 60, 1140, STAMP),
            ("2026-09-26", 2100, None, None, None, None, STAMP),
        ]
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_0006_keeps_every_macro_and_derives_the_calories(tmp_path: Path) -> None:
    db_path = _v3_database(tmp_path)
    migrate_to_head(db_path)
    with db.connection_scope(db_path) as connection:
        columns = [str(row[1]) for row in connection.execute("PRAGMA table_info(nutrition_day)")]
        assert "calories_kcal" not in columns
        days = tracking.list_nutrition_days(connection)
    assert [(day.logged_on, day.protein_g, day.carbs_g, day.fat_g, day.notes) for day in days] == [
        ("2026-09-24", 22, 21, 33, None),
        ("2026-09-25", 150, None, 60, "restaurant"),
        ("2026-09-27", 140, 300, 55, None),
    ]
    assert all(day.entered_at_utc == STAMP for day in days)
    derived = [
        day_calories(protein_g=day.protein_g, carbs_g=day.carbs_g, fat_g=day.fat_g).calories_kcal
        for day in days
    ]
    assert derived == [469, 1140, 2255]


def test_the_calorie_archive_is_closed_and_append_only(tmp_path: Path) -> None:
    db_path = _v3_database(tmp_path)
    migrate_to_head(db_path)
    with db.connection_scope(db_path) as connection:
        for statement in (
            "UPDATE nutrition_entered_calories SET entered_calories_kcal = 1",
            "DELETE FROM nutrition_entered_calories",
            "INSERT INTO nutrition_entered_calories VALUES "
            "('2026-10-01', 1, NULL, NULL, NULL, NULL, 'x', 'x', 'x')",
        ):
            with pytest.raises(sqlite3.DatabaseError):
                connection.execute(statement)
        assert (
            connection.execute("SELECT count(*) FROM nutrition_entered_calories").fetchone()[0] == 3
        )


def test_a_request_carrying_calories_is_refused(client: TestClient) -> None:
    refused = client.put(
        "/api/nutrition/2026-10-01", json={"protein_g": 150, "calories_kcal": 9000}
    )
    assert refused.status_code == 422
