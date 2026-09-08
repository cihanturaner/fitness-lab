# M1 — Domain Model and Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable performed-training foundation for fitness-lab — hardened SQLite
connections, a deterministic forward-only migration runner, the approved performed-training
schema, a pure kilogram-only domain model with completion validation, concrete persistence
functions, and the emergency raw-capture contract plus its validator — without breaking any
verified M0 behaviour.

**Architecture:** Dependency direction stays one-way: `domain -> storage -> api -> web`.
`domain` is pure (no I/O, no `sqlite3`, no `fastapi`) and speaks **kilograms** as `Decimal`;
`storage` is the only layer that knows SQLite and the only layer that knows **integer grams**;
`api` changes in exactly one place (its `lifespan` calls the migration runner instead of the
removed `init_db()`); `web` is untouched. Persistence functions are concrete module-level
functions, not repository interfaces or a service layer.

**Tech Stack:** Python 3.13.1, uv, SQLite 3.53.4 (stdlib `sqlite3`), FastAPI, pytest,
ruff 0.16.x, mypy strict. No new runtime dependencies are added by this milestone.

**Spec:** `docs/superpowers/specs/2026-09-07-m1-domain-persistence-design.md`
(APPROVED, commit `322a711`). The spec is the source of truth; this plan implements it and
never re-decides it.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Units are kilograms.** SQLite stores integer grams; the domain, docs and capture contract
  speak kilograms. There is no lb support anywhere in the system.
- **`float` is forbidden at the kg/g boundary** — `TypeError`. Accept `str`, `int`,
  `decimal.Decimal`, `None` only. Sub-gram precision is **rejected, never rounded**.
- **`NULL` is never collapsed into `0`** or into any other default, in the schema, the domain,
  the mapper, or the tests.
- **`planned` is not `performed`.** M1 stores only performed facts. No program/planned tables.
- **`performed_at` is not `entered_at`.** `workout.performed_on` / `performed_time_local` are
  civil local time; `entered_at_utc` / `updated_at_utc` are UTC ISO-8601.
- **All new tables are `STRICT`.** The one exception is `m0_technical_check` in
  `0001_baseline.sql`, which must reproduce the legacy M0 table byte-compatibly (it is not
  STRICT); adding STRICT there would make `CREATE TABLE IF NOT EXISTS` silently diverge from
  the legacy file.
- **`PRAGMA foreign_keys = ON` on every connection.** Without it every `ON DELETE RESTRICT` and
  `CASCADE` in the schema is inert.
- **`PRAGMA journal_mode = WAL` is set once at bootstrap**, never as routine per-connection
  state.
- **Migrations are numbered `NNNN_description.sql`, forward-only, and never edited after being
  applied.** `schema_migrations` is the single source of truth for applied state;
  `PRAGMA user_version` is deliberately not maintained.
- **A snapshot is created only when migrations are pending** — exactly one per pending
  sequence, and none at all when there is nothing to apply. No pruning or retention in M1.
- **No generic table-rebuild helper.** Every M1 migration is purely additive.
- **No new API surface, no UI, no e1RM/PR/volume caches, no `movement_family`, no importer.**
- **The M0 technical surface survives M1**: `m0_technical_check`, `/api/ping-db`, the React
  page and the Playwright smoke test all keep working.
- **Lint/type gates:** ruff `line-length = 100`, lint rules `E,F,I,UP,B,SIM,ANN` (so **every**
  function, including test functions, needs full annotations and `-> None`); mypy `strict = true`
  with `warn_unreachable`, covering `src` **and** `tests`.
- **Every backend command runs from `backend/`** (`cd backend && uv run ...`).
- **SQLite database files and `data/` are never committed.** `data/` is already gitignored,
  which covers `data/snapshots/`.

---

## Verified implementation constraints discovered during planning

These were executed against this machine's Python 3.13.1 / SQLite 3.53.4 while writing the
plan. They are mechanism facts, not spec changes.

1. **`Connection.executescript()` commits the open transaction.** Verified: after
   `conn.execute("BEGIN")`, calling `executescript(...)` leaves `conn.in_transaction == False`
   and a subsequent `ROLLBACK` fails with `OperationalError: cannot rollback - no transaction
   is active`, with the DDL already committed. The spec requires each migration to apply inside
   **one explicit transaction** that rolls back on failure (§12.2), so the runner **must not**
   use `executescript`. It splits the file with `sqlite3.complete_statement()` and executes the
   statements individually inside its own `BEGIN`/`COMMIT`. Verified that this splitter handles
   comments containing `;` and string literals containing `;`.
2. **Constructing a `PRAGMA foreign_key_check` violation while `foreign_keys = ON`** requires a
   `DEFERRABLE INITIALLY DEFERRED` foreign key: with immediate enforcement, bad inserts and
   `DROP TABLE parent` raise at statement time instead. Verified that a deferred violation is
   invisible to statement-level enforcement and *is* reported by `PRAGMA foreign_key_check`
   inside the open transaction — which is what makes the runner's pre-commit check testable.
3. **Exception types the tests assert** (all verified against the §10 DDL):
   - duplicate exercise identity, blank `equipment_label`, bad `performed_on`, invalid
     `set_type` code, deleting a referenced exercise, duplicate `(workout_id, set_order)`,
     negative `reps`, and text into `load_g` under `STRICT` → **`sqlite3.IntegrityError`**
     (STRICT reports `cannot store TEXT value in INTEGER column performed_set.load_g`).
   - `INSERT`/`UPDATE` against the generated column `load_kg` → **`sqlite3.OperationalError`**
     (`cannot INSERT into generated column "load_kg"` /
     `cannot UPDATE generated column "load_kg"`).
   - `rir = -1` stores and reads back as `-1`; `load_g = 102500` reads back as `load_kg = 102.5`.
4. **The existing `data/fitness_lab.db` is real and is in `journal_mode = delete`**, holds only
   `m0_technical_check` with token `sqlite-roundtrip-ok`, and has no `schema_migrations` table.
   Bootstrap must therefore switch a legacy file to WAL, and adoption must not reset it.
5. **`VACUUM INTO` requires no open transaction** and produces a readable single-file copy
   (`PRAGMA integrity_check` → `ok`).

### One recorded resolution of a spec-internal tension

Spec §12.4 requires `init_db()`'s inline DDL to be removed and the API `lifespan` to call the
migration runner. Spec §19 also says "all existing M0 backend tests must pass unchanged". Those
two cannot both hold literally, because four tests in `backend/tests/test_storage.py` call
`init_db()` by name. **Resolution:** the M0 *behaviour* is preserved exactly — the
`m0_technical_check` row, `/api/ping-db`, `backend/tests/test_api.py`, the frontend and the
Playwright smoke test are all unchanged and must stay green — while the four storage unit tests
that name the deleted function are retargeted at `migrate_to_head()` in Task 5, keeping every
assertion about the row identical. No production behaviour visible to the API, the UI or the
E2E suite changes.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `backend/src/fitness_lab/storage/migrations.py` | Migration discovery, checksum enforcement, transactional apply, `schema_migrations` bookkeeping |
| `backend/src/fitness_lab/storage/snapshots.py` | `VACUUM INTO` snapshots (used by the migration runner and by complete-workout deletion) |
| `backend/src/fitness_lab/storage/exercises.py` | Exercise row ↔ domain mapping and CRUD |
| `backend/src/fitness_lab/storage/workouts.py` | Workout and performed-set mapping, CRUD, renumbering, deletion policy |
| `backend/src/fitness_lab/domain/units.py` | Canonical exact kg↔gram mapper and kg display formatting |
| `backend/src/fitness_lab/domain/models.py` | `Exercise`, `Workout`, `PerformedSet`, enums, id generation, identity normalization, exercise operations |
| `backend/src/fitness_lab/domain/completion.py` | Set renumbering and completion rules C1–C4 plus advisories |
| `backend/src/fitness_lab/domain/capture.py` | Pure validator for the emergency raw-capture contract |
| `backend/migrations/0001_baseline.sql` | Adopts the existing M0 database without a reset |
| `backend/migrations/0002_performed_training.sql` | The §10 performed-training schema and `set_type` seed |
| `docs/contracts/raw-capture-v1.md` | The emergency raw-capture contract (v1) |
| `docs/contracts/raw-capture-v1.example.json` | The documented example, loaded by a test so doc and code cannot drift |
| `backend/tests/conftest.py` | Shared `db_path` / `migrated_db` fixtures |
| `backend/tests/test_connection.py` | Connection hardening assertions |
| `backend/tests/test_migrations.py` | Migration runner behaviour against synthetic migration directories |
| `backend/tests/test_snapshots.py` | Snapshot policy |
| `backend/tests/test_baseline_migration.py` | Real `0001` against empty and legacy M0 databases |
| `backend/tests/test_units.py` | kg↔gram exactness and rejections |
| `backend/tests/test_domain_models.py` | Entities, identity normalization, exercise operations |
| `backend/tests/test_completion.py` | C1–C4, advisories, reopen |
| `backend/tests/test_schema_constraints.py` | The §10 DDL constraint matrix against a real migrated database |
| `backend/tests/test_exercises.py` | Exercise persistence |
| `backend/tests/test_workouts.py` | Workout/performed-set persistence round-trips |
| `backend/tests/test_deletion_policy.py` | Correction and deletion policy (§14) |
| `backend/tests/test_capture_contract.py` | Capture validator |

**Modified**

| Path | Change |
|---|---|
| `backend/src/fitness_lab/storage/db.py` | Hardened `connect()`, add `connection_scope()`, `transaction()`, `bootstrap_database()`; **remove** `init_db()`; keep `database_path()`, `read_technical_check()`, `TechnicalCheck`, `M0_TOKEN`, `REPO_ROOT` |
| `backend/src/fitness_lab/api/app.py` | `lifespan` calls `migrations.migrate_to_head()` instead of `db.init_db()` |
| `backend/tests/test_architecture.py` | Add the storage-layer guard and the `load_g`-must-not-leak-into-domain guard |
| `backend/tests/test_storage.py` | Retarget the four `init_db()` tests at `migrate_to_head()`, assertions unchanged |

**Deliberately not created:** no `repositories/` abstraction, no service layer, no
`raw_capture_import` table, no importer, no API routes, no frontend files, no rebuild helper,
no snapshot pruning.

---

## Task order and dependencies

```
1 connection hardening
2 architecture guards
3 migration runner core            (needs 1)
4 snapshot policy                  (needs 3)
5 baseline migration + adoption    (needs 4)   <- M0 database adopted here
6 kg<->gram mapper                 (needs 2)
7 domain models                    (needs 6)
8 completion rules C1-C4           (needs 7)
9 performed-training migration     (needs 5)
10 exercise persistence            (needs 7, 9)
11 workout / performed-set persistence (needs 8, 9, 10)
12 correction & deletion policy    (needs 4, 11)
13 capture contract + validator    (needs 6, 7)
14 full milestone regression       (needs all)
```

No cycles. Every task ends on a commit that leaves the repository green.

---

### Task 1: Connection hardening

**Files:**
- Modify: `backend/src/fitness_lab/storage/db.py`
- Test: `backend/tests/test_connection.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `db.connect(path: Path | None = None) -> sqlite3.Connection`
  - `db.connection_scope(path: Path | None = None) -> Iterator[sqlite3.Connection]` (context manager, closes the connection)
  - `db.transaction(connection: sqlite3.Connection) -> Iterator[sqlite3.Connection]` (context manager; `BEGIN` / `COMMIT` / `ROLLBACK`)
  - `db.bootstrap_database(path: Path | None = None) -> None` (persists WAL once)
  - unchanged: `db.REPO_ROOT`, `db.DEFAULT_DB_PATH`, `db.M0_TOKEN`, `db.TechnicalCheck`, `db.database_path()`, `db.read_technical_check()`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_connection.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_connection.py -v
```

Expected: FAIL — `AttributeError: module 'fitness_lab.storage.db' has no attribute
'connection_scope'` (and `transaction`, `bootstrap_database`).

- [ ] **Step 3: Implement the hardening in `backend/src/fitness_lab/storage/db.py`**

Add the imports `from collections.abc import Iterator` and `from contextlib import contextmanager`,
replace `connect()`, and add the three new functions. Leave `database_path()`,
`TechnicalCheck`, `M0_TOKEN`, `REPO_ROOT` and `DEFAULT_DB_PATH` exactly as they are.
`init_db()` is **not** removed in this task (Task 5 removes it).

```python
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


def bootstrap_database(path: Path | None = None) -> None:
    """Persistent database configuration, set once — not routine connection state.

    WAL is recorded in the file header and read back by any later connection, so
    re-issuing it per connection would be noise.
    """
    with connection_scope(path) as connection:
        connection.execute("PRAGMA journal_mode = WAL")
```

Also change `read_technical_check()` to use `connection_scope(path)` instead of
`connect(path)` so it no longer leaks a connection (its body and return value are otherwise
unchanged). `init_db()` keeps using `connect(path)` for now; it disappears in Task 5.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_connection.py tests/test_storage.py tests/test_api.py -v
```

Expected: PASS — all of `test_connection.py`, plus the untouched M0 storage and API tests.

- [ ] **Step 5: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/fitness_lab/storage/db.py backend/tests/test_connection.py
git commit -m "feat(storage): harden SQLite connections (foreign keys, WAL bootstrap, explicit transactions)"
```

---

### Task 2: Architecture guards for M1

**Files:**
- Modify: `backend/tests/test_architecture.py`
- Test: same file

**Interfaces:**
- Consumes: nothing.
- Produces: the guards every later task is checked against — `domain` stays pure, `storage`
  never imports the API layer, and the grams representation never leaks into `domain`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_architecture.py` (keep the existing helper and test), and add
`import re` plus the `STORAGE_DIR` constant next to `DOMAIN_DIR`:

```python
STORAGE_DIR = Path(__file__).resolve().parents[1] / "src" / "fitness_lab" / "storage"
FORBIDDEN_FOR_STORAGE = ("fitness_lab.api", "fastapi")
GRAMS_TOKEN = re.compile(r"\bload_g\b")


def test_storage_does_not_depend_on_the_api_layer() -> None:
    offenders: list[str] = []
    for source in STORAGE_DIR.rglob("*.py"):
        for imported in _imported_modules(source):
            if imported.startswith(FORBIDDEN_FOR_STORAGE):
                offenders.append(f"{source.name} imports {imported}")

    assert offenders == [], f"storage must not depend on the HTTP boundary: {offenders}"


def test_domain_never_references_the_grams_column() -> None:
    """The domain speaks kilograms. ``load_g`` is a storage representation detail."""
    offenders = [
        f"{source.name}:{number}"
        for source in DOMAIN_DIR.rglob("*.py")
        for number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), start=1)
        if GRAMS_TOKEN.search(line)
    ]

    assert offenders == [], f"grams must not leak into the domain layer: {offenders}"
```

- [ ] **Step 2: Run the tests**

```bash
cd backend && uv run pytest tests/test_architecture.py -v
```

Expected: PASS immediately — these are standing guards, and the current tree satisfies them.
This is the one place in the plan where a test is not expected to fail first: there is no
behaviour to add, only a boundary to freeze before the code that could violate it is written.
To confirm the guards actually bite, temporarily add `load_g = 1` to
`backend/src/fitness_lab/domain/__init__.py` and re-run — `test_domain_never_references_the_grams_column`
must FAIL — then revert that line.

- [ ] **Step 3: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_architecture.py
git commit -m "test(architecture): guard the storage boundary and keep grams out of the domain"
```

---

### Task 3: Migration runner core

**Files:**
- Create: `backend/src/fitness_lab/storage/migrations.py`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_migrations.py` (create)

**Interfaces:**
- Consumes: `db.connection_scope`, `db.transaction`, `db.bootstrap_database`, `db.database_path`.
- Produces:
  - `MIGRATIONS_DIR: Path` (= `backend/migrations`)
  - `class MigrationError(RuntimeError)`, `class ChecksumMismatchError(MigrationError)`
  - `Migration(version: int, filename: str, sha256: str, sql: str)` — frozen dataclass
  - `MigrationResult(applied: tuple[int, ...], snapshot: Path | None)` — frozen dataclass
  - `discover_migrations(directory: Path = MIGRATIONS_DIR) -> tuple[Migration, ...]`
  - `ensure_schema_migrations(connection: sqlite3.Connection) -> None`
  - `applied_versions(connection: sqlite3.Connection) -> dict[int, str]`
  - `pending_migrations(connection: sqlite3.Connection, migrations: Sequence[Migration]) -> tuple[Migration, ...]`
  - `migrate_to_head(path: Path | None = None, *, directory: Path = MIGRATIONS_DIR) -> MigrationResult`
  - In this task `MigrationResult.snapshot` is always `None`; Task 4 fills it in.

- [ ] **Step 1: Create the shared fixtures**

Create `backend/tests/conftest.py`:

```python
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
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_migrations.py`:

```python
"""The migration runner. Every claim here is about real files and a real database."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from fitness_lab.storage import db
from fitness_lab.storage.migrations import (
    ChecksumMismatchError,
    MigrationError,
    applied_versions,
    discover_migrations,
    migrate_to_head,
)

CREATE_ONE = "CREATE TABLE one (id INTEGER PRIMARY KEY, label TEXT NOT NULL) STRICT;\n"
CREATE_TWO = "CREATE TABLE two (id INTEGER PRIMARY KEY) STRICT;\n"


def write_migration(directory: Path, filename: str, sql: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / filename
    path.write_text(sql, encoding="utf-8")
    return path


def table_names(db_file: Path) -> set[str]:
    with db.connection_scope(db_file) as connection:
        rows = connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    return {str(row["name"]) for row in rows}


def test_empty_database_migrates_to_head(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)

    result = migrate_to_head(db_path, directory=directory)

    assert result.applied == (1,)
    assert "one" in table_names(db_path)
    with db.connection_scope(db_path) as connection:
        assert applied_versions(connection) == {
            1: discover_migrations(directory)[0].sha256,
        }


def test_migrations_apply_in_numeric_order(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0002_two.sql", "INSERT INTO one (id, label) VALUES (1, 'x');\n")
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    write_migration(directory, "0010_ten.sql", "INSERT INTO one (id, label) VALUES (2, 'y');\n")

    result = migrate_to_head(db_path, directory=directory)

    assert result.applied == (1, 2, 10)


def test_rerunning_at_head_applies_nothing(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)

    result = migrate_to_head(db_path, directory=directory)

    assert result.applied == ()


def test_editing_an_applied_migration_is_refused(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)
    write_migration(directory, "0001_one.sql", CREATE_ONE + "-- tweaked after the fact\n")

    with pytest.raises(ChecksumMismatchError, match="0001_one.sql"):
        migrate_to_head(db_path, directory=directory)


def test_a_checksum_mismatch_applies_nothing_else(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)
    write_migration(directory, "0001_one.sql", CREATE_ONE + "-- tweaked\n")
    write_migration(directory, "0002_two.sql", CREATE_TWO)

    with pytest.raises(ChecksumMismatchError):
        migrate_to_head(db_path, directory=directory)

    assert "two" not in table_names(db_path)


def test_an_applied_migration_missing_from_disk_is_refused(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    path = write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)
    path.unlink()

    with pytest.raises(MigrationError, match="applied migration 1"):
        migrate_to_head(db_path, directory=directory)


def test_a_failing_migration_rolls_back_and_records_nothing(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    write_migration(
        directory,
        "0002_broken.sql",
        "CREATE TABLE broken (id INTEGER PRIMARY KEY) STRICT;\n"
        "INSERT INTO no_such_table (id) VALUES (1);\n",
    )

    with pytest.raises(MigrationError, match="0002_broken.sql"):
        migrate_to_head(db_path, directory=directory)

    names = table_names(db_path)
    assert "one" in names
    assert "broken" not in names
    with db.connection_scope(db_path) as connection:
        assert sorted(applied_versions(connection)) == [1]


def test_a_foreign_key_violation_aborts_the_migration(tmp_path: Path, db_path: Path) -> None:
    """Deferred FKs slip past statement-level enforcement; foreign_key_check catches them."""
    directory = tmp_path / "migrations"
    write_migration(
        directory,
        "0001_dangling.sql",
        "CREATE TABLE fk_parent (id INTEGER PRIMARY KEY) STRICT;\n"
        "CREATE TABLE fk_child (\n"
        "    id INTEGER PRIMARY KEY,\n"
        "    p  INTEGER REFERENCES fk_parent(id) DEFERRABLE INITIALLY DEFERRED\n"
        ") STRICT;\n"
        "INSERT INTO fk_child (id, p) VALUES (1, 999);\n",
    )

    with pytest.raises(MigrationError, match="foreign key"):
        migrate_to_head(db_path, directory=directory)

    assert "fk_child" not in table_names(db_path)


def test_foreign_key_check_is_clean_after_a_successful_migration(
    tmp_path: Path, db_path: Path
) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)

    with db.connection_scope(db_path) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_migrating_never_resets_an_existing_database(tmp_path: Path, db_path: Path) -> None:
    raw = sqlite3.connect(db_path)
    try:
        raw.execute("CREATE TABLE preexisting (id INTEGER PRIMARY KEY, token TEXT NOT NULL)")
        raw.execute("INSERT INTO preexisting (id, token) VALUES (1, 'keep-me')")
        raw.commit()
    finally:
        raw.close()
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)

    migrate_to_head(db_path, directory=directory)

    with db.connection_scope(db_path) as connection:
        row = connection.execute("SELECT token FROM preexisting WHERE id = 1").fetchone()
    assert row["token"] == "keep-me"


def test_a_badly_named_migration_file_is_refused(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "baseline.sql", CREATE_ONE)

    with pytest.raises(MigrationError, match="NNNN_description.sql"):
        migrate_to_head(db_path, directory=directory)


def test_duplicate_version_numbers_are_refused(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    write_migration(directory, "0001_also_one.sql", CREATE_TWO)

    with pytest.raises(MigrationError, match="duplicate migration version"):
        migrate_to_head(db_path, directory=directory)


def test_statements_split_on_real_boundaries_not_on_every_semicolon(
    tmp_path: Path, db_path: Path
) -> None:
    """A semicolon inside a comment or a string literal must not split a statement."""
    directory = tmp_path / "migrations"
    write_migration(
        directory,
        "0001_tricky.sql",
        "-- a comment; with a semicolon in it\n"
        "CREATE TABLE tricky (id INTEGER PRIMARY KEY, label TEXT NOT NULL) STRICT;\n"
        "INSERT INTO tricky (id, label) VALUES (1, 'a;b');\n"
        "-- trailing comment after the last statement\n",
    )

    migrate_to_head(db_path, directory=directory)

    with db.connection_scope(db_path) as connection:
        row = connection.execute("SELECT label FROM tricky WHERE id = 1").fetchone()
    assert row["label"] == "a;b"


def test_migrations_run_with_foreign_keys_enabled(tmp_path: Path, db_path: Path) -> None:
    directory = tmp_path / "migrations"
    write_migration(directory, "0001_one.sql", CREATE_ONE)
    migrate_to_head(db_path, directory=directory)

    with db.connection_scope(db_path) as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_migrations.py -v
```

Expected: FAIL at collection — `ModuleNotFoundError: No module named
'fitness_lab.storage.migrations'`.

- [ ] **Step 4: Implement the runner**

Create `backend/src/fitness_lab/storage/migrations.py`:

```python
"""Forward-only SQL migrations over numbered files.

``schema_migrations`` is the single source of truth for applied state; ``PRAGMA
user_version`` is deliberately not maintained alongside it. Files are never edited
after they are applied — the recorded sha256 turns an edit into a loud refusal
instead of silent divergence.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from fitness_lab.storage import db

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
        line
        for line in buffer.splitlines()
        if line.strip() and not line.strip().startswith("--")
    ]
    if leftover:
        raise MigrationError(f"unterminated SQL statement: {leftover[0]!r}")
    return tuple(statements)


def discover_migrations(directory: Path = MIGRATIONS_DIR) -> tuple[Migration, ...]:
    migrations: list[Migration] = []
    seen: set[int] = set()
    for path in sorted(directory.glob("*.sql")):
        match = FILENAME_PATTERN.match(path.name)
        if match is None:
            raise MigrationError(
                f"migration filename must be NNNN_description.sql: {path.name}"
            )
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

    Never drops or recreates anything: the runner only applies pending files.
    """
    db_path = path if path is not None else db.database_path()
    db.bootstrap_database(db_path)
    migrations = discover_migrations(directory)
    with db.connection_scope(db_path) as connection:
        ensure_schema_migrations(connection)
        pending = pending_migrations(connection, migrations)
        if not pending:
            return MigrationResult(applied=(), snapshot=None)
        for migration in pending:
            _apply(connection, migration)
        return MigrationResult(
            applied=tuple(migration.version for migration in pending), snapshot=None
        )
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_migrations.py -v
```

Expected: PASS, all 14 tests.

- [ ] **Step 6: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/fitness_lab/storage/migrations.py backend/tests/test_migrations.py backend/tests/conftest.py
git commit -m "feat(storage): deterministic forward-only migration runner"
```

---

### Task 4: Pre-migration snapshot policy

**Files:**
- Create: `backend/src/fitness_lab/storage/snapshots.py`
- Modify: `backend/src/fitness_lab/storage/migrations.py`
- Test: `backend/tests/test_snapshots.py` (create)

**Interfaces:**
- Consumes: `db.connection_scope`, `migrations.migrate_to_head`.
- Produces:
  - `class SnapshotError(RuntimeError)`
  - `snapshot_directory(db_path: Path) -> Path` (= `<db parent>/snapshots`)
  - `create_snapshot(connection: sqlite3.Connection, db_path: Path, label: str) -> Path`
  - `migrate_to_head` now returns a real `MigrationResult.snapshot` path when anything was
    pending, and `None` when nothing was.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_snapshots.py`:

```python
"""Snapshot policy: exactly one snapshot per pending sequence, none when at head."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from fitness_lab.storage import db
from fitness_lab.storage.migrations import ChecksumMismatchError, migrate_to_head
from fitness_lab.storage.snapshots import SnapshotError, create_snapshot, snapshot_directory

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


def test_the_snapshot_is_named_for_the_first_pending_version(
    tmp_path: Path, db_path: Path
) -> None:
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_snapshots.py -v
```

Expected: FAIL at collection — `ModuleNotFoundError: No module named
'fitness_lab.storage.snapshots'`.

- [ ] **Step 3: Implement the snapshot module**

Create `backend/src/fitness_lab/storage/snapshots.py`:

```python
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
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    target = directory / f"{stamp}-{label}.db"
    if target.exists():
        raise SnapshotError(f"snapshot already exists: {target}")
    connection.execute("VACUUM INTO ?", (str(target),))
    return target
```

- [ ] **Step 4: Wire the snapshot into the runner**

In `backend/src/fitness_lab/storage/migrations.py`, import
`from fitness_lab.storage.snapshots import create_snapshot` and replace the tail of
`migrate_to_head`:

```python
        pending = pending_migrations(connection, migrations)
        if not pending:
            return MigrationResult(applied=(), snapshot=None)
        # Discovery first, snapshot second: starting the app at head must not
        # accumulate a snapshot per launch. One snapshot covers the whole sequence.
        snapshot = create_snapshot(connection, db_path, f"pre-{pending[0].version:04d}")
        for migration in pending:
            _apply(connection, migration)
        return MigrationResult(
            applied=tuple(migration.version for migration in pending), snapshot=snapshot
        )
```

Note the ordering that must not be changed: `ensure_schema_migrations` runs *before* the
snapshot, so the snapshot of a legacy database contains an empty `schema_migrations` table.
That is deliberate — creating the empty bookkeeping table destroys no data, and it must exist
before pending state can be determined at all.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_snapshots.py tests/test_migrations.py -v
```

Expected: PASS.

- [ ] **Step 6: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/fitness_lab/storage/snapshots.py backend/src/fitness_lab/storage/migrations.py backend/tests/test_snapshots.py
git commit -m "feat(storage): take exactly one pre-migration snapshot when migrations are pending"
```

---

### Task 5: Baseline migration and adoption of the existing M0 database

**Files:**
- Create: `backend/migrations/0001_baseline.sql`
- Modify: `backend/src/fitness_lab/storage/db.py` (remove `init_db`)
- Modify: `backend/src/fitness_lab/api/app.py` (`lifespan` calls the runner)
- Modify: `backend/tests/test_storage.py` (retarget the four `init_db` tests)
- Test: `backend/tests/test_baseline_migration.py` (create)

**Interfaces:**
- Consumes: `migrate_to_head`, `snapshot_directory`, `db.M0_TOKEN`, `db.read_technical_check`.
- Produces: version 1 of the real schema; `db.init_db` no longer exists; the API bootstraps
  through `migrations.migrate_to_head()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_baseline_migration.py`:

```python
"""0001_baseline adopts the real M0 database instead of resetting it."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fitness_lab.storage import db
from fitness_lab.storage.migrations import applied_versions, migrate_to_head
from fitness_lab.storage.snapshots import snapshot_directory

LEGACY_DDL = """
CREATE TABLE IF NOT EXISTS m0_technical_check (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    token      TEXT    NOT NULL,
    created_at TEXT    NOT NULL
)
"""


def make_legacy_m0_database(db_file: Path, token: str, created_at: str) -> None:
    """Reproduce exactly what M0's init_db() left on disk: no schema_migrations, no WAL."""
    raw = sqlite3.connect(db_file)
    try:
        raw.execute(LEGACY_DDL)
        raw.execute(
            "INSERT OR IGNORE INTO m0_technical_check (id, token, created_at) VALUES (1, ?, ?)",
            (token, created_at),
        )
        raw.commit()
    finally:
        raw.close()


def test_baseline_creates_the_technical_table_on_an_empty_database(db_path: Path) -> None:
    result = migrate_to_head(db_path)

    assert 1 in result.applied
    check = db.read_technical_check(db_path)
    assert check.row_id == 1
    assert check.token == db.M0_TOKEN
    assert check.created_at


def test_a_legacy_m0_database_is_adopted_without_losing_its_row(db_path: Path) -> None:
    make_legacy_m0_database(db_path, "legacy-token", "2026-09-07T19:28:21+00:00")

    migrate_to_head(db_path)

    check = db.read_technical_check(db_path)
    assert check.token == "legacy-token"
    assert check.created_at == "2026-09-07T19:28:21+00:00"


def test_adopting_a_legacy_database_records_the_baseline_version(db_path: Path) -> None:
    make_legacy_m0_database(db_path, "legacy-token", "2026-09-07T19:28:21+00:00")

    migrate_to_head(db_path)

    with db.connection_scope(db_path) as connection:
        assert 1 in applied_versions(connection)


def test_adopting_a_legacy_database_snapshots_it_first(db_path: Path) -> None:
    make_legacy_m0_database(db_path, "legacy-token", "2026-09-07T19:28:21+00:00")

    result = migrate_to_head(db_path)

    assert result.snapshot is not None
    assert len(list(snapshot_directory(db_path).glob("*.db"))) == 1
    raw = sqlite3.connect(result.snapshot)
    try:
        assert raw.execute("SELECT token FROM m0_technical_check").fetchone()[0] == "legacy-token"
    finally:
        raw.close()


def test_adopting_a_legacy_database_switches_it_to_wal(db_path: Path) -> None:
    make_legacy_m0_database(db_path, "legacy-token", "2026-09-07T19:28:21+00:00")

    migrate_to_head(db_path)

    raw = sqlite3.connect(db_path)
    try:
        assert raw.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    finally:
        raw.close()


def test_rerunning_the_baseline_changes_nothing(db_path: Path) -> None:
    migrate_to_head(db_path)
    first = db.read_technical_check(db_path)

    result = migrate_to_head(db_path)

    assert result.applied == ()
    assert db.read_technical_check(db_path) == first
```

Retarget the four M0 tests in `backend/tests/test_storage.py`. Replace
`from fitness_lab.storage import db` usage of `db.init_db(...)` with
`migrate_to_head(...)`, adding `from fitness_lab.storage.migrations import migrate_to_head`.
The three affected tests become:

```python
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
```

`test_read_without_init_raises` and `test_database_path_honours_env_override` stay exactly as
they are.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_baseline_migration.py tests/test_storage.py -v
```

Expected: FAIL — `sqlite3.OperationalError: no such table: m0_technical_check` (the baseline
migration file does not exist yet, so `migrate_to_head` applies nothing).

- [ ] **Step 3: Write the baseline migration**

Create `backend/migrations/0001_baseline.sql`:

```sql
-- 0001_baseline.sql
-- Adopts the database M0 already created, without a reset.
--
-- CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE make this a no-op against the legacy
-- file (which already holds the table and its row) and a creation against an empty one.
-- One code path, both cases, nothing destroyed.
--
-- This table is deliberately NOT STRICT: it must match the table M0 created byte for
-- byte, or CREATE TABLE IF NOT EXISTS would silently keep the legacy definition while
-- the code believed otherwise. m0_technical_check is retained through M1 because
-- /api/ping-db, the React page and the Playwright smoke test all depend on it; it is
-- retired in the milestone that replaces the visible technical surface.

CREATE TABLE IF NOT EXISTS m0_technical_check (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    token      TEXT    NOT NULL,
    created_at TEXT    NOT NULL
);

INSERT OR IGNORE INTO m0_technical_check (id, token, created_at)
VALUES (1, 'sqlite-roundtrip-ok', strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'));
```

- [ ] **Step 4: Remove `init_db` and switch the API bootstrap**

In `backend/src/fitness_lab/storage/db.py`, delete the whole `init_db` function and drop the
now-unused `from datetime import UTC, datetime` import if nothing else uses it. Update the
module docstring's second paragraph to say the technical table now lives in
`backend/migrations/0001_baseline.sql`.

In `backend/src/fitness_lab/api/app.py`:

```python
from fitness_lab.storage import db, migrations


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    migrations.migrate_to_head()
    yield
```

Nothing else in `app.py` changes: `/api/health`, `/api/ping-db`, the response models and the
static mount stay exactly as they are.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_baseline_migration.py tests/test_storage.py tests/test_api.py -v
```

Expected: PASS — including the unchanged `test_api.py`, which now boots through the migration
runner.

- [ ] **Step 6: Prove the real database is adopted, not reset**

```bash
cd backend && uv run python -c "
from pathlib import Path
from fitness_lab.storage import db
from fitness_lab.storage.migrations import migrate_to_head
before = db.read_technical_check()
print('before:', before)
print('migrated:', migrate_to_head())
after = db.read_technical_check()
print('after: ', after)
assert (after.row_id, after.token, after.created_at) == (before.row_id, before.token, before.created_at)
print('legacy row survived adoption')
"
```

Expected: the same `token` and `created_at` before and after, `applied=(1,)` on the first run,
and one file under `data/snapshots/`. Re-running prints `applied=()` and adds no snapshot.

- [ ] **Step 7: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/0001_baseline.sql backend/src/fitness_lab/storage/db.py backend/src/fitness_lab/api/app.py backend/tests/test_storage.py backend/tests/test_baseline_migration.py
git commit -m "feat(storage): adopt the existing M0 database through 0001_baseline"
```

---

### Task 6: Exact kg ↔ gram boundary

**Files:**
- Create: `backend/src/fitness_lab/domain/units.py`
- Test: `backend/tests/test_units.py` (create)

**Interfaces:**
- Consumes: nothing (pure domain, stdlib `decimal` only).
- Produces:
  - `kg_to_g(value: str | int | Decimal | None) -> int | None`
  - `g_to_kg(grams: int | None) -> Decimal | None`
  - `format_kg(value: Decimal | None) -> str | None`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_units.py`:

```python
"""The kg/gram boundary. Wrong once here is wrong in every stored row thereafter."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, cast

import pytest

from fitness_lab.domain.units import format_kg, g_to_kg, kg_to_g


@pytest.mark.parametrize(
    ("value", "grams"),
    [
        ("0", 0),
        (0, 0),
        ("0.001", 1),
        ("0.5", 500),
        ("1.25", 1250),
        ("32.5", 32500),
        ("102.5", 102500),
        ("220.75", 220750),
        (60, 60000),
        (Decimal("102.5"), 102500),
        (Decimal("0.001"), 1),
    ],
)
def test_kg_to_g_is_exact(value: str | int | Decimal, grams: int) -> None:
    assert kg_to_g(value) == grams


def test_none_maps_to_none_in_both_directions() -> None:
    assert kg_to_g(None) is None
    assert g_to_kg(None) is None


@pytest.mark.parametrize("value", ["0.0005", "0.4999", "1.0001"])
def test_sub_gram_precision_is_rejected_never_rounded(value: str) -> None:
    with pytest.raises(ValueError, match="sub-gram"):
        kg_to_g(value)


def test_negative_load_is_rejected() -> None:
    with pytest.raises(ValueError, match="negative"):
        kg_to_g("-1")


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_input_is_rejected(value: str) -> None:
    with pytest.raises(ValueError, match="non-finite"):
        kg_to_g(value)


def test_non_numeric_text_is_rejected() -> None:
    with pytest.raises(ValueError, match="not a decimal"):
        kg_to_g("heavy")


@pytest.mark.parametrize("value", [102.5, 0.1, 0.0])
def test_float_input_is_refused_outright(value: float) -> None:
    """By the time a float exists, precision may already be lost."""
    with pytest.raises(TypeError, match="float"):
        kg_to_g(cast(Any, value))


def test_bool_is_refused_because_it_is_an_int_subclass() -> None:
    with pytest.raises(TypeError):
        kg_to_g(cast(Any, True))


@pytest.mark.parametrize("value", ["0", "0.5", "1.25", "32.5", "102.5", "220.75"])
def test_round_trips_are_exact(value: str) -> None:
    grams = kg_to_g(value)
    assert grams is not None
    assert g_to_kg(grams) == Decimal(value)


def test_g_to_kg_is_exact_without_division_context() -> None:
    assert g_to_kg(102500) == Decimal("102.5")
    assert g_to_kg(1) == Decimal("0.001")
    assert g_to_kg(0) == Decimal("0")


@pytest.mark.parametrize(
    ("grams", "rendered"),
    [
        (100000, "100"),
        (60000, "60"),
        (102500, "102.5"),
        (500, "0.5"),
        (220750, "220.75"),
        (0, "0"),
        (1, "0.001"),
    ],
)
def test_display_never_uses_scientific_notation(grams: int, rendered: str) -> None:
    """normalize() alone renders 100 kg as 1E+2; the "f" format suppresses that."""
    assert format_kg(g_to_kg(grams)) == rendered
    assert "E" not in (format_kg(g_to_kg(grams)) or "")


def test_format_kg_passes_none_through() -> None:
    assert format_kg(None) is None


def test_json_parsed_with_decimal_converts_exactly() -> None:
    document = json.loads('{"load_kg": 102.5}', parse_float=Decimal)
    assert document["load_kg"] == Decimal("102.5")
    assert kg_to_g(document["load_kg"]) == 102500


def test_json_sub_gram_input_is_refused() -> None:
    document = json.loads('{"load_kg": 0.0005}', parse_float=Decimal)
    with pytest.raises(ValueError, match="sub-gram"):
        kg_to_g(document["load_kg"])
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_units.py -v
```

Expected: FAIL at collection — `ModuleNotFoundError: No module named
'fitness_lab.domain.units'`.

- [ ] **Step 3: Implement the mapper**

Create `backend/src/fitness_lab/domain/units.py`:

```python
"""The canonical kilogram/gram boundary.

SQLite stores integer grams; the domain, the docs and the capture contract speak
kilograms. Float multiplication plus rounding is not used here: gym plate weights are
binary-exact as IEEE doubles, so a float implementation passes every obvious test and
then fails on upstream arithmetic (0.1 + 0.2 -> 0.30000000000000004), while a round()
would paper over exactly the sub-gram input that should have been refused.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

GRAMS_PER_KILOGRAM_EXPONENT = 3


def kg_to_g(value: str | int | Decimal | None) -> int | None:
    """Convert kilograms to integer grams, exactly. NULL stays NULL."""
    if value is None:
        return None
    if isinstance(value, bool) or isinstance(value, float):
        raise TypeError(f"float input forbidden at the kg/g boundary: {value!r}")
    try:
        kilograms = Decimal(value)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"not a decimal load: {value!r}") from exc
    if not kilograms.is_finite():
        raise ValueError(f"non-finite load: {value!r}")
    grams = kilograms.scaleb(GRAMS_PER_KILOGRAM_EXPONENT)
    if grams != grams.to_integral_value():
        raise ValueError(f"sub-gram precision is not representable: {value!r}")
    if grams < 0:
        raise ValueError(f"negative load: {value!r}")
    return int(grams)


def g_to_kg(grams: int | None) -> Decimal | None:
    """Convert integer grams to kilograms, exactly. NULL stays NULL."""
    return None if grams is None else Decimal(grams).scaleb(-GRAMS_PER_KILOGRAM_EXPONENT)


def format_kg(value: Decimal | None) -> str | None:
    """Render kilograms for display without scientific notation."""
    return None if value is None else format(value.normalize(), "f")
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_units.py tests/test_architecture.py -v
```

Expected: PASS — including the architecture guards, which confirm `units.py` neither imports
outward nor mentions `load_g`.

- [ ] **Step 5: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/fitness_lab/domain/units.py backend/tests/test_units.py
git commit -m "feat(domain): exact Decimal-based kilogram/gram conversion boundary"
```

---

### Task 7: Domain model and exercise operations

**Files:**
- Create: `backend/src/fitness_lab/domain/models.py`
- Test: `backend/tests/test_domain_models.py` (create)

**Interfaces:**
- Consumes: `fitness_lab.domain.units` (for `Decimal` loads only).
- Produces:
  - `class WorkoutStatus(StrEnum)`: `DRAFT = "draft"`, `COMPLETE = "complete"`
  - `class SetTypeCode(StrEnum)`: `WARMUP = "warmup"`, `WORKING = "working"`, `BACKOFF = "backoff"`
  - `new_id() -> str` (`uuid4().hex`)
  - `utc_now_iso() -> str` (UTC ISO-8601, seconds precision)
  - `normalize_identity(name: str, equipment_label: str | None) -> tuple[str, str]`
  - `Exercise(id, name, equipment_label, notes, is_active, created_at_utc, updated_at_utc)`
  - `Workout(id, performed_on, performed_time_local, status, notes, entered_at_utc, updated_at_utc)`
  - `PerformedSet(id, workout_id, exercise_id, set_order, set_type, load_kg, reps, rir, notes, entered_at_utc, updated_at_utc)`
  - `create_exercise(name: str, equipment_label: str | None = None, *, notes: str | None = None, now: str | None = None) -> Exercise`
  - `rename_exercise(exercise: Exercise, name: str, equipment_label: str | None, *, now: str | None = None) -> Exercise`
  - `deactivate_exercise(exercise: Exercise, *, now: str | None = None) -> Exercise`
  - `new_draft_workout(performed_on: str, *, performed_time_local: str | None = None, notes: str | None = None, now: str | None = None) -> Workout`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_domain_models.py`:

```python
"""Pure domain entities and the two distinct exercise operations."""

from __future__ import annotations

from decimal import Decimal

import pytest

from fitness_lab.domain.models import (
    Exercise,
    PerformedSet,
    SetTypeCode,
    Workout,
    WorkoutStatus,
    create_exercise,
    deactivate_exercise,
    new_draft_workout,
    new_id,
    normalize_identity,
    rename_exercise,
    utc_now_iso,
)


def test_new_id_is_an_opaque_stable_hex_id() -> None:
    identifier = new_id()

    assert len(identifier) == 32
    assert identifier.isalnum()
    assert identifier != new_id()


def test_utc_now_iso_is_utc_and_second_precision() -> None:
    stamp = utc_now_iso()

    assert stamp.endswith("+00:00")
    assert len(stamp) == len("2026-10-01T18:30:00+00:00")


@pytest.mark.parametrize(
    ("name", "label", "expected"),
    [
        ("Incline Chest Press", "Hammer Strength", ("incline chest press", "hammer strength")),
        ("  Incline Chest Press ", "  Hammer Strength ", ("incline chest press", "hammer strength")),
        ("Incline Chest Press", None, ("incline chest press", "")),
    ],
)
def test_normalize_identity_matches_the_unique_index_rule(
    name: str, label: str | None, expected: tuple[str, str]
) -> None:
    assert normalize_identity(name, label) == expected


def test_create_exercise_establishes_a_new_identity() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    assert exercise.name == "Incline Chest Press"
    assert exercise.equipment_label == "Hammer Strength"
    assert exercise.is_active is True
    assert exercise.created_at_utc == exercise.updated_at_utc
    assert exercise.notes is None


def test_create_exercise_allows_no_equipment_label() -> None:
    exercise = create_exercise("Incline dumbbell press")

    assert exercise.equipment_label is None


def test_create_exercise_refuses_a_blank_name() -> None:
    with pytest.raises(ValueError, match="name"):
        create_exercise("   ")


def test_create_exercise_refuses_a_blank_equipment_label() -> None:
    """'' must never become a third state alongside NULL and a real label."""
    with pytest.raises(ValueError, match="equipment_label"):
        create_exercise("Incline Chest Press", "   ")


def test_two_exercises_created_with_the_same_name_get_different_ids() -> None:
    first = create_exercise("Incline Chest Press", "Hammer Strength")
    second = create_exercise("Incline Chest Press", "Technogym Pure Strength")

    assert first.id != second.id


def test_rename_exercise_corrects_labels_and_keeps_the_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """Renaming corrects the label of the same identity; it never switches machines."""
    exercise = create_exercise("Incline Chest Pres", "Hammer Strength", now="2026-10-01T10:00:00+00:00")

    renamed = rename_exercise(
        exercise, "Incline Chest Press", "Hammer Strength Iso-Lateral", now="2026-10-02T10:00:00+00:00"
    )

    assert renamed.id == exercise.id
    assert renamed.name == "Incline Chest Press"
    assert renamed.equipment_label == "Hammer Strength Iso-Lateral"
    assert renamed.created_at_utc == exercise.created_at_utc
    assert renamed.updated_at_utc == "2026-10-02T10:00:00+00:00"


def test_rename_exercise_can_clear_the_equipment_label() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    renamed = rename_exercise(exercise, "Incline Chest Press", None)

    assert renamed.equipment_label is None


def test_rename_exercise_refuses_a_blank_name() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    with pytest.raises(ValueError, match="name"):
        rename_exercise(exercise, "  ", "Hammer Strength")


def test_deactivate_exercise_retires_rather_than_deletes() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    retired = deactivate_exercise(exercise, now="2026-10-03T10:00:00+00:00")

    assert retired.id == exercise.id
    assert retired.is_active is False
    assert retired.updated_at_utc == "2026-10-03T10:00:00+00:00"


def test_new_draft_workout_starts_as_a_draft_with_only_a_date() -> None:
    workout = new_draft_workout("2026-10-01")

    assert workout.status is WorkoutStatus.DRAFT
    assert workout.performed_on == "2026-10-01"
    assert workout.performed_time_local is None
    assert workout.notes is None


def test_entities_are_frozen() -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")

    with pytest.raises(AttributeError):
        exercise.name = "changed"  # type: ignore[misc]


def test_a_draft_set_may_carry_nothing_but_its_anchors() -> None:
    """Field-level autosave means a row exists before reps, load or type are known."""
    performed_set = PerformedSet(
        id=new_id(),
        workout_id=new_id(),
        exercise_id=new_id(),
        set_order=1,
        set_type=None,
        load_kg=None,
        reps=None,
        rir=None,
        notes=None,
        entered_at_utc=utc_now_iso(),
        updated_at_utc=utc_now_iso(),
    )

    assert performed_set.reps is None
    assert performed_set.set_type is None
    assert performed_set.load_kg is None
    assert performed_set.rir is None


def test_a_set_speaks_kilograms_as_decimal() -> None:
    performed_set = PerformedSet(
        id=new_id(),
        workout_id=new_id(),
        exercise_id=new_id(),
        set_order=1,
        set_type=SetTypeCode.WORKING,
        load_kg=Decimal("102.5"),
        reps=8,
        rir=-1,
        notes=None,
        entered_at_utc=utc_now_iso(),
        updated_at_utc=utc_now_iso(),
    )

    assert performed_set.load_kg == Decimal("102.5")
    assert performed_set.rir == -1


def test_the_status_and_set_type_vocabularies_are_closed() -> None:
    assert [status.value for status in WorkoutStatus] == ["draft", "complete"]
    assert [code.value for code in SetTypeCode] == ["warmup", "working", "backoff"]


def test_entity_field_names_are_the_ones_storage_expects() -> None:
    assert set(Exercise.__dataclass_fields__) == {
        "id",
        "name",
        "equipment_label",
        "notes",
        "is_active",
        "created_at_utc",
        "updated_at_utc",
    }
    assert set(Workout.__dataclass_fields__) == {
        "id",
        "performed_on",
        "performed_time_local",
        "status",
        "notes",
        "entered_at_utc",
        "updated_at_utc",
    }
    assert set(PerformedSet.__dataclass_fields__) == {
        "id",
        "workout_id",
        "exercise_id",
        "set_order",
        "set_type",
        "load_kg",
        "reps",
        "rir",
        "notes",
        "entered_at_utc",
        "updated_at_utc",
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_domain_models.py -v
```

Expected: FAIL at collection — `ModuleNotFoundError: No module named
'fitness_lab.domain.models'`.

- [ ] **Step 3: Implement the model**

Create `backend/src/fitness_lab/domain/models.py`:

```python
"""Pure domain entities.

IDs are generated here, not by the database, so a retried write collides on the primary
key instead of creating a duplicate. Loads are kilograms as ``Decimal``; the grams
representation belongs to storage and must never appear in this package.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import uuid4


class WorkoutStatus(StrEnum):
    DRAFT = "draft"
    COMPLETE = "complete"


class SetTypeCode(StrEnum):
    WARMUP = "warmup"
    WORKING = "working"
    BACKOFF = "backoff"


def new_id() -> str:
    """An opaque, immutable, domain-generated identifier."""
    return uuid4().hex


def utc_now_iso() -> str:
    """A system-event timestamp. Training facts use civil time instead."""
    return datetime.now(UTC).isoformat(timespec="seconds")


def normalize_identity(name: str, equipment_label: str | None) -> tuple[str, str]:
    """The same normalization ux_exercise_identity applies: lower(trim(...)), NULL -> ''."""
    label = "" if equipment_label is None else equipment_label
    return name.strip().lower(), label.strip().lower()


@dataclass(frozen=True, slots=True)
class Exercise:
    id: str
    name: str
    equipment_label: str | None
    notes: str | None
    is_active: bool
    created_at_utc: str
    updated_at_utc: str


@dataclass(frozen=True, slots=True)
class Workout:
    id: str
    performed_on: str
    performed_time_local: str | None
    status: WorkoutStatus
    notes: str | None
    entered_at_utc: str
    updated_at_utc: str


@dataclass(frozen=True, slots=True)
class PerformedSet:
    id: str
    workout_id: str
    exercise_id: str
    set_order: int
    set_type: SetTypeCode | None
    load_kg: Decimal | None
    reps: int | None
    rir: int | None
    notes: str | None
    entered_at_utc: str
    updated_at_utc: str


def _validated_name(name: str) -> str:
    if not name.strip():
        raise ValueError("exercise name must not be blank")
    return name


def _validated_label(equipment_label: str | None) -> str | None:
    if equipment_label is not None and not equipment_label.strip():
        raise ValueError("equipment_label must be absent or non-blank, never ''")
    return equipment_label


def create_exercise(
    name: str,
    equipment_label: str | None = None,
    *,
    notes: str | None = None,
    now: str | None = None,
) -> Exercise:
    """Establish a NEW identity. Training on a different machine goes through here."""
    stamp = now if now is not None else utc_now_iso()
    return Exercise(
        id=new_id(),
        name=_validated_name(name),
        equipment_label=_validated_label(equipment_label),
        notes=notes,
        is_active=True,
        created_at_utc=stamp,
        updated_at_utc=stamp,
    )


def rename_exercise(
    exercise: Exercise, name: str, equipment_label: str | None, *, now: str | None = None
) -> Exercise:
    """Correct the labels of an EXISTING identity — a typo, or a more precise label.

    This is never the mechanism for switching machines: that is create_exercise().
    History stays attached because no row anywhere stores an exercise name.
    """
    return replace(
        exercise,
        name=_validated_name(name),
        equipment_label=_validated_label(equipment_label),
        updated_at_utc=now if now is not None else utc_now_iso(),
    )


def deactivate_exercise(exercise: Exercise, *, now: str | None = None) -> Exercise:
    """Retirement, never deletion: history keeps resolving."""
    return replace(
        exercise, is_active=False, updated_at_utc=now if now is not None else utc_now_iso()
    )


def new_draft_workout(
    performed_on: str,
    *,
    performed_time_local: str | None = None,
    notes: str | None = None,
    now: str | None = None,
) -> Workout:
    """Retrospective entry starts here: a date, a draft, and nothing else required."""
    stamp = now if now is not None else utc_now_iso()
    return Workout(
        id=new_id(),
        performed_on=performed_on,
        performed_time_local=performed_time_local,
        status=WorkoutStatus.DRAFT,
        notes=notes,
        entered_at_utc=stamp,
        updated_at_utc=stamp,
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_domain_models.py tests/test_architecture.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green. If ruff flags the unused `monkeypatch` parameter in
`test_rename_exercise_corrects_labels_and_keeps_the_id`, delete that parameter — it is not
needed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/fitness_lab/domain/models.py backend/tests/test_domain_models.py
git commit -m "feat(domain): exercise, workout and performed-set entities with stable opaque ids"
```

---

### Task 8: Completion rules C1–C4

**Files:**
- Create: `backend/src/fitness_lab/domain/completion.py`
- Test: `backend/tests/test_completion.py` (create)

**Interfaces:**
- Consumes: `fitness_lab.domain.models` (`PerformedSet`, `Workout`, `WorkoutStatus`, `utc_now_iso`).
- Produces:
  - `CompletionIssue(rule: str, message: str, set_orders: tuple[int, ...])` — frozen dataclass
  - `CompletionReport(ok: bool, blockers: tuple[CompletionIssue, ...], advisories: tuple[CompletionIssue, ...], sets: tuple[PerformedSet, ...], renumbered: bool)`
  - `renumber_sets(sets: Sequence[PerformedSet]) -> tuple[PerformedSet, ...]`
  - `evaluate_completion(sets: Sequence[PerformedSet]) -> CompletionReport`
  - `complete_workout(workout: Workout, sets: Sequence[PerformedSet], *, now: str | None = None) -> tuple[Workout, CompletionReport]`
  - `reopen_workout(workout: Workout, *, now: str | None = None) -> Workout`
  - Rule codes are exactly `"C1"`, `"C2"`, `"C3"`, `"C4"`, `"A-LOAD"`, `"A-RIR"`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_completion.py`:

```python
"""Tier 2: what must additionally be true before a workout may be called evidence."""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

from fitness_lab.domain.completion import (
    CompletionIssue,
    complete_workout,
    evaluate_completion,
    renumber_sets,
    reopen_workout,
)
from fitness_lab.domain.models import (
    PerformedSet,
    SetTypeCode,
    Workout,
    WorkoutStatus,
    new_draft_workout,
    new_id,
)

WORKOUT_ID = "workout-1"
EXERCISE_ID = "exercise-1"


def make_set(
    set_order: int,
    *,
    reps: int | None = 8,
    set_type: SetTypeCode | None = SetTypeCode.WORKING,
    load_kg: Decimal | None = Decimal("60"),
    rir: int | None = 2,
) -> PerformedSet:
    return PerformedSet(
        id=new_id(),
        workout_id=WORKOUT_ID,
        exercise_id=EXERCISE_ID,
        set_order=set_order,
        set_type=set_type,
        load_kg=load_kg,
        reps=reps,
        rir=rir,
        notes=None,
        entered_at_utc="2026-10-01T19:00:00+00:00",
        updated_at_utc="2026-10-01T19:00:00+00:00",
    )


def rules(issues: Sequence[CompletionIssue]) -> list[str]:
    return [issue.rule for issue in issues]


def test_c1_an_empty_workout_cannot_be_completed() -> None:
    report = evaluate_completion([])

    assert report.ok is False
    assert "C1" in rules(report.blockers)


def test_c2_missing_reps_blocks_and_names_the_offending_positions() -> None:
    sets = [make_set(1), make_set(2, reps=None), make_set(3, reps=None)]

    report = evaluate_completion(sets)

    assert report.ok is False
    blocker = next(issue for issue in report.blockers if issue.rule == "C2")
    assert blocker.set_orders == (2, 3)
    assert "2" in blocker.message and "3" in blocker.message


def test_c2_zero_reps_is_evidence_not_absence() -> None:
    """0 is a recorded failed attempt; it must not be treated as missing."""
    report = evaluate_completion([make_set(1, reps=0)])

    assert report.ok is True


def test_c3_a_sparse_sequence_is_repaired_then_accepted() -> None:
    sets = [make_set(1), make_set(3), make_set(7)]

    report = evaluate_completion(sets)

    assert report.ok is True
    assert report.renumbered is True
    assert [performed.set_order for performed in report.sets] == [1, 2, 3]


def test_c3_a_dense_sequence_is_left_alone() -> None:
    report = evaluate_completion([make_set(1), make_set(2)])

    assert report.renumbered is False
    assert [performed.set_order for performed in report.sets] == [1, 2]


def test_c3_repair_preserves_chronological_order_and_identity() -> None:
    first, second, third = make_set(2), make_set(5), make_set(9)

    report = evaluate_completion([third, first, second])

    assert [performed.id for performed in report.sets] == [first.id, second.id, third.id]


def test_c3_repair_is_revalidated_and_can_still_block() -> None:
    sets = [make_set(1), make_set(4, reps=None)]

    report = evaluate_completion(sets)

    assert report.ok is False
    blocker = next(issue for issue in report.blockers if issue.rule == "C2")
    assert blocker.set_orders == (2,), "offending positions are reported after renumbering"


def test_c4_missing_set_type_blocks_and_names_the_offending_positions() -> None:
    sets = [make_set(1), make_set(2, set_type=None)]

    report = evaluate_completion(sets)

    assert report.ok is False
    blocker = next(issue for issue in report.blockers if issue.rule == "C4")
    assert blocker.set_orders == (2,)


def test_missing_load_is_an_advisory_not_a_blocker() -> None:
    """Forcing a load at completion would make a lifter type a guess into permanent history."""
    report = evaluate_completion([make_set(1, load_kg=None)])

    assert report.ok is True
    advisory = next(issue for issue in report.advisories if issue.rule == "A-LOAD")
    assert advisory.set_orders == (1,)


def test_missing_rir_is_an_advisory_not_a_blocker() -> None:
    report = evaluate_completion([make_set(1, rir=None)])

    assert report.ok is True
    assert "A-RIR" in rules(report.advisories)


def test_zero_load_and_zero_rir_raise_no_advisory() -> None:
    """0 kg is a bodyweight set; 0 RIR is failure. Neither is a missing measurement."""
    report = evaluate_completion([make_set(1, load_kg=Decimal("0"), rir=0)])

    assert report.advisories == ()


def test_a_draft_with_null_reps_and_null_set_type_is_a_valid_draft() -> None:
    """Tier 1 allows partial; only the transition to complete is gated."""
    sets = [make_set(1, reps=None, set_type=None, load_kg=None, rir=None)]

    report = evaluate_completion(sets)

    assert sorted(rules(report.blockers)) == ["C2", "C4"]


def test_complete_workout_promotes_when_every_rule_passes() -> None:
    workout = new_draft_workout("2026-10-01", now="2026-10-01T19:00:00+00:00")

    promoted, report = complete_workout(
        workout, [make_set(1), make_set(2)], now="2026-10-01T20:00:00+00:00"
    )

    assert report.ok is True
    assert promoted.status is WorkoutStatus.COMPLETE
    assert promoted.updated_at_utc == "2026-10-01T20:00:00+00:00"
    assert promoted.id == workout.id


def test_complete_workout_leaves_the_workout_alone_when_blocked() -> None:
    workout = new_draft_workout("2026-10-01")

    unchanged, report = complete_workout(workout, [make_set(1, reps=None)])

    assert report.ok is False
    assert unchanged == workout


def test_reopening_a_complete_workout_is_always_permitted() -> None:
    workout = new_draft_workout("2026-10-01", now="2026-10-01T19:00:00+00:00")
    promoted, _ = complete_workout(workout, [make_set(1)], now="2026-10-01T20:00:00+00:00")

    reopened = reopen_workout(promoted, now="2026-10-02T09:00:00+00:00")

    assert reopened.status is WorkoutStatus.DRAFT
    assert reopened.id == workout.id
    assert reopened.updated_at_utc == "2026-10-02T09:00:00+00:00"


def test_renumber_sets_on_an_empty_list_is_empty() -> None:
    assert renumber_sets([]) == ()


def test_completion_needs_no_database() -> None:
    """Tier 2 is pure logic over in-memory objects; the autosave path never pays for it."""
    workout = Workout(
        id=WORKOUT_ID,
        performed_on="2026-10-01",
        performed_time_local=None,
        status=WorkoutStatus.DRAFT,
        notes=None,
        entered_at_utc="2026-10-01T19:00:00+00:00",
        updated_at_utc="2026-10-01T19:00:00+00:00",
    )

    promoted, report = complete_workout(workout, [make_set(1)])

    assert report.ok is True
    assert promoted.status is WorkoutStatus.COMPLETE
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_completion.py -v
```

Expected: FAIL at collection — `ModuleNotFoundError: No module named
'fitness_lab.domain.completion'`.

- [ ] **Step 3: Implement the rules**

Create `backend/src/fitness_lab/domain/completion.py`:

```python
"""Completion preconditions, evaluated only on the draft -> complete transition.

The database guarantees what must be true of any row; this module guarantees what must
additionally be true before a workout may be called evidence. reps and set_type block
because a set without them cannot be interpreted; load and RIR only advise, because
forcing a lifter to supply a load they do not remember writes a falsehood into
permanent history.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

from fitness_lab.domain.models import PerformedSet, Workout, WorkoutStatus, utc_now_iso


@dataclass(frozen=True, slots=True)
class CompletionIssue:
    rule: str
    message: str
    set_orders: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class CompletionReport:
    ok: bool
    blockers: tuple[CompletionIssue, ...]
    advisories: tuple[CompletionIssue, ...]
    sets: tuple[PerformedSet, ...]
    renumbered: bool


def renumber_sets(sets: Sequence[PerformedSet]) -> tuple[PerformedSet, ...]:
    """Rule C3's repair: a dense 1..n sequence in the recorded chronological order."""
    ordered = sorted(sets, key=lambda performed: performed.set_order)
    return tuple(
        performed if performed.set_order == position else replace(performed, set_order=position)
        for position, performed in enumerate(ordered, start=1)
    )


def evaluate_completion(sets: Sequence[PerformedSet]) -> CompletionReport:
    """Apply C1-C4 and the advisories. C3 repairs first, then everything is re-verified."""
    ordered = renumber_sets(sets)
    renumbered = [performed.set_order for performed in sorted(sets, key=lambda s: s.set_order)] != [
        performed.set_order for performed in ordered
    ]

    blockers: list[CompletionIssue] = []
    advisories: list[CompletionIssue] = []

    if not ordered:
        blockers.append(
            CompletionIssue("C1", "a workout with no sets is not evidence of training", ())
        )

    missing_reps = tuple(performed.set_order for performed in ordered if performed.reps is None)
    if missing_reps:
        blockers.append(
            CompletionIssue("C2", f"sets missing reps: {list(missing_reps)}", missing_reps)
        )

    missing_type = tuple(performed.set_order for performed in ordered if performed.set_type is None)
    if missing_type:
        blockers.append(
            CompletionIssue("C4", f"sets missing set_type: {list(missing_type)}", missing_type)
        )

    missing_load = tuple(performed.set_order for performed in ordered if performed.load_kg is None)
    if missing_load:
        advisories.append(
            CompletionIssue("A-LOAD", f"sets with no recorded load: {list(missing_load)}", missing_load)
        )

    missing_rir = tuple(performed.set_order for performed in ordered if performed.rir is None)
    if missing_rir:
        advisories.append(
            CompletionIssue("A-RIR", f"sets with no recorded RIR: {list(missing_rir)}", missing_rir)
        )

    return CompletionReport(
        ok=not blockers,
        blockers=tuple(blockers),
        advisories=tuple(advisories),
        sets=ordered,
        renumbered=renumbered,
    )


def complete_workout(
    workout: Workout, sets: Sequence[PerformedSet], *, now: str | None = None
) -> tuple[Workout, CompletionReport]:
    """Promote draft -> complete when C1-C4 pass. Returns the workout unchanged if not."""
    report = evaluate_completion(sets)
    if not report.ok:
        return workout, report
    return (
        replace(
            workout,
            status=WorkoutStatus.COMPLETE,
            updated_at_utc=now if now is not None else utc_now_iso(),
        ),
        report,
    )


def reopen_workout(workout: Workout, *, now: str | None = None) -> Workout:
    """complete -> draft, to correct a record. Always permitted; re-runs nothing."""
    return replace(
        workout,
        status=WorkoutStatus.DRAFT,
        updated_at_utc=now if now is not None else utc_now_iso(),
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_completion.py -v
```

Expected: PASS, all 18 tests.

- [ ] **Step 5: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/fitness_lab/domain/completion.py backend/tests/test_completion.py
git commit -m "feat(domain): completion rules C1-C4 with renumbering repair and advisories"
```

---

### Task 9: Performed-training schema migration

**Files:**
- Create: `backend/migrations/0002_performed_training.sql`
- Test: `backend/tests/test_schema_constraints.py` (create)

**Interfaces:**
- Consumes: the `migrated_db` fixture from `backend/tests/conftest.py`.
- Produces: version 2 of the schema — tables `set_type` (seeded), `exercise`, `workout`,
  `performed_set`; indexes `ux_exercise_identity`, `ix_workout_performed_on`,
  `ix_performed_set_exercise`; the virtual generated column `performed_set.load_kg`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_schema_constraints.py`. Every `CHECK` is tested with bad input,
never merely read — a SQL `CHECK` passes on NULL and fails only on false, which is how a
`performed_on` constraint can silently accept `'2026-13-01'`.

```python
"""The §10 DDL, asserted against a real migrated database."""

from __future__ import annotations

import sqlite3

import pytest

STAMP = "2026-10-01T19:00:00+00:00"


def insert_exercise(
    connection: sqlite3.Connection,
    exercise_id: str,
    name: str,
    equipment_label: str | None = None,
) -> None:
    connection.execute(
        "INSERT INTO exercise (id, name, equipment_label, notes, is_active, "
        "created_at_utc, updated_at_utc) VALUES (?, ?, ?, NULL, 1, ?, ?)",
        (exercise_id, name, equipment_label, STAMP, STAMP),
    )


def insert_workout(
    connection: sqlite3.Connection,
    workout_id: str,
    performed_on: str = "2026-10-01",
    performed_time_local: str | None = "19:45",
    status: str = "draft",
) -> None:
    connection.execute(
        "INSERT INTO workout (id, performed_on, performed_time_local, status, notes, "
        "entered_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, NULL, ?, ?)",
        (workout_id, performed_on, performed_time_local, status, STAMP, STAMP),
    )


def insert_set(connection: sqlite3.Connection, set_id: str, **columns: object) -> None:
    values: dict[str, object] = {
        "id": set_id,
        "workout_id": "w1",
        "exercise_id": "e1",
        "set_order": 1,
        "set_type": None,
        "load_g": None,
        "reps": None,
        "rir": None,
        "notes": None,
        "entered_at_utc": STAMP,
        "updated_at_utc": STAMP,
    }
    values.update(columns)
    names = ", ".join(values)
    placeholders = ", ".join("?" for _ in values)
    connection.execute(
        f"INSERT INTO performed_set ({names}) VALUES ({placeholders})", tuple(values.values())
    )


@pytest.fixture
def seeded(migrated_db: sqlite3.Connection) -> sqlite3.Connection:
    insert_exercise(migrated_db, "e1", "Incline Chest Press", "Hammer Strength")
    insert_workout(migrated_db, "w1")
    return migrated_db


def test_every_m1_table_is_strict(migrated_db: sqlite3.Connection) -> None:
    rows = migrated_db.execute(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN "
        "('schema_migrations', 'set_type', 'exercise', 'workout', 'performed_set')"
    ).fetchall()
    assert len(rows) == 5
    for row in rows:
        assert "STRICT" in str(row["sql"]).upper(), row["name"]


def test_set_type_is_seeded_in_display_order(migrated_db: sqlite3.Connection) -> None:
    rows = migrated_db.execute(
        "SELECT code, description, sort_order FROM set_type ORDER BY sort_order"
    ).fetchall()

    assert [str(row["code"]) for row in rows] == ["warmup", "working", "backoff"]
    assert [int(row["sort_order"]) for row in rows] == [1, 2, 3]
    assert all(str(row["description"]) for row in rows)


def test_the_expected_indexes_exist(migrated_db: sqlite3.Connection) -> None:
    names = {
        str(row["name"])
        for row in migrated_db.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
    }

    assert {"ux_exercise_identity", "ix_workout_performed_on", "ix_performed_set_exercise"} <= names


def test_workout_has_no_unique_constraint_on_the_date(migrated_db: sqlite3.Connection) -> None:
    """Two sessions on one calendar date are allowed."""
    insert_workout(migrated_db, "w1", performed_on="2026-10-01")
    insert_workout(migrated_db, "w2", performed_on="2026-10-01")

    count = migrated_db.execute(
        "SELECT count(*) AS n FROM workout WHERE performed_on = '2026-10-01'"
    ).fetchone()["n"]
    assert count == 2


def test_a_blank_exercise_name_is_rejected(migrated_db: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_exercise(migrated_db, "e9", "   ")


@pytest.mark.parametrize("label", ["", "   "])
def test_a_blank_equipment_label_is_unstorable(
    migrated_db: sqlite3.Connection, label: str
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_exercise(migrated_db, "e9", "Incline Chest Press", label)


def test_the_same_name_on_different_equipment_is_two_identities(
    migrated_db: sqlite3.Connection,
) -> None:
    insert_exercise(migrated_db, "e1", "Incline Chest Press", "Technogym Pure Strength")
    insert_exercise(migrated_db, "e2", "Incline Chest Press", "Hammer Strength")

    rows = migrated_db.execute("SELECT id FROM exercise ORDER BY id").fetchall()
    assert [str(row["id"]) for row in rows] == ["e1", "e2"]


def test_case_and_whitespace_variants_are_the_same_identity(
    migrated_db: sqlite3.Connection,
) -> None:
    insert_exercise(migrated_db, "e1", "Incline Chest Press", "Hammer Strength")

    with pytest.raises(sqlite3.IntegrityError, match="ux_exercise_identity"):
        insert_exercise(migrated_db, "e2", "incline chest press", "  hammer strength ")


def test_two_rows_with_the_same_name_and_both_labels_null_are_rejected(
    migrated_db: sqlite3.Connection,
) -> None:
    """The coalesce() in ux_exercise_identity is load-bearing: UNIQUE treats NULLs as distinct."""
    insert_exercise(migrated_db, "e1", "Incline Chest Press", None)

    with pytest.raises(sqlite3.IntegrityError, match="ux_exercise_identity"):
        insert_exercise(migrated_db, "e2", "incline chest press", None)


def test_a_null_equipment_label_does_not_collide_with_a_real_one(
    migrated_db: sqlite3.Connection,
) -> None:
    insert_exercise(migrated_db, "e1", "Incline Chest Press", None)
    insert_exercise(migrated_db, "e2", "Incline Chest Press", "Hammer Strength")

    assert migrated_db.execute("SELECT count(*) AS n FROM exercise").fetchone()["n"] == 2


@pytest.mark.parametrize(
    "performed_on", ["2026-02-31", "2026-13-01", "2026-10-1", "1 Oct 2026", ""]
)
def test_malformed_dates_are_rejected(migrated_db: sqlite3.Connection, performed_on: str) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_workout(migrated_db, "w9", performed_on=performed_on)


@pytest.mark.parametrize("performed_on", ["2026-10-01", "2028-02-29"])
def test_real_dates_are_accepted(migrated_db: sqlite3.Connection, performed_on: str) -> None:
    insert_workout(migrated_db, f"w-{performed_on}", performed_on=performed_on)


@pytest.mark.parametrize("performed_time_local", ["25:00", "7:45", "19:45:30", ""])
def test_malformed_times_are_rejected(
    migrated_db: sqlite3.Connection, performed_time_local: str
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_workout(migrated_db, "w9", performed_time_local=performed_time_local)


def test_a_missing_time_is_not_midnight(migrated_db: sqlite3.Connection) -> None:
    insert_workout(migrated_db, "w1", performed_time_local=None)

    row = migrated_db.execute("SELECT performed_time_local FROM workout WHERE id = 'w1'").fetchone()
    assert row["performed_time_local"] is None


def test_only_draft_and_complete_are_valid_statuses(migrated_db: sqlite3.Connection) -> None:
    insert_workout(migrated_db, "w1", status="draft")
    insert_workout(migrated_db, "w2", status="complete")

    with pytest.raises(sqlite3.IntegrityError):
        insert_workout(migrated_db, "w3", status="abandoned")


def test_strict_rejects_text_in_the_gram_column(seeded: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="TEXT value in INTEGER column"):
        insert_set(seeded, "s1", load_g="heavy")


def test_negative_load_and_negative_reps_are_rejected(seeded: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_set(seeded, "s1", load_g=-1)
    with pytest.raises(sqlite3.IntegrityError):
        insert_set(seeded, "s2", set_order=2, reps=-1)


def test_set_order_is_one_based(seeded: sqlite3.Connection) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_set(seeded, "s1", set_order=0)


def test_duplicate_set_positions_are_rejected(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1)

    with pytest.raises(sqlite3.IntegrityError, match="workout_id"):
        insert_set(seeded, "s2", set_order=1)


def test_rir_has_no_database_bound(seeded: sqlite3.Connection) -> None:
    """A methodology assumption must not live in the table most expensive to rebuild."""
    insert_set(seeded, "s1", set_order=1, rir=-1)

    row = seeded.execute("SELECT rir FROM performed_set WHERE id = 's1'").fetchone()
    assert row["rir"] == -1


def test_null_is_distinguishable_from_zero_for_every_nullable_measurement(
    seeded: sqlite3.Connection,
) -> None:
    insert_set(seeded, "s1", set_order=1, load_g=None, reps=None, rir=None)
    insert_set(seeded, "s2", set_order=2, load_g=0, reps=0, rir=0)

    null_row = seeded.execute(
        "SELECT id FROM performed_set WHERE load_g IS NULL AND reps IS NULL AND rir IS NULL"
    ).fetchone()
    zero_row = seeded.execute(
        "SELECT id FROM performed_set WHERE load_g = 0 AND reps = 0 AND rir = 0"
    ).fetchone()

    assert str(null_row["id"]) == "s1"
    assert str(zero_row["id"]) == "s2"


def test_set_type_may_be_null_but_never_invalid(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1, set_type=None)
    insert_set(seeded, "s2", set_order=2, set_type="warmup")

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_set(seeded, "s3", set_order=3, set_type="nope")


def test_set_type_has_no_default(seeded: sqlite3.Connection) -> None:
    """A row autosaved before classification must not silently acquire 'working'."""
    seeded.execute(
        "INSERT INTO performed_set (id, workout_id, exercise_id, set_order, "
        "entered_at_utc, updated_at_utc) VALUES ('s1', 'w1', 'e1', 1, ?, ?)",
        (STAMP, STAMP),
    )

    row = seeded.execute("SELECT set_type FROM performed_set WHERE id = 's1'").fetchone()
    assert row["set_type"] is None


def test_a_referenced_set_type_cannot_be_deleted(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1, set_type="working")

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        seeded.execute("DELETE FROM set_type WHERE code = 'working'")


def test_deleting_a_workout_cascades_to_its_sets(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1)

    seeded.execute("DELETE FROM workout WHERE id = 'w1'")

    assert seeded.execute("SELECT count(*) AS n FROM performed_set").fetchone()["n"] == 0


def test_deleting_a_referenced_exercise_is_blocked(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1)

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        seeded.execute("DELETE FROM exercise WHERE id = 'e1'")


def test_deleting_an_unused_exercise_is_permitted(seeded: sqlite3.Connection) -> None:
    insert_exercise(seeded, "e2", "Never Performed")

    seeded.execute("DELETE FROM exercise WHERE id = 'e2'")

    assert seeded.execute("SELECT count(*) AS n FROM exercise").fetchone()["n"] == 1


def test_load_kg_is_generated_and_read_only(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1, load_g=102500)

    row = seeded.execute("SELECT load_g, load_kg FROM performed_set WHERE id = 's1'").fetchone()
    assert row["load_g"] == 102500
    assert row["load_kg"] == 102.5

    with pytest.raises(sqlite3.OperationalError, match="generated column"):
        seeded.execute("UPDATE performed_set SET load_kg = 5 WHERE id = 's1'")
    with pytest.raises(sqlite3.OperationalError, match="generated column"):
        seeded.execute(
            "INSERT INTO performed_set (id, workout_id, exercise_id, set_order, load_kg, "
            "entered_at_utc, updated_at_utc) VALUES ('s2', 'w1', 'e1', 2, 10.0, ?, ?)",
            (STAMP, STAMP),
        )


def test_load_kg_is_null_when_no_load_is_recorded(seeded: sqlite3.Connection) -> None:
    insert_set(seeded, "s1", set_order=1, load_g=None)

    row = seeded.execute("SELECT load_kg FROM performed_set WHERE id = 's1'").fetchone()
    assert row["load_kg"] is None


def test_a_set_cannot_reference_a_missing_workout_or_exercise(
    seeded: sqlite3.Connection,
) -> None:
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_set(seeded, "s1", workout_id="nope")
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        insert_set(seeded, "s2", set_order=2, exercise_id="nope")


def test_the_schema_carries_no_deferred_or_future_columns(
    migrated_db: sqlite3.Connection,
) -> None:
    """No movement_family, no group_key, no side, no duration, no program reference."""
    exercise_columns = {
        str(row["name"]) for row in migrated_db.execute("PRAGMA table_info(exercise)")
    }
    set_columns = {
        str(row["name"]) for row in migrated_db.execute("PRAGMA table_info(performed_set)")
    }

    assert "movement_family_id" not in exercise_columns
    assert {"group_key", "side", "duration_seconds", "e1rm", "volume"} & set_columns == set()


def test_foreign_key_check_is_clean_at_head(migrated_db: sqlite3.Connection) -> None:
    assert migrated_db.execute("PRAGMA foreign_key_check").fetchall() == []
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_schema_constraints.py -v
```

Expected: FAIL — `sqlite3.OperationalError: no such table: exercise` (version 2 does not exist
yet).

- [ ] **Step 3: Write the migration**

Create `backend/migrations/0002_performed_training.sql` with exactly the §10 DDL:

```sql
-- 0002_performed_training.sql
-- The performed-training foundation. Purely additive: CREATE TABLE, CREATE INDEX and a
-- vocabulary seed. Nothing is rebuilt, so no foreign-key-off dance is needed.

CREATE TABLE set_type (
    code        TEXT    PRIMARY KEY,
    description TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL
) STRICT;

INSERT INTO set_type (code, description, sort_order) VALUES
    ('warmup',  'Warm-up set',  1),
    ('working', 'Working set',  2),
    ('backoff', 'Back-off set', 3);

CREATE TABLE exercise (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    equipment_label TEXT    CHECK (equipment_label IS NULL
                                   OR length(trim(equipment_label)) > 0),
    notes           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at_utc  TEXT    NOT NULL,
    updated_at_utc  TEXT    NOT NULL
) STRICT;

-- coalesce() is required and must not be removed: without it, two rows with the same
-- name and a NULL equipment_label are BOTH accepted, because UNIQUE treats NULLs as
-- mutually distinct. That silent duplicate identity is the exact failure this index exists
-- to prevent.
CREATE UNIQUE INDEX ux_exercise_identity ON exercise (
    lower(trim(name)),
    coalesce(lower(trim(equipment_label)), '')
);

CREATE TABLE workout (
    id                   TEXT PRIMARY KEY,
    performed_on         TEXT NOT NULL
        CHECK (date(performed_on) IS NOT NULL AND performed_on = date(performed_on)),
    performed_time_local TEXT
        CHECK (performed_time_local IS NULL
               OR (time(performed_time_local) IS NOT NULL
                   AND performed_time_local = substr(time(performed_time_local), 1, 5))),
    status               TEXT NOT NULL CHECK (status IN ('draft', 'complete')),
    notes                TEXT,
    entered_at_utc       TEXT NOT NULL,
    updated_at_utc       TEXT NOT NULL
) STRICT;

-- Deliberately NOT unique: two sessions on one calendar date are allowed.
CREATE INDEX ix_workout_performed_on ON workout (performed_on);

CREATE TABLE performed_set (
    id             TEXT    PRIMARY KEY,
    workout_id     TEXT    NOT NULL REFERENCES workout(id)    ON DELETE CASCADE,
    exercise_id    TEXT    NOT NULL REFERENCES exercise(id)   ON DELETE RESTRICT,
    set_order      INTEGER NOT NULL CHECK (set_order >= 1),
    set_type       TEXT             REFERENCES set_type(code) ON DELETE RESTRICT,
    load_g         INTEGER          CHECK (load_g IS NULL OR load_g >= 0),
    reps           INTEGER          CHECK (reps   IS NULL OR reps   >= 0),
    rir            INTEGER,
    notes          TEXT,
    entered_at_utc TEXT    NOT NULL,
    updated_at_utc TEXT    NOT NULL,
    load_kg        REAL GENERATED ALWAYS AS (load_g / 1000.0) VIRTUAL,
    UNIQUE (workout_id, set_order)
) STRICT;

CREATE INDEX ix_performed_set_exercise ON performed_set (exercise_id);
```

Deliberate absences to preserve exactly: `set_type` has **no** `NOT NULL` and **no**
`DEFAULT`; `rir` has **no** `CHECK`; `workout` has **no** `UNIQUE(performed_on)`;
`performed_set` has **no** `group_key`, `side` or `duration_seconds`; `exercise` has **no**
`movement_family_id`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_schema_constraints.py -v
```

Expected: PASS, every parametrized case included.

- [ ] **Step 5: Verify the real database migrates from version 1 to version 2**

```bash
cd backend && uv run python -c "
from fitness_lab.storage import db
from fitness_lab.storage.migrations import migrate_to_head
print(migrate_to_head())
print(db.read_technical_check())
with db.connection_scope() as c:
    print(sorted(r['name'] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")))
    print(c.execute('PRAGMA foreign_key_check').fetchall())
"
```

Expected: `applied=(2,)` with a snapshot path on the first run, the M0 row unchanged, the
tables `exercise`, `m0_technical_check`, `performed_set`, `schema_migrations`, `set_type`,
`workout`, and an empty `foreign_key_check`.

- [ ] **Step 6: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/0002_performed_training.sql backend/tests/test_schema_constraints.py
git commit -m "feat(storage): performed-training schema migration with verified constraints"
```

---

### Task 10: Exercise persistence

**Files:**
- Create: `backend/src/fitness_lab/storage/exercises.py`
- Test: `backend/tests/test_exercises.py` (create)

**Interfaces:**
- Consumes: `fitness_lab.domain.models` (`Exercise`, `create_exercise`, `rename_exercise`,
  `deactivate_exercise`), the `migrated_db` fixture.
- Produces:
  - `insert_exercise(connection: sqlite3.Connection, exercise: Exercise) -> None`
  - `update_exercise(connection: sqlite3.Connection, exercise: Exercise) -> None`
  - `get_exercise(connection: sqlite3.Connection, exercise_id: str) -> Exercise | None`
  - `find_exercise_by_identity(connection: sqlite3.Connection, name: str, equipment_label: str | None) -> Exercise | None`
  - `list_exercises(connection: sqlite3.Connection, *, include_inactive: bool = False) -> tuple[Exercise, ...]`
  - `delete_exercise(connection: sqlite3.Connection, exercise_id: str) -> None`
  - `row_to_exercise(row: sqlite3.Row) -> Exercise`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_exercises.py`:

```python
"""Exercise persistence: identity that survives renaming, retirement and time."""

from __future__ import annotations

import sqlite3

import pytest

from fitness_lab.domain.models import create_exercise, deactivate_exercise, rename_exercise
from fitness_lab.storage.exercises import (
    delete_exercise,
    find_exercise_by_identity,
    get_exercise,
    insert_exercise,
    list_exercises,
    update_exercise,
)

STAMP = "2026-10-01T19:00:00+00:00"


def test_an_exercise_round_trips(migrated_db: sqlite3.Connection) -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength", notes="left of rack")

    insert_exercise(migrated_db, exercise)

    assert get_exercise(migrated_db, exercise.id) == exercise


def test_an_exercise_without_an_equipment_label_round_trips(
    migrated_db: sqlite3.Connection,
) -> None:
    exercise = create_exercise("Incline dumbbell press")

    insert_exercise(migrated_db, exercise)

    stored = get_exercise(migrated_db, exercise.id)
    assert stored is not None
    assert stored.equipment_label is None


def test_get_exercise_returns_none_when_absent(migrated_db: sqlite3.Connection) -> None:
    assert get_exercise(migrated_db, "nope") is None


def test_the_same_name_on_two_machines_is_two_ids(migrated_db: sqlite3.Connection) -> None:
    hammer = create_exercise("Incline Chest Press", "Hammer Strength")
    technogym = create_exercise("Incline Chest Press", "Technogym Pure Strength")

    insert_exercise(migrated_db, hammer)
    insert_exercise(migrated_db, technogym)

    assert hammer.id != technogym.id
    assert len(list_exercises(migrated_db)) == 2


def test_a_duplicate_normalized_identity_is_refused(migrated_db: sqlite3.Connection) -> None:
    insert_exercise(migrated_db, create_exercise("Incline Chest Press", "Hammer Strength"))

    with pytest.raises(sqlite3.IntegrityError):
        insert_exercise(migrated_db, create_exercise("incline chest press", " hammer strength "))


def test_a_duplicate_identity_with_both_labels_null_is_refused(
    migrated_db: sqlite3.Connection,
) -> None:
    insert_exercise(migrated_db, create_exercise("Incline Chest Press"))

    with pytest.raises(sqlite3.IntegrityError):
        insert_exercise(migrated_db, create_exercise("incline chest press"))


def test_find_by_identity_normalizes_case_and_whitespace(
    migrated_db: sqlite3.Connection,
) -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)

    found = find_exercise_by_identity(migrated_db, "  incline chest press ", "HAMMER STRENGTH")

    assert found is not None
    assert found.id == exercise.id


def test_find_by_identity_treats_a_missing_label_as_its_own_identity(
    migrated_db: sqlite3.Connection,
) -> None:
    without = create_exercise("Incline Chest Press")
    with_label = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, without)
    insert_exercise(migrated_db, with_label)

    found = find_exercise_by_identity(migrated_db, "Incline Chest Press", None)

    assert found is not None
    assert found.id == without.id


def test_find_by_identity_returns_none_when_nothing_matches(
    migrated_db: sqlite3.Connection,
) -> None:
    assert find_exercise_by_identity(migrated_db, "Nothing", None) is None


def test_renaming_keeps_the_id_and_moves_only_updated_at(
    migrated_db: sqlite3.Connection,
) -> None:
    exercise = create_exercise("Incline Chest Pres", "Hammer Strength", now=STAMP)
    insert_exercise(migrated_db, exercise)

    corrected = rename_exercise(
        exercise, "Incline Chest Press", "Hammer Strength Iso-Lateral", now="2026-10-02T09:00:00+00:00"
    )
    update_exercise(migrated_db, corrected)

    stored = get_exercise(migrated_db, exercise.id)
    assert stored == corrected
    assert stored is not None
    assert stored.created_at_utc == STAMP


def test_deactivating_hides_from_pickers_but_keeps_the_row(
    migrated_db: sqlite3.Connection,
) -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)

    update_exercise(migrated_db, deactivate_exercise(exercise))

    assert list_exercises(migrated_db) == ()
    retired = list_exercises(migrated_db, include_inactive=True)
    assert len(retired) == 1
    assert retired[0].is_active is False


def test_list_exercises_is_ordered_by_name_then_label(migrated_db: sqlite3.Connection) -> None:
    insert_exercise(migrated_db, create_exercise("Squat", "Rack 2"))
    insert_exercise(migrated_db, create_exercise("Incline Chest Press", "Technogym"))
    insert_exercise(migrated_db, create_exercise("Incline Chest Press", "Hammer Strength"))

    listed = list_exercises(migrated_db)

    assert [(item.name, item.equipment_label) for item in listed] == [
        ("Incline Chest Press", "Hammer Strength"),
        ("Incline Chest Press", "Technogym"),
        ("Squat", "Rack 2"),
    ]


def test_deleting_an_unused_exercise_is_permitted(migrated_db: sqlite3.Connection) -> None:
    exercise = create_exercise("Never Performed")
    insert_exercise(migrated_db, exercise)

    delete_exercise(migrated_db, exercise.id)

    assert get_exercise(migrated_db, exercise.id) is None


def test_is_active_round_trips_as_a_bool_not_an_int(migrated_db: sqlite3.Connection) -> None:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)

    stored = get_exercise(migrated_db, exercise.id)

    assert stored is not None
    assert stored.is_active is True
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_exercises.py -v
```

Expected: FAIL at collection — `ModuleNotFoundError: No module named
'fitness_lab.storage.exercises'`.

- [ ] **Step 3: Implement the module**

Create `backend/src/fitness_lab/storage/exercises.py`:

```python
"""Exercise rows <-> domain entities.

Concrete functions, not a repository interface: there is one database, it is SQLite, and
it will be SQLite in ten years.
"""

from __future__ import annotations

import sqlite3

from fitness_lab.domain.models import Exercise

COLUMNS = "id, name, equipment_label, notes, is_active, created_at_utc, updated_at_utc"


def row_to_exercise(row: sqlite3.Row) -> Exercise:
    return Exercise(
        id=str(row["id"]),
        name=str(row["name"]),
        equipment_label=None if row["equipment_label"] is None else str(row["equipment_label"]),
        notes=None if row["notes"] is None else str(row["notes"]),
        is_active=bool(row["is_active"]),
        created_at_utc=str(row["created_at_utc"]),
        updated_at_utc=str(row["updated_at_utc"]),
    )


def insert_exercise(connection: sqlite3.Connection, exercise: Exercise) -> None:
    connection.execute(
        f"INSERT INTO exercise ({COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            exercise.id,
            exercise.name,
            exercise.equipment_label,
            exercise.notes,
            int(exercise.is_active),
            exercise.created_at_utc,
            exercise.updated_at_utc,
        ),
    )


def update_exercise(connection: sqlite3.Connection, exercise: Exercise) -> None:
    """Plain UPDATE. History is untouched by construction: no row stores an exercise name."""
    connection.execute(
        "UPDATE exercise SET name = ?, equipment_label = ?, notes = ?, is_active = ?, "
        "updated_at_utc = ? WHERE id = ?",
        (
            exercise.name,
            exercise.equipment_label,
            exercise.notes,
            int(exercise.is_active),
            exercise.updated_at_utc,
            exercise.id,
        ),
    )


def get_exercise(connection: sqlite3.Connection, exercise_id: str) -> Exercise | None:
    row = connection.execute(
        f"SELECT {COLUMNS} FROM exercise WHERE id = ?", (exercise_id,)
    ).fetchone()
    return None if row is None else row_to_exercise(row)


def find_exercise_by_identity(
    connection: sqlite3.Connection, name: str, equipment_label: str | None
) -> Exercise | None:
    """Match the normalized pair exactly as ux_exercise_identity does."""
    row = connection.execute(
        f"SELECT {COLUMNS} FROM exercise "
        "WHERE lower(trim(name)) = lower(trim(?)) "
        "AND coalesce(lower(trim(equipment_label)), '') = coalesce(lower(trim(?)), '')",
        (name, equipment_label),
    ).fetchone()
    return None if row is None else row_to_exercise(row)


def list_exercises(
    connection: sqlite3.Connection, *, include_inactive: bool = False
) -> tuple[Exercise, ...]:
    predicate = "" if include_inactive else "WHERE is_active = 1 "
    rows = connection.execute(
        f"SELECT {COLUMNS} FROM exercise {predicate}"
        "ORDER BY lower(trim(name)), coalesce(lower(trim(equipment_label)), '')"
    ).fetchall()
    return tuple(row_to_exercise(row) for row in rows)


def delete_exercise(connection: sqlite3.Connection, exercise_id: str) -> None:
    """Permitted only for an unused exercise: ON DELETE RESTRICT blocks the rest."""
    connection.execute("DELETE FROM exercise WHERE id = ?", (exercise_id,))
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_exercises.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/fitness_lab/storage/exercises.py backend/tests/test_exercises.py
git commit -m "feat(storage): exercise persistence with normalized identity lookup"
```

---

### Task 11: Workout and performed-set persistence

**Files:**
- Create: `backend/src/fitness_lab/storage/workouts.py`
- Test: `backend/tests/test_workouts.py` (create)

**Interfaces:**
- Consumes: `fitness_lab.domain.models`, `fitness_lab.domain.units` (`kg_to_g`, `g_to_kg`),
  `fitness_lab.storage.exercises.insert_exercise`.
- Produces:
  - `insert_workout(connection, workout: Workout) -> None`
  - `update_workout(connection, workout: Workout) -> None`
  - `get_workout(connection, workout_id: str) -> Workout | None`
  - `list_workouts_on(connection, performed_on: str) -> tuple[Workout, ...]`
  - `insert_performed_set(connection, performed_set: PerformedSet) -> None`
  - `update_performed_set(connection, performed_set: PerformedSet) -> None`
  - `list_sets_for_workout(connection, workout_id: str) -> tuple[PerformedSet, ...]`
  - `row_to_workout(row) -> Workout`, `row_to_performed_set(row) -> PerformedSet`
  - This is the only layer that converts kilograms to `load_g` and back.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_workouts.py`:

```python
"""Workout and performed-set persistence: the canonical evidence path."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

import pytest

from fitness_lab.domain.models import (
    PerformedSet,
    SetTypeCode,
    Workout,
    WorkoutStatus,
    create_exercise,
    new_draft_workout,
    new_id,
)
from fitness_lab.storage.exercises import insert_exercise
from fitness_lab.storage.workouts import (
    get_workout,
    insert_performed_set,
    insert_workout,
    list_sets_for_workout,
    list_workouts_on,
    update_performed_set,
    update_workout,
)

STAMP = "2026-10-01T19:00:00+00:00"


@pytest.fixture
def exercise_id(migrated_db: sqlite3.Connection) -> str:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)
    return exercise.id


@pytest.fixture
def workout(migrated_db: sqlite3.Connection) -> Workout:
    created = new_draft_workout(
        "2026-10-01", performed_time_local="18:30", notes="first logged session", now=STAMP
    )
    insert_workout(migrated_db, created)
    return created


def make_set(
    workout_id: str,
    exercise_id: str,
    set_order: int,
    *,
    set_type: SetTypeCode | None = SetTypeCode.WORKING,
    load_kg: Decimal | None = Decimal("102.5"),
    reps: int | None = 8,
    rir: int | None = 2,
    notes: str | None = None,
) -> PerformedSet:
    return PerformedSet(
        id=new_id(),
        workout_id=workout_id,
        exercise_id=exercise_id,
        set_order=set_order,
        set_type=set_type,
        load_kg=load_kg,
        reps=reps,
        rir=rir,
        notes=notes,
        entered_at_utc=STAMP,
        updated_at_utc=STAMP,
    )


def test_a_workout_round_trips(migrated_db: sqlite3.Connection, workout: Workout) -> None:
    assert get_workout(migrated_db, workout.id) == workout


def test_a_workout_with_no_time_recorded_round_trips(migrated_db: sqlite3.Connection) -> None:
    created = new_draft_workout("2026-10-01", now=STAMP)
    insert_workout(migrated_db, created)

    stored = get_workout(migrated_db, created.id)

    assert stored is not None
    assert stored.performed_time_local is None


def test_two_workouts_on_the_same_date_are_allowed(migrated_db: sqlite3.Connection) -> None:
    morning = new_draft_workout("2026-10-01", performed_time_local="07:00", now=STAMP)
    evening = new_draft_workout("2026-10-01", performed_time_local="18:30", now=STAMP)
    insert_workout(migrated_db, morning)
    insert_workout(migrated_db, evening)

    found = list_workouts_on(migrated_db, "2026-10-01")

    assert {item.id for item in found} == {morning.id, evening.id}


def test_updating_a_workout_persists_the_status_transition(
    migrated_db: sqlite3.Connection, workout: Workout
) -> None:
    from dataclasses import replace

    promoted = replace(
        workout, status=WorkoutStatus.COMPLETE, updated_at_utc="2026-10-01T20:00:00+00:00"
    )

    update_workout(migrated_db, promoted)

    stored = get_workout(migrated_db, workout.id)
    assert stored is not None
    assert stored.status is WorkoutStatus.COMPLETE
    assert stored.entered_at_utc == STAMP


def test_a_full_workout_of_mixed_sets_round_trips(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    sets = [
        make_set(workout.id, exercise_id, 1, set_type=SetTypeCode.WARMUP, load_kg=Decimal("40"), reps=10, rir=None),
        make_set(workout.id, exercise_id, 2, load_kg=Decimal("102.5"), reps=8, rir=2),
        make_set(workout.id, exercise_id, 3, set_type=None, load_kg=None, reps=None, rir=None),
        make_set(workout.id, exercise_id, 4, set_type=SetTypeCode.BACKOFF, load_kg=Decimal("0"), reps=0, rir=0),
    ]
    for performed in sets:
        insert_performed_set(migrated_db, performed)

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert stored == tuple(sets)


def test_sets_come_back_in_global_chronological_order(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    for position in (3, 1, 2):
        insert_performed_set(migrated_db, make_set(workout.id, exercise_id, position))

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert [performed.set_order for performed in stored] == [1, 2, 3]


def test_kilograms_are_stored_as_exact_integer_grams(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    performed = make_set(workout.id, exercise_id, 1, load_kg=Decimal("102.5"))
    insert_performed_set(migrated_db, performed)

    row = migrated_db.execute(
        "SELECT load_g, load_kg FROM performed_set WHERE id = ?", (performed.id,)
    ).fetchone()

    assert row["load_g"] == 102500
    assert row["load_kg"] == 102.5
    stored = list_sets_for_workout(migrated_db, workout.id)[0]
    assert stored.load_kg == Decimal("102.5")


def test_a_null_load_is_not_zero(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    unrecorded = make_set(workout.id, exercise_id, 1, load_kg=None)
    bodyweight = make_set(workout.id, exercise_id, 2, load_kg=Decimal("0"))
    insert_performed_set(migrated_db, unrecorded)
    insert_performed_set(migrated_db, bodyweight)

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert stored[0].load_kg is None
    assert stored[1].load_kg == Decimal("0")


def test_a_null_reps_is_not_zero_reps(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1, reps=None))
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 2, reps=0))

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert stored[0].reps is None
    assert stored[1].reps == 0


def test_a_null_rir_is_not_zero_rir(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1, rir=None))
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 2, rir=0))

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert stored[0].rir is None
    assert stored[1].rir == 0


def test_a_negative_rir_persists(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    """Forced or assisted reps must remain recordable without a migration."""
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1, rir=-1))

    assert list_sets_for_workout(migrated_db, workout.id)[0].rir == -1


def test_a_negative_load_is_refused_before_it_reaches_the_database(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    performed = make_set(workout.id, exercise_id, 1, load_kg=Decimal("-1"))

    with pytest.raises(ValueError, match="negative"):
        insert_performed_set(migrated_db, performed)


def test_sub_gram_precision_is_refused_before_it_reaches_the_database(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    performed = make_set(workout.id, exercise_id, 1, load_kg=Decimal("0.0005"))

    with pytest.raises(ValueError, match="sub-gram"):
        insert_performed_set(migrated_db, performed)


def test_two_sets_cannot_claim_the_same_position(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))

    with pytest.raises(sqlite3.IntegrityError):
        insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))


def test_the_same_position_in_two_workouts_is_fine(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    other = new_draft_workout("2026-10-02", now=STAMP)
    insert_workout(migrated_db, other)

    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))
    insert_performed_set(migrated_db, make_set(other.id, exercise_id, 1))

    assert len(list_sets_for_workout(migrated_db, other.id)) == 1


def test_an_alternating_interleave_is_visible_as_an_interleave(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    other = create_exercise("Seated Row", "Technogym")
    insert_exercise(migrated_db, other)
    for position, target in enumerate([exercise_id, other.id, exercise_id, other.id], start=1):
        insert_performed_set(migrated_db, make_set(workout.id, target, position))

    stored = list_sets_for_workout(migrated_db, workout.id)

    assert [performed.exercise_id for performed in stored] == [
        exercise_id,
        other.id,
        exercise_id,
        other.id,
    ]


def test_correcting_a_set_updates_in_place_and_moves_updated_at(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    from dataclasses import replace

    performed = make_set(workout.id, exercise_id, 1, reps=8)
    insert_performed_set(migrated_db, performed)

    corrected = replace(performed, reps=9, updated_at_utc="2026-10-01T20:00:00+00:00")
    update_performed_set(migrated_db, corrected)

    stored = list_sets_for_workout(migrated_db, workout.id)[0]
    assert stored.reps == 9
    assert stored.entered_at_utc == STAMP
    assert stored.updated_at_utc == "2026-10-01T20:00:00+00:00"


def test_correcting_an_exercise_label_leaves_every_set_row_untouched(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    """No row anywhere stores an exercise name, so a rename cannot disturb history."""
    from fitness_lab.domain.models import rename_exercise
    from fitness_lab.storage.exercises import get_exercise, update_exercise

    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))
    before = list_sets_for_workout(migrated_db, workout.id)

    exercise = get_exercise(migrated_db, exercise_id)
    assert exercise is not None
    update_exercise(
        migrated_db, rename_exercise(exercise, "Incline Press", "Hammer Strength Iso-Lateral")
    )

    assert list_sets_for_workout(migrated_db, workout.id) == before


def test_history_stays_readable_after_the_exercise_is_retired(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    from fitness_lab.domain.models import deactivate_exercise
    from fitness_lab.storage.exercises import get_exercise, update_exercise

    insert_performed_set(migrated_db, make_set(workout.id, exercise_id, 1))
    exercise = get_exercise(migrated_db, exercise_id)
    assert exercise is not None

    update_exercise(migrated_db, deactivate_exercise(exercise))

    stored = list_sets_for_workout(migrated_db, workout.id)
    assert stored[0].exercise_id == exercise_id
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_workouts.py -v
```

Expected: FAIL at collection — `ModuleNotFoundError: No module named
'fitness_lab.storage.workouts'`.

- [ ] **Step 3: Implement the module**

Create `backend/src/fitness_lab/storage/workouts.py`:

```python
"""Workout and performed-set rows <-> domain entities.

This is the only place where kilograms become integer grams. The domain never sees the
gram representation, and load_kg in the database is a read-only generated column that
exists so hand-written SQL reads in kilograms.
"""

from __future__ import annotations

import sqlite3

from fitness_lab.domain.models import PerformedSet, SetTypeCode, Workout, WorkoutStatus
from fitness_lab.domain.units import g_to_kg, kg_to_g

WORKOUT_COLUMNS = (
    "id, performed_on, performed_time_local, status, notes, entered_at_utc, updated_at_utc"
)
SET_COLUMNS = (
    "id, workout_id, exercise_id, set_order, set_type, load_g, reps, rir, notes, "
    "entered_at_utc, updated_at_utc"
)


def row_to_workout(row: sqlite3.Row) -> Workout:
    return Workout(
        id=str(row["id"]),
        performed_on=str(row["performed_on"]),
        performed_time_local=(
            None if row["performed_time_local"] is None else str(row["performed_time_local"])
        ),
        status=WorkoutStatus(str(row["status"])),
        notes=None if row["notes"] is None else str(row["notes"]),
        entered_at_utc=str(row["entered_at_utc"]),
        updated_at_utc=str(row["updated_at_utc"]),
    )


def row_to_performed_set(row: sqlite3.Row) -> PerformedSet:
    return PerformedSet(
        id=str(row["id"]),
        workout_id=str(row["workout_id"]),
        exercise_id=str(row["exercise_id"]),
        set_order=int(row["set_order"]),
        set_type=None if row["set_type"] is None else SetTypeCode(str(row["set_type"])),
        load_kg=g_to_kg(None if row["load_g"] is None else int(row["load_g"])),
        reps=None if row["reps"] is None else int(row["reps"]),
        rir=None if row["rir"] is None else int(row["rir"]),
        notes=None if row["notes"] is None else str(row["notes"]),
        entered_at_utc=str(row["entered_at_utc"]),
        updated_at_utc=str(row["updated_at_utc"]),
    )


def insert_workout(connection: sqlite3.Connection, workout: Workout) -> None:
    connection.execute(
        f"INSERT INTO workout ({WORKOUT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            workout.id,
            workout.performed_on,
            workout.performed_time_local,
            workout.status.value,
            workout.notes,
            workout.entered_at_utc,
            workout.updated_at_utc,
        ),
    )


def update_workout(connection: sqlite3.Connection, workout: Workout) -> None:
    connection.execute(
        "UPDATE workout SET performed_on = ?, performed_time_local = ?, status = ?, "
        "notes = ?, updated_at_utc = ? WHERE id = ?",
        (
            workout.performed_on,
            workout.performed_time_local,
            workout.status.value,
            workout.notes,
            workout.updated_at_utc,
            workout.id,
        ),
    )


def get_workout(connection: sqlite3.Connection, workout_id: str) -> Workout | None:
    row = connection.execute(
        f"SELECT {WORKOUT_COLUMNS} FROM workout WHERE id = ?", (workout_id,)
    ).fetchone()
    return None if row is None else row_to_workout(row)


def list_workouts_on(connection: sqlite3.Connection, performed_on: str) -> tuple[Workout, ...]:
    """Several sessions may share a calendar date; the date is not unique by design."""
    rows = connection.execute(
        f"SELECT {WORKOUT_COLUMNS} FROM workout WHERE performed_on = ? "
        "ORDER BY coalesce(performed_time_local, ''), entered_at_utc",
        (performed_on,),
    ).fetchall()
    return tuple(row_to_workout(row) for row in rows)


def insert_performed_set(connection: sqlite3.Connection, performed_set: PerformedSet) -> None:
    connection.execute(
        f"INSERT INTO performed_set ({SET_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            performed_set.id,
            performed_set.workout_id,
            performed_set.exercise_id,
            performed_set.set_order,
            None if performed_set.set_type is None else performed_set.set_type.value,
            kg_to_g(performed_set.load_kg),
            performed_set.reps,
            performed_set.rir,
            performed_set.notes,
            performed_set.entered_at_utc,
            performed_set.updated_at_utc,
        ),
    )


def update_performed_set(connection: sqlite3.Connection, performed_set: PerformedSet) -> None:
    """In-place correction. Prior values are not retained; the snapshot is the mitigation."""
    connection.execute(
        "UPDATE performed_set SET exercise_id = ?, set_order = ?, set_type = ?, load_g = ?, "
        "reps = ?, rir = ?, notes = ?, updated_at_utc = ? WHERE id = ?",
        (
            performed_set.exercise_id,
            performed_set.set_order,
            None if performed_set.set_type is None else performed_set.set_type.value,
            kg_to_g(performed_set.load_kg),
            performed_set.reps,
            performed_set.rir,
            performed_set.notes,
            performed_set.updated_at_utc,
            performed_set.id,
        ),
    )


def list_sets_for_workout(
    connection: sqlite3.Connection, workout_id: str
) -> tuple[PerformedSet, ...]:
    """The stored order is the true chronological order of the whole session."""
    rows = connection.execute(
        f"SELECT {SET_COLUMNS} FROM performed_set WHERE workout_id = ? ORDER BY set_order",
        (workout_id,),
    ).fetchall()
    return tuple(row_to_performed_set(row) for row in rows)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_workouts.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/fitness_lab/storage/workouts.py backend/tests/test_workouts.py
git commit -m "feat(storage): workout and performed-set persistence with exact gram mapping"
```

---

### Task 12: Correction and deletion policy

**Files:**
- Modify: `backend/src/fitness_lab/storage/workouts.py`
- Test: `backend/tests/test_deletion_policy.py` (create)

**Interfaces:**
- Consumes: `db.transaction`, `snapshots.create_snapshot`, `domain.completion.renumber_sets`,
  the functions produced by Task 11.
- Produces:
  - `class DeletionRefused(RuntimeError)`
  - `renumber_workout_sets(connection, workout_id: str) -> tuple[PerformedSet, ...]`
  - `delete_performed_set(connection, set_id: str) -> tuple[PerformedSet, ...]` (deletes, then
    renumbers the workout's remaining sets to a dense `1..n`, returning them)
  - `delete_draft_workout(connection, workout_id: str) -> None`
  - `delete_complete_workout(connection, workout_id: str, *, db_path: Path, i_understand_this_deletes_evidence: bool = False) -> Path` (returns the safety snapshot path)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_deletion_policy.py`:

```python
"""The smallest policy that is still safe: no audit table, one guarded path."""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from fitness_lab.domain.models import (
    PerformedSet,
    SetTypeCode,
    Workout,
    WorkoutStatus,
    create_exercise,
    new_draft_workout,
    new_id,
)
from fitness_lab.storage import db
from fitness_lab.storage.exercises import insert_exercise
from fitness_lab.storage.snapshots import snapshot_directory
from fitness_lab.storage.workouts import (
    DeletionRefused,
    delete_complete_workout,
    delete_draft_workout,
    delete_performed_set,
    insert_performed_set,
    insert_workout,
    list_sets_for_workout,
    renumber_workout_sets,
    update_workout,
)

STAMP = "2026-10-01T19:00:00+00:00"


@pytest.fixture
def exercise_id(migrated_db: sqlite3.Connection) -> str:
    exercise = create_exercise("Incline Chest Press", "Hammer Strength")
    insert_exercise(migrated_db, exercise)
    return exercise.id


@pytest.fixture
def workout(migrated_db: sqlite3.Connection) -> Workout:
    created = new_draft_workout("2026-10-01", now=STAMP)
    insert_workout(migrated_db, created)
    return created


def add_set(
    connection: sqlite3.Connection, workout_id: str, exercise_id: str, set_order: int
) -> PerformedSet:
    performed = PerformedSet(
        id=new_id(),
        workout_id=workout_id,
        exercise_id=exercise_id,
        set_order=set_order,
        set_type=SetTypeCode.WORKING,
        load_kg=Decimal("60"),
        reps=8,
        rir=2,
        notes=None,
        entered_at_utc=STAMP,
        updated_at_utc=STAMP,
    )
    insert_performed_set(connection, performed)
    return performed


def test_removing_a_set_renumbers_the_rest_to_a_dense_sequence(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    first = add_set(migrated_db, workout.id, exercise_id, 1)
    second = add_set(migrated_db, workout.id, exercise_id, 2)
    third = add_set(migrated_db, workout.id, exercise_id, 3)

    remaining = delete_performed_set(migrated_db, second.id)

    assert [performed.id for performed in remaining] == [first.id, third.id]
    assert [performed.set_order for performed in remaining] == [1, 2]
    assert list_sets_for_workout(migrated_db, workout.id) == remaining


def test_removing_the_first_set_does_not_collide_on_the_unique_position(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    first = add_set(migrated_db, workout.id, exercise_id, 1)
    add_set(migrated_db, workout.id, exercise_id, 2)
    add_set(migrated_db, workout.id, exercise_id, 3)

    remaining = delete_performed_set(migrated_db, first.id)

    assert [performed.set_order for performed in remaining] == [1, 2]


def test_removing_the_only_set_leaves_an_empty_but_valid_draft(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    only = add_set(migrated_db, workout.id, exercise_id, 1)

    assert delete_performed_set(migrated_db, only.id) == ()


def test_deleting_an_unknown_set_is_refused(migrated_db: sqlite3.Connection) -> None:
    with pytest.raises(DeletionRefused, match="no set"):
        delete_performed_set(migrated_db, "nope")


def test_renumber_repairs_a_sparse_sequence_left_by_earlier_edits(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)
    add_set(migrated_db, workout.id, exercise_id, 4)
    add_set(migrated_db, workout.id, exercise_id, 9)

    repaired = renumber_workout_sets(migrated_db, workout.id)

    assert [performed.set_order for performed in repaired] == [1, 2, 3]
    assert [performed.set_order for performed in list_sets_for_workout(migrated_db, workout.id)] == [
        1,
        2,
        3,
    ]


def test_renumbering_an_already_dense_workout_changes_nothing(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)
    add_set(migrated_db, workout.id, exercise_id, 2)
    before = list_sets_for_workout(migrated_db, workout.id)

    assert renumber_workout_sets(migrated_db, workout.id) == before


def test_deleting_a_draft_workout_cascades_to_its_sets(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)

    delete_draft_workout(migrated_db, workout.id)

    assert list_sets_for_workout(migrated_db, workout.id) == ()
    assert migrated_db.execute("SELECT count(*) AS n FROM workout").fetchone()["n"] == 0


def test_deleting_a_complete_workout_through_the_draft_path_is_refused(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)
    update_workout(migrated_db, replace(workout, status=WorkoutStatus.COMPLETE))

    with pytest.raises(DeletionRefused, match="complete"):
        delete_draft_workout(migrated_db, workout.id)

    assert migrated_db.execute("SELECT count(*) AS n FROM workout").fetchone()["n"] == 1


def test_deleting_a_complete_workout_without_the_confirming_argument_is_refused(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str, db_path: Path
) -> None:
    """No ordinary code path supplies this argument by accident."""
    add_set(migrated_db, workout.id, exercise_id, 1)
    update_workout(migrated_db, replace(workout, status=WorkoutStatus.COMPLETE))

    with pytest.raises(DeletionRefused, match="confirm"):
        delete_complete_workout(migrated_db, workout.id, db_path=db_path)

    assert migrated_db.execute("SELECT count(*) AS n FROM workout").fetchone()["n"] == 1


def test_deleting_a_complete_workout_snapshots_first_then_deletes(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str, db_path: Path
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)
    update_workout(migrated_db, replace(workout, status=WorkoutStatus.COMPLETE))
    before = len(list(snapshot_directory(db_path).glob("*.db")))

    snapshot = delete_complete_workout(
        migrated_db, workout.id, db_path=db_path, i_understand_this_deletes_evidence=True
    )

    assert len(list(snapshot_directory(db_path).glob("*.db"))) == before + 1
    assert migrated_db.execute("SELECT count(*) AS n FROM workout").fetchone()["n"] == 0
    raw = sqlite3.connect(snapshot)
    try:
        assert raw.execute("SELECT count(*) FROM workout").fetchone()[0] == 1
        assert raw.execute("SELECT count(*) FROM performed_set").fetchone()[0] == 1
    finally:
        raw.close()


def test_deleting_a_draft_through_the_complete_path_is_refused(
    migrated_db: sqlite3.Connection, workout: Workout, db_path: Path
) -> None:
    with pytest.raises(DeletionRefused, match="draft"):
        delete_complete_workout(
            migrated_db, workout.id, db_path=db_path, i_understand_this_deletes_evidence=True
        )


def test_deleting_an_unknown_workout_is_refused(
    migrated_db: sqlite3.Connection, db_path: Path
) -> None:
    with pytest.raises(DeletionRefused, match="no workout"):
        delete_draft_workout(migrated_db, "nope")
    with pytest.raises(DeletionRefused, match="no workout"):
        delete_complete_workout(
            migrated_db, "nope", db_path=db_path, i_understand_this_deletes_evidence=True
        )


def test_deleting_a_workout_never_deletes_its_exercises(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    add_set(migrated_db, workout.id, exercise_id, 1)

    delete_draft_workout(migrated_db, workout.id)

    assert migrated_db.execute("SELECT count(*) AS n FROM exercise").fetchone()["n"] == 1


def test_the_connection_is_left_without_an_open_transaction(
    migrated_db: sqlite3.Connection, workout: Workout, exercise_id: str
) -> None:
    performed = add_set(migrated_db, workout.id, exercise_id, 1)
    add_set(migrated_db, workout.id, exercise_id, 2)

    delete_performed_set(migrated_db, performed.id)

    assert not migrated_db.in_transaction
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_deletion_policy.py -v
```

Expected: FAIL at collection — `ImportError: cannot import name 'DeletionRefused' from
'fitness_lab.storage.workouts'`.

- [ ] **Step 3: Extend `backend/src/fitness_lab/storage/workouts.py`**

Add these imports at the top of the module (`Sequence` joins the existing
`from __future__ import annotations` / `import sqlite3` block):

```python
from collections.abc import Sequence
from pathlib import Path

from fitness_lab.domain.completion import renumber_sets
from fitness_lab.storage import db
from fitness_lab.storage.snapshots import create_snapshot
```

and append:

```python
class DeletionRefused(RuntimeError):
    """A deletion was refused because it would destroy evidence unguarded."""


_RENUMBER_OFFSET = 1_000_000


def _write_renumbering(
    connection: sqlite3.Connection, workout_id: str, target: Sequence[PerformedSet]
) -> None:
    """Assign the target positions. Caller must already hold a transaction.

    The offset pass exists because UNIQUE (workout_id, set_order) would otherwise be
    violated mid-update while positions are being reassigned.
    """
    connection.execute(
        "UPDATE performed_set SET set_order = set_order + ? WHERE workout_id = ?",
        (_RENUMBER_OFFSET, workout_id),
    )
    for performed in target:
        connection.execute(
            "UPDATE performed_set SET set_order = ? WHERE id = ?",
            (performed.set_order, performed.id),
        )


def renumber_workout_sets(
    connection: sqlite3.Connection, workout_id: str
) -> tuple[PerformedSet, ...]:
    """Compact this workout's sets to a dense 1..n (rule C3's repair), persisted."""
    current = list_sets_for_workout(connection, workout_id)
    target = renumber_sets(current)
    if [performed.set_order for performed in current] == [
        performed.set_order for performed in target
    ]:
        return current
    with db.transaction(connection):
        _write_renumbering(connection, workout_id, target)
    return target


def delete_performed_set(
    connection: sqlite3.Connection, set_id: str
) -> tuple[PerformedSet, ...]:
    """Hard DELETE, then renumber the workout's remaining sets. Returns what is left.

    Both halves run in one transaction: a set removed but not renumbered would leave the
    workout in a state rule C3 exists to prevent.
    """
    row = connection.execute(
        "SELECT workout_id FROM performed_set WHERE id = ?", (set_id,)
    ).fetchone()
    if row is None:
        raise DeletionRefused(f"no set with id {set_id!r}")
    workout_id = str(row["workout_id"])
    with db.transaction(connection):
        connection.execute("DELETE FROM performed_set WHERE id = ?", (set_id,))
        remaining = renumber_sets(list_sets_for_workout(connection, workout_id))
        _write_renumbering(connection, workout_id, remaining)
    return remaining


def _require_workout(connection: sqlite3.Connection, workout_id: str) -> Workout:
    workout = get_workout(connection, workout_id)
    if workout is None:
        raise DeletionRefused(f"no workout with id {workout_id!r}")
    return workout


def delete_draft_workout(connection: sqlite3.Connection, workout_id: str) -> None:
    """A draft is not evidence; nothing is lost. Sets cascade."""
    workout = _require_workout(connection, workout_id)
    if workout.status is not WorkoutStatus.DRAFT:
        raise DeletionRefused(
            f"workout {workout_id!r} is complete; use delete_complete_workout()"
        )
    connection.execute("DELETE FROM workout WHERE id = ?", (workout_id,))


def delete_complete_workout(
    connection: sqlite3.Connection,
    workout_id: str,
    *,
    db_path: Path,
    i_understand_this_deletes_evidence: bool = False,
) -> Path:
    """The only guarded path. Takes a safety snapshot first and returns its location."""
    workout = _require_workout(connection, workout_id)
    if workout.status is not WorkoutStatus.COMPLETE:
        raise DeletionRefused(
            f"workout {workout_id!r} is a draft; use delete_draft_workout()"
        )
    if not i_understand_this_deletes_evidence:
        raise DeletionRefused(
            "deleting a complete workout requires confirm via "
            "i_understand_this_deletes_evidence=True"
        )
    snapshot = create_snapshot(connection, db_path, f"pre-delete-workout-{workout_id}")
    connection.execute("DELETE FROM workout WHERE id = ?", (workout_id,))
    return snapshot
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_deletion_policy.py tests/test_workouts.py -v
```

Expected: PASS.

- [ ] **Step 5: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green. `test_architecture.py` still passes — `workouts.py` imports `domain` and
`storage` only.

- [ ] **Step 6: Commit**

```bash
git add backend/src/fitness_lab/storage/workouts.py backend/tests/test_deletion_policy.py
git commit -m "feat(storage): correction and deletion policy with a guarded complete-workout path"
```

---

### Task 13: Emergency raw-capture contract and validator

**Files:**
- Create: `docs/contracts/raw-capture-v1.md`
- Create: `docs/contracts/raw-capture-v1.example.json`
- Create: `backend/src/fitness_lab/domain/capture.py`
- Test: `backend/tests/test_capture_contract.py` (create)

**Interfaces:**
- Consumes: `fitness_lab.domain.units.kg_to_g`, `fitness_lab.domain.models`
  (`SetTypeCode`, `normalize_identity`).
- Produces:
  - `CAPTURE_SCHEMA_VERSION = 1`
  - `CaptureIssue(path: str, message: str)`
  - `CatalogEntry(id: str, name: str, equipment_label: str | None)`
  - `CaptureReport(ok: bool, errors: tuple[CaptureIssue, ...], warnings: tuple[CaptureIssue, ...], workout_count: int, set_count: int)`
  - `parse_capture_json(text: str) -> object` (always `parse_float=Decimal`)
  - `validate_capture(document: object, *, catalog: Sequence[CatalogEntry] | None = None) -> CaptureReport`
- **Not produced, deliberately:** no importer, no `raw_capture_import` table, no CLI, no
  network or AI dependency of any kind.

- [ ] **Step 1: Write the contract document**

Create `docs/contracts/raw-capture-v1.md`:

```markdown
# Emergency raw-capture contract, version 1

**Purpose.** If the application is unavailable on or after 1 October 2026, raw workout
evidence must still be capturable in a portable structured form and later imported
deterministically. This is deadline insurance, not a historical-import product feature.
No UI is required: the file is writable by hand in a text editor.

**Status in M1.** The contract and a pure validator
(`backend/src/fitness_lab/domain/capture.py`) ship. **The importer does not.** It is
written later, against a schema that exists, with time to test it. This path must never
grow a CLI or an entry UI — that would make it a second workout-entry application to
maintain forever.

## Shape

See `raw-capture-v1.example.json`, which is loaded verbatim by
`backend/tests/test_capture_contract.py` so the document and the validator cannot drift.

## Rules

- `schema_version` is **required** and must be `1`. An unknown version is a hard refusal,
  never a best-effort parse.
- `units` **must** be `"kg"`. It exists so a future reader cannot misread the file. Any
  other value is refused, never converted. There is no lb support anywhere in the system.
- **Set order is array order.** An explicit `set_order` (integer >= 1) is accepted as an
  override for an edited file; duplicates within one workout are refused.
- `load_kg` is kilograms and is converted through the canonical mapper
  (`fitness_lab.domain.units.kg_to_g`). The file **must** be parsed with
  `json.loads(..., parse_float=Decimal)` so no value passes through binary floating point.
  Sub-gram precision and negative loads are refused, never rounded.
- `reps` is **optional**. Omitting it imports as NULL. This is safe because imported
  workouts land as `draft`, and completion rule C2 blocks promotion until reps are
  supplied. The validator **reports** every set missing reps rather than rejecting the
  file.
- `set_type` is **optional**, imports as NULL, and is likewise reported — rule C4 blocks
  completion until it is classified. When supplied it must be one of `warmup`, `working`,
  `backoff`.
- `rir` is optional and **unbounded**: an integer of either sign, or absent. Absent is not
  `0`.
- `notes` is optional on both workouts and sets.
- Omission is the only representation of "not recorded". There is no sentinel value.
- `performed_on` is a civil local date `YYYY-MM-DD`; `performed_time_local` is optional
  civil local `HH:MM`. No timezone, offset or UTC instant appears anywhere in the file.

## Exercise resolution

`exercise` is a name, with `equipment_label` as an optional sibling field. An explicit
`{"id": "..."}` form is also accepted. Resolution order:

1. Explicit `id` → exact match.
2. Normalized `(name, equipment_label)` pair — the same `lower(trim(...))` /
   `coalesce(..., '')` rule as `ux_exercise_identity` → exact match.
3. Name alone → **must resolve to exactly one exercise.**

**Ambiguity is refused, never guessed**, with the candidates listed. Guessing wrong would
attach a session to the wrong machine's strength history — precisely the corruption
`equipment_label` exists to prevent. Unresolved names never auto-create; that will be an
explicit importer decision.

## Import behaviour (specified here, implemented later)

The importer will record the file's `sha256` so an identical re-run is a no-op, run a
dry-run report before an explicit apply, and land every imported workout as `draft` so it
is reviewed before becoming evidence.
```

Create `docs/contracts/raw-capture-v1.example.json`:

```json
{
  "schema_version": 1,
  "units": "kg",
  "capture_note": "written by hand; app unavailable",
  "workouts": [
    {
      "performed_on": "2026-10-01",
      "performed_time_local": "18:30",
      "notes": "first logged session",
      "sets": [
        { "exercise": "Incline Chest Press", "equipment_label": "Hammer Strength",
          "set_type": "warmup",  "load_kg": 40,   "reps": 10 },
        { "exercise": "Incline Chest Press", "equipment_label": "Hammer Strength",
          "set_type": "working", "load_kg": 60,   "reps": 9, "rir": 2 },
        { "exercise": "Incline Chest Press", "equipment_label": "Hammer Strength",
          "set_type": "working", "load_kg": 60,   "reps": 8, "rir": 1 },
        { "exercise": "Incline dumbbell press",
          "set_type": "backoff", "load_kg": 32.5, "reps": 10, "rir": 2,
          "notes": "bench notch 3" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_capture_contract.py`:

```python
"""The emergency capture contract's validator. Pure: no database, no network, no AI."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from fitness_lab.domain.capture import (
    CatalogEntry,
    parse_capture_json,
    validate_capture,
)

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[2] / "docs" / "contracts" / "raw-capture-v1.example.json"
)

CATALOG = (
    CatalogEntry(id="e1", name="Incline Chest Press", equipment_label="Hammer Strength"),
    CatalogEntry(id="e2", name="Incline Chest Press", equipment_label="Technogym Pure Strength"),
    CatalogEntry(id="e3", name="Incline dumbbell press", equipment_label=None),
)


def example() -> dict[str, Any]:
    document = parse_capture_json(EXAMPLE_PATH.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return deepcopy(document)


def test_the_documented_example_validates() -> None:
    report = validate_capture(example())

    assert report.ok is True
    assert report.errors == ()
    assert report.workout_count == 1
    assert report.set_count == 4


def test_the_documented_example_resolves_against_a_catalog() -> None:
    report = validate_capture(example(), catalog=CATALOG)

    assert report.ok is True


def test_loads_are_parsed_as_decimal_not_float() -> None:
    from decimal import Decimal

    document = example()
    assert document["workouts"][0]["sets"][3]["load_kg"] == Decimal("32.5")
    assert not isinstance(document["workouts"][0]["sets"][3]["load_kg"], float)


def test_an_unknown_schema_version_is_a_hard_refusal() -> None:
    document = example()
    document["schema_version"] = 2

    report = validate_capture(document)

    assert report.ok is False
    assert any("schema_version" in issue.path for issue in report.errors)


def test_a_missing_schema_version_is_refused() -> None:
    document = example()
    del document["schema_version"]

    assert validate_capture(document).ok is False


def test_units_other_than_kg_are_refused_never_converted() -> None:
    document = example()
    document["units"] = "lb"

    report = validate_capture(document)

    assert report.ok is False
    assert any("kg" in issue.message for issue in report.errors)


@pytest.mark.parametrize("performed_on", ["2026-13-01", "2026-02-31", "2026-10-1", "1 Oct 2026", ""])
def test_malformed_dates_are_refused(performed_on: str) -> None:
    document = example()
    document["workouts"][0]["performed_on"] = performed_on

    assert validate_capture(document).ok is False


@pytest.mark.parametrize("performed_time_local", ["25:00", "7:45", "19:45:30"])
def test_malformed_times_are_refused(performed_time_local: str) -> None:
    document = example()
    document["workouts"][0]["performed_time_local"] = performed_time_local

    assert validate_capture(document).ok is False


def test_an_absent_time_is_accepted() -> None:
    document = example()
    del document["workouts"][0]["performed_time_local"]

    assert validate_capture(document).ok is True


def test_a_negative_load_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["load_kg"] = -1

    report = validate_capture(document)

    assert report.ok is False
    assert any("negative" in issue.message for issue in report.errors)


def test_sub_gram_precision_is_refused() -> None:
    document = parse_capture_json(
        json.dumps(
            {
                "schema_version": 1,
                "units": "kg",
                "workouts": [
                    {
                        "performed_on": "2026-10-01",
                        "sets": [{"exercise": "Incline dumbbell press", "load_kg": 0.0005, "reps": 5}],
                    }
                ],
            }
        )
    )

    report = validate_capture(document)

    assert report.ok is False
    assert any("sub-gram" in issue.message for issue in report.errors)


def test_a_negative_rep_count_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["reps"] = -1

    assert validate_capture(document).ok is False


def test_missing_reps_is_reported_not_rejected() -> None:
    """Three unremembered rep counts should import and surface the gaps, not fail wholesale."""
    document = example()
    del document["workouts"][0]["sets"][0]["reps"]

    report = validate_capture(document)

    assert report.ok is True
    assert any("reps" in issue.path for issue in report.warnings)


def test_missing_set_type_is_reported_not_rejected() -> None:
    document = example()
    del document["workouts"][0]["sets"][0]["set_type"]

    report = validate_capture(document)

    assert report.ok is True
    assert any("set_type" in issue.path for issue in report.warnings)


def test_an_unknown_set_type_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["set_type"] = "amrap"

    report = validate_capture(document)

    assert report.ok is False
    assert any("set_type" in issue.path for issue in report.errors)


def test_an_absent_rir_is_distinguishable_from_zero() -> None:
    without = example()
    del without["workouts"][0]["sets"][1]["rir"]
    with_zero = example()
    with_zero["workouts"][0]["sets"][1]["rir"] = 0

    absent_report = validate_capture(without)
    zero_report = validate_capture(with_zero)

    assert absent_report.ok is True
    assert zero_report.ok is True
    absent_paths = {issue.path for issue in absent_report.warnings}
    zero_paths = {issue.path for issue in zero_report.warnings}
    assert "$.workouts[0].sets[1].rir" in absent_paths
    assert "$.workouts[0].sets[1].rir" not in zero_paths


def test_a_negative_rir_is_accepted() -> None:
    document = example()
    document["workouts"][0]["sets"][1]["rir"] = -1

    assert validate_capture(document).ok is True


def test_a_non_integer_rir_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][1]["rir"] = "two"

    assert validate_capture(document).ok is False


def test_array_order_is_the_default_set_order() -> None:
    document = example()
    for entry in document["workouts"][0]["sets"]:
        assert "set_order" not in entry

    assert validate_capture(document).ok is True


def test_an_explicit_set_order_override_is_accepted() -> None:
    document = example()
    for position, entry in enumerate(reversed(document["workouts"][0]["sets"]), start=1):
        entry["set_order"] = position

    assert validate_capture(document).ok is True


def test_duplicate_set_orders_are_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["set_order"] = 2
    document["workouts"][0]["sets"][1]["set_order"] = 2

    report = validate_capture(document)

    assert report.ok is False
    assert any("set_order" in issue.path for issue in report.errors)


def test_an_ambiguous_name_only_reference_is_refused_with_candidates() -> None:
    document = example()
    for entry in document["workouts"][0]["sets"][:3]:
        del entry["equipment_label"]

    report = validate_capture(document, catalog=CATALOG)

    assert report.ok is False
    message = " ".join(issue.message for issue in report.errors)
    assert "e1" in message and "e2" in message


def test_an_unambiguous_name_only_reference_resolves() -> None:
    document = example()

    report = validate_capture(document, catalog=CATALOG)

    assert report.ok is True


def test_an_unknown_exercise_name_is_refused_against_a_catalog() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["exercise"] = "Nordic ham curl"
    document["workouts"][0]["sets"][0]["equipment_label"] = "Bench"

    assert validate_capture(document, catalog=CATALOG).ok is False


def test_an_explicit_id_reference_resolves() -> None:
    document = example()
    document["workouts"][0]["sets"][0] = {
        "exercise": {"id": "e1"},
        "set_type": "warmup",
        "load_kg": 40,
        "reps": 10,
    }

    assert validate_capture(document, catalog=CATALOG).ok is True


def test_an_unknown_explicit_id_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0] = {"exercise": {"id": "missing"}, "reps": 10}

    assert validate_capture(document, catalog=CATALOG).ok is False


def test_equipment_aware_references_keep_two_machines_apart() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["equipment_label"] = "Technogym Pure Strength"

    report = validate_capture(document, catalog=CATALOG)

    assert report.ok is True


def test_a_set_without_an_exercise_reference_is_refused() -> None:
    document = example()
    del document["workouts"][0]["sets"][0]["exercise"]

    assert validate_capture(document).ok is False


def test_a_document_that_is_not_an_object_is_refused() -> None:
    assert validate_capture([]).ok is False


def test_an_empty_workouts_array_is_refused() -> None:
    document = example()
    document["workouts"] = []

    assert validate_capture(document).ok is False
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend && uv run pytest tests/test_capture_contract.py -v
```

Expected: FAIL at collection — `ModuleNotFoundError: No module named
'fitness_lab.domain.capture'`.

- [ ] **Step 4: Implement the validator**

Create `backend/src/fitness_lab/domain/capture.py`:

```python
"""Validator for the emergency raw-capture contract (docs/contracts/raw-capture-v1.md).

Deadline insurance, not a product feature. M1 ships this validator and the contract; the
importer is written later, against a schema that exists. Errors block; warnings report
gaps that import as NULL and are caught later by completion rules C2 and C4.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, time
from decimal import Decimal
from typing import TypeGuard

from fitness_lab.domain.models import SetTypeCode, normalize_identity
from fitness_lab.domain.units import kg_to_g

CAPTURE_SCHEMA_VERSION = 1
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")
KNOWN_SET_TYPES = tuple(code.value for code in SetTypeCode)


@dataclass(frozen=True, slots=True)
class CaptureIssue:
    path: str
    message: str


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    id: str
    name: str
    equipment_label: str | None


@dataclass(frozen=True, slots=True)
class CaptureReport:
    ok: bool
    errors: tuple[CaptureIssue, ...]
    warnings: tuple[CaptureIssue, ...]
    workout_count: int
    set_count: int


def parse_capture_json(text: str) -> object:
    """Parse a capture file. parse_float=Decimal keeps loads out of binary floating point."""
    return json.loads(text, parse_float=Decimal)


def _is_int(value: object) -> TypeGuard[int]:
    """bool is an int subclass and is never an acceptable count."""
    return isinstance(value, int) and not isinstance(value, bool)


def _check_date(value: object, path: str, errors: list[CaptureIssue]) -> None:
    if not isinstance(value, str) or not DATE_PATTERN.match(value):
        errors.append(CaptureIssue(path, f"performed_on must be YYYY-MM-DD: {value!r}"))
        return
    try:
        date.fromisoformat(value)
    except ValueError:
        errors.append(CaptureIssue(path, f"not a real calendar date: {value!r}"))


def _check_time(value: object, path: str, errors: list[CaptureIssue]) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not TIME_PATTERN.match(value):
        errors.append(CaptureIssue(path, f"performed_time_local must be HH:MM: {value!r}"))
        return
    try:
        time.fromisoformat(value)
    except ValueError:
        errors.append(CaptureIssue(path, f"not a real wall-clock time: {value!r}"))


def _check_exercise_reference(
    entry: dict[str, object],
    path: str,
    catalog: Sequence[CatalogEntry] | None,
    errors: list[CaptureIssue],
) -> None:
    reference = entry.get("exercise")

    if isinstance(reference, dict):
        identifier = reference.get("id")
        if not isinstance(identifier, str) or not identifier.strip():
            errors.append(
                CaptureIssue(f"{path}.exercise", "an object reference must carry a non-blank id")
            )
            return
        if catalog is not None and all(item.id != identifier for item in catalog):
            errors.append(CaptureIssue(f"{path}.exercise", f"no exercise with id {identifier!r}"))
        return

    if not isinstance(reference, str) or not reference.strip():
        errors.append(
            CaptureIssue(
                f"{path}.exercise", "exercise must be a non-blank name or an object with an id"
            )
        )
        return

    label = entry.get("equipment_label")
    if label is not None and (not isinstance(label, str) or not label.strip()):
        errors.append(
            CaptureIssue(
                f"{path}.equipment_label", f"equipment_label must be absent or non-blank: {label!r}"
            )
        )
        return

    if catalog is None:
        return

    if label is not None:
        wanted = normalize_identity(reference, label)
        if all(normalize_identity(item.name, item.equipment_label) != wanted for item in catalog):
            errors.append(
                CaptureIssue(f"{path}.exercise", f"no exercise {reference!r} on {label!r}")
            )
        return

    wanted_name = normalize_identity(reference, None)[0]
    candidates = [
        item for item in catalog if normalize_identity(item.name, item.equipment_label)[0] == wanted_name
    ]
    if not candidates:
        errors.append(CaptureIssue(f"{path}.exercise", f"no exercise named {reference!r}"))
    elif len(candidates) > 1:
        listed = ", ".join(f"{item.id} ({item.equipment_label})" for item in candidates)
        errors.append(
            CaptureIssue(
                f"{path}.exercise",
                f"{reference!r} is ambiguous and is never guessed; candidates: {listed}",
            )
        )


def _check_set(
    entry: dict[str, object],
    path: str,
    index: int,
    seen_orders: set[int],
    catalog: Sequence[CatalogEntry] | None,
    errors: list[CaptureIssue],
    warnings: list[CaptureIssue],
) -> None:
    order = entry.get("set_order", index + 1)
    if not _is_int(order) or order < 1:
        errors.append(
            CaptureIssue(f"{path}.set_order", f"set_order must be an integer >= 1: {order!r}")
        )
    elif order in seen_orders:
        errors.append(CaptureIssue(f"{path}.set_order", f"duplicate set_order {order!r}"))
    else:
        seen_orders.add(order)

    _check_exercise_reference(entry, path, catalog, errors)

    if "load_kg" in entry:
        load = entry["load_kg"]
        if isinstance(load, str | int | Decimal) or load is None:
            try:
                kg_to_g(load)
            except (TypeError, ValueError) as exc:
                errors.append(CaptureIssue(f"{path}.load_kg", str(exc)))
        else:
            errors.append(CaptureIssue(f"{path}.load_kg", f"not a decimal load: {load!r}"))
    else:
        warnings.append(CaptureIssue(f"{path}.load_kg", "no load recorded; imports as NULL"))

    if "reps" in entry:
        reps = entry["reps"]
        if not _is_int(reps) or reps < 0:
            errors.append(
                CaptureIssue(f"{path}.reps", f"reps must be an integer >= 0 when present: {reps!r}")
            )
    else:
        warnings.append(
            CaptureIssue(f"{path}.reps", "no reps recorded; imports as NULL and blocks completion (C2)")
        )

    if "rir" in entry:
        if not _is_int(entry["rir"]):
            errors.append(
                CaptureIssue(f"{path}.rir", f"rir must be an integer when present: {entry['rir']!r}")
            )
    else:
        warnings.append(CaptureIssue(f"{path}.rir", "no RIR recorded; imports as NULL"))

    if "set_type" in entry:
        code = entry["set_type"]
        if code not in KNOWN_SET_TYPES:
            errors.append(
                CaptureIssue(
                    f"{path}.set_type", f"unknown set_type {code!r}; known: {list(KNOWN_SET_TYPES)}"
                )
            )
    else:
        warnings.append(
            CaptureIssue(
                f"{path}.set_type", "no set_type recorded; imports as NULL and blocks completion (C4)"
            )
        )


def validate_capture(
    document: object, *, catalog: Sequence[CatalogEntry] | None = None
) -> CaptureReport:
    """Validate a parsed capture document. Never guesses, never converts units."""
    errors: list[CaptureIssue] = []
    warnings: list[CaptureIssue] = []

    if not isinstance(document, dict):
        return CaptureReport(
            False, (CaptureIssue("$", "document must be a JSON object"),), (), 0, 0
        )

    version = document.get("schema_version")
    if version != CAPTURE_SCHEMA_VERSION:
        return CaptureReport(
            False,
            (
                CaptureIssue(
                    "$.schema_version",
                    f"unsupported schema_version {version!r}; only {CAPTURE_SCHEMA_VERSION} is "
                    "understood, and an unknown version is never best-effort parsed",
                ),
            ),
            (),
            0,
            0,
        )

    units = document.get("units")
    if units != "kg":
        return CaptureReport(
            False,
            (
                CaptureIssue(
                    "$.units", f"units must be 'kg' and are never converted; got {units!r}"
                ),
            ),
            (),
            0,
            0,
        )

    workouts = document.get("workouts")
    if not isinstance(workouts, list) or not workouts:
        return CaptureReport(
            False, (CaptureIssue("$.workouts", "workouts must be a non-empty array"),), (), 0, 0
        )

    workout_count = 0
    set_count = 0
    for workout_index, workout in enumerate(workouts):
        path = f"$.workouts[{workout_index}]"
        if not isinstance(workout, dict):
            errors.append(CaptureIssue(path, "workout must be an object"))
            continue
        workout_count += 1
        _check_date(workout.get("performed_on"), f"{path}.performed_on", errors)
        _check_time(workout.get("performed_time_local"), f"{path}.performed_time_local", errors)

        entries = workout.get("sets")
        if not isinstance(entries, list):
            errors.append(CaptureIssue(f"{path}.sets", "sets must be an array"))
            continue
        seen_orders: set[int] = set()
        for set_index, entry in enumerate(entries):
            set_path = f"{path}.sets[{set_index}]"
            if not isinstance(entry, dict):
                errors.append(CaptureIssue(set_path, "set must be an object"))
                continue
            set_count += 1
            _check_set(entry, set_path, set_index, seen_orders, catalog, errors, warnings)

    return CaptureReport(
        ok=not errors,
        errors=tuple(errors),
        warnings=tuple(warnings),
        workout_count=workout_count,
        set_count=set_count,
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd backend && uv run pytest tests/test_capture_contract.py tests/test_architecture.py -v
```

Expected: PASS — including the architecture guards (`capture.py` is pure domain and never
mentions `load_g`).

- [ ] **Step 6: Run the full backend gate**

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add docs/contracts backend/src/fitness_lab/domain/capture.py backend/tests/test_capture_contract.py
git commit -m "feat(domain): emergency raw-capture contract v1 and its pure validator"
```

---

### Task 14: Full milestone verification and M0 regression closure

**Files:**
- Modify: none expected. If a gate fails, fix the cause in the owning module and note the
  fix in the commit message; do **not** weaken a test or a constraint to make a gate pass.
- Test: every existing suite, plus the live application.

**Interfaces:**
- Consumes: everything built in Tasks 1–13.
- Produces: the evidence that M1 is complete and that the verified M0 surface still works.

M1 cannot be declared complete until every step below has been **run** and its output seen.
Reporting a gate as green without running it is a milestone failure.

- [ ] **Step 1: Backend suite, lint, format and types**

```bash
cd backend && uv run pytest -q
```

Expected: PASS, zero failures, zero errors.

```bash
cd backend && uv run ruff check .
```

Expected: `All checks passed!`

```bash
cd backend && uv run ruff format --check .
```

Expected: every file already formatted.

```bash
cd backend && uv run mypy
```

Expected: `Success: no issues found`.

- [ ] **Step 2: Confirm the architecture boundaries still hold**

```bash
cd backend && uv run pytest tests/test_architecture.py -v
```

Expected: PASS — `domain` imports nothing from `storage`, `api`, `sqlite3` or `fastapi`;
`storage` imports nothing from `api` or `fastapi`; no module under `domain` mentions `load_g`.

- [ ] **Step 3: Confirm the real database is at head with its M0 row intact**

```bash
cd backend && uv run python -c "
from fitness_lab.storage import db
from fitness_lab.storage.migrations import applied_versions, discover_migrations, migrate_to_head
print('migrate:', migrate_to_head())
with db.connection_scope() as c:
    print('applied:', sorted(applied_versions(c)))
    print('tables :', sorted(r['name'] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")))
    print('fk_chk :', c.execute('PRAGMA foreign_key_check').fetchall())
    print('fk_on  :', c.execute('PRAGMA foreign_keys').fetchone()[0])
    print('journal:', c.execute('PRAGMA journal_mode').fetchone()[0])
print('m0 row :', db.read_technical_check())
print('files  :', [m.filename for m in discover_migrations()])
"
```

Expected: `applied: [1, 2]`; tables `exercise`, `m0_technical_check`, `performed_set`,
`schema_migrations`, `set_type`, `workout`; `fk_chk: []`; `fk_on: 1`; `journal: wal`; the M0
row still carrying its original token and `created_at`; and `migrate: MigrationResult(applied=(),
snapshot=None)` on a second run (no snapshot per launch).

- [ ] **Step 4: Frontend gates (unchanged code — this is a regression check)**

```bash
cd web && npm run typecheck
```

Expected: PASS.

```bash
cd web && npm run lint
```

Expected: PASS with no warnings.

```bash
cd web && npm test
```

Expected: PASS.

```bash
cd web && npm run build
```

Expected: a successful production build into `web/dist`.

- [ ] **Step 5: End-to-end smoke test through the real launcher**

```bash
cd e2e && npx playwright test
```

Expected: both M0 specs PASS — the page renders the FastAPI health and the SQLite-backed row,
the values match the row read straight out of the database file, the browser console has no
errors, and no network request fails. This is the gate proving M1 did not break the verified
M0 surface, including a clean browser console and the live SQLite path.

- [ ] **Step 6: Production launcher sanity check**

```bash
./scripts/start.sh --no-open
```

Expected: the script builds (or skips a fresh build), reports `==> ready:
http://127.0.0.1:8000`, and the server stays up. In another shell:

```bash
curl -s http://127.0.0.1:8000/api/health && echo && curl -s http://127.0.0.1:8000/api/ping-db
```

Expected: both return `"status":"ok"`, and `/api/ping-db` reports `"source":"sqlite"` with
`row_id` 1. Stop the launcher with Ctrl-C afterwards.

- [ ] **Step 7: Confirm nothing untracked or unwanted was left behind**

```bash
git status --porcelain
```

Expected: empty. In particular `data/` (including `data/snapshots/`) must not appear — it is
gitignored — and no `.db`, `.db-wal` or `.db-shm` file may be staged.

- [ ] **Step 8: Confirm the milestone's scope boundary was respected**

```bash
git diff --stat 322a711..HEAD
```

Expected: changes confined to `backend/` (source, tests, migrations) and `docs/contracts/` plus
this plan. **No files under `web/` or `e2e/` may appear.** If any do, the milestone has leaked
scope and the change must be reverted before M1 is declared complete.

- [ ] **Step 9: Commit any fixes made during verification**

Only if Steps 1–8 required a fix:

```bash
git add -A
git commit -m "fix: <what the verification found and how it was fixed>"
```

If nothing needed fixing, there is nothing to commit — the milestone ends on Task 13's commit.

---

## Appendix A — Spec coverage map

Each binding requirement of the spec, and the task that implements or proves it.

| Spec | Requirement | Task |
|---|---|---|
| §3 | e1RM/volume/PRs never stored; no derived caches | 9 (schema has no such columns) |
| §4.1–4.3 | Entity fields exactly as tabled | 7, 9 |
| §4.4 | `set_type` lookup table seeded `warmup`/`working`/`backoff` | 9 |
| §4.5 | `schema_migrations(version, filename, sha256, applied_at_utc)` | 3 |
| §5.1 | Opaque `uuid4().hex` generated in the domain; rename touches no set row | 7, 11 |
| §5.2 | `equipment_label` is canonical identity; `notes` is not | 7, 9, 10 |
| §5.3 | `ux_exercise_identity` with the load-bearing `coalesce` | 9, 10 |
| §5.4 | `create_exercise` and `rename_exercise` are distinct operations | 7, 11 |
| §5.5 | Retirement by `is_active = 0`; deletion of a referenced exercise blocked | 9, 10, 11 |
| §6 | Only `draft` and `complete`; both transitions available; no `abandoned`/`skipped` | 8, 9 |
| §7.1 | Global chronological `set_order`, `UNIQUE (workout_id, set_order)` | 9, 11 |
| §7.2 | Nullable `reps`, `set_type` (no default), unbounded `rir`, gram `load_g` | 9, 11 |
| §7.3 | C1–C4 plus load/RIR advisories, pure and database-free | 8 |
| §8 | NULL never collapsed to `0`, in schema, mapper and repositories | 6, 9, 11 |
| §9 | Civil `performed_on`/`performed_time_local`, UTC `entered_at`/`updated_at` | 7, 9 |
| §9.3 | Date/time `CHECK`s including the load-bearing `IS NOT NULL` half | 9 |
| §10 | The DDL verbatim, all tables `STRICT`, all three indexes | 9 |
| §11.1 | WAL persisted once at bootstrap | 1 |
| §11.2 | `foreign_keys`, `busy_timeout`, `synchronous`, `isolation_level=None` per connection | 1 |
| §12.1–12.2 | Hand-rolled runner, numbered forward-only files, checksum refusal, one transaction, `foreign_key_check` before commit | 3 |
| §12.3 | No generic rebuild helper; every M1 migration additive | 3, 9 |
| §12.4 | `0001_baseline` adopts the legacy M0 database; `init_db` removed; lifespan migrates | 5 |
| §13 | Snapshot only when pending, exactly one, readable, no pruning | 4 |
| §14 | Correction and deletion policy, guarded complete-workout delete with snapshot | 12 |
| §15 | Capture contract v1 documented; validator only, no importer | 13 |
| §16 | Exact `Decimal` kg↔g mapper, float refused, sub-gram refused, `format(normalize(), "f")` | 6 |
| §17 | No outward FK and no program column on `workout`/`performed_set` | 9 |
| §18 | Every constraint, foreign key and index | 9 |
| §19 | All required tests | 3–13 |
| §19 Regression | M0 backend, frontend and Playwright suites green | 14 |
| §20 | Layering guards, grams confined to storage | 2 |
| §21 | No `group_key`, `side`, `duration_seconds`, `movement_family_id` | 9 |

## Appendix B — Deliberately not built in M1

- No workout-entry UI, dashboard, exercise-history UI or any frontend change at all.
- No new API routes; `api/app.py` changes in exactly one line of `lifespan`.
- No program, planned-workout or `workout_plan_link` tables (M2 owns those).
- No e1RM, PR, volume, tonnage or %1RM computation or storage.
- No `movement_family`, equipment taxonomy, `side`, `group_key` or `duration_seconds`.
- No capture **importer** and no `raw_capture_import` table — contract and validator only.
- No generic table-rebuild helper, no snapshot pruning or retention, no audit table, no event
  log, no soft-delete framework, no repository interface, no service layer.
- No lb↔kg conversion, no timezone machinery, no external network calls, no new dependencies.
