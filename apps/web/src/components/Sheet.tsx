import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { useViewport } from '../hooks/useViewport';
import { colors, fonts, spacing, BORDER } from '../theme';

/**
 * A bottom sheet (Settings revised v2 · the How-Epic-plans sheets SE7–SE11, the
 * edit sheet SE6, the photo-source sheet SX1). A 40×4 handle, a 20px/800 title
 * with an optional action on the right and Cancel on the left, a 2px ink rule,
 * then content. Scrim behind; a tap on it closes.
 *
 * Pins to the phone frame on the Mobile toggle, the same way the venue drawer
 * does, so it sits inside the 390px frame rather than across the whole window.
 * `fromTop` makes it a tall near-full sheet (SE6 sits 56px below the top);
 * otherwise it is bottom-anchored and only as tall as its content.
 */
export function Sheet({ title, onClose, onCancel, cancelLabel = 'Cancel', onDone, doneLabel = 'Done', doneDisabled, fromTop, handle = true, children }: {
  title: string;
  onClose: () => void;
  /** Left action. When set, the header reads Cancel · title · action. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** Right action (Done/Save). */
  onDone?: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
  /** px below the top for a tall sheet (SE6). Omit for a content-height bottom sheet. */
  fromTop?: number;
  handle?: boolean;
  children: React.ReactNode;
}) {
  const { width, height, framed, origin } = useViewport();
  const box = framed && origin
    ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height }
    : { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
  const tall = fromTop != null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={box}>
        <Press style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.card, tall ? { position: 'absolute', top: fromTop, left: 0, right: 0, bottom: 0 } : styles.bottom]}>
          {handle && !tall ? <View style={styles.handle} /> : null}
          <View style={styles.header}>
            <View style={styles.side}>
              {onCancel ? <Press onPress={onCancel} accessibilityRole="button"><Text style={styles.cancel}>{cancelLabel}</Text></Press> : null}
            </View>
            <Text numberOfLines={1} style={styles.title}>{title}</Text>
            <View style={[styles.side, { alignItems: 'flex-end' }]}>
              {onDone ? (
                <Press onPress={onDone} disabled={doneDisabled} accessibilityRole="button">
                  <Text style={[styles.done, doneDisabled && styles.doneOff]}>{doneLabel}</Text>
                </Press>
              ) : null}
            </View>
          </View>
          <View style={styles.rule} />
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  card: { backgroundColor: colors.bg },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%' },
  handle: { width: 40, height: 4, backgroundColor: colors.ruleSoft, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 8 },
  side: { minWidth: 56, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  cancel: { fontFamily: fonts.body, fontSize: 16, color: colors.inkMuted },
  done: { fontFamily: fonts.body, fontSize: 16, fontWeight: '700', color: colors.ink },
  doneOff: { color: colors.inkFaint },
  rule: { height: BORDER, backgroundColor: colors.line },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 28, gap: 14 },
});
