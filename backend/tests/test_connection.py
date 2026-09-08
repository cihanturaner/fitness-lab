"""Connection hardening: the pragmas that make the schema's guarantees real."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from fitness_lab.storage import db


def test_connect_enables_foreign_keys(tmp_path: Path) -> None:
    """The M0 defect: without this, every ON DELETE RESTRICT/CASCADE is inert."""
    with db.connection_scope(tmp_path / "c.db") as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_connect_uses_explicit_transaction_control(tmp_path: Path) -> None:
    with db.connection_scope(tmp_path / "c.db") as connection:
        assert connection.isolation_level is None
        connection.execute("BEGIN")
        assert connection.in_transaction
        connection.execute("ROLLBACK")


def test_connect_sets_busy_timeout_and_synchronous(tmp_path: Path) -> None:
    with db.connection_scope(tmp_path / "c.db") as connection:
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        assert connection.execute("PRAGMA synchronous").fetchone()[0] == 2


def test_connect_returns_rows_addressable_by_column_name(tmp_path: Path) -> None:
    with db.connection_scope(tmp_path / "c.db") as connection:
        row = connection.execute("SELECT 1 AS answer").fetchone()
        assert row["answer"] == 1


def test_bootstrap_persists_wal_for_later_connections(tmp_path: Path) -> None:
    """WAL is database state, set once; a fresh connection that sets nothing reads it back."""
    db_file = tmp_path / "c.db"
    db.bootstrap_database(db_file)

    raw = sqlite3.connect(db_file)
    try:
        assert raw.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    finally:
        raw.close()


def test_bootstrap_is_idempotent(tmp_path: Path) -> None:
    db_file = tmp_path / "c.db"
    db.bootstrap_database(db_file)
    db.bootstrap_database(db_file)

    with db.connection_scope(db_file) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_bootstrap_converts_a_legacy_non_wal_database(tmp_path: Path) -> None:
    """The real data/fitness_lab.db is in journal_mode=delete and must be converted."""
    db_file = tmp_path / "legacy.db"
    raw = sqlite3.connect(db_file)
    try:
        raw.execute("CREATE TABLE legacy (id INTEGER PRIMARY KEY)")
        raw.commit()
        assert raw.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    finally:
        raw.close()

    db.bootstrap_database(db_file)

    with db.connection_scope(db_file) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert connection.execute("SELECT count(*) FROM legacy").fetchone()[0] == 0


def test_transaction_commits_on_success(tmp_path: Path) -> None:
    db_file = tmp_path / "c.db"
    with db.connection_scope(db_file) as connection:
        connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")
        with db.transaction(connection):
            connection.execute("INSERT INTO t (id) VALUES (1)")
        assert not connection.in_transaction

    with db.connection_scope(db_file) as connection:
        assert connection.execute("SELECT count(*) FROM t").fetchone()[0] == 1


def test_transaction_rolls_back_and_reraises(tmp_path: Path) -> None:
    db_file = tmp_path / "c.db"
    with db.connection_scope(db_file) as connection:
        connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")
        with pytest.raises(RuntimeError, match="boom"), db.transaction(connection):
            connection.execute("INSERT INTO t (id) VALUES (1)")
            raise RuntimeError("boom")
        assert not connection.in_transaction
        assert connection.execute("SELECT count(*) FROM t").fetchone()[0] == 0


def test_connection_scope_closes_the_connection(tmp_path: Path) -> None:
    with db.connection_scope(tmp_path / "c.db") as connection:
        pass
    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute("SELECT 1")
