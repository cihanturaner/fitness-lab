import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PROGRAM_NOTES_TR } from '@/data/program-notes-tr';
import { color, radius, space } from '@/theme/tokens';
import { Card } from '@/ui/card';
import { Icon } from '@/ui/icon';
import { Pressable } from '@/ui/pressable';
import { Text } from '@/ui/text';

import { parseProgramNotes, ruleLabel, turkishProgramName } from '../program-notes';
import { Row } from './block-card';

type Props = { versionLabel: string };

/**
 * Settings › Program, in Turkish as the frozen desktop shows it for this program: its name,
 * version and rules, verbatim from the locked source (exercise names, RIR, P1/P2/P7′,
 * formulas and numbers unchanged). Read-only; nothing here is applied by the app.
 */
export function ProgramCard({ versionLabel }: Props) {
  const sections = useMemo(() => parseProgramNotes(PROGRAM_NOTES_TR, 'Program Hakkında'), []);
  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong" accessibilityRole="header">
        Program
      </Text>
      <View style={styles.facts}>
        <Row label="Program" value={turkishProgramName(PROGRAM_NOTES_TR)} />
        <Row label="Sürüm" value={versionLabel} />
      </View>
      <Text variant="label" accessibilityRole="header">
        Program Kuralları
      </Text>
      <Text variant="caption" tone="muted">
        Kilitli programdan. İlerleme, hafifletme haftası, kalibrasyon ve 12. hafta kıyaslaması kararlarınız için yol
        göstericidir; uygulama bunları kendisi uygulamaz.
      </Text>
      <View style={styles.rules}>
        {sections.map((section, i) => (
          <RuleSection key={section.title} title={section.title} first={i === 0}>
            {section.blocks.map((block, j) =>
              block.kind === 'json' ? (
                <Value key={j} value={block.value} />
              ) : (
                <View key={j} style={styles.lines}>
                  {block.lines.map((line) => (
                    <Text key={line} variant="caption" tone="inkSoft">
                      {line}
                    </Text>
                  ))}
                </View>
              ),
            )}
          </RuleSection>
        ))}
      </View>
    </Card>
  );
}

function RuleSection({ title, first, children }: { title: string; first: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.section, !first && styles.divider]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.sectionHead}>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chevronRight" size={12} color={color.emerald700} />
        </View>
        <Text variant="label">{title}</Text>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

/** A JSON value from the notes, as a labelled list; booleans read evet / hayır. */
function Value({ value }: { value: unknown }) {
  if (value === null) return <Text variant="caption" tone="faint">—</Text>;
  if (typeof value === 'boolean') return <Text variant="caption">{value ? 'evet' : 'hayır'}</Text>;
  if (typeof value !== 'object') return <Text variant="caption">{String(value)}</Text>;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return <Text variant="caption">{value.map((item) => String(item)).join(', ')}</Text>;
    }
    return (
      <View style={styles.lines}>
        {value.map((item, i) => (
          <View key={i} style={styles.nested}>
            <Value value={item} />
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.lines}>
      {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
        <View key={key} style={styles.pair}>
          <Text variant="caption" tone="muted">
            {ruleLabel(key)}
          </Text>
          <View style={styles.pairValue}>
            <Value value={item} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  facts: { gap: space.sm },
  rules: { borderRadius: radius.md, backgroundColor: color.sunken, paddingHorizontal: space.md },
  section: { paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  body: { paddingLeft: space.xl, paddingBottom: space.md, gap: space.sm },
  lines: { gap: 6 },
  nested: { borderLeftWidth: 1, borderLeftColor: color.hairline, paddingLeft: space.sm },
  pair: { gap: 1 },
  pairValue: { paddingLeft: space.sm },
});
