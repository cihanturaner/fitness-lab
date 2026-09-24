import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EARLY_EXCEPTIONS, MACROS, parseMacroText, targetCalories, targetError, type Macro, type MacroTarget } from '@/domain/nutrition';
import { groupThousands } from '@/features/home/format';
import { color, radius, space } from '@/theme/tokens';
import { HeroButton } from '@/ui/hero-button';
import { Icon } from '@/ui/icon';
import { NumberField } from '@/ui/number-field';
import { Pressable } from '@/ui/pressable';
import { Sheet } from '@/ui/sheet';
import { Text } from '@/ui/text';

import { MACRO_LABEL } from '../nutrition-view';

type Props = {
  visible: boolean;
  first: boolean;
  defaults: Record<Macro, string>;
  needsException: boolean;
  onClose: () => void;
  onSave: (target: MacroTarget, notes: string | null) => Promise<void>;
};

/**
 * Sets the daily macro target, effective from today: earlier days keep the targets they
 * had (targets are append-only). Its calories are derived, never typed. In the early block
 * weeks, changing an established target asks which of the source's exceptions applies.
 */
export function TargetSheet({ visible, first, defaults, needsException, onClose, onSave }: Props) {
  const [values, setValues] = useState(defaults);
  const [exception, setException] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = MACROS.map((m) => [m, parseMacroText(values[m])] as const);
  const complete = parsed.every(([, v]) => typeof v === 'number');
  const target = complete ? (Object.fromEntries(parsed) as MacroTarget) : null;

  const save = async () => {
    if (!target) {
      setError('Enter all three macros in whole grams.');
      return;
    }
    const invalid = targetError(target);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (needsException && !exception) {
      setError('Weeks 1–2 allow no routine change: choose the exception that applies.');
      return;
    }
    await onSave(target, exception ? `Weeks 1–2 exception: ${exception}` : null);
    setException(null);
    setError(null);
    onClose();
  };

  return (
    <Sheet visible={visible} title={first ? 'Set a daily target' : 'Change daily target'} onClose={onClose}>
      <Text variant="body" tone="muted">
        From today; earlier days keep the targets they had.
      </Text>
      {first ? (
        <Text variant="caption" tone="muted">
          Protein 145 g and fat 60 g are offered from the nutrition source; carbohydrate is yours to set.
        </Text>
      ) : null}
      <View style={styles.fields}>
        {MACROS.map((m) => (
          <View key={m} style={styles.field}>
            <Text variant="caption" tone="muted" style={styles.center}>
              {MACRO_LABEL[m]} (g)
            </Text>
            <NumberField
              kind="whole"
              size="large"
              value={values[m]}
              placeholder="—"
              onChangeText={(t) => {
                setValues((v) => ({ ...v, [m]: t }));
                setError(null);
              }}
              accessibilityLabel={`Target ${MACRO_LABEL[m].toLowerCase()} in grams`}
            />
          </View>
        ))}
      </View>
      <Text variant="bodyStrong" style={styles.center}>
        {target ? `${groupThousands(targetCalories(target))} kcal a day` : 'Calories follow from the three macros'}
      </Text>

      {needsException ? (
        <View style={styles.exceptions}>
          <Text variant="label" tone="warn">
            Weeks 1–2: no routine bodyweight-driven changes. Change an established target only for one of the source’s exceptions.
          </Text>
          {EARLY_EXCEPTIONS.map((e) => (
            <Pressable
              key={e}
              onPress={() => setException(e)}
              accessibilityRole="radio"
              accessibilityState={{ checked: exception === e }}
              style={[styles.option, exception === e && styles.optionOn]}>
              <View style={[styles.radio, exception === e && styles.radioOn]}>
                {exception === e ? <Icon name="check" size={11} color={color.onPrimary} /> : null}
              </View>
              <Text variant="body">{e}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {error ? (
        <Text variant="caption" tone="warn" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <HeroButton label="Save target" icon="check" accessibilityLabel="Save target" onPress={() => void save()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fields: { flexDirection: 'row', gap: space.sm },
  field: { flex: 1, gap: space.xs },
  center: { textAlign: 'center' },
  exceptions: { gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.sunken,
  },
  optionOn: { backgroundColor: color.emerald50 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: color.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: color.emerald600, borderColor: color.emerald600 },
});
