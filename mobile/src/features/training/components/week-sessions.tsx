import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { ProgressBar } from '@/ui/progress-bar';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import type { SessionRow } from '../training-view';
import { StatusChip } from './status-chip';

type Props = {
  sessions: SessionRow[];
  restLabel: string | null;
  outsideLabel: string | null;
  onSelect: (date: string) => void;
};

/** The week's scheduled sessions as one list; rest days fold into a single line below it. */
export function WeekSessions({ sessions, restLabel, outsideLabel, onSelect }: Props) {
  return (
    <View style={styles.stack}>
      {sessions.length ? (
        <Card style={styles.card}>
          {sessions.map((s, i) => (
            <Fragment key={s.date}>
              {i > 0 ? <View style={styles.rule} /> : null}
              <Pressable
                onPress={() => onSelect(s.date)}
                accessibilityRole="button"
                accessibilityLabel={s.accessibilityLabel}
                accessibilityState={{ selected: s.isSelected }}
                style={[styles.row, s.isSelected && styles.rowSelected]}>
                <View style={styles.date}>
                  <Text variant="caption" tone={s.isToday ? 'emerald700' : 'muted'}>
                    {s.weekday}
                  </Text>
                  <Text variant="bodyStrong" style={styles.dayNumber}>
                    {s.day}
                  </Text>
                </View>
                <View style={styles.body}>
                  <View style={styles.nameRow}>
                    <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>
                      {s.name}
                    </Text>
                    <StatusChip status={s.status} label={s.statusLabel} />
                  </View>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {s.detailLabel}
                  </Text>
                  {s.progress !== null ? (
                    <View style={styles.bar}>
                      <ProgressBar
                        value={s.progress}
                        height={4}
                        color={s.status === 'shortened' ? color.warn : color.emerald600}
                      />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            </Fragment>
          ))}
        </Card>
      ) : null}
      {restLabel ? <Line text={restLabel} /> : null}
      {outsideLabel ? <Line text={outsideLabel} /> : null}
    </View>
  );
}

function Line({ text }: { text: string }) {
  return (
    <View style={styles.line}>
      <Text variant="caption" tone="muted">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  card: { padding: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.lg,
  },
  rowSelected: { backgroundColor: color.emerald50 },
  rule: { height: 1, backgroundColor: color.hairline, marginHorizontal: space.md },
  date: { width: 34, alignItems: 'center' },
  dayNumber: { fontSize: 18, lineHeight: 22, fontVariant: ['tabular-nums'] },
  body: { flex: 1, gap: space.xxs },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  name: { flexShrink: 1 },
  bar: { marginTop: space.xs },
  line: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.sunken,
  },
});
