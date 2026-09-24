import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { MuscleGroup } from '@/data/home-facts';
import { color, radius, space } from '@/theme/tokens';
import { Icon } from '@/ui/icon';
import { Text } from '@/ui/text';

import { muscleArt } from '../muscle-art';

type Props = { groups: MuscleGroup[]; labels: string[] };

/**
 * The reserved muscle-focus area. It shows original artwork from `muscleArt()` when there
 * is some; until then a quiet placeholder keeps the space. The focus is named in text
 * beside it (WorkoutHero), so the art is never the only carrier of that information.
 */
export function MuscleFocus({ groups, labels }: Props) {
  const art = muscleArt(groups);
  return (
    <View style={styles.panel} accessible accessibilityLabel={`Focus: ${labels.join(', ')}`}>
      {art ? (
        <Image source={art} style={styles.art} contentFit="contain" />
      ) : (
        <View style={styles.placeholder}>
          <View style={styles.badge}>
            <Icon name="figure" size={34} color={color.emerald600} />
          </View>
          <Text variant="eyebrow" tone="faint" style={styles.caption}>
            Muscle map
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    height: 164,
    borderRadius: radius.xl,
    backgroundColor: color.sunken,
    borderWidth: 1,
    borderColor: color.hairline,
    overflow: 'hidden',
  },
  art: { flex: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  badge: {
    width: 72,
    height: 72,
    borderRadius: radius.round,
    backgroundColor: color.emerald50,
    borderWidth: 1,
    borderColor: color.emerald100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { fontSize: 11 },
});
