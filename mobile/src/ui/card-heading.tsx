import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './icon';
import { Text } from './text';

export function CardHeading({ icon, title }: { icon: IconName; title: string }) {
  return (
    <View style={styles.heading}>
      <View style={styles.iconWell}>
        <Icon name={icon} size={15} color={color.emerald700} />
      </View>
      <Text variant="label">{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iconWell: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: color.emerald50,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
