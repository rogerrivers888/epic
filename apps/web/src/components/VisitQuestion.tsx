/**
 * "Help the next family" — the one fact question in the rating after a visit
 * (Epic Visit Question board, V1–V4, 28 Sep 2026). It sits between the stars
 * and What stood out, between two ink rules:
 *
 *   V1  the question and Yes · No · Didn't notice
 *   V2  answered Yes or No: a moss tick, "Thanks — that helps families like yours", Change
 *   V3  answered Didn't notice: "No problem — thanks anyway" (it is not counted,
 *       so it does not claim to help), Change
 *   V4  nothing fits this household: nothing is drawn at all
 *
 * The answer saves on the tap. Change returns to V1; the next answer replaces
 * the recorded one rather than adding a second. Nothing is drawn while the
 * question loads, or if it cannot be fetched — the rating works without it.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Press } from './press';
import { Icon } from './Icon';
import { api, VisitAnswer, VisitQuestion as Question } from '../api';
import { colors, fonts } from '../theme';

type Source = { visitId: string; placeId?: string } | { booking: string };

export function VisitQuestion({ source, style }: { source: Source | null; style?: any }) {
  const [q, setQ] = useState<Question | null>(null);
  const [answer, setAnswer] = useState<VisitAnswer | null>(null);
  const [saving, setSaving] = useState(false);
  const key = source ? ('booking' in source ? `b:${source.booking}` : `v:${source.visitId}`) : null;

  useEffect(() => {
    let live = true;
    setQ(null); setAnswer(null);
    if (!source) return;
    api.visitQuestion(source).then((r) => { if (live) { setQ(r ?? null); setAnswer(r?.answer ?? null); } }).catch(() => { if (live) setQ(null); });
    return () => { live = false; };
    // The source is identified by its key; a new object for the same visit is the same question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!q) return null; // V4

  const say = async (a: VisitAnswer) => {
    if (saving) return;
    const was = answer;
    setAnswer(a); setSaving(true);
    try { await api.answerVisitQuestion({ visitId: q.visitId, factId: q.factId, answer: a }); }
    catch { setAnswer(was); }
    finally { setSaving(false); }
  };

  if (answer) {
    return (
      <View style={[styles.block, styles.done, style]}>
        <Icon name="check" size={20} color={colors.accent} strokeWidth={2.4} />
        <Text style={styles.thanks}>{answer === 'unsure' ? 'No problem — thanks anyway' : 'Thanks — that helps families like yours'}</Text>
        <Press onPress={() => setAnswer(null)} accessibilityRole="button" accessibilityLabel="Change your answer" hitSlop={12}>
          <Text style={styles.change}>Change</Text>
        </Press>
      </View>
    );
  }

  return (
    <View style={[styles.block, styles.open, style]}>
      <Text style={styles.kicker}>Help the next family</Text>
      <Text style={styles.question}>{q.question}</Text>
      <View style={styles.answers}>
        {(['yes', 'no'] as const).map((a) => (
          <Press key={a} onPress={() => void say(a)} accessibilityRole="button" disabled={saving}
            style={({ hovered }: any) => [styles.answer, hovered && styles.answerHover]}>
            {({ hovered }: any) => <Text style={[styles.answerText, hovered && { color: colors.selectedFg }]}>{a === 'yes' ? 'Yes' : 'No'}</Text>}
          </Press>
        ))}
        <Press onPress={() => void say('unsure')} accessibilityRole="button" disabled={saving}
          style={({ hovered }: any) => [styles.unsure, hovered && styles.unsureHover]}>
          {({ hovered }: any) => <Text numberOfLines={1} style={[styles.unsureText, hovered && { color: colors.ink }]}>Didn’t notice</Text>}
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 2px ink rules above and below, 14px / 16px padding (the board).
  block: { borderTopWidth: 2, borderBottomWidth: 2, borderColor: colors.ink },
  open: { paddingTop: 14, paddingBottom: 16, gap: 10 },
  done: { paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  kicker: { fontFamily: fonts.heading, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, textTransform: 'uppercase', color: colors.accent },
  question: { fontFamily: fonts.heading, fontSize: 19, fontWeight: '800', letterSpacing: -0.475, lineHeight: 23, color: colors.ink },
  answers: { flexDirection: 'row', gap: 6 },
  // 13px + 14.5px type + 13px ≈ 46px: over the 44px target.
  answer: { flex: 1, paddingVertical: 13, paddingHorizontal: 12, backgroundColor: colors.warm },
  answerHover: { backgroundColor: colors.selected },
  answerText: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: '700', color: colors.ink },
  unsure: { flex: 1.5, padding: 12, borderWidth: 1, borderColor: colors.ruleSoft },
  unsureHover: { borderColor: colors.ink },
  unsureText: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: '600', color: colors.inkMuted },
  thanks: { flex: 1, fontFamily: fonts.body, fontSize: 14, fontWeight: '700', lineHeight: 19, color: colors.ink },
  change: { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: colors.inkMuted, borderBottomWidth: 1, borderBottomColor: colors.ghost },
});
