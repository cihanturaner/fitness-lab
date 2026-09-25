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

/** One compact pill: previous / next block week around the week's dates. */
export function WeekNavigator(props: Props) {
  return (
    <View style={styles.pill}>
      <StepButton icon="chevronLeft" {...props.previous} onPress={props.onPrevious} />
      <View style={styles.center}>
        <Text
          variant="label"
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
            <Text variant="label" tone="emerald700" style={styles.backText}>
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
      style={styles.step}>
      <View style={[styles.stepDisc, !enabled && styles.stepDisabled]}>
        <Icon name={icon} size={14} color={enabled ? color.emerald700 : color.faint} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  center: { flex: 1, alignItems: 'center' },
  range: { fontSize: 15, lineHeight: 19, fontVariant: ['tabular-nums'] },
  caption: { lineHeight: 17 },
  back: { minHeight: 17, justifyContent: 'center' },
  backText: { fontSize: 13, lineHeight: 17 },
  // A 44-pt target around a small quiet disc: navigation, not the screen's hero.
  step: { width: hitTarget, height: hitTarget, alignItems: 'center', justifyContent: 'center' },
  stepDisc: {
    width: 32,
    height: 32,
    borderRadius: radius.round,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: shadow.card,
  },
  stepDisabled: { backgroundColor: 'transparent', boxShadow: 'none' },
});
