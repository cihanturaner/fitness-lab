"""Forward-only SQL migrations over numbered files.

``schema_migrations`` is the single source of truth for applied state; ``PRAGMA
user_version`` is deliberately not maintained alongside it. Files are never edited
after they are applied — the recorded sha256 turns an edit into a loud refusal
instead of silent divergence.
"""

from __future__ import annotations

import fcntl
import hashlib
import re
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from fitness_lab.storage import db
from fitness_lab.storage.snapshots import create_snapshot

MIGRATIONS_DIR = db.REPO_ROOT / "backend" / "migrations"
FILENAME_PATTERN = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")


class MigrationError(RuntimeError):
    """Any refusal or failure in the migration path."""


class ChecksumMismatchError(MigrationError):
    """An already-applied migration file has changed on disk."""


@dataclass(frozen=True, slots=True)
class Migration:
    version: int
    filename: str
    sha256: str
    sql: str


@dataclass(frozen=True, slots=True)
class MigrationResult:
    applied: tuple[int, ...]
    snapshot: Path | None


def _split_statements(sql: str) -> tuple[str, ...]:
    """Split a migration file into statements.

    ``Connection.executescript()`` is not usable here: it commits the open
    transaction, which would destroy the rollback guarantee this runner exists to
    provide. ``sqlite3.complete_statement`` is SQLite's own statement-boundary
    detector, so semicolons inside comments and string literals do not split.
    """
    statements: list[str] = []
    buffer = ""
    for line in sql.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            statement = buffer.strip()
            if statement:
                statements.append(statement)
            buffer = ""
    leftover = [
        line for line in buffer.splitlines() if line.strip() and not line.strip().startswith("--")
    ]
    if leftover:
        raise MigrationError(f"unterminated SQL statement: {leftover[0]!r}")
    return tuple(statements)


@contextmanager
def migration_lock(db_path: Path) -> Iterator[None]:
    """Serialize migration across processes.

    The launcher can be started twice by accident. Without this lock both processes read
    an empty schema_migrations, both take a pre-migration snapshot, and the loser dies on
    "database is locked" or on re-applying a migration whose objects already exist —
    verified: four concurrent unlocked starts produced two snapshots and three non-zero
    exits. flock is advisory, released automatically if the process dies, needs no
    dependency, and is scoped to this machine, which is the whole world for a local
    single-user desktop application.
    """
    lock_path = db_path.with_name(db_path.name + ".migrate.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("w")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


def discover_migrations(directory: Path = MIGRATIONS_DIR) -> tuple[Migration, ...]:
    migrations: list[Migration] = []
    seen: set[int] = set()
    for path in sorted(directory.glob("*.sql")):
        match = FILENAME_PATTERN.match(path.name)
        if match is None:
            raise MigrationError(f"migration filename must be NNNN_description.sql: {path.name}")
        version = int(match.group(1))
        if version in seen:
            raise MigrationError(f"duplicate migration version: {version}")
        seen.add(version)
        sql = path.read_text(encoding="utf-8")
        migrations.append(
            Migration(
                version=version,
                filename=path.name,
                sha256=hashlib.sha256(sql.encode("utf-8")).hexdigest(),
                sql=sql,
            )
        )
    return tuple(sorted(migrations, key=lambda migration: migration.version))


def ensure_schema_migrations(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version        INTEGER PRIMARY KEY,
            filename       TEXT    NOT NULL,
            sha256         TEXT    NOT NULL,
            applied_at_utc TEXT    NOT NULL
        ) STRICT
        """
    )


def applied_versions(connection: sqlite3.Connection) -> dict[int, str]:
    rows = connection.execute("SELECT version, sha256 FROM schema_migrations").fetchall()
    return {int(row["version"]): str(row["sha256"]) for row in rows}


def pending_migrations(
    connection: sqlite3.Connection, migrations: Sequence[Migration]
) -> tuple[Migration, ...]:
    applied = applied_versions(connection)
    known = {migration.version for migration in migrations}
    for version in sorted(applied):
        if version not in known:
            raise MigrationError(
                f"applied migration {version} is missing from the migrations directory"
            )
    pending: list[Migration] = []
    for migration in migrations:
        recorded = applied.get(migration.version)
        if recorded is None:
            pending.append(migration)
        elif recorded != migration.sha256:
            raise ChecksumMismatchError(
                f"{migration.filename} changed after it was applied "
                f"(recorded {recorded}, on disk {migration.sha256}); "
                "migrations are forward-only and must never be edited"
            )
    return tuple(pending)


def _apply(connection: sqlite3.Connection, migration: Migration) -> None:
    try:
        with db.transaction(connection):
            for statement in _split_statements(migration.sql):
                connection.execute(statement)
            violations = connection.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise MigrationError(
                    f"{migration.filename} leaves foreign key violations: "
                    f"{[tuple(row) for row in violations]}"
                )
            connection.execute(
                "INSERT INTO schema_migrations (version, filename, sha256, applied_at_utc) "
                "VALUES (?, ?, ?, ?)",
                (
                    migration.version,
                    migration.filename,
                    migration.sha256,
                    datetime.now(UTC).isoformat(timespec="seconds"),
                ),
            )
    except sqlite3.Error as exc:
        raise MigrationError(f"{migration.filename} failed: {exc}") from exc


def migrate_to_head(
    path: Path | None = None, *, directory: Path = MIGRATIONS_DIR
) -> MigrationResult:
    """Bring the database at ``path`` up to the newest migration.

    Everything from discovery to the last applied statement happens under the migration
    lock, so a second process starting at the same time waits and then re-discovers
    state instead of acting on a pending list that went stale while it waited. Never
    drops or recreates anything: the runner only applies pending files.
    """
    db_path = path if path is not None else db.database_path()
    with migration_lock(db_path):
        db.bootstrap_database(db_path)
        migrations = discover_migrations(directory)
        with db.connection_scope(db_path) as connection:
            ensure_schema_migrations(connection)
            pending = pending_migrations(connection, migrations)
            if not pending:
                return MigrationResult(applied=(), snapshot=None)
            # Discovery first, snapshot second, both under the lock: starting the app at
            # head must not accumulate a snapshot per launch, and a process that waited
            # for the lock must not snapshot against a pending list it read earlier.
            # One snapshot covers the whole sequence.
            snapshot = create_snapshot(connection, db_path, f"pre-{pending[0].version:04d}")
            for migration in pending:
                _apply(connection, migration)
            return MigrationResult(
                applied=tuple(migration.version for migration in pending), snapshot=snapshot
            )
