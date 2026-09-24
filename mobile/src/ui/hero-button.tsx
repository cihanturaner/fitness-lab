import { StyleSheet } from 'react-native';

import { color, radius, shadow, space } from '@/theme/tokens';

import { Icon, type IconName } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

type Props = {
  label: string;
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  /** `primary` is the screen's one dominant emerald action; `secondary` is a quiet outline. */
  emphasis?: 'primary' | 'secondary';
};

/** The full-width call to action anchored at the bottom of a hero card. */
export function HeroButton({ label, icon, accessibilityLabel, onPress, emphasis = 'primary' }: Props) {
  const primary = emphasis === 'primary';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.button, primary ? styles.primary : styles.secondary]}>
      <Text variant="cta" tone={primary ? 'onPrimary' : 'emerald700'}>
        {label}
      </Text>
      <Icon name={icon} size={15} color={primary ? color.onPrimary : color.emerald700} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: radius.lg + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm + 2,
  },
  primary: { backgroundColor: color.emerald700, boxShadow: shadow.cta },
  secondary: { backgroundColor: color.card, borderWidth: 1.5, borderColor: color.emerald600 },
});
