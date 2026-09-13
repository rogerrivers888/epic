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
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, CheckKind, HostContact, HostHome, LocalKind, Money, OfferInput, OfferInvite, OwnOffer, Place, Visibility } from '../../api';
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
import { Avatar, Bullet, CheckBox, Cta, Field, Input, Nav, PickChip, Picker, PlaceField, Segments, StatCell, Tick, UnitBox, Weekdays, k, t } from '../../components/hostKit';
import { KindChooser } from './ProfileScreen';

/** What each step is called on the button that leads to it, and in the progress line. */
const LABEL: Record<string, string> = { plan: 'what we need', vis: 'who can come', event: 'what it is', weeks: 'the run', invite: 'who is coming', numbers: 'how many', money: 'is anyone paying', basics: 'about you', kind: 'what kind of host', subdetail: 'the detail', video: 'tell us what you do', extract: 'your listing', checks: 'what backs it up', evidence: 'the details', done: 'done' };
const TITLE: Record<string, string> = { basics: 'About you', kind: 'What kind of host', vis: 'Who can come', video: 'Tell us what you do', extract: 'Your listing', checks: 'What backs it up', evidence: 'The details', subdetail: 'The detail', weeks: 'The run', event: 'What it is, and when', invite: 'Who is coming', numbers: 'How many', money: 'Is anyone paying' };
/** What the wizard's chrome shows while a step has taken it over (My Epic contacts, C2f). */
type Chrome = { title: string; cta: { label: string; lime?: boolean; onPress: () => void } | null; back: () => void } | null;
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
  // A step may take the chrome over (My Epic contacts, C2f); it hands it back when it closes or the step changes.
  const [chrome, setChrome] = useState<Chrome>(null);

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
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); setChrome(null); }, [step]);
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
  // A shared screen says both totals when the lane is private: "2 of 4 · 2 of 10 public" (lanes A and B).
  const pubFlow = (o.publicSteps ?? []).filter((s) => s !== 'plan' && s !== 'done');
  const pubCur = pubFlow.indexOf(step) + 1;
  const count = cur > 0 ? `${cur} of ${flow.length}${o.visibility !== 'public' && pubCur > 0 ? ` · ${pubCur} of ${pubFlow.length} public` : ''}` : '';
  // Coming back to "who is invited" once it is live (C2h): no progress bar, the event's name up top, Done at the foot.
  const live = step === 'invite' && (o.state === 'live' || o.state === 'paused');
  // "Make it epic" on the two screens before the branch (H2, H3 boards); "Next · <step>" after it; "Make it epic" again only when nothing follows.
  const cta = live ? 'Done' : step === 'done' ? null : step === 'plan' ? 'Make it epic' : !nextStep || nextStep === 'done' ? (o.state === 'draft' ? 'Make it epic' : 'Save') : `Next · ${LABEL[nextStep] ?? nextStep}`;

  return (
    <View style={k.page}>
      <View style={[wide && k.wide, { paddingTop: TOP }]}>
        <Nav title={chrome ? chrome.title : live ? (o.title ?? 'Who is invited') : step === 'done' ? 'All set' : 'Host on Epic'} onBack={() => (chrome ? chrome.back() : live ? navigate(paths.hostOffer(o.id), { replace: true }) : step === 'done' ? navigate(paths.host(), { replace: true }) : at > 0 ? go(steps[at - 1]) : back(paths.host()))} />
        {cur > 0 && !live && !chrome ? (
          <View style={k.prog}>
            <View style={k.progRow}><Text style={[t.small, { fontWeight: '600', lineHeight: 15 }]}>{TITLE[step] ?? ''}</Text><Text style={[t.small, { fontSize: 11.5, lineHeight: 15 }]} numberOfLines={1}>{count}</Text></View>
            <View style={k.progBars}>{flow.map((s, i) => <View key={s} style={[k.progBar, i < cur && k.progBarOn]} />)}</View>
          </View>
        ) : null}
      </View>
      <ScrollView ref={scroller} contentContainerStyle={[styles.scroll, wide && k.wide]} keyboardShouldPersistTaps="handled">
        {step === 'plan' ? <Plan /> : null}
        {step === 'vis' ? <Vis offer={o} save={save} /> : null}
        {step === 'event' ? <EventStep offer={o} save={save} onSeeded={setOffer} /> : null}
        {step === 'weeks' ? <Weeks offer={o} save={save} /> : null}
        {step === 'numbers' ? <Numbers offer={o} save={save} /> : null}
        {step === 'invite' ? <Invite offer={o} setOffer={setOffer} setError={setError} live={live} setChrome={setChrome} /> : null}
        {step === 'money' ? <MoneyStep offer={o} save={save} /> : null}
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
      {chrome?.cta ? (
        <View style={wide ? k.wide : undefined}><Cta label={chrome.cta.label} lime={chrome.cta.lime} onPress={chrome.cta.onPress} style={{ paddingBottom: (Platform.OS === 'web' ? 'max(14px, var(--epic-sab))' : 14) as any }} /></View>
      ) : chrome ? null : cta ? (
        <View style={wide ? k.wide : undefined}>
          <Cta label={cta} loading={busy} onPress={live ? () => navigate(paths.hostOffer(o.id), { replace: true }) : forward} sub={cta === 'Make it epic' && step !== 'plan' && o.blockers.length ? o.blockers[0] : null} style={{ paddingBottom: (Platform.OS === 'web' ? 'max(14px, var(--epic-sab))' : 14) as any }} />
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
    { h: 'Everyone', pub: false, rows: [['1', 'Who can come', 'Invite-only, a link, or listed on Epic for anyone to find.'], ['2', 'What it is, and when', 'Title, place, date and how long.'], ['3', 'Who is coming', 'Names, or how many you can take.'], ['4', 'Is anyone paying', 'Free, or a price per person.']] },
    { h: 'If it is listed on Epic', pub: true, rows: [['5', 'You, and what you do', 'Your name, your town, and a minute of video.'], ['6', 'What backs it up', 'Only if you say you are an expert guide.']] },
  ];
  return (
    <View style={k.gutter}>
      <Text style={[t.h26, { paddingTop: 16 }]}>Here is what we need</Text>
      {groups.map((g, gi) => (
        <View key={g.h} style={{ paddingTop: gi === 0 ? 16 : 28 }}>
          <Text style={t.kicker}>{g.h}</Text>
          {g.rows.map(([n, title, sub]) => (
            <View key={n} style={[styles.planRow, k.rule]}>
              <View style={[k.tile30, k.warm, g.pub && { borderWidth: 1, borderColor: colors.ruleSoft }]}><Text style={styles.planN}>{n}</Text></View>
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
  const opts: { k: Visibility; icon: IconName; t: string; s: string | null; lane: string }[] = [
    { k: 'invite', icon: 'locked', t: 'Only people I invite', s: null, lane: '→ lane A · no video, no ID check' },
    { k: 'link', icon: 'link', t: 'Anyone with the link', s: null, lane: '→ lane B · no video, no ID check' },
    { k: 'public', icon: 'everyone', t: 'Listed on Epic', s: 'Anyone can find it — in Inspire and Places.', lane: '→ lane C · video and ID check' },
  ];
  const pub = o.visibility === 'public';
  const after = o.steps.slice(o.steps.indexOf('vis') + 1).filter((x) => x !== 'done');
  const WORDS: Record<string, string> = { event: 'what it is', weeks: 'the run', invite: 'who is coming', numbers: 'how many', money: 'is anyone paying' };
  const NUM = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  const note = pub
    ? 'Five more steps after this: what it is, how many, the price, you and what you do, and what backs it up.'
    : `${NUM[after.length] ?? after.length} more steps after this: ${after.map((x) => WORDS[x] ?? x).map((w, i, a) => (i === a.length - 1 && a.length > 1 ? `and ${w}` : w)).join(', ')}.`;
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h25}>Who can come?</Text></View>
      <View style={[k.gutter, { paddingTop: 14, gap: 9 }]}>
        {opts.map((v) => {
          const on = o.visibility === v.k;
          return (
            <View key={v.k}>
              <Press onPress={() => void save({ visibility: v.k })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.visCard, on && styles.visCardOn]}>
                <View style={[k.tile30, on ? k.lime : k.warm]}><Icon name={v.icon} size={15} color={INK} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{v.t}</Text>
                  {v.s ? <Text style={[t.tiny, { lineHeight: 17, marginTop: 1 }]}>{v.s}</Text> : null}
                </View>
                {on ? <View style={[k.tick22, { width: 20, height: 20 }]}><Icon name="check" size={12} color={INK} strokeWidth={3} /></View> : null}
              </Press>
              <Text style={styles.laneLine}>{v.lane}</Text>
            </View>
          );
        })}
        <View style={[k.panelTint, { marginTop: 4 }]}><Text style={[t.small, { lineHeight: 18, color: colors.accent }]}>{note}</Text></View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// event — what it is, and when
// ---------------------------------------------------------------------------

/** A time in the prototype's field, opening the wheel beneath it. */
function TimeBox({ value, onChange, placeholder = 'Tap to choose', seeded, flex, compact }: { value: string; onChange: (v: string) => void; placeholder?: string; seeded?: boolean; flex?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[flex && { flex: 1 }, { gap: 8 }]}>
      {compact
        ? <Press onPress={() => setOpen(!open)} accessibilityRole="button" style={[k.field, { paddingHorizontal: 11 }, seeded && k.seeded]}><Text style={[t.input, { fontSize: 15 }, !value && { color: colors.ghost }]} numberOfLines={1}>{value || placeholder}</Text></Press>
        : <Picker value={value ? timeLabel(value) : null} placeholder={placeholder} seeded={seeded} onPress={() => setOpen(!open)} />}
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
        {/* The document sits at the top. Once read, the banner says so and the fields it filled carry the lime edge (C1). */}
        {o.doc ? (
          <Press onPress={() => void dropDoc()} accessibilityRole="button" accessibilityLabel="Take the document off" style={styles.docBanner}>
            <View style={[k.tile30, k.warm, { borderWidth: 1, borderColor: colors.ruleSoft }]}><Icon name="faq" size={15} color={INK} strokeWidth={2} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.sub, { fontWeight: '700', color: colors.ink, lineHeight: 17 }]} numberOfLines={1}>{docBusy ? 'Reading it…' : 'Your document'}</Text>
              <Text style={[t.tiny, { fontSize: 11.5, lineHeight: 15, color: colors.accent }]}>Read — the fields below are filled in from it. Guests can download it too.</Text>
            </View>
          </Press>
        ) : (
          <Press onPress={() => void pickDoc()} accessibilityRole="button" style={k.dashed}>
            <View style={[k.tile30, k.warm]}><Icon name="faq" size={15} color={INK} strokeWidth={2} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.sub, { fontWeight: '700', color: colors.ink, lineHeight: 17 }]}>{docBusy ? 'Reading it…' : 'Got a PDF for guests?'}</Text>
              <Text style={[t.tiny, { fontSize: 11.5, lineHeight: 15 }]}>Upload it here — guests can download it.</Text>
            </View>
          </Press>
        )}

        <Field label={o.shape === 'oneoff' ? 'Event name' : 'What is it called'}>
          <Input value={title} onChangeText={setTitle} onBlur={() => void save({ title })} placeholder={o.shape === 'series' ? 'Six Thursdays, learning to see' : pub ? 'Reading, as it actually was' : 'Our wedding at the barn'} seeded={seeded('title')} style={{ fontSize: 15 }} />
        </Field>

        {o.shape === 'oneoff' ? (
          <>
            {/* Date · Starts · Ends on one row (flex 1.55 / 1 / 1), the date with its calendar glyph. */}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Field label="Date" style={{ flex: 1.55, minWidth: 0 }}>
                <Press onPress={() => setOpenDate(!openDate)} accessibilityRole="button" style={[k.field, k.fieldRow, { paddingHorizontal: 11, gap: 6 }, seeded('startsOn') && k.seeded]}>
                  <Text style={[t.input, { fontSize: 15, flex: 1 }, !o.startsOn && { color: colors.ghost }]} numberOfLines={1}>{o.startsOn ? dmy(o.startsOn) : 'Choose'}</Text>
                  <Icon name="calendar" size={15} color={colors.ink} strokeWidth={2} />
                </Press>
              </Field>
              <Field label="Starts" style={{ flex: 1, minWidth: 0 }}><TimeBox value={o.startsAt ?? ''} onChange={(v) => void save({ startsAt: v || null })} placeholder="13:00" seeded={seeded('startsAt')} compact /></Field>
              <Field label="Ends" style={{ flex: 1, minWidth: 0 }}><TimeBox value={o.endsAt ?? ''} onChange={(v) => void save({ endsAt: v || null, durationMin: null })} placeholder="23:30" compact /></Field>
            </View>
            {openDate ? <View style={styles.calendar}><DateRangePicker single inline start={o.startsOn} end={o.startsOn} onApply={(d) => { void save({ startsOn: d }); setOpenDate(false); }} /></View> : null}
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
        <Field label={o.shape === 'oneoff' ? 'Event info' : 'Anything they should know'}>
          <Input value={notes} onChangeText={setNotes} onBlur={() => void save({ description: notes })} multiline placeholder={o.shape === 'oneoff' ? 'Ceremony at one, food at three, carriages at midnight. Parking is in the field by the gate.' : 'Flat walking, about ninety minutes, nothing strenuous.'} seeded={seeded('description')} style={{ fontSize: 15, fontWeight: '500', minHeight: 104, lineHeight: 22 }} />
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
  const hint = focus === 'min' ? `Under ${num(min) ?? '…'} and it is called off — everybody is told, and anything taken is refunded.` : focus === 'expect' ? 'Just your best guess. It is not shown to anyone.' : `At ${num(max) ?? '…'} it is full and the page stops taking bookings.`;
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

type Reach = { name: string; mobile: string | null; email: string | null };
const reachOf = (c: Pick<HostContact, 'mobile' | 'email'>) => c.mobile ?? c.email ?? '';
const shortUrl = (u: string) => u.replace(/^https?:\/\//, '');
/** People are matched on mobile or email, never on name (C2a's de-duplication rule). */
const sameReach = (a: Reach, b: Reach) => Boolean((a.mobile && b.mobile && a.mobile.replace(/\s/g, '') === b.mobile.replace(/\s/g, '')) || (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()));

/**
 * Who is invited (C2), and everything that happens on it: the status row,
 * the invitation link with Share and Copy, the search that opens over the
 * list (C2a, C2b), the new-contact sheet (C2c, C2g), My Epic contacts (C2f),
 * the confirmation when people are added (C2i), and the same screen once the
 * event is live, with each person's answer (C2h).
 */
function Invite({ offer: o, setOffer, setError, live, setChrome }: { offer: OwnOffer; setOffer: (o: OwnOffer) => void; setError: (e: string | null) => void; live: boolean; setChrome: (c: Chrome) => void }) {
  const [text, setText] = useState('');
  const [view, setView] = useState<'main' | 'contacts'>('main');
  const [contacts, setContacts] = useState<HostContact[]>([]);
  const [phone, setPhone] = useState<Reach[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<{ name: string; mobile: string; email: string; tried: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [just, setJust] = useState<{ n: number; ids: string[] } | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(false);
  const loadContacts = useCallback(async () => { try { setContacts((await api.hostContacts()).contacts); } catch { /* the list is empty until it loads */ } }, []);
  useEffect(() => { void loadContacts(); }, [loadContacts]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const invited = o.invites;
  const accepted = invited.filter((i) => i.rsvp === 'yes').length;
  const searching = text.trim().length > 0;
  const q = text.trim().toLowerCase();
  const already = (r: Reach) => invited.some((i) => sameReach({ name: i.name, mobile: i.contactKind === 'mobile' ? i.contact : null, email: i.contactKind === 'email' ? i.contact : null }, r));
  const epicMatches = contacts.filter((c) => !already(c) && (c.name.toLowerCase().includes(q) || (c.mobile ?? '').includes(q) || (c.email ?? '').toLowerCase().includes(q)));
  const phoneMatches = phone.filter((r) => !already(r) && !contacts.some((c) => sameReach(c, r)) && (r.name.toLowerCase().includes(q) || (r.mobile ?? '').includes(q) || (r.email ?? '').toLowerCase().includes(q)));
  const inPhone = (c: HostContact) => phone.some((r) => sameReach(c, r));

  /** The confirmation (C2i): the count pops, the lime bar says so, the new rows sit tinted, then it settles after 2.6s. */
  const confirm = (n: number, ids: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    setJust({ n, ids });
    timer.current = setTimeout(() => setJust(null), 2600);
  };
  const add = async (rows: Reach[]) => {
    // One send at a time: a double tap would otherwise invite the same person
    // twice and text them twice (Codex, 13 Sep 2026).
    if (!rows.length || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const before = new Set(o.invites.map((i) => i.id));
      const r = await api.addInvites(o.id, rows.map((x) => ({ name: x.name, mobile: x.mobile, email: x.email, heads: 1 })));
      setOffer(r.offer); setError(null); setText('');
      confirm(rows.length, r.offer.invites.filter((i) => !before.has(i.id)).map((i) => i.id));
      void loadContacts();
    } catch (e: any) { setError(e.message); } finally { busyRef.current = false; setBusy(false); }
  };
  const remove = async (i: OfferInvite) => { try { const r = await api.removeInvite(o.id, i.id); setOffer(r.offer); } catch (e: any) { setError(e.message); } };
  const browsePhone = async () => {
    const nav: any = (globalThis as any).navigator;
    if (!nav?.contacts?.select) { setError('This browser cannot open your phone contacts. Type a name and add them.'); return; }
    try {
      const rows = await nav.contacts.select(['name', 'tel', 'email'], { multiple: true });
      const got: Reach[] = rows.map((c: any) => ({ name: c.name?.[0] ?? '', mobile: c.tel?.[0] ?? null, email: c.email?.[0] ?? null })).filter((c: Reach) => c.name && (c.mobile || c.email));
      setPhone((p) => [...p, ...got.filter((g) => !p.some((x) => sameReach(x, g)))]);
      if (got.length && !searching) await add(got);
    } catch (e: any) { setError(e.message); }
  };
  const share = async () => {
    const nav: any = (globalThis as any).navigator;
    try { if (nav?.share) await nav.share({ title: o.title ?? 'You are invited', url: o.linkUrl }); else await copy(); } catch { /* closed */ }
  };
  const copy = async () => { try { await (globalThis as any).navigator?.clipboard?.writeText(o.linkUrl); setCopied(true); setTimeout(() => setCopied(false), 2600); } catch { setError('Could not copy — press and hold the link instead.'); } };
  const newContact = async () => {
    if (!sheet) return;
    const mobile = sheet.mobile.trim() || null, email = sheet.email.trim() || null;
    if (!mobile && !email) { setSheet({ ...sheet, tried: true }); return; }
    const name = sheet.name.trim();
    if (!name) { setSheet({ ...sheet, tried: true }); return; }
    setSheet(null);
    await add([{ name, mobile, email }]);
  };

  // My Epic contacts (C2f) takes the chrome over: its own title, its own lime action.
  useEffect(() => {
    if (view !== 'contacts') { setChrome(null); return; }
    const n = picked.size;
    setChrome({ title: 'My Epic contacts', back: () => setView('main'), cta: { label: n ? `Add ${n} to this event` : 'Pick who to add', lime: true, onPress: async () => { const rows = contacts.filter((c) => picked.has(c.id)); setView('main'); setPicked(new Set()); await add(rows); } } });
  }, [view, picked, contacts]);

  const reachable = Boolean(sheet && (sheet.mobile.trim() || sheet.email.trim()));
  const errOn = Boolean(sheet?.tried && !reachable);
  const dim = sheet ? { opacity: 0.32 } : null;

  if (view === 'contacts') {
    const cq = contactSearch.trim().toLowerCase();
    const shown = contacts.filter((c) => !cq || c.name.toLowerCase().includes(cq) || (c.mobile ?? '').includes(cq) || (c.email ?? '').toLowerCase().includes(cq));
    const often = shown.filter((c) => c.timesInvited >= 2);
    const rest = shown.filter((c) => c.timesInvited < 2);
    const toggle = (c: HostContact) => { if (already(c)) return; const next = new Set(picked); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); setPicked(next); };
    const Row = ({ c }: { c: HostContact }) => <ContactRow c={c} on={already(c) || picked.has(c.id)} invited={already(c)} onPress={() => toggle(c)} />;
    return (
      <View>
        <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h25}>{contacts.length} saved</Text></View>
        <View style={[k.gutter, { paddingTop: 14, gap: 11 }]}>
          <View style={styles.search}><Icon name="search" size={16} color={colors.inkMuted} strokeWidth={2} /><TextInput value={contactSearch} onChangeText={setContactSearch} placeholder="Search saved contacts" placeholderTextColor={colors.ghost} style={[styles.searchInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} /></View>
          <Press onPress={() => setSheet({ name: contactSearch.trim(), mobile: '', email: '', tried: false })} accessibilityRole="button" style={[k.dashed, { paddingVertical: 11, paddingHorizontal: 12 }]}><Icon name="addPerson" size={16} color={colors.accent} strokeWidth={2} /><Text style={[t.sub, { fontWeight: '700', color: colors.accent, lineHeight: 17 }]}>Add a new contact</Text></Press>
          {often.length ? <View><Text style={t.kicker}>Invited most often</Text>{often.map((c) => <Row key={c.id} c={c} />)}</View> : null}
          {rest.length ? <View style={{ marginTop: often.length ? 10 : 0 }}><Text style={t.kicker}>Everyone else</Text>{rest.map((c) => <Row key={c.id} c={c} />)}</View> : null}
          {!contacts.length ? <Text style={[t.small, { lineHeight: 18 }]}>Nobody yet. Everyone you invite is saved here for the next thing you host.</Text> : null}
        </View>
        {sheet ? <NewContactSheet sheet={sheet} setSheet={setSheet} errOn={errOn} reachable={reachable} onAdd={newContact} /> : null}
      </View>
    );
  }

  const showStatus = invited.length > 0 || o.minCount != null || o.maxCount != null;
  const rsvpWords = (i: OfferInvite): { text: string; color: string } => {
    if (just?.ids.includes(i.id)) return { text: 'Invited just now · no reply yet', color: colors.inkMuted };
    if (live) {
      if (i.rsvp === 'yes') return { text: `Coming · ${i.rsvpHeads ?? i.heads}${(i.rsvpHeads ?? i.heads) > 1 ? ' of them' : ''}`, color: colors.accent };
      if (i.rsvp === 'no') return { text: 'Cannot make it', color: colors.overrun };
      return { text: i.sentAt ? 'No reply' : 'Not sent yet', color: colors.inkMuted };
    }
    return { text: i.contact ?? 'No way to reach them', color: colors.inkMuted };
  };
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h25}>Who is invited?</Text></View>
      <View style={[k.gutter, { paddingTop: 14, gap: 12 }, dim]}>
        {showStatus && !searching ? (
          <View style={{ flexDirection: 'row', gap: 7 }}>
            <StatCell label="INVITED" value={String(invited.length)} hot={Boolean(just)} />
            <StatCell label="ACCEPTED" value={String(accepted)} />
            <StatCell label="MIN" value={o.minCount != null ? String(o.minCount) : '—'} />
            <StatCell label="MAX" value={o.maxCount != null ? String(o.maxCount) : '—'} />
          </View>
        ) : null}
        {just && !searching ? (
          <View style={styles.toast}>
            <View style={[k.tile30, k.ink, { width: 24, height: 24 }]}><Icon name="check" size={13} color={LIME} strokeWidth={3} /></View>
            <Text style={[t.sub, { fontWeight: '700', color: colors.ink, flex: 1, lineHeight: 17 }]}>{just.n === 1 ? '1 invited — their text is on the way' : `${just.n} invited — their texts are on the way`}</Text>
          </View>
        ) : null}
        {!searching ? (
          <View style={styles.linkCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="link" size={16} color={colors.ink} strokeWidth={2} /><Text style={t.label}>The invitation link</Text></View>
            {!live ? <View style={styles.linkBox}><Text style={[t.body, { fontSize: 14, fontWeight: '600', lineHeight: 18 }]} numberOfLines={1}>{shortUrl(o.linkUrl)}</Text></View> : null}
            {o.visibility === 'link' ? <Text style={[t.tiny, { lineHeight: 16, marginTop: -3 }]}>Anyone with this can open it.</Text> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Press onPress={() => void share()} accessibilityRole="button" style={[styles.linkBtn, k.ink]}><Icon name="share" size={16} color={colors.primaryFg} strokeWidth={2} /><Text style={[styles.linkBtnText, { color: colors.primaryFg }]}>Share</Text></Press>
              <Press onPress={() => void copy()} accessibilityRole="button" style={[styles.linkBtn, { borderWidth: 1, borderColor: colors.line }]}><Icon name="copy" size={16} color={colors.ink} strokeWidth={2} /><Text style={styles.linkBtnText}>{copied ? 'Copied' : 'Copy'}</Text></Press>
            </View>
          </View>
        ) : null}
        {just && !searching && invited.length ? (
          <View style={{ gap: 6 }}>
            <Text style={t.kicker}>Invited</Text>
            {invited.filter((i) => just.ids.includes(i.id)).map((i) => <GuestRow key={i.id} i={i} words={rsvpWords(i)} tinted live={live} onRemove={() => void remove(i)} />)}
          </View>
        ) : null}
        <View style={{ gap: 7 }}>
          <Text style={t.label}>Or add them by name</Text>
          <View style={[styles.search, searching && { borderWidth: 2, borderColor: colors.line, paddingVertical: 11, paddingHorizontal: 12 }]}>
            <Icon name="search" size={16} color={searching ? colors.ink : colors.inkMuted} strokeWidth={2} />
            <TextInput value={text} onChangeText={setText} placeholder="Search my contacts, or type a name" placeholderTextColor={colors.ghost} autoCapitalize="words" style={[styles.searchInput, searching && { fontWeight: '600' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
            {searching ? <Press onPress={() => setText('')} accessibilityRole="button" accessibilityLabel="Clear" hitSlop={8}><Icon name="close" size={16} color={colors.inkMuted} strokeWidth={2} /></Press> : null}
          </View>
        </View>
        {searching ? (
          <View style={styles.drop}>
            <Press onPress={() => setSheet({ name: text.trim(), mobile: /^[\d\s+()-]{6,}$/.test(text.trim()) ? text.trim() : '', email: text.includes('@') ? text.trim() : '', tried: false })} accessibilityRole="button" style={[styles.dropRow, k.rule]}>
              <View style={[k.tile30, k.lime]}><Icon name="add" size={16} color={INK} strokeWidth={2.4} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[t.body, { fontSize: 14, fontWeight: '700', lineHeight: 18 }]}>Add a new contact</Text>
                <Text style={[t.tiny, { color: colors.accent }]}>“{text.trim()}” — name, then a mobile or an email</Text>
              </View>
            </Press>
            {epicMatches.length ? <><Text style={[t.kicker, { paddingHorizontal: 13, paddingTop: 9, paddingBottom: 5 }]}>On Epic already</Text><View style={{ paddingHorizontal: 13 }}>{epicMatches.slice(0, 6).map((c) => (
              <Press key={c.id} onPress={() => void add([{ name: c.name, mobile: c.mobile, email: c.email }])} disabled={busy} accessibilityRole="button" style={[styles.guest, k.rule, busy && { opacity: 0.5 }]}>
                <Avatar name={c.name} /><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.guestName}>{c.name}</Text><Text style={t.tiny}>{reachOf(c)}{inPhone(c) ? ' · also in your phone' : c.timesInvited ? ` · invited to ${c.timesInvited}` : ''}</Text></View><CheckBox on={false} size={22} />
              </Press>
            ))}</View></> : null}
            {phoneMatches.length ? <><Text style={[t.kicker, { paddingHorizontal: 13, paddingTop: 9, paddingBottom: 5 }]}>In my phone, not on Epic</Text><View style={{ paddingHorizontal: 13 }}>{phoneMatches.slice(0, 6).map((r, i) => (
              <Press key={i} onPress={() => void add([r])} disabled={busy} accessibilityRole="button" style={[styles.guest, k.rule, busy && { opacity: 0.5 }]}>
                <Avatar name={r.name} /><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.guestName}>{r.name}</Text><Text style={t.tiny}>{reachOf(r)}</Text></View><CheckBox on={false} size={22} />
              </Press>
            ))}</View></> : null}
            <Press onPress={() => void browsePhone()} accessibilityRole="button" style={[styles.dropFoot, k.ruleTop]}><Icon name="phone" size={16} color={colors.accent} strokeWidth={2} /><Text style={[t.sub, { fontWeight: '700', color: colors.accent, lineHeight: 17 }]}>Browse all my phone contacts</Text></Press>
          </View>
        ) : null}
        {!searching && invited.length && !just ? (
          <View style={{ gap: 6 }}>
            <Text style={t.kicker}>{live ? `Invited · ${invited.length}` : 'Invited'}</Text>
            {invited.map((i) => <GuestRow key={i.id} i={i} words={rsvpWords(i)} live={live} onRemove={() => void remove(i)} />)}
          </View>
        ) : null}
        {!searching ? (
          <Press onPress={() => { setPicked(new Set()); setContactSearch(''); setView('contacts'); }} accessibilityRole="button" style={styles.contactsRow}>
            <Icon name="household" size={17} color={colors.ink} strokeWidth={2} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[t.sub, { fontWeight: '700', color: colors.ink, lineHeight: 17 }]}>My Epic contacts</Text>
              <Text style={t.tiny}>{just ? `${contacts.length} saved — the new ${just.n === 1 ? 'one is' : 'ones are'} in` : `${contacts.length} saved from things you have hosted`}</Text>
            </View>
            <Icon name="more" size={16} color={colors.inkMuted} strokeWidth={2} />
          </Press>
        ) : null}
        {busy ? <Text style={t.tiny}>Adding…</Text> : null}
      </View>
      {sheet ? <NewContactSheet sheet={sheet} setSheet={setSheet} errOn={errOn} reachable={reachable} onAdd={newContact} /> : null}
    </View>
  );
}

function ContactRow({ c, on, invited, onPress }: { c: HostContact; on: boolean; invited: boolean; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.guest, k.rule]}>
      <Avatar name={c.name} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.guestName}>{c.name}</Text>
        <Text style={t.tiny}>{reachOf(c)} · {c.timesInvited === 1 ? '1 thing' : `${c.timesInvited} things`}{invited ? ' · invited' : ''}</Text>
      </View>
      <CheckBox on={on} size={22} />
    </Press>
  );
}

function GuestRow({ i, words, tinted, live, onRemove }: { i: OfferInvite; words: { text: string; color: string }; tinted?: boolean; live: boolean; onRemove: () => void }) {
  return (
    <View style={[styles.guest, k.rule, tinted && { backgroundColor: colors.surfaceMuted, marginHorizontal: -8, paddingHorizontal: 8 }]}>
      <Avatar name={i.name} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.guestName}>{i.name}</Text>
        <Text style={[t.tiny, { color: words.color }]}>{words.text}</Text>
      </View>
      {live ? null : <Press onPress={onRemove} accessibilityRole="checkbox" accessibilityState={{ checked: true }} accessibilityLabel={`Remove ${i.name}`} hitSlop={8}><CheckBox on size={22} /></Press>}
    </View>
  );
}

/**
 * New contact (C2c), and its refusal (C2g): one of a mobile or an email is
 * required. A sheet at the foot of the screen over the dimmed content, so it
 * portals out of the step's scroll and pins itself to the phone frame
 * (CLAUDE.md; the same rule `VenueDrawer` keeps).
 */
function NewContactSheet({ sheet, setSheet, errOn, reachable, onAdd }: { sheet: { name: string; mobile: string; email: string; tried: boolean }; setSheet: (s: any) => void; errOn: boolean; reachable: boolean; onAdd: () => void }) {
  const { width, height, framed, origin } = useViewport();
  const border = (filled: boolean) => (errOn ? { borderWidth: 2, borderColor: colors.overrun, padding: 12 } : filled ? { borderWidth: 2, borderColor: colors.line, padding: 12 } : null);
  const frameBox = framed && origin ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height, overflow: 'hidden' as const } : { flex: 1 };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => setSheet(null)}>
      <View style={frameBox}>
        <Press onPress={() => setSheet(null)} accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1 }} />
        <View style={styles.sheet}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[t.h21, { fontSize: 19, lineHeight: 22 }]}>New contact</Text>
          <Press onPress={() => setSheet(null)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}><Icon name="close" size={18} color={colors.ink} strokeWidth={2} /></Press>
        </View>
        <Field label="Name"><Input value={sheet.name} onChangeText={(v) => setSheet({ ...sheet, name: v })} placeholder="Their name" autoCapitalize="words" style={[{ fontSize: 15, padding: 13 }, sheet.tried && !sheet.name.trim() ? { borderWidth: 2, borderColor: colors.overrun, padding: 12 } : null]} /></Field>
        <Field label="Mobile"><Input value={sheet.mobile} onChangeText={(v) => setSheet({ ...sheet, mobile: v, tried: false })} placeholder="07700 900000" keyboardType="phone-pad" style={[{ fontSize: 15, padding: 13 }, border(Boolean(sheet.mobile.trim()))]} /></Field>
        <Field label="Email" right={<Text style={[t.tiny, { fontSize: 11.5 }]}>{sheet.mobile.trim() ? 'optional if you gave a mobile' : 'one of the two is needed'}</Text>}><Input value={sheet.email} onChangeText={(v) => setSheet({ ...sheet, email: v, tried: false })} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" style={[{ fontSize: 15, padding: 13 }, border(Boolean(sheet.email.trim()))]} /></Field>
        {errOn ? <View style={styles.refused}><Icon name="alert" size={15} color={colors.overrun} strokeWidth={2} /><Text style={[t.small, { fontWeight: '600', color: colors.overrun, flex: 1, lineHeight: 17 }]}>Give a mobile or an email — we need one way to send the invitation.</Text></View> : null}
        {/* Not disabled: the tap is what asks, and the refusal is the answer (C2g). It still wears the disabled fill. */}
        <Press onPress={onAdd} accessibilityRole="button" accessibilityState={{ disabled: !reachable }} style={[k.cta, reachable ? k.ctaLime : { backgroundColor: colors.ruleSoft }]}>
          <Text style={[k.ctaText, { color: reachable ? INK : colors.inkMuted }]}>Add to the list</Text>
          <Icon name="add" size={17} color={reachable ? INK : colors.inkMuted} strokeWidth={2} />
        </Press>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// money — both paths
// ---------------------------------------------------------------------------

function NumberField({ label, value, onChange, onCommit, fill }: { label: string; value: string; onChange: (v: string) => void; onCommit: () => void; fill?: 'warm' | 'tint' }) {
  return (
    <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
      <Text style={[t.label, { fontSize: 12.5 }]}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} onBlur={onCommit} onSubmitEditing={onCommit} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus placeholder="—" placeholderTextColor={colors.ghost} style={[styles.bigBox, fill === 'warm' && k.warm, fill === 'tint' && k.tint, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
    </View>
  );
}
function ModeBoxes({ mode, onPick }: { mode: string; onPick: (m: 'same_each' | 'by_numbers') => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {[{ key: 'same_each' as const, t: 'Same each', s: 'Everybody pays the same.' }, { key: 'by_numbers' as const, t: 'Depends on numbers', s: 'Cheaper the more come.' }].map((m) => {
        const on = mode === m.key;
        return (
          <Press key={m.key} onPress={() => onPick(m.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.modeBox, on && styles.modeBoxOn]}>
            <Text style={[t.h16, { fontSize: 14.5, lineHeight: 17, textAlign: 'center' }]}>{m.t}</Text>
            <Text style={[t.tiny, { fontSize: 11, lineHeight: 14, textAlign: 'center' }]}>{m.s}</Text>
          </Press>
        );
      })}
    </View>
  );
}
function PriceBox({ label, value, onChange, onCommit, height = 52 }: { label: string; value: string; onChange: (v: string) => void; onCommit: () => void; height?: number }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[t.label, { fontSize: 12.5 }]}>{label}</Text>
      <View style={[styles.priceBox, { height }]}>
        <Text style={[t.h21, { fontSize: 20, lineHeight: 24 }]}>£</Text>
        <TextInput value={value} onChangeText={onChange} onBlur={onCommit} onSubmitEditing={onCommit} keyboardType="decimal-pad" returnKeyType="done" selectTextOnFocus placeholder="0" placeholderTextColor={colors.ghost} style={[t.h21, { fontSize: 20, lineHeight: 24, minWidth: 40, padding: 0, textAlign: 'center' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
      </View>
    </View>
  );
}

function MoneyStep({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  const pub = o.visibility === 'public';
  const [amount, setAmount] = useState(pnds(o.pricePence));
  const [total, setTotal] = useState(pnds(o.totalPence));
  const [min, setMin] = useState(str(o.minCount));
  const [max, setMax] = useState(str(o.maxCount));
  useEffect(() => { setAmount(pnds(o.pricePence)); setTotal(pnds(o.totalPence)); setMin(str(o.minCount)); setMax(str(o.maxCount)); }, [o.money, o.priceMode]);
  const opts: { k: Money; t: string; s: string; on: string }[] = pub
    ? [{ k: 'free', t: 'No, it is free', s: 'Nothing to set up.', on: 'Nobody is charged, so nobody is refunded.' }, { k: 'epic', t: 'Epic collects, and pays me out', s: 'Stripe set-up, once.', on: 'Stripe set-up, once. We hold it and refund if it does not run.' }]
    : [{ k: 'free', t: 'No, it is free', s: 'Nothing to set up.', on: 'Nobody is charged, so nobody is refunded.' }, { k: 'direct', t: 'They pay me directly', s: 'Cash, bank transfer, up to you.', on: 'Cash, bank transfer, up to you. We chase and you tick off.' }, { k: 'epic', t: 'Epic collects, and pays me out', s: 'Stripe set-up, once.', on: 'Stripe set-up, once. We hold it and refund if it does not run.' }];
  const byNumbers = o.priceMode === 'by_numbers';
  const minN = num(min), maxN = num(max), totalP = pence(total);
  const each = (n: number | null) => (totalP && n ? pounds(Math.ceil(totalP / n)) : '—');
  const commitNumbers = () => void save({ minCount: minN, maxCount: maxN });
  const pick = (m: Money) => void save({ money: m, ...(m !== 'free' && o.priceMode === 'free' ? { priceMode: 'same_each' } : {}) });

  const fact = (bold: string, rest: string) => <Text style={[t.small, { lineHeight: 18 }]}><Text style={[t.strong, { color: colors.ink }]}>{bold}</Text>{rest}</Text>;

  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}><Text style={t.h25}>Is anyone paying?</Text></View>
      <View style={[k.gutter, { paddingTop: 14, gap: 9 }]}>
        {opts.map((m) => {
          const on = o.money === m.k;
          if (!on) {
            return (
              <Press key={m.k} onPress={() => pick(m.k)} accessibilityRole="button" style={styles.moneyRow}>
                <View style={{ flex: 1 }}><Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{m.t}</Text></View>
                <Icon name="more" size={15} color={colors.inkMuted} strokeWidth={2} />
              </Press>
            );
          }
          return (
            <View key={m.k} style={styles.drawer}>
              <View style={[styles.moneyRow, { borderWidth: 0, backgroundColor: colors.surfaceMuted }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[t.body, { fontWeight: '700', lineHeight: 18 }]}>{m.t}</Text>
                  <Text style={[t.tiny, { color: colors.accent, lineHeight: 16, marginTop: 1 }]}>{m.on}</Text>
                </View>
                <View style={[k.tick22, { width: 20, height: 20 }]}><Icon name="check" size={12} color={INK} strokeWidth={3} /></View>
              </View>
              <View style={[styles.drawerBody, k.ruleTop]}>
                {m.k === 'free' ? (
                  <>
                    <View style={{ flexDirection: 'row', gap: 8 }}><NumberField label="Minimum" value={min} onChange={setMin} onCommit={commitNumbers} /><NumberField label="Maximum" value={max} onChange={setMax} onCommit={commitNumbers} /></View>
                    <Text style={[t.small, { lineHeight: 18 }]}>{minN ? `Fewer than ${minN} and it does not run.` : 'A minimum here only decides whether it runs.'}</Text>
                  </>
                ) : (
                  <>
                    <ModeBoxes mode={o.priceMode} onPick={(m2) => void save({ priceMode: m2 })} />
                    {!byNumbers ? (
                      <>
                        <PriceBox label="Each person pays" value={amount} onChange={setAmount} onCommit={() => void save({ pricePence: pence(amount), per: 'person' })} />
                        <View style={{ flexDirection: 'row', gap: 8 }}><NumberField label="Minimum" value={min} onChange={setMin} onCommit={commitNumbers} /><NumberField label="Maximum" value={max} onChange={setMax} onCommit={commitNumbers} /></View>
                        {m.k === 'epic' ? (
                          <View style={{ gap: 2 }}>
                            <Text style={t.kicker}>If it is called off</Text>
                            {([['24h', 'Full refund up to 24 hours before'], ['7d', 'Full refund up to 7 days before'], ['none', 'No refunds']] as const).map(([key, label]) => {
                              const on2 = o.refundRule === key;
                              return <Press key={key} onPress={() => void save({ refundRule: key })} accessibilityRole="radio" accessibilityState={{ checked: on2 }} style={[styles.radioRow, k.rule, { paddingVertical: 9, gap: 10 }]}><View style={[styles.radio17, on2 && k.lime, on2 && { borderWidth: 0 }]}>{on2 ? <Icon name="check" size={11} color={INK} strokeWidth={3.2} /> : null}</View><Text style={[t.label, { fontWeight: on2 ? '700' : '600', flex: 1 }]}>{label}</Text></Press>;
                            })}
                          </View>
                        ) : <Text style={[t.small, { lineHeight: 18 }]}>We show everyone what they owe and chase them. You tick them off as it arrives.</Text>}
                      </>
                    ) : (
                      <>
                        <PriceBox label="The whole thing costs" value={total} onChange={setTotal} onCommit={() => void save({ totalPence: pence(total), per: 'person' })} />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {([['Minimum', min, setMin, 'warm', minN], ['Maximum', max, setMax, 'tint', maxN]] as const).map(([label, value, set, fill, n]) => (
                            <View key={label} style={{ flex: 1, gap: 6, minWidth: 0 }}>
                              <Text style={[t.label, { fontSize: 12.5 }]}>{label}</Text>
                              <View style={{ borderWidth: 1, borderColor: colors.ruleSoft }}>
                                <TextInput value={value} onChangeText={set} onBlur={commitNumbers} onSubmitEditing={commitNumbers} keyboardType="number-pad" returnKeyType="done" selectTextOnFocus placeholder="—" placeholderTextColor={colors.ghost} style={[styles.bigBox, { height: 50, borderWidth: 0 }, fill === 'warm' ? k.warm : k.tint, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
                                <View style={[{ height: 46, alignItems: 'center', justifyContent: 'center', gap: 1 }, fill === 'warm' ? k.warm : k.tint, k.ruleTop]}>
                                  <Text style={{ fontFamily: t.label.fontFamily, fontSize: 9, fontWeight: '700', letterSpacing: 0.54, color: colors.inkMuted }}>EACH PAYS</Text>
                                  <Text style={[t.h17, { lineHeight: 20 }]}>{each(n)}</Text>
                                </View>
                              </View>
                            </View>
                          ))}
                        </View>
                        {m.k === 'epic'
                          ? fact(minN ? `Fewer than ${minN} and it does not run` : 'Give a minimum', minN ? ` — everyone refunded. Epic holds ${each(minN)} each and returns the difference.` : ' — below it nothing runs and everyone is refunded.')
                          : fact(minN ? `Fewer than ${minN} and it does not run.` : 'Give a minimum.', ' We tell each person what they owe once numbers are final.')}
                      </>
                    )}
                  </>
                )}
              </View>
            </View>
          );
        })}
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
                  ? <TextInput autoFocus value={f.value} onChangeText={(v) => setFacts(facts.map((x, j) => (j === i ? { ...x, value: v } : x)))} onBlur={() => commitFacts(facts)} placeholder="…" placeholderTextColor={colors.ghost} style={[styles.factValue, { padding: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
                  : <Press onPress={() => setEditing(i)} accessibilityRole="button" style={{ flex: 1 }}><Text style={styles.factValue}>{f.value}</Text></Press>}
                {/* The row stays open while focus moves between its key and its value; the tick closes it (Codex, 13 Sep 2026). */}
                <Press onPress={() => { if (editing === i) { setEditing(null); commitFacts(facts); } else setEditing(i); }} accessibilityRole="button" accessibilityLabel={editing === i ? 'Done' : 'Edit'} style={styles.factBtn}><Icon name={editing === i ? 'check' : 'edit'} size={14} color={editing === i ? colors.accent : colors.inkMuted} strokeWidth={editing === i ? 2.6 : 2} /></Press>
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
  const link = o.visibility === 'link';
  const each = o.money === 'free' ? null : o.priceMode === 'by_numbers' ? (o.totalPence && o.minCount ? pounds(Math.ceil(o.totalPence / o.minCount)) : null) : pounds(o.price.each);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const nav: any = (globalThis as any).navigator;
    const url = pub ? (typeof window !== 'undefined' ? `${window.location.origin}${paths.experience(o.id)}` : paths.experience(o.id)) : o.linkUrl;
    try { if (nav?.share) await nav.share({ title: o.title ?? 'On Epic', url }); else if (nav?.clipboard) { await nav.clipboard.writeText(url); setCopied(true); } } catch { /* closed */ }
  };
  const moneyRow = each ? (o.money === 'epic'
    ? { icon: 'card' as IconName, t: `${each} a head is collected by Epic`, s: 'Held until the day, then paid to you three working days after.' }
    : { icon: 'card' as IconName, t: `You collect ${each} a head`, s: 'We show everyone what they owe and chase them. You tick them off as it arrives.' }) : null;
  const rows: { icon: IconName; t: string; s: string; onPress?: () => void }[] = pub
    ? [{ icon: 'verified', t: 'We are checking what you sent', s: 'Your Checked badge appears when it clears — usually a day.' }, { icon: 'link', t: 'Share the link', s: 'Most first sessions fill from your own contacts.', onPress: () => void share() }]
    : [
      // Lane B leads with the link to copy; nothing is sent. Lane A leads with the invitations.
      link ? { icon: 'link', t: copied ? 'Copied' : 'The link to copy', s: shortUrl(o.linkUrl), onPress: () => void share() } : { icon: 'household', t: 'Send the invitations', s: 'By name, by text or by link — only they can open it.', onPress: () => navigate(paths.hostOfferEdit(o.id, 'invite')) },
      { icon: 'calendar', t: 'RSVPs come back with numbers', s: 'Yes, no, and how many they are bringing. Chased for you.' },
      ...(moneyRow ? [moneyRow] : []),
      { icon: 'address', t: 'It sits in Trips', s: 'With the travel, the stay and the rest of the weekend.' },
    ];
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 16 }]}>
        <View style={[k.limeBlock, { padding: 18, flexDirection: 'row', gap: 12, alignItems: 'center' }]}>
          <View style={[k.tile44, k.ink]}><Icon name="check" size={24} color={LIME} strokeWidth={3} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[t.h21, { color: INK }]}>{pub ? (o.state === 'live' ? 'You are live' : 'It is on its way') : 'Invitations ready'}</Text>
            <Text style={[t.small, { color: colors.onLime, marginTop: 2, lineHeight: 16 }]}>{pub ? `${o.title ?? 'Your offer'} · listed on Epic${each ? ` · ${each} each` : ''}` : link ? (each ? `Anyone with the link · ${each} each` : 'Anyone with the link can see this') : (each ? `Only the people you name · ${each} each` : 'Only the people you name can see this')}</Text>
          </View>
        </View>
      </View>
      <View style={[k.gutter, { paddingTop: 16, gap: 11 }]}>
        <Text style={t.kicker}>{pub ? 'Get the first few in' : 'What happens now'}</Text>
        <View style={{ marginTop: -5 }}>
          {rows.map((r) => (
            <Press key={r.t} onPress={r.onPress ?? (() => {})} disabled={!r.onPress} accessibilityRole={r.onPress ? 'button' : undefined} style={[styles.doneRow, k.rule]}>
              <View style={[k.tile30, pub ? k.tint : k.warm]}><Icon name={r.icon} size={15} color={INK} strokeWidth={2} /></View>
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
  planRow: { flexDirection: 'row', gap: 13, alignItems: 'flex-start', paddingVertical: 12 },
  planN: { ...t.h16, fontSize: 14, letterSpacing: 0, lineHeight: 17 },
  planTitle: { ...t.body, fontSize: 15.5, fontWeight: '700', lineHeight: 19 },
  visCard: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  visCardOn: { paddingVertical: 11, paddingHorizontal: 12, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  laneLine: { fontFamily: t.label.fontFamily, fontSize: 11.5, fontWeight: '600', color: colors.accent, marginTop: -4, marginBottom: 2, marginLeft: 4, lineHeight: 15, paddingTop: 8 },
  wheel: { borderWidth: 1, borderColor: colors.ruleSoft, padding: 12, gap: 10 },
  docBanner: { flexDirection: 'row', gap: 11, alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, backgroundColor: colors.surfaceMuted },
  calendar: { borderWidth: 1, borderColor: colors.ruleSoft, padding: 13, marginTop: 2 },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  weekN: { ...t.kicker, fontFamily: t.label.fontFamily, fontSize: 10.5, textTransform: 'none', width: 56, lineHeight: 13 },
  weekText: { ...t.body, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  numLabel: { fontFamily: t.label.fontFamily, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkMuted, lineHeight: 12 },
  numBox: { borderWidth: 1, borderColor: colors.ruleSoft, paddingVertical: 11, paddingHorizontal: 12, ...t.h21, fontSize: 20, letterSpacing: 0, lineHeight: 24, backgroundColor: colors.surface },
  numBoxOn: { borderWidth: 2, borderColor: colors.line, paddingVertical: 10, paddingHorizontal: 11 },
  ageBox: { borderWidth: 2, borderColor: colors.line, paddingVertical: 10, width: 62, textAlign: 'center', ...t.h21, fontSize: 20, letterSpacing: 0, lineHeight: 24 },
  guest: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  guestName: { ...t.body, fontWeight: '600', lineHeight: 18 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 13, backgroundColor: LIME },
  linkCard: { borderWidth: 2, borderColor: colors.line, padding: 13, gap: 10 },
  linkBox: { backgroundColor: colors.warm, paddingVertical: 11, paddingHorizontal: 12 },
  linkBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44 },
  linkBtnText: { ...t.body, fontWeight: '700', lineHeight: 18 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.ruleSoft, paddingVertical: 12, paddingHorizontal: 13 },
  searchInput: { ...t.body, flex: 1, minWidth: 0, padding: 0, lineHeight: 18 },
  drop: { borderWidth: 1, borderColor: colors.ruleSoft },
  dropRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, paddingHorizontal: 13, backgroundColor: colors.surface },
  dropFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 13 },
  contactsRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, paddingHorizontal: 13, backgroundColor: colors.warm },
  sheet: { borderTopWidth: 2, borderTopColor: colors.line, backgroundColor: colors.bg, paddingTop: 16, paddingHorizontal: 20, paddingBottom: (Platform.OS === 'web' ? 'max(14px, var(--epic-sab))' : 14) as any, gap: 12 },
  refused: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.overrun, backgroundColor: colors.surface },
  moneyRow: { flexDirection: 'row', gap: 11, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  drawer: { borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface },
  drawerBody: { padding: 13, gap: 12 },
  modeBox: { width: 152, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 3, padding: 10, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  modeBoxOn: { padding: 9, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surfaceMuted },
  priceBox: { width: 152, borderWidth: 2, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  bigBox: { height: 52, borderWidth: 1, borderColor: colors.ruleSoft, textAlign: 'center', ...t.h21, fontSize: 20, letterSpacing: 0, lineHeight: 24, backgroundColor: colors.surface },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
  radio17: { width: 17, height: 17, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
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
