import { openTestDatabase } from '@/data/db/test-database';
import { PROGRAM } from '@/data/program';
import { openWorkout, addSet, workoutForDay } from '@/data/repo/workouts';
import { loadHomeFacts } from '@/data/facts-source';

test('double Start and double Log set', async () => {
  const db = await openTestDatabase();
  const plan = PROGRAM.workouts[0];
  const date = '2026-10-05';
  await db.run("INSERT INTO training_block (program_key, start_on, set_at) VALUES (?, ?, ?)", [PROGRAM.key, '2026-10-01', 'x']);
  const a = openWorkout(db, date, plan, '2026-10-05T10:00:00.000Z');
  await new Promise((r) => setTimeout(r, 0));
  const b = openWorkout(db, date, plan, '2026-10-05T10:00:00.001Z');
  const [ra, rb] = await Promise.all([a, b]);
  const n = await db.all<{ id: number }>('SELECT id FROM workout');
  console.log('drafts after double Start:', n.length, ra.workout.id, rb.workout.id);
  const id = rb.workout.id;
  const s1 = addSet(db, id, { slotKey: plan.exercises[0].slotKey }, { loadG: 1000, reps: 5, rir: 2 }, '2026-10-05T10:01:00.000Z');
  await new Promise((r) => setTimeout(r, 0));
  const s2 = addSet(db, id, { slotKey: plan.exercises[0].slotKey }, { loadG: 1000, reps: 5, rir: 2 }, '2026-10-05T10:01:00.001Z');
  const res = await Promise.allSettled([s1, s2]);
  console.log('double Log set:', res.map((r) => r.status + (r.status === 'rejected' ? ' ' + (r.reason as Error).message : '')));
  const sets = await db.all('SELECT workout_id, set_order FROM performed_set');
  console.log('sets:', JSON.stringify(sets));
  const logger = await workoutForDay(db, date, plan.key);
  const home = await loadHomeFacts(db, date);
  console.log('logger opens', logger?.id, 'home week entry', JSON.stringify(home.week.find((w) => w.date === date)));
});
