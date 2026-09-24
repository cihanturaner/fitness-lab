import { Stack } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TrainingFacts } from '@/data/training-facts';
import { color, gutter, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Text } from '@/ui/text';

import { StatusChip } from '@/ui/status-chip';
import { buildSessionPreview, type PlanExercise } from './training-view';

/**
 * A scheduled workout's plan, read-only: what is prescribed, in program order. Nothing
 * here records, edits or completes anything — logging is a later milestone.
 */
export function SessionPlanScreen({ facts, date }: { facts: TrainingFacts; date: string }) {
  const insets = useSafeAreaInsets();
  const preview = useMemo(() => buildSessionPreview(facts, date), [facts, date]);

  // The stack header sits above this screen and owns the top safe area.
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
      showsVerticalScrollIndicator={false}>
      <Stack.Screen options={{ title: preview?.name ?? 'Workout plan' }} />
      {!preview ? (
        <Card>
          <Text variant="bodyStrong">No workout planned</Text>
          <Text variant="body" tone="muted">
            This day has no scheduled session in the block.
          </Text>
        </Card>
      ) : (
        <>
          <Card size="hero">
            <Text variant="eyebrow" tone={preview.isToday ? 'emerald700' : 'muted'}>
              {[preview.isToday ? 'Today' : null, preview.dateLabel].filter(Boolean).join(' · ')}
            </Text>
            <Text variant="workoutName" tone="emerald700" accessibilityRole="header" style={styles.title}>
              {preview.name}
            </Text>
            {preview.weekLabel ? (
              <Text variant="body" tone="muted">
                {preview.weekLabel}
              </Text>
            ) : null}
            <View style={styles.statusRow}>
              <StatusChip status={preview.status} label={preview.statusLabel} />
              {preview.progressLabel ? (
                <Text variant="numeric" tone="inkSoft" style={styles.progress}>
                  {preview.progressLabel}
                </Text>
              ) : null}
            </View>
            <View style={styles.stats}>
              {preview.stats.map((s) => (
                <View
                  key={s.label}
                  style={styles.stat}
                  accessible
                  accessibilityLabel={`${s.value} ${s.label.replace('min, est.', 'minutes, estimated')}`}>
                  <Text variant="metric">{s.value}</Text>
                  <Text variant="caption" tone="muted">
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <Text variant="title" accessibilityRole="header" style={styles.section}>
            Exercises
          </Text>
          <Card style={styles.list}>
            {preview.exercises.map((e, i) => (
              <Fragment key={`${e.order}-${e.name}`}>
                {i > 0 ? <View style={styles.rule} /> : null}
                <ExerciseRow exercise={e} />
              </Fragment>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function ExerciseRow({ exercise: e }: { exercise: PlanExercise }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={e.accessibilityLabel}>
      <View style={styles.order}>
        <Text variant="label" tone="emerald800" style={styles.orderText}>
          {e.order}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text variant="bodyStrong" style={styles.name}>
            {e.name}
          </Text>
          {e.marker ? (
            <View style={styles.marker}>
              <Text variant="label" tone="plan" style={styles.markerText}>
                Marker
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="numeric" tone="inkSoft">
          {e.setsLabel} · {e.repsLabel}
        </Text>
        <Text variant="numeric" tone="inkSoft">
          {e.rirLabel}
        </Text>
        <Text variant="caption" tone="muted">
          {e.restLabel} · {e.failureLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: gutter, paddingTop: space.lg },
  title: { marginTop: space.sm, marginBottom: space.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  progress: { flexShrink: 1 },
  stats: { flexDirection: 'row', marginTop: space.xl, gap: space.md },
  stat: { flex: 1, gap: space.xxs },
  section: { marginTop: space.xxxl, marginBottom: space.md },
  list: { paddingVertical: space.xs },
  rule: { height: 1, backgroundColor: color.hairline, marginLeft: 52 },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md },
  order: {
    width: 28,
    height: 28,
    borderRadius: radius.round,
    backgroundColor: color.emerald50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  orderText: { fontVariant: ['tabular-nums'] },
  body: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  name: { flexShrink: 1 },
  marker: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm - 2,
    backgroundColor: color.planSurface,
    marginTop: 1,
  },
  markerText: { fontSize: 12, lineHeight: 16 },
});
