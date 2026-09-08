"""Validator for the emergency raw-capture contract (docs/contracts/raw-capture-v1.md).

Deadline insurance, not a product feature. M1 ships this validator and the contract; the
importer is written later, against a schema that exists. Errors block; warnings report
gaps that import as NULL and are caught later by completion rules C2 and C4.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, time
from decimal import Decimal
from typing import TypeGuard

from fitness_lab.domain.models import SetTypeCode, normalize_identity
from fitness_lab.domain.units import kg_to_g

CAPTURE_SCHEMA_VERSION = 1
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")
KNOWN_SET_TYPES = tuple(code.value for code in SetTypeCode)


@dataclass(frozen=True, slots=True)
class CaptureIssue:
    path: str
    message: str


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    id: str
    name: str
    equipment_label: str | None


@dataclass(frozen=True, slots=True)
class CaptureReport:
    ok: bool
    errors: tuple[CaptureIssue, ...]
    warnings: tuple[CaptureIssue, ...]
    workout_count: int
    set_count: int


def parse_capture_json(text: str) -> object:
    """Parse a capture file. parse_float=Decimal keeps loads out of binary floating point."""
    return json.loads(text, parse_float=Decimal)


def _is_int(value: object) -> TypeGuard[int]:
    """bool is an int subclass and is never an acceptable count."""
    return isinstance(value, int) and not isinstance(value, bool)


def _check_date(value: object, path: str, errors: list[CaptureIssue]) -> None:
    if not isinstance(value, str) or not DATE_PATTERN.match(value):
        errors.append(CaptureIssue(path, f"performed_on must be YYYY-MM-DD: {value!r}"))
        return
    try:
        date.fromisoformat(value)
    except ValueError:
        errors.append(CaptureIssue(path, f"not a real calendar date: {value!r}"))


def _check_time(value: object, path: str, errors: list[CaptureIssue]) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not TIME_PATTERN.match(value):
        errors.append(CaptureIssue(path, f"performed_time_local must be HH:MM: {value!r}"))
        return
    try:
        time.fromisoformat(value)
    except ValueError:
        errors.append(CaptureIssue(path, f"not a real wall-clock time: {value!r}"))


def _check_exercise_reference(
    entry: dict[str, object],
    path: str,
    catalog: Sequence[CatalogEntry] | None,
    errors: list[CaptureIssue],
) -> None:
    reference = entry.get("exercise")

    if isinstance(reference, dict):
        identifier = reference.get("id")
        if not isinstance(identifier, str) or not identifier.strip():
            errors.append(
                CaptureIssue(f"{path}.exercise", "an object reference must carry a non-blank id")
            )
            return
        if catalog is not None and all(item.id != identifier for item in catalog):
            errors.append(CaptureIssue(f"{path}.exercise", f"no exercise with id {identifier!r}"))
        return

    if not isinstance(reference, str) or not reference.strip():
        errors.append(
            CaptureIssue(
                f"{path}.exercise", "exercise must be a non-blank name or an object with an id"
            )
        )
        return

    label = entry.get("equipment_label")
    if label is not None and (not isinstance(label, str) or not label.strip()):
        errors.append(
            CaptureIssue(
                f"{path}.equipment_label", f"equipment_label must be absent or non-blank: {label!r}"
            )
        )
        return

    if catalog is None:
        return

    if label is not None:
        wanted = normalize_identity(reference, label)
        if all(normalize_identity(item.name, item.equipment_label) != wanted for item in catalog):
            errors.append(
                CaptureIssue(f"{path}.exercise", f"no exercise {reference!r} on {label!r}")
            )
        return

    wanted_name = normalize_identity(reference, None)[0]
    candidates = [
        item
        for item in catalog
        if normalize_identity(item.name, item.equipment_label)[0] == wanted_name
    ]
    if not candidates:
        errors.append(CaptureIssue(f"{path}.exercise", f"no exercise named {reference!r}"))
    elif len(candidates) > 1:
        listed = ", ".join(f"{item.id} ({item.equipment_label})" for item in candidates)
        errors.append(
            CaptureIssue(
                f"{path}.exercise",
                f"{reference!r} is ambiguous and is never guessed; candidates: {listed}",
            )
        )


def _check_set(
    entry: dict[str, object],
    path: str,
    index: int,
    seen_orders: set[int],
    catalog: Sequence[CatalogEntry] | None,
    errors: list[CaptureIssue],
    warnings: list[CaptureIssue],
) -> None:
    order = entry.get("set_order", index + 1)
    if not _is_int(order) or order < 1:
        errors.append(
            CaptureIssue(f"{path}.set_order", f"set_order must be an integer >= 1: {order!r}")
        )
    elif order in seen_orders:
        errors.append(CaptureIssue(f"{path}.set_order", f"duplicate set_order {order!r}"))
    else:
        seen_orders.add(order)

    _check_exercise_reference(entry, path, catalog, errors)

    if "load_kg" in entry:
        load = entry["load_kg"]
        if isinstance(load, str | int | Decimal) or load is None:
            try:
                kg_to_g(load)
            except (TypeError, ValueError) as exc:
                errors.append(CaptureIssue(f"{path}.load_kg", str(exc)))
        else:
            errors.append(CaptureIssue(f"{path}.load_kg", f"not a decimal load: {load!r}"))
    else:
        warnings.append(CaptureIssue(f"{path}.load_kg", "no load recorded; imports as NULL"))

    if "reps" in entry:
        reps = entry["reps"]
        if not _is_int(reps) or reps < 0:
            errors.append(
                CaptureIssue(f"{path}.reps", f"reps must be an integer >= 0 when present: {reps!r}")
            )
    else:
        warnings.append(
            CaptureIssue(
                f"{path}.reps", "no reps recorded; imports as NULL and blocks completion (C2)"
            )
        )

    if "rir" in entry:
        if not _is_int(entry["rir"]):
            errors.append(
                CaptureIssue(
                    f"{path}.rir", f"rir must be an integer when present: {entry['rir']!r}"
                )
            )
    else:
        warnings.append(CaptureIssue(f"{path}.rir", "no RIR recorded; imports as NULL"))

    if "set_type" in entry:
        code = entry["set_type"]
        if code not in KNOWN_SET_TYPES:
            errors.append(
                CaptureIssue(
                    f"{path}.set_type", f"unknown set_type {code!r}; known: {list(KNOWN_SET_TYPES)}"
                )
            )
    else:
        warnings.append(
            CaptureIssue(
                f"{path}.set_type",
                "no set_type recorded; imports as NULL and blocks completion (C4)",
            )
        )


def validate_capture(
    document: object, *, catalog: Sequence[CatalogEntry] | None = None
) -> CaptureReport:
    """Validate a parsed capture document. Never guesses, never converts units."""
    errors: list[CaptureIssue] = []
    warnings: list[CaptureIssue] = []

    if not isinstance(document, dict):
        return CaptureReport(
            False, (CaptureIssue("$", "document must be a JSON object"),), (), 0, 0
        )

    version = document.get("schema_version")
    if version != CAPTURE_SCHEMA_VERSION:
        return CaptureReport(
            False,
            (
                CaptureIssue(
                    "$.schema_version",
                    f"unsupported schema_version {version!r}; only {CAPTURE_SCHEMA_VERSION} is "
                    "understood, and an unknown version is never best-effort parsed",
                ),
            ),
            (),
            0,
            0,
        )

    units = document.get("units")
    if units != "kg":
        return CaptureReport(
            False,
            (
                CaptureIssue(
                    "$.units", f"units must be 'kg' and are never converted; got {units!r}"
                ),
            ),
            (),
            0,
            0,
        )

    workouts = document.get("workouts")
    if not isinstance(workouts, list) or not workouts:
        return CaptureReport(
            False, (CaptureIssue("$.workouts", "workouts must be a non-empty array"),), (), 0, 0
        )

    workout_count = 0
    set_count = 0
    for workout_index, workout in enumerate(workouts):
        path = f"$.workouts[{workout_index}]"
        if not isinstance(workout, dict):
            errors.append(CaptureIssue(path, "workout must be an object"))
            continue
        workout_count += 1
        _check_date(workout.get("performed_on"), f"{path}.performed_on", errors)
        _check_time(workout.get("performed_time_local"), f"{path}.performed_time_local", errors)

        entries = workout.get("sets")
        if not isinstance(entries, list):
            errors.append(CaptureIssue(f"{path}.sets", "sets must be an array"))
            continue
        seen_orders: set[int] = set()
        for set_index, entry in enumerate(entries):
            set_path = f"{path}.sets[{set_index}]"
            if not isinstance(entry, dict):
                errors.append(CaptureIssue(set_path, "set must be an object"))
                continue
            set_count += 1
            _check_set(entry, set_path, set_index, seen_orders, catalog, errors, warnings)

    return CaptureReport(
        ok=not errors,
        errors=tuple(errors),
        warnings=tuple(warnings),
        workout_count=workout_count,
        set_count=set_count,
    )
