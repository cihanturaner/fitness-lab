"""File snapshots via ``VACUUM INTO``.

A snapshot costs ~15 lines, needs no schema, and protects against classes of loss an
audit table cannot — migration bugs, file corruption, mistaken bulk updates. M1 does
no pruning or retention: snapshots accumulate under ``data/snapshots/``, which is
gitignored with the rest of ``data/``.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

STAMP_FORMAT = "%Y%m%dT%H%M%S%fZ"
SNAPSHOT_NAME = re.compile(r"(?P<stamp>[0-9]{8}T[0-9]{12}Z)-(?P<label>[A-Za-z0-9-]+)\.db")
MANUAL_BACKUP_LABEL = "manual-backup"


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
    stamp = datetime.now(UTC).strftime(STAMP_FORMAT)
    target = directory / f"{stamp}-{label}.db"
    if target.exists():
        raise SnapshotError(f"snapshot already exists: {target}")
    try:
        connection.execute("VACUUM INTO ?", (str(target),))
    except sqlite3.Error as exc:
        raise SnapshotError(f"snapshot failed: {exc}") from exc
    verify_snapshot(target)
    return target


def verify_snapshot(path: Path) -> None:
    """Refuse a snapshot that cannot be opened read-only and pass ``quick_check``.

    A backup is only a backup once it has been read back; callers treat a failure exactly
    like a failed snapshot and do not proceed.
    """
    if not path.is_file():
        raise SnapshotError(f"snapshot verification failed: {path} does not exist")
    try:
        check = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            result = check.execute("PRAGMA quick_check").fetchall()
        finally:
            check.close()
    except sqlite3.Error as exc:
        raise SnapshotError(f"snapshot verification failed: {exc}") from exc
    if [tuple(row) for row in result] != [("ok",)]:
        raise SnapshotError(f"snapshot verification failed: quick_check returned {result}")


@dataclass(frozen=True, slots=True)
class SnapshotInfo:
    name: str
    kind: str
    created_at_utc: str
    size_bytes: int


def _kind(label: str) -> str:
    if label == MANUAL_BACKUP_LABEL:
        return "manual"
    if label.startswith("pre-delete") or label.startswith("pre-discard"):
        return "pre-delete"
    if label.startswith("pre-"):
        return "pre-migration"
    return "other"


def list_snapshots(db_path: Path) -> tuple[SnapshotInfo, ...]:
    """Snapshot files by name only (never their contents), newest first."""
    directory = snapshot_directory(db_path)
    if not directory.is_dir():
        return ()
    found: list[SnapshotInfo] = []
    for path in directory.iterdir():
        match = SNAPSHOT_NAME.fullmatch(path.name)
        if match is None or not path.is_file():
            continue
        created = datetime.strptime(match["stamp"], STAMP_FORMAT).replace(tzinfo=UTC)
        found.append(
            SnapshotInfo(
                name=path.name,
                kind=_kind(match["label"]),
                created_at_utc=created.isoformat(timespec="seconds").replace("+00:00", "Z"),
                size_bytes=path.stat().st_size,
            )
        )
    return tuple(sorted(found, key=lambda item: item.name, reverse=True))
