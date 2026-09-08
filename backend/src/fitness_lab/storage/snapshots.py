"""File snapshots via ``VACUUM INTO``.

A snapshot costs ~15 lines, needs no schema, and protects against classes of loss an
audit table cannot — migration bugs, file corruption, mistaken bulk updates. M1 does
no pruning or retention: snapshots accumulate under ``data/snapshots/``, which is
gitignored with the rest of ``data/``.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path


class SnapshotError(RuntimeError):
    """A snapshot could not be taken."""


def snapshot_directory(db_path: Path) -> Path:
    return db_path.parent / "snapshots"


def create_snapshot(connection: sqlite3.Connection, db_path: Path, label: str) -> Path:
    """Write a consistent single-file copy of the database and return its path."""
    if connection.in_transaction:
        raise SnapshotError("a snapshot cannot be taken inside an open transaction")
    directory = snapshot_directory(db_path)
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise SnapshotError(f"snapshot directory unusable: {exc}") from exc
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    target = directory / f"{stamp}-{label}.db"
    if target.exists():
        raise SnapshotError(f"snapshot already exists: {target}")
    try:
        connection.execute("VACUUM INTO ?", (str(target),))
    except sqlite3.Error as exc:
        raise SnapshotError(f"snapshot failed: {exc}") from exc
    return target
