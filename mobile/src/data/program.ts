import type { ProgramFacts } from './training-facts';

/**
 * The locked 12-week program as bundled with the app, transcribed mechanically from
 * programs/advanced-natural-12w/package/program.json: workout and slot keys, exercise names,
 * order, rep ranges, RIR and each slot's notes verbatim. Rest, failure and the marker flag
 * are read from those notes; approved substitutes are parsed from them at runtime
 * (`domain/substitutes.ts`). `training-fixture.test.ts` checks every field against the
 * package, so it cannot drift. The package states no muscle focus, so none is here.
 *
 * Planned is not performed: nothing here says what was lifted.
 */
export const PROGRAM: ProgramFacts = {
  key: 'advanced-natural-12w',
  name: '12-Week Advanced Natural Hypertrophy + Strength Program',
  versionLabel: '1.0.0',
  weeks: 12,
  workouts: [
    {
      key: 'upper_a',
      name: 'Upper A',
      weekday: 1,
      estimatedMinutes: { min: 85, max: 105 },
      exercises: [
        {
          slotKey: 'upper_a.01',
          name: 'Smith Flat Bench Press',
          marker: true,
          failure: 'prohibited',
          restSeconds: { min: 180, max: 240 },
          sets: [
            { reps: [5, 8], rir: [2, 2] },
            { reps: [5, 8], rir: [2, 2] },
            { reps: [5, 8], rir: [1, 1] },
          ],
          notes:
            'Marker lift (week-12 benchmark).\nFailure: prohibited.\nRest: 180–240 s.\nApproved substitutes: Barbell Bench Press, Stable Chest Press.',
        },
        {
          slotKey: 'upper_a.02',
          name: 'Chest-Supported Row',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 150, max: 180 },
          sets: [
            { reps: [6, 10], rir: [2, 2] },
            { reps: [6, 10], rir: [1, 1] },
            { reps: [6, 10], rir: [1, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 150–180 s.\nApproved substitutes: Supported Machine Row, Supported Cable Row.',
        },
        {
          slotKey: 'upper_a.03',
          name: 'Neutral-Grip Lat Pulldown',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 150, max: 150 },
          sets: [
            { reps: [8, 12], rir: [2, 2] },
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [1, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 150 s.\nApproved substitutes: Fixed Pulldown, Assisted Pull-Up, Weighted Pull-Up.',
        },
        {
          slotKey: 'upper_a.04',
          name: 'Incline Converging Machine Press',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 120 },
          sets: [
            { reps: [8, 12], rir: [2, 2] },
            { reps: [8, 12], rir: [1, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 120 s.\nBench angle: 20–30°.\nApproved substitutes: Incline Smith Press, Incline Machine Press, Incline Dumbbell Press 15-35°.',
        },
        {
          slotKey: 'upper_a.05',
          name: 'Stable Machine Shoulder Press',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 120 },
          sets: [
            { reps: [8, 12], rir: [2, 2] },
            { reps: [8, 12], rir: [1, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 120 s.\nApproved substitutes: Stable Smith Shoulder Press, Dumbbell Shoulder Press.',
        },
        {
          slotKey: 'upper_a.06',
          name: 'Cable Lateral Raise',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [12, 20], rir: [1, 1] },
            { reps: [12, 20], rir: [1, 1] },
            { reps: [12, 20], rir: [1, 1] },
            { reps: [12, 20], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 90 s.\nProgram slot: Cable/Machine Lateral Raise. Planned as its first variant; if performed as Machine Lateral Raise, substitute that exercise for this slot.\nApproved substitutes: Cable Lateral Raise, Machine Lateral Raise, Dumbbell Lateral Raise.',
        },
        {
          slotKey: 'upper_a.07',
          name: 'Reverse Pec Deck',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [12, 20], rir: [1, 1] },
            { reps: [12, 20], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 90 s.\nApproved substitutes: Cable Rear-Delt Fly.',
        },
        {
          slotKey: 'upper_a.08',
          name: 'Overhead Cable Triceps Extension',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 90 s.\nApproved substitutes: Another Stable Overhead Triceps Extension.',
        },
        {
          slotKey: 'upper_a.09',
          name: 'Preacher Curl',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 90 s.\nApproved substitutes: Cable Curl, Preacher Curl Variant, Bayesian Cable Curl.',
        },
      ],
    },
    {
      key: 'lower_a',
      name: 'Lower A',
      weekday: 2,
      estimatedMinutes: { min: 75, max: 90 },
      exercises: [
        {
          slotKey: 'lower_a.01',
          name: 'Smith High-Bar Squat',
          marker: true,
          failure: 'prohibited',
          restSeconds: { min: 180, max: 240 },
          sets: [
            { reps: [5, 8], rir: [2, 2] },
            { reps: [5, 8], rir: [2, 2] },
            { reps: [5, 8], rir: [1, 1] },
          ],
          notes:
            'Marker lift (week-12 benchmark).\nFailure: prohibited.\nRest: 180–240 s.\nApproved substitutes: Hack Squat, Pendulum Squat, Barbell High-Bar Squat.',
        },
        {
          slotKey: 'lower_a.02',
          name: 'Romanian Deadlift',
          marker: false,
          failure: 'prohibited',
          restSeconds: { min: 180, max: 180 },
          sets: [
            { reps: [6, 10], rir: [2, 2] },
            { reps: [6, 10], rir: [2, 2] },
            { reps: [6, 10], rir: [2, 2] },
          ],
          notes:
            'Failure: prohibited.\nRest: 180 s.\nApproved substitutes: Smith Romanian Deadlift, Dumbbell Romanian Deadlift.',
        },
        {
          slotKey: 'lower_a.03',
          name: '45° Leg Press',
          marker: false,
          failure: 'prohibited',
          restSeconds: { min: 150, max: 150 },
          sets: [
            { reps: [8, 12], rir: [2, 2] },
            { reps: [8, 12], rir: [1, 1] },
          ],
          notes:
            'Failure: prohibited.\nRest: 150 s.\nApproved substitutes: Hack Squat, Pendulum Squat, Belt Squat.',
        },
        {
          slotKey: 'lower_a.04',
          name: 'Seated Leg Curl',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 120 },
          sets: [
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 120 s.\nApproved substitutes: Another Seated/Hip-Flexed Leg Curl, Lying Leg Curl if unavailable/intolerant.',
        },
        {
          slotKey: 'lower_a.05',
          name: 'Standing Calf Raise',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 120 },
          sets: [
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 120 s.\nApproved substitutes: Smith Straight-Knee Calf Raise, Leg-Press Straight-Knee Calf Raise.',
        },
        {
          slotKey: 'lower_a.06',
          name: 'Cable Crunch',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 90 s.\nApproved substitutes: Machine Abdominal Crunch.',
        },
      ],
    },
    {
      key: 'upper_b',
      name: 'Upper B',
      weekday: 4,
      estimatedMinutes: { min: 80, max: 95 },
      exercises: [
        {
          slotKey: 'upper_b.01',
          name: 'Neutral-Grip Lat Pulldown',
          marker: true,
          failure: 'prohibited',
          restSeconds: { min: 180, max: 180 },
          sets: [
            { reps: [6, 10], rir: [2, 2] },
            { reps: [6, 10], rir: [2, 2] },
            { reps: [6, 10], rir: [1, 1] },
          ],
          notes:
            'Marker lift (week-12 benchmark).\nFailure: prohibited.\nRest: 180 s.\nApproved substitutes: Fixed Pulldown, Assisted Pull-Up, Weighted Pull-Up.',
        },
        {
          slotKey: 'upper_b.02',
          name: 'Incline Smith Press',
          marker: false,
          failure: 'prohibited',
          restSeconds: { min: 180, max: 180 },
          sets: [
            { reps: [6, 10], rir: [2, 2] },
            { reps: [6, 10], rir: [2, 2] },
            { reps: [6, 10], rir: [1, 1] },
          ],
          notes: 'Failure: prohibited.\nRest: 180 s.\nBench angle: 20–30°.',
        },
        {
          slotKey: 'upper_b.03',
          name: 'Chest-Supported Upper-Back Row',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 150 },
          sets: [
            { reps: [8, 12], rir: [2, 2] },
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [1, 1] },
          ],
          notes: 'Failure: permitted on the final set only.\nRest: 120–150 s.',
        },
        {
          slotKey: 'upper_b.04',
          name: 'Flat Converging Machine Press',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 120 },
          sets: [
            { reps: [8, 12], rir: [2, 2] },
            { reps: [8, 12], rir: [1, 1] },
          ],
          notes: 'Failure: permitted on the final set only.\nRest: 120 s.',
        },
        {
          slotKey: 'upper_b.05',
          name: 'Cable Lateral Raise',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [12, 20], rir: [1, 1] },
            { reps: [12, 20], rir: [1, 1] },
            { reps: [12, 20], rir: [1, 1] },
            { reps: [12, 20], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 90 s.\nProgram slot: Cable/Machine Lateral Raise. Planned as its first variant; if performed as Machine Lateral Raise, substitute that exercise for this slot.\nApproved substitutes: Cable Lateral Raise, Machine Lateral Raise, Dumbbell Lateral Raise.',
        },
        {
          slotKey: 'upper_b.06',
          name: 'Reverse Pec Deck',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [12, 20], rir: [1, 1] },
            { reps: [12, 20], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 90 s.\nApproved substitutes: Cable Rear-Delt Fly.',
        },
        {
          slotKey: 'upper_b.07',
          name: 'Cable Pressdown',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [0, 1] },
          ],
          notes: 'Failure: permitted on the final set only.\nRest: 90 s.',
        },
        {
          slotKey: 'upper_b.08',
          name: 'Bayesian Cable Curl',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [0, 1] },
          ],
          notes: 'Failure: permitted on the final set only.\nRest: 90 s.',
        },
      ],
    },
    {
      key: 'lower_b',
      name: 'Lower B',
      weekday: 5,
      estimatedMinutes: { min: 75, max: 90 },
      exercises: [
        {
          slotKey: 'lower_b.01',
          name: 'Hack Squat',
          marker: false,
          failure: 'prohibited',
          restSeconds: { min: 180, max: 180 },
          sets: [
            { reps: [8, 12], rir: [2, 2] },
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [1, 1] },
          ],
          notes: 'Failure: prohibited.\nRest: 180 s.',
        },
        {
          slotKey: 'lower_b.02',
          name: 'Smith Hip Thrust',
          marker: false,
          failure: 'prohibited',
          restSeconds: { min: 150, max: 150 },
          sets: [
            { reps: [8, 12], rir: [2, 2] },
            { reps: [8, 12], rir: [1, 1] },
            { reps: [8, 12], rir: [1, 1] },
          ],
          notes:
            'Failure: prohibited.\nRest: 150 s.\nProgram slot: Smith/Machine Hip Thrust. Planned as its first variant; if performed as Machine Hip Thrust, substitute that exercise for this slot.\nApproved substitutes: Glute Drive, Smith Glute Bridge.',
        },
        {
          slotKey: 'lower_b.03',
          name: 'Leg Extension',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 120 },
          sets: [
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 120 s.\nApproved substitutes: Another Leg Extension Machine.',
        },
        {
          slotKey: 'lower_b.04',
          name: 'Seated Leg Curl',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 120 },
          sets: [
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 120 s.\nApproved substitutes: Another Seated/Hip-Flexed Leg Curl, Lying Leg Curl if unavailable/intolerant.',
        },
        {
          slotKey: 'lower_b.05',
          name: 'Standing Calf Raise',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 120, max: 120 },
          sets: [
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [1, 1] },
            { reps: [10, 15], rir: [0, 1] },
          ],
          notes:
            'Failure: permitted on the final set only.\nRest: 120 s.\nApproved substitutes: Smith Straight-Knee Calf Raise, Leg-Press Straight-Knee Calf Raise.',
        },
        {
          slotKey: 'lower_b.06',
          name: 'Machine Abdominal Crunch',
          marker: false,
          failure: 'final-set',
          restSeconds: { min: 90, max: 90 },
          sets: [
            { reps: [8, 15], rir: [1, 1] },
            { reps: [8, 15], rir: [1, 1] },
            { reps: [8, 15], rir: [0, 1] },
          ],
          notes: 'Failure: permitted on the final set only.\nRest: 90 s.',
        },
      ],
    },
  ],
};
