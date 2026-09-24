#!/usr/bin/env python3
"""Export a desktop Fitness Lab database as ``fitness-lab-export-v1.json`` — read-only.

The mobile app imports this file. The exporter never writes to the source database: it opens
it with SQLite's read-only URI (``mode=ro``, plus ``immutable=1`` when no write-ahead log is
pending) and ``PRAGMA query_only``; when a non-empty ``-wal`` file exists it copies the
database with its WAL and SHM into a temporary directory and reads the copy instead. The
source file's SHA-256, size and modification time are checked again after the export and
the export fails if anything changed. It imports nothing from ``backend/`` (whose code paths
migrate); it needs only the Python standard library.

Usage::

    python3 tools/export/fitness_lab_export.py --db PATH/TO/fitness_lab.db --out fitness-lab-export-v1.json

Stop the desktop app first so the file is not being written while it is read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

FORMAT = "fitness-lab-export"
FORMAT_VERSION = 1
SUPPORTED_SCHEMA = 8


class ExportError(Exception):
    """The source cannot be exported as it is; nothing was written."""


@dataclass(frozen=True)
class FileState:
    sha256: str
    size: int
    mtime_ns: int


def file_state(path: Path) -> FileState:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    stat = path.stat()
    return FileState(digest.hexdigest(), stat.st_size, stat.st_mtime_ns)


def _sidecars(db: Path) -> dict[str, Path]:
    return {suffix: Path(f"{db}{suffix}") for suffix in ("-wal", "-shm")}


def _states(db: Path) -> dict[str, FileState | None]:
    states: dict[str, FileState | None] = {"db": file_state(db)}
    for suffix, path in _sidecars(db).items():
        states[suffix] = file_state(path) if path.exists() else None
    return states


def _open_read_only(db: Path, scratch: Path) -> sqlite3.Connection:
    wal = _sidecars(db)["-wal"]
    if wal.exists() and wal.stat().st_size > 0:
        # Committed data may still sit in the WAL; immutable=1 would ignore it. Read a copy.
        copy = scratch / db.name
        shutil.copy2(db, copy)
        for suffix, path in _sidecars(db).items():
            if path.exists():
                shutil.copy2(path, Path(f"{copy}{suffix}"))
        uri = f"{copy.resolve().as_uri()}?mode=ro"
    else:
        uri = f"{db.resolve().as_uri()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = 1")
    return connection


def _rows(connection: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(sql, params)]


def _validate(connection: sqlite3.Connection) -> int:
    check = connection.execute("PRAGMA quick_check").fetchone()[0]
    if check != "ok":
        raise ExportError(f"the database fails SQLite's quick_check: {check}")
    try:
        version = connection.execute("SELECT max(version) FROM schema_migrations").fetchone()[0]
    except sqlite3.Error as exc:
        raise ExportError("not a Fitness Lab database (no schema_migrations table)") from exc
    if version != SUPPORTED_SCHEMA:
        raise ExportError(f"unsupported desktop schema {version}; this exporter reads schema {SUPPORTED_SCHEMA}")
    broken = connection.execute("PRAGMA foreign_key_check").fetchall()
    if broken:
        raise ExportError(f"{len(broken)} broken foreign-key relationship(s), for example in {broken[0][0]}")
    stray = connection.execute(
        """SELECT count(*) FROM performed_set_slot p JOIN performed_set s ON s.id = p.set_id
           WHERE p.workout_id <> s.workout_id"""
    ).fetchone()[0]
    if stray:
        raise ExportError(f"{stray} set placement(s) point at another workout")
    return int(version)


def _program(connection: sqlite3.Connection) -> tuple[dict[str, Any] | None, str | None]:
    active = connection.execute(
        """SELECT v.* FROM active_program_version a JOIN program_version v ON v.id = a.program_version_id"""
    ).fetchone()
    if active is None:
        return None, None
    return (
        {
            "key": active["program_key"],
            "name": active["name"],
            "version_label": active["version_label"],
            "duration_weeks": active["duration_weeks"],
            "program_json_sha256": active["program_json_sha256"],
        },
        active["id"],
    )


def build_export(connection: sqlite3.Connection, *, exported_at: str, database_sha256: str) -> dict[str, Any]:
    schema = _validate(connection)
    program, active_id = _program(connection)

    exercises = [
        {
            "id": r["id"],
            "name": r["name"],
            "equipment_label": r["equipment_label"],
            "is_active": bool(r["is_active"]),
            "created_at_utc": r["created_at_utc"],
        }
        for r in _rows(connection, "SELECT * FROM exercise ORDER BY created_at_utc, id")
    ]

    # Every slot of every program version a workout was opened from: its key, position and
    # planned exercise name, so the importer can prove the slots it maps onto are the same.
    program_slots = _rows(
        connection,
        """SELECT v.program_key, v.version_label, pw.workout_key, pw.name AS workout_name,
                  s.slot_key, s.position, e.name AS exercise_name
           FROM planned_exercise_slot s
           JOIN planned_workout pw ON pw.id = s.planned_workout_id
           JOIN program_version v ON v.id = pw.program_version_id
           JOIN exercise e ON e.id = s.exercise_id
           WHERE pw.id IN (SELECT planned_workout_id FROM workout_plan_origin)
              OR v.id = ?
           ORDER BY v.program_key, v.version_label, pw.sequence, s.position""",
        (active_id,),
    )

    workouts = []
    for w in _rows(connection, "SELECT * FROM workout ORDER BY performed_on, entered_at_utc, id"):
        origin = connection.execute(
            """SELECT v.program_key, v.version_label, pw.workout_key
               FROM workout_plan_origin o JOIN planned_workout pw ON pw.id = o.planned_workout_id
               JOIN program_version v ON v.id = pw.program_version_id WHERE o.workout_id = ?""",
            (w["id"],),
        ).fetchone()
        substitutions = _rows(
            connection,
            """SELECT s.slot_key, x.exercise_id, x.created_at_utc, x.updated_at_utc
               FROM workout_slot_substitution x JOIN planned_exercise_slot s ON s.id = x.slot_id
               WHERE x.workout_id = ? ORDER BY s.position""",
            (w["id"],),
        )
        sets = []
        for s in _rows(
            connection,
            """SELECT p.*, (pl.set_id IS NOT NULL) AS placed, sl.slot_key AS placed_slot
               FROM performed_set p
               LEFT JOIN performed_set_slot pl ON pl.set_id = p.id
               LEFT JOIN planned_exercise_slot sl ON sl.id = pl.slot_id
               WHERE p.workout_id = ? ORDER BY p.set_order""",
            (w["id"],),
        ):
            sets.append(
                {
                    "id": s["id"],
                    "exercise_id": s["exercise_id"],
                    "set_order": s["set_order"],
                    "set_type": s["set_type"],
                    "load_g": s["load_g"],
                    "reps": s["reps"],
                    "rir": s["rir"],
                    "notes": s["notes"],
                    "entered_at_utc": s["entered_at_utc"],
                    "updated_at_utc": s["updated_at_utc"],
                    # null: no placement recorded (before desktop migration 0008);
                    # {"slot_key": null}: recorded as extra work.
                    "placement": {"slot_key": s["placed_slot"]} if s["placed"] else None,
                }
            )
        workouts.append(
            {
                "id": w["id"],
                "performed_on": w["performed_on"],
                "performed_time_local": w["performed_time_local"],
                "status": w["status"],
                "notes": w["notes"],
                "entered_at_utc": w["entered_at_utc"],
                "updated_at_utc": w["updated_at_utc"],
                "origin": dict(origin) if origin else None,
                "substitutions": substitutions,
                "sets": sets,
            }
        )

    block = (
        connection.execute("SELECT start_on, set_at_utc FROM training_block WHERE program_version_id = ?", (active_id,)).fetchone()
        if active_id
        else None
    )
    document: dict[str, Any] = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "exported_at_utc": exported_at,
        "source": {"app": "fitness-lab-desktop", "schema_version": schema, "database_sha256": database_sha256},
        "program": program,
        "program_slots": program_slots,
        "training_block": dict(block) if block else None,
        "exercises": exercises,
        "workouts": workouts,
        "bodyweight": _rows(connection, "SELECT * FROM bodyweight_entry ORDER BY measured_on"),
        "nutrition_days": _rows(connection, "SELECT * FROM nutrition_day ORDER BY logged_on"),
        "macro_targets": _rows(
            connection,
            """SELECT id, effective_on, protein_g, carbs_g, fat_g, notes, set_at_utc, from_calorie_target_id
               FROM macro_target ORDER BY set_at_utc, rowid""",
        ),
        "archive": {
            "nutrition_entered_calories": _rows(connection, "SELECT * FROM nutrition_entered_calories ORDER BY logged_on"),
            "calorie_target": _rows(connection, "SELECT * FROM calorie_target ORDER BY set_at_utc, rowid"),
            "controller_event": _rows(connection, "SELECT * FROM controller_event ORDER BY recorded_at_utc, rowid"),
            "diagnostic_gate_event": _rows(connection, "SELECT * FROM diagnostic_gate_event ORDER BY recorded_at_utc, rowid"),
        },
    }
    document["counts"] = {
        "exercises": len(exercises),
        "workouts": len(workouts),
        "sets": sum(len(w["sets"]) for w in workouts),
        "bodyweight": len(document["bodyweight"]),
        "nutrition_days": len(document["nutrition_days"]),
        "macro_targets": len(document["macro_targets"]),
    }
    return document


def export_database(db: Path, out: Path, *, exported_at: str | None = None) -> dict[str, Any]:
    db = Path(db)
    out = Path(out)
    if not db.is_file():
        raise ExportError(f"no database file at {db}")
    if out.exists():
        raise ExportError(f"{out} already exists; choose another output path")
    if out.resolve() == db.resolve() or out.resolve().parent == db.resolve().parent and out.name.startswith(db.name):
        raise ExportError("the output must not be written next to the database as one of its files")
    before = _states(db)
    stamp = exported_at or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    with tempfile.TemporaryDirectory(prefix="fitness-lab-export-") as scratch:
        connection = _open_read_only(db, Path(scratch))
        try:
            document = build_export(connection, exported_at=stamp, database_sha256=before["db"].sha256)  # type: ignore[union-attr]
        finally:
            connection.close()
    if _states(db) != before:
        raise ExportError("the source database changed while it was read; stop the desktop app and export again")
    text = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    tmp = out.with_name(f".{out.name}.partial")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, out)
    return document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--db", required=True, type=Path, help="the desktop database file (read, never written)")
    parser.add_argument("--out", required=True, type=Path, help="where to write fitness-lab-export-v1.json")
    parser.add_argument("--exported-at", help="fixed export timestamp (for reproducible output)")
    args = parser.parse_args(argv)
    try:
        document = export_database(args.db, args.out, exported_at=args.exported_at)
    except ExportError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "out": str(args.out), "counts": document["counts"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
