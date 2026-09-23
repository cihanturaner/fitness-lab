"""Snapshot policy: exactly one snapshot per pending sequence, none when at head."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from fitness_lab.storage import db
from fitness_lab.storage.migrations import ChecksumMismatchError, migrate_to_head
from fitness_lab.storage.snapshots import (
    SnapshotError,
    create_snapshot,
    snapshot_directory,
    verify_snapshot,
)

CREATE_ONE = "CREATE TABLE one (id INTEGER PRIMARY KEY, label TEXT NOT NULL) STRICT;\n"
CREATE_TWO = "CREATE TABLE two (id INTEGER PRIMARY KEY) STRICT;\n"


def write_migration(directory: Path, filename: str, sql: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / filename
    path.write_text(sql, encoding="utf-8")
    return path


def snapshots(db_path: Path) -> list[Path]:
    directory = snapshot_directory(db_path)
    return sorted(directory.glob("*.db")) if directory.is_dir() else []


def test_no_pending_migrations_creates_no_snapshot(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)
    before = snapshots(db_path)

    result = migrate_to_head(db_path, directory=directory)

    assert result.snapshot is None
    assert snapshots(db_path) == before


def test_starting_at_head_repeatedly_never_accumulates_snapshots(
    tmp_path: Path, db_path: Path
) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)

    for _ in range(5):
        migrate_to_head(db_path, directory=directory)

    assert len(snapshots(db_path)) == 1


def test_a_pending_sequence_creates_exactly_one_snapshot(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    write_migration(directory, "0002_two.sql", CREATE_TWO)

    result = migrate_to_head(db_path, directory=directory)

    assert result.applied == (1, 2)
    assert result.snapshot is not None
    assert snapshots(db_path) == [result.snapshot]


def test_the_snapshot_is_named_for_the_first_pending_version(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)
    write_migration(directory, "0002_two.sql", CREATE_TWO)

    result = migrate_to_head(db_path, directory=directory)

    assert result.snapshot is not None
    assert result.snapshot.name.endswith("-pre-0002.db")


def test_the_snapshot_is_a_readable_sqlite_database(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)

    result = migrate_to_head(db_path, directory=directory)

    assert result.snapshot is not None
    raw = sqlite3.connect(result.snapshot)
    try:
        assert raw.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        raw.close()


def test_the_snapshot_captures_the_pre_migration_state(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)
    with db.connection_scope(db_path) as connection:
        connection.execute("INSERT INTO one (id, label) VALUES (1, 'before')")
    write_migration(directory, "0002_two.sql", CREATE_TWO)

    result = migrate_to_head(db_path, directory=directory)

    assert result.snapshot is not None
    raw = sqlite3.connect(result.snapshot)
    try:
        names = {row[0] for row in raw.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "one" in names
        assert "two" not in names
        assert raw.execute("SELECT label FROM one WHERE id = 1").fetchone()[0] == "before"
    finally:
        raw.close()


def test_a_refused_migration_creates_no_snapshot(tmp_path: Path, db_path: Path) -> None:
    """Checksum refusal happens during discovery, before anything is snapshotted."""
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)
    write_migration(directory, "0001_one.sql", CREATE_ONE + "-- edited\n")
    before = snapshots(db_path)

    with pytest.raises(ChecksumMismatchError):
        migrate_to_head(db_path, directory=directory)

    assert snapshots(db_path) == before


def test_create_snapshot_refuses_to_run_inside_a_transaction(db_path: Path) -> None:
    with db.connection_scope(db_path) as connection:
        connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")
        connection.execute("BEGIN")
        with pytest.raises(SnapshotError, match="transaction"):
            create_snapshot(connection, db_path, "pre-0001")
        connection.execute("ROLLBACK")


def test_snapshots_taken_in_quick_succession_do_not_collide(db_path: Path) -> None:
    with db.connection_scope(db_path) as connection:
        connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")
        first = create_snapshot(connection, db_path, "pre-0001")
        second = create_snapshot(connection, db_path, "pre-0001")

    assert first != second
    assert first.exists() and second.exists()


def test_a_snapshot_that_cannot_be_written_raises_snapshot_error(db_path: Path) -> None:
    """Callers guard one failure type; VACUUM INTO's sqlite3 error is wrapped into it."""
    with db.connection_scope(db_path) as connection:
        connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")
        directory = snapshot_directory(db_path)
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o500)
        try:
            with pytest.raises(SnapshotError, match="snapshot failed"):
                create_snapshot(connection, db_path, "pre-0001")
        finally:
            directory.chmod(0o700)


def test_a_snapshot_directory_blocked_by_a_file_raises_snapshot_error(db_path: Path) -> None:
    with db.connection_scope(db_path) as connection:
        connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")
        snapshot_directory(db_path).write_text("a regular file where the directory belongs")

        with pytest.raises(SnapshotError, match="snapshot directory unusable"):
            create_snapshot(connection, db_path, "pre-0001")


def test_a_written_snapshot_is_verified_readable(db_path: Path) -> None:
    with db.connection_scope(db_path) as connection:
        connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")
        target = create_snapshot(connection, db_path, "pre-0001")
    verify_snapshot(target)  # does not raise


def test_an_unreadable_snapshot_fails_verification(tmp_path: Path) -> None:
    broken = tmp_path / "broken.db"
    broken.write_bytes(b"SQLite format 3\x00" + b"\xff" * 4096)
    with pytest.raises(SnapshotError, match="verification"):
        verify_snapshot(broken)
    with pytest.raises(SnapshotError, match="verification"):
        verify_snapshot(tmp_path / "missing.db")
