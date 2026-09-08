-- 0002_performed_training.sql
-- The performed-training foundation. Purely additive: CREATE TABLE, CREATE INDEX and a
-- vocabulary seed. Nothing is rebuilt, so no foreign-key-off dance is needed.

CREATE TABLE set_type (
    code        TEXT    PRIMARY KEY,
    description TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL
) STRICT;

INSERT INTO set_type (code, description, sort_order) VALUES
    ('warmup',  'Warm-up set',  1),
    ('working', 'Working set',  2),
    ('backoff', 'Back-off set', 3);

CREATE TABLE exercise (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    equipment_label TEXT    CHECK (equipment_label IS NULL
                                   OR length(trim(equipment_label)) > 0),
    notes           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at_utc  TEXT    NOT NULL,
    updated_at_utc  TEXT    NOT NULL
) STRICT;

-- coalesce() is required and must not be removed: without it, two rows with the same
-- name and a NULL equipment_label are BOTH accepted, because UNIQUE treats NULLs as
-- mutually distinct. That silent duplicate identity is the exact failure this index exists
-- to prevent.
CREATE UNIQUE INDEX ux_exercise_identity ON exercise (
    lower(trim(name)),
    coalesce(lower(trim(equipment_label)), '')
);

CREATE TABLE workout (
    id                   TEXT PRIMARY KEY,
    performed_on         TEXT NOT NULL
        CHECK (date(performed_on) IS NOT NULL AND performed_on = date(performed_on)),
    performed_time_local TEXT
        CHECK (performed_time_local IS NULL
               OR (time(performed_time_local) IS NOT NULL
                   AND performed_time_local = substr(time(performed_time_local), 1, 5))),
    status               TEXT NOT NULL CHECK (status IN ('draft', 'complete')),
    notes                TEXT,
    entered_at_utc       TEXT NOT NULL,
    updated_at_utc       TEXT NOT NULL
) STRICT;

-- Deliberately NOT unique: two sessions on one calendar date are allowed.
CREATE INDEX ix_workout_performed_on ON workout (performed_on);

CREATE TABLE performed_set (
    id             TEXT    PRIMARY KEY,
    workout_id     TEXT    NOT NULL REFERENCES workout(id)    ON DELETE CASCADE,
    exercise_id    TEXT    NOT NULL REFERENCES exercise(id)   ON DELETE RESTRICT,
    set_order      INTEGER NOT NULL CHECK (set_order >= 1),
    set_type       TEXT             REFERENCES set_type(code) ON DELETE RESTRICT,
    load_g         INTEGER          CHECK (load_g IS NULL OR load_g >= 0),
    reps           INTEGER          CHECK (reps   IS NULL OR reps   >= 0),
    rir            INTEGER,
    notes          TEXT,
    entered_at_utc TEXT    NOT NULL,
    updated_at_utc TEXT    NOT NULL,
    load_kg        REAL GENERATED ALWAYS AS (load_g / 1000.0) VIRTUAL,
    UNIQUE (workout_id, set_order)
) STRICT;

CREATE INDEX ix_performed_set_exercise ON performed_set (exercise_id);
