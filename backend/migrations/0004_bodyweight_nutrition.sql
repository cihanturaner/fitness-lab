-- 0004_bodyweight_nutrition.sql
-- V2: daily bodyweight, daily nutrition log, explicit calorie-target decisions, and the
-- start date of a program's training block. Purely additive: CREATE TABLE and CREATE
-- TRIGGER only. No existing table is altered and nothing is backfilled.
--
-- Values are exact integers: bodyweight in grams (the M1 unit philosophy), energy in kcal,
-- macronutrients in whole grams. Dates are canonical YYYY-MM-DD civil dates, one row per
-- date for the two daily logs.

CREATE TABLE bodyweight_entry (
    measured_on    TEXT    PRIMARY KEY
        CHECK (date(measured_on) IS NOT NULL AND measured_on = date(measured_on)),
    bodyweight_g   INTEGER NOT NULL CHECK (bodyweight_g BETWEEN 20000 AND 300000),
    notes          TEXT    CHECK (notes IS NULL OR length(trim(notes)) > 0),
    entered_at_utc TEXT    NOT NULL,
    updated_at_utc TEXT    NOT NULL
) STRICT;

-- Each number is nullable (a partly logged day is truthful); an entirely empty log is not.
CREATE TABLE nutrition_day (
    logged_on      TEXT    PRIMARY KEY
        CHECK (date(logged_on) IS NOT NULL AND logged_on = date(logged_on)),
    calories_kcal  INTEGER CHECK (calories_kcal IS NULL OR calories_kcal BETWEEN 0 AND 15000),
    protein_g      INTEGER CHECK (protein_g IS NULL OR protein_g BETWEEN 0 AND 1500),
    carbs_g        INTEGER CHECK (carbs_g IS NULL OR carbs_g BETWEEN 0 AND 1500),
    fat_g          INTEGER CHECK (fat_g IS NULL OR fat_g BETWEEN 0 AND 1500),
    notes          TEXT    CHECK (notes IS NULL OR length(trim(notes)) > 0),
    entered_at_utc TEXT    NOT NULL,
    updated_at_utc TEXT    NOT NULL,
    CHECK (calories_kcal IS NOT NULL OR protein_g IS NOT NULL
           OR carbs_g IS NOT NULL OR fat_g IS NOT NULL)
) STRICT;

-- Every explicit calorie-target decision, append-only. The target in force on a date is
-- the row with the latest effective_on on or before it (ties: latest set_at_utc, rowid).
-- No row means "not calibrated yet". 1120 kcal is the locked protein + fat alone.
CREATE TABLE calorie_target (
    id            TEXT    PRIMARY KEY,
    effective_on  TEXT    NOT NULL
        CHECK (date(effective_on) IS NOT NULL AND effective_on = date(effective_on)),
    calories_kcal INTEGER NOT NULL CHECK (calories_kcal BETWEEN 1120 AND 10000),
    notes         TEXT    CHECK (notes IS NULL OR length(trim(notes)) > 0),
    set_at_utc    TEXT    NOT NULL
) STRICT;

CREATE INDEX ix_calorie_target_effective ON calorie_target (effective_on);

CREATE TRIGGER calorie_target_no_update BEFORE UPDATE ON calorie_target
BEGIN
    SELECT RAISE(ABORT, 'calorie_target is append-only; record a new decision instead');
END;

CREATE TRIGGER calorie_target_no_delete BEFORE DELETE ON calorie_target
BEGIN
    SELECT RAISE(ABORT, 'calorie_target is append-only; it is never deleted');
END;

-- REPLACE deletes without firing delete triggers; refuse any insert onto an existing id.
CREATE TRIGGER calorie_target_no_replace BEFORE INSERT ON calorie_target
WHEN EXISTS (SELECT 1 FROM calorie_target WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'calorie_target is append-only; an id is never reused');
END;

-- When week 1 of a program version's block starts (state, set from the CLI).
CREATE TABLE training_block (
    program_version_id TEXT PRIMARY KEY REFERENCES program_version(id) ON DELETE RESTRICT,
    start_on           TEXT NOT NULL
        CHECK (date(start_on) IS NOT NULL AND start_on = date(start_on)),
    set_at_utc         TEXT NOT NULL
) STRICT;
