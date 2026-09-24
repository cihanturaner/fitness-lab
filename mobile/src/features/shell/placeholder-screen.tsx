import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, gutter, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Icon, type IconName } from '@/ui/icon';
import { Text } from '@/ui/text';

import { tabBarClearance } from './tab-bar';

type Props = { title: string; icon: IconName; note: string; inTabs?: boolean };

/** A destination that exists in the shell but whose functionality is a later milestone. */
export function PlaceholderScreen({ title, icon, note, inTabs = true }: Props) {
  const insets = useSafeAreaInsets();
  // Tab screens have no header: the top inset goes on a non-scrolling frame so the scroll
  // viewport starts below the status bar (see HomeScreen).
  return (
    <View style={[styles.screen, { paddingTop: inTabs ? insets.top : 0 }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: inTabs ? space.md : space.lg,
            paddingBottom: inTabs ? tabBarClearance(insets.bottom) : insets.bottom + space.xl,
          },
        ]}>
        {inTabs ? (
          <Text variant="screenTitle" accessibilityRole="header">
            {title}
          </Text>
        ) : null}
        <Card style={styles.card}>
          <View style={styles.well}>
            <Icon name={icon} size={24} color={color.emerald700} />
          </View>
          <Text variant="bodyStrong">Not built yet</Text>
          <Text variant="body" tone="muted" style={styles.note}>
            {note}
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  scroll: { flex: 1 },
  content: { paddingHorizontal: gutter, gap: space.xl },
  card: { alignItems: 'center', paddingVertical: space.xxxl, gap: space.sm },
  well: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: color.emerald50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  note: { textAlign: 'center', maxWidth: 280 },
});
