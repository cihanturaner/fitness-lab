import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, hitTarget, radius, space } from '@/theme/tokens';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

type Props = {
  /** The screen title, drawn on the navigator's own row so the chrome stays one light band. */
  title: ReactNode;
  blockLabel: string;
  rangeLabel: string;
  rangeAccessibilityLabel: string;
  previous: { enabled: boolean; accessibilityLabel: string };
  next: { enabled: boolean; accessibilityLabel: string };
  isCurrentWeek: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCurrent: () => void;
};

/**
 * Training's top chrome in two quiet lines: the title beside a small ‹ Week n of 12 ›
 * stepper, then the week's dates with "This week" (or a way back to it). The selected
 * workout below is the screen's hero, so nothing here carries a card or a shadow.
 */
export function WeekNavigator(props: Props) {
  return (
    <View style={styles.block}>
      <View style={styles.top}>
        <View style={styles.title}>{props.title}</View>
        <View style={styles.stepper}>
          <StepButton icon="chevronLeft" {...props.previous} onPress={props.onPrevious} />
          <Text variant="label" tone="emerald700" numberOfLines={1} style={styles.week}>
            {props.blockLabel}
          </Text>
          <StepButton icon="chevronRight" {...props.next} onPress={props.onNext} />
        </View>
      </View>
      <View style={styles.rangeRow}>
        <Text
          variant="caption"
          tone="ink"
          accessibilityRole="header"
          accessibilityLabel={props.rangeAccessibilityLabel}
          numberOfLines={1}
          style={styles.range}>
          {props.rangeLabel}
        </Text>
        <Text variant="caption" tone="faint">
          ·
        </Text>
        {props.isCurrentWeek ? (
          <Text variant="caption" tone="emerald700">
            This week
          </Text>
        ) : (
          <Pressable
            onPress={props.onCurrent}
            accessibilityRole="button"
            accessibilityLabel="Back to this week"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.back}>
            <Text variant="label" tone="emerald700" style={styles.backText}>
              Back to this week
            </Text>
          </Pressable>
        )}
      </View>
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
      hitSlop={{ left: 5, right: 5 }}
      style={styles.step}>
      <Icon name={icon} size={14} color={enabled ? color.emerald700 : color.hairline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: 0 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: hitTarget },
  title: { flex: 1 },
  // A light mint capsule: the chevrons keep full 44-pt targets inside it.
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: radius.round,
    backgroundColor: color.emerald50,
  },
  week: { fontSize: 13, lineHeight: 16, fontVariant: ['tabular-nums'] },
  step: { width: 34, height: hitTarget, alignItems: 'center', justifyContent: 'center' },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  range: { fontVariant: ['tabular-nums'] },
  back: { minHeight: 20, justifyContent: 'center' },
  backText: { fontSize: 13, lineHeight: 17 },
});
