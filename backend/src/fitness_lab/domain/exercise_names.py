"""Exercise names typed by the lifter (V3.3.1 "Change" with a new exercise).

Two rules, mirrored in ``web/src/lib/exerciseNames.ts`` so the screen can show the exact name
before it is saved:

- ``typed_exercise_name``: surrounding and repeated whitespace goes; an all-lowercase entry is
  title-cased ("triceps curl" -> "Triceps Curl"), any other casing is the lifter's own and
  kept ("EZ-bar curl", "RDL").
- ``name_key``: the comparison key that keeps trivial duplicates out — case and whitespace
  insensitive ("Triceps  curl" is "Triceps Curl").
"""

from __future__ import annotations

MAX_NAME_LENGTH = 80
# A letter after one of these (or at the start) begins a word.
WORD_BREAKS = frozenset(" -/(")


def name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def typed_exercise_name(text: str) -> str:
    collapsed = " ".join(text.split())
    if not collapsed:
        raise ValueError("exercise name must not be blank")
    if len(collapsed) > MAX_NAME_LENGTH:
        raise ValueError(f"exercise name must be at most {MAX_NAME_LENGTH} characters")
    if collapsed != collapsed.lower():
        return collapsed
    characters: list[str] = []
    previous = " "
    for character in collapsed:
        characters.append(character.upper() if previous in WORD_BREAKS else character)
        previous = character
    return "".join(characters)
