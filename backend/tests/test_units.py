"""The kg/gram boundary. Wrong once here is wrong in every stored row thereafter."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, cast

import pytest

from fitness_lab.domain.units import format_kg, g_to_kg, kg_to_g


@pytest.mark.parametrize(
    ("value", "grams"),
    [
        ("0", 0),
        (0, 0),
        ("0.001", 1),
        ("0.5", 500),
        ("1.25", 1250),
        ("32.5", 32500),
        ("102.5", 102500),
        ("220.75", 220750),
        (60, 60000),
        (Decimal("102.5"), 102500),
        (Decimal("0.001"), 1),
    ],
)
def test_kg_to_g_is_exact(value: str | int | Decimal, grams: int) -> None:
    assert kg_to_g(value) == grams


def test_none_maps_to_none_in_both_directions() -> None:
    assert kg_to_g(None) is None
    assert g_to_kg(None) is None


@pytest.mark.parametrize("value", ["0.0005", "0.4999", "1.0001"])
def test_sub_gram_precision_is_rejected_never_rounded(value: str) -> None:
    with pytest.raises(ValueError, match="sub-gram"):
        kg_to_g(value)


def test_negative_load_is_rejected() -> None:
    with pytest.raises(ValueError, match="negative"):
        kg_to_g("-1")


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_input_is_rejected(value: str) -> None:
    with pytest.raises(ValueError, match="non-finite"):
        kg_to_g(value)


def test_non_numeric_text_is_rejected() -> None:
    with pytest.raises(ValueError, match="not a decimal"):
        kg_to_g("heavy")


@pytest.mark.parametrize("value", [102.5, 0.1, 0.0])
def test_float_input_is_refused_outright(value: float) -> None:
    """By the time a float exists, precision may already be lost."""
    with pytest.raises(TypeError, match="float"):
        kg_to_g(cast(Any, value))


def test_bool_is_refused_because_it_is_an_int_subclass() -> None:
    with pytest.raises(TypeError):
        kg_to_g(cast(Any, True))


@pytest.mark.parametrize("value", ["0", "0.5", "1.25", "32.5", "102.5", "220.75"])
def test_round_trips_are_exact(value: str) -> None:
    grams = kg_to_g(value)
    assert grams is not None
    assert g_to_kg(grams) == Decimal(value)


def test_g_to_kg_is_exact_without_division_context() -> None:
    assert g_to_kg(102500) == Decimal("102.5")
    assert g_to_kg(1) == Decimal("0.001")
    assert g_to_kg(0) == Decimal("0")


@pytest.mark.parametrize(
    ("grams", "rendered"),
    [
        (100000, "100"),
        (60000, "60"),
        (102500, "102.5"),
        (500, "0.5"),
        (220750, "220.75"),
        (0, "0"),
        (1, "0.001"),
    ],
)
def test_display_never_uses_scientific_notation(grams: int, rendered: str) -> None:
    """normalize() alone renders 100 kg as 1E+2; the "f" format suppresses that."""
    assert format_kg(g_to_kg(grams)) == rendered
    assert "E" not in (format_kg(g_to_kg(grams)) or "")


def test_format_kg_passes_none_through() -> None:
    assert format_kg(None) is None


def test_json_parsed_with_decimal_converts_exactly() -> None:
    document = json.loads('{"load_kg": 102.5}', parse_float=Decimal)
    assert document["load_kg"] == Decimal("102.5")
    assert kg_to_g(document["load_kg"]) == 102500


def test_json_sub_gram_input_is_refused() -> None:
    document = json.loads('{"load_kg": 0.0005}', parse_float=Decimal)
    with pytest.raises(ValueError, match="sub-gram"):
        kg_to_g(document["load_kg"])
