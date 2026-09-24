import { vi } from 'vitest'
import type {
  ActiveProgram,
  Bodyweight,
  Entry,
  Exercise,
  Nutrition,
  NutritionReview,
  Week,
  WeekSession,
} from '@/api/types'

export interface Call {
  method: string
  url: string
  body: unknown
}

type Reply = { status?: number; body?: unknown } | undefined
type Handler = (call: Call) => Reply | Promise<Reply>

/** Routes fetch() by "METHOD /path" and records every call for assertions. */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    const call = { method, url, body }
    calls.push(call)
    const handler = routes[`${method} ${url.split('?')[0]}`]
    if (!handler) throw new Error(`unexpected ${method} ${url}`)
    const result = (await handler(call)) ?? {}
    const status = result.status ?? 200
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify(result.body ?? null), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

export const SYSTEM_ROUTES: Record<string, Handler> = {
  'GET /api/health': () => ({ body: { status: 'ok', service: 'fitness-lab', version: '0.1.0' } }),
  'GET /api/ping-db': () => ({
    body: {
      status: 'ok',
      source: 'sqlite',
      row_id: 1,
      token: 'sqlite-roundtrip-ok',
      created_at: 'x',
      sqlite_version: '3.53.4',
    },
  }),
}

export const BENCH: Exercise = {
  id: 'bench',
  name: 'Smith Flat Bench Press',
  equipment_label: null,
  notes: null,
  is_active: true,
}
export const INCLINE: Exercise = {
  id: 'incline',
  name: 'Incline Smith Press',
  equipment_label: null,
  notes: null,
  is_active: true,
}
export const CURL: Exercise = {
  id: 'curl',
  name: 'Preacher Curl',
  equipment_label: null,
  notes: null,
  is_active: true,
}

export const PROGRAM: ActiveProgram = {
  version: {
    id: 'v1',
    program_key: 'advanced-natural-12w',
    name: '12-Week Advanced Natural Hypertrophy + Strength Program',
    version_label: '1.0.0',
    duration_weeks: 12,
    package_sha256: 'a'.repeat(64),
    imported_at_utc: 'x',
  },
  activated_at_utc: 'x',
  notes_text: '# Guidance',
  planned_workouts: [
    {
      id: 'pw-upper',
      workout_key: 'upper_a',
      sequence: 1,
      name: 'Upper A',
      day_label: 'Monday',
      notes: null,
      slot_count: 9,
      set_count: 23,
      open_draft_id: null,
      open_draft_performed_on: null,
      completed_count: 0,
      last_completed_on: null,
    },
    {
      id: 'pw-lower',
      workout_key: 'lower_a',
      sequence: 2,
      name: 'Lower A',
      day_label: 'Tuesday',
      notes: null,
      slot_count: 6,
      set_count: 18,
      open_draft_id: 'draft-1',
      open_draft_performed_on: '2026-10-06',
      completed_count: 2,
      last_completed_on: '2026-10-06',
    },
  ],
}

export function entryFixture(overrides: Partial<Entry> = {}): Entry {
  return {
    workout: {
      id: 'w1',
      performed_on: '2026-10-05',
      performed_time_local: null,
      status: 'draft',
      notes: null,
      entered_at_utc: 'x',
      updated_at_utc: 'x',
    },
    origin: {
      planned_workout_id: 'pw-upper',
      planned_workout_name: 'Upper A',
      workout_key: 'upper_a',
      day_label: 'Monday',
      program_version_id: 'v1',
      program_name: '12-Week Advanced Natural Hypertrophy + Strength Program',
      version_label: '1.0.0',
    },
    slots: [
      {
        id: 'slot-1',
        slot_key: 'upper_a.01',
        position: 1,
        exercise_id: 'bench',
        notes: 'Marker lift (week-12 benchmark).',
        sets: [
          {
            id: 'ps1',
            position: 1,
            set_type: 'working',
            reps_min: 5,
            reps_max: 8,
            target_rir_min: 2,
            target_rir_max: 2,
            target_load_lb: null,
            notes: null,
          },
          {
            id: 'ps2',
            position: 2,
            set_type: 'working',
            reps_min: 5,
            reps_max: 8,
            target_rir_min: 0,
            target_rir_max: 1,
            target_load_lb: null,
            notes: null,
          },
        ],
        substitute_exercise_id: null,
        effective_exercise_id: 'bench',
      },
    ],
    sets: [],
    exercises: { bench: BENCH },
    last_performance: {
      bench: {
        workout_id: 'w0',
        performed_on: '2026-09-28',
        performed_time_local: null,
        planned_workout_name: 'Upper A',
        sets: [
          {
            id: 'old-1',
            workout_id: 'w0',
            exercise_id: 'bench',
            set_order: 1,
            set_type: 'working',
            load_lb: '80',
            reps: 6,
            rir: 2,
            notes: null,
            entered_at_utc: 'x',
            updated_at_utc: 'x',
          },
        ],
      },
    },
    work_sets: { planned: 2, actual: 0, short: true },
    ...overrides,
  }
}

export function session(overrides: Partial<WeekSession>): WeekSession {
  return {
    planned_workout_id: 'pw-upper',
    workout_key: 'upper_a',
    name: 'Upper A',
    day_label: 'Monday',
    slot_count: 9,
    set_count: 23,
    status: 'not_started',
    workout_id: null,
    workout_on: null,
    planned_work_sets: 23,
    actual_work_sets: null,
    open_draft_id: null,
    open_draft_on: null,
    ...overrides,
  }
}

/** Week of Mon 5 – Sun 11 Oct 2026, block week 2: Upper A done, Lower A a draft. */
export const WEEK: Week = {
  date: '2026-10-07',
  today: '2026-10-07',
  is_current_week: true,
  week_start: '2026-10-05',
  week_end: '2026-10-11',
  program: {
    id: 'v1',
    name: '12-Week Advanced Natural Hypertrophy + Strength Program',
    version_label: '1.0.0',
    duration_weeks: 12,
  },
  block: { start_on: '2026-10-01', week: 2, weeks: 12, phase: 'block' },
  days: [
    {
      date: '2026-10-05',
      weekday: 'Monday',
      phase: 'block',
      sessions: [
        session({ status: 'complete', workout_id: 'w-done', workout_on: '2026-10-05', actual_work_sets: 23 }),
      ],
      unplanned: [],
    },
    {
      date: '2026-10-06',
      weekday: 'Tuesday',
      phase: 'block',
      sessions: [
        session({
          planned_workout_id: 'pw-lower',
          workout_key: 'lower_a',
          name: 'Lower A',
          day_label: 'Tuesday',
          status: 'draft',
          workout_id: 'draft-1',
          workout_on: '2026-10-06',
          planned_work_sets: 18,
          actual_work_sets: 4,
          open_draft_id: 'draft-1',
          open_draft_on: '2026-10-06',
        }),
      ],
      unplanned: [],
    },
    { date: '2026-10-07', weekday: 'Wednesday', phase: 'block', sessions: [], unplanned: [] },
    {
      date: '2026-10-08',
      weekday: 'Thursday',
      phase: 'block',
      sessions: [
        session({ planned_workout_id: 'pw-upper-b', workout_key: 'upper_b', name: 'Upper B', day_label: 'Thursday' }),
      ],
      unplanned: [],
    },
    {
      date: '2026-10-09',
      weekday: 'Friday',
      phase: 'block',
      sessions: [
        session({ planned_workout_id: 'pw-lower-b', workout_key: 'lower_b', name: 'Lower B', day_label: 'Friday' }),
      ],
      unplanned: [],
    },
    { date: '2026-10-10', weekday: 'Saturday', phase: 'block', sessions: [], unplanned: [] },
    { date: '2026-10-11', weekday: 'Sunday', phase: 'block', sessions: [], unplanned: [] },
  ],
  unscheduled: [],
  open_drafts: [],
}

export const BODYWEIGHT: Bodyweight = {
  entries: [
    { measured_on: '2026-10-07', bodyweight_kg: '72.6', notes: null },
    { measured_on: '2026-10-06', bodyweight_kg: '72.4', notes: 'late dinner' },
  ],
  summary: {
    reference_on: '2026-10-07',
    latest: { measured_on: '2026-10-07', bodyweight_kg: '72.6' },
    current_avg_kg: '72.30',
    current_count: 7,
    previous_avg_kg: '71.60',
    previous_count: 6,
    change_kg: '0.70',
    change_pct: '0.98',
  },
  series: [
    { date: '2026-10-06', bodyweight_kg: '72.4', avg7_kg: '72.25' },
    { date: '2026-10-07', bodyweight_kg: '72.6', avg7_kg: '72.30' },
  ],
  trend: {
    window_first: '2026-09-24',
    window_last: '2026-10-07',
    weigh_ins: 2,
    first_half: 0,
    second_half: 2,
    pct_bw_per_week: null,
    qualified: false,
    band: null,
  },
}

export const NUTRITION: Nutrition = {
  date: '2026-10-07',
  day: { logged_on: '2026-10-07', calories_kcal: 2318, calories_complete: true, protein_g: 150, carbs_g: 290, fat_g: 62, notes: null },
  targets: { protein_g: 145, fat_g: 60, calories_kcal: null, carbs_g: null, calorie_target_effective_on: null },
  recent: [{ logged_on: '2026-10-07', calories_kcal: 2318, calories_complete: true, protein_g: 150, carbs_g: 290, fat_g: 62, notes: null }],
  target_history: [],
}

/** A review not due: block week 1, nothing to decide yet. */
export const REVIEW: NutritionReview = {
  available: true,
  reason: null,
  today: '2026-10-07',
  block_start_on: '2026-10-01',
  weeks_in_block: 12,
  review: {
    phase: 'early',
    block_week: 1,
    week_start: '2026-09-28',
    week_end: '2026-10-04',
    trend: null,
    status: 'INSUFFICIENT_DATA',
    sustained: null,
    decision_due: false,
    already_decided: false,
    next_decision_week: 3,
    next_decision_on: '2026-10-18',
    recommended_action: null,
    recommended_delta_kcal: null,
    current_target_kcal: null,
    recommended_target_kcal: null,
    recommended_carbs_g: null,
    failed_corrections: 0,
    note: 'Weeks 1-2: no routine bodyweight-driven changes.',
    decision: null,
  },
  weeks: [],
  decisions: [],
  gates: [],
  gate_checks: [
    'tracking_method_consistent',
    'food_logging_consistent',
    'restaurant_unlogged_intake_reviewed',
    'weighing_protocol_consistent',
    'activity_NEAT_changed',
    'training_workload_changed',
    'sleep_recovery_changed',
    'illness_travel',
    'adherence_consistent',
  ],
  reliability_checks: [
    'tracking_method_consistent',
    'food_logging_consistent',
    'restaurant_unlogged_intake_reviewed',
    'weighing_protocol_consistent',
    'adherence_consistent',
  ],
  week_1_2_exceptions: ['GI intolerance', 'obvious logging error', 'illness', 'clearly falling trend', 'implementation mistake'],
}

/** Routes the home screen reads, answering every date with the fixtures above. */
export const HOME_ROUTES: Record<string, Handler> = {
  'GET /api/nutrition/review': () => ({ body: REVIEW }),
  'GET /api/week': () => ({ body: WEEK }),
  'GET /api/bodyweight': () => ({ body: BODYWEIGHT }),
  'GET /api/nutrition': () => ({ body: NUTRITION }),
  'GET /api/history/recent': () => ({ body: [] }),
}
