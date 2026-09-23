import { vi } from 'vitest'
import type { ActiveProgram, Bodyweight, Entry, Exercise, Nutrition, Week, WeekSession } from '@/api/types'

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
            target_load_kg: null,
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
            target_load_kg: null,
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
            load_kg: '80',
            reps: 6,
            rir: 2,
            notes: null,
            entered_at_utc: 'x',
            updated_at_utc: 'x',
          },
        ],
      },
    },
    ...overrides,
  }
}

function session(overrides: Partial<WeekSession>): WeekSession {
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
    ...overrides,
  }
}

/** Week of Mon 5 – Sun 11 Oct 2026, block week 2: Upper A done, Lower A a draft. */
export const WEEK: Week = {
  date: '2026-10-07',
  week_start: '2026-10-05',
  week_end: '2026-10-11',
  program: {
    id: 'v1',
    name: '12-Week Advanced Natural Hypertrophy + Strength Program',
    version_label: '1.0.0',
    duration_weeks: 12,
  },
  block: { start_on: '2026-10-01', week: 2, weeks: 12 },
  days: [
    {
      date: '2026-10-05',
      weekday: 'Monday',
      sessions: [session({ status: 'complete', workout_id: 'w-done', workout_on: '2026-10-05' })],
      unplanned: [],
    },
    {
      date: '2026-10-06',
      weekday: 'Tuesday',
      sessions: [
        session({
          planned_workout_id: 'pw-lower',
          workout_key: 'lower_a',
          name: 'Lower A',
          day_label: 'Tuesday',
          status: 'draft',
          workout_id: 'draft-1',
          workout_on: '2026-10-06',
        }),
      ],
      unplanned: [],
    },
    { date: '2026-10-07', weekday: 'Wednesday', sessions: [], unplanned: [] },
    {
      date: '2026-10-08',
      weekday: 'Thursday',
      sessions: [
        session({ planned_workout_id: 'pw-upper-b', workout_key: 'upper_b', name: 'Upper B', day_label: 'Thursday' }),
      ],
      unplanned: [],
    },
    {
      date: '2026-10-09',
      weekday: 'Friday',
      sessions: [
        session({ planned_workout_id: 'pw-lower-b', workout_key: 'lower_b', name: 'Lower B', day_label: 'Friday' }),
      ],
      unplanned: [],
    },
    { date: '2026-10-10', weekday: 'Saturday', sessions: [], unplanned: [] },
    { date: '2026-10-11', weekday: 'Sunday', sessions: [], unplanned: [] },
  ],
  unscheduled: [],
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
}

export const NUTRITION: Nutrition = {
  date: '2026-10-07',
  day: { logged_on: '2026-10-07', calories_kcal: 2410, protein_g: 150, carbs_g: 290, fat_g: 62, notes: null },
  targets: { protein_g: 145, fat_g: 60, calories_kcal: null, carbs_g: null, calorie_target_effective_on: null },
  recent: [{ logged_on: '2026-10-07', calories_kcal: 2410, protein_g: 150, carbs_g: 290, fat_g: 62, notes: null }],
  target_history: [],
}

/** Routes the home screen reads, answering every date with the fixtures above. */
export const HOME_ROUTES: Record<string, Handler> = {
  'GET /api/week': () => ({ body: WEEK }),
  'GET /api/bodyweight': () => ({ body: BODYWEIGHT }),
  'GET /api/nutrition': () => ({ body: NUTRITION }),
  'GET /api/history/recent': () => ({ body: [] }),
}
