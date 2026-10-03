/**
 * Which guest screen an address opens (guest handoff). An event from the four
 * lanes gets the guest pages (G2–G10, G23, G24); an offer made before them keeps
 * the older page it was built with. Signed out, the same pages are the web ones:
 * the epic.day wordmark where the back button was, and no tab bar.
 */

import React, { useEffect, useState } from 'react';
import { api, type Experience, type PaymentsConfig } from '../../api';
import type { Route } from '../../routes';
import { useRouter } from '../../router';
import { ExperienceScreen } from '../ExperienceScreen';
import { Book } from './Book';
import { EventPage } from './EventPage';
import { Waiting } from './kit';
import { Invite } from './Invite';
import { InvitedScreen } from '../InvitedScreen';

export function GuestEvent({ route, webPage }: { route: Extract<Route, { name: 'experience' }>; webPage: boolean }) {
  const { query } = useRouter();
  const l = query.get('l');
  const i = query.get('i');
  const [lane, setLane] = useState<string | null | undefined>(undefined);
  // Read once and handed on: every read of an event counts a view in the host's Insights (Codex, 3 Oct 2026).
  const [data, setData] = useState<{ offer: Experience; payments: PaymentsConfig } | null>(null);
  useEffect(() => {
    setLane(undefined); setData(null);
    api.experience(route.id, i, l).then((r) => { setData(r); setLane(r.offer.lane ?? null); }).catch(() => setLane(null));
  }, [route.id, i, l]);
  if (lane === undefined) return <Waiting />;
  // An older offer, and a question already asked (?topic=, from Messages), keep the page they were built on.
  if (!lane || query.get('topic')) return <ExperienceScreen route={route} />;
  if (route.layer === 'book') return <Book id={route.id} webPage={webPage} linkToken={l} inviteToken={i} initial={data?.offer ?? null} />;
  if (route.layer === 'ask' || route.layer === 'where') return <ExperienceScreen route={route} />;
  return <EventPage id={route.id} webPage={webPage} linkToken={l} inviteToken={i} initial={data} />;
}

/** An invitation: the guest page for an event from the four lanes, the older page for an older offer. */
export function GuestInvite({ token, webPage }: { token: string; webPage: boolean }) {
  const [lane, setLane] = useState<string | null | undefined>(undefined);
  useEffect(() => { setLane(undefined); api.invited(token).then((r) => setLane(r.offer.lane ?? null)).catch(() => setLane(null)); }, [token]);
  if (lane === undefined) return <Waiting />;
  return lane ? <Invite token={token} webPage={webPage} /> : <InvitedScreen token={token} />;
}
