import { StyleSheet, View, type ViewProps } from 'react-native';

import { color, radius, shadow, space } from '@/theme/tokens';

type Props = ViewProps & { size?: 'hero' | 'regular' };

export function Card({ size = 'regular', style, ...rest }: Props) {
  return <View {...rest} style={[styles.base, size === 'hero' && styles.hero, style]} />;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: color.card,
    borderRadius: radius.xl,
    padding: space.lg,
    boxShadow: shadow.card,
  },
  hero: {
    borderRadius: radius.hero,
    padding: space.xl,
  },
});
