import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../press';
import { colors, fonts, BORDER, TARGET } from '../../theme';
import { Icon } from '../Icon';
import { useViewport } from '../../hooks/useViewport';

/**
 * A sheet the chat module opens over a screen: the ellipsis (E2), the
 * reaction picker (E3), where an answer goes (C6).
 *
 * A Modal portals out of the tree, so it pins itself to the phone frame the
 * shell draws on a wide window (CLAUDE.md): `framed` and `origin` come from
 * `useViewport`, and the sheet is positioned at that origin with the frame's
 * size, as VenueDrawer does. Otherwise it covers the whole browser window.
 */
export function ChatSheet({ title, onClose, children, maxHeight = 0.86 }: {
  title?: string | null;
  onClose: () => void;
  children: React.ReactNode;
  /** How much of the screen the sheet may take, as a share of its height. */
  maxHeight?: number;
}) {
  const { width, height, framed, origin } = useViewport();
  const frameBox = framed && origin
    ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height, overflow: 'hidden' as const }
    : null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={[styles.frame, frameBox]}>
          <Press style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
          <View style={[styles.sheet, { maxHeight: Math.round(height * maxHeight) }]}>
            {title ? (
              <View style={styles.head}>
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
                <Press onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
                  <Icon name="close" size={16} color={colors.ink} strokeWidth={2.4} />
                </Press>
              </View>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  frame: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.bg, borderTopWidth: BORDER, borderTopColor: colors.line, paddingBottom: 24 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 20, paddingRight: 8, minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  title: { flex: 1, fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', letterSpacing: -0.34, color: colors.ink },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
});
