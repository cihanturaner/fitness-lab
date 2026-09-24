import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Db } from '@/data/db/database';
import { SCHEMA_VERSION } from '@/data/db/version';
import { loadBlock, loadNutritionFacts } from '@/data/facts-source';
import { PROGRAM } from '@/data/program';
import { setBlockStart } from '@/data/repo/block';
import { addMacroTarget } from '@/data/repo/nutrition';
import { TargetSheet } from '@/features/nutrition/components/target-sheet';
import { buildNutritionView } from '@/features/nutrition/nutrition-view';
import { useQuery, useToday, useWrite } from '@/store/data-store';
import { color, gutter, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { ConfirmDialog, type ConfirmRequest } from '@/ui/confirm-dialog';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import { BlockCard, Row } from './components/block-card';
import { ProgramCard } from './components/program-card';

/** Settings: what is needed to run the app — the block, the target, the program, your data. */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const write = useWrite();
  const { data: block } = useQuery((db) => loadBlock(db), 'block');
  const loadTarget = useCallback((db: Db, t: string) => loadNutritionFacts(db, t, t), []);
  const { data: nutrition } = useQuery(loadTarget, 'settings-target');
  const target = useMemo(() => (nutrition ? buildNutritionView(nutrition) : null), [nutrition]);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Text variant="caption" tone="muted">
          Everything here stays on this iPhone.
        </Text>
        {block !== undefined ? (
          <BlockCard
            start={block?.start ?? null}
            weeks={PROGRAM.weeks}
            today={today}
            confirm={setConfirm}
            onSave={(start) => write((db, now) => setBlockStart(db, PROGRAM.key, start, now))}
          />
        ) : null}

        {target ? (
          <Card style={styles.card}>
            <Text variant="bodyStrong" accessibilityRole="header">
              Daily macro target
            </Text>
            {target.target ? (
              <>
                <Row label="Target (g)" value={target.target.summary} />
                <Row label="Calories" value={target.target.kcalLabel} />
                <Row label="In force" value={target.target.sinceLabel.replace('Since ', 'since ')} />
              </>
            ) : (
              <Text variant="body" tone="muted">
                No target yet. Each day is judged by the target in force on it.
              </Text>
            )}
            <Text variant="caption" tone="muted">
              Calories are derived from the macros, never typed. A new target applies from today; earlier days keep theirs.
            </Text>
            <Pressable
              onPress={() => setEditingTarget(true)}
              accessibilityRole="button"
              accessibilityLabel={target.target ? 'Change daily macro target' : 'Set daily macro target'}
              style={styles.link}>
              <Text variant="label" tone="emerald700">
                {target.target ? 'Change target' : 'Set target'}
              </Text>
            </Pressable>
          </Card>
        ) : null}

        <ProgramCard versionLabel={PROGRAM.versionLabel} />

        <Card style={styles.card}>
          <Text variant="bodyStrong" accessibilityRole="header">
            About
          </Text>
          <Row label="Workout loads" value="pounds (lb, to 0.01)" />
          <Row label="Bodyweight" value="kilograms (kg)" />
          <Row label="Calories" value="protein × 4 + carbs × 4 + fat × 9" />
          <Row label="Storage" value={`this iPhone only · schema ${SCHEMA_VERSION}`} />
        </Card>
      </ScrollView>

      {target ? (
        <TargetSheet
          key={`${editingTarget}`}
          visible={editingTarget}
          first={target.target === null}
          defaults={target.targetDefaults}
          needsException={target.targetChangeNeedsException}
          onClose={() => setEditingTarget(false)}
          onSave={(t, notes) =>
            write((db, now, day) => addMacroTarget(db, { ...t, effectiveOn: day, notes }, now)).then(() => undefined)
          }
        />
      ) : null}
      <ConfirmDialog request={confirm} onDismiss={() => setConfirm(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: gutter, paddingTop: space.md, gap: space.lg },
  card: { gap: space.md },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
});
