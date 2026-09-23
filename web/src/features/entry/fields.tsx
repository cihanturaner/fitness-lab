import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { markUnsaved, useUnsavedKey } from '@/lib/unsaved'
import { numberInputClass, textInputClass } from './parse'

/**
 * A text input that keeps its own draft and commits once, on blur or Enter, only when the
 * value actually changed. While focused it ignores server refreshes, so saving one field
 * never steals the lifter's cursor from the next.
 *
 * A draft that differs from the saved value is never dropped silently: until it is saved
 * it counts as unsaved input (Complete and leaving the screen check that), and an invalid
 * or refused commit says so right under the field. Enter retries; Escape restores the
 * saved value.
 */
export function CommitInput({
  value,
  onCommit,
  isValid,
  invalidHint,
  label,
  context,
  disabled,
  placeholder,
  className,
  inputMode,
  align = 'right',
  type = 'text',
}: {
  value: string
  /** Resolves true once the server has stored the text. */
  onCommit: (text: string) => Promise<boolean>
  isValid?: (text: string) => boolean
  invalidHint?: string
  label: string
  /** Where the field is, for the unsaved-input summary (e.g. the exercise). */
  context?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  inputMode?: 'decimal' | 'numeric' | 'text'
  align?: 'left' | 'right'
  type?: 'text' | 'date' | 'time'
}) {
  const [draft, setDraftState] = useState(value)
  const latest = useRef(value)
  const setDraft = (text: string) => {
    latest.current = text
    setDraftState(text)
  }
  const [problem, setProblem] = useState<string | null>(null)
  const focused = useRef(false)
  // The text currently being sent, so Enter followed by blur (or Tab) never sends it twice.
  const sending = useRef<string | null>(null)
  // The text last stored by the server; until the lifter types again, the field follows
  // the stored value even while focused ("82,5" becomes "82.5" and is not sent again).
  const saved = useRef<string | null>(null)
  const key = useUnsavedKey()
  const description = context ? `${context}, ${label}` : label

  const track = (text: string) => markUnsaved(key, text === value ? null : description)

  useEffect(() => {
    if (focused.current && (saved.current === null || latest.current !== saved.current)) return
    saved.current = null
    latest.current = value
    setDraftState(value)
    setProblem(null)
    markUnsaved(key, null)
  }, [value, key])

  const invalid = isValid ? !isValid(draft) : false

  const commit = () => {
    if (draft === value || draft === sending.current || draft === saved.current) return
    if (invalid) {
      setProblem(`Not saved: ${invalidHint ?? 'invalid value'}. Esc restores the saved value.`)
      return
    }
    const text = draft
    sending.current = text
    void onCommit(text).then((stored) => {
      sending.current = null
      if (stored) {
        saved.current = text
        setProblem(null)
        // Saved; still unsaved only if the lifter typed on while it was on its way.
        markUnsaved(key, latest.current === text ? null : description)
      } else {
        setProblem('Not saved. Press Enter to retry, or Esc to restore the saved value.')
      }
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') {
      setDraft(value)
      setProblem(null)
      markUnsaved(key, null)
    }
  }

  return (
    <>
      <input
        type={type}
        aria-label={label}
        aria-invalid={invalid || problem !== null || undefined}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`${align === 'left' ? textInputClass : numberInputClass} ${className ?? ''}`}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          commit()
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          setProblem(null)
          track(event.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      {problem && (
        <p role="alert" className="mt-1 text-left text-xs font-normal text-destructive">
          {problem}
        </p>
      )}
    </>
  )
}
