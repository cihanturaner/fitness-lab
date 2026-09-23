import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { numberInputClass, textInputClass } from './parse'

/**
 * A text input that keeps its own draft and commits once, on blur or Enter, only when the
 * value actually changed. While focused it ignores server refreshes, so saving one field
 * never steals the lifter's cursor from the next.
 */
export function CommitInput({
  value,
  onCommit,
  isValid,
  label,
  disabled,
  placeholder,
  className,
  inputMode,
  align = 'right',
  type = 'text',
}: {
  value: string
  onCommit: (text: string) => void
  isValid?: (text: string) => boolean
  label: string
  disabled?: boolean
  placeholder?: string
  className?: string
  inputMode?: 'decimal' | 'numeric' | 'text'
  align?: 'left' | 'right'
  type?: 'text' | 'date' | 'time'
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])

  const invalid = isValid ? !isValid(draft) : false

  const commit = () => {
    if (invalid || draft === value) return
    onCommit(draft)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') setDraft(value)
  }

  return (
    <input
      type={type}
      aria-label={label}
      aria-invalid={invalid || undefined}
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
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}
