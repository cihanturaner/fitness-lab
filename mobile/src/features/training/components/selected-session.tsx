import { StyleSheet, View } from 'react-native';

import { color, radius, shadow, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Icon } from '@/ui/icon';
import { ProgressBar } from '@/ui/progress-bar';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import type { SelectedDay, SelectedWorkout } from '../training-view';
import { StatusChip } from './status-chip';

type Props = { selected: SelectedWorkout | SelectedDay; onViewPlan: (date: string) => void };

/** The selected day: a workout gets the prominent card; rest and off-block days stay small. */
export function SelectedSession({ selected, onViewPlan }: Props) {
  if (selected.kind !== 'workout') {
    return (
      <Card style={styles.quiet}>
        <Text variant="eyebrow" tone="muted">
          {selected.eyebrow}
        </Text>
        <Text variant="title" accessibilityRole="header">
          {selected.title}
        </Text>
        <Text variant="body" tone="muted">
          {selected.note}
        </Text>
      </Card>
    );
  }

  return (
    <Card size="hero">
      <View style={styles.topRow}>
        <Text
          variant="eyebrow"
          tone={selected.isToday ? 'emerald700' : 'muted'}
          style={styles.eyebrow}>
          {selected.eyebrow}
        </Text>
        <StatusChip status={selected.status} label={selected.statusLabel} />
      </View>

      <Text variant="heroTitle" accessibilityRole="header" style={styles.title}>
        {selected.name}
      </Text>
      <Text variant="body" tone="muted" style={styles.focus}>
        {selected.focusLabel}
      </Text>
      <Text variant="caption" tone="muted" style={styles.meta}>
        {selected.metaLabel}
      </Text>

      {selected.progress ? (
        <View style={styles.progress}>
          <View style={styles.progressLabels}>
            <Text variant="numeric">{selected.progress.label}</Text>
            <Text variant="numeric" tone="muted">
              {selected.progress.percentLabel}
            </Text>
          </View>
          <ProgressBar
            value={selected.progress.value}
            height={8}
            color={selected.status === 'shortened' ? color.warn : color.emerald600}
          />
        </View>
      ) : null}

      <Pressable
        onPress={() => onViewPlan(selected.date)}
        accessibilityRole="button"
        accessibilityLabel={selected.planAccessibilityLabel}
        style={styles.cta}>
        <Text variant="button" tone="onPrimary">
          View plan
        </Text>
        <View style={styles.ctaIcon}>
          <Icon name="chevronRight" size={14} color={color.emerald800} />
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  quiet: { gap: space.xs, paddingVertical: space.lg },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  eyebrow: { flexShrink: 1 },
  title: { marginTop: space.md },
  focus: { marginTop: space.xs },
  meta: { marginTop: space.sm },
  progress: { marginTop: space.lg, gap: space.sm },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  cta: {
    marginTop: space.xl,
    height: 56,
    borderRadius: radius.xl - 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    backgroundColor: color.emerald700,
    boxShadow: shadow.cta,
  },
  ctaIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.round,
    backgroundColor: color.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
