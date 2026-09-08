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
