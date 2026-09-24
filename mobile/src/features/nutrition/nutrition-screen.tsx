import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Db } from '@/data/db/database';
import { loadNutritionFacts } from '@/data/facts-source';
import { addMacroTarget, saveNutritionDay } from '@/data/repo/nutrition';
import type { Macro } from '@/domain/nutrition';
import { tabBarClearance } from '@/features/shell/tab-bar';
import { useQuery, useToday, useWrite } from '@/store/data-store';
import { color, gutter, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { DayStepper } from '@/ui/day-stepper';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { ProgressBar } from '@/ui/progress-bar';
import { Text } from '@/ui/text';

import { CalorieGauge } from './components/calorie-gauge';
import { MacroEntry } from './components/macro-entry';
import { TargetSheet } from './components/target-sheet';
import { buildNutritionView } from './nutrition-view';

const MACRO_COLOR: Record<Macro, string> = { protein: color.protein, carbs: color.carbs, fat: color.fat };

/**
 * Macro tracking: the day's protein, carbs and fat in whole grams, calories derived from
 * them, each day judged by the target in force on it. No food database, no meals.
 */
export function NutritionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = useToday();
  const write = useWrite();
  const [date, setDate] = useState(today);
  const [editingTarget, setEditingTarget] = useState(false);
  const load = useCallback((db: Db, t: string) => loadNutritionFacts(db, date, t), [date]);
  const { data: facts } = useQuery(load, `nutrition|${date}`);
  const view = useMemo(() => (facts ? buildNutritionView(facts) : null), [facts]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance(insets.bottom) }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}>
        <Text variant="screenTitle" accessibilityRole="header">
          Nutrition
        </Text>
        <DayStepper date={date} today={today} label={view?.dateLabel ?? ''} onChange={setDate} />

        {view && facts ? (
          <>
            <Card size="hero" style={styles.hero}>
              <CalorieGauge gauge={view.gauge} />
              <View style={styles.macros}>
                {view.macros.map((m) => (
                  <View
                    key={m.macro}
                    style={styles.macro}
                    accessible
                    accessibilityLabel={`${m.label}: ${m.eatenLabel === '—' ? 'not recorded' : `${m.eatenLabel} grams`}${m.targetLabel ? ` of ${m.targetLabel}` : ''}${m.leftLabel ? `, ${m.leftLabel}` : ''}`}>
                    <View style={styles.macroHead}>
                      <View style={[styles.swatch, { backgroundColor: MACRO_COLOR[m.macro] }]} />
                      <Text variant="label">{m.label}</Text>
                      {m.met ? <Icon name="check" size={12} color={color.emerald600} /> : null}
                    </View>
                    <ProgressBar value={m.fraction} color={MACRO_COLOR[m.macro]} height={6} />
                    <Text variant="numeric">
                      {m.eatenLabel}
                      <Text variant="caption" tone="muted">
                        {m.targetLabel ? ` / ${m.targetLabel}` : ' g'}
                      </Text>
                    </Text>
                    <Text variant="caption" tone="muted">
                      {m.leftLabel ?? ' '}
                    </Text>
                  </View>
                ))}
              </View>
              {view.partialNote ? (
                <Text variant="caption" tone="warn">
                  {view.partialNote}
                </Text>
              ) : null}
            </Card>

            <Card style={styles.card}>
              <Text variant="bodyStrong" accessibilityRole="header">
                {view.isToday ? 'Today’s macros' : `Macros · ${view.dateLabel}`}
              </Text>
              <MacroEntry
                key={`${date}|${facts.day?.updatedAt ?? 'none'}`}
                initial={facts.day?.grams ?? { protein: null, carbs: null, fat: null }}
                dayLabel={view.dateLabel}
                onSave={(grams) => write((db, now) => saveNutritionDay(db, date, grams, now))}
              />
            </Card>

            <View style={styles.row}>
              <Pressable
                onPress={() => setEditingTarget(true)}
                accessibilityRole="button"
                accessibilityLabel={view.target ? `Daily target: ${view.target.summary}, ${view.target.kcalLabel}. Change target` : 'No daily target yet. Set a target'}
                style={styles.tilePress}>
                <Card style={styles.tile}>
                  <View style={styles.tileHead}>
                    <Icon name="target" size={16} color={color.emerald600} />
                    <Text variant="cardTitle">Daily target</Text>
                  </View>
                  {view.target ? (
                    <>
                      <Text variant="bodyStrong">{view.target.kcalLabel}</Text>
                      <Text variant="caption" tone="muted">
                        {view.target.summary}
                      </Text>
                      <Text variant="caption" tone="faint" numberOfLines={1}>
                        {view.target.sinceLabel}
                      </Text>
                    </>
                  ) : (
                    <Text variant="caption" tone="muted">
                      No target yet
                    </Text>
                  )}
                  <Text variant="label" tone="emerald700">
                    {view.target ? 'Change' : 'Set target'}
                  </Text>
                </Card>
              </Pressable>
              <Pressable
                onPress={() => router.push('/bodyweight')}
                accessibilityRole="button"
                accessibilityLabel={`Bodyweight: ${view.bodyweight.valueLabel ?? 'none'}, ${view.bodyweight.caption}. Open bodyweight`}
                style={styles.tilePress}>
                <Card style={styles.tile}>
                  <View style={styles.tileHead}>
                    <Icon name="bodyweight" size={16} color={color.fat} />
                    <Text variant="cardTitle">Bodyweight</Text>
                  </View>
                  <Text variant="bodyStrong">{view.bodyweight.valueLabel ?? '—'}</Text>
                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {view.bodyweight.caption}
                  </Text>
                  <Text variant="label" tone="emerald700">
                    Weigh in
                  </Text>
                </Card>
              </Pressable>
            </View>

            <Card style={styles.card}>
              <Text variant="bodyStrong" accessibilityRole="header">
                Last 7 days
              </Text>
              {view.recent.length === 0 ? (
                <Text variant="body" tone="muted">
                  Nothing logged in these 7 days.
                </Text>
              ) : (
                view.recent.map((r) => (
                  <Pressable
                    key={r.date}
                    onPress={() => setDate(r.date)}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.dayLabel}: ${r.kcalLabel}, ${r.detail}${r.partial ? ', partial' : ''}`}
                    style={styles.recent}>
                    <Text variant="label" tone="muted" style={styles.recentDay}>
                      {r.dayLabel}
                    </Text>
                    <View style={styles.recentText}>
                      <Text variant="bodyStrong">
                        {r.kcalLabel}
                        {r.partial ? (
                          <Text variant="caption" tone="warn">
                            {' '}
                            partial
                          </Text>
                        ) : null}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {r.detail}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </Card>

            <TargetSheet
              key={`${editingTarget}`}
              visible={editingTarget}
              first={view.target === null}
              defaults={view.targetDefaults}
              needsException={view.targetChangeNeedsException}
              onClose={() => setEditingTarget(false)}
              onSave={(target, notes) =>
                write((db, now, t) => addMacroTarget(db, { ...target, effectiveOn: t, notes }, now)).then(() => undefined)
              }
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: gutter, paddingTop: space.xs, gap: space.md },
  hero: { gap: space.lg },
  macros: { flexDirection: 'row', gap: space.md },
  macro: { flex: 1, gap: 5 },
  macroHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: radius.round },
  card: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  tilePress: { flex: 1 },
  tile: { flex: 1, gap: 4 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.xs },
  recent: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  recentDay: { width: 84 },
  recentText: { flex: 1, gap: 1 },
});
