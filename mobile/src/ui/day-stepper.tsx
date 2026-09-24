import { StyleSheet, View } from 'react-native';

import { addDays, parseIsoDate, type IsoDate } from '@/domain/dates';
import { color, hitTarget, radius, shadow } from '@/theme/tokens';

import { Icon } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

type Props = { date: IsoDate; today: IsoDate; label: string; onChange: (date: IsoDate) => void };

/** ‹ day › — steps one day at a time; never past today (a future day cannot be recorded). */
export function DayStepper({ date, today, label, onChange }: Props) {
  const atToday = parseIsoDate(date) >= parseIsoDate(today);
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(addDays(date, -1))}
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        style={styles.arrow}>
        <Icon name="chevronLeft" size={15} color={color.emerald700} />
      </Pressable>
      <View style={styles.center}>
        <Text variant="bodyStrong" accessibilityRole="header">
          {label}
        </Text>
        {date !== today ? (
          <Pressable onPress={() => onChange(today)} accessibilityRole="button" hitSlop={6}>
            <Text variant="caption" tone="emerald700">
              Back to today
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        onPress={() => onChange(addDays(date, 1))}
        disabled={atToday}
        accessibilityRole="button"
        accessibilityLabel={atToday ? 'Next day, unavailable: a future day cannot be recorded' : 'Next day'}
        accessibilityState={{ disabled: atToday }}
        style={[styles.arrow, atToday && styles.disabled]}>
        <Icon name="chevronRight" size={15} color={color.emerald700} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.card,
    borderRadius: radius.round,
    padding: 5,
    boxShadow: shadow.card,
  },
  center: { flex: 1, alignItems: 'center', gap: 1 },
  arrow: {
    width: hitTarget,
    height: hitTarget,
    borderRadius: radius.round,
    backgroundColor: color.emerald50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
});
