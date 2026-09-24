"""Which planned slot each recorded set of a workout belongs to (V3.3.1).

A set recorded in a slot carries that placement (``performed_set_slot``), so two slots
performed as the same exercise keep their own sets; a placement without a slot (None) is
recorded extra work and stays extra work. A set with no placement at all — recorded before
V3.3.1, or through the API without saying — belongs, as it always did, to the first slot (by
position) performed as its exercise; any other set is extra work of its own exercise.

Pure: no I/O. Groups are returned in the order they were trained (their first set's order).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class SlotFacts:
    slot_id: str
    position: int
    planned_exercise_id: str
    # The exercise the slot is performed as in this workout (its substitute, else planned).
    performed_exercise_id: str


@dataclass(frozen=True, slots=True)
class SetFacts:
    set_id: str
    exercise_id: str
    set_order: int


@dataclass(frozen=True, slots=True)
class SetGroup:
    """One slot's sets, or one extra exercise's sets (``slot`` None)."""

    exercise_id: str
    slot: SlotFacts | None
    set_ids: tuple[str, ...]

    @property
    def planned_exercise_id(self) -> str | None:
        """The planned exercise when the slot was performed as another one, else None."""
        if self.slot is None or self.slot.planned_exercise_id == self.exercise_id:
            return None
        return self.slot.planned_exercise_id


def place_sets(
    slots: Sequence[SlotFacts],
    sets: Sequence[SetFacts],
    placed: Mapping[str, str | None],
) -> dict[str, str | None]:
    """Each set's slot id (None: extra work).

    ``placed`` maps set id -> the slot it was recorded in, or None when it was recorded as
    extra work; a set absent from it has no recorded placement.
    """
    by_id = {slot.slot_id: slot for slot in slots}
    first_for: dict[str, str] = {}
    for slot in sorted(slots, key=lambda item: item.position):
        first_for.setdefault(slot.performed_exercise_id, slot.slot_id)
    result: dict[str, str | None] = {}
    for performed in sets:
        if performed.set_id in placed:
            recorded = placed[performed.set_id]
            result[performed.set_id] = recorded if recorded in by_id else None
        else:
            result[performed.set_id] = first_for.get(performed.exercise_id)
    return result


def group_sets(
    slots: Sequence[SlotFacts],
    sets: Sequence[SetFacts],
    placed: Mapping[str, str | None],
) -> tuple[SetGroup, ...]:
    """The workout's sets by slot (and extra exercise), in the order they were trained."""
    by_id = {slot.slot_id: slot for slot in slots}
    where = place_sets(slots, sets, placed)
    groups: dict[tuple[str, str], list[SetFacts]] = {}
    for performed in sorted(sets, key=lambda item: item.set_order):
        slot_id = where[performed.set_id]
        key = ("slot", slot_id) if slot_id is not None else ("extra", performed.exercise_id)
        groups.setdefault(key, []).append(performed)
    return tuple(
        SetGroup(
            exercise_id=members[0].exercise_id,
            slot=by_id[key[1]] if key[0] == "slot" else None,
            set_ids=tuple(item.set_id for item in members),
        )
        for key, members in groups.items()
    )
