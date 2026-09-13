/**
 * "Just say what you are up for" — the intake (Casual meet ups, O1–O6, O11).
 *
 * The order is the product. Voice, once: six things in one breath, not six
 * trips through a form. Then chips you confirm — we extract the facts and show
 * them, so nobody proof-reads a transcript. Then silence: nothing is listed,
 * nobody can search for you, and no profile page exists. There is no date, no
 * price, no cap, no venue and no listing, because most meetups are not events
 * yet — they are interests, and there is nothing to cancel.
 *
 * One intake serves both sides. A household at home says what it is up for
 * standing, and is asked again in three months; a household on a trip says
 * what it is up for there, and it clears when the trip ends. Only the scope
 * and the copy differ.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, OpenEntry, OpenHome, OpenLanguage, Trip } from '../../api';
import { colors, INK, LIME } from '../../theme';
import { Icon } from '../../components/Icon';
import { StatusLine } from '../../components/ui';
import { useSpeech } from '../../hooks/useSpeech';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import {
  Aside, ChoiceChip, Cta, DoneBlock, FactChip, InfoRow, Nav, Progress, RedNote, SaidChip, k, t,
} from '../../components/hostKit';

const TOP = (Platform.OS === 'web' ? 'max(8px, var(--epic-sat))' : 8) as any;
/** What was heard, held between the listening and the chips. Nothing is saved until it is confirmed. */
const DRAFT = 'epic.open.heard';
type Draft = { interests: string[]; level: string[]; when: string[]; languages: string[]; transcript: string };
const loadDraft = (): Draft | null => { try { const v = sessionStorage.getItem(DRAFT); return v ? JSON.parse(v) : null; } catch { return null; } };
const saveDraft = (d: Draft | null) => { try { if (d) sessionStorage.setItem(DRAFT, JSON.stringify(d)); else sessionStorage.removeItem(DRAFT); } catch { /* a private window */ } };

const count = (n: number) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** Where a trip is, in the words the trip already holds — never asked again here. */
const placeOf = (trip: Trip | null) => trip?.place?.label ?? trip?.destination?.label ?? trip?.title ?? null;
/**
 * Who is already being asked, on the card. A count and the shared thing, never
 * a list and never a name: "Three people in Lisbon are up for chess". Before
 * anybody has been asked it says what will happen instead of nothing.
 */
const asked = (entry: OpenEntry | null, where: string) => {
  const n = entry?.asked ?? 0;
  const thing = entry?.interests[0]?.toLowerCase();
  if (!n) return `People in ${where} are up for the same things`;
  const who = `${count(n)[0].toUpperCase()}${count(n).slice(1)} ${n === 1 ? 'person' : 'people'}`;
  return `${who} in ${where} ${n === 1 ? 'is' : 'are'} up for ${thing ?? 'the same things'}`;
};
/** The head on a trip screen: where, and when, exactly as the trip already says it. */
const tripHead = (trip: Trip | null) => [placeOf(trip), datesOf(trip)].filter(Boolean).join(' · ') || 'Your trip';
const datesOf = (trip: Trip | null) => {
  const from = trip?.startDate ?? trip?.departAt, to = trip?.endDate ?? trip?.returnAt;
  if (!from) return null;
  const day = (d: string) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return to && String(to).slice(0, 10) !== String(from).slice(0, 10) ? `${day(from)}–${day(to)}` : day(from);
};

/** The head every screen in this flow shares: a back, a title, and the 1–3 counter where there is one. */
function Head({ title, at, onBack, wide }: { title: string; at?: number; onBack: () => void; wide: boolean }) {
  return (
    <View style={[wide && k.wide, { paddingTop: TOP }]}>
      <Nav title={title} onBack={onBack} />
      {at ? <Progress label="What you are up for" at={at} of={3} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// O1 — the fork
// ---------------------------------------------------------------------------

/**
 * Define an event, or just say what you are up for. This is not a fourth
 * shape and it replaces nothing: it is the other half of meetups and mini
 * tours, for the things that are not events yet.
 */
export function ForkScreen() {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [pick, setPick] = useState<'event' | 'say'>('say');
  const options = [
    { key: 'event' as const, title: 'Define an event', line: 'A date, a place, how many, and a price if there is one. Best when you know it is happening.' },
    { key: 'say' as const, title: 'Just say what you are up for', line: 'No date, no price, nothing to cancel. We introduce you when somebody fits.' },
  ];
  return (
    <View style={k.page}>
      <Head title="Host on Epic" at={1} onBack={() => back(paths.host())} wide={wide} />
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
          <Text style={t.h25}>Meetups and mini tours</Text>
          <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>Two ways to do this. Neither is listed until you say so.</Text>
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
          {options.map((o) => {
            const on = pick === o.key;
            return (
              <Press key={o.key} onPress={() => setPick(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.option, on && styles.optionOn]}>
                <View style={{ flex: 1 }}>
                  <Text style={t.h17}>{o.title}</Text>
                  <Text style={[t.tiny, { lineHeight: 17, marginTop: 2, color: on ? colors.accent : colors.inkMuted }]}>{o.line}</Text>
                </View>
                {on ? <View style={k.tick22}><Icon name="check" size={13} color={INK} strokeWidth={3} /></View> : null}
              </Press>
            );
          })}
          <Aside>Most meetups are not events yet. A trip to the market in six months is not a plan — it is an interest.</Aside>
        </View>
      </ScrollView>
      <View style={wide ? k.wide : undefined}>
        <Cta
          label={pick === 'say' ? 'Next · say what you are up for' : 'Next · define an event'}
          onPress={() => navigate(pick === 'say' ? paths.openSay() : paths.hostNewOffer('oneoff'))}
          style={{ paddingBottom: 14 }}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// O2 — listening, and O5 — the same intake from a trip
// ---------------------------------------------------------------------------

/**
 * One breath, as many things as you like. Nothing is saved until it has been
 * seen written down, so the recording goes straight to the chips and the
 * transcript is never something the person has to read back.
 */
export function ListeningScreen({ tripId }: { tripId: string | null }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  useEffect(() => { if (tripId) api.trip(tripId).then((r) => setTrip(r.trip)).catch(() => setTrip(null)); }, [tripId]);

  const heard = useCallback(async (transcript: string) => {
    const words = transcript.trim();
    if (!words) return;
    setBusy(true);
    try {
      const r = await api.openHeard(words);
      saveDraft({ ...r.heard, transcript: words });
      navigate(paths.openHeard(tripId), { replace: true });
    } catch (e: any) {
      // Without the listener there is still a way through: what was typed becomes the chips.
      saveDraft({ interests: words.split(/,| and |\n/).map((s) => s.trim()).filter(Boolean).slice(0, 12), level: [], when: [], languages: [], transcript: words });
      setSaid(e.message);
      navigate(paths.openHeard(tripId), { replace: true });
    } finally { setBusy(false); }
  }, [navigate, tripId]);

  const speech = useSpeech({ onFinal: heard, confirm: false });
  const where = placeOf(trip);
  const title = tripId ? `What are you up for${where ? ` in ${where}` : ''}?` : 'What are you up for?';
  const listening = speech.listening;

  return (
    <View style={k.page}>
      <Head title={tripId ? (trip ? `${trip.title}` : 'Your trip') : 'Host on Epic'} at={tripId ? undefined : 2} onBack={() => back(tripId ? paths.openTrip(tripId) : paths.open())} wide={wide} />
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]} keyboardShouldPersistTaps="handled">
        <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
          <Text style={t.h25}>{title}</Text>
          {tripId ? <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>We will introduce you to people who are up for the same.</Text> : null}
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
          {listening ? (
            <View style={styles.listening}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <View style={[k.tile34, k.ink]}><Icon name="mic" size={17} color={LIME} strokeWidth={2} /></View>
                <Text style={[t.h21, { fontSize: 19, lineHeight: 22, color: INK }]}>Listening…</Text>
                <Text style={[t.label, { marginLeft: 'auto', color: colors.onLime }]}>{clock(speech.seconds)}</Text>
              </View>
              <Text style={[t.body, { fontSize: 15, lineHeight: 22, color: INK }]}>{speech.transcript || speech.interim || 'Say the things you would do with other people.'}</Text>
            </View>
          ) : (
            <Press onPress={() => speech.start()} accessibilityRole="button" style={styles.tapToSay}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[k.tile44, k.lime]}><Icon name="mic" size={20} color={INK} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[t.h18, { letterSpacing: -0.45 }]}>Tap and just say it</Text>
                  <Text style={[t.tiny, { marginTop: 1 }]}>One go, as many things as you like.</Text>
                </View>
              </View>
              <View style={styles.tryBlock}>
                <Text style={[t.sub, { lineHeight: 20 }]}><Text style={[t.strong, { color: colors.ink }]}>Try: </Text>“chess, a skate park, and anyone who walks the beach and likes nature”</Text>
              </View>
            </Press>
          )}

          {listening ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {speech.canPause ? (
                <Press onPress={() => (speech.paused ? speech.resume() : speech.pause())} accessibilityRole="button" style={[styles.halfBtn, { borderWidth: 1, borderColor: colors.line }]}>
                  <Text style={[t.body, { fontWeight: '700' }]}>{speech.paused ? 'Resume' : 'Pause'}</Text>
                </Press>
              ) : null}
              <Press onPress={() => speech.stop()} accessibilityRole="button" style={[styles.halfBtn, k.ink]}>
                <Text style={[t.body, { fontWeight: '700', color: colors.primaryFg }]}>Done</Text>
              </Press>
            </View>
          ) : null}

          {typing ? (
            <View style={{ gap: 8 }}>
              <TextInput value={text} onChangeText={setText} multiline autoFocus placeholder="Chess, a skate park, walks on the beach…" placeholderTextColor={colors.ghost}
                style={[k.field, t.input, { minHeight: 96, lineHeight: 22, textAlignVertical: 'top' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
              <Press onPress={() => void heard(text)} disabled={busy || !text.trim()} accessibilityRole="button" style={[styles.halfBtn, k.ink, (busy || !text.trim()) && { opacity: 0.6 }]}>
                <Text style={[t.body, { fontWeight: '700', color: colors.primaryFg }]}>{busy ? 'Reading it…' : 'Done'}</Text>
              </Press>
            </View>
          ) : (
            <Press onPress={() => { if (listening) speech.cancel(); setTyping(true); }} accessibilityRole="button"><Text style={[t.link, { fontSize: 13 }]}>Type instead</Text></Press>
          )}

          {speech.error ? <StatusLine tone="warn">{speech.error}</StatusLine> : null}
          {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
          <Aside>{tripId ? 'Grey is from the trip. You do not have to repeat where you are or when.' : 'One breath, six things. Nothing is saved until you have seen it written down.'}</Aside>
        </View>
      </ScrollView>
    </View>
  );
}

/** O5 — the trip's own intake: the trip's facts are already known, so they are not asked again. */
export function TripIntakeScreen({ tripId }: { tripId: string }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [going, setGoing] = useState(0);
  useEffect(() => {
    api.trip(tripId).then((r) => { setTrip(r.trip); setGoing(r.attendees.length); }).catch(() => setTrip(null));
  }, [tripId]);
  const where = placeOf(trip) ?? 'here';
  // Everything grey here is already on the trip: where, when, how many of you,
  // and whether there is a car. None of it is asked again.
  const chips = [
    where,
    datesOf(trip),
    going > 1 ? `${count(going)[0].toUpperCase()}${count(going).slice(1)} of us` : going === 1 ? 'On my own' : null,
    trip?.hasCar === false ? 'No car' : null,
  ].filter(Boolean) as string[];
  return (
    <View style={k.page}>
      <Head title={tripHead(trip)} onBack={() => back(paths.trips())} wide={wide} />
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
          <Text style={t.h25}>What are you up for in {where}?</Text>
          <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>We will introduce you to people who are up for the same.</Text>
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{chips.map((c) => <FactChip key={c} label={c} />)}</View>
          <Press onPress={() => navigate(paths.openSay(tripId))} accessibilityRole="button" style={styles.tapToSay}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[k.tile44, k.lime]}><Icon name="mic" size={20} color={INK} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[t.h18, { letterSpacing: -0.45 }]}>Tap and just say it</Text>
                <Text style={[t.tiny, { marginTop: 1 }]}>One go, as many things as you like.</Text>
              </View>
            </View>
            <View style={styles.tryBlock}>
              <Text style={[t.sub, { lineHeight: 20 }]}><Text style={[t.strong, { color: colors.ink }]}>Try: </Text>“chess, a skate park, and anyone who walks the beach and likes nature”</Text>
            </View>
          </Press>
          <Press onPress={() => navigate(paths.openSay(tripId))} accessibilityRole="button"><Text style={[t.link, { fontSize: 13 }]}>Type instead</Text></Press>
          <Aside>Grey is from the trip. You do not have to repeat where you are or when.</Aside>
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// O3 — here is what we heard
// ---------------------------------------------------------------------------

/**
 * The key screen. Lime is what you said and comes off with a tap; grey is from
 * your profile or the trip and taps to change. The facts sit in a two-column
 * grid precisely so a new fact can be added later without two unrelated labels
 * being merged into one — it is not collapsed back to a single column.
 */
export function HeardScreen({ tripId }: { tripId: string | null }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [draft, setDraft] = useState<Draft | null>(() => loadDraft());
  const [home, setHome] = useState<OpenHome | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => { api.openHome().then(setHome).catch(() => setHome(null)); }, []);
  useEffect(() => { if (tripId) api.trip(tripId).then((r) => setTrip(r.trip)).catch(() => setTrip(null)); }, [tripId]);

  const entry = home?.entries.find((e) => (tripId ? e.tripId === tripId : e.scope === 'standing')) ?? null;
  const interests = draft?.interests ?? [];
  const level = draft?.level ?? [];
  const when = draft?.when.length ? draft.when : entry?.when ?? [];
  const where = tripId ? [placeOf(trip)].filter(Boolean) as string[] : [home?.you.home, home?.you.miles ? `${home.you.miles} miles` : null].filter(Boolean) as string[];
  const languages: OpenLanguage[] = (draft?.languages.length ? draft.languages.map((n) => ({ name: n, level: 'fluent' as const })) : entry?.languages ?? []);
  const prefs = entry?.prefs ?? { age: 'any' as const, company: ['anyone'], fluency: 'some' as const };
  const whoChips = [tripId ? 'Locals' : 'Visitors', prefs.age === 'similar' ? 'A similar age' : 'Any age', ...(prefs.company.includes('anyone') ? ['Anyone'] : prefs.company.map((c) => c[0].toUpperCase() + c.slice(1)))];

  const drop = (from: 'interests' | 'level', word: string) => setDraft((d) => (d ? { ...d, [from]: d[from].filter((x) => x !== word) } : d));

  const save = async () => {
    if (!interests.length) { setSaid('Say at least one thing you are up for.'); return; }
    setBusy(true);
    try {
      await api.saveOpen({
        scope: tripId ? 'trip' : 'standing', tripId, interests, level, when,
        where: where[0] ?? null, miles: home?.you.miles ?? null, languages,
        transcript: draft?.transcript ?? null,
      });
      saveDraft(null);
      navigate(tripId ? paths.openTripCard(tripId) : paths.openSaved(), { replace: true });
    } catch (e: any) { setSaid(e.message); } finally { setBusy(false); }
  };

  if (!draft) {
    return (
      <View style={k.page}>
        <Head title="Host on Epic" onBack={() => back(paths.open())} wide={wide} />
        <View style={[k.gutter, { paddingTop: 24, gap: 12 }]}>
          <Text style={t.h24}>Nothing heard yet</Text>
          <Cta label="Say what you are up for" onPress={() => navigate(paths.openSay(tripId), { replace: true })} style={{ paddingHorizontal: 0 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={k.page}>
      <Head title={tripId ? trip?.title ?? 'Your trip' : 'Host on Epic'} at={tripId ? undefined : 3} onBack={() => back(paths.openSay(tripId))} wide={wide} />
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
          <Text style={t.h25}>Here is what we heard</Text>
          <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>Lime is what you said. Grey is from your profile — tap to change.</Text>
        </View>
        <View style={[k.gutter, { paddingTop: 12, gap: 10 }]}>
          <View style={{ gap: 7 }}>
            <Text style={[t.label, { fontSize: 12.5 }]}>What you are up for</Text>
            <View style={styles.chipWrap}>{interests.map((i) => <SaidChip key={i} label={i} onRemove={() => drop('interests', i)} />)}</View>
          </View>
          {level.length ? (
            <View style={{ gap: 7 }}>
              <Text style={[t.label, { fontSize: 12.5 }]}>How it goes</Text>
              <View style={styles.chipWrap}>{level.map((i) => <SaidChip key={i} label={i} onRemove={() => drop('level', i)} />)}</View>
            </View>
          ) : null}

          {/* The facts, two columns, so another can be added without merging two labels into one. */}
          <View style={styles.grid}>
            <Fact label="Roughly when" chips={when.length ? when : ['Whenever']} />
            <Fact label="Roughly where" chips={where.length ? where : ['Near home']} />
            <Fact label={tripId ? 'Who I would like to meet' : 'Who you would meet'} chips={whoChips} span onChange={() => navigate(paths.openWho(tripId))} />
            <Fact label="Language" chips={languages.length ? languages.map((l) => (l.level === 'some' ? `${l.name}, a bit` : l.name)) : ['English']} />
            <Fact label="Money" chips={['Free']} />
          </View>
          {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
        </View>
      </ScrollView>
      <View style={wide ? k.wide : undefined}>
        <Cta lime label="Save what I am up for" loading={busy} onPress={() => void save()} style={{ paddingBottom: 14 }} />
      </View>
    </View>
  );
}

function Fact({ label, chips, span, onChange }: { label: string; chips: string[]; span?: boolean; onChange?: () => void }) {
  return (
    <View style={[{ gap: 6, minWidth: 0 }, span ? styles.gridSpan : styles.gridCell]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <Text style={[t.label, { fontSize: 12.5 }]}>{label}</Text>
        {onChange ? <Press onPress={onChange} accessibilityRole="button"><Text style={[t.link, { fontSize: 11.5 }]}>Change ›</Text></Press> : null}
      </View>
      <View style={[styles.chipWrap, { gap: 5 }]}>{chips.map((c) => <FactChip key={c} label={c} />)}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// O4 and O6 — the card, once it is saved
// ---------------------------------------------------------------------------

/** O4 — standing. Nothing is listed, nobody can search for you, and we ask again in three months. */
export function SavedScreen({ tripId }: { tripId: string | null }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [home, setHome] = useState<OpenHome | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  useEffect(() => { api.openHome().then(setHome).catch(() => setHome(null)); }, []);
  useEffect(() => { if (tripId) api.trip(tripId).then((r) => setTrip(r.trip)).catch(() => setTrip(null)); }, [tripId]);
  const entry = home?.entries.find((e) => (tripId ? e.tripId === tripId : e.scope === 'standing')) ?? null;
  const where = tripId ? placeOf(trip) ?? 'there' : entry?.where ?? 'here';
  const n = entry?.interests.length ?? 0;

  if (tripId) {
    return (
      <View style={k.page}>
        <Head title={tripHead(trip)} onBack={() => back(paths.trips())} wide={wide} />
        <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
          <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h25}>Up for {count(n)} {n === 1 ? 'thing' : 'things'} in {where}</Text></View>
          <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
            <View style={styles.chipWrap}>{(entry?.interests ?? []).map((i) => <SaidChip key={i} label={i} />)}</View>
            {entry?.level.length ? <View style={{ gap: 7 }}><Text style={[t.label, { fontSize: 12.5 }]}>How it goes</Text><View style={styles.chipWrap}>{entry.level.map((i) => <SaidChip key={i} label={i} />)}</View></View> : null}
            {entry?.languages.length ? <View style={{ gap: 7 }}><Text style={[t.label, { fontSize: 12.5 }]}>Language</Text><View style={styles.chipWrap}>{entry.languages.map((l) => <FactChip key={l.name} label={l.level === 'some' ? `${l.name}, a bit` : l.name} />)}</View></View> : null}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Text style={[t.label, { fontSize: 12.5 }]}>Who I would like to meet</Text>
                <Press onPress={() => navigate(paths.openWho(tripId))} accessibilityRole="button"><Text style={[t.link, { fontSize: 11.5 }]}>Change ›</Text></Press>
              </View>
              <View style={[styles.chipWrap, { gap: 5 }]}>{['Locals', entry?.prefs.age === 'similar' ? 'A similar age' : 'Any age', ...(entry?.prefs.company.includes('anyone') ? ['Anyone'] : (entry?.prefs.company ?? []).map((c) => c[0].toUpperCase() + c.slice(1)))].map((c) => <FactChip key={c} label={c} />)}</View>
            </View>
            <Text style={t.kicker}>While you are there</Text>
            <View>
              <InfoRow icon="household" title={asked(entry, where)} line="We ask them first. You will hear back, not before." />
              <InfoRow icon="calendar" title="This clears when the trip ends" line="Your standing interests stay on your profile." />
            </View>
          </View>
        </ScrollView>
        <View style={wide ? k.wide : undefined}><Cta label="Done" onPress={() => navigate(paths.trips(), { replace: true })} style={{ paddingBottom: 14 }} /></View>
      </View>
    );
  }

  return (
    <View style={k.page}>
      <Head title="Host on Epic" onBack={() => back(paths.host())} wide={wide} />
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 16 }]}>
          <DoneBlock title={`You are up for ${count(n)} ${n === 1 ? 'thing' : 'things'}`} line="Nothing is listed. Nobody can search for you." />
        </View>
        <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
          <Text style={t.kicker}>What you said</Text>
          <View style={styles.chipWrap}>{(entry?.interests ?? []).map((i) => <SaidChip key={i} label={i} />)}</View>
          <Text style={t.kicker}>What happens now</Text>
          <View>
            <InfoRow icon="household" title="We introduce you when somebody fits" line={`Someone visiting ${where} who is up for the same thing. We ask you first.`} />
            <InfoRow icon="locked" title="Nothing is shared until you say yes" line="No name, no photograph, no contact — not even that you exist." />
            <InfoRow icon="calendar" title="We ask again in three months" line="Still up for these? One tap to keep them, one to change them." />
          </View>
        </View>
      </ScrollView>
      <View style={wide ? k.wide : undefined}><Cta label="Done" onPress={() => navigate(paths.host(), { replace: true })} style={{ paddingBottom: 14 }} /></View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// O11 — who you would rather meet
// ---------------------------------------------------------------------------

/**
 * Age, company and language, and nothing else — never ethnicity, religion or
 * nationality, and never anything about a child. What is picked here is never
 * shown to anybody, and it has to fit both ways, so it cannot be used to hunt.
 */
export function WhoScreen({ tripId }: { tripId: string | null }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { back } = useRouter();
  const [home, setHome] = useState<OpenHome | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const load = useCallback(() => { api.openHome().then(setHome).catch(() => setHome(null)); }, []);
  useEffect(() => { load(); }, [load]);
  const entry: OpenEntry | null = home?.entries.find((e) => (tripId ? e.tripId === tripId : e.scope === 'standing')) ?? null;
  const [age, setAge] = useState<'any' | 'similar'>('any');
  const [company, setCompany] = useState<string[]>(['anyone']);
  const [fluency, setFluency] = useState<'fluent' | 'some'>('some');
  useEffect(() => { if (entry) { setAge(entry.prefs.age); setCompany(entry.prefs.company.length ? entry.prefs.company : ['anyone']); setFluency(entry.prefs.fluency); } }, [entry?.id]);

  const speaks = entry?.languages ?? [];
  const first = speaks[0]?.name ?? 'English';
  const spoken = speaks.length
    ? `You speak ${speaks.map((l) => (l.level === 'some' ? `a bit of ${l.name}` : l.name)).join(', and ')}`
    : 'The language on your profile';
  const toggleCompany = (c: string) => {
    if (c === 'anyone') { setCompany(['anyone']); return; }
    const next = new Set(company.filter((x) => x !== 'anyone'));
    if (next.has(c)) next.delete(c); else next.add(c);
    setCompany(next.size ? [...next] : ['anyone']);
  };
  const cannot = company.filter((c) => c === 'women' || c === 'men');

  const save = async () => {
    if (!entry) { back(paths.openHeard(tripId)); return; }
    setBusy(true);
    try { await api.openWho(entry.id, { age, company, fluency }); back(tripId ? paths.openTripCard(tripId) : paths.openHeard(tripId)); }
    catch (e: any) { setSaid(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={k.page}>
      <Head title="What you are up for" onBack={() => back(paths.openHeard(tripId))} wide={wide} />
      <ScrollView contentContainerStyle={[styles.scroll, wide && k.wide]}>
        <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
          <Text style={t.h25}>Who you would rather meet</Text>
          <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>This only changes who we introduce you to. It is never shown to anybody.</Text>
        </View>
        <View style={[k.gutter, { paddingTop: 13, gap: 11 }]}>
          <View style={{ gap: 7 }}>
            <Text style={t.label}>Age</Text>
            <View style={styles.chipWrap}>
              <ChoiceChip label="Any age" on={age === 'any'} onPress={() => setAge('any')} />
              <ChoiceChip label="A similar age" on={age === 'similar'} onPress={() => setAge('similar')} />
            </View>
          </View>

          <View style={{ gap: 7 }}>
            <Text style={t.label}>Company</Text>
            <View style={styles.chipWrap}>
              {['anyone', 'women', 'men', 'couples', 'families'].map((c) => (
                <ChoiceChip key={c} label={c[0].toUpperCase() + c.slice(1)} on={company.includes(c)} onPress={() => toggleCompany(c)} />
              ))}
            </View>
            <Text style={[t.tiny, { lineHeight: 17 }]}>Pick as many as fit. Leaving it on Anyone is the default.</Text>
            {/* Epic holds no record of anybody's sex, so it says so rather than implying it filtered. */}
            {cannot.length ? <Text style={[t.tiny, { lineHeight: 17, color: colors.accent }]}>Epic does not record anybody's sex, so {cannot.join(' and ')} cannot decide an introduction yet. It changes nothing else you picked.</Text> : null}
          </View>

          <View style={{ gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={t.label}>Language</Text>
              <Text style={t.tiny}>{spoken}</Text>
            </View>
            <Text style={[t.small, { lineHeight: 18, marginTop: -1 }]}>You are only ever introduced to somebody you share a language with. The question is how well.</Text>
            <View style={styles.chipWrap}>
              <ChoiceChip label={`Fluent in ${first}`} on={fluency === 'fluent'} onPress={() => setFluency('fluent')} />
              <ChoiceChip label={`Some ${first} is fine`} on={fluency === 'some'} onPress={() => setFluency('some')} />
            </View>
            <Text style={[t.tiny, { lineHeight: 17 }]}>For chess it hardly matters. For a walk where the talking is the point, it does — so the introduction says how well they speak it.</Text>
          </View>

          <Aside>
            <Text style={[t.strong, { color: colors.ink }]}>Nobody is told what you picked</Text> — not the people we introduce you to, and not the ones we do not. <Text style={[t.strong, { color: colors.ink }]}>It has to fit both ways</Text>: we only make the introduction if what they said about company fits you too.
          </Aside>
          <RedNote>Age, company and language, and nothing else. Never ethnicity, religion or nationality — a shared language is about being able to talk, it is symmetric, and it says nothing about where anybody is from. And never anything about a child.</RedNote>
          {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
        </View>
      </ScrollView>
      <View style={wide ? k.wide : undefined}><Cta lime label="Save" loading={busy} onPress={() => void save()} style={{ paddingBottom: 14 }} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 16 },
  option: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 13, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  optionOn: { padding: 12, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  listening: { backgroundColor: LIME, paddingVertical: 16, paddingHorizontal: 18, gap: 10 },
  tapToSay: { borderWidth: 2, borderColor: colors.line, padding: 16, gap: 11 },
  tryBlock: { backgroundColor: colors.warm, paddingVertical: 11, paddingHorizontal: 12 },
  halfBtn: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, rowGap: 11 },
  gridCell: { width: '47%', flexGrow: 1 },
  gridSpan: { width: '100%' },
});
