import { StyleSheet, View, useWindowDimensions } from "react-native";

import { color, hitTarget, radius, shadow, space } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Pressable } from "@/ui/pressable";
import { Text } from "@/ui/text";

type Props = {
  dateLabel: string;
  blockLabel: string | null;
  onOpenSettings: () => void;
};

/**
 * One compact row: today on the left; the block week as a small factual badge and
 * Settings on the right — context, not a dashboard heading.
 */
export function HomeHeader({ dateLabel, blockLabel, onOpenSettings }: Props) {
  // On a compact phone the badge sits under the date, so neither is cut short.
  const stacked = useWindowDimensions().width < 400;
  const badge = blockLabel ? (
    <View style={[styles.badge, stacked && styles.badgeStacked]}>
      <Text
        variant="label"
        tone="emerald700"
        numberOfLines={1}
        style={styles.badgeText}
      >
        {blockLabel}
      </Text>
    </View>
  ) : null;
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <Text
          variant="title"
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {dateLabel}
        </Text>
        {stacked ? badge : null}
      </View>
      {stacked ? null : badge}
      <Pressable
        onPress={onOpenSettings}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={styles.settings}
      >
        <View style={styles.settingsDisc}>
          <Icon name="settings" size={18} color={color.inkSoft} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: hitTarget + 4,
  },
  titles: { flex: 1, gap: space.xs },
  badge: {
    flexShrink: 1,
    height: 30,
    paddingHorizontal: space.md,
    borderRadius: radius.round,
    backgroundColor: color.emerald50,
    justifyContent: "center",
  },
  badgeStacked: {
    alignSelf: "flex-start",
    height: 24,
    paddingHorizontal: space.sm + 2,
  },
  badgeText: { fontSize: 13, lineHeight: 16 },
  settings: {
    width: hitTarget,
    height: hitTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsDisc: {
    width: 38,
    height: 38,
    borderRadius: radius.round,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadow.card,
  },
});
