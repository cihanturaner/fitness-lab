// Entry sanity only, not fitness policy: at most four integer digits catches a slipped key
// (10000 reps, 55555 lb) before it becomes evidence. The server enforces storage limits.

/** Pounds: accepts "185", "72.5" or "72,5"; at most 0.01 lb, never negative. '' means not recorded. */
export function parseLoad(text: string): { ok: true; value: string | null } | { ok: false } {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return { ok: true, value: null }
  return /^\d{1,4}(\.\d{1,2})?$/.test(trimmed) ? { ok: true, value: trimmed } : { ok: false }
}

export function parseCount(
  text: string,
  { allowNegative }: { allowNegative: boolean },
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  const pattern = allowNegative ? /^-?\d{1,4}$/ : /^\d{1,4}$/
  return pattern.test(trimmed) ? { ok: true, value: Number(trimmed) } : { ok: false }
}

export const inputClass =
  'num h-9 w-full rounded-[10px] border border-border-strong bg-card px-2.5 text-[14px] outline-none transition-colors ' +
  'placeholder:text-faint hover:border-input focus-visible:border-ring focus-visible:ring-3 ' +
  'focus-visible:ring-ring/15 disabled:border-transparent disabled:bg-transparent ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20'

/** Numbers read right-aligned in a column; words read left-aligned. */
export const numberInputClass = `${inputClass} text-right`
export const textInputClass = `${inputClass} text-left`

/**
 * The workout sheet: one row per set, so every pixel of height counts. A SAVED value reads
 * as text — no box until the pointer or the cursor arrives — so recorded work and empty
 * fields never look alike.
 */
const savedCellClass =
  'num h-8 w-full rounded-lg border border-transparent bg-transparent px-2 text-[15px] font-semibold outline-none ' +
  'transition-[background-color,border-color,box-shadow] hover:bg-sunken focus-visible:border-ring focus-visible:bg-card ' +
  'focus-visible:ring-3 focus-visible:ring-ring/15 disabled:text-foreground disabled:hover:bg-transparent ' +
  'aria-invalid:border-destructive aria-invalid:bg-destructive/5 aria-invalid:ring-destructive/20'
export const gridInputClass = `${savedCellClass} text-right`

/** A row still to be entered: a sunken well, the plan's hint in plan-blue. */
export const pendingInputClass =
  'num h-8 w-full rounded-lg border border-transparent bg-sunken px-2 text-right text-[15px] font-semibold ' +
  'outline-none transition-[background-color,border-color,box-shadow] placeholder:font-normal placeholder:text-plan/70 ' +
  'hover:border-border-strong focus-visible:border-ring focus-visible:bg-card focus-visible:ring-3 focus-visible:ring-ring/15 ' +
  'read-only:opacity-60 aria-invalid:border-destructive aria-invalid:ring-destructive/20'

/** Free text inside the sheet (set notes, session details): a quiet field. */
export const gridTextInputClass =
  'h-8 w-full rounded-lg border border-border-strong bg-card px-2 text-left text-[13px] outline-none transition-colors ' +
  'placeholder:text-faint hover:border-border-strong focus-visible:border-ring focus-visible:ring-2 ' +
  'focus-visible:ring-ring/15 disabled:border-transparent disabled:bg-transparent disabled:text-foreground ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20'
