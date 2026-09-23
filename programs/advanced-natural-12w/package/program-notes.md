# 12-Week Advanced Natural Hypertrophy + Strength Program

- Source artifact: `locked_workout_program.json`
- Source SHA-256: `81a7d4bca38bb4a581d146abfc4c6b83b239e281ea4896f37addcd6a76d7b24e`
- Source version: 1.0.0 (FINAL_PATCHED_LOCKED, DECISION_GRADE_PASS_WITH_CAVEAT)
- Generated deterministically by the fitness-lab locked-program adapter; the source artifact is preserved unchanged beside this package.

## Weekly schedule

- Monday: Upper A (23 work sets, 85–105 min)
- Tuesday: Lower A (18 work sets, 75–90 min)
- Wednesday: rest
- Thursday: Upper B (21 work sets, 80–95 min)
- Friday: Lower B (19 work sets, 75–90 min)
- Saturday: rest
- Sunday: rest

## Execution rules

```json
{
  "full_controlled_pain_free_ROM": true,
  "longest_comfortable_muscle_length": true,
  "eccentric_seconds": "1-3",
  "concentric": "forceful_but_controlled",
  "lengthened_partials_default": false,
  "compound_failure": "generally_avoid",
  "isolation_failure": "selective",
  "patch_P7_prime": {
    "failure_permitted_zero_rir_valid_execution": true,
    "progression_rule": "If prescribed final-set RIR is 1, taking it to 0 RIR does NOT satisfy load-progression criterion for that exposure."
  }
}
```

## Progression

```json
{
  "type": "finite_double_progression",
  "rule": "When ALL work sets reach top of rep range at prescribed RIR or more reserve, increase the smallest practical load increment.",
  "after_load_increase": "Performance should return near the lower end of the rep range.",
  "harder_than_prescribed_does_not_qualify": true,
  "example": {
    "target_RIR": 2,
    "actual_RIR": 0,
    "qualifies_for_load_increase": false
  },
  "microloading_rule_locked": false
}
```

## Plateau logic

```json
{
  "one_bad_workout": "NOISE",
  "plateau_definition": "approximately 3 consecutive standardized exposures without meaningful rep/load progress",
  "audit_order": [
    "technique_and_ROM",
    "RIR_accuracy",
    "sleep_and_stress",
    "energy_intake_and_recovery",
    "pain",
    "systemic_fatigue"
  ],
  "exercise_level_response": {
    "step_1": "reduce load toward lower half of rep range at target RIR",
    "step_2": "rebuild for 2-3 exposures",
    "recurring_stall": "substitute exercise if justified"
  },
  "muscle_level_response": {
    "trigger": "2 or more exercises for same muscle stall while technique/recovery are good",
    "action": "add 1 direct set per week",
    "placement": "preferably lower-volume session",
    "evaluation_period_weeks_approx": 3
  },
  "automatic_volume_escalation": false
}
```

## Calibration

```json
{
  "applies_to": "unfamiliar_exercise_setup_or_technique_only",
  "first_exposures": "1-2",
  "adjustment": "approximately +1 RIR more conservative",
  "mandatory_three_week_calibration": false
}
```

## Weeks 1–11

```json
{
  "same_base_program": true,
  "automatic_RIR_progression": false,
  "automatic_failure_escalation": false,
  "automatic_set_escalation": false,
  "scheduled_calendar_deload": false
}
```

## Deload (P1)

```json
{
  "trigger": {
    "minimum_meaningful_signs": 2,
    "persistence": "approximately 2 exposures or 5-7 days",
    "signs": [
      "standardized performance regression",
      "clearly worsened or non-restorative sleep/recovery",
      "persistent unusual soreness or joint/tendon irritation",
      "marked deterioration in training readiness"
    ],
    "novel_sign_policy": "A novel sign may justify a documented exception but does not retroactively count as one of the two precommitted signs."
  },
  "check_first": [
    "inadequate_sleep",
    "inadequate_energy_intake",
    "pain_or_acute_illness",
    "major_external_stress"
  ],
  "rule_if_primary_driver_found": "correct primary driver first; deload does not fix sleep or energy deficit",
  "implementation": {
    "duration_days": 7,
    "same_4_sessions": true,
    "same_exercises": true,
    "set_mapping": {
      "4": 2,
      "3": 2,
      "2": 1
    },
    "weekly_sets_before": 81,
    "weekly_sets_deload": 48,
    "volume_reduction_pct_approx": 41,
    "rep_target": "lower half of normal rep ranges",
    "RIR": 4,
    "failure": "NONE",
    "load_rule": "retain prior load only if reduced reps still allow >=4 RIR; otherwise reduce load"
  }
}
```

## Week 12 (P2)

```json
{
  "normal_hypertrophy_week": true,
  "taper": false,
  "true_max": false,
  "extra_test_sets": false,
  "benchmark_rule": "Compare first normal work set of locked markers with Week-1 baseline.",
  "calibration_exception": "If marker was under calibration +1 RIR during Week 1, baseline = first non-calibrated standardized exposure.",
  "record_baseline_exposure_once_established": true,
  "markers": [
    {
      "day": "Monday",
      "exercise": "Smith Flat Bench Press"
    },
    {
      "day": "Tuesday",
      "exercise": "Smith High-Bar Squat"
    },
    {
      "day": "Thursday",
      "exercise": "Neutral-Grip Lat Pulldown"
    }
  ],
  "optional_e1RM": {
    "formula": "load * (1 + (reps + RIR) / 30)",
    "use": "same exercise/machine trend only",
    "not_for": [
      "cross-machine comparison",
      "cross-exercise comparison",
      "physiological truth"
    ]
  }
}
```

## Warm-up

```json
{
  "first_heavy_exercise_ramp_sets": [
    2,
    4
  ],
  "first_new_heavy_pattern_later_ramp_sets": [
    1,
    3
  ],
  "later_machine_or_isolation_ramp_sets": [
    0,
    1
  ],
  "failure": false,
  "counts_as_work_set": false
}
```

## Weekly volume

```json
{
  "fractional_counting_note": "0.5 fractional counting is a planning heuristic, not a biological constant.",
  "muscles": {
    "Chest": {
      "direct": 10,
      "fractional_approx": 10
    },
    "Lats": {
      "direct": 6,
      "fractional_approx": 9
    },
    "Upper Back": {
      "direct": 6,
      "fractional_approx": 9
    },
    "Front Delts": {
      "direct": 2,
      "fractional_approx": 7
    },
    "Lateral Delts": {
      "direct": 8,
      "fractional_approx": 8
    },
    "Rear Delts": {
      "direct": 4,
      "fractional_approx": 7
    },
    "Biceps": {
      "direct": 4,
      "fractional_approx": 10
    },
    "Triceps": {
      "direct": 4,
      "fractional_approx": 10
    },
    "Quads": {
      "direct": 11,
      "fractional_approx": 11
    },
    "Hamstrings": {
      "direct": 9,
      "fractional_approx": 9
    },
    "Glutes": {
      "direct": 6,
      "fractional_approx": 10
    },
    "Gastrocnemius": {
      "direct": 8,
      "fractional_approx": 8
    },
    "Soleus": {
      "direct": 8,
      "fractional_approx": 8
    },
    "Abs/Core": {
      "direct": 6,
      "fractional_approx": 6
    },
    "Upper Traps": {
      "direct": 0,
      "fractional_approx": 3
    },
    "Forearms": {
      "direct": 0,
      "fractional_approx": null
    }
  }
}
```

## Substitution matrix

```json
{
  "Smith Flat Bench Press": [
    "Barbell Bench Press",
    "Stable Chest Press"
  ],
  "Smith High-Bar Squat": [
    "Hack Squat",
    "Pendulum Squat",
    "Barbell High-Bar Squat"
  ],
  "Neutral-Grip Lat Pulldown": [
    "Fixed Pulldown",
    "Assisted Pull-Up",
    "Weighted Pull-Up"
  ],
  "Chest-Supported Row": [
    "Supported Machine Row",
    "Supported Cable Row"
  ],
  "Incline Converging Machine Press": [
    "Incline Smith Press",
    "Incline Machine Press",
    "Incline Dumbbell Press 15-35°"
  ],
  "Stable Machine Shoulder Press": [
    "Stable Smith Shoulder Press",
    "Dumbbell Shoulder Press"
  ],
  "Cable/Machine Lateral Raise": [
    "Cable Lateral Raise",
    "Machine Lateral Raise",
    "Dumbbell Lateral Raise"
  ],
  "Reverse Pec Deck": [
    "Cable Rear-Delt Fly"
  ],
  "Overhead Cable Triceps Extension": [
    "Another Stable Overhead Triceps Extension"
  ],
  "Preacher Curl": [
    "Cable Curl",
    "Preacher Curl Variant",
    "Bayesian Cable Curl"
  ],
  "Romanian Deadlift": [
    "Smith Romanian Deadlift",
    "Dumbbell Romanian Deadlift"
  ],
  "45° Leg Press": [
    "Hack Squat",
    "Pendulum Squat",
    "Belt Squat"
  ],
  "Seated Leg Curl": [
    "Another Seated/Hip-Flexed Leg Curl",
    "Lying Leg Curl if unavailable/intolerant"
  ],
  "Smith/Machine Hip Thrust": [
    "Glute Drive",
    "Smith Glute Bridge"
  ],
  "Leg Extension": [
    "Another Leg Extension Machine"
  ],
  "Standing Calf Raise": [
    "Smith Straight-Knee Calf Raise",
    "Leg-Press Straight-Knee Calf Raise"
  ],
  "Cable Crunch": [
    "Machine Abdominal Crunch"
  ],
  "mechanical_non_equivalence_note": "45° Back Extension is NOT mechanically identical to Hip Thrust."
}
```
