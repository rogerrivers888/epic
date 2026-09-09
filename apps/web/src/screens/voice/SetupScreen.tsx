/**
 * "Set up my family first" — the two-minute set-up (row O).
 *
 * Five steps, three of them spoken. Address and range are taps (voice is poor
 * at postcodes and numbers); household, food and what you like doing are one
 * breath each. Every step is skippable and nothing here blocks a plan.
 *
 *   1  Where's home?             address search or current location → home
 *   2  How far for a day out?    Usually by · Each way, up to → travelMode, range
 *   3  Who's in the household?   voice → people → the review (O3b) → members
 *   4  Food                      voice → diet / allergy / dislike / favourite chips
 *   5  What do you all like?     voice → likes and avoids on our shelves
 *   ✓  Done                      the summary as grey profile chips; two doors
 *
 * `?step=n` is the address of each step.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, HouseholdResponse, Member, Place, SpokenFood, SpokenLike, SpokenPerson } from '../../api';
import { paths } from '../../routes';
import { asNumber, useQueryState, useRouter } from '../../router';
import { useSpeech } from '../../hooks/useSpeech';
import { Boxes, Captions, ChipGroup, FactChip, ListRow, MicControl, PrimaryCta, Progress, SentenceField, TextLink, VoiceHeader, VoiceScreen, clock } from '../../components/voice/kit';
import { bandOf } from '../../components/voice/ChipPicker';
import { Icon } from '../../components/Icon';
import { StatusLine } from '../../components/ui';
import { colors, fonts, type } from '../../theme';

const MODES = [{ value: 'driving', label: 'Car' }, { value: 'transit', label: 'Train & bus' }, { value: 'walking', label: 'On foot' }] as const;
const MODE_ICONS = { driving: 'driving', transit: 'transit', walking: 'walking' } as const;
const RANGES = [{ value: 20, label: '20 min' }, { value: 30, label: '30 min' }, { value: 60, label: '1 hr' }, { value: 120, label: '2 hr' }];
const BANDS = ['0-4', '5-8', '9-12', '13+'];
const KM_PER_MIN = { driving: 1, transit: 0.7, walking: 0.08 } as const;

const town = (label?: string | null) => { if (!label) return ''; const parts = label.split(',').map((p) => p.trim()).filter((p) => p && !/\d/.test(p)); return parts[parts.length - 1] ?? label; };

export function SetupScreen({ household, refresh }: { household: HouseholdResponse | null; refresh: () => Promise<void> }) {
  const { navigate, back } = useRouter();
  const [stepN, setStepN] = useQueryState<number | null>('step', 1, asNumber(1));
  const step = Math.min(6, Math.max(1, stepN ?? 1));
  const started = useRef(Date.now());
  const [error, setError] = useState<string | null>(null);
  const go = (n: number) => { setError(null); setStepN(n); };

  return (
    <>
      {step === 1 ? <HomeStep household={household} refresh={refresh} onNext={() => go(2)} onBack={() => back(paths.welcome())} error={error} setError={setError} /> : null}
      {step === 2 ? <RangeStep household={household} refresh={refresh} onNext={() => go(3)} onBack={() => go(1)} error={error} setError={setError} /> : null}
      {step === 3 ? <WhoStep household={household} refresh={refresh} onNext={() => go(4)} onBack={() => go(2)} error={error} setError={setError} /> : null}
      {step === 4 ? <FoodStep household={household} refresh={refresh} onNext={() => go(5)} onBack={() => go(3)} error={error} setError={setError} /> : null}
      {step === 5 ? <LikesStep household={household} refresh={refresh} onNext={() => go(6)} onBack={() => go(4)} error={error} setError={setError} /> : null}
      {step === 6 ? <DoneStep household={household} startedAt={started.current} onPlan={() => navigate(paths.say({ for: 'trip' }), { replace: true })} onLook={() => navigate(paths.inspire(), { replace: true })} onBack={() => go(5)} /> : null}
    </>
  );
}

type StepProps = { household: HouseholdResponse | null; refresh: () => Promise<void>; onNext: () => void; onBack: () => void; error: string | null; setError: (e: string | null) => void };

// ---------------------------------------------------------------------------
// 1 · Where's home?
// ---------------------------------------------------------------------------

function HomeStep({ household, refresh, onNext, onBack, error, setError }: StepProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [chosen, setChosen] = useState<Place | null>(household?.household.home ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return; }
    let live = true;
    const t = setTimeout(() => { api.geocode(q.trim(), 6).then((r) => { if (live) setResults(r.results); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const locate = () => {
    if (Platform.OS !== 'web' || !navigator.geolocation) { setError('Location isn’t available here — search for the address instead.'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try { const r = await api.where(pos.coords.latitude, pos.coords.longitude); setChosen(r.place); setQ(''); setResults([]); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
    }, () => { setBusy(false); setError('Epic couldn’t get your location. Search for the address instead.'); }, { timeout: 8000 });
  };
  const next = async () => {
    if (!chosen) { onNext(); return; }
    setBusy(true);
    try { await api.updateHousehold({ home: chosen }); await refresh(); onNext(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <VoiceScreen footer={<PrimaryCta label="Next · how far" onPress={next} busy={busy} />}>
      <VoiceHeader onBack={onBack} right={<Progress step={1} of={5} />} title="Where’s home?" sub="Trips start here, and “an hour away” is measured from it." big />
      <SentenceField value={q} onChange={setQ} onSubmit={() => {}} placeholder="Sunningdale, Ascot SL5" autoFocus={!chosen} />
      <View>
        {chosen && !results.length ? <ListRow icon="home" label={chosen.label} on onPress={() => {}} /> : null}
        {results.map((p) => <ListRow key={`${p.lat},${p.lng}`} icon="address" label={p.label} on={chosen?.label === p.label} onPress={() => { setChosen(p); setResults([]); setQ(''); }} />)}
      </View>
      <TextLink label="Use my current location" icon="here" onPress={locate} />
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      <View style={{ flex: 1 }} />
      <TextLink label="Skip for now" tone="grey" onPress={onNext} />
    </VoiceScreen>
  );
}

// ---------------------------------------------------------------------------
// 2 · How far for a day out?
// ---------------------------------------------------------------------------

function RangeStep({ household, refresh, onNext, onBack, error, setError }: StepProps) {
  const knownMode = household?.household.travelMode;
  const [mode, setMode] = useState<'driving' | 'transit' | 'walking'>(knownMode === 'transit' || knownMode === 'walking' ? knownMode : 'driving');
  const [range, setRange] = useState<number>(household?.household.maxTravelMinutes && RANGES.some((r) => r.value === household.household.maxTravelMinutes) ? household.household.maxTravelMinutes : 60);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const home = household?.household.home ?? null;
  // "About 240 places within an hour's drive of Sunningdale" — counted from our own atlas.
  useEffect(() => {
    if (!home) { setCount(null); return; }
    let live = true;
    const km = Math.min(100, Math.max(2, Math.round(range * KM_PER_MIN[mode])));
    api.inspireNear({ lat: home.lat, lng: home.lng, label: home.label, mode: mode === 'driving' ? 'drive' : mode === 'transit' ? 'transit' : 'walk', km }).then((r) => { if (live) setCount(r.items.length); }).catch(() => { if (live) setCount(null); });
    return () => { live = false; };
  }, [home, mode, range]);
  const next = async () => {
    setBusy(true);
    try { await api.updateHousehold({ travelMode: mode, maxTravelMinutes: range }); await refresh(); onNext(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const rangeWords = range < 60 ? `${range} minutes` : range === 60 ? 'an hour' : `${range / 60} hours`;
  const reach = mode === 'driving' ? `${rangeWords}’${rangeWords.endsWith('s') ? '' : 's'} drive` : mode === 'transit' ? `${rangeWords} by train or bus` : `${rangeWords} on foot`;
  return (
    <VoiceScreen footer={<PrimaryCta label="Next · who’s coming" onPress={next} busy={busy} />}>
      <VoiceHeader onBack={onBack} right={<Progress step={2} of={5} />} title="How far will you go for a day out?" sub="Your default. Change it any time on a trip." big />
      <View style={{ gap: 8 }}>
        <Text style={styles.kicker}>Usually by</Text>
        <Boxes options={MODES as any} value={mode} onChange={(v) => setMode(v as any)} icons={MODE_ICONS} grow />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={styles.kicker}>Each way, up to</Text>
        <Boxes options={RANGES} value={range} onChange={setRange} grow />
        {home ? <Text style={type.small}>{count == null ? 'Counting places…' : `About ${count} places within ${reach} of ${town(home.label)}.`}</Text> : <Text style={type.small}>Set home on the step before and Epic will say how many places that reaches.</Text>}
      </View>
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      <View style={{ flex: 1 }} />
      <TextLink label="Skip" tone="grey" onPress={onNext} />
    </VoiceScreen>
  );
}

// ---------------------------------------------------------------------------
// 3 · Who's in the household? (voice) → the review
// ---------------------------------------------------------------------------

function WhoStep({ household, refresh, onNext, onBack, error, setError }: StepProps) {
  const [people, setPeople] = useState<SpokenPerson[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const read = useCallback(async (transcript: string) => {
    setBusy('Working out who’s who…'); setError(null);
    try { const r = await api.voiceHouseholdWho({ transcript }); setPeople(r.people); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }, [setError]);
  const speech = useSpeech({ onFinal: (t) => { void read(t); }, confirm: false });
  useEffect(() => { if (speech.error) setError(speech.error); }, [speech.error, setError]);
  const listening = speech.phase === 'listening';

  const justMe = async () => {
    setBusy('Saving…');
    try {
      if (!household?.members.length) await api.voiceHouseholdWhoApply({ people: [{ name: 'Me', role: 'adult', age: null, relationship: 'self', isSpeaker: true }] });
      await refresh(); onNext();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  // --- O3b: the review ------------------------------------------------------
  if (people) {
    const save = async () => {
      setBusy('Saving…');
      try { await api.voiceHouseholdWhoApply({ people }); await refresh(); onNext(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
    };
    const update = (i: number, patch: Partial<SpokenPerson>) => setPeople(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    return (
      <VoiceScreen footer={<PrimaryCta label="Next · food" onPress={save} busy={!!busy} />}>
        <VoiceHeader onBack={() => setPeople(null)} right={<Progress step={3} of={5} />} title="Your household" sub="Tap a name to fix anything." />
        <View>
          {people.map((p, i) => {
            const complete = p.role === 'adult' || p.age != null || p.band;
            const editing = false;
            return (
              <View key={i} style={styles.personRow}>
                <View style={[styles.tile, complete ? { backgroundColor: colors.selected } : null]}><Text style={styles.tileText}>{p.name[0]?.toUpperCase()}</Text></View>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <TextInput value={p.name} onChangeText={(name) => update(i, { name })} style={styles.nameInput} accessibilityLabel="Name" />
                  <Text style={type.small}>{p.role === 'child' ? (p.age != null ? `Child · ${p.age}` : p.band ? `Child · ${p.band}` : 'Child · how old?') : p.role === 'adult' ? `Adult${p.isSpeaker ? ' · you' : ''}` : 'Grown-up or child?'}</Text>
                  {!p.role ? <Boxes options={[{ value: 'adult', label: 'Adult' }, { value: 'child', label: 'Child' }]} value={null} onChange={(v) => update(i, { role: v as any })} /> : null}
                  {p.role === 'child' && p.age == null ? <Boxes options={BANDS.map((b) => ({ value: b, label: b.replace('-', '–') }))} value={p.band ?? null} onChange={(band) => update(i, { band })} /> : null}
                </View>
                <Press onPress={() => setPeople(people.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} hitSlop={8}><Icon name="close" size={16} color={colors.inkMuted} /></Press>
                {editing ? null : null}
              </View>
            );
          })}
        </View>
        <TextLink label="+ Add someone" onPress={() => setPeople([...people, { name: '', role: null, age: null, relationship: null, isSpeaker: false }])} />
        {busy ? <StatusLine>{busy}</StatusLine> : null}
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      </VoiceScreen>
    );
  }

  // --- O3: the breath ---------------------------------------------------------
  return (
    <VoiceScreen scroll={false}>
      <VoiceHeader onBack={onBack} right={<Progress step={3} of={5} />} title="Who’s in the household?" sub="Say everyone in one go — names, and whether they’re grown-ups or kids." big />
      {household?.members.length ? <Text style={type.small}>Already here: {household.members.map((m) => m.name).join(', ')}. Say them again to change anything, or add to them.</Text> : null}
      {listening || speech.phase === 'transcribing'
        ? <Captions committed={speech.live?.committed ?? (speech.mode === 'browser' ? speech.transcript : '')} partial={speech.live?.partial ?? ''} paused={speech.paused} placeholder={speech.mode === 'record' || speech.mode === 'stream' ? 'Recording…' : ''} />
        : typing ? <SentenceField value={text} onChange={setText} onSubmit={() => text.trim() && read(text.trim())} placeholder="It’s me, Sam, my partner Jo, and the kids…" /> : <View style={{ minHeight: 80 }} />}
      <View style={{ flex: 1 }} />
      {busy ? <StatusLine>{busy}</StatusLine> : null}
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {!listening ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextLink label="Just me" tone="grey" onPress={justMe} />
          {typing ? <TextLink label="Send" icon="forward" onPress={() => text.trim() && read(text.trim())} /> : <TextLink label="Type" icon="keyboard" tone="grey" onPress={() => setTyping(true)} />}
        </View>
      ) : null}
      <MicControl state={busy || speech.phase === 'transcribing' ? 'busy' : listening ? (speech.paused ? 'paused' : 'listening') : 'idle'} onStart={() => { setTyping(false); void speech.start(); }} onPause={speech.pause} onResume={speech.resume} onDone={() => { void speech.stop(); }} canPause={speech.canPause} label={null} />
      {listening ? <Text style={styles.timer}>{clock(speech.seconds)}</Text> : null}
    </VoiceScreen>
  );
}

// ---------------------------------------------------------------------------
// 4 · Food (voice)
// ---------------------------------------------------------------------------

function FoodStep({ household, refresh, onNext, onBack, error, setError }: StepProps) {
  const [items, setItems] = useState<SpokenFood[]>([]);
  const [heard, setHeard] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const read = useCallback(async (transcript: string) => {
    setBusy('Reading that…'); setError(null);
    try { const r = await api.voiceHouseholdFood({ transcript }); setItems((cur) => [...cur, ...r.items]); setHeard(true); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }, [setError]);
  const speech = useSpeech({ onFinal: (t) => { void read(t); }, confirm: false });
  useEffect(() => { if (speech.error) setError(speech.error); }, [speech.error, setError]);
  const listening = speech.phase === 'listening';
  const save = async () => {
    if (!items.length) { onNext(); return; }
    setBusy('Saving…');
    try { await api.voiceHouseholdApply({ food: items }); await refresh(); onNext(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  return (
    <VoiceScreen scroll={false} footer={heard ? <PrimaryCta label="Next · what you like doing" onPress={save} busy={!!busy} /> : undefined}>
      <VoiceHeader onBack={onBack} right={<Progress step={4} of={5} />} title="Anything we should know about food?" sub="Diets, allergies, things you all love or hate. One breath is plenty." big />
      {listening || speech.phase === 'transcribing'
        ? <Captions committed={speech.live?.committed ?? (speech.mode === 'browser' ? speech.transcript : '')} partial={speech.live?.partial ?? ''} paused={speech.paused} placeholder={speech.mode === 'record' || speech.mode === 'stream' ? 'Recording…' : ''} />
        : typing ? <SentenceField value={text} onChange={setText} onSubmit={() => text.trim() && read(text.trim())} placeholder="We’re all vegetarian, Priya’s allergic to nuts…" /> : null}
      <FoodChips items={items} onRemove={(i) => setItems(items.filter((_, j) => j !== i))} />
      {items.some((i) => i.kind === 'allergy') ? <Text style={type.tiny}>Allergies are health data. We keep the label to filter restaurants; the recording is deleted once read.</Text> : null}
      <View style={{ flex: 1 }} />
      {busy ? <StatusLine>{busy}</StatusLine> : null}
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {!listening ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextLink label="Nothing to add" tone="grey" onPress={onNext} />
          {typing ? <TextLink label="Send" icon="forward" onPress={() => text.trim() && read(text.trim())} /> : <TextLink label="Type" icon="keyboard" tone="grey" onPress={() => setTyping(true)} />}
        </View>
      ) : null}
      <MicControl state={busy || speech.phase === 'transcribing' ? 'busy' : listening ? (speech.paused ? 'paused' : 'listening') : 'idle'} onStart={() => { setTyping(false); void speech.start(); }} onPause={speech.pause} onResume={speech.resume} onDone={() => { void speech.stop(); }} canPause={speech.canPause} label={null} />
      {listening ? <Text style={styles.timer}>{clock(speech.seconds)}</Text> : null}
    </VoiceScreen>
  );
}

export function FoodChips({ items, onRemove }: { items: SpokenFood[]; onRemove?: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map((it, i) => {
        const who = it.memberName ?? 'everyone';
        const label = it.kind === 'allergy' ? `${who} · ${it.value} · allergy` : it.kind === 'dislike' ? `${who} · no ${it.value}` : it.kind === 'favourite' ? `${who} · loves ${it.value}` : `${cap(it.value)} · ${who}`;
        return <FactChip key={i} label={label} look={it.kind === 'allergy' ? 'allergy' : 'said'} small onPress={onRemove ? () => onRemove(i) : undefined} />;
      })}
    </View>
  );
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------------------
// 5 · What do you all like doing? (voice)
// ---------------------------------------------------------------------------

function LikesStep({ household, refresh, onNext, onBack, error, setError }: StepProps) {
  const [items, setItems] = useState<SpokenLike[]>([]);
  const [heard, setHeard] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const read = useCallback(async (transcript: string) => {
    setBusy('Reading that…'); setError(null);
    try { const r = await api.voiceHouseholdLikes({ transcript }); setItems((cur) => [...cur, ...r.items]); setHeard(true); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }, [setError]);
  const speech = useSpeech({ onFinal: (t) => { void read(t); }, confirm: false });
  useEffect(() => { if (speech.error) setError(speech.error); }, [speech.error, setError]);
  const listening = speech.phase === 'listening';
  const save = async () => {
    if (!items.length) { onNext(); return; }
    setBusy('Saving…');
    try { await api.voiceHouseholdApply({ likes: items }); await refresh(); onNext(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  return (
    <VoiceScreen scroll={false} footer={heard ? <PrimaryCta label="That’s it" onPress={save} busy={!!busy} /> : undefined}>
      <VoiceHeader onBack={onBack} right={<Progress step={5} of={5} />} title="What do you all like doing?" sub="Free speak — sporty, active, culture, favourites, anything you avoid. Name people if it’s just them." big />
      {listening || speech.phase === 'transcribing'
        ? <Captions committed={speech.live?.committed ?? (speech.mode === 'browser' ? speech.transcript : '')} partial={speech.live?.partial ?? ''} paused={speech.paused} placeholder={speech.mode === 'record' || speech.mode === 'stream' ? 'Recording…' : ''} />
        : typing ? <SentenceField value={text} onChange={setText} onSubmit={() => text.trim() && read(text.trim())} placeholder="We like walks and cycling, the kids are into climbing…" /> : null}
      <LikeChips items={items} onRemove={(i) => setItems(items.filter((_, j) => j !== i))} />
      {items.length ? <Text style={type.tiny}>Anything unnamed applies to everyone. Struck-through = things to avoid.</Text> : null}
      <View style={{ flex: 1 }} />
      {busy ? <StatusLine>{busy}</StatusLine> : null}
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {!listening ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <TextLink label="Skip" tone="grey" onPress={onNext} />
          {typing ? <TextLink label="Send" icon="forward" onPress={() => text.trim() && read(text.trim())} /> : <TextLink label="Type" icon="keyboard" tone="grey" onPress={() => setTyping(true)} />}
        </View>
      ) : null}
      <MicControl state={busy || speech.phase === 'transcribing' ? 'busy' : listening ? (speech.paused ? 'paused' : 'listening') : 'idle'} onStart={() => { setTyping(false); void speech.start(); }} onPause={speech.pause} onResume={speech.resume} onDone={() => { void speech.stop(); }} canPause={speech.canPause} label={null} />
      {listening ? <Text style={styles.timer}>{clock(speech.seconds)}</Text> : null}
    </VoiceScreen>
  );
}

export function LikeChips({ items, onRemove }: { items: SpokenLike[]; onRemove?: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map((it, i) => {
        const who = it.memberName ?? 'everyone';
        const label = `${who} · ${it.label ?? it.phrase}`;
        return <FactChip key={i} label={label} look={it.kind === 'avoid' ? 'avoid' : 'said'} small onPress={onRemove ? () => onRemove(i) : undefined} />;
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

function DoneStep({ household, startedAt, onPlan, onLook, onBack }: { household: HouseholdResponse | null; startedAt: number; onPlan: () => void; onLook: () => void; onBack: () => void }) {
  const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const h = household?.household;
  const members = household?.members ?? [];
  const MODE_WORDS: Record<string, string> = { driving: 'Car', transit: 'Train & bus', walking: 'On foot', cycling: 'Bike' };
  const modeLabel = h?.travelMode ? MODE_WORDS[h.travelMode] ?? null : null;
  const range = h?.maxTravelMinutes ? (h.maxTravelMinutes < 60 ? `${h.maxTravelMinutes} min` : `${Math.round(h.maxTravelMinutes / 60)} hr`) : null;
  const first = (m: Member) => m.name.split(/\s+/)[0];
  const diets = uniq(members.flatMap((m) => m.diets.map((d) => `${cap(d.value)} · ${first(m)}`)));
  const allergies = members.flatMap((m) => m.allergens.map((a) => `${first(m)} · ${a.value}`));
  const dislikes = members.flatMap((m) => m.dislikes.filter((d) => d.conceptKind !== 'experience').map((d) => `${first(m)} · no ${d.value}`));
  const loves = uniq(members.flatMap((m) => m.likes.filter((l) => l.conceptKind === 'experience').map((l) => `${first(m)} · ${l.value}`)));
  const avoids = uniq(members.flatMap((m) => m.dislikes.filter((d) => d.conceptKind === 'experience').map((d) => `${first(m)} · ${d.value}`)));
  return (
    <VoiceScreen>
      <VoiceHeader onBack={onBack} right={<Text style={styles.timer}>{Math.floor(secs / 60)} min {String(secs % 60).padStart(2, '0')}</Text>} title="That’s it — we’ll stop asking" sub="Every plan starts from this. Change any of it in Household or Settings." />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {h?.home ? <FactChip label={town(h.home.label)} icon="home" look="profile" /> : null}
        {modeLabel || range ? <FactChip label={[modeLabel, range ? `up to ${range}` : null].filter(Boolean).join(' · ')} icon="driving" look="profile" /> : null}
        {members.length ? <FactChip label={members.map((m) => (m.age != null && m.isMinor ? `${first(m)} ${m.age}` : first(m))).join(', ')} icon="household" look="profile" /> : null}
      </View>
      {diets.length || allergies.length || dislikes.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {diets.map((d) => <FactChip key={d} label={d} look="profile" small />)}
          {allergies.map((a) => <FactChip key={a} label={a} look="allergy" small />)}
          {dislikes.map((d) => <FactChip key={d} label={d} look="profile" small />)}
        </View>
      ) : null}
      {loves.length || avoids.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {loves.map((l) => <FactChip key={l} label={l} look="profile" small />)}
          {avoids.map((a) => <FactChip key={a} label={a} look="avoid" small />)}
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <PrimaryCta label="Plan something now" onPress={onPlan} />
      <View style={{ alignItems: 'center' }}><TextLink label="Have a look around first" tone="grey" onPress={onLook} /></View>
    </VoiceScreen>
  );
}
const uniq = (xs: string[]) => [...new Set(xs)];

const styles = {
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.88, textTransform: 'uppercase' as const, color: colors.inkMuted },
  timer: { fontSize: 12, fontWeight: '600' as const, color: colors.inkMuted, textAlign: 'center' as const },
  personRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  tile: { width: 40, height: 40, backgroundColor: colors.warm, alignItems: 'center' as const, justifyContent: 'center' as const },
  tileText: { fontFamily: fonts.heading, fontWeight: '800' as const, fontSize: 16, color: colors.ink },
  nameInput: { fontSize: 16, fontWeight: '600' as const, color: colors.ink, padding: 0 },
};

export type { Member };
