"""Tests for the read-only desktop exporter. Run from the repository root:

    python3 -m unittest discover -s tools/export -v
"""

from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fitness_lab_export as exporter  # noqa: E402
import fixture_db  # noqa: E402

SAMPLE = HERE.parents[1] / "mobile" / "src" / "data" / "fixtures" / "desktop-export-v1.json"
STAMP = "2026-10-08T20:00:00.000000Z"


class ExporterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.db = fixture_db.build(self.dir / "fitness_lab.db")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def export(self, name: str = "out.json", db: Path | None = None) -> dict:
        return exporter.export_database(db or self.db, self.dir / name, exported_at=STAMP)

    def test_never_changes_the_source_and_is_deterministic(self) -> None:
        before = exporter._states(self.db)
        first = (self.export("a.json"), (self.dir / "a.json").read_text(encoding="utf-8"))
        second = (self.dir / "b.json", self.export("b.json"))
        self.assertEqual(exporter._states(self.db), before)
        self.assertEqual(first[1], second[0].read_text(encoding="utf-8"))
        self.assertFalse(Path(f"{self.db}-wal").exists())
        self.assertFalse(Path(f"{self.db}-shm").exists())

    def test_reads_committed_data_still_in_the_wal_without_touching_the_source(self) -> None:
        writer = sqlite3.connect(self.db)
        writer.execute("PRAGMA journal_mode = WAL")
        writer.execute("PRAGMA wal_autocheckpoint = 0")
        with writer:
            writer.execute("INSERT INTO bodyweight_entry VALUES ('2026-10-09', 82300, NULL, 'x', 'x')")
        self.assertGreater(Path(f"{self.db}-wal").stat().st_size, 0)
        before = exporter._states(self.db)
        document = self.export()
        self.assertEqual(exporter._states(self.db), before)
        self.assertIn("2026-10-09", [row["measured_on"] for row in document["bodyweight"]])
        writer.close()

    def test_carries_slot_placements_substitutions_and_origins(self) -> None:
        document = self.export()
        self.assertEqual(document["format"], "fitness-lab-export")
        self.assertEqual(document["format_version"], 1)
        self.assertEqual(document["source"]["schema_version"], 8)
        upper_a = next(w for w in document["workouts"] if w["id"] == "w-1")
        self.assertEqual(upper_a["origin"], {"program_key": "advanced-natural-12w", "version_label": "1.0.0", "workout_key": "upper_a"})
        self.assertEqual([s["slot_key"] for s in upper_a["substitutions"]], ["upper_a.07"])
        placements = {s["id"]: s["placement"] for s in upper_a["sets"]}
        self.assertEqual(placements["s-03"], {"slot_key": "upper_a.07"})
        self.assertEqual(placements["s-04"], {"slot_key": "upper_a.06"})
        self.assertIsNone(placements["s-06"])  # recorded before placements existed
        self.assertEqual(placements["s-07"], {"slot_key": None})  # extra work
        unplanned = next(w for w in document["workouts"] if w["id"] == "w-2")
        self.assertIsNone(unplanned["origin"])
        self.assertEqual(document["training_block"], {"start_on": "2026-10-01", "set_at_utc": "2026-09-20T08:00:00Z"})
        self.assertEqual(len(document["program_slots"]), 29)
        self.assertEqual(document["counts"]["sets"], 10)
        self.assertNotIn("calories", json.dumps(document["nutrition_days"]))

    def test_refuses_what_it_cannot_export_safely(self) -> None:
        with self.assertRaisesRegex(exporter.ExportError, "no database file"):
            exporter.export_database(self.dir / "missing.db", self.dir / "x.json")
        other = self.dir / "other.db"
        sqlite3.connect(other).execute("CREATE TABLE t (x)").connection.close()
        with self.assertRaisesRegex(exporter.ExportError, "not a Fitness Lab database"):
            self.export("o.json", db=other)
        (self.dir / "taken.json").write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(exporter.ExportError, "already exists"):
            self.export("taken.json")

    def test_refuses_an_unsupported_schema(self) -> None:
        with sqlite3.connect(self.db) as c:
            c.execute("INSERT INTO schema_migrations VALUES (9, '0009_future.sql', ?, 'x')", ("0" * 64,))
        with self.assertRaisesRegex(exporter.ExportError, "unsupported desktop schema 9"):
            self.export()

    def test_refuses_broken_relationships(self) -> None:
        c = sqlite3.connect(self.db)
        c.execute("PRAGMA foreign_keys = OFF")
        with c:
            c.execute("INSERT INTO bodyweight_entry VALUES ('2026-10-10', 82000, NULL, 'x', 'x')")
            c.execute("UPDATE training_block SET program_version_id = 'gone'")
        c.close()
        with self.assertRaisesRegex(exporter.ExportError, "broken foreign-key"):
            self.export()

    def test_imports_nothing_from_the_backend(self) -> None:
        source = (HERE / "fitness_lab_export.py").read_text(encoding="utf-8")
        self.assertNotIn("fitness_lab.", source.replace("fitness_lab.db", ""))
        self.assertNotIn("import fitness_lab", source)

    def test_the_mobile_sample_is_this_exporter_output(self) -> None:
        document = self.export()
        text = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        committed = SAMPLE.read_text(encoding="utf-8")
        # The database hash depends on SQLite's file layout; everything else must match.
        self.assertEqual(
            json.loads(text) | {"source": None},
            json.loads(committed) | {"source": None},
        )


if __name__ == "__main__":
    unittest.main()
