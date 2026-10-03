/**
 * The Host tab (Settings revised v2 · Lane 3, SX7–SX21).
 *
 * Two states. Not a host yet: the learn layer (H1), unchanged. A host: a title
 * band with "Host" and an ink "+ New offer", then four tabs — Upcoming (SX15) ·
 * Stats (SX12) · Money (SX9) · Profile (SX8). Everything below a tab pushes a
 * screen with a back arrow, and every one of those is query state on this same
 * /host address (there is no new route): ?tab=, ?activity=&when=, ?level=1,
 * ?money=, ?skills=1, ?evidence=1 — the way this screen already carried ?view=.
 *
 * The old onboarding, the offer wizard, the per-offer dashboard, the host inbox,
 * the video recorder and the editable profile are untouched: they are the other
 * `route.page`s and are dispatched first, exactly as before.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, HostHome, OfferShape } from '../../api';
import { colors } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { paths, type Route } from '../../routes';
import { t } from '../../components/hostKit';
import { LearnExample, LearnExamples, LearnShape, LearnWho } from './Learn';
import { OfferWizard } from './OfferWizard';
import { OfferDashboard } from './OfferDashboard';
import { VideoRecorder } from './VideoRecorder';
import { ProfileScreen } from './ProfileScreen';
import { HostInbox } from '../../components/chat/HostInbox';
// Four ways to host (hosting v7): Host home 4e, a lane, its set-up, the checklist, the ending.
import { HostLanes, LaneScreen } from './v7/HostHome';
import { Setup } from './v7/Setup';
import { Publish } from './v7/Publish';
import { Ending } from './v7/Ending';
import { HOST_LANES, type HostLane } from '../../routes';
// Hosting v4, existing hosts (E1–E13): a host with a draft or an event lands on E1, not 4e.
import { HostDesk } from './desk/Desk';
import { DeskEventScreen } from './desk/Event';
import { DeskTodo } from './desk/Todo';
import { DeskAtRisk } from './desk/AtRisk';
import { DeskEvents } from './desk/Events';
import { DeskEarnings } from './desk/Earnings';
import { DeskFees } from './desk/Fees';
import { DeskInsights } from './desk/Insights';
import { DeskMessages, DeskAutoMessages } from './desk/Messages';
import { DeskReviews } from './desk/Reviews';
import { DeskMe } from './desk/Me';

const WIDE = 900;

export function HostScreen({ route }: { route: Extract<Route, { name: 'host' }> }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { navigate, query, setQuery, back } = useRouter();
  const [home, setHome] = useState<HostHome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const h = await api.hostHome();
      setHome(h); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load, route.page]);

  // A new offer is made one of the four ways to host; the old way's address goes there (Roger, 3 Oct 2026).
  useEffect(() => { if (route.page === 'new') navigate(paths.hostLanes(), { replace: true }); }, [route.page]);
  useEffect(() => { if (route.page === 'start') navigate(paths.hostMe(), { replace: true }); }, [route.page]);
  // The old dashboard is replaced by All events (hosting v4, E7); its address goes there.
  useEffect(() => { if (route.page === 'manage') navigate(paths.hostEvents(), { replace: true }); }, [route.page]);

  // Four ways to host — dispatched before anything else, and needing nothing loaded here.
  if (route.page === 'lanes') return <HostLanes />;
  if (route.page === 'home') return <HostDesk />;
  if (route.page === 'event' && route.offerId) return <DeskEventScreen offerId={route.offerId} />;
  if (route.page === 'todo') return <DeskTodo />;
  if (route.page === 'risk') return <DeskAtRisk />;
  if (route.page === 'events') return <DeskEvents />;
  if (route.page === 'earnings') return <DeskEarnings />;
  if (route.page === 'fees') return <DeskFees />;
  if (route.page === 'insights') return <DeskInsights />;
  if (route.page === 'messages') return <DeskMessages />;
  if (route.page === 'auto') return <DeskAutoMessages />;
  if (route.page === 'reviews') return <DeskReviews />;
  if (route.page === 'me') return <DeskMe />;
  if (route.page === 'lane' && route.param && (HOST_LANES as readonly string[]).includes(route.param)) return <LaneScreen lane={route.param as HostLane} />;
  if (route.page === 'compose' && route.param && (HOST_LANES as readonly string[]).includes(route.param)) return <Setup lane={route.param as HostLane} offerId={null} />;
  if (route.page === 'setup' && route.offerId) return <Setup lane={null} offerId={route.offerId} />;
  if (route.page === 'publish' && route.offerId) return <Publish offerId={route.offerId} />;
  if (route.page === 'done' && route.offerId) return <Ending offerId={route.offerId} />;

  // The existing sub-stacks, dispatched first and unchanged.
  if (route.page === 'shape' && route.param) return <LearnShape shape={route.param as OfferShape} wide={wide} />;
  if (route.page === 'examples') return <LearnExamples wide={wide} />;
  if (route.page === 'example' && route.param) return <LearnExample exampleKey={route.param} wide={wide} />;
  if (route.page === 'who') return <LearnWho wide={wide} />;
  if ((route.page === 'profile' || route.page === 'start') && home) return <ProfileScreen home={home} onChanged={load} />;
  if (route.page === 'edit' && route.offerId) return <OfferWizard offerId={route.offerId} home={home} onChanged={load} />;
  if (route.page === 'offer' && route.offerId) return <OfferDashboard offerId={route.offerId} hostName={home?.host?.name ?? ''} chat={route.chat ?? null} />;
  if (route.page === 'questions') return <HostInbox onBack={() => navigate(paths.host())} onOpen={(offerId, topicId) => navigate(paths.hostOfferChatTopic(offerId, topicId))} />;
  if (route.page === 'video') {
    const offerId = query.get('offer');
    return <VideoRecorder offerId={offerId} onDone={() => navigate(offerId ? paths.hostOfferEdit(offerId, 'extract') : paths.hostMe(), { replace: true })} />;
  }
  if (route.page === 'new' || route.page === 'profile') return <View style={styles.centre}><Text style={t.sub}>{error ?? 'One moment…'}</Text></View>;

  if (!home) return <View style={styles.centre}><Text style={t.sub}>{error ?? 'Loading…'}</Text></View>;
  // Not hosting yet: Host home 4e (hosting v7) — the four ways in; a host who hosts gets E1 (above).
  if (route.page !== 'manage') return <HostLanes yours={home.host ? home.offers.length : 0} />;
  // The old dashboard is gone (Roger, 3 Oct 2026): /host/offers is All events, by the effect above.
  return <Loading />;
}

function Loading() { return <View style={styles.centre}><Text style={t.sub}>One moment…</Text></View>; }

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
});
