"""Deterministic adapter: the user's locked 12-week program artifact -> package format 1.

Pure: bytes in, bytes out, no I/O. The source artifact is never modified; it is decoded
under the same strict rules as a package, its own ``integrity_checks`` must hold, and every
mapping decision is explicit here rather than guessed:

- each session becomes a planned workout, in weekly-schedule order;
- each exercise row becomes one slot with ``sets`` planned ``working`` sets;
- ``rir_by_set`` ``"2"`` -> 2..2 and ``"0-1"`` -> 0..1; ``rep_range`` -> reps min/max;
- marker, failure policy, rest, angle and approved substitutes become slot notes;
- a name offering an equipment alternative ("Cable/Machine …") is never one identity:
  the slot plans the first-named variant and the other variant is created separately,
  so recording it is a whole-slot substitution instead of a silent merge.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from fitness_lab.domain.program import PROGRAM_FORMAT, decode_artifact, sha256_hex

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
EQUIPMENT_ALTERNATIVES: dict[str, tuple[str, str]] = {
    "Cable/Machine Lateral Raise": ("Cable Lateral Raise", "Machine Lateral Raise"),
    "Smith/Machine Hip Thrust": ("Smith Hip Thrust", "Machine Hip Thrust"),
}
FAILURE_NOTES = {
    "PROHIBITED": "Failure: prohibited.",
    "FINAL_SET_PERMITTED": "Failure: permitted on the final set only.",
}
RIR_PATTERN = re.compile(r"^(\d+)(?:-(\d+))?$")
GUIDANCE_SECTIONS = (
    ("execution_rules", "Execution rules"),
    ("progression", "Progression"),
    ("plateau_logic", "Plateau logic"),
    ("calibration", "Calibration"),
    ("weeks_1_to_11", "Weeks 1–11"),
    ("deload_P1", "Deload (P1)"),
    ("week_12_P2", "Week 12 (P2)"),
    ("warmup", "Warm-up"),
    ("weekly_volume", "Weekly volume"),
    ("substitution_matrix", "Substitution matrix"),
)


class AdapterError(ValueError):
    """The artifact cannot be adapted without guessing."""


@dataclass(frozen=True, slots=True)
class AdaptedProgram:
    program_json: bytes
    notes_md: bytes
    exercises_json: bytes


def _refuse_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise AdapterError(f"duplicate key {key!r} in the artifact")
        result[key] = value
    return result


def _range_text(value: object, unit: str) -> str:
    if isinstance(value, list) and len(value) == 2:
        return f"{value[0]}–{value[1]}{unit}"
    return f"{value}{unit}"


def _parse_rir(text: object, where: str) -> tuple[int, int]:
    if not isinstance(text, str) or (match := RIR_PATTERN.match(text)) is None:
        raise AdapterError(f"{where}: unreadable RIR {text!r}")
    low = int(match.group(1))
    high = int(match.group(2)) if match.group(2) is not None else low
    if high < low:
        raise AdapterError(f"{where}: RIR range {text!r} is reversed")
    return low, high


def _planned_name(name: str, where: str) -> tuple[str, str | None]:
    """The exercise the slot plans, plus the alternative variant when there is one."""
    if name in EQUIPMENT_ALTERNATIVES:
        first, second = EQUIPMENT_ALTERNATIVES[name]
        return first, second
    if "/" in name:
        raise AdapterError(
            f"{where}: {name!r} names an equipment alternative with no explicit mapping; "
            "different equipment is never merged into one exercise identity"
        )
    return name, None


def _check_integrity(document: dict[str, Any]) -> None:
    checks = document["integrity_checks"]
    sessions = document["sessions"]
    rows = [row for session in sessions.values() for row in session["exercises"]]
    per_session = {key: sum(row["sets"] for row in s["exercises"]) for key, s in sessions.items()}
    actual = {
        "exercise_rows_expected": len(rows),
        "weekly_work_sets_expected": sum(row["sets"] for row in rows),
        "session_work_sets_expected": per_session,
        "failure_prohibited_rows_expected": sum(row["failure"] == "PROHIBITED" for row in rows),
        "failure_final_set_permitted_rows_expected": sum(
            row["failure"] == "FINAL_SET_PERMITTED" for row in rows
        ),
        "marker_exercises_expected": sum(bool(row["marker"]) for row in rows),
        "marker_exercise_names_expected": [row["name"] for row in rows if row["marker"]],
    }
    failures = [
        f"{key}: expected {checks[key]!r}, found {value!r}"
        for key, value in actual.items()
        if checks.get(key) != value
    ]
    if failures:
        raise AdapterError("source integrity checks failed: " + "; ".join(failures))


def _slot_notes(row: dict[str, Any], alternative: str | None, substitutes: object) -> str:
    lines: list[str] = []
    if row.get("marker"):
        lines.append("Marker lift (week-12 benchmark).")
    failure = FAILURE_NOTES.get(str(row.get("failure")))
    if failure is None:
        raise AdapterError(f"{row['name']!r}: unknown failure policy {row.get('failure')!r}")
    lines.append(failure)
    lines.append(f"Rest: {_range_text(row['rest_seconds'], ' s')}.")
    if "angle_deg" in row:
        lines.append(f"Bench angle: {_range_text(row['angle_deg'], '°')}.")
    if alternative is not None:
        lines.append(
            f"Program slot: {row['name']}. Planned as its first variant; if performed as "
            f"{alternative}, substitute that exercise for this slot."
        )
    if isinstance(substitutes, list) and substitutes:
        lines.append("Approved substitutes: " + ", ".join(str(item) for item in substitutes) + ".")
    return "\n".join(lines)


def _render_notes(document: dict[str, Any], source: bytes, source_name: str) -> str:
    meta = document["meta"]
    lines = [
        f"# {meta['name']}",
        "",
        f"- Source artifact: `{source_name}`",
        f"- Source SHA-256: `{sha256_hex(source)}`",
        f"- Source version: {meta['version']} ({meta['status']}, {meta['release']})",
        "- Generated deterministically by the fitness-lab locked-program adapter; the source "
        "artifact is preserved unchanged beside this package.",
        "",
        "## Weekly schedule",
        "",
    ]
    schedule = document["weekly_schedule"]
    for day in WEEKDAYS:
        entry = schedule[day]
        if entry["session_id"] is None:
            lines.append(f"- {day.capitalize()}: rest")
        else:
            minutes = _range_text(entry["estimated_duration_min"], " min")
            lines.append(
                f"- {day.capitalize()}: {entry['session_name']} "
                f"({entry['work_sets']} work sets, {minutes})"
            )
    for key, title in GUIDANCE_SECTIONS:
        if key not in document:
            continue
        lines.extend(
            [
                "",
                f"## {title}",
                "",
                "```json",
                json.dumps(document[key], ensure_ascii=False, indent=2),
                "```",
            ]
        )
    return "\n".join(lines) + "\n"


def adapt_locked_program(source: bytes, source_name: str) -> AdaptedProgram:
    """Convert the locked artifact to package files. Raises ``AdapterError``; never guesses."""
    text = decode_artifact(source, source_name)
    try:
        document = json.loads(text, object_pairs_hook=_refuse_duplicates)
    except json.JSONDecodeError as exc:
        raise AdapterError(f"{source_name}: invalid JSON ({exc})") from exc
    try:
        _check_integrity(document)
        return _adapt(document, source, source_name)
    except (KeyError, TypeError) as exc:
        raise AdapterError(f"{source_name}: unexpected artifact shape ({exc!r})") from exc


def _adapt(document: dict[str, Any], source: bytes, source_name: str) -> AdaptedProgram:
    meta = document["meta"]
    sessions = document["sessions"]
    substitution_matrix = document.get("substitution_matrix", {})
    schedule = document["weekly_schedule"]

    manifest: dict[str, dict[str, Any]] = {}

    def ensure(name: str) -> None:
        manifest.setdefault(name, {"name": name, "equipment_label": None, "notes": None})

    workouts: list[dict[str, Any]] = []
    for day in WEEKDAYS:
        session_id = schedule[day]["session_id"]
        if session_id is None:
            continue
        session = sessions[session_id]
        slots: list[dict[str, Any]] = []
        for row in sorted(session["exercises"], key=lambda item: item["order"]):
            where = f"{session_id} #{row['order']}"
            planned, alternative = _planned_name(row["name"], where)
            ensure(planned)
            if alternative is not None:
                ensure(alternative)
            rirs = row["rir_by_set"]
            if not isinstance(rirs, list) or len(rirs) != row["sets"]:
                raise AdapterError(f"{where}: rir_by_set does not match sets={row['sets']}")
            low_reps, high_reps = row["rep_range"]
            sets = []
            for index, rir_text in enumerate(rirs, start=1):
                rir_min, rir_max = _parse_rir(rir_text, f"{where} set {index}")
                sets.append(
                    {
                        "set_type": "working",
                        "reps_min": low_reps,
                        "reps_max": high_reps,
                        "target_rir_min": rir_min,
                        "target_rir_max": rir_max,
                        "target_load_kg": None,
                        "notes": None,
                    }
                )
            slots.append(
                {
                    "key": f"{session_id}.{row['order']:02d}",
                    "exercise": {"name": planned, "equipment_label": None},
                    "notes": _slot_notes(row, alternative, substitution_matrix.get(row["name"])),
                    "sets": sets,
                }
            )
        workouts.append(
            {
                "key": session_id,
                "name": session["name"],
                "day_label": day.capitalize(),
                "notes": (
                    f"{session['work_sets']} work sets · estimated "
                    f"{_range_text(session['estimated_duration_min'], ' min')}"
                ),
                "slots": slots,
            }
        )

    program = {
        "format": PROGRAM_FORMAT,
        "format_version": 1,
        "program": {
            "key": "advanced-natural-12w",
            "name": meta["name"],
            "version_label": meta["version"],
            "duration_weeks": document["athlete_context"]["block_duration_weeks"],
            "notes": f"{meta['status']} · {meta['release']}",
        },
        "workouts": workouts,
    }
    exercises = {
        "format": "fitness-lab.exercise-manifest",
        "format_version": 1,
        "exercises": list(manifest.values()),
    }
    return AdaptedProgram(
        program_json=(json.dumps(program, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        notes_md=_render_notes(document, source, source_name).encode("utf-8"),
        exercises_json=(json.dumps(exercises, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
