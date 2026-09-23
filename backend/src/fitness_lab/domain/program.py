"""Program package format 1: exact artifact preservation, hashing and strict validation.

A package is ``program.json`` plus an optional ``program-notes.md``, handed over as raw
bytes. Both are preserved exactly: the stored text must re-encode to the original bytes,
and every hash is taken over those original bytes — never over a re-serialisation, which
would silently change with key order, whitespace or line endings.

Validation is strict and exhaustive: unknown keys, duplicate keys, floats and blank
strings are refused, and every issue is reported with its JSON path instead of stopping at
the first. Nothing is guessed, defaulted or normalised.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import TypeGuard

from fitness_lab.domain.models import SetTypeCode
from fitness_lab.domain.units import kg_to_g

PROGRAM_FORMAT = "fitness-lab.program"
PACKAGE_FORMAT = 1
PACKAGE_HASH_PREFIX = "fitness-lab.program-package.v1"
UTF8_BOM = b"\xef\xbb\xbf"
KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]*$")


class PackageError(ValueError):
    """The package was refused. ``issues`` lists every problem found, with its path."""

    def __init__(self, issues: tuple[str, ...]) -> None:
        super().__init__("; ".join(issues))
        self.issues = issues


@dataclass(frozen=True, slots=True)
class ExerciseRef:
    """An exercise by its canonical identity pair, resolved at import, never created."""

    name: str
    equipment_label: str | None


@dataclass(frozen=True, slots=True)
class PlannedSetSpec:
    set_type: SetTypeCode
    reps_min: int
    reps_max: int | None
    target_rir_min: int | None
    target_rir_max: int | None
    target_load_kg: Decimal | None
    notes: str | None


@dataclass(frozen=True, slots=True)
class SlotSpec:
    key: str
    exercise: ExerciseRef
    notes: str | None
    sets: tuple[PlannedSetSpec, ...]


@dataclass(frozen=True, slots=True)
class WorkoutSpec:
    key: str
    name: str
    day_label: str | None
    notes: str | None
    slots: tuple[SlotSpec, ...]


@dataclass(frozen=True, slots=True)
class ProgramSpec:
    key: str
    name: str
    version_label: str | None
    duration_weeks: int | None
    notes: str | None
    workouts: tuple[WorkoutSpec, ...]


@dataclass(frozen=True, slots=True)
class ProgramPackage:
    spec: ProgramSpec
    program_json_text: str
    program_json_sha256: str
    notes_text: str | None
    notes_sha256: str | None
    package_sha256: str


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def package_sha256(program_json_sha256: str, notes_sha256: str | None) -> str:
    """The identity of the exact package: versioned, deterministic, order-fixed."""
    manifest = (
        f"{PACKAGE_HASH_PREFIX}\n"
        f"program.json {program_json_sha256}\n"
        f"program-notes.md {notes_sha256 if notes_sha256 is not None else '-'}\n"
    )
    return sha256_hex(manifest.encode("utf-8"))


def decode_artifact(data: bytes, label: str) -> str:
    """Strict UTF-8 without BOM or NUL; line endings and trailing newline kept as-is."""
    if data.startswith(UTF8_BOM):
        raise PackageError((f"{label}: a UTF-8 BOM is not accepted",))
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise PackageError(
            (f"{label}: not valid UTF-8 ({exc.reason} at byte {exc.start})",)
        ) from exc
    if "\x00" in text:
        raise PackageError((f"{label}: NUL bytes are not accepted",))
    return text


def _refuse_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate key {key!r}")
        result[key] = value
    return result


@dataclass(frozen=True, slots=True)
class _RefusedNumber:
    """A JSON float/NaN/Infinity. Kept as a marker so the validator can name its path."""

    literal: str

    def __repr__(self) -> str:
        return f"{self.literal} (non-integer JSON number; use a decimal string)"


def _refuse_float(literal: str) -> object:
    return _RefusedNumber(literal)


def _is_int(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


class _Validator:
    """Collects every issue; returns placeholders so validation can continue."""

    def __init__(self) -> None:
        self.issues: list[str] = []

    def fail(self, path: str, message: str) -> None:
        self.issues.append(f"{path}: {message}")

    def obj(
        self, value: object, path: str, required: set[str], optional: set[str]
    ) -> dict[str, object] | None:
        if not isinstance(value, dict):
            self.fail(path, "must be an object")
            return None
        for key in sorted(set(value) - required - optional):
            self.fail(f"{path}.{key}", "unknown key")
        for key in sorted(required - set(value)):
            self.fail(f"{path}.{key}", "required key is missing")
        return value

    def text(self, value: object, path: str) -> str:
        if not isinstance(value, str) or not value.strip():
            self.fail(path, "must be a non-blank string")
            return ""
        return value

    def optional_text(self, entry: dict[str, object], key: str, path: str) -> str | None:
        value = entry.get(key)
        if value is None:
            return None
        return self.text(value, f"{path}.{key}")

    def key(self, value: object, path: str) -> str:
        if not isinstance(value, str) or not KEY_PATTERN.match(value):
            self.fail(path, f"must match {KEY_PATTERN.pattern}: {value!r}")
            return ""
        return value

    def integer(self, value: object, path: str, minimum: int | None = None) -> int:
        if not _is_int(value):
            self.fail(path, f"must be an integer: {value!r}")
            return 0
        if minimum is not None and value < minimum:
            self.fail(path, f"must be >= {minimum}: {value!r}")
        return value

    def optional_integer(
        self, entry: dict[str, object], key: str, path: str, minimum: int | None = None
    ) -> int | None:
        value = entry.get(key)
        if value is None:
            return None
        return self.integer(value, f"{path}.{key}", minimum)

    def items(self, value: object, path: str) -> list[object]:
        if not isinstance(value, list) or not value:
            self.fail(path, "must be a non-empty array")
            return []
        return value


def _parse_set(v: _Validator, value: object, path: str) -> PlannedSetSpec | None:
    entry = v.obj(
        value,
        path,
        required={"set_type", "reps_min", "reps_max"},
        optional={"target_rir_min", "target_rir_max", "target_load_kg", "notes"},
    )
    if entry is None:
        return None
    code = entry.get("set_type")
    set_type = SetTypeCode.WORKING
    if not isinstance(code, str) or code not in {member.value for member in SetTypeCode}:
        v.fail(f"{path}.set_type", f"unknown set_type {code!r}")
    else:
        set_type = SetTypeCode(code)

    reps_min = v.integer(entry.get("reps_min"), f"{path}.reps_min", minimum=1)
    reps_max = v.optional_integer(entry, "reps_max", path)
    if reps_max is not None and _is_int(entry.get("reps_min")) and reps_max < reps_min:
        v.fail(f"{path}.reps_max", f"must be null (open-ended) or >= reps_min: {reps_max}")

    rir_min = v.optional_integer(entry, "target_rir_min", path)
    rir_max = v.optional_integer(entry, "target_rir_max", path)
    if (rir_min is None) != (rir_max is None):
        v.fail(f"{path}.target_rir", "target_rir_min and target_rir_max are both set or both null")
    elif rir_min is not None and rir_max is not None and rir_min > rir_max:
        v.fail(f"{path}.target_rir", f"target_rir_min {rir_min} exceeds target_rir_max {rir_max}")

    load: Decimal | None = None
    raw_load = entry.get("target_load_kg")
    if raw_load is not None:
        if not isinstance(raw_load, str):
            v.fail(f"{path}.target_load_kg", f"must be a decimal string or null: {raw_load!r}")
        else:
            try:
                kg_to_g(raw_load)
                load = Decimal(raw_load)
            except (TypeError, ValueError) as exc:
                v.fail(f"{path}.target_load_kg", str(exc))

    return PlannedSetSpec(
        set_type=set_type,
        reps_min=reps_min,
        reps_max=reps_max,
        target_rir_min=rir_min,
        target_rir_max=rir_max,
        target_load_kg=load,
        notes=v.optional_text(entry, "notes", path),
    )


def _parse_slot(v: _Validator, value: object, path: str) -> SlotSpec | None:
    entry = v.obj(value, path, required={"key", "exercise", "sets"}, optional={"notes"})
    if entry is None:
        return None
    reference = v.obj(
        entry.get("exercise"), f"{path}.exercise", required={"name"}, optional={"equipment_label"}
    )
    exercise = ExerciseRef(name="", equipment_label=None)
    if reference is not None:
        exercise = ExerciseRef(
            name=v.text(reference.get("name"), f"{path}.exercise.name"),
            equipment_label=v.optional_text(reference, "equipment_label", f"{path}.exercise"),
        )
    sets = [
        _parse_set(v, item, f"{path}.sets[{index}]")
        for index, item in enumerate(v.items(entry.get("sets"), f"{path}.sets"))
    ]
    return SlotSpec(
        key=v.key(entry.get("key"), f"{path}.key"),
        exercise=exercise,
        notes=v.optional_text(entry, "notes", path),
        sets=tuple(item for item in sets if item is not None),
    )


def _unique_keys(v: _Validator, keys: list[str], path: str) -> None:
    seen: set[str] = set()
    for key in keys:
        if key and key in seen:
            v.fail(path, f"duplicate key {key!r}")
        seen.add(key)


def _parse_workout(v: _Validator, value: object, path: str) -> WorkoutSpec | None:
    entry = v.obj(value, path, required={"key", "name", "slots"}, optional={"day_label", "notes"})
    if entry is None:
        return None
    slots = [
        _parse_slot(v, item, f"{path}.slots[{index}]")
        for index, item in enumerate(v.items(entry.get("slots"), f"{path}.slots"))
    ]
    parsed = tuple(item for item in slots if item is not None)
    _unique_keys(v, [slot.key for slot in parsed], f"{path}.slots")
    return WorkoutSpec(
        key=v.key(entry.get("key"), f"{path}.key"),
        name=v.text(entry.get("name"), f"{path}.name"),
        day_label=v.optional_text(entry, "day_label", path),
        notes=v.optional_text(entry, "notes", path),
        slots=parsed,
    )


def _parse_spec(v: _Validator, document: object) -> ProgramSpec | None:
    root = v.obj(
        document, "$", required={"format", "format_version", "program", "workouts"}, optional=set()
    )
    if root is None:
        return None
    if root.get("format") != PROGRAM_FORMAT:
        v.fail("$.format", f"must be {PROGRAM_FORMAT!r}: {root.get('format')!r}")
    if not _is_int(root.get("format_version")) or root.get("format_version") != PACKAGE_FORMAT:
        v.fail(
            "$.format_version",
            f"only format_version {PACKAGE_FORMAT} is understood: {root.get('format_version')!r}",
        )
    program = v.obj(
        root.get("program"),
        "$.program",
        required={"key", "name"},
        optional={"version_label", "duration_weeks", "notes"},
    )
    workouts = [
        _parse_workout(v, item, f"$.workouts[{index}]")
        for index, item in enumerate(v.items(root.get("workouts"), "$.workouts"))
    ]
    parsed = tuple(item for item in workouts if item is not None)
    _unique_keys(v, [workout.key for workout in parsed], "$.workouts")
    if program is None:
        return None
    return ProgramSpec(
        key=v.key(program.get("key"), "$.program.key"),
        name=v.text(program.get("name"), "$.program.name"),
        version_label=v.optional_text(program, "version_label", "$.program"),
        duration_weeks=v.optional_integer(program, "duration_weeks", "$.program", minimum=1),
        notes=v.optional_text(program, "notes", "$.program"),
        workouts=parsed,
    )


def parse_program_package(program_json: bytes, notes: bytes | None) -> ProgramPackage:
    """Decode, hash and validate a package. Raises ``PackageError`` listing every issue."""
    issues: list[str] = []
    program_text = ""
    notes_text: str | None = None
    try:
        program_text = decode_artifact(program_json, "program.json")
    except PackageError as exc:
        issues.extend(exc.issues)
    if notes is not None:
        try:
            notes_text = decode_artifact(notes, "program-notes.md")
        except PackageError as exc:
            issues.extend(exc.issues)
    if issues:
        raise PackageError(tuple(issues))

    try:
        document = json.loads(
            program_text,
            object_pairs_hook=_refuse_duplicate_keys,
            parse_float=_refuse_float,
            parse_constant=_refuse_float,
        )
    except ValueError as exc:
        raise PackageError((f"program.json: invalid JSON ({exc})",)) from exc

    validator = _Validator()
    spec = _parse_spec(validator, document)
    if validator.issues or spec is None:
        raise PackageError(tuple(validator.issues) or ("$: invalid package",))

    json_hash = sha256_hex(program_json)
    notes_hash = None if notes is None else sha256_hex(notes)
    return ProgramPackage(
        spec=spec,
        program_json_text=program_text,
        program_json_sha256=json_hash,
        notes_text=notes_text,
        notes_sha256=notes_hash,
        package_sha256=package_sha256(json_hash, notes_hash),
    )
