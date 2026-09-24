"""Nutrition targets and daily-log validity.

Authoritative source: ``programs/advanced-natural-12w-nutrition/artifact/
locked_nutrition_tracker.json``. Since V3.3 a target is the lifter's protein, carbohydrate
and fat in grams; its calories are derived exactly like a logged day's (P x 4 + C x 4 +
F x 9), so there is no separate calorie target to contradict them. There is no target until
the lifter records one — the source forbids inventing maintenance. The source's locked
protein 145 g and fat 60 g are the defaults offered for a first target; before V3.3 a target
was calories only and carbohydrate was its remainder, ``(kcal - 1120) / 4`` (kept here
because migration 0007 converts those targets with it). Nothing here ever changes a target.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

PROTEIN_G_PER_DAY = 145
FAT_G_PER_DAY = 60
# Atwater general factors: the only way a day's calories are known (V3.1).
KCAL_PER_G_PROTEIN = 4
KCAL_PER_G_CARBOHYDRATE = 4
KCAL_PER_G_FAT = 9
# 145 g x 4 kcal + 60 g x 9 kcal
FIXED_PROTEIN_FAT_KCAL = PROTEIN_G_PER_DAY * KCAL_PER_G_PROTEIN + FAT_G_PER_DAY * KCAL_PER_G_FAT

MAX_CALORIE_TARGET = 10_000
MAX_DAY_MACRO_G = 1_500
MAX_TARGET_MACRO_G = 1_500


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


@dataclass(frozen=True, slots=True)
class MacroTargets:
    """A daily target: grams of each macronutrient. Its calories are derived, never set."""

    protein_g: int
    carbs_g: int
    fat_g: int

    @property
    def calories_kcal(self) -> int:
        return (
            self.protein_g * KCAL_PER_G_PROTEIN
            + self.carbs_g * KCAL_PER_G_CARBOHYDRATE
            + self.fat_g * KCAL_PER_G_FAT
        )


def check_macro_targets(*, protein_g: int, carbs_g: int, fat_g: int) -> MacroTargets:
    """Whole grams, each 0-1500, and a derived energy of 1-10000 kcal."""
    for name, value in (("protein", protein_g), ("carbs", carbs_g), ("fat", fat_g)):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"the {name} target must be whole grams: {value!r}")
        if not 0 <= value <= MAX_TARGET_MACRO_G:
            raise ValueError(f"the {name} target must be 0-{MAX_TARGET_MACRO_G} g: {value}")
    targets = MacroTargets(protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g)
    if not 0 < targets.calories_kcal <= MAX_CALORIE_TARGET:
        raise ValueError(
            f"a target's calories must be 1-{MAX_CALORIE_TARGET} kcal: {targets.calories_kcal}"
        )
    return targets


def check_day_values(
    *,
    protein_g: int | None,
    carbs_g: int | None,
    fat_g: int | None,
) -> None:
    """A logged day holds at least one macro, and every macro is humanly possible."""
    if protein_g is None and carbs_g is None and fat_g is None:
        raise ValueError("a nutrition log needs at least one of protein, carbs, fat")
    for name, value in (("protein", protein_g), ("carbs", carbs_g), ("fat", fat_g)):
        if value is not None and not 0 <= value <= MAX_DAY_MACRO_G:
            raise ValueError(f"{name} must be 0-{MAX_DAY_MACRO_G} g: {value}")


@dataclass(frozen=True, slots=True)
class DayCalories:
    """A day's energy, derived from its macros; never entered on its own."""

    calories_kcal: int
    # True only when protein, carbs and fat were all recorded (0 counts as recorded).
    complete: bool


def day_calories(*, protein_g: int | None, carbs_g: int | None, fat_g: int | None) -> DayCalories:
    """protein x 4 + carbs x 4 + fat x 9, exact integers; an unrecorded macro adds nothing."""
    check_day_values(protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g)
    return DayCalories(
        calories_kcal=(protein_g or 0) * KCAL_PER_G_PROTEIN
        + (carbs_g or 0) * KCAL_PER_G_CARBOHYDRATE
        + (fat_g or 0) * KCAL_PER_G_FAT,
        complete=protein_g is not None and carbs_g is not None and fat_g is not None,
    )
