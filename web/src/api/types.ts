// Mirrors backend/src/fitness_lab/api/schemas.py. Loads are decimal strings, never numbers.

export type SetType = 'warmup' | 'working' | 'backoff'
export type WorkoutStatus = 'draft' | 'complete'

export interface Exercise {
  id: string
  name: string
  equipment_label: string | null
  notes: string | null
  is_active: boolean
}

export interface Workout {
  id: string
  performed_on: string
  performed_time_local: string | null
  status: WorkoutStatus
  notes: string | null
  entered_at_utc: string
  updated_at_utc: string
}

export interface PerformedSet {
  id: string
  workout_id: string
  exercise_id: string
  set_order: number
  set_type: SetType | null
  load_kg: string | null
  reps: number | null
  rir: number | null
  notes: string | null
  entered_at_utc: string
  updated_at_utc: string
}

export interface Origin {
  planned_workout_id: string
  planned_workout_name: string
  workout_key: string
  day_label: string | null
  program_version_id: string
  program_name: string
  version_label: string | null
}

export interface PlannedSet {
  id: string
  position: number
  set_type: SetType
  reps_min: number
  reps_max: number | null
  target_rir_min: number | null
  target_rir_max: number | null
  target_load_kg: string | null
  notes: string | null
}

export interface Slot {
  id: string
  slot_key: string
  position: number
  exercise_id: string
  notes: string | null
  sets: PlannedSet[]
}

export interface EntrySlot extends Slot {
  substitute_exercise_id: string | null
  effective_exercise_id: string
}

export interface LastPerformance {
  workout_id: string
  performed_on: string
  performed_time_local: string | null
  planned_workout_name: string | null
  sets: PerformedSet[]
}

export interface Entry {
  workout: Workout
  origin: Origin | null
  slots: EntrySlot[]
  sets: PerformedSet[]
  exercises: Record<string, Exercise>
  last_performance: Record<string, LastPerformance | null>
}

export interface ProgramVersion {
  id: string
  program_key: string
  name: string
  version_label: string | null
  duration_weeks: number | null
  package_sha256: string
  imported_at_utc: string
}

export interface PlannedWorkoutSummary {
  id: string
  workout_key: string
  sequence: number
  name: string
  day_label: string | null
  notes: string | null
  slot_count: number
  set_count: number
  open_draft_id: string | null
  open_draft_performed_on: string | null
  completed_count: number
  last_completed_on: string | null
}

export interface ActiveProgram {
  version: ProgramVersion | null
  activated_at_utc: string | null
  notes_text: string | null
  planned_workouts: PlannedWorkoutSummary[]
}

export interface OpenResult {
  workout_id: string
  created: boolean
  workout: Workout
  origin: Origin | null
}

export interface WorkoutSummary extends Workout {
  planned_workout_id: string | null
  origin_name: string | null
  set_count: number
}

export interface CompletionIssue {
  rule: string
  message: string
  set_orders: number[]
}

export interface CompleteResult {
  workout: Workout
  advisories: CompletionIssue[]
  renumbered: boolean
}

export interface SetFields {
  set_type?: SetType | null
  load_kg?: string | null
  reps?: number | null
  rir?: number | null
  notes?: string | null
  exercise_id?: string
}
