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

// --- V2: week, bodyweight, nutrition, history ------------------------------------------

export type SessionStatus = 'complete' | 'draft' | 'not_started'

export interface WeekSession {
  planned_workout_id: string
  workout_key: string
  name: string
  day_label: string | null
  slot_count: number
  set_count: number
  status: SessionStatus
  workout_id: string | null
  workout_on: string | null
}

export interface WeekDay {
  date: string
  weekday: string
  sessions: WeekSession[]
  unplanned: { workout_id: string; status: WorkoutStatus }[]
}

export interface Week {
  date: string
  week_start: string
  week_end: string
  program: { id: string; name: string; version_label: string | null; duration_weeks: number | null } | null
  block: { start_on: string; week: number; weeks: number | null } | null
  days: WeekDay[]
  unscheduled: WeekSession[]
}

export interface BodyweightEntry {
  measured_on: string
  bodyweight_kg: string
  notes: string | null
}

export interface BodyweightSummary {
  reference_on: string
  latest: { measured_on: string; bodyweight_kg: string } | null
  current_avg_kg: string | null
  current_count: number
  previous_avg_kg: string | null
  previous_count: number
  change_kg: string | null
  change_pct: string | null
}

export interface SeriesPoint {
  date: string
  bodyweight_kg: string | null
  avg7_kg: string | null
}

export interface Bodyweight {
  entries: BodyweightEntry[]
  summary: BodyweightSummary
  series: SeriesPoint[]
}

export interface NutritionDay {
  logged_on: string
  calories_kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  notes: string | null
}

export interface NutritionTargets {
  protein_g: number
  fat_g: number
  calories_kcal: number | null
  carbs_g: number | null
  calorie_target_effective_on: string | null
}

export interface CalorieTarget {
  id: string
  effective_on: string
  calories_kcal: number
  notes: string | null
  set_at_utc: string
}

export interface Nutrition {
  date: string
  day: NutritionDay | null
  targets: NutritionTargets
  recent: NutritionDay[]
  target_history: CalorieTarget[]
}

export interface NutritionFields {
  calories_kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  notes: string | null
}

export interface HistoryExercise {
  exercise: Exercise
  exposures: number
  last_performed_on: string
}

export interface Exposure {
  workout_id: string
  performed_on: string
  performed_time_local: string | null
  planned_workout_name: string | null
  block_week: number | null
  sets: PerformedSet[]
}

export interface ExerciseHistory {
  exercise: Exercise
  block_start_on: string | null
  exposures: Exposure[]
}

export interface RecentSession {
  workout_id: string
  performed_on: string
  performed_time_local: string | null
  planned_workout_name: string | null
  exercises: { exercise: Exercise; sets: PerformedSet[] }[]
}
