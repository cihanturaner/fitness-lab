import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { addDays, mondayOf, type IsoDate } from '@/domain/dates';
import { longDate } from '@/features/home/format';
import { color, radius, space } from '@/theme/tokens';
import { font } from '@/theme/typography';
import { Card } from '@/ui/card';
import type { ConfirmRequest } from '@/ui/confirm-dialog';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import { blockSetting, blockStartQuestion, isCalendarDate } from '../block-view';

type Props = {
  start: IsoDate | null;
  weeks: number;
  today: IsoDate;
  onSave: (start: IsoDate) => Promise<void>;
  confirm: (request: ConfirmRequest) => void;
};

/** Training block: when week 1 starts. Week 1 is the Monday–Sunday week containing it. */
export function BlockCard({ start, weeks, today, onSave, confirm }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setting = blockSetting(start, weeks);
  const thisMonday = mondayOf(today);
  const nextMonday = addDays(thisMonday, 7);

  const ask = (date: string) => {
    const value = date.trim();
    if (!isCalendarDate(value)) {
      setError('Type the date as YYYY-MM-DD, for example 2026-10-01.');
      return;
    }
    setError(null);
    confirm({
      title: `Start the block on ${longDate(value)}?`,
      message: blockStartQuestion(value),
      confirmLabel: 'Set start',
      onConfirm: () => void onSave(value).then(() => setText('')),
    });
  };

  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong" accessibilityRole="header">
        Training block
      </Text>
      <Row label="Start date" value={setting.startLabel} />
      {setting.week1Label ? <Row label="Week 1" value={setting.week1Label} /> : null}
      <Row label="Length" value={setting.lengthLabel} />
      <Text variant="caption" tone="muted">
        Week 1 is the Monday–Sunday week containing the start date. Days before the start date are pre-block.
      </Text>

      <View style={styles.quick}>
        {[thisMonday, nextMonday].map((d, i) => (
          <Pressable
            key={d}
            onPress={() => ask(d)}
            accessibilityRole="button"
            accessibilityLabel={`Start on ${longDate(d)}`}
            style={styles.chip}>
            <Text variant="label" tone="emerald800">
              {i === 0 ? 'This Monday' : 'Next Monday'}
            </Text>
            <Text variant="caption" tone="muted">
              {longDate(d)}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.custom}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setError(null);
          }}
          placeholder="Another date, YYYY-MM-DD"
          placeholderTextColor={color.faint}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          returnKeyType="done"
          onSubmitEditing={() => ask(text)}
          accessibilityLabel="Block start date, YYYY-MM-DD"
          style={styles.input}
        />
        <Pressable onPress={() => ask(text)} accessibilityRole="button" accessibilityLabel="Set block start" style={styles.set}>
          <Text variant="label" tone="onPrimary">
            Set
          </Text>
        </Pressable>
      </View>
      {error ? (
        <Text variant="caption" tone="warn">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="label" style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  value: { flexShrink: 1, textAlign: 'right' },
  quick: { flexDirection: 'row', gap: space.sm },
  chip: {
    flex: 1,
    minHeight: 56,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.emerald50,
    gap: 2,
  },
  custom: { flexDirection: 'row', gap: space.sm },
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
  set: {
    height: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.emerald700,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
