import { StyleSheet, View } from 'react-native';

import { color, gutter, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Text } from '@/ui/text';

/**
 * Shown instead of the app when the device database cannot be opened — for instance when it
 * was written by a newer Fitness Lab. Nothing is changed or reset; the data stays as it is.
 */
export function StartupError({ error }: { error: Error }) {
  return (
    <View style={styles.screen}>
      <Card style={styles.card}>
        <Text variant="title" accessibilityRole="header">
          Fitness Lab could not open its data
        </Text>
        <Text variant="body" tone="inkSoft">
          {error.message}
        </Text>
        <Text variant="caption" tone="muted">
          Nothing was changed or deleted. Update the app, then open it again.
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper, justifyContent: 'center', padding: gutter },
  card: { gap: space.md },
});
