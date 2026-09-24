import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, gutter, hitTarget, radius, space } from '@/theme/tokens';
import { Icon, type IconName } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

const ACTIONS: { label: string; hint: string; icon: IconName; href: Href }[] = [
  { label: 'Workout', hint: "Open today's session", icon: 'training', href: '/training' },
  { label: 'Food', hint: "Add to today's macros", icon: 'nutrition', href: '/nutrition' },
  { label: 'Bodyweight', hint: "Record today's weigh-in", icon: 'bodyweight', href: '/nutrition' },
];

/**
 * Quick Add: the three things logged every day, one tap from any tab. In M1 each action
 * only routes to the tab that will own it.
 */
export function QuickAddSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header">
          Quick add
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={6}
          style={styles.close}>
          <Icon name="close" size={16} color={color.inkSoft} />
        </Pressable>
      </View>
      {ACTIONS.map((a) => (
        <Pressable
          key={a.label}
          onPress={() => {
            router.back();
            router.navigate(a.href);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${a.label}: ${a.hint}`}
          style={styles.row}>
          <View style={styles.well}>
            <Icon name={a.icon} size={20} color={color.emerald700} />
          </View>
          <View style={styles.rowText}>
            <Text variant="bodyStrong">{a.label}</Text>
            <Text variant="caption" tone="muted">
              {a.hint}
            </Text>
          </View>
          <Icon name="chevronRight" size={14} color={color.faint} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: color.card, paddingHorizontal: gutter, paddingTop: space.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.round,
    backgroundColor: color.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: hitTarget + space.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  well: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: color.emerald50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
});
