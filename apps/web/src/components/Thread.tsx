import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from './press';
import { ChatMessage } from '../api';
import { colors, fonts, BORDER, type } from '../theme';
import { Icon } from './Icon';

/**
 * A conversation, drawn (trip rebuild, 7 Sep 2026, screens 5e and 3d).
 *
 * One component for both threads, because they are the same thread seen through
 * two windows: the trip's chat shows everything, a stop's Ask shows that stop's
 * messages, and a message asked on a stop carries a Moss pointer back to it in
 * the chat. Two components would mean two bubble styles and two composers, and
 * they would stop matching within a week.
 *
 * Received is a 28px initial tile, the name in grey, and a `#EAE7E7` bubble.
 * Sent is a lime bubble with ink text — never cream on lime, which is 1.25:1
 * and forbidden by the pack — with "Seen by 3" beneath it.
 */

const dayOf = (iso: string) => new Date(iso).toDateString();

/** "Thursday", "Yesterday", "Today" — the divider between one day and the next. */
function dividerFor(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((+new Date(new Date().toDateString()) - +new Date(d.toDateString())) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function Thread({ messages, onOpenStop, empty, helper }: {
  messages: ChatMessage[];
  /** Tapping the "› Asked on Savill Garden" pointer. Absent inside a stop's own thread. */
  onOpenStop?: (venueRef: string) => void;
  /** What to say when nobody has said anything yet. */
  empty?: string;
  /** A line above the thread — the Ask screen's "Questions here go to Sam, who's organising". */
  helper?: string;
}) {
  const scroller = useRef<ScrollView>(null);
  // A thread opens at the bottom, where the newest message is: scrolling up to
  // find what somebody just said is not reading a conversation.
  useEffect(() => { scroller.current?.scrollToEnd({ animated: false }); }, [messages.length]);

  return (
    <ScrollView
      ref={scroller}
      style={{ flex: 1 }}
      contentContainerStyle={styles.thread}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
    >
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      {!messages.length ? <Text style={styles.empty}>{empty ?? 'Nothing said yet.'}</Text> : null}
      {messages.map((m, i) => (
        <React.Fragment key={m.id}>
          {i === 0 || dayOf(messages[i - 1].at) !== dayOf(m.at)
            ? <Text style={styles.divider}>{dividerFor(m.at)}</Text>
            : null}
          <Bubble message={m} onOpenStop={onOpenStop} />
        </React.Fragment>
      ))}
    </ScrollView>
  );
}

function Bubble({ message: m, onOpenStop }: { message: ChatMessage; onOpenStop?: (ref: string) => void }) {
  /**
   * "› Asked on Savill Garden" — where a message was asked, when it was asked
   * on a stop. Drawn on your own messages as well as everybody else's: the
   * pointer is what tells the two threads apart, and a question you asked
   * yourself is exactly the one you want to be able to get back to.
   */
  const pointer = m.onStop && onOpenStop ? (
    <Press
      onPress={() => onOpenStop(m.onStop!.venueRef)}
      style={styles.pointer}
      accessibilityRole="link"
      accessibilityLabel={`Open ${m.onStop.label ?? 'that stop'}`}
    >
      <Icon name="more" size={12} color={colors.accent} strokeWidth={2.4} />
      <Text style={styles.pointerText}>{`Asked on ${m.onStop.label ?? 'a stop'}`}</Text>
    </Press>
  ) : null;

  if (m.mine) {
    return (
      <View style={styles.sentRow}>
        <View style={styles.sentCol}>
          <View style={styles.sent}><Text style={styles.sentText}>{m.body}</Text></View>
          {pointer}
          {m.seenBy > 1 ? <Text style={styles.meta}>{`Seen by ${m.seenBy - 1}`}</Text> : null}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.gotRow}>
      <View style={styles.tile}><Text style={styles.tileText}>{m.author.initial}</Text></View>
      <View style={styles.gotCol}>
        <Text style={styles.meta}>{m.author.guest ? `${m.author.name} · guest` : m.author.name}</Text>
        <View style={styles.got}><Text style={styles.gotText}>{m.body}</Text></View>
        {pointer}
      </View>
    </View>
  );
}

/** The 48px field and the 48px send button. One composer for both threads. */
export function Composer({ placeholder, onSend, busy, insetBottom = 0 }: {
  placeholder: string;
  onSend: (body: string) => Promise<void> | void;
  busy?: boolean;
  /**
   * How much of the bottom of the screen belongs to something else. On the chat
   * the tab bar floats over the page (the trip is full-bleed), and without this
   * the send button sits behind it.
   */
  insetBottom?: number;
}) {
  const [text, setText] = useState('');
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    // Cleared first: a message that stays in the box while it is sending gets
    // sent twice by anybody who taps again.
    setText('');
    try { await onSend(body); } catch { setText(body); }
  };
  return (
    <View style={[styles.composer, insetBottom ? { paddingBottom: 12 + insetBottom } : null]}>
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={send}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        returnKeyType="send"
        multiline={false}
        style={styles.field}
        accessibilityLabel={placeholder}
      />
      {/* An arrow, not a filled block (5h): the composer is a line you type on,
          and a solid square beside it was the heaviest thing on the screen. */}
      <Press onPress={send} style={styles.send} accessibilityRole="button" accessibilityLabel="Send" disabled={busy}>
        <Icon name="send" size={20} color={colors.accent} strokeWidth={2.2} />
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, gap: 14, flexGrow: 1, justifyContent: 'flex-end' },
  helper: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, lineHeight: 18, alignSelf: 'flex-start' },
  empty: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, alignSelf: 'center' },
  divider: { alignSelf: 'center', fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },

  gotRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  gotCol: { maxWidth: '78%', gap: 4 },
  sentRow: { flexDirection: 'row-reverse', gap: 10, alignItems: 'flex-end' },
  sentCol: { maxWidth: '78%', gap: 4, alignItems: 'flex-end' },

  tile: { width: 28, height: 28, backgroundColor: colors.bubble, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tileText: { fontFamily: fonts.heading, fontSize: 12, fontWeight: '800', color: colors.ink },

  got: { backgroundColor: colors.bubble, paddingVertical: 10, paddingHorizontal: 14 },
  gotText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  // Ink on lime, always: `colors.ink` turns cream in the dark and lime carries
  // ink type in both palettes (theme.ts, ON_LIME).
  sent: { backgroundColor: colors.selected, paddingVertical: 10, paddingHorizontal: 14 },
  sentText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.selectedFg },

  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  pointer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pointerText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.accent },

  composer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12 },
  field: {
    flex: 1, height: 48, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.lineSoft,
    backgroundColor: colors.surface, fontFamily: fonts.body, fontSize: 15, color: colors.ink,
  },
  send: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
