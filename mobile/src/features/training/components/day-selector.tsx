import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/theme/tokens';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import type { PlannerDay } from '../training-view';
import { STATUS_TONE } from './status-chip';

type Props = { days: PlannerDay[]; onSelect: (date: string) => void };

/**
 * The seven days of the shown block week. A filled tile is the selected day, a ringed one
 * is today; under the number a dot says what the day holds (hollow = planned, filled =
 * recorded, a short dash = rest). Days outside the block are dimmed.
 */
export function DaySelector({ days, onSelect }: Props) {
  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel="Days of the week">
      {days.map((d) => (
        <Pressable
          key={d.date}
          onPress={() => onSelect(d.date)}
          accessibilityRole="tab"
          accessibilityLabel={d.accessibilityLabel}
          // accessibilityState reaches iOS/Android; react-native-web reads only aria-selected
          // (an RN prop too), so both carry the same value.
          accessibilityState={{ selected: d.isSelected }}
          aria-selected={d.isSelected}
          style={styles.column}>
          <Text
            variant="caption"
            tone={d.isSelected || d.isToday ? 'emerald700' : 'muted'}
            style={[styles.weekday, d.kind === 'outside' && styles.dim]}>
            {d.weekday}
          </Text>
          <View
            style={[
              styles.tile,
              d.kind === 'outside' && styles.dim,
              d.isToday && !d.isSelected && styles.today,
              d.isSelected && styles.selected,
            ]}>
            <Text variant="bodyStrong" tone={d.isSelected ? 'onPrimary' : 'ink'} style={styles.day}>
              {d.day}
            </Text>
            <Mark day={d} />
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function Mark({ day }: { day: PlannerDay }) {
  if (day.kind !== 'workout' || !day.status) {
    const tint = day.isSelected ? color.emerald300 : color.hairline;
    return <View style={[styles.dash, { backgroundColor: day.kind === 'rest' ? tint : 'transparent' }]} />;
  }
  const hollow = day.status === 'planned' || day.status === 'not-recorded';
  const tone = day.isSelected ? color.onPrimary : STATUS_TONE[day.status].fg;
  const fill =
    day.status === 'in-progress' ? (day.isSelected ? color.emerald300 : color.emerald500) : tone;
  return (
    <View
      style={[
        styles.dot,
        hollow ? { borderWidth: 1.5, borderColor: tone } : { backgroundColor: fill },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.xs },
  column: { flex: 1, alignItems: 'center', gap: space.sm, minHeight: 88 },
  weekday: { fontSize: 12 },
  tile: {
    width: '100%',
    maxWidth: 50,
    height: 62,
    borderRadius: radius.lg,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  today: { borderWidth: 1.5, borderColor: color.emerald700 },
  selected: { backgroundColor: color.emerald700 },
  dim: { opacity: 0.45 },
  day: { fontSize: 18, lineHeight: 22, fontVariant: ['tabular-nums'] },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dash: { width: 10, height: 2, borderRadius: 1 },
});
