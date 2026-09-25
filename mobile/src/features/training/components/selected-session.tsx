import { StyleSheet, View } from 'react-native';

import { color, space } from '@/theme/tokens';
import { MuscleFocus } from '@/ui/anatomy/muscle-focus';
import { useAnatomyHeight } from '@/ui/anatomy/use-anatomy-height';
import { Card } from '@/ui/card';
import { HeroButton } from '@/ui/hero-button';
import { ProgressBar } from '@/ui/progress-bar';
import { QuietState } from '@/ui/quiet-state';
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
  const anatomyHeight = useAnatomyHeight(0.92, 50);

  if (selected.kind !== 'workout') {
    return (
      <QuietState
        icon={selected.kind === 'rest' ? 'week' : 'program'}
        eyebrow={selected.eyebrow}
        title={selected.title}
        note={selected.note}
      />
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
        <StatusChip status={selected.status} label={selected.statusLabel} plain />
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
  eyebrow: { marginBottom: space.xs },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { flex: 1 },
  meta: { marginTop: 2 },
  anatomy: { marginTop: space.md },
  progress: { marginTop: space.md, gap: space.sm },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  cta: { marginTop: space.md + 2 },
});
