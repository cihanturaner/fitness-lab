import { StyleSheet, View } from 'react-native';

import type { SetValues } from '@/data/repo/workouts';
import { color, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import type { ExerciseBlock, LoggedRow } from '../workout-view';
import { SetEntry } from './set-entry';

/** Which row of a card is open for entry. */
export type OpenRow = { kind: 'new' } | { kind: 'edit'; setId: number } | null;

type Props = {
  block: ExerciseBlock;
  editable: boolean;
  open: OpenRow;
  /** The lifter tapped this row (rather than the card opening on the next set). */
  focusOnOpen: boolean;
  onOpen: (row: OpenRow) => void;
  onLog: (values: SetValues) => Promise<void>;
  onUpdate: (setId: number, values: SetValues) => Promise<void>;
  onDelete: (row: LoggedRow) => void;
  onChange: () => void;
};

/**
 * One planned slot: what the program prescribes (never merged with what was lifted), the
 * sets logged in this slot, and the rows still to log. The slot holding the next planned
 * set carries an emerald edge; its next row is open for entry.
 */
export function ExerciseCard({ block, editable, open, focusOnOpen, onOpen, onLog, onUpdate, onDelete, onChange }: Props) {
  const nextPending = block.pending[0];
  const extraNumber = block.logged.length + 1;
  const lastHint = block.pending.at(-1) ?? null;
  return (
    <Card style={[styles.card, block.isNext && editable && styles.next]} accessibilityLabel={block.accessibilityLabel}>
      <View style={styles.head}>
        <View style={[styles.order, block.complete && styles.orderDone]}>
          {block.complete ? (
            <Icon name="check" size={13} color={color.onPrimary} />
          ) : (
            <Text variant="numeric" tone="emerald800">
              {block.order}
            </Text>
          )}
        </View>
        <View style={styles.titles}>
          <Text variant="bodyStrong" accessibilityRole="header">
            {block.name}
          </Text>
          {block.plannedName ? (
            <Text variant="caption" tone="warn">
              Planned: {block.plannedName} · changed for this workout
            </Text>
          ) : null}
        </View>
        <Text variant="numeric" tone={block.complete ? 'emerald700' : 'muted'} accessibilityLabel={`${block.countLabel} sets`}>
          {block.countLabel}
        </Text>
      </View>

      <View style={styles.plan}>
        <Text variant="caption" tone="inkSoft">
          {block.prescription}
        </Text>
        <Text variant="caption" tone="muted">
          {block.details}
          {block.marker ? ' · Marker lift' : ''}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {block.lastLabel}
        </Text>
      </View>

      {block.logged.length || block.pending.length ? (
        <View style={styles.columns} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text variant="eyebrow" tone="faint" style={styles.colSet}>
            Set
          </Text>
          <Text variant="eyebrow" tone="faint" style={styles.colLb}>
            lb
          </Text>
          <Text variant="eyebrow" tone="faint" style={styles.colReps}>
            Reps
          </Text>
          <Text variant="eyebrow" tone="faint" style={styles.colRir}>
            RIR
          </Text>
          <View style={styles.colAction} />
        </View>
      ) : null}

      <View style={styles.rows}>
        {block.logged.map((row) =>
          editable && open?.kind === 'edit' && open.setId === row.setId ? (
            <SetEntry
              key={row.setId}
              number={row.number}
              exerciseName={block.name}
              mode="edit"
              autoFocus
              initial={{ load: row.loadText, reps: row.repsText, rir: row.rirText }}
              hints={{ reps: 'reps', rir: 'RIR' }}
              onSubmit={(values) => onUpdate(row.setId, values)}
              onDelete={() => onDelete(row)}
              onCancel={() => onOpen(null)}
            />
          ) : (
            <Pressable
              key={row.setId}
              disabled={!editable}
              onPress={() => onOpen({ kind: 'edit', setId: row.setId })}
              accessibilityRole={editable ? 'button' : 'text'}
              accessibilityLabel={`Set ${row.number}: ${row.summary}${row.warmup ? ', warm-up' : ''}${editable ? '. Tap to correct' : ''}`}
              style={styles.row}>
              <Text variant="numeric" tone="muted" style={styles.colSet}>
                {row.number}
              </Text>
              <Text variant="bodyStrong" style={styles.colLb}>
                {row.loadText || '—'}
              </Text>
              <Text variant="bodyStrong" style={styles.colReps}>
                {row.repsText || '—'}
              </Text>
              <Text variant="bodyStrong" tone="inkSoft" style={styles.colRir}>
                {row.rirText || '—'}
              </Text>
              <View style={styles.colAction}>
                {row.warmup ? (
                  <Text variant="caption" tone="muted">
                    warm-up
                  </Text>
                ) : (
                  <Icon name="check" size={14} color={color.emerald600} />
                )}
              </View>
            </Pressable>
          ),
        )}

        {block.pending.map((p, i) =>
          editable && i === 0 && open?.kind === 'new' ? (
            <SetEntry
              key={`p${p.number}`}
              number={p.number}
              exerciseName={block.name}
              mode="new"
              autoFocus={focusOnOpen}
              initial={{ load: p.loadPrefill, reps: '', rir: '' }}
              hints={{ reps: p.repsHint, rir: p.rirHint }}
              onSubmit={onLog}
            />
          ) : (
            <Pressable
              key={`p${p.number}`}
              disabled={!editable || i !== 0}
              onPress={() => onOpen({ kind: 'new' })}
              accessibilityRole={editable && i === 0 ? 'button' : 'text'}
              accessibilityLabel={`Set ${p.number}, planned ${p.repsHint} reps at RIR ${p.rirHint}, not logged${editable && i === 0 ? '. Tap to log' : ''}`}
              style={[styles.row, styles.pending]}>
              <Text variant="numeric" tone="faint" style={styles.colSet}>
                {p.number}
              </Text>
              <Text variant="body" tone="faint" style={styles.colLb}>
                —
              </Text>
              <Text variant="body" tone="faint" style={styles.colReps}>
                {p.repsHint}
              </Text>
              <Text variant="body" tone="faint" style={styles.colRir}>
                {p.rirHint}
              </Text>
              <View style={styles.colAction} />
            </Pressable>
          ),
        )}

        {editable && nextPending === undefined && open?.kind === 'new' ? (
          <SetEntry
            number={extraNumber}
            exerciseName={block.name}
            mode="new"
            autoFocus
            initial={{ load: block.logged.at(-1)?.loadText ?? '', reps: '', rir: '' }}
            hints={{ reps: lastHint?.repsHint ?? 'reps', rir: lastHint?.rirHint ?? 'RIR' }}
            onSubmit={onLog}
          />
        ) : null}
      </View>

      {editable ? (
        <View style={styles.actions}>
          {nextPending === undefined && open?.kind !== 'new' ? (
            <Pressable
              onPress={() => onOpen({ kind: 'new' })}
              accessibilityRole="button"
              accessibilityLabel={`Add a set to ${block.name}`}
              style={styles.action}>
              <Icon name="add" size={14} color={color.emerald700} />
              <Text variant="label" tone="emerald700">
                Add set
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Pressable
            onPress={onChange}
            accessibilityRole="button"
            accessibilityLabel={`Change exercise for this workout: ${block.name}`}
            style={styles.action}>
            <Icon name="swap" size={14} color={color.inkSoft} />
            <Text variant="label" tone="inkSoft">
              Change
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  next: { borderWidth: 1.5, borderColor: color.emerald300 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  order: {
    width: 26,
    height: 26,
    borderRadius: radius.round,
    backgroundColor: color.emerald50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -1,
  },
  orderDone: { backgroundColor: color.emerald600 },
  titles: { flex: 1, gap: 2 },
  plan: { gap: 2, paddingLeft: 38 },
  columns: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: -space.xs },
  rows: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  pending: {},
  colSet: { width: 30, textAlign: 'center', letterSpacing: 0 },
  colLb: { flex: 1.25, textAlign: 'center' },
  colReps: { flex: 1, textAlign: 'center' },
  colRir: { flex: 0.9, textAlign: 'center' },
  colAction: { width: 46, alignItems: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.xs },
});
