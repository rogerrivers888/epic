/**
 * Tell Epic about one person (D3), and the card of what it heard (D4).
 *
 * One recording per person: "Tell me about Priya", two prompts, live captions,
 * chips resolving inline with allergies red at once. Footer **Skip Priya** /
 * **Type**. Then the review — Loves / Avoids / Eats, and **Allergies** under a
 * red kicker with the one-line privacy note — and **Looks right · next: Alfie**.
 * Children stay proxy-rated by an adult: this is always somebody speaking for
 * them.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { api, HouseholdResponse, Member, SpokenFood, SpokenLike } from '../../api';
import { paths } from '../../routes';
import { useRouter } from '../../router';
import { useSpeech } from '../../hooks/useSpeech';
import { Bullets, Captions, ChipGroup, FactChip, MicControl, PrimaryCta, Progress, SentenceField, TextLink, VoiceHeader, VoiceScreen, clock } from '../../components/voice/kit';
import { FoodChips, LikeChips } from './SetupScreen';
import { StatusLine } from '../../components/ui';
import { colors, fonts, type } from '../../theme';

type Heard = { food: SpokenFood[]; likes: SpokenLike[] };
const DRAFT_KEY = (id: string) => `epic.voice.tell.${id}`;
const loadDraft = (id: string): Heard | null => { try { const v = sessionStorage.getItem(DRAFT_KEY(id)); return v ? JSON.parse(v) : null; } catch { return null; } };
const saveDraft = (id: string, h: Heard | null) => { try { if (h) sessionStorage.setItem(DRAFT_KEY(id), JSON.stringify(h)); else sessionStorage.removeItem(DRAFT_KEY(id)); } catch { /* noop */ } };

export function TellScreen({ memberId, mode, household, refresh }: { memberId: string; mode: 'tell' | 'review'; household: HouseholdResponse | null; refresh: () => Promise<void> }) {
  const { navigate, back } = useRouter();
  const members = household?.members ?? [];
  const member = members.find((m) => m.id === memberId) ?? null;
  const index = Math.max(0, members.findIndex((m) => m.id === memberId));
  const nextMember: Member | null = members[index + 1] ?? null;
  const [heard, setHeard] = useState<Heard | null>(() => loadDraft(memberId));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => { setHeard(loadDraft(memberId)); setError(null); setTyping(false); setText(''); }, [memberId]);

  const read = useCallback(async (transcript: string) => {
    if (!member) return;
    setBusy('Reading that…'); setError(null);
    try {
      const [food, likes] = await Promise.all([api.voiceHouseholdFood({ transcript, memberId: member.id }), api.voiceHouseholdLikes({ transcript, memberId: member.id })]);
      const next = { food: [...(heard?.food ?? []), ...food.items], likes: [...(heard?.likes ?? []), ...likes.items] };
      setHeard(next); saveDraft(member.id, next);
      navigate(paths.householdReview(member.id));
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }, [member, heard, navigate]);
  const speech = useSpeech({ onFinal: (t) => { void read(t); }, confirm: false });
  useEffect(() => { if (speech.error) setError(speech.error); }, [speech.error]);
  const listening = speech.phase === 'listening';

  const onwards = () => { if (nextMember) navigate(paths.householdTell(nextMember.id), { replace: true }); else navigate(paths.household(), { replace: true }); };
  const skip = () => { saveDraft(memberId, null); onwards(); };
  const save = async () => {
    if (!member || !heard) return;
    setBusy('Saving…');
    try { await api.voiceHouseholdApply({ memberId: member.id, food: heard.food, likes: heard.likes }); saveDraft(member.id, null); await refresh(); onwards(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  if (!household) return <VoiceScreen><StatusLine>Loading…</StatusLine></VoiceScreen>;
  if (!member) return <VoiceScreen><VoiceHeader onBack={() => back(paths.household())} title="Nobody by that name" /></VoiceScreen>;
  const she = member.relationship === 'child' ? 'they' : 'they';
  const sub = member.isMinor || (member.age != null && member.age < 18) ? `Child${member.age != null ? ` · ${member.age}` : ''}` : 'Adult';

  // --- D4: the review -----------------------------------------------------------
  if (mode === 'review') {
    const groups = useMemo(() => split(heard), [heard]);
    return (
      <VoiceScreen footer={<PrimaryCta label={nextMember ? `Looks right · next: ${nextMember.name}` : 'Looks right'} onPress={save} busy={!!busy} disabled={!heard} />}>
        <VoiceHeader onBack={() => back(paths.householdTell(member.id))} right={<TextLink label="Say more" icon="mic" onPress={() => navigate(paths.householdTell(member.id))} />} title={member.name} sub="Tap a label to remove it. Say more to add." />
        {!heard ? <Text style={type.small}>Nothing heard yet for {member.name}. Go back and tell Epic about them.</Text> : null}
        <ChipGroup title="Loves"><Wrap items={groups.loves} onRemove={(i) => drop('likes', i)} empty="+ add" /></ChipGroup>
        <ChipGroup title="Avoids"><Wrap items={groups.avoids} look="avoid" onRemove={(i) => drop('likes', i)} empty="+ add" /></ChipGroup>
        <ChipGroup title="Eats"><Wrap items={groups.eats} onRemove={(i) => drop('food', i)} empty="+ add" /></ChipGroup>
        <ChipGroup title="Allergies" tone="danger">
          <Wrap items={groups.allergies} look="allergy" onRemove={(i) => drop('food', i)} empty="+ add" />
        </ChipGroup>
        <Text style={type.tiny}>Allergies are health data. We keep the label so restaurants are filtered for {member.name}; the recording was deleted once we’d read it.</Text>
        {busy ? <StatusLine>{busy}</StatusLine> : null}
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      </VoiceScreen>
    );
  }
  function drop(kind: 'food' | 'likes', at: number) {
    if (!heard) return;
    const next = { ...heard, [kind]: heard[kind].filter((_, i) => i !== at) } as Heard;
    setHeard(next); saveDraft(memberId, next);
  }

  // --- D3: the breath ------------------------------------------------------------
  return (
    <VoiceScreen scroll={false}>
      <VoiceHeader onBack={() => back(paths.household(member.id))} right={<Progress step={index + 1} of={members.length} />} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={styles.tile}><Text style={styles.tileText}>{member.name[0]?.toUpperCase()}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={2}>Tell me about {member.name}</Text>
          <Text style={type.small}>{sub}</Text>
        </View>
      </View>
      <Bullets items={[`What does ${member.name} love doing?`, `What ${she === 'they' ? 'do they' : 'does she'} eat — and anything to avoid?`]} />
      {listening || speech.phase === 'transcribing'
        ? <Captions committed={speech.live?.committed ?? (speech.mode === 'browser' ? speech.transcript : '')} partial={speech.live?.partial ?? ''} paused={speech.paused} placeholder={speech.mode === 'record' || speech.mode === 'stream' ? 'Recording…' : ''} />
        : typing ? <SentenceField value={text} onChange={setText} onSubmit={() => text.trim() && read(text.trim())} placeholder={`${member.name} loves climbing, no nuts, doesn’t like fish…`} /> : null}
      {heard ? <><FoodChips items={heard.food} /><LikeChips items={heard.likes} /></> : null}
      <View style={{ flex: 1 }} />
      {busy ? <StatusLine>{busy}</StatusLine> : null}
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {!listening ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextLink label={`Skip ${member.name}`} tone="grey" onPress={skip} />
          {typing ? <TextLink label="Send" icon="forward" onPress={() => text.trim() && read(text.trim())} /> : <TextLink label="Type" icon="keyboard" tone="grey" onPress={() => setTyping(true)} />}
        </View>
      ) : null}
      <MicControl state={busy || speech.phase === 'transcribing' ? 'busy' : listening ? (speech.paused ? 'paused' : 'listening') : 'idle'} onStart={() => { setTyping(false); void speech.start(); }} onPause={speech.pause} onResume={speech.resume} onDone={() => { void speech.stop(); }} canPause={speech.canPause} label={null} />
      {listening ? <Text style={styles.timer}>{clock(speech.seconds)}</Text> : null}
    </VoiceScreen>
  );
}

function split(heard: Heard | null) {
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const likes = heard?.likes ?? [];
  const food = heard?.food ?? [];
  return {
    loves: likes.map((l, i) => ({ i, label: l.label ?? cap(l.phrase), hide: l.kind !== 'love' })),
    avoids: [...likes.map((l, i) => ({ i, label: l.label ?? cap(l.phrase), hide: l.kind !== 'avoid' }))],
    eats: food.map((f, i) => ({ i, label: f.kind === 'dislike' ? `No ${f.value}` : f.kind === 'favourite' ? `Loves ${f.value}` : cap(f.value), hide: f.kind === 'allergy' })),
    allergies: food.map((f, i) => ({ i, label: cap(f.value), hide: f.kind !== 'allergy' })),
  };
}

function Wrap({ items, look = 'profile', onRemove, empty }: { items: { i: number; label: string; hide: boolean }[]; look?: 'profile' | 'avoid' | 'allergy'; onRemove: (i: number) => void; empty: string }) {
  const shown = items.filter((x) => !x.hide);
  return (
    <>
      {shown.map((x) => <FactChip key={x.i} label={x.label} look={look} small onPress={() => onRemove(x.i)} />)}
      {!shown.length ? <FactChip label={empty} look="add" small /> : null}
    </>
  );
}

const styles = {
  title: { fontFamily: fonts.heading, fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.78, lineHeight: 28, color: colors.ink },
  tile: { width: 48, height: 48, backgroundColor: colors.warm, alignItems: 'center' as const, justifyContent: 'center' as const },
  tileText: { fontFamily: fonts.heading, fontWeight: '800' as const, fontSize: 20, color: colors.ink },
  timer: { fontSize: 12, fontWeight: '600' as const, color: colors.inkMuted, textAlign: 'center' as const },
};
