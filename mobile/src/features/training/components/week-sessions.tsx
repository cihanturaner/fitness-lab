import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { ProgressBar } from '@/ui/progress-bar';
import { Pressable } from '@/ui/pressable';
import { StatusChip } from '@/ui/status-chip';
import { Text } from '@/ui/text';

import type { SessionRow } from '../training-view';

type Props = {
  sessions: SessionRow[];
  restLabel: string | null;
  outsideLabel: string | null;
  onSelect: (date: string) => void;
};

/** The week's scheduled sessions as one light list; rest days fold into a line below it. */
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
                aria-selected={s.isSelected}
                style={[styles.row, s.isSelected && styles.rowSelected]}>
                <View style={[styles.date, s.isSelected && styles.dateSelected]}>
                  <Text
                    variant="caption"
                    tone={s.isSelected ? 'emerald100' : s.isToday ? 'emerald700' : 'muted'}
                    style={styles.weekday}>
                    {s.weekday}
                  </Text>
                  <Text variant="day" tone={s.isSelected ? 'onPrimary' : 'ink'}>
                    {s.day}
                  </Text>
                </View>
                <View style={styles.body}>
                  <View style={styles.nameRow}>
                    <Text variant="label" numberOfLines={1} style={styles.name}>
                      {s.name}
                    </Text>
                    <StatusChip status={s.status} label={s.statusLabel} plain />
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
    <Text variant="caption" tone="muted" style={styles.line}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  card: { padding: space.sm - 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 58,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
  },
  rowSelected: { backgroundColor: color.emerald50 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: color.hairline, marginHorizontal: space.md },
  date: {
    width: 40,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: color.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateSelected: { backgroundColor: color.emerald700 },
  weekday: { fontSize: 11, lineHeight: 13 },
  body: { flex: 1, gap: 2 },
  bar: { marginTop: space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  name: { flexShrink: 1 },
  line: { paddingHorizontal: space.sm, color: color.faint },
});
