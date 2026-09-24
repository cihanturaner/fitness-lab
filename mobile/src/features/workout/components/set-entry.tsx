import { useRef, useState } from 'react';
import { InputAccessoryView, Platform, StyleSheet, View, type TextInput } from 'react-native';

import { color, radius, space } from '@/theme/tokens';
import { Icon } from '@/ui/icon';
import { NumberField } from '@/ui/number-field';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import { parseSetText, type SetText } from '../set-input';
import type { SetValues } from '@/data/repo/workouts';

type Props = {
  number: number;
  exerciseName: string;
  initial: SetText;
  hints: { reps: string; rir: string };
  mode: 'new' | 'edit';
  /** Focus the first empty field when the row opens (the lifter tapped it). */
  autoFocus?: boolean;
  onSubmit: (values: SetValues) => Promise<void>;
  onDelete?: () => void;
  onCancel?: () => void;
};

/**
 * One set being entered, in the order it is read off the gym floor: LOAD (lb) → REPS → RIR.
 * Each field has a numeric keyboard; Next moves on, and the last step logs the set. On iOS
 * the number pad has no return key, so a bar above the keyboard carries Next and Log set.
 */
export function SetEntry({ number, exerciseName, initial, hints, mode, autoFocus, onSubmit, onDelete, onCancel }: Props) {
  const [text, setText] = useState<SetText>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useRef<TextInput>(null);
  const reps = useRef<TextInput>(null);
  const rir = useRef<TextInput>(null);
  const focused = useRef<'load' | 'reps' | 'rir'>('load');
  const accessory = `set-entry-${exerciseName}-${number}`.replace(/[^a-zA-Z0-9-]/g, '');

  const submit = async () => {
    const parsed = parseSetText(text);
    if (!parsed.ok) {
      setError(parsed.error);
      if (parsed.error.startsWith('Load')) load.current?.focus();
      else if (parsed.error.startsWith('RIR')) rir.current?.focus();
      else reps.current?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(parsed.values);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this set.');
    } finally {
      setSaving(false);
    }
  };

  const next = () => {
    if (focused.current === 'load') reps.current?.focus();
    else if (focused.current === 'reps') rir.current?.focus();
    else void submit();
  };

  const label = mode === 'new' ? 'Log set' : 'Save set';
  const iosBar = Platform.OS === 'ios';
  return (
    <View style={styles.wrap}>
      <View style={[styles.row, styles.active]}>
        <Text variant="numeric" tone="emerald800" style={styles.number}>
          {number}
        </Text>
        <NumberField
          ref={load}
          kind="decimal"
          value={text.load}
          placeholder="lb"
          autoFocus={autoFocus && initial.load === ''}
          onChangeText={(load) => setText((t) => ({ ...t, load }))}
          onFocus={() => (focused.current = 'load')}
          returnKeyType="next"
          onSubmitEditing={() => reps.current?.focus()}
          blurOnSubmit={false}
          inputAccessoryViewID={iosBar ? accessory : undefined}
          accessibilityLabel={`${exerciseName}, set ${number}, load in pounds`}
          invalid={!!error?.startsWith('Load')}
          flex={1.25}
        />
        <NumberField
          ref={reps}
          kind="whole"
          value={text.reps}
          placeholder={hints.reps}
          autoFocus={autoFocus && initial.load !== ''}
          onChangeText={(reps) => setText((t) => ({ ...t, reps }))}
          onFocus={() => (focused.current = 'reps')}
          returnKeyType="next"
          onSubmitEditing={() => rir.current?.focus()}
          blurOnSubmit={false}
          inputAccessoryViewID={iosBar ? accessory : undefined}
          accessibilityLabel={`${exerciseName}, set ${number}, reps, planned ${hints.reps}`}
          invalid={!!error && (error.startsWith('Reps') || error.startsWith('Enter'))}
          flex={1}
        />
        <NumberField
          ref={rir}
          kind="whole"
          value={text.rir}
          placeholder={hints.rir}
          onChangeText={(rir) => setText((t) => ({ ...t, rir }))}
          onFocus={() => (focused.current = 'rir')}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          inputAccessoryViewID={iosBar ? accessory : undefined}
          accessibilityLabel={`${exerciseName}, set ${number}, reps in reserve, target ${hints.rir}`}
          invalid={!!error?.startsWith('RIR')}
          flex={0.9}
        />
        <Pressable
          onPress={() => void submit()}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={`${label} ${number}, ${exerciseName}`}
          style={styles.log}>
          <Icon name="check" size={20} color={color.onPrimary} />
        </Pressable>
      </View>
      {error ? (
        <Text variant="caption" tone="warn" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {mode === 'edit' ? (
        <View style={styles.editActions}>
          {onCancel ? (
            <Pressable onPress={onCancel} accessibilityRole="button" style={styles.textButton}>
              <Text variant="label" tone="inkSoft">
                Cancel
              </Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={`Delete set ${number}, ${exerciseName}`}
              style={styles.textButton}>
              <Icon name="trash" size={14} color={color.warn} />
              <Text variant="label" tone="warn">
                Delete set
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {iosBar ? (
        <InputAccessoryView nativeID={accessory} backgroundColor={color.sunken}>
          <View style={styles.bar}>
            <Pressable onPress={next} accessibilityRole="button" style={styles.barButton}>
              <Text variant="bodyStrong" tone="emerald700">
                Next
              </Text>
            </Pressable>
            <Pressable onPress={() => void submit()} accessibilityRole="button" style={[styles.barButton, styles.barPrimary]}>
              <Text variant="bodyStrong" tone="onPrimary">
                {label}
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  active: {
    padding: space.xs + 2,
    marginHorizontal: -(space.xs + 2),
    borderRadius: radius.lg,
    backgroundColor: color.emerald50,
  },
  number: { width: 30 - (space.xs + 2), textAlign: 'center' },
  log: {
    width: 46,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: color.emerald700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { paddingLeft: 30 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.lg, paddingTop: space.xs },
  textButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.xs },
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  barButton: { minHeight: 40, paddingHorizontal: space.lg, borderRadius: radius.md, justifyContent: 'center' },
  barPrimary: { backgroundColor: color.emerald700 },
});
