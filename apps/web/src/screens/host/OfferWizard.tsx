/**
 * Add an offer: the five steps, in the group set-up's clothes (Hosts and
 * Events W1–W5; Events v4 C0–C3, D2).
 *
 *   1  What shape is it?     the fork. One-off · Series · Anytime — and it
 *                            visibly changes what is asked next.
 *   2  What is it?           title, what happens, photos, where — then the
 *                            shape's own questions: a running order and who
 *                            else is there (one-off); the outcome first, then
 *                            the arc, then the weeks, then joining (series);
 *                            one line, why you for this, the four formats and
 *                            when you are free (anytime). Its own video.
 *   3  Who, and how many     minimum · expecting · maximum, typed never nudged,
 *                            the three-line panel beneath, party size, age limit.
 *   4  Price                 Free / Same each / Depends on numbers, Person /
 *                            Household, what it includes, the refund rule.
 *                            Epic collects, pays you out — the only way here.
 *   5  Publish               the card as a guest sees it, the checklist of
 *                            what has to be true first, live or link only.
 *
 * Every field saves as it is left (`PATCH /api/host/offers/<id>`), so the
 * draft is never lost and the wizard is the same screen for editing later.
 * `?step=n` is the page's address. The regulated-city question appears only
 * when the venue is in one.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, Availability, OfferInput, OfferShape, OwnOffer, Place, PriceMode, RefundRule, RunningOrderRow, OfferVenue, Week } from '../../api';
import { colors, fonts, spacing, TARGET, type, BORDER } from '../../theme';
import { Button, Row, Segmented, StatusLine, Wrap } from '../../components/ui';
import { Icon, IconName } from '../../components/Icon';
import { PlacePicker } from '../../components/PlacePicker';
import { DateRangePicker } from '../../components/DateRangePicker';
import { TimeField } from '../../components/TimePicker';
import { useViewport } from '../../hooks/useViewport';
import { asNumber, useQueryState, useRouter } from '../../router';
import { paths } from '../../routes';
import { pickPhotoBlob } from '../../components/pickPhoto';
import {
  ExperienceCard, Kicker, NumberBox, SHAPE_ICON, SHAPE_LABEL, SizePanel, VENUE_ICON, VENUE_LABEL, dayLong, mediaUrl, money, weekdayName,
} from '../../components/hosting';

const STEPS = ['What shape is it?', 'What you are offering', 'Who, and how many', 'Price', 'How it will look'];
const NEXT = ['Next · what you are offering', 'Next · who and how many', 'Next · price', 'Next · see it as a guest', 'Publish it'];
const DAYS = [{ n: 1, l: 'Mon' }, { n: 2, l: 'Tue' }, { n: 3, l: 'Wed' }, { n: 4, l: 'Thu' }, { n: 5, l: 'Fri' }, { n: 6, l: 'Sat' }, { n: 0, l: 'Sun' }];
const PARTS = [{ k: 'morning', l: 'Mornings' }, { k: 'afternoon', l: 'Afternoons' }, { k: 'evening', l: 'Evenings' }] as const;
const pence = (t: string) => (t.trim() === '' ? null : Math.round(Number(t.replace(/[^0-9.]/g, '')) * 100) || null);
const num = (t: string) => (t.trim() === '' ? null : Math.max(0, Math.round(Number(t.replace(/[^0-9]/g, '')))) || null);
const str = (n?: number | null) => (n == null ? '' : String(n));
const pounds = (p?: number | null) => (p == null ? '' : String(p / 100));

export function OfferWizard({ offerId, onDone }: { offerId: string; onDone: (offer: OwnOffer, inReview: boolean) => void }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [stepN, setStepN] = useQueryState<number | null>('step', 1, asNumber(1));
  const step = Math.min(5, Math.max(1, stepN ?? 1));
  const [offer, setOffer] = useState<OwnOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.hostOffer(offerId).then((r) => setOffer(r.offer)).catch((e) => setError(e.message)); }, [offerId]);

  /** Every change is a PATCH; the answer is the whole offer, so the screen never guesses. */
  const save = useCallback(async (body: OfferInput) => {
    try { const r = await api.updateOffer(offerId, body); setOffer(r.offer); setError(null); return r.offer; }
    catch (e: any) { setError(e.message); return null; }
  }, [offerId]);

  const go = (n: number) => { setError(null); setStepN(n); };
  if (error && !offer) return <View style={styles.page}><Text style={type.h2}>Not one of yours</Text><Text style={type.small}>{error}</Text><Button label="Back to hosting" kind="secondary" onPress={() => navigate(paths.host(), { replace: true })} /></View>;
  if (!offer) return <View style={styles.page}><Text style={type.small}>Opening…</Text></View>;

  const publish = async () => {
    setBusy(true); setError(null);
    try { const r = await api.submitOffer(offerId); onDone(r.offer, r.inReview); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const heading = step === 1 ? 'What shape is it?'
    : step === 2 ? (offer.shape === 'oneoff' ? 'What is going to happen?' : offer.shape === 'series' ? 'Across the weeks' : 'What are you offering?')
      : step === 3 ? 'Who, and how many' : step === 4 ? 'Price' : 'How it will look';
  const kicker = step === 2 ? (offer.shape === 'oneoff' ? 'One-off' : offer.shape === 'series' ? 'Series' : 'Anytime offer') : offer.state === 'draft' ? 'New offer' : 'Your offer';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wide]} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Press onPress={() => (step > 1 ? go(step - 1) : back(paths.host()))} accessibilityRole="button" hitSlop={8}><Row><Icon name="back" size={18} /><Text style={type.h3}>{kicker}</Text></Row></Press>
          <Text style={type.small}>{heading} · {step} of 5</Text>
        </Row>
        <View style={styles.progress}>{STEPS.map((s, i) => <View key={s} style={[styles.bar, i < step && styles.barOn]} />)}</View>
        <Text style={type.title}>{heading}</Text>

        {step === 1 ? <ShapeStep offer={offer} onPick={(shape) => void save({ shape })} /> : null}
        {step === 2 ? <WhatStep offer={offer} save={save} onVideo={() => navigate(paths.hostVideo(offer.id))} /> : null}
        {step === 3 ? <WhoStep offer={offer} save={save} /> : null}
        {step === 4 ? <PriceStep offer={offer} save={save} /> : null}
        {step === 5 ? <PublishStep offer={offer} save={save} onEdit={(n) => go(n)} /> : null}

        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      </ScrollView>
      <View style={[styles.footer, wide && styles.wide]}>
        {step < 5 ? (
          <>
            <Button label={NEXT[step - 1]} icon="forward" onPress={() => go(step + 1)} />
            <Text style={[type.tiny, { textAlign: 'center' }]}>{step === 1 ? 'Most hosts end up with several offers of different shapes. You can add another as soon as this one is done.' : 'Saved as a draft — nothing is public yet'}</Text>
          </>
        ) : (
          <>
            <Button label={offer.state === 'live' ? 'Save changes' : 'Publish it'} icon="check" loading={busy} disabled={offer.blockers.length > 0 && offer.state !== 'live'} onPress={offer.state === 'live' ? () => navigate(paths.hostOffer(offer.id), { replace: true }) : publish} />
            <Text style={[type.tiny, { textAlign: 'center' }]}>{offer.blockers.length && offer.state !== 'live' ? offer.blockers[0] : 'Take it down any time — bookings are honoured'}</Text>
          </>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 1 · the fork
// ---------------------------------------------------------------------------

function ShapeStep({ offer, onPick }: { offer: OwnOffer; onPick: (s: OfferShape) => void }) {
  const shapes: { key: OfferShape; title: string; body: string }[] = [
    { key: 'oneoff', title: 'One-off', body: 'One date, one start time. You will list the running order and who else is there.' },
    { key: 'series', title: 'Series', body: 'A fixed run of sessions. You will write the arc, the weeks and what people leave knowing.' },
    { key: 'anytime', title: 'Anytime', body: 'No date — people book your time. You will describe what you offer and when you are free.' },
  ];
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
      <Text style={type.small}>This changes what we ask you next — describing a single evening is nothing like describing a ten-week course.</Text>
      {shapes.map((s) => {
        const on = offer.shape === s.key;
        return (
          <Press key={s.key} onPress={() => onPick(s.key)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.shape, on && styles.shapeOn]}>
            <View style={[styles.shapeIcon, on && { backgroundColor: colors.ink }]}><Icon name={SHAPE_ICON[s.key]} size={18} color={on ? colors.primaryFg : colors.ink} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.h3}>{s.title}</Text>
              <Text style={type.small}>{s.body}</Text>
            </View>
            {on ? <Icon name="check" size={18} color={colors.ink} strokeWidth={2.4} /> : null}
          </Press>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 2 · what it is, then the shape's own questions
// ---------------------------------------------------------------------------

function WhatStep({ offer: o, save, onVideo }: { offer: OwnOffer; save: (b: OfferInput) => Promise<OwnOffer | null>; onVideo: () => void }) {
  const [title, setTitle] = useState(o.title ?? '');
  const [description, setDescription] = useState(o.description ?? '');
  const [whyYou, setWhyYou] = useState(o.whyYou ?? '');
  const [category, setCategory] = useState(o.category ?? '');
  const [duration, setDuration] = useState(str(o.durationMin));
  const [passions, setPassions] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => { api.hostHome().then((h) => setPassions(h.config.passions)).catch(() => {}); }, []);

  const addPhoto = async () => {
    const blob = await pickPhotoBlob();
    if (!blob) return;
    const m = await api.uploadHostMedia(blob, 'photo');
    const ids = [...o.photos.map(idOf), m.id].filter(Boolean) as string[];
    await save({ photoIds: ids });
  };
  const removePhoto = (url: string) => save({ photoIds: o.photos.filter((p) => p !== url).map(idOf).filter(Boolean) as string[] });

  return (
    <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
      {o.shape === 'oneoff' ? <Text style={type.small}>Add it as a running order, not a paragraph. Guests read this before anything else.</Text> : null}

      <Field label={o.shape === 'anytime' ? 'In one line' : 'Title'}>
        <TextInput value={title} onChangeText={setTitle} onBlur={() => void save({ title })} placeholder={o.shape === 'anytime' ? 'An hour on getting the best out of AI' : o.shape === 'series' ? 'Six Thursdays, learning to see' : 'Windsor back streets, the bits the tours miss'} placeholderTextColor={colors.inkFaint} style={styles.input} />
      </Field>

      {o.shape === 'anytime' ? (
        <Field label="Why you, for this one" hint="The credentials and story for this specific offer, not a general bio.">
          <TextInput value={whyYou} onChangeText={setWhyYou} onBlur={() => void save({ whyYou })} multiline placeholder="Founder of a 100-person business. We rebuilt how the whole company writes and plans around it in eighteen months." placeholderTextColor={colors.inkFaint} style={[styles.input, styles.multi]} />
        </Field>
      ) : null}

      <Field label={o.shape === 'anytime' ? 'What happens, and what to bring' : 'What happens'}>
        <TextInput value={description} onChangeText={setDescription} onBlur={() => void save({ description })} multiline placeholder={o.shape === 'series' ? 'What each session is like, and what to bring.' : 'Two hours on foot. The yards behind the high street, the bridge nobody photographs, and a pint in the pub the guides walk past.'} placeholderTextColor={colors.inkFaint} style={[styles.input, styles.multi]} />
        <Text style={type.tiny}>Say what you will actually do, what they go home with, who it suits — and who it does not. That last one sells.</Text>
      </Field>

      <Field label="What it is about" hint="One word guests pick when they look for people who do what they love.">
        <Wrap>
          {passions.map((p) => <Press key={p.key} onPress={() => { setCategory(p.key); void save({ category: p.key }); }} accessibilityRole="button" accessibilityState={{ selected: category === p.key }} style={[styles.pill, category === p.key && styles.pillOn]}><Text style={[styles.pillText, category === p.key && { color: colors.selectedFg }]}>{p.label}</Text></Press>)}
        </Wrap>
      </Field>

      <Field label="Runs for">
        <Row>
          <NumberBox value={duration} onChange={setDuration} onCommit={() => void save({ durationMin: num(duration) })} width={96} />
          <Text style={type.small}>minutes{num(duration) && num(duration)! >= 60 ? ` · ${Math.floor(num(duration)! / 60)} h${num(duration)! % 60 ? ` ${num(duration)! % 60}` : ''}` : ''}</Text>
        </Row>
      </Field>

      <Field label={`Photos · ${o.photos.length} of 8`}>
        <Row style={{ flexWrap: 'wrap' }}>
          {o.photos.map((p) => (
            <View key={p} style={styles.photo}>
              <Image source={{ uri: mediaUrl(p)! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <Press onPress={() => void removePhoto(p)} accessibilityRole="button" accessibilityLabel="Remove photo" style={styles.photoX}><Icon name="close" size={12} color={colors.ink} /></Press>
            </View>
          ))}
          {o.photos.length < 8 ? <Press onPress={() => void addPhoto()} accessibilityRole="button" style={[styles.photo, styles.photoAdd]}><Icon name="camera" size={18} color={colors.inkMuted} /><Text style={type.tiny}>Add</Text></Press> : null}
        </Row>
      </Field>

      {/* One video per offer, separate from the profile intro. */}
      <Press onPress={onVideo} accessibilityRole="button" style={styles.videoRow}>
        <View style={styles.videoIcon}><Icon name="video" size={18} color={colors.selectedFg} /></View>
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>{o.video ? 'Your video for this offer is up' : 'Record a video for this offer'}</Text>
          <Text style={type.small}>Separate from your profile intro. {o.video ? 'Tap to re-record.' : 'Thirty to sixty seconds.'}</Text>
        </View>
        <Text style={[type.small, { color: colors.accent, fontWeight: '700' }]}>{o.video ? 'Redo' : 'Record'}</Text>
      </Press>

      <WhereBlock offer={o} save={save} />

      {o.shape === 'oneoff' ? <OneOffQuestions offer={o} save={save} /> : null}
      {o.shape === 'series' ? <SeriesQuestions offer={o} save={save} /> : null}
      {o.shape === 'anytime' ? <AnytimeQuestions offer={o} save={save} /> : null}
    </View>
  );
}

const idOf = (url: string) => url.split('/').pop() ?? null;

/** Where it happens: the four formats, and what each asks for (brief §7). */
function WhereBlock({ offer: o, save }: { offer: OwnOffer; save: (b: OfferInput) => Promise<OwnOffer | null> }) {
  const [place, setPlace] = useState<Place | null>(o.venueLabel ? { label: o.venueLabel, lat: o.venueLat ?? 0, lng: o.venueLng ?? 0 } : null);
  const [area, setArea] = useState(o.venueArea ?? '');
  const [notes, setNotes] = useState(o.venueNotes ?? '');
  const [radius, setRadius] = useState(str(o.travelRadiusMin));
  const [charge, setCharge] = useState(pounds(o.travelChargePence));
  const [platform, setPlatform] = useState(o.onlinePlatform ?? '');
  const venues: { key: OfferVenue; body: string }[] = [
    { key: 'their_place', body: 'Your home or studio' }, { key: 'your_place', body: 'You go to them' }, { key: 'out_about', body: 'A meeting point' }, { key: 'online', body: 'A call' },
  ];
  const pick = (p: Place | null) => {
    setPlace(p);
    if (!p) return;
    const town = p.locality ?? p.address?.town ?? p.label.split(',').slice(-2)[0]?.trim() ?? null;
    if (!area) setArea(town ? (o.venue === 'their_place' ? `central ${town}` : town) : '');
    void save({ venueLabel: p.formatted ?? p.label, venueLat: p.lat, venueLng: p.lng, venueCountry: p.countryCode ?? null, venueArea: area || (town ?? null) });
  };
  return (
    <Field label="Where it happens">
      <View style={styles.grid}>
        {venues.map((v) => {
          const on = o.venue === v.key;
          return (
            <Press key={v.key} onPress={() => void save({ venue: v.key })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.venue, on && styles.venueOn]}>
              <Icon name={VENUE_ICON[v.key]} size={18} color={colors.ink} />
              <Text style={type.h3}>{VENUE_LABEL[v.key]}</Text>
              <Text style={type.tiny}>{v.body}</Text>
            </Press>
          );
        })}
      </View>
      {o.venue !== 'online' ? (
        <>
          <PlacePicker value={place} onPick={pick} placeholder={o.venue === 'their_place' ? 'Your address — shown only once they have booked' : o.venue === 'your_place' ? 'Where you are based, so we can say how far you go' : 'The exact spot: a door, a bench, a café'} />
          <Row>
            <Text style={[type.small, { width: 118 }]}>Shown before booking</Text>
            <TextInput value={area} onChangeText={setArea} onBlur={() => void save({ venueArea: area || null })} placeholder="central Windsor" placeholderTextColor={colors.inkFaint} style={[styles.input, { flex: 1 }]} />
          </Row>
        </>
      ) : null}
      {o.venue === 'their_place' ? (
        <>
          <TextInput value={notes} onChangeText={setNotes} onBlur={() => void save({ venueNotes: notes || null })} multiline placeholder="Who else is in the house, stairs, a dog — what to expect" placeholderTextColor={colors.inkFaint} style={[styles.input, styles.multi]} />
          <Text style={type.tiny}>Guests see the exact address once they have booked; before that it shows as "{area || 'the area'}". Hosting at your place needs the Checked level.</Text>
        </>
      ) : null}
      {o.venue === 'your_place' ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Text style={type.small}>Within</Text><NumberBox value={radius} onChange={setRadius} onCommit={() => void save({ travelRadiusMin: num(radius) })} width={72} /><Text style={type.small}>min ·</Text>
          <NumberBox value={charge} onChange={setCharge} onCommit={() => void save({ travelChargePence: pence(charge) })} prefix="£" width={84} /><Text style={type.small}>beyond that</Text>
        </Row>
      ) : null}
      {o.venue === 'out_about' ? (
        <TextInput value={notes} onChangeText={setNotes} onBlur={() => void save({ venueNotes: notes || null })} placeholder="Meet outside, by the crooked door" placeholderTextColor={colors.inkFaint} style={styles.input} />
      ) : null}
      {o.venue === 'online' ? (
        <>
          <TextInput value={platform} onChangeText={setPlatform} onBlur={() => void save({ onlinePlatform: platform || null })} placeholder="A video call — Zoom, FaceTime, Meet" placeholderTextColor={colors.inkFaint} style={styles.input} />
          <Text style={type.tiny}>Marked clearly as a call, never an outing. The link goes out when they book.</Text>
        </>
      ) : null}
    </Field>
  );
}

/** One-off: a running order and who else will be there. */
function OneOffQuestions({ offer: o, save }: { offer: OwnOffer; save: (b: OfferInput) => Promise<OwnOffer | null> }) {
  const [rows, setRows] = useState<RunningOrderRow[]>(o.runningOrder);
  const [people, setPeople] = useState(o.featuredPeople.map((p) => ({ name: p.name, role: p.role ?? '' })));
  const [openDate, setOpenDate] = useState(false);
  const commitRows = (next: RunningOrderRow[]) => { setRows(next); void save({ runningOrder: next.filter((r) => r.title.trim()) }); };
  const commitPeople = (next: { name: string; role: string }[]) => { setPeople(next); void save({ featuredPeople: next.filter((p) => p.name.trim()).map((p) => ({ name: p.name, role: p.role || null })) }); };
  return (
    <>
      <Field label="When">
        <Press onPress={() => setOpenDate(!openDate)} accessibilityRole="button"><Row><Icon name="calendar" size={16} /><Text style={type.h3}>{o.startsOn ? dayLong(o.startsOn) : 'Pick the date'}</Text><Icon name={openDate ? 'collapse' : 'expand'} size={14} /></Row></Press>
        {openDate ? <DateRangePicker single start={o.startsOn} end={o.startsOn} onApply={(d) => { void save({ startsOn: d }); setOpenDate(false); }} /> : null}
        <Row><Text style={[type.small, { width: 64 }]}>Starts</Text><View style={{ flex: 1 }}><TimeField value={o.startsAt ?? ''} onChange={(t) => void save({ startsAt: t || null })} step={15} placeholder="14:00" label="Starts" /></View></Row>
      </Field>
      <Field label="The running order" hint="Guests read this as a programme.">
        {rows.map((r, i) => (
          <Row key={i} style={{ alignItems: 'flex-start' }}>
            <TextInput value={r.time ?? ''} onChangeText={(t) => setRows(rows.map((x, j) => (j === i ? { ...x, time: t } : x)))} onBlur={() => commitRows(rows)} placeholder="19:00" placeholderTextColor={colors.inkFaint} style={[styles.input, { width: 72, textAlign: 'center' }]} />
            <View style={{ flex: 1, gap: 4 }}>
              <TextInput value={r.title} onChangeText={(t) => setRows(rows.map((x, j) => (j === i ? { ...x, title: t } : x)))} onBlur={() => commitRows(rows)} placeholder="Arrival and a drink" placeholderTextColor={colors.inkFaint} style={styles.input} />
              <TextInput value={r.detail ?? ''} onChangeText={(t) => setRows(rows.map((x, j) => (j === i ? { ...x, detail: t } : x)))} onBlur={() => commitRows(rows)} placeholder="In the studio · 30 min" placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 36, fontSize: 13 }]} />
            </View>
            <Press onPress={() => commitRows(rows.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel="Remove" hitSlop={8} style={{ paddingTop: 12 }}><Icon name="close" size={16} color={colors.inkMuted} /></Press>
          </Row>
        ))}
        <AddRow label="Add to the running order" onPress={() => setRows([...rows, { time: '', title: '', detail: '' }])} />
      </Field>
      <Field label="Who else will be there" hint='Guests see this as "who you’ll meet".'>
        {people.map((p, i) => (
          <Row key={i}>
            <TextInput value={p.name} onChangeText={(t) => setPeople(people.map((x, j) => (j === i ? { ...x, name: t } : x)))} onBlur={() => commitPeople(people)} placeholder="Ollie Hart" placeholderTextColor={colors.inkFaint} style={[styles.input, { flex: 1 }]} />
            <TextInput value={p.role} onChangeText={(t) => setPeople(people.map((x, j) => (j === i ? { ...x, role: t } : x)))} onBlur={() => commitPeople(people)} placeholder="Forager · 20 years in these woods" placeholderTextColor={colors.inkFaint} style={[styles.input, { flex: 1.4 }]} />
            <Press onPress={() => commitPeople(people.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel="Remove" hitSlop={8}><Icon name="close" size={16} color={colors.inkMuted} /></Press>
          </Row>
        ))}
        <AddRow label="Add someone" onPress={() => setPeople([...people, { name: '', role: '' }])} />
      </Field>
    </>
  );
}

/** Series: the outcome first, then the arc, then the weeks, then joining. */
function SeriesQuestions({ offer: o, save }: { offer: OwnOffer; save: (b: OfferInput) => Promise<OwnOffer | null> }) {
  const [outcome, setOutcome] = useState(o.outcome ?? '');
  const [arc, setArc] = useState(o.arc ?? '');
  const [weeks, setWeeks] = useState<Week[]>(o.weeks);
  const [sessions, setSessions] = useState(str(o.sessions));
  const [dropIn, setDropIn] = useState(pounds(o.dropInPence));
  const [missed, setMissed] = useState(o.missedNote ?? '');
  const [openDate, setOpenDate] = useState(false);
  const commitWeeks = (next: Week[]) => { setWeeks(next); void save({ weeks: next.filter((w) => w.title.trim()).map((w, i) => ({ n: i + 1, title: w.title })) }); };
  const dates = o.dates;
  return (
    <>
      <Field label="What they will be able to do by the end" hint="This is what sells a ten-week commitment.">
        <TextInput value={outcome} onChangeText={setOutcome} onBlur={() => void save({ outcome })} multiline placeholder="Paint a landscape from life in one sitting, and know when to stop." placeholderTextColor={colors.inkFaint} style={[styles.input, styles.multi]} />
      </Field>
      <Field label="How it develops">
        <TextInput value={arc} onChangeText={setArc} onBlur={() => void save({ arc })} multiline placeholder="We start with tone and shape, then colour, then out into the park for the last three." placeholderTextColor={colors.inkFaint} style={[styles.input, styles.multi]} />
      </Field>
      <Field label="Your series">
        <Row style={{ flexWrap: 'wrap' }}>
          <Text style={type.small}>Every</Text>
          <View style={{ flex: 1, minWidth: 160 }}>
            <Segmented value={String(o.weekday ?? (o.firstDate ? new Date(`${o.firstDate}T12:00:00`).getDay() : 4))} options={DAYS.map((d) => ({ value: String(d.n), label: d.l }))} onChange={(v) => void save({ weekday: Number(v) })} />
          </View>
        </Row>
        <Row><Text style={[type.small, { width: 64 }]}>At</Text><View style={{ flex: 1 }}><TimeField value={o.startsAt ?? ''} onChange={(t) => void save({ startsAt: t || null })} step={15} placeholder="19:00" label="At" /></View></Row>
        <Press onPress={() => setOpenDate(!openDate)} accessibilityRole="button"><Row><Text style={[type.small, { width: 64 }]}>Starting</Text><Icon name="calendar" size={16} /><Text style={type.h3}>{o.firstDate ? dayLong(o.firstDate) : 'Pick the first date'}</Text></Row></Press>
        {openDate ? <DateRangePicker single start={o.firstDate} end={o.firstDate} onApply={(d) => { void save({ firstDate: d, weekday: new Date(`${d}T12:00:00`).getDay() }); setOpenDate(false); }} /> : null}
        <Row><Text style={[type.small, { width: 64 }]}>Sessions</Text><NumberBox value={sessions} onChange={setSessions} onCommit={() => void save({ sessions: num(sessions) })} width={72} /></Row>
        {dates.length ? (
          <>
            <Text style={type.small}>The {dates.length} {weekdayName(new Date(`${dates[0]}T12:00:00`).getDay())}s. Tap a date to skip it — half term, in this case.</Text>
            <Wrap>
              {allDates(o).map((d) => {
                const skipped = o.skippedDates.includes(d);
                return <Press key={d} onPress={() => void save({ skippedDates: skipped ? o.skippedDates.filter((x) => x !== d) : [...o.skippedDates, d] })} accessibilityRole="button" accessibilityState={{ selected: !skipped }} style={[styles.pill, skipped && { opacity: 0.4 }]}><Text style={[styles.pillText, skipped && { textDecorationLine: 'line-through' }]}>{new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text></Press>;
              })}
            </Wrap>
          </>
        ) : null}
      </Field>
      <Field label={`The ${o.sessions ?? ''} weeks`} hint="Keep it light if you like.">
        {weeks.map((w, i) => (
          <Row key={i}>
            <Text style={[type.tiny, { width: 56, fontWeight: '700' }]}>WEEK {i + 1}</Text>
            <TextInput value={w.title} onChangeText={(t) => setWeeks(weeks.map((x, j) => (j === i ? { ...x, title: t } : x)))} onBlur={() => commitWeeks(weeks)} placeholder="Seeing tone, not things" placeholderTextColor={colors.inkFaint} style={[styles.input, { flex: 1 }]} />
            <Press onPress={() => commitWeeks(weeks.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel="Remove" hitSlop={8}><Icon name="close" size={16} color={colors.inkMuted} /></Press>
          </Row>
        ))}
        <AddRow label={`Add week ${weeks.length + 1}`} onPress={() => setWeeks([...weeks, { n: weeks.length + 1, title: '' }])} />
      </Field>
      <Field label="How people join">
        <Segmented value={o.joinMode ?? 'whole'} options={[{ value: 'whole', label: 'The whole series' }, { value: 'drop_in', label: 'Drop in' }, { value: 'both', label: 'Both' }]} onChange={(v) => void save({ joinMode: v as any })} />
        <Text style={type.small}>{o.joinMode === 'drop_in' ? 'Pay per session, come when they can.' : o.joinMode === 'both' ? 'One booking for the run, or a session at a time.' : 'One booking, all the sessions.'}</Text>
        {o.joinMode && o.joinMode !== 'whole' ? <Row><NumberBox value={dropIn} onChange={setDropIn} onCommit={() => void save({ dropInPence: pence(dropIn) })} prefix="£" width={96} /><Text style={type.small}>a session, to drop in</Text></Row> : null}
        <TextInput value={missed} onChangeText={setMissed} onBlur={() => void save({ missedNote: missed || null })} placeholder="Miss a week and we tell you what you missed — no refund for single sessions." placeholderTextColor={colors.inkFaint} style={styles.input} />
      </Field>
    </>
  );
}

/** Every candidate date including the skipped ones, so a skipped one can be put back. */
function allDates(o: OwnOffer): string[] {
  if (!o.firstDate || !o.sessions) return [];
  const out: string[] = [];
  const d = new Date(`${o.firstDate}T12:00:00`);
  const wanted = o.sessions + o.skippedDates.length;
  for (let i = 0; i < wanted && i < 60; i++) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 7); }
  return out;
}

/** Anytime: a simple availability pattern — days and parts of the day. */
function AnytimeQuestions({ offer: o, save }: { offer: OwnOffer; save: (b: OfferInput) => Promise<OwnOffer | null> }) {
  const a: Availability = o.availability ?? {};
  const days = new Set(a.days ?? []);
  const parts = new Set(a.parts ?? []);
  const set = (next: Availability) => void save({ availability: next });
  return (
    <Field label="When you are free" hint="A simple pattern, not a diary. Guests pick a time from the next fortnight.">
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {DAYS.map((d) => {
          const on = days.has(d.n);
          return <Press key={d.n} onPress={() => { const n = new Set(days); if (on) n.delete(d.n); else n.add(d.n); set({ days: [...n], parts: [...parts] }); }} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.dayChip, on && styles.pillOn]}><Text style={[styles.pillText, on && { color: colors.selectedFg }]}>{d.l}</Text></Press>;
        })}
      </Row>
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {PARTS.map((p) => {
          const on = parts.has(p.k);
          return <Press key={p.k} onPress={() => { const n = new Set(parts); if (on) n.delete(p.k); else n.add(p.k); set({ days: [...days], parts: [...n] as any }); }} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.pill, on && styles.pillOn]}><Text style={[styles.pillText, on && { color: colors.selectedFg }]}>{p.l}</Text></Press>;
        })}
      </Row>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// 3 · who, and how many — the group set-up's numbers, verbatim
// ---------------------------------------------------------------------------

function WhoStep({ offer: o, save }: { offer: OwnOffer; save: (b: OfferInput) => Promise<OwnOffer | null> }) {
  const [at, setAt] = useState<'minimum' | 'expecting' | 'maximum' | null>(null);
  const [min, setMin] = useState(str(o.minCount));
  const [exp, setExp] = useState(str(o.expectedCount));
  const [max, setMax] = useState(str(o.maxCount));
  const commit = () => void save({ minCount: num(min), expectedCount: num(exp), maxCount: num(max) });
  const party = o.partyMax == null ? 'any' : String(o.partyMax);
  return (
    <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
      <Row style={{ gap: spacing.lg }}>
        {[{ k: 'minimum', l: 'Minimum', v: min, s: setMin }, { k: 'expecting', l: 'Expecting', v: exp, s: setExp }, { k: 'maximum', l: 'Maximum', v: max, s: setMax }].map((f) => (
          <View key={f.k} style={{ flex: 1 }}>
            <Text style={type.label}>{f.l}</Text>
            <NumberBox value={f.v} onChange={f.s} onCommit={commit} onFocus={() => setAt(f.k as any)} width={undefined as any} />
          </View>
        ))}
      </Row>
      <SizePanel min={num(min)} expected={num(exp)} max={num(max)} priceMode={o.priceMode} pricePence={o.pricePence} totalPence={o.totalPence} at={at} />
      <Field label="Party size" hint="The most one booking can bring.">
        <Segmented value={party} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '4', label: '4' }, { value: '6', label: '6' }, { value: 'any', label: 'Any' }]} onChange={(v) => void save({ partyMax: v === 'any' ? null : Number(v) })} />
      </Field>
      <Field label="Age limit" hint="Set a limit and we ask for the age of everyone in the party at booking.">
        <Segmented value={o.ageLimit == null ? 'any' : String(o.ageLimit)} options={[{ value: 'any', label: 'Anyone' }, { value: '12', label: 'Over 12' }, { value: '16', label: 'Over 16' }, { value: '18', label: 'Over 18' }]} onChange={(v) => void save({ ageLimit: v === 'any' ? null : Number(v) })} />
      </Field>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 4 · price — Free / Same each / Depends on numbers, then Person / Household
// ---------------------------------------------------------------------------

function PriceStep({ offer: o, save }: { offer: OwnOffer; save: (b: OfferInput) => Promise<OwnOffer | null> }) {
  const [amount, setAmount] = useState(pounds(o.pricePence));
  const [total, setTotal] = useState(pounds(o.totalPence));
  const [includes, setIncludes] = useState(o.includes ?? '');
  const refunds: { key: RefundRule; title: string; body: string }[] = [
    { key: '24h', title: 'Full refund up to 24 hours before', body: 'Most hosts pick this' },
    { key: '7d', title: 'Full refund up to 7 days before', body: 'For things you buy in for' },
    { key: 'none', title: 'No refunds', body: 'Only for tickets you cannot return' },
  ];
  return (
    <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
      <Segmented value={o.priceMode} options={[{ value: 'free' as PriceMode, label: 'Free' }, { value: 'same_each' as PriceMode, label: 'Same each' }, { value: 'by_numbers' as PriceMode, label: 'Depends on numbers' }]} onChange={(v) => void save({ priceMode: v })} />
      {o.priceMode === 'same_each' ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <NumberBox value={amount} onChange={setAmount} onCommit={() => void save({ pricePence: pence(amount) })} prefix="£" width={110} />
          <Text style={type.small}>each ·</Text>
          <View style={{ width: 190 }}><Segmented value={o.per} options={[{ value: 'person', label: 'Person' }, { value: 'household', label: 'Household' }]} onChange={(v) => void save({ per: v })} /></View>
        </Row>
      ) : null}
      {o.priceMode === 'by_numbers' ? (
        <>
          <Row><NumberBox value={total} onChange={setTotal} onCommit={() => void save({ totalPence: pence(total) })} prefix="£" width={120} /><Text style={[type.small, { flex: 1 }]}>in total, split between whoever comes</Text></Row>
          <SizePanel min={o.minCount} expected={o.expectedCount} max={o.maxCount} priceMode={o.priceMode} pricePence={o.pricePence} totalPence={pence(total)} />
        </>
      ) : null}
      {o.priceMode === 'free' ? <Text style={type.small}>Free. The page says you are not doing this for money.</Text> : null}

      <Field label="What that includes">
        <TextInput value={includes} onChangeText={setIncludes} onBlur={() => void save({ includes: includes || null })} placeholder="The walk, the stories and the first round." placeholderTextColor={colors.inkFaint} style={styles.input} />
      </Field>

      {o.priceMode !== 'free' ? (
        <Field label="If they cancel">
          {refunds.map((r) => {
            const on = o.refundRule === r.key;
            return (
              <Press key={r.key} onPress={() => void save({ refundRule: r.key })} accessibilityRole="radio" accessibilityState={{ checked: on }} style={styles.radioRow}>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                <View style={{ flex: 1 }}><Text style={type.h3}>{r.title}</Text><Text style={type.small}>{r.body}</Text></View>
              </Press>
            );
          })}
        </Field>
      ) : null}

      <View style={styles.collects}>
        <Icon name="payout" size={16} color={colors.ink} />
        <Text style={[type.small, { flex: 1, color: colors.ink }]}>
          Epic collects, pays you out. {o.priceMode !== 'free' && o.pricePence ? `Guests see ${money(o.pricePence)} all in — no fee bolted on at the end. ` : ''}Your payout is shown before you publish.
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 5 · publish — the card as a guest sees it, then what has to be true first
// ---------------------------------------------------------------------------

function PublishStep({ offer: o, save, onEdit }: { offer: OwnOffer; save: (b: OfferInput) => Promise<OwnOffer | null>; onEdit: (step: number) => void }) {
  const { navigate } = useRouter();
  const [licence, setLicence] = useState(o.licenceNumber ?? '');
  const checks: { ok: boolean; title: string; body: string; step?: number }[] = [
    { ok: Boolean(o.video), title: o.video ? 'Your video is up' : 'No video for this yet', body: o.video ? 'Plays on the page' : 'People book the person. Record one from step 2.', step: 2 },
    { ok: o.priceMode === 'free' || o.money.fee.percent >= 0, title: "Epic's fee", body: o.money.fee.percent ? `${o.money.fee.percent}% — you keep ${money(o.money.fee.net)} at ${o.expectedCount ?? o.minCount ?? 1}` : 'TBC — you will see it here before it applies' },
  ];
  const regulated = o.regulated;
  const flagged = regulated && o.regulated?.answer === 'no_commentary' && /tour of|guided|monument|museum|duomo|colosseum|cathedral|heritage/i.test(`${o.title} ${o.description}`);
  return (
    <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.small}>Exactly what a stranger sees.</Text>
        <Press onPress={() => onEdit(2)} accessibilityRole="button"><Text style={[type.small, { color: colors.accent, fontWeight: '700' }]}>Edit</Text></Press>
      </Row>
      <ExperienceCard item={o} onOpen={() => (o.state === 'live' ? navigate(paths.experience(o.id)) : onEdit(2))} />
      <Text style={type.tiny}>{o.state === 'live' ? 'Tap to see the full page.' : 'The full page opens once it is live.'}</Text>

      {/* The regulated-city step (D2), only where guiding is a licensed profession. */}
      {regulated ? (
        <View style={styles.regulated}>
          <Kicker>PUBLISH IN {regulated.country.toUpperCase()}</Kicker>
          <Text style={type.h3}>One thing about hosting in {regulated.country}</Text>
          <Text style={type.small}>{regulated.country} reserves talking about historic and artistic sites for licensed guides — even one-to-one. Nothing stops you sharing a skill or taking someone to where you eat; it is commentary on monuments and museums that needs a licence.</Text>
          {[{ k: 'no_commentary', t: 'My offer includes no guided commentary on monuments, museums or heritage sites', b: 'Most Practitioner and Local offers' }, { k: 'licensed', t: 'I hold a licence to guide in this region', b: 'We will ask for the number and expiry' }].map((r) => {
            const on = o.regulated?.answer === r.k;
            return (
              <Press key={r.k} onPress={() => void save({ regulatedAnswer: r.k as any })} accessibilityRole="radio" accessibilityState={{ checked: on }} style={styles.radioRow}>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                <View style={{ flex: 1 }}><Text style={type.h3}>{r.t}</Text><Text style={type.small}>{r.b}</Text></View>
              </Press>
            );
          })}
          {o.regulated?.answer === 'licensed' ? <TextInput value={licence} onChangeText={setLicence} onBlur={() => void save({ licenceNumber: licence || null })} placeholder="Licence number" placeholderTextColor={colors.inkFaint} style={styles.input} /> : null}
          <Text style={type.tiny}>Wording that helps. "A morning cooking together" is fine. "A tour of the Duomo" is not.{flagged ? ' Your listing reads like the second — change the words before publishing.' : ' We flag anything in your listing that reads like the second.'}</Text>
        </View>
      ) : null}

      <Field label="Before you publish">
        {checks.map((c, i) => (
          <Row key={i} style={{ alignItems: 'flex-start', paddingVertical: 6 }}>
            <Icon name={c.ok ? 'check' : 'alert'} size={16} color={c.ok ? colors.accent : colors.inkMuted} />
            <View style={{ flex: 1 }}><Text style={type.h3}>{c.title}</Text><Text style={type.small}>{c.body}</Text></View>
            {c.step && !c.ok ? <Press onPress={() => onEdit(c.step!)} accessibilityRole="button"><Text style={[type.small, { color: colors.accent, fontWeight: '700' }]}>Fix</Text></Press> : null}
          </Row>
        ))}
        {o.blockers.map((b) => (
          <Row key={b} style={{ alignItems: 'flex-start', paddingVertical: 6 }}>
            <Icon name="alert" size={16} color={colors.overrun} />
            <Text style={[type.small, { flex: 1, color: colors.ink }]}>{b}</Text>
          </Row>
        ))}
      </Field>

      <Field label="Who can find it">
        <Segmented value={o.visibility} options={[{ value: 'public', label: 'Live · anyone can find it' }, { value: 'link', label: 'Link only' }]} onChange={(v) => void save({ visibility: v })} />
      </Field>

      {o.state === 'draft' && o.reviewNote ? (
        <View style={styles.reviewNote}>
          <Kicker>WHAT WE SAID LAST TIME</Kicker>
          <Text style={type.body}>{o.reviewNote}</Text>
        </View>
      ) : null}
      <Text style={type.small}>{o.state === 'live' ? 'This is live. Changes show the moment you save.' : 'A first listing is read by somebody at Epic — back within 48 hours. After that yours go live as you publish them.'}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={type.tiny}>{hint}</Text> : null}
    </View>
  );
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" style={styles.addRow}>
      <Icon name="add" size={16} color={colors.accent} />
      <Text style={[type.h3, { color: colors.accent }]}>{label}</Text>
    </Press>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: (Platform.OS === 'web' ? 'max(16px, calc(var(--epic-sat) + 10px))' : 16) as any, paddingBottom: 150, gap: spacing.sm },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  progress: { flexDirection: 'row', gap: 4, marginTop: spacing.sm, marginBottom: spacing.sm },
  bar: { flex: 1, height: 4, backgroundColor: colors.lineSoft },
  barOn: { backgroundColor: colors.selected },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, paddingBottom: (spacing.md + 8) as any, gap: 6, backgroundColor: colors.surface, borderTopWidth: BORDER, borderTopColor: colors.line },
  shape: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: BORDER, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  shapeOn: { borderColor: colors.ink, backgroundColor: colors.surfaceMuted },
  shapeIcon: { width: 40, height: 40, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  input: { minHeight: TARGET, paddingHorizontal: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink, fontFamily: fonts.body },
  multi: { minHeight: 88, paddingTop: 10 },
  pill: { paddingHorizontal: 12, height: 34, justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  pillOn: { backgroundColor: colors.selected },
  pillText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  dayChip: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  photo: { width: 84, height: 84, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.warm, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  photoAdd: { borderWidth: BORDER, borderStyle: 'dashed', borderColor: colors.ruleSoft, gap: 2 },
  photoX: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceMuted },
  videoIcon: { width: 40, height: 40, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  venue: { width: '48%', flexGrow: 1, padding: spacing.md, gap: 4, borderWidth: BORDER, borderColor: colors.ruleSoft, backgroundColor: colors.surface },
  venueOn: { borderColor: colors.ink, backgroundColor: colors.surfaceMuted },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  radioRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 8 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: BORDER, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioOn: { borderColor: colors.ink },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ink },
  collects: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceMuted },
  regulated: { padding: spacing.md, gap: spacing.sm, borderWidth: BORDER, borderColor: colors.ink },
  reviewNote: { padding: spacing.md, gap: 4, backgroundColor: colors.warm },
});
