"""The lifter's decisions on nutrition-controller reviews, and diagnostic-gate audits.

Append-only records (migration 0005). What a review recommends is computed by
``domain.nutrition_controller``; this module only stores what the lifter chose. Applying a
recommendation appends the new ``macro_target`` and the decision in one transaction, so
there is never a target change without its reason, nor a recorded "applied" without a target.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass

from fitness_lab.domain.models import new_id, utc_now_iso
from fitness_lab.domain.nutrition import MacroTargets
from fitness_lab.domain.nutrition_controller import GATE_CHECKS
from fitness_lab.storage import db, tracking
from fitness_lab.storage.entry import Conflict


@dataclass(frozen=True, slots=True)
class DecisionRow:
    id: str
    program_version_id: str
    block_week: int
    decided_on: str
    window_first: str
    window_last: str
    weigh_ins: int
    trend_pct: str
    status: str
    recommended_action: str
    recommended_delta_kcal: int | None
    previous_calorie_target_kcal: int
    user_choice: str
    new_target_id: str | None
    new_target: MacroTargets | None
    composition_concern: bool
    notes: str | None
    recorded_at_utc: str


@dataclass(frozen=True, slots=True)
class GateRow:
    id: str
    program_version_id: str
    block_week: int
    decided_on: str
    checks: dict[str, bool]
    result: str
    notes: str | None
    recorded_at_utc: str


def _opt_int(value: object) -> int | None:
    return None if value is None else int(str(value))


def _opt_str(value: object) -> str | None:
    return None if value is None else str(value)


DECISION_SELECT = (
    "SELECT e.id, e.program_version_id, e.block_week, e.decided_on, e.window_first, "
    "e.window_last, e.weigh_ins, e.trend_pct_bw_per_week, e.status, e.recommended_action, "
    "e.recommended_delta_kcal, e.previous_calorie_target_kcal, e.user_choice, "
    "e.new_macro_target_id, t.protein_g AS new_protein_g, t.carbs_g AS new_carbs_g, "
    "t.fat_g AS new_fat_g, e.composition_concern, e.notes, "
    "e.recorded_at_utc FROM controller_event e "
    "LEFT JOIN macro_target t ON t.id = e.new_macro_target_id"
)


def _decision(row: sqlite3.Row) -> DecisionRow:
    return DecisionRow(
        id=str(row["id"]),
        program_version_id=str(row["program_version_id"]),
        block_week=int(row["block_week"]),
        decided_on=str(row["decided_on"]),
        window_first=str(row["window_first"]),
        window_last=str(row["window_last"]),
        weigh_ins=int(row["weigh_ins"]),
        trend_pct=str(row["trend_pct_bw_per_week"]),
        status=str(row["status"]),
        recommended_action=str(row["recommended_action"]),
        recommended_delta_kcal=_opt_int(row["recommended_delta_kcal"]),
        previous_calorie_target_kcal=int(row["previous_calorie_target_kcal"]),
        user_choice=str(row["user_choice"]),
        new_target_id=_opt_str(row["new_macro_target_id"]),
        new_target=None
        if row["new_macro_target_id"] is None
        else MacroTargets(
            protein_g=int(row["new_protein_g"]),
            carbs_g=int(row["new_carbs_g"]),
            fat_g=int(row["new_fat_g"]),
        ),
        composition_concern=bool(row["composition_concern"]),
        notes=_opt_str(row["notes"]),
        recorded_at_utc=str(row["recorded_at_utc"]),
    )


def record_decision(
    connection: sqlite3.Connection,
    *,
    program_version_id: str,
    block_week: int,
    decided_on: str,
    window_first: str,
    window_last: str,
    weigh_ins: int,
    trend_pct: str,
    status: str,
    recommended_action: str,
    recommended_delta_kcal: int | None,
    previous_calorie_target_kcal: int,
    user_choice: str,
    new_target: MacroTargets | None,
    composition_concern: bool,
    notes: str | None,
    now: str | None = None,
) -> DecisionRow:
    """Record the lifter's choice on one review; APPLIED also appends the new target."""
    if user_choice == "APPLIED" and new_target is None:
        raise ValueError("an applied recommendation needs its new target")
    if user_choice == "KEPT" and new_target is not None:
        raise ValueError("a kept target records no new target")
    stamp = now if now is not None else utc_now_iso()
    clean_notes = None if notes is None or notes.strip() == "" else notes
    decision_id = new_id()
    with db.immediate_transaction(connection):
        if connection.execute(
            "SELECT 1 FROM controller_event WHERE program_version_id = ? AND block_week = ?",
            (program_version_id, block_week),
        ).fetchone():
            raise Conflict(f"the week {block_week} review was already decided")
        target_id = None
        if new_target is not None:
            delta = new_target.calories_kcal - previous_calorie_target_kcal
            target = tracking.add_macro_target(
                connection,
                decided_on,
                protein_g=new_target.protein_g,
                carbs_g=new_target.carbs_g,
                fat_g=new_target.fat_g,
                notes=f"Week {block_week} review: {status}, {delta:+d} kcal/day applied",
                now=stamp,
            )
            target_id = target.id
        try:
            connection.execute(
                "INSERT INTO controller_event (id, program_version_id, block_week, decided_on, "
                "window_first, window_last, weigh_ins, trend_pct_bw_per_week, status, "
                "recommended_action, recommended_delta_kcal, previous_calorie_target_kcal, "
                "user_choice, new_macro_target_id, composition_concern, notes, "
                "recorded_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    decision_id,
                    program_version_id,
                    block_week,
                    decided_on,
                    window_first,
                    window_last,
                    weigh_ins,
                    trend_pct,
                    status,
                    recommended_action,
                    recommended_delta_kcal,
                    previous_calorie_target_kcal,
                    user_choice,
                    target_id,
                    int(composition_concern),
                    clean_notes,
                    stamp,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"invalid review decision: {exc}") from exc
        row = connection.execute(f"{DECISION_SELECT} WHERE e.id = ?", (decision_id,)).fetchone()
    return _decision(row)


def list_decisions(
    connection: sqlite3.Connection, program_version_id: str
) -> tuple[DecisionRow, ...]:
    rows = connection.execute(
        f"{DECISION_SELECT} WHERE e.program_version_id = ? ORDER BY e.block_week",
        (program_version_id,),
    ).fetchall()
    return tuple(_decision(row) for row in rows)


GATE_COLUMNS = ", ".join(GATE_CHECKS)


def _gate(row: sqlite3.Row) -> GateRow:
    return GateRow(
        id=str(row["id"]),
        program_version_id=str(row["program_version_id"]),
        block_week=int(row["block_week"]),
        decided_on=str(row["decided_on"]),
        checks={name: bool(row[name]) for name in GATE_CHECKS},
        result=str(row["result"]),
        notes=_opt_str(row["notes"]),
        recorded_at_utc=str(row["recorded_at_utc"]),
    )


def record_gate(
    connection: sqlite3.Connection,
    *,
    program_version_id: str,
    block_week: int,
    decided_on: str,
    checks: Mapping[str, bool],
    result: str,
    notes: str | None,
    now: str | None = None,
) -> GateRow:
    """Record one diagnostic-gate audit with every one of the nine answers."""
    if set(checks) != set(GATE_CHECKS):
        raise ValueError("a diagnostic-gate audit answers all nine checks")
    gate_id = new_id()
    stamp = now if now is not None else utc_now_iso()
    clean_notes = None if notes is None or notes.strip() == "" else notes
    placeholders = ", ".join("?" for _ in range(len(GATE_CHECKS) + 7))
    with db.immediate_transaction(connection):
        try:
            connection.execute(
                "INSERT INTO diagnostic_gate_event (id, program_version_id, block_week, "
                f"decided_on, {GATE_COLUMNS}, result, notes, recorded_at_utc) "
                f"VALUES ({placeholders})",
                (
                    gate_id,
                    program_version_id,
                    block_week,
                    decided_on,
                    *(int(bool(checks[name])) for name in GATE_CHECKS),
                    result,
                    clean_notes,
                    stamp,
                ),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError(f"invalid diagnostic-gate audit: {exc}") from exc
        row = connection.execute(
            "SELECT * FROM diagnostic_gate_event WHERE id = ?", (gate_id,)
        ).fetchone()
    return _gate(row)


def list_gates(connection: sqlite3.Connection, program_version_id: str) -> tuple[GateRow, ...]:
    """Audits of one program version in the order they were recorded."""
    rows = connection.execute(
        "SELECT * FROM diagnostic_gate_event WHERE program_version_id = ? "
        "ORDER BY recorded_at_utc, rowid",
        (program_version_id,),
    ).fetchall()
    return tuple(_gate(row) for row in rows)
