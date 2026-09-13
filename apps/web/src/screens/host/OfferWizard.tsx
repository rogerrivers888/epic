/**
 * Setting an offer up: one question per screen (Host prototype, 13 Sep 2026 —
 * "the behaviour spec"; README §2–3).
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
import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, CheckKind, Evidence, HostHome, LocalKind, Money, OfferInput, OfferInvite, OfferShape, OwnOffer, Place, Visibility } from '../../api';
import { colors, fonts, spacing, TARGET, type, BORDER, INK, LIME } from '../../theme';
import { Button, Row, Segmented, StatusLine, Wrap } from '../../components/ui';
import { Icon, IconName } from '../../components/Icon';
import { PlacePicker } from '../../components/PlacePicker';
import { DateRangePicker } from '../../components/DateRangePicker';
import { TimeField } from '../../components/TimePicker';
import { BirthdayPicker } from '../../components/BirthdayPicker';
import { useViewport } from '../../hooks/useViewport';
import { useQueryState, useRouter } from '../../router';
import { paths } from '../../routes';
import { pickPhotoBlob } from '../../components/pickPhoto';
import { ExperienceCard, NumberBox, SHAPE_ICON, SHAPE_LABEL, VISIBILITY_CHIP, VISIBILITY_LABEL, dayLong, dayShort, money as pounds, weekdayName } from '../../components/hosting';
import { KindChooser } from './ProfileScreen';

/** What each step is called on the button that leads to it, and in the progress line. */
const LABEL: Record<string, string> = { plan: 'what we need', vis: 'who can come', event: 'what it is', weeks: 'the run', invite: 'who is invited', numbers: 'how many', money: 'money', price: 'price', basics: 'about you', kind: 'what kind of host', subdetail: 'the detail', video: 'tell us what you do', extract: 'your listing', checks: 'what backs it up', evidence: 'the details', done: 'done' };
const TITLE: Record<string, string> = { basics: 'About you', kind: 'What kind of host', vis: 'Who can come', video: 'Tell us what you do', extract: 'Your listing', checks: 'What backs it up', evidence: 'The details', subdetail: 'The detail', weeks: 'The run', event: 'What it is, and when', invite: 'Who is invited', numbers: 'How many', price: 'Price', money: 'Money' };
const DAYS = [{ n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' }, { n: 4, l: 'T' }, { n: 5, l: 'F' }, { n: 6, l: 'S' }, { n: 0, l: 'S' }];
const pence = (t: string) => (t.trim() === '' ? null : Math.round(Number(t.replace(/[^0-9.]/g, '')) * 100) || null);
const num = (t: string) => (t.trim() === '' ? null : Math.max(0, Math.round(Number(t.replace(/[^0-9]/g, '')))) || null);
const str = (n?: number | null) => (n == null ? '' : String(n));
const pnds = (p?: number | null) => (p == null ? '' : String(p / 100));
const dmy = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

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

  if (error && !offer) return <View style={styles.page}><Text style={type.h2}>Not one of yours</Text><Text style={type.small}>{error}</Text><Button label="Back to hosting" kind="secondary" onPress={() => navigate(paths.host(), { replace: true })} /></View>;
  if (!offer) return <View style={styles.page}><Text style={type.small}>Opening…</Text></View>;
  const o = offer;
  const pub = o.visibility === 'public';

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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView ref={scroller} contentContainerStyle={[styles.scroll, wide && styles.wide]} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Press onPress={() => (at > 0 ? go(steps[at - 1]) : back(paths.host()))} accessibilityRole="button" hitSlop={8}><Row><Icon name="back" size={18} /><Text style={type.h3}>{step === 'done' ? 'All set' : 'Host on Epic'}</Text></Row></Press>
          {cur > 0 ? <Text style={type.small}>{TITLE[step]} · {cur} of {flow.length}</Text> : null}
        </Row>
        {cur > 0 ? <View style={styles.progress}>{flow.map((s, i) => <View key={s} style={[styles.bar, i < cur && styles.barOn]} />)}</View> : null}

        {step === 'plan' ? <Plan offer={o} /> : null}
        {step === 'vis' ? <Vis offer={o} save={save} /> : null}
        {step === 'event' ? <EventStep offer={o} save={save} onSeeded={setOffer} /> : null}
        {step === 'weeks' ? <Weeks offer={o} save={save} /> : null}
        {step === 'numbers' ? <Numbers offer={o} save={save} /> : null}
        {step === 'invite' ? <Invite offer={o} setOffer={setOffer} setError={setError} /> : null}
        {step === 'money' ? <MoneyStep offer={o} save={save} /> : null}
        {step === 'price' ? <Price offer={o} save={save} /> : null}
        {step === 'basics' ? <Basics home={home} onChanged={onChanged} /> : null}
        {step === 'kind' ? <Kind home={home} onChanged={onChanged} offer={o} save={save} /> : null}
        {step === 'subdetail' ? <SubDetail offer={o} save={save} sub={home?.host?.localKind ?? 'already_do'} /> : null}
        {step === 'video' ? <VideoStep offer={o} onRecord={() => navigate(paths.hostVideo(o.id))} /> : null}
        {step === 'extract' ? <Extract offer={o} save={save} setOffer={setOffer} setError={setError} /> : null}
        {step === 'checks' ? <Checks offer={o} save={save} kind={home?.host?.type ?? 'skill'} town={home?.host?.location ?? null} /> : null}
        {step === 'evidence' ? <EvidenceStep offer={o} home={home} onChanged={onChanged} /> : null}
        {step === 'done' ? <Done offer={o} home={home} /> : null}

        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      </ScrollView>
      {cta ? (
        <View style={[styles.footer, wide && styles.wide]}>
          <Button label={cta} icon={cta === 'Make it epic' ? 'check' : 'forward'} loading={busy} onPress={forward} />
          {step === 'plan' ? <Text style={[type.tiny, { textAlign: 'center' }]}>Save and come back whenever. Nothing is public until you press publish.</Text> : null}
          {cta === 'Make it epic' && o.blockers.length ? <Text style={[type.tiny, { textAlign: 'center', color: colors.overrun }]}>{o.blockers[0]}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// plan — "Here is what we need"
// ---------------------------------------------------------------------------

function Plan({ offer: o }: { offer: OwnOffer }) {
  const groups = [
    { h: 'EVERYONE', lime: false, rows: [['1', 'Who can come', '30 sec'], ['2', 'What it is, and when', '2 min'], ['3', 'Who is coming', '1 min'], ['4', 'Is anyone paying', '1 min']] },
    { h: 'IF IT IS PUBLIC', lime: true, rows: [['5', 'You and what you do', '4 min'], ['6', 'What backs it up', '2 min']] },
  ];
  return (
    <View style={{ gap: spacing.sm }}>
      <Row style={{ gap: 6 }}><View style={styles.shapeTag}><Icon name={SHAPE_ICON[o.shape]} size={11} color={colors.ink} /><Text style={styles.shapeTagText}>{SHAPE_LABEL[o.shape].toUpperCase()}</Text></View></Row>
      <Text style={styles.title}>Here is what we need</Text>
      {groups.map((g) => (
        <View key={g.h}>
          <Text style={[styles.groupHead, g.lime && { color: colors.accent }]}>{g.h}</Text>
          {g.rows.map(([n, t, m]) => (
            <Row key={n} style={styles.planRow}>
              <View style={[styles.numTile, g.lime && { backgroundColor: LIME }]}><Text style={styles.numText}>{n}</Text></View>
              <Text style={[type.body, { flex: 1 }]}>{t}</Text>
              <Text style={type.tiny}>{m}</Text>
            </Row>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// vis — who can come
// ---------------------------------------------------------------------------

function Vis({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  const opts: { k: Visibility; icon: IconName; t: string; s: string; money: string }[] = [
    { k: 'invite', icon: 'locked', t: 'Only people I invite', s: 'Add names now or later. Hidden from everyone else.', money: 'No video, no ID check, no payout set-up' },
    { k: 'link', icon: 'share', t: 'Anyone with the link', s: 'One link, passed around. Not listed on Epic.', money: 'No video needed — you are splitting costs' },
    { k: 'public', icon: 'web', t: 'Anyone on Epic', s: 'In Inspire and Places, near people whose trip fits.', money: 'A video and an ID check · we pay you out' },
  ];
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.title}>Who can come?</Text>
      {opts.map((v) => {
        const on = o.visibility === v.k;
        return (
          <Press key={v.k} onPress={() => void save({ visibility: v.k })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.choice, on && styles.choiceOn]}>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={[styles.iconTile, on && { backgroundColor: LIME }]}><Icon name={v.icon} size={16} color={colors.ink} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.h3}>{v.t}</Text>
                <Text style={type.small}>{v.s}</Text>
                <Text style={[type.tiny, { color: colors.accent, fontWeight: '600' }]}>{v.money}</Text>
              </View>
              {on ? <View style={styles.tick}><Icon name="check" size={14} color={colors.selectedFg} strokeWidth={3} /></View> : null}
            </Row>
          </Press>
        );
      })}
      <View style={[styles.note, o.visibility === 'public' && { backgroundColor: colors.surfaceMuted }]}>
        <Text style={[type.small, { color: o.visibility === 'public' ? colors.accent : colors.inkMuted }]}>
          {o.visibility === 'public' ? 'It will be listed publicly, so we need a video and something that backs you up.' : 'No video and no checks. You will still say what it is, who is invited and whether anyone is paying.'}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// event — what it is, and when
// ---------------------------------------------------------------------------

function EventStep({ offer: o, save, onSeeded }: { offer: OwnOffer; save: Save; onSeeded: (o: OwnOffer) => void }) {
  const pub = o.visibility === 'public';
  const [title, setTitle] = useState(o.title ?? '');
  const [notes, setNotes] = useState(o.description ?? '');
  const [place, setPlace] = useState<Place | null>(o.venueLabel ? { label: o.venueLabel, lat: o.venueLat ?? 0, lng: o.venueLng ?? 0 } : null);
  const [openDate, setOpenDate] = useState(false);
  const [endMode, setEndMode] = useState<'end' | 'dur'>(o.endsAt ? 'end' : 'dur');
  const [dur, setDur] = useState(str(o.durationMin));
  const [endKind, setEndKind] = useState<'count' | 'date'>(o.endDate && !o.sessions ? 'date' : 'count');
  const [sessions, setSessions] = useState(str(o.sessions));
  const [openEnd, setOpenEnd] = useState(false);
  const [notice, setNotice] = useState(str(o.noticeDays ?? 2));
  const [slot, setSlot] = useState(str(o.slotMin ?? o.durationMin ?? 90));
  const [docBusy, setDocBusy] = useState(false);
  useEffect(() => { setTitle(o.title ?? ''); setNotes(o.description ?? ''); if (o.venueLabel) setPlace({ label: o.venueLabel, lat: o.venueLat ?? 0, lng: o.venueLng ?? 0 }); }, [o.seeded.join(',')]);
  const seeded = (k: string) => o.seeded.some((s) => s.endsWith(`:${k}`));
  const edge = (k: string) => (seeded(k) ? styles.seeded : null);

  const pickDoc = async () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/pdf';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      setDocBusy(true);
      try { const m = await api.uploadHostMedia(f, 'doc'); const r = await api.seedOfferDoc(o.id, m.id); onSeeded(r.offer); } catch (e: any) { /* said by the footer */ } finally { setDocBusy(false); }
    };
    input.click();
  };
  const dropDoc = async () => { const r = await api.seedOfferDoc(o.id, null); onSeeded(r.offer); };

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{o.shape === 'series' ? 'What is it, and when does it run?' : pub ? 'What is it, and when?' : 'What is the day?'}</Text>

      {/* The document sits at the top: what it says seeds the fields, each marked. */}
      <Press onPress={() => (o.doc ? void dropDoc() : void pickDoc())} accessibilityRole="button" style={[styles.docRow, o.doc && { backgroundColor: colors.surfaceMuted }]}>
        <View style={[styles.iconTile, o.doc && { backgroundColor: LIME }]}><Icon name={o.doc ? 'check' : 'upload'} size={16} color={colors.ink} /></View>
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>{docBusy ? 'Reading it…' : o.doc ? 'Your PDF is attached' : 'Got a PDF for guests?'}</Text>
          <Text style={type.small}>{o.doc ? 'Guests can download it. Tap to take it off.' : 'Upload it here — guests can download it, and we fill in what we can from it.'}</Text>
        </View>
      </Press>

      <Field label="What is it called">
        <TextInput value={title} onChangeText={setTitle} onBlur={() => void save({ title })} placeholder={o.shape === 'series' ? 'Six Thursdays, learning to see' : pub ? 'Reading, as it actually was' : 'Our wedding at the barn'} placeholderTextColor={colors.inkFaint} style={[styles.input, edge('title')]} />
      </Field>

      {o.shape === 'oneoff' ? (
        <>
          <Field label="Date">
            <Press onPress={() => setOpenDate(!openDate)} accessibilityRole="button" style={[styles.input, styles.inputRow, edge('startsOn')]}><Icon name="calendar" size={16} /><Text style={[type.body, !o.startsOn && { color: colors.inkMuted }]}>{o.startsOn ? dayLong(o.startsOn) : 'Tap to choose'}</Text></Press>
            {openDate ? <DateRangePicker single inline start={o.startsOn} end={o.startsOn} onApply={(d) => { void save({ startsOn: d }); setOpenDate(false); }} /> : null}
          </Field>
          <Field label="Time" right={<Press onPress={() => setEndMode(endMode === 'end' ? 'dur' : 'end')} accessibilityRole="button"><Text style={styles.link}>{endMode === 'end' ? 'Give a duration instead' : 'Give an end time instead'}</Text></Press>}>
            <Row>
              <View style={[{ flex: 1 }, edge('startsAt')]}><TimeField value={o.startsAt ?? ''} onChange={(t) => void save({ startsAt: t || null })} step={15} placeholder="Starts" label="Starts" /></View>
              {endMode === 'end'
                ? <View style={{ flex: 1 }}><TimeField value={o.endsAt ?? ''} onChange={(t) => void save({ endsAt: t || null, durationMin: null })} step={15} placeholder="Ends" label="Ends" /></View>
                : <Row style={{ flex: 1 }}><NumberBox value={dur} onChange={setDur} onCommit={() => void save({ durationMin: num(dur), endsAt: null })} width={84} /><Text style={type.small}>min</Text></Row>}
            </Row>
            <Text style={type.tiny}>{endMode === 'end' ? 'Guests see both — we work the duration out.' : 'Guests see both — we work the end time out.'}</Text>
          </Field>
        </>
      ) : null}

      {o.shape === 'series' ? (
        <>
          <Field label="How often">
            <Segmented value={o.repeatEvery} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'fortnightly', label: 'Fortnightly' }, { value: 'monthly', label: 'Monthly' }]} onChange={(v) => void save({ repeatEvery: v })} />
          </Field>
          <Field label="On a">
            <Row style={{ gap: 6 }}>
              {DAYS.map((d) => { const on = (o.weekday ?? (o.firstDate ? new Date(`${o.firstDate}T12:00:00`).getDay() : 4)) === d.n; return <Press key={d.n} onPress={() => void save({ weekday: d.n })} accessibilityRole="button" style={[styles.dayChip, on && styles.dayOn]}><Text style={[styles.dayText, on && { color: colors.selectedFg }]}>{d.l}</Text></Press>; })}
            </Row>
          </Field>
          <Field label="First one">
            <Press onPress={() => setOpenDate(!openDate)} accessibilityRole="button" style={[styles.input, styles.inputRow, edge('firstDate')]}><Icon name="calendar" size={16} /><Text style={[type.body, !o.firstDate && { color: colors.inkMuted }]}>{o.firstDate ? dayLong(o.firstDate) : 'Tap to choose'}</Text></Press>
            {openDate ? <DateRangePicker single inline start={o.firstDate} end={o.firstDate} onApply={(d) => { void save({ firstDate: d, weekday: new Date(`${d}T12:00:00`).getDay() }); setOpenDate(false); }} /> : null}
            <TimeField value={o.startsAt ?? ''} onChange={(t) => void save({ startsAt: t || null })} step={15} placeholder="Starts at" label="Starts at" />
          </Field>
          <Field label="Until" right={<Press onPress={() => setEndKind(endKind === 'count' ? 'date' : 'count')} accessibilityRole="button"><Text style={styles.link}>{endKind === 'count' ? 'Give an end date instead' : 'Give a number instead'}</Text></Press>}>
            {endKind === 'count' ? (
              <Row><NumberBox value={sessions} onChange={setSessions} onCommit={() => void save({ sessions: num(sessions), endDate: null })} width={84} /><Text style={type.small}>sessions</Text></Row>
            ) : (
              <>
                <Press onPress={() => setOpenEnd(!openEnd)} accessibilityRole="button" style={[styles.input, styles.inputRow]}><Icon name="calendar" size={16} /><Text style={[type.body, !o.endDate && { color: colors.inkMuted }]}>{o.endDate ? dayLong(o.endDate) : 'Tap to choose'}</Text></Press>
                {openEnd ? <DateRangePicker single inline start={o.endDate} end={o.endDate} onApply={(d) => { void save({ endDate: d, sessions: null }); setOpenEnd(false); }} /> : null}
              </>
            )}
            <Text style={type.tiny}>{o.dates.length ? `${o.dates.length} ${weekdayName(new Date(`${o.dates[0]}T12:00:00`).getDay())}s from ${dayShort(o.dates[0])} — the last is ${dayShort(o.dates[o.dates.length - 1])}.` : 'Give the first date and a number or an end date, and we work the other out.'}</Text>
          </Field>
          <Field label="Each one lasts">
            <Row><NumberBox value={dur} onChange={setDur} onCommit={() => void save({ durationMin: num(dur) })} width={84} /><Text style={type.small}>minutes</Text></Row>
          </Field>
        </>
      ) : null}

      {o.shape === 'anytime' ? (
        <>
          <Field label="Days you are free">
            <Row style={{ gap: 6 }}>
              {DAYS.map((d) => { const days = new Set(o.availability.days ?? []); const on = days.has(d.n); return <Press key={d.n} onPress={() => { if (on) days.delete(d.n); else days.add(d.n); void save({ availability: { days: [...days], parts: o.availability.parts ?? [] } }); }} accessibilityRole="button" style={[styles.dayChip, on && styles.dayOn]}><Text style={[styles.dayText, on && { color: colors.selectedFg }]}>{d.l}</Text></Press>; })}
            </Row>
          </Field>
          <Field label="When in the day">
            <Row style={{ gap: 6 }}>
              {(['morning', 'afternoon', 'evening'] as const).map((p) => { const parts = new Set(o.availability.parts ?? []); const on = parts.has(p); return <Press key={p} onPress={() => { if (on) parts.delete(p); else parts.add(p); void save({ availability: { days: o.availability.days ?? [], parts: [...parts] } }); }} accessibilityRole="button" style={[styles.pill, on && styles.pillOn]}><Text style={[styles.pillText, on && { color: colors.primaryFg }]}>{p[0].toUpperCase() + p.slice(1)}s</Text></Press>; })}
            </Row>
          </Field>
          <Field label="Each booking lasts">
            <Row><NumberBox value={slot} onChange={setSlot} onCommit={() => void save({ slotMin: num(slot), durationMin: num(slot) })} width={84} /><Text style={type.small}>minutes</Text></Row>
          </Field>
          <Field label="How much notice you need" hint="Nobody can book a slot closer than this. You confirm or decline each one.">
            <Row><NumberBox value={notice} onChange={setNotice} onCommit={() => void save({ noticeDays: num(notice) })} width={84} /><Text style={type.small}>days</Text></Row>
          </Field>
        </>
      ) : null}

      <Field label="Where">
        <View style={edge('venueLabel')}>
          <PlacePicker value={place} onPick={(p) => { setPlace(p); if (p) void save({ venueLabel: p.formatted ?? p.label, venueLat: p.lat, venueLng: p.lng, venueCountry: p.countryCode ?? null, venueArea: p.locality ?? p.address?.town ?? null }); }} placeholder="Abbey ruins, Reading" />
        </View>
      </Field>
      <Field label="Anything they should know">
        <TextInput value={notes} onChangeText={setNotes} onBlur={() => void save({ description: notes })} multiline placeholder="Flat walking, about ninety minutes, nothing strenuous." placeholderTextColor={colors.inkFaint} style={[styles.input, styles.multi, edge('description')]} />
      </Field>
      {o.seeded.some((s) => s.startsWith('doc:')) ? <Text style={type.tiny}>Fields with a lime edge came from your document. Change any of them.</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// weeks — series only: outcome first
// ---------------------------------------------------------------------------

function Weeks({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  const [outcome, setOutcome] = useState(o.outcome ?? '');
  const [weeks, setWeeks] = useState(() => o.dates.map((_, i) => ({ n: i + 1, title: o.weeks.find((w) => w.n === i + 1)?.title ?? '' })));
  const commit = (next: typeof weeks) => { setWeeks(next); void save({ weeks: next.filter((w) => w.title.trim()) }); };
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>What do they leave with?</Text>
      <Text style={type.small}>This is what sells a ten-week commitment, not the weekly detail.</Text>
      <Field label="By the end they can…">
        <TextInput value={outcome} onChangeText={setOutcome} onBlur={() => void save({ outcome })} multiline placeholder="Paint a landscape from life in one sitting, and know when to stop." placeholderTextColor={colors.inkFaint} style={[styles.input, styles.multi]} />
      </Field>
      <Field label="Do the weeks differ?">
        <Segmented value={o.themesDiffer ? 'differ' : 'same'} options={[{ value: 'same', label: 'The same each week' }, { value: 'differ', label: 'Each week is different' }]} onChange={(v) => void save({ themesDiffer: v === 'differ' })} />
        <Text style={type.tiny}>{o.themesDiffer ? 'Name them below so people can see the arc. It also lets us say what they missed.' : 'Good for a run club or a weekly swim — no week list needed.'}</Text>
      </Field>
      {o.themesDiffer ? (
        <Field label="The weeks" hint="Leave any of them blank — guests just see the date.">
          {weeks.map((w, i) => (
            <Row key={w.n}>
              <Text style={styles.weekN}>WEEK {w.n}</Text>
              <TextInput value={w.title} onChangeText={(t) => setWeeks(weeks.map((x, j) => (j === i ? { ...x, title: t } : x)))} onBlur={() => commit(weeks)} placeholder={o.dates[i] ? dayShort(o.dates[i]) : 'Add a theme'} placeholderTextColor={colors.inkFaint} style={[styles.input, { flex: 1 }]} />
            </Row>
          ))}
          {!weeks.length ? <Text style={type.small}>Give the run its dates first.</Text> : null}
        </Field>
      ) : null}
      <Field label="Can people join for one week?">
        <Segmented value={o.joinMode === 'whole' || !o.joinMode ? 'run' : 'drop'} options={[{ value: 'run', label: 'The whole run only' }, { value: 'drop', label: 'One week is fine too' }]} onChange={(v) => void save({ joinMode: v === 'run' ? 'whole' : 'both' })} />
      </Field>
    </View>
  );
}

// ---------------------------------------------------------------------------
// numbers — public only: min only when money does
// ---------------------------------------------------------------------------

function Numbers({ offer: o, save }: { offer: OwnOffer; save: Save }) {
  // Expecting and Maximum here. A minimum only exists when money does, and
  // money is asked next — so the minimum is asked once, on the price step.
  const [focus, setFocus] = useState<'expect' | 'max'>('expect');
  const [exp, setExp] = useState(str(o.expectedCount));
  const [max, setMax] = useState(str(o.maxCount));
  const [age, setAge] = useState(str(o.ageLimit ?? 18));
  // A free offer carries no minimum, whatever an older row held.
  const commit = () => void save({ expectedCount: num(exp), maxCount: num(max), ...(o.money === 'free' ? { minCount: null } : {}) });
  const hint = focus === 'expect' ? 'Just your best guess. It is not shown to anyone.' : `At ${num(max) ?? '…'} it is full and the page stops taking bookings.`;
  const boxes = [{ k: 'expect' as const, l: 'Expecting', v: exp, s: setExp }, { k: 'max' as const, l: 'Maximum', v: max, s: setMax }];
  const restricted = o.ageLimit != null;
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>Who, and how many</Text>
      <Row style={{ gap: spacing.md }}>
        {boxes.map((b) => (
          <View key={b.k} style={{ flex: 1 }}>
            <Text style={[styles.fieldLabel, focus === b.k && { color: colors.ink }]}>{b.l}</Text>
            <NumberBox value={b.v} onChange={b.s} onCommit={commit} onFocus={() => setFocus(b.k)} width={undefined as any} />
          </View>
        ))}
      </Row>
      <Text style={type.small}>{hint}</Text>
      <Field label="Age limit">
        <Segmented value={restricted ? 'min' : 'any'} options={[{ value: 'any', label: 'Anyone' }, { value: 'min', label: 'Age restricted' }]} onChange={(v) => void save({ ageLimit: v === 'any' ? null : num(age) ?? 18 })} />
        {restricted ? <Row style={{ justifyContent: 'flex-end' }}><NumberBox value={age} onChange={setAge} onCommit={() => void save({ ageLimit: num(age) ?? 18 })} width={72} /><Text style={type.small}>and over</Text></Row> : null}
        <Text style={type.tiny}>{restricted ? 'We ask the age of everyone in the party at booking, and turn away anyone under it.' : 'Children welcome. Nobody is asked their age.'}</Text>
      </Field>
    </View>
  );
}

// ---------------------------------------------------------------------------
// invite — private only
// ---------------------------------------------------------------------------

function Invite({ offer: o, setOffer, setError }: { offer: OwnOffer; setOffer: (o: OwnOffer) => void; setError: (e: string | null) => void }) {
  const [mode, setMode] = useState<'contacts' | 'typed'>('typed');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [heads, setHeads] = useState('1');
  const [busy, setBusy] = useState(false);
  const total = o.invites.reduce((n, i) => n + (i.rsvp === 'no' ? 0 : i.rsvpHeads ?? i.heads), 0);
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { const r = await api.addInvites(o.id, [{ name: name.trim(), contact: contact.trim() || null, heads: num(heads) ?? 1 }]); setOffer(r.offer); setName(''); setContact(''); setHeads('1'); setError(null); }
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
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>Who is invited?</Text>
      <Text style={type.small}>Only these people can open it.</Text>
      <Row style={{ gap: 6 }}>
        <Press onPress={() => { setMode('contacts'); void pickContacts(); }} accessibilityRole="button" style={[styles.pill, mode === 'contacts' && styles.pillLime]}><Text style={styles.pillText}>From my contacts</Text></Press>
        <Press onPress={() => setMode('typed')} accessibilityRole="button" style={[styles.pill, mode === 'typed' && styles.pillLime]}><Text style={styles.pillText}>Type names</Text></Press>
      </Row>
      {mode === 'typed' ? (
        <View style={{ gap: spacing.sm }}>
          <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.inkFaint} style={styles.input} />
          <Row>
            <TextInput value={contact} onChangeText={setContact} placeholder="Mobile or email" placeholderTextColor={colors.inkFaint} autoCapitalize="none" style={[styles.input, { flex: 1 }]} />
            <NumberBox value={heads} onChange={setHeads} width={64} />
          </Row>
          <Button label="Add them" kind="secondary" icon="addPerson" loading={busy} disabled={!name.trim()} onPress={() => void add()} />
        </View>
      ) : null}
      {o.invites.map((i) => (
        <Row key={i.id} style={styles.guest}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{i.name[0]?.toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>{i.name}</Text>
            <Text style={type.small}>{[i.contact, i.heads > 1 ? `${i.heads} people` : null, i.rsvp === 'yes' ? `yes · ${i.rsvpHeads ?? i.heads} coming` : i.rsvp === 'no' ? 'no' : i.sentAt ? 'asked' : 'not sent yet'].filter(Boolean).join(' · ')}</Text>
          </View>
          <Press onPress={async () => { const r = await api.removeInvite(o.id, i.id); setOffer(r.offer); }} accessibilityRole="button" accessibilityLabel={`Remove ${i.name}`} hitSlop={8}><Icon name="close" size={16} color={colors.inkMuted} /></Press>
        </Row>
      ))}
      <View style={styles.note}>
        <Text style={[type.h3, { color: colors.ink }]}>Inviting {total} {total === 1 ? 'person' : 'people'}</Text>
        <Text style={type.small}>They get a text with a link — no account, no password. They tap yes or no and say how many they are bringing.{o.invites.some((i) => !i.sentAt && i.contact) ? ' Invitations go out when you publish.' : ''}</Text>
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
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.title}>Is anyone paying?</Text>
      <Text style={type.small}>{pub ? 'Public things are always paid through Epic, so we can hold the money until it runs.' : 'Private things can be free, or split between whoever is coming.'}</Text>
      {opts.map((m) => {
        const on = o.money === m.k;
        return (
          <Press key={m.k} onPress={() => void save({ money: m.k })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.choice, on && styles.choiceOn]}>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.h3}>{m.t}</Text>
                <Text style={type.small}>{m.s}</Text>
                <Text style={[type.tiny, { color: colors.accent, fontWeight: '600' }]}>{m.note}</Text>
              </View>
              {on ? <View style={styles.tick}><Icon name="check" size={14} color={colors.selectedFg} strokeWidth={3} /></View> : null}
            </Row>
          </Press>
        );
      })}
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
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>How much, per person</Text>
      <Row style={{ gap: spacing.sm }}>
        {[{ k: 'same_each' as const, t: 'Same each', s: 'One price, whoever comes' }, { k: 'by_numbers' as const, t: 'Depends on numbers', s: 'Cheaper the more there are' }].map((p) => {
          const on = o.priceMode === p.k;
          return (
            <Press key={p.k} onPress={() => void save({ priceMode: p.k })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.modeTile, on && { backgroundColor: INK }]}>
              <Text style={[type.h3, on && { color: colors.primaryFg }]}>{p.t}</Text>
              <Text style={[type.tiny, on && { color: colors.primaryFg, opacity: 0.8 }]}>{p.s}</Text>
            </Press>
          );
        })}
      </Row>
      <Field label={byNumbers ? 'The whole thing costs' : 'Each person pays'}>
        <Row>
          {byNumbers
            ? <NumberBox value={total} onChange={setTotal} onCommit={() => void save({ totalPence: pence(total), per: 'person' })} prefix="£" width={140} />
            : <NumberBox value={amount} onChange={setAmount} onCommit={() => void save({ pricePence: pence(amount), per: 'person' })} prefix="£" width={140} />}
        </Row>
        <Text style={type.tiny}>{byNumbers ? 'The most anyone pays is the total split by the minimum. We work the rest out from how many come and refund the difference.' : 'What every guest pays. A household booking three places pays three times this.'}</Text>
      </Field>
      {/* A minimum only exists when money does, and money is asked after the numbers — so it is asked here (Codex, 13 Sep 2026). */}
      <Field label="Fewest it can run with" hint={num(min) ? `Under ${num(min)} and it is called off — everybody is told and nothing is taken.` : 'Leave it empty and it runs whoever books.'}>
        <Row><NumberBox value={min} onChange={setMin} onCommit={() => void save({ minCount: num(min) })} width={84} /><Text style={type.small}>people</Text></Row>
      </Field>
      {o.money === 'epic' ? (
        <Field label="If they cancel">
          {([['24h', 'Full refund up to 24 hours before'], ['7d', 'Full refund up to 7 days before'], ['none', 'No refunds']] as const).map(([k, t]) => {
            const on = o.refundRule === k;
            return <Press key={k} onPress={() => void save({ refundRule: k })} accessibilityRole="radio" accessibilityState={{ checked: on }} style={styles.radioRow}><View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View><Text style={type.body}>{t}</Text></Press>;
          })}
        </Field>
      ) : null}
      <View style={styles.note}>
        <Text style={type.small}>{o.money === 'epic' ? <><Text style={{ fontWeight: '700', color: colors.ink }}>Epic collects, pays you out</Text> three working days after it runs. Guests see one all-in price.</> : 'You collect it however you normally do. We show everyone what they owe and tick them off as you confirm.'}</Text>
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
  const [said, setSaid] = useState<string | null>(null);
  const save = async (patch: Parameters<typeof api.updateHost>[0]) => { try { await api.updateHost(patch); await onChanged(); setSaid(null); } catch (e: any) { setSaid(e.message); } };
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>About you</Text>
      <Field label="Your name, as they will see it"><TextInput value={name} onChangeText={setName} onBlur={() => void save({ name: name.trim() })} placeholder="Jay Alderton" placeholderTextColor={colors.inkFaint} style={styles.input} /></Field>
      <Field label="Where you host">
        <PlacePicker value={place} onPick={(p) => { setPlace(p); if (p) void save({ locationLabel: p.locality ?? p.label, lat: p.lat, lng: p.lng, countryCode: p.countryCode ?? null }); }} kind="area" placeholder="Reading" />
        {showAddr ? <TextInput value={address} onChangeText={setAddress} onBlur={() => void save({ address: address.trim() || null })} placeholder="Street and number, or the park gate" placeholderTextColor={colors.inkFaint} style={styles.input} /> : null}
        <Press onPress={() => setShowAddr(!showAddr)} accessibilityRole="button"><Text style={styles.link}>{showAddr ? 'It is just the town' : 'It happens at a particular address ›'}</Text></Press>
      </Field>
      <BirthdayPicker value={h?.dateOfBirth ?? null} onChange={(iso) => void save({ dateOfBirth: iso })} clearable={false} minAge={18} hint="Hosts are eighteen or over. Never shown to guests." />
      {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
    </View>
  );
}

function Kind({ home, onChanged, offer: o, save }: { home: HostHome | null; onChanged: () => Promise<void>; offer: OwnOffer; save: Save }) {
  const h = home?.host ?? null;
  const set = async (patch: Parameters<typeof api.updateHost>[0]) => { await api.updateHost(patch); await onChanged(); await save({}); };
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>Which sounds most like you?</Text>
      <KindChooser kind={h?.type ?? null} sub={h?.localKind ?? null} onKind={(k) => void set({ type: k, localKind: k === 'meetups' ? h?.localKind ?? null : null })} onSub={(s) => void set({ type: 'meetups', localKind: s })} />
      <Text style={type.tiny}>Sub-kinds only appear once you pick Meetups and mini tours.</Text>
      {o ? null : null}
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
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{d.t}</Text>
      <Text style={type.small}>{d.s}</Text>
      {d.g.map((g) => (
        <Field key={g.key} label={g.h} hint={g.note}>
          {g.chips ? (
            <Wrap>
              {g.chips.map((c) => {
                const val = g.key === 'minGroup' ? Number(c) : c;
                const on = g.multi ? (local[g.key] ?? []).includes(c) : local[g.key] === val;
                return <Press key={c} onPress={() => write({ ...local, [g.key]: g.multi ? (on ? (local[g.key] ?? []).filter((x: string) => x !== c) : [...(local[g.key] ?? []), c]) : val })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.pill, on && styles.pillLime]}><Text style={styles.pillText}>{c}</Text></Press>;
              })}
            </Wrap>
          ) : (
            <TextInput value={local[g.key] ?? ''} onChangeText={(t) => setLocal({ ...local, [g.key]: t })} onBlur={() => write(local)} placeholder={g.field} placeholderTextColor={colors.inkFaint} style={styles.input} />
          )}
        </Field>
      ))}
      <View style={styles.rules}>
        <Text style={type.h3}>{d.rt}</Text>
        {d.r.map((r) => <Row key={r} style={{ alignItems: 'flex-start' }}><View style={styles.dot} /><Text style={[type.small, { flex: 1, color: colors.ink }]}>{r}</Text></Row>)}
        <Press onPress={() => void save({ rulesAccepted: !o.rulesAccepted })} accessibilityRole="checkbox" accessibilityState={{ checked: o.rulesAccepted }} style={styles.checkRow}>
          <View style={[styles.box, o.rulesAccepted && styles.boxOn]}>{o.rulesAccepted ? <Icon name="check" size={14} color={colors.selectedFg} strokeWidth={3} /> : null}</View>
          <Text style={[type.small, { flex: 1, color: colors.ink, fontWeight: '600' }]}>I have read these and they are how I will host</Text>
        </Press>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// video → extract → checks → evidence
// ---------------------------------------------------------------------------

function VideoStep({ offer: o, onRecord }: { offer: OwnOffer; onRecord: () => void }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>Tell us what you do</Text>
      <Text style={type.small}>Because this is public, we need to show people who you are.</Text>
      <Press onPress={onRecord} accessibilityRole="button" style={styles.recordTile}>
        <View style={styles.playRing}><Icon name={o.video ? 'refresh' : 'video'} size={24} color={INK} /></View>
        <Text style={[type.h3, { color: colors.bg }]}>{o.video ? 'Recorded · tap to redo' : 'Tap to record'}</Text>
      </Press>
      <View style={styles.script}>
        <Text style={styles.scriptKicker}>READ THIS, IN YOUR OWN WORDS</Text>
        {['Say your name and where you are', 'Say what you will do together, and how long', 'Say why you know this — and who it suits'].map((t, i) => (
          <Row key={t}><View style={[styles.scriptBox, o.video && { backgroundColor: LIME }]}>{o.video ? <Icon name="check" size={12} color={INK} strokeWidth={3} /> : <Text style={styles.scriptN}>{i + 1}</Text>}</View><Text style={[type.body, { flex: 1 }]}>{t}</Text></Row>
        ))}
      </View>
      <Text style={type.small}>Thirty to sixty seconds. Re-record as often as you like — only the one you keep is uploaded.</Text>
      <Text style={type.tiny}>We turn what you say into a title, a summary and a description. Nothing is published until you have read them.</Text>
    </View>
  );
}

function Extract({ offer: o, save, setOffer, setError }: { offer: OwnOffer; save: Save; setOffer: (o: OwnOffer) => void; setError: (e: string | null) => void }) {
  const [title, setTitle] = useState(o.title ?? '');
  const [summary, setSummary] = useState(o.summary ?? '');
  const [description, setDescription] = useState(o.description ?? '');
  const [facts, setFacts] = useState(o.facts);
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
  const from = (k: string) => (o.seeded.includes(`video:${k}`) ? ' FROM YOUR VIDEO' : '');
  const commitFacts = (next: typeof facts) => { setFacts(next); void save({ facts: next }); };
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>Here is what we heard</Text>
      <Text style={type.small}>{busy ? 'Listening to your video…' : 'Pulled from your video and tidied up. Change anything — guests read this, not the transcript.'}</Text>
      {note ? <View style={styles.note}><Text style={type.small}>{note}</Text></View> : null}
      <Field label={`Your skill${from('title')}`}><TextInput value={title} onChangeText={setTitle} onBlur={() => void save({ title })} style={[styles.input, { fontWeight: '700' }, o.seeded.includes('video:title') && styles.seeded]} placeholder="Reading, as it actually was" placeholderTextColor={colors.inkFaint} /></Field>
      <Field label={`The short version${from('summary')}`}><TextInput value={summary} onChangeText={setSummary} onBlur={() => void save({ summary })} multiline style={[styles.input, { minHeight: 64, paddingTop: 10 }, o.seeded.includes('video:summary') && styles.seeded]} placeholder="Ninety minutes round the old town with a historian who has taught it for twenty years." placeholderTextColor={colors.inkFaint} /></Field>
      <Field label={`The longer one${from('description')}`}><TextInput value={description} onChangeText={setDescription} onBlur={() => void save({ description })} multiline style={[styles.input, styles.multi, o.seeded.includes('video:description') && styles.seeded]} placeholder="We start at the abbey ruins and end where the Kennet meets the Thames…" placeholderTextColor={colors.inkFaint} /></Field>
      <Field label="Facts from your video">
        {facts.map((f, i) => (
          <Row key={i}>
            <TextInput value={f.key} onChangeText={(t) => setFacts(facts.map((x, j) => (j === i ? { ...x, key: t } : x)))} onBlur={() => commitFacts(facts)} style={[styles.input, { width: 110 }]} />
            <TextInput value={f.value} onChangeText={(t) => setFacts(facts.map((x, j) => (j === i ? { ...x, value: t } : x)))} onBlur={() => commitFacts(facts)} style={[styles.input, { flex: 1 }]} />
            <Press onPress={() => commitFacts(facts.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel="Delete" hitSlop={8}><Icon name="delete" size={16} color={colors.inkMuted} /></Press>
          </Row>
        ))}
        <Press onPress={() => setFacts([...facts, { key: '', value: '' }])} accessibilityRole="button" style={{ paddingVertical: 6 }}><Row><Icon name="add" size={14} color={colors.accent} /><Text style={styles.link}>Add a fact</Text></Row></Press>
      </Field>
      <Row><Button label={busy ? 'Listening…' : 'Listen again and rewrite'} kind="ghost" icon="refresh" disabled={busy || !o.video} onPress={() => void run(true)} /></Row>
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
  const toggle = (k: CheckKind) => { const set = new Set(o.checks); if (set.has(k)) set.delete(k); else set.add(k); void save({ checks: [...set] }); };
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.title}>What backs it up?</Text>
      <Text style={type.small}>{sub}</Text>
      {CHECK_ROWS.map((c) => {
        const on = o.checks.includes(c.k);
        return (
          <Press key={c.k} onPress={() => toggle(c.k)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.choice, on && styles.choiceOn]}>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={[styles.box, on && styles.boxOn, { marginTop: 2 }]}>{on ? <Icon name="check" size={14} color={colors.selectedFg} strokeWidth={3} /> : null}</View>
              <View style={{ flex: 1 }}><Text style={type.h3}>{c.t}</Text><Text style={type.small}>{c.s}</Text></View>
            </Row>
          </Press>
        );
      })}
      <Text style={type.tiny}>A licence is only asked for where the city legally requires one.{o.regulated ? ` ${o.regulated.country} does.` : town ? ` ${town} does not.` : ''}</Text>
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
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(picked.map((k) => [k, Object.fromEntries(Object.entries(existing.find((e) => e.kind === k)?.fields ?? {}).map(([a, b]) => [a, b ?? '']))])));
  const [said, setSaid] = useState<string | null>(null);
  const commit = async (k: CheckKind) => {
    const fields = drafts[k] ?? {};
    const have = existing.find((e) => e.kind === k);
    try { if (have) await api.updateEvidence(have.id, { fields }); else await api.addEvidence({ kind: k, offerId: o.id, fields }); await onChanged(); setSaid(null); } catch (e: any) { setSaid(e.message); }
  };
  const upload = async (k: CheckKind) => {
    const blob = await pickPhotoBlob();
    if (!blob) return;
    try { const m = await api.uploadHostMedia(blob, 'photo'); const have = existing.find((e) => e.kind === k); if (have) await api.updateEvidence(have.id, { mediaId: m.id }); else await api.addEvidence({ kind: k, offerId: o.id, fields: drafts[k] ?? {}, mediaId: m.id }); await onChanged(); } catch (e: any) { setSaid(e.message); }
  };
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{picked.length > 1 ? 'Tell us about each one' : picked.length === 1 ? 'Tell us about it' : 'Nothing to add'}</Text>
      <Text style={type.small}>{picked.length > 1 ? 'For each thing you ticked. Nothing here is shown to guests.' : 'Nothing here is shown to guests — only the badge that comes from it.'}</Text>
      {picked.map((k) => {
        const d = EVD[k];
        const have = existing.find((e) => e.kind === k);
        return (
          <View key={k} style={styles.evGroup}>
            <Text style={type.h3}>{d.h}</Text>
            {d.fields.map(([key, label, ph]) => (
              <Field key={key} label={label}>
                <TextInput value={drafts[k]?.[key] ?? ''} onChangeText={(t) => setDrafts({ ...drafts, [k]: { ...(drafts[k] ?? {}), [key]: t } })} onBlur={() => void commit(k)} placeholder={ph} placeholderTextColor={colors.inkFaint} autoCapitalize={key.includes('mail') || key === 'link' ? 'none' : 'sentences'} style={styles.input} />
              </Field>
            ))}
            {d.upload ? <Row><Button label={have?.media ? 'Uploaded · change it' : d.upload} kind="secondary" icon="upload" onPress={() => void upload(k)} />{have?.media ? <Icon name="check" size={16} color={colors.accent} /> : null}</Row> : null}
          </View>
        );
      })}
      {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// done
// ---------------------------------------------------------------------------

function Done({ offer: o, home }: { offer: OwnOffer; home: HostHome | null }) {
  const { navigate } = useRouter();
  const pub = o.visibility === 'public';
  const each = o.money === 'free' ? null : pounds(o.price.each);
  const rows: { icon: IconName; t: string; s: string }[] = pub
    ? [{ icon: 'verified', t: 'We are checking what you sent', s: o.state === 'in_review' ? 'Your listing is read within 48 hours; your Checked badge appears when the checks clear.' : 'Your Checked badge appears when it clears — usually a day.' }, { icon: 'share', t: 'Share the link', s: 'Most first sessions fill from your own contacts.' }]
    : [{ icon: 'household', t: 'Send the invitations', s: 'By name, by text or by link — only they can open it.' }, { icon: 'calendar', t: 'RSVPs come back with numbers', s: 'Yes, no, and how many they are bringing. Chased for you.' },
      ...(each ? [{ icon: 'payout' as IconName, t: o.money === 'epic' ? `We collect ${each} each` : `You collect ${each} each`, s: o.money === 'epic' ? 'Charged when they say yes, paid out to you three days after.' : 'We show everyone what they owe and chase them; you tick them off as it arrives.' }] : []),
      { icon: 'trips', t: 'It sits in Trips', s: 'With the travel, the stay and the rest of the weekend.' }];
  const share = async () => {
    const nav: any = (globalThis as any).navigator;
    const url = typeof window !== 'undefined' ? `${window.location.origin}${paths.experience(o.id)}` : paths.experience(o.id);
    try { if (nav?.share) await nav.share({ title: o.title ?? 'On Epic', url }); else if (nav?.clipboard) await nav.clipboard.writeText(url); } catch { /* closed */ }
  };
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{pub ? (o.state === 'live' ? 'You are live' : 'It is on its way') : 'Invitations ready'}</Text>
      <Text style={type.small}>{pub ? `${o.title ?? 'Your offer'} · anyone on Epic${each ? ` · ${each} each` : ''}` : o.money === 'free' ? 'Only the people you name can see this' : `Only the people you name · ${each} each`}</Text>
      <ExperienceCard item={o} onOpen={() => (o.state === 'live' ? navigate(paths.experience(o.id)) : undefined)} />
      <Text style={styles.kicker}>{pub ? 'GET THE FIRST FEW IN' : 'WHAT HAPPENS NOW'}</Text>
      {rows.map((r) => <Row key={r.t} style={{ alignItems: 'flex-start' }}><View style={styles.iconTile}><Icon name={r.icon} size={16} color={colors.ink} /></View><View style={{ flex: 1 }}><Text style={type.h3}>{r.t}</Text><Text style={type.small}>{r.s}</Text></View></Row>)}
      {pub ? <Button label="Share the link" kind="secondary" icon="share" onPress={() => void share()} /> : <Button label={o.invites.some((i) => !i.sentAt && i.contact) ? 'Send the invitations' : 'Add people to invite'} kind="secondary" icon="send" onPress={() => navigate(paths.hostOfferEdit(o.id, 'invite'))} />}
      {pub ? (
        <View style={styles.multi}>
          <Text style={type.h3}>That is one of your skills</Text>
          <Text style={type.small}>People book the thing, not the profile — so each skill is its own listing, with its own video, its own price and its own reason you are good at it.</Text>
          {[{ t: 'A sourdough morning', s: 'Anytime · 3 h · £45' }, { t: 'An hour on getting the best out of AI', s: 'Anytime · online · £80' }].map((e) => <Row key={e.t}><Icon name="anytime" size={14} color={colors.inkMuted} /><View style={{ flex: 1 }}><Text style={type.body}>{e.t}</Text><Text style={type.tiny}>{e.s}</Text></View></Row>)}
          <Text style={type.tiny}>Tom hosts both. Same person, two audiences.</Text>
          <Button label="Add another skill" icon="add" onPress={() => navigate(paths.hostNewOffer())} />
        </View>
      ) : null}
      <Button label="Back to hosting" kind="ghost" onPress={() => navigate(paths.host(), { replace: true })} />
      {home ? null : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

function Field({ label, hint, right, children }: { label: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}><Text style={styles.fieldLabel}>{label}</Text>{right}</Row>
      {children}
      {hint ? <Text style={type.tiny}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: (Platform.OS === 'web' ? 'max(16px, calc(var(--epic-sat) + 10px))' : 16) as any, paddingBottom: 150, gap: spacing.sm },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  progress: { flexDirection: 'row', gap: 4, marginBottom: spacing.sm },
  bar: { flex: 1, height: 4, backgroundColor: colors.lineSoft },
  barOn: { backgroundColor: colors.selected },
  title: { fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.9, lineHeight: 30, color: colors.ink },
  kicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: colors.inkMuted },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, paddingBottom: (Platform.OS === 'web' ? 'max(14px, var(--epic-sab))' : 14) as any, gap: 6, backgroundColor: colors.surface, borderTopWidth: BORDER, borderTopColor: colors.line },
  shapeTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, height: 20, borderWidth: 1, borderColor: colors.ink },
  shapeTagText: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.ink },
  groupHead: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: colors.inkMuted, marginTop: 28, marginBottom: 0 },
  planRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  numTile: { width: 26, height: 26, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: fonts.heading, fontSize: 13, fontWeight: '800', color: INK },
  choice: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  choiceOn: { borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surfaceMuted },
  iconTile: { width: 34, height: 34, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 24, height: 24, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  note: { backgroundColor: colors.warm, padding: spacing.md, gap: 4 },
  fieldLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  input: { minHeight: TARGET, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface, fontSize: 16, color: colors.ink, fontFamily: fonts.body },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  multi: { minHeight: 96, paddingTop: 10, gap: spacing.sm },
  seeded: { borderLeftWidth: 3, borderLeftColor: LIME },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  dayChip: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.warm },
  dayOn: { backgroundColor: colors.selected },
  dayText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.inkMuted },
  pill: { paddingHorizontal: 12, height: 36, justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  pillOn: { backgroundColor: INK },
  pillLime: { backgroundColor: LIME },
  pillText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  weekN: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.inkMuted, width: 60 },
  guest: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  modeTile: { flex: 1, padding: spacing.md, gap: 2, backgroundColor: colors.surfaceMuted, minHeight: 72 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.ruleSoft, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderWidth: 6, borderColor: INK },
  radioDot: { width: 0, height: 0 },
  rules: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.warm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink, marginTop: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: 4 },
  box: { width: 22, height: 22, borderWidth: 1, borderColor: colors.ruleSoft, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  boxOn: { backgroundColor: colors.selected, borderColor: colors.selected },
  recordTile: { backgroundColor: INK, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  playRing: { width: 64, height: 64, borderRadius: 32, backgroundColor: LIME, alignItems: 'center', justifyContent: 'center' },
  script: { backgroundColor: INK, padding: spacing.md, gap: spacing.sm },
  scriptKicker: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: colors.bg, opacity: 0.8 },
  scriptBox: { width: 22, height: 22, backgroundColor: 'rgba(255,253,249,0.22)', alignItems: 'center', justifyContent: 'center' },
  scriptN: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: '#FFFDF9' },
  evGroup: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.ruleSoft },
});
