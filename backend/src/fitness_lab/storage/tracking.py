"""Daily bodyweight, daily nutrition and calorie-target decisions.

Logging only. Each daily log keeps one row per date: saving again replaces the values
(a correction) but keeps the first entry time. Macro targets are the exception — every
decision is a new append-only, effective-dated row, so the history of targets (and how any
earlier day is judged) can never be rewritten.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from fitness_lab.domain.models import new_id, utc_now_iso
from fitness_lab.domain.nutrition import MacroTargets, check_day_values, check_macro_targets
from fitness_lab.storage import db
from fitness_lab.storage.entry import NotFound


@dataclass(frozen=True, slots=True)
class BodyweightRow:
    measured_on: str
    grams: int
    notes: str | None
    entered_at_utc: str
    updated_at_utc: str


@dataclass(frozen=True, slots=True)
class NutritionDayRow:
    """One day's macros as entered. Its calories are derived (domain.nutrition.day_calories)."""

    logged_on: str
    protein_g: int | None
    carbs_g: int | None
    fat_g: int | None
    notes: str | None
    entered_at_utc: str
    updated_at_utc: str


@dataclass(frozen=True, slots=True)
class MacroTargetRow:
    id: str
    effective_on: str
    macros: MacroTargets
    notes: str | None
    set_at_utc: str
    # Pre-V3.3 targets were calories only; this is the number the lifter recorded then.
    legacy_calories_kcal: int | None


def _opt_int(value: object) -> int | None:
    return None if value is None else int(str(value))


def _opt_str(value: object) -> str | None:
    return None if value is None else str(value)


def _clean_notes(notes: str | None) -> str | None:
    return None if notes is None or notes.strip() == "" else notes


def _range(column: str, first: str | None, last: str | None) -> tuple[str, list[str]]:
    clauses: list[str] = []
    params: list[str] = []
    if first is not None:
        clauses.append(f"{column} >= ?")
        params.append(first)
    if last is not None:
        clauses.append(f"{column} <= ?")
        params.append(last)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), params


# --- bodyweight ------------------------------------------------------------------------

BODYWEIGHT_COLUMNS = "measured_on, bodyweight_g, notes, entered_at_utc, updated_at_utc"


def _bodyweight(row: sqlite3.Row) -> BodyweightRow:
    return BodyweightRow(
        measured_on=str(row["measured_on"]),
        grams=int(row["bodyweight_g"]),
        notes=_opt_str(row["notes"]),
        entered_at_utc=str(row["entered_at_utc"]),
        updated_at_utc=str(row["updated_at_utc"]),
    )


def put_bodyweight(
    connection: sqlite3.Connection,
    measured_on: str,
    grams: int,
    notes: str | None,
    *,
    now: str | None = None,
) -> BodyweightRow:
    """Record (or correct) the bodyweight of one date."""
    stamp = now if now is not None else utc_now_iso()
    with db.immediate_transaction(connection):
        try:
            connection.execute(
                f"INSERT INTO bodyweight_entry ({BODYWEIGHT_COLUMNS}) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT (measured_on) DO UPDATE SET bodyweight_g = excluded.bodyweight_g, "
                "notes = excluded.notes, updated_at_utc = excluded.updated_at_utc",
                (measured_on, grams, _clean_notes(notes), stamp, stamp),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"invalid bodyweight entry: {exc}") from exc
        row = connection.execute(
            f"SELECT {BODYWEIGHT_COLUMNS} FROM bodyweight_entry WHERE measured_on = ?",
            (measured_on,),
        ).fetchone()
    return _bodyweight(row)


def list_bodyweight(
    connection: sqlite3.Connection, *, first: str | None = None, last: str | None = None
) -> tuple[BodyweightRow, ...]:
    where, params = _range("measured_on", first, last)
    rows = connection.execute(
        f"SELECT {BODYWEIGHT_COLUMNS} FROM bodyweight_entry{where} ORDER BY measured_on", params
    ).fetchall()
    return tuple(_bodyweight(row) for row in rows)


def delete_bodyweight(connection: sqlite3.Connection, measured_on: str) -> None:
    deleted = connection.execute(
        "DELETE FROM bodyweight_entry WHERE measured_on = ?", (measured_on,)
    ).rowcount
    if deleted != 1:
        raise NotFound(f"no bodyweight recorded on {measured_on}")


# --- nutrition -------------------------------------------------------------------------

NUTRITION_COLUMNS = "logged_on, protein_g, carbs_g, fat_g, notes, entered_at_utc, updated_at_utc"


def _nutrition(row: sqlite3.Row) -> NutritionDayRow:
    return NutritionDayRow(
        logged_on=str(row["logged_on"]),
        protein_g=_opt_int(row["protein_g"]),
        carbs_g=_opt_int(row["carbs_g"]),
        fat_g=_opt_int(row["fat_g"]),
        notes=_opt_str(row["notes"]),
        entered_at_utc=str(row["entered_at_utc"]),
        updated_at_utc=str(row["updated_at_utc"]),
    )


def put_nutrition_day(
    connection: sqlite3.Connection,
    logged_on: str,
    *,
    protein_g: int | None,
    carbs_g: int | None,
    fat_g: int | None,
    notes: str | None,
    now: str | None = None,
) -> NutritionDayRow:
    """Record (or correct) one day's macros. Omitted macros are stored as unknown."""
    check_day_values(protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g)
    stamp = now if now is not None else utc_now_iso()
    with db.immediate_transaction(connection):
        try:
            connection.execute(
                f"INSERT INTO nutrition_day ({NUTRITION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (logged_on) DO UPDATE SET protein_g = excluded.protein_g, "
                "carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, notes = excluded.notes, "
                "updated_at_utc = excluded.updated_at_utc",
                (
                    logged_on,
                    protein_g,
                    carbs_g,
                    fat_g,
                    _clean_notes(notes),
                    stamp,
                    stamp,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"invalid nutrition log: {exc}") from exc
        row = connection.execute(
            f"SELECT {NUTRITION_COLUMNS} FROM nutrition_day WHERE logged_on = ?", (logged_on,)
        ).fetchone()
    return _nutrition(row)


def get_nutrition_day(connection: sqlite3.Connection, logged_on: str) -> NutritionDayRow | None:
    row = connection.execute(
        f"SELECT {NUTRITION_COLUMNS} FROM nutrition_day WHERE logged_on = ?", (logged_on,)
    ).fetchone()
    return None if row is None else _nutrition(row)


def list_nutrition_days(
    connection: sqlite3.Connection, *, first: str | None = None, last: str | None = None
) -> tuple[NutritionDayRow, ...]:
    where, params = _range("logged_on", first, last)
    rows = connection.execute(
        f"SELECT {NUTRITION_COLUMNS} FROM nutrition_day{where} ORDER BY logged_on", params
    ).fetchall()
    return tuple(_nutrition(row) for row in rows)


def delete_nutrition_day(connection: sqlite3.Connection, logged_on: str) -> None:
    deleted = connection.execute(
        "DELETE FROM nutrition_day WHERE logged_on = ?", (logged_on,)
    ).rowcount
    if deleted != 1:
        raise NotFound(f"no nutrition logged on {logged_on}")


# --- macro target --------------------------------------------------------------------

TARGET_COLUMNS = (
    "id, effective_on, protein_g, carbs_g, fat_g, notes, set_at_utc, from_calorie_target_id"
)


def _target(row: sqlite3.Row) -> MacroTargetRow:
    return MacroTargetRow(
        id=str(row["id"]),
        effective_on=str(row["effective_on"]),
        macros=MacroTargets(
            protein_g=int(row["protein_g"]),
            carbs_g=int(row["carbs_g"]),
            fat_g=int(row["fat_g"]),
        ),
        notes=_opt_str(row["notes"]),
        set_at_utc=str(row["set_at_utc"]),
        legacy_calories_kcal=_opt_int(row["legacy_kcal"]),
    )


TARGET_SELECT = (
    f"SELECT {', '.join('m.' + c.strip() for c in TARGET_COLUMNS.split(','))}, "
    "c.calories_kcal AS legacy_kcal FROM macro_target m "
    "LEFT JOIN calorie_target c ON c.id = m.from_calorie_target_id"
)


def add_macro_target(
    connection: sqlite3.Connection,
    effective_on: str,
    *,
    protein_g: int,
    carbs_g: int,
    fat_g: int,
    notes: str | None,
    now: str | None = None,
) -> MacroTargetRow:
    """Append one explicit target decision by the lifter. The app never calls this itself.

    A target is effective from its date on: earlier days keep the target in force then.
    """
    macros = check_macro_targets(protein_g=protein_g, carbs_g=carbs_g, fat_g=fat_g)
    target = MacroTargetRow(
        id=new_id(),
        effective_on=effective_on,
        macros=macros,
        notes=_clean_notes(notes),
        set_at_utc=now if now is not None else utc_now_iso(),
        legacy_calories_kcal=None,
    )
    try:
        connection.execute(
            "INSERT INTO macro_target (id, effective_on, protein_g, carbs_g, fat_g, notes, "
            "set_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                target.id,
                target.effective_on,
                macros.protein_g,
                macros.carbs_g,
                macros.fat_g,
                target.notes,
                target.set_at_utc,
            ),
        )
    except sqlite3.IntegrityError as exc:
        raise ValueError(f"invalid macro target: {exc}") from exc
    return target


def macro_target_on(connection: sqlite3.Connection, day: str) -> MacroTargetRow | None:
    """The target in force on ``day``: the latest effective on or before it."""
    row = connection.execute(
        f"{TARGET_SELECT} WHERE m.effective_on <= ? "
        "ORDER BY m.effective_on DESC, m.set_at_utc DESC, m.rowid DESC LIMIT 1",
        (day,),
    ).fetchone()
    return None if row is None else _target(row)


def list_macro_targets(connection: sqlite3.Connection) -> tuple[MacroTargetRow, ...]:
    """Every recorded target, newest effective date first."""
    rows = connection.execute(
        f"{TARGET_SELECT} ORDER BY m.effective_on DESC, m.set_at_utc DESC, m.rowid DESC"
    ).fetchall()
    return tuple(_target(row) for row in rows)
