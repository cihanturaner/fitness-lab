import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Check, ChevronDown, ChevronUp, MessageSquareText, Plus, X } from 'lucide-react'
import type { PerformedSet, PlannedSet, SetFields } from '@/api/types'
import { compactSet, formatReps, formatRir } from '@/lib/format'
import { markUnsaved, useUnsavedKey } from '@/lib/unsaved'
import { CommitInput } from './fields'
import { moveWithinBlock } from './model'
import { parseCount, parseLoad, pendingInputClass } from './parse'

export interface SetActions {
  add: (exerciseId: string, fields: SetFields) => Promise<boolean>
  patch: (setId: string, fields: SetFields) => Promise<boolean>
  remove: (setId: string) => void
  reorder: (setIds: string[]) => void
}

const validLoad = (text: string) => parseLoad(text).ok
const validReps = (text: string) => parseCount(text, { allowNegative: false }).ok
const validRir = (text: string) => parseCount(text, { allowNegative: true }).ok
const LOAD_HINT = 'pounds with up to 2 decimals, e.g. 185 or 72.5'
const COUNT_HINT = 'a whole number'

const iconButton =
  'press inline-flex size-7 items-center justify-center rounded-md text-muted-foreground ' +
  'hover:bg-sunken hover:text-foreground disabled:opacity-30 [&_svg]:size-3.5'

function SavedRow({
  performed,
  index,
  exerciseName,
  allSets,
  locked,
  actions,
  fresh,
}: {
  performed: PerformedSet
  index: number
  exerciseName: string
  allSets: PerformedSet[]
  locked: boolean
  actions: SetActions
  /** Saved during this visit: it settles in with a brief emerald confirmation. */
  fresh: boolean
}) {
  const label = `set ${index + 1}`
  const [noteOpen, setNoteOpen] = useState(false)
  const up = moveWithinBlock(allSets, performed.id, -1)
  const down = moveWithinBlock(allSets, performed.id, 1)
  const commitCount = (field: 'reps' | 'rir', text: string) => {
    const parsed = parseCount(text, { allowNegative: field === 'rir' })
    return parsed.ok ? actions.patch(performed.id, { [field]: parsed.value }) : Promise.resolve(false)
  }
  const showNote = noteOpen || performed.notes !== null

  return (
    <>
      <tr
        data-testid="set-row"
        className={`group/row ${fresh ? 'just-saved' : ''} ${performed.set_type === 'warmup' ? '[&_input]:text-muted-foreground' : ''}`}
      >
        <td className="rounded-l-[10px]">
          {/* Saved evidence: the set number settles into a filled emerald dot. */}
          {/* A warm-up can only be legacy evidence (no screen asks for a type since V3.2):
              it stays marked, because it never counts toward the planned working sets. */}
          <span
            title={performed.set_type === 'warmup' ? 'Warm-up: not counted as a working set' : undefined}
            className={`num relative flex size-6 items-center justify-center rounded-full text-[12px] font-semibold ${
              performed.set_type === 'warmup' ? 'bg-sunken text-faint' : 'bg-emerald-100 text-emerald-800'
            } ${fresh ? 'pop-in' : ''}`}
          >
            {index + 1}
            {performed.set_type === 'warmup' && <span className="sr-only"> (warm-up)</span>}
            {fresh && (
              <span aria-hidden className="confirm absolute inset-0 flex items-center justify-center rounded-full bg-emerald-600 text-white">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            )}
          </span>
        </td>
        <td>
          <CommitInput
            label={`Load in lb, ${label}`}
            context={exerciseName}
            value={performed.load_lb ?? ''}
            inputMode="decimal"
            disabled={locked}
            isValid={validLoad}
            invalidHint={LOAD_HINT}
            dense
            onCommit={(text) => {
              const parsed = parseLoad(text)
              return parsed.ok ? actions.patch(performed.id, { load_lb: parsed.value }) : Promise.resolve(false)
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
        <td className="rounded-r-[10px] text-right whitespace-nowrap">
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
          <td colSpan={4} className="pb-1">
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
}

/**
 * A row that exists only on screen until the lifter saves it — by leaving the row or with
 * Enter. Nothing about it comes from the plan except placeholder hints; the load it may start
 * with is the previous row's, and a carried load is not counted as input. The lifter types
 * load, reps and RIR only: a saved row is a working set (V3.2 — no set type is ever asked).
 */
function PendingRow({
  number,
  exerciseId,
  exerciseName,
  planned,
  carry,
  autoFocus,
  actions,
  onSubmitting,
  onSaved,
}: {
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

  // The previous row was just submitted: start from its load unless this row already holds
  // something of the lifter's own. Adjusted during render, not in an effect.
  const [seenCarry, setSeenCarry] = useState(carry)
  if (carry.load !== seenCarry.load) {
    setSeenCarry(carry)
    if (load === carriedLoad && carry.load !== carriedLoad) {
      setLoad(carry.load)
      setCarriedLoad(carry.load)
    }
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
    if (!parsedLoad.ok) return setProblem('Not saved: load must be pounds, e.g. 185 or 72.5.')
    if (!parsedReps.ok || parsedReps.value === null) return setProblem('Not saved: enter reps.')
    if (!parsedRir.ok) return setProblem('Not saved: RIR must be a whole number.')
    setProblem(null)
    inFlight.current = true
    setSaving(true)
    onSubmitting({ load: parsedLoad.value ?? '' })
    const saved = await actions
      .add(exerciseId, {
        set_type: 'working',
        load_lb: parsedLoad.value,
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
      // Drop what was typed in this row; the carried load stays as offered.
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
      <tr
        ref={rowRef}
        data-testid="new-set-row"
        onBlur={onBlur}
        aria-busy={saving || undefined}
        className="group/pending transition-colors [&:focus-within>td]:bg-emerald-50 [&>td]:transition-colors [&>td]:duration-200"
      >
        <td className="rounded-l-[10px]">
          <span className="num flex size-6 items-center justify-center rounded-full border border-dashed border-faint/70 text-[12px] font-medium text-faint transition-colors group-focus-within/pending:border-emerald-600 group-focus-within/pending:bg-card group-focus-within/pending:text-emerald-700">
            {number}
          </span>
        </td>
        <td>
          <input
            ref={loadRef}
            aria-label={`Load in lb, ${label}`}
            inputMode="decimal"
            placeholder={planned?.target_load_lb ?? ''}
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
        <td className="rounded-r-[10px] pr-1 text-right text-[12px] font-medium text-emerald-700">{saving ? 'Saving…' : ''}</td>
      </tr>
      {problem && (
        <tr>
          <td />
          <td colSpan={4}>
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
  // Sets already on record when the grid opened; any other saved set is fresh this visit.
  const [initial] = useState(() => new Set(sets.map((performed) => performed.id)))
  const [pending, setPending] = useState<{ key: number; carry: Carry; focus: boolean }[]>(() => {
    if (locked) return []
    const count = Math.max(planned.length - worked, sets.length === 0 ? 1 : 0)
    const carry: Carry = { load: lastSaved?.load_lb ?? '' }
    return Array.from({ length: count }, () => ({ key: nextPendingKey++, carry, focus: false }))
  })

  const addRow = () => {
    const last = pending.at(-1)?.carry ?? { load: lastSaved?.load_lb ?? '' }
    setPending((rows) => [...rows, { key: nextPendingKey++, carry: last, focus: true }])
  }

  return (
    <div>
      {/* Four columns, the order the lifter types in: set, load, reps, RIR. */}
      <table className="w-full max-w-[28rem] table-fixed border-separate border-spacing-x-0 border-spacing-y-[3px] [&_td:not(:first-child):not(:last-child)]:pr-1" aria-label={`Sets, ${exerciseName}`}>
        <colgroup>
          <col className="w-10" />
          <col className="w-[6rem]" />
          <col className="w-[4.75rem]" />
          <col className="w-[4.75rem]" />
          <col />
        </colgroup>
        <thead>
          <tr className="text-left text-[12px] text-muted-foreground [&>th]:pb-1.5 [&>th:not(:last-child)]:border-b [&>th:not(:last-child)]:border-border">
            <th className="font-medium">Set</th>
            <th className="pr-3 text-right font-semibold text-emerald-800">lb</th>
            <th className="pr-3 text-right font-medium">Reps</th>
            <th className="pr-3 text-right font-medium">RIR</th>
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
              fresh={!initial.has(performed.id)}
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
          className="press mt-1.5 -ml-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50"
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
