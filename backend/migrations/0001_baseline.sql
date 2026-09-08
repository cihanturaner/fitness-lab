-- 0001_baseline.sql
-- Adopts the database M0 already created, without a reset.
--
-- CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE make this a no-op against the legacy
-- file (which already holds the table and its row) and a creation against an empty one.
-- One code path, both cases, nothing destroyed.
--
-- This table is deliberately NOT STRICT: it must match the table M0 created byte for
-- byte, or CREATE TABLE IF NOT EXISTS would silently keep the legacy definition while
-- the code believed otherwise. m0_technical_check is retained through M1 because
-- /api/ping-db, the React page and the Playwright smoke test all depend on it; it is
-- retired in the milestone that replaces the visible technical surface.

CREATE TABLE IF NOT EXISTS m0_technical_check (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    token      TEXT    NOT NULL,
    created_at TEXT    NOT NULL
);

INSERT OR IGNORE INTO m0_technical_check (id, token, created_at)
VALUES (1, 'sqlite-roundtrip-ok', strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'));
