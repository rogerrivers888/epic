/**
 * Setting an offer up: one question per screen, drawn to the prototype
 * (`Epic Host prototype.dc.html`, 13 Sep 2026 — "the behaviour spec"; README
 * §2–3). Owner, the same day: "mirror them exactly to the pixel … pay
 * attention also to spacing and font size".
 *
 * Three independent axes decide which questions are asked:
 *
 *   shape       oneoff · series · anytime    what "when" looks like
 *   visibility  invite · link · public       whether we need identity, a video,
 *                                             evidence and an age gate
 *   money       free · direct · epic         whether there is a price, a
 *                                             minimum, a refund rule, a payout
 *
 *   plan → vis → event → [weeks] → numbers | invite → money → [price]
 *        → [basics, kind, [subdetail], video, extract, checks, [evidence]] → done
 *
 * The sequence comes from the API (`offer.steps`), so the progress bar is
 * honest for every combination and nothing hard-codes a total. The primary
 * button reads "Next · <the next step>" and "Make it epic" only when nothing
 * follows. Every field saves as it is left. Each step opens at the top.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, CheckKind, HostHome, LocalKind, Money, OfferInput, OwnOffer, Place, Visibility } from '../../api';
import { colors, INK, LIME } from '../../theme';
import { StatusLine } from '../../components/ui';
import { Icon, IconName } from '../../components/Icon';
import { DateRangePicker } from '../../components/DateRangePicker';
import { Wheel, slots, timeLabel } from '../../components/TimePicker';
import { BirthdayPicker, birthdayWords } from '../../components/BirthdayPicker';
import { VideoHero } from '../../components/hosting';
import { useViewport } from '../../hooks/useViewport';
import { useQueryState, useRouter } from '../../router';
import { paths } from '../../routes';
import { pickPhotoBlob } from '../../components/pickPhoto';
import { dayShort, money as pounds, weekdayName } from '../../components/hosting';
import { Bullet, CheckBox, Cta, Field, Input, Nav, PickChip, Picker, PlaceField, Progress, Segments, Tick, UnitBox, Weekdays, k, t } from '../../components/hostKit';
import { KindChooser } from './ProfileScreen';

/** What each step is called on the button that leads to it, and in the progress line. */
const LABEL: Record<string, string> = { plan: 'what we need', vis: 'who can come', event: 'what it is', weeks: 'the run', invite: 'who is invited', numbers: 'how many', money: 'money', price: 'price', basics: 'about you', kind: 'what kind of host', subdetail: 'the detail', video: 'tell us what you do', extract: 'your listing', checks: 'what backs it up', evidence: 'the details', done: 'done' };
const TITLE: Record<string, string> = { basics: 'About you', kind: 'What kind of host', vis: 'Who can come', video: 'Tell us what you do', extract: 'Your listing', checks: 'What backs it up', evidence: 'The details', subdetail: 'The detail', weeks: 'The run', event: 'What it is, and when', invite: 'Who is invited', numbers: 'How many', price: 'Price', money: 'Money' };
const pence = (s: string) => (s.trim() === '' ? null : Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100) || null);
const num = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.round(Number(s.replace(/[^0-9]/g, '')))) || null);
const str = (n?: number | null) => (n == null ? '' : String(n));
const pnds = (p?: number | null) => (p == null ? '' : String(p / 100));
const dmy = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const TOP = (Platform.OS === 'web' ? 'max(8px, var(--epic-sat))' : 8) as any;

type Save = (b: OfferInput) => Promise<OwnOffer | null>;

export function OfferWizard({ offerId, home, onChanged }: { offerId: string; home: HostHome | null; onChanged: () => Promise<void> }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [stepQ, setStepQ] = useQueryState<string | null>('step', null, { read: (r) => r || null, write: (v) => v || null });
  const [offer, setOffer] = useState<OwnOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try { setOffer((await api.hostOffer(offerId)).offer); setError(null); } catch (e: any) { setError(e.message); }
  }, [offerId]);
  useEffect(() => { void load(); }, [load]);

  /** Every change is a PATCH; the answer is the whole offer, sequence included. */
  const save: Save = useCallback(async (body) => {
    try { const r = await api.updateOffer(offerId, body); setOffer(r.offer); setError(null); return r.offer; }
    catch (e: any) { setError(e.message); return null; }
  }, [offerId]);

  const steps = offer?.steps ?? ['plan'];
  const step = stepQ && steps.includes(stepQ) ? stepQ : 'plan';
  // Each step opens at the top: set the container, never scrollIntoView (fault 2).
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  const go = (s: string) => { setError(null); setStepQ(s === 'plan' ? null : s, { replace: false }); };
  const at = steps.indexOf(step);
  const nextStep = steps[at + 1] ?? null;
  const flow = steps.filter((s) => s !== 'plan' && s !== 'done');
  const cur = flow.indexOf(step) + 1;

  if (error && !offer) return <View style={[k.page, k.gutter, { paddingTop: 24, gap: 12 }]}><Text style={t.h24}>Not one of yours</Text><Text style={t.sub}>{error}</Text><Cta quiet label="Back to hosting" onPress={() => navigate(paths.host(), { replace: true })} style={{ paddingHorizontal: 0 }} /></View>;
  if (!offer) return <View style={[k.page, k.gutter, { paddingTop: 24 }]}><Text style={t.sub}>Opening…</Text></View>;
  const o = offer;

  const publish = async () => {
    setBusy(true); setError(null);
    try { const r = await api.submitOffer(offerId); setOffer(r.offer); await onChanged(); go('done'); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const forward = () => {
    if (!nextStep) return;
    if (nextStep === 'done') { if (o.state === 'draft') void publish(); else go('done'); return; }
    go(nextStep);
  };
  const cta = step === 'done' ? null : !nextStep || nextStep === 'done' ? (o.state === 'draft' ? 'Make it epic' : 'Save') : `Next · ${LABEL[nextStep] ?? nextStep}`;

  return (
    <View style={k.page}>
      <View style={[wide && k.wide, { paddingTop: TOP }]}>
        <Nav title={step === 'done' ? 'All set' : 'Host on Epic'} onBack={() => (at > 0 ? go(steps[at - 1]) : back(paths.host()))} />
        {cur > 0 ? <Progress label={TITLE[step] ?? ''} at={cur} of={flow.length} /> : null}
      </View>
      <ScrollView ref={scroller} contentContainerStyle={[styles.scroll, wide && k.wide]} keyboardShouldPersistTaps="handled">
        {step === 'plan' ? <Plan /> : null}
        {step === 'vis' ? <Vis offer={o} save={save} /> : null}
        {step === 'event' ? <EventStep offer={o} save={save} onSeeded={setOffer} /> : null}
        {step === 'weeks' ? <Weeks offer={o} save={save} /> : null}
        {step === 'numbers' ? <Numbers offer={o} save={save} /> : null}
        {step === 'invite' ? <Invite offer={o} setOffer={setOffer} setError={setError} /> : null}
        {step === 'money' ? <MoneyStep offer={o} save={save} /> : null}
        {step === 'price' ? <Price offer={o} save={save} /> : null}
        {step === 'basics' ? <Basics home={home} onChanged={onChanged} /> : null}
        {step === 'kind' ? <Kind home={home} onChanged={onChanged} save={save} /> : null}
        {step === 'subdetail' ? <SubDetail offer={o} save={save} sub={home?.host?.localKind ?? 'already_do'} /> : null}
        {step === 'video' ? <VideoStep offer={o} onRecord={() => navigate(paths.hostVideo(o.id))} /> : null}
        {step === 'extract' ? <Extract offer={o} save={save} setOffer={setOffer} setError={setError} /> : null}
        {step === 'checks' ? <Checks offer={o} save={save} kind={home?.host?.type ?? 'skill'} town={home?.host?.location ?? null} /> : null}
        {step === 'evidence' ? <EvidenceStep offer={o} home={home} onChanged={onChanged} /> : null}
        {step === 'done' ? <Done offer={o} /> : null}
        {error ? <View style={[k.gutter, { paddingTop: 12 }]}><StatusLine tone="warn">{error}</StatusLine></View> : null}
      </ScrollView>
      {cta ? (
        <View style={wide ? k.wide : undefined}>
          <Cta label={cta} icon={cta === 'Make it epic' ? 'check' : undefined} loading={busy} onPress={forward} sub={cta === 'Make it epic' && o.blockers.length ? o.blockers[0] : null} style={{ paddingBottom: (Platform.OS === 'web' ? 'max(10px, var(--epic-sab))' : 10) as any }} />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// plan — "Here is what we need" (H3 · shared · all three lanes)
// ---------------------------------------------------------------------------

function Plan() {
  const groups = [
    { h: 'Everyone', lime: false, rows: [['1', 'Who can come', 'Invite-only, a link, or anyone on Epic.'], ['2', 'What it is, and when', 'Title, place, date and how long.'], ['3', 'Who is coming', 'Names, or how many you can take.'], ['4', 'Is anyone paying', 'Free, or a price per person.']] },
    { h: 'If it is public', lime: true, rows: [['5', 'You and what you do', 'Your name, your town, and a minute of video.'], ['6', 'What backs it up', 'Only if you say you are an expert guide.']] },
  ];
  return (
    <View style={k.gutter}>
      <Text style={[t.h26, { paddingTop: 16 }]}>Here is what we need</Text>
      {groups.map((g) => (
        <View key={g.h} style={{ paddingTop: 30 }}>
          <Text style={[t.kicker, g.lime && t.kickerGreen]}>{g.h}</Text>
          {g.rows.map(([n, title, sub]) => (
            <View key={n} style={[styles.planRow, k.rule]}>
              <View style={[k.tile30, g.lime ? k.lime : k.warm]}><Text style={styles.planN}>{n}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>{title}</Text>
                <Text style={[t.small, { lineHeight: 17, marginTop: 1 }]}>{sub}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// vis — who can come
// ---------------------------------------------------------------------------

/** A card with a title, a line beneath and a green consequence; ticked when picked. */
function ChoiceCard({ on, onPress, icon, title, sub, note }: { on: boolean; onPress: () => void; icon?: IconName; title: string; sub: string; note: string }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={[k.card, on && k.cardOn]}>
      {icon ? <View style={[k.tile36, on ? k.lime : k.warm]}><Icon name={icon} size={18} color={INK} strokeWidth={2} /></View> : null}
      <View style={{ flex: 1 }}>
        <Text style={t.h17}>{title}</Text>
        <Text style={[t.small, { lineHeight: 17, marginTop: 2 }]}>{sub}</Text>
        <Text style={[t.tiny, { fontWeight: '600', color: colors.accent, marginTop: 5 }]}>{note}</Text>
      </View>
      {on ? <Tick /> : null}
    </Press>
  );
}

function Vis({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  const opts: { k: Visibility; icon: IconName; t: string; s: string; money: string }[] = [
    { k: 'invite', icon: 'locked', t: 'Only people I invite', s: 'Add names now or later. Hidden from everyone else.', money: 'No video, no ID check, no payout set-up' },
    { k: 'link', icon: 'link', t: 'Anyone with the link', s: 'One link, passed around. Not listed on Epic.', money: 'No video needed — you are splitting costs' },
    { k: 'public', icon: 'everyone', t: 'Anyone on Epic', s: 'In Inspire and Places, near people whose trip fits.', money: 'A video and an ID check · we pay you out' },
  ];
  const pub = o.visibility === 'public';
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h25}>Who can come?</Text></View>
      <View style={[k.gutter, { paddingTop: 14, gap: 9 }]}>
        {opts.map((v) => <ChoiceCard key={v.k} on={o.visibility === v.k} onPress={() => void save({ visibility: v.k })} icon={v.icon} title={v.t} sub={v.s} note={v.money} />)}
        <View style={[pub ? k.panelTint : { ...k.panelWarm, paddingVertical: 12, paddingHorizontal: 13 }, { marginTop: 2 }]}>
          <Text style={[t.small, { lineHeight: 18 }, pub && { color: colors.accent }]}>{pub ? 'It will be listed publicly, so we need a video and something that backs you up.' : 'No video and no checks. You will still say what it is, who is invited and whether anyone is paying.'}</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// event — what it is, and when
// ---------------------------------------------------------------------------

/** A time in the prototype's field, opening the wheel beneath it. */
function TimeBox({ value, onChange, placeholder = 'Tap to choose', seeded, flex }: { value: string; onChange: (v: string) => void; placeholder?: string; seeded?: boolean; flex?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[flex && { flex: 1 }, { gap: 8 }]}>
      <Picker value={value ? timeLabel(value) : null} placeholder={placeholder} seeded={seeded} onPress={() => setOpen(!open)} />
      {open ? <View style={styles.wheel}><Wheel label="Time" value={value || '19:00'} options={slots(15)} onChange={onChange} /><Press onPress={() => setOpen(false)} accessibilityRole="button" style={[k.cta, { height: 44 }]}><Text style={k.ctaText}>Done</Text><Icon name="check" size={16} color={colors.primaryFg} strokeWidth={2} /></Press></View> : null}
    </View>
  );
}

function EventStep({ offer: o, save, onSeeded }: { offer: OwnOffer; save: Save; onSeeded: (o: OwnOffer) => void }) {
  const pub = o.visibility === 'public';
  const [title, setTitle] = useState(o.title ?? '');
  const [notes, setNotes] = useState(o.description ?? '');
  const [place, setPlace] = useState<Place | null>(o.venueLabel ? { label: o.venueLabel, lat: o.venueLat ?? 0, lng: o.venueLng ?? 0 } : null);
  const [openDate, setOpenDate] = useState(false);
  const [endMode, setEndMode] = useState<'end' | 'dur'>(o.endsAt || !o.durationMin ? 'end' : 'dur');
  const [dur, setDur] = useState(str(o.durationMin));
  const [endKind, setEndKind] = useState<'count' | 'date'>(o.endDate && !o.sessions ? 'date' : 'count');
  const [sessions, setSessions] = useState(str(o.sessions));
  const [openEnd, setOpenEnd] = useState(false);
  const [notice, setNotice] = useState(str(o.noticeDays ?? 2));
  const [slot, setSlot] = useState(str(o.slotMin ?? o.durationMin ?? 90));
  const [docBusy, setDocBusy] = useState(false);
  useEffect(() => { setTitle(o.title ?? ''); setNotes(o.description ?? ''); if (o.venueLabel) setPlace({ label: o.venueLabel, lat: o.venueLat ?? 0, lng: o.venueLng ?? 0 }); }, [o.seeded.join(',')]);
  const seeded = (key: string) => o.seeded.some((s) => s.endsWith(`:${key}`));

  const pickDoc = async () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/pdf';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      setDocBusy(true);
      try { const m = await api.uploadHostMedia(f, 'doc'); const r = await api.seedOfferDoc(o.id, m.id); onSeeded(r.offer); } catch { /* said by the frame */ } finally { setDocBusy(false); }
    };
    input.click();
  };
  const dropDoc = async () => { const r = await api.seedOfferDoc(o.id, null); onSeeded(r.offer); };
  const weekday = o.weekday ?? (o.firstDate ? new Date(`${o.firstDate}T12:00:00`).getDay() : null);
  const untilNote = o.dates.length ? `${o.dates.length} ${weekdayName(new Date(`${o.dates[0]}T12:00:00`).getDay())}s from ${dayShort(o.dates[0])} — the last is ${dayShort(o.dates[o.dates.length - 1])}.` : 'Give the first date and a number or an end date, and we work the other out.';

  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h24}>{o.shape === 'series' ? 'What is it, and when does it run?' : pub ? 'What is it, and when?' : 'What is the day?'}</Text></View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }]}>
        {/* The document sits at the top: what it says seeds the fields, each marked with the lime edge. */}
        <Press onPress={() => (o.doc ? void dropDoc() : void pickDoc())} accessibilityRole="button" style={[k.dashed, o.doc && k.tint]}>
          <View style={[k.tile34, o.doc ? k.lime : k.warm]}><Icon name="faq" size={17} color={INK} strokeWidth={2} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{docBusy ? 'Reading it…' : o.doc ? 'Your PDF is attached' : 'Got a PDF for guests?'}</Text>
            <Text style={[t.small, { lineHeight: 17, marginTop: 1 }]}>{o.doc ? 'Guests can download it. Tap to take it off.' : 'Upload it here — guests can download it.'}</Text>
          </View>
        </Press>

        <Field label="What is it called">
          <Input value={title} onChangeText={setTitle} onBlur={() => void save({ title })} placeholder={o.shape === 'series' ? 'Six Thursdays, learning to see' : pub ? 'Reading, as it actually was' : 'Our wedding at the barn'} seeded={seeded('title')} />
        </Field>

        {o.shape === 'oneoff' ? (
          <>
            <Field label="Date">
              <Picker value={o.startsOn ? dmy(o.startsOn) : null} placeholder="Tap to choose" trailing="calendar" seeded={seeded('startsOn')} onPress={() => setOpenDate(!openDate)} />
              {openDate ? <View style={styles.calendar}><DateRangePicker single inline start={o.startsOn} end={o.startsOn} onApply={(d) => { void save({ startsOn: d }); setOpenDate(false); }} /></View> : null}
            </Field>
            <Field label="Time" right={<Press onPress={() => setEndMode(endMode === 'end' ? 'dur' : 'end')} accessibilityRole="button"><Text style={t.link}>{endMode === 'end' ? 'Give a duration instead' : 'Give an end time instead'}</Text></Press>}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <TimeBox flex value={o.startsAt ?? ''} onChange={(v) => void save({ startsAt: v || null })} placeholder="Starts" seeded={seeded('startsAt')} />
                {endMode === 'end'
                  ? <TimeBox flex value={o.endsAt ?? ''} onChange={(v) => void save({ endsAt: v || null, durationMin: null })} placeholder="Ends" />
                  : <UnitBox fill value={dur} onChange={setDur} onCommit={() => void save({ durationMin: num(dur), endsAt: null })} unit="min" />}
              </View>
              <Text style={t.tiny}>{endMode === 'end' ? 'Guests see both — we work the duration out.' : 'Guests see both — we work the end time out.'}</Text>
            </Field>
          </>
        ) : null}

        {o.shape === 'anytime' ? (
          <>
            <Field label="Days you are free">
              <Weekdays on={(n) => (o.availability.days ?? []).includes(n)} onPress={(n) => { const days = new Set(o.availability.days ?? []); if (days.has(n)) days.delete(n); else days.add(n); void save({ availability: { days: [...days], parts: o.availability.parts ?? [] } }); }} />
            </Field>
            <Field label="When in the day">
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['morning', 'afternoon', 'evening'] as const).map((p) => { const parts = new Set(o.availability.parts ?? []); const on = parts.has(p); return <Press key={p} onPress={() => { if (on) parts.delete(p); else parts.add(p); void save({ availability: { days: o.availability.days ?? [], parts: [...parts] } }); }} accessibilityRole="button" accessibilityState={{ selected: on }} style={[k.seg, { paddingHorizontal: 0 }, on && k.segOn]}><Text style={[k.segText, on && k.segTextOn]}>{p[0].toUpperCase() + p.slice(1)}s</Text></Press>; })}
              </View>
            </Field>
            <Field label="Each booking lasts"><UnitBox value={slot} onChange={setSlot} onCommit={() => void save({ slotMin: num(slot), durationMin: num(slot) })} unit="minutes" /></Field>
            <Field label="How much notice you need" hint="Nobody can book a slot closer than this. You confirm or decline each one."><UnitBox value={notice} onChange={setNotice} onCommit={() => void save({ noticeDays: num(notice) })} unit="days" /></Field>
          </>
        ) : null}

        {o.shape === 'series' ? (
          <>
            <Field label="How often"><Segments value={o.repeatEvery} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'monthly', label: 'Monthly' }]} onPick={(v) => void save({ repeatEvery: v })} /></Field>
            <Field label="On a"><Weekdays on={(n) => weekday === n} onPress={(n) => void save({ weekday: n })} /></Field>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Field label="First one" style={{ flex: 1 }}>
                <Picker value={o.firstDate ? dmy(o.firstDate) : null} placeholder="Tap to choose" trailing="calendar" seeded={seeded('firstDate')} onPress={() => setOpenDate(!openDate)} />
              </Field>
              <Field label="Starts at" style={{ flex: 1 }}>
                <TimeBox value={o.startsAt ?? ''} onChange={(v) => void save({ startsAt: v || null })} placeholder="19:00" />
              </Field>
            </View>
            {openDate ? <View style={styles.calendar}><DateRangePicker single inline start={o.firstDate} end={o.firstDate} onApply={(d) => { void save({ firstDate: d, weekday: new Date(`${d}T12:00:00`).getDay() }); setOpenDate(false); }} /></View> : null}
            <Field label="Until" right={<Press onPress={() => setEndKind(endKind === 'count' ? 'date' : 'count')} accessibilityRole="button"><Text style={t.link}>{endKind === 'count' ? 'Give an end date instead' : 'Give a number instead'}</Text></Press>}>
              {endKind === 'count' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><UnitBox fill value={sessions} onChange={setSessions} onCommit={() => void save({ sessions: num(sessions), endDate: null })} /><Text style={[t.label, { fontWeight: '400', color: colors.inkMuted }]}>sessions</Text></View>
              ) : (
                <>
                  <Picker value={o.endDate ? dmy(o.endDate) : null} placeholder="Tap to choose" trailing="calendar" onPress={() => setOpenEnd(!openEnd)} />
                  {openEnd ? <View style={styles.calendar}><DateRangePicker single inline start={o.endDate} end={o.endDate} onApply={(d) => { void save({ endDate: d, sessions: null }); setOpenEnd(false); }} /></View> : null}
                </>
              )}
              <Text style={t.tiny}>{untilNote}</Text>
            </Field>
            <Field label="Each one lasts"><UnitBox value={dur} onChange={setDur} onCommit={() => void save({ durationMin: num(dur) })} unit="minutes" /></Field>
          </>
        ) : null}

        <Field label="Where">
          <PlaceField value={place} seeded={seeded('venueLabel')} onPick={(p: Place | null) => { setPlace(p); if (p) void save({ venueLabel: p.formatted ?? p.label, venueLat: p.lat, venueLng: p.lng, venueCountry: p.countryCode ?? null, venueArea: p.locality ?? p.address?.town ?? null }); }} placeholder="Abbey ruins, Reading" />
        </Field>
        <Field label="Anything they should know">
          <Input value={notes} onChangeText={setNotes} onBlur={() => void save({ description: notes })} multiline placeholder="Flat walking, about ninety minutes, nothing strenuous." seeded={seeded('description')} style={{ fontSize: 15, fontWeight: '400' }} />
        </Field>
        <View style={{ height: 8 }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// weeks — series only: outcome first
// ---------------------------------------------------------------------------

function Weeks({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  const [outcome, setOutcome] = useState(o.outcome ?? '');
  const [weeks, setWeeks] = useState(() => o.dates.map((_, i) => ({ n: i + 1, title: o.weeks.find((w) => w.n === i + 1)?.title ?? '' })));
  const [editing, setEditing] = useState<number | null>(null);
  const commit = (next: typeof weeks) => { setWeeks(next); void save({ weeks: next.filter((w) => w.title.trim()) }); };
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
        <Text style={t.h24}>What do they leave with?</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>This is what sells a ten-week commitment, not the weekly detail.</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 14 }]}>
        <Field label="By the end they can…">
          <Input value={outcome} onChangeText={setOutcome} onBlur={() => void save({ outcome })} multiline placeholder="Paint a landscape from life in one sitting, and know when to stop." style={{ fontSize: 15, fontWeight: '400', minHeight: 50 }} />
        </Field>
        <Field label="Do the weeks differ?" gap={8}>
          <Segments value={o.themesDiffer ? 'differ' : 'same'} options={[{ value: 'same', label: 'The same each week' }, { value: 'differ', label: 'Each week is different' }]} onPick={(v) => void save({ themesDiffer: v === 'differ' })} />
          <Text style={t.tiny}>{o.themesDiffer ? 'Name them below so people can see the arc. It also lets us say what they missed.' : 'Good for a run club or a weekly swim — no week list needed.'}</Text>
        </Field>
        {o.themesDiffer ? (
          <Field label="The weeks" hint="Leave any of them blank — guests just see the date.">
            <View>
              {weeks.map((w, i) => (
                <View key={w.n} style={[styles.weekRow, k.rule]}>
                  <Text style={styles.weekN}>WEEK {w.n}</Text>
                  {editing === i
                    ? <TextInput autoFocus value={w.title} onChangeText={(v) => setWeeks(weeks.map((x, j) => (j === i ? { ...x, title: v } : x)))} onBlur={() => { setEditing(null); commit(weeks); }} placeholder="Add a theme" placeholderTextColor={colors.ghost} style={[styles.weekText, { flex: 1, padding: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
                    : <Press onPress={() => setEditing(i)} accessibilityRole="button" style={{ flex: 1 }}><Text style={[styles.weekText, !w.title && { color: colors.ghost }]}>{w.title || 'Add a theme'}</Text></Press>}
                  <Press onPress={() => setEditing(i)} accessibilityRole="button" accessibilityLabel={`Edit week ${w.n}`} hitSlop={8}><Icon name="edit" size={14} color={colors.inkMuted} strokeWidth={2} /></Press>
                </View>
              ))}
              {!weeks.length ? <Text style={[t.small, { paddingVertical: 9 }]}>Give the run its dates first.</Text> : null}
            </View>
          </Field>
        ) : null}
        <Field label="Can people join for one week?" gap={8}>
          <Segments value={o.joinMode === 'whole' || !o.joinMode ? 'run' : 'drop'} options={[{ value: 'run', label: 'The whole run only' }, { value: 'drop', label: 'One week is fine too' }]} onPick={(v) => void save({ joinMode: v === 'run' ? 'whole' : 'both' })} />
        </Field>
        <View style={{ height: 8 }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// numbers — public only: a minimum only exists when money does
// ---------------------------------------------------------------------------

function Numbers({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  const paid = o.money !== 'free';
  const [focus, setFocus] = useState<'min' | 'expect' | 'max'>(paid ? 'min' : 'expect');
  const [min, setMin] = useState(str(o.minCount));
  const [exp, setExp] = useState(str(o.expectedCount));
  const [max, setMax] = useState(str(o.maxCount));
  const [age, setAge] = useState(str(o.ageLimit ?? 18));
  // A free offer carries no minimum, whatever an older row held.
  const commit = () => void save({ expectedCount: num(exp), maxCount: num(max), minCount: paid ? num(min) : null });
  const boxes = [...(paid ? [{ key: 'min' as const, l: 'Minimum', v: min, s: setMin }] : []), { key: 'expect' as const, l: 'Expecting', v: exp, s: setExp }, { key: 'max' as const, l: 'Maximum', v: max, s: setMax }];
  const hint = focus === 'min' ? `Under ${num(min) ?? '…'} and it is called off — everybody is told and nothing is taken.` : focus === 'expect' ? 'Just your best guess. It is not shown to anyone.' : `At ${num(max) ?? '…'} it is full and the page stops taking bookings.`;
  const restricted = o.ageLimit != null;
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h24}>Who, and how many</Text></View>
      <View style={[k.gutter, { paddingTop: 14, gap: 14 }]}>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {boxes.map((b) => {
              const on = focus === b.key;
              return (
                <View key={b.key} style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.numLabel, on && { color: colors.ink }]}>{b.l}</Text>
                  <TextInput value={b.v} onChangeText={b.s} onFocus={() => setFocus(b.key)} onBlur={commit} onSubmitEditing={commit} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus placeholder="0" placeholderTextColor={colors.ghost}
                    style={[styles.numBox, on && styles.numBoxOn, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
                </View>
              );
            })}
          </View>
          <Text style={[t.small, { lineHeight: 18, minHeight: 34 }]}>{hint}</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={t.label}>Age limit</Text>
          <Segments value={restricted ? 'min' : 'any'} options={[{ value: 'any', label: 'Anyone' }, { value: 'min', label: 'Age restricted' }]} onPick={(v) => void save({ ageLimit: v === 'any' ? null : num(age) ?? 18 })} pad={12} />
          {restricted ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 2 }}>
              <View style={{ width: '50%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
                <TextInput value={age} onChangeText={setAge} onBlur={() => void save({ ageLimit: num(age) ?? 18 })} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus style={[styles.ageBox, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
                <Text style={[t.body, { fontSize: 14, color: colors.inkMuted }]}>and over</Text>
              </View>
            </View>
          ) : null}
          <Text style={[t.small, { lineHeight: 18 }]}>{restricted ? 'We ask the age of everyone in the party at booking, and turn away anyone under it.' : 'Children welcome. Nobody is asked their age.'}</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// invite — private only
// ---------------------------------------------------------------------------

/** "Rachel Alderton, 07700 900312" → a name and a contact; the contact is whatever part carries digits or an @. */
function splitGuest(text: string): { name: string; contact: string | null } {
  const parts = text.split(/,|\bthen\b|\s{2,}/).map((s) => s.trim()).filter(Boolean);
  const contactAt = parts.findIndex((p) => /@|\d{5,}/.test(p));
  if (contactAt === -1) return { name: text.trim(), contact: null };
  return { name: parts.filter((_, i) => i !== contactAt).join(' ').trim(), contact: parts[contactAt] };
}

function Invite({ offer: o, setOffer, setError }: { offer: OwnOffer; setOffer: (o: OwnOffer) => void; setError: (e: string | null) => void }) {
  const [mode, setMode] = useState<'contacts' | 'typed'>('typed');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const heads = o.invites.reduce((n, i) => n + (i.rsvp === 'no' ? 0 : i.rsvpHeads ?? i.heads), 0);
  const add = async () => {
    const g = splitGuest(text);
    if (!g.name) return;
    setBusy(true);
    try { const r = await api.addInvites(o.id, [{ name: g.name, contact: g.contact, heads: 1 }]); setOffer(r.offer); setText(''); setError(null); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const pickContacts = async () => {
    const nav: any = (globalThis as any).navigator;
    if (!nav?.contacts?.select) { setMode('typed'); setError('This browser cannot open your contacts. Type the names instead.'); return; }
    try {
      const picked = await nav.contacts.select(['name', 'tel', 'email'], { multiple: true });
      const rows = picked.map((c: any) => ({ name: c.name?.[0] ?? '', contact: c.tel?.[0] ?? c.email?.[0] ?? null, heads: 1 })).filter((c: any) => c.name);
      if (rows.length) { const r = await api.addInvites(o.id, rows); setOffer(r.offer); }
    } catch (e: any) { setError(e.message); }
  };
  const typed = mode === 'typed';
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
        <Text style={t.h24}>Who is invited?</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted }]}>Only these people can open it.</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 11 }]}>
        <View style={{ flexDirection: 'row' }}>
          <Press onPress={() => { setMode('contacts'); void pickContacts(); }} accessibilityRole="button" style={[styles.inviteTab, !typed && k.lime]}><Text style={[styles.inviteTabText, !typed && { color: INK }]}>From my contacts</Text></Press>
          <Press onPress={() => setMode('typed')} accessibilityRole="button" style={[styles.inviteTab, typed && k.lime]}><Text style={[styles.inviteTabText, typed && { color: INK }]}>Type names</Text></Press>
        </View>
        {typed ? (
          <View style={{ gap: 7 }}>
            <Input value={text} onChangeText={setText} onSubmitEditing={() => void add()} placeholder="Name, then a mobile or an email" autoCapitalize="words" style={{ fontSize: 15.5 }} />
            <Press onPress={() => void add()} disabled={busy || !text.trim()} accessibilityRole="button" style={[styles.addThem, (busy || !text.trim()) && { opacity: 0.6 }]}><Icon name="add" size={16} color={INK} strokeWidth={2.4} /><Text style={[t.body, { fontSize: 14, fontWeight: '700', color: INK }]}>Add them</Text></Press>
          </View>
        ) : null}
        <View>
          {o.invites.map((i) => (
            <View key={i.id} style={[styles.guest, k.rule]}>
              <View style={[styles.guestFace]}><Text style={[t.label, { color: INK }]}>{i.name[0]?.toUpperCase()}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[t.body, { fontWeight: '600', lineHeight: 18 }]}>{i.name}</Text>
                <Text style={t.tiny}>{[i.contact, i.heads > 1 ? `${i.heads} people` : null, i.rsvp === 'yes' ? `yes · ${i.rsvpHeads ?? i.heads} coming` : i.rsvp === 'no' ? 'no' : i.sentAt ? 'asked' : null].filter(Boolean).join(' · ') || 'Not sent yet'}</Text>
              </View>
              <Press onPress={async () => { try { const r = await api.removeInvite(o.id, i.id); setOffer(r.offer); } catch (e: any) { setError(e.message); } }} accessibilityRole="checkbox" accessibilityState={{ checked: true }} accessibilityLabel={`Remove ${i.name}`} hitSlop={8}><CheckBox on size={22} /></Press>
            </View>
          ))}
        </View>
        <View style={[k.panelTint, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <Text style={[t.label, { fontWeight: '400', color: colors.accent }]}>Inviting</Text>
          <Text style={t.label}>{heads} {heads === 1 ? 'person' : 'people'}</Text>
        </View>
        <Text style={[t.small, { lineHeight: 18 }]}>They get a text with a link — no account, no password. They tap yes or no and say how many they are bringing.{o.invites.some((i) => !i.sentAt && i.contact) ? ' Invitations go out when you publish.' : ''}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// money — both paths
// ---------------------------------------------------------------------------

function MoneyStep({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  const pub = o.visibility === 'public';
  const opts: { k: Money; t: string; s: string; note: string }[] = pub
    ? [{ k: 'free', t: 'No, it is free', s: 'Nothing to collect, nothing to pay out.', note: 'No bank details needed' }, { k: 'epic', t: 'Yes — Epic collects', s: 'We charge the guest and pay you three days after it runs.', note: 'Stripe set-up, once' }]
    : [{ k: 'free', t: 'No, it is free', s: 'A wedding, a christening, a day out with friends.', note: 'Nothing else to set up' }, { k: 'direct', t: 'They pay me directly', s: 'However you normally do it. We chase who has not paid.', note: 'No bank details needed' }, { k: 'epic', t: 'Epic collects and pays me out', s: 'For anything you are out of pocket on up front.', note: 'Stripe set-up, once' }];
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
        <Text style={t.h24}>Is anyone paying?</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 18 }]}>{pub ? 'Public things are always paid through Epic, so we can hold the money until it runs.' : 'Private things can be free, or split between whoever is coming.'}</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 9 }]}>
        {opts.map((m) => <ChoiceCard key={m.k} on={o.money === m.k} onPress={() => void save({ money: m.k })} title={m.t} sub={m.s} note={m.note} />)}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// price — only when money ≠ free. Per person only.
// ---------------------------------------------------------------------------

function Price({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  const [amount, setAmount] = useState(pnds(o.pricePence));
  const [total, setTotal] = useState(pnds(o.totalPence));
  const [min, setMin] = useState(str(o.minCount));
  const byNumbers = o.priceMode === 'by_numbers';
  const epic = o.money === 'epic';
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h24}>How much, per person</Text></View>
      <View style={[k.gutter, { paddingTop: 14, gap: 14 }]}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[{ key: 'same_each' as const, t: 'Same each', s: 'One price, whoever comes' }, { key: 'by_numbers' as const, t: 'Depends on numbers', s: 'Cheaper the more there are' }].map((p) => {
            const on = o.priceMode === p.key;
            return (
              <Press key={p.key} onPress={() => void save({ priceMode: p.key })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.modeTile, on && k.segOn]}>
                <Text style={[t.body, { fontSize: 14, fontWeight: '700', lineHeight: 17, textAlign: 'center' }, on && { color: colors.primaryFg }]}>{p.t}</Text>
                <Text style={[t.tiny, { fontSize: 11, lineHeight: 14, textAlign: 'center' }, on && { color: colors.mutedOnInk }]}>{p.s}</Text>
              </Press>
            );
          })}
        </View>
        <Field label={byNumbers ? 'The whole thing costs' : 'Each person pays'}>
          {byNumbers
            ? <UnitBox big prefix="£" value={total} onChange={setTotal} onCommit={() => void save({ totalPence: pence(total), per: 'person' })} width={130} />
            : <UnitBox big prefix="£" value={amount} onChange={setAmount} onCommit={() => void save({ pricePence: pence(amount), per: 'person' })} width={130} />}
          <Text style={[t.small, { lineHeight: 18 }]}>{byNumbers ? 'The most anyone pays is the total split by the minimum. We work the rest out from how many come and refund the difference.' : 'What every guest pays. A household booking three places pays three times this.'}</Text>
        </Field>
        {/* A minimum only exists when money does; if the numbers step asked it already, it is not asked twice (Codex, 13 Sep 2026). */}
        {o.minCount == null || o.visibility !== 'public' ? (
          <Field label="Fewest it can run with" hint={num(min) ? `Under ${num(min)} and it is called off — everybody is told and nothing is taken.` : 'Leave it empty and it runs whoever books.'}>
            <UnitBox value={min} onChange={setMin} onCommit={() => void save({ minCount: num(min) })} unit="people" />
          </Field>
        ) : null}
        {epic ? (
          <View style={{ gap: 7 }}>
            <Text style={t.label}>If they cancel</Text>
            {([['24h', 'Full refund up to 24 hours before'], ['7d', 'Full refund up to 7 days before'], ['none', 'No refunds']] as const).map(([key, label]) => {
              const on = o.refundRule === key;
              return <Press key={key} onPress={() => void save({ refundRule: key })} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.radioRow, k.rule]}><View style={[styles.radio, on && styles.radioOn]} /><Text style={[t.body, { fontSize: 14, fontWeight: '600', flex: 1 }]}>{label}</Text></Press>;
            })}
          </View>
        ) : null}
        <View style={k.panelWarm}>
          <Text style={[t.small, { lineHeight: 18 }]}>{epic ? <><Text style={[t.strong, { color: colors.ink }]}>Epic collects, pays you out</Text> three working days after it runs. Guests see one all-in price.</> : 'You collect it however you normally do. We show everyone what they owe and tick them off as you confirm.'}</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// basics / kind / subdetail — public only
// ---------------------------------------------------------------------------

function Basics({ home, onChanged }: { home: HostHome | null; onChanged: () => Promise<void> }) {
  const h = home?.host ?? null;
  const [name, setName] = useState(h?.name ?? home?.you?.name ?? '');
  const [place, setPlace] = useState<Place | null>(h?.location ? { label: h.location, lat: h.lat ?? 0, lng: h.lng ?? 0 } : null);
  const [address, setAddress] = useState(h?.address ?? '');
  const [showAddr, setShowAddr] = useState(Boolean(h?.address));
  const [openDob, setOpenDob] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // The host arrives after the step has drawn: the fields follow it.
  useEffect(() => { if (h) { setName(h.name); setAddress(h.address ?? ''); setShowAddr(Boolean(h.address)); if (h.location) setPlace({ label: h.location, lat: h.lat ?? 0, lng: h.lng ?? 0 }); } }, [h?.id, h?.name, h?.location, h?.address]);
  const save = async (patch: Parameters<typeof api.updateHost>[0]) => { try { await api.updateHost(patch); await onChanged(); setSaid(null); } catch (e: any) { setSaid(e.message); } };
  return (
    <View style={[k.gutter, { paddingTop: 18, gap: 16 }]}>
      <Text style={t.h24}>About you</Text>
      <Field label="Your name, as they will see it"><Input value={name} onChangeText={setName} onBlur={() => void save({ name: name.trim() })} placeholder="Jay Alderton" /></Field>
      <Field label="Where you host">
        <PlaceField value={place} kind="area" onPick={(p: Place | null) => { setPlace(p); if (p) void save({ locationLabel: p.locality ?? p.label, lat: p.lat, lng: p.lng, countryCode: p.countryCode ?? null }); }} placeholder="Reading" />
        <Press onPress={() => setShowAddr(!showAddr)} accessibilityRole="button"><Text style={t.link}>{showAddr ? 'It is just the town' : 'It happens at a particular address ›'}</Text></Press>
        {showAddr ? <Input value={address} onChangeText={setAddress} onBlur={() => void save({ address: address.trim() || null })} placeholder="Street and number, or the park gate" /> : null}
      </Field>
      <Field label="Date of birth" hint="Hosts are eighteen or over. Never shown to guests.">
        {openDob || !h?.dateOfBirth
          ? <BirthdayPicker value={h?.dateOfBirth ?? null} onChange={(iso) => { void save({ dateOfBirth: iso }); setOpenDob(false); }} clearable={false} minAge={18} label="" />
          : <Picker value={birthdayWords(h.dateOfBirth)} placeholder="Tap to choose" trailing="calendar" onPress={() => setOpenDob(true)} />}
      </Field>
      {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
    </View>
  );
}

function Kind({ home, onChanged, save }: { home: HostHome | null; onChanged: () => Promise<void>; save: Save }) {
  const h = home?.host ?? null;
  const set = async (patch: Parameters<typeof api.updateHost>[0]) => { await api.updateHost(patch); await onChanged(); await save({}); };
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h25}>Which sounds most like you?</Text></View>
      <View style={[k.gutter, { paddingTop: 14 }]}>
        <KindChooser kind={h?.type ?? null} sub={h?.localKind ?? null} onKind={(kind) => void set({ type: kind, localKind: kind === 'meetups' ? h?.localKind ?? null : null })} onSub={(s) => void set({ type: 'meetups', localKind: s })} />
      </View>
    </View>
  );
}

type Group = { h: string; chips?: string[]; field?: string; note?: string; key: string; multi?: boolean };
const SUBS: Record<LocalKind, { t: string; s: string; bucket: 'family' | 'night' | 'already' | 'neighbourhood'; g: Group[]; rt: string; r: string[] }> = {
  family: {
    t: 'About your family', s: 'Families are matched to families — never an adult to somebody else’s child.', bucket: 'family',
    g: [{ key: 'ageBands', h: 'How old are your children', chips: ['Under 5', '5–8', '9–12', '13+'], multi: true, note: 'Ages only. We never show a child’s name or photograph.' },
      { key: 'interests', h: 'What they are into', chips: ['Playgrounds', 'Animals', 'Swimming', 'Building things', 'Football', 'Museums'], multi: true },
      { key: 'matchAges', h: 'Ages you are happy to meet', chips: ['Within a year', 'Within two years', 'Any age'], note: 'We match on age and interests. We do not offer matching by a child’s sex, and we do not let anyone search for it.' },
      { key: 'notes', h: 'Anything else worth knowing', field: 'Buggy-friendly, one of ours is autistic, we are usually out by three…' }],
    rt: 'How family hosting works',
    r: ['Daytime only, and always in a public place — a park, a beach, soft play, a café.', 'Both families are there the whole time. Never one adult and another family’s child.', 'Both adults are ID-checked before anything is listed.', 'Messages stay between the adults, in Epic. No contact with a child.', 'It is free. Anyone charging for time with children is not doing this.'],
  },
  night_out: {
    t: 'About the night', s: 'Over-18s, named venues, and never one-to-one.', bucket: 'night',
    g: [{ key: 'kinds', h: 'What kind of night', chips: ['Pubs', 'Live music', 'Comedy', 'Clubbing', 'Food and drinks', 'Quiz'], multi: true },
      { key: 'venues', h: 'Which venues, by name', field: 'The Retreat, then Purple Turtle — we finish at the kebab place', note: 'Guests see the list before they book, and we post it publicly.' },
      { key: 'minGroup', h: 'Smallest group you will run it with', chips: ['3', '4', '6'], note: 'Below three it does not run. This is not a one-to-one.' },
      { key: 'endTime', h: 'What time it ends', field: '23:30' }],
    rt: 'How nights out work',
    r: ['Everyone is 18 or over, checked at booking.', 'Minimum of three guests. A night out never runs one-to-one.', 'Named public venues only — no private addresses.', 'A published end time, and a “we have finished” tap that tells us it went fine.', 'Report anything from any screen. We read every one.'],
  },
  already_do: {
    t: 'What are they joining?', s: 'Say the actual thing, so nobody turns up expecting something else.', bucket: 'already',
    g: [{ key: 'what', h: 'What it is', chips: ['A run', 'A swim', 'A skate', 'A market trip', 'A cycle', 'A walk'], multi: true },
      { key: 'route', h: 'Where you meet, and where you finish', field: 'Meet at the Abbey gate, finish at the lock café' },
      { key: 'difficulty', h: 'How hard is it', chips: ['Anyone can do it', 'Reasonably fit', 'You need to know how'], note: 'This is the one people get wrong. Be honest.' },
      { key: 'bring', h: 'What they need to bring', field: 'Your own board and a helmet. Nothing else.' }],
    rt: 'The rules',
    r: ['You are not teaching it, so do not describe it as a lesson.', 'Public places, and a meeting point anyone can find.', 'Say plainly if it is not for beginners.'],
  },
  neighbourhood: {
    t: 'What is the route?', s: 'A walk round a neighbourhood is still a plan — say where it goes.', bucket: 'neighbourhood',
    g: [{ key: 'what', h: 'What it is', chips: ['A walk', 'A food crawl', 'A market', 'The parks', 'Shops and makers'], multi: true },
      { key: 'route', h: 'Where it starts and ends', field: 'Start at the station, finish at the Saturday market' },
      { key: 'stops', h: 'Three or four stops on the way', field: 'The old prison wall, the bakery on Union St, the canal bridge' },
      { key: 'gettingAround', h: 'Getting around', chips: ['On foot', 'On bikes', 'Bus and walk'], multi: true, note: 'Say if there are steps, hills or no loos.' },
      { key: 'access', h: 'Access notes', field: 'Two flights of steps at the bridge; loos at the market only' }],
    rt: 'The rules',
    r: ['No commentary on monuments or museums in cities that reserve it for licensed guides — we will tell you if yours is one.', 'Public routes only.', 'Give a real finish time.'],
  },
};

function SubDetail({ offer: o, save, sub }: { offer: OwnOffer; save: Save; sub: LocalKind }) {
  const d = SUBS[sub];
  const held: Record<string, any> = (o.subDetail as any)[d.bucket] ?? {};
  const [local, setLocal] = useState<Record<string, any>>(held);
  const write = (next: Record<string, any>) => { setLocal(next); void save({ subDetail: { ...o.subDetail, [d.bucket]: next } as any }); };
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
        <Text style={t.h24}>{d.t}</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>{d.s}</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 14 }]}>
        {d.g.map((g) => (
          <Field key={g.key} label={g.h} hint={g.note} gap={8}>
            {g.chips ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -2 }}>
                {g.chips.map((c) => {
                  const val = g.key === 'minGroup' ? Number(c) : c;
                  const on = g.multi ? (local[g.key] ?? []).includes(c) : local[g.key] === val;
                  return <PickChip key={c} label={c} on={on} onPress={() => write({ ...local, [g.key]: g.multi ? (on ? (local[g.key] ?? []).filter((x: string) => x !== c) : [...(local[g.key] ?? []), c]) : val })} />;
                })}
              </View>
            ) : (
              <Input value={local[g.key] ?? ''} onChangeText={(v) => setLocal({ ...local, [g.key]: v })} onBlur={() => write(local)} placeholder={g.field} style={{ fontSize: 15, fontWeight: '400' }} />
            )}
          </Field>
        ))}
        <View style={[k.panelTint, { padding: 14, gap: 9 }]}>
          <Text style={[t.kicker, t.kickerGreen]}>{d.rt}</Text>
          {d.r.map((r) => <Bullet key={r} color={colors.accent}>{r}</Bullet>)}
          <Press onPress={() => void save({ rulesAccepted: !o.rulesAccepted })} accessibilityRole="checkbox" accessibilityState={{ checked: o.rulesAccepted }} style={styles.accept}>
            <CheckBox on={o.rulesAccepted} />
            <Text style={[t.small, { fontWeight: '600', color: colors.ink, lineHeight: 17, flex: 1 }]}>I have read these and they are how I will host</Text>
          </Press>
        </View>
        <View style={{ height: 8 }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// video → extract → checks → evidence
// ---------------------------------------------------------------------------

const SCRIPT = ['Say your name and where you are', 'Say what you will do together, and how long', 'Say why you know this — and who it suits'];

function VideoStep({ offer: o, onRecord }: { offer: OwnOffer; onRecord: () => void }) {
  const done = Boolean(o.video);
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 14, gap: 6 }]}>
        <Text style={t.h24}>Tell us what you do</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>Because this is public, we need to show people who you are.</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 12 }]}>
        <View style={styles.videoBox}>
          {done ? <View style={StyleSheet.absoluteFill}><VideoHero src={o.video} poster={o.photos[0] ?? null} height={250} /></View> : null}
          <View style={styles.recLabel}><Text style={[t.tiny, { fontSize: 11, fontWeight: '700', color: colors.bg, lineHeight: 13 }]}>{done ? 'Recorded' : 'Tap to record'}</Text></View>
          <View style={styles.scriptBox}>
            <Text style={styles.scriptKicker}>READ THIS, IN YOUR OWN WORDS</Text>
            {SCRIPT.map((line) => (
              <View key={line} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={[styles.scriptTick, done && k.lime]}>{done ? <Icon name="check" size={10} color={INK} strokeWidth={3.4} /> : null}</View>
                <Text style={[t.small, { color: done ? 'rgba(255,253,249,0.55)' : '#FFFFFF', fontWeight: done ? '400' : '600', lineHeight: 16 }]}>{line}</Text>
              </View>
            ))}
          </View>
          <Press onPress={onRecord} accessibilityRole="button" accessibilityLabel={done ? 'Record it again' : 'Record'} style={styles.recButton}><View style={styles.recDot} /></Press>
        </View>
      </View>
      <View style={[k.gutter, { paddingTop: 12, gap: 9 }]}>
        <Text style={[t.small, { lineHeight: 19 }]}>Thirty to sixty seconds. Re-record as often as you like — only the one you keep is uploaded.</Text>
        <View style={[k.panelWarm, k.tint]}><Text style={[t.small, { lineHeight: 18, color: colors.accent }]}>We turn what you say into a title, a summary and a description. Nothing is published until you have read them.</Text></View>
      </View>
    </View>
  );
}

function Extract({ offer: o, save, setOffer, setError }: { offer: OwnOffer; save: Save; setOffer: (o: OwnOffer) => void; setError: (e: string | null) => void }) {
  const [title, setTitle] = useState(o.title ?? '');
  const [summary, setSummary] = useState(o.summary ?? '');
  const [description, setDescription] = useState(o.description ?? '');
  const [facts, setFacts] = useState(o.facts);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const tried = useRef(false);
  useEffect(() => { setTitle(o.title ?? ''); setSummary(o.summary ?? ''); setDescription(o.description ?? ''); setFacts(o.facts); }, [o.seeded.join(','), o.facts.length]);
  const run = async (force = false) => {
    if (!o.video) { setNote('Record the video first — the listing is written from what you say.'); return; }
    setBusy(true);
    try { const r = await api.extractOffer(o.id, force); setOffer(r.offer); setNote(r.seeded.length ? null : 'Nothing new to add — what you wrote stands.'); setError(null); }
    catch (e: any) { setNote(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { if (!tried.current && o.video && !o.transcript) { tried.current = true; void run(false); } }, [o.video]);
  const from = (key: string) => o.seeded.includes(`video:${key}`);
  const commitFacts = (next: typeof facts) => { setFacts(next); void save({ facts: next }); };
  const fields: { key: 'title' | 'summary' | 'description'; l: string; v: string; set: (v: string) => void; size: number; weight: '700' | '500' | '400'; ph: string; multi?: boolean }[] = [
    { key: 'title', l: 'Your skill', v: title, set: setTitle, size: 17, weight: '700', ph: 'Reading, as it actually was' },
    { key: 'summary', l: 'The short version', v: summary, set: setSummary, size: 14, weight: '500', ph: 'Ninety minutes round the old town with a historian who has taught it for twenty years.', multi: true },
    { key: 'description', l: 'The longer one', v: description, set: setDescription, size: 13.5, weight: '400', ph: 'We start at the abbey ruins and end where the Kennet meets the Thames…', multi: true },
  ];
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 14, gap: 6 }]}>
        <Text style={t.h24}>Here is what we heard</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>{busy ? 'Listening to your video…' : 'Pulled from your video and tidied up. Change anything — guests read this, not the transcript.'}</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 13 }]}>
        {note ? <View style={k.panelWarm}><Text style={t.small}>{note}</Text></View> : null}
        {fields.map((f) => (
          <Field key={f.key} label={f.l} right={from(f.key) ? <Text style={[t.tiny, { fontSize: 11, fontWeight: '700', color: colors.accent }]}>FROM YOUR VIDEO</Text> : undefined}>
            <Input value={f.v} onChangeText={f.set} onBlur={() => void save({ [f.key]: f.v } as OfferInput)} multiline={f.multi} placeholder={f.ph} seeded={from(f.key)} style={[{ fontSize: f.size, fontWeight: f.weight, lineHeight: Math.round(f.size * 1.45), paddingHorizontal: 13, paddingVertical: 12 }, f.multi && { minHeight: 50 }]} />
          </Field>
        ))}
        <View style={{ gap: 6 }}>
          <Text style={t.label}>Facts from your video</Text>
          <View>
            {facts.map((f, i) => (
              <View key={i} style={[styles.factRow, k.rule]}>
                {editing === i
                  ? <TextInput value={f.key} onChangeText={(v) => setFacts(facts.map((x, j) => (j === i ? { ...x, key: v } : x)))} onBlur={() => commitFacts(facts)} placeholder="Fact" placeholderTextColor={colors.ghost} style={[styles.factKey, { padding: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
                  : <Text style={styles.factKey} numberOfLines={1}>{f.key || 'Fact'}</Text>}
                {editing === i
                  ? <TextInput autoFocus value={f.value} onChangeText={(v) => setFacts(facts.map((x, j) => (j === i ? { ...x, value: v } : x)))} onBlur={() => { setEditing(null); commitFacts(facts); }} placeholder="…" placeholderTextColor={colors.ghost} style={[styles.factValue, { padding: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
                  : <Press onPress={() => setEditing(i)} accessibilityRole="button" style={{ flex: 1 }}><Text style={styles.factValue}>{f.value}</Text></Press>}
                <Press onPress={() => setEditing(i)} accessibilityRole="button" accessibilityLabel="Edit" style={styles.factBtn}><Icon name="edit" size={14} color={colors.inkMuted} strokeWidth={2} /></Press>
                <Press onPress={() => commitFacts(facts.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel="Delete" style={styles.factBtn}><Icon name="close" size={14} color={colors.inkMuted} strokeWidth={2} /></Press>
              </View>
            ))}
            <Press onPress={() => { setFacts([...facts, { key: '', value: '' }]); setEditing(facts.length); }} accessibilityRole="button" style={{ paddingVertical: 9, flexDirection: 'row', gap: 6, alignItems: 'center' }}><Icon name="add" size={14} color={colors.accent} strokeWidth={2.4} /><Text style={t.link}>Add a fact</Text></Press>
          </View>
        </View>
        {o.video ? <Press onPress={() => void run(true)} disabled={busy} accessibilityRole="button" style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Icon name="refresh" size={14} color={colors.accent} strokeWidth={2} /><Text style={t.link}>{busy ? 'Listening…' : 'Listen again and rewrite'}</Text></Press> : null}
      </View>
    </View>
  );
}

const CHECK_ROWS: { k: CheckKind; t: string; s: string }[] = [
  { k: 'pub', t: 'Published on the subject', s: 'A book, a paper, a column. Link or upload.' },
  { k: 'qual', t: 'A qualification', s: 'A degree, a post, a certificate in the subject.' },
  { k: 'years', t: 'Years of doing it', s: 'Tell us how long and where; we may ask for a reference.' },
  { k: 'lic', t: 'A guiding licence', s: 'Only where the city requires one.' },
];

function Checks({ offer: o, save, kind, town }: { offer: OwnOffer; save: Save; kind: string; town: string | null }) {
  const sub = kind === 'expert' ? 'You said expert guide, so we ask to see something. It need not be a licence.' : kind === 'skill' ? 'Anything that shows you can do this. Tick what you have — none of it is required.' : 'Optional for meetups and mini tours. Tick anything you have.';
  const toggle = (key: CheckKind) => { const set = new Set(o.checks); if (set.has(key)) set.delete(key); else set.add(key); void save({ checks: [...set] }); };
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 14, gap: 6 }]}>
        <Text style={t.h24}>What backs it up?</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 19 }]}>{sub}</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 9 }]}>
        {CHECK_ROWS.map((c) => {
          const on = o.checks.includes(c.k);
          return (
            <Press key={c.k} onPress={() => toggle(c.k)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[k.card, { gap: 11, paddingVertical: 12 }, on && [k.cardOn, { paddingVertical: 11 }]]}>
              <View style={{ marginTop: 1 }}><CheckBox on={on} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{c.t}</Text>
                <Text style={[t.small, { lineHeight: 17 }]}>{c.s}</Text>
              </View>
            </Press>
          );
        })}
        <View style={[k.panelTint, { marginTop: 2 }]}><Text style={[t.small, { lineHeight: 18, color: colors.accent }]}>A licence is only asked for where the city legally requires one.{o.regulated ? ` ${o.regulated.country} does.` : town ? ` ${town} does not.` : ''}</Text></View>
      </View>
    </View>
  );
}

const EVD: Record<CheckKind, { h: string; fields: [string, string, string][]; upload: string | null }> = {
  pub: { h: 'Published on the subject', fields: [['title', 'Title', 'The name of the book, paper or column'], ['where', 'Where it appeared', 'Publisher, journal or masthead'], ['link', 'Link', 'A URL, if there is one']], upload: 'Upload a copy or a scan' },
  qual: { h: 'A qualification', fields: [['what', 'What it is', 'BA History, PGCE, Mountain Leader…'], ['awardedBy', 'Awarded by', 'University, board or institute'], ['year', 'Year', 'e.g. 2009']], upload: 'Upload the certificate' },
  years: { h: 'Years of doing it', fields: [['howLong', 'How long', 'e.g. 17 years'], ['where', 'Where, and for whom', 'Museums, schools, your own tours…'], ['refName', 'Reference · name', 'Their full name'], ['refPhone', 'Reference · phone', '07700 900000'], ['refEmail', 'Reference · email', 'name@example.com']], upload: null },
  lic: { h: 'A guiding licence', fields: [['number', 'Licence number', 'As printed on the badge'], ['issuer', 'Issued by', 'City or regional authority'], ['expires', 'Expires', 'MM/YYYY']], upload: 'Upload the licence' },
};

function EvidenceStep({ offer: o, home, onChanged }: { offer: OwnOffer; home: HostHome | null; onChanged: () => Promise<void> }) {
  const existing = home?.host?.evidence ?? [];
  const picked = o.checks;
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(picked.map((key) => [key, Object.fromEntries(Object.entries(existing.find((e) => e.kind === key)?.fields ?? {}).map(([a, b]) => [a, b ?? '']))])));
  const [said, setSaid] = useState<string | null>(null);
  const commit = async (key: CheckKind) => {
    const fields = drafts[key] ?? {};
    const have = existing.find((e) => e.kind === key);
    try { if (have) await api.updateEvidence(have.id, { fields }); else await api.addEvidence({ kind: key, offerId: o.id, fields }); await onChanged(); setSaid(null); } catch (e: any) { setSaid(e.message); }
  };
  const upload = async (key: CheckKind) => {
    const blob = await pickPhotoBlob();
    if (!blob) return;
    try { const m = await api.uploadHostMedia(blob, 'photo'); const have = existing.find((e) => e.kind === key); if (have) await api.updateEvidence(have.id, { mediaId: m.id }); else await api.addEvidence({ kind: key, offerId: o.id, fields: drafts[key] ?? {}, mediaId: m.id }); await onChanged(); } catch (e: any) { setSaid(e.message); }
  };
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16, gap: 5 }]}>
        <Text style={t.h24}>{picked.length > 1 ? 'Tell us about each one' : picked.length === 1 ? 'Tell us about it' : 'Nothing to add'}</Text>
        <Text style={[t.label, { fontWeight: '400', color: colors.inkMuted, lineHeight: 18 }]}>{picked.length > 1 ? 'For each thing you ticked. Nothing here is shown to guests.' : 'Nothing here is shown to guests — only the badge that comes from it.'}</Text>
      </View>
      <View style={[k.gutter, { paddingTop: 14, gap: 14 }]}>
        {picked.map((key) => {
          const d = EVD[key];
          const have = existing.find((e) => e.kind === key);
          return (
            <View key={key} style={{ gap: 9 }}>
              <Text style={[t.kicker, t.kickerGreen]}>{d.h}</Text>
              {d.fields.map(([fk, label, ph]) => (
                <Field key={fk} label={label}>
                  <Input value={drafts[key]?.[fk] ?? ''} onChangeText={(v) => setDrafts({ ...drafts, [key]: { ...(drafts[key] ?? {}), [fk]: v } })} onBlur={() => void commit(key)} placeholder={ph} autoCapitalize={fk.includes('mail') || fk === 'link' ? 'none' : 'sentences'} style={{ fontSize: 15.5, fontWeight: '400' }} />
                </Field>
              ))}
              {d.upload ? (
                <Press onPress={() => void upload(key)} accessibilityRole="button" style={[k.dashed, { gap: 10 }]}>
                  <View style={[k.tile30, k.warm]}><Icon name="upload" size={15} color={INK} strokeWidth={2} /></View>
                  <Text style={[t.label, { fontWeight: '600', flex: 1 }]}>{have?.media ? 'Uploaded · tap to change it' : d.upload}</Text>
                  {have?.media ? <Icon name="check" size={16} color={colors.accent} strokeWidth={2.4} /> : null}
                </Press>
              ) : null}
            </View>
          );
        })}
        {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
        <View style={{ height: 8 }} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// done
// ---------------------------------------------------------------------------

function Done({ offer: o }: { offer: OwnOffer }) {
  const { navigate } = useRouter();
  const pub = o.visibility === 'public';
  const each = o.money === 'free' ? null : pounds(o.price.each);
  const share = async () => {
    const nav: any = (globalThis as any).navigator;
    const url = typeof window !== 'undefined' ? `${window.location.origin}${paths.experience(o.id)}` : paths.experience(o.id);
    try { if (nav?.share) await nav.share({ title: o.title ?? 'On Epic', url }); else if (nav?.clipboard) await nav.clipboard.writeText(url); } catch { /* closed */ }
  };
  const rows: { icon: IconName; t: string; s: string; onPress?: () => void }[] = pub
    ? [{ icon: 'verified', t: 'We are checking what you sent', s: 'Your Checked badge appears when it clears — usually a day.' }, { icon: 'link', t: 'Share the link', s: 'Most first sessions fill from your own contacts.', onPress: () => void share() }]
    : [{ icon: 'household', t: 'Send the invitations', s: 'By name, by text or by link — only they can open it.', onPress: () => navigate(paths.hostOfferEdit(o.id, 'invite')) }, { icon: 'calendar', t: 'RSVPs come back with numbers', s: 'Yes, no, and how many they are bringing. Chased for you.' },
      ...(each ? [{ icon: 'card' as IconName, t: o.money === 'epic' ? `We collect ${each} each` : `You collect ${each} each`, s: o.money === 'epic' ? 'Charged when they say yes, paid out to you three days after.' : 'We show everyone what they owe and chase them; you tick them off as it arrives.' }] : []),
      { icon: 'address', t: 'It sits in Trips', s: 'With the travel, the stay and the rest of the weekend.' }];
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}>
        <View style={[k.limeBlock, { padding: 18, flexDirection: 'row', gap: 12, alignItems: 'center' }]}>
          <View style={[k.tile44, k.ink]}><Icon name="check" size={24} color={LIME} strokeWidth={3} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[t.h21, { color: INK }]}>{pub ? (o.state === 'live' ? 'You are live' : 'It is on its way') : 'Invitations ready'}</Text>
            <Text style={[t.small, { color: colors.onLime, marginTop: 2, lineHeight: 16 }]}>{pub ? `${o.title ?? 'Your offer'} · anyone on Epic${each ? ` · ${each} each` : ''}` : o.money === 'free' ? 'Only the people you name can see this' : `Only the people you name · ${each} each`}</Text>
          </View>
        </View>
      </View>
      <View style={[k.gutter, { paddingTop: 16, gap: 11 }]}>
        <Text style={t.kicker}>{pub ? 'Get the first few in' : 'What happens now'}</Text>
        <View style={{ marginTop: -5 }}>
          {rows.map((r) => (
            <Press key={r.t} onPress={r.onPress ?? (() => {})} disabled={!r.onPress} accessibilityRole={r.onPress ? 'button' : undefined} style={[styles.doneRow, k.rule]}>
              <View style={[k.tile30, k.tint]}><Icon name={r.icon} size={15} color={INK} strokeWidth={2} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{r.t}</Text>
                <Text style={[t.small, { lineHeight: 17 }]}>{r.s}</Text>
              </View>
            </Press>
          ))}
        </View>
        {pub ? (
          <View style={[k.panelTint, { paddingVertical: 13, paddingHorizontal: 14, gap: 9, marginTop: 4 }]}>
            <Text style={[t.h16, { fontSize: 16.5 }]}>That is one of your skills</Text>
            <Text style={[t.small, { lineHeight: 18, color: colors.accent }]}>People book the thing, not the profile — so each skill is its own listing, with its own video, its own price and its own reason you are good at it.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[{ t: 'A sourdough morning', s: 'Anytime · 3 h · £45' }, { t: 'An hour on getting the best out of AI', s: 'Anytime · online · £80' }].map((e) => (
                <View key={e.t} style={{ flex: 1, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 11 }}>
                  <Text style={[t.small, { fontWeight: '700', color: colors.ink, lineHeight: 16 }]}>{e.t}</Text>
                  <Text style={[t.tiny, { fontSize: 11.5, lineHeight: 14, marginTop: 2 }]}>{e.s}</Text>
                </View>
              ))}
            </View>
            <Text style={[t.tiny, { color: colors.accent }]}>Tom hosts both. Same person, two audiences.</Text>
            <Press onPress={() => navigate(paths.hostNewOffer())} accessibilityRole="button" style={styles.addSkill}>
              <Text style={[t.body, { fontWeight: '700', color: INK }]}>Add another skill</Text>
              <Icon name="add" size={17} color={INK} strokeWidth={2.2} />
            </Press>
          </View>
        ) : null}
        <Press onPress={() => navigate(paths.host(), { replace: true })} accessibilityRole="button" style={{ paddingTop: 4, paddingBottom: 16 }}><Text style={[t.link, { fontSize: 13 }]}>Back to hosting ›</Text></Press>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: { paddingBottom: 16 },
  planRow: { flexDirection: 'row', gap: 13, alignItems: 'center', paddingVertical: 12 },
  planN: { ...t.h16, fontSize: 14, letterSpacing: 0, lineHeight: 17 },
  planTitle: { ...t.body, fontSize: 16, fontWeight: '700', lineHeight: 20 },
  wheel: { borderWidth: 1, borderColor: colors.ruleSoft, padding: 12, gap: 10 },
  calendar: { borderWidth: 1, borderColor: colors.ruleSoft, padding: 13, marginTop: 2 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  weekN: { ...t.kicker, fontFamily: t.label.fontFamily, fontSize: 10.5, textTransform: 'none', width: 56, lineHeight: 13 },
  weekText: { ...t.body, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  numLabel: { fontFamily: t.label.fontFamily, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkMuted, lineHeight: 12 },
  numBox: { borderWidth: 1, borderColor: colors.ruleSoft, paddingVertical: 11, paddingHorizontal: 12, ...t.h21, fontSize: 20, letterSpacing: 0, lineHeight: 24, backgroundColor: colors.surface },
  numBoxOn: { borderWidth: 2, borderColor: colors.line, paddingVertical: 10, paddingHorizontal: 11 },
  ageBox: { borderWidth: 2, borderColor: colors.line, paddingVertical: 10, width: 62, textAlign: 'center', ...t.h21, fontSize: 20, letterSpacing: 0, lineHeight: 24 },
  inviteTab: { flex: 1, alignItems: 'center', paddingVertical: 11, backgroundColor: colors.warm },
  inviteTabText: { ...t.sub, fontWeight: '600', lineHeight: 17 },
  addThem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, backgroundColor: LIME },
  guest: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  guestFace: { width: 32, height: 32, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  modeTile: { flex: 1, height: 64, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 8, backgroundColor: colors.surfaceMuted },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  radio: { width: 18, height: 18, borderWidth: 1, borderColor: colors.ruleSoft },
  radioOn: { borderWidth: 6, borderColor: colors.line },
  accept: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, paddingVertical: 11, paddingHorizontal: 12, marginTop: 3 },
  videoBox: { height: 250, backgroundColor: colors.videoGround, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 16, overflow: 'hidden' },
  recLabel: { position: 'absolute', left: 12, top: 12, backgroundColor: colors.primary, paddingVertical: 4, paddingHorizontal: 8 },
  scriptBox: { position: 'absolute', left: 12, right: 12, top: 56, backgroundColor: 'rgba(32,30,29,0.82)', paddingVertical: 11, paddingHorizontal: 12, gap: 6 },
  scriptKicker: { fontFamily: t.label.fontFamily, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: LIME, lineHeight: 12 },
  scriptTick: { width: 16, height: 16, backgroundColor: 'rgba(255,253,249,0.22)', alignItems: 'center', justifyContent: 'center' },
  recButton: { width: 56, height: 56, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 20, height: 20, backgroundColor: colors.ink },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  factKey: { fontFamily: t.label.fontFamily, fontSize: 11, fontWeight: '700', letterSpacing: 0.55, textTransform: 'uppercase', color: colors.inkMuted, width: 76, lineHeight: 14 },
  factValue: { ...t.body, fontWeight: '600', lineHeight: 18, flex: 1 },
  factBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  doneRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', paddingVertical: 11 },
  addSkill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, height: 44, backgroundColor: LIME, marginTop: 2 },
});
