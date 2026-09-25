import { StyleSheet, View } from 'react-native';

import type { MuscleGroup } from '@/data/home-facts';
import { color, space } from '@/theme/tokens';

import { Text } from '../text';
import { AnatomyFigure } from './anatomy-figure';

type Props = { groups: readonly MuscleGroup[]; labels: readonly string[]; height: number };

/**
 * The workout's muscle focus: front and back figures with the stated groups highlighted,
 * and the same groups named in text underneath. Only a focus a source states is drawn; with
 * none, the figures stay neutral and the text says so — nothing is inferred.
 */
export function MuscleFocus({ groups, labels, height }: Props) {
  const stated = labels.length > 0;
  return (
    <View
      style={styles.area}
      accessible
      accessibilityLabel={stated ? `Focus: ${labels.join(', ')}` : 'No muscle focus stated for this workout'}>
      <AnatomyFigure groups={groups} height={height} />
      <View style={styles.caption}>
        {stated ? <View style={styles.swatch} /> : null}
        <Text variant="caption" tone="muted" style={styles.text}>
          {stated ? labels.join(' · ') : 'No muscle focus stated for this workout'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  area: { alignItems: 'center', gap: space.sm + 2 },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: space.sm,
  },
  swatch: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.emerald500 },
  text: { textAlign: 'center', flexShrink: 1 },
});
