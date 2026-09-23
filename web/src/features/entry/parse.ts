/** Accepts "82.5" or "82,5"; at most gram precision, never negative. '' means not recorded. */
export function parseLoad(text: string): { ok: true; value: string | null } | { ok: false } {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return { ok: true, value: null }
  return /^\d+(\.\d{1,3})?$/.test(trimmed) ? { ok: true, value: trimmed } : { ok: false }
}

export function parseCount(
  text: string,
  { allowNegative }: { allowNegative: boolean },
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/
  return pattern.test(trimmed) ? { ok: true, value: Number(trimmed) } : { ok: false }
}

export const inputClass =
  'num h-8 w-full rounded-md border border-input bg-card px-2 text-sm outline-none ' +
  'placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 ' +
  'focus-visible:ring-ring/30 disabled:border-transparent disabled:bg-transparent ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20'

/** Numbers read right-aligned in a column; words read left-aligned. */
export const numberInputClass = `${inputClass} text-right`
export const textInputClass = `${inputClass} text-left`
