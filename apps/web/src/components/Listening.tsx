import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';
import { Button, Row } from './ui';
import type { SpeechPhase } from '../hooks/useSpeech';
import type { LiveState } from '../voice/live';

/**
 * What the screen becomes while the household is speaking (owner, 3 Sep 2026):
 * everything else collapses and one big box shows exactly what has been heard
 * so far, growing as they talk. Done sends it all; Cancel keeps nothing. The
 * same words could have been typed into the box that was there before.
 *
 * Three states now, not one (the voice brief, 8 Sep 2026):
 *
 *   listening     the captions, where the mode has them. Settled words in ink,
 *                 the words still being decided in a lighter ink with a bar
 *                 that breathes — live text rewrites itself as more arrives,
 *                 and drawn this way it reads as listening, not as confused.
 *                 Modes that record and send show the clock and nothing else.
 *   transcribing  Done has been tapped and the recording is being written
 *                 down. In the hybrid mode the captions stay, greyed, as a
 *                 preview of what is coming.
 *   confirm       the words, in a box that can be edited, and one button to
 *                 use them. On by default; Settings › Voice switches it off.
 */
export function Listening({ transcript, hint, onDone, onCancel, phase = 'listening', live = null, seconds = 0, draft = '', onDraft, onAccept, onRetry, error = null, captions = true }: {
  transcript: string;
  hint?: string;
  onDone: () => void;
  onCancel: () => void;
  phase?: SpeechPhase;
  live?: LiveState | null;
  seconds?: number;
  draft?: string;
  onDraft?: (text: string) => void;
  onAccept?: () => void;
  onRetry?: () => void;
  error?: string | null;
  /** Whether this mode shows words while listening. */
  captions?: boolean;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { scroll.current?.scrollToEnd({ animated: true }); }, [transcript, phase]);

  const committed = live ? live.committed : transcript;
  const partial = live ? live.partial : '';
  const shown = live ? [committed, partial].filter(Boolean).join(' ') : transcript;
  const long = seconds >= 120;
  const title = phase === 'transcribing' ? 'Writing that down…' : phase === 'confirm' ? 'Is this right?' : 'Listening…';
  const connecting = phase === 'listening' && live && (live.status === 'connecting' || live.status === 'reconnecting');

  return (
    <View style={styles.wrap} testID="listening">
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          {phase === 'transcribing' ? <ActivityIndicator color={colors.accent} /> : phase === 'confirm' ? null : <Animated.View style={[styles.dot, { opacity: pulse }]} />}
          <Text style={type.h2}>{title}</Text>
        </Row>
        {phase !== 'confirm' ? <Text style={[type.small, styles.clock]} accessibilityLabel={`${seconds} seconds`}>{clock(seconds)}</Text> : null}
      </Row>

      {phase === 'confirm' ? (
        <TextInput
          value={draft}
          onChangeText={onDraft}
          multiline
          autoFocus
          style={[styles.box, styles.boxInner, styles.transcript, styles.editor]}
          accessibilityLabel="The words Epic heard — change anything before planning"
        />
      ) : (
        <ScrollView ref={scroll} style={styles.box} contentContainerStyle={styles.boxInner} accessibilityLiveRegion="polite" accessibilityLabel="What you've said so far">
          {shown ? (
            <Text style={[styles.transcript, phase === 'transcribing' && { color: colors.inkMuted }]}>
              {committed}
              {partial ? <Text style={styles.partial}>{committed ? ' ' : ''}{partial}</Text> : null}
              {phase === 'listening' && captions ? <Animated.View style={[styles.caret, { opacity: pulse }]} /> : null}
            </Text>
          ) : (
            <Text style={[styles.transcript, { color: colors.inkFaint }]}>
              {phase === 'transcribing'
                ? 'The recording is on its way. A moment.'
                : connecting
                  ? 'Connecting… keep talking, it is being recorded.'
                  : captions
                    ? (hint ?? 'Say where you\'re starting, how long you\'ve got, and anything you must fit in.')
                    : (hint ?? 'Say where you\'re starting, how long you\'ve got, and anything you must fit in.') + ' The words appear when you tap Done.'}
            </Text>
          )}
        </ScrollView>
      )}

      {phase === 'listening' ? (
        <Text style={type.small}>{long ? 'That\'s plenty — tap Done when you\'re ready.' : 'Take your time — nothing is sent until you tap Done. The recording isn\'t kept.'}</Text>
      ) : null}
      {phase === 'listening' && live?.status === 'failed' ? <Text style={[type.tiny, { color: colors.inkMuted }]}>{live.error}</Text> : null}
      {phase === 'confirm' ? <Text style={type.small}>Change anything that was misheard, then use it. The recording has already been forgotten.</Text> : null}
      {error ? <Text style={[type.tiny, { color: colors.overrun }]}>{error}</Text> : null}

      <Row style={{ justifyContent: 'flex-end' }}>
        {phase === 'confirm' ? (
          <>
            {onRetry ? <Button label="Say it again" kind="ghost" onPress={onRetry} icon="mic" /> : null}
            <Button label="Cancel" kind="ghost" onPress={onCancel} />
            <Button label="Use these words" onPress={onAccept ?? onDone} disabled={!draft.trim()} icon="check" />
          </>
        ) : phase === 'transcribing' ? (
          <Button label="Cancel" kind="ghost" onPress={onCancel} />
        ) : (
          <>
            <Button label="Cancel" kind="ghost" onPress={onCancel} />
            <Button label="Done" onPress={onDone} disabled={captions ? !shown.trim() : seconds < 1} />
          </>
        )}
      </Row>
    </View>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.overrun },
  clock: { fontVariant: ['tabular-nums'], color: colors.inkMuted, fontWeight: '600' },
  box: {
    minHeight: 220, maxHeight: 480, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  boxInner: { padding: spacing.lg, flexGrow: 1 },
  editor: { textAlignVertical: 'top' },
  transcript: { fontSize: 22, lineHeight: 32, color: colors.ink },
  partial: { color: colors.inkMuted },
  caret: { width: 3, height: 22, marginLeft: 3, backgroundColor: colors.accent, transform: [{ translateY: 4 }] },
});
