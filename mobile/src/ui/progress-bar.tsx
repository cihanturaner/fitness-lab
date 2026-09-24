import { StyleSheet, View } from 'react-native';

import { color as palette, radius } from '@/theme/tokens';

type Props = { value: number; color?: string; height?: number };

/** A decorative bar; the number it shows must also be stated in text beside it. */
export function ProgressBar({ value, color = palette.emerald600, height = 6 }: Props) {
  const pct = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` as const;
  return (
    <View
      style={[styles.track, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <View style={[styles.fill, { width: pct, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: palette.track,
    borderRadius: radius.round,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.round,
  },
});
