/**
 * A booking of ours (Events v4 canvas G1 · G3): held until the minimum, then
 * booked; and, after it ran, the rating.
 *
 * Where a minimum applies the page says *held, not booked yet*, shows the
 * count against it and the decide-by date, and says in one line that nothing
 * has left the account. Then what happens next, either way, and a share
 * prompt — two more and it runs.
 *
 * Rating (G3): stars, three chips (Skill · Company · Value), an optional line,
 * an optional photo. Both reviews go live together a fortnight later, so
 * neither is written in reply to the other.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { api, Booking, PaymentsConfig } from '../api';
import { colors, fonts, spacing, TARGET, type, BORDER } from '../theme';
import { Button, Row, StatusLine } from '../components/ui';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { useViewport } from '../hooks/useViewport';
import { useRouter } from '../router';
import { paths, type Route } from '../routes';
import { HostFace, Kicker, REFUND_WORDS, VENUE_ICON, dateOnly, dayShort, durationWords, money, venueWords } from '../components/hosting';
import { pickPhotoBlob } from '../components/pickPhoto';

const WIDE = 900;
const CHIPS = [{ key: 'skill', label: 'Skill' }, { key: 'company', label: 'Company' }, { key: 'value', label: 'Value' }];

export function BookingScreen({ route }: { route: Extract<Route, { name: 'booking' }> }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, back } = useRouter();
  const [data, setData] = useState<{ booking: Booking; payments: PaymentsConfig } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.booking(route.id)); setError(null); } catch (e: any) { setError(e.message); }
  }, [route.id]);
  useEffect(() => { void load(); }, [load]);

  if (error && !data) return <View style={styles.page}><Wordmark height={30} /><Text style={type.h2}>Not one of yours</Text><Text style={type.small}>{error}</Text><Button label="Your bookings" kind="secondary" onPress={() => navigate(paths.bookings(), { replace: true })} /></View>;
  if (!data) return <View style={styles.page}><Wordmark height={30} /><Text style={type.small}>Opening…</Text></View>;

  const { booking: b, payments } = data;
  const first = b.host.name.split(' ')[0];

  if (route.rate) return <RateHost booking={b} wide={wide} onBack={() => back(paths.booking(b.id))} onDone={() => { void load(); back(paths.booking(b.id)); }} />;

  const held = b.state === 'pending';
  const waitlisted = b.state === 'waitlisted';
  const cancelled = b.state === 'cancelled';
  const off = b.offerState === 'ended';
  const when = [b.on ? dayShort(b.on) : null, b.startsAt, durationWords(b.durationMin), b.venue === 'their_place' && b.venueLabel ? b.venueLabel : venueWords(b)].filter(Boolean).join(' · ');
  const needs = b.minCount ? Math.max(0, b.minCount - (b.heads)) : 0;

  const title = cancelled ? (b.cancelledBy === 'host' || off ? 'Called off' : 'You cancelled this')
    : waitlisted ? 'On the waiting list'
      : held ? 'Held, not booked yet'
        : b.isPast ? (b.reviewed ? 'You went' : ['confirmed', 'attended'].includes(b.state) ? 'How was it?' : 'It ran without you')
          : 'You are booked';

  return (
    <ScrollView contentContainerStyle={[styles.scroll, styles.gutter, wide && styles.scrollWide]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Press onPress={() => back(paths.bookings())} accessibilityRole="button"><Row><Icon name="back" size={18} /><Text style={type.h3}>Your booking</Text></Row></Press>
        <Wordmark height={24} />
      </Row>

      <Kicker style={{ marginTop: spacing.lg }}>{cancelled ? 'OFF' : held ? 'HELD' : waitlisted ? 'WAITING' : b.isPast ? 'PAST' : 'BOOKED'}</Kicker>
      <Text style={type.title}>{title}</Text>
      <Text style={[type.body, { marginTop: 6 }]}>
        {cancelled
          ? `${b.offerCancelledNote ?? (b.cancelledBy === 'guest' ? 'You cancelled.' : `${first} called it off.`)} ${b.paymentStatus === 'refunded' ? `Your ${money(b.amountPence)} is on its way back to the card you paid with.` : 'Nothing was taken, so there is nothing to refund.'}`
          : waitlisted
            ? `This one is full. If a place comes up you are next — nothing has left your account.`
            : held
              ? `${first} needs ${b.minCount} people and ${b.minCount! - needs} ${b.minCount! - needs === 1 ? 'is' : 'are'} in. Nothing has left your account — ${payments.ready ? `we take the ${money(b.amountPence)} the moment it is certain` : 'nothing is charged until it is certain'}.`
              : b.isPast
                ? `${b.title} with ${first}, ${b.on ? dayShort(b.on) : ''}.`
                : `${first} has been told. ${b.amountPence ? (b.paymentStatus === 'paid' ? `${money(b.amountPence)} paid.` : `${money(b.amountPence)} recorded — ${payments.note}`) : 'Free.'}`}
      </Text>

      {/* The thing itself. */}
      <Press onPress={() => navigate(paths.experience(b.offerId))} accessibilityRole="button" style={styles.card}>
        <HostFace host={b.host} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.h3}>{b.title}</Text>
          <Text style={type.small}>{when}</Text>
          <Text style={type.small}>{b.heads === 1 ? 'Just you' : `${b.heads} of you`} · {b.party.map((p) => p.name.split(' ')[0]).join(', ')}</Text>
        </View>
        <Icon name="more" size={16} color={colors.inkMuted} />
      </Press>

      {held ? (
        <View style={styles.heldBar}>
          <View style={{ flex: 1 }}>
            <Text style={[type.h2, { color: colors.selectedFg }]}>{b.minCount! - needs} of {b.minCount} in</Text>
            <Text style={[type.small, { color: colors.selectedFg }]}>Decides {b.decideBy ? dayShort(b.decideBy) : 'soon'}</Text>
          </View>
          <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.min(100, Math.round(((b.minCount! - needs) / b.minCount!) * 100))}%` as any }]} /></View>
        </View>
      ) : null}

      {held || (!cancelled && !b.isPast) ? (
        <View style={styles.block}>
          <Kicker>WHAT HAPPENS NEXT</Kicker>
          {held ? (
            <>
              <Step icon="check" title={`If it reaches ${b.minCount}`} body={`${payments.ready ? `We take ${money(b.amountPence)} and` : 'We confirm your place and'} send you ${b.venue === 'their_place' ? 'the address' : b.venue === 'online' ? 'the link' : 'the meeting point'}.`} />
              <Step icon="close" title="If it does not" body={`Nothing is taken and we tell you on the ${b.decideBy ? new Date(`${b.decideBy}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' }) : 'day'}.`} />
              <Step icon="trips" title="Either way" body="It sits in Trips with the rest of your plans." />
            </>
          ) : (
            <>
              <Step icon={VENUE_ICON[b.venue]} title={b.venue === 'their_place' ? (b.venueLabel ?? `${first}'s place`) : b.venue === 'your_place' ? (b.address ?? 'At yours') : b.venue === 'online' ? (b.onlinePlatform ?? 'A video call') : (b.venueLabel ?? 'The meeting point')} body={b.venueNotes ?? (b.venue === 'online' ? 'The link comes the day before.' : b.venue === 'your_place' ? (b.accessNotes ?? 'You told us how to get in.') : 'Be there a few minutes early.')} />
              <Step icon="hours" title={REFUND_WORDS[b.refundRule]} body={b.refundRule === 'none' ? 'Tickets bought in for this cannot be returned.' : 'Cancel from here and the refund follows the rule.'} />
              {b.noteToHost ? <Step icon="message" title={`You told ${first}`} body={b.noteToHost} /> : null}
            </>
          )}
        </View>
      ) : null}

      {held ? (
        <View style={styles.shareBox}>
          <Text style={[type.small, { flex: 1, color: colors.ink }]}>Know someone {b.venueArea ? `in ${b.venueArea}` : 'nearby'} that day? {needs} more and it runs.</Text>
          <Button label="Share" kind="secondary" icon="share" onPress={() => void share(b)} />
        </View>
      ) : null}

      {b.isPast && !cancelled && ['confirmed', 'attended'].includes(b.state) && !b.reviewed ? (
        <Button label={`Rate ${first}`} icon="favourite" onPress={() => navigate(paths.bookingRate(b.id))} style={{ marginTop: spacing.lg }} />
      ) : null}
      {b.reviewed ? <StatusLine tone="good">Thank you — your review goes live a fortnight after the day, with {first}'s.</StatusLine> : null}

      {!cancelled && !b.isPast ? (
        <Press onPress={async () => { setBusy(true); try { await api.cancelBooking(b.id); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }} accessibilityRole="button" disabled={busy} style={{ marginTop: spacing.xl, paddingVertical: 8 }}>
          <Text style={[type.small, { color: colors.overrun, fontWeight: '700', textAlign: 'center' }]}>{held || waitlisted ? 'Cancel any time while it is held' : 'Cancel this booking'}</Text>
        </Press>
      ) : null}
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      <Press onPress={() => navigate(paths.bookings())} accessibilityRole="button" style={{ paddingVertical: 8 }}>
        <Text style={[type.small, { color: colors.accent, fontWeight: '700', textAlign: 'center' }]}>See it with your trips ›</Text>
      </Press>
    </ScrollView>
  );
}

function Step({ icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <Row style={{ alignItems: 'flex-start', paddingVertical: 6 }}>
      <View style={styles.stepIcon}><Icon name={icon} size={14} color={colors.ink} /></View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={type.h3}>{title}</Text>
        <Text style={type.small}>{body}</Text>
      </View>
    </Row>
  );
}

async function share(b: Booking) {
  const nav: any = (globalThis as any).navigator;
  const url = typeof window !== 'undefined' ? `${window.location.origin}${paths.experience(b.offerId)}` : paths.experience(b.offerId);
  try {
    if (nav?.share) await nav.share({ title: b.title ?? 'On Epic', text: `${b.host.name.split(' ')[0]} needs a few more for this. Come?`, url });
    else if (nav?.clipboard) await nav.clipboard.writeText(url);
  } catch { /* closed */ }
}

/** G3: how was it? */
function RateHost({ booking: b, wide, onBack, onDone }: { booking: Booking; wide: boolean; onBack: () => void; onDone: () => void }) {
  const first = b.host.name.split(' ')[0];
  const [stars, setStars] = useState(0);
  const [chips, setChips] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addPhoto = async () => {
    const blob = await pickPhotoBlob();
    if (!blob) return;
    try { const m = await api.uploadHostMedia(blob, 'photo'); setPhoto({ id: m.id, url: m.url }); } catch (e: any) { setError(e.message); }
  };
  const post = async () => {
    setBusy(true); setError(null);
    try { await api.reviewHost(b.id, { stars, chips: [...chips], text: text.trim() || null, photoId: photo?.id ?? null }); onDone(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={[styles.scroll, styles.gutter, wide && styles.scrollWide]} keyboardShouldPersistTaps="handled">
      <Row style={{ justifyContent: 'space-between' }}>
        <Press onPress={onBack} accessibilityRole="button"><Row><Icon name="back" size={18} /><Text style={type.h3}>Back</Text></Row></Press>
        <Wordmark height={24} />
      </Row>
      <Text style={[type.title, { marginTop: spacing.lg }]}>How was it?</Text>
      <Row style={{ marginTop: spacing.md }}>
        <HostFace host={b.host} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>{b.host.name}</Text>
          <Text style={type.small}>{b.title} · {dateOnly(b.on)}</Text>
        </View>
      </Row>

      <Row style={{ marginTop: spacing.lg, gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Press key={n} onPress={() => setStars(n)} accessibilityRole="button" accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`} style={styles.star}>
            <Icon name="favourite" size={34} color={colors.ink} fill={n <= stars} strokeWidth={1.6} />
          </Press>
        ))}
      </Row>

      <View style={styles.block}>
        <Kicker>WHAT STOOD OUT</Kicker>
        <Row>
          {CHIPS.map((c) => {
            const on = chips.has(c.key);
            return (
              <Press key={c.key} onPress={() => setChips((s) => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[type.h3, on && { color: colors.selectedFg }]}>{c.label}</Text>
              </Press>
            );
          })}
        </Row>
      </View>

      <View style={styles.block}>
        <Kicker>ANYTHING TO ADD</Kicker>
        <TextInput value={text} onChangeText={setText} multiline placeholder={`What ${first} did well, what you would tell a friend`} placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 96, paddingTop: 10 }]} />
        <Row>
          <Button label={photo ? 'Change the photo' : 'Add a photo if you took one'} kind="ghost" icon="camera" onPress={() => void addPhoto()} />
          {photo ? <Icon name="check" size={16} color={colors.accent} /> : null}
        </Row>
        <Text style={type.tiny}>{first} sees your review and can reply.</Text>
      </View>

      <View style={styles.note}>
        <Text style={type.small}>Both reviews go live together, a fortnight after the day — so neither of you writes in reply to the other.</Text>
      </View>
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      <Button label="Post my review" icon="check" disabled={!stars} loading={busy} onPress={post} style={{ marginTop: spacing.lg }} />
      <Press onPress={onBack} accessibilityRole="button" style={{ paddingVertical: 10 }}><Text style={[type.small, { textAlign: 'center' }]}>Or skip · we will not ask again</Text></Press>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  scroll: { paddingBottom: 60, paddingTop: spacing.lg, backgroundColor: colors.bg },
  scrollWide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  gutter: { paddingHorizontal: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, borderWidth: BORDER, borderColor: colors.line },
  heldBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.selected },
  progress: { width: 96, height: 10, backgroundColor: 'rgba(32,30,29,0.18)', overflow: 'hidden' },
  progressFill: { height: 10, backgroundColor: colors.selectedFg },
  block: { marginTop: spacing.lg, gap: spacing.sm },
  stepIcon: { width: 28, height: 28, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  shareBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surfaceMuted },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chip: { flex: 1, minHeight: TARGET, alignItems: 'center', justifyContent: 'center', borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.selected },
  input: { minHeight: TARGET, paddingHorizontal: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink, fontFamily: fonts.body },
  note: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.warm },
});
