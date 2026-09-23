"""Program package format 1: exact artifact preservation, hashing and strict validation."""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest

from fitness_lab.domain.models import SetTypeCode
from fitness_lab.domain.program import (
    PackageError,
    decode_artifact,
    package_sha256,
    parse_program_package,
    sha256_hex,
)


def valid_document() -> dict[str, Any]:
    return {
        "format": "fitness-lab.program",
        "format_version": 1,
        "program": {
            "key": "test-program",
            "name": "Test Program",
            "version_label": "1.0.0",
            "duration_weeks": 12,
            "notes": "Ağırlık — notes",
        },
        "workouts": [
            {
                "key": "upper_a",
                "name": "Upper A",
                "day_label": "Monday",
                "notes": None,
                "slots": [
                    {
                        "key": "upper_a.01",
                        "exercise": {"name": "Bench Press", "equipment_label": None},
                        "notes": "Marker",
                        "sets": [
                            {
                                "set_type": "working",
                                "reps_min": 5,
                                "reps_max": 8,
                                "target_rir_min": 2,
                                "target_rir_max": 2,
                                "target_load_kg": "82.5",
                                "notes": None,
                            },
                            {
                                "set_type": "working",
                                "reps_min": 5,
                                "reps_max": None,
                                "target_rir_min": 0,
                                "target_rir_max": 1,
                                "target_load_kg": None,
                                "notes": None,
                            },
                        ],
                    },
                    {
                        "key": "upper_a.02",
                        "exercise": {"name": "Row", "equipment_label": "Cable stack"},
                        "sets": [{"set_type": "working", "reps_min": 10, "reps_max": 10}],
                    },
                ],
            },
            {
                "key": "lower_a",
                "name": "Lower A",
                "slots": [
                    {
                        "key": "lower_a.01",
                        "exercise": {"name": "Squat"},
                        "sets": [{"set_type": "working", "reps_min": 6, "reps_max": 10}],
                    }
                ],
            },
        ],
    }


def encode(document: object) -> bytes:
    return (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def issues_of(program_json: bytes, notes: bytes | None = None) -> tuple[str, ...]:
    with pytest.raises(PackageError) as caught:
        parse_program_package(program_json, notes)
    return caught.value.issues


Change = Callable[[dict[str, Any]], object]


def mutated(change: Change) -> bytes:
    document = copy.deepcopy(valid_document())
    change(document)
    return encode(document)


# --- artifact decoding -------------------------------------------------------------------


def test_bom_is_refused() -> None:
    with pytest.raises(PackageError, match="BOM"):
        decode_artifact(b"\xef\xbb\xbf{}", "program.json")


def test_invalid_utf8_is_refused() -> None:
    with pytest.raises(PackageError, match="UTF-8"):
        decode_artifact(b'{"a": "\xff"}', "program.json")


def test_nul_byte_is_refused() -> None:
    with pytest.raises(PackageError, match="NUL"):
        decode_artifact(b"notes\x00more", "program-notes.md")


def test_decoding_preserves_crlf_trailing_newline_and_non_ascii() -> None:
    original = "# Notlar\r\n\r\nAğırlık: 82.5 kg — çalış\r\n".encode()
    text = decode_artifact(original, "program-notes.md")
    assert text.encode("utf-8") == original
    assert text.endswith("\r\n")


def test_sha256_is_over_the_exact_bytes() -> None:
    data = b"abc\r\n"
    assert sha256_hex(data) == hashlib.sha256(data).hexdigest()


# --- hashing ------------------------------------------------------------------------------


def test_package_hash_is_versioned_and_depends_on_notes() -> None:
    json_hash = sha256_hex(b"{}")
    without = package_sha256(json_hash, None)
    with_notes = package_sha256(json_hash, sha256_hex(b"n"))
    expected = hashlib.sha256(
        f"fitness-lab.program-package.v1\nprogram.json {json_hash}\nprogram-notes.md -\n".encode()
    ).hexdigest()
    assert without == expected
    assert with_notes != without
    assert package_sha256(json_hash, None) == without


def test_parsed_package_carries_exact_texts_and_hashes() -> None:
    program_json = encode(valid_document()).replace(b"\n", b"\r\n")
    notes = "Ağırlık notları\n".encode()
    package = parse_program_package(program_json, notes)
    assert package.program_json_text.encode("utf-8") == program_json
    assert package.program_json_sha256 == hashlib.sha256(program_json).hexdigest()
    assert package.notes_text is not None
    assert package.notes_text.encode("utf-8") == notes
    assert package.notes_sha256 == hashlib.sha256(notes).hexdigest()
    assert package.package_sha256 == package_sha256(
        package.program_json_sha256, package.notes_sha256
    )


def test_package_without_notes_has_no_notes_hash() -> None:
    package = parse_program_package(encode(valid_document()), None)
    assert package.notes_text is None
    assert package.notes_sha256 is None


# --- structure ----------------------------------------------------------------------------


def test_valid_package_parses_in_array_order() -> None:
    spec = parse_program_package(encode(valid_document()), None).spec
    assert spec.key == "test-program"
    assert spec.duration_weeks == 12
    assert [workout.key for workout in spec.workouts] == ["upper_a", "lower_a"]
    first = spec.workouts[0]
    assert first.day_label == "Monday"
    assert [slot.key for slot in first.slots] == ["upper_a.01", "upper_a.02"]
    bench = first.slots[0]
    assert bench.exercise.name == "Bench Press"
    assert bench.exercise.equipment_label is None
    assert bench.sets[0].set_type is SetTypeCode.WORKING
    assert bench.sets[0].target_load_kg == Decimal("82.5")
    assert (bench.sets[0].target_rir_min, bench.sets[0].target_rir_max) == (2, 2)
    assert bench.sets[1].reps_max is None
    assert first.slots[1].exercise.equipment_label == "Cable stack"
    assert first.slots[1].notes is None
    assert spec.workouts[1].day_label is None


def test_invalid_json_is_refused() -> None:
    assert any("JSON" in issue for issue in issues_of(b"{not json"))


def test_duplicate_keys_are_refused() -> None:
    raw = b'{"format": "fitness-lab.program", "format": "x"}'
    assert any("duplicate key" in issue for issue in issues_of(raw))


def test_floats_are_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(reps_min=5.0))
    assert any("reps_min" in issue for issue in issues_of(raw))


def test_json_number_load_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(target_load_kg=82))
    assert any("target_load_kg" in issue for issue in issues_of(raw))


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d.update(extra=1),
        lambda d: d["program"].update(extra=1),
        lambda d: d["workouts"][0].update(extra=1),
        lambda d: d["workouts"][0]["slots"][0].update(extra=1),
        lambda d: d["workouts"][0]["slots"][0]["exercise"].update(extra=1),
        lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(extra=1),
    ],
)
def test_unknown_keys_are_refused_at_every_level(change: Change) -> None:
    assert any("unknown key" in issue for issue in issues_of(mutated(change)))


def test_wrong_format_is_refused() -> None:
    assert issues_of(mutated(lambda d: d.update(format="other")))


def test_unsupported_format_version_is_refused() -> None:
    assert issues_of(mutated(lambda d: d.update(format_version=2)))


def test_missing_reps_max_is_refused_rather_than_read_as_open_ended() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].pop("reps_max"))
    assert any("reps_max" in issue for issue in issues_of(raw))


def test_reps_max_below_min_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(reps_max=4))
    assert any("reps_max" in issue for issue in issues_of(raw))


def test_reps_min_below_one_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(reps_min=0))
    assert any("reps_min" in issue for issue in issues_of(raw))


def test_half_specified_rir_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(target_rir_max=None))
    assert any("target_rir" in issue for issue in issues_of(raw))


def test_rir_min_above_max_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(target_rir_min=3))
    assert any("target_rir" in issue for issue in issues_of(raw))


def test_bool_is_not_an_integer() -> None:
    raw = mutated(lambda d: d["program"].update(duration_weeks=True))
    assert any("duration_weeks" in issue for issue in issues_of(raw))


def test_unknown_set_type_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(set_type="amrap"))
    assert any("set_type" in issue for issue in issues_of(raw))


def test_bad_slug_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0].update(key="Upper A"))
    assert any("key" in issue for issue in issues_of(raw))


def test_duplicate_workout_keys_are_refused() -> None:
    raw = mutated(lambda d: d["workouts"][1].update(key="upper_a"))
    assert any("duplicate" in issue for issue in issues_of(raw))


def test_duplicate_slot_keys_are_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][1].update(key="upper_a.01"))
    assert any("duplicate" in issue for issue in issues_of(raw))


def test_empty_lists_are_refused() -> None:
    assert issues_of(mutated(lambda d: d.update(workouts=[])))
    assert issues_of(mutated(lambda d: d["workouts"][0].update(slots=[])))
    assert issues_of(mutated(lambda d: d["workouts"][0]["slots"][0].update(sets=[])))


def test_blank_optional_strings_are_refused() -> None:
    raw = mutated(lambda d: d["program"].update(version_label="  "))
    assert any("version_label" in issue for issue in issues_of(raw))


def test_blank_equipment_label_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["exercise"].update(equipment_label=""))
    assert any("equipment_label" in issue for issue in issues_of(raw))


def test_sub_gram_target_load_is_refused() -> None:
    raw = mutated(lambda d: d["workouts"][0]["slots"][0]["sets"][0].update(target_load_kg="0.0001"))
    assert any("target_load_kg" in issue for issue in issues_of(raw))


def test_every_issue_is_reported_not_just_the_first() -> None:
    def change(d: dict[str, Any]) -> None:
        d["program"]["name"] = ""
        d["workouts"][0]["slots"][0]["sets"][0]["reps_min"] = -1

    assert len(issues_of(mutated(change))) >= 2


def test_notes_artifact_is_decoded_with_the_same_rules() -> None:
    assert any("BOM" in issue for issue in issues_of(encode(valid_document()), b"\xef\xbb\xbfx"))
