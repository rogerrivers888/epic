/**
 * The toast (Settings revised v2 · State). One line on an ink bar, a lime tick,
 * an optional lime Undo, gone after 3.5s. 52px tall, 12px in from the edges and
 * 82px up from the bottom. Ink in both themes, like the tab bars.
 *
 * There is one `<Toaster />`, mounted once inside the app's frame so the toast
 * sits inside the phone on the Mobile toggle rather than across the whole
 * window. Anywhere can raise one with `showToast('Saved', { undo })` — a module
 * emitter rather than a context, the same shape the viewer and session stores
 * use, so a screen deep in a sheet does not have to thread a hook down to it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { Icon } from './Icon';
import { INK, CREAM, LIME, fonts } from '../theme';

export type ToastOpts = { undo?: () => void; durationMs?: number };
type Toast = { id: number; message: string; undo?: () => void; durationMs: number };

let seq = 0;
const listeners = new Set<(t: Toast) => void>();

/** Raise a toast from anywhere. Undo (if given) is a lime action on the right. */
export function showToast(message: string, opts: ToastOpts = {}) {
  const t: Toast = { id: ++seq, message, undo: opts.undo, durationMs: opts.durationMs ?? 3500 };
  listeners.forEach((fn) => fn(t));
  return t.id;
}

export function Toaster() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
    const onToast = (t: Toast) => {
      clear();
      setToast(t);
      timer.current = setTimeout(() => setToast((cur) => (cur?.id === t.id ? null : cur)), t.durationMs);
    };
    listeners.add(onToast);
    return () => { listeners.delete(onToast); clear(); };
  }, []);
  if (!toast) return null;
  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <View style={styles.toast} accessibilityRole="alert" accessibilityLabel={toast.message}>
        <Icon name="check" size={18} color={LIME} strokeWidth={2.6} />
        <Text numberOfLines={1} style={styles.message}>{toast.message}</Text>
        {toast.undo ? (
          <Press
            accessibilityRole="button"
            onPress={() => { toast.undo?.(); setToast((cur) => (cur?.id === toast.id ? null : cur)); }}
            hitSlop={8}
          >
            <Text style={styles.undo}>Undo</Text>
          </Press>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fills the frame; the toast pins to its bottom. box-none lets taps through
  // everywhere except the toast itself.
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', alignItems: 'stretch' },
  toast: {
    position: 'absolute', left: 12, right: 12, bottom: 82, minHeight: 52,
    backgroundColor: INK, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16,
  },
  message: { flex: 1, fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: CREAM },
  undo: { fontFamily: fonts.body, fontSize: 14, fontWeight: '800', color: LIME },
});
