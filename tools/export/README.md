# Desktop → mobile export (read-only)

`fitness_lab_export.py` writes a desktop Fitness Lab database as `fitness-lab-export-v1.json`,
the versioned file the mobile app imports (Settings › Your data › Import a file). It needs only
Python 3.11+ and its standard library, and imports nothing from `backend/`.

    # stop the desktop app first, then, from the repository root:
    python3 tools/export/fitness_lab_export.py --db data/fitness_lab.db --out ~/Desktop/fitness-lab-export-v1.json

It never writes to the source: SQLite read-only URI (`mode=ro`, `immutable=1` when no WAL is
pending) plus `PRAGMA query_only`; a non-empty `-wal` is read from a temporary copy. The
database, WAL and SHM are hashed before and after, and the export fails if anything changed.
It refuses a database that fails `quick_check`, has broken foreign keys, or is not desktop
schema 8, and it never overwrites an existing output file.

The file carries every workout (draft or complete) with its planned origin, per-slot
substitutions and every set with its recorded slot placement (`null` = none recorded,
`{"slot_key": null}` = extra work), plus the block start, exercises, bodyweight, nutrition
days, macro targets, the slots of the program versions used, and the desktop-only history
(controller decisions, gate audits, archived calories) under `archive`.

Tests (build a fixture database from `backend/migrations`, never the real one):

    python3 -m unittest discover -s tools/export -v

`make_sample.py` regenerates `mobile/src/data/fixtures/desktop-export-v1.json`, which the
mobile importer's tests read.
