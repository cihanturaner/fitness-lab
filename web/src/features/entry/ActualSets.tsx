import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PerformedSet, PlannedSet, SetFields, SetType } from '@/api/types'
import { Button } from '@/components/ui/button'
import { describeSet, formatReps, formatRir, setTypeLabel } from '@/lib/format'
import { markUnsaved, useUnsavedKey } from '@/lib/unsaved'
import { CommitInput } from './fields'
import { moveWithinExercise } from './model'
import { numberInputClass, parseCount, parseLoad, textInputClass } from './parse'

const SET_TYPES: SetType[] = ['warmup', 'working', 'backoff']

export interface SetActions {
  add: (exerciseId: string, fields: SetFields) => Promise<boolean>
  patch: (setId: string, fields: SetFields) => Promise<boolean>
  remove: (setId: string) => void
  reorder: (setIds: string[]) => void
}

const validLoad = (text: string) => parseLoad(text).ok
const validReps = (text: string) => parseCount(text, { allowNegative: false }).ok
const validRir = (text: string) => parseCount(text, { allowNegative: true }).ok

const LOAD_HINT = 'kilograms with up to 3 decimals, e.g. 82.5'
const COUNT_HINT = 'a whole number'

function SetRow({
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
  const context = `${exerciseName} ${label}`
  const up = moveWithinExercise(allSets, performed.id, -1)
  const down = moveWithinExercise(allSets, performed.id, 1)
  const commitCount = (field: 'reps' | 'rir', text: string) => {
    const parsed = parseCount(text, { allowNegative: field === 'rir' })
    return parsed.ok ? actions.patch(performed.id, { [field]: parsed.value }) : Promise.resolve(false)
  }

  return (
    <tr data-testid="set-row" className="border-b border-border/70 last:border-b-0">
      <td className="num w-8 py-1.5 pr-2 text-sm text-muted-foreground">{index + 1}</td>
      <td className="w-32 py-1.5 pr-2">
        <select
          aria-label={`Set type, ${label}`}
          className={textInputClass}
          value={performed.set_type ?? ''}
          disabled={locked}
          onChange={(event) =>
            void actions.patch(performed.id, {
              set_type: event.target.value === '' ? null : (event.target.value as SetType),
            })
          }
        >
          {performed.set_type === null && <option value="">Unclassified</option>}
          {SET_TYPES.map((code) => (
            <option key={code} value={code}>
              {setTypeLabel(code)}
            </option>
          ))}
        </select>
      </td>
      <td className="w-24 py-1.5 pr-2">
        <CommitInput
          label={`Load in kg, ${label}`}
          context={exerciseName}
          value={performed.load_kg ?? ''}
          inputMode="decimal"
          disabled={locked}
          isValid={validLoad}
          invalidHint={LOAD_HINT}
          onCommit={(text) => {
            const parsed = parseLoad(text)
            return parsed.ok ? actions.patch(performed.id, { load_kg: parsed.value }) : Promise.resolve(false)
          }}
        />
      </td>
      <td className="w-20 py-1.5 pr-2">
        <CommitInput
          label={`Reps, ${label}`}
          context={exerciseName}
          value={performed.reps === null ? '' : String(performed.reps)}
          inputMode="numeric"
          disabled={locked}
          isValid={validReps}
          invalidHint={COUNT_HINT}
          onCommit={(text) => commitCount('reps', text)}
        />
      </td>
      <td className="w-20 py-1.5 pr-2">
        <CommitInput
          label={`RIR, ${label}`}
          context={exerciseName}
          value={performed.rir === null ? '' : String(performed.rir)}
          inputMode="numeric"
          disabled={locked}
          isValid={validRir}
          invalidHint={`${COUNT_HINT} (negative allowed)`}
          onCommit={(text) => commitCount('rir', text)}
        />
      </td>
      <td className="py-1.5 pr-2">
        <CommitInput
          label={`Notes, ${label}`}
          context={exerciseName}
          value={performed.notes ?? ''}
          align="left"
          disabled={locked}
          onCommit={(text) => actions.patch(performed.id, { notes: text.trim() === '' ? null : text })}
        />
      </td>
      <td className="w-28 py-1.5 text-right whitespace-nowrap">
        {!locked && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${label} earlier`}
              isDisabled={up === null}
              onPress={() => up && actions.reorder(up)}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${label} later`}
              isDisabled={down === null}
              onPress={() => down && actions.reorder(down)}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${label}`}
              className="text-destructive"
              onPress={() => {
                if (window.confirm(`Delete ${context} (${describeSet(performed)})?`)) {
                  actions.remove(performed.id)
                }
              }}
            >
              ✕
            </Button>
          </>
        )}
      </td>
    </tr>
  )
}

function NewSetRow({
  exerciseId,
  exerciseName,
  nextIndex,
  planned,
  previousType,
  actions,
  onClose,
}: {
  exerciseId: string
  exerciseName: string
  nextIndex: number
  planned: PlannedSet | undefined
  previousType: SetType | null
  actions: SetActions
  onClose: () => void
}) {
  // Never taken from the plan: the first set of an exercise needs an explicit choice, later
  // sets offer the type the lifter chose for the previous one.
  const [setType, setSetType] = useState<SetType | ''>(previousType ?? '')
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const [load, setLoad] = useState('')
  const [reps, setReps] = useState('')
  const [rir, setRir] = useState('')
  const [notes, setNotes] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  // The load kept from the previous save is a convenience, not new input.
  const [keptLoad, setKeptLoad] = useState('')
  const loadRef = useRef<HTMLInputElement>(null)
  const label = `new set ${nextIndex + 1}`
  const unsavedKey = useUnsavedKey()
  const dirty =
    reps.trim() !== '' || rir.trim() !== '' || notes.trim() !== '' || (load.trim() !== '' && load !== keptLoad)
  useEffect(() => {
    markUnsaved(unsavedKey, dirty ? `${exerciseName} ${label} (typed, not saved)` : null)
  }, [unsavedKey, dirty, exerciseName, label])

  const close = () => {
    if (dirty && !window.confirm(`Discard the unsaved ${label} of ${exerciseName}?`)) return
    onClose()
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (inFlight.current) return
    const parsedLoad = parseLoad(load)
    const parsedReps = parseCount(reps, { allowNegative: false })
    const parsedRir = parseCount(rir, { allowNegative: true })
    if (!parsedLoad.ok) return setProblem('Load must be kilograms with up to 3 decimals, e.g. 82.5.')
    if (!parsedReps.ok || parsedReps.value === null) return setProblem('Enter reps to save the set.')
    if (!parsedRir.ok) return setProblem('RIR must be a whole number.')
    if (setType === '') return setProblem('Choose a set type.')
    setProblem(null)
    inFlight.current = true
    setSubmitting(true)
    const saved = await actions
      .add(exerciseId, {
        set_type: setType,
        load_kg: parsedLoad.value,
        reps: parsedReps.value,
        rir: parsedRir.value,
        notes: notes.trim() === '' ? null : notes,
      })
      .finally(() => {
        inFlight.current = false
        setSubmitting(false)
      })
    if (saved) {
      // Saved: nothing here is unsaved any more, even before React re-renders (Complete may
      // be reading the registry right now).
      markUnsaved(unsavedKey, null)
      // The next set usually repeats the load: keep it, selected, so typing replaces it.
      setLoad(parsedLoad.value ?? '')
      setKeptLoad(parsedLoad.value ?? '')
      setReps('')
      setRir('')
      setNotes('')
      requestAnimationFrame(() => loadRef.current?.select())
    }
  }

  const rirHint = planned ? formatRir(planned.target_rir_min, planned.target_rir_max) : null

  return (
    <tr className="bg-muted/50" data-testid="new-set-row">
      <td className="num w-8 py-1.5 pr-2 pl-1 text-sm text-muted-foreground">{nextIndex + 1}</td>
      <td className="py-1.5 pr-2">
        <select
          aria-label={`Set type, ${label}`}
          className={textInputClass}
          value={setType}
          autoFocus={setType === ''}
          onChange={(event) => setSetType(event.target.value as SetType | '')}
        >
          {setType === '' && <option value="">Choose type…</option>}
          {SET_TYPES.map((code) => (
            <option key={code} value={code}>
              {setTypeLabel(code)}
            </option>
          ))}
        </select>
      </td>
      <td className="py-1.5 pr-2">
        <input
          ref={loadRef}
          aria-label={`Load in kg, ${label}`}
          className={numberInputClass}
          inputMode="decimal"
          placeholder={planned?.target_load_kg ?? 'kg'}
          value={load}
          autoFocus={setType !== ''}
          onChange={(event) => setLoad(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          aria-label={`Reps, ${label}`}
          className={numberInputClass}
          inputMode="numeric"
          placeholder={planned ? formatReps(planned.reps_min, planned.reps_max) : 'reps'}
          value={reps}
          onChange={(event) => setReps(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          aria-label={`RIR, ${label}`}
          className={numberInputClass}
          inputMode="numeric"
          placeholder={rirHint ?? 'RIR'}
          value={rir}
          onChange={(event) => setRir(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          aria-label={`Notes, ${label}`}
          className={textInputClass}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
        />
        {problem && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {problem}
          </p>
        )}
      </td>
      <td className="py-1.5 text-right whitespace-nowrap">
        <Button size="sm" isDisabled={submitting} onPress={() => void submit()}>
          Save set
        </Button>
        <Button size="sm" variant="ghost" onPress={close}>
          Done
        </Button>
      </td>
    </tr>
  )
}

export function ActualSets({
  exerciseId,
  exerciseName,
  sets,
  allSets,
  planned,
  locked,
  actions,
  startOpen = false,
}: {
  exerciseId: string
  exerciseName: string
  sets: PerformedSet[]
  allSets: PerformedSet[]
  planned: PlannedSet[]
  locked: boolean
  actions: SetActions
  startOpen?: boolean
}) {
  const [adding, setAdding] = useState(startOpen)
  const showForm = adding && !locked

  return (
    <div className="flex flex-col gap-2">
      {sets.length === 0 && !showForm ? (
        <p className="text-sm text-muted-foreground">No sets recorded for {exerciseName} yet.</p>
      ) : (
        <table className="w-full" aria-label={`Actual sets, ${exerciseName}`}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-1 font-medium">#</th>
              <th className="pb-1 font-medium">Type</th>
              <th className="pb-1 pr-2 text-right font-medium">Load kg</th>
              <th className="pb-1 pr-2 text-right font-medium">Reps</th>
              <th className="pb-1 pr-2 text-right font-medium">RIR</th>
              <th className="pb-1 font-medium">Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sets.map((performed, index) => (
              <SetRow
                key={performed.id}
                performed={performed}
                index={index}
                exerciseName={exerciseName}
                allSets={allSets}
                locked={locked}
                actions={actions}
              />
            ))}
            {showForm && (
              <NewSetRow
                exerciseId={exerciseId}
                exerciseName={exerciseName}
                nextIndex={sets.length}
                // Hints follow the prescription, which lists work sets only: warm-ups
                // recorded before them do not shift which planned set comes next.
                planned={planned[sets.filter((recorded) => recorded.set_type !== 'warmup').length]}
                previousType={sets.at(-1)?.set_type ?? null}
                actions={actions}
                onClose={() => setAdding(false)}
              />
            )}
          </tbody>
        </table>
      )}
      {!locked && !showForm && (
        <div>
          <Button size="sm" variant="outline" onPress={() => setAdding(true)}>
            Add set
          </Button>
        </div>
      )}
    </div>
  )
}
