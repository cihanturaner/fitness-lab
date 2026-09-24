/**
 * Rules of one performed workout (a session), mirroring the desktop's `domain/placement.py`
 * and `domain/completion.py`. Pure: no I/O.
 *
 * Slot identity: a set recorded in a planned slot carries that placement, so two slots
 * performed as the same exercise keep their own sets; a placement of `null` is recorded
 * extra work. A set with no recorded placement (`undefined` — recorded before placements
 * existed) belongs to the first slot, by position, performed as its exercise, else it is
 * extra work. Sets are never grouped by exercise alone.
 */

export type SetType = 'warmup' | 'working' | 'backoff';

export type PerformedSet = {
  id: number;
  exerciseId: number;
  setOrder: number;
  setType: SetType | null;
  loadG: number | null;
  reps: number | null;
  rir: number | null;
  /** The slot it was recorded in; null = recorded as extra work; undefined = none recorded. */
  placement: string | null | undefined;
};

export type SlotIdentity = {
  slotKey: string;
  /** 1-based order of the slot in its workout. */
  position: number;
  plannedExerciseId: number;
  /** The exercise the slot is performed as in this workout: its substitute, else planned. */
  performedExerciseId: number;
};

/** Each set's slot key, or null when it is extra work. */
export function placeSets(
  slots: readonly SlotIdentity[],
  sets: readonly PerformedSet[],
): Map<number, string | null> {
  const known = new Set(slots.map((s) => s.slotKey));
  const firstFor = new Map<number, string>();
  for (const slot of [...slots].sort((a, b) => a.position - b.position)) {
    if (!firstFor.has(slot.performedExerciseId)) firstFor.set(slot.performedExerciseId, slot.slotKey);
  }
  const result = new Map<number, string | null>();
  for (const set of sets) {
    if (set.placement === undefined) result.set(set.id, firstFor.get(set.exerciseId) ?? null);
    else result.set(set.id, set.placement !== null && known.has(set.placement) ? set.placement : null);
  }
  return result;
}

export type GroupedSets = {
  /** Every slot's sets in the order they were recorded (empty when none). */
  bySlot: Map<string, PerformedSet[]>;
  /** Extra work, one group per exercise, in the order it was trained. */
  extra: { exerciseId: number; sets: PerformedSet[] }[];
};

export function groupSets(slots: readonly SlotIdentity[], sets: readonly PerformedSet[]): GroupedSets {
  const placed = placeSets(slots, sets);
  const bySlot = new Map<string, PerformedSet[]>(slots.map((s) => [s.slotKey, []]));
  const extra = new Map<number, PerformedSet[]>();
  for (const set of [...sets].sort((a, b) => a.setOrder - b.setOrder)) {
    const slot = placed.get(set.id) ?? null;
    if (slot !== null) bySlot.get(slot)?.push(set);
    else extra.set(set.exerciseId, [...(extra.get(set.exerciseId) ?? []), set]);
  }
  return {
    bySlot,
    extra: [...extra.entries()].map(([exerciseId, group]) => ({ exerciseId, sets: group })),
  };
}

/** A set that counts as work: anything but a warm-up (an untyped legacy set counts). */
export function isWorkSet(set: Pick<PerformedSet, 'setType'>): boolean {
  return set.setType !== 'warmup';
}

export type WorkSetTotals = { planned: number; actual: number; short: boolean };

/**
 * Non-warm-up sets recorded (extra work included) against the origin's planned non-warm-up
 * sets. Totals only — never matched set by set.
 */
export function workSetTotals(plannedWorkSets: number, sets: readonly PerformedSet[]): WorkSetTotals {
  const actual = sets.filter(isWorkSet).length;
  return { planned: plannedWorkSets, actual, short: actual < plannedWorkSets };
}

export type CompletionBlocker = 'no-sets' | 'missing-reps';

/** Why a draft cannot be completed yet; missing load or RIR never blocks. */
export function completionBlockers(sets: readonly PerformedSet[]): CompletionBlocker[] {
  if (sets.length === 0) return ['no-sets'];
  return sets.some((s) => s.reps === null) ? ['missing-reps'] : [];
}

export type NextSet = { slotKey: string; setNumber: number; setCount: number };

/**
 * The first slot, in program order, with fewer work sets recorded than planned, and the
 * set number that comes next in it; null when every slot has its planned sets.
 */
export function nextPlannedSet(
  slots: readonly (SlotIdentity & { plannedSets: number })[],
  sets: readonly PerformedSet[],
): NextSet | null {
  const { bySlot } = groupSets(slots, sets);
  for (const slot of [...slots].sort((a, b) => a.position - b.position)) {
    const done = (bySlot.get(slot.slotKey) ?? []).filter(isWorkSet).length;
    if (done < slot.plannedSets) {
      return { slotKey: slot.slotKey, setNumber: done + 1, setCount: slot.plannedSets };
    }
  }
  return null;
}
