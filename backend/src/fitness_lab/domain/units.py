"""The canonical kilogram/gram and pound/gram boundaries.

SQLite stores integer grams; the domain, the docs and the capture contract speak
kilograms. Float multiplication plus rounding is not used here: gym plate weights are
binary-exact as IEEE doubles, so a float implementation passes every obvious test and
then fails on upstream arithmetic (0.1 + 0.2 -> 0.30000000000000004), while a round()
would paper over exactly the sub-gram input that should have been refused.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

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


# --- pounds: the unit every workout load is entered and shown in (V3.1) --------------------
#
# Storage stays integer grams, a physical mass, so no recorded set is ever reinterpreted:
# a set saved as 33000 g reads as 72.75 lb. Bodyweight stays kilograms.
#
# The pound is exactly 0.45359237 kg (international yard and pound agreement, 1959), so
# the conversion is exact Decimal arithmetic with one rounding to the whole gram. A pound
# value has at most 2 decimals (0.01 lb); rounding to the gram moves it by at most 0.5 g
# (0.0011 lb), under half of 0.01 lb, so every entered value reads back exactly.

GRAMS_PER_POUND = Decimal("453.59237")
POUND_QUANTUM = Decimal("0.01")


def lb_to_g(value: str | int | Decimal | None) -> int | None:
    """Convert pounds (at most 0.01 lb precision) to integer grams. NULL stays NULL."""
    if value is None:
        return None
    if isinstance(value, bool | float):
        raise TypeError(f"float input forbidden at the lb/g boundary: {value!r}")
    try:
        pounds = Decimal(value)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"not a decimal load: {value!r}") from exc
    if not pounds.is_finite():
        raise ValueError(f"non-finite load: {value!r}")
    if pounds != pounds.quantize(POUND_QUANTUM, rounding=ROUND_HALF_UP):
        raise ValueError(f"loads are entered to 0.01 lb at most: {value!r}")
    if pounds < 0:
        raise ValueError(f"negative load: {value!r}")
    return int((pounds * GRAMS_PER_POUND).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def g_to_lb(grams: int | None) -> Decimal | None:
    """Integer grams as pounds, rounded half-up to 0.01 lb. NULL stays NULL."""
    if grams is None:
        return None
    return (Decimal(grams) / GRAMS_PER_POUND).quantize(POUND_QUANTUM, rounding=ROUND_HALF_UP)


def format_lb(grams: int | None) -> str | None:
    """Render a stored load in pounds: '225', '72.75', '2.5' (no exponent, no padding)."""
    pounds = g_to_lb(grams)
    if pounds is None:
        return None
    text = format(pounds, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text
