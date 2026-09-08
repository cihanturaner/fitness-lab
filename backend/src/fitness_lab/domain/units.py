"""The canonical kilogram/gram boundary.

SQLite stores integer grams; the domain, the docs and the capture contract speak
kilograms. Float multiplication plus rounding is not used here: gym plate weights are
binary-exact as IEEE doubles, so a float implementation passes every obvious test and
then fails on upstream arithmetic (0.1 + 0.2 -> 0.30000000000000004), while a round()
would paper over exactly the sub-gram input that should have been refused.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

GRAMS_PER_KILOGRAM_EXPONENT = 3


def kg_to_g(value: str | int | Decimal | None) -> int | None:
    """Convert kilograms to integer grams, exactly. NULL stays NULL."""
    if value is None:
        return None
    if isinstance(value, bool | float):
        raise TypeError(f"float input forbidden at the kg/g boundary: {value!r}")
    try:
        kilograms = Decimal(value)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"not a decimal load: {value!r}") from exc
    if not kilograms.is_finite():
        raise ValueError(f"non-finite load: {value!r}")
    grams = kilograms.scaleb(GRAMS_PER_KILOGRAM_EXPONENT)
    if grams != grams.to_integral_value():
        raise ValueError(f"sub-gram precision is not representable: {value!r}")
    if grams < 0:
        raise ValueError(f"negative load: {value!r}")
    return int(grams)


def g_to_kg(grams: int | None) -> Decimal | None:
    """Convert integer grams to kilograms, exactly. NULL stays NULL."""
    return None if grams is None else Decimal(grams).scaleb(-GRAMS_PER_KILOGRAM_EXPONENT)


def format_kg(value: Decimal | None) -> str | None:
    """Render kilograms for display without scientific notation."""
    return None if value is None else format(value.normalize(), "f")
