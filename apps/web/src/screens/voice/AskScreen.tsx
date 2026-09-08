/**
 * A gap question (C4) — only when a gap changes the plan, and at most two.
 *
 * Kids' ages: one row per child with 0–4 / 5–8 / 9–12 / 13+ boxes, "+ another
 * child", "or say it — 'nine and six'" with the small mic. Footer: **Skip ·
 * plan for all ages** left, **Remember them** (moss) right, which seeds the
 * household without a set-up flow. The other gaps (what kind of day, how far,
 * the mood) are the same screen with a row of boxes.
 *
 * `?n=2` is the second question. The last one says "last one" top-right.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, HouseholdResponse, Intake } from '../../api';
import { paths } from '../../routes';
import { asNumber, useQueryState, useRouter } from '../../router';
import { useSpeech } from '../../hooks/useSpeech';
import { Boxes, Captions, MicControl, TextLink, VoiceHeader, VoiceScreen, clock } from '../../components/voice/kit';
import { KidsPicker } from '../../components/voice/ChipPicker';
import { StatusLine } from '../../components/ui';
import { colors, fonts, type } from '../../theme';

export function AskScreen({ intakeId }: { intakeId: string; household: HouseholdResponse | null }) {
  const { navigate, back } = useRouter();
  const [n, setN] = useQueryState<number | null>('n', 1, asNumber(1));
  const [intake, setIntake] = useState<Intake | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kids, setKids] = useState<{ name: string | null; band: string | null }[]>([]);
  const [choice, setChoice] = useState<string | number | null>(null);

  useEffect(() => {
    let live = true;
    api.voiceIntakeGet(intakeId).then((r) => { if (live) setIntake(r.intake); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [intakeId]);

  // The questions were computed when the card was drawn; answering one removes
  // it, so this screen always shows the first still open.
  const question = intake?.questions[0] ?? null;
  const total = useMemo(() => Math.max(n ?? 1, (n ?? 1) - 1 + (intake?.questions.length ?? 0)), [intake, n]);

  const finish = useCallback((after: Intake) => {
    if (after.questions.length) { setN((n ?? 1) + 1); setKids([]); setChoice(null); return; }
    navigate(after.resultsHref, { replace: true });
  }, [n, navigate, setN]);

  const answer = useCallback(async (value: unknown, remember = false) => {
    if (!question) return;
    setBusy(true); setError(null);
    try {
      const { intake: got } = await api.voiceIntakePatch(intakeId, { answer: { [question.slot]: value } });
      if (remember) await api.voiceIntakeRemember(intakeId).catch(() => {});
      setIntake(got);
      setBusy(false);
      finish(got);
    } catch (e: any) { setError(e.message); setBusy(false); }
  }, [question, intakeId, finish]);

  // "or say it — 'nine and six'": one breath, read as an answer to this slot.
  const said = useCallback(async (transcript: string) => {
    if (!question) return;
    setBusy(true);
    try {
      const { intake: got } = await api.voiceIntake({ transcript, flow: 'first', mode: 'said', intakeId });
      setIntake(got);
      setBusy(false);
      if (!got.questions.some((q) => q.slot === question.slot)) finish(got);
    } catch (e: any) { setError(e.message); setBusy(false); }
  }, [question, intakeId, finish]);
  const speech = useSpeech({ onFinal: (t) => { void said(t); }, confirm: false });

  if (!intake) return <VoiceScreen><VoiceHeader onBack={() => back(paths.heard(intakeId))} />{error ? <StatusLine tone="warn">{error}</StatusLine> : <StatusLine>Loading…</StatusLine>}</VoiceScreen>;
  if (!question) { navigate(intake.resultsHref, { replace: true }); return null; }

  const listening = speech.phase === 'listening';
  const isKids = question.slot === 'kids_ages';
  const canRemember = isKids && kids.some((k) => k.band);

  return (
    <VoiceScreen>
      <VoiceHeader
        onBack={() => ((n ?? 1) > 1 ? setN((n ?? 1) - 1) : back(paths.heard(intakeId)))}
        right={<Text style={styles.count}>{(n ?? 1) >= total ? 'last one' : `${n} of ${total}`}</Text>}
      />
      <Text style={styles.title}>{question.title}</Text>
      <Text style={[type.body, { color: colors.inkMuted }]}>{question.why}</Text>

      {isKids ? (
        <KidsPicker inline initial={[]} names={question.children?.map((c) => c.name) ?? []} onChange={setKids} />
      ) : (
        <Boxes options={question.options ?? []} value={choice} onChange={(v) => { setChoice(v); void answer(v); }} grow />
      )}

      {listening || speech.phase === 'transcribing' ? (
        <>
          <Captions committed={speech.live?.committed ?? (speech.mode === 'browser' ? speech.transcript : '')} partial={speech.live?.partial ?? ''} paused={speech.paused} minHeight={60} placeholder="" />
          <Text style={styles.timer}>{clock(speech.seconds)}</Text>
        </>
      ) : <Text style={[type.small, { textAlign: 'center' }]}>or say it — {isKids ? '“nine and six”' : question.slot === 'max_minutes' ? '“about an hour”' : '“something relaxed”'}</Text>}
      <View style={{ alignItems: 'center' }}>
        <MicControl size="small" label={null} state={busy ? 'busy' : listening ? (speech.paused ? 'paused' : 'listening') : 'idle'} onStart={() => { void speech.start(); }} onPause={speech.pause} onResume={speech.resume} onDone={() => { void speech.stop(); }} canPause={speech.canPause} />
      </View>

      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextLink label={question.skip} tone="grey" onPress={() => answer(null)} />
        {isKids
          ? <TextLink label={question.remember ?? 'Remember them'} onPress={() => answer(kids.filter((k) => k.band), true)} style={!canRemember ? { opacity: 0.4 } : undefined} />
          : null}
      </View>
      {isKids && kids.some((k) => k.band) ? <TextLink label="Use these ages · just for today" tone="grey" onPress={() => answer(kids.filter((k) => k.band))} /> : null}
    </VoiceScreen>
  );
}

const styles = {
  title: { fontFamily: fonts.heading, fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.9, lineHeight: 32, color: colors.ink },
  count: { fontSize: 12, fontWeight: '600' as const, color: colors.inkMuted },
  timer: { fontSize: 12, fontWeight: '600' as const, color: colors.inkMuted, textAlign: 'center' as const },
};
