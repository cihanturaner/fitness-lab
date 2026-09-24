import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MACROS, parseMacroText, type Macro, type MacroGrams } from '@/domain/nutrition';
import { color, space } from '@/theme/tokens';
import { HeroButton } from '@/ui/hero-button';
import { NumberField } from '@/ui/number-field';
import { Text } from '@/ui/text';

import { calorieEquation, MACRO_LABEL } from '../nutrition-view';

type Props = {
  initial: MacroGrams;
  dayLabel: string;
  onSave: (grams: MacroGrams) => Promise<void>;
  /** Draw the Save button as the screen's primary action (Nutrition) or a quiet one (sheet). */
  saveLabel?: string;
};

const text = (g: number | null) => (g === null ? '' : `${g}`);

/**
 * The day's macro totals in whole grams — protein, carbs, fat. Calories are never typed:
 * the equation under the fields derives them as the lifter types. A blank macro is not
 * recorded (the day is then partial); clearing all three removes the day's log.
 */
export function MacroEntry({ initial, dayLabel, onSave, saveLabel = 'Save macros' }: Props) {
  const [values, setValues] = useState<Record<Macro, string>>({
    protein: text(initial.protein),
    carbs: text(initial.carbs),
    fat: text(initial.fat),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const parsed = MACROS.map((m) => [m, parseMacroText(values[m])] as const);
  const invalid = parsed.filter(([, v]) => v === 'invalid').map(([m]) => m);
  const grams = Object.fromEntries(parsed.map(([m, v]) => [m, v === 'invalid' ? null : v])) as MacroGrams;

  const save = async () => {
    if (invalid.length) {
      setError('Macros are whole grams, 0–1500.');
      return;
    }
    setError(null);
    await onSave(grams);
    const cleared = MACROS.every((m) => grams[m] === null);
    setSaved(cleared ? `Cleared ${dayLabel.toLowerCase() === 'today' ? 'today' : dayLabel}.` : 'Saved.');
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.fields}>
        {MACROS.map((m) => (
          <View key={m} style={styles.field}>
            <Text variant="caption" tone="muted" style={styles.label}>
              {MACRO_LABEL[m]} (g)
            </Text>
            <NumberField
              kind="whole"
              size="large"
              value={values[m]}
              placeholder="—"
              onChangeText={(t) => {
                setValues((v) => ({ ...v, [m]: t }));
                setSaved(null);
              }}
              invalid={invalid.includes(m)}
              accessibilityLabel={`${MACRO_LABEL[m]} in grams, ${dayLabel}`}
            />
          </View>
        ))}
      </View>
      <Text variant="caption" tone="muted" accessibilityLabel={`Calories derived: ${calorieEquation(grams)}`}>
        {calorieEquation(grams)}
      </Text>
      {error ? (
        <Text variant="caption" tone="warn">
          {error}
        </Text>
      ) : null}
      {saved ? (
        <Text variant="caption" tone="emerald700" accessibilityLiveRegion="polite">
          {saved}
        </Text>
      ) : null}
      <HeroButton label={saveLabel} icon="check" accessibilityLabel={`${saveLabel}, ${dayLabel}`} onPress={() => void save()} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  fields: { flexDirection: 'row', gap: space.sm },
  field: { flex: 1, gap: space.xs },
  label: { textAlign: 'center', color: color.muted },
});
