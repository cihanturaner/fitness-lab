/**
 * Approved substitutes of a planned slot, read from its locked notes, and the rules for an
 * exercise name the lifter types. Mirrors the desktop's `domain/substitutes.py` and
 * `domain/exercise_names.py` exactly.
 */

export type ApprovedSubstitute = {
  name: string;
  /** The source's own condition for this substitute ("if unavailable/intolerant"), if any. */
  condition: string | null;
};

const PREFIX = 'Approved substitutes:';
const CONDITION = ' if ';

/** The slot's approved substitutes in source order; none when its notes list none. */
export function approvedSubstitutes(notes: string | null): ApprovedSubstitute[] {
  if (notes === null) return [];
  for (const line of notes.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith(PREFIX)) continue;
    let body = text.slice(PREFIX.length).trim();
    if (body.endsWith('.')) body = body.slice(0, -1);
    const found: ApprovedSubstitute[] = [];
    for (const item of body.split(', ')) {
      const entry = item.trim();
      if (!entry) continue;
      const at = entry.indexOf(CONDITION);
      found.push(
        at === -1
          ? { name: entry, condition: null }
          : {
              name: entry.slice(0, at).trim(),
              condition: `if ${entry.slice(at + CONDITION.length).trim()}`,
            },
      );
    }
    return found;
  }
  return [];
}

export const MAX_EXERCISE_NAME_LENGTH = 80;
const WORD_BREAKS = new Set([' ', '-', '/', '(']);

/** Comparison key that keeps trivial duplicates out: case- and whitespace-insensitive. */
export function exerciseNameKey(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

export type TypedName = { ok: true; name: string } | { ok: false; error: string };

/**
 * A typed exercise name: surrounding and repeated whitespace goes; an all-lowercase entry is
 * title-cased ("triceps curl" → "Triceps Curl"); any other casing is the lifter's own.
 */
export function typedExerciseName(text: string): TypedName {
  const collapsed = text.split(/\s+/).filter(Boolean).join(' ');
  if (!collapsed) return { ok: false, error: 'Type the exercise’s name.' };
  if (collapsed.length > MAX_EXERCISE_NAME_LENGTH) {
    return { ok: false, error: `At most ${MAX_EXERCISE_NAME_LENGTH} characters.` };
  }
  if (collapsed !== collapsed.toLowerCase()) return { ok: true, name: collapsed };
  let previous = ' ';
  let name = '';
  for (const ch of collapsed) {
    name += WORD_BREAKS.has(previous) ? ch.toUpperCase() : ch;
    previous = ch;
  }
  return { ok: true, name };
}
