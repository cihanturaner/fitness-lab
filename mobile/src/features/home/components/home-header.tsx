import { StyleSheet, View } from 'react-native';

import { color, hitTarget, radius, shadow, space } from '@/theme/tokens';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

type Props = { dateLabel: string; blockLabel: string | null; onOpenSettings: () => void };

export function HomeHeader({ dateLabel, blockLabel, onOpenSettings }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        {blockLabel ? (
          <Text variant="eyebrow" tone="emerald700">
            {blockLabel}
          </Text>
        ) : null}
        <Text
          variant="largeTitle"
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}>
          {dateLabel}
        </Text>
      </View>
      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        hitSlop={8}
        style={styles.settings}>
        <Icon name="settings" size={20} color={color.inkSoft} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  titles: { flex: 1, gap: space.xs },
  settings: {
    width: hitTarget,
    height: hitTarget,
    borderRadius: radius.round,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.card,
    marginBottom: space.xxs,
  },
});
