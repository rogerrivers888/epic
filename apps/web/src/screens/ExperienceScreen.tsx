/**
 * One experience, as a guest sees it (Events v4 canvas E1 · E2 · E3, F1, F3).
 *
 * The video is the hero in all three shapes; what changes is the middle. A
 * one-off shows its running order and who you will meet. A series shows the
 * outcome in lime above the fold, then the arc, then the weeks — a progression,
 * not a repeated event. An anytime offer shows why them for this, the format
 * banner and a slot picker in place of a date.
 *
 * The page works logged-out: it is answered by a public endpoint and drawn
 * outside the shell, with no tab bar. What a session adds is the booking sheet
 * (`/experiences/<id>/book`) and, once booked, the exact address of the host's
 * place. `/experiences/<id>/where` is the four formats explained.
 *
 * Money: Epic cannot take a card yet, and every figure here says so rather
 * than pretending. A booking is recorded and honoured; nothing has left
 * anybody's account.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { api, Booking, Experience, PartyMember, PaymentsConfig } from '../api';
import { colors, fonts, spacing, TARGET, type, BORDER } from '../theme';
import { Button, Row, Segmented, StatusLine } from '../components/ui';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths, type Route } from '../routes';
import { signedIn } from '../session';
import { LockScreen } from './LockScreen';
import {
  HostFace, Kicker, NewOnEpic, RatingLine, REFUND_WORDS, ShapeChip, TRUST_LABEL, TrustBadge, TypeChip, VENUE_ICON, VENUE_LABEL, VideoHero,
  dateOnly, dayLong, dayShort, durationWords, money, needsLine, priceWords, venueWords,
} from '../components/hosting';

const WIDE = 900;

export function ExperienceScreen({ route }: { route: Extract<Route, { name: 'experience' }> }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, back } = useRouter();
  const [data, setData] = useState<{ offer: Experience; payments: PaymentsConfig } | null>(null);
  const [mine, setMine] = useState<{ bookings: Booking[]; party: PartyMember[]; you: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.experience(route.id));
      setError(null);
      if (signedIn()) api.experienceMine(route.id).then(setMine).catch(() => setMine(null));
    } catch (e: any) { setError(e.message); }
  }, [route.id]);
  useEffect(() => { void load(); }, [load]);

  if (error && !data) {
    return (
      <View style={styles.page}>
        <Wordmark height={30} />
        <Text style={type.h2}>Nothing at that address</Text>
        <Text style={type.small}>{error}</Text>
        <Button label="Take me home" kind="secondary" onPress={() => navigate(paths.inspire(), { replace: true })} />
      </View>
    );
  }
  if (!data) return <View style={styles.page}><Wordmark height={30} /><Text style={type.small}>Opening…</Text></View>;

  const { offer, payments } = data;
  const host = offer.host!;
  const booked = mine?.bookings.filter((b) => b.state !== 'cancelled') ?? [];
  const revealed = booked.length > 0;

  // --- the booking sheet, over the page -----------------------------------
  if (route.layer === 'book') {
    if (!signedIn()) {
      return (
        <View style={{ flex: 1 }}>
          <View style={[styles.gutter, { paddingTop: spacing.md, gap: 4 }]}>
            <Press onPress={() => back(paths.experience(offer.id))} accessibilityRole="button"><Row><Icon name="back" size={18} /><Text style={type.h3}>{offer.title}</Text></Row></Press>
            <Text style={type.small}>Booking needs an Epic account, so the host knows who is coming and your booking lands in Trips. Sign in, or ask for a link.</Text>
          </View>
          <LockScreen onIn={() => void load()} />
        </View>
      );
    }
    return (
      <BookSheet
        offer={offer} payments={payments} party={mine?.party ?? []} you={mine?.you ?? null} wide={wide}
        onBack={() => back(paths.experience(offer.id))}
        onBooked={(b) => navigate(paths.booking(b.id), { replace: true })}
      />
    );
  }

  if (route.layer === 'where') {
    return <WhereItHappens offer={offer} revealed={revealed} onBack={() => back(paths.experience(offer.id))} wide={wide} />;
  }

  const paused = offer.state === 'paused';
  const ended = offer.state === 'ended';
  const full = offer.standing.full;
  const cta = ended ? 'This one is off'
    : paused ? `Paused${offer.pausedUntil ? ` · back ${dateOnly(offer.pausedUntil)}` : ''}`
      : full ? 'Full · join the waiting list'
        : offer.shape === 'series' ? `Join the ${offer.sessions ?? ''} weeks · ${money(offer.pricePence)}`
          : offer.shape === 'anytime' ? 'Pick a time'
            : `Book a place · ${priceWords(offer)}`;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.scrollWide]}>
        {/* Back on the left, Share on the right, both over the video. */}
        <VideoHero
          src={offer.video ?? host.introVideo} poster={offer.photos[0] ?? host.photo} height={wide ? 360 : 280}
          label={offer.video ? `${host.name.split(' ')[0]} on this` : `${host.name.split(' ')[0]} says hello`}
          badge={<><ShapeChip shape={offer.shape} /><TypeChip type={host.type} localKind={host.localKind} /></>}
          badgeInset={44}
        />
        <View style={styles.overBar}>
          <Press onPress={() => back(paths.inspire())} accessibilityRole="button" accessibilityLabel="Back" style={styles.overBtn}><Icon name="back" size={18} color={colors.ink} /></Press>
          <Press onPress={() => share(offer)} accessibilityRole="button" accessibilityLabel="Share" style={styles.overBtn}><Icon name="share" size={16} color={colors.ink} /></Press>
        </View>

        <View style={styles.gutter}>
          <Text style={type.title}>{offer.title}</Text>
          <Text style={[type.small, { marginTop: 4 }]}>{headline(offer)}</Text>

          {/* The host block: person first, trust level beside them. */}
          <Press onPress={() => navigate(paths.hostProfile(host.id))} accessibilityRole="button" style={styles.hostRow}>
            <HostFace host={host} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.h3}>{host.name}</Text>
              <RatingLine host={host} />
            </View>
            <TrustBadge trust={host.trust} checks={host.checks} />
          </Press>
          <Row style={{ marginTop: spacing.sm, justifyContent: 'space-between' }}>
            {host.isNew ? <NewOnEpic /> : <View />}
            <Press onPress={() => navigate(paths.hostTrust(host.id))} accessibilityRole="button"><Text style={styles.link}>What {host.checks === 'running' ? 'checks running' : TRUST_LABEL[host.trust]} means ›</Text></Press>
          </Row>

          {/* What changes by shape. */}
          {offer.shape === 'oneoff' ? <OneOffBody offer={offer} /> : offer.shape === 'series' ? <SeriesBody offer={offer} /> : <AnytimeBody offer={offer} onPick={() => navigate(paths.experienceBook(offer.id))} />}

          {/* Where it happens, in the format's own words, with the door to the four. */}
          <View style={styles.block}>
            <Kicker>{VENUE_LABEL[offer.venue].toUpperCase()}</Kicker>
            <Row style={{ alignItems: 'flex-start' }}>
              <Icon name={VENUE_ICON[offer.venue]} size={18} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.h3}>{whereTitle(offer, host.name, revealed)}</Text>
                <Text style={type.small}>{whereBody(offer, host.name, revealed)}</Text>
              </View>
            </Row>
            <Press onPress={() => navigate(paths.experienceWhere(offer.id))} accessibilityRole="button"><Text style={styles.link}>How the four formats work ›</Text></Press>
          </View>

          {offer.includes ? (
            <View style={styles.block}><Kicker>WHAT IS INCLUDED</Kicker><Text style={type.body}>{offer.includes}</Text></View>
          ) : null}

          {/* The money and the minimum, in one plain block. */}
          <View style={styles.priceBlock}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={type.title}>{priceWords(offer)}</Text>
              {offer.shape === 'series' && offer.dropInPence && offer.joinMode !== 'whole' ? <Text style={type.small}>Or {money(offer.dropInPence)} to drop into one</Text> : null}
              {offer.shape === 'anytime' ? <Text style={type.small}>{offer.partyMax ? `For up to ${offer.partyMax} of you` : 'For your party'}</Text> : null}
            </Row>
            {offer.priceMode === 'by_numbers' ? <Text style={type.small}>Depends on numbers: never more than {money(offer.price.ceilingPence)} each.</Text> : null}
            {needsLine(offer) ? <Text style={[type.small, { color: colors.ink, fontWeight: '600' }]}>{needsLine(offer)}</Text> : null}
            <Text style={type.small}>
              {REFUND_WORDS[offer.refundRule]}.{offer.minCount ? ` Under ${offer.minCount} and it is called off — everybody is told and nothing is taken.` : ''}
            </Text>
            {offer.ageLimit ? <Text style={type.small}>Over {offer.ageLimit}s only. We ask for the age of everyone in the party when you book.</Text> : null}
          </View>

          {booked.length ? (
            <Press onPress={() => navigate(paths.booking(booked[0].id))} accessibilityRole="button" style={styles.mineRow}>
              <Icon name="booked" size={16} color={colors.accent} />
              <Text style={[type.small, { flex: 1, color: colors.ink }]}>You are {booked[0].state === 'pending' ? 'held on this' : 'booked on this'} — {booked[0].heads} of you.</Text>
              <Icon name="more" size={16} color={colors.inkMuted} />
            </Press>
          ) : null}

          {/* Report, on every page. */}
          {reporting ? <ReportBox hostId={host.id} offerId={offer.id} onDone={() => setReporting(false)} /> : (
            <Text style={[type.tiny, { marginTop: spacing.lg }]}>
              No account needed to look · <Text style={{ color: colors.accent, fontWeight: '700' }} onPress={() => setReporting(true)}>report this listing</Text>
            </Text>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, wide && styles.footerWide]}>
        <Button
          label={cta}
          icon={full ? 'hours' : offer.shape === 'anytime' ? 'calendar' : 'forward'}
          disabled={ended || paused}
          onPress={() => navigate(paths.experienceBook(offer.id))}
        />
        <Text style={[type.tiny, { textAlign: 'center' }]}>{ended ? offer.cancelledNote ?? 'Called off.' : paused ? 'Not taking bookings just now.' : payments.ready ? 'Card charged when it is certain.' : 'Nothing is charged yet — a booking is recorded and honoured.'}</Text>
      </View>
    </View>
  );
}

const headline = (o: Experience) => {
  const dur = durationWords(o.durationMin);
  if (o.shape === 'oneoff') return [o.startsOn ? dayShort(o.startsOn) : null, o.startsAt, dur, venueWords(o)].filter(Boolean).join(' · ');
  if (o.shape === 'series') return [o.firstDate ? `From ${dateOnly(o.firstDate)}` : null, o.startsAt, o.sessions ? `${o.sessions} weeks` : null, venueWords(o)].filter(Boolean).join(' · ');
  return ['Book a slot', dur, venueWords(o)].filter(Boolean).join(' · ');
};

async function share(o: Experience) {
  const nav: any = (globalThis as any).navigator;
  const url = typeof window !== 'undefined' ? window.location.href : '';
  try {
    if (nav?.share) await nav.share({ title: o.title ?? 'An experience on Epic', url });
    else if (nav?.clipboard) await nav.clipboard.writeText(url);
  } catch { /* the sheet was closed */ }
}

// ---------------------------------------------------------------------------
// the middle, by shape
// ---------------------------------------------------------------------------

function OneOffBody({ offer }: { offer: Experience }) {
  return (
    <>
      {offer.description ? <Text style={[type.body, { marginTop: spacing.md }]}>{offer.description}</Text> : null}
      {offer.runningOrder.length ? (
        <View style={styles.block}>
          <Kicker>THE RUNNING ORDER</Kicker>
          {offer.runningOrder.map((r, i) => (
            <Row key={i} style={styles.orderRow}>
              <Text style={styles.orderTime}>{r.time ?? ''}</Text>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={type.h3}>{r.title}</Text>
                {r.detail ? <Text style={type.small}>{r.detail}</Text> : null}
              </View>
            </Row>
          ))}
        </View>
      ) : null}
      {offer.featuredPeople.length ? (
        <View style={styles.block}>
          <Kicker>WHO YOU WILL MEET</Kicker>
          <Row style={{ flexWrap: 'wrap', gap: spacing.md }}>
            {offer.featuredPeople.map((p, i) => (
              <View key={i} style={{ alignItems: 'center', gap: 4, width: 92 }}>
                <HostFace host={{ name: p.name, photo: p.photo }} size={56} />
                <Text style={[type.h3, { textAlign: 'center' }]} numberOfLines={1}>{p.name.split(' ')[0]}</Text>
                {p.role ? <Text style={[type.tiny, { textAlign: 'center' }]} numberOfLines={2}>{p.role}</Text> : null}
              </View>
            ))}
          </Row>
        </View>
      ) : null}
    </>
  );
}

function SeriesBody({ offer }: { offer: Experience }) {
  const [all, setAll] = useState(false);
  const weeks = all ? offer.weeks : offer.weeks.slice(0, 4);
  return (
    <>
      {offer.outcome ? (
        <View style={styles.outcome}>
          <Text style={[styles.outcomeKicker]}>BY THE END</Text>
          <Text style={styles.outcomeText}>{offer.outcome}</Text>
        </View>
      ) : null}
      {offer.arc ? <Text style={[type.body, { marginTop: spacing.md }]}>{offer.arc}</Text> : null}
      {offer.description && !offer.arc ? <Text style={[type.body, { marginTop: spacing.md }]}>{offer.description}</Text> : null}
      <View style={styles.block}>
        <Kicker>THE {offer.sessions ?? offer.dates.length} WEEKS</Kicker>
        {weeks.length ? weeks.map((w) => (
          <Row key={w.n} style={styles.weekRow}>
            <Text style={styles.weekN}>WEEK {w.n}</Text>
            <Text style={[type.h3, { flex: 1 }]}>{w.title}</Text>
          </Row>
        )) : offer.dates.slice(0, 4).map((d, i) => (
          <Row key={d} style={styles.weekRow}>
            <Text style={styles.weekN}>WEEK {i + 1}</Text>
            <Text style={[type.h3, { flex: 1 }]}>{dayShort(d)}</Text>
          </Row>
        ))}
        {!all && offer.weeks.length > 4 ? (
          <Press onPress={() => setAll(true)} accessibilityRole="button"><Text style={styles.link}>{offer.weeks.length - 4} more week{offer.weeks.length - 4 === 1 ? '' : 's'} ›</Text></Press>
        ) : null}
        {offer.dates.length ? <Text style={type.tiny}>{offer.dates.map(dateOnly).join(' · ')}</Text> : null}
      </View>
      {offer.missedNote || offer.joinMode ? (
        <Text style={[type.small, { marginTop: spacing.sm }]}>
          {offer.joinMode === 'whole' ? 'Booked as the whole run. ' : offer.joinMode === 'drop_in' ? 'Drop into any session. ' : 'Join the whole run, or drop into a session. '}
          {offer.missedNote ?? ''}
        </Text>
      ) : null}
    </>
  );
}

function AnytimeBody({ offer, onPick }: { offer: Experience; onPick: () => void }) {
  return (
    <>
      {offer.venue === 'online' ? (
        <View style={styles.onlineBanner}>
          <Icon name="online" size={16} color={colors.ink} />
          <Text style={[type.small, { flex: 1, color: colors.ink }]}>Online. {offer.onlinePlatform ?? 'A video call'}, not an outing. UK time · link sent when you book.</Text>
        </View>
      ) : null}
      <View style={styles.block}>
        <Kicker>WHY {(offer.host?.name.split(' ')[0] ?? 'THEM').toUpperCase()}, FOR THIS</Kicker>
        <Text style={type.body}>{offer.whyYou ?? offer.description}</Text>
      </View>
      {offer.description && offer.whyYou ? <Text style={type.body}>{offer.description}</Text> : null}
      <View style={styles.block}>
        <Kicker>PICK A TIME</Kicker>
        {offer.slots.length ? (
          <>
            <Row style={{ flexWrap: 'wrap' }}>
              {offer.slots.slice(0, 6).map((d) => (
                <Press key={d.date} onPress={onPick} accessibilityRole="button" style={styles.dayBox}>
                  <Text style={type.tiny}>{new Date(`${d.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</Text>
                  <Text style={[type.h2, { fontSize: 18 }]}>{new Date(`${d.date}T12:00:00`).getDate()}</Text>
                </Press>
              ))}
            </Row>
            <Text style={type.small}>{offer.slots[0].times.join(' · ')} on {dayShort(offer.slots[0].date)}, and more on the sheet.</Text>
          </>
        ) : <Text style={type.small}>No free times in the next fortnight. Check back, or ask on the booking sheet.</Text>}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// where it happens (F1): what each format shows before and after booking
// ---------------------------------------------------------------------------

const whereTitle = (o: Experience, host: string, revealed: boolean) => {
  const first = host.split(' ')[0];
  if (o.venue === 'their_place') return revealed && o.venueLabel ? o.venueLabel : `${first}'s place, ${o.venueArea ?? 'nearby'}`;
  if (o.venue === 'your_place') return `${first} comes to you`;
  if (o.venue === 'online') return `${o.onlinePlatform ?? 'A video call'} · UK time`;
  return o.venueLabel ?? o.venueArea ?? 'A meeting point';
};
const whereBody = (o: Experience, host: string, revealed: boolean) => {
  const first = host.split(' ')[0];
  if (o.venue === 'their_place') return `${revealed ? 'The address is yours now that you are booked.' : 'Full address once you have booked.'}${o.venueNotes ? ` ${o.venueNotes}` : ''}`;
  if (o.venue === 'your_place') return `Anywhere within ${o.travelRadiusMin ?? 30} minutes of ${o.venueArea ?? 'where they are'}. We will ask for the address and how to get in when you book.${o.travelChargePence ? ` Travel included up to ${o.travelRadiusMin ?? 30} min · ${money(o.travelChargePence)} beyond.` : ''}`;
  if (o.venue === 'online') return 'Link sent when you book. This is a call, not an outing — nothing to travel to.';
  return o.venueNotes ?? `Meet ${first} at the spot. The pin is on the booking.`;
};

function WhereItHappens({ offer, revealed, onBack, wide }: { offer: Experience; revealed: boolean; onBack: () => void; wide: boolean }) {
  const host = offer.host!;
  const formats: { key: Experience['venue']; title: string; body: string; foot: string | null }[] = [
    { key: 'their_place', title: whereTitle({ ...offer, venue: 'their_place' }, host.name, revealed), body: 'Their home or studio. The area and a rough pin before you book; the full address, who else is in the house and how to get in after. Hosts at their place hold the Checked level.', foot: offer.venue === 'their_place' ? `Checked host${offer.venueNotes ? ` · ${offer.venueNotes}` : ''}` : null },
    { key: 'your_place', title: `${host.name.split(' ')[0]} comes to you`, body: `The host comes to where you are staying. We ask for the address and how to get in on the booking sheet.`, foot: offer.venue === 'your_place' ? whereBody(offer, host.name, revealed) : null },
    { key: 'out_about', title: offer.venue === 'out_about' ? (offer.venueLabel ?? 'A meeting point') : 'A meeting point', body: 'A named spot on the map with a photo of it, so you know the door to stand by.', foot: offer.venue === 'out_about' ? offer.venueNotes : null },
    { key: 'online', title: 'A video call · UK time', body: 'A call, not an outing. The link is sent when you book, and nothing is travelled to.', foot: offer.venue === 'online' ? (offer.onlinePlatform ?? 'A video call') : null },
  ];
  return (
    <ScrollView contentContainerStyle={[styles.scroll, styles.gutter, wide && styles.scrollWide, { paddingTop: spacing.lg }]}>
      <Press onPress={onBack} accessibilityRole="button"><Row><Icon name="back" size={18} /><Text style={type.h3}>Back to the listing</Text></Row></Press>
      <Text style={[type.title, { marginTop: spacing.md }]}>Where it happens</Text>
      <Text style={type.small}>The four formats, and how the "where" block reads in each. This one is <Text style={{ fontWeight: '700', color: colors.ink }}>{VENUE_LABEL[offer.venue].toLowerCase()}</Text>.</Text>
      {formats.map((f) => (
        <View key={f.key} style={[styles.formatCard, f.key === offer.venue && styles.formatCardOn]}>
          <Row><Icon name={VENUE_ICON[f.key]} size={16} /><Kicker>{VENUE_LABEL[f.key].toUpperCase()}</Kicker></Row>
          <Text style={type.h3}>{f.title}</Text>
          <Text style={type.small}>{f.body}</Text>
          {f.foot ? <Text style={[type.small, { color: colors.accent }]}>{f.foot}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// the booking sheet (F3)
// ---------------------------------------------------------------------------

function BookSheet({ offer, payments, party, you, wide, onBack, onBooked }: {
  offer: Experience; payments: PaymentsConfig; party: PartyMember[]; you: string | null; wide: boolean;
  onBack: () => void; onBooked: (b: Booking) => void;
}) {
  const host = offer.host!;
  const first = host.name.split(' ')[0];
  const [coming, setComing] = useState<Set<string>>(() => new Set(party.filter((p) => !blocked(offer, p)).map((p) => p.id ?? p.name)));
  useEffect(() => { setComing(new Set(party.filter((p) => !blocked(offer, p)).map((p) => p.id ?? p.name))); }, [party.length]);
  const [extra, setExtra] = useState<PartyMember[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAge, setNewAge] = useState('');
  const [note, setNote] = useState('');
  const [address, setAddress] = useState('');
  const [access, setAccess] = useState('');
  const [occurrence, setOccurrence] = useState<string | null>(offer.shape === 'series' ? (offer.joinMode === 'drop_in' ? offer.dates[0] ?? null : 'whole') : null);
  const [slotDay, setSlotDay] = useState<string | null>(offer.slots[0]?.date ?? null);
  const [slotTime, setSlotTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const everyone = [...party, ...extra];
  const chosen = everyone.filter((p) => coming.has(p.id ?? p.name));
  const heads = chosen.length;
  const perHead = offer.per === 'person';
  const each = offer.shape === 'series' && occurrence && occurrence !== 'whole' && offer.dropInPence ? offer.dropInPence : offer.price.each;
  const total = offer.priceMode === 'free' ? 0 : each * (perHead ? Math.max(1, heads) : 1);
  const willRun = !offer.standing.minimum || offer.standing.heads + heads >= offer.standing.minimum;
  const slot = offer.shape === 'anytime' && slotDay && slotTime ? `${slotDay}T${slotTime}` : null;
  const ready = heads > 0 && (offer.shape !== 'anytime' || slot) && (offer.venue !== 'your_place' || address.trim()) && !busy;

  const toggle = (p: PartyMember) => {
    if (blocked(offer, p)) return;
    const k = p.id ?? p.name;
    setComing((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  };

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.bookExperience(offer.id, {
        party: chosen.map((p) => ({ name: p.name, age: p.age, child: p.child })),
        occurrence: offer.shape === 'anytime' ? slot : occurrence,
        bookedBy: you, noteToHost: note.trim() || null,
        address: offer.venue === 'your_place' ? address.trim() : null, accessNotes: offer.venue === 'your_place' ? access.trim() || null : null,
      });
      onBooked(r.booking);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.scroll, styles.gutter, wide && styles.scrollWide, { paddingTop: spacing.lg }]} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Press onPress={onBack} accessibilityRole="button"><Row><Icon name="back" size={18} /><Text style={type.h3}>Book this</Text></Row></Press>
          <Wordmark height={24} />
        </Row>
        <Text style={[type.title, { marginTop: spacing.md }]}>{offer.title}</Text>
        <Text style={type.small}>{headline(offer)}</Text>

        {/* Which instance, where the shape has more than one. */}
        {offer.shape === 'series' && offer.joinMode !== 'whole' ? (
          <View style={styles.block}>
            <Kicker>WHICH</Kicker>
            <Segmented
              value={occurrence === 'whole' ? 'whole' : 'one'}
              options={[...(offer.joinMode !== 'drop_in' ? [{ value: 'whole', label: `The whole run · ${money(offer.pricePence)}` }] : []), { value: 'one', label: `One session · ${money(offer.dropInPence)}` }]}
              onChange={(v) => setOccurrence(v === 'whole' ? 'whole' : offer.dates[0] ?? null)}
            />
            {occurrence !== 'whole' ? (
              <Row style={{ flexWrap: 'wrap' }}>
                {offer.dates.map((d) => (
                  <Press key={d} onPress={() => setOccurrence(d)} accessibilityRole="button" style={[styles.dayBox, occurrence === d && styles.dayBoxOn]}>
                    <Text style={type.tiny}>{new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</Text>
                    <Text style={[type.h2, { fontSize: 18 }, occurrence === d && { color: colors.selectedFg }]}>{new Date(`${d}T12:00:00`).getDate()}</Text>
                  </Press>
                ))}
              </Row>
            ) : null}
          </View>
        ) : null}
        {offer.shape === 'anytime' ? (
          <View style={styles.block}>
            <Kicker>PICK A TIME</Kicker>
            {offer.slots.length ? (
              <>
                <Row style={{ flexWrap: 'wrap' }}>
                  {offer.slots.map((d) => (
                    <Press key={d.date} onPress={() => { setSlotDay(d.date); setSlotTime(null); }} accessibilityRole="button" style={[styles.dayBox, slotDay === d.date && styles.dayBoxOn]}>
                      <Text style={[type.tiny, slotDay === d.date && { color: colors.selectedFg }]}>{new Date(`${d.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</Text>
                      <Text style={[type.h2, { fontSize: 18 }, slotDay === d.date && { color: colors.selectedFg }]}>{new Date(`${d.date}T12:00:00`).getDate()}</Text>
                    </Press>
                  ))}
                </Row>
                <Row style={{ flexWrap: 'wrap' }}>
                  {(offer.slots.find((d) => d.date === slotDay)?.times ?? []).map((t) => (
                    <Press key={t} onPress={() => setSlotTime(t)} accessibilityRole="button" style={[styles.timeBox, slotTime === t && styles.dayBoxOn]}>
                      <Text style={[type.h3, slotTime === t && { color: colors.selectedFg }]}>{t}</Text>
                    </Press>
                  ))}
                </Row>
              </>
            ) : <Text style={type.small}>No free times in the next fortnight.</Text>}
          </View>
        ) : null}

        {/* Who is coming, from the household. */}
        <View style={styles.block}>
          <Kicker>WHO IS COMING</Kicker>
          {everyone.map((p, i) => {
            const k = p.id ?? p.name;
            const out = blocked(offer, p);
            const on = coming.has(k);
            return (
              <Press key={k} onPress={() => toggle(p)} accessibilityRole="switch" accessibilityState={{ checked: on }} disabled={out} style={[styles.personRow, out && { opacity: 0.55 }]}>
                <HostFace host={{ name: p.name, photo: p.avatarUrl ?? null }} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={type.h3}>{p.name}</Text>
                  <Text style={type.small}>{i === 0 && you === p.name ? 'You · adult' : p.child ? `Child${p.age != null ? ` · ${p.age}` : ''}` : 'Adult'}</Text>
                </View>
                <View style={[styles.tick, on && !out && styles.tickOn]}>{on && !out ? <Icon name="check" size={14} color={colors.selectedFg} strokeWidth={3} /> : null}</View>
              </Press>
            );
          })}
          {everyone.some((p) => blocked(offer, p)) ? (
            <View style={styles.gateRow}>
              <Icon name="alert" size={14} color={colors.overrun} />
              <Text style={[type.small, { flex: 1, color: colors.overrun }]}>Over {offer.ageLimit} only — {everyone.filter((p) => blocked(offer, p)).map((p) => p.name.split(' ')[0]).join(' and ')} cannot come to this one.</Text>
            </View>
          ) : null}
          {offer.partyMax && heads > offer.partyMax ? <StatusLine tone="warn">The most one booking can bring is {offer.partyMax}.</StatusLine> : null}
          {adding ? (
            <View style={{ gap: spacing.sm }}>
              <TextInput value={newName} onChangeText={setNewName} placeholder="Their name" placeholderTextColor={colors.inkFaint} style={styles.input} autoFocus />
              <Row>
                <TextInput value={newAge} onChangeText={(t) => setNewAge(t.replace(/\D/g, '').slice(0, 2))} placeholder="Age" placeholderTextColor={colors.inkFaint} keyboardType="number-pad" style={[styles.input, { width: 84, textAlign: 'center' }]} />
                <Text style={[type.small, { flex: 1 }]}>Only needed where there is an age limit.</Text>
              </Row>
              <Row>
                <Button label="Add them" kind="secondary" onPress={() => {
                  if (!newName.trim()) return;
                  const age = newAge ? Number(newAge) : null;
                  const p: PartyMember = { name: newName.trim(), age, child: age != null && age < 18 };
                  setExtra([...extra, p]); setComing((c) => new Set([...c, p.name])); setNewName(''); setNewAge(''); setAdding(false);
                }} />
                <Button label="Cancel" kind="ghost" onPress={() => setAdding(false)} />
              </Row>
            </View>
          ) : (
            <Press onPress={() => setAdding(true)} accessibilityRole="button" style={{ paddingVertical: 6 }}><Row><Icon name="addPerson" size={16} color={colors.accent} /><Text style={[type.h3, { color: colors.accent }]}>Add someone</Text></Row></Press>
          )}
        </View>

        {offer.venue === 'your_place' ? (
          <View style={styles.block}>
            <Kicker>WHERE {first.toUpperCase()} SHOULD COME</Kicker>
            <TextInput value={address} onChangeText={setAddress} placeholder="The address you are staying at" placeholderTextColor={colors.inkFaint} style={styles.input} />
            <TextInput value={access} onChangeText={setAccess} placeholder="How to get in — gate code, which door, parking" placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 64, paddingTop: 10 }]} multiline />
          </View>
        ) : null}

        <View style={styles.block}>
          <Kicker>ANYTHING {first.toUpperCase()} SHOULD KNOW</Kicker>
          <TextInput value={note} onChangeText={setNote} placeholder="Allergies, a birthday, how much you have done before" placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 64, paddingTop: 10 }]} multiline />
        </View>

        {/* The price summary: all in, no fee bolted on. */}
        <View style={styles.summary}>
          {offer.priceMode === 'free' ? <Text style={type.h3}>Free · {first} is not doing this for money</Text> : (
            <>
              <Row style={{ justifyContent: 'space-between' }}><Text style={type.body}>{perHead ? `${Math.max(1, heads)} × ${money(each)}` : money(each)}</Text><Text style={type.body}>{money(total)}</Text></Row>
              <Row style={{ justifyContent: 'space-between' }}><Text style={type.small}>Epic fee included</Text><Text style={type.small}>—</Text></Row>
              <Row style={{ justifyContent: 'space-between', borderTopWidth: BORDER, borderTopColor: colors.line, paddingTop: 6 }}>
                <Text style={type.h3}>{willRun ? (payments.ready ? 'Pay now' : 'Recorded now') : 'Held until it is certain'}</Text>
                <Text style={type.h3}>{money(total)}</Text>
              </Row>
            </>
          )}
          <Text style={type.small}>
            {offer.standing.minimum
              ? willRun
                ? `Needs ${offer.standing.minimum} people. You are number ${offer.standing.heads + heads}, so it is going ahead. `
                : `Needs ${offer.standing.minimum} people and ${offer.standing.heads} ${offer.standing.heads === 1 ? 'is' : 'are'} in. Your place is held and nothing leaves your account until it is certain. `
              : ''}
            {REFUND_WORDS[offer.refundRule]}.
          </Text>
          {!payments.ready ? <Text style={type.tiny}>{payments.note}</Text> : null}
        </View>
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      </ScrollView>
      <View style={[styles.footer, wide && styles.footerWide]}>
        <Button label={total ? `Confirm${payments.ready ? ' and pay' : ''} · ${money(total)}` : 'Confirm my place'} icon="check" disabled={!ready} loading={busy} onPress={confirm} />
        <Text style={[type.tiny, { textAlign: 'center' }]}>{payments.ready ? `Card charged now · ${first} is paid the day after` : `Nothing charged · ${first} is told, and your place is recorded`}</Text>
      </View>
    </View>
  );
}

const blocked = (o: Experience, p: PartyMember) => Boolean(o.ageLimit && ((p.age != null && p.age < o.ageLimit) || (p.age == null && p.child)));

export function ReportBox({ hostId, offerId, onDone }: { hostId: string; offerId?: string | null; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  return (
    <View style={[styles.block, { borderWidth: BORDER, borderColor: colors.line, padding: spacing.md }]}>
      <Text style={type.h3}>Report this</Text>
      <Text style={type.small}>Say what is wrong. Somebody at Epic reads every report; the host is not told who sent it.</Text>
      <TextInput value={reason} onChangeText={setReason} placeholder="What happened, or what looks wrong" placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 64, paddingTop: 10 }]} multiline autoFocus />
      {said ? <StatusLine tone="good">{said}</StatusLine> : null}
      <Row>
        <Button label="Send" kind="secondary" disabled={!reason.trim()} onPress={async () => { try { const r = await api.reportHost(hostId, reason.trim(), offerId); setSaid(r.message); setTimeout(onDone, 1500); } catch (e: any) { setSaid(e.message); } }} />
        <Button label="Cancel" kind="ghost" onPress={onDone} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  scroll: { paddingBottom: 140, backgroundColor: colors.bg },
  scrollWide: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  gutter: { paddingHorizontal: 20 },
  overBar: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  overBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, marginTop: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.ruleSoft },
  block: { marginTop: spacing.lg, gap: spacing.sm },
  orderRow: { alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  orderTime: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: colors.ink, width: 52 },
  weekRow: { alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  weekN: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: colors.inkMuted, width: 64 },
  outcome: { backgroundColor: colors.selected, padding: spacing.lg, marginTop: spacing.lg, gap: 6 },
  outcomeKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: colors.selectedFg },
  outcomeText: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.selectedFg, lineHeight: 26 },
  onlineBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warm, padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.ruleSoft },
  dayBox: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  dayBoxOn: { backgroundColor: colors.selected },
  timeBox: { minWidth: 72, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 10 },
  priceBlock: { marginTop: spacing.lg, gap: 6, borderTopWidth: BORDER, borderTopColor: colors.line, paddingTop: spacing.md },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceMuted },
  link: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.accent },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.md, paddingBottom: (spacing.md + 8) as any, gap: 6, backgroundColor: colors.surface, borderTopWidth: BORDER, borderTopColor: colors.line },
  footerWide: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  formatCard: { marginTop: spacing.md, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: colors.ruleSoft },
  formatCardOn: { borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surfaceMuted },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  tick: { width: 24, height: 24, borderWidth: BORDER, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  tickOn: { backgroundColor: colors.selected },
  gateRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 6 },
  input: { minHeight: TARGET, paddingHorizontal: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink, fontFamily: fonts.body },
  summary: { marginTop: spacing.lg, padding: spacing.md, gap: 6, backgroundColor: colors.surfaceMuted },
});
