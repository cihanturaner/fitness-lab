import { Modal, StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/theme/tokens';

import { Pressable } from './pressable';
import { Text } from './text';

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  /** A destructive confirmation is drawn in the warning colour. */
  destructive?: boolean;
  onConfirm: () => void;
};

type Props = { request: ConfirmRequest | null; onDismiss: () => void };

/**
 * An explicit yes/no question in the app's own dialog, so it looks and behaves the same on
 * iOS, Android and the web preview (and can be tested). Cancel is always offered.
 */
export function ConfirmDialog({ request, onDismiss }: Props) {
  return (
    <Modal visible={request !== null} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.scrim}>
        {request ? (
          <View style={styles.dialog} accessibilityViewIsModal accessibilityRole="alert">
            <Text variant="title" accessibilityRole="header">
              {request.title}
            </Text>
            <Text variant="body" tone="inkSoft">
              {request.message}
            </Text>
            <View style={styles.actions}>
              <Pressable onPress={onDismiss} accessibilityRole="button" style={[styles.button, styles.cancel]}>
                <Text variant="button" tone="inkSoft">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  onDismiss();
                  request.onConfirm();
                }}
                accessibilityRole="button"
                style={[styles.button, request.destructive ? styles.destructive : styles.confirm]}>
                <Text variant="button" tone="onPrimary">
                  {request.confirmLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(15, 31, 25, 0.36)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: color.card,
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
  },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  button: { flex: 1, height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: color.sunken },
  confirm: { backgroundColor: color.emerald700 },
  destructive: { backgroundColor: color.warn },
});
