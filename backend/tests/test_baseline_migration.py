"""0001_baseline adopts the real M0 database instead of resetting it."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fitness_lab.storage import db
from fitness_lab.storage.migrations import applied_versions, migrate_to_head
from fitness_lab.storage.snapshots import snapshot_directory

LEGACY_DDL = """
CREATE TABLE IF NOT EXISTS m0_technical_check (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    token      TEXT    NOT NULL,
    created_at TEXT    NOT NULL
)
"""


def make_legacy_m0_database(db_file: Path, token: str, created_at: str) -> None:
    """Reproduce exactly what M0's init_db() left on disk: no schema_migrations, no WAL."""
    raw = sqlite3.connect(db_file)
    try:
        raw.execute(LEGACY_DDL)
        raw.execute(
            "INSERT OR IGNORE INTO m0_technical_check (id, token, created_at) VALUES (1, ?, ?)",
            (token, created_at),
        )
        raw.commit()
    finally:
        raw.close()


def test_baseline_creates_the_technical_table_on_an_empty_database(db_path: Path) -> None:
    result = migrate_to_head(db_path)

    assert 1 in result.applied
    check = db.read_technical_check(db_path)
    assert check.row_id == 1
    assert check.token == db.M0_TOKEN
    assert check.created_at


def test_a_legacy_m0_database_is_adopted_without_losing_its_row(db_path: Path) -> None:
    make_legacy_m0_database(db_path, "legacy-token", "2026-09-07T19:28:21+00:00")

    migrate_to_head(db_path)

    check = db.read_technical_check(db_path)
    assert check.token == "legacy-token"
    assert check.created_at == "2026-09-07T19:28:21+00:00"


def test_adopting_a_legacy_database_records_the_baseline_version(db_path: Path) -> None:
    make_legacy_m0_database(db_path, "legacy-token", "2026-09-07T19:28:21+00:00")

    migrate_to_head(db_path)

    with db.connection_scope(db_path) as connection:
        assert 1 in applied_versions(connection)


def test_adopting_a_legacy_database_snapshots_it_first(db_path: Path) -> None:
    make_legacy_m0_database(db_path, "legacy-token", "2026-09-07T19:28:21+00:00")

    result = migrate_to_head(db_path)

    assert result.snapshot is not None
    assert len(list(snapshot_directory(db_path).glob("*.db"))) == 1
    raw = sqlite3.connect(result.snapshot)
    try:
        assert raw.execute("SELECT token FROM m0_technical_check").fetchone()[0] == "legacy-token"
    finally:
        raw.close()


def test_adopting_a_legacy_database_switches_it_to_wal(db_path: Path) -> None:
    make_legacy_m0_database(db_path, "legacy-token", "2026-09-07T19:28:21+00:00")

    migrate_to_head(db_path)

    raw = sqlite3.connect(db_path)
    try:
        assert raw.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    finally:
        raw.close()


def test_rerunning_the_baseline_changes_nothing(db_path: Path) -> None:
    migrate_to_head(db_path)
    first = db.read_technical_check(db_path)

    result = migrate_to_head(db_path)

    assert result.applied == ()
    assert db.read_technical_check(db_path) == first
