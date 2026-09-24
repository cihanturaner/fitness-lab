import { StyleSheet, View } from 'react-native';

import type { Macro } from '@/domain/nutrition';
import { color, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { CardHeading } from '@/ui/card-heading';
import { ProgressBar } from '@/ui/progress-bar';
import { Text } from '@/ui/text';

import type { HomeView } from '../home-view';

const MACRO_COLOR: Record<Macro, string> = {
  protein: color.protein,
  carbs: color.carbs,
  fat: color.fat,
};

/** Today's intake. Calories shown here are always derived from macros, never entered. */
export function NutritionCard({ nutrition }: { nutrition: HomeView['nutrition'] }) {
  return (
    <Card>
      <View style={styles.header}>
        <CardHeading icon="nutrition" title="Nutrition" />
        {nutrition.remainingLabel ? (
          <Text variant="label" tone="emerald700">
            {nutrition.remainingLabel}
          </Text>
        ) : null}
      </View>

      <View style={styles.kcal}>
        <Text variant="metric">{nutrition.kcalLabel}</Text>
        <Text variant="caption" tone="muted">
          {nutrition.kcalCaption}
          {nutrition.incomplete ? ' · macros missing' : ''}
        </Text>
      </View>

      <View style={styles.macros}>
        {nutrition.macros.map((m) => (
          <View
            key={m.macro}
            style={styles.macro}
            accessible
            accessibilityLabel={`${m.label} ${m.eatenLabel} ${m.targetLabel ?? ''}`.trim()}>
            <View style={styles.macroLabel}>
              <View style={[styles.swatch, { backgroundColor: MACRO_COLOR[m.macro] }]} />
              <Text variant="caption" tone="muted">
                {m.label}
              </Text>
            </View>
            <ProgressBar value={m.fraction} color={MACRO_COLOR[m.macro]} height={5} />
            <Text variant="numeric">
              {m.eatenLabel}
              <Text variant="caption" tone="muted">
                {' '}
                {m.targetLabel}
              </Text>
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kcal: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.md },
  macros: { flexDirection: 'row', gap: space.lg, marginTop: space.lg },
  macro: { flex: 1, gap: 7 },
  macroLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 7, height: 7, borderRadius: 2 },
});
