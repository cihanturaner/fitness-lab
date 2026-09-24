import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadBodyweightEntries } from '@/data/facts-source';
import { deleteBodyweight, saveBodyweight } from '@/data/repo/bodyweight';
import { parseKgToGrams } from '@/domain/bodyweight';
import { useQuery, useToday, useWrite } from '@/store/data-store';
import { color, gutter, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { ConfirmDialog, type ConfirmRequest } from '@/ui/confirm-dialog';
import { DayStepper } from '@/ui/day-stepper';
import { HeroButton } from '@/ui/hero-button';
import { Icon } from '@/ui/icon';
import { NumberField } from '@/ui/number-field';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import { buildBodyweightView, kgExact, shortDay } from './bodyweight-view';

/**
 * Bodyweight in kilograms: one weigh-in per day (a second one replaces it), the 7-day
 * average with how many days it covers, and the change of that average once both weeks
 * have enough weigh-ins. Nothing is interpolated.
 */
export function BodyweightScreen() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const write = useWrite();
  const { data: entries } = useQuery(loadBodyweightEntries, 'bodyweight');
  const view = useMemo(() => (entries ? buildBodyweightView(entries, today) : null), [entries, today]);
  const [date, setDate] = useState(today);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  if (!view || !entries) return <View style={styles.screen} />;
  const existing = entries.find((e) => e.date === date) ?? null;
  const value = text ?? (existing ? kgExact(existing.grams) : '');

  const save = async () => {
    const grams = parseKgToGrams(value);
    if (grams === null) {
      setError('Enter kilograms between 20 and 300, to 0.01 kg (for example 82.4).');
      return;
    }
    setError(null);
    await write((db, now) => saveBodyweight(db, date, grams, now));
    setText(null);
    setSaved(`Saved ${kgExact(grams)} kg for ${date === today ? 'today' : shortDay(date)}.`);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Card size="hero" style={styles.hero} accessible accessibilityLabel={`7-day average: ${view.averageLabel ? `${view.averageLabel} kilograms, ${view.averageCaption}` : view.averageCaption}`}>
          <Text variant="eyebrow" tone="muted">
            7-day average
          </Text>
          <View style={styles.value}>
            <Text variant="metric">{view.averageLabel ?? '—'}</Text>
            {view.averageLabel ? (
              <Text variant="metricUnit" tone="muted">
                kg
              </Text>
            ) : null}
          </View>
          <Text variant="caption" tone="muted">
            {view.averageCaption}
          </Text>
          <View style={styles.facts}>
            <View style={styles.fact}>
              <Text variant="caption" tone="muted">
                Latest
              </Text>
              <Text variant="bodyStrong">{view.latestLabel ? `${view.latestLabel} kg` : '—'}</Text>
              {view.latestWhen ? (
                <Text variant="caption" tone="muted">
                  {view.latestWhen}
                </Text>
              ) : null}
            </View>
            <View style={styles.fact}>
              <Text variant="caption" tone="muted">
                Change of the average
              </Text>
              <Text variant="bodyStrong">{view.changeLabel ? `${view.changeLabel} kg` : '—'}</Text>
              <Text variant="caption" tone="muted">
                {view.changeCaption}
              </Text>
            </View>
          </View>
        </Card>

        <DayStepper
          date={date}
          today={today}
          label={date === today ? 'Today' : shortDay(date)}
          onChange={(d) => {
            setDate(d);
            setText(null);
            setError(null);
            setSaved(null);
          }}
        />
        <Card style={styles.entry}>
          <Text variant="bodyStrong">{existing ? 'Replace this day’s weigh-in' : 'Weigh-in'}</Text>
          <View style={styles.entryRow}>
            <NumberField
              kind="decimal"
              size="large"
              value={value}
              placeholder="kg"
              onChangeText={(t) => {
                setText(t);
                setSaved(null);
              }}
              returnKeyType="done"
              onSubmitEditing={() => void save()}
              accessibilityLabel={`Bodyweight in kilograms, ${date === today ? 'today' : shortDay(date)}`}
              invalid={error !== null}
              flex={1}
            />
            <Text variant="metricUnit" tone="muted">
              kg
            </Text>
          </View>
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
          <HeroButton
            label={existing ? 'Replace' : 'Save weigh-in'}
            icon="check"
            accessibilityLabel={existing ? 'Replace weigh-in' : 'Save weigh-in'}
            onPress={() => void save()}
          />
        </Card>

        <Card style={styles.list}>
          <Text variant="bodyStrong" accessibilityRole="header">
            Recent weigh-ins
          </Text>
          {view.recent.length === 0 ? (
            <Text variant="body" tone="muted">
              No weigh-ins yet.
            </Text>
          ) : (
            view.recent.map((r) => (
              <View key={r.date} style={styles.listRow}>
                <Text variant="label" tone="muted" style={styles.listDay}>
                  {r.dayLabel}
                </Text>
                <Text variant="bodyStrong">{r.kgLabel} kg</Text>
                <Pressable
                  onPress={() =>
                    setConfirm({
                      title: 'Delete this weigh-in?',
                      message: `${r.dayLabel}: ${r.kgLabel} kg.`,
                      confirmLabel: 'Delete',
                      destructive: true,
                      onConfirm: () => void write((db) => deleteBodyweight(db, r.date)),
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Delete weigh-in, ${r.dayLabel}, ${r.kgLabel} kilograms`}
                  hitSlop={8}
                  style={styles.delete}>
                  <Icon name="trash" size={15} color={color.faint} />
                </Pressable>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
      <ConfirmDialog request={confirm} onDismiss={() => setConfirm(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: gutter, paddingTop: space.md, gap: space.md },
  hero: { gap: space.xs },
  value: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  facts: { flexDirection: 'row', gap: space.lg, marginTop: space.md },
  fact: { flex: 1, gap: 2 },
  entry: { gap: space.md },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  list: { gap: space.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  listDay: { flex: 1 },
  delete: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
