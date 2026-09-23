"""SQLite access for fitness-lab.

M0 scope only: this module proves a real SQLite round-trip. The single
``m0_technical_check`` table is a technical fixture, not part of the fitness
domain schema, and now lives in ``backend/migrations/0001_baseline.sql``.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

# backend/src/fitness_lab/storage/db.py -> repository root is 5 levels up.
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "fitness_lab.db"

M0_TOKEN = "sqlite-roundtrip-ok"


@dataclass(frozen=True, slots=True)
class TechnicalCheck:
    """One row of the M0 technical table, plus the engine that served it."""

    row_id: int
    token: str
    created_at: str
    sqlite_version: str


def database_path() -> Path:
    """Resolve the SQLite file path (``FITNESS_LAB_DB`` overrides the default)."""
    override = os.environ.get("FITNESS_LAB_DB")
    return Path(override).expanduser().resolve() if override else DEFAULT_DB_PATH


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open a hardened connection.

    ``foreign_keys`` is the critical one: it is OFF by default, and without it every
    ON DELETE RESTRICT/CASCADE in the schema is silently inert. ``isolation_level=None``
    hands transaction control to us, which the migration runner and ``VACUUM INTO``
    both require.
    """
    db_path = path if path is not None else database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA synchronous = FULL")
    return connection


@contextmanager
def connection_scope(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    """A hardened connection that is actually closed afterwards."""
    connection = connect(path)
    try:
        yield connection
    finally:
        connection.close()


@contextmanager
def transaction(connection: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """One explicit transaction. Rolls back and re-raises on any exception."""
    connection.execute("BEGIN")
    try:
        yield connection
    except BaseException:
        connection.execute("ROLLBACK")
        raise
    connection.execute("COMMIT")


@contextmanager
def immediate_transaction(connection: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """A transaction that takes the write lock up front (``BEGIN IMMEDIATE``).

    Required for read-then-write sequences that must not race: a deferred transaction
    that reads first and upgrades to a writer later fails with SQLITE_BUSY in WAL mode
    when another writer committed in between, instead of waiting. Taking the lock first
    makes a second writer — another thread, another process, a retried request — wait
    for ``busy_timeout`` and then read the committed state.
    """
    connection.execute("BEGIN IMMEDIATE")
    try:
        yield connection
    except BaseException:
        connection.execute("ROLLBACK")
        raise
    connection.execute("COMMIT")


def bootstrap_database(path: Path | None = None) -> None:
    """Persistent database configuration, set once — not routine connection state.

    WAL is recorded in the file header and read back by any later connection, so
    re-issuing it per connection would be noise.
    """
    with connection_scope(path) as connection:
        connection.execute("PRAGMA journal_mode = WAL")


def read_technical_check(path: Path | None = None) -> TechnicalCheck:
    """Read the M0 row back out of SQLite. Raises if the row is missing."""
    with connection_scope(path) as connection:
        row = connection.execute(
            "SELECT id, token, created_at FROM m0_technical_check WHERE id = 1"
        ).fetchone()
        if row is None:
            raise LookupError("m0_technical_check row 1 is missing; run init_db() first")
        version_row = connection.execute("SELECT sqlite_version() AS v").fetchone()
    return TechnicalCheck(
        row_id=int(row["id"]),
        token=str(row["token"]),
        created_at=str(row["created_at"]),
        sqlite_version=str(version_row["v"]),
    )
