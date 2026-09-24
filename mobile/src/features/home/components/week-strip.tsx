import { StyleSheet, View } from 'react-native';

import { color, radius, shadow, space } from '@/theme/tokens';
import { Text } from '@/ui/text';

import type { DayMark, StripDay } from '../home-view';

/**
 * The current Monday–Sunday week as one light row of dates. Today is the filled pill
 * ("Thu 8"); a training day's number is ink, a rest day's is faint, and a small mark under
 * a training day says what it held (filled = recorded, ring = planned).
 */
export function WeekStrip({ days }: { days: StripDay[] }) {
  return (
    <View style={styles.row} accessibilityRole="list" accessibilityLabel="This week">
      {days.map((d) => (
        <View
          key={d.date}
          style={[styles.cell, d.isToday && styles.todayCell]}
          accessible
          accessibilityLabel={d.accessibilityLabel}
          accessibilityState={{ selected: d.isToday }}>
          <View style={[styles.pill, d.isToday && styles.today]}>
            {d.isToday ? (
              <Text variant="day" tone="onPrimary" numberOfLines={1}>
                {d.weekdayShort} {d.day}
              </Text>
            ) : (
              <Text variant="day" tone={d.mark === 'rest' ? 'faint' : 'ink'}>
                {d.day}
              </Text>
            )}
          </View>
          <Mark mark={d.mark} />
        </View>
      ))}
    </View>
  );
}

function Mark({ mark }: { mark: DayMark }) {
  if (mark === 'rest') return <View style={styles.dot} />;
  const filled: Partial<Record<DayMark, string>> = {
    done: color.emerald600,
    shortened: color.warn,
    'in-progress': color.emerald500,
  };
  const fill = filled[mark];
  if (fill) return <View style={[styles.dot, { backgroundColor: fill }]} />;
  const ring = mark === 'planned' ? color.plan : color.faint;
  return <View style={[styles.dot, styles.ring, { borderColor: ring }]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cell: { flex: 1, alignItems: 'center', gap: 5 },
  todayCell: { flex: 2 },
  pill: {
    height: 40,
    minWidth: 40,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  today: {
    paddingHorizontal: space.md,
    backgroundColor: color.emerald700,
    boxShadow: shadow.cta,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  ring: { borderWidth: 1.2 },
});
