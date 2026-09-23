import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, MessageSquareText, Plus, X } from 'lucide-react'
import type { PerformedSet, PlannedSet, SetFields, SetType } from '@/api/types'
import { compactSet, formatReps, formatRir } from '@/lib/format'
import { markUnsaved, useUnsavedKey } from '@/lib/unsaved'
import { CommitInput } from './fields'
import { moveWithinExercise } from './model'
import { parseCount, parseLoad, pendingInputClass } from './parse'

export interface SetActions {
  add: (exerciseId: string, fields: SetFields) => Promise<boolean>
  patch: (setId: string, fields: SetFields) => Promise<boolean>
  remove: (setId: string) => void
  reorder: (setIds: string[]) => void
}

const TYPE_OPTIONS: { code: SetType; label: string }[] = [
  { code: 'working', label: 'Working' },
  { code: 'warmup', label: 'Warm-up' },
  { code: 'backoff', label: 'Back-off' },
]

const validLoad = (text: string) => parseLoad(text).ok
const validReps = (text: string) => parseCount(text, { allowNegative: false }).ok
const validRir = (text: string) => parseCount(text, { allowNegative: true }).ok
const LOAD_HINT = 'kilograms with up to 3 decimals, e.g. 82.5'
const COUNT_HINT = 'a whole number'

const selectClass =
  'h-8 w-full appearance-none rounded-md border border-transparent pr-6 pl-2 text-[13px] outline-none ' +
  'transition-colors focus-visible:border-ring focus-visible:bg-card focus-visible:ring-2 ' +
  'focus-visible:ring-ring/40 disabled:opacity-100 aria-invalid:border-destructive aria-invalid:bg-destructive/5'

const iconButton =
  'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground ' +
  'hover:bg-sunken hover:text-foreground disabled:opacity-30 [&_svg]:size-3.5'

function TypeSelect({
  label,
  value,
  disabled,
  invalid,
  quiet = false,
  pending = false,
  onChange,
}: {
  label: string
  value: SetType | null | ''
  disabled?: boolean
  invalid?: boolean
  /** Unset but not yet asked for: rows after the first take the previous row's type. */
  quiet?: boolean
  /** A row not yet saved: shown as a well, like its number fields. */
  pending?: boolean
  onChange: (value: SetType) => void
}) {
  const unset = value === null || value === ''
  const surface = pending || unset ? 'bg-sunken hover:border-border-strong' : 'bg-transparent hover:bg-sunken disabled:hover:bg-transparent'
  return (
    <span className="group/type relative block">
      <select
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={`${selectClass} ${surface} ${unset ? 'text-muted-foreground' : value === 'warmup' ? 'text-muted-foreground' : 'text-foreground'}`}
        value={value ?? ''}
        disabled={disabled}
        // Once chosen, the type is skipped by Tab so load → reps → RIR runs straight on to
        // the next row; it stays one click (or a letter key) away.
        tabIndex={unset ? 0 : -1}
        onChange={(event) => event.target.value && onChange(event.target.value as SetType)}
      >
        {unset && <option value="">{quiet ? '–' : 'Set type'}</option>}
        {TYPE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
      {!disabled && (
        <ChevronDown
          aria-hidden
          className={`pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-faint transition-opacity ${
            pending || unset ? '' : 'opacity-0 group-hover/type:opacity-100 group-focus-within/type:opacity-100'
          }`}
        />
      )}
    </span>
  )
}

function SavedRow({
  performed,
  index,
  exerciseName,
  allSets,
  locked,
  actions,
}: {
  performed: PerformedSet
  index: number
  exerciseName: string
  allSets: PerformedSet[]
  locked: boolean
  actions: SetActions
}) {
  const label = `set ${index + 1}`
  const [noteOpen, setNoteOpen] = useState(false)
  const up = moveWithinExercise(allSets, performed.id, -1)
  const down = moveWithinExercise(allSets, performed.id, 1)
  const commitCount = (field: 'reps' | 'rir', text: string) => {
    const parsed = parseCount(text, { allowNegative: field === 'rir' })
    return parsed.ok ? actions.patch(performed.id, { [field]: parsed.value }) : Promise.resolve(false)
  }
  const showNote = noteOpen || performed.notes !== null

  return (
    <>
      <tr data-testid="set-row" className={`group/row ${performed.set_type === 'warmup' ? '[&_input]:text-muted-foreground' : ''}`}>
        <td className={`num text-[13px] ${performed.set_type === 'warmup' ? 'text-faint' : 'text-muted-foreground'}`}>
          {index + 1}
        </td>
        <td>
          <CommitInput
            label={`Load in kg, ${label}`}
            context={exerciseName}
            value={performed.load_kg ?? ''}
            inputMode="decimal"
            disabled={locked}
            isValid={validLoad}
            invalidHint={LOAD_HINT}
            dense
            onCommit={(text) => {
              const parsed = parseLoad(text)
              return parsed.ok ? actions.patch(performed.id, { load_kg: parsed.value }) : Promise.resolve(false)
            }}
          />
        </td>
        <td>
          <CommitInput
            label={`Reps, ${label}`}
            context={exerciseName}
            value={performed.reps === null ? '' : String(performed.reps)}
            inputMode="numeric"
            disabled={locked}
            isValid={validReps}
            invalidHint={COUNT_HINT}
            dense
            onCommit={(text) => commitCount('reps', text)}
          />
        </td>
        <td>
          <CommitInput
            label={`RIR, ${label}`}
            context={exerciseName}
            value={performed.rir === null ? '' : String(performed.rir)}
            inputMode="numeric"
            disabled={locked}
            isValid={validRir}
            invalidHint={`${COUNT_HINT} (negative allowed)`}
            dense
            onCommit={(text) => commitCount('rir', text)}
          />
        </td>
        <td>
          <TypeSelect
            label={`Set type, ${label}`}
            value={performed.set_type}
            disabled={locked}
            invalid={performed.set_type === null}
            onChange={(code) => void actions.patch(performed.id, { set_type: code })}
          />
        </td>
        <td className="text-right whitespace-nowrap">
          {!locked && (
            <span className="inline-flex opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
              <button
                type="button"
                tabIndex={-1}
                className={iconButton}
                aria-label={`Note, ${label}`}
                aria-expanded={showNote}
                onClick={() => setNoteOpen((open) => !open)}
              >
                <MessageSquareText aria-hidden />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className={iconButton}
                aria-label={`Move ${label} earlier`}
                disabled={up === null}
                onClick={() => up && actions.reorder(up)}
              >
                <ChevronUp aria-hidden />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className={iconButton}
                aria-label={`Move ${label} later`}
                disabled={down === null}
                onClick={() => down && actions.reorder(down)}
              >
                <ChevronDown aria-hidden />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className={`${iconButton} hover:text-destructive`}
                aria-label={`Delete ${label}`}
                onClick={() => {
                  if (window.confirm(`Delete ${exerciseName} ${label} (${compactSet(performed)})?`)) {
                    actions.remove(performed.id)
                  }
                }}
              >
                <X aria-hidden />
              </button>
            </span>
          )}
        </td>
      </tr>
      {showNote && (
        <tr>
          <td />
          <td colSpan={5} className="pb-1">
            <CommitInput
              label={`Notes, ${label}`}
              context={exerciseName}
              value={performed.notes ?? ''}
              align="left"
              disabled={locked}
              placeholder="Note for this set"
              dense
              className="text-muted-foreground"
              onCommit={(text) => actions.patch(performed.id, { notes: text.trim() === '' ? null : text })}
            />
          </td>
        </tr>
      )}
    </>
  )
}

interface Carry {
  load: string
  type: SetType | ''
}

/**
 * A row that exists only on screen until the lifter saves it — by leaving the row or with
 * Enter. Nothing about it comes from the plan except placeholder hints; the load and type
 * it may start with are the previous row's, and a carried load is not counted as input.
 */
function PendingRow({
  number,
  exerciseId,
  exerciseName,
  planned,
  carry,
  autoFocus,
  first,
  actions,
  onSubmitting,
  onSaved,
}: {
  first: boolean
  number: number
  exerciseId: string
  exerciseName: string
  planned: PlannedSet | undefined
  carry: Carry
  autoFocus: boolean
  actions: SetActions
  onSubmitting: (carry: Carry) => void
  onSaved: () => void
}) {
  const [load, setLoad] = useState(carry.load)
  const [carriedLoad, setCarriedLoad] = useState(carry.load)
  const [reps, setReps] = useState('')
  const [rir, setRir] = useState('')
  const [type, setType] = useState<SetType | ''>(carry.type)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  // Saved and about to be removed: nothing — not even the focus leaving it — resubmits it.
  const done = useRef(false)
  const loadRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLTableRowElement>(null)
  const unsavedKey = useUnsavedKey()
  const label = `new set ${number}`
  const dirty = reps.trim() !== '' || rir.trim() !== '' || (load.trim() !== '' && load !== carriedLoad)

  useEffect(() => {
    markUnsaved(unsavedKey, dirty ? `${exerciseName} ${label} (typed, not saved)` : null)
  }, [unsavedKey, dirty, exerciseName, label])

  // The previous row was just submitted: start from its load and type unless this row
  // already holds something of the lifter's own. Adjusted during render, not in an effect.
  const [seenCarry, setSeenCarry] = useState(carry)
  if (carry.load !== seenCarry.load || carry.type !== seenCarry.type) {
    setSeenCarry(carry)
    if (load === carriedLoad && carry.load !== carriedLoad) {
      setLoad(carry.load)
      setCarriedLoad(carry.load)
    }
    if (type === '' && carry.type !== '') setType(carry.type)
  }
  // A carried load that lands in the focused field is selected once, as it arrives, so
  // typing replaces it. Only a new carry triggers this — never the lifter's own typing,
  // which may pass through the same text ("82.5" on the way to "82.55").
  useEffect(() => {
    const field = loadRef.current
    if (field && document.activeElement === field && field.value !== '' && field.value === carriedLoad) {
      field.select()
    }
  }, [carriedLoad])

  /** Where Enter sends the cursor once this row is saved: the next row, else "+ Set". */
  const focusNext = () => {
    let next = rowRef.current?.nextElementSibling ?? null
    while (next && next.getAttribute('data-testid') !== 'new-set-row') next = next.nextElementSibling
    const target =
      next?.querySelector('input') ??
      rowRef.current?.closest('table')?.parentElement?.querySelector<HTMLButtonElement>('button[aria-label^="Add set"]')
    target?.focus()
  }

  const submit = async (fromEnter = false) => {
    if (inFlight.current || done.current || !dirty) return
    const parsedLoad = parseLoad(load)
    const parsedReps = parseCount(reps, { allowNegative: false })
    const parsedRir = parseCount(rir, { allowNegative: true })
    if (!parsedLoad.ok) return setProblem('Not saved: load must be kilograms, e.g. 82.5.')
    if (!parsedReps.ok || parsedReps.value === null) return setProblem('Not saved: enter reps.')
    if (!parsedRir.ok) return setProblem('Not saved: RIR must be a whole number.')
    if (type === '') return setProblem('Not saved: choose the set type (Work, Warm or Back).')
    setProblem(null)
    inFlight.current = true
    setSaving(true)
    onSubmitting({ load: parsedLoad.value ?? '', type })
    const saved = await actions
      .add(exerciseId, {
        set_type: type,
        load_kg: parsedLoad.value,
        reps: parsedReps.value,
        rir: parsedRir.value,
        notes: null,
      })
      .finally(() => {
        inFlight.current = false
        setSaving(false)
      })
    if (saved) {
      // Nothing here is unsaved any more, even before React removes the row (Complete may
      // be reading the registry right now).
      done.current = true
      markUnsaved(unsavedKey, null)
      if (fromEnter && rowRef.current?.contains(document.activeElement)) focusNext()
      onSaved()
    } else {
      setProblem('Not saved. Press Enter to retry.')
    }
  }

  const onBlur = (event: FocusEvent<HTMLTableRowElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    void submit()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit(true)
    }
    if (event.key === 'Escape') {
      // Drop what was typed in this row; the carried load and type stay as offered.
      setLoad(carriedLoad)
      setReps('')
      setRir('')
      setProblem(null)
    }
  }
  const input = (field: 'load' | 'reps' | 'rir') => {
    const value = field === 'load' ? load : field === 'reps' ? reps : rir
    const set = field === 'load' ? setLoad : field === 'reps' ? setReps : setRir
    return {
      value,
      onChange: (event: { target: { value: string } }) => {
        set(event.target.value)
        setProblem(null)
      },
      onKeyDown,
      // readOnly, not disabled: a disabled field drops the lifter's focus mid-save.
      readOnly: saving,
      className: pendingInputClass,
    }
  }
  const rirHint = planned ? formatRir(planned.target_rir_min, planned.target_rir_max) : null

  return (
    <>
      <tr ref={rowRef} data-testid="new-set-row" onBlur={onBlur} aria-busy={saving || undefined}>
        <td className="num text-[13px] text-faint">{number}</td>
        <td>
          <input
            ref={loadRef}
            aria-label={`Load in kg, ${label}`}
            inputMode="decimal"
            placeholder={planned?.target_load_kg ?? ''}
            autoFocus={autoFocus}
            aria-invalid={(problem !== null && !validLoad(load)) || undefined}
            onFocus={(event) => load !== '' && load === carriedLoad && event.currentTarget.select()}
            {...input('load')}
          />
        </td>
        <td>
          <input
            aria-label={`Reps, ${label}`}
            inputMode="numeric"
            placeholder={planned ? formatReps(planned.reps_min, planned.reps_max) : ''}
            aria-invalid={(problem !== null && reps.trim() === '') || undefined}
            {...input('reps')}
          />
        </td>
        <td>
          <input
            aria-label={`RIR, ${label}`}
            inputMode="numeric"
            placeholder={rirHint ?? ''}
            {...input('rir')}
          />
        </td>
        <td onKeyDown={onKeyDown}>
          <TypeSelect
            label={`Set type, ${label}`}
            value={type}
            invalid={problem !== null && type === ''}
            quiet={!first && problem === null}
            pending
            onChange={(code) => {
              if (saving) return
              setType(code)
              setProblem(null)
            }}
          />
        </td>
        <td className="pr-1 text-right text-[12px] text-muted-foreground">{saving ? 'Saving…' : ''}</td>
      </tr>
      {problem && (
        <tr>
          <td />
          <td colSpan={5}>
            <p role="alert" className="pb-1 text-[12px] text-destructive">
              {problem}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

let nextPendingKey = 0

export function SetGrid({
  exerciseId,
  exerciseName,
  sets,
  allSets,
  planned,
  locked,
  actions,
}: {
  exerciseId: string
  exerciseName: string
  sets: PerformedSet[]
  allSets: PerformedSet[]
  planned: PlannedSet[]
  locked: boolean
  actions: SetActions
}) {
  const worked = sets.filter((recorded) => recorded.set_type !== 'warmup').length
  const lastSaved = sets.at(-1)
  const [pending, setPending] = useState<{ key: number; carry: Carry; focus: boolean }[]>(() => {
    if (locked) return []
    const count = Math.max(planned.length - worked, sets.length === 0 ? 1 : 0)
    const carry: Carry = { load: lastSaved?.load_kg ?? '', type: lastSaved?.set_type ?? '' }
    return Array.from({ length: count }, () => ({ key: nextPendingKey++, carry, focus: false }))
  })

  const addRow = () => {
    const last = pending.at(-1)?.carry ?? { load: lastSaved?.load_kg ?? '', type: lastSaved?.set_type ?? '' }
    setPending((rows) => [...rows, { key: nextPendingKey++, carry: last, focus: true }])
  }

  return (
    <div>
      <table className="w-full max-w-[30rem] table-fixed border-separate border-spacing-x-1 border-spacing-y-[2px]" aria-label={`Sets, ${exerciseName}`}>
        <colgroup>
          <col className="w-7" />
          <col className="w-[5.25rem]" />
          <col className="w-[4.25rem]" />
          <col className="w-[3.75rem]" />
          <col className="w-[6.25rem]" />
          <col />
        </colgroup>
        <thead>
          <tr className="text-left text-[12px] text-muted-foreground">
            <th className="pb-1 font-medium">Set</th>
            <th className="pr-2 pb-1 text-right font-medium">kg</th>
            <th className="pr-2 pb-1 text-right font-medium">Reps</th>
            <th className="pr-2 pb-1 text-right font-medium">RIR</th>
            <th className="pb-1 pl-2 font-medium">Type</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sets.map((performed, index) => (
            <SavedRow
              key={performed.id}
              performed={performed}
              index={index}
              exerciseName={exerciseName}
              allSets={allSets}
              locked={locked}
              actions={actions}
            />
          ))}
          {!locked &&
            pending.map((row, index) => (
              <PendingRow
                key={row.key}
                number={sets.length + index + 1}
                exerciseId={exerciseId}
                exerciseName={exerciseName}
                // Hints follow the prescription, which lists work sets only: warm-ups do
                // not shift which planned set comes next.
                planned={planned[worked + index]}
                carry={row.carry}
                autoFocus={row.focus}
                first={index === 0}
                actions={actions}
                onSubmitting={(carry) =>
                  setPending((rows) => {
                    const at = rows.findIndex((item) => item.key === row.key)
                    return rows.map((item, position) => (position === at + 1 ? { ...item, carry } : item))
                  })
                }
                onSaved={() => setPending((rows) => rows.filter((item) => item.key !== row.key))}
              />
            ))}
        </tbody>
      </table>
      {sets.length === 0 && locked && <p className="t-micro pl-9">No sets recorded.</p>}
      {!locked && (
        <button
          type="button"
          className="mt-1 ml-8 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-sunken hover:text-foreground"
          aria-label={`Add set, ${exerciseName}`}
          onClick={addRow}
        >
          <Plus className="size-3.5" aria-hidden />
          Add set
        </button>
      )}
    </div>
  )
}
