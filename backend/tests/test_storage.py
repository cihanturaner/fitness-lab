"""SQLite round-trip: what we read back must actually come from the database."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from fitness_lab.storage import db
from fitness_lab.storage.migrations import migrate_to_head


def test_migrate_to_head_creates_and_seeds_the_technical_table(tmp_path: Path) -> None:
    db_file = tmp_path / "roundtrip.db"
    migrate_to_head(db_file)

    assert db_file.exists()
    with sqlite3.connect(db_file) as raw:
        rows = raw.execute("SELECT id, token FROM m0_technical_check").fetchall()
    assert rows == [(1, db.M0_TOKEN)]


def test_read_technical_check_returns_the_stored_row(tmp_path: Path) -> None:
    db_file = tmp_path / "roundtrip.db"
    migrate_to_head(db_file)

    check = db.read_technical_check(db_file)

    assert check.row_id == 1
    assert check.token == db.M0_TOKEN
    assert check.created_at
    assert check.sqlite_version


def test_migrate_to_head_is_idempotent(tmp_path: Path) -> None:
    db_file = tmp_path / "roundtrip.db"
    migrate_to_head(db_file)
    first = db.read_technical_check(db_file)
    migrate_to_head(db_file)

    assert db.read_technical_check(db_file) == first


def test_read_without_init_raises(tmp_path: Path) -> None:
    with pytest.raises(sqlite3.OperationalError):
        db.read_technical_check(tmp_path / "missing.db")


def test_database_path_honours_env_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FITNESS_LAB_DB", str(tmp_path / "custom.db"))
    assert db.database_path() == (tmp_path / "custom.db").resolve()
