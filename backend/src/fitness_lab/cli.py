"""``fitness-lab`` — the command-line boundary for program administration.

Program import and activation are deliberately not in the UI: a mis-click must never
switch the active program. Every command migrates the database to head first (the same
guarded path the server takes), honours ``FITNESS_LAB_DB``, and prints one JSON object
so its outcome can be recorded verbatim.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from fitness_lab.domain.locked_program import AdapterError, adapt_locked_program
from fitness_lab.domain.models import create_exercise
from fitness_lab.domain.program import PackageError, parse_program_package, sha256_hex
from fitness_lab.storage import db, migrations, programs
from fitness_lab.storage.exercises import find_exercise_by_identity, insert_exercise

MANIFEST_FORMAT = "fitness-lab.exercise-manifest"


class CommandError(RuntimeError):
    """A command refused; the message is reported and the exit status is 1."""


def _emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def _migrate() -> dict[str, object]:
    result = migrations.migrate_to_head()
    return {
        "database": str(db.database_path()),
        "applied": list(result.applied),
        "snapshot": None if result.snapshot is None else str(result.snapshot),
    }


def cmd_migrate(_args: argparse.Namespace) -> dict[str, object]:
    return _migrate()


def cmd_adapt(args: argparse.Namespace) -> dict[str, object]:
    source_path = Path(args.artifact)
    source = source_path.read_bytes()
    try:
        adapted = adapt_locked_program(source, source_path.name)
    except (AdapterError, PackageError) as exc:
        raise CommandError(str(exc)) from exc
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "program.json").write_bytes(adapted.program_json)
    (out_dir / "program-notes.md").write_bytes(adapted.notes_md)
    (out_dir / "exercises.json").write_bytes(adapted.exercises_json)
    package = parse_program_package(adapted.program_json, adapted.notes_md)
    return {
        "source_sha256": sha256_hex(source),
        "out_dir": str(out_dir),
        "program_json_sha256": package.program_json_sha256,
        "notes_sha256": package.notes_sha256,
        "package_sha256": package.package_sha256,
    }


def cmd_ensure_exercises(args: argparse.Namespace) -> dict[str, object]:
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    if manifest.get("format") != MANIFEST_FORMAT or manifest.get("format_version") != 1:
        raise CommandError(f"not a {MANIFEST_FORMAT} v1 file: {args.manifest}")
    migration = _migrate()
    created: list[str] = []
    existing: list[str] = []
    with db.connection_scope() as connection, db.immediate_transaction(connection):
        for item in manifest["exercises"]:
            name, label = item["name"], item.get("equipment_label")
            found = find_exercise_by_identity(connection, name, label)
            if found is not None:
                if not found.is_active:
                    raise CommandError(
                        f"exercise {name!r} exists but is retired; it is never silently revived"
                    )
                existing.append(name)
                continue
            insert_exercise(connection, create_exercise(name, label, notes=item.get("notes")))
            created.append(name)
    return {"migration": migration, "created": created, "existing": existing}


def cmd_import(args: argparse.Namespace) -> dict[str, object]:
    package_dir = Path(args.package_dir)
    program_json = (package_dir / "program.json").read_bytes()
    notes_path = package_dir / "program-notes.md"
    notes = notes_path.read_bytes() if notes_path.exists() else None
    try:
        package = parse_program_package(program_json, notes)
    except PackageError as exc:
        raise CommandError(str(exc)) from exc
    migration = _migrate()
    with db.connection_scope() as connection:
        try:
            result = programs.import_program_package(connection, package)
        except programs.ImportRefused as exc:
            raise CommandError(str(exc)) from exc
    return {
        "migration": migration,
        "version_id": result.version.id,
        "created": result.created,
        "package_sha256": result.version.package_sha256,
        "program_json_sha256": result.version.program_json_sha256,
        "notes_sha256": result.version.notes_sha256,
    }


def cmd_activate(args: argparse.Namespace) -> dict[str, object]:
    _migrate()
    with db.connection_scope() as connection:
        try:
            programs.activate_program_version(connection, args.version_id)
        except programs.ProgramStateError as exc:
            raise CommandError(str(exc)) from exc
    return {"active_version_id": args.version_id}


def cmd_deactivate(_args: argparse.Namespace) -> dict[str, object]:
    _migrate()
    with db.connection_scope() as connection:
        programs.deactivate_program(connection)
    return {"active_version_id": None}


def cmd_list(_args: argparse.Namespace) -> dict[str, object]:
    _migrate()
    with db.connection_scope() as connection:
        active = programs.get_active_version(connection)
        versions = programs.list_program_versions(connection)
    return {
        "active_version_id": None if active is None else active.id,
        "versions": [
            {
                "id": version.id,
                "program_key": version.program_key,
                "name": version.name,
                "version_label": version.version_label,
                "package_sha256": version.package_sha256,
                "imported_at_utc": version.imported_at_utc,
            }
            for version in versions
        ],
    }


def cmd_show(args: argparse.Namespace) -> dict[str, object]:
    _migrate()
    with db.connection_scope() as connection:
        version = (
            programs.get_program_version(connection, args.version_id)
            if args.version_id
            else programs.get_active_version(connection)
        )
        if version is None:
            raise CommandError("no such program version (and none is active)")
        planned = []
        for workout in programs.list_planned_workouts(connection, version.id):
            slots = programs.list_slots(connection, workout.id)
            planned.append(
                {
                    "key": workout.workout_key,
                    "name": workout.name,
                    "day_label": workout.day_label,
                    "slots": len(slots),
                    "sets": sum(len(slot.sets) for slot in slots),
                }
            )
    return {"version_id": version.id, "name": version.name, "planned_workouts": planned}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fitness-lab", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate", help="apply pending migrations").set_defaults(func=cmd_migrate)
    adapt = commands.add_parser("adapt-locked-program", help="convert the locked program")
    adapt.add_argument("artifact")
    adapt.add_argument("out_dir")
    adapt.set_defaults(func=cmd_adapt)
    ensure = commands.add_parser("ensure-exercises", help="create missing exercise identities")
    ensure.add_argument("manifest")
    ensure.set_defaults(func=cmd_ensure_exercises)
    importer = commands.add_parser("import-program", help="import a program package directory")
    importer.add_argument("package_dir")
    importer.set_defaults(func=cmd_import)
    activate = commands.add_parser("activate-program", help="make a version the active one")
    activate.add_argument("version_id")
    activate.set_defaults(func=cmd_activate)
    commands.add_parser("deactivate-program", help="leave no active version").set_defaults(
        func=cmd_deactivate
    )
    commands.add_parser("list-programs", help="list imported versions").set_defaults(func=cmd_list)
    show = commands.add_parser("show-program", help="summarise a version (default: active)")
    show.add_argument("version_id", nargs="?")
    show.set_defaults(func=cmd_show)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        payload = args.func(args)
    except CommandError as exc:
        _emit({"ok": False, "error": str(exc)})
        return 1
    _emit({"ok": True, **payload})
    return 0


if __name__ == "__main__":
    sys.exit(main())
