"""The deterministic adapter from the locked 12-week program artifact to package format 1."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from fitness_lab.domain.locked_program import (
    AdapterError,
    adapt_locked_program,
)
from fitness_lab.domain.program import parse_program_package

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT = (
    REPO_ROOT / "programs" / "advanced-natural-12w" / "artifact" / "locked_workout_program.json"
)
ARTIFACT_SHA256 = "81a7d4bca38bb4a581d146abfc4c6b83b239e281ea4896f37addcd6a76d7b24e"


@pytest.fixture
def source() -> bytes:
    return ARTIFACT.read_bytes()


def reencode(document: dict[str, Any]) -> bytes:
    return json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8")


def test_the_preserved_artifact_is_the_locked_one(source: bytes) -> None:
    assert hashlib.sha256(source).hexdigest() == ARTIFACT_SHA256


def test_adaptation_is_deterministic(source: bytes) -> None:
    first = adapt_locked_program(source, "locked_workout_program.json")
    second = adapt_locked_program(source, "locked_workout_program.json")
    assert first == second


def test_output_is_a_valid_package_with_the_locked_shape(source: bytes) -> None:
    adapted = adapt_locked_program(source, "locked_workout_program.json")
    spec = parse_program_package(adapted.program_json, adapted.notes_md).spec

    assert spec.duration_weeks == 12
    assert spec.version_label == "1.0.0"
    assert [(w.key, w.name, w.day_label) for w in spec.workouts] == [
        ("upper_a", "Upper A", "Monday"),
        ("lower_a", "Lower A", "Tuesday"),
        ("upper_b", "Upper B", "Thursday"),
        ("lower_b", "Lower B", "Friday"),
    ]
    assert sum(len(w.slots) for w in spec.workouts) == 29
    assert [sum(len(s.sets) for s in w.slots) for w in spec.workouts] == [23, 18, 21, 19]
    assert all(
        planned.set_type.value == "working" and planned.target_load_kg is None
        for w in spec.workouts
        for s in w.slots
        for planned in s.sets
    )


def test_prescriptions_map_exactly(source: bytes) -> None:
    adapted = adapt_locked_program(source, "locked_workout_program.json")
    spec = parse_program_package(adapted.program_json, adapted.notes_md).spec
    bench = spec.workouts[0].slots[0]
    assert bench.key == "upper_a.01"
    assert bench.exercise.name == "Smith Flat Bench Press"
    assert bench.exercise.equipment_label is None
    assert [(p.reps_min, p.reps_max) for p in bench.sets] == [(5, 8)] * 3
    assert [(p.target_rir_min, p.target_rir_max) for p in bench.sets] == [(2, 2), (2, 2), (1, 1)]
    assert bench.notes is not None
    assert "Marker lift" in bench.notes and "Failure: prohibited" in bench.notes
    assert "180–240 s" in bench.notes
    assert "Barbell Bench Press" in bench.notes

    lateral = spec.workouts[0].slots[5]
    assert [(p.target_rir_min, p.target_rir_max) for p in lateral.sets][-1] == (0, 1)


def test_equipment_alternatives_are_never_merged(source: bytes) -> None:
    adapted = adapt_locked_program(source, "locked_workout_program.json")
    spec = parse_program_package(adapted.program_json, adapted.notes_md).spec
    names = {s.exercise.name for w in spec.workouts for s in w.slots}
    assert "Cable/Machine Lateral Raise" not in names
    assert "Smith/Machine Hip Thrust" not in names
    assert {"Cable Lateral Raise", "Smith Hip Thrust"} <= names
    lateral = spec.workouts[0].slots[5]
    assert lateral.notes is not None and "Machine Lateral Raise" in lateral.notes

    manifest = json.loads(adapted.exercises_json)
    manifest_names = [item["name"] for item in manifest["exercises"]]
    assert len(manifest_names) == len(set(manifest_names)) == 26
    assert {"Machine Lateral Raise", "Machine Hip Thrust"} <= set(manifest_names)
    assert names <= set(manifest_names)


def test_notes_record_the_source_and_its_guidance(source: bytes) -> None:
    adapted = adapt_locked_program(source, "locked_workout_program.json")
    notes = adapted.notes_md.decode("utf-8")
    assert ARTIFACT_SHA256 in notes
    assert "locked_workout_program.json" in notes
    assert "finite_double_progression" in notes
    assert notes.endswith("\n")


def test_failed_integrity_checks_refuse(source: bytes) -> None:
    document = json.loads(source)
    document["sessions"]["upper_a"]["exercises"][0]["sets"] = 4
    document["sessions"]["upper_a"]["exercises"][0]["rir_by_set"].append("1")
    with pytest.raises(AdapterError, match="integrity"):
        adapt_locked_program(reencode(document), "tampered.json")


def test_rir_list_must_match_the_set_count(source: bytes) -> None:
    document = json.loads(source)
    document["sessions"]["upper_a"]["exercises"][0]["rir_by_set"].pop()
    with pytest.raises(AdapterError, match="rir_by_set"):
        adapt_locked_program(reencode(document), "tampered.json")


def test_an_unknown_equipment_alternative_is_refused(source: bytes) -> None:
    document = json.loads(source)
    document["sessions"]["upper_a"]["exercises"][1]["name"] = "Cable/Machine Row"
    with pytest.raises(AdapterError, match="Cable/Machine Row"):
        adapt_locked_program(reencode(document), "tampered.json")


def test_unreadable_rir_is_refused(source: bytes) -> None:
    document = json.loads(source)
    document["sessions"]["upper_a"]["exercises"][0]["rir_by_set"][0] = "2+"
    with pytest.raises(AdapterError, match="RIR"):
        adapt_locked_program(reencode(document), "tampered.json")
