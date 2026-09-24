import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadNutritionFacts } from '@/data/facts-source';
import { saveBodyweight } from '@/data/repo/bodyweight';
import { saveNutritionDay } from '@/data/repo/nutrition';
import { parseKgToGrams } from '@/domain/bodyweight';
import { kgExact } from '@/features/bodyweight/bodyweight-view';
import { MacroEntry } from '@/features/nutrition/components/macro-entry';
import { useQuery, useToday, useWrite } from '@/store/data-store';
import { color, gutter, hitTarget, radius, space } from '@/theme/tokens';
import { HeroButton } from '@/ui/hero-button';
import { Icon, type IconName } from '@/ui/icon';
import { NumberField } from '@/ui/number-field';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

type Open = 'bodyweight' | 'macros' | null;

/**
 * Quick Add: today's weigh-in and macros, entered right here in a few taps, and today's
 * workout one tap away. Everything saved shows on Home at once.
 */
export function QuickAddSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const write = useWrite();
  const { data: facts } = useQuery((db, t) => loadNutritionFacts(db, t, t), 'quick-add');
  const [open, setOpen] = useState<Open>(null);
  const [kgText, setKgText] = useState<string | null>(null);
  const [kgError, setKgError] = useState<string | null>(null);
  const [kgSaved, setKgSaved] = useState<string | null>(null);

  const todayWeight = facts?.bodyweight.find((e) => e.date === today) ?? null;
  const kgValue = kgText ?? (todayWeight ? kgExact(todayWeight.grams) : '');

  const saveKg = async () => {
    const grams = parseKgToGrams(kgValue);
    if (grams === null) {
      setKgError('Kilograms between 20 and 300, to 0.01 kg.');
      return;
    }
    setKgError(null);
    await write((db, now) => saveBodyweight(db, today, grams, now));
    setKgText(null);
    setKgSaved(`Saved ${kgExact(grams)} kg for today.`);
  };

  return (
    // A plain View, not a ScrollView: the form sheet sizes itself to its content on iOS.
    <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header">
          Quick add
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={6}
          style={styles.close}>
          <Icon name="close" size={16} color={color.inkSoft} />
        </Pressable>
      </View>

      <Row
        icon="bodyweight"
        label="Bodyweight"
        hint={todayWeight ? `Today: ${kgExact(todayWeight.grams)} kg · tap to replace` : "Today's weigh-in, kg"}
        open={open === 'bodyweight'}
        onPress={() => setOpen(open === 'bodyweight' ? null : 'bodyweight')}
      />
      {open === 'bodyweight' ? (
        <View style={styles.panel}>
          <View style={styles.kgRow}>
            <NumberField
              kind="decimal"
              size="large"
              value={kgValue}
              placeholder="kg"
              autoFocus
              onChangeText={(t) => {
                setKgText(t);
                setKgSaved(null);
              }}
              returnKeyType="done"
              onSubmitEditing={() => void saveKg()}
              accessibilityLabel="Bodyweight in kilograms, today"
              invalid={kgError !== null}
              flex={1}
            />
            <Text variant="metricUnit" tone="muted">
              kg
            </Text>
          </View>
          {kgError ? (
            <Text variant="caption" tone="warn">
              {kgError}
            </Text>
          ) : null}
          {kgSaved ? (
            <Text variant="caption" tone="emerald700" accessibilityLiveRegion="polite">
              {kgSaved}
            </Text>
          ) : null}
          <HeroButton
            label={todayWeight ? 'Replace weigh-in' : 'Save weigh-in'}
            icon="check"
            accessibilityLabel={todayWeight ? 'Replace today’s weigh-in' : 'Save today’s weigh-in'}
            onPress={() => void saveKg()}
          />
        </View>
      ) : null}

      <Row
        icon="nutrition"
        label="Macros"
        hint="Today's protein, carbs and fat, in grams"
        open={open === 'macros'}
        onPress={() => setOpen(open === 'macros' ? null : 'macros')}
      />
      {open === 'macros' && facts ? (
        <View style={styles.panel}>
          <MacroEntry
            key={facts.day?.updatedAt ?? 'none'}
            initial={facts.day?.grams ?? { protein: null, carbs: null, fat: null }}
            dayLabel="Today"
            onSave={(grams) => write((db, now) => saveNutritionDay(db, today, grams, now))}
          />
        </View>
      ) : null}

      <Row
        icon="training"
        label="Workout"
        hint="Open today's session"
        onPress={() => {
          router.back();
          router.push({ pathname: '/workout/[date]', params: { date: today } });
        }}
      />
    </View>
  );
}

function Row({
  icon,
  label,
  hint,
  open,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint: string;
  open?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${hint}`}
      accessibilityState={open === undefined ? undefined : { expanded: open }}
      style={styles.row}>
      <View style={styles.well}>
        <Icon name={icon} size={20} color={color.emerald700} />
      </View>
      <View style={styles.rowText}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      </View>
      <Icon name="chevronRight" size={14} color={color.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: color.card, paddingHorizontal: gutter, paddingTop: space.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.round,
    backgroundColor: color.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: hitTarget + space.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.hairline,
  },
  well: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: color.emerald50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  panel: { gap: space.md, paddingVertical: space.md },
  kgRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
