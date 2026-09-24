import { StyleSheet, View } from 'react-native';

import { color, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { CardHeading } from '@/ui/card-heading';
import { Text } from '@/ui/text';

import type { DayMark, HomeView } from '../home-view';

export function BodyweightCard({ bodyweight }: { bodyweight: HomeView['bodyweight'] }) {
  return (
    <Card style={styles.half}>
      <CardHeading icon="bodyweight" title="Bodyweight" />
      <View style={styles.metricRow}>
        <Text variant="metric">{bodyweight.valueLabel ?? '—'}</Text>
        {bodyweight.valueLabel ? (
          <Text variant="metricUnit" tone="muted">
            kg
          </Text>
        ) : null}
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {bodyweight.changeLabel
          ? `${bodyweight.whenLabel} · ${bodyweight.changeLabel}`
          : bodyweight.whenLabel}
      </Text>
      {bodyweight.averageLabel ? (
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.secondLine}>
          {bodyweight.averageLabel}
        </Text>
      ) : null}
    </Card>
  );
}

const SEGMENT_COLOR: Record<DayMark, string> = {
  done: color.emerald600,
  shortened: color.warn,
  'in-progress': color.emerald300,
  planned: color.planRule,
  'not-recorded': color.track,
  rest: color.track,
};

export function WeekCard({ week }: { week: HomeView['week'] }) {
  return (
    <Card style={styles.half}>
      <CardHeading icon="training" title="This week" />
      <View style={styles.metricRow}>
        <Text variant="metric">{week.finished}</Text>
        <Text variant="metricUnit" tone="muted">
          of {week.scheduled} done
        </Text>
      </View>
      <View style={styles.segments} accessibilityElementsHidden>
        {week.segments.map((mark, i) => (
          <View key={i} style={[styles.segment, { backgroundColor: SEGMENT_COLOR[mark] }]} />
        ))}
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {week.caption}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  half: { flex: 1 },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  secondLine: { marginTop: space.xs },
  segments: { flexDirection: 'row', gap: 4, marginBottom: space.sm, marginTop: space.xs },
  segment: { flex: 1, height: 5, borderRadius: 3 },
});
