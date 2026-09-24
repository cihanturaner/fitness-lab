import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TrainingFacts } from '@/data/training-facts';
import { tabBarClearance } from '@/features/shell/tab-bar';
import { color, gutter, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Text } from '@/ui/text';

import { DaySelector } from './components/day-selector';
import { SelectedSession } from './components/selected-session';
import { WeekNavigator } from './components/week-navigator';
import { WeekSessions } from './components/week-sessions';
import { buildTrainingView, initialSelection, selectWeek, type TrainingSelection } from './training-view';

/** The 12-week planner: one block week at a time, a selected day, and a read-only plan. */
export function TrainingScreen({ facts }: { facts: TrainingFacts }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState<TrainingSelection | null>(() => initialSelection(facts));
  // Without a block there is no selection; the view then says how to start one.
  const view = useMemo(
    () => buildTrainingView(facts, selection ?? { week: 1, date: facts.today }),
    [facts, selection],
  );

  // Entering Training (from Home's workout CTA or the tab bar) always lands on today in the
  // current block week. Only coming back from this screen's own plan preview keeps the week
  // being browsed.
  const returningFromPlan = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (returningFromPlan.current) {
        returningFromPlan.current = false;
        return;
      }
      setSelection(initialSelection(facts));
    }, [facts]),
  );

  const goToWeek = (week: number) => setSelection(selectWeek(facts, week));
  const select = (date: string) => setSelection((s) => (s ? { week: s.week, date } : s));
  const openPlan = (date: string) => {
    returningFromPlan.current = true;
    router.push({ pathname: '/plan/[date]', params: { date } });
  };

  // Same frame as Home: the top inset is on a non-scrolling view, so the scroll viewport
  // itself starts below the status bar and nothing scrolls under it.
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance(insets.bottom) }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.titles}>
          {view.kind === 'planner' ? (
            <Text variant="eyebrow" tone="emerald700">
              {view.blockLabel}
            </Text>
          ) : null}
          <Text variant="largeTitle" accessibilityRole="header">
            Training
          </Text>
        </View>

        {view.kind === 'planner' && selection ? (
          <>
            <View style={styles.navigator}>
              <WeekNavigator
                rangeLabel={view.rangeLabel}
                rangeAccessibilityLabel={view.rangeAccessibilityLabel}
                previous={view.previous}
                next={view.next}
                isCurrentWeek={view.isCurrentWeek}
                onPrevious={() => goToWeek(selection.week - 1)}
                onNext={() => goToWeek(selection.week + 1)}
                onCurrent={() => setSelection(initialSelection(facts))}
              />
            </View>
            <DaySelector days={view.days} onSelect={select} />
            <View style={styles.selected}>
              <SelectedSession selected={view.selected} onViewPlan={openPlan} />
            </View>
            <View style={styles.sectionHead}>
              <Text variant="title" accessibilityRole="header">
                Sessions
              </Text>
              <Text variant="caption" tone="muted" style={styles.summary}>
                {view.summaryLabel}
              </Text>
            </View>
            <WeekSessions
              sessions={view.sessions}
              restLabel={view.restLabel}
              outsideLabel={view.outsideLabel}
              onSelect={select}
            />
          </>
        ) : (
          <Card style={styles.noBlock}>
            <Text variant="bodyStrong">No training block yet</Text>
            <Text variant="body" tone="muted">
              {view.kind === 'no-block' ? view.note : null}
            </Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  scroll: { flex: 1 },
  content: { paddingHorizontal: gutter, paddingTop: space.md },
  titles: { gap: space.xs },
  navigator: { marginTop: space.xl, marginBottom: space.lg },
  selected: { marginTop: space.lg },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.xxxl,
    marginBottom: space.md,
  },
  summary: { flexShrink: 1, textAlign: 'right' },
  noBlock: { marginTop: space.xl, gap: space.xs },
});
