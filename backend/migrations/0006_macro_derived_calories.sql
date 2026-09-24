-- 0006_macro_derived_calories.sql
-- V3.1: a day's calories are no longer entered; they are derived from its macronutrients
-- (Atwater: protein 4, carbohydrate 4, fat 9 kcal per gram) in domain/nutrition.py.
--
-- Nothing entered is destroyed. Every calorie value typed before this migration is copied,
-- with the macros stored beside it, into nutrition_entered_calories, an append-only audit
-- table, before nutrition_day is rebuilt without its calories column. A day that held
-- calories and no macro at all cannot be derived and so leaves nutrition_day; its entry
-- survives only in the audit table (derived_kcal NULL marks it).
--
-- nutrition_day has no foreign keys in or out, so the rebuild needs no foreign-key dance.

CREATE TABLE nutrition_entered_calories (
    logged_on             TEXT    PRIMARY KEY
        CHECK (date(logged_on) IS NOT NULL AND logged_on = date(logged_on)),
    entered_calories_kcal INTEGER NOT NULL,
    protein_g             INTEGER,
    carbs_g               INTEGER,
    fat_g                 INTEGER,
    -- The same day's calories from its macros (unknown macros count 0); NULL: no macros.
    derived_kcal          INTEGER,
    entered_at_utc        TEXT    NOT NULL,
    updated_at_utc        TEXT    NOT NULL,
    archived_at_utc       TEXT    NOT NULL
) STRICT;

INSERT INTO nutrition_entered_calories (
    logged_on, entered_calories_kcal, protein_g, carbs_g, fat_g, derived_kcal,
    entered_at_utc, updated_at_utc, archived_at_utc
)
SELECT
    logged_on, calories_kcal, protein_g, carbs_g, fat_g,
    CASE WHEN protein_g IS NULL AND carbs_g IS NULL AND fat_g IS NULL THEN NULL
         ELSE coalesce(protein_g, 0) * 4 + coalesce(carbs_g, 0) * 4 + coalesce(fat_g, 0) * 9
    END,
    entered_at_utc, updated_at_utc, strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')
FROM nutrition_day
WHERE calories_kcal IS NOT NULL;

CREATE TRIGGER nutrition_entered_calories_no_update BEFORE UPDATE ON nutrition_entered_calories
BEGIN
    SELECT RAISE(ABORT, 'nutrition_entered_calories is an audit record; it is never changed');
END;

CREATE TRIGGER nutrition_entered_calories_no_delete BEFORE DELETE ON nutrition_entered_calories
BEGIN
    SELECT RAISE(ABORT, 'nutrition_entered_calories is an audit record; it is never deleted');
END;

CREATE TRIGGER nutrition_entered_calories_no_insert BEFORE INSERT ON nutrition_entered_calories
BEGIN
    SELECT RAISE(ABORT, 'nutrition_entered_calories is closed; calories are derived now');
END;

-- Each macro is nullable (a partly logged day is truthful); a day with none is not a log.
CREATE TABLE nutrition_day_v31 (
    logged_on      TEXT    PRIMARY KEY
        CHECK (date(logged_on) IS NOT NULL AND logged_on = date(logged_on)),
    protein_g      INTEGER CHECK (protein_g IS NULL OR protein_g BETWEEN 0 AND 1500),
    carbs_g        INTEGER CHECK (carbs_g IS NULL OR carbs_g BETWEEN 0 AND 1500),
    fat_g          INTEGER CHECK (fat_g IS NULL OR fat_g BETWEEN 0 AND 1500),
    notes          TEXT    CHECK (notes IS NULL OR length(trim(notes)) > 0),
    entered_at_utc TEXT    NOT NULL,
    updated_at_utc TEXT    NOT NULL,
    CHECK (protein_g IS NOT NULL OR carbs_g IS NOT NULL OR fat_g IS NOT NULL)
) STRICT;

INSERT INTO nutrition_day_v31 (
    logged_on, protein_g, carbs_g, fat_g, notes, entered_at_utc, updated_at_utc
)
SELECT logged_on, protein_g, carbs_g, fat_g, notes, entered_at_utc, updated_at_utc
FROM nutrition_day
WHERE protein_g IS NOT NULL OR carbs_g IS NOT NULL OR fat_g IS NOT NULL;

DROP TABLE nutrition_day;

ALTER TABLE nutrition_day_v31 RENAME TO nutrition_day;
