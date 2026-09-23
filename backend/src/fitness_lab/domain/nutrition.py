"""Nutrition targets and daily-log validity.

Authoritative source: ``programs/advanced-natural-12w-nutrition/artifact/
locked_nutrition_tracker.json``. Protein and fat are locked. The calorie target is
unknown until the lifter explicitly sets one — the source forbids inventing maintenance —
and carbohydrate is the remainder of that target. Nothing here ever changes calories.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

PROTEIN_G_PER_DAY = 145
FAT_G_PER_DAY = 60
# 145 g x 4 kcal + 60 g x 9 kcal
FIXED_PROTEIN_FAT_KCAL = 1120
KCAL_PER_G_CARBOHYDRATE = 4

MAX_CALORIE_TARGET = 10_000
MAX_DAY_KCAL = 15_000
MAX_DAY_MACRO_G = 1_500


@dataclass(frozen=True, slots=True)
class NutritionTargets:
    protein_g: int
    fat_g: int
    calories_kcal: int | None
    carbs_g: int | None


def check_calorie_target(calories_kcal: int) -> int:
    if not FIXED_PROTEIN_FAT_KCAL <= calories_kcal <= MAX_CALORIE_TARGET:
        raise ValueError(
            f"a calorie target must be {FIXED_PROTEIN_FAT_KCAL}-{MAX_CALORIE_TARGET} kcal "
            f"(protein {PROTEIN_G_PER_DAY} g and fat {FAT_G_PER_DAY} g alone are "
            f"{FIXED_PROTEIN_FAT_KCAL} kcal): {calories_kcal}"
        )
    return calories_kcal


def carbohydrate_target_g(calories_kcal: int) -> int:
    """(calories - 1120) / 4, rounded half-up to whole grams (2650 -> 383)."""
    check_calorie_target(calories_kcal)
    remainder = Decimal(calories_kcal - FIXED_PROTEIN_FAT_KCAL) / KCAL_PER_G_CARBOHYDRATE
    return int(remainder.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def targets_for(calories_kcal: int | None) -> NutritionTargets:
    return NutritionTargets(
        protein_g=PROTEIN_G_PER_DAY,
        fat_g=FAT_G_PER_DAY,
        calories_kcal=calories_kcal,
        carbs_g=None if calories_kcal is None else carbohydrate_target_g(calories_kcal),
    )


def check_day_values(
    *,
    calories_kcal: int | None,
    protein_g: int | None,
    carbs_g: int | None,
    fat_g: int | None,
) -> None:
    """A logged day holds at least one number, and every number is humanly possible."""
    if calories_kcal is None and protein_g is None and carbs_g is None and fat_g is None:
        raise ValueError("a nutrition log needs at least one of calories, protein, carbs, fat")
    if calories_kcal is not None and not 0 <= calories_kcal <= MAX_DAY_KCAL:
        raise ValueError(f"calories must be 0-{MAX_DAY_KCAL} kcal: {calories_kcal}")
    for name, value in (("protein", protein_g), ("carbs", carbs_g), ("fat", fat_g)):
        if value is not None and not 0 <= value <= MAX_DAY_MACRO_G:
            raise ValueError(f"{name} must be 0-{MAX_DAY_MACRO_G} g: {value}")
