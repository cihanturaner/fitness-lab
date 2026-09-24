import { StyleSheet, View } from 'react-native';

import { color, hitTarget, radius, shadow, space } from '@/theme/tokens';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

type Props = { dateLabel: string; blockLabel: string | null; onOpenSettings: () => void };

/** A compact personal header: today and the block week, with Settings within reach. */
export function HomeHeader({ dateLabel, blockLabel, onOpenSettings }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <Text
          variant="screenTitle"
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}>
          {dateLabel}
        </Text>
        {blockLabel ? (
          <Text variant="label" tone="emerald700">
            {blockLabel}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        hitSlop={4}
        style={styles.settings}>
        <Icon name="settings" size={19} color={color.inkSoft} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  titles: { flex: 1, gap: 1 },
  settings: {
    width: hitTarget,
    height: hitTarget,
    borderRadius: radius.round,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.card,
  },
});
