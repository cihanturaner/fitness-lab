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
  /** Pounds, as the server renders the stored grams ("225", "72.75"). */
  load_lb: string | null
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
  target_load_lb: string | null
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
  /** Planned non-warm-up sets of the origin vs those recorded; null when unplanned. */
  work_sets: WorkSets | null
}

export interface WorkSets {
  planned: number
  actual: number
  short: boolean
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
  work_set_count: number
  planned_work_sets: number | null
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
  load_lb?: string | null
  reps?: number | null
  rir?: number | null
  notes?: string | null
  exercise_id?: string
}

// --- V2: week, bodyweight, nutrition, history ------------------------------------------

export type SessionStatus = 'complete' | 'draft' | 'not_started'
export type BlockPhase = 'pre_block' | 'block' | 'post_block'

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
  planned_work_sets: number
  /** Non-warm-up sets recorded in the workout shown; null when none is shown. */
  actual_work_sets: number | null
  /** The planned workout's open draft whatever its date (Start resumes it). */
  open_draft_id: string | null
  open_draft_on: string | null
}

export interface OpenDraft {
  workout_id: string
  planned_workout_id: string
  name: string
  performed_on: string
  block_week: number | null
}

export interface WeekDay {
  date: string
  weekday: string
  phase: BlockPhase | null
  sessions: WeekSession[]
  unplanned: { workout_id: string; status: WorkoutStatus }[]
}

export interface Week {
  date: string
  today: string
  is_current_week: boolean
  week_start: string
  week_end: string
  program: { id: string; name: string; version_label: string | null; duration_weeks: number | null } | null
  /** `week` and `phase` are those of `date`; a day of week 1 before the start is pre-block. */
  block: { start_on: string; week: number; weeks: number | null; phase: BlockPhase } | null
  days: WeekDay[]
  unscheduled: WeekSession[]
  open_drafts: OpenDraft[]
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

export interface BodyweightTrend {
  window_first: string
  window_last: string
  weigh_ins: number
  first_half: number
  second_half: number
  pct_bw_per_week: string | null
  qualified: boolean
  band: string | null
}

export interface Bodyweight {
  entries: BodyweightEntry[]
  summary: BodyweightSummary
  series: SeriesPoint[]
  trend: BodyweightTrend
}

export interface NutritionDay {
  logged_on: string
  /** Derived by the server: protein × 4 + carbs × 4 + fat × 9. Never entered. */
  calories_kcal: number
  /** False when a macro is unrecorded: the total covers the recorded macros only. */
  calories_complete: boolean
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
  phase: BlockPhase | null
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
  planned_work_sets: number | null
  actual_work_sets: number
  exercises: { exercise: Exercise; sets: PerformedSet[] }[]
}

// --- V3: nutrition review, settings ---------------------------------------------------

export type ReviewStatus =
  | 'INSUFFICIENT_DATA'
  | 'UNDER_GAIN'
  | 'IN_RANGE'
  | 'OVER_GAIN'
  | 'DIAGNOSTIC_GATE'
  | 'COMPOSITION_REASSESSMENT'
  | 'UNKNOWN'

export interface ReviewTrend {
  window_first: string
  window_last: string
  weigh_ins: number
  first_half: number
  second_half: number
  pct_bw_per_week: string | null
  reason: 'OK' | 'TOO_FEW_WEIGH_INS' | 'WAITING_FOR_NEW_TREND'
  band: string | null
}

export interface ReviewDecision {
  id: string
  block_week: number
  decided_on: string
  trend_pct_bw_per_week: string
  weigh_ins: number
  status: ReviewStatus
  recommended_action: string
  recommended_delta_kcal: number | null
  previous_calorie_target_kcal: number
  user_choice: 'APPLIED' | 'KEPT'
  new_calorie_target_kcal: number | null
  composition_concern: boolean
  notes: string | null
  recorded_at_utc: string
}

export interface GateAudit {
  id: string
  block_week: number
  decided_on: string
  checks: Record<string, boolean>
  result: 'GENUINE_UNDERFEEDING_CONFIRMED' | 'INPUTS_UNRELIABLE'
  notes: string | null
  recorded_at_utc: string
}

export interface Review {
  phase: 'pre_block' | 'early' | 'decision' | 'post_block'
  block_week: number | null
  week_start: string | null
  week_end: string | null
  trend: ReviewTrend | null
  status: ReviewStatus
  sustained: boolean | null
  decision_due: boolean
  already_decided: boolean
  next_decision_week: number | null
  next_decision_on: string | null
  recommended_action: string | null
  recommended_delta_kcal: number | null
  current_target_kcal: number | null
  recommended_target_kcal: number | null
  recommended_carbs_g: number | null
  failed_corrections: number
  note: string | null
  decision: ReviewDecision | null
}

export interface ReviewWeek {
  block_week: number
  week_end: string
  avg7_kg: string | null
  avg7_count: number
  trend: ReviewTrend
  target_kcal: number | null
  decision: ReviewDecision | null
}

export interface NutritionReview {
  available: boolean
  reason: 'no_program' | 'no_block' | null
  today: string
  block_start_on: string | null
  weeks_in_block: number | null
  review: Review | null
  weeks: ReviewWeek[]
  decisions: ReviewDecision[]
  gates: GateAudit[]
  gate_checks: string[]
  reliability_checks: string[]
  week_1_2_exceptions: string[]
}

export interface BlockStartResult {
  version_id: string
  start_on: string
  week_1_start: string
  week_1_end: string
}

export interface Backup {
  name: string
  kind: 'manual' | 'pre-migration' | 'pre-delete' | 'other'
  created_at_utc: string
  size_bytes: number
}
