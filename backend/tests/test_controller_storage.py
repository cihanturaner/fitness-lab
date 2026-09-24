"""Migration 0005 and the nutrition-controller decision records, against real SQLite files."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from fitness_lab.domain.nutrition import MacroTargets
from fitness_lab.domain.nutrition_controller import GATE_CHECKS
from fitness_lab.storage import controller, db, tracking
from fitness_lab.storage.entry import Conflict
from fitness_lab.storage.migrations import MIGRATIONS_DIR, migrate_to_head
from fitness_lab.storage.programs import (
    activate_program_version,
    import_program_package,
    set_block_start,
)
from program_fixtures import package, seed_exercises

STAMP = "2026-10-18T10:00:00+00:00"


@pytest.fixture
def version(migrated_db: sqlite3.Connection) -> str:
    seed_exercises(migrated_db)
    imported = import_program_package(migrated_db, package()).version
    activate_program_version(migrated_db, imported.id)
    return imported.id


def decide(
    connection: sqlite3.Connection, version: str, week: int, choice: str, new_carbs: int | None
) -> controller.DecisionRow:
    return controller.record_decision(
        connection,
        program_version_id=version,
        block_week=week,
        decided_on="2026-10-18",
        window_first="2026-10-05",
        window_last="2026-10-18",
        weigh_ins=14,
        trend_pct="0.07",
        status="UNDER_GAIN",
        recommended_action="ADD_CALORIES",
        recommended_delta_kcal=150,
        previous_calorie_target_kcal=2650,
        user_choice=choice,
        new_target=None
        if new_carbs is None
        else MacroTargets(protein_g=145, carbs_g=new_carbs, fat_g=60),
        composition_concern=False,
        notes=None,
        now=STAMP,
    )


def test_0005_is_additive_over_a_v2_database(tmp_path: Path) -> None:
    before_dir = tmp_path / "v2-migrations"
    before_dir.mkdir()
    for path in sorted(MIGRATIONS_DIR.glob("000[1234]_*.sql")):
        shutil.copyfile(path, before_dir / path.name)
    db_path = tmp_path / "fitness_lab.db"
    migrate_to_head(db_path, directory=before_dir)
    with db.connection_scope(db_path) as connection:
        seed_exercises(connection)
        imported = import_program_package(connection, package()).version
        activate_program_version(connection, imported.id)
        set_block_start(connection, imported.id, "2026-09-28")
        tracking.put_bodyweight(connection, "2026-09-23", 72_000, None, now=STAMP)
        tracking.put_nutrition_day(
            connection,
            "2026-09-23",
            protein_g=150,
            carbs_g=None,
            fat_g=60,
            notes=None,
            now=STAMP,
        )
        connection.execute(
            "INSERT INTO calorie_target VALUES ('t1', '2026-09-23', 2650, 'calibration', ?)",
            (STAMP,),
        )
        tables = [
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        before = {
            table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY 1")]
            for table in tables
            if table != "schema_migrations"
        }

    through_0005 = tmp_path / "v3-migrations"
    through_0005.mkdir()
    for path in sorted(MIGRATIONS_DIR.glob("000[12345]_*.sql")):
        shutil.copyfile(path, through_0005 / path.name)
    result = migrate_to_head(db_path, directory=through_0005)

    assert result.applied == (5,)
    assert result.snapshot is not None and result.snapshot.name.endswith("-pre-0005.db")
    with db.connection_scope(db_path) as connection:
        after = {
            table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY 1")]
            for table in before
        }
        assert after == before
        for table in ("controller_event", "diagnostic_gate_event"):
            assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_applying_appends_one_target_and_one_decision_together(
    migrated_db: sqlite3.Connection, version: str
) -> None:
    row = decide(migrated_db, version, 3, "APPLIED", 421)
    targets = tracking.list_macro_targets(migrated_db)
    assert [(item.effective_on, item.macros.calories_kcal) for item in targets] == [
        ("2026-10-18", 2804)
    ]
    assert row.new_target_id == targets[0].id
    assert row.new_target == MacroTargets(protein_g=145, carbs_g=421, fat_g=60)
    assert targets[0].notes == "Week 3 review: UNDER_GAIN, +154 kcal/day applied"
    assert [item.block_week for item in controller.list_decisions(migrated_db, version)] == [3]


def test_keeping_records_the_decision_and_no_target(
    migrated_db: sqlite3.Connection, version: str
) -> None:
    row = decide(migrated_db, version, 3, "KEPT", None)
    assert (row.user_choice, row.new_target_id) == ("KEPT", None)
    assert tracking.list_macro_targets(migrated_db) == ()


def test_a_week_is_decided_once_and_a_refused_apply_leaves_no_target(
    migrated_db: sqlite3.Connection, version: str
) -> None:
    decide(migrated_db, version, 3, "KEPT", None)
    with pytest.raises(Conflict, match="already"):
        decide(migrated_db, version, 3, "APPLIED", 421)
    assert tracking.list_macro_targets(migrated_db) == ()


def test_decisions_and_audits_are_append_only(
    migrated_db: sqlite3.Connection, version: str
) -> None:
    row = decide(migrated_db, version, 3, "KEPT", None)
    gate = controller.record_gate(
        migrated_db,
        program_version_id=version,
        block_week=7,
        decided_on="2026-11-15",
        checks=dict.fromkeys(GATE_CHECKS, True),
        result="INPUTS_UNRELIABLE",
        notes=None,
        now=STAMP,
    )
    for statement in (
        f"UPDATE controller_event SET user_choice = 'KEPT' WHERE id = '{row.id}'",
        f"DELETE FROM controller_event WHERE id = '{row.id}'",
        f"UPDATE diagnostic_gate_event SET result = 'INPUTS_UNRELIABLE' WHERE id = '{gate.id}'",
        f"DELETE FROM diagnostic_gate_event WHERE id = '{gate.id}'",
    ):
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            migrated_db.execute(statement)


def test_audits_keep_every_answer_and_list_in_recorded_order(
    migrated_db: sqlite3.Connection, version: str
) -> None:
    checks = dict.fromkeys(GATE_CHECKS, False)
    checks["adherence_consistent"] = True
    for stamp, result in (
        ("2026-11-15T08:00:00+00:00", "INPUTS_UNRELIABLE"),
        ("2026-11-16T08:00:00+00:00", "GENUINE_UNDERFEEDING_CONFIRMED"),
    ):
        controller.record_gate(
            migrated_db,
            program_version_id=version,
            block_week=7,
            decided_on=stamp[:10],
            checks=checks,
            result=result,
            notes="scale replaced",
            now=stamp,
        )
    gates = controller.list_gates(migrated_db, version)
    assert [item.result for item in gates] == [
        "INPUTS_UNRELIABLE",
        "GENUINE_UNDERFEEDING_CONFIRMED",
    ]
    assert gates[0].checks == checks


def test_an_applied_decision_must_carry_a_new_target(
    migrated_db: sqlite3.Connection, version: str
) -> None:
    with pytest.raises(ValueError, match="new target"):
        decide(migrated_db, version, 3, "APPLIED", None)
    with pytest.raises(ValueError, match="kept"):
        decide(migrated_db, version, 3, "KEPT", 421)
