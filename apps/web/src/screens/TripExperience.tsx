/**
 * The trip, the ideas feed and the shortlist — one screen, three stages
 * (trip redesign 8a, owner 29 Sep 2026: "the redesign becomes the trip
 * experience at /trips/<id>").
 *
 * Once a trip exists the screen changes job. It shows the trip (a map with the
 * timeline below it), runs the X-ray search over the detour zone the first time
 * and whenever the user asks for more ideas, then hands over to an image-led
 * feed of everything within reach — Activities and Food & drink. Hearts build a
 * shortlist; a shortlisted place is added to the trip's timeline. Each stage has
 * its own address (`/trips/<id>`, `…/ideas/<tab>`, `…/shortlist`), and because
 * this one component is mounted across all three the moves between them animate
 * rather than cutting.
 *
 * It reuses the app's own map (`MapGL`, with the detour zone as its `shade` and
 * the shortlist's Epic pins as the `pin` kind), the place drawer (`VenueDrawer`,
 * opened on `?place=`), and the trip/along/shortlist data layer. The old
 * pin-search browse it replaces is gone.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api, DayStop, HouseholdResponse, LegMode, ShortlistItem, ShortlistStatus, TripAlongPlace, TripDay, TripDetail } from '../api';
import type { BrowseItem } from '../api';
import { storage } from '../storage';
import { CHIP_SCRIM, CREAM, GHOST, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_EDGE, LIME_TINT, MOSS, NEUTRAL, fonts } from '../theme';
import { Icon, type IconName } from '../components/Icon';
import { Press } from '../components/press';
import { MapGL } from '../components/MapGL';
import type { MapMarker, MapRoute } from '../components/MapGL';
import { VenueDrawer } from '../components/VenueDrawer';
import { VenueThumb, MEDIA_RADIUS, CARD_W, CARD_H } from '../components/VenueThumb';
import { ScanOverlay } from '../components/ScanOverlay';
import { CompactBand, MicTile } from '../components/Band';
import { InkMenu } from '../components/InkMenu';
import { useViewport } from '../hooks/useViewport';
import { flyHeart } from '../components/epicHeart';
import { searchGround } from '../components/searchGround';
import { paths, withQuery, type IdeasTab } from '../routes';
import { useQueryState, useRouter, asText, asOneOf } from '../router';
import { buildFeed, bandCount, destShortName, DETOUR_BANDS, type FeedCard } from './tripIdeas';
// The Stays tab exposes the same accommodation workflow the old `stay` menu route
// used; StayPanel lives in TripsScreen and is rendered here in the tab's drawer. The
// import is a runtime cycle (TripsScreen renders TripExperience), safe because it is
// only referenced inside the component body, by when both modules have evaluated.
import { StayPanel } from './TripsScreen';

const GREY = HAIRLINE;
const MUTED = INK_MUTED;

type Stage = 'trip' | 'search' | 'feed' | 'short';
/** The four peer tabs on a trip (nav 6a–6c): the map's ink menu. */
type TripTab = IdeasTab | 'stays' | 'shortlist';
type ShortTab = 'all' | 'activities' | 'food';
type StopWithSlot = DayStop & { slot: 'morning' | 'afternoon' | 'evening' };
const SLOT_ORDER = ['morning', 'afternoon', 'evening'];

/**
 * Trips just created this session, so the X-ray search runs once when the
 * itinerary first opens — even when creation went via Getting there, where the
 * `?new=1` marker does not survive the detour, and on native, which has no
 * localStorage (Codex). In memory: it does not need to outlive the session, and
 * this is the one signal that works on both platforms and across the detour.
 */
const justCreatedTrips = new Set<string>();
export const markTripJustCreated = (id: string) => { justCreatedTrips.add(id); };
/** The last-searched signature per trip, in memory, so a route/time/mode change re-scans even without storage. */
const searchSigs = new Map<string, string>();

const HEART_PATH = 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z';

// The detour band is one of 10/15/30 only; anything else in the URL falls to 15
// so a hand-edited value cannot ask for a zone the 30-minute pool cannot fill.
const detourCodec = {
  read: (raw: string): number | null => ((DETOUR_BANDS as readonly number[]).includes(Number(raw)) ? Number(raw) : null),
  write: (v: number): string | null => (v === 15 ? null : String(v)),
};

// The three ways of getting about the trip picker offers — car, walking, public
// transport (owner, 30 Sep 2026). Canonical words, so they match `trip.travelMode`
// and `modeIcon`; the along-route API normalises them either way.
// The picker offers the three the owner named — car, walking, public transport
// — like Inspire. `cycling` is not a button, but it is a valid mode a trip can
// already be, so it stays a legal value: a cycling trip seeds and searches as
// cycling rather than being forced to driving (Codex), with no button lit.
const TRIP_MODES = ['driving', 'walking', 'transit'] as const;
const MODE_VALUES = ['driving', 'walking', 'transit', 'cycling'] as const;
type TripMode = typeof MODE_VALUES[number];
const MODE_LABEL: Record<TripMode, string> = { driving: 'Drive', walking: 'Walk', transit: 'Public transport', cycling: 'Cycle' };

// All trip times are worked in wall-clock minutes in the trip's own timezone, so
// nothing shifts when the device is in another zone (Codex). An ISO timestamp
// (the day's start, the departure) is read into minutes there; a stop's "HH:MM"
// is already that wall clock. `TripDay.startTime` is a full ISO, `DayStop`'s is
// "HH:MM" — both are handled.
const isoMinutes = (iso: string | null | undefined, tz?: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz ?? undefined }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === 'hour')?.value);
    const m = Number(parts.find((p) => p.type === 'minute')?.value);
    return Number.isFinite(h) ? (h % 24) * 60 + (m || 0) : null;
  } catch {
    return d.getHours() * 60 + d.getMinutes();
  }
};
const hmMinutes = (hhmm: string | null | undefined): number | null => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};
const fmtMinutes = (mins: number | null): string => (mins == null ? '' : `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(((mins % 60) + 60) % 60).padStart(2, '0')}`);
const clock = (iso: string | null | undefined, tz?: string | null): string => fmtMinutes(isoMinutes(iso, tz));
const addMin = (iso: string | null | undefined, mins: number, tz?: string | null): string => { const b = isoMinutes(iso, tz); return b == null ? '' : fmtMinutes(b + Math.round(mins)); };

const seededFlag = (key: string): boolean => storage.getItem(key) === '1';
const setFlag = (key: string, on: boolean) => {
  if (on) storage.setItem(key, '1'); else storage.removeItem(key);
};

/** A place's fit line, always "+N min detour" in 8a. */
const fitOf = (mins: number | null | undefined): string => (mins != null ? `+${Math.round(mins)} min detour` : 'On your way');

/** Straight-line km — confirms a name match is the seeded destination, not a namesake. */
function kmApart(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The card heart chip (38px round, ink at 32%): a 20px cream-outline heart when
 * off, a solid lime heart when on. The two are stacked exactly, and the solid
 * one carries `data-ov` so `epicHeart` can pop it as it flies to the shortlist.
 */
function CardHeart({ on }: { on: boolean }) {
  return (
    <View style={styles.heartChip}>
      <View style={{ width: 20, height: 20 }}>
        <Svg width={20} height={20} viewBox="0 0 24 24" style={StyleSheet.absoluteFill}>
          <Path d={HEART_PATH} fill="none" stroke={CREAM} strokeWidth={2.2} strokeLinejoin="round" />
        </Svg>
        <View {...({ dataSet: { ov: '1' } } as object)} style={[StyleSheet.absoluteFill, { opacity: on ? 1 : 0 }]}>
          {/* On: a solid lime heart with no ink edge (README line 132). */}
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path d={HEART_PATH} fill={LIME} stroke={LIME} strokeWidth={2.2} strokeLinejoin="round" />
          </Svg>
        </View>
      </View>
    </View>
  );
}

export function TripExperience({ d, days, household, wide, section, ideasTab, onBack, onChanged, onMenu }: {
  d: TripDetail;
  /** Every day of the trip; the shown one is picked by `?day=` (a day trip has one). */
  days: TripDay[];
  household: HouseholdResponse | null;
  wide: boolean;
  section: 'ideas' | 'shortlist' | 'stays' | null;
  ideasTab: IdeasTab;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onMenu?: () => void;
}) {
  const id = d.trip.id;
  const trip = d.trip;
  const { navigate, query, setQuery } = useRouter();
  const [detour, setDetour] = useQueryState<number>('detour', 15, detourCodec);
  // The car / walking / public-transport picker, restored on the trip (owner,
  // 30 Sep 2026: it "has gone from the Trips tab"). It rides in the address, the
  // detour zone and the along-route search both use it, and it seeds from the
  // trip's own mode. `travelMode` normalises the trip's canonical word.
  const tripModeSeed: TripMode = (MODE_VALUES as readonly string[]).includes(trip.travelMode) ? (trip.travelMode as TripMode) : 'driving';
  // The codec's fallback is the trip's own mode, so an absent `?by` means the
  // trip's mode and picking a *different* mode writes it down — otherwise Drive
  // on a walking trip serialised to nothing and snapped straight back (Codex).
  const [by, setBy] = useQueryState<TripMode>('by', tripModeSeed, asOneOf(MODE_VALUES, tripModeSeed));
  const [place, setPlace] = useQueryState<string | null>('place', null, asText);
  const [showRaw, setShow] = useQueryState<string | null>('show', null, asText);
  // Which day the trip stage shows and adds to; `?day=` on a multi-day trip.
  const [dayId, setDayId] = useQueryState<string | null>('day', null, asText);
  const day = useMemo(() => days.find((x) => x.id === dayId) ?? days[0] ?? null, [days, dayId]);
  const show = (showRaw ?? 'all') as ShortTab;

  // The detour band and the selected day travel with the moves between stages,
  // so the feed filters the way you left it and adding lands on the day you
  // chose — the defaults (15 min, the first day) are never written down.
  // The picked mode travels with the moves between stages too, or switching
  // Activities/Food or opening the shortlist would drop it back to the trip's
  // own mode (Codex).
  // The new-trip marker rides along every move until the scan consumes it: after a
  // refresh `?new=1` is the only durable creation signal, and opening Stays or the
  // Shortlist first would otherwise drop it and lose the first-search scan (Codex).
  const carried = () => ({
    detour: detour !== 15 ? String(detour) : null,
    day: dayId && dayId !== days[0]?.id ? dayId : null,
    by: by !== tripModeSeed ? by : null,
    new: (query.get('new') === '1' || justCreatedTrips.has(id)) ? '1' : null,
  });
  const feedHref = (tab: IdeasTab) => withQuery(paths.tripIdeas(id, tab), carried());
  const shortHref = () => withQuery(paths.tripShortlist(id), carried());
  const tripHref = () => withQuery(paths.trip(id), carried());

  const searchedKey = `epic.trip.${id}.searched`;
  const collapsedKey = `epic.trip.${id}.ideasCollapsed`;
  const sigKey = `epic.trip.${id}.searchSig`;
  // A durable record that this trip is still awaiting its first scan. `?new=1` and the
  // in-memory marker are both lost once the user leaves the trip and reloads, so on
  // their own the promised first-search scan is skipped for good on return; this flag
  // survives in storage and is cleared only when the scan actually runs (Codex).
  const newKey = `epic.trip.${id}.new`;
  const [searched, setSearched] = useState(() => seededFlag(searchedKey));

  // The search stands until the route, the time or the mode changes; then it
  // runs again on the next visit to the trip (README). A signature of those
  // three, kept per trip, is what tells the difference from a plain reopen.
  // Keyed on the trip's own route, time and mode — NOT the browse picker `by`.
  // The picker refetches the pools itself (below); folding it in here marked a
  // rescan that then replayed the X-ray scan on "Back to my trip" (Codex).
  const searchSig = `${trip.origin?.lat},${trip.origin?.lng},${trip.base?.lat},${trip.base?.lng},${trip.destination?.lat},${trip.destination?.lng},${trip.departAt},${trip.travelMode}`;
  // The scan plays only when a trip is genuinely new (`?new=1` from creation) or
  // its route/time/mode has changed since it was last searched — never merely
  // because this browser has no record of it, which would fire a paid search on
  // every old trip a returning user opens (Codex).
  // Just created, so the scan should run once when the itinerary first opens:
  // `?new=1` on the direct route, or the in-memory marker for the ones that
  // reach the itinerary indirectly (e.g. via Getting there), on either platform.
  const justCreated = query.get('new') === '1' || justCreatedTrips.has(id) || seededFlag(newKey);
  // Persist the creation marker the first time it is seen, so it outlives `?new` and
  // the in-memory set across a leave-and-reload (Codex). onScanDone clears it.
  useEffect(() => { if (justCreated && !seededFlag(newKey)) setFlag(newKey, true); }, [justCreated, newKey]);
  const [needsRescan, setNeedsRescan] = useState(false);
  // The scan only ever runs where there is a route to search along.
  const canSearch = Boolean(trip.origin?.lat != null || trip.base?.lat != null);
  useEffect(() => {
    // The signature is kept in memory as well as the device store, so a
    // route/time/mode change is caught even where storage is blocked (Codex).
    let prev: string | null = searchSigs.get(id) ?? null;
    if (prev == null) prev = storage.getItem(sigKey);
    if (prev === searchSig) return;
    if (prev == null) {
      // A first sighting is not a re-search: baseline the signature so a *later*
      // change is caught, raising no pending scan. But NOT while the trip is still
      // awaiting its first scan (`justCreated`) — baselining then would record it as
      // searched and skip that scan if the marker is later lost; onScanDone commits
      // the signature once the scan has run (Codex).
      if (!justCreated) { searchSigs.set(id, searchSig); storage.setItem(sigKey, searchSig); }
      return;
    }
    // A known signature changed → a re-search is pending. Do NOT store the new
    // signature yet: the scan is deferred until an ideas tab is opened, and if the
    // bare trip is reloaded first the stored (old) signature must still differ so
    // this fires again. onScanDone commits the signature once the scan runs (Codex).
    setSearched(false); setFlag(searchedKey, false); setNeedsRescan(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSig, sigKey, searchedKey, id, justCreated]);
  // Whether a scan is pending, read SYNCHRONOUSLY during render — never from the
  // `needsRescan` state alone, which the signature effect only queues and so lags a
  // render behind. Comparing the stored signature to the trip's current one here means
  // a route/time/mode change is known on the very first render, so a direct ideas
  // route or a refreshed interrupted scan starts the scan instead of being marked
  // searched (Codex). A pending scan is a genuinely new trip, or such a change.
  const storedSig = searchSigs.get(id) ?? storage.getItem(sigKey);
  const sigChanged = storedSig != null && storedSig !== searchSig;
  const scanPending = canSearch && (justCreated || needsRescan || sigChanged);
  const [scanning, setScanning] = useState(false);
  const [ideasCollapsed, setIdeasCollapsed] = useState(() => seededFlag(collapsedKey));
  const [minsOpen, setMinsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The tab the feed is on, kept while you step away so "Back to ideas" returns
  // to the same one (the feed layer stays mounted, so the scroll is kept too).
  const [lastTab, setLastTab] = useState<IdeasTab>(ideasTab);
  useEffect(() => { if (section === 'ideas') setLastTab(ideasTab); }, [section, ideasTab]);

  // The two search pools, one call per kind at the widest band; the detour
  // filter is then a client-side cut. Not stored (rented content) — refetched,
  // and the server serves it from cache without a new paid search.
  const [pools, setPools] = useState<{ activities: TripAlongPlace[]; food: TripAlongPlace[] } | null>(null);
  // The search each pool came from, so a shortlist made from it is attributed
  // to that search (the retired browse flow did the same) — held in a ref so the
  // reconcile loop reads it without a stale closure.
  const poolQ = useRef<{ activities: string | null; food: string | null }>({ activities: null, food: null });
  const [poolError, setPoolError] = useState(false);
  const [poolCounts, setPoolCounts] = useState<{ act: number; food: number }>({ act: 0, food: 0 });
  const loadingRef = useRef(false);
  // Which pool request is the latest — only it commits (Codex, mode-switch race).
  const poolToken = useRef(0);

  const stage: Stage = section === 'ideas' ? 'feed' : section === 'shortlist' ? 'short' : scanning ? 'search' : 'trip';

  // Optimistic overlays so a heart or an add answers the finger before the
  // reload lands. Reconciled against the trip whenever it changes.
  const [heartAdd, setHeartAdd] = useState<Set<string>>(new Set());
  const [heartRm, setHeartRm] = useState<Set<string>>(new Set());
  const [stopAdd, setStopAdd] = useState<Set<string>>(new Set());
  useEffect(() => { setHeartAdd(new Set()); setHeartRm(new Set()); setStopAdd(new Set()); }, [d]);
  // The freshest shortlist, for the reconcile loop below to read without a stale closure.
  const shortlistNow = useRef(d.shortlist);
  useEffect(() => { shortlistNow.current = d.shortlist; }, [d.shortlist]);

  const shortlistRefs = useMemo(() => {
    const s = new Set(d.shortlist.map((x) => x.venueRef));
    for (const r of heartAdd) s.add(r);
    for (const r of heartRm) s.delete(r);
    return s;
  }, [d.shortlist, heartAdd, heartRm]);
  // Places set aside on this trip: off the shortlist and out of this trip's feed,
  // so they do not keep coming back (owner, 30 Sep 2026). It is a per-trip hide,
  // not a household one — the place is untouched on other trips and in Inspire.
  const asideRefs = useMemo(() => new Set(d.shortlist.filter((s) => s.status === 'set_aside').map((s) => s.venueRef)), [d.shortlist]);
  // The pools the feed draws from, with this trip's set-aside places taken out —
  // used for the feed rows, its counts and the detour menu alike, so the menu
  // never promises more than the feed shows (Codex). The unfiltered `pools` stay
  // for the shortlist, which still needs a set-aside place's photo and detour.
  const livePools = useMemo(() => (pools ? {
    activities: pools.activities.filter((p) => !asideRefs.has(p.venueRef)),
    food: pools.food.filter((p) => !asideRefs.has(p.venueRef)),
  } : null), [pools, asideRefs]);
  // The stops on the day the trip stage shows — the timeline, and what "In trip"
  // is measured against. The API keys these to a day and groups them by slot
  // (morning/afternoon/evening); the flat timeline is the slots in order, each
  // in its own position order, and every stop carries its slot so a reorder
  // stays inside it and does not desync the day planner (Codex).
  const dayStops = useMemo<StopWithSlot[]>(
    () => (day
      ? [...day.slots]
          .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
          .flatMap((sl) => [...sl.stops].sort((a, b) => a.position - b.position).map((st) => ({ ...st, slot: sl.slot })))
      : []),
    [day],
  );
  const stopRefs = useMemo(() => {
    const s = new Set(dayStops.map((x) => x.venueRef));
    for (const r of stopAdd) s.add(r);
    return s;
  }, [dayStops, stopAdd]);

  const start = trip.base?.lat != null ? trip.base : trip.origin;
  const dest = trip.destination;
  // A based holiday sets out from its hotel — or, before one is booked, the
  // destination-city centre — not the household home, so the pin and the
  // timeline name the base rather than putting "Home" in the wrong town (Codex).
  // Only a base whose kind is `home` is actually home.
  const fromBase = trip.base?.lat != null && trip.base.kind !== 'home';
  const startLabel = fromBase ? (trip.base?.label?.split(',')[0]?.trim() || 'your base') : 'Home';
  const startIcon: IconName = fromBase ? (trip.base?.kind === 'centre' ? 'place' : 'hotel') : 'home';
  // A booked place to stay — only on an overnight trip, because a day outing stores
  // its destination as `trip.base` with kind 'other' too and is not a stay (Codex).
  // Nights are the span of the dates, the same way the trip card counts them. Not
  // home and not the stand-in city-centre; it heads The day as "Where you're staying"
  // (owner) and opens the Stays tab when tapped.
  const tripNights = trip.startDate && trip.endDate
    ? Math.max(0, Math.round((+new Date(`${trip.endDate}T12:00:00`) - +new Date(`${trip.startDate}T12:00:00`)) / 86400000))
    : 0;
  const stayBase = tripNights > 0 && trip.base && trip.base.lat != null && trip.base.kind !== 'home' && trip.base.kind !== 'centre' ? trip.base : null;
  // The destination is its own timeline row; an outing that seeded it as the
  // day's first stop must not also show a second, plain copy. The trip payload
  // does not carry the destination's ref, so it is matched on the identity that
  // is present — its ref if any, else its own name — which a genuinely
  // different place at the same address (a restaurant in the venue) does not share.
  const destKeys = useMemo(() => {
    const ks = new Set<string>();
    const add = (v?: string | null) => { if (v && v.trim()) ks.add(v.trim().toLowerCase()); };
    add(dest?.name); add(dest?.label); add(dest ? destShortName(trip) : null);
    return ks;
  }, [dest?.name, dest?.label]);
  // The name match must be confirmed by location, so one branch of a chain is
  // not mistaken for the seeded destination that happens to share its name
  // (Codex): same name AND within ~150m of the destination, or the exact ref.
  const isSeededDest = useCallback((s: StopWithSlot) => {
    if (dest?.ref && s.venueRef === dest.ref) return true;
    if (!destKeys.has((s.name ?? '').trim().toLowerCase())) return false;
    if (dest?.lat == null || s.lat == null || s.lng == null) return true;
    return kmApart(dest.lat, dest.lng as number, s.lat, s.lng) < 0.15;
  }, [dest?.ref, dest?.lat, dest?.lng, destKeys]);
  const addedStops = useMemo<StopWithSlot[]>(() => dayStops.filter((s) => !isSeededDest(s)), [dayStops, isSeededDest]);
  // The seeded destination stop keeps its own saved time and allowance, and its place in the day's order.
  const destStop = useMemo(() => dayStops.find(isSeededDest) ?? null, [dayStops, isSeededDest]);

  const loadPools = useCallback(async (force = false) => {
    if (pools && !force) return;
    // A non-forced load waits behind one in flight; a forced one (a mode change)
    // supersedes it — the token below makes the latest request the one that
    // commits, so selecting Walk then Drive can never leave Walk's pool under a
    // Drive-selected picker (Codex).
    if (loadingRef.current && !force) return;
    const token = ++poolToken.current;
    loadingRef.current = true;
    setPoolError(false);
    // A forced search follows a changed route/time/mode: drop the old journey's
    // results so a slow or failed refetch never shows suggestions for the old
    // one, and the retry UI can appear (Codex).
    if (force) { setPools(null); poolQ.current = { activities: null, food: null }; }
    try {
      // The detour minutes come back computed for the chosen mode, so walking
      // gives a far smaller pool than driving (owner, 30 Sep 2026).
      const [things, food] = await Promise.all([
        api.tripAlong(id, { kind: 'things', maxDetourMin: 30, mode: by }),
        api.tripAlong(id, { kind: 'food', maxDetourMin: 30, mode: by }),
      ]);
      if (token !== poolToken.current) return; // a newer mode/search superseded this one
      const noTransport = (p: TripAlongPlace) => !/station|bus_stop|parking|car_park|taxi/i.test(`${p.category ?? ''} ${p.subcategory ?? ''}`);
      poolQ.current = { activities: things.queryId ?? null, food: food.queryId ?? null };
      setPools({ activities: things.places.filter(noTransport), food: food.places.filter(noTransport) });
    } catch {
      // Leave the pools unset on failure and mark the error, so the feed offers
      // a retry rather than pinning an empty feed or a permanent spinner (Codex).
      if (token === poolToken.current) setPoolError(true);
    } finally {
      if (token === poolToken.current) loadingRef.current = false;
    }
  }, [id, pools, by]);

  // The band counts for the caption and the trip's "More ideas" line, kept live
  // as the pools arrive during a scan.
  useEffect(() => {
    if (!livePools) return;
    setPoolCounts({ act: bandCount(livePools.activities, detour), food: bandCount(livePools.food, detour) });
  }, [livePools, detour]);

  // The feed and shortlist need the pools; the searched trip stage needs them
  // too, so the "Back to ideas" bar shows real counts rather than 0; and a
  // ?place= deep link needs them to resolve the place it names (Codex).
  // While a scan is pending the scan's own forced load is the only one that runs;
  // the generic load stands aside for EVERY section, not just ideas. On a pending
  // trip, loading here would either show pools computed for a route/mode that is
  // about to be re-searched, or — after a Shortlist visit populated them — be
  // repeated by the forced load a scan then starts, since a forced load bypasses the
  // in-flight guard and fires both requests again (Codex). It resumes once the scan
  // has run and cleared the pending signal.
  useEffect(() => {
    if (scanPending) return;
    if (section === 'ideas' || section === 'shortlist' || place || (section == null && searched)) loadPools();
  }, [section, searched, place, scanPending, loadPools]);

  // A new mode is a new pool: the detour minutes come back computed for it, so
  // the cards, counts and zone must all be refetched, not just re-filtered — a
  // plain `loadPools()` short-circuits on the pool it already has (Codex).
  const lastModeRef = useRef(by);
  useEffect(() => {
    if (lastModeRef.current === by) return;
    lastModeRef.current = by;
    // Force regardless of whether a pool is present or a load is mid-flight —
    // the token in loadPools makes this latest mode the one that commits.
    loadPools(true);
  }, [by, loadPools]);

  // Reaching an ideas route with nothing already running. A scan selectTab started
  // is navigating through here too; `!scanning` stands aside for it. Otherwise there
  // are two cases (Codex):
  //  - a scan is PENDING (a genuinely new trip, or a changed route/time/mode) that
  //    arrived here directly — a shared link, or a refresh mid-scan that reset
  //    `scanning` to false: run it here rather than marking the trip searched, or
  //    the required search is skipped for good;
  //  - nothing pending — landing here is discovery already done, so mark it searched
  //    and do not replay the scan. Shortlist is never marked: opening it first must
  //    not skip the scan a later Activities/Food open still needs.
  useEffect(() => {
    if (section !== 'ideas' || searched || scanning) return;
    if (scanPending) { setScanning(true); loadPools(true); }
    else { setSearched(true); setFlag(searchedKey, true); }
  }, [section, searched, scanning, scanPending, searchedKey, loadPools]);

  // A new trip arrives on 6a with nothing selected (nav). The scan runs the first
  // time an Activities/Food tab is OPENED (selectTab), inside the map — not on
  // arrival — so the "new" marker must survive arrival and be consumed only when
  // the scan actually completes (onScanDone). A trip that can't be searched will
  // never scan, so clear its marker here rather than leave `?new` in the address.
  useEffect(() => {
    if (section == null && justCreated && !canSearch) {
      justCreatedTrips.delete(id);
      setFlag(newKey, false);
      if (query.get('new')) setQuery({ new: null }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, justCreated, canSearch, id, newKey]);

  const onScanDone = () => {
    // The scan plays inside the map while the drawer rises (nav 6e); when it ends
    // the tab is already open, so there is nothing to navigate to — just stop, and
    // retire the pending signal so it does not replay on the next tab-open or return.
    setScanning(false);
    setSearched(true);
    setFlag(searchedKey, true);
    setNeedsRescan(false);
    // Commit the signature only now the scan for it has actually run, so a reload
    // before the scan still sees the old signature and re-arms the rescan (Codex).
    searchSigs.set(id, searchSig);
    storage.setItem(sigKey, searchSig);
    justCreatedTrips.delete(id);
    setFlag(newKey, false);
    if (query.get('new')) setQuery({ new: null }, { replace: true });
  };

  const frameRef = useRef<any>(null);
  const shortlistBtnRef = useRef<any>(null);

  // --- data for the stages ----------------------------------------------
  const feed = useMemo(() => {
    if (!livePools) return null;
    const kind = lastTab;
    // Set-aside places are already out of livePools, so the next search never
    // brings a set-aside place straight back into the feed (owner).
    return buildFeed({ places: kind === 'food' ? livePools.food : livePools.activities, kind, trip, minutes: detour, mode: by });
  }, [livePools, lastTab, trip, detour, by]);

  const shortlistCards: FeedCard[] = useMemo(() => {
    // Everything on the shortlist, with its detour if the search knows it.
    const byRef = new Map<string, TripAlongPlace>();
    const foodRefs = new Set((pools?.food ?? []).map((p) => p.venueRef));
    for (const p of [...(pools?.activities ?? []), ...(pools?.food ?? [])]) byRef.set(p.venueRef, p);
    const priceOf = (p?: TripAlongPlace) => (p == null || p.priceLevel == null ? null : p.priceLevel === 0 ? 'Free' : '£'.repeat(Math.max(1, Math.min(4, Math.round(p.priceLevel)))));
    const cards = d.shortlist
      .filter((s) => shortlistRefs.has(s.venueRef))
      .map((s) => {
        const p = byRef.get(s.venueRef);
        const kind: 'activities' | 'food' = s.kind === 'food' ? 'food' : 'activities';
        const price = priceOf(p);
        const what = (s.category ?? p?.category ?? 'Place');
        return {
          ref: s.venueRef, name: s.name, photos: (p?.photos ?? []).slice(0, 1), category: s.category ?? p?.category ?? null, experiences: p?.experiences ?? [],
          fit: fitOf(p?.detourMinutes), typeR: p?.rating != null ? `${cap(what)} · ★ ${p.rating.toFixed(1)}${price ? ` · ${price}` : ''}` : cap(what),
          price, kind, onShortlist: true, onDay: stopRefs.has(s.venueRef), status: s.status,
          lat: s.lat ?? p?.lat ?? null, lng: s.lng ?? p?.lng ?? null, place: p as TripAlongPlace,
        } as FeedCard;
      });
    // A place hearted a moment ago, before the reload lands, is on the list too
    // (Codex): build its card from the pool so it shows and can be added at once.
    const persisted = new Set(d.shortlist.map((s) => s.venueRef));
    for (const r of heartAdd) {
      if (persisted.has(r) || !shortlistRefs.has(r)) continue;
      const p = byRef.get(r);
      if (!p) continue;
      const kind: 'activities' | 'food' = foodRefs.has(r) ? 'food' : 'activities';
      const price = priceOf(p);
      const what = p.category ?? 'Place';
      cards.push({
        ref: r, name: p.name, photos: (p.photos ?? []).slice(0, 1), category: p.category, experiences: p.experiences ?? [],
        fit: fitOf(p.detourMinutes), typeR: p.rating != null ? `${cap(what)} · ★ ${p.rating.toFixed(1)}${price ? ` · ${price}` : ''}` : cap(what),
        price, kind, onShortlist: true, onDay: stopRefs.has(r), lat: p.lat, lng: p.lng, place: p,
      } as FeedCard);
    }
    return cards;
  }, [d.shortlist, pools, shortlistRefs, stopRefs, heartAdd]);

  const shownShort = useMemo(
    // Set-aside places are off the list quietly (owner); Full stays, marked.
    () => shortlistCards.filter((c) => c.status !== 'set_aside' && (show === 'all' || (show === 'food' ? c.kind === 'food' : c.kind === 'activities'))),
    [shortlistCards, show],
  );
  // The set-aside ones, gathered for the quiet foot row that can bring them back.
  const asideCards = useMemo(() => shortlistCards.filter((c) => c.status === 'set_aside'), [shortlistCards]);
  const [shortSel, setShortSel] = useState<string | null>(null);
  useEffect(() => { if (shortSel && !shownShort.some((c) => c.ref === shortSel)) setShortSel(null); }, [shownShort, shortSel]);

  // --- mutations ---------------------------------------------------------
  // Hearting is optimistic, and the API calls per place run one at a time
  // toward the latest wanted state — so removing then re-adding (or the
  // reverse) before the first request lands cannot leave the server contradicting
  // the last tap (Codex). `desired` holds what each place should end up as.
  const desired = useRef(new Map<string, { want: boolean; card: FeedCard }>());
  const busy = useRef(new Set<string>());
  const reconcile = useCallback(async (ref: string) => {
    if (busy.current.has(ref)) return;
    busy.current.add(ref);
    try {
      for (;;) {
        const entry = desired.current.get(ref);
        if (!entry) break;
        const item = shortlistNow.current.find((x) => x.venueRef === ref);
        if (entry.want === !!item) { desired.current.delete(ref); break; }
        const detail = entry.want
          ? await api.addToShortlist(id, { venueRef: ref, venueLabel: entry.card.name, kind: entry.card.kind === 'food' ? 'food' : 'activity', category: entry.card.place?.category ?? null, lat: entry.card.lat, lng: entry.card.lng, queryId: entry.card.kind === 'food' ? poolQ.current.food : poolQ.current.activities })
          : await api.removeFromShortlist(id, item!.id);
        shortlistNow.current = detail.shortlist;
        await onChanged();
      }
    } catch {
      // The mutation failed: drop the intent and the optimistic overlay so the
      // heart falls back to the true server state rather than lying (Codex). The
      // heart visibly reverting is the feedback; the next tap starts fresh.
      desired.current.delete(ref);
      setHeartAdd((s) => { const n = new Set(s); n.delete(ref); return n; });
      setHeartRm((s) => { const n = new Set(s); n.delete(ref); return n; });
    } finally {
      busy.current.delete(ref);
    }
  }, [id, onChanged]);

  const toggleHeart = useCallback((card: FeedCard, chipEl?: Element | null) => {
    const want = !shortlistRefs.has(card.ref);
    desired.current.set(card.ref, { want, card });
    if (want) {
      setHeartAdd((s) => new Set(s).add(card.ref));
      setHeartRm((s) => { const n = new Set(s); n.delete(card.ref); return n; });
      // In the drawer the old feed Shortlist button is gone, so the heart flies to
      // the Shortlist tab in the ink menu — the marker's parent cell, so the bump on
      // landing scales that tab, not the whole frame (Codex). Null if it is not on
      // screen, and then the heart just pops in place rather than bumping anything.
      const flyTarget: Element | null = shortlistBtnRef.current
        ?? (frameRef.current?.querySelector?.('[data-fly-to]') as Element | null)?.parentElement
        ?? null;
      if (chipEl) flyHeart(chipEl, { frame: frameRef.current, target: flyTarget });
    } else {
      setHeartRm((s) => new Set(s).add(card.ref));
      setHeartAdd((s) => { const n = new Set(s); n.delete(card.ref); return n; });
    }
    reconcile(card.ref);
  }, [shortlistRefs, reconcile]);

  const addToTrip = useCallback((card: FeedCard) => {
    if (!day || stopRefs.has(card.ref)) return;
    setStopAdd((s) => new Set(s).add(card.ref));
    const sl = d.shortlist.find((x) => x.venueRef === card.ref);
    // No dwell here: the API picks the right default for the category — an
    // attraction is not a café — and only an explicit choice should override it.
    // Category is omitted, not nulled, when unknown, so the server keeps the
    // shortlisted item's own and its category-specific dwell (Codex).
    const category = card.place?.category ?? sl?.category ?? undefined;
    api.addStopToDay(id, day.id, { venueRef: card.ref, name: card.name, lat: card.lat, lng: card.lng, category, shortlistId: sl?.id })
      .then(() => onChanged()).catch(() => setStopAdd((s) => { const n = new Set(s); n.delete(card.ref); return n; }));
  }, [day, stopRefs, id, d.shortlist, onChanged]);

  const moveStop = useCallback((stopId: string, dir: -1 | 1) => {
    if (!day) return;
    // Swap with the immediately adjacent stop in the day's own order, but only
    // when that neighbour is in the same slot and is not the seeded destination —
    // so a reorder never crosses the fixed destination anchor or a slot boundary
    // (Codex). The whole day is sent so positions stay in step.
    const i = dayStops.findIndex((s) => s.id === stopId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= dayStops.length) return;
    const neighbour = dayStops[j];
    if (neighbour.id === destStop?.id || neighbour.slot !== dayStops[i].slot) return;
    const full = dayStops.map((s) => s.id);
    [full[i], full[j]] = [full[j], full[i]];
    api.reorderDayStops(id, day.id, full).then(() => onChanged()).catch(() => {});
  }, [day, dayStops, destStop, id, onChanged]);

  const updateShortlistItem = useCallback((itemId: string, patch: Parameters<typeof api.updateShortlist>[2]) =>
    api.updateShortlist(id, itemId, patch).then(() => onChanged()).catch(() => {}), [id, onChanged]);

  // --- the map: markers, route, detour zone ------------------------------
  const tripMarkers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    if (start?.lat != null) out.push({ id: 'start', lat: start.lat, lng: start.lng as number, kind: fromBase ? 'base' : 'home', icon: startIcon, label: startLabel, tag: clock(trip.departAt, trip.timezone) });
    if (dest?.lat != null) out.push({ id: 'dest', lat: dest.lat, lng: dest.lng as number, kind: 'dest', label: destShortName(trip), tag: trip.journey?.minutes ? addMin(trip.departAt, trip.journey.minutes, trip.timezone) : null });
    for (const s of addedStops) if (s.lat != null) out.push({ id: s.venueRef, lat: s.lat, lng: s.lng as number, kind: 'added', icon: 'place' });
    return out;
  }, [start?.lat, dest?.lat, fromBase, startLabel, addedStops, trip.departAt, trip.journey?.minutes]);

  const routeLine: MapRoute[] = useMemo(
    () => (start?.lat != null && dest?.lat != null ? [{ id: 'there', points: [{ lat: start.lat, lng: start.lng as number }, { lat: dest.lat, lng: dest.lng as number }] }] : []),
    [start?.lat, dest?.lat],
  );

  const zone = useMemo(() => {
    // Drawn while the scan runs as well as after it, so the X-ray sweeps over
    // the detour zone rather than empty ground (Codex).
    if ((!scanning && !searched) || start?.lat == null) return null;
    const g = searchGround({
      origin: { lat: start.lat, lng: start.lng as number },
      destination: dest?.lat != null ? { lat: dest.lat, lng: dest.lng as number } : null,
      around: null, mode: by, maxDetourMin: detour,
    });
    return { ...g, searching: false, zone: true };
  }, [scanning, searched, start?.lat, dest?.lat, by, detour]);

  const shortMarkers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    if (dest?.lat != null) out.push({ id: 'dest', lat: dest.lat, lng: dest.lng as number, kind: 'dest', label: destShortName(trip), tag: trip.journey?.minutes ? addMin(trip.departAt, trip.journey.minutes, trip.timezone) : null });
    if (start?.lat != null) out.push({ id: 'start', lat: start.lat, lng: start.lng as number, kind: fromBase ? 'base' : 'home', icon: startIcon, label: startLabel });
    for (const c of shownShort) {
      if (c.lat == null || c.lng == null) continue;
      out.push({ id: c.ref, lat: c.lat, lng: c.lng, kind: 'pin', selected: shortSel === c.ref, onPress: () => setShortSel((s) => (s === c.ref ? null : c.ref)) });
    }
    return out;
  }, [shownShort, shortSel, dest?.lat, start?.lat, trip.departAt, trip.journey?.minutes]);

  // --- timeline ----------------------------------------------------------
  const detourByRef = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of [...(pools?.activities ?? []), ...(pools?.food ?? [])]) m.set(p.venueRef, p.detourMinutes);
    return m;
  }, [pools]);
  // A stop's booking status and its shortlist item (for the leg-mode change),
  // both keyed by venue so the timeline can show a chip and change a leg.
  const slByRef = useMemo(() => { const m = new Map<string, ShortlistItem>(); for (const s of d.shortlist) m.set(s.venueRef, s); return m; }, [d.shortlist]);
  // The leg into a stop is walk / transit / drive; tapping cycles it, saved on
  // the stop's shortlist item — the mode lives on the timeline, not the drawer.
  const cycleLeg = useCallback((venueRef: string) => {
    const s = slByRef.get(venueRef);
    if (!s) return;
    const order: LegMode[] = ['walking', 'transit', 'driving'];
    const next = order[(order.indexOf((s.legMode as LegMode) ?? 'walking') + 1) % order.length];
    updateShortlistItem(s.id, { legMode: next });
  }, [slByRef, updateShortlistItem]);
  // Bring a set-aside place back to the shortlist: its status returns to the
  // to-book default, and it is a live shortlist place (and feed candidate) again.
  const bringBack = useCallback((venueRef: string) => {
    const s = slByRef.get(venueRef);
    if (s) updateShortlistItem(s.id, { status: 'to_call' });
  }, [slByRef, updateShortlistItem]);
  const timeline = useMemo(() => buildTimeline(trip, day, dest, dayStops, destStop?.id ?? null, detourByRef, slByRef, startLabel, fromBase), [trip, day, dest, dayStops, destStop, detourByRef, slByRef, startLabel, fromBase]);
  const homeBy = timeline.homeBy;

  // --- drawer (Details / a place opened from anywhere) -------------------
  // A ?place= link can come from the feed, the shortlist, or a day stop's own
  // Ask screen — the last of which is on the bare trip route where the pools are
  // not loaded, so the day's stops are a source of last resort (Codex).
  const drawerCard = useMemo<FeedCard | null>(() => {
    if (!place) return null;
    const found = [...shortlistCards, ...(feed?.rows.flatMap((r) => r.items) ?? []), ...(feed?.thin?.items ?? [])].find((c) => c.ref === place);
    if (found) return found;
    // Resolve from either pool, not just the tab on screen, so a food link opens
    // its drawer while Activities is showing (Codex).
    const p = [...(pools?.activities ?? []), ...(pools?.food ?? [])].find((x) => x.venueRef === place);
    if (p) return poolCard(p, (pools?.food ?? []).some((x) => x.venueRef === place) ? 'food' : 'activities');
    const s = dayStops.find((x) => x.venueRef === place);
    return s ? dayStopToCard(s) : null;
  }, [place, shortlistCards, feed, pools, dayStops]);
  const drawerItem: BrowseItem | null = drawerCard ? cardToItem(drawerCard) : null;
  const drawerInTrip = drawerItem ? stopRefs.has(drawerItem.venueRef) : false;
  // Settle belongs to the place, so it lives in its drawer (owner, 29 Sep 2026):
  // the shortlist item behind the open place carries booked/full/set-aside and
  // the booking time and reference.
  const drawerSl = place ? d.shortlist.find((x) => x.venueRef === place) ?? null : null;

  // The active shortlist — everything hearted that has not been set aside. It is
  // what the badge counts and what a card's heart reflects, so the badge never
  // disagrees with the list (Codex); the full `shortlistRefs` stays for the
  // reconcile loop, which still has to know a set-aside place is a server row.
  const activeRefs = useMemo(() => { const s = new Set(shortlistRefs); for (const r of asideRefs) s.delete(r); return s; }, [shortlistRefs, asideRefs]);
  const nHearts = activeRefs.size;
  // The destination counts once: as a day stop if it was seeded, else as its own row.
  const nStops = addedStops.length + (dest ? 1 : 0);

  // ---- the trip tab, the shrinking map and the drawer (nav 6a–6c / 7b) -------
  // One screen. The selected tab is read from the address so a link lands on it;
  // nothing selected (a bare trip) is 6a. Tapping a tab moves the marker, shrinks
  // the map and raises the drawer; tapping it again returns to 6a.
  const sel: TripTab | null = section === 'ideas' ? lastTab : section === 'shortlist' ? 'shortlist' : section === 'stays' ? 'stays' : null;
  const browsing = sel != null;
  const staysHref = () => withQuery(paths.trip(id, 'stays'), carried());
  const tripContextLine = [
    dateLabel(trip.startDate ?? trip.departAt, trip.timezone),
    d.attendees.length ? `${d.attendees.length} ${d.attendees.length === 1 ? 'person' : 'people'}` : null,
    `${nStops} ${nStops === 1 ? 'stop' : 'stops'}`,
  ].filter(Boolean).join(' · ');
  const selectTab = useCallback((t: TripTab) => {
    if (t === sel) { navigate(tripHref()); return; }             // tap the selected tab again → 6a
    // The scan runs inside the map while the drawer rises (6e), but only on a real
    // pending signal — a genuinely new trip, or a route/time/mode change — and only
    // for the two tabs that use the pools. An existing trip with no pending signal
    // (a plain reopen, a new device, storage off) must NOT rescan (Codex); and Stays
    // consumes no pool, so opening it first must not fire the activities-and-food search.
    if (scanPending && !scanning && (t === 'activities' || t === 'food')) {
      setScanning(true); loadPools(true);
    }
    navigate(t === 'shortlist' ? shortHref() : t === 'stays' ? staysHref() : feedHref(t));
    // `by` is here because the hrefs carry it (carried()); without it a tab tapped
    // after a mode change serialises the stale mode and reverts the pick (Codex).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, scanPending, scanning, navigate, id, detour, dayId, by, loadPools]);

  // The drawer snaps between three heights; the map shows through the strip above
  // it (MapGL fits its pins into that strip via `coverBottom`). Dragging it to its
  // lowest point deselects the tab and returns to The day (owner, 30 Sep 2026).
  const [areaH, setAreaH] = useState(0);
  // The three detents, always inside the measured area and always leaving a strip
  // of map above the drawer. A phone in landscape can be shorter than the natural
  // sizes, so each is capped at `areaH - STRIP`; the absolutely-positioned drawer
  // must never grow past the area and cover the ink menu, nor hand MapGL a bottom
  // padding larger than its own height (Codex). Before the first layout (areaH 0)
  // they fall back to 224 so the drawer opens at its collapsed height, not zero.
  const STRIP = 96;                                          // 7b/7c: the minimum map strip
  const FULL = areaH > 0 ? Math.max(0, areaH - STRIP) : 224; // tallest the drawer goes
  const COLLAPSED = Math.min(224, FULL);                     // 6a: The day; map large
  const DEFAULT = Math.min(Math.max(COLLAPSED, areaH - 210), FULL); // 6b/6c: map ~210px
  const drawerH = useRef(new Animated.Value(COLLAPSED)).current;
  const drawerHNow = useRef(COLLAPSED);
  const snapRef = useRef({ COLLAPSED, DEFAULT, FULL, browsing });
  snapRef.current = { COLLAPSED, DEFAULT, FULL, browsing };
  // Held in a ref so the retained PanResponder / snapTo always return to The day
  // with the current detour and day in the address, not the ones from first
  // render (Codex): dragging the drawer closed must not reset those choices.
  const backToDay = useRef(() => {});
  backToDay.current = () => navigate(tripHref());
  const [coverBottom, setCoverBottom] = useState(COLLAPSED);
  // The covered height tracks the drawer through drags AND snap animations, not just
  // at the settled detent, so the map's fit and its labels keep clear of the drawer
  // as it moves rather than jumping when the gesture ends (Codex). Rounded to the
  // fit's own 24px step so it re-renders/refits at most once a step, not once a frame.
  useEffect(() => {
    const l = drawerH.addListener(({ value }) => {
      drawerHNow.current = value;
      setCoverBottom((prev) => (Math.round(prev / 24) === Math.round(value / 24) ? prev : value));
    });
    return () => drawerH.removeListener(l);
  }, [drawerH]);
  const snapTo = useCallback((h: number, mayDeselect = false) => {
    Animated.spring(drawerH, { toValue: h, useNativeDriver: false, bounciness: 1, speed: 18 }).start();
    // The listener above tracks the covered height as the spring runs; set the exact
    // final value here too so it lands precisely on the detent.
    setCoverBottom(h);
    if (mayDeselect && h <= snapRef.current.COLLAPSED + 1 && snapRef.current.browsing) backToDay.current();
  }, [drawerH]);
  // Rise when a tab opens, settle to The day when none is selected.
  useEffect(() => { if (areaH > 0) snapTo(browsing ? DEFAULT : COLLAPSED); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [browsing, areaH]);
  // The height at the start of a drag; `g.dy` is cumulative, so it is subtracted
  // from this fixed value, not from the live (already-moved) height (Codex).
  const dragStartH = useRef(COLLAPSED);
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 5 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { drawerH.stopAnimation((v) => { dragStartH.current = v; }); dragStartH.current = drawerHNow.current; },
    onPanResponderMove: (_e, g) => { const { COLLAPSED: c, FULL: f } = snapRef.current; drawerH.setValue(Math.max(c, Math.min(f, dragStartH.current - g.dy))); },
    onPanResponderRelease: () => {
      const { COLLAPSED: c, DEFAULT: d2, FULL: f } = snapRef.current;
      const h = Math.max(c, Math.min(f, drawerHNow.current));
      const nearest = [c, d2, f].reduce((a, b) => (Math.abs(b - h) < Math.abs(a - h) ? b : a), c);
      snapTo(nearest, true);
    },
  })).current;

  // Pins follow the drawer (owner, 30 Sep 2026): the map shows a small window of
  // the cards near where the drawer is scrolled — never all of them at once —
  // and the window slides as you scroll. The order is the list the drawer draws.
  const WINDOW = 5;
  const [winStart, setWinStart] = useState(0);
  useEffect(() => { setWinStart(0); }, [sel]);
  const onDrawerScroll = useCallback((y: number, vh: number, ch: number) => {
    const n = browseOrderRef.current.length;
    if (n <= WINDOW) { setWinStart(0); return; }
    const f = ch > vh ? Math.max(0, Math.min(1, y / (ch - vh))) : 0;
    setWinStart(Math.round(f * (n - WINDOW)));
  }, []);
  // A shelf scrolled sideways: start the pin window at that card, so on the horizontal
  // shelves the pins track what is on screen and not only the vertical position (Codex).
  const onCardFocus = useCallback((ref: string) => {
    const order = browseOrderRef.current;
    const i = order.findIndex((c) => c.ref === ref);
    if (i >= 0) setWinStart(Math.min(i, Math.max(0, order.length - WINDOW)));
  }, []);
  // (a ref lets the scroll handler read the order's length without being rebuilt.)
  const browseOrderRef = useRef<FeedCard[]>([]);
  const browseOrder = useMemo<FeedCard[]>(() => {
    if (sel === 'shortlist') return shownShort;
    if (sel === 'activities' || sel === 'food') {
      // A thin band (fewer than five) puts its cards in `feed.thin.items` and
      // leaves `feed.rows` empty, so read that too or those pins go missing (Codex).
      if (feed?.thin) return feed.thin.items;
      const seen = new Set<string>(); const out: FeedCard[] = [];
      for (const r of feed?.rows ?? []) for (const c of r.items) if (!seen.has(c.ref)) { seen.add(c.ref); out.push(c); }
      return out;
    }
    return [];
  }, [sel, feed, shownShort]);
  browseOrderRef.current = browseOrder;
  // When the shown order shrinks without the tab changing — a narrower shortlist
  // filter, a smaller detour, a walking mode — a high `winStart` from an earlier
  // scroll would slice past the end and show no pins at all. Clamp it back inside
  // the new length so the window still lands on visible cards (Codex).
  useEffect(() => {
    setWinStart((s) => Math.min(s, Math.max(0, browseOrder.length - WINDOW)));
  }, [browseOrder.length]);
  // Every browse pin — activities, food and shortlist alike — opens the place's
  // details drawer, and the open place is what the map highlights and focuses. In
  // the drawer the shortlist has no map callout of its own and its rows open details
  // directly, so a pin that only tinted a row would do nothing useful (Codex); one
  // action, `place`, keeps rows, pins and focus consistent across all four tabs.
  const browseSel = place;
  const browseMarkers = useMemo<MapMarker[]>(() =>
    browseOrder.slice(winStart, winStart + WINDOW)
      .filter((c) => c.lat != null && c.lng != null)
      .map((c) => ({
        id: c.ref, lat: c.lat as number, lng: c.lng as number, kind: 'pin' as const,
        selected: c.ref === browseSel,
        onPress: () => setPlace(c.ref),
      })),
    [browseOrder, winStart, browseSel]);
  // On the map: the full trip on arrival (home, destination, stops); while
  // browsing, home and destination plus the drawer's current window of pins.
  const mapMarkers = useMemo<MapMarker[]>(() => {
    if (!browsing) return tripMarkers;
    return [...tripMarkers.filter((m) => m.id === 'start' || m.id === 'dest'), ...browseMarkers];
  }, [browsing, tripMarkers, browseMarkers]);

  // =======================================================================
  return (
    <View ref={frameRef} style={styles.frame} collapsable={false}>
      {/* ---- The trip (nav 6a–6c): band · ink menu · map · drawer ---- */}
      <CompactBand
        title={trip.title ?? destShortName(trip)}
        titleLines={2}
        context={tripContextLine}
        onBack={onBack}
        right={<MicTile onPress={() => navigate(paths.say({ for: 'trip' }))} />}
      />
      <InkMenu<TripTab>
        tabs={[
          { key: 'activities', label: 'Activities' },
          { key: 'food', label: 'Food' },
          { key: 'stays', label: 'Stays' },
          { key: 'shortlist', label: 'Shortlist', count: nHearts || undefined },
        ]}
        selected={sel}
        onSelect={selectTab}
        flyToKey="shortlist"
      />
      <View style={styles.mapDrawerArea} onLayout={(e) => setAreaH(e.nativeEvent.layout.height)}>
        <View style={StyleSheet.absoluteFill}>
          <MapGL
            markers={mapMarkers}
            routes={routeLine}
            shade={browsing || scanning || searched ? zone : null}
            focusId={browsing ? browseSel : place}
            // The drawer covers the bottom, so the fit reserves that much plus a
            // margin — else the pins land behind the drawer and the strip is blank
            // (Codex). The detent is in the key so it refits when the drawer moves.
            fitKey={`trip-${sel ?? 'day'}-${Math.round(coverBottom / 24)}-${mapMarkers.map((mk) => mk.id).join(',')}`}
            padding={{ top: 24, bottom: coverBottom + 24, left: 44, right: 44 }}
            coverBottom={coverBottom}
            hideAttribution
          />
          {/* The X-ray scan plays inside the strip of map above the drawer (6e). */}
          {scanning ? (
            <View style={[styles.scanArea, { bottom: coverBottom }]} pointerEvents="none">
              <ScanBox minutes={detour} act={poolCounts.act} food={poolCounts.food} ready={pools != null || poolError} onDone={onScanDone} />
            </View>
          ) : null}
        </View>

        <Animated.View style={[styles.drawer, { height: drawerH }]}>
          <View style={styles.handleWrap} {...pan.panHandlers}>
            <View style={styles.grab} />
            {/* Drag the drawer down to its lowest point to return to The day; the
                handle names it so people know it is there (owner, 30 Sep 2026). */}
            {browsing ? (
              <Press onPress={() => navigate(tripHref())} style={styles.handleHint} accessibilityRole="button" accessibilityLabel="Back to The day">
                <Icon name="collapse" size={12} color={MUTED} /><Text style={styles.handleHintText}>The day</Text>
              </Press>
            ) : null}
          </View>

          {sel == null ? (
            <ScrollView contentContainerStyle={styles.dayInner} showsVerticalScrollIndicator={false}>

            {days.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
                {days.map((dd, i) => {
                  const on = dd.id === day?.id;
                  const n = dd.slots.reduce((a, sl) => a + sl.stops.length, 0);
                  return (
                    <Press key={dd.id} onPress={() => setDayId(dd.id)} style={[styles.dayChip, on && styles.dayChipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[styles.dayChipDay, on && { color: INK }]}>DAY {i + 1}</Text>
                      <Text style={styles.dayChipDate}>{dateLabel(dd.date)}</Text>
                      <Text style={styles.dayChipN}>{n ? `${n} stop${n === 1 ? '' : 's'}` : 'nothing yet'}</Text>
                    </Press>
                  );
                })}
              </ScrollView>
            ) : null}
            {stayBase ? (
              // Where the household is staying, above the day itself (owner). Tapping
              // it opens the Stays tab, where a booking is changed or one is found.
              <View style={styles.staySection}>
                <Text style={styles.stayHead}>Where you're staying</Text>
                <Press onPress={() => navigate(staysHref())} style={styles.stayRow} accessibilityRole="button" accessibilityLabel="Where you're staying">
                  <Icon name="hotel" size={18} color={INK} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.stayName} numberOfLines={1}>{stayBase.label?.split(',')[0]?.trim() || 'Your stay'}</Text>
                    {/* check-in/out are times of day the editor stored (e.g. "15:00"),
                        not dates, so they are shown as-is — dateLabel would blank them (Codex). */}
                    {stayBase.checkIn ? <Text style={styles.stayMeta} numberOfLines={1}>Check in {stayBase.checkIn}{stayBase.checkOut ? ` · out ${stayBase.checkOut}` : ''}</Text> : null}
                  </View>
                  <Icon name="forward" size={16} color={MUTED} />
                </Press>
              </View>
            ) : null}
            <View style={styles.dayKickerRow}>
              <Text style={styles.dayKicker}>{days.length > 1 && day ? dateLabel(day.date) : 'The day'} · {nStops} {nStops === 1 ? 'stop' : 'stops'}</Text>
              {/* The trip's secondary actions — who's coming, getting there, share,
                  delete — live behind this one control (owner: a ⋯ menu home). The
                  mic in the band is voice; this is the menu, each doing what it says. */}
              {onMenu ? (
                <Press onPress={onMenu} style={styles.dayMore} accessibilityRole="button" accessibilityLabel="More trip actions">
                  <Icon name="menu" size={18} color={MUTED} />
                </Press>
              ) : null}
            </View>
            <View style={styles.timeline}>
              <View style={styles.spine} />
              {timeline.rows.map((r) => (
                r.kind === 'leg' ? (
                  // The leg between two stops: its travel mode, tappable to cycle
                  // (walk → transit → drive), saved on the stop it leads to.
                  <View key={r.key} style={styles.legRow}>
                    <Press
                      onPress={r.legRef ? () => cycleLeg(r.legRef!) : undefined}
                      disabled={!r.legRef}
                      effect={r.legRef ? 'sink' : 'none'}
                      style={styles.legChip}
                      accessibilityRole="button"
                      accessibilityLabel={r.legRef ? `Change how you travel this leg — now ${LEG_WORD[r.legMode ?? 'driving']}` : undefined}
                    >
                      <Icon name={LEG_ICON[r.legMode ?? 'driving']} size={13} color={MUTED} />
                      <Text style={styles.legText}>{LEG_WORD[r.legMode ?? 'driving']} {r.legMinutes} min</Text>
                    </Press>
                  </View>
                ) : (
                <View key={r.key} style={styles.beat}>
                  <Text style={styles.beatTime}>{r.time}</Text>
                  <View style={[styles.node, { backgroundColor: r.nodeFill, borderColor: r.nodeBorder, borderStyle: r.dashed ? 'dashed' : 'solid' }]}>
                    <Icon name={r.icon} size={15} color={INK} />
                  </View>
                  <Press onPress={r.onPress} disabled={!r.onPress} effect={r.onPress ? 'sink' : 'none'} style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={styles.beatTitleRow}>
                      <Text style={styles.beatTitle} numberOfLines={1}>{r.title}</Text>
                      <StatusChip status={r.status} />
                    </View>
                    {r.sub ? <Text style={styles.beatSub} numberOfLines={2}>{r.sub}</Text> : null}
                  </Press>
                  {r.stopId ? (
                    <View style={styles.moveCol}>
                      <Press onPress={() => moveStop(r.stopId!, -1)} style={styles.moveBtn} disabled={r.first} accessibilityLabel="Move up"><Icon name="collapse" size={16} color={INK} /></Press>
                      <Press onPress={() => moveStop(r.stopId!, 1)} style={styles.moveBtn} disabled={r.last} accessibilityLabel="Move down"><Icon name="expand" size={16} color={INK} /></Press>
                    </View>
                  ) : null}
                </View>
                )
              ))}
            </View>
            </ScrollView>
          ) : sel === 'shortlist' ? (
            <ShortlistView
              drawer onScroll={onDrawerScroll}
              cards={shownShort} allCards={shortlistCards.filter((c) => c.status !== 'set_aside')} aside={asideCards} show={show} sel={place} markers={shortMarkers} zone={zone}
              trip={trip} nStops={nStops} homeBy={homeBy} homeWord={fromBase ? 'back' : 'home'}
              onBack={() => navigate(tripHref())}
              onShow={(v) => setShow(v === 'all' ? null : v)}
              onSelect={(ref) => setShortSel((s) => (s === ref ? null : ref))}
              onDetails={(ref) => setPlace(ref)}
              onAdd={addToTrip}
              onBringBack={bringBack}
              inTrip={(ref) => stopRefs.has(ref)}
              onViewTrip={() => navigate(tripHref())}
            />
          ) : sel === 'stays' ? (
            <ScrollView
              contentContainerStyle={styles.staysInner}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={(e) => onDrawerScroll(e.nativeEvent.contentOffset.y, e.nativeEvent.layoutMeasurement.height, e.nativeEvent.contentSize.height)}
            >
              <StayPanel
                d={d}
                household={household}
                onChanged={onChanged}
                onFindNear={() => navigate(feedHref('activities'))}
                openSearch={!(trip.base && trip.base.kind !== 'centre')}
              />
            </ScrollView>
          ) : feed ? (
            <FeedView
              drawer onScroll={onDrawerScroll} onCardFocus={onCardFocus}
              feed={feed} trip={trip} tab={sel as IdeasTab} detour={detour} minsOpen={minsOpen} filtersOpen={filtersOpen} pools={livePools}
              by={by} onBy={(m) => { setBy(m); setFiltersOpen(false); }}
              nHearts={nHearts} shortlistBtnRef={shortlistBtnRef}
              heartOf={(ref) => activeRefs.has(ref)}
              onBackToTrip={() => navigate(tripHref())}
              onShortlist={() => navigate(shortHref())}
              onTab={(t) => navigate(feedHref(t))}
              onDetour={(m) => { setDetour(m); setMinsOpen(false); }}
              onToggleMins={() => { setMinsOpen((v) => !v); setFiltersOpen(false); }}
              onToggleFilters={() => { setFiltersOpen((v) => !v); setMinsOpen(false); }}
              onHeart={toggleHeart}
              onOpen={(ref) => setPlace(ref)}
            />
          ) : (
            <View style={styles.loading}>
              {poolError ? (
                <>
                  <Text style={styles.metaText}>We couldn't find places just now.</Text>
                  <Press onPress={() => loadPools(true)} style={styles.retryBtn} accessibilityRole="button"><Icon name="refresh" size={16} color={CREAM} /><Text style={styles.retryText}>Try again</Text></Press>
                </>
              ) : (
                <Text style={styles.metaText}>Finding places near your trip…</Text>
              )}
            </View>
          )}
          {/* The map credit, off the map face (owner) but reachable on every tab and
              linking to the licence, as the interactive control it replaces did — a
              faint corner link over the drawer's bottom padding (Codex). */}
          <Press onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')} style={styles.mapCredit} accessibilityRole="link" accessibilityLabel="Map data © OpenStreetMap contributors">
            <Text style={styles.mapCreditText}>© OpenStreetMap</Text>
          </Press>
        </Animated.View>
      </View>

      {/* ---- Details / place drawer ---- */}
      {drawerItem ? (
        <VenueDrawer
          item={drawerItem}
          country={trip.countryCode ?? trip.destination?.countryCode ?? null}
          baseLabel={destShortName(trip)}
          onClose={() => setPlace(null)}
          onAdd={drawerCard ? () => { addToTrip(drawerCard); } : undefined}
          addLabel={drawerInTrip ? 'In your trip' : 'Add to trip'}
          addIcon={drawerInTrip ? 'check' : 'add'}
          added={drawerInTrip}
          shortlisted={drawerItem ? activeRefs.has(drawerItem.venueRef) : false}
          onShortlist={drawerCard ? async () => {
            // Hearting a set-aside place brings it back to the shortlist rather
            // than deleting its row (which is what removing an active place does)
            // — the heart follows the active state the badge and list show (Codex).
            if (drawerSl?.status === 'set_aside') bringBack(drawerCard.ref); else toggleHeart(drawerCard);
          } : undefined}
          ours={drawerSl ? <SettleControls item={drawerSl} onUpdate={(patch) => updateShortlistItem(drawerSl.id, patch)} /> : undefined}
        />
      ) : null}
    </View>
  );
}

/**
 * A licensed photo's required credit (Google, Data Thistle, …), drawn small in
 * the corner of the image as the other photo surfaces do (VenueThumb,
 * VenueDrawer). Nothing is drawn for an owned photo or none.
 */
function PhotoCredit({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.credit} pointerEvents="none">
      <Text style={styles.creditText} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** The scan, sized to its own box so it can measure the map area it draws over. */
function ScanBox({ minutes, act, food, ready, onDone }: { minutes: number; act: number; food: number; ready: boolean; onDone: () => void }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} pointerEvents="none">
      {size ? <ScanOverlay width={size.w} height={size.h} minutes={minutes} act={act} food={food} ready={ready} onDone={onDone} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------
function FeedView({ feed, trip, tab, detour, by, onBy, minsOpen, filtersOpen, pools, nHearts, shortlistBtnRef, drawer, onScroll, onCardFocus, heartOf, onBackToTrip, onShortlist, onTab, onDetour, onToggleMins, onToggleFilters, onHeart, onOpen }: {
  feed: NonNullable<ReturnType<typeof buildFeed>>;
  trip: TripDetail['trip']; tab: IdeasTab; detour: number; by: TripMode; onBy: (m: TripMode) => void; minsOpen: boolean; filtersOpen: boolean; pools: { activities: TripAlongPlace[]; food: TripAlongPlace[] } | null;
  nHearts: number; shortlistBtnRef: React.RefObject<any>;
  /** In the trip drawer (nav 6b): the band, the toggle and the Back/Shortlist row
   *  are gone — the trip's own band and ink menu do those jobs — so only the
   *  context row and the shelves are drawn. */
  drawer?: boolean;
  onScroll?: (y: number, viewportH: number, contentH: number) => void;
  /** A shelf scrolled horizontally: the ref of its first fully-visible card, so the
   *  map's pin window follows the cards actually on screen, not just the vertical
   *  scroll position (Codex). */
  onCardFocus?: (ref: string) => void;
  heartOf: (ref: string) => boolean;
  onBackToTrip: () => void; onShortlist: () => void; onTab: (t: IdeasTab) => void; onDetour: (m: number) => void; onToggleMins: () => void; onToggleFilters: () => void;
  onHeart: (card: FeedCard, chip?: Element | null) => void; onOpen: (ref: string) => void;
}) {
  const noun = (k: IdeasTab) => (k === 'food' ? 'places to eat' : 'things to do');
  // The trip's own mode is the default; anything else is an active filter to surface.
  const seedMode: TripMode = (MODE_VALUES as readonly string[]).includes(trip.travelMode) ? (trip.travelMode as TripMode) : 'driving';
  const modeActive = by !== seedMode;
  return (
    <>
      {drawer ? null : (
      <View style={styles.feedHead}>
        <Press onPress={onBackToTrip} style={styles.backBtn} accessibilityRole="button"><Icon name="back" size={18} color={CREAM} /><Text style={styles.backBtnText}>Back to my trip</Text></Press>
        <Press ref={shortlistBtnRef} onPress={onShortlist} style={styles.shortBtn} accessibilityRole="button">
          <View {...({ dataSet: { flyTo: '1' } } as object)} style={{ width: 24, height: 24 }}>
            <Svg width={24} height={24} viewBox="0 0 24 24"><Path d={HEART_PATH} fill={nHearts ? LIME : 'none'} stroke={nHearts ? LIME_EDGE : INK} strokeWidth={nHearts ? 0.9 : 2} strokeLinejoin="round" /></Svg>
          </View>
          <Text style={styles.shortBtnLabel}>Shortlist</Text>
          <View style={styles.shortCount}><Text style={styles.shortCountText}>{nHearts}</Text></View>
        </Press>
      </View>
      )}
      {drawer ? null : <Text style={styles.feedKicker}>{(trip.title ?? destShortName(trip))} · {dateLabel(trip.startDate ?? trip.departAt, trip.timezone)}</Text>}

      {drawer ? null : (
      <View style={styles.tabs}>
        {(['activities', 'food'] as IdeasTab[]).map((t) => (
          <Press key={t} onPress={() => onTab(t)} style={[styles.tab, { backgroundColor: tab === t ? LIME : INACTIVE }]} accessibilityRole="button" accessibilityState={{ selected: tab === t }}>
            <Text style={[styles.tabText, { color: tab === t ? INK : MUTED }]}>{t === 'food' ? 'Food & drink' : 'Activities'}</Text>
          </Press>
        ))}
      </View>
      )}

      {/* The context row (nav §6): "Up to N min detour ▾" on the left, "Filters" on
          the right. Travel mode is NOT a row of its own — the owner's design keeps
          the three ways of getting about inside Filters, so they live in that
          dropdown, not on the drawer. */}
      <View style={styles.filterLine}>
        <Press onPress={onToggleMins} style={styles.ctxLeft} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} accessibilityRole="button" accessibilityState={{ expanded: minsOpen }}>
          <Icon name="duration" size={17} color={INK} />
          <Text style={styles.ctxLeftText}>Up to {detour} min detour</Text>
          <Icon name={minsOpen ? 'collapse' : 'expand'} size={14} color={INK} />
        </Press>
        {/* "Filters" names the active travel mode once it is off the trip's default, so
            a feed filtered by walking or transit is never silently different (CLAUDE.md:
            a non-default filter must say so). Default mode → plain grey "Filters". */}
        <Press onPress={onToggleFilters} style={styles.ctxFilters} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }} accessibilityRole="button" accessibilityState={{ expanded: filtersOpen }} accessibilityLabel={modeActive ? `Filters — ${MODE_LABEL[by]}` : 'Filters'}>
          <Icon name="filters" size={16} color={modeActive ? INK : MUTED} />
          <Text style={[styles.ctxFiltersText, modeActive && styles.ctxFiltersActive]}>{modeActive ? MODE_LABEL[by] : 'Filters'}</Text>
        </Press>
        {minsOpen ? (
          <View style={styles.minsMenu}>
            <Text style={styles.minsHead}>Added to your journey</Text>
            {DETOUR_BANDS.map((m) => {
              const c = bandCount(tab === 'food' ? pools?.food ?? [] : pools?.activities ?? [], m);
              return (
                <Press key={m} onPress={() => onDetour(m)} style={[styles.minsRow, m === detour && { backgroundColor: LIME_TINT }]} accessibilityRole="button">
                  <Text style={[styles.minsLabel, { fontWeight: m === detour ? '600' : '400' }]}>{m} minutes</Text>
                  <Text style={styles.minsCount}>{c} {noun(tab)}</Text>
                </Press>
              );
            })}
          </View>
        ) : null}
        {filtersOpen ? (
          <View style={styles.filtersMenu}>
            <Text style={styles.minsHead}>How you're getting about</Text>
            {TRIP_MODES.map((m) => (
              <Press key={m} onPress={() => onBy(m)} style={[styles.minsRow, by === m && { backgroundColor: LIME_TINT }]} accessibilityRole="button" accessibilityState={{ selected: by === m }}>
                <View style={styles.filterModeLabel}>
                  <Icon name={modeIcon(m)} size={16} color={INK} />
                  <Text style={[styles.minsLabel, { fontWeight: by === m ? '600' : '400' }]}>{MODE_LABEL[m]}</Text>
                </View>
                {by === m ? <Icon name="check" size={16} color={INK} /> : null}
              </Press>
            ))}
          </View>
        ) : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll ? (e) => onScroll(e.nativeEvent.contentOffset.y, e.nativeEvent.layoutMeasurement.height, e.nativeEvent.contentSize.height) : undefined}
      >
        {feed.thin ? (
          <View style={styles.thinWrap}>
            <Text style={styles.thinTitle}>Only {feed.thin.count} {noun(tab)} within {detour} minutes of your trip</Text>
            {feed.thin.items.map((c) => <ThinCard key={c.ref} card={c} on={heartOf(c.ref)} onHeart={onHeart} onOpen={onOpen} />)}
            {detour < 30 ? (
              <View style={styles.widenWrap}>
                <Text style={styles.widenSub}>{feed.thin.widerCount} {noun(tab)} within 30 minutes</Text>
                <Press onPress={() => onDetour(30)} style={styles.widenBtn} accessibilityRole="button"><Text style={styles.widenBtnText}>Widen to 30 minutes</Text><Icon name="forward" size={18} color={CREAM} /></Press>
              </View>
            ) : null}
          </View>
        ) : (
          feed.rows.map((row) => (
            <View key={row.key} style={styles.row}>
              <View style={styles.rowHead}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                {row.sub ? <Text style={styles.metaText}>{row.sub}</Text> : null}
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rowScroll}
                scrollEventThrottle={16}
                onScroll={onCardFocus ? (e) => {
                  // Card step is the 280px card plus the 12px shelf gap; the first
                  // card in view is the one the pin window should start from.
                  const i = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 12));
                  const c = row.items[Math.max(0, Math.min(row.items.length - 1, i))];
                  if (c) onCardFocus(c.ref);
                } : undefined}
              >
                {row.items.map((c) => <FeedCardView key={c.ref} card={c} on={heartOf(c.ref)} onHeart={onHeart} onOpen={onOpen} />)}
              </ScrollView>
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}

// Every card is the large top-row size now (owner, 30 Sep 2026: "all the images
// the same size as the top row"). The 160-wide small card is gone; each row is
// the same 280×187 picture, whichever shelf it is — and that size is the shared
// CARD_W/CARD_H from VenueThumb, so Inspire, Places and the trip list match it
// (owner, 1 Oct 2026: "everywhere I go, I want them to be this size").
function FeedCardView({ card, on, onHeart, onOpen }: { card: FeedCard; on: boolean; onHeart: (c: FeedCard, chip?: Element | null) => void; onOpen: (ref: string) => void }) {
  return (
    <View style={{ width: CARD_W, gap: 8 }}>
      <VenueThumb name={card.name} photos={card.photos} category={card.category} experiences={card.experiences} width={CARD_W} height={CARD_H} rounded={MEDIA_RADIUS} credit={false} onPress={() => onOpen(card.ref)}>
        <Pressable onPress={(e: any) => { e?.stopPropagation?.(); onHeart(card, e?.currentTarget); }} style={styles.heartChipWrap} accessibilityRole="button" accessibilityLabel={on ? 'Remove from shortlist' : 'Add to shortlist'}>
          <CardHeart on={on} />
        </Pressable>
        {card.price ? <View style={styles.priceTag}><Text style={styles.priceTagText}>{card.price}</Text></View> : null}
        <PhotoCredit text={card.photos[0]?.attribution ?? null} />
      </VenueThumb>
      <View style={{ gap: 3 }}>
        <Text style={styles.cardName} numberOfLines={2}>{card.name}</Text>
        {/* The detour on the left, what it is and its rating on the right, one
            line now the card is wider (owner, 1 Oct 2026). */}
        <View style={styles.cardLine}>
          <Text style={styles.cardFit} numberOfLines={1}>{card.fit}</Text>
          <Text style={[styles.metaText, styles.cardLineR]} numberOfLines={1}>{card.typeR}</Text>
        </View>
      </View>
    </View>
  );
}

function ThinCard({ card, on, onHeart, onOpen }: { card: FeedCard; on: boolean; onHeart: (c: FeedCard, chip?: Element | null) => void; onOpen: (ref: string) => void }) {
  return (
    <View style={{ width: CARD_W, gap: 8 }}>
      {/* The thin-results list uses the same picture as every shelf, so "all
          images the same size" holds in the low-result state too (owner, 30 Sep
          2026; Codex). */}
      <VenueThumb name={card.name} photos={card.photos} category={card.category} experiences={card.experiences} width={CARD_W} height={CARD_H} rounded={MEDIA_RADIUS} credit={false} onPress={() => onOpen(card.ref)}>
        <Pressable onPress={(e: any) => { e?.stopPropagation?.(); onHeart(card, e?.currentTarget); }} style={styles.heartChipWrap} accessibilityRole="button"><CardHeart on={on} /></Pressable>
        {card.price ? <View style={styles.priceTag}><Text style={styles.priceTagText}>{card.price}</Text></View> : null}
        <PhotoCredit text={card.photos[0]?.attribution ?? null} />
      </VenueThumb>
      <View style={{ gap: 3 }}>
        <Text style={[styles.cardName, { fontSize: 16 }]}>{card.name}</Text>
        <View style={styles.cardLine}>
          <Text style={styles.cardFit} numberOfLines={1}>{card.fit}</Text>
          <Text style={[styles.metaText, styles.cardLineR]} numberOfLines={1}>{card.typeR}</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The shortlist
// ---------------------------------------------------------------------------
const SHORT_FILTER_LABEL: Record<ShortTab, string> = { all: 'Everything', activities: 'Activities', food: 'Places to eat' };

function ShortlistView({ cards, allCards, aside, show, sel, markers, zone, trip, nStops, homeBy, homeWord, drawer, onScroll, onBack, onShow, onSelect, onDetails, onAdd, onBringBack, inTrip, onViewTrip }: {
  cards: FeedCard[]; allCards: FeedCard[]; aside: FeedCard[]; show: ShortTab; sel: string | null; markers: MapMarker[]; zone: any;
  trip: TripDetail['trip']; nStops: number; homeBy: string; homeWord: string;
  /** In the trip drawer (nav 6c): the shortlist's own map and its "View my trip"
   *  bar are gone — the trip map above shows the pins and the ink menu does the
   *  navigation — so only the header and the list are drawn. */
  drawer?: boolean;
  onScroll?: (y: number, viewportH: number, contentH: number) => void;
  onBack: () => void; onShow: (v: ShortTab) => void; onSelect: (ref: string) => void; onDetails: (ref: string) => void; onAdd: (c: FeedCard) => void; onBringBack: (ref: string) => void; inTrip: (ref: string) => boolean; onViewTrip: () => void;
}) {
  const [asideOpen, setAsideOpen] = useState(false);
  // The map grows when you are working it and shrinks when you go back to the
  // list (owner, 30 Sep 2026: "when I click on a pin the card covers the other
  // pins and I scroll in a very small area"). Big is at least half the frame, so
  // the callout has room above it; the list gets the space back on a scroll.
  const { height: frameH } = useViewport();
  const MAP_SMALL = 260;
  // At least half the frame, but always leaving room for the handle, the title,
  // the tabs and some list — so a short viewport (a phone in landscape) can never
  // push the shortlist off the bottom (Codex). On a tiny frame it does not grow.
  const MAP_BIG = Math.max(MAP_SMALL, Math.min(Math.round(frameH * 0.58), frameH - 240));
  const [mapBig, setMapBig] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const mapH = useRef(new Animated.Value(MAP_SMALL)).current;
  useEffect(() => {
    Animated.timing(mapH, { toValue: mapBig ? MAP_BIG : MAP_SMALL, duration: 260, useNativeDriver: false }).start();
  }, [mapBig, MAP_BIG, mapH]);
  // Selecting a pin is working the map: give it room rather than dropping a card
  // over the pins you were choosing between.
  useEffect(() => { if (sel) setMapBig(true); }, [sel]);
  const selCard = sel ? cards.find((c) => c.ref === sel) ?? null : null;
  const tabs: { key: ShortTab; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: allCards.length },
    { key: 'activities', label: 'Activities', n: allCards.filter((c) => c.kind === 'activities').length },
    { key: 'food', label: 'Places to eat', n: allCards.filter((c) => c.kind === 'food').length },
  ];
  return (
    <>
      {drawer ? null : (
      <Animated.View style={[styles.shortMap, { height: mapH }]}>
        <MapGL markers={markers} routes={[]} shade={zone} focusId={sel} fitKey={`short-${markers.map((mk) => mk.id).join(',')}`} padding={{ top: 60, bottom: selCard ? 96 : 40, left: 30, right: 30 }} />
        <Press onPress={onBack} style={styles.floatBack} accessibilityRole="button" accessibilityLabel="Back to ideas"><Icon name="back" size={20} color={INK} /></Press>
        {selCard ? (
          <Press onPress={() => onDetails(selCard.ref)} style={styles.callout} accessibilityRole="button">
            <VenueThumb name={selCard.name} photos={selCard.photos} category={selCard.category} experiences={selCard.experiences} width={72} height={48} rounded={MEDIA_RADIUS} credit={false}>
              <PhotoCredit text={selCard.photos[0]?.attribution ?? null} />
            </VenueThumb>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={styles.calloutName} numberOfLines={1}>{selCard.name}</Text>
              <Text style={styles.cardFit} numberOfLines={1}>{selCard.fit}</Text>
            </View>
            <View style={styles.calloutDetails}><Text style={styles.calloutDetailsText}>Details</Text><Icon name="more" size={16} color={INK} /></View>
          </Press>
        ) : null}
      </Animated.View>
      )}

      {drawer ? null : (
      <Press onPress={() => setMapBig((v) => !v)} style={styles.mapGrab} accessibilityRole="button" accessibilityLabel={mapBig ? 'Shrink the map, more list' : 'Expand the map'}>
        <View style={styles.mapGrabBar} />
      </Press>
      )}

      {drawer ? null : (
      <View style={styles.shortTitleRow}>
        <Text style={styles.shortTitle}>Shortlist</Text>
        <Text style={styles.metaText}>{allCards.length} {allCards.length === 1 ? 'place' : 'places'} · {trip.title ?? destShortName(trip)}</Text>
      </View>
      )}

      {drawer ? (
        // 6c: the old three pills are one dropdown, and the count the selected tab
        // used to carry lives in the header instead ("N saved") — nav §5.
        <>
        <View style={styles.shortDrawerHead}>
          <Text style={styles.shortSaved}>{allCards.length} saved</Text>
          <Press onPress={() => setFilterOpen((o) => !o)} style={styles.shortFilter} accessibilityRole="button" accessibilityState={{ expanded: filterOpen }} accessibilityLabel="Filter the shortlist">
            <Text style={styles.shortFilterLabel}>{SHORT_FILTER_LABEL[show]}</Text>
            <Icon name={filterOpen ? 'collapse' : 'expand'} size={12} color={INK} />
          </Press>
        </View>
        {/* The choices open in normal flow, pushing the list down — an absolute menu
            would be clipped by the drawer's overflow:hidden on a short viewport (Codex). */}
        {filterOpen ? (
          <View style={styles.shortFilterMenu}>
            {tabs.map((t) => (
              <Press key={t.key} onPress={() => { onShow(t.key); setFilterOpen(false); }} style={[styles.shortFilterRow, show === t.key && { backgroundColor: LIME_TINT }]} accessibilityRole="button" accessibilityState={{ selected: show === t.key }}>
                <Text style={styles.shortFilterRowLabel}>{t.label}</Text>
                <Text style={styles.shortFilterRowN}>{t.n}</Text>
              </Press>
            ))}
          </View>
        ) : null}
        </>
      ) : (
        <View style={styles.shortTabs}>
          {tabs.map((t) => (
            <Press key={t.key} onPress={() => onShow(t.key)} style={[styles.shortTab, { backgroundColor: show === t.key ? LIME : INACTIVE }]} accessibilityRole="button" accessibilityState={{ selected: show === t.key }}>
              <Text style={[styles.shortTabLabel, { color: show === t.key ? INK : MUTED }]}>{t.label}</Text>
              <Text style={[styles.shortTabN, { color: show === t.key ? INK : MUTED }]}>{t.n}</Text>
            </Press>
          ))}
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: drawer ? 24 : 96 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => setMapBig(false)}
        onScroll={onScroll ? (e) => onScroll(e.nativeEvent.contentOffset.y, e.nativeEvent.layoutMeasurement.height, e.nativeEvent.contentSize.height) : undefined}
      >
        {!cards.length ? (
          <View style={styles.shortEmpty}>
            <Text style={styles.emptyTitle}>{!allCards.length ? 'Nothing on your shortlist yet' : show === 'food' ? 'No places to eat on your shortlist yet' : 'No activities on your shortlist yet'}</Text>
            <Text style={styles.metaText}>Tap the heart on anything in Activities or Food &amp; drink.</Text>
          </View>
        ) : null}
        {cards.map((c) => {
          const added = inTrip(c.ref);
          const on = sel === c.ref;
          // A place the household set aside or found full is not offered back to
          // the day: adding it would reverse that decision (Codex).
          const rejected = c.status === 'full' || c.status === 'set_aside';
          return (
            // In the drawer the shortlist has no map callout, so the row itself is
            // the way into the place — its details, booking and status. Elsewhere a
            // tap highlights the row and its pin, and the callout opens details (Codex).
            <Pressable key={c.ref} onPress={() => (drawer ? onDetails(c.ref) : onSelect(c.ref))} style={[styles.shortRow, on && { backgroundColor: LIME_TINT }]}>
              <VenueThumb name={c.name} photos={c.photos} category={c.category} experiences={c.experiences} width={96} height={64} rounded={MEDIA_RADIUS} credit={false}>
                <PhotoCredit text={c.photos[0]?.attribution ?? null} />
              </VenueThumb>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.shortRowName, { flexShrink: 1 }]} numberOfLines={1}>{c.name}</Text>
                  <StatusChip status={c.status} />
                </View>
                <Text style={styles.cardFit} numberOfLines={1}>{c.fit}</Text>
                <Text style={styles.shortRowMeta} numberOfLines={1}>{c.typeR}</Text>
              </View>
              {rejected ? (
                <View style={[styles.addBtn, { borderColor: GREY }]}><Text style={[styles.addBtnText, { color: MUTED }]}>{c.status === 'full' ? 'Full' : 'Set aside'}</Text></View>
              ) : (
                <Pressable onPress={() => onAdd(c)} disabled={added} style={[styles.addBtn, added && { backgroundColor: LIME_TINT, borderColor: LIME_TINT }]} accessibilityRole="button" accessibilityLabel={added ? 'In trip' : 'Add to trip'}>
                  <Icon name={added ? 'check' : 'add'} size={14} color={INK} />
                  <Text style={styles.addBtnText}>{added ? 'In trip' : 'Add to trip'}</Text>
                </Pressable>
              )}
            </Pressable>
          );
        })}

        {/* Set aside: off the shortlist and out of this trip's feed, but not lost
            — a quiet foot row that brings any of them back (owner, 30 Sep 2026).
            Hidden when nothing is set aside. */}
        {aside.length ? (
          <View style={styles.asideWrap}>
            <Pressable onPress={() => setAsideOpen((v) => !v)} style={styles.asideHead} accessibilityRole="button" accessibilityState={{ expanded: asideOpen }}>
              <Text style={styles.asideHeadText}>{aside.length} set aside</Text>
              <Icon name={asideOpen ? 'collapse' : 'expand'} size={14} color={MUTED} />
            </Pressable>
            {asideOpen ? aside.map((c) => (
              <View key={c.ref} style={styles.asideRow}>
                <VenueThumb name={c.name} photos={c.photos} category={c.category} experiences={c.experiences} width={48} height={32} rounded={MEDIA_RADIUS} credit={false}>
                  <PhotoCredit text={c.photos[0]?.attribution ?? null} />
                </VenueThumb>
                <Text style={styles.asideName} numberOfLines={1}>{c.name}</Text>
                <Pressable onPress={() => onBringBack(c.ref)} style={styles.asideBtn} accessibilityRole="button" accessibilityLabel={`Bring ${c.name} back to the shortlist`}>
                  <Icon name="add" size={13} color={INK} />
                  <Text style={styles.asideBtnText}>Bring back</Text>
                </Pressable>
              </View>
            )) : null}
          </View>
        ) : null}
      </ScrollView>

      {drawer ? null : (
      <Press onPress={onViewTrip} style={styles.viewTripBar} accessibilityRole="button">
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.ideasTitle}>View my trip</Text>
          <Text style={styles.ideasSub} numberOfLines={1}>{trip.title ?? destShortName(trip)} · {nStops} {nStops === 1 ? 'stop' : 'stops'}{homeBy ? ` · ${homeWord} by ${homeBy}` : ''}</Text>
        </View>
        <Icon name="forward" size={18} color={CREAM} />
      </Press>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ') : s);
const modeIcon = (m: TripDetail['trip']['travelMode']): IconName => (m === 'walking' ? 'walking' : m === 'transit' ? 'transit' : m === 'cycling' ? 'cycle' : 'driving');

function dateLabel(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return '';
  // A date-only value (a day's date) is anchored at midday to sidestep any zone
  // rollover; a full timestamp (an outing's departure) is read in the trip's own
  // timezone so it never shows the day before or after (Codex).
  const dateOnly = iso.length <= 10;
  const d = new Date(dateOnly ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: dateOnly ? undefined : (tz ?? undefined) });
}

function whoLine(attendees: TripDetail['attendees'], household: HouseholdResponse | null): string {
  if (!attendees.length) return '';
  if (household && attendees.length >= household.members.length) return 'The whole family';
  if (attendees.length > 3) return `${attendees.length} of you`;
  return attendees.map((a) => a.name.split(' ')[0]).join(', ');
}

/**
 * Settle a shortlisted place, in its own drawer (owner, 29 Sep 2026): booked /
 * full / set aside, and the booking time and reference when it is booked. "Full"
 * keeps it on the shortlist, marked, so it is not tried again; "Set aside" takes
 * it off quietly and any other status here brings it back. The status also shows
 * as a chip on the shortlist card and the trip timeline.
 */
const SETTLE_OPTIONS: { k: ShortlistStatus; label: string }[] = [
  { k: 'to_call', label: 'To book' },
  { k: 'booked', label: 'Booked' },
  { k: 'full', label: 'Full' },
  { k: 'set_aside', label: 'Set aside' },
];
function SettleControls({ item, onUpdate }: { item: ShortlistItem; onUpdate: (patch: Parameters<typeof api.updateShortlist>[2]) => void }) {
  const [time, setTime] = useState(item.bookedTime ?? '');
  const [ref, setRef] = useState(item.bookingRef ?? '');
  useEffect(() => { setTime(item.bookedTime ?? ''); setRef(item.bookingRef ?? ''); }, [item.id, item.bookedTime, item.bookingRef]);
  return (
    <View style={settle.wrap}>
      <Text style={settle.head}>Booking</Text>
      <View style={settle.chips}>
        {SETTLE_OPTIONS.map((o) => {
          const on = item.status === o.k;
          return (
            <Press key={o.k} onPress={() => onUpdate({ status: o.k })} style={[settle.chip, on && settle.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[settle.chipText, on && { color: INK }]}>{o.label}</Text>
            </Press>
          );
        })}
      </View>
      {item.status === 'set_aside' ? <Text style={settle.note}>Set aside — off your shortlist. Pick a status above to bring it back.</Text> : null}
      {item.status === 'booked' ? (
        <View style={settle.fields}>
          <TextInput value={time} onChangeText={setTime} onBlur={() => onUpdate({ bookedTime: time.trim() || null })} placeholder="Time (e.g. 13:00)" placeholderTextColor={INK_MUTED} style={settle.input} />
          <TextInput value={ref} onChangeText={setRef} onBlur={() => onUpdate({ bookingRef: ref.trim() || null })} placeholder="Booking reference" placeholderTextColor={INK_MUTED} style={settle.input} />
        </View>
      ) : null}
    </View>
  );
}

/** A booking-status chip for a card or a timeline stop; nothing for the everyday states. */
function StatusChip({ status }: { status: string | null | undefined }) {
  if (status !== 'booked' && status !== 'full' && status !== 'set_aside') return null;
  const label = status === 'booked' ? 'Booked' : status === 'full' ? 'Full' : 'Set aside';
  return <View style={[settle.statusChip, status === 'booked' && { backgroundColor: LIME_TINT, borderColor: LIME_TINT }]}><Text style={settle.statusChipText}>{label}</Text></View>;
}

const settle = StyleSheet.create({
  wrap: { gap: 10, paddingVertical: 4 },
  head: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase', color: INK_MUTED },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: HAIRLINE, backgroundColor: CREAM },
  chipOn: { borderColor: INK, backgroundColor: LIME },
  chipText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: INK_MUTED },
  note: { fontFamily: fonts.body, fontSize: 13, color: INK_MUTED },
  fields: { gap: 8 },
  input: { fontFamily: fonts.body, fontSize: 15, color: INK, borderWidth: 1, borderColor: HAIRLINE, paddingHorizontal: 12, paddingVertical: 10 },
  statusChip: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: HAIRLINE, backgroundColor: INACTIVE },
  statusChipText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', color: INK },
});

/** A search result, in the feed-card shape — for opening its drawer from anywhere. */
function poolCard(p: TripAlongPlace, kind: 'activities' | 'food'): FeedCard {
  const price = p.priceLevel == null ? null : p.priceLevel === 0 ? 'Free' : '£'.repeat(Math.max(1, Math.min(4, Math.round(p.priceLevel))));
  const what = p.subcategory ? p.subcategory.replace(/-/g, ' ') : p.category ?? 'Place';
  const label = what.charAt(0).toUpperCase() + what.slice(1);
  return {
    ref: p.venueRef, name: p.name, photos: (p.photos ?? []).slice(0, 1), category: p.category, experiences: p.experiences ?? [],
    fit: fitOf(p.detourMinutes), typeR: p.rating != null ? `${label} · ★ ${p.rating.toFixed(1)}` : label,
    price, kind, onShortlist: p.onShortlist, onDay: p.onDay, lat: p.lat, lng: p.lng, place: p,
  };
}

/** A day stop, in the feed-card shape — enough for the drawer to open and refetch. */
function dayStopToCard(s: StopWithSlot): FeedCard {
  return {
    ref: s.venueRef, name: s.name, photos: [], category: null, experiences: [], fit: 'On your trip', typeR: 'A stop on your trip',
    price: null, kind: 'activities', onShortlist: false, onDay: true,
    lat: s.lat ?? null, lng: s.lng ?? null, place: undefined as unknown as TripAlongPlace,
  };
}

function cardToItem(card: FeedCard): BrowseItem {
  const p = card.place;
  return {
    id: card.ref, venueRef: card.ref, name: card.name, category: p?.category ?? 'attraction',
    lat: card.lat ?? 0, lng: card.lng ?? 0, dwellMinutes: 0, reasons: [], justification: null,
    startsAt: null, endsAt: null, pinned: false, source: p?.source ?? card.ref.split(':')[0],
    cuisines: p?.cuisines ?? [], experiences: p?.experiences ?? [],
    address: p?.address ?? null, website: p?.website ?? null, openingHours: p?.openingHours ?? null,
    photos: p?.photos ?? [], attribution: p?.attribution ?? null,
    rating: p?.rating ?? null, ratingCount: p?.ratingCount ?? null, priceLevel: p?.priceLevel ?? null,
    // The merged place's per-field source, so a Google rating or price level on
    // an OSM-identified place is read as Google's (Codex).
    provenance: p?.provenance, mapsUrl: p?.mapsUrl ?? null,
    summary: p?.summary ?? null, goodForChildren: p?.goodForChildren ?? null,
    travelFromBaseMinutes: p?.detourMinutes ?? null,
  };
}

type TimelineRow = { key: string; kind?: 'leg'; time: string; icon: 'home' | 'place'; title: string; sub: string | null; nodeFill: string; nodeBorder: string; dashed: boolean; onPress?: () => void; stopId?: string; first?: boolean; last?: boolean; status?: string | null;
  /** A leg row between two stops: the mode into the next stop, and the item to save a change on. */
  legMode?: LegMode; legMinutes?: number; legRef?: string | null };
const LEG_ICON: Record<LegMode, IconName> = { walking: 'walking', transit: 'transit', driving: 'driving', taxi: 'taxi' };
const LEG_WORD: Record<LegMode, string> = { walking: 'walk', transit: 'transit', driving: 'drive', taxi: 'taxi' };

/** "allow 1h", "allow 2h 30m", "allow 45 min" — a stop's own dwell. */
function allowLabel(mins: number): string {
  if (mins < 60) return `allow ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `allow ${h}h${m ? ` ${m}m` : ''}`;
}

function buildTimeline(trip: TripDetail['trip'], day: TripDay | null, dest: TripDetail['trip']['destination'], allStops: StopWithSlot[], destStopId: string | null, detourByRef: Map<string, number | null>, slByRef: Map<string, ShortlistItem>, startLabel: string, fromBase: boolean): { rows: TimelineRow[]; homeBy: string } {
  const rows: TimelineRow[] = [];
  // A holiday day carries its own schedule; fall back to the trip's for a day out (Codex).
  const travel = day?.journey?.minutes ?? trip.journey?.minutes ?? 0;
  const mode = day?.travelMode ?? trip.travelMode;
  const tz = trip.timezone ?? undefined;
  const tripLeg: LegMode = mode === 'walking' ? 'walking' : mode === 'transit' ? 'transit' : 'driving';

  // Worked in wall-clock minutes in the trip's timezone. The day's ISO start is
  // read there; a stop's own "HH:MM" pins the arrival, else it is the running
  // clock (Codex).
  let cur = isoMinutes(day?.startTime ?? trip.departAt, tz) ?? 0;
  rows.push({ key: 'leave', time: fmtMinutes(cur), icon: 'home', title: fromBase ? `Leave ${startLabel}` : 'Leave home', sub: null, nodeFill: CREAM, nodeBorder: GREY, dashed: false });

  // The day in order: the destination in its place (heading the day when it is
  // not itself one of the stops) and the added stops around it.
  type Item = { key: string; kind: 'dest' | 'stop'; s?: StopWithSlot; dwell: number; det: number | null; startTime: string | null; ref: string | null };
  const items: Item[] = [];
  if (dest && !destStopId) items.push({ key: 'dest', kind: 'dest', dwell: 180, det: null, startTime: null, ref: null });
  for (const s of allStops) {
    if (s.id === destStopId) items.push({ key: 'dest', kind: 'dest', s, dwell: s.dwellMinutes ?? 180, det: null, startTime: s.startTime, ref: s.venueRef });
    else items.push({ key: s.id, kind: 'stop', s, dwell: s.dwellMinutes || 60, det: detourByRef.get(s.venueRef) ?? null, startTime: s.startTime, ref: s.venueRef });
  }

  items.forEach((it, idx) => {
    // Travel to reach this stop: the journey to the first thing, then each
    // later stop's own detour (a nominal 10 min where the search does not know).
    const legMins = idx === 0 ? travel : it.det != null ? Math.round(it.det) : 10;
    cur += legMins;
    // The leg into this stop, its own tappable row between the two nodes. Its mode
    // is the stop's saved leg mode where the household has set one, else the trip's.
    const sl = it.ref ? slByRef.get(it.ref) : undefined;
    const legMode = (sl?.legMode as LegMode | undefined) ?? tripLeg;
    rows.push({ key: `leg:${it.key}`, kind: 'leg', time: '', icon: 'place', title: '', sub: null, nodeFill: CREAM, nodeBorder: GREY, dashed: true, legMode, legMinutes: legMins, legRef: it.ref });
    const pinned = hmMinutes(it.startTime);
    if (pinned != null) cur = pinned; // a scheduled stop shows at its set time
    if (it.kind === 'dest') {
      rows.push({ key: 'dest', time: fmtMinutes(cur), icon: 'place', title: destShortName(trip), sub: 'Your destination', nodeFill: LIME, nodeBorder: LIME, dashed: false, status: sl?.status ?? null });
    } else {
      const s = it.s!;
      const sub = it.det != null ? `+${Math.round(it.det)} min detour · ${allowLabel(it.dwell)}` : allowLabel(it.dwell);
      // An arrow only swaps with the immediately adjacent stop, never across a
      // slot boundary or the fixed destination anchor — so it is disabled there.
      const ai = allStops.indexOf(s);
      const prev = allStops[ai - 1];
      const next = allStops[ai + 1];
      const first = !prev || prev.id === destStopId || prev.slot !== s.slot;
      const last = !next || next.id === destStopId || next.slot !== s.slot;
      rows.push({ key: s.id, time: fmtMinutes(cur), icon: 'place', title: s.name, sub, nodeFill: LIME, nodeBorder: LIME, dashed: false, stopId: s.id, first, last, status: sl?.status ?? null });
    }
    cur += it.dwell;
  });
  // Variant 4 has no "More ideas nearby" spine row — the Back to ideas bar does that.
  const homeArrive = cur + travel;
  rows.push({ key: 'home', time: fmtMinutes(cur), icon: 'home', title: fromBase ? `Back to ${startLabel}` : 'Head home', sub: `${cap(mode)} ${travel} min · ${fromBase ? 'back' : 'home'} by ${fmtMinutes(homeArrive)}`, nodeFill: CREAM, nodeBorder: GREY, dashed: false });
  return { rows, homeBy: fmtMinutes(homeArrive) };
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: CREAM, position: 'relative', overflow: 'hidden' },

  // Trip stage
  tripMap: { height: 400, position: 'relative' },
  tripSheet: { position: 'absolute', left: 0, right: 0, top: 400, bottom: 0, backgroundColor: CREAM },
  sheetInner: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 180 },
  grab: { alignSelf: 'center', width: 40, height: 4, backgroundColor: GREY, marginTop: 4, marginBottom: 8, borderRadius: 2 },
  // The trip (nav 6a–6c): the map fills this area and the drawer covers its
  // bottom; the map shows through the strip above (MapGL coverBottom).
  mapDrawerArea: { flex: 1, position: 'relative', backgroundColor: NEUTRAL },
  scanArea: { position: 'absolute', left: 0, right: 0, top: 0 },
  // The drawer: a bottom sheet with 18px top corners (nav §9), over the map.
  drawer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CREAM, borderTopLeftRadius: 18, borderTopRightRadius: 18, shadowColor: INK, shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: -6 }, overflow: 'hidden' },
  handleWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  handleHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  handleHintText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: MUTED },
  dayInner: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 28 },
  mapCredit: { position: 'absolute', right: 10, bottom: 6, paddingHorizontal: 4, paddingVertical: 2 },
  mapCreditText: { fontFamily: fonts.body, fontSize: 10, color: MUTED, opacity: 0.7 },
  staysInner: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  tripHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  headBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  tripName: { fontFamily: fonts.heading, fontSize: 24, fontWeight: '800', letterSpacing: -0.72, lineHeight: 26, color: INK },
  tripMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontFamily: fonts.body, fontSize: 13, color: MUTED, lineHeight: 18 },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  avatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: CREAM, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', color: INK },
  whoText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: INK },
  dayKickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  dayKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase', color: MUTED },
  // Where you're staying: a title-case header (a possessive phrase reads wrong in
  // caps) and a tappable row that opens the Stays tab.
  staySection: { marginTop: 18 },
  stayHead: { fontFamily: fonts.heading, fontSize: 14, fontWeight: '800', letterSpacing: -0.28, color: INK, marginBottom: 8 },
  stayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: LIME_TINT },
  stayName: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: INK },
  stayMeta: { fontFamily: fonts.body, fontSize: 12.5, color: MUTED, marginTop: 1 },
  dayMore: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  dayStrip: { gap: 8, marginTop: 16 },
  dayChip: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: GREY, gap: 2 },
  dayChipOn: { borderColor: INK, backgroundColor: LIME_TINT },
  dayChipDay: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: MUTED },
  dayChipDate: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: INK },
  dayChipN: { fontFamily: fonts.body, fontSize: 11, color: MUTED },
  timeline: { position: 'relative' },
  spine: { position: 'absolute', left: 57, top: 14, bottom: 14, width: 1, backgroundColor: GREY },
  beat: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  beatTime: { width: 30, fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: INK, fontVariant: ['tabular-nums'] },
  node: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  beatTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  beatTitle: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: INK, flexShrink: 1 },
  beatSub: { fontFamily: fonts.body, fontSize: 13, color: MUTED },
  moveCol: { marginRight: -8 },
  moveBtn: { width: 32, height: 24, alignItems: 'center', justifyContent: 'center' },
  // The leg sits on the spine between two beats, its chip aligned under the nodes.
  legRow: { paddingLeft: 44, paddingVertical: 2 },
  legChip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, backgroundColor: CREAM, borderWidth: 1, borderColor: HAIRLINE },
  legText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: MUTED },

  ideasBar: { position: 'absolute', left: 16, right: 16, bottom: 92, flexDirection: 'row', backgroundColor: INK },
  ideasMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 12 },
  ideasTitle: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: CREAM },
  ideasSub: { fontFamily: fonts.body, fontSize: 13, color: HAIRLINE },
  ideasHearts: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ideasHeartsN: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: LIME },
  ideasDone: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderLeftWidth: 1, borderLeftColor: INK_MUTED },
  ideasDoneText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: CREAM },
  ideasMini: { position: 'absolute', right: 16, bottom: 92, height: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, backgroundColor: CREAM, borderWidth: 1, borderColor: GREY },
  ideasMiniText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: INK },

  // Feed
  feed: { backgroundColor: CREAM },
  // A screen that owns its header (routes.ownsHeader) gets no top inset from the
  // shell (App.tsx Edges), so it takes the status bar into its own first row —
  // else "Back to my trip" sits under the clock (deployed, 29 Sep 2026).
  feedHead: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: (Platform.OS === 'web' ? 'calc(8px + var(--epic-sat))' : 8) as any },
  backBtn: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: INK, borderWidth: 2, borderColor: INK },
  backBtnText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: CREAM },
  shortBtn: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 10, backgroundColor: CREAM, borderWidth: 1, borderColor: GREY },
  shortBtnLabel: { flex: 1, fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: INK },
  shortCount: { minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  shortCountText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: INK },
  feedKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase', color: MUTED, paddingHorizontal: 20, paddingTop: 14 },
  tabs: { flexDirection: 'row', marginTop: 14 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  tabText: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.6 },
  filterLine: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: GREY, position: 'relative', zIndex: 5 },
  // §6 context row: left control 13.5px/400 (17px leading icon, 14px chevron), and
  // "Filters" on the right at 13px/600 grey with the sliders icon. Travel mode lives
  // inside Filters, per the owner's design — never a row of its own.
  ctxLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: -6, paddingVertical: 6 },
  ctxLeftText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: '400', color: INK },
  ctxFilters: { flexDirection: 'row', alignItems: 'center', gap: 5, marginVertical: -6, paddingVertical: 6 },
  ctxFiltersText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: MUTED },
  ctxFiltersActive: { color: INK },
  filterModeLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  minsMenu: { position: 'absolute', left: 12, top: '100%', marginTop: 4, minWidth: 250, backgroundColor: CREAM, borderWidth: 1, borderColor: GREY, zIndex: 6, shadowColor: INK, shadowOpacity: 0.16, shadowRadius: 28, shadowOffset: { width: 0, height: 12 } },
  filtersMenu: { position: 'absolute', right: 12, top: '100%', marginTop: 4, minWidth: 230, backgroundColor: CREAM, borderWidth: 1, borderColor: GREY, zIndex: 6, shadowColor: INK, shadowOpacity: 0.16, shadowRadius: 28, shadowOffset: { width: 0, height: 12 } },
  minsHead: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase', color: MUTED, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  minsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingHorizontal: 14, paddingVertical: 12 },
  minsLabel: { fontFamily: fonts.body, fontSize: 15, color: INK },
  minsCount: { fontFamily: fonts.body, fontSize: 13, color: MUTED },

  row: { gap: 12, paddingTop: 22 },
  rowHead: { paddingHorizontal: 20, gap: 2 },
  rowTitle: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.6, color: INK },
  rowScroll: { gap: 12, paddingHorizontal: 20 },
  cardName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', lineHeight: 19, color: INK },
  cardFit: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: MOSS },
  // The detour and the type·rating on one row: detour left, the rest right, with
  // the right side free to shrink so a long "Museum · ★ 4.7" never shoves the
  // detour off the card.
  cardLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardLineR: { flexShrink: 1, textAlign: 'right' },
  heartChipWrap: { position: 'absolute', top: 8, right: 8 },
  heartChip: { width: 38, height: 38, borderRadius: 19, backgroundColor: CHIP_SCRIM, alignItems: 'center', justifyContent: 'center' },
  priceTag: { position: 'absolute', left: 8, bottom: 8, backgroundColor: CREAM, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  priceTagText: { fontFamily: fonts.body, fontSize: 11, fontWeight: '700', color: INK },
  credit: { position: 'absolute', right: 0, bottom: 0, maxWidth: '100%', backgroundColor: CHIP_SCRIM, paddingHorizontal: 4, paddingVertical: 1 },
  creditText: { fontFamily: fonts.body, fontSize: 9, color: CREAM },

  thinWrap: { paddingHorizontal: 20, paddingTop: 22, gap: 16 },
  thinTitle: { fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, lineHeight: 23, color: INK },
  widenWrap: { borderTopWidth: 2, borderTopColor: INK, paddingTop: 14, marginTop: 4, gap: 12 },
  widenSub: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: INK },
  widenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 15, backgroundColor: INK },
  widenBtnText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: CREAM },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: INK },
  retryText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: CREAM },

  // Shortlist
  short: { backgroundColor: CREAM },
  shortMap: { height: 300, position: 'relative', overflow: 'hidden' },
  mapGrab: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  mapGrabBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: GREY },
  // Clears the status bar itself — the shortlist owns its header, so the shell
  // adds no top inset (App.tsx Edges); the map runs under the clock, this must not.
  floatBack: { position: 'absolute', left: 16, top: (Platform.OS === 'web' ? 'calc(16px + var(--epic-sat))' : 16) as any, width: 40, height: 40, borderRadius: 8, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center', shadowColor: INK, shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  callout: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, backgroundColor: CREAM, shadowColor: INK, shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  calloutImg: { width: 48, height: 48, borderRadius: 8, backgroundColor: NEUTRAL },
  calloutName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: INK },
  calloutDetails: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  calloutDetailsText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: INK },
  shortTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 20, paddingTop: 16 },
  shortTitle: { fontFamily: fonts.heading, fontSize: 24, fontWeight: '800', letterSpacing: -0.72, color: INK },
  // 6c drawer: "N saved" on the left, the "Everything ▾" filter dropdown on the right.
  shortDrawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  shortSaved: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: MUTED },
  shortFilter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: -6, paddingVertical: 6 },
  shortFilterLabel: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: INK },
  shortFilterMenu: { marginHorizontal: 20, marginTop: 4, marginBottom: 4, borderTopWidth: 1, borderColor: GREY, borderBottomWidth: 1 },
  shortFilterRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingHorizontal: 6, paddingVertical: 12 },
  shortFilterRowLabel: { fontFamily: fonts.body, fontSize: 15, color: INK },
  shortFilterRowN: { fontFamily: fonts.body, fontSize: 13, color: MUTED },
  shortTabs: { flexDirection: 'row', marginTop: 12 },
  shortTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 6 },
  shortTabLabel: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  shortTabN: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700' },
  shortEmpty: { paddingVertical: 28, gap: 6 },
  emptyTitle: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: INK },
  shortRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: -20, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: GREY },
  shortThumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: NEUTRAL },
  shortRowName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', lineHeight: 19, color: INK },
  shortRowMeta: { fontFamily: fonts.body, fontSize: 12, color: MUTED },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 10, borderWidth: 1, borderColor: INK, backgroundColor: CREAM },
  addBtnText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: INK },
  asideWrap: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: GREY },
  asideHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  asideHeadText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: MUTED },
  asideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  asideName: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, color: INK },
  asideBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderWidth: 1, borderColor: INK, backgroundColor: CREAM },
  asideBtnText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: INK },
  viewTripBar: { position: 'absolute', left: 16, right: 16, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 14, backgroundColor: INK, shadowColor: INK, shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
});
