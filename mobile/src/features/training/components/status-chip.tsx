import { StyleSheet, View } from 'react-native';

import type { DayStatus } from '@/domain/training';
import { color, radius } from '@/theme/tokens';
import { Icon } from '@/ui/icon';
import { Text } from '@/ui/text';

/** Status colours: steel blue = planned, emerald = recorded, amber = shortened. */
export const STATUS_TONE: Record<DayStatus, { bg: string; fg: string }> = {
  planned: { bg: color.planSurface, fg: color.plan },
  'in-progress': { bg: color.emerald50, fg: color.emerald800 },
  done: { bg: color.emerald50, fg: color.emerald800 },
  shortened: { bg: color.warnSurface, fg: color.warn },
  'not-recorded': { bg: color.sunken, fg: color.muted },
};

export function StatusChip({ status, label }: { status: DayStatus; label: string }) {
  const tone = STATUS_TONE[status];
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      {status === 'done' ? (
        <Icon name="check" size={11} color={tone.fg} />
      ) : (
        <View
          style={[
            styles.dot,
            status === 'planned' || status === 'not-recorded'
              ? { borderWidth: 1.5, borderColor: tone.fg }
              : { backgroundColor: tone.fg },
          ]}
        />
      )}
      <Text variant="label" style={[styles.text, { color: tone.fg }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 13, lineHeight: 16 },
});
