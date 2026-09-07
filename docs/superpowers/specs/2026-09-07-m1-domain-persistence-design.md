# M1 — Domain Model and Persistence Design

Status: **APPROVED** (design v1.1 + amendments 1–4)
Date: 2026-09-07
Milestone: M1 (first fitness-domain milestone; follows the verified M0 walking skeleton)

This document is the authoritative, self-contained specification for M1. It assumes no
knowledge of the conversation that produced it. Where a decision looks arbitrary, the
rationale is stated, because the cost of re-litigating it later is higher than the cost of
recording it now.

Every SQLite behaviour asserted here was verified against SQLite **3.53.4** / Python
**3.13.1**, the versions this project runs on. Claims that depend on engine behaviour are
marked *(verified)*.

---

## 1. Purpose and M1 scope

fitness-lab is a single-user, local-first fitness performance system intended to be used and
maintained for many years. Real workout logging begins **1 October 2026**.

M1 establishes the durable foundation for recording **performed** resistance training: stable
exercise identity, performed workouts, ordered performed sets, and the migration
infrastructure every later schema change depends on. It is a foundation milestone — its
visible output is a schema, a domain model and a test suite, not a user interface.

### In scope

| Concept | Why it cannot wait |
|---|---|
| Migration infrastructure | Every later schema change depends on it; must exist before the first real table |
| `exercise` identity | The highest cost-to-fix-later decision in the system |
| `workout` (performed) | Canonical container for a training session |
| `performed_set` | The canonical evidence; irrecoverable if not captured from 1 October |
| `set_type` vocabulary | Warm-up vs working changes the meaning of every set |
| Connection hardening | Foreign keys are off by default; integrity is silently lost otherwise |
| kg↔gram conversion boundary | Wrong once, wrong in every stored row thereafter |
| Emergency raw-capture **contract** | Deadline insurance (contract + validator only; no importer) |

### Deliberately deferred, with the reason

- **`movement_family`** — nothing in M1 consumes family grouping. The catalog is one person's,
  realistically 60–150 rows over a decade; classifying it later is an `ADD COLUMN` plus a
  short backfill that never touches `performed_set`. What is genuinely irrecoverable is the
  *distinction between two exercises*, and that is carried by them being separate rows. A
  family column added now would be populated by guesswork and re-guessed when analytics
  reveals what grouping must mean.
- **Equipment taxonomy or `equipment` table** — superseded by the `equipment_label` column
  (§5). Two exercises stay unmerged because they are two rows, not because a lookup table
  says so.
- **Program / planned anything** — M2 owns the program artifact contract. §17 defines the
  attachment point.
- **Bodyweight, nutrition, conditioning, mobility, e1RM, PRs, charts** — no foundational
  schema reason; all attach additively later.
- **The capture importer itself** — M1 ships the contract and a validator. The importer is
  written when there is a schema to import into and time to test it.
- **API endpoints and UI** — none in M1. Persistence is proven by tests against real SQLite
  files, which is stronger evidence than an endpoint, and fixing an API shape before the
  entry UI exists would be premature.

---

## 2. Explicit non-goals

M1 does **not** design or implement any of the following. This list is binding.

Workout-entry UI · dashboard · exercise-history UI · program generation · progression
algorithms · e1RM implementation · PR analytics · charts · nutrition · bodyweight tracking ·
conditioning · mobility · cloud sync · authentication · multi-tenancy · user/account tables ·
admin tables · mobile · external network calls · runtime AI · event sourcing · a generic audit
system · a soft-delete framework applied to every entity · a generic foreign-key-off table
rebuild helper · snapshot retention/pruning · lb↔kg conversion (the system is kilograms only).

---

## 3. Source-of-truth rules

For every stored field, exactly one answer to "what kind of fact is this?"

| Kind | Meaning | Examples |
|---|---|---|
| **Canonical evidence** | Raw record of what happened. Irreplaceable. Never derived. | `load_g`, `reps`, `rir`, `set_order`, `performed_on` |
| **Configuration** | User-curated reference data. | `exercise.name`, `exercise.equipment_label`, `set_type` rows |
| **Metadata** | Facts about the record, not the training. | `entered_at_utc`, `updated_at_utc`, `is_active`, `status` |
| **Derived** | Computable from canonical evidence. **Never stored.** | e1RM, PRs, volume, tonnage, set counts, %1RM |

Rules that follow:

1. **e1RM is derived and must never be persisted as history.** Formulas change; canonical
   evidence must survive that change untouched. M1 implements no e1RM at all.
2. **No truth is stored twice.** If a value can be computed from another stored value, it is
   not stored. The single exception is the virtual generated column `performed_set.load_kg`,
   which occupies no storage and is computed by the engine on read *(verified read-only —
   both `INSERT` and `UPDATE` against it are refused by SQLite)*.
3. **`planned` is not `performed`.** M1 stores only performed facts. Nothing in M1 records
   what was prescribed.
4. **`performed_at` is not `entered_at`.** Both are recorded; neither substitutes for the
   other (§9).
5. **Raw performance data is canonical.** Any future analytic claim must be reconstructible
   from `performed_set` rows alone.

---

## 4. Entity definitions

### 4.1 `Exercise`

One exact exercise, on one specific piece of equipment, as this lifter performs it.

| Field | Kind | Null | Notes |
|---|---|---|---|
| `id` | canonical | no | `uuid4().hex`, opaque, immutable, domain-generated |
| `name` | configuration | no | Editable display label; non-blank |
| `equipment_label` | configuration | yes | Free-text machine/equipment identity; non-blank when present |
| `notes` | metadata | yes | Commentary only — **never** canonical historical identity |
| `is_active` | metadata | no | `1`/`0`; retirement, never deletion |
| `created_at_utc`, `updated_at_utc` | metadata | no | UTC ISO-8601 |

**Not stored:** movement family, equipment type enum, muscle groups, laterality, unilateral
flag, default rep ranges, estimated 1RM, PR cache, last-performed cache.

### 4.2 `Workout`

One performed training session.

| Field | Kind | Null | Notes |
|---|---|---|---|
| `id` | canonical | no | `uuid4().hex` |
| `performed_on` | canonical | no | Civil local date `YYYY-MM-DD` |
| `performed_time_local` | canonical | yes | Civil local `HH:MM`; NULL = not recorded, **not** midnight |
| `notes` | canonical | yes | Session circumstances |
| `status` | metadata | no | `draft` or `complete` |
| `entered_at_utc`, `updated_at_utc` | metadata | no | UTC ISO-8601 |

**Not stored:** duration, session title, bodyweight, session RPE, total volume, set count,
program reference, location, "skipped" flag.

### 4.3 `PerformedSet`

The canonical evidence unit. Every claim the system will ever make about strength must be
reconstructible from these rows.

| Field | Kind | Null | Notes |
|---|---|---|---|
| `id` | canonical | no | `uuid4().hex` |
| `workout_id` | canonical | no | FK → `workout`, CASCADE |
| `exercise_id` | canonical | no | FK → `exercise`, RESTRICT; the row's anchor |
| `set_order` | canonical | no | Global chronological position within the workout, `>= 1`, unique per workout |
| `set_type` | canonical | **yes** | FK → `set_type`; NULL = not classified yet |
| `load_g` | canonical | yes | Integer grams; NULL = not recorded, `0` = no external load |
| `reps` | canonical | yes | NULL = not entered yet, `0` = recorded zero reps |
| `rir` | canonical | yes | **No database bound.** NULL = not recorded, `0` = taken to failure |
| `notes` | canonical | yes | Time-specific setup evidence (seat notch, belt, how it felt) |
| `entered_at_utc`, `updated_at_utc` | metadata | no | UTC ISO-8601 |

**Not stored:** e1RM, volume load, tonnage, %1RM, tempo, rest time, PR flags, "is best set",
per-set timestamps, side, duration, superset group key.

### 4.4 `SetType` (lookup)

Closed-but-extensible vocabulary. Seeded with `warmup`, `working`, `backoff`.
Fields: `code` (PK), `description`, `sort_order`.

A table rather than a `CHECK` constraint so that adding a fourth type is an `INSERT` rather
than a full rebuild of `performed_set` — the one table that should never be rebuilt. By
contrast `workout.status` stays a `CHECK`, because adding a status is a code change anyway and
`workout` is cheap to rebuild.

### 4.5 `SchemaMigration` (infrastructure, not domain)

Fields: `version` (PK), `filename`, `sha256`, `applied_at_utc`. Storage layer only.

---

## 5. Exercise identity semantics

**Recommendation in force:** opaque `uuid4().hex` primary key generated in the domain layer;
display name and equipment label are plain editable attributes; uniqueness is enforced over
the normalized *pair*; retirement by `is_active = 0`, never deletion.

### 5.1 Why the name is not the key

No row anywhere stores an exercise *name*. Renaming is a single `UPDATE exercise SET name = ?`
and changes zero rows in `performed_set`. This is asserted by a test, not by convention.

IDs are generated in the **domain**, not by the database. This makes retried writes naturally
idempotent — a retry collides on the primary key instead of creating a duplicate — which
matters for the future autosave path and for the capture importer. `uuid4` from the standard
library is used deliberately: time-ordered IDs (UUIDv7/ULID) would buy nothing, because
`set_order` and `performed_on` carry all ordering that matters, and would cost a dependency or
a hand-rolled base32 implementation.

### 5.2 `equipment_label` is canonical identity; `notes` is not

Without `equipment_label`, distinguishing a Hammer Strength incline press from a Technogym one
requires either overloading the display name (`"Incline Chest Press (Hammer)"`) or burying the
distinction in `notes`. Both are wrong: the first makes the name carry identity it must not
carry, the second puts historical identity in a field designated as commentary and freely
edited.

```
name = "Incline Chest Press",  equipment_label = "Technogym Pure Strength"   -> exercise id A
name = "Incline Chest Press",  equipment_label = "Hammer Strength"           -> exercise id B
```

A and B are separate identities with separate, never-merged strength histories.

Time-specific setup detail — seat notch, pin position, how a session felt — is **performed
evidence** and belongs on `performed_set.notes`, not on the exercise.

### 5.3 Duplicate identity rule

```sql
CREATE UNIQUE INDEX ux_exercise_identity ON exercise (
    lower(trim(name)),
    coalesce(lower(trim(equipment_label)), '')
);
```

**The `coalesce` is load-bearing and must not be removed.** *(verified)* A UNIQUE index treats
NULLs as mutually distinct, so the obvious formulation
`(lower(trim(name)), lower(trim(equipment_label)))` **accepts** both
`('Incline Chest Press', NULL)` and `('incline chest press', NULL)` — a silent duplicate
identity, which is the exact failure this index exists to prevent. Folding NULL to `''` closes
it.

Verified behaviour:

| `name` | `equipment_label` | Result |
|---|---|---|
| `Incline Chest Press` | `Technogym Pure Strength` | accept |
| `Incline Chest Press` | `Hammer Strength` | accept — separate id, separate history |
| `Incline Chest Press` | `NULL` | accept |
| `incline chest press` | `  hammer strength ` | reject — case and whitespace normalized |
| `incline chest press` | `NULL` | reject — the NULL-vs-NULL trap, closed |
| `Incline Chest Press` | `''` or `'   '` | reject — blank is not a label |
| `''` | `Hammer Strength` | reject — blank name |

`CHECK (equipment_label IS NULL OR length(trim(equipment_label)) > 0)` makes blank unstorable,
so `''` can never become a third state alongside NULL and a real label.

### 5.4 Editing `equipment_label` vs. switching equipment

**Binding semantic rule.** Editing `equipment_label` corrects the label of *the same underlying
exact exercise* — a typo, or `"Hammer Strength"` → `"Hammer Strength Iso-Lateral"`. It is
**not** the mechanism for switching machines. Training on a genuinely different machine
creates a **new exercise row with a new id**, leaving prior history attached to the equipment
that produced it.

The database cannot enforce intent. The domain enforces it by exposing two distinct
operations and never a single ambiguous "edit":

- `rename_exercise(id, name, equipment_label)` — corrects labels of an existing identity.
- `create_exercise(name, equipment_label)` — establishes a new identity.

A test asserts that a label correction leaves every referencing `performed_set` row unchanged.

### 5.5 Retirement, not deletion

`is_active = 0` hides an exercise from pickers while every historical set keeps resolving.
Actual deletion of a referenced exercise is blocked at the database level by
`ON DELETE RESTRICT` *(verified to raise `IntegrityError`)*. Deleting an exercise that has
never been used is permitted and harmless.

---

## 6. Workout draft/complete lifecycle

Two statuses. That is the whole model.

| Status | Meaning |
|---|---|
| `draft` | Entry is in progress or was interrupted. The record makes no claim about training yet. |
| `complete` | The lifter asserts this record is a finished, accurate account of the session. |

Transitions: `draft → complete` (gated, §7.3) and `complete → draft` (reopening to correct;
always permitted, re-runs nothing). Neither is automatic.

### 6.1 Deliberate exclusions

- **No `abandoned` status.** It conflates two unrelated events. An *abandoned training
  session* — ill, left after two exercises — is a **complete record of a short workout**:
  status `complete`, circumstance in `notes`. An *abandoned entry draft* is a `draft` that is
  deleted. A single status would force these to be recorded identically.
- **No `skipped`.** Skipping is defined only relative to a plan. That concept arrives in M2.
- **The absence of a workout row means nothing.** A date with no workout is "no session
  recorded" — not a rest day, not a missed session, not zero training. This is why there is no
  "rest day" row type.

### 6.2 Analytics contract (binding on M3+)

Analytics **must** filter `status = 'complete'`. A draft is not evidence. Within a complete
workout, `reps IS NULL` and `set_type IS NULL` are unreachable — rules C2 and C4 guarantee it.

### 6.3 Interrupted retrospective entry

Retrospective entry is the primary workflow, not an error path: the lifter performs a workout
at the gym and enters 15–25 sets later at the desktop. The model tolerates this by design —
create the workout as `draft` with only `performed_on`, add and refine sets over minutes or
days, promote to `complete` when finished. A draft with zero sets is valid and carries no
penalty. Application interruption loses nothing already persisted.

---

## 7. Performed-set semantics

### 7.1 Ordering

A single `set_order` sequence spans the **whole workout**, not each exercise. The stored order
is therefore the true chronological order of the session: an A/B/A/B interleave is visible as
an interleave, and returning to an exercise at the end of a session is representable without
inventing a "block" identity. Exercise grouping for display is derived by the UI.

An intermediate `workout_exercise` block table was considered and rejected: it adds a table
and an identity to migrate in order to make explicit something the flat sequence already
records, and it makes "I came back to squats at the end" awkward.

`UNIQUE (workout_id, set_order)` prevents two sets claiming the same position.

### 7.2 Field semantics

- **`reps` is nullable.** Field-level autosave means a row exists the moment the lifter starts
  it — exercise chosen, load typed, reps not yet. A `NOT NULL` constraint would force the
  storage layer to refuse the write or invent a placeholder, and any placeholder collapses
  semantic absence into a number. `CHECK (reps IS NULL OR reps >= 0)`. No upper bound —
  inventing a maximum would be an unevidenced fitness assumption. `0` is meaningful evidence:
  an attempted rep that failed.
- **`set_type` is nullable.** Same reasoning. A row autosaved before the lifter classifies the
  set must not silently acquire a real classification. **There is no database default and no
  domain default of `'working'`.** The UI may visually preselect `working` for entry speed,
  but persistence records only what the lifter actually chose. NULL means *not classified
  yet*. *(verified: a NULL foreign-key value is accepted, an invalid code is rejected, and
  `ON DELETE RESTRICT` still protects referenced codes.)*
- **`rir` carries no database constraint at all.** An earlier draft specified
  `CHECK (rir >= 0)`. That encodes a current coaching convention into the table most expensive
  to rebuild: relaxing it later — for negative RIR on forced or assisted reps — would mean
  rebuilding a table of irreplaceable data to accommodate a methodology change. Any
  restriction on entered values is a domain/UI policy, changeable in a code edit with no
  migration. *(verified: `rir = -1` stores and reads back as `-1`.)* NULL remains distinct
  from `0`.
- **`load_g` is nullable integer grams.** `0` means *no external load* — a bodyweight pull-up,
  genuinely zero added kilograms. `NULL` means *not recorded*. See §16 for the conversion
  boundary.
- **`exercise_id` is NOT NULL.** A set cannot exist before an exercise is chosen; the exercise
  is the row's anchor, and the UI creates the row under an already-selected exercise.
- **No per-set timestamp.** The workout carries date and time. A per-set timestamp would be
  `entered_at` masquerading as `performed_at`.

### 7.3 Draft vs complete validation

Two tiers. The database guarantees what must be true of *any* row; the domain guarantees what
must additionally be true before a workout may be called evidence.

**Tier 1 — structural invariants (database, always enforced, drafts included).** Valid
`performed_on` and `performed_time_local` formats; every set anchored to an existing exercise
and workout; `set_order` unique within its workout; `set_type` either NULL or a real code; no
negative `load_g`, `reps` or `set_order`. **A draft may be partial; it may never be
malformed.**

**Tier 2 — completion preconditions (domain, evaluated only on `draft → complete`).**

| Rule | Check | On failure |
|---|---|---|
| **C1** | the workout has at least one set | block — an empty record is not evidence of training |
| **C2** | every set has `reps IS NOT NULL` | block, naming the offending `set_order` values |
| **C3** | `set_order` forms a dense `1..n` sequence | **repair, do not block** — renumber, then re-verify |
| **C4** | every set has `set_type IS NOT NULL` | block, naming the offending `set_order` values |

**Advisories — reported, never blocking:** sets with `load_g IS NULL`; sets with `rir IS NULL`.

**Why `reps` and `set_type` block but `load` only advises.** A set with reps and no load is
interpretable evidence — the set demonstrably happened, at an unrecorded load. A set with a
load and no reps is not a set at all; nothing was performed. A set with no `set_type` cannot
be interpreted, because whether it was a warm-up or a working set changes every conclusion
drawn from it. Load is different in kind: making it mandatory at completion would be actively
harmful, because a lifter facing a genuinely unremembered load would type `0` or a guess to
pass the gate, writing a falsehood into permanent history. NULL is the honest answer, and the
NULL≠0 principle forbids coercing it into a number. The advisory keeps the gap visible without
forcing it closed.

Tier 2 is pure domain logic over in-memory objects, testable with no database. It runs only at
the transition, so the autosave write path never pays for it.

---

## 8. NULL semantics

**Binding rule: semantic absence is never collapsed into a numeric or boolean default.**

| Field | `NULL` means | `0` / absence of row means |
|---|---|---|
| `performed_set.load_g` | not recorded | `0` = no external load (bodyweight) |
| `performed_set.reps` | not entered yet | `0` = recorded zero reps (failed attempt) |
| `performed_set.rir` | not recorded | `0` = taken to failure, zero in reserve |
| `performed_set.set_type` | not classified yet | — (no default is truthful) |
| `performed_set.notes` | nothing noted | — |
| `workout.performed_time_local` | time not recorded | **not** midnight |
| `exercise.equipment_label` | no equipment distinction recorded | `''` is unstorable |
| *no `workout` row for a date* | no session recorded | **not** a rest day, **not** a skipped session |

Corollaries:

- A missing measurement is never `0`. A set not entered is never a failed set. A workout not
  planned is never a skipped workout.
- Any query that would coerce NULL to a number (`coalesce(rir, 0)`, `sum(load_g)` across NULLs
  treated as zero) is a defect unless the coercion is deliberate and documented at the call
  site.
- The single deliberate NULL-folding in the system is inside `ux_exercise_identity` (§5.3),
  where `coalesce(..., '')` exists precisely to make two absences compare equal. It is
  confined to the index expression and stores nothing.

---

## 9. Time model

**Core decision: training facts use civil (naive local) time; system facts use UTC.** These
are different kinds of time, and mixing them is what corrupts history.

| Column | Type | Meaning |
|---|---|---|
| `workout.performed_on` | TEXT `YYYY-MM-DD` | The local calendar date of the session. NOT NULL. Canonical grouping key for all history. |
| `workout.performed_time_local` | TEXT `HH:MM` | Local wall-clock start time. NULL = not recorded. |
| `*.entered_at_utc` | TEXT ISO-8601 UTC | When the row was first written. |
| `*.updated_at_utc` | TEXT ISO-8601 UTC | When the row last changed. |

### 9.1 Why travel and DST cannot corrupt workout-day history

`performed_on` is a plain civil date and is **never derived from a UTC instant at read time**.
There is no offset arithmetic anywhere in the read path, so no expression exists that could
shift a Tuesday session onto Monday. Training in Istanbul and later querying from Tokyo
returns the date trained. The alternative — storing a UTC instant and rendering a local date —
is precisely the design that breaks, because the rendering timezone is not the training
timezone.

### 9.2 No timezone machinery

No IANA zone names, no offsets, no `zoneinfo` in the training path. Storing `performed_tz` to
reconstruct wall-clock from UTC was considered and rejected: it solves a problem that exists
only if UTC is stored in the first place. `entered_at_utc` and `updated_at_utc` are UTC because
they are system events where a global instant is correct and nobody cares about their wall
clock.

### 9.3 Format validation

Both formats are validated at the database level *(verified)*:

```sql
CHECK (date(performed_on) IS NOT NULL AND performed_on = date(performed_on))
CHECK (performed_time_local IS NULL
       OR (time(performed_time_local) IS NOT NULL
           AND performed_time_local = substr(time(performed_time_local), 1, 5)))
```

**The `IS NOT NULL` half is load-bearing and must not be simplified away.** A constraint of
only `performed_on = date(performed_on)` silently **accepts** `'2026-13-01'` and `'1 Oct 2026'`,
because `date()` returns NULL for those, `x = NULL` evaluates to NULL, and a SQL `CHECK`
passes on NULL — it fails only on false.

Verified: rejects `2026-02-31`, `2026-13-01`, `2026-10-1`, `1 Oct 2026`, `''`, `25:00`, `7:45`,
`19:45:30`. Accepts `2026-10-01`, `2028-02-29`, `19:45`.

---

## 10. Final SQLite DDL

All tables `STRICT` — SQLite's default type affinity would otherwise let a text value into an
integer column *(verified: `STRICT` rejects `'heavy'` into `load_g`)*.

```sql
-- ---- infrastructure -------------------------------------------------------
CREATE TABLE schema_migrations (
    version        INTEGER PRIMARY KEY,
    filename       TEXT    NOT NULL,
    sha256         TEXT    NOT NULL,
    applied_at_utc TEXT    NOT NULL
) STRICT;

-- ---- vocabulary -----------------------------------------------------------
CREATE TABLE set_type (
    code        TEXT    PRIMARY KEY,
    description TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL
) STRICT;
-- seeded: ('warmup', 'Warm-up set', 1),
--         ('working', 'Working set', 2),
--         ('backoff', 'Back-off set', 3)

-- ---- identity -------------------------------------------------------------
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

-- coalesce() is required: without it, two rows with the same name and NULL
-- equipment_label are both accepted, because UNIQUE treats NULLs as distinct.
CREATE UNIQUE INDEX ux_exercise_identity ON exercise (
    lower(trim(name)),
    coalesce(lower(trim(equipment_label)), '')
);

-- ---- performed history ----------------------------------------------------
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
```

Notes on deliberate absences in the DDL above: `set_type` has **no** `NOT NULL` and **no**
`DEFAULT`; `rir` has **no** `CHECK`; `workout` has **no** `UNIQUE(performed_on)`;
`performed_set` has **no** `group_key`, **no** `side`, **no** `duration_seconds`; `exercise`
has **no** `movement_family_id`.

`load_kg` exists solely so hand-written SQL reads in kilograms; it is read-only and derived
*(verified)*. It is not a second source of truth and must never be written.

---

## 11. Connection initialization semantics

Two distinct categories, which the implementation must not conflate.

### 11.1 Persistent database configuration — set once, at bootstrap

```sql
PRAGMA journal_mode = WAL;
```

*(verified: WAL is recorded in the database file header and is read back as `wal` by a fresh
connection that sets nothing.)* It is therefore established by the database
initialization / migration bootstrap path and **must not** be re-issued as routine
per-connection state.

### 11.2 Connection-local safety settings — set on every connection

```sql
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous  = FULL;
```

plus `sqlite3.connect(..., isolation_level=None)` for explicit transaction control.

**`foreign_keys` is the critical one.** *(verified: it reads `0` on a fresh connection even
after WAL has been persisted.)* The M0 `connect()` in `backend/src/fitness_lab/storage/db.py`
does not set it, which means every `ON DELETE RESTRICT` and `ON DELETE CASCADE` in §10 would
be **silently inert** — including the constraint protecting history from exercise deletion.
This is the class of defect that stays invisible until the day it matters, so it is asserted
by a dedicated test, not left to code review.

`isolation_level=None` is likewise required, not stylistic. *(verified: with Python's default
implicit-transaction mode, both `BEGIN` and `VACUUM INTO` fail outright with
"cannot start a transaction within a transaction".)* The migration runner cannot work without
it.

Honest note on the other two, so a future reader does not mistake them for load-bearing
discoveries: on this build `synchronous` already reads `2` (FULL) as the compiled default, and
`busy_timeout` already reads `5000` because Python's `sqlite3.connect()` defaults to
`timeout=5.0` *(both verified)*. They are set explicitly anyway, because defaults are not
contractual and a future Python or SQLite build may differ. `synchronous` is confirmed
per-connection: setting it to `OFF` on one connection does not affect a fresh one.

---

## 12. Migration design

### 12.1 Chosen mechanism

**A hand-rolled runner over numbered forward-only SQL files.** Roughly 60 lines, zero
dependencies.

Alternatives considered and rejected:

- **Alembic** — pulls SQLAlchemy into a project that uses none of it. `--autogenerate` is
  ORM-driven and would go unused; without it you hand-write `op.*` calls that translate to the
  SQL you would have written anyway. Its SQLite batch-mode rebuild is genuinely good, but that
  solves one problem out of many and arrives with `env.py`, `alembic.ini` and a `versions/`
  convention. Disproportionate.
- **`yoyo-migrations`** — small, raw-SQL, supports rollback; the closest competitor. Rejected
  because it adds a third-party dependency to a system meant to run untouched for years, and
  its tracking table offers no protection against an already-applied file being edited.

### 12.2 Design

- Files live in `backend/migrations/`, named `NNNN_description.sql`, applied in ascending
  numeric order. **Forward-only. Never edited after being applied.**
- `schema_migrations` is the **single source of truth** for applied state. `PRAGMA
  user_version` is deliberately *not* also maintained — two records of the same truth is
  exactly the duplication §3 forbids.
- Each file's `sha256` is recorded on application. On every run the runner re-checks the
  stored hash of already-applied files and **refuses to proceed** if one has changed. This
  turns "I tweaked an old migration" from silent divergence into a loud failure.
- Each migration applies inside **one explicit transaction**, followed by
  `PRAGMA foreign_key_check` before commit. A failure rolls back leaving `schema_migrations`
  unchanged.
- **No destructive silent reset.** The runner never drops or recreates a database.

### 12.3 No generic rebuild helper

A generic foreign-key-off / 12-step table-rebuild helper is **deliberately not built in M1**.
It would be speculative infrastructure for a migration that does not exist.

This is safe because **every M1 migration is purely additive** — `CREATE TABLE`,
`CREATE INDEX`, and the `set_type` seed. Nothing rebuilds. Cutting it also genuinely
simplifies the runner: since no migration turns foreign keys off, `PRAGMA foreign_keys` is set
once at connection time and never touched, which sidesteps the constraint that it cannot be
changed inside a transaction. The runner reduces to: *begin → execute file →
`foreign_key_check` → record → commit*.

The schema is also now less likely ever to need a rebuild: moving RIR's bound out of the
database (§7.2) and set types into a lookup table (§4.4) removed the two most probable future
`CHECK` changes on `performed_set`.

When a migration genuinely requires a rebuild, the mechanics belong in that migration, or in a
helper extracted at that moment when its real shape is known.

### 12.4 Adopting the existing M0 database without a reset

`data/fitness_lab.db` already exists, created by M0's `init_db()`, containing
`m0_technical_check` and no `schema_migrations` table.

`0001_baseline.sql` reproduces exactly what M0 creates, using `CREATE TABLE IF NOT EXISTS` and
`INSERT OR IGNORE`. Applying it to the legacy file is a no-op that simply records version 1;
applying it to an empty file creates the table. One code path, both cases, nothing destroyed.
`init_db()`'s inline DDL is then removed and the API `lifespan` calls the migration runner
instead.

**`m0_technical_check` is retained through M1.** `/api/ping-db`, the React page and the
Playwright smoke test all depend on it, and M1 ships no UI to replace them. It is retired in
the milestone that replaces the visible technical surface.

`0002_performed_training.sql` contains the §10 DDL and the `set_type` seed.

---

## 13. Pre-migration snapshot behavior

**Discovery happens before snapshot creation.** The runner determines the pending set first,
then acts:

- **No pending migrations** → **create no snapshot** and return cleanly. Starting the
  application must not accumulate a snapshot per launch.
- **One or more pending migrations** → create **exactly one** consistent pre-migration
  snapshot covering the whole pending sequence, then apply the sequence.

Snapshots use `VACUUM INTO 'data/snapshots/<utc-timestamp>-pre-<version>.db'`
*(verified to work under WAL and to produce a consistent single-file copy)*.

**No automatic pruning or retention in M1.** Retention belongs to the later backup/export
milestone. Snapshots accumulate under `data/snapshots/`, which is gitignored along with the
rest of `data/`.

Deleting a **complete** workout may still take its own safety snapshot, as specified in §14.

Rationale for preferring file snapshots to an audit table: a snapshot costs ~15 lines, needs
no schema, and protects against every class of loss including the ones an audit table cannot —
migration bugs, file corruption, and mistaken bulk updates.

---

## 14. Correction / deletion policy

The smallest policy that is still safe. **No audit table, no event log, no soft-delete
framework across entities.**

| Event | Policy |
|---|---|
| Exercise renamed / label corrected | Plain `UPDATE`. History untouched by construction (§5.1). |
| Exercise retired | `is_active = 0`. Hidden from pickers, fully resolvable in history. |
| Exercise deleted | **Blocked by the database** when any set references it (`ON DELETE RESTRICT`). Deleting an unused exercise is permitted. |
| Set corrected | In-place `UPDATE`; `updated_at_utc` moves. Prior values are not retained — versioning every set is enterprise machinery for a problem a single user does not have; corrections are overwhelmingly same-session typo fixes. |
| Set removed | Hard `DELETE`, then the domain renumbers the workout's remaining sets to a dense `1..n` (rule C3). |
| Draft workout deleted | Hard `DELETE`, cascading. A draft is not evidence; nothing is lost. |
| **Complete workout deleted** | The only guarded path: requires an explicit confirming argument at the storage boundary that no ordinary code path supplies by accident, **and** takes a `VACUUM INTO` safety snapshot first. Then hard `DELETE` with cascade. |

Equipment changes are never a deletion or an edit: a different machine is a new exercise
identity (§5.4).

---

## 15. Emergency raw-capture contract

**Purpose.** If the application is unavailable on or after 1 October 2026, raw workout
evidence must still be capturable in a portable structured form and later imported
deterministically. This is deadline insurance, **not** a historical-import product feature. No
UI is required, and the file must be writable by hand in a text editor.

**M1 ships:** this contract and a pure-domain validator.
**M1 does not ship:** the importer. It is written against a schema that exists, with time to
test it.

### 15.1 Shape

```json
{
  "schema_version": 1,
  "units": "kg",
  "capture_note": "written by hand; app unavailable",
  "workouts": [
    {
      "performed_on": "2026-10-01",
      "performed_time_local": "18:30",
      "notes": "first logged session",
      "sets": [
        { "exercise": "Incline Chest Press", "equipment_label": "Hammer Strength",
          "set_type": "warmup",  "load_kg": 40,   "reps": 10 },
        { "exercise": "Incline Chest Press", "equipment_label": "Hammer Strength",
          "set_type": "working", "load_kg": 60,   "reps": 9, "rir": 2 },
        { "exercise": "Incline Chest Press", "equipment_label": "Hammer Strength",
          "set_type": "working", "load_kg": 60,   "reps": 8, "rir": 1 },
        { "exercise": "Incline dumbbell press",
          "set_type": "backoff", "load_kg": 32.5, "reps": 10, "rir": 2,
          "notes": "bench notch 3" }
      ]
    }
  ]
}
```

### 15.2 Rules

- `schema_version` is **required**. An unknown version is a hard refusal, never a best-effort
  parse.
- `units` **must** be `"kg"`. It exists so a future reader cannot misread the file. Any other
  value is refused, never converted. There is no lb support anywhere in the system.
- **Set order is array order.** Nothing to type, nothing to get wrong. An explicit `set_order`
  is accepted as an override for an edited file.
- `load_kg` is written in kilograms and converted through the canonical mapper of §16. The
  file **must** be parsed with `json.loads(..., parse_float=Decimal)` so no value ever passes
  through binary floating point *(verified: `102.5` parses to `Decimal('102.5')` and converts
  to exactly `102500` g; `0.0005` is refused for sub-gram precision)*.
- `reps` is **optional**. Omitting it imports as NULL. This is safe because imported workouts
  land as `draft`, and rule C2 means such a workout cannot be promoted to `complete` until
  reps are supplied. The validator **reports** every set missing reps rather than rejecting
  the file — a hand-written emergency file with three unremembered rep counts should import
  and surface the gaps, not fail wholesale.
- `set_type` is **optional**, imports as NULL, and is likewise reported — rule C4 blocks
  completion until it is classified.
- `rir` is optional and **unbounded**, matching the database: an integer or absent, nothing
  more.
- Omission is the only representation of "not recorded". There is no sentinel value.

### 15.3 Exercise resolution

The `exercise` field is a name; `equipment_label` is an optional sibling field. An explicit
`{"id": "..."}` form is also accepted. Resolution order:

1. Explicit `id` → exact match.
2. Normalized `(name, equipment_label)` pair — the same `lower(trim(...))` /
   `coalesce(..., '')` rule as `ux_exercise_identity` → exact match.
3. Name alone → **must resolve to exactly one exercise.**

**Ambiguity is refused, never guessed.** If `"Incline Chest Press"` alone matches both the
Hammer Strength and Technogym rows, the importer stops and lists the candidates. Guessing
wrong would attach a session to the wrong machine's strength history — precisely the
corruption `equipment_label` exists to prevent.

Unresolved names **never auto-create**. The importer prints a resolution report and requires
an explicit `--create-missing` decision.

### 15.4 Duplicate protection

The importer records the file's `sha256` in a small `raw_capture_import` table, so re-running
an identical file is a no-op. Because the hash changes when the file is edited, that alone is
insufficient, so import is two-phase: a dry-run report first ("will create 1 workout on
2026-10-01 with 4 sets; **a workout already exists on that date**"), then an explicit apply.
**Imported workouts always land as `draft`**, never `complete`, so they are reviewed before
becoming evidence.

---

## 16. Exact kg ↔ grams boundary

SQLite stores **integer grams**. The domain, API, UI and capture contract speak **kilograms**.
The conversion boundary must be exact and centralized in one canonical mapper reused by
persistence mapping, future API/UI entry, and the capture validator/import path.

### 16.1 Why not float multiplication plus rounding

Because it passes a naive test suite and fails later. *(verified)* Gym plate weights are
binary-exact as IEEE doubles — `0.5`, `32.5`, `102.5`, `1.25` all multiply by 1000 to exact
integers — so a float implementation looks correct against every obvious test case. But any
upstream float arithmetic breaks it: `0.1 + 0.2` is `0.30000000000000004`, which times 1000 is
`300.00000000000006`. A `round()` would paper over that while silently accepting sub-gram
input that should have been rejected. The failure is invisible at the boundary and permanent
in the stored row.

### 16.2 Canonical mapper

Rules:

1. Accept `str`, `int`, or `decimal.Decimal`. **Reject `float` outright** with `TypeError` —
   by the time a float exists, precision may already be lost, so the boundary refuses to
   pretend otherwise. (`bool` is rejected too, being an `int` subclass.)
2. `None` maps to `None` in both directions. NULL stays NULL.
3. `kg → g`: build a `Decimal`, require it finite, scale by `10^3`, and require the result to
   be integral. **Sub-gram precision is rejected, never rounded.**
4. Reject negative loads (the database `CHECK` agrees, but the domain fails earlier and with a
   better message).
5. `g → kg`: `Decimal(g).scaleb(-3)` — exact, no division context involved.

```python
def kg_to_g(value: str | int | Decimal | None) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or isinstance(value, float):
        raise TypeError(f"float input forbidden at the kg/g boundary: {value!r}")
    try:
        kg = Decimal(value)
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"not a decimal load: {value!r}") from exc
    if not kg.is_finite():
        raise ValueError(f"non-finite load: {value!r}")
    grams = kg.scaleb(3)
    if grams != grams.to_integral_value():
        raise ValueError(f"sub-gram precision is not representable: {value!r}")
    if grams < 0:
        raise ValueError(f"negative load: {value!r}")
    return int(grams)


def g_to_kg(grams: int | None) -> Decimal | None:
    return None if grams is None else Decimal(grams).scaleb(-3)
```

### 16.3 Verified behaviour

| Input | Result |
|---|---|
| `"0"`, `0` | `0` g |
| `"0.5"` | `500` g |
| `"1.25"` | `1250` g |
| `"32.5"` | `32500` g |
| `"102.5"` | `102500` g |
| `"0.001"` | `1` g (one gram is the finest representable step) |
| `None` | `None` |
| `"0.0005"`, `"0.4999"` | **rejected** — sub-gram precision |
| `"-1"` | **rejected** — negative |
| `"NaN"`, `"Infinity"` | **rejected** — non-finite |
| `"heavy"` | **rejected** — not a decimal |
| `102.5` (float) | **rejected** — `TypeError` |

Round trips are exact for `0`, `0.5`, `1.25`, `32.5`, `102.5`, `220.75`.

### 16.4 Display

`g_to_kg` returns a `Decimal` with a scale of 3 (`Decimal('102.500')`). For display, use
**`format(value.normalize(), "f")`**, not `str(value.normalize())`. *(verified)*
`normalize()` alone renders `100` kg as `1E+2` and `60` kg as `6E+1`; the `"f"` format
suppresses exponent notation, giving `100`, `60`, `102.5`, `0.5`, `220.75`.

JSON input must be parsed with `json.loads(..., parse_float=Decimal)` so the mapper never
receives a float from the capture path.

---

## 17. M2 compatibility contract

M2 owns the program artifact schema, `program.json`, blocks/weeks/days structure, program
import, program versioning, and planned-workout generation. **None of it is prejudged here.**

The M1 performed model contains **no foreign key pointing outward** and **no column reserved
for a program**. That is what makes M2 safe.

M2 adds, additively:

```
program → program_version → planned_workout → planned_set        (all new tables)
workout_plan_link (workout_id UNIQUE, planned_workout_id)        (new association table)
```

Three properties follow, and they are the contract:

1. **`workout` and `performed_set` are never altered.** The link lives in its own table, so
   attaching plans is `CREATE TABLE` only — no rebuild of the tables holding irreplaceable
   data.
2. **Unplanned workouts stay first-class.** No link row means the session was not planned.
   Because the link is a table rather than a nullable column, "unplanned" is the natural
   default rather than a NULL that later reads as missing data.
3. **Planned history cannot be rewritten.** M2 makes `program_version` append-only: editing a
   program creates a new version, and already-generated `planned_workout` rows keep pointing
   at the version that produced them. Combined with the link table, changing next month's
   program cannot alter what last month's plan said — the `planned != performed` invariant
   enforced structurally rather than by discipline.

Planned superset/grouping semantics also belong to M2 program artifacts (§21).

---

## 18. Database constraints and indexes

### Constraints

| Constraint | Table | Purpose |
|---|---|---|
| `STRICT` (all tables) | all | Rejects wrong-typed values that affinity would coerce |
| `length(trim(name)) > 0` | `exercise` | No blank exercise names |
| `equipment_label IS NULL OR length(trim(...)) > 0` | `exercise` | `''` cannot become a third state |
| `is_active IN (0, 1)` | `exercise` | Boolean discipline |
| `date(performed_on) IS NOT NULL AND performed_on = date(performed_on)` | `workout` | Real calendar dates only (§9.3) |
| `performed_time_local IS NULL OR (time(...) IS NOT NULL AND ... = substr(time(...),1,5))` | `workout` | Valid `HH:MM` or absent |
| `status IN ('draft','complete')` | `workout` | Closed lifecycle |
| `set_order >= 1` | `performed_set` | Positions are 1-based |
| `load_g IS NULL OR load_g >= 0` | `performed_set` | No negative loads; NULL preserved |
| `reps IS NULL OR reps >= 0` | `performed_set` | No negative reps; NULL preserved; **no upper bound** |
| *(none on `rir`)* | `performed_set` | No methodology assumption in an expensive-to-rebuild table |

**Deliberately absent constraints:** any maximum load or rep count (inventing one would be an
unevidenced fitness assumption); any lower bound on `rir`; `NOT NULL` on `reps` or `set_type`;
`UNIQUE(performed_on)` on `workout`.

### Foreign keys

| From | To | On delete | Rationale |
|---|---|---|---|
| `performed_set.workout_id` | `workout.id` | **CASCADE** | Sets have no meaning without their workout |
| `performed_set.exercise_id` | `exercise.id` | **RESTRICT** | History can never be orphaned; retirement is the supported path |
| `performed_set.set_type` | `set_type.code` | **RESTRICT** | A code in use cannot vanish; NULL is permitted and unconstrained by the FK |

All foreign keys require `PRAGMA foreign_keys = ON` per connection (§11.2), without which they
are inert.

### Indexes

| Index | Purpose |
|---|---|
| `ux_exercise_identity` (UNIQUE, expression) | Prevents duplicate exercise identity (§5.3) |
| `ix_workout_performed_on` | History lookup by date. **Not unique** — two sessions per day are allowed |
| `UNIQUE (workout_id, set_order)` | Prevents duplicate set positions; also serves "all sets of a workout in order", so no separate index is needed |
| `ix_performed_set_exercise` | Without it, every `ON DELETE RESTRICT` check on an exercise scans the whole set table; also serves future per-exercise history |

---

## 19. Required tests

### Architecture

- `domain` imports nothing from `fitness_lab.storage`, `fitness_lab.api`, `sqlite3`, `fastapi`
  (extends the existing `backend/tests/test_architecture.py`).
- **New:** `storage` imports nothing from `fitness_lab.api` or `fastapi`.
- **New:** no module under `domain` references `load_g` — the grams representation must not
  leak out of storage.

### Domain (pure, no I/O)

- Completion rules: **C1** empty workout blocked; **C2** blocked with offending `set_order`
  values named; **C3** sparse order renumbered then accepted; **C4** blocked with offending
  `set_order` values named.
- Advisories raised for NULL `load_g` and NULL `rir` without blocking.
- `complete → draft` reopen permitted and re-runs nothing.
- A draft with NULL `reps` and NULL `set_type` is valid.
- `rename_exercise` and `create_exercise` are distinct operations (§5.4).

### kg ↔ grams (§16)

- Exact: `0`, `0.5`, `1.25`, `32.5`, `102.5`, `0.001`, integer input, `Decimal` input.
- `None → None` both directions.
- **Rejections:** `0.0005` and `0.4999` (sub-gram), `-1` (negative), `NaN`, `Infinity`,
  non-numeric text, and **any `float` input**.
- Round-trip exactness for all accepted values.
- Display uses `format(normalize(), "f")`: `100` kg renders `100`, not `1E+2`.
- JSON parsed with `parse_float=Decimal` yields exact grams; sub-gram JSON input is refused.

### Persistence

- `PRAGMA foreign_keys` reads `1` on a connection returned by `connect()` — the test that
  catches the M0 defect.
- `journal_mode` reads `wal` on a fresh connection that sets nothing (persisted at bootstrap).
- Full round-trip of a workout with mixed set types and mixed NULL/present `load_g`, `reps`,
  `rir`, `set_type`.
- `reps`: NULL accepted; `-1` rejected; NULL and `0` distinguishable in a query.
- `set_type`: NULL accepted; an invalid code rejected; `ON DELETE RESTRICT` still protects a
  referenced code.
- `rir`: **`-1` accepted and read back as `-1`** — a regression test that no methodology bound
  has crept into the schema; NULL and `0` distinguishable.
- Exercise identity: same name + different `equipment_label` → two rows, two ids; same name +
  **both labels NULL** → rejected (the `coalesce` trap, tested directly, since the naive index
  passes it); `''` and `'   '` labels rejected; case and whitespace variants rejected.
- Correcting `equipment_label` or `name` leaves every referencing `performed_set` row
  unchanged.
- Deactivating an exercise keeps its history readable.
- Deleting a workout cascades its sets; deleting a referenced exercise raises.
- Duplicate `(workout_id, set_order)` rejected.
- `STRICT` rejects text into `load_g`.
- Generated column: `INSERT` and `UPDATE` against `load_kg` both refused; `102500` reads as
  `102.5`.
- Date/time matrix: rejects `2026-02-31`, `2026-13-01`, `2026-10-1`, `1 Oct 2026`, `''`,
  `25:00`, `7:45`, `19:45:30`; accepts `2026-10-01`, `2028-02-29`, `19:45`.

### Migration

- Empty database → head produces the expected schema.
- **Legacy M0 database → head preserves the existing `m0_technical_check` row.**
- Re-running at head is a no-op **and creates no snapshot** (§13).
- Pending migrations create **exactly one** snapshot, which is itself a readable database.
- An edited already-applied file is refused with a checksum error.
- A failing migration rolls back, leaving `schema_migrations` unchanged.
- `PRAGMA foreign_key_check` is clean after every migration.

### Capture contract validator

- Accepts the §15.1 example.
- Rejects unknown `schema_version`, `units: "lb"`, malformed dates, negative values, unknown
  set types.
- A set with no `rir` key validates and is distinguishable from `"rir": 0`.
- Missing `reps` and missing `set_type` validate with a report, not a rejection.
- Ambiguous name-only exercise references are refused with candidates listed.

### Regression

All existing M0 backend tests, the frontend suite, and the Playwright end-to-end smoke test
must pass unchanged. That is the gate proving M1 did not break the verified M0 surface.

---

## 20. Architecture dependency rules

Dependency direction is one-way and unchanged from M0:

```
domain  ->  storage  ->  api  ->  web
```

- **`domain`** — pure fitness logic: entity types, `SetType`/`WorkoutStatus` enums, completion
  validation (C1–C4), set renumbering, and the kg↔grams mapper. No I/O, no database, no HTTP.
  Must not import `fitness_lab.storage`, `fitness_lab.api`, `sqlite3` or `fastapi`. Must not
  reference `load_g`; it speaks kilograms only.
- **`storage`** — SQLite access, migrations, repositories, and row↔domain mapping. The only
  layer that touches the database, and the only layer that knows grams. Must not import
  `fitness_lab.api` or `fastapi`.
- **`api`** — FastAPI boundary. **Unchanged in M1** beyond replacing the `init_db()` call in
  `lifespan` with the migration runner.
- **`web`** — **no M1 work.**

The database representation does not dictate the domain API: grams and SQL rows stop at the
storage boundary, and the domain exposes kilograms and value objects.

Repository functions are concrete, not an abstract interface with swappable backends. There is
one database, it is SQLite, and it will be SQLite in ten years.

---

## 21. Risks and known deferred concepts

### Resolved, recorded so they are not reopened

| Question | Decision |
|---|---|
| Supersets / circuits | **No `group_key` in M1.** Global chronological `set_order` is the canonical actual sequence; an A/B/A/B interleave is visible as an interleave. Grouping *intent* belongs to M2 program artifacts. The system must never claim rest / no-rest timing without recorded evidence. |
| Non-rep-based work (timed holds, carries) | **No duration fields in M1.** Timed-set semantics are not invented now. Nullable `reps` keeps a future `duration_seconds` strictly additive — a nullable column added to `performed_set` needs no rebuild. |
| Unilateral / per-side logging | **No `side` column.** Not added without a real requirement. |
| Multiple sessions per day | **Allowed.** No `UNIQUE(performed_on)`. Duplicate-date protection is a non-blocking domain warning surfaced to the UI. |
| Negative RIR | **No database lower bound.** Domain/UI policy may restrict entered values later without a migration. |
| Load storage | **Integer grams** in SQLite; kilograms in domain/API/UI/capture; conversion isolated and tested (§16); virtual `load_kg` retained and verified read-only. |

### Deferred concepts and their re-entry cost

| Concept | Deferred to | Cost to add later |
|---|---|---|
| `movement_family` | M3+ (when analytics defines what grouping means) | `CREATE TABLE` + nullable FK on `exercise` + short backfill of a small catalog. Never touches `performed_set`. |
| Equipment taxonomy | Indefinitely | Would replace `equipment_label`; only if free text proves inadequate. |
| `duration_seconds` | When timed work is actually logged | Nullable `ADD COLUMN`. Additive. |
| `side`, `group_key` | When a real requirement exists | Nullable `ADD COLUMN`. Additive, but rows logged before it exists will lack the data permanently. |
| Snapshot retention/pruning | Backup/export milestone | Independent of schema. |
| Capture importer | When needed, or before 1 October 2026 | Validator already exists; importer is contained. |
| e1RM, PRs, progression | M3+ | Pure computation over canonical evidence; no schema change. |
| Program / planned model | M2 | Additive tables + association table (§17). |

### Standing risks

1. **Foreign keys are off by default.** Every FK in §10 is inert without `PRAGMA
   foreign_keys = ON` on the connection. Mitigated by setting it in `connect()` and asserting
   it in a dedicated test.
2. **`CHECK` constraints pass on NULL.** SQL three-valued logic means a `CHECK` fails only on
   *false*. The `performed_on` constraint was initially written in a form that silently
   accepted `'2026-13-01'` for exactly this reason (§9.3). Every `CHECK` must be tested with
   bad input, never merely read.
3. **A duplicate exercise identity is silent.** Only the `coalesce` form of
   `ux_exercise_identity` catches the both-NULL case (§5.3). It must be tested directly,
   because the naive index passes an otherwise reasonable test suite.
4. **Float contamination at the kg boundary.** Gym plate weights are binary-exact, so a float
   implementation passes obvious tests and fails on upstream arithmetic (§16.1). Mitigated by
   rejecting `float` at the boundary and by `parse_float=Decimal` on the capture path.
5. **Set corrections are not versioned** (§14). A wrong correction overwrites the prior value.
   Accepted for a single-user application; the mitigation is the snapshot, not an audit table.
6. **The capture path could become a second entry system.** If it grows a CLI or UI it becomes
   a parallel product to maintain forever. Mitigated by shipping only the contract and
   validator in M1.

### Domain-policy decisions recorded for visibility

These are pure code with no schema consequence and are cheap to change:

1. Load is **advisory** at completion while reps and set type **block** (§7.3).
2. Ambiguous name-only exercise references in a capture file are **refused**, not
   auto-resolved (§15.3).
3. There is **no** default `set_type` in persistence; any preselection is a UI affordance only
   (§7.2).

---

*End of specification. No unresolved schema question remains.*
