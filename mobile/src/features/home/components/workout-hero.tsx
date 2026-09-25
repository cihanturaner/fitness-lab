import { StyleSheet, View } from 'react-native';

import type { MuscleGroup } from '@/data/home-facts';
import { color, space } from '@/theme/tokens';
import { MuscleFocus } from '@/ui/anatomy/muscle-focus';
import { useAnatomyHeight } from '@/ui/anatomy/use-anatomy-height';
import { Card } from '@/ui/card';
import { HeroButton } from '@/ui/hero-button';
import { ProgressBar } from '@/ui/progress-bar';
import { StatusChip } from '@/ui/status-chip';
import { QuietState } from '@/ui/quiet-state';
import { Text } from '@/ui/text';

import type { RestHero, SetupHero, WorkoutHero as WorkoutHeroView } from '../home-view';

type Props = {
  hero: WorkoutHeroView | RestHero | SetupHero;
  focusGroups: readonly MuscleGroup[];
  onOpenWorkout: () => void;
  onOpenSettings: () => void;
};

/**
 * Today's training card: the workout's name and status, its muscle focus drawn as the
 * centerpiece, progress kept secondary, and the one call to action anchored at the bottom.
 */
export function WorkoutHero({ hero, focusGroups, onOpenWorkout, onOpenSettings }: Props) {
  const anatomyHeight = useAnatomyHeight();

  if (hero.kind === 'setup') {
    return (
      <QuietState icon="program" eyebrow="Training block" title="Not started yet" note={hero.note}>
        <HeroButton label="Set block start" icon="chevronRight" accessibilityLabel="Set block start in Settings" onPress={onOpenSettings} />
      </QuietState>
    );
  }

  if (hero.kind === 'rest') {
    return <QuietState icon="week" eyebrow="Today" title="Rest day" note={hero.nextLabel} />;
  }

  const started = hero.status !== 'planned';
  return (
    <Card size="hero" style={styles.card}>
      <View style={styles.topRow}>
        <Text
          variant="workoutName"
          tone="emerald700"
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.name}>
          {hero.name}
        </Text>
        <StatusChip status={hero.status} label={hero.statusLabel} plain />
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {hero.metaLabel}
        {started ? null : <Text variant="caption" tone="muted">{` · ${hero.setsLabel}`}</Text>}
      </Text>

      <View style={styles.anatomy}>
        <MuscleFocus groups={focusGroups} labels={hero.focus} height={anatomyHeight} />
      </View>

      {started ? (
        // Once sets are recorded: one line of progress and what comes next — secondary.
        <View style={styles.progress}>
          <View style={styles.progressRow}>
            <Text variant="numeric">{hero.setsLabel}</Text>
            <View style={styles.bar}>
              <ProgressBar
                value={hero.progress}
                height={5}
                color={hero.status === 'shortened' ? color.warn : color.emerald600}
              />
            </View>
            <Text variant="numeric" tone="muted">
              {Math.round(hero.progress * 100)}%
            </Text>
          </View>
          {hero.nextLabel ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              Up next · <Text variant="caption" tone="inkSoft">{hero.nextLabel}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}

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
  card: { paddingTop: space.lg + 2, paddingBottom: space.lg + 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: 2 },
  name: { flex: 1 },
  anatomy: { marginTop: space.md, marginBottom: space.md + 2 },
  progress: { gap: space.xs + 2, marginBottom: space.md + 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  bar: { flex: 1 },
});
