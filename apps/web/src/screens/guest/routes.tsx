/**
 * Which guest screen an address opens (guest handoff). An event from the four
 * lanes gets the guest pages (G2–G10, G23, G24); an offer made before them keeps
 * the older page it was built with. Signed out, the same pages are the web ones:
 * the epic.day wordmark where the back button was, and no tab bar.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import type { Route } from '../../routes';
import { useRouter } from '../../router';
import { ExperienceScreen } from '../ExperienceScreen';
import { Book } from './Book';
import { EventPage } from './EventPage';
import { Waiting } from './kit';

export function GuestEvent({ route, webPage }: { route: Extract<Route, { name: 'experience' }>; webPage: boolean }) {
  const { query } = useRouter();
  const l = query.get('l');
  const i = query.get('i');
  const [lane, setLane] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setLane(undefined);
    api.experience(route.id, i, l).then((r) => setLane(r.offer.lane ?? null)).catch(() => setLane(null));
  }, [route.id, i, l]);
  if (lane === undefined) return <Waiting />;
  // An older offer, and a question already asked (?topic=, from Messages), keep the page they were built on.
  if (!lane || query.get('topic')) return <ExperienceScreen route={route} />;
  if (route.layer === 'book') return <Book id={route.id} webPage={webPage} linkToken={l} inviteToken={i} />;
  if (route.layer === 'ask' || route.layer === 'where') return <ExperienceScreen route={route} />;
  return <EventPage id={route.id} webPage={webPage} linkToken={l} inviteToken={i} />;
}
