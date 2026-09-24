import { StyleSheet, View } from 'react-native';

import { color, space } from '@/theme/tokens';
import { MuscleFocus } from '@/ui/anatomy/muscle-focus';
import { useAnatomyHeight } from '@/ui/anatomy/use-anatomy-height';
import { Card } from '@/ui/card';
import { HeroButton } from '@/ui/hero-button';
import { ProgressBar } from '@/ui/progress-bar';
import { StatusChip } from '@/ui/status-chip';
import { Text } from '@/ui/text';

import type { SelectedDay, SelectedWorkout } from '../training-view';

type Props = {
  selected: SelectedWorkout | SelectedDay;
  onOpen: (date: string, route: SelectedWorkout['cta']['route']) => void;
};

/**
 * The selected day. A workout gets the same hero card as Home — name, status, stated muscle
 * focus, progress, then its one action; rest and off-block days stay a small quiet card.
 */
export function SelectedSession({ selected, onOpen }: Props) {
  const anatomyHeight = useAnatomyHeight(0.84);

  if (selected.kind !== 'workout') {
    return (
      <Card size="hero" style={styles.quiet}>
        <Text variant="eyebrow" tone="muted">
          {selected.eyebrow}
        </Text>
        <Text variant="workoutName" tone="inkSoft" accessibilityRole="header">
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
      <Text
        variant="eyebrow"
        tone={selected.isToday ? 'emerald700' : 'muted'}
        numberOfLines={1}
        style={styles.eyebrow}>
        {selected.eyebrow}
      </Text>
      <View style={styles.topRow}>
        <Text
          variant="workoutName"
          tone="emerald700"
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.name}>
          {selected.name}
        </Text>
        <StatusChip status={selected.status} label={selected.statusLabel} />
      </View>
      <Text variant="caption" tone="muted" style={styles.meta}>
        {selected.metaLabel}
      </Text>

      {selected.focus.groups.length ? (
        <View style={styles.anatomy}>
          <MuscleFocus
            groups={selected.focus.groups}
            labels={selected.focus.names}
            height={anatomyHeight}
          />
        </View>
      ) : null}

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
            height={6}
            color={selected.status === 'shortened' ? color.warn : color.emerald600}
          />
        </View>
      ) : null}

      <View style={styles.cta}>
        <HeroButton
          label={selected.cta.label}
          icon={selected.cta.route === 'plan' ? 'chevronRight' : 'play'}
          accessibilityLabel={selected.cta.accessibilityLabel}
          onPress={() => onOpen(selected.date, selected.cta.route)}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  quiet: { gap: space.xs },
  eyebrow: { marginBottom: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { flex: 1 },
  meta: { marginTop: 3 },
  anatomy: { marginTop: space.lg },
  progress: { marginTop: space.lg, gap: space.sm },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  cta: { marginTop: space.xl },
});
