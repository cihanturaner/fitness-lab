"""The emergency capture contract's validator. Pure: no database, no network, no AI."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from fitness_lab.domain.capture import (
    CatalogEntry,
    parse_capture_json,
    validate_capture,
)

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[2] / "docs" / "contracts" / "raw-capture-v1.example.json"
)

CATALOG = (
    CatalogEntry(id="e1", name="Incline Chest Press", equipment_label="Hammer Strength"),
    CatalogEntry(id="e2", name="Incline Chest Press", equipment_label="Technogym Pure Strength"),
    CatalogEntry(id="e3", name="Incline dumbbell press", equipment_label=None),
)


def example() -> dict[str, Any]:
    document = parse_capture_json(EXAMPLE_PATH.read_text(encoding="utf-8"))
    assert isinstance(document, dict)
    return deepcopy(document)


def test_the_documented_example_validates() -> None:
    report = validate_capture(example())

    assert report.ok is True
    assert report.errors == ()
    assert report.workout_count == 1
    assert report.set_count == 4


def test_the_documented_example_resolves_against_a_catalog() -> None:
    report = validate_capture(example(), catalog=CATALOG)

    assert report.ok is True


def test_loads_are_parsed_as_decimal_not_float() -> None:
    from decimal import Decimal

    document = example()
    assert document["workouts"][0]["sets"][3]["load_kg"] == Decimal("32.5")
    assert not isinstance(document["workouts"][0]["sets"][3]["load_kg"], float)


def test_an_unknown_schema_version_is_a_hard_refusal() -> None:
    document = example()
    document["schema_version"] = 2

    report = validate_capture(document)

    assert report.ok is False
    assert any("schema_version" in issue.path for issue in report.errors)


def test_a_missing_schema_version_is_refused() -> None:
    document = example()
    del document["schema_version"]

    assert validate_capture(document).ok is False


def test_units_other_than_kg_are_refused_never_converted() -> None:
    document = example()
    document["units"] = "lb"

    report = validate_capture(document)

    assert report.ok is False
    assert any("kg" in issue.message for issue in report.errors)


@pytest.mark.parametrize(
    "performed_on", ["2026-13-01", "2026-02-31", "2026-10-1", "1 Oct 2026", ""]
)
def test_malformed_dates_are_refused(performed_on: str) -> None:
    document = example()
    document["workouts"][0]["performed_on"] = performed_on

    assert validate_capture(document).ok is False


@pytest.mark.parametrize("performed_time_local", ["25:00", "7:45", "19:45:30"])
def test_malformed_times_are_refused(performed_time_local: str) -> None:
    document = example()
    document["workouts"][0]["performed_time_local"] = performed_time_local

    assert validate_capture(document).ok is False


def test_an_absent_time_is_accepted() -> None:
    document = example()
    del document["workouts"][0]["performed_time_local"]

    assert validate_capture(document).ok is True


def test_a_negative_load_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["load_kg"] = -1

    report = validate_capture(document)

    assert report.ok is False
    assert any("negative" in issue.message for issue in report.errors)


def test_sub_gram_precision_is_refused() -> None:
    document = parse_capture_json(
        json.dumps(
            {
                "schema_version": 1,
                "units": "kg",
                "workouts": [
                    {
                        "performed_on": "2026-10-01",
                        "sets": [
                            {"exercise": "Incline dumbbell press", "load_kg": 0.0005, "reps": 5}
                        ],
                    }
                ],
            }
        )
    )

    report = validate_capture(document)

    assert report.ok is False
    assert any("sub-gram" in issue.message for issue in report.errors)


def test_a_negative_rep_count_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["reps"] = -1

    assert validate_capture(document).ok is False


def test_missing_reps_is_reported_not_rejected() -> None:
    """Three unremembered rep counts should import and surface the gaps, not fail wholesale."""
    document = example()
    del document["workouts"][0]["sets"][0]["reps"]

    report = validate_capture(document)

    assert report.ok is True
    assert any("reps" in issue.path for issue in report.warnings)


def test_missing_set_type_is_reported_not_rejected() -> None:
    document = example()
    del document["workouts"][0]["sets"][0]["set_type"]

    report = validate_capture(document)

    assert report.ok is True
    assert any("set_type" in issue.path for issue in report.warnings)


def test_an_unknown_set_type_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["set_type"] = "amrap"

    report = validate_capture(document)

    assert report.ok is False
    assert any("set_type" in issue.path for issue in report.errors)


def test_an_absent_rir_is_distinguishable_from_zero() -> None:
    without = example()
    del without["workouts"][0]["sets"][1]["rir"]
    with_zero = example()
    with_zero["workouts"][0]["sets"][1]["rir"] = 0

    absent_report = validate_capture(without)
    zero_report = validate_capture(with_zero)

    assert absent_report.ok is True
    assert zero_report.ok is True
    absent_paths = {issue.path for issue in absent_report.warnings}
    zero_paths = {issue.path for issue in zero_report.warnings}
    assert "$.workouts[0].sets[1].rir" in absent_paths
    assert "$.workouts[0].sets[1].rir" not in zero_paths


def test_a_negative_rir_is_accepted() -> None:
    document = example()
    document["workouts"][0]["sets"][1]["rir"] = -1

    assert validate_capture(document).ok is True


def test_a_non_integer_rir_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][1]["rir"] = "two"

    assert validate_capture(document).ok is False


def test_array_order_is_the_default_set_order() -> None:
    document = example()
    for entry in document["workouts"][0]["sets"]:
        assert "set_order" not in entry

    assert validate_capture(document).ok is True


def test_an_explicit_set_order_override_is_accepted() -> None:
    document = example()
    for position, entry in enumerate(reversed(document["workouts"][0]["sets"]), start=1):
        entry["set_order"] = position

    assert validate_capture(document).ok is True


def test_duplicate_set_orders_are_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["set_order"] = 2
    document["workouts"][0]["sets"][1]["set_order"] = 2

    report = validate_capture(document)

    assert report.ok is False
    assert any("set_order" in issue.path for issue in report.errors)


def test_an_ambiguous_name_only_reference_is_refused_with_candidates() -> None:
    document = example()
    for entry in document["workouts"][0]["sets"][:3]:
        del entry["equipment_label"]

    report = validate_capture(document, catalog=CATALOG)

    assert report.ok is False
    message = " ".join(issue.message for issue in report.errors)
    assert "e1" in message and "e2" in message


def test_an_unambiguous_name_only_reference_resolves() -> None:
    document = example()

    report = validate_capture(document, catalog=CATALOG)

    assert report.ok is True


def test_an_unknown_exercise_name_is_refused_against_a_catalog() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["exercise"] = "Nordic ham curl"
    document["workouts"][0]["sets"][0]["equipment_label"] = "Bench"

    assert validate_capture(document, catalog=CATALOG).ok is False


def test_an_explicit_id_reference_resolves() -> None:
    document = example()
    document["workouts"][0]["sets"][0] = {
        "exercise": {"id": "e1"},
        "set_type": "warmup",
        "load_kg": 40,
        "reps": 10,
    }

    assert validate_capture(document, catalog=CATALOG).ok is True


def test_an_unknown_explicit_id_is_refused() -> None:
    document = example()
    document["workouts"][0]["sets"][0] = {"exercise": {"id": "missing"}, "reps": 10}

    assert validate_capture(document, catalog=CATALOG).ok is False


def test_equipment_aware_references_keep_two_machines_apart() -> None:
    document = example()
    document["workouts"][0]["sets"][0]["equipment_label"] = "Technogym Pure Strength"

    report = validate_capture(document, catalog=CATALOG)

    assert report.ok is True


def test_a_set_without_an_exercise_reference_is_refused() -> None:
    document = example()
    del document["workouts"][0]["sets"][0]["exercise"]

    assert validate_capture(document).ok is False


def test_a_document_that_is_not_an_object_is_refused() -> None:
    assert validate_capture([]).ok is False


def test_an_empty_workouts_array_is_refused() -> None:
    document = example()
    document["workouts"] = []

    assert validate_capture(document).ok is False
