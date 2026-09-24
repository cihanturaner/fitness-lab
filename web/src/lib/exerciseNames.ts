/**
 * Exercise names typed by the lifter — the same two rules as the server's
 * backend/src/fitness_lab/domain/exercise_names.py, so the screen can show the exact name
 * before it is saved. The server stays the authority.
 */
export const MAX_NAME_LENGTH = 80
const WORD_BREAKS = new Set([' ', '-', '/', '('])

/** Case- and whitespace-insensitive comparison key: "Triceps  curl" is "Triceps Curl". */
export function nameKey(name: string): string {
  return name.trim().split(/\s+/).join(' ').toLowerCase()
}

/**
 * Surrounding and repeated whitespace goes; an all-lowercase entry is title-cased
 * ("triceps curl" → "Triceps Curl"); any other casing is the lifter's own ("EZ-bar curl").
 * Null when nothing usable was typed.
 */
export function typedExerciseName(text: string): string | null {
  const collapsed = text.trim().split(/\s+/).join(' ')
  if (collapsed === '' || collapsed.length > MAX_NAME_LENGTH) return null
  if (collapsed !== collapsed.toLowerCase()) return collapsed
  let previous = ' '
  let result = ''
  for (const character of collapsed) {
    result += WORD_BREAKS.has(previous) ? character.toUpperCase() : character
    previous = character
  }
  return result
}
