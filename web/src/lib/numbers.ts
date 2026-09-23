/** "72.4" or "72,4", at most two decimals, 20–300 kg. Anything else is refused, not rounded. */
export function parseBodyweight(text: string): string | null {
  const value = text.trim().replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null
  const number = Number(value)
  return number >= 20 && number <= 300 ? value : null
}

/**
 * A whole number within [0, max]: '' is "not logged" (null); anything else that is not a
 * plain whole number — "145.5", "1e3", "-1" — is refused rather than rounded.
 */
export function parseWhole(text: string, max: number): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (!/^\d{1,5}$/.test(trimmed)) return { ok: false }
  const value = Number(trimmed)
  return value <= max ? { ok: true, value } : { ok: false }
}
