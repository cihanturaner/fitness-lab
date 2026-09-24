import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Db } from '@/data/db/database';
import { loadHistoryPage, type HistoryKind } from '@/data/history-source';
import { tabBarClearance } from '@/features/shell/tab-bar';
import { useQuery, useToday } from '@/store/data-store';
import { color, gutter, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { StatusChip } from '@/ui/status-chip';
import { Text } from '@/ui/text';

import { historyDayView, type HistoryDayView } from './history-view';

const PAGE = 21;
const FILTERS: { kind: HistoryKind; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'training', label: 'Training' },
  { kind: 'bodyweight', label: 'Bodyweight' },
  { kind: 'nutrition', label: 'Nutrition' },
];
const EMPTY: Record<HistoryKind, string> = {
  all: 'Nothing recorded yet.',
  training: 'No completed training recorded yet.',
  bodyweight: 'No bodyweight recorded yet.',
  nutrition: 'No nutrition recorded yet.',
};

/** History, day by day: each day with a completed workout, a weigh-in or a macro log. */
export function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = useToday();
  const [kind, setKind] = useState<HistoryKind>('all');
  const [pages, setPages] = useState(1);
  const load = useCallback((db: Db) => loadHistoryPage(db, kind, null, PAGE * pages), [kind, pages]);
  const { data: page } = useQuery(load, `history|${kind}|${pages}`);
  const days = useMemo(() => (page ? page.days.map((d) => historyDayView(d, page, today)) : null), [page, today]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance(insets.bottom) }]}
        showsVerticalScrollIndicator={false}>
        <Text variant="screenTitle" accessibilityRole="header">
          History
        </Text>
        <View style={styles.filters} accessibilityRole="tablist">
          {FILTERS.map((f) => (
            <Pressable
              key={f.kind}
              onPress={() => {
                setKind(f.kind);
                setPages(1);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: kind === f.kind }}
              style={[styles.filter, kind === f.kind && styles.filterOn]}>
              <Text variant="label" tone={kind === f.kind ? 'onPrimary' : 'inkSoft'}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {days && days.length === 0 ? (
          <Card style={styles.empty}>
            <Text variant="bodyStrong">{EMPTY[kind]}</Text>
            <Text variant="body" tone="muted">
              Each day with a completed workout, a weigh-in or a nutrition log appears here, newest first.
            </Text>
          </Card>
        ) : null}

        {days?.map((day) => (
          <DayCard
            key={day.date}
            day={day}
            onOpenWorkout={(id) => router.push({ pathname: '/workout/[date]', params: { date: day.date, id: `${id}` } })}
          />
        ))}

        {page?.nextBefore ? (
          <Pressable onPress={() => setPages((p) => p + 1)} accessibilityRole="button" style={styles.more}>
            <Text variant="label" tone="emerald700">
              Earlier days
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function DayCard({ day, onOpenWorkout }: { day: HistoryDayView; onOpenWorkout: (id: number) => void }) {
  return (
    <Card style={styles.day}>
      <View style={styles.dayHead} accessibilityRole="header">
        <Text variant="eyebrow" tone={day.isToday ? 'emerald700' : 'muted'}>
          {day.weekday}
        </Text>
        <Text variant="bodyStrong">{day.dayMonth}</Text>
        {day.isToday ? (
          <Text variant="caption" tone="emerald700">
            Today
          </Text>
        ) : null}
      </View>

      {day.workouts.map((w) => (
        <Pressable key={w.id} onPress={() => onOpenWorkout(w.id)} accessibilityRole="button" accessibilityLabel={w.accessibilityLabel} style={styles.workout}>
          <View style={styles.workoutHead}>
            <Icon name="training" size={16} color={color.emerald700} />
            <Text variant="bodyStrong" style={styles.flex}>
              {w.name}
            </Text>
            {w.shortened ? <StatusChip status="shortened" label="Shortened" /> : null}
            <Icon name="chevronRight" size={12} color={color.faint} />
          </View>
          <Text variant="caption" tone="muted" style={styles.indent}>
            {w.setsLabel}
          </Text>
          {w.slots.map((s) => (
            <View key={s.key} style={styles.indent}>
              <Text variant="caption" tone="inkSoft">
                <Text variant="label" tone="ink">
                  {s.plannedName ? `Performed: ${s.name}` : s.name}
                </Text>
                {s.plannedName ? ` (Planned: ${s.plannedName})` : ''} — {s.setsText}
              </Text>
            </View>
          ))}
        </Pressable>
      ))}

      {day.bodyweightLabel ? (
        <View style={styles.line} accessible accessibilityLabel={`Bodyweight ${day.bodyweightLabel}`}>
          <Icon name="bodyweight" size={16} color={color.fat} />
          <Text variant="label" tone="muted">
            Bodyweight
          </Text>
          <Text variant="bodyStrong">{day.bodyweightLabel}</Text>
        </View>
      ) : null}

      {day.nutrition ? (
        <View
          style={styles.line}
          accessible
          accessibilityLabel={`Nutrition ${day.nutrition.kcalLabel}, ${day.nutrition.detail}${day.nutrition.partial ? ', partial' : ''}`}>
          <Icon name="nutrition" size={16} color={color.carbs} />
          <View style={styles.flex}>
            <Text variant="bodyStrong">
              {day.nutrition.kcalLabel}
              {day.nutrition.partial ? (
                <Text variant="caption" tone="warn">
                  {' '}
                  partial
                </Text>
              ) : null}
            </Text>
            <Text variant="caption" tone="muted">
              {day.nutrition.detail}
            </Text>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: gutter, paddingTop: space.xs, gap: space.md },
  filters: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  filter: {
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.round,
    backgroundColor: color.card,
    justifyContent: 'center',
  },
  filterOn: { backgroundColor: color.emerald700 },
  empty: { gap: space.sm },
  day: { gap: space.md },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  workout: { gap: 3 },
  workoutHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  indent: { paddingLeft: 24 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  more: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xl },
});
