"""Approved substitutes of a planned slot, read from its locked notes.

The locked program lists them per exercise (``substitution_matrix``); the adapter writes them
verbatim into each slot's notes as one line, ``Approved substitutes: A, B, C.``. This module
only reads that line back. A trailing condition in the source ("Lying Leg Curl if
unavailable/intolerant") is kept, split from the exercise name so the name can be an exercise
identity while the condition is still shown.
"""

from __future__ import annotations

from dataclasses import dataclass

PREFIX = "Approved substitutes:"
CONDITION = " if "


@dataclass(frozen=True, slots=True)
class ApprovedSubstitute:
    name: str
    # The source's own condition for this substitute ("if unavailable/intolerant"), if any.
    condition: str | None


def approved_substitutes(notes: str | None) -> tuple[ApprovedSubstitute, ...]:
    """The slot's approved substitutes in source order; none when the notes list none."""
    if notes is None:
        return ()
    for line in notes.splitlines():
        text = line.strip()
        if not text.startswith(PREFIX):
            continue
        body = text[len(PREFIX) :].strip().removesuffix(".")
        found: list[ApprovedSubstitute] = []
        for item in body.split(", "):
            entry = item.strip()
            if not entry:
                continue
            name, separator, condition = entry.partition(CONDITION)
            found.append(
                ApprovedSubstitute(
                    name=name.strip(),
                    condition=f"if {condition.strip()}" if separator else None,
                )
            )
        return tuple(found)
    return ()
