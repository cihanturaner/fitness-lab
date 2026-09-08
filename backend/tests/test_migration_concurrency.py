"""Two launchers started at once must not both migrate.

These tests start real subprocesses on purpose: flock is an inter-process mechanism, and a
threads-in-one-process test would prove nothing about the case this guards against.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"

# The child migrates, then prints its result as JSON. It waits for a shared wall-clock
# deadline so all workers are released at the same instant. Parent and child MUST use the
# same clock: handing a time.time() deadline to a child that waits on time.monotonic()
# never fires.
CHILD_PROGRAM = """
import json, sys, time
from pathlib import Path
from fitness_lab.storage.migrations import migrate_to_head

db_path, directory, release_at = Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3])
while time.time() < release_at:
    time.sleep(0.001)
result = migrate_to_head(db_path, directory=directory)
print(json.dumps({
    "applied": list(result.applied),
    "snapshot": None if result.snapshot is None else result.snapshot.name,
}))
"""

# Slow enough that the workers genuinely overlap rather than finishing one after another.
SLOW_MIGRATION = (
    "CREATE TABLE slow (id INTEGER PRIMARY KEY) STRICT;\n"
    "INSERT INTO slow (id) WITH RECURSIVE counter(x) AS "
    "(SELECT 1 UNION ALL SELECT x + 1 FROM counter WHERE x < 200000) SELECT x FROM counter;\n"
)
SECOND_MIGRATION = "CREATE TABLE second (id INTEGER PRIMARY KEY) STRICT;\n"


@pytest.fixture
def migrations_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "migrations"
    directory.mkdir()
    (directory / "0001_slow.sql").write_text(SLOW_MIGRATION, encoding="utf-8")
    (directory / "0002_second.sql").write_text(SECOND_MIGRATION, encoding="utf-8")
    return directory


def run_concurrent_migrations(
    db_path: Path, directory: Path, *, workers: int = 4
) -> list[dict[str, object]]:
    """Start `workers` real processes that all migrate the same database at once."""
    release_at = time.time() + 0.5
    environment = {**os.environ, "PYTHONPATH": str(SRC)}
    processes = [
        subprocess.Popen(
            [sys.executable, "-c", CHILD_PROGRAM, str(db_path), str(directory), str(release_at)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=environment,
        )
        for _ in range(workers)
    ]
    results: list[dict[str, object]] = []
    for process in processes:
        stdout, stderr = process.communicate(timeout=120)
        assert process.returncode == 0, f"a migration process failed:\n{stderr}"
        results.append(json.loads(stdout.strip()))
    return results


def test_only_one_concurrent_start_applies_the_pending_sequence(
    db_path: Path, migrations_dir: Path
) -> None:
    results = run_concurrent_migrations(db_path, migrations_dir)

    appliers = [result for result in results if result["applied"]]
    assert len(appliers) == 1, f"more than one process applied migrations: {results}"
    assert appliers[0]["applied"] == [1, 2]


def test_the_processes_that_waited_observe_head_rather_than_a_stale_pending_list(
    db_path: Path, migrations_dir: Path
) -> None:
    """The losers must re-discover state after the lock, not replay what they saw before."""
    results = run_concurrent_migrations(db_path, migrations_dir)

    assert sum(1 for result in results if result["applied"] == []) == len(results) - 1


def test_concurrent_starts_record_each_version_exactly_once_and_leave_a_valid_database(
    db_path: Path, migrations_dir: Path
) -> None:
    import sqlite3

    run_concurrent_migrations(db_path, migrations_dir)

    raw = sqlite3.connect(db_path)
    try:
        rows = raw.execute("SELECT version FROM schema_migrations ORDER BY version")
        versions = [row[0] for row in rows]
        assert versions == [1, 2]
        assert raw.execute("SELECT count(*) FROM slow").fetchone()[0] == 200000
        assert raw.execute("PRAGMA foreign_key_check").fetchall() == []
        assert raw.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        raw.close()
