import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/theme/tokens';

import { Card } from './card';
import { Icon, type IconName } from './icon';
import { Text } from './text';

type Props = {
  icon: IconName;
  eyebrow: string;
  title: string;
  note: string;
  /** An action, when the state has one (never invented for a state that has none). */
  children?: ReactNode;
};

/**
 * A deliberate no-workout card (rest day, block not started, outside the block): a small
 * emerald mark, the state in words, one line of context — no figure, nothing invented.
 */
export function QuietState({ icon, eyebrow, title, note, children }: Props) {
  return (
    <Card size="hero" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.disc}>
          <Icon name={icon} size={20} color={color.emerald700} />
        </View>
        <View style={styles.titles}>
          <Text variant="eyebrow" tone="muted" numberOfLines={1}>
            {eyebrow}
          </Text>
          <Text variant="title" accessibilityRole="header">
            {title}
          </Text>
        </View>
      </View>
      <Text variant="body" tone="muted">
        {note}
      </Text>
      {children ? <View style={styles.action}>{children}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  disc: {
    width: 44,
    height: 44,
    borderRadius: radius.round,
    backgroundColor: color.emerald50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1, gap: 1 },
  action: { marginTop: space.xs },
});
