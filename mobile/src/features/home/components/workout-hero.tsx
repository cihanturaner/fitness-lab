import { StyleSheet, View } from 'react-native';

import type { MuscleGroup } from '@/data/home-facts';
import { color, radius, shadow, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Icon } from '@/ui/icon';
import { ProgressBar } from '@/ui/progress-bar';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import type { RestHero, WorkoutHero as WorkoutHeroView } from '../home-view';
import { MuscleFocus } from './muscle-focus';

type Props = {
  hero: WorkoutHeroView | RestHero;
  focusGroups: MuscleGroup[];
  onOpenWorkout: () => void;
};

const STATUS_TONE = {
  planned: { bg: color.planSurface, fg: color.plan },
  'in-progress': { bg: color.emerald50, fg: color.emerald800 },
  done: { bg: color.emerald50, fg: color.emerald800 },
  shortened: { bg: color.warnSurface, fg: color.warn },
} as const;

export function WorkoutHero({ hero, focusGroups, onOpenWorkout }: Props) {
  if (hero.kind === 'rest') {
    return (
      <Card size="hero" style={styles.rest}>
        <Text variant="eyebrow" tone="muted">
          Today
        </Text>
        <Text variant="heroTitle" accessibilityRole="header">
          Rest day
        </Text>
        <Text variant="body" tone="muted">
          {hero.nextLabel}
        </Text>
      </Card>
    );
  }

  const tone = STATUS_TONE[hero.status];
  const primary = hero.cta.emphasis === 'primary';
  return (
    <Card size="hero">
      <View style={styles.topRow}>
        <View style={[styles.status, { backgroundColor: tone.bg }]}>
          {hero.status === 'done' ? (
            <Icon name="check" size={12} color={tone.fg} />
          ) : (
            <View style={[styles.statusDot, { backgroundColor: tone.fg }]} />
          )}
          <Text variant="label" style={[styles.statusText, { color: tone.fg }]}>
            {hero.statusLabel}
          </Text>
        </View>
        <Text variant="caption" tone="muted">
          {hero.metaLabel}
        </Text>
      </View>

      <Text variant="heroTitle" accessibilityRole="header" style={styles.title}>
        {hero.name}
      </Text>
      <Text variant="body" tone="muted" style={styles.focus}>
        {hero.focus.join(' · ')}
      </Text>

      <MuscleFocus groups={focusGroups} labels={hero.focus} />

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
            height={8}
            color={hero.status === 'shortened' ? color.warn : color.emerald600}
          />
        ) : null}
      </View>

      {hero.nextLabel ? (
        <View style={styles.next}>
          <Text variant="eyebrow" tone="faint" style={styles.nextEyebrow}>
            Up next
          </Text>
          <Text variant="label" tone="inkSoft" numberOfLines={1} style={styles.nextText}>
            {hero.nextLabel}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={onOpenWorkout}
        accessibilityRole="button"
        accessibilityLabel={`${hero.cta.label}, ${hero.name}`}
        style={[styles.cta, primary ? styles.ctaPrimary : styles.ctaSecondary]}>
        <Text variant="button" tone={primary ? 'onPrimary' : 'emerald800'}>
          {hero.cta.label}
        </Text>
        <View style={[styles.ctaIcon, !primary && styles.ctaIconSecondary]}>
          <Icon
            name={primary ? 'play' : 'chevronRight'}
            size={14}
            color={primary ? color.emerald800 : color.emerald700}
          />
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  rest: { gap: space.sm },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, lineHeight: 16 },
  title: { marginTop: space.md },
  focus: { marginTop: space.xs, marginBottom: space.lg },
  progress: { marginTop: space.lg, gap: space.sm },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  next: {
    marginTop: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  nextEyebrow: { fontSize: 11 },
  nextText: { flex: 1 },
  cta: {
    marginTop: space.xl,
    height: 60,
    borderRadius: radius.xl - 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  ctaPrimary: { backgroundColor: color.emerald700, boxShadow: shadow.cta },
  ctaSecondary: {
    backgroundColor: color.emerald50,
    borderWidth: 1,
    borderColor: color.emerald100,
  },
  ctaIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.round,
    backgroundColor: color.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaIconSecondary: { backgroundColor: color.card },
});
