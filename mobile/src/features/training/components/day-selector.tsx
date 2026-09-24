import { StyleSheet, View } from 'react-native';

import { color, radius, shadow, space } from '@/theme/tokens';
import { Pressable } from '@/ui/pressable';
import { STATUS_TONE } from '@/ui/status-chip';
import { Text } from '@/ui/text';

import type { PlannerDay } from '../training-view';

type Props = { days: PlannerDay[]; onSelect: (date: string) => void };

/**
 * The seven days of the shown block week, as light capsules on the page. The filled
 * capsule is the selected day, a ringed one is today; under it a mark says what the day
 * holds (ring = planned, dot = recorded, dash = rest). Days outside the block are dimmed.
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
          <View
            style={[
              styles.capsule,
              d.kind === 'outside' && styles.dim,
              d.isToday && !d.isSelected && styles.today,
              d.isSelected && styles.selected,
            ]}>
            <Text
              variant="caption"
              tone={d.isSelected ? 'emerald100' : d.isToday ? 'emerald700' : 'muted'}
              style={styles.weekday}>
              {d.weekday.slice(0, 1)}
            </Text>
            <Text
              variant="day"
              tone={d.isSelected ? 'onPrimary' : d.kind === 'workout' ? 'ink' : 'faint'}>
              {d.day}
            </Text>
          </View>
          <Mark day={d} />
        </Pressable>
      ))}
    </View>
  );
}

function Mark({ day }: { day: PlannerDay }) {
  if (day.kind !== 'workout' || !day.status) {
    return (
      <View
        style={[styles.dash, { backgroundColor: day.kind === 'rest' ? color.hairline : 'transparent' }]}
      />
    );
  }
  const hollow = day.status === 'planned' || day.status === 'not-recorded';
  const tone = STATUS_TONE[day.status].fg;
  const fill = day.status === 'in-progress' ? color.emerald500 : tone;
  return (
    <View
      style={[styles.dot, hollow ? { borderWidth: 1.5, borderColor: tone } : { backgroundColor: fill }]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.xs },
  column: { flex: 1, alignItems: 'center', gap: 6, minHeight: 74 },
  capsule: {
    width: '100%',
    maxWidth: 46,
    height: 62,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  weekday: { fontSize: 12, lineHeight: 15 },
  today: { borderWidth: 1.5, borderColor: color.emerald600 },
  selected: { backgroundColor: color.emerald700, boxShadow: shadow.cta },
  dim: { opacity: 0.45 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dash: { width: 9, height: 2, borderRadius: 1, marginVertical: 2 },
});

