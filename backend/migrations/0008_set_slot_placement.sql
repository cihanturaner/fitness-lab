-- 0008_set_slot_placement.sql
-- V3.3.1: which planned slot of its workout a set was recorded in.
--
-- Why a schema change: sets were grouped by exercise, so two slots performed as the same
-- exercise in one workout (both changed to "Triceps Curl", say) could not be told apart and
-- their sets, counts and History merged. Only a stored fact can keep them apart.
--
-- Nothing recorded is altered or rewritten:
-- - performed_set and workout are untouched (M1 section 17); this is an association table,
--   exactly like workout_slot_substitution.
-- - A placement names a planned SLOT (an occurrence of an exercise in the session), never a
--   planned_set: an actual set still carries no link to a prescription (M2 invariant 8).
-- - Nothing is backfilled. Sets recorded before 0008 have no placement row and are shown by
--   the pre-0008 rule (the first slot performing their exercise), as before.
-- - A row with slot_id NULL records that a set of a planned workout is extra work — added as
--   extra, or left behind when its slot was changed to another exercise — so the pre-0008 rule
--   can never move it into a slot.
--
-- Guarantees (composite keys and triggers, like workout_slot_substitution):
-- - the slot belongs to the planned workout the set's workout was opened from;
-- - the set belongs to that workout, and is of the exercise that slot is performed as in
--   that workout (its substitute, else its planned exercise) — also when either changes;
-- - a placement never changes: it is recorded with the set and goes with it;
-- - nothing changes while the workout is complete (reopen first).

CREATE TABLE performed_set_slot (
    set_id             TEXT NOT NULL PRIMARY KEY
        REFERENCES performed_set(id) ON DELETE CASCADE,
    workout_id         TEXT NOT NULL,
    planned_workout_id TEXT NOT NULL,
    slot_id            TEXT,             -- NULL: extra work, in no slot
    created_at_utc     TEXT NOT NULL,
    FOREIGN KEY (workout_id, planned_workout_id)
        REFERENCES workout_plan_origin (workout_id, planned_workout_id) ON DELETE CASCADE,
    FOREIGN KEY (slot_id, planned_workout_id)
        REFERENCES planned_exercise_slot (id, planned_workout_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX ix_performed_set_slot_workout ON performed_set_slot (workout_id, slot_id);
CREATE INDEX ix_performed_set_slot_slot ON performed_set_slot (slot_id, planned_workout_id);

CREATE TRIGGER trg_set_slot_same_workout BEFORE INSERT ON performed_set_slot
WHEN NOT EXISTS (SELECT 1 FROM performed_set WHERE id = NEW.set_id AND workout_id = NEW.workout_id)
BEGIN
    SELECT RAISE(ABORT, 'a set can only be placed in a slot of its own workout');
END;

CREATE TRIGGER trg_set_slot_exercise BEFORE INSERT ON performed_set_slot
WHEN NEW.slot_id IS NOT NULL
 AND (SELECT exercise_id FROM performed_set WHERE id = NEW.set_id) IS NOT coalesce(
    (SELECT exercise_id FROM workout_slot_substitution
     WHERE workout_id = NEW.workout_id AND slot_id = NEW.slot_id),
    (SELECT exercise_id FROM planned_exercise_slot WHERE id = NEW.slot_id))
BEGIN
    SELECT RAISE(ABORT, 'a set is placed only in a slot performed as its own exercise');
END;

CREATE TRIGGER trg_set_slot_complete_insert BEFORE INSERT ON performed_set_slot
WHEN EXISTS (SELECT 1 FROM workout WHERE id = NEW.workout_id AND status = 'complete')
BEGIN
    SELECT RAISE(ABORT, 'workout is complete; reopen it before changing its sets');
END;

CREATE TRIGGER trg_set_slot_no_update BEFORE UPDATE ON performed_set_slot
BEGIN
    SELECT RAISE(ABORT, 'a set placement never changes; it is recorded with the set');
END;

-- A cascade from deleting the workout itself (draft discard, M1's guarded delete) finds the
-- workout row already gone, so it is not blocked here.
CREATE TRIGGER trg_set_slot_complete_delete BEFORE DELETE ON performed_set_slot
WHEN EXISTS (SELECT 1 FROM workout WHERE id = OLD.workout_id AND status = 'complete')
BEGIN
    SELECT RAISE(ABORT, 'workout is complete; reopen it before changing its sets');
END;

-- A placed set keeps the exercise of its slot.
CREATE TRIGGER trg_set_slot_set_exercise BEFORE UPDATE OF exercise_id ON performed_set
WHEN NEW.exercise_id IS NOT OLD.exercise_id AND EXISTS (
    SELECT 1 FROM performed_set_slot WHERE set_id = OLD.id AND slot_id IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'a set placed in a slot keeps that slot''s exercise; unplace it first');
END;

-- A slot keeps the exercise of the sets placed in it. The workout-exists guard lets the
-- cascade of a deleted workout through.
CREATE TRIGGER trg_set_slot_substitution_insert BEFORE INSERT ON workout_slot_substitution
WHEN EXISTS (
    SELECT 1 FROM performed_set_slot p JOIN performed_set s ON s.id = p.set_id
    WHERE p.workout_id = NEW.workout_id AND p.slot_id = NEW.slot_id
      AND s.exercise_id IS NOT NEW.exercise_id)
BEGIN
    SELECT RAISE(ABORT, 'sets placed in this slot are of another exercise; unplace them first');
END;

CREATE TRIGGER trg_set_slot_substitution_update BEFORE UPDATE ON workout_slot_substitution
WHEN EXISTS (
    SELECT 1 FROM performed_set_slot p JOIN performed_set s ON s.id = p.set_id
    WHERE p.workout_id = NEW.workout_id AND p.slot_id = NEW.slot_id
      AND s.exercise_id IS NOT NEW.exercise_id)
BEGIN
    SELECT RAISE(ABORT, 'sets placed in this slot are of another exercise; unplace them first');
END;

CREATE TRIGGER trg_set_slot_substitution_delete BEFORE DELETE ON workout_slot_substitution
WHEN EXISTS (SELECT 1 FROM workout WHERE id = OLD.workout_id) AND EXISTS (
    SELECT 1 FROM performed_set_slot p JOIN performed_set s ON s.id = p.set_id
    WHERE p.workout_id = OLD.workout_id AND p.slot_id = OLD.slot_id
      AND s.exercise_id IS NOT (SELECT exercise_id FROM planned_exercise_slot WHERE id = OLD.slot_id))
BEGIN
    SELECT RAISE(ABORT, 'sets placed in this slot are of another exercise; unplace them first');
END;
