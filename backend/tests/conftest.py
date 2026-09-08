"""Fixtures shared by the storage-facing test modules."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from fitness_lab.storage import db
from fitness_lab.storage.migrations import migrate_to_head


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    """A database file path inside the test's own directory."""
    return tmp_path / "fitness_lab.db"


@pytest.fixture
def migrated_db(db_path: Path) -> Iterator[sqlite3.Connection]:
    """A real SQLite file migrated to head, on a hardened connection."""
    migrate_to_head(db_path)
    with db.connection_scope(db_path) as connection:
        yield connection
