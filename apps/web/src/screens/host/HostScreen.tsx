/**
 * The Host tab (Host Journey canvas, 13 Sep 2026).
 *
 * Two states, both designed. Not yet a host: the learn layer — two kinds of
 * hosting, three ways to host, what people host, who can come — and nothing
 * to fill in. A host: the dashboard (S4) — who you are, live · booked · to
 * come, your offers as a menu, a full-width lime "Add another thing you do",
 * and what people have asked for that you do not offer yet.
 *
 * The set-up is a separate stack entered from a button (`/host/offers/new`);
 * the profile is its own page (`/host/profile`); the learn layer and the
 * dashboard keep the tab bar.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { api, HostHome, OfferShape, Visibility } from '../../api';
import { colors, fonts, type, INK, LIME } from '../../theme';
import { Button } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ScreenTop } from '../../components/InspireHeader';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths, type Route } from '../../routes';
import { SHAPE_ICON, SHAPE_LABEL, STATE_LABEL, TRUST_LABEL, TYPE_CHIP, VISIBILITY_CHIP, mediaUrl, money, priceWords } from '../../components/hosting';
import { Tag, k, t } from '../../components/hostKit';
import { LearnExample, LearnExamples, LearnHome, LearnShape, LearnWho } from './Learn';
import { OfferWizard } from './OfferWizard';
import { OfferDashboard } from './OfferDashboard';
import { VideoRecorder } from './VideoRecorder';
import { ProfileScreen } from './ProfileScreen';
import { HostInbox } from '../../components/chat/HostInbox';

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

  // A new offer: the draft is made on the first tap, then it continues on its own address.
  const creating = useRef(false);
  useEffect(() => {
    if (route.page !== 'new' || creating.current) return;
    creating.current = true;
    const shape = (query.get('shape') as OfferShape | null) ?? 'oneoff';
    const vis = (query.get('vis') as Visibility | null) ?? undefined;
    api.createOffer(shape, vis).then((r) => navigate(paths.hostOfferEdit(r.offer.id, 'plan'), { replace: true })).catch((e) => { setError(e.message); creating.current = false; });
  }, [route.page]);
  // The old four-step onboarding address lands on the profile.
  useEffect(() => { if (route.page === 'start') navigate(paths.hostMe(), { replace: true }); }, [route.page]);

  if (route.page === 'shape' && route.param) return <LearnShape shape={route.param as OfferShape} wide={wide} />;
  if (route.page === 'examples') return <LearnExamples wide={wide} />;
  if (route.page === 'example' && route.param) return <LearnExample exampleKey={route.param} wide={wide} />;
  if (route.page === 'who') return <LearnWho wide={wide} />;
  if ((route.page === 'profile' || route.page === 'start') && home) return <ProfileScreen home={home} onChanged={load} />;
  if (route.page === 'edit' && route.offerId) return <OfferWizard offerId={route.offerId} home={home} onChanged={load} />;
  if (route.page === 'offer' && route.offerId) return <OfferDashboard offerId={route.offerId} hostName={home?.host?.name ?? ''} chat={route.chat ?? null} />;
  // The host inbox (C5): every question across every offer, waiting first.
  if (route.page === 'questions') return <HostInbox onBack={() => navigate(paths.host())} onOpen={(offerId, topicId) => navigate(paths.hostOfferChatTopic(offerId, topicId))} />;
  if (route.page === 'video') {
    const offerId = query.get('offer');
    return <VideoRecorder offerId={offerId} onDone={() => navigate(offerId ? paths.hostOfferEdit(offerId, 'extract') : paths.hostMe(), { replace: true })} />;
  }
  if (route.page === 'new' || route.page === 'profile') return <View style={styles.centre}><Text style={t.sub}>{error ?? 'One moment…'}</Text></View>;

  if (!home) return <View style={styles.centre}><Text style={t.sub}>{error ?? 'Loading…'}</Text></View>;
  if (!home.host || !home.offers.length) return <LearnHome wide={wide} />;

  return (
    <View style={k.page}>
      <View style={wide ? k.wide : undefined}>
        <ScreenTop>
          <Press onPress={() => navigate(paths.hostMe())} accessibilityRole="button" accessibilityLabel="You, as a host" style={styles.menu}><Icon name="menu" size={16} color={colors.ink} strokeWidth={2} /></Press>
        </ScreenTop>
      </View>
      <ScrollView contentContainerStyle={[styles.body, wide && k.wide]}>
        <Dashboard home={home} onReset={async () => { await load(); navigate(paths.host(), { replace: true }); }} />
      </ScrollView>
    </View>
  );
}

/** S4 · live, with room to grow. */
function Dashboard({ home, onReset }: { home: HostHome; onReset: () => Promise<void> }) {
  const { navigate } = useRouter();
  const h = home.host!;
  const s = home.stats!;
  const order = { live: 0, in_review: 1, paused: 2, draft: 3, ended: 4 } as const;
  const offers = [...home.offers].sort((a, b) => order[a.state] - order[b.state]);
  const bookedOn = (id: string) => home.offers.find((o) => o.id === id)?.bookings.filter((b) => b.state !== 'cancelled').reduce((n, b) => n + b.heads, 0) ?? 0;
  const asks = home.asks ?? [];
  const first = h.name.split(' ')[0];
  return (
    <View>
      <View style={[k.gutter, { paddingTop: 14, gap: 10 }]}>
        <Press onPress={() => navigate(paths.hostMe())} accessibilityRole="button">
          <Text style={t.h27}>Hosting</Text>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
            {h.type ? <Tag tone="tint">{TYPE_CHIP[h.type].toUpperCase()}</Tag> : null}
            <Tag>{h.checks === 'running' ? 'CHECKS RUNNING' : TRUST_LABEL[h.trust].toUpperCase()}</Tag>
            <Text style={t.small}>{h.name}{h.location ? ` · ${h.location}` : ''}</Text>
          </View>
        </Press>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat n={String(s.live)} label={s.live === 1 ? 'offer live' : 'offers live'} />
          <Stat n={String(s.booked)} label="booked" />
          <Stat n={s.toComePence ? money(s.toComePence) : '£0'} label={home.config.payments.ready ? 'to come' : 'recorded'} />
        </View>
      </View>

      <View style={[k.gutter, { paddingTop: 16, gap: 8 }]}>
        <Text style={t.kicker}>Your offers</Text>
        <View>
          {offers.map((o, i) => (
            <Press key={o.id} onPress={() => navigate(o.state === 'draft' ? paths.hostOfferEdit(o.id, 'plan') : paths.hostOffer(o.id))} accessibilityRole="button" style={[styles.offer, k.rule, i === 0 && k.ruleTop]}>
              <View style={styles.thumb}>
                {mediaUrl(o.photos[0]) ? <Image source={{ uri: mediaUrl(o.photos[0])! }} style={[StyleSheet.absoluteFill, { borderRadius: 8 }]} resizeMode="cover" /> : <Icon name={SHAPE_ICON[o.shape]} size={18} color={colors.inkMuted} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                  <Tag tone="ink">{SHAPE_LABEL[o.shape].toUpperCase()}</Tag>
                  <Tag tone={o.state === 'live' ? 'lime' : 'warm'}>{STATE_LABEL[o.state].toUpperCase()}</Tag>
                  {o.visibility !== 'public' ? <Tag>{VISIBILITY_CHIP[o.visibility].toUpperCase()}</Tag> : null}
                </View>
                <Text style={[t.body, { fontWeight: '600', lineHeight: 18, marginTop: 3 }]} numberOfLines={2}>{o.title ?? 'Untitled'}</Text>
                <Text style={t.tiny} numberOfLines={1}>{[priceWords(o), o.visibility !== 'public' && o.invites.length ? `${o.invites.filter((iv) => iv.rsvp === 'yes').length} of ${o.invites.length} said yes` : `${bookedOn(o.id)} booked`].join(' · ')}</Text>
              </View>
            </Press>
          ))}
        </View>
        <Press onPress={() => navigate(paths.hostNewOffer())} accessibilityRole="button" style={styles.addBar}>
          <Text style={[t.body, { fontSize: 15, fontWeight: '700', color: INK }]}>Add another thing you do</Text>
          <Icon name="add" size={18} color={INK} strokeWidth={2} />
        </Press>
        {asks.length ? (
          <View style={{ gap: 7, marginTop: 8 }}>
            <Text style={t.kicker}>People have asked {first} about</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -2 }}>{asks.map((a, i) => <Tag key={i} tone="plain">{a}</Tag>)}</View>
            <Text style={[t.small, { lineHeight: 18 }]}>{asks.length === 1 ? 'One person' : `${['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][asks.length - 2] ?? asks.length} people`} asked for something you do not offer yet. Each one is a second offer waiting to be written.</Text>
          </View>
        ) : null}
        {!h.introVideo || h.checks === 'running' ? (
          <Text style={[t.small, { lineHeight: 18, marginTop: 8 }]}>{h.checks === 'running' ? 'Your checks are running; the profile says so until they pass. ' : ''}{!h.introVideo ? 'No intro video yet — people book the person. Record one from your profile.' : ''}</Text>
        ) : null}
        <DeleteAll onDone={onReset} />
      </View>
    </View>
  );
}

/**
 * Delete all events (owner, 13 Sep 2026: "I'm currently in testing mode on the
 * hosting tab… reset me back to the starting point so that I can continue my
 * testing"). Two taps: the host record, every offer, invitation and video go —
 * anyone still holding a place is called off and refunded on the way — and the
 * tab is the learn layer again.
 */
function DeleteAll({ onDone }: { onDone: () => Promise<void> }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (!arm) {
    return (
      <Press onPress={() => setArm(true)} accessibilityRole="button" style={{ paddingVertical: 14, marginTop: 8 }}>
        <Text style={[t.small, { color: colors.overrun, fontWeight: '700', textAlign: 'center' }]}>Delete all events</Text>
      </Press>
    );
  }
  return (
    <View style={styles.deleteBox}>
      <Text style={[t.sub, { color: colors.ink }]}>Everything goes: your host profile, every offer, every invitation and every video. Anyone holding a place is called off and refunded. You start again from the beginning.</Text>
      {said ? <Text style={[t.small, { color: colors.overrun }]}>{said}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Delete all events" kind="danger" icon="delete" loading={busy} onPress={async () => { setBusy(true); try { await api.stopHosting(true); await onDone(); } catch (e: any) { setSaid(e.message); } finally { setBusy(false); } }} />
        <Button label="Keep them" kind="ghost" onPress={() => setArm(false)} />
      </View>
    </View>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return <View style={styles.stat}><Text style={t.h21}>{n}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  body: { paddingBottom: 40 },
  menu: { width: 36, height: 36, borderWidth: 1, borderColor: colors.ruleSoft, alignItems: 'center', justifyContent: 'center' },
  stat: { flex: 1, backgroundColor: colors.surfaceMuted, paddingVertical: 12, paddingHorizontal: 10 },
  statLabel: { fontFamily: fonts.body, fontSize: 10.5, fontWeight: '600', color: colors.inkMuted, lineHeight: 14 },
  offer: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 11 },
  thumb: { width: 74, height: 56, borderRadius: 8, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' },
  addBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 50, backgroundColor: LIME, marginTop: 6 },
  deleteBox: { padding: 14, gap: 10, borderWidth: 2, borderColor: colors.overrun, marginTop: 8 },
});
