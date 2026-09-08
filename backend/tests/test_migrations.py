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
