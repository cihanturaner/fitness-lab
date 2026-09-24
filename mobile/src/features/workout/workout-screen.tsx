import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadWorkoutFacts } from '@/data/facts-source';
import {
  addSet,
  changeExercise,
  completeWorkout,
  deleteSet,
  discardWorkout,
  openWorkout,
  reopenWorkout,
  updateSet,
  type SetValues,
} from '@/data/repo/workouts';
import { useQuery, useWrite } from '@/store/data-store';
import { color, gutter, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { ConfirmDialog, type ConfirmRequest } from '@/ui/confirm-dialog';
import { HeroButton } from '@/ui/hero-button';
import { Pressable } from '@/ui/pressable';
import { ProgressBar } from '@/ui/progress-bar';
import { StatusChip } from '@/ui/status-chip';
import { Text } from '@/ui/text';

import { ChangeSheet } from './components/change-sheet';
import { ExerciseCard, type OpenRow } from './components/exercise-card';
import { BLOCKER_TEXT, buildWorkoutView, shortenedQuestion, type LoggedRow } from './workout-view';

type Props = { date: string; workoutId: number | null };

/**
 * The workout logger: the day's planned workout in program order, each slot's
 * prescription beside the sets logged in it, and one open row — the next planned set — to
 * log LOAD → REPS → RIR. Start creates the day's draft; Finish completes it (asking first
 * when it is shortened); a completed workout is read-only until reopened.
 */
export function WorkoutScreen({ date, workoutId }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const write = useWrite();
  const load = useCallback(
    (db: Parameters<typeof loadWorkoutFacts>[0], today: string) => loadWorkoutFacts(db, date, today, workoutId),
    [date, workoutId],
  );
  const { data: facts, error } = useQuery(load, `${date}|${workoutId}`);
  const view = useMemo(() => (facts ? buildWorkoutView(facts) : null), [facts]);

  const [open, setOpen] = useState<{ slotKey: string; row: OpenRow; tapped: boolean } | null>(null);
  const [changeSlot, setChangeSlot] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (error) {
    return <Message title="Could not open this workout" note={error.message} />;
  }
  if (facts === null) {
    return <Message title="No workout planned" note="This day has no scheduled session in the block." />;
  }
  if (!facts || !view) return <View style={styles.screen} />;

  const editable = view.mode === 'draft';
  const id = view.workoutId;
  // With nothing opened by the lifter, the next planned set's row is open.
  const current = open ?? (editable && view.next ? { slotKey: view.next.slotKey, row: { kind: 'new' as const }, tapped: false } : null);

  const run = async (work: () => Promise<unknown>) => {
    setNotice(null);
    await work();
  };

  const start = () =>
    run(async () => {
      const plan = facts.plan;
      if (plan) await write((db, now) => openWorkout(db, date, plan, now));
    });

  const log = (slotKey: string) => async (values: SetValues) => {
    if (id === null) return;
    await write((db, now) => addSet(db, id, { slotKey }, values, now));
    setOpen(null);
  };

  const update = async (setId: number, values: SetValues) => {
    await write((db, now) => updateSet(db, setId, values, now));
    setOpen(null);
  };

  const remove = (block: string) => (row: LoggedRow) =>
    setConfirm({
      title: `Delete set ${row.number}?`,
      message: `${block}: ${row.summary}. The other sets keep their order.`,
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
        void write((db, now) => deleteSet(db, row.setId, now)).then(() => setOpen(null));
      },
    });

  const complete = async () => {
    if (id === null) return;
    const finish = async () => {
      const result = await write((db, now) => completeWorkout(db, id, now));
      if (!result.ok) setNotice(result.blockers.map((b) => BLOCKER_TEXT[b]).join(' '));
      setOpen(null);
    };
    if (view.blockers.length) {
      setNotice(view.blockers.map((b) => BLOCKER_TEXT[b]).join(' '));
      return;
    }
    if (view.short) {
      setConfirm({
        title: 'Finish a shortened session?',
        message: shortenedQuestion(view),
        confirmLabel: 'Complete anyway',
        onConfirm: () => void finish(),
      });
      return;
    }
    await finish();
  };

  const reopen = () =>
    setConfirm({
      title: 'Reopen to correct?',
      message: 'The workout becomes a draft again. Nothing recorded changes until you edit it.',
      confirmLabel: 'Reopen',
      onConfirm: () => {
        if (id !== null) void write((db, now) => reopenWorkout(db, id, now));
      },
    });

  const discard = () =>
    setConfirm({
      title: 'Discard this workout?',
      message: `${view.discardSummary ?? 'The empty draft will be removed.'} The plan is not changed.`,
      confirmLabel: 'Discard',
      destructive: true,
      onConfirm: () => {
        if (id === null) return;
        void write((db, now) => discardWorkout(db, id, now)).then(() => {
          if (router.canGoBack()) router.back();
        });
      },
    });

  const changing = view.blocks.find((b) => b.slotKey === changeSlot) ?? null;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: view.name }} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}>
        <Card size="hero" style={styles.header}>
          <Text variant="eyebrow" tone={view.isToday ? 'emerald700' : 'muted'}>
            {[view.isToday ? 'Today' : null, view.dateLabel, view.weekLabel].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.titleRow}>
            <Text variant="workoutName" tone="emerald700" accessibilityRole="header" style={styles.flex}>
              {view.name}
            </Text>
            <StatusChip status={view.status} label={view.statusLabel} />
          </View>
          <View style={styles.progressRow}>
            <Text variant="numeric">{view.progress.label}</Text>
            <View style={styles.flex}>
              <ProgressBar
                value={view.progress.fraction}
                color={view.status === 'shortened' ? color.warn : color.emerald600}
              />
            </View>
            <Text variant="numeric" tone="muted">
              {view.progress.percentLabel}
            </Text>
          </View>
          {view.shortenedNote ? (
            <Text variant="caption" tone="warn">
              {view.shortenedNote}
            </Text>
          ) : null}
          {view.startNote ? (
            <Text variant="caption" tone="muted">
              {view.startNote}
            </Text>
          ) : null}
          {view.mode === 'plan' && view.canStart ? (
            <HeroButton label="Start workout" icon="play" accessibilityLabel={`Start workout, ${view.name}`} onPress={() => void start()} />
          ) : null}
        </Card>

        {notice ? (
          <Card style={styles.notice} accessibilityLiveRegion="polite">
            <Text variant="label" tone="warn">
              {notice}
            </Text>
          </Card>
        ) : null}

        {view.blocks.map((block) => (
          <ExerciseCard
            key={block.slotKey}
            block={block}
            editable={editable}
            open={current?.slotKey === block.slotKey ? current.row : null}
            focusOnOpen={current?.slotKey === block.slotKey && current.tapped}
            onOpen={(row) => setOpen(row ? { slotKey: block.slotKey, row, tapped: true } : { slotKey: '', row: null, tapped: true })}
            onLog={log(block.slotKey)}
            onUpdate={update}
            onDelete={remove(block.name)}
            onChange={() => setChangeSlot(block.slotKey)}
          />
        ))}

        {view.extra.length ? (
          <Card style={styles.extra}>
            <Text variant="bodyStrong" accessibilityRole="header">
              Extra work
            </Text>
            {view.extra.map((g) => (
              <View key={g.key} style={styles.extraGroup}>
                <Text variant="label">{g.name}</Text>
                {g.logged.map((row) => (
                  <Pressable
                    key={row.setId}
                    disabled={!editable}
                    onPress={() => remove(g.name)(row)}
                    accessibilityRole={editable ? 'button' : 'text'}
                    accessibilityLabel={`${g.name}, set ${row.number}: ${row.summary}${editable ? '. Tap to delete' : ''}`}>
                    <Text variant="caption" tone="inkSoft">
                      {row.number}. {row.summary}
                      {row.warmup ? ' · warm-up' : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </Card>
        ) : null}

        {view.mode === 'draft' ? (
          <View style={styles.footer}>
            <HeroButton
              label="Finish workout"
              icon="check"
              accessibilityLabel={`Finish workout, ${view.progress.label}`}
              onPress={() => void complete()}
            />
            <Pressable onPress={discard} accessibilityRole="button" style={styles.quiet}>
              <Text variant="label" tone="warn">
                Discard workout
              </Text>
            </Pressable>
          </View>
        ) : null}
        {view.mode === 'complete' ? (
          <View style={styles.footer}>
            <HeroButton label="Reopen to correct" icon="undo" emphasis="secondary" accessibilityLabel="Reopen to correct" onPress={reopen} />
          </View>
        ) : null}
      </ScrollView>

      <ChangeSheet
        block={changing}
        onClose={() => setChangeSlot(null)}
        onChoose={async (name) => {
          if (id === null || !changing) return;
          await write((db, now) => changeExercise(db, id, changing.slotKey, name, now));
        }}
      />
      <ConfirmDialog request={confirm} onDismiss={() => setConfirm(null)} />
    </View>
  );
}

function Message({ title, note }: { title: string; note: string }) {
  return (
    <View style={[styles.screen, styles.content]}>
      <Card>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="body" tone="muted">
          {note}
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  scroll: { flex: 1 },
  content: { paddingHorizontal: gutter, paddingTop: space.md, gap: space.md },
  header: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  notice: { backgroundColor: color.warnSurface },
  extra: { gap: space.md },
  extraGroup: { gap: space.xs },
  footer: { gap: space.md, marginTop: space.sm },
  quiet: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg },
});
