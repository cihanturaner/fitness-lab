import { StyleSheet, View } from 'react-native';

import type { MuscleGroup } from '@/data/home-facts';
import { color, space } from '@/theme/tokens';
import { MuscleFocus } from '@/ui/anatomy/muscle-focus';
import { useAnatomyHeight } from '@/ui/anatomy/use-anatomy-height';
import { Card } from '@/ui/card';
import { HeroButton } from '@/ui/hero-button';
import { ProgressBar } from '@/ui/progress-bar';
import { StatusChip } from '@/ui/status-chip';
import { Text } from '@/ui/text';

import type { RestHero, WorkoutHero as WorkoutHeroView } from '../home-view';

type Props = {
  hero: WorkoutHeroView | RestHero;
  focusGroups: readonly MuscleGroup[];
  onOpenWorkout: () => void;
};

/**
 * Today's training card: the workout's name and status, its muscle focus drawn as the
 * centerpiece, progress kept secondary, and the one call to action anchored at the bottom.
 */
export function WorkoutHero({ hero, focusGroups, onOpenWorkout }: Props) {
  const anatomyHeight = useAnatomyHeight();

  if (hero.kind === 'rest') {
    return (
      <Card size="hero" style={styles.rest}>
        <Text variant="eyebrow" tone="muted">
          Today
        </Text>
        <Text variant="workoutName" tone="emerald700" accessibilityRole="header">
          Rest day
        </Text>
        <Text variant="body" tone="muted">
          {hero.nextLabel}
        </Text>
      </Card>
    );
  }

  return (
    <Card size="hero" style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.titles}>
          <Text variant="workoutName" tone="emerald700" accessibilityRole="header" numberOfLines={1}>
            {hero.name}
          </Text>
          <Text variant="caption" tone="muted">
            {hero.metaLabel}
          </Text>
        </View>
        <StatusChip status={hero.status} label={hero.statusLabel} />
      </View>

      <View style={styles.anatomy}>
        <MuscleFocus groups={focusGroups} labels={hero.focus} height={anatomyHeight} />
      </View>

      <View style={styles.progress}>
        <View style={styles.progressLabels}>
          <Text variant="numeric">{hero.setsLabel}</Text>
          {hero.status !== 'planned' ? (
            <Text variant="numeric" tone="muted">
              {Math.round(hero.progress * 100)}%
            </Text>
          ) : null}
        </View>
        {hero.status !== 'planned' ? (
          <ProgressBar
            value={hero.progress}
            height={6}
            color={hero.status === 'shortened' ? color.warn : color.emerald600}
          />
        ) : null}
        {hero.nextLabel ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            Up next · <Text variant="caption" tone="inkSoft">{hero.nextLabel}</Text>
          </Text>
        ) : null}
      </View>

      <HeroButton
        label={hero.cta.label}
        icon={hero.cta.emphasis === 'primary' ? 'play' : 'chevronRight'}
        emphasis={hero.cta.emphasis}
        accessibilityLabel={`${hero.cta.label}, ${hero.name}`}
        onPress={onOpenWorkout}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  rest: { gap: space.sm },
  card: { paddingBottom: space.xl },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  titles: { flex: 1, gap: 3 },
  anatomy: { marginTop: space.lg, marginBottom: space.lg },
  progress: { gap: space.sm, marginBottom: space.lg },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
});
