"""V3.3 migration 0007: calorie-only targets become macro targets; nothing recorded changes."""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest

from fitness_lab.domain.nutrition import MacroTargets
from fitness_lab.storage import controller, db, tracking
from fitness_lab.storage.migrations import MIGRATIONS_DIR, migrate_to_head
from fitness_lab.storage.programs import activate_program_version, import_program_package
from program_fixtures import package, seed_exercises

STAMP = "2026-10-18T10:00:00+00:00"


def _v31_database(tmp_path: Path) -> tuple[Path, str]:
    """A database at 0006 holding two calorie targets and an applied and a kept decision."""
    before = tmp_path / "v31-migrations"
    before.mkdir()
    for path in sorted(MIGRATIONS_DIR.glob("000[123456]_*.sql")):
        shutil.copyfile(path, before / path.name)
    db_path = tmp_path / "fitness_lab.db"
    migrate_to_head(db_path, directory=before)
    with db.connection_scope(db_path) as connection:
        seed_exercises(connection)
        version = import_program_package(connection, package()).version
        activate_program_version(connection, version.id)
        with db.transaction(connection):
            connection.execute(
                "INSERT INTO calorie_target VALUES "
                "('t-2650', '2026-09-20', 2650, 'calibration', '2026-09-20T08:00:00+00:00'), "
                "('t-2800', '2026-10-18', 2800, 'Week 3 review', ?)",
                (STAMP,),
            )
            for week, choice, target_id in ((3, "APPLIED", "t-2800"), (5, "KEPT", None)):
                connection.execute(
                    "INSERT INTO controller_event (id, program_version_id, block_week, "
                    "decided_on, window_first, window_last, weigh_ins, trend_pct_bw_per_week, "
                    "status, recommended_action, recommended_delta_kcal, "
                    "previous_calorie_target_kcal, user_choice, new_calorie_target_id, "
                    "composition_concern, notes, recorded_at_utc) VALUES "
                    "(?, ?, ?, '2026-10-18', '2026-10-05', '2026-10-18', 14, '0.07', "
                    "'UNDER_GAIN', 'ADD_CALORIES', 150, 2650, ?, ?, 0, NULL, ?)",
                    (f"e-{week}", version.id, week, choice, target_id, STAMP),
                )
    return db_path, version.id


def _rows(connection: sqlite3.Connection, table: str) -> list[tuple[object, ...]]:
    return [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY rowid")]


def test_0007_converts_calorie_targets_by_the_source_rule_and_keeps_every_row(
    tmp_path: Path,
) -> None:
    db_path, version = _v31_database(tmp_path)
    with db.connection_scope(db_path) as connection:
        calorie_before = _rows(connection, "calorie_target")
        events_before = _rows(connection, "controller_event")

    result = migrate_to_head(db_path)

    assert result.applied == (7, 8)
    assert result.snapshot is not None and result.snapshot.name.endswith("-pre-0007.db")
    with db.connection_scope(db_path) as connection:
        # The original calorie targets are untouched.
        assert _rows(connection, "calorie_target") == calorie_before
        targets = tracking.list_macro_targets(connection)
        # 145 P, 60 F, carbohydrate (kcal - 1120) / 4 half-up, exactly as V3.2 showed it.
        assert [
            (row.id, row.effective_on, row.macros, row.legacy_calories_kcal, row.notes)
            for row in targets
        ] == [
            ("t-2800", "2026-10-18", MacroTargets(145, 420, 60), 2800, "Week 3 review"),
            ("t-2650", "2026-09-20", MacroTargets(145, 383, 60), 2650, "calibration"),
        ]
        # Every decision survives column for column; an applied one now names its target.
        events = _rows(connection, "controller_event")
        assert [row[:14] + row[15:] for row in events] == [tuple(row) for row in events_before]
        assert [(row[0], row[13], row[14]) for row in events] == [
            ("e-3", "t-2800", "t-2800"),
            ("e-5", None, None),
        ]
        decisions = controller.list_decisions(connection, version)
        assert [row.new_target for row in decisions] == [MacroTargets(145, 420, 60), None]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        # Append-only guarantees are back on the rebuilt table, and the old table is closed.
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM controller_event")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("UPDATE controller_event SET notes = 'x'")
        with pytest.raises(sqlite3.IntegrityError, match="closed"):
            connection.execute(
                "INSERT INTO calorie_target VALUES ('t-new', '2026-10-20', 3000, NULL, 'x')"
            )
    assert migrate_to_head(db_path).applied == ()


def test_an_applied_decision_must_name_its_macro_target(tmp_path: Path) -> None:
    db_path, version = _v31_database(tmp_path)
    migrate_to_head(db_path)
    with db.connection_scope(db_path) as connection, pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO controller_event (id, program_version_id, block_week, decided_on, "
            "window_first, window_last, weigh_ins, trend_pct_bw_per_week, status, "
            "recommended_action, recommended_delta_kcal, previous_calorie_target_kcal, "
            "user_choice, composition_concern, recorded_at_utc) VALUES ('e-7', ?, 7, "
            "'2026-11-15', '2026-11-02', '2026-11-15', 14, '0.07', 'UNDER_GAIN', "
            "'ADD_CALORIES', 150, 2800, 'APPLIED', 0, ?)",
            (version, STAMP),
        )
