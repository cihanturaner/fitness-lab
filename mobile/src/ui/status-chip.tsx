import { StyleSheet, View } from 'react-native';

import type { DayStatus } from '@/domain/training';
import { color, radius } from '@/theme/tokens';

import { Icon } from './icon';
import { Text } from './text';

/** Status colours: steel blue = planned, emerald = recorded, amber = shortened. */
export const STATUS_TONE: Record<DayStatus, { bg: string; fg: string }> = {
  planned: { bg: color.planSurface, fg: color.plan },
  'in-progress': { bg: color.emerald50, fg: color.emerald800 },
  done: { bg: color.emerald50, fg: color.emerald800 },
  shortened: { bg: color.warnSurface, fg: color.warn },
  'not-recorded': { bg: color.sunken, fg: color.muted },
};

type Props = {
  status: DayStatus;
  label: string;
  /** `plain` drops the surface: just the mark and the word, for rows inside a list. */
  plain?: boolean;
};

export function StatusChip({ status, label, plain = false }: Props) {
  const tone = STATUS_TONE[status];
  return (
    <View style={[styles.chip, plain ? styles.plain : { backgroundColor: tone.bg }]}>
      <StatusMark status={status} tint={tone.fg} />
      <Text variant="label" style={[styles.text, { color: tone.fg }]}>
        {label}
      </Text>
    </View>
  );
}

/** Tick for done, ring for not yet recorded, filled dot for recorded work. */
export function StatusMark({ status, tint }: { status: DayStatus; tint: string }) {
  if (status === 'done') return <Icon name="check" size={11} color={tint} />;
  const hollow = status === 'planned' || status === 'not-recorded';
  return (
    <View
      style={[
        styles.dot,
        hollow ? { borderWidth: 1.5, borderColor: tint } : { backgroundColor: tint },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.round,
  },
  plain: { paddingHorizontal: 0, paddingVertical: 0 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 13, lineHeight: 16 },
});
