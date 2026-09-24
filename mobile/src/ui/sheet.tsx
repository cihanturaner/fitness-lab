import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, gutter, radius, space } from '@/theme/tokens';

import { Icon } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/** A bottom sheet over a dimmed screen: a title, a close button, and its content. */
export function Sheet({ visible, title, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={styles.scrim} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text variant="title" accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.close}>
              <Icon name="close" size={15} color={color.inkSoft} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15, 31, 25, 0.32)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: color.card,
    borderTopLeftRadius: radius.hero,
    borderTopRightRadius: radius.hero,
    paddingHorizontal: gutter,
    paddingTop: space.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: color.hairline,
    marginBottom: space.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  title: { flex: 1 },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.round,
    backgroundColor: color.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { gap: space.md, paddingBottom: space.sm },
});
