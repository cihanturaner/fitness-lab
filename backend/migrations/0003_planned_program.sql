-- 0003_planned_program.sql
-- The planned side of training (M2). Purely additive: CREATE TABLE, CREATE INDEX and
-- CREATE TRIGGER only. workout and performed_set are not altered (M1 §17): a workout's
-- planned origin lives in its own link table, and there is deliberately no link from a
-- performed set to a planned set. Nothing is backfilled — every existing workout stays
-- unplanned.
--
-- Imported program content (program_version, planned_workout, planned_exercise_slot,
-- planned_set) is append-only, enforced by triggers: a new program edit is a new version.
-- Which version is active is state, not content, and lives in a singleton table.

CREATE TABLE program_version (
    id                  TEXT    PRIMARY KEY,
    program_key         TEXT    NOT NULL CHECK (length(trim(program_key)) > 0),
    name                TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    version_label       TEXT    CHECK (version_label IS NULL OR length(trim(version_label)) > 0),
    duration_weeks      INTEGER CHECK (duration_weeks IS NULL OR duration_weeks >= 1),
    package_format      INTEGER NOT NULL CHECK (package_format >= 1),
    package_sha256      TEXT    NOT NULL UNIQUE
        CHECK (length(package_sha256) = 64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'),
    program_json_sha256 TEXT    NOT NULL
        CHECK (length(program_json_sha256) = 64 AND program_json_sha256 NOT GLOB '*[^0-9a-f]*'),
    program_json_text   TEXT    NOT NULL,
    notes_sha256        TEXT
        CHECK (notes_sha256 IS NULL
               OR (length(notes_sha256) = 64 AND notes_sha256 NOT GLOB '*[^0-9a-f]*')),
    notes_text          TEXT,
    imported_at_utc     TEXT    NOT NULL,
    CHECK ((notes_sha256 IS NULL) = (notes_text IS NULL))
) STRICT;

CREATE TABLE planned_workout (
    id                 TEXT    PRIMARY KEY,
    program_version_id TEXT    NOT NULL REFERENCES program_version(id) ON DELETE RESTRICT,
    workout_key        TEXT    NOT NULL CHECK (length(trim(workout_key)) > 0),
    sequence           INTEGER NOT NULL CHECK (sequence >= 1),
    name               TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    day_label          TEXT    CHECK (day_label IS NULL OR length(trim(day_label)) > 0),
    notes              TEXT,
    UNIQUE (program_version_id, workout_key),
    UNIQUE (program_version_id, sequence)
) STRICT;

-- The slot, not the exercise, is the identity of a planned occurrence: an A/B/A session
-- is three slots even when two of them reference the same exercise.
CREATE TABLE planned_exercise_slot (
    id                 TEXT    PRIMARY KEY,
    planned_workout_id TEXT    NOT NULL REFERENCES planned_workout(id) ON DELETE RESTRICT,
    slot_key           TEXT    NOT NULL CHECK (length(trim(slot_key)) > 0),
    position           INTEGER NOT NULL CHECK (position >= 1),
    exercise_id        TEXT    NOT NULL REFERENCES exercise(id) ON DELETE RESTRICT,
    notes              TEXT,
    UNIQUE (planned_workout_id, slot_key),
    UNIQUE (planned_workout_id, position),
    -- Composite foreign-key target: lets workout_slot_substitution prove that a slot
    -- belongs to the same planned workout as the workout's origin.
    UNIQUE (id, planned_workout_id)
) STRICT;

CREATE INDEX ix_planned_exercise_slot_exercise ON planned_exercise_slot (exercise_id);

-- Rep-based prescriptions only. reps_max NULL = open-ended (AMRAP); equal = exact;
-- greater = range. Target RIR is both-or-neither. Target load is integer grams (M1 §16).
CREATE TABLE planned_set (
    id             TEXT    PRIMARY KEY,
    slot_id        TEXT    NOT NULL REFERENCES planned_exercise_slot(id) ON DELETE RESTRICT,
    position       INTEGER NOT NULL CHECK (position >= 1),
    set_type       TEXT    NOT NULL REFERENCES set_type(code) ON DELETE RESTRICT,
    reps_min       INTEGER NOT NULL CHECK (reps_min >= 1),
    reps_max       INTEGER CHECK (reps_max IS NULL OR reps_max >= reps_min),
    target_rir_min INTEGER,
    target_rir_max INTEGER,
    target_load_g  INTEGER CHECK (target_load_g IS NULL OR target_load_g >= 0),
    notes          TEXT,
    CHECK ((target_rir_min IS NULL) = (target_rir_max IS NULL)),
    CHECK (target_rir_min IS NULL OR target_rir_min <= target_rir_max),
    UNIQUE (slot_id, position)
) STRICT;

-- Zero rows = no active program. One row at most, by construction.
CREATE TABLE active_program_version (
    singleton          INTEGER PRIMARY KEY CHECK (singleton = 1),
    program_version_id TEXT    NOT NULL REFERENCES program_version(id) ON DELETE RESTRICT,
    activated_at_utc   TEXT    NOT NULL
) STRICT;

-- A workout's planned origin: set once at creation, never rebound, never cleared. No row
-- means the workout was not planned — the natural default, not missing data.
CREATE TABLE workout_plan_origin (
    workout_id         TEXT PRIMARY KEY REFERENCES workout(id) ON DELETE CASCADE,
    planned_workout_id TEXT NOT NULL REFERENCES planned_workout(id) ON DELETE RESTRICT,
    created_at_utc     TEXT NOT NULL,
    UNIQUE (workout_id, planned_workout_id)
) STRICT;

CREATE INDEX ix_workout_plan_origin_planned ON workout_plan_origin (planned_workout_id);

-- Whole-slot substitution for one workout. The two composite foreign keys force the
-- slot's planned workout to equal the workout's origin, so attaching a slot of another
-- session (or any slot to an unplanned workout) fails structurally.
CREATE TABLE workout_slot_substitution (
    workout_id         TEXT NOT NULL,
    planned_workout_id TEXT NOT NULL,
    slot_id            TEXT NOT NULL,
    exercise_id        TEXT NOT NULL REFERENCES exercise(id) ON DELETE RESTRICT,
    created_at_utc     TEXT NOT NULL,
    updated_at_utc     TEXT NOT NULL,
    PRIMARY KEY (workout_id, slot_id),
    FOREIGN KEY (workout_id, planned_workout_id)
        REFERENCES workout_plan_origin (workout_id, planned_workout_id) ON DELETE CASCADE,
    FOREIGN KEY (slot_id, planned_workout_id)
        REFERENCES planned_exercise_slot (id, planned_workout_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX ix_workout_slot_substitution_slot
    ON workout_slot_substitution (slot_id, planned_workout_id);
CREATE INDEX ix_workout_slot_substitution_exercise ON workout_slot_substitution (exercise_id);

-- Append-only program content.

CREATE TRIGGER trg_program_version_no_update BEFORE UPDATE ON program_version
BEGIN
    SELECT RAISE(ABORT, 'program_version is append-only; import a new version instead');
END;

CREATE TRIGGER trg_program_version_no_delete BEFORE DELETE ON program_version
BEGIN
    SELECT RAISE(ABORT, 'program_version is append-only; it is never deleted');
END;

CREATE TRIGGER trg_planned_workout_no_update BEFORE UPDATE ON planned_workout
BEGIN
    SELECT RAISE(ABORT, 'planned_workout is append-only; import a new version instead');
END;

CREATE TRIGGER trg_planned_workout_no_delete BEFORE DELETE ON planned_workout
BEGIN
    SELECT RAISE(ABORT, 'planned_workout is append-only; it is never deleted');
END;

CREATE TRIGGER trg_planned_exercise_slot_no_update BEFORE UPDATE ON planned_exercise_slot
BEGIN
    SELECT RAISE(ABORT, 'planned_exercise_slot is append-only; import a new version instead');
END;

CREATE TRIGGER trg_planned_exercise_slot_no_delete BEFORE DELETE ON planned_exercise_slot
BEGIN
    SELECT RAISE(ABORT, 'planned_exercise_slot is append-only; it is never deleted');
END;

CREATE TRIGGER trg_planned_set_no_update BEFORE UPDATE ON planned_set
BEGIN
    SELECT RAISE(ABORT, 'planned_set is append-only; import a new version instead');
END;

CREATE TRIGGER trg_planned_set_no_delete BEFORE DELETE ON planned_set
BEGIN
    SELECT RAISE(ABORT, 'planned_set is append-only; it is never deleted');
END;

-- REPLACE / INSERT OR REPLACE resolves a conflict by deleting the existing row WITHOUT
-- firing delete triggers (recursive_triggers is off). These guards refuse any insert that
-- would collide with an existing row on any of the table's unique keys, so a conflict can
-- only ever abort — never silently rewrite content, rebind an origin or recreate a workout.

CREATE TRIGGER trg_program_version_no_replace BEFORE INSERT ON program_version
WHEN EXISTS (SELECT 1 FROM program_version
             WHERE id = NEW.id OR package_sha256 = NEW.package_sha256)
BEGIN
    SELECT RAISE(ABORT, 'program_version is append-only; this version already exists');
END;

CREATE TRIGGER trg_planned_workout_no_replace BEFORE INSERT ON planned_workout
WHEN EXISTS (SELECT 1 FROM planned_workout
             WHERE id = NEW.id
                OR (program_version_id = NEW.program_version_id
                    AND (workout_key = NEW.workout_key OR sequence = NEW.sequence)))
BEGIN
    SELECT RAISE(ABORT, 'planned_workout is append-only; this row already exists');
END;

CREATE TRIGGER trg_planned_exercise_slot_no_replace BEFORE INSERT ON planned_exercise_slot
WHEN EXISTS (SELECT 1 FROM planned_exercise_slot
             WHERE id = NEW.id
                OR (planned_workout_id = NEW.planned_workout_id
                    AND (slot_key = NEW.slot_key OR position = NEW.position)))
BEGIN
    SELECT RAISE(ABORT, 'planned_exercise_slot is append-only; this row already exists');
END;

CREATE TRIGGER trg_planned_set_no_replace BEFORE INSERT ON planned_set
WHEN EXISTS (SELECT 1 FROM planned_set
             WHERE id = NEW.id OR (slot_id = NEW.slot_id AND position = NEW.position))
BEGIN
    SELECT RAISE(ABORT, 'planned_set is append-only; this row already exists');
END;

CREATE TRIGGER trg_workout_plan_origin_no_replace BEFORE INSERT ON workout_plan_origin
WHEN EXISTS (SELECT 1 FROM workout_plan_origin WHERE workout_id = NEW.workout_id)
BEGIN
    SELECT RAISE(ABORT, 'workout_plan_origin is immutable; a workout is never rebound');
END;

-- An origin is recorded only at the workout's creation: a draft with no performed sets.
-- An unplanned or completed history row can never be relabelled as planned afterwards.
CREATE TRIGGER trg_workout_plan_origin_only_at_creation BEFORE INSERT ON workout_plan_origin
WHEN NOT EXISTS (SELECT 1 FROM workout WHERE id = NEW.workout_id AND status = 'draft')
  OR EXISTS (SELECT 1 FROM performed_set WHERE workout_id = NEW.workout_id)
BEGIN
    SELECT RAISE(ABORT, 'a planned origin is recorded only at creation, on an empty draft');
END;

-- Additive guard on the M1 table (a trigger does not alter workout): INSERT OR REPLACE on
-- an existing workout id would otherwise delete and recreate it, cascading away its sets,
-- origin and substitutions without any delete trigger firing.
CREATE TRIGGER trg_workout_no_replace BEFORE INSERT ON workout
WHEN EXISTS (SELECT 1 FROM workout WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'workout already exists; it is updated in place, never replaced');
END;

-- The same protection for the rest of the M1 evidence. An id is permanent, and no write may
-- land on another row's unique key: UPDATE OR REPLACE / INSERT OR REPLACE would otherwise
-- delete that row (cascading away a workout's sets, origin and substitutions) without any
-- delete trigger firing. Ordinary renumbering never collides, so it is unaffected.
CREATE TRIGGER trg_workout_id_immutable BEFORE UPDATE OF id ON workout
WHEN NEW.id IS NOT OLD.id
BEGIN
    SELECT RAISE(ABORT, 'a workout id never changes');
END;

CREATE TRIGGER trg_performed_set_id_immutable BEFORE UPDATE OF id ON performed_set
WHEN NEW.id IS NOT OLD.id
BEGIN
    SELECT RAISE(ABORT, 'a performed set id never changes');
END;

CREATE TRIGGER trg_performed_set_no_replace BEFORE INSERT ON performed_set
WHEN EXISTS (SELECT 1 FROM performed_set WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'a performed set is never replaced; it is updated in place');
END;

CREATE TRIGGER trg_performed_set_no_replace_order BEFORE INSERT ON performed_set
WHEN EXISTS (SELECT 1 FROM performed_set
             WHERE workout_id = NEW.workout_id AND set_order = NEW.set_order)
BEGIN
    SELECT RAISE(ABORT,
        'a performed set is never replaced: (workout_id, set_order) is already taken');
END;

CREATE TRIGGER trg_performed_set_no_replace_order_update
BEFORE UPDATE OF workout_id, set_order ON performed_set
WHEN EXISTS (SELECT 1 FROM performed_set
             WHERE workout_id = NEW.workout_id AND set_order = NEW.set_order
               AND id <> OLD.id)
BEGIN
    SELECT RAISE(ABORT,
        'a performed set is never replaced: (workout_id, set_order) is already taken');
END;

-- Immutable provenance. A DELETE is legal only as the cascade of the workout's own
-- deletion: by then the workout row is already gone (verified against SQLite 3.53).

CREATE TRIGGER trg_workout_plan_origin_no_update BEFORE UPDATE ON workout_plan_origin
BEGIN
    SELECT RAISE(ABORT, 'workout_plan_origin is immutable; a workout is never rebound');
END;

CREATE TRIGGER trg_workout_plan_origin_no_delete BEFORE DELETE ON workout_plan_origin
WHEN EXISTS (SELECT 1 FROM workout WHERE id = OLD.workout_id)
BEGIN
    SELECT RAISE(ABORT, 'workout_plan_origin is immutable; it is removed only with its workout');
END;

-- Substitution rules.

CREATE TRIGGER trg_substitution_not_original_insert BEFORE INSERT ON workout_slot_substitution
WHEN NEW.exercise_id = (SELECT exercise_id FROM planned_exercise_slot WHERE id = NEW.slot_id)
BEGIN
    SELECT RAISE(ABORT, 'a substitution must differ from the planned exercise; clear it instead');
END;

CREATE TRIGGER trg_substitution_not_original_update BEFORE UPDATE ON workout_slot_substitution
WHEN NEW.exercise_id = (SELECT exercise_id FROM planned_exercise_slot WHERE id = NEW.slot_id)
BEGIN
    SELECT RAISE(ABORT, 'a substitution must differ from the planned exercise; clear it instead');
END;

CREATE TRIGGER trg_substitution_complete_insert BEFORE INSERT ON workout_slot_substitution
WHEN EXISTS (SELECT 1 FROM workout WHERE id = NEW.workout_id AND status = 'complete')
BEGIN
    SELECT RAISE(ABORT, 'workout is complete; reopen it before changing substitutions');
END;

CREATE TRIGGER trg_substitution_complete_update BEFORE UPDATE ON workout_slot_substitution
WHEN EXISTS (SELECT 1 FROM workout
             WHERE id IN (OLD.workout_id, NEW.workout_id) AND status = 'complete')
BEGIN
    SELECT RAISE(ABORT, 'workout is complete; reopen it before changing substitutions');
END;

CREATE TRIGGER trg_substitution_complete_delete BEFORE DELETE ON workout_slot_substitution
WHEN EXISTS (SELECT 1 FROM workout WHERE id = OLD.workout_id AND status = 'complete')
BEGIN
    SELECT RAISE(ABORT, 'workout is complete; reopen it before changing substitutions');
END;
