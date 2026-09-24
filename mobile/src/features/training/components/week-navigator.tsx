import { StyleSheet, View } from 'react-native';

import { color, hitTarget, radius, shadow, space } from '@/theme/tokens';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

type Props = {
  rangeLabel: string;
  rangeAccessibilityLabel: string;
  previous: { enabled: boolean; accessibilityLabel: string };
  next: { enabled: boolean; accessibilityLabel: string };
  isCurrentWeek: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCurrent: () => void;
};

/** Previous / next block week, the week's dates, and a way back to this week. */
export function WeekNavigator(props: Props) {
  return (
    <View style={styles.row}>
      <StepButton icon="chevronLeft" {...props.previous} onPress={props.onPrevious} />
      <View style={styles.center}>
        <Text
          variant="title"
          accessibilityRole="header"
          accessibilityLabel={props.rangeAccessibilityLabel}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={styles.range}>
          {props.rangeLabel}
        </Text>
        {props.isCurrentWeek ? (
          <Text variant="caption" tone="emerald700" style={styles.caption}>
            This week
          </Text>
        ) : (
          <Pressable
            onPress={props.onCurrent}
            accessibilityRole="button"
            accessibilityLabel="Back to this week"
            hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
            style={styles.back}>
            <Text variant="label" tone="emerald700">
              Back to this week
            </Text>
          </Pressable>
        )}
      </View>
      <StepButton icon="chevronRight" {...props.next} onPress={props.onNext} />
    </View>
  );
}

type StepProps = {
  icon: 'chevronLeft' | 'chevronRight';
  enabled: boolean;
  accessibilityLabel: string;
  onPress: () => void;
};

function StepButton({ icon, enabled, accessibilityLabel, onPress }: StepProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !enabled }}
      style={[styles.step, !enabled && styles.stepDisabled]}>
      <Icon name={icon} size={17} color={enabled ? color.emerald700 : color.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  center: { flex: 1, alignItems: 'center', gap: space.xxs },
  range: { fontVariant: ['tabular-nums'] },
  caption: { lineHeight: 20 },
  back: { minHeight: 20, justifyContent: 'center' },
  step: {
    width: hitTarget,
    height: hitTarget,
    borderRadius: radius.round,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.card,
  },
  stepDisabled: { backgroundColor: color.sunken, boxShadow: 'none' },
});
