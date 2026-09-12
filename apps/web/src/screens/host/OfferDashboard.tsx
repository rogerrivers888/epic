/**
 * One experience, from the host's side (Hosts and Events D1; Events v4 H2).
 *
 * Bookings against the minimum as a two-tone bar; money collected, refunded
 * and when it pays out; who is coming — people and bookings counted
 * separately, "9 in 5 bookings"; a broadcast to everyone booked; another date;
 * pause and resume; and, in red, call it off with automatic refunds. Red is
 * for money that needs returning and nothing else.
 *
 * In review (H2): a real state with a 48-hour promise, the checklist of what
 * we read, and the editorial reply when there is one.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, OwnOffer } from '../../api';
import { colors, fonts, spacing, TARGET, type, BORDER } from '../../theme';
import { Button, Row, StatusLine } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { DateRangePicker } from '../../components/DateRangePicker';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths } from '../../routes';
import { HostFace, Kicker, SHAPE_LABEL, StandingBar, StateChip, dateOnly, dayShort, durationWords, metaLine, money, priceWords } from '../../components/hosting';

/** A tile says £0, never "Free": it is a sum, not a price. */
const cash = (p: number) => (p ? money(p) : '£0');

const CHECKS: { key: keyof OwnOffer['checklist']; label: string }[] = [
  { key: 'what', label: 'What you will actually do' }, { key: 'home', label: 'What they go home with' }, { key: 'suits', label: 'Who it suits' }, { key: 'notSuits', label: 'Who it does not suit' }, { key: 'photos', label: 'Your photos' },
];

export function OfferDashboard({ offerId, hostName }: { offerId: string; hostName: string }) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { navigate, back } = useRouter();
  const [offer, setOffer] = useState<OwnOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | 'message' | 'date' | 'off' | 'pause'>(null);
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setOffer((await api.hostOffer(offerId)).offer); setError(null); } catch (e: any) { setError(e.message); }
  }, [offerId]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<{ offer: OwnOffer; told?: { sentTo: number; delivered: number; channel: string } }>, after?: (r: any) => void) => {
    setBusy(true); setError(null);
    try { const r = await fn(); setOffer(r.offer); after?.(r); setPanel(null); setText(''); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (error && !offer) return <View style={styles.page}><Text style={type.h2}>Not one of yours</Text><Text style={type.small}>{error}</Text><Button label="Back to hosting" kind="secondary" onPress={() => navigate(paths.host(), { replace: true })} /></View>;
  if (!offer) return <View style={styles.page}><Text style={type.small}>Opening…</Text></View>;
  const o = offer;
  const live = o.bookings.filter((b) => b.state !== 'cancelled');
  const heads = live.reduce((n, b) => n + b.heads, 0);
  const seen = (r: { sentTo: number; delivered: number; channel: string }) => (r.channel === 'none'
    ? `Written for ${r.sentTo} ${r.sentTo === 1 ? 'household' : 'households'}. Epic has no message sender connected yet, so nobody has been texted — the owner adds one.`
    : `Sent to ${r.delivered} of ${r.sentTo}.`);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wide]} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Press onPress={() => back(paths.host())} accessibilityRole="button" hitSlop={8}><Row><Icon name="back" size={18} /><Text style={type.h3}>Hosting</Text></Row></Press>
          <Press onPress={() => navigate(paths.hostOfferEdit(o.id))} accessibilityRole="button" hitSlop={8}><Text style={[type.small, { color: colors.accent, fontWeight: '700' }]}>Edit</Text></Press>
        </Row>
        <Text style={type.title}>{o.title ?? 'Untitled'}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          <StateChip state={o.state} pausedUntil={o.pausedUntil} />
          <Text style={type.small}>{SHAPE_LABEL[o.shape]} · {metaLine(o)}</Text>
        </Row>
        <Text style={type.small}>{priceWords(o)}{o.money === 'epic' ? ' · Epic collects' : o.money === 'direct' ? ' · paid to you directly' : ''}</Text>

        {/* In review: what we read, and what we said. */}
        {o.state === 'in_review' ? (
          <View style={styles.review}>
            <Kicker>WE ARE READING THIS</Kicker>
            <Text style={type.h3}>Back within 48 hours</Text>
            <Text style={type.small}>We check every first listing — a weak pitch costs you bookings and costs us our badge.</Text>
            <Text style={[styles.fieldLabel, { marginTop: 6 }]}>What we look at</Text>
            {CHECKS.map((c) => {
              const v = (o.reviewChecklist ?? o.checklist)[c.key];
              const ok = v === 'clear';
              return (
                <Row key={c.key} style={{ justifyContent: 'space-between' }}>
                  <Text style={type.body}>{c.label}</Text>
                  <Text style={[type.small, { color: ok ? colors.accent : colors.overrun, fontWeight: '700' }]}>{ok ? 'Clear' : v === 'missing' ? 'Missing' : v}</Text>
                </Row>
              );
            })}
            <View style={styles.example}>
              <Text style={type.small}>A strong one, same category</Text>
              <Text style={[type.body, { fontStyle: 'italic' }]}>"Six places in three hours, none of them on a list. You will eat standing up twice. Not for anyone who wants a table and a menu."</Text>
              <Text style={type.tiny}>Nina, Bologna · books out in a week</Text>
            </View>
            <Row><Button label="Preview as a guest" kind="secondary" icon="preview" onPress={() => navigate(paths.hostOfferEdit(o.id, 5))} /><Button label="Edit the pitch" kind="ghost" icon="edit" onPress={() => navigate(paths.hostOfferEdit(o.id, 2))} /></Row>
          </View>
        ) : null}
        {o.state === 'draft' && o.reviewNote ? (
          <View style={styles.review}>
            <Kicker>WHAT WE SAID</Kicker>
            <Text style={type.body}>{o.reviewNote}</Text>
            <Button label="Edit the pitch" kind="secondary" icon="edit" onPress={() => navigate(paths.hostOfferEdit(o.id, 2))} />
          </View>
        ) : null}
        {o.state === 'draft' && !o.reviewNote ? (
          <View style={styles.review}>
            <Text style={type.h3}>A draft. Nothing is public yet.</Text>
            <Text style={type.small}>{o.blockers.length ? o.blockers[0] : 'Everything is in place — publish it from the last step.'}</Text>
            <Button label="Carry on" icon="forward" onPress={() => navigate(paths.hostOfferEdit(o.id, o.blockers.length ? 2 : 5))} />
          </View>
        ) : null}

        {/* Bookings against the three numbers. */}
        {o.shape !== 'anytime' ? (
          <View style={styles.block}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={type.h2}>{heads} booked</Text>
              <Text style={type.small}>{o.standing.full ? 'Full' : o.standing.placesLeft != null ? `${o.standing.placesLeft} more and it is full` : o.standing.needs ? `${o.standing.needs} more to run` : 'Running'}</Text>
            </Row>
            <StandingBar standing={o.standing} />
          </View>
        ) : (
          <View style={styles.block}>
            <Text style={type.h2}>{live.length} slot{live.length === 1 ? '' : 's'} booked</Text>
            <Text style={type.small}>{o.slots.reduce((n, d) => n + d.times.length, 0)} free in the next fortnight.</Text>
          </View>
        )}

        <Row style={styles.tiles}>
          <Tile label="collected" value={cash(o.takings.collectedPence + o.takings.recordedPence)} sub={o.takings.recordedPence && !o.takings.collectedPence ? 'recorded' : undefined} />
          <Tile label="refunded" value={cash(o.takings.refundedPence)} red={o.takings.refundedPence > 0} />
          <Tile label="paid out" value={o.takings.payoutOn ? dateOnly(o.takings.payoutOn) : '—'} />
        </Row>

        {/* Who is coming: people and bookings counted separately. */}
        <View style={styles.block}>
          <Kicker>WHO IS COMING · {heads} IN {live.length} BOOKING{live.length === 1 ? '' : 'S'}</Kicker>
          {live.length ? live.slice(0, 8).map((b) => (
            <Row key={b.id} style={styles.person}>
              <HostFace host={{ name: b.name ?? 'Guest', photo: null }} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>{b.name ?? 'A guest'}</Text>
                <Text style={type.small}>{b.heads} {b.heads === 1 ? 'person' : 'people'} · {money(b.amountPence)} · booked {dateOnly(b.bookedAt.slice(0, 10))}{o.shape !== 'oneoff' && b.occurrence ? ` · ${b.occurrence === 'whole' ? 'whole run' : b.occurrence.length > 10 ? `${dayShort(b.occurrence.slice(0, 10))} ${b.occurrence.slice(11)}` : dayShort(b.occurrence)}` : ''}</Text>
                {b.note ? <Text style={[type.small, { color: colors.accent }]}>Asked: {b.note}</Text> : null}
                {b.state === 'pending' ? <Text style={type.tiny}>Held until the minimum</Text> : b.state === 'waitlisted' ? <Text style={type.tiny}>Waiting list</Text> : null}
              </View>
            </Row>
          )) : <Text style={type.small}>Nobody yet. {o.state === 'live' ? 'Guests find you through Inspire and Places.' : ''}</Text>}
          {live.length > 8 ? <Text style={type.small}>And {live.length - 8} more.</Text> : null}
        </View>

        {o.broadcasts.length ? (
          <View style={styles.block}>
            <Kicker>WHAT YOU HAVE SAID TO THEM</Kicker>
            {o.broadcasts.slice(0, 3).map((b) => <Text key={b.id} style={type.small}><Text style={{ color: colors.ink }}>{dateOnly(b.at.slice(0, 10))}</Text> · {b.body}</Text>)}
          </View>
        ) : null}

        {/* The controls. */}
        {o.state === 'live' || o.state === 'paused' ? (
          <View style={styles.block}>
            {panel === 'message' ? (
              <View style={{ gap: spacing.sm }}>
                <TextInput value={text} onChangeText={setText} multiline autoFocus placeholder="Where to park, what to bring, a change of time" placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 88, paddingTop: 10 }]} />
                <Row><Button label={`Send to ${live.length}`} icon="send" loading={busy} disabled={!text.trim()} onPress={() => void run(() => api.broadcastOffer(o.id, text.trim()), (r) => setSaid(seen(r.told)))} /><Button label="Cancel" kind="ghost" onPress={() => setPanel(null)} /></Row>
              </View>
            ) : <Button label={`Message all ${heads}`} kind="secondary" icon="broadcast" disabled={!live.length} onPress={() => setPanel('message')} />}

            {o.shape === 'oneoff' ? (panel === 'date' ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={type.small}>Another date of the same one — a copy, live at once, with its own bookings.</Text>
                <DateRangePicker single start={null} end={null} onApply={(d) => void run(() => api.addOfferDate(o.id, d, o.startsAt), (r) => navigate(paths.hostOffer(r.offer.id), { replace: true }))} />
                <Button label="Cancel" kind="ghost" onPress={() => setPanel(null)} />
              </View>
            ) : <Button label="Add another date" kind="secondary" icon="calendar" onPress={() => setPanel('date')} />) : null}

            {o.state === 'live' ? (panel === 'pause' ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={type.small}>Paused keeps its place on your profile, greys the card and says when it is back. Pick the date it comes back, or pause with no date.</Text>
                <DateRangePicker single start={null} end={null} onApply={(d) => void run(() => api.pauseOffer(o.id, d))} />
                <Row><Button label="Pause with no date" kind="secondary" onPress={() => void run(() => api.pauseOffer(o.id, null))} /><Button label="Cancel" kind="ghost" onPress={() => setPanel(null)} /></Row>
              </View>
            ) : <Button label="Pause it" kind="ghost" icon="pause" onPress={() => setPanel('pause')} />) : (
              <Button label="Take it off pause" kind="secondary" icon="resume" loading={busy} onPress={() => void run(() => api.resumeOffer(o.id))} />
            )}

            {panel === 'off' ? (
              <View style={[styles.off]}>
                <Text style={[type.h3, { color: colors.overrun }]}>Call this one off</Text>
                <Text style={type.small}>Everyone booked is told and refunded — {live.length} booking{live.length === 1 ? '' : 's'}, {money(o.takings.collectedPence + o.takings.recordedPence)}. It cannot be undone.</Text>
                <TextInput value={text} onChangeText={setText} placeholder="A line for them — why, and whether you will try again" placeholderTextColor={colors.inkFaint} style={styles.input} />
                <Row><Button label="Call it off · everyone is refunded" kind="danger" loading={busy} onPress={() => void run(() => api.cancelOffer(o.id, text.trim() || null), (r) => setSaid(seen(r.told)))} /><Button label="Keep it" kind="ghost" onPress={() => setPanel(null)} /></Row>
              </View>
            ) : (
              <Press onPress={() => setPanel('off')} accessibilityRole="button" style={{ paddingVertical: 10 }}><Text style={[type.small, { color: colors.overrun, fontWeight: '700', textAlign: 'center' }]}>Call this one off · everyone is refunded</Text></Press>
            )}
          </View>
        ) : null}
        {o.state === 'ended' ? <View style={styles.block}><Text style={type.h3}>Called off{o.cancelledNote ? ` — ${o.cancelledNote}` : ''}</Text><Text style={type.small}>Everyone was told. {money(o.takings.refundedPence)} refunded.</Text></View> : null}
        {o.state === 'draft' ? (
          <Press onPress={() => void run(async () => { await api.deleteOffer(o.id); navigate(paths.host(), { replace: true }); return { offer: o }; })} accessibilityRole="button" style={{ paddingVertical: 10 }}><Text style={[type.small, { color: colors.overrun, fontWeight: '700', textAlign: 'center' }]}>Delete this draft</Text></Press>
        ) : null}

        {said ? <StatusLine tone="good">{said}</StatusLine> : null}
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        {o.state === 'live' ? <Press onPress={() => navigate(paths.experience(o.id))} accessibilityRole="button" style={{ paddingVertical: 10 }}><Text style={[type.small, { color: colors.accent, fontWeight: '700', textAlign: 'center' }]}>See it as a guest ›</Text></Press> : null}
        <Text style={[type.tiny, { textAlign: 'center' }]}>{hostName} · {durationWords(o.durationMin) ?? ''}</Text>
      </ScrollView>
    </View>
  );
}

function Tile({ label, value, sub, red }: { label: string; value: string; sub?: string; red?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, red && { color: colors.overrun }]}>{value}</Text>
      <Text style={type.tiny}>{sub ?? label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, paddingTop: (Platform.OS === 'web' ? 'max(16px, calc(var(--epic-sat) + 10px))' : 16) as any, paddingBottom: 60, gap: spacing.sm },
  wide: { maxWidth: 720, alignSelf: 'center', width: '100%' },
  fieldLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.ink },
  review: { marginTop: spacing.md, padding: spacing.md, gap: spacing.sm, backgroundColor: colors.warm },
  example: { padding: spacing.md, gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.ruleSoft },
  block: { marginTop: spacing.lg, gap: spacing.sm },
  tiles: { marginTop: spacing.lg, gap: spacing.sm },
  tile: { flex: 1, padding: spacing.md, gap: 2, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  tileValue: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  person: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft, alignItems: 'flex-start' },
  input: { minHeight: TARGET, paddingHorizontal: spacing.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink, fontFamily: fonts.body },
  off: { padding: spacing.md, gap: spacing.sm, borderWidth: BORDER, borderColor: colors.overrun },
});
