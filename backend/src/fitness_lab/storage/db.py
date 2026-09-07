"""SQLite access for fitness-lab.

M0 scope only: this module proves a real SQLite round-trip. The single
``m0_technical_check`` table is a technical fixture, not part of the fitness
domain schema, and will be dropped once real migrations arrive.
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
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
    """Open a connection with row access by column name."""
    db_path = path if path is not None else database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def init_db(path: Path | None = None) -> None:
    """Create and seed the M0 technical table if it is not there yet."""
    with connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS m0_technical_check (
                id         INTEGER PRIMARY KEY CHECK (id = 1),
                token      TEXT    NOT NULL,
                created_at TEXT    NOT NULL
            )
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO m0_technical_check (id, token, created_at) VALUES (1, ?, ?)",
            (M0_TOKEN, datetime.now(UTC).isoformat(timespec="seconds")),
        )


def read_technical_check(path: Path | None = None) -> TechnicalCheck:
    """Read the M0 row back out of SQLite. Raises if the row is missing."""
    with connect(path) as connection:
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
