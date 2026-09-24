import { StyleSheet, View } from 'react-native';

import type { Macro } from '@/domain/nutrition';
import { color, space } from '@/theme/tokens';
import { ProgressBar } from '@/ui/progress-bar';
import { StatCard, StatValue } from '@/ui/stat-card';
import { Text } from '@/ui/text';

import type { DayMark, HomeView } from '../home-view';

const MACRO_COLOR: Record<Macro, string> = {
  protein: color.protein,
  carbs: color.carbs,
  fat: color.fat,
};

const SEGMENT_COLOR: Record<DayMark, string> = {
  done: color.emerald600,
  shortened: color.warn,
  'in-progress': color.emerald300,
  planned: color.planRule,
  'not-recorded': color.track,
  rest: color.track,
};

type Props = Pick<HomeView, 'nutrition' | 'bodyweight' | 'week'>;

/**
 * Home's Progress section: four small cards in two rows — today's calories and macros,
 * then the week's sessions and bodyweight. Calories are always derived from macros.
 */
export function ProgressCards({ nutrition, bodyweight, week }: Props) {
  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        <StatCard
          icon="calories"
          title="Calories"
          tint={color.carbs}
          accessibilityLabel={[
            `Calories: ${nutrition.kcalLabel} ${nutrition.kcalCaption}`,
            nutrition.remainingLabel,
            nutrition.incomplete ? 'macros missing' : null,
          ]
            .filter(Boolean)
            .join(', ')}>
          <StatValue value={nutrition.kcalLabel} />
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {nutrition.kcalCaption}
            {nutrition.incomplete ? ' · macros missing' : ''}
          </Text>
          {nutrition.remainingLabel ? (
            <Text variant="label" tone="emerald700" numberOfLines={1}>
              {nutrition.remainingLabel}
            </Text>
          ) : null}
        </StatCard>

        <StatCard icon="macros" title="Macros">
          <View style={styles.macros}>
            {nutrition.macros.map((m) => (
              <View
                key={m.macro}
                style={styles.macro}
                accessible
                accessibilityLabel={`${m.label} ${m.eatenLabel} ${m.targetLabel ?? ''}`.trim()}>
                <View style={styles.macroLine}>
                  <Text variant="caption" tone="muted">
                    {m.label}
                  </Text>
                  <Text variant="numeric" style={styles.macroNumber}>
                    {m.eatenLabel}
                    <Text variant="caption" tone="faint">
                      {' '}
                      {m.targetLabel}
                    </Text>
                  </Text>
                </View>
                <ProgressBar value={m.fraction} color={MACRO_COLOR[m.macro]} height={4} />
              </View>
            ))}
          </View>
        </StatCard>
      </View>

      <View style={styles.row}>
        <StatCard
          icon="week"
          title="This week"
          accessibilityLabel={`This week: ${week.finished} of ${week.scheduled} sessions done, ${week.caption}`}>
          <StatValue value={`${week.finished}`} unit={`of ${week.scheduled} done`} />
          <View style={styles.segments}>
            {week.segments.map((mark, i) => (
              <View key={i} style={[styles.segment, { backgroundColor: SEGMENT_COLOR[mark] }]} />
            ))}
          </View>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {week.caption}
          </Text>
        </StatCard>

        <StatCard
          icon="bodyweight"
          title="Bodyweight"
          tint={color.fat}
          accessibilityLabel={[
            bodyweight.valueLabel ? `Bodyweight: ${bodyweight.valueLabel} kg` : 'Bodyweight',
            bodyweight.whenLabel,
            bodyweight.changeLabel,
            bodyweight.averageLabel,
          ]
            .filter(Boolean)
            .join(', ')}>
          <StatValue value={bodyweight.valueLabel ?? '—'} unit={bodyweight.valueLabel ? 'kg' : undefined} />
          {[bodyweight.whenLabel, bodyweight.changeLabel, bodyweight.averageLabel].map((line) =>
            line ? (
              <Text key={line} variant="caption" tone="muted" numberOfLines={1}>
                {line}
              </Text>
            ) : null,
          )}
        </StatCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  macros: { gap: space.sm },
  macro: { gap: 4 },
  macroLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 },
  macroNumber: { fontSize: 13, lineHeight: 16 },
  segments: { flexDirection: 'row', gap: 4, marginVertical: 5 },
  segment: { flex: 1, height: 5, borderRadius: 3 },
});
