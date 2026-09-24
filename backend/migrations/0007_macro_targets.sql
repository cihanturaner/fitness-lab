-- 0007_macro_targets.sql
-- V3.3: the nutrition target is the lifter's protein / carbohydrate / fat in grams; its
-- calories are derived (P x 4 + C x 4 + F x 9) and never stored or entered on their own.
--
-- Nothing recorded is destroyed or rewritten:
-- - macro_target is new, append-only and effective-dated like calorie_target was. The target
--   in force on a date is the row with the latest effective_on on or before it (ties: latest
--   set_at_utc, then rowid), so a change today never re-judges an earlier day.
-- - Every calorie_target row becomes one macro_target row with the SAME id, by the locked
--   source's own rule for that era (protein 145 g, fat 60 g, carbohydrate the remainder
--   (kcal - 1120) / 4 rounded half-up to whole grams, as the app showed it). The original row
--   stays untouched and linked (from_calorie_target_id); calorie_target is then closed.
-- - controller_event is rebuilt with the same rows so an applied decision references the
--   macro target it created. Legacy links are kept; previous_calorie_target_kcal loses the
--   1120 kcal floor, which belonged to the locked protein + fat and no longer bounds a target.
--   Nothing references controller_event, so the rebuild needs no foreign-key dance.

CREATE TABLE macro_target (
    id                     TEXT    PRIMARY KEY,
    effective_on           TEXT    NOT NULL
        CHECK (date(effective_on) IS NOT NULL AND effective_on = date(effective_on)),
    protein_g              INTEGER NOT NULL CHECK (protein_g BETWEEN 0 AND 2500),
    carbs_g                INTEGER NOT NULL CHECK (carbs_g BETWEEN 0 AND 2500),
    fat_g                  INTEGER NOT NULL CHECK (fat_g BETWEEN 0 AND 2500),
    notes                  TEXT    CHECK (notes IS NULL OR length(trim(notes)) > 0),
    set_at_utc             TEXT    NOT NULL,
    -- Set only on rows converted from a pre-V3.3 calorie target.
    from_calorie_target_id TEXT    UNIQUE REFERENCES calorie_target(id) ON DELETE RESTRICT,
    CHECK (protein_g + carbs_g + fat_g > 0)
) STRICT;

CREATE INDEX ix_macro_target_effective ON macro_target (effective_on);

INSERT INTO macro_target (
    id, effective_on, protein_g, carbs_g, fat_g, notes, set_at_utc, from_calorie_target_id
)
SELECT id, effective_on, 145, (calories_kcal - 1120 + 2) / 4, 60, notes, set_at_utc, id
FROM calorie_target
ORDER BY effective_on, set_at_utc, rowid;

CREATE TRIGGER macro_target_no_update BEFORE UPDATE ON macro_target
BEGIN
    SELECT RAISE(ABORT, 'macro_target is append-only; record a new target instead');
END;

CREATE TRIGGER macro_target_no_delete BEFORE DELETE ON macro_target
BEGIN
    SELECT RAISE(ABORT, 'macro_target is append-only; it is never deleted');
END;

CREATE TRIGGER macro_target_no_replace BEFORE INSERT ON macro_target
WHEN EXISTS (SELECT 1 FROM macro_target WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'macro_target is append-only; an id is never reused');
END;

CREATE TRIGGER calorie_target_closed BEFORE INSERT ON calorie_target
BEGIN
    SELECT RAISE(ABORT, 'calorie_target is closed; targets are protein, carbs and fat now');
END;

CREATE TABLE controller_event_v33 (
    id                           TEXT    PRIMARY KEY,
    program_version_id           TEXT    NOT NULL
        REFERENCES program_version(id) ON DELETE RESTRICT,
    block_week                   INTEGER NOT NULL CHECK (block_week BETWEEN 1 AND 104),
    decided_on                   TEXT    NOT NULL
        CHECK (date(decided_on) IS NOT NULL AND decided_on = date(decided_on)),
    window_first                 TEXT    NOT NULL
        CHECK (date(window_first) IS NOT NULL AND window_first = date(window_first)),
    window_last                  TEXT    NOT NULL
        CHECK (date(window_last) IS NOT NULL AND window_last = date(window_last)),
    weigh_ins                    INTEGER NOT NULL CHECK (weigh_ins >= 0),
    trend_pct_bw_per_week        TEXT    NOT NULL CHECK (length(trend_pct_bw_per_week) > 0),
    status                       TEXT    NOT NULL CHECK (status IN (
        'UNDER_GAIN', 'IN_RANGE', 'OVER_GAIN', 'DIAGNOSTIC_GATE', 'COMPOSITION_REASSESSMENT')),
    recommended_action           TEXT    NOT NULL CHECK (recommended_action IN (
        'ADD_CALORIES', 'NO_CHANGE', 'REDUCE_CALORIES', 'STRONGER_REASSESSMENT',
        'AUDIT_BEFORE_CONTINUING', 'FIX_INPUT_PROBLEM_FIRST')),
    recommended_delta_kcal       INTEGER,
    previous_calorie_target_kcal INTEGER NOT NULL CHECK (previous_calorie_target_kcal >= 0),
    user_choice                  TEXT    NOT NULL CHECK (user_choice IN ('APPLIED', 'KEPT')),
    -- Pre-V3.3 decisions only: the calorie target they appended.
    new_calorie_target_id        TEXT    REFERENCES calorie_target(id) ON DELETE RESTRICT,
    new_macro_target_id          TEXT    REFERENCES macro_target(id) ON DELETE RESTRICT,
    composition_concern          INTEGER NOT NULL CHECK (composition_concern IN (0, 1)),
    notes                        TEXT    CHECK (notes IS NULL OR length(trim(notes)) > 0),
    recorded_at_utc              TEXT    NOT NULL,
    UNIQUE (program_version_id, block_week),
    CHECK ((user_choice = 'APPLIED') = (new_macro_target_id IS NOT NULL)),
    CHECK (new_calorie_target_id IS NULL OR new_calorie_target_id = new_macro_target_id)
) STRICT;

INSERT INTO controller_event_v33 (
    id, program_version_id, block_week, decided_on, window_first, window_last, weigh_ins,
    trend_pct_bw_per_week, status, recommended_action, recommended_delta_kcal,
    previous_calorie_target_kcal, user_choice, new_calorie_target_id, new_macro_target_id,
    composition_concern, notes, recorded_at_utc
)
SELECT
    id, program_version_id, block_week, decided_on, window_first, window_last, weigh_ins,
    trend_pct_bw_per_week, status, recommended_action, recommended_delta_kcal,
    previous_calorie_target_kcal, user_choice, new_calorie_target_id, new_calorie_target_id,
    composition_concern, notes, recorded_at_utc
FROM controller_event
ORDER BY rowid;

-- DROP TABLE's implicit delete fires no trigger; its append-only triggers go with it and are
-- recreated on the rebuilt table below.
DROP TABLE controller_event;

ALTER TABLE controller_event_v33 RENAME TO controller_event;

CREATE TRIGGER controller_event_no_update BEFORE UPDATE ON controller_event
BEGIN
    SELECT RAISE(ABORT, 'controller_event is append-only; decisions are never rewritten');
END;

CREATE TRIGGER controller_event_no_delete BEFORE DELETE ON controller_event
BEGIN
    SELECT RAISE(ABORT, 'controller_event is append-only; it is never deleted');
END;

CREATE TRIGGER controller_event_no_replace BEFORE INSERT ON controller_event
WHEN EXISTS (SELECT 1 FROM controller_event WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'controller_event is append-only; an id is never reused');
END;
