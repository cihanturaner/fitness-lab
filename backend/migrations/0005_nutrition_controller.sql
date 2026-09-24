-- 0005_nutrition_controller.sql
-- V3: the lifter's decisions on the locked nutrition controller's reviews, and diagnostic-
-- gate audits. Purely additive: CREATE TABLE, CREATE INDEX and CREATE TRIGGER only. Both
-- tables are append-only (source: controller_event_template, diagnostic_gate_event_template).
-- A review with no row is PENDING; the app never writes a row on its own.

-- One decision per program version and block week. APPLIED means a new calorie_target row
-- was appended in the same transaction; KEPT means the target in force stayed.
CREATE TABLE controller_event (
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
    previous_calorie_target_kcal INTEGER NOT NULL
        CHECK (previous_calorie_target_kcal BETWEEN 1120 AND 10000),
    user_choice                  TEXT    NOT NULL CHECK (user_choice IN ('APPLIED', 'KEPT')),
    new_calorie_target_id        TEXT    REFERENCES calorie_target(id) ON DELETE RESTRICT,
    composition_concern          INTEGER NOT NULL CHECK (composition_concern IN (0, 1)),
    notes                        TEXT    CHECK (notes IS NULL OR length(trim(notes)) > 0),
    recorded_at_utc              TEXT    NOT NULL,
    UNIQUE (program_version_id, block_week),
    CHECK ((user_choice = 'APPLIED') = (new_calorie_target_id IS NOT NULL))
) STRICT;

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

-- A diagnostic-gate audit: the nine source checks answered yes (1) or no (0). An audit may
-- be redone for the same week; the latest recorded one decides.
CREATE TABLE diagnostic_gate_event (
    id                                  TEXT    PRIMARY KEY,
    program_version_id                  TEXT    NOT NULL
        REFERENCES program_version(id) ON DELETE RESTRICT,
    block_week                          INTEGER NOT NULL CHECK (block_week BETWEEN 1 AND 104),
    decided_on                          TEXT    NOT NULL
        CHECK (date(decided_on) IS NOT NULL AND decided_on = date(decided_on)),
    tracking_method_consistent          INTEGER NOT NULL CHECK (tracking_method_consistent IN (0, 1)),
    food_logging_consistent             INTEGER NOT NULL CHECK (food_logging_consistent IN (0, 1)),
    restaurant_unlogged_intake_reviewed INTEGER NOT NULL
        CHECK (restaurant_unlogged_intake_reviewed IN (0, 1)),
    weighing_protocol_consistent        INTEGER NOT NULL
        CHECK (weighing_protocol_consistent IN (0, 1)),
    activity_NEAT_changed               INTEGER NOT NULL CHECK (activity_NEAT_changed IN (0, 1)),
    training_workload_changed           INTEGER NOT NULL CHECK (training_workload_changed IN (0, 1)),
    sleep_recovery_changed              INTEGER NOT NULL CHECK (sleep_recovery_changed IN (0, 1)),
    illness_travel                      INTEGER NOT NULL CHECK (illness_travel IN (0, 1)),
    adherence_consistent                INTEGER NOT NULL CHECK (adherence_consistent IN (0, 1)),
    result                              TEXT    NOT NULL
        CHECK (result IN ('GENUINE_UNDERFEEDING_CONFIRMED', 'INPUTS_UNRELIABLE')),
    notes                               TEXT    CHECK (notes IS NULL OR length(trim(notes)) > 0),
    recorded_at_utc                     TEXT    NOT NULL
) STRICT;

CREATE INDEX ix_diagnostic_gate_event_week
    ON diagnostic_gate_event (program_version_id, block_week);

CREATE TRIGGER diagnostic_gate_event_no_update BEFORE UPDATE ON diagnostic_gate_event
BEGIN
    SELECT RAISE(ABORT, 'diagnostic_gate_event is append-only');
END;

CREATE TRIGGER diagnostic_gate_event_no_delete BEFORE DELETE ON diagnostic_gate_event
BEGIN
    SELECT RAISE(ABORT, 'diagnostic_gate_event is append-only; it is never deleted');
END;

CREATE TRIGGER diagnostic_gate_event_no_replace BEFORE INSERT ON diagnostic_gate_event
WHEN EXISTS (SELECT 1 FROM diagnostic_gate_event WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'diagnostic_gate_event is append-only; an id is never reused');
END;
