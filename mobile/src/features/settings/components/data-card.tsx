import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Db } from '@/data/db/database';
import { pickExportFile, shareExportFile } from '@/data/device-files';
import { exportDevice } from '@/data/transfer/export';
import { parseExport, type ExportDocument } from '@/data/transfer/format';
import { planImport, runImport, type ImportPlan } from '@/data/transfer/import';
import { color, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import type { ConfirmRequest } from '@/ui/confirm-dialog';
import { HeroButton } from '@/ui/hero-button';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

type Write = <T>(work: (db: Db, now: string, today: string) => Promise<T>) => Promise<T>;
type Props = { write: Write; today: string; confirm: (request: ConfirmRequest) => void };

type Pending = { name: string; document: ExportDocument; plan: Extract<ImportPlan, { ok: true }> };

/**
 * Your data: export everything as `fitness-lab-export-v1.json` (a backup, or the way to a
 * new iPhone), and import one — from the desktop exporter or this app. An import is shown
 * first; it goes into an empty app, or replaces this iPhone's data only when you say so
 * (the replaced data is kept on the device). Nothing is ever merged.
 */
export function DataCard({ write, today, confirm }: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const exportAll = async () => {
    setNotice(null);
    setBusy(true);
    try {
      const document = await write((db, now) => exportDevice(db, now));
      const shared = await shareExportFile(`fitness-lab-export-v1-${today}.json`, `${JSON.stringify(document, null, 2)}\n`);
      setNotice(shared === 'shared' ? 'Export ready.' : 'Sharing is not available here.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    setErrors([]);
    setNotice(null);
    setPending(null);
    const file = await pickExportFile();
    if (!file) return;
    const parsed = parseExport(file.text);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    const plan = await write((db) => planImport(db, parsed.document));
    if (!plan.ok) setErrors(plan.errors);
    else setPending({ name: file.name, document: parsed.document, plan });
  };

  const run = (mode: 'into-empty' | 'replace') => {
    if (!pending) return;
    confirm({
      title: mode === 'replace' ? 'Replace all data on this iPhone?' : 'Import this file?',
      message:
        mode === 'replace'
          ? 'Everything recorded on this iPhone is replaced by the file’s data. A copy of the current data is kept on the device first.'
          : `${pending.plan.summary.workouts} workouts, ${pending.plan.summary.bodyweight} weigh-ins and ${pending.plan.summary.nutritionDays} nutrition days will be imported.`,
      confirmLabel: mode === 'replace' ? 'Replace' : 'Import',
      destructive: mode === 'replace',
      onConfirm: () => {
        setBusy(true);
        write((db, now) => runImport(db, pending.document, mode, now))
          .then(() => {
            setPending(null);
            setNotice('Imported. Home, Training, Nutrition and History now show the file’s data.');
          })
          .catch((e: unknown) => setErrors([e instanceof Error ? e.message : 'Import failed; nothing was changed.']))
          .finally(() => setBusy(false));
      },
    });
  };

  const s = pending?.plan.summary;
  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong" accessibilityRole="header">
        Your data
      </Text>
      <Text variant="caption" tone="muted">
        One file, fitness-lab-export-v1.json: a backup of everything on this iPhone, or data from the desktop app.
      </Text>
      <View style={styles.actions}>
        <Action icon="export" label="Export data" onPress={() => void exportAll()} disabled={busy} />
        <Action icon="import" label="Import a file" onPress={() => void choose()} disabled={busy} />
      </View>

      {errors.length ? (
        <View style={styles.errors} accessibilityLiveRegion="polite">
          <Text variant="label" tone="warn">
            Not imported — nothing was changed.
          </Text>
          {errors.map((e) => (
            <Text key={e} variant="caption" tone="warn">
              {e}
            </Text>
          ))}
        </View>
      ) : null}

      {pending && s ? (
        <View style={styles.preview} accessibilityLabel={`Import preview for ${pending.name}`}>
          <Text variant="label">{pending.name}</Text>
          <Text variant="caption" tone="inkSoft">
            {s.workouts} workouts ({s.completed} completed, {s.sets} sets) · {s.bodyweight} weigh-ins · {s.nutritionDays} nutrition
            days · {s.targets} targets
          </Text>
          <Text variant="caption" tone="muted">
            {s.firstDate ? `${s.firstDate} to ${s.lastDate}` : 'No dated records'}
            {s.blockStart ? ` · block start ${s.blockStart}` : ''}
          </Text>
          <Text variant="caption" tone="muted">
            {pending.plan.programMatch === 'exact'
              ? 'Same program as this app.'
              : 'The program file differs, but every slot the file uses matches this app’s program.'}
          </Text>
          {pending.plan.deviceHasData ? (
            <>
              <Text variant="caption" tone="warn">
                This iPhone already holds data. Importing never merges: it can only replace what is here.
              </Text>
              <HeroButton label="Replace all data" icon="import" emphasis="secondary" accessibilityLabel="Replace all data on this iPhone" onPress={() => run('replace')} />
            </>
          ) : (
            <HeroButton label="Import" icon="import" accessibilityLabel={`Import ${pending.name}`} onPress={() => run('into-empty')} />
          )}
          <Pressable onPress={() => setPending(null)} accessibilityRole="button" style={styles.cancel}>
            <Text variant="label" tone="inkSoft">
              Cancel
            </Text>
          </Pressable>
        </View>
      ) : null}

      {notice ? (
        <Text variant="caption" tone="emerald700" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
    </Card>
  );
}

function Action({ icon, label, onPress, disabled }: { icon: 'export' | 'import'; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={styles.action}>
      <Icon name={icon} size={18} color={color.emerald700} />
      <Text variant="label" tone="emerald800">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  action: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    backgroundColor: color.emerald50,
  },
  errors: { gap: 4, padding: space.md, borderRadius: radius.md, backgroundColor: color.warnSurface },
  preview: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: color.sunken },
  cancel: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: space.lg },
});
