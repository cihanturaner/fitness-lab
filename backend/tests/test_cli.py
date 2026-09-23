"""The fitness-lab command-line tool: adapt, ensure exercises, import, activate."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from fitness_lab.cli import main
from fitness_lab.domain.models import create_exercise, deactivate_exercise
from fitness_lab.storage import db
from fitness_lab.storage.exercises import find_exercise_by_identity, insert_exercise
from program_fixtures import document, encode

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = (
    REPO_ROOT / "programs" / "advanced-natural-12w" / "artifact" / "locked_workout_program.json"
)


@pytest.fixture
def db_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "cli.db"
    monkeypatch.setenv("FITNESS_LAB_DB", str(path))
    return path


def run(capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, dict[str, object]]:
    code = main(list(argv))
    out = capsys.readouterr().out.strip().splitlines()
    return code, json.loads(out[-1]) if out else {}


def write_manifest(path: Path, names: list[str]) -> Path:
    manifest = {
        "format": "fitness-lab.exercise-manifest",
        "format_version": 1,
        "exercises": [{"name": name, "equipment_label": None, "notes": None} for name in names],
    }
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def test_ensure_exercises_creates_only_missing_ones(
    db_file: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = write_manifest(tmp_path / "exercises.json", ["Bench Press", "Row"])
    code, first = run(capsys, "ensure-exercises", str(manifest))
    assert code == 0
    assert first["created"] == ["Bench Press", "Row"]
    assert first["existing"] == []

    code, second = run(capsys, "ensure-exercises", str(manifest))
    assert code == 0
    assert second["created"] == []
    assert second["existing"] == ["Bench Press", "Row"]


def test_ensure_exercises_refuses_retired_identities(
    db_file: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, _ = run(capsys, "migrate")
    assert code == 0
    with db.connection_scope(db_file) as connection:
        exercise = create_exercise("Row")
        insert_exercise(connection, deactivate_exercise(exercise))
    manifest = write_manifest(tmp_path / "exercises.json", ["Row"])
    code, result = run(capsys, "ensure-exercises", str(manifest))
    assert code == 1
    assert "retired" in str(result["error"])


def test_import_is_idempotent_and_activation_works(
    db_file: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    package_dir = tmp_path / "package"
    package_dir.mkdir()
    (package_dir / "program.json").write_bytes(encode(document()))
    (package_dir / "program-notes.md").write_bytes(b"Notlar\r\n")
    run(
        capsys,
        "ensure-exercises",
        str(write_manifest(tmp_path / "e.json", ["Bench Press", "Row", "Squat"])),
    )

    code, first = run(capsys, "import-program", str(package_dir))
    assert code == 0 and first["created"] is True
    code, second = run(capsys, "import-program", str(package_dir))
    assert code == 0 and second["created"] is False
    assert second["version_id"] == first["version_id"]

    code, listed = run(capsys, "list-programs")
    assert code == 0 and listed["active_version_id"] is None

    code, _ = run(capsys, "activate-program", str(first["version_id"]))
    assert code == 0
    code, shown = run(capsys, "show-program")
    assert code == 0
    assert shown["version_id"] == first["version_id"]
    assert shown["planned_workouts"] == [
        {"key": "upper_a", "name": "Upper A", "day_label": "Monday", "slots": 3, "sets": 4},
        {"key": "lower_a", "name": "Lower A", "day_label": "Tuesday", "slots": 1, "sets": 1},
    ]

    code, _ = run(capsys, "deactivate-program")
    assert code == 0
    code, listed = run(capsys, "list-programs")
    assert listed["active_version_id"] is None


def test_import_refuses_missing_exercises_cleanly(
    db_file: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    package_dir = tmp_path / "package"
    package_dir.mkdir()
    (package_dir / "program.json").write_bytes(encode(document()))
    code, result = run(capsys, "import-program", str(package_dir))
    assert code == 1
    assert "Bench Press" in str(result["error"])


def test_import_refuses_an_invalid_package(
    db_file: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    package_dir = tmp_path / "package"
    package_dir.mkdir()
    (package_dir / "program.json").write_bytes(b"\xef\xbb\xbf{}")
    code, result = run(capsys, "import-program", str(package_dir))
    assert code == 1
    assert "BOM" in str(result["error"])


def test_activating_an_unknown_version_fails(
    db_file: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, result = run(capsys, "activate-program", "nope")
    assert code == 1
    assert "nope" in str(result["error"])


def test_the_locked_program_goes_end_to_end(
    db_file: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out_dir = tmp_path / "package"
    code, adapted = run(capsys, "adapt-locked-program", str(ARTIFACT), str(out_dir))
    assert code == 0
    assert sorted(path.name for path in out_dir.iterdir()) == [
        "exercises.json",
        "program-notes.md",
        "program.json",
    ]
    first_bytes = (out_dir / "program.json").read_bytes()
    run(capsys, "adapt-locked-program", str(ARTIFACT), str(out_dir))
    assert (out_dir / "program.json").read_bytes() == first_bytes

    code, ensured = run(capsys, "ensure-exercises", str(out_dir / "exercises.json"))
    created = ensured["created"]
    assert code == 0 and isinstance(created, list) and len(created) == 26
    code, imported = run(capsys, "import-program", str(out_dir))
    assert code == 0
    run(capsys, "activate-program", str(imported["version_id"]))
    code, shown = run(capsys, "show-program")
    planned: Any = shown["planned_workouts"]
    assert [(item["key"], item["slots"], item["sets"]) for item in planned] == [
        ("upper_a", 9, 23),
        ("lower_a", 6, 18),
        ("upper_b", 8, 21),
        ("lower_b", 6, 19),
    ]
    with db.connection_scope(db_file) as connection:
        assert find_exercise_by_identity(connection, "Machine Lateral Raise", None) is not None
        assert connection.execute("SELECT count(*) FROM performed_set").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM workout").fetchone()[0] == 0
    assert adapted["source_sha256"] == (
        "81a7d4bca38bb4a581d146abfc4c6b83b239e281ea4896f37addcd6a76d7b24e"
    )


def test_set_block_start_for_the_active_version(
    db_file: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, result = run(capsys, "set-block-start", "2026-10-01")
    assert code == 1
    assert "no active program" in str(result["error"])

    manifest = write_manifest(tmp_path / "exercises.json", ["Bench Press", "Row", "Squat"])
    run(capsys, "ensure-exercises", str(manifest))
    package_dir = tmp_path / "package"
    package_dir.mkdir()
    (package_dir / "program.json").write_bytes(encode(document()))
    _, imported = run(capsys, "import-program", str(package_dir))
    run(capsys, "activate-program", str(imported["version_id"]))

    code, result = run(capsys, "set-block-start", "2026-10-01")
    assert code == 0
    assert result["start_on"] == "2026-10-01"
    assert result["version_id"] == imported["version_id"]
    assert result["week_1"] == ["2026-09-28", "2026-10-04"]

    code, result = run(capsys, "set-block-start", "2026-10-32")
    assert code == 1
    with db.connection_scope(db_file) as connection:
        row = connection.execute("SELECT start_on FROM training_block").fetchone()
    assert row["start_on"] == "2026-10-01"
