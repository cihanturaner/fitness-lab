"""Regenerates mobile/src/data/fixtures/desktop-export-v1.json from the fixture database.

    python3 tools/export/make_sample.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import fitness_lab_export as exporter  # noqa: E402
import fixture_db  # noqa: E402

SAMPLE = HERE.parents[1] / "mobile" / "src" / "data" / "fixtures" / "desktop-export-v1.json"

if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as tmp:
        db = fixture_db.build(Path(tmp) / "fitness_lab.db")
        SAMPLE.unlink(missing_ok=True)
        exporter.export_database(db, SAMPLE, exported_at="2026-10-08T20:00:00.000000Z")
    print(SAMPLE)
