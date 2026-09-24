import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { color, space } from '@/theme/tokens';
import { Text } from '@/ui/text';

import type { NutritionView } from '../nutrition-view';

const W = 240;
const R = 104;
const STROKE = 16;
const CX = W / 2;
const CY = R + STROKE / 2;

/** A point on the half circle: 0 = left end, 1 = right end. */
function point(t: number): string {
  const a = Math.PI * (1 - t);
  return `${CX + R * Math.cos(a)},${CY - R * Math.sin(a)}`;
}

function arc(from: number, to: number): string {
  return `M${point(from)} A${R},${R} 0 0 1 ${point(to)}`;
}

/**
 * The day's calories as a half-ring: eaten against the target in force that day, with the
 * target on the left and what is left (or over) on the right. Decorative for assistive
 * technology — the same numbers are its accessibility label.
 */
export function CalorieGauge({ gauge }: { gauge: NutritionView['gauge'] }) {
  const f = Math.max(0, Math.min(1, gauge.fraction));
  const label = [
    `${gauge.eatenLabel} kilocalories eaten`,
    gauge.targetLabel ? `target ${gauge.targetLabel}` : 'no target',
    gauge.leftLabel ? `${gauge.leftLabel} ${gauge.over ? 'over' : 'left'}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.wrap} accessible accessibilityLabel={label}>
      <Svg width={W} height={CY + STROKE / 2} viewBox={`0 0 ${W} ${CY + STROKE / 2}`}>
        <Path d={arc(0, 1)} stroke={color.track} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
        {f > 0.005 ? (
          <Path
            d={arc(0, f)}
            stroke={gauge.over ? color.warn : color.emerald600}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
      </Svg>
      <View style={styles.center}>
        <Text variant="metric">{gauge.eatenLabel}</Text>
        <Text variant="caption" tone="muted">
          kcal eaten
        </Text>
      </View>
      <View style={styles.sides}>
        <View style={styles.side}>
          <Text variant="bodyStrong">{gauge.targetLabel ?? '—'}</Text>
          <Text variant="caption" tone="muted">
            {gauge.targetLabel ? 'target' : 'no target'}
          </Text>
        </View>
        <View style={[styles.side, styles.right]}>
          <Text variant="bodyStrong" tone={gauge.over ? 'warn' : 'emerald700'}>
            {gauge.leftLabel ?? '—'}
          </Text>
          <Text variant="caption" tone="muted">
            {gauge.over ? 'over' : 'left'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  center: { position: 'absolute', top: 54, alignItems: 'center' },
  sides: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: space.sm,
  },
  side: { gap: 1 },
  right: { alignItems: 'flex-end' },
});
