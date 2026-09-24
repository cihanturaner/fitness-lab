import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { typedExerciseName } from '@/domain/substitutes';
import { color, radius, space } from '@/theme/tokens';
import { font } from '@/theme/typography';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Sheet } from '@/ui/sheet';
import { Text } from '@/ui/text';

import type { ExerciseBlock } from '../workout-view';

type Props = {
  block: ExerciseBlock | null;
  onClose: () => void;
  /** null: back to the planned exercise. */
  onChoose: (exerciseName: string | null) => Promise<void>;
};

/**
 * "Change" performs one slot as another exercise in this workout only: the program's
 * approved substitutes (read from the slot's notes), or an exercise the lifter types. The
 * plan and every other occurrence keep the planned exercise.
 */
export function ChangeSheet({ block, onClose, onChoose }: Props) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const planned = block?.plannedName ?? block?.name ?? '';
  const preview = typed.trim() ? typedExerciseName(typed) : null;

  const choose = async (name: string | null) => {
    try {
      await onChoose(name);
      setTyped('');
      setError(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the exercise.');
    }
  };

  const setsLogged = block?.logged.length ?? 0;
  return (
    <Sheet visible={block !== null} title="Change exercise" onClose={onClose}>
      <Text variant="body" tone="muted">
        For this workout only. The program and every other session keep {planned}.
      </Text>
      {setsLogged > 0 ? (
        <Text variant="caption" tone="warn">
          {setsLogged} saved {setsLogged === 1 ? 'set stays' : 'sets stay'} recorded as {block?.name}, as extra work.
        </Text>
      ) : null}

      {block?.plannedName ? (
        <Option label={`Back to ${block.plannedName}`} hint="The planned exercise" icon="undo" onPress={() => void choose(null)} />
      ) : null}
      {block?.substitutes.length ? (
        <Text variant="eyebrow" tone="muted">
          Approved substitutes
        </Text>
      ) : null}
      {block?.substitutes.map((s) => (
        <Option
          key={s.name}
          label={s.name}
          hint={s.condition ?? 'From the program'}
          selected={s.name === block.name}
          onPress={() => void choose(s.name)}
        />
      ))}

      <Text variant="eyebrow" tone="muted">
        Another exercise
      </Text>
      <View style={styles.typedRow}>
        <TextInput
          value={typed}
          onChangeText={(t) => {
            setTyped(t);
            setError(null);
          }}
          placeholder="Exercise name"
          placeholderTextColor={color.faint}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={120}
          returnKeyType="done"
          onSubmitEditing={() => preview?.ok && void choose(preview.name)}
          accessibilityLabel="Another exercise, name"
          style={styles.input}
        />
        <Pressable
          disabled={!preview?.ok}
          onPress={() => preview?.ok && void choose(preview.name)}
          accessibilityRole="button"
          accessibilityLabel={preview?.ok ? `Use ${preview.name}` : 'Use'}
          style={[styles.use, !preview?.ok && styles.useDisabled]}>
          <Text variant="label" tone="onPrimary">
            Use
          </Text>
        </Pressable>
      </View>
      {preview?.ok && preview.name !== typed.trim() ? (
        <Text variant="caption" tone="muted">
          Saved as “{preview.name}”
        </Text>
      ) : null}
      {preview && !preview.ok ? (
        <Text variant="caption" tone="warn">
          {preview.error}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="warn">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

function Option({
  label,
  hint,
  selected = false,
  icon = 'swap',
  onPress,
}: {
  label: string;
  hint: string;
  selected?: boolean;
  icon?: 'swap' | 'undo';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={selected}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${hint}${selected ? ', current' : ''}`}
      style={[styles.option, selected && styles.optionSelected]}>
      <Icon name={selected ? 'check' : icon} size={15} color={selected ? color.emerald700 : color.inkSoft} />
      <View style={styles.optionText}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="caption" tone="muted">
          {selected ? 'Current for this workout' : hint}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.sunken,
  },
  optionSelected: { backgroundColor: color.emerald50 },
  optionText: { flex: 1, gap: 1 },
  typedRow: { flexDirection: 'row', gap: space.sm },
  input: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.sunken,
    color: color.ink,
    fontFamily: font.medium,
    fontSize: 16,
  },
  use: {
    height: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.emerald700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useDisabled: { opacity: 0.4 },
});
