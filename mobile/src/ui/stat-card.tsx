import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, space } from '@/theme/tokens';

import { Card } from './card';
import { Icon, type IconName } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

type Props = {
  icon: IconName;
  title: string;
  /** Icon tint; emerald unless a card carries a semantic colour of its own. */
  tint?: string;
  children: ReactNode;
  accessibilityLabel?: string;
  /** Opens the screen that owns this figure. */
  onPress?: () => void;
};

/**
 * A small Progress card: a tinted icon and title on top, the figure pushed to the bottom.
 * Cards in one row stretch to the same height.
 */
export function StatCard({ icon, title, tint = color.emerald600, children, accessibilityLabel, onPress }: Props) {
  const content = (
    <Card
      style={styles.card}
      accessible={onPress === undefined && accessibilityLabel !== undefined}
      accessibilityLabel={onPress === undefined ? accessibilityLabel : undefined}>
      <View style={styles.heading}>
        <Icon name={icon} size={17} color={tint} />
        <Text variant="cardTitle">{title}</Text>
      </View>
      <View style={styles.body}>{children}</View>
    </Card>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={styles.press}>
      {content}
    </Pressable>
  );
}

/** A big tabular figure with an optional small unit after it. */
export function StatValue({ value, unit }: { value: string; unit?: string }) {
  return (
    <View style={styles.value}>
      <Text variant="stat">{value}</Text>
      {unit ? (
        <Text variant="label" tone="muted">
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, paddingVertical: space.lg, minHeight: 128 },
  press: { flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  body: { flex: 1, justifyContent: 'flex-end', marginTop: space.lg, gap: 3 },
  value: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
});
