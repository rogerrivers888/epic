/**
 * One question at a time (Option B — the wizard, a fallback from C1).
 *
 * Three pages, one breath each: where from and how far; who's going and what's
 * the mood; anything on food. A progress bar of three segments and "n of 3".
 * Live captions while recording; the chips resolve beneath once the page's
 * words are read; Skip and Type on every page. No budget question — that is
 * the Filters control on the results. Page 3's Done goes to the summary (B4),
 * which is the fact card at /say/<id>.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, HouseholdResponse, Intake } from '../../api';
import { paths } from '../../routes';
import { asNumber, useQueryState, useRouter } from '../../router';
import { useSpeech } from '../../hooks/useSpeech';
import { Bullets, Captions, FactChip, MicControl, Progress, SentenceField, TextLink, VoiceHeader, VoiceScreen, clock } from '../../components/voice/kit';
import { groupingFor } from '../../components/voice/FactCard';
import { StatusLine } from '../../components/ui';
import { colors, fonts } from '../../theme';

const PAGES = [
  { n: 1, title: 'Where from, and how far?', prompts: ['Starting from home, or somewhere else?', 'Driving, train, or on foot?', 'How long are you happy to travel?'] },
  { n: 2, title: 'Who’s going, and what’s the mood?', prompts: ['Everyone, or just some of you?', 'Fun, culture, active, or relaxed?', 'One thing, or a few?'] },
  { n: 3, title: 'Anything on food?', prompts: ['Anything you must have or avoid?', 'Somewhere in particular for lunch?'] },
];

export function StepsScreen({ household }: { household: HouseholdResponse | null }) {
  const { navigate, back } = useRouter();
  const [pageN, setPageN] = useQueryState<number | null>('page', 1, asNumber(1));
  const page = PAGES[Math.min(3, Math.max(1, pageN ?? 1)) - 1];
  const [intake, setIntake] = useState<Intake | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');

  const next = useCallback((after: Intake | null) => {
    if (page.n < 3) { setPageN(page.n + 1); setTyping(false); setText(''); return; }
    if (after) navigate(paths.heard(after.id), { replace: true });
    else navigate(paths.say(), { replace: true });
  }, [page.n, navigate, setPageN]);

  const submit = useCallback(async (transcript: string, mode: 'steps' | 'typed') => {
    setBusy(true); setError(null);
    try {
      const { intake: got } = await api.voiceIntake({ transcript, flow: 'first', mode: mode === 'typed' ? 'typed' : 'steps', page: page.n, intakeId: intake?.id ?? null });
      setIntake(got);
      setBusy(false);
      next(got);
    } catch (e: any) { setError(e?.message || 'Epic couldn’t read that.'); setBusy(false); }
  }, [intake, page.n, next]);

  const speech = useSpeech({ onFinal: (t) => { void submit(t, 'steps'); }, confirm: false });
  useEffect(() => { if (speech.error) setError(speech.error); }, [speech.error]);
  const listening = speech.phase === 'listening';

  // The chips this page's slots resolved to, from the reading so far (B2, B3 boards).
  const chips = useMemo(() => {
    if (!intake) return [];
    const keys = groupingFor({ flow: 'first', mode: 'steps' })[page.n - 1]?.keys ?? [];
    return intake.slots.filter((s) => keys.includes(s.key) && s.source === 'said');
  }, [intake, page.n]);

  return (
    <VoiceScreen scroll={false}>
      <VoiceHeader
        onBack={() => (page.n > 1 ? setPageN(page.n - 1) : back(paths.say()))}
        right={<Progress step={page.n} of={3} />}
      />
      <Text style={styles.title}>{page.title}</Text>
      <Bullets items={page.prompts} />
      {listening || speech.phase === 'transcribing' ? (
        <Captions committed={speech.live?.committed ?? (speech.mode === 'browser' ? speech.transcript : '')} partial={speech.live?.partial ?? ''} paused={speech.paused || speech.phase === 'transcribing'} placeholder={speech.mode === 'record' || speech.mode === 'stream' ? 'Recording…' : ''} />
      ) : typing ? (
        <SentenceField value={text} onChange={setText} onSubmit={() => text.trim() && submit(text.trim(), 'typed')} placeholder={page.prompts[0]} />
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 40 }}>
        {chips.map((s, i) => <FactChip key={`${s.key}-${i}`} label={s.label} icon={s.icon} look="said" />)}
      </View>
      <View style={{ flex: 1 }} />
      {busy ? <StatusLine>Reading that…</StatusLine> : null}
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {!listening ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextLink label="Skip" tone="grey" onPress={() => next(intake)} />
          {typing
            ? <TextLink label="Send" icon="forward" onPress={() => text.trim() && submit(text.trim(), 'typed')} />
            : <TextLink label="Type" icon="keyboard" tone="grey" onPress={() => setTyping(true)} />}
        </View>
      ) : null}
      <MicControl
        state={speech.phase === 'transcribing' || busy ? 'busy' : listening ? (speech.paused ? 'paused' : 'listening') : 'idle'}
        onStart={() => { setTyping(false); void speech.start(); }} onPause={speech.pause} onResume={speech.resume} onDone={() => { void speech.stop(); }}
        canPause={speech.canPause} label={null}
      />
      {listening ? <Text style={styles.timer}>{clock(speech.seconds)}{speech.paused ? ' · paused' : ''}</Text> : null}
    </VoiceScreen>
  );
}

const styles = {
  title: { fontFamily: fonts.heading, fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.9, lineHeight: 32, color: colors.ink },
  timer: { fontSize: 12, fontWeight: '600' as const, color: colors.inkMuted, textAlign: 'center' as const },
};
