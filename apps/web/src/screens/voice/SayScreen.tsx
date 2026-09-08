/**
 * Just say it (voice intake handoff, 8 Sep 2026).
 *
 * One screen, three doors, set by the address:
 *
 *   /say               C1 — "What do you fancy doing?", the big mic, an example
 *                      sentence, "Answer one at a time ›" to the wizard.
 *   /say?for=trip      R1 — Trips' New trip: "Where to, and what do you fancy?"
 *                      with the known chips (grey, from the profile) up top.
 *   /say?for=inspire   R5 — the ask row: "Or just ask…", straight to results.
 *
 * and three states inside it: C0b (the pre-permission page, once, before the
 * browser's own prompt), C2 (listening, live captions, Pause / Done), C2b
 * (paused). `?type=1` is the keyboard (R1b): one field that takes a whole
 * sentence or just a place, through the same extraction.
 *
 * Nothing is transcribed until Done. Done sends the recording, reads the facts,
 * and moves to the card (/say/<id>) — or, from the ask row, to the results.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, HouseholdResponse, IntakeFlow } from '../../api';
import { paths } from '../../routes';
import { asFlag, asOneOf, useQueryState, useRouter } from '../../router';
import { useSpeech } from '../../hooks/useSpeech';
import { recordingSupported } from '../../voice/recorder';
import { loadVoiceLimits, voiceConfigured } from '../../voice/settings';
import { Captions, ChipGroup, Example, FactChip, ListRow, MicControl, MicTile, PrimaryCta, SentenceField, TextLink, TypeInstead, VoiceHeader, VoiceScreen, clock } from '../../components/voice/kit';
import { Icon } from '../../components/Icon';
import { colors, type } from '../../theme';
import { StatusLine } from '../../components/ui';

const PREPERMISSION_KEY = 'epic.voice.prepermission';
const seenPrePermission = () => typeof localStorage !== 'undefined' && localStorage.getItem(PREPERMISSION_KEY) === 'seen';
const markPrePermission = () => { try { localStorage.setItem(PREPERMISSION_KEY, 'seen'); } catch { /* noop */ } };

const RECENTS_KEY = 'epic.voice.recents';
const recents = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); } catch { return []; } };
const remember = (place: string) => { try { localStorage.setItem(RECENTS_KEY, JSON.stringify([place, ...recents().filter((p) => p !== place)].slice(0, 5))); } catch { /* noop */ } };

const COPY = {
  first: { title: 'What do you fancy doing?', example: 'we want a day out on Saturday, happy to drive an hour, the kids want something active, and we’d like a good pub lunch', placeholder: 'Where, when, who’s coming, and what for…' },
  trip: { title: 'Where to, and what do you fancy?', example: 'Windsor on Saturday, something for the kids, and a pub lunch', placeholder: 'Where, when, and what for…' },
  inspire: { title: 'What are you after?', example: 'somewhere for a rainy afternoon with the kids', placeholder: 'Somewhere for…' },
};

export function SayScreen({ household }: { household: HouseholdResponse | null }) {
  const { navigate, back } = useRouter();
  const [door] = useQueryState<'trip' | 'inspire' | null>('for', null, asOneOf(['trip', 'inspire'] as const, null));
  const [typing, setTyping] = useQueryState<boolean>('type', false, asFlag);
  const flow: IntakeFlow = door === 'trip' ? 'returning' : door === 'inspire' ? 'inspire' : 'first';
  const copy = COPY[door ?? 'first'];
  const [preface, setPreface] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');

  // What the profile already says (R1): home, how they travel, who, diets.
  // Only on Trips' door — the first-time screen (C1) has no profile to show.
  const known = useMemo(() => (door === 'trip' ? knownChips(household) : []), [household, door]);
  // Whether the server can hear at all. Off, the ordinary town search is the way to a trip.
  const [voiceOn, setVoiceOn] = useState<boolean | null>(voiceConfigured());
  useEffect(() => { void loadVoiceLimits(api.voiceConfig, true).then(() => setVoiceOn(voiceConfigured())); }, []);
  const off = voiceOn === false;

  const submit = useCallback(async (transcript: string, mode: 'said' | 'typed') => {
    setBusy('Reading that…');
    setError(null);
    try {
      const { intake } = await api.voiceIntake({ transcript, flow, mode });
      if (intake.resolved.destination) remember(intake.resolved.destination);
      if (flow === 'inspire') navigate(intake.resultsHref, { replace: true });
      else navigate(paths.heard(intake.id), { replace: true });
    } catch (e: any) {
      setError(e?.message || 'Epic couldn’t read that. Try again, or type it.');
      setBusy(null);
    }
  }, [flow, navigate]);

  const speech = useSpeech({ onFinal: (t) => { void submit(t, 'said'); }, confirm: false });
  const listening = speech.phase === 'listening';
  const transcribing = speech.phase === 'transcribing';

  const startMic = () => {
    if (!seenPrePermission()) { setPreface(true); return; }
    void speech.start();
  };
  const allow = () => { markPrePermission(); setPreface(false); void speech.start(); };
  useEffect(() => { if (speech.error) setError(speech.error); }, [speech.error]);

  // --- C0b: the pre-permission page, once -------------------------------------
  if (preface) {
    return (
      <VoiceScreen>
        <VoiceHeader onBack={() => setPreface(false)} />
        <View style={{ flex: 1 }} />
        <MicTile onPress={allow} size={64} />
        <Text style={[type.title, { fontSize: 28, lineHeight: 30 }]}>Epic listens so you don’t have to type</Text>
        <Text style={[type.body, { color: colors.inkMuted }]}>Your phone will ask to use the microphone. We turn what you say into a plan, then delete the recording — only the details stay.</Text>
        <PrimaryCta label="Allow microphone" onPress={allow} />
        <TypeInstead label="I’d rather type" onPress={() => { markPrePermission(); setPreface(false); setTyping(true); }} />
      </VoiceScreen>
    );
  }

  // --- C2 / C2b / R2: listening ----------------------------------------------------
  if (listening || transcribing) {
    const paused = speech.paused;
    return (
      <VoiceScreen scroll={false}>
        <VoiceHeader
          onBack={() => { speech.cancel(); }}
          right={<Text style={styles.timer}>{clock(speech.seconds)}{paused ? ' · paused' : ''}</Text>}
          title={transcribing ? 'Got it…' : paused ? 'Paused' : 'Listening…'}
        />
        <Captions
          committed={speech.live?.committed ?? (speech.mode === 'browser' ? speech.transcript : '')}
          partial={speech.live?.partial ?? ''}
          paused={paused || transcribing}
          placeholder={speech.live?.status === 'connecting' || speech.live?.status === 'reconnecting' ? 'Connecting… keep talking, it is being recorded.' : speech.mode === 'record' || speech.mode === 'stream' ? 'Recording. The words are read when you tap Done.' : ''}
        />
        <View style={{ flex: 1 }} />
        {transcribing ? <StatusLine>{busy ?? 'Writing that down…'}</StatusLine> : (
          <MicControl state={paused ? 'paused' : 'listening'} onStart={startMic} onPause={speech.pause} onResume={speech.resume} onDone={() => { void speech.stop(); }} canPause={speech.canPause} />
        )}
        {!transcribing ? <TypeInstead onPress={() => { speech.cancel(); setTyping(true); }} /> : null}
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      </VoiceScreen>
    );
  }

  // --- R1b / typed ------------------------------------------------------------------
  if (typing) {
    const list = recents();
    return (
      <VoiceScreen>
        <VoiceHeader onBack={() => (door ? back(door === 'trip' ? paths.trips() : paths.inspire()) : back(paths.inspire()))} right={<MicTile onPress={() => { setTyping(false); startMic(); }} />} title={copy.title} />
        {known.length ? <KnownChips chips={known} /> : null}
        <Example>{copy.example}</Example>
        {!off ? <SentenceField value={text} onChange={setText} onSubmit={() => text.trim() && submit(text.trim(), 'typed')} placeholder={copy.placeholder} /> : null}
        {off ? <VoiceOff door={door} onSearch={() => navigate(paths.tripsSearch())} /> : null}
        {door === 'trip' && !off ? <TextLink label="Or search for a town ›" tone="grey" onPress={() => navigate(paths.tripsSearch())} /> : null}
        {busy ? <StatusLine>{busy}</StatusLine> : null}
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        {list.length && !off ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.kicker}>Recent</Text>
            {list.map((p) => <ListRow key={p} icon="address" label={p} onPress={() => submit(p, 'typed')} />)}
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {!off ? <PrimaryCta label={door === 'trip' ? 'Plan it' : 'Show me plans'} onPress={() => text.trim() && submit(text.trim(), 'typed')} disabled={!text.trim()} busy={!!busy} /> : null}
      </VoiceScreen>
    );
  }

  // --- C1 / R1 / R5: the mic ---------------------------------------------------------
  const supported = recordingSupported() || speech.supported;
  return (
    <VoiceScreen>
      <VoiceHeader
        onBack={() => (door === 'trip' ? back(paths.trips()) : back(paths.inspire()))}
        right={!door ? <TextLink label="Answer one at a time ›" tone="grey" onPress={() => navigate(paths.saySteps())} /> : null}
        title={copy.title}
      />
      {known.length ? <KnownChips chips={known} /> : null}
      <Example>{copy.example}</Example>
      {off ? <VoiceOff door={door} onSearch={() => navigate(paths.tripsSearch())} /> : null}
      <View style={{ flex: 1 }} />
      {off ? null : supported ? (
        <MicControl state={busy ? 'busy' : 'idle'} onStart={startMic} onDone={() => {}} label="Tap and just say it" />
      ) : (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="keyboard" size={28} color={colors.inkMuted} />
          <Text style={[type.small, { textAlign: 'center' }]}>This browser can’t record. Typing does exactly the same thing.</Text>
        </View>
      )}
      {!off ? <TypeInstead onPress={() => setTyping(true)} /> : null}
      {busy ? <StatusLine>{busy}</StatusLine> : null}
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
    </VoiceScreen>
  );
}

/** Voice is not set up on this server (no key, or switched off): say so, and keep the other door open. */
function VoiceOff({ door, onSearch }: { door: 'trip' | 'inspire' | null; onSearch: () => void }) {
  return (
    <View style={{ gap: 8, backgroundColor: colors.warm, padding: 14 }}>
      <Text style={type.body}>Voice isn’t set up on this Epic yet, so nothing said or typed here can be read.</Text>
      {door === 'trip' ? <TextLink label="Search for a town instead ›" onPress={onSearch} /> : <Text style={type.small}>The rest of Epic works as it always has.</Text>}
    </View>
  );
}

/** The grey chips of what the profile already says (R1). */
function KnownChips({ chips }: { chips: { label: string; icon: string }[] }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {chips.map((c) => <FactChip key={c.label} label={c.label} icon={c.icon} look="profile" />)}
      </View>
      <Text style={type.small}>What we already know — tap to change on the next screen, or just say it differently.</Text>
    </View>
  );
}

function knownChips(h: HouseholdResponse | null): { label: string; icon: string }[] {
  if (!h) return [];
  const out: { label: string; icon: string }[] = [];
  const home = h.household.home;
  if (home) out.push({ label: `From home · ${town(home.label)}`, icon: 'home' });
  const MODE_WORDS: Record<string, string> = { driving: 'Car', transit: 'Train & bus', walking: 'On foot', cycling: 'Bike' };
  const modeLabel = h.household.travelMode ? MODE_WORDS[h.household.travelMode] ?? null : null;
  const mins = h.household.maxTravelMinutes;
  if (modeLabel || mins) out.push({ label: [modeLabel, mins ? `up to ${mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} hr`}` : null].filter(Boolean).join(' · '), icon: modeLabel === 'Train & bus' ? 'transit' : modeLabel === 'On foot' ? 'walking' : 'driving' });
  if (h.members.length) out.push({ label: h.members.length === 1 ? 'Just you' : `All ${h.members.length} of you`, icon: 'household' });
  const diets = [...new Set(h.members.flatMap((m) => m.diets.map((d) => d.value)))];
  for (const d of diets.slice(0, 2)) out.push({ label: d[0].toUpperCase() + d.slice(1), icon: 'restaurant' });
  return out;
}
const town = (label: string) => { const parts = label.split(',').map((p) => p.trim()).filter((p) => p && !/\d/.test(p)); return parts[parts.length - 1] ?? label; };

const styles = {
  timer: { fontSize: 13, fontWeight: '600' as const, color: colors.inkMuted },
  kicker: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.88, textTransform: 'uppercase' as const, color: colors.inkMuted },
};

export { ChipGroup };
