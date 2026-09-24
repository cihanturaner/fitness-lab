import { useRouter } from 'expo-router';
import type { TabListProps, TabTriggerSlotProps } from 'expo-router/ui';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, radius, shadow, space } from '@/theme/tokens';
import { Icon, type IconName } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

const BAR_HEIGHT = 68;

function barBottom(insetBottom: number): number {
  return Math.max(insetBottom - 6, space.md);
}

/** Bottom padding a scrolling screen needs so its last card clears the floating bar. */
export function tabBarClearance(insetBottom: number): number {
  return barBottom(insetBottom) + BAR_HEIGHT + space.xxl;
}

export const TABS = [
  { name: 'index', href: '/', label: 'Home', icon: 'home' },
  { name: 'training', href: '/training', label: 'Training', icon: 'training' },
  { name: 'nutrition', href: '/nutrition', label: 'Nutrition', icon: 'nutrition' },
  { name: 'history', href: '/history', label: 'History', icon: 'history' },
] as const satisfies readonly { name: string; href: string; label: string; icon: IconName }[];

/**
 * The floating tab bar: four destinations in one bar, with Quick Add beside it within
 * thumb reach. Settings is deliberately not a tab (it opens from Home's header). The
 * `TabList`/`TabTrigger` elements live in the route layout: expo-router reads the tab
 * routes from that JSX, so they cannot be hidden inside a wrapper component.
 */
export function BarLayout({ children, style, ...rest }: TabListProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View {...rest} style={[styles.dock, { bottom: barBottom(insets.bottom) }, style]}>
      <View style={styles.bar} accessibilityRole="tablist">
        {children}
      </View>
      <Pressable
        onPress={() => router.push('/quick-add')}
        accessibilityRole="button"
        accessibilityLabel="Quick add"
        style={styles.quickAdd}>
        <Icon name="add" size={28} color={color.ink} />
      </Pressable>
    </View>
  );
}

type TabButtonProps = TabTriggerSlotProps & { icon: IconName; label: string };

export function TabButton({ icon, label, isFocused, ...rest }: TabButtonProps) {
  const tint = isFocused ? color.emerald700 : color.inkSoft;
  return (
    <Pressable
      {...rest}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      style={[styles.tab, isFocused && styles.tabActive]}>
      <Icon name={icon} size={23} color={tint} />
      <Text variant="tab" style={{ color: isFocused ? color.emerald800 : color.inkSoft }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  bar: {
    flex: 1,
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    backgroundColor: color.card,
    borderRadius: BAR_HEIGHT / 2,
    boxShadow: shadow.dock,
  },
  tab: {
    flex: 1,
    height: BAR_HEIGHT - 14,
    borderRadius: (BAR_HEIGHT - 14) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabActive: { backgroundColor: color.emerald100 },
  quickAdd: {
    width: BAR_HEIGHT,
    height: BAR_HEIGHT,
    borderRadius: radius.round,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.dock,
  },
});
