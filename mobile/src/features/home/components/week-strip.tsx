import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/theme/tokens';
import { Text } from '@/ui/text';

import type { DayMark, StripDay } from '../home-view';

/** The current Monday–Sunday week. A dot under a date says what that day held. */
export function WeekStrip({ days }: { days: StripDay[] }) {
  return (
    <View style={styles.row} accessibilityRole="list" accessibilityLabel="This week">
      {days.map((d) => (
        <View
          key={d.date}
          style={styles.column}
          accessible
          accessibilityLabel={d.accessibilityLabel}
          accessibilityState={{ selected: d.isToday }}>
          <Text variant="caption" tone={d.isToday ? 'emerald700' : 'faint'} style={styles.weekday}>
            {d.weekday}
          </Text>
          <View style={[styles.tile, d.isToday && styles.today]}>
            <Text
              variant="bodyStrong"
              tone={d.isToday ? 'onPrimary' : 'ink'}
              style={styles.day}>
              {d.day}
            </Text>
            <Mark mark={d.mark} onToday={d.isToday} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Mark({ mark, onToday }: { mark: DayMark; onToday: boolean }) {
  if (mark === 'rest') return <View style={styles.dot} />;
  const filled: Partial<Record<DayMark, string>> = {
    done: onToday ? color.onPrimary : color.emerald600,
    shortened: onToday ? color.warnSurface : color.warn,
    'in-progress': onToday ? color.emerald300 : color.emerald500,
  };
  const fill = filled[mark];
  if (fill) return <View style={[styles.dot, { backgroundColor: fill }]} />;
  const ring = mark === 'planned' ? (onToday ? color.onPrimary : color.plan) : color.faint;
  return <View style={[styles.dot, styles.ring, { borderColor: ring }]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  column: { alignItems: 'center', gap: space.sm, flex: 1 },
  weekday: { fontSize: 12 },
  tile: {
    width: 46,
    height: 58,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  today: { backgroundColor: color.emerald700 },
  day: { fontSize: 18, lineHeight: 22, fontVariant: ['tabular-nums'] },
  dot: { width: 6, height: 6, borderRadius: 3 },
  ring: { borderWidth: 1.5 },
});
