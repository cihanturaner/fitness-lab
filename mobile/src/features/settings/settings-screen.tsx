import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadBlock } from '@/data/facts-source';
import { PROGRAM } from '@/data/program';
import { setBlockStart } from '@/data/repo/block';
import { useQuery, useToday, useWrite } from '@/store/data-store';
import { color, gutter, space } from '@/theme/tokens';
import { ConfirmDialog, type ConfirmRequest } from '@/ui/confirm-dialog';
import { Text } from '@/ui/text';

import { BlockCard } from './components/block-card';

/** Settings: what is needed to run the app — the block, targets, the program, your data. */
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const today = useToday();
  const write = useWrite();
  const { data: block } = useQuery((db) => loadBlock(db), 'block');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

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
      </ScrollView>
      <ConfirmDialog request={confirm} onDismiss={() => setConfirm(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: gutter, paddingTop: space.md, gap: space.lg },
});
