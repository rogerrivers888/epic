/**
 * The Host tab (Hosts and Events N-B, H1; Events v4 H1, H3).
 *
 * Two quite different states, both designed:
 *
 *   Not yet a host — the tab is the invitation. Epic's pitch to supply, and
 *   the best real estate we have for it: what people host, across the three
 *   types; what they earn; how little is needed to start; the trust ladder;
 *   the people already hosting nearby, so the tap is worth it even for
 *   somebody who never starts; and one primary action.
 *
 *   Already a host — the tab is their hosting home. Who they are with their
 *   trust level and rating; live · booked · to come; the offers as a menu with
 *   live / paused / draft / in review states and bookings against each; and a
 *   prominent Add an offer. Nothing to browse: guests find you through Inspire
 *   and Places, and the screen says so.
 *
 * It draws the same head as Trips — the wordmark and one control — and keeps
 * the tab bar. Everything inside it is a page of its own.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { api, HostHome, OfferShape } from '../../api';
import { colors, fonts, spacing, type, BORDER, INK, LIME, LIME_TINT, MOSS, CREAM } from '../../theme';
import { Button, Row } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ScreenTop, TopControl } from '../../components/InspireHeader';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths, type Route } from '../../routes';
import { HostFace, Kicker, OfferRow, RatingLine, SHAPE_ICON, SHAPE_LABEL, TYPE_LABEL, TrustBadge, TypeChip, dateOnly, money } from '../../components/hosting';
import { BecomeHostScreen } from './BecomeHostScreen';
import { OfferWizard } from './OfferWizard';
import { OfferDashboard } from './OfferDashboard';
import { VideoRecorder } from './VideoRecorder';

const WIDE = 900;

export function HostScreen({ route }: { route: Extract<Route, { name: 'host' }> }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, query } = useRouter();
  const [home, setHome] = useState<HostHome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setHome(await api.hostHome()); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load, route.page]);

  // A new offer: make the draft, then continue on its own address so a reload lands on it.
  const creating = React.useRef(false);
  useEffect(() => {
    if (route.page !== 'new' || creating.current) return;
    creating.current = true;
    const shape = (query.get('shape') as OfferShape | null) ?? 'oneoff';
    api.createOffer(shape).then((r) => navigate(paths.hostOfferEdit(r.offer.id, query.get('shape') ? 2 : 1), { replace: true })).catch((e) => { setError(e.message); creating.current = false; });
  }, [route.page]);

  if (route.page === 'start' && home) return <BecomeHostScreen home={home} onChanged={load} />;
  if (route.page === 'edit' && route.offerId) return <OfferWizard offerId={route.offerId} onDone={(offer, inReview) => { void load(); navigate(paths.hostOffer(offer.id), { replace: true }); void inReview; }} />;
  if (route.page === 'offer' && route.offerId) return <OfferDashboard offerId={route.offerId} hostName={home?.host?.name ?? ''} />;
  if (route.page === 'video') {
    const offerId = query.get('offer');
    return <VideoRecorder offerId={offerId} onDone={() => navigate(offerId ? paths.hostOfferEdit(offerId, 2) : paths.hostStart(3), { replace: true })} />;
  }
  if (route.page === 'new') return <View style={styles.centre}><Text style={type.small}>{error ?? 'Starting a new offer…'}</Text></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={wide ? styles.wide : undefined}>
        <ScreenTop>
          {home?.host ? <TopControl label="Add an offer" icon="add" onPress={() => navigate(paths.hostNewOffer())} /> : <TopControl label="Start hosting" icon="host" onPress={() => navigate(paths.hostStart())} />}
        </ScreenTop>
      </View>
      <ScrollView contentContainerStyle={[styles.body, wide && styles.wide]}>
        {error && !home ? <Text style={type.small}>{error}</Text> : null}
        {!home ? <Text style={type.small}>Loading…</Text> : home.host ? <Dashboard home={home} wide={wide} /> : <Invitation home={home} wide={wide} />}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// not yet a host: the invitation
// ---------------------------------------------------------------------------

function Invitation({ home, wide }: { home: HostHome; wide: boolean }) {
  const { navigate } = useRouter();
  const examples: { type: 'practitioner' | 'local' | 'guide'; local?: 'family' | 'something_you_do'; title: string; earn: string; shape: OfferShape }[] = [
    { type: 'practitioner', title: 'A painting afternoon, you and the kids', earn: '£38 each · 3 h · her studio', shape: 'oneoff' },
    { type: 'local', local: 'family', title: 'A day out with our two, and yours', earn: 'Free · the good swings and the café', shape: 'anytime' },
    { type: 'local', local: 'something_you_do', title: 'Tuesday run club round the lake', earn: '£40 the series · ten Tuesdays', shape: 'series' },
    { type: 'practitioner', title: 'An hour on getting the best out of AI', earn: '£80 · online', shape: 'anytime' },
    { type: 'guide', title: 'Half a day, the City as it really was', earn: '£229 · Blue Badge', shape: 'anytime' },
  ];
  return (
    <View style={{ gap: spacing.xl }}>
      <View style={styles.pitch}>
        <Text style={[styles.pitchKicker]}>HOST ON EPIC</Text>
        <Text style={styles.pitchTitle}>Know something,{'\n'}or somewhere?</Text>
        <Text style={[type.body, { color: INK }]}>An afternoon of painting. A morning round the food places you actually go to. A day out with your kids and somebody else's. People book the person, not the listing — and Epic already knows who is coming to your town, and when.</Text>
        <Button label="Start hosting" icon="host" onPress={() => navigate(paths.hostStart())} />
        <Text style={[type.tiny, { color: INK }]}>About ten minutes to set up · nothing goes live until you say so</Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Kicker>WHAT PEOPLE HOST</Kicker>
        {examples.map((e, i) => (
          <View key={i} style={styles.example}>
            <View style={styles.exampleIcon}><Icon name={SHAPE_ICON[e.shape]} size={16} color={colors.ink} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Row style={{ gap: 6 }}><TypeChip type={e.type} localKind={e.local ?? null} small /><Text style={type.tiny}>{SHAPE_LABEL[e.shape]}</Text></Row>
              <Text style={type.h3}>{e.title}</Text>
              <Text style={type.small}>{e.earn}</Text>
            </View>
          </View>
        ))}
        <Text style={type.tiny}>Not a tour catalogue. Landmarks have guidebooks; what they do not have is you.</Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Kicker>THREE KINDS OF HOST</Kicker>
        {[
          { type: 'practitioner' as const, body: 'You sell a skill or a craft. Guests come to do the thing, and often to learn it.' },
          { type: 'local' as const, body: 'You sell access and company. A family for a family; something you do; a night out; your neighbourhood.' },
          { type: 'guide' as const, body: 'You sell knowledge and credentials — a licence, years, languages — at a professional rate.' },
        ].map((t) => (
          <Row key={t.type} style={{ alignItems: 'flex-start', paddingVertical: 4 }}>
            <View style={{ width: 118 }}><TypeChip type={t.type} /></View>
            <Text style={[type.small, { flex: 1 }]}>{t.body}</Text>
          </Row>
        ))}
        <Text style={type.tiny}>Never ranked against each other. Trust is separate: Verified, Checked, Epic Trusted.</Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Kicker>WHAT YOU EARN, AND HOW</Kicker>
        {[
          { t: 'You set the price', b: 'Free, the same for everyone, or a total split by numbers. Per person or per household.' },
          { t: 'Epic collects, pays you out', b: 'Three working days after it runs, one payment per experience. Guests see one all-in price.' },
          { t: 'A minimum protects you', b: 'Under it and it is called off — everybody is told and nothing is taken.' },
        ].map((s, i) => (
          <Row key={i} style={{ alignItems: 'flex-start' }}>
            <View style={styles.num}><Text style={styles.numText}>{i + 1}</Text></View>
            <View style={{ flex: 1 }}><Text style={type.h3}>{s.t}</Text><Text style={type.small}>{s.b}</Text></View>
          </Row>
        ))}
        {!home.config.payments.ready ? <Text style={type.tiny}>{home.config.payments.note} Free offers work now.</Text> : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Kicker>HOW EPIC CHECKS HOSTS</Kicker>
        <Row style={{ flexWrap: 'wrap' }}><TrustBadge trust="verified" /><TrustBadge trust="checked" /><TrustBadge trust="trusted" /></Row>
        <Text style={type.small}>Every host clears Verified — ID and contact confirmed against the face in their video. Checked is documents seen, and is required at your place, with children, or above £100. Epic Trusted is earned over time and carries our name.</Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Kicker>{home.nearby.length ? 'ALREADY HOSTING NEAR YOU' : 'NEAR YOU'}</Kicker>
        {home.nearby.length ? home.nearby.slice(0, 6).map((h) => (
          <Press key={h.id} onPress={() => navigate(paths.hostProfile(h.id))} accessibilityRole="button" style={styles.nearby}>
            <HostFace host={h} size={40} />
            <View style={{ flex: 1 }}>
              <Row style={{ gap: 6 }}><Text style={type.h3}>{h.name}</Text><TypeChip type={h.type} small /></Row>
              <Text style={type.small}>{[h.location, h.liveOffers ? `${h.liveOffers} live` : null, h.km != null ? `${h.km} km` : null].filter(Boolean).join(' · ')}</Text>
            </View>
            <Icon name="more" size={16} color={colors.inkMuted} />
          </Press>
        )) : <Text style={type.small}>Nobody hosting near you yet. The first person to start is the one people find.</Text>}
      </View>

      <Button label="Start hosting" icon="host" onPress={() => navigate(paths.hostStart())} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// a host: the dashboard
// ---------------------------------------------------------------------------

function Dashboard({ home, wide }: { home: HostHome; wide: boolean }) {
  const { navigate } = useRouter();
  const h = home.host!;
  const s = home.stats!;
  const order = { live: 0, in_review: 1, paused: 2, draft: 3, ended: 4 } as const;
  const offers = [...home.offers].sort((a, b) => order[a.state] - order[b.state]);
  const bookedOn = (id: string) => home.offers.find((o) => o.id === id)?.bookings.filter((b) => b.state !== 'cancelled').reduce((n, b) => n + b.heads, 0) ?? 0;
  const incomplete = !h.introVideo || !h.photo;
  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={type.title}>Hosting</Text>
      <Press onPress={() => navigate(paths.hostProfile(h.id))} accessibilityRole="button" style={styles.me}>
        <HostFace host={h} size={48} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={type.h3}>{h.name}</Text>
          <Row style={{ flexWrap: 'wrap', gap: 6 }}><TypeChip type={h.type} localKind={h.localKind} small /><TrustBadge trust={h.trust} checks={h.checks} /></Row>
          <RatingLine host={h} />
        </View>
        <Icon name="more" size={16} color={colors.inkMuted} />
      </Press>

      <Row style={{ gap: spacing.sm }}>
        <Stat n={String(s.live)} label="live" />
        <Stat n={String(s.booked)} label="booked" />
        <Stat n={money(s.toComePence)} label={home.config.payments.ready ? 'to come' : 'recorded'} />
      </Row>

      {incomplete ? (
        <Press onPress={() => navigate(paths.hostStart(!h.introVideo ? 2 : 3))} accessibilityRole="button" style={styles.nudge}>
          <Icon name={!h.introVideo ? 'video' : 'camera'} size={16} color={colors.ink} />
          <Text style={[type.small, { flex: 1, color: colors.ink }]}>{!h.introVideo ? 'No intro video yet. People book the person — a minute of you talking is the thing they watch first.' : 'No photograph yet — it is the face on every card.'}</Text>
          <Icon name="more" size={16} color={colors.inkMuted} />
        </Press>
      ) : null}
      {h.checks === 'running' ? <Text style={type.small}>Your checks are running. You can publish meanwhile; the profile says so until they pass.</Text> : null}

      <View>
        <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: spacing.sm, borderBottomWidth: BORDER, borderBottomColor: colors.line }}>
          <Text style={type.h2}>Your offers{offers.length ? ` · ${offers.length}` : ''}</Text>
          {s.nextPayoutOn ? <Text style={type.small}>Next runs {dateOnly(s.nextPayoutOn)}</Text> : null}
        </Row>
        {offers.map((o) => <OfferRow key={o.id} item={o} own={{ booked: bookedOn(o.id) }} onPress={() => navigate(o.state === 'draft' ? paths.hostOfferEdit(o.id) : paths.hostOffer(o.id))} />)}
        {!offers.length ? <Text style={[type.small, { paddingVertical: spacing.md }]}>Nothing yet. Your first offer is read by somebody at Epic within 48 hours; after that they go live as you publish them.</Text> : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Button label={offers.length ? 'Add another offer' : 'Add an offer'} icon="add" onPress={() => navigate(paths.hostNewOffer())} />
        <Row style={{ justifyContent: 'center', gap: spacing.sm }}>
          {(['oneoff', 'series', 'anytime'] as OfferShape[]).map((sh) => (
            <Press key={sh} onPress={() => navigate(paths.hostNewOffer(sh))} accessibilityRole="button" style={styles.shapeQuick}>
              <Icon name={SHAPE_ICON[sh]} size={14} color={colors.ink} />
              <Text style={type.tiny}>{SHAPE_LABEL[sh]}</Text>
            </Press>
          ))}
        </Row>
      </View>

      <Text style={type.small}>
        {s.joinedThisWeek ? `${s.joinedThisWeek} ${s.joinedThisWeek === 1 ? 'booking' : 'bookings'} this week. ` : ''}Guests find you through Inspire and Places — there is nothing to browse here.
      </Text>
    </View>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statN}>{n}</Text>
      <Text style={type.tiny}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wide: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  body: { paddingHorizontal: 20, paddingTop: spacing.md, paddingBottom: 40 },
  pitch: { backgroundColor: LIME, padding: spacing.lg, gap: spacing.md },
  pitchKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: INK },
  pitchTitle: { fontFamily: fonts.heading, fontSize: 30, fontWeight: '800', letterSpacing: -0.9, lineHeight: 34, color: INK },
  example: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  exampleIcon: { width: 36, height: 36, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center' },
  num: { width: 26, height: 26, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: fonts.heading, fontSize: 13, fontWeight: '800', color: colors.selectedFg },
  nearby: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  me: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  stat: { flex: 1, padding: spacing.md, gap: 2, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface },
  statN: { fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceMuted },
  shapeQuick: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderWidth: 1, borderColor: colors.ruleSoft },
});
