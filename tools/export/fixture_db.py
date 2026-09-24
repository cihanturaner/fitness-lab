"""A small desktop database for the exporter's tests, built without the backend's code.

It applies the frozen migrations (backend/migrations/0001…0008, read only) to a new SQLite
file and records a few days the way the desktop app does: the locked program imported and
active, a block start, a completed Upper A in which a substitution makes two slots the same
exercise (the V3.3.1 duplicate-slot case), a set recorded before placements existed, extra
work, a draft Upper B, an unplanned session, weigh-ins, macro logs and targets. Invented
numbers only — not user data.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "backend" / "migrations"
PACKAGE = ROOT / "programs" / "advanced-natural-12w" / "package"
PACKAGE_HASH_PREFIX = "fitness-lab.program-package.v1"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def migrate(connection: sqlite3.Connection) -> None:
    connection.execute(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, filename TEXT NOT NULL,"
        " sha256 TEXT NOT NULL, applied_at_utc TEXT NOT NULL) STRICT"
    )
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        text = path.read_text(encoding="utf-8")
        connection.executescript(text)
        connection.execute(
            "INSERT INTO schema_migrations VALUES (?, ?, ?, ?)",
            (int(path.name[:4]), path.name, sha(text.encode("utf-8")), "2026-09-01T00:00:00Z"),
        )


def import_program(connection: sqlite3.Connection) -> dict[str, str]:
    """The locked package as the desktop importer stores it; returns exercise ids by name."""
    program_bytes = (PACKAGE / "program.json").read_bytes()
    notes_bytes = (PACKAGE / "program-notes.md").read_bytes()
    program = json.loads(program_bytes)
    manifest = f"{PACKAGE_HASH_PREFIX}\nprogram.json {sha(program_bytes)}\nprogram-notes.md {sha(notes_bytes)}\n"
    exercises: dict[str, str] = {}
    for index, item in enumerate(json.loads((PACKAGE / "exercises.json").read_bytes())["exercises"], start=1):
        exercises[item["name"]] = f"ex-{index:02d}"
        connection.execute(
            "INSERT INTO exercise (id, name, equipment_label, notes, is_active, created_at_utc, updated_at_utc)"
            " VALUES (?, ?, NULL, NULL, 1, ?, ?)",
            (f"ex-{index:02d}", item["name"], "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
        )
    meta = program["program"]
    connection.execute(
        "INSERT INTO program_version VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
        (
            "pv-1",
            meta["key"],
            meta["name"],
            meta["version_label"],
            meta["duration_weeks"],
            sha(manifest.encode("utf-8")),
            sha(program_bytes),
            program_bytes.decode("utf-8"),
            sha(notes_bytes),
            notes_bytes.decode("utf-8"),
            "2026-09-01T00:00:00Z",
        ),
    )
    for sequence, workout in enumerate(program["workouts"], start=1):
        workout_id = f"pw-{workout['key']}"
        connection.execute(
            "INSERT INTO planned_workout VALUES (?, 'pv-1', ?, ?, ?, ?, ?)",
            (workout_id, workout["key"], sequence, workout["name"], workout["day_label"], workout["notes"]),
        )
        for position, slot in enumerate(workout["slots"], start=1):
            slot_id = f"ps-{slot['key']}"
            connection.execute(
                "INSERT INTO planned_exercise_slot VALUES (?, ?, ?, ?, ?, ?)",
                (slot_id, workout_id, slot["key"], position, exercises[slot["exercise"]["name"]], slot["notes"]),
            )
            for set_position, planned in enumerate(slot["sets"], start=1):
                connection.execute(
                    "INSERT INTO planned_set VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
                    (
                        f"pset-{slot['key']}-{set_position}",
                        slot_id,
                        set_position,
                        planned["set_type"],
                        planned["reps_min"],
                        planned["reps_max"],
                        planned["target_rir_min"],
                        planned["target_rir_max"],
                    ),
                )
    connection.execute("INSERT INTO active_program_version VALUES (1, 'pv-1', '2026-09-01T00:00:00Z')")
    return exercises


class Recorder:
    def __init__(self, connection: sqlite3.Connection, exercises: dict[str, str]) -> None:
        self.c = connection
        self.ex = exercises
        self.n = 0

    def stamp(self) -> str:
        self.n += 1
        return f"2026-10-01T{self.n // 60:02d}:{self.n % 60:02d}:00Z"

    def workout(self, wid: str, day: str, workout_key: str | None) -> None:
        now = self.stamp()
        self.c.execute(
            "INSERT INTO workout VALUES (?, ?, NULL, 'draft', NULL, ?, ?)", (wid, day, now, now)
        )
        if workout_key:
            self.c.execute("INSERT INTO workout_plan_origin VALUES (?, ?, ?)", (wid, f"pw-{workout_key}", now))

    def substitute(self, wid: str, workout_key: str, slot_key: str, exercise: str) -> None:
        now = self.stamp()
        self.c.execute(
            "INSERT INTO workout_slot_substitution VALUES (?, ?, ?, ?, ?, ?)",
            (wid, f"pw-{workout_key}", f"ps-{slot_key}", self.ex[exercise], now, now),
        )

    def set(
        self,
        wid: str,
        sid: str,
        exercise: str,
        load_g: int | None,
        reps: int | None,
        rir: int | None,
        *,
        slot: tuple[str, str | None] | None,
        set_type: str = "working",
    ) -> None:
        """``slot``: (workout_key, slot_key) placed; (workout_key, None) extra work; None unplaced."""
        now = self.stamp()
        order = self.c.execute("SELECT coalesce(max(set_order), 0) + 1 FROM performed_set WHERE workout_id = ?", (wid,)).fetchone()[0]
        self.c.execute(
            "INSERT INTO performed_set VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
            (sid, wid, self.ex[exercise], order, set_type, load_g, reps, rir, now, now),
        )
        if slot is not None:
            workout_key, slot_key = slot
            self.c.execute(
                "INSERT INTO performed_set_slot VALUES (?, ?, ?, ?, ?)",
                (sid, wid, f"pw-{workout_key}", f"ps-{slot_key}" if slot_key else None, now),
            )

    def complete(self, wid: str) -> None:
        self.c.execute("UPDATE workout SET status = 'complete', updated_at_utc = ? WHERE id = ?", (self.stamp(), wid))


def build(path: Path) -> Path:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    with connection:
        migrate(connection)
        exercises = import_program(connection)
        connection.execute("INSERT INTO training_block VALUES ('pv-1', '2026-10-01', '2026-09-20T08:00:00Z')")
        r = Recorder(connection, exercises)

        # Upper A, Monday of week 2: Reverse Pec Deck (slot 07) performed as Cable Lateral Raise,
        # so slots 06 and 07 are the same exercise and must keep their own sets.
        r.workout("w-1", "2026-10-05", "upper_a")
        r.substitute("w-1", "upper_a", "upper_a.07", "Cable Lateral Raise")
        r.set("w-1", "s-01", "Smith Flat Bench Press", 102058, 7, 2, slot=("upper_a", "upper_a.01"))
        r.set("w-1", "s-02", "Smith Flat Bench Press", 102058, 6, 1, slot=("upper_a", "upper_a.01"))
        r.set("w-1", "s-03", "Cable Lateral Raise", 9072, 18, 1, slot=("upper_a", "upper_a.07"))
        r.set("w-1", "s-04", "Cable Lateral Raise", 11340, 15, 1, slot=("upper_a", "upper_a.06"))
        r.set("w-1", "s-05", "Cable Lateral Raise", 9072, 16, 0, slot=("upper_a", "upper_a.07"))
        r.set("w-1", "s-06", "Preacher Curl", 20412, 12, None, slot=None)  # before placements existed
        r.set("w-1", "s-07", "Leg Extension", 31751, 15, 1, slot=("upper_a", None))  # extra work
        r.set("w-1", "s-08", "Smith Flat Bench Press", 61235, 5, None, slot=("upper_a", "upper_a.01"), set_type="warmup")
        r.complete("w-1")

        # An unplanned session.
        r.workout("w-2", "2026-10-03", None)
        r.set("w-2", "s-09", "Hack Squat", 90718, 10, 2, slot=None)
        r.complete("w-2")

        # Upper B, Thursday: still a draft.
        r.workout("w-3", "2026-10-08", "upper_b")
        r.set("w-3", "s-10", "Neutral-Grip Lat Pulldown", 63503, 9, 2, slot=("upper_b", "upper_b.01"))

        for day, grams in (("2026-10-04", 82900), ("2026-10-06", 82500), ("2026-10-08", 82400)):
            connection.execute("INSERT INTO bodyweight_entry VALUES (?, ?, NULL, ?, ?)", (day, grams, r.stamp(), r.stamp()))
        connection.execute("INSERT INTO nutrition_day VALUES ('2026-10-05', 150, 300, 62, NULL, ?, ?)", (r.stamp(), r.stamp()))
        connection.execute("INSERT INTO nutrition_day VALUES ('2026-10-06', 140, NULL, 55, 'travel', ?, ?)", (r.stamp(), r.stamp()))
        connection.execute(
            "INSERT INTO macro_target (id, effective_on, protein_g, carbs_g, fat_g, notes, set_at_utc, from_calorie_target_id)"
            " VALUES ('mt-1', '2026-10-01', 145, 310, 60, NULL, '2026-09-30T08:00:00Z', NULL)"
        )
        connection.execute(
            "INSERT INTO macro_target (id, effective_on, protein_g, carbs_g, fat_g, notes, set_at_utc, from_calorie_target_id)"
            " VALUES ('mt-2', '2026-10-06', 145, 348, 60, 'Weeks 1–2 exception: illness', '2026-10-06T07:00:00Z', NULL)"
        )
    connection.close()
    return path
