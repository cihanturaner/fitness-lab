import type {
  ActiveProgram,
  Backup,
  BlockStartResult,
  GateAudit,
  NutritionReview,
  ReviewDecision,
  Bodyweight,
  BodyweightEntry,
  HistoryDays,
  HistoryKind,
  MacroTarget,
  MacroTargetFields,
  ExerciseHistory,
  HistoryExercise,
  Nutrition,
  NutritionDay,
  NutritionFields,
  RecentSession,
  Week,
  CompleteResult,
  CompletionIssue,
  Entry,
  Exercise,
  LastPerformance,
  OpenResult,
  PerformedSet,
  SetFields,
  Workout,
  WorkoutSummary,
} from './types'

/** A refused request. `blockers` carries completion rules C1–C4 when the API sent them. */
export class ApiError extends Error {
  readonly status: number
  readonly blockers: CompletionIssue[]

  constructor(status: number, message: string, blockers: CompletionIssue[] = []) {
    super(message)
    this.status = status
    this.blockers = blockers
  }
}

function describe(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item: { loc?: unknown[]; msg?: string }) =>
        [item.loc?.slice(1).join('.'), item.msg].filter(Boolean).join(': '),
      )
      .join('; ')
  }
  return 'The request was refused.'
}

const UNREACHABLE = 'The local fitness-lab server could not be reached. Is it still running?'

function parse(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  let text: string
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // Always drain the body, even for 204: an unread response stream is cancelled (and
    // reported as a failed request) when the page navigates away.
    text = await response.text()
  } catch {
    throw new ApiError(0, UNREACHABLE)
  }
  if (response.status === 204) return undefined as T
  const payload = parse(text)
  if (!response.ok && payload === null) {
    throw new ApiError(response.status, `The server answered ${response.status}; reload to see what was stored.`)
  }
  if (!response.ok) {
    const record = (payload ?? {}) as { detail?: unknown; blockers?: CompletionIssue[] }
    throw new ApiError(response.status, describe(record.detail), record.blockers ?? [])
  }
  return payload as T
}

export const api = {
  activeProgram: () => request<ActiveProgram>('GET', '/api/program/active'),
  openPlanned: (plannedWorkoutId: string, performedOn: string) =>
    request<OpenResult>('POST', `/api/planned-workouts/${plannedWorkoutId}/open`, {
      performed_on: performedOn,
    }),
  createWorkout: (performedOn: string) =>
    request<Workout>('POST', '/api/workouts', { performed_on: performedOn }),
  recentWorkouts: (limit = 200) => request<WorkoutSummary[]>('GET', `/api/workouts?limit=${limit}`),
  entry: (workoutId: string) => request<Entry>('GET', `/api/workouts/${workoutId}/entry`),
  patchWorkout: (
    workoutId: string,
    fields: { performed_on?: string; performed_time_local?: string | null; notes?: string | null },
  ) => request<Workout>('PATCH', `/api/workouts/${workoutId}`, fields),
  discardWorkout: (workoutId: string) => request<void>('DELETE', `/api/workouts/${workoutId}`),
  complete: (workoutId: string) =>
    request<CompleteResult>('POST', `/api/workouts/${workoutId}/complete`),
  reopen: (workoutId: string) => request<Workout>('POST', `/api/workouts/${workoutId}/reopen`),
  addSet: (workoutId: string, fields: SetFields & { exercise_id: string; slot_id?: string | null }) =>
    request<PerformedSet>('POST', `/api/workouts/${workoutId}/sets`, fields),
  patchSet: (setId: string, fields: SetFields) =>
    request<PerformedSet>('PATCH', `/api/sets/${setId}`, fields),
  deleteSet: (setId: string) => request<void>('DELETE', `/api/sets/${setId}`),
  reorderSets: (workoutId: string, setIds: string[]) =>
    request<PerformedSet[]>('PUT', `/api/workouts/${workoutId}/set-order`, { set_ids: setIds }),
  setSlotExercise: (workoutId: string, slotId: string, exerciseId: string) =>
    request<Entry>('PUT', `/api/workouts/${workoutId}/slots/${slotId}/exercise`, {
      exercise_id: exerciseId,
    }),
  useApprovedSubstitute: (workoutId: string, slotId: string, name: string) =>
    request<Entry>('PUT', `/api/workouts/${workoutId}/slots/${slotId}/approved-substitute`, { name }),
  /** A typed exercise name: found (case/space-insensitive) or created, for this workout only. */
  useTypedExercise: (workoutId: string, slotId: string, name: string) =>
    request<Entry>('PUT', `/api/workouts/${workoutId}/slots/${slotId}/typed-exercise`, { name }),
  exercises: () => request<Exercise[]>('GET', '/api/exercises?include_inactive=true'),
  createExercise: (name: string, equipmentLabel: string | null) =>
    request<Exercise>('POST', '/api/exercises', { name, equipment_label: equipmentLabel }),
  lastPerformance: (exerciseId: string) =>
    request<LastPerformance | null>('GET', `/api/exercises/${exerciseId}/last-performance`),
  week: (date: string, today: string = date) => request<Week>('GET', `/api/week?date=${date}&today=${today}`),
  bodyweight: (date: string, days = 90) =>
    request<Bodyweight>('GET', `/api/bodyweight?date=${date}&days=${days}`),
  putBodyweight: (date: string, bodyweightKg: string, notes: string | null) =>
    request<BodyweightEntry>('PUT', `/api/bodyweight/${date}`, { bodyweight_kg: bodyweightKg, notes }),
  deleteBodyweight: (date: string) => request<void>('DELETE', `/api/bodyweight/${date}`),
  nutrition: (date: string) => request<Nutrition>('GET', `/api/nutrition?date=${date}`),
  putNutrition: (date: string, fields: NutritionFields) =>
    request<NutritionDay>('PUT', `/api/nutrition/${date}`, fields),
  deleteNutrition: (date: string) => request<void>('DELETE', `/api/nutrition/${date}`),
  addMacroTarget: (fields: MacroTargetFields) => request<MacroTarget>('POST', '/api/nutrition/targets', fields),
  historyDays: (kind: HistoryKind, before: string | null = null, limit = 21) =>
    request<HistoryDays>(
      'GET',
      `/api/history/days?kind=${kind}&limit=${limit}${before ? `&before=${before}` : ''}`,
    ),
  historyExercises: () => request<HistoryExercise[]>('GET', '/api/history/exercises'),
  exerciseHistory: (exerciseId: string) =>
    request<ExerciseHistory>('GET', `/api/exercises/${exerciseId}/history`),
  recentTraining: (limit = 3) => request<RecentSession[]>('GET', `/api/history/recent?limit=${limit}`),
  nutritionReview: (date: string, compositionConcern = false) =>
    request<NutritionReview>(
      'GET',
      `/api/nutrition/review?date=${date}${compositionConcern ? '&composition_concern=true' : ''}`,
    ),
  decideReview: (fields: {
    date: string
    block_week: number
    choice: 'APPLIED' | 'KEPT'
    expected_status: string
    expected_delta_kcal: number | null
    expected_target_kcal: number | null
    expected_macros: { protein_g: number; carbs_g: number; fat_g: number } | null
    composition_concern: boolean
    notes: string | null
  }) => request<ReviewDecision>('POST', '/api/nutrition/review/decision', fields),
  recordGate: (fields: {
    date: string
    block_week: number
    checks: Record<string, boolean>
    result: GateAudit['result']
    notes: string | null
  }) => request<GateAudit>('POST', '/api/nutrition/review/gate', fields),
  putBlockStart: (startOn: string) =>
    request<BlockStartResult>('PUT', '/api/program/block-start', { start_on: startOn }),
  backup: () => request<Backup>('POST', '/api/backup', {}),
  backups: () => request<Backup[]>('GET', '/api/backups'),
}
