# Emergency raw-capture contract, version 1

**Purpose.** If the application is unavailable on or after 1 October 2026, raw workout
evidence must still be capturable in a portable structured form and later imported
deterministically. This is deadline insurance, not a historical-import product feature.
No UI is required: the file is writable by hand in a text editor.

**Status in M1.** The contract and a pure validator
(`backend/src/fitness_lab/domain/capture.py`) ship. **The importer does not.** It is
written later, against a schema that exists, with time to test it. This path must never
grow a CLI or an entry UI — that would make it a second workout-entry application to
maintain forever.

## Shape

See `raw-capture-v1.example.json`, which is loaded verbatim by
`backend/tests/test_capture_contract.py` so the document and the validator cannot drift.

## Rules

- `schema_version` is **required** and must be `1`. An unknown version is a hard refusal,
  never a best-effort parse.
- `units` **must** be `"kg"`. It exists so a future reader cannot misread the file. Any
  other value is refused, never converted. There is no lb support anywhere in the system.
- **Set order is array order.** An explicit `set_order` (integer >= 1) is accepted as an
  override for an edited file; duplicates within one workout are refused.
- `load_kg` is kilograms and is converted through the canonical mapper
  (`fitness_lab.domain.units.kg_to_g`). The file **must** be parsed with
  `json.loads(..., parse_float=Decimal)` so no value passes through binary floating point.
  Sub-gram precision and negative loads are refused, never rounded. `load_kg` is
  **optional**. Omitting it imports as NULL and is reported, not rejected. An explicit
  `null` is refused: omission is the only representation of "not recorded", so a hand-typed
  `null` is a mistake to catch, not a second way to say the same thing.
- `reps` is **optional**. Omitting it imports as NULL. This is safe because imported
  workouts land as `draft`, and completion rule C2 blocks promotion until reps are
  supplied. The validator **reports** every set missing reps rather than rejecting the
  file.
- `set_type` is **optional**, imports as NULL, and is likewise reported — rule C4 blocks
  completion until it is classified. When supplied it must be one of `warmup`, `working`,
  `backoff`.
- `rir` is optional and **unbounded**: an integer of either sign, or absent. Absent is not
  `0`.
- `notes` is optional on both workouts and sets.
- Omission is the only representation of "not recorded". There is no sentinel value.
- `performed_on` is a civil local date `YYYY-MM-DD`; `performed_time_local` is optional
  civil local `HH:MM`. No timezone, offset or UTC instant appears anywhere in the file.

## Exercise resolution

`exercise` is a name, with `equipment_label` as an optional sibling field. An explicit
`{"id": "..."}` form is also accepted. Resolution order:

1. Explicit `id` → exact match.
2. Normalized `(name, equipment_label)` pair — the same `lower(trim(...))` /
   `coalesce(..., '')` rule as `ux_exercise_identity` → exact match.
3. Name alone → **must resolve to exactly one exercise.**

**Ambiguity is refused, never guessed**, with the candidates listed. Guessing wrong would
attach a session to the wrong machine's strength history — precisely the corruption
`equipment_label` exists to prevent. Unresolved names never auto-create; that will be an
explicit importer decision.

## Import behaviour (specified here, implemented later)

The importer will record the file's `sha256` so an identical re-run is a no-op, run a
dry-run report before an explicit apply, and land every imported workout as `draft` so it
is reviewed before becoming evidence.
