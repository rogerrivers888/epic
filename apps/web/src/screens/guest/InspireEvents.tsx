/**
 * Every event near you (guest handoff G1c): See all on Inspire's Events near
 * you lane. The lime sub-page header (6c — back, title, the count line, the
 * mic), then the filters as dropdowns — Kind · When · Who it's for · Price, each
 * turning lime with its value once set — then every event as the Inspire card.
 * Where it is looking from, how far, and the filters are the query.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, type EventNear } from '../../api';
import { CompactBand, MicTile } from '../../components/Band';
import { EventCard } from '../../components/InspireBody';
import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { paths } from '../../routes';
import { asOneOf, asText, useQueryState, useRouter } from '../../router';
import { Buttons, CREAM, GuestPage, GuestSheet, HAIRLINE, INK, INK_MUTED, LIME, Para, Waiting, tx } from './kit';

const FILTERS = {
  kind: { label: 'Kind', all: 'All kinds', options: ['All kinds', 'One-off', 'Weekly', 'Course', 'On request'] },
  when: { label: 'When', all: 'Any time', options: ['Any time', 'This weekend', 'Next 7 days', 'Next 30 days'] },
  who: { label: 'Who it’s for', all: 'Anyone', options: ['Anyone', 'Families', 'Adults only', 'Children · drop off'] },
  price: { label: 'Price', all: 'Any price', options: ['Any price', 'Free', 'Under £20', '£20 to £50', '£50 and over'] },
} as const;
type FilterKey = keyof typeof FILTERS;
const LANE_OF: Record<string, string> = { 'One-off': 'oneoff', Weekly: 'weekly', Course: 'course', 'On request': 'onrequest' };

const daysTo = (ymd: string | null) => (ymd ? Math.round((new Date(`${ymd}T12:00:00Z`).getTime() - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime()) / 86_400_000) : null);
// The price a card shows, for the Price filter: the child rate on children-only events, a weekly class's lower kind price.
const each = (e: EventNear) => {
  const p = e.price;
  if (p.mode === 'free') return 0;
  if (p.nowEach != null) return p.nowEach;
  if ((e.who.dropOff || (e.who.ageMax != null && e.who.ageMax < 18)) && p.childPence) return p.childPence;
  if (p.pence) return p.pence;
  const kinds = [p.dropInPence, p.bookAheadPence].filter((n): n is number => typeof n === 'number' && n > 0);
  return kinds.length ? Math.min(...kinds) : 0;
};

function passes(e: EventNear, f: Record<FilterKey, string>): boolean {
  if (f.kind !== FILTERS.kind.all && e.lane !== LANE_OF[f.kind]) return false;
  const d = daysTo(e.date);
  if (f.when === 'This weekend') { if (d == null) return false; const dow = new Date(`${e.date}T12:00:00Z`).getUTCDay(); if (d > 6 || (dow !== 0 && dow !== 6)) return false; }
  if (f.when === 'Next 7 days' && (d == null || d > 7)) return false;
  if (f.when === 'Next 30 days' && (d == null || d > 30)) return false;
  const adultsOnly = e.who.ageMin != null && e.who.ageMin >= 18;
  if (f.who === 'Families' && (adultsOnly || e.who.dropOff)) return false;
  if (f.who === 'Adults only' && !adultsOnly) return false;
  if (f.who === 'Children · drop off' && !e.who.dropOff) return false;
  const p = each(e);
  if (f.price === 'Free' && p !== 0) return false;
  if (f.price === 'Under £20' && !(p < 2000)) return false;
  if (f.price === '£20 to £50' && !(p >= 2000 && p <= 5000)) return false;
  if (f.price === '£50 and over' && !(p >= 5000)) return false;
  return true;
}

export function InspireEvents() {
  const { navigate, back } = useRouter();
  const [lat] = useQueryState<string>('lat', '', asText);
  const [lng] = useQueryState<string>('lng', '', asText);
  const [m] = useQueryState<string>('m', '', asText);
  const [at] = useQueryState<string>('at', '', asText);
  const [kind, setKind] = useQueryState('kind', FILTERS.kind.all as string, asOneOf(FILTERS.kind.options as unknown as string[], FILTERS.kind.all));
  const [when, setWhen] = useQueryState('when', FILTERS.when.all as string, asOneOf(FILTERS.when.options as unknown as string[], FILTERS.when.all));
  const [who, setWho] = useQueryState('who', FILTERS.who.all as string, asOneOf(FILTERS.who.options as unknown as string[], FILTERS.who.all));
  const [price, setPrice] = useQueryState('price', FILTERS.price.all as string, asOneOf(FILTERS.price.options as unknown as string[], FILTERS.price.all));
  const [open, setOpen] = useState<FilterKey | null>(null);
  const [events, setEvents] = useState<EventNear[] | null>(null);
  const [place, setPlace] = useState<string>(at);
  const [error, setError] = useState<string | null>(null);
  const minutes = Number(m) || 60;

  useEffect(() => {
    const go = (la: number, ln: number) => api.eventsNear({ lat: la, lng: ln, minutes }).then((r) => setEvents(r.events)).catch((e) => setError(e?.message ?? 'Events didn’t load.'));
    if (Number.isFinite(Number(lat)) && lat && lng) { void go(Number(lat), Number(lng)); return; }
    // Opened from a link: from home, as Inspire is when nothing else is said.
    api.household().then((h) => {
      const home = h.household?.home;
      if (home?.lat != null && home?.lng != null) { setPlace(home.locality ?? home.label ?? ''); void go(home.lat, home.lng); } else setError('Set your home in Settings to see events near you.');
    }).catch((e) => setError(e?.message ?? 'Events didn’t load.'));
  }, [lat, lng, minutes]);

  const f = { kind, when, who, price } as Record<FilterKey, string>;
  const set: Record<FilterKey, (v: string) => void> = { kind: setKind, when: setWhen, who: setWho, price: setPrice };
  const list = useMemo(() => (events ?? []).filter((e) => passes(e, f)), [events, kind, when, who, price]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!events) return <Waiting error={error} />;

  const reach = minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;
  return (
    <GuestPage
      head={<CompactBand title="Events near you" context={`${list.length} event${list.length === 1 ? '' : 's'} · up to ${reach}${place ? ` from ${place}` : ''}`}
                         onBack={() => back(paths.inspire())} right={<MicTile onPress={() => navigate(paths.say({ for: 'inspire' }))} />} />}
      overlay={open ? (
        <GuestSheet title={FILTERS[open].label} onClose={() => setOpen(null)}>
          <Buttons items={FILTERS[open].options.map((o) => ({ key: o, label: o, tone: f[open] === o ? 'ink' as const : undefined, onPress: () => { set[open](o); setOpen(null); } }))} />
        </GuestSheet>
      ) : null}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}>
        {(Object.keys(FILTERS) as FilterKey[]).map((k) => {
          const on = f[k] !== FILTERS[k].all;
          return (
            <Press key={k} onPress={() => setOpen(k)} accessibilityRole="button" accessibilityLabel={`${FILTERS[k].label}: ${f[k]}`}
                   style={{ height: 36, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: on ? INK : HAIRLINE, backgroundColor: on ? LIME : CREAM }}>
              <Text style={tx(13, on ? '800' : '600')}>{on ? f[k] : FILTERS[k].label}</Text>
              <Icon name="expand" size={12} color={INK} strokeWidth={2.6} />
            </Press>
          );
        })}
      </ScrollView>
      {/* The wide card brings its own 20px gutter, as in Inspire's drill-down. */}
      <View style={{ gap: 20, marginHorizontal: -20 }}>
        {list.map((e) => <EventCard key={e.id} e={e} wide onOpen={() => navigate(paths.experience(e.id))} />)}
      </View>
      {!events.length ? <Para color={INK_MUTED}>No events near you yet</Para> : !list.length ? <Para color={INK_MUTED}>Nothing matches those filters.</Para> : null}
    </GuestPage>
  );
}
