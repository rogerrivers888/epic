import React, { useEffect, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useViewport } from '../hooks/useViewport';
import { Icon, IconName, IconText, Rating, Stars } from './Icon';
import { API_URL, api, BrowseItem, MenuLink, OwnedRecord, PlaceInsideItem, Venue, Visit } from '../api';
import { colors, fonts, radius, spacing, TARGET, type, BORDER, CREAM, INK, LIME } from '../theme';
import { Button, Chip, Row, Segmented, Wrap, clock, minutes } from './ui';
import { MenuPanel, OrderPanel, PastMeals, StaffSheet, useMenuOrder } from './MenuOrder';
import { FamilyVerdict } from './FamilyVerdict';
import { OwnedFacts } from './OwnedFacts';
import { useOffline } from '../hooks/useOffline';
import { savedRecord } from '../offline/cache';
import { SOURCE_LABEL, priceMarks, typeLine } from './StopCard';
import { PHOTO_W, VenueThumb } from './VenueThumb';

/**
 * The click-through on a place (owner, 3 Sep 2026): a side drawer on a wide
 * screen, a full sheet on a phone, with tabs for what the sources actually
 * give us — overview (summary, address, price, children, booking, website,
 * map), reviews (best to most critical, with attribution), opening hours, and
 * photos. Detail is fetched when opened and never stored: licensed content is
 * rented, identifiers are ours (Technical Constraints §4).
 *
 * Underneath all of that sits the part that does not disappear (owner, 4 Sep
 * 2026): Epic's own record of the place, researched when the household kept it,
 * from sources whose licences let us hold on to the answer. With no signal the
 * provider's half of this drawer is empty and that record is the whole of it —
 * the address, the phone number, the hours, the menu — which is what makes a
 * place openable standing outside it with no bars.
 *
 * Three things it answers for someone standing outside (owner, 4 Sep 2026):
 * whether it is open today, what each review actually gave it in stars, and
 * where the menu is — the last found by following the website when the drawer
 * opens, not by asking a source that does not have it.
 */

// The tabs the owner asked for (4 Sep 2026): "I don't think hours and photos
// are needed… no harm, but definitely doesn't need to be a tab." Hours and
// photos fold into Overview; getting there earns one of its own; and the menu
// and the order — the two things you want while you are standing in the place —
// are tabs rather than something below the fold.
type Tab = 'overview' | 'travel' | 'reviews' | 'menu' | 'order' | 'inside';

// Somewhere you eat, where the menu is worth a row of its own.
const EATING = new Set(['restaurant', 'cafe', 'bar', 'pub']);

/** Just the domain, which is what a website line is for: "piccolino.co.uk". */
const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};



/**
 * Open today, or not. Google decides `openNow` in the place's own timezone, so
 * this reads it rather than working it out; `hoursToday` is the day's own words
 * where the place is. Sources that do not say leave this empty rather than
 * guessing.
 */
function openState(v?: Venue): { state: string; detail: string | null; open: boolean | null } | null {
  if (!v) return null;
  const today = (v.hoursToday ?? '').trim();
  const closedAllDay = /^closed$/i.test(today);
  if (v.openNow === true) return { state: 'Open now', detail: v.closesAt ? `closes ${v.closesAt}` : today || null, open: true };
  if (v.openNow === false) {
    if (closedAllDay) return { state: 'Closed today', detail: null, open: false };
    return { state: 'Closed now', detail: v.opensAt ? `opens ${v.opensAt}` : today || null, open: false };
  }
  if (closedAllDay) return { state: 'Closed today', detail: null, open: false };
  if (today) return { state: 'Open today', detail: today, open: null };
  return null;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/**
 * "Monday to Friday · 12:00–22:30" rather than the same line five times (owner,
 * 4 Sep 2026). A run of days that keep the same hours becomes one row; the days
 * that differ keep their own.
 */
function foldHours(lines: string[]): string[] {
  const parsed = lines
    .map((l) => l.match(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => ({ day: m![1], time: m![2].replace(/\s*[–-]\s*/, '–').replace(/\s+/g, ' ') }));
  if (parsed.length !== lines.length || !parsed.length) return lines;   // an unexpected shape stays as it came
  const runs: { from: string; to: string; time: string }[] = [];
  for (const { day, time } of parsed) {
    const last = runs[runs.length - 1];
    const consecutive = last && DAYS.indexOf(day) === DAYS.indexOf(last.to) + 1;
    if (last && last.time === time && consecutive) last.to = day;
    else runs.push({ from: day, to: day, time });
  }
  return runs.map((r) => `${r.from === r.to ? r.from : `${r.from} to ${r.to}`} · ${r.time}`);
}

/** The address as you would read it aloud, without the protocol. */
const prettyUrl = (u: string) => u.replace(/^https?:\/\//i, '').replace(/\/$/, '').slice(0, 64);

/**
 * One picture, which removes itself if it does not arrive. A photo that 404s —
 * a provider's daily allowance run out — used to leave a coloured box on the
 * screen for as long as you looked at it (owner, 4 Sep 2026).
 */
function Hero({ uri, attribution }: { uri: string | null; attribution: string | null }) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready || failed) return;
    const t = setTimeout(() => setFailed(true), 8000);
    return () => clearTimeout(t);
  }, [ready, failed, uri]);
  if (!uri || failed) return null;
  return (
    <View>
      <Image source={{ uri }} style={styles.hero} onError={() => setFailed(true)} onLoad={() => setReady(true)} accessibilityIgnoresInvertColors />
      {attribution ? <Text style={type.tiny}>{attribution}</Text> : null}
    </View>
  );
}

// Places whose grounds hold other places, and how far those grounds reach.
const GROUNDS: Record<string, number> = { 'theme-park': 1.2, zoo: 1.0, 'water-park': 0.8, aquarium: 0.4 };

/**
 * Who may ride, which is the first thing a parent asks and the last thing a
 * source gives you (owner, 4 Sep 2026: "they are useless without any age rating
 * or info on the ride"). Height in centimetres because that is how a park
 * writes it and how a family measures a child against a board.
 */
function whoCanRide(f: PlaceInsideItem['facts']): string | null {
  const cm = (m?: number) => (m ? `${Math.round(m * 100)} cm` : null);
  const bits = [
    f.minHeightM ? `${cm(f.minHeightM)} and over` : null,
    f.maxHeightM ? `up to ${cm(f.maxHeightM)}` : null,
    f.minAge ? `${f.minAge}+` : null,
    f.supervision ? f.supervision : null,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

/** How a ride reads: 30 m high, 129 km/h, opened 2024. */
function rideLine(f: PlaceInsideItem['facts']): string {
  return [
    f.heightM ? `${Math.round(f.heightM)} m high` : null,
    f.speedKph ? `${Math.round(f.speedKph)} km/h` : null,
    f.lengthM ? `${Math.round(f.lengthM)} m long` : null,
    f.opened ? `opened ${f.opened}` : null,
    f.extraCharge ? 'extra charge' : null,
  ].filter(Boolean).join(' · ');
}

/**
 * What is inside this place. A theme park is not one thing to do, it is forty,
 * and those forty belong here rather than in the list beside the museum down
 * the road (owner, 4 Sep 2026). Everything shown is ours: the open map for the
 * rides and where they stand, Wikidata for how high and how fast, Wikipedia for
 * the paragraph — all licences that let us keep the answer.
 */
/**
 * What is inside this place, as its own tab. A theme park is not one thing to
 * do, it is forty, and those forty are why you opened it (owner, 4 Sep 2026).
 * Everything shown is ours: the open map for the rides and where they stand,
 * Wikidata for how high and how fast, the park's own pages for who may ride.
 */
function InsideList({ inside, busy, full = false }: { inside: PlaceInsideItem[] | null; busy: boolean; full?: boolean }) {
  const [open, setOpen] = useState(false);
  if (busy && !inside) return <IconText name="search">Looking up what is inside…</IconText>;
  if (!inside?.length) return null;

  const rides = inside.filter((i) => !['eat', 'shop', 'facility'].includes(i.kind));
  const eat = inside.filter((i) => i.kind === 'eat');
  const shown = full || open ? rides : rides.slice(0, 6);
  return (
    <View style={{ gap: full ? spacing.md : 6, ...(full ? {} : { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted }) }}>
      {!full ? <Text style={[type.tiny, { fontWeight: '700', color: colors.ink }]}>WHAT'S INSIDE</Text> : null}
      {shown.map((i) => {
        const f = i.facts;
        const who = whoCanRide(f);
        const facts = rideLine(f);
        return (
          <View key={i.itemRef} style={{ gap: 2 }}>
            <Text style={[full ? type.body : type.small, { color: colors.ink, fontWeight: '600' }]}>{i.name}</Text>
            <Text style={type.tiny}>{[i.kindLabel, facts].filter(Boolean).join(' · ')}</Text>
            {who ? <Row style={{ gap: 5, alignItems: 'flex-start' }}><View style={{ paddingTop: 2 }}><Icon name="children" size={13} color={colors.icon} /></View><Text style={[type.tiny, { flex: 1, color: colors.ink }]}>{who}</Text></Row> : null}
            {full && i.summary ? <Text style={type.tiny} numberOfLines={3}>{i.summary}</Text> : null}
          </View>
        );
      })}
      {full && !rides.some((r) => r.facts?.restrictionsChecked) ? <IconText name="search">Reading the park's own height restrictions…</IconText> : null}
      {rides.length > shown.length ? <Pressable onPress={() => setOpen(true)} accessibilityRole="button"><Text style={[type.tiny, { color: colors.accent, fontWeight: '700' }]}>All {rides.length}</Text></Pressable> : null}
      {eat.length ? <Text style={type.tiny}>{eat.length} place{eat.length === 1 ? '' : 's'} to eat inside.</Text> : null}
      <Text style={type.tiny}>{[...new Set(inside.flatMap((i) => i.attribution))].join(' · ')}</Text>
    </View>
  );
}

export function VenueDrawer({ item, baseLabel, onClose, onAdd, addLabel, addIcon, onShortlist, added, shortlisted, ours, capture, onVenue, gettingThere }: {
  item: BrowseItem | null;
  baseLabel?: string | null;
  onClose: () => void;
  onAdd?: (item: BrowseItem) => void;
  /**
   * What the primary action is called here. A drawer opened inside a trip is
   * adding to that day's plan; one opened from the home screen is starting a
   * trip that does not exist yet, and calling both "Add to plan" would be a
   * lie in one of the two places.
   */
  addLabel?: string;
  addIcon?: IconName;
  onShortlist?: (item: BrowseItem) => Promise<void>;
  added?: boolean;
  shortlisted?: boolean;
  /** The household's own side of the place (Places tab): status, history, notes — shown above the source's tabs. */
  ours?: React.ReactNode;
  /**
   * The one question worth asking the moment the place is open — did everyone
   * love it? — at the top of the overview, where the household's own record
   * sits behind the reviews tab (owner, 4 Sep 2026).
   */
  capture?: React.ReactNode;
  /** The source's record once fetched (the atlas uses it to learn a name it only held as an identifier). */
  onVenue?: (venue: Venue) => void;
  /** How you get to it — the station, its lines, the postcode — which now has a tab of its own. */
  gettingThere?: React.ReactNode;
}) {
  const { width, height, framed, origin } = useViewport();
  const wide = width >= 900;
  // Inside the shell's phone frame the Modal still portals to the whole window, so the sheet is pinned to the frame's size.
  const frameBox = framed && origin ? { position: 'absolute' as const, left: origin.x, top: origin.y, width, height, borderRadius: radius.lg, overflow: 'hidden' as const } : null;
  const [tab, setTab] = useState<Tab>('overview');
  // What is inside a place with grounds: the rides in a theme park, the animals
  // in a zoo (owner, 4 Sep 2026). Researched once from the open map, Wikidata
  // and Wikipedia, then ours — so this is a read, and it may go on the device.
  const [inside, setInside] = useState<PlaceInsideItem[] | null>(null);
  const [insideBusy, setInsideBusy] = useState(false);
  // Which places have grounds worth looking inside, decided from what the
  // search already said this place is.
  const insideOf = item?.experiences ?? [];
  const grounds = insideOf.reduce((r, e) => Math.max(r, GROUNDS[e] ?? 0), 0);
  const [venue, setVenue] = useState<Venue | null | undefined>(undefined);
  const [menu, setMenu] = useState<MenuLink | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Epic's own record: what survives when the provider cannot be reached.
  const [ownRecord, setOwnRecord] = useState<OwnedRecord | null | undefined>(undefined);
  /**
   * What the crowd made of an atlas place.
   *
   * The atlas is Wikidata and OpenStreetMap and has no reviews in it, so an
   * attraction opened from Inspire showed none however many Google had (owner,
   * 7 Sep 2026: "for activities, get the reviews always from Google"). This is
   * fetched *beside* the drawer rather than before it — the screen opens on
   * what we already hold and the stars arrive a moment later, because "I don't
   * want there to be any delays. I want it to be snappy."
   */
  const [crowd, setCrowd] = useState<{ rating: number | null; ratingCount: number | null; reviews: Venue['reviews']; attribution: string | null } | null>(null);
  /**
   * Every visit this household has made here, with every star given on it —
   * the place itself and each plate on the table (routes/places.js
   * `visitPayload`). It is what the family's own rating is worked out from
   * (owner, 7 Sep 2026), and `undefined` until it has been asked for, so a
   * place they have been to does not flash "have you been?" first.
   */
  const [visits, setVisits] = useState<Visit[] | undefined>(undefined);
  const { online, serving } = useOffline();
  // The same test the shell uses: not what the browser claims, but whether the
  // answers on screen actually came off the device.
  const showingSaved = !online || serving;


  // What is inside is fetched when the drawer opens, not when its tab is
  // tapped: a tab nobody can see is a tab nobody can tap.
  useEffect(() => {
    if (!item || !grounds || inside || insideBusy) return;
    setInsideBusy(true);
    let live = true;
    const ask = (): Promise<void> => api.placeInside({ ref: item.venueRef, lat: item.lat, lng: item.lng, experiences: insideOf.join(','), name: item.name, website: v?.website ?? item.website ?? undefined })
      .then(async (r) => {
        if (!live) return;
        setInside(r.items);
        // Who may ride is the park's own answer and takes a minute to read, so
        // the rides arrive first and the heights fill in underneath them.
        const missing = r.items.some((i) => !['eat', 'shop', 'facility'].includes(i.kind) && !i.facts?.restrictionsChecked);
        if (!r.askingWhoCanRide || !missing) return;
        for (let n = 0; n < 8 && live; n += 1) {
          await new Promise((res) => setTimeout(res, 8000));
          if (!live) return;
          const again = await api.placeInside({ ref: item.venueRef }).catch(() => null);
          if (!again?.items.length) continue;
          setInside(again.items);
          if (again.items.some((i) => i.facts?.restrictionsChecked)) return;
        }
      })
      .catch(() => { if (live) setInside([]); })
      .finally(() => { if (live) setInsideBusy(false); });
    void ask();
    return () => { live = false; };
  }, [item?.venueRef, grounds]);


  useEffect(() => {
    setTab('overview'); setVenue(undefined); setMenu(undefined); setError(null); setSaved(false); setOwnRecord(undefined); setInside(null); setVisits(undefined); setCrowd(null);
    if (!item) return;
    let live = true;
    // A place the household has never opened has no saved answer of its own, but
    // every owned record arrived in one piece when the copy was filled — so with
    // no signal the address and the phone number are still here.
    const fromDevice = async () => {
      const ref = item.venueRef;
      const r = await savedRecord(ref);
      if (live) setOwnRecord(r);
    };
    // An idea that has not been matched to a place yet has no identifier to
    // look up. That is not a reason to refuse to open: the card's own facts are
    // the drawer, and what is around it still loads (owner, 4 Sep 2026).
    if (!item.venueRef) { setVenue(null); return () => { live = false; }; }
    // Nothing to ask about a place that is ours. `wikidata:` is not a provider
    // and no source holds that identifier, so the round trip could only ever
    // come back empty — and an empty answer is what the screen was reading as
    // "no signal".
    /**
     * A place of ours, with no reviews in it.
     *
     * Two pools are like this and both need the same thing. The atlas
     * identifies a place by Wikidata or OpenStreetMap; the postcode sweep
     * identifies a restaurant by OpenStreetMap and keeps a *band* rather than a
     * rating, because a rating is not ours to store. Neither can answer "what
     * did people say", and both were opening with nothing on them (owner,
     * 7 Sep 2026: "when I click into Indian… there are no reviews. There are
     * names, but there are no reviews").
     *
     * So it is the source that decides, not the ref's prefix. Google is asked
     * once by name and coordinates, and the answer arrives beside the drawer
     * rather than in front of it: the screen is already up and gains its stars
     * a moment later ("I want it to be snappy"). The list keeps the sweep's own
     * band — that part is ours and does not need buying.
     */
    if ((item.source === 'atlas' || item.source === 'scout') && item.lat != null && item.lng != null) {
      api.placeReviews({ ref: item.venueRef, name: item.name, lat: item.lat, lng: item.lng })
        .then((d) => { if (live && d.matched) setCrowd({ rating: d.rating, ratingCount: d.ratingCount, reviews: d.reviews, attribution: d.attribution }); })
        .catch(() => { /* no reviews is not an error worth a message */ });
    }
    // No provider holds a `wikidata:` id, so there is no venue to fetch for one.
    if (item.venueRef.startsWith('wikidata:')) { setVenue(null); return () => { live = false; }; }
    // Opening a place we never managed to identify sends the researcher out
    // again (owner, 5 Sep 2026: "we should call the API as soon as a user opens
    // a record to make sure that we get the correct data in"). It takes a few
    // seconds — the open map, then their own page — so the drawer comes back
    // for the answer rather than showing the gap and leaving it there.
    //
    // It asks for our own record, not for the place again: a second look at the
    // place is a second Place Details request, and spending six of somebody's
    // daily allowance to watch a free lookup finish is how the allowance ran
    // out in the first place. `/api/places/record` reads our own tables and
    // calls nobody.
    const waitForResearch = async () => {
      const ref = item.venueRef;
      for (let n = 0; n < 6 && live; n += 1) {
        await new Promise((r) => setTimeout(r, 4000));
        if (!live) return;
        const held = await api.placeRecords([ref]).catch(() => null);
        const now = held?.records?.[ref];
        if (!live || !now) continue;
        setOwnRecord(now);
        // Something to show: a name, a page of theirs, or the open map's entry.
        if (now.website || now.osmRef || now.name) return;
      }
    };
    api.place(item.venueRef)
      .then((d) => {
        if (!live) return;
        setVenue(d.venue); setMenu(d.menu ?? null); setVisits(d.visits ?? []);
        if (d.venue) onVenue?.(d.venue);
        if (d.sourceError) setError(d.sourceError);
        if (d.ours) setOwnRecord(d.ours);
        else void fromDevice();
        if (d.researching) void waitForResearch();
      })
      .catch((e) => {
        if (!live) return;
        setVenue(null); setMenu(null); setVisits([]);
        setError(e?.code === 'offline' ? null : e.message);
        void fromDevice();
      });
    return () => { live = false; };
  }, [item?.venueRef]);

  // Menu and order are tabs of this drawer, so their state lives here and is
  // only fetched for somewhere you eat (owner, 4 Sep 2026).
  const ctl = useMenuOrder({
    venueRef: item?.venueRef ?? '',
    venueLabel: (item && item.name === item.venueRef && venue?.name ? venue.name : item?.name) ?? '',
    website: venue?.website ?? ownRecord?.website ?? item?.website ?? null,
    enabled: !!item && EATING.has(item.category),
  });

  /**
   * Send this place to somebody.
   *
   * The venue's own page where it has one, and its name and address where it
   * does not — never a link into Epic, which the person receiving it cannot
   * open. `navigator.share` on a phone, the clipboard everywhere else, and a
   * tick for a second so the tap is not silent.
   *
   * Above the `if (!item)` below, with the rest of the hooks: React counts
   * them, and one declared after an early return is a drawer that crashes the
   * moment it is opened.
   */
  const [shared, setShared] = useState(false);
  const sharePlace = async () => {
    if (!item) return;
    const url = venue?.website ?? item.website ?? null;
    const text = [item.name, venue?.address ?? item.address ?? null].filter(Boolean).join(', ');
    try {
      const nav = (globalThis as any).navigator;
      if (nav?.share) await nav.share({ title: item.name, text, ...(url ? { url } : {}) });
      else if (nav?.clipboard) await nav.clipboard.writeText(url ?? text);
      else return;
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch { /* a share somebody cancelled is not an error worth a screen */ }
  };

  if (!item) return null;
  const v = venue ?? undefined;
  // A place the atlas holds only by identifier takes its name from the source when the drawer opens.
  const title = item.name === item.venueRef && v?.name ? v.name : item.name;
  const photos = (v?.photos?.length ? v.photos : item.photos) ?? [];
  const reviews = [...(v?.reviews ?? crowd?.reviews ?? [])].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const hours = (v?.openingHours ?? item.openingHours ?? '').split(' · ').filter(Boolean);
  const website = v?.website ?? ownRecord?.website ?? item.website;
  const mapsUrl = v?.mapsUrl ?? item.mapsUrl;
  const externalUrl = v?.externalUrl ?? item.externalUrl;
  const price = priceMarks(v?.priceLevel ?? item.priceLevel);
  // Ours first, then the card's, then the crowd's — an atlas place has neither
  // of the first two and is the whole reason the third is fetched.
  const rating = v?.rating ?? item.rating ?? crowd?.rating ?? null;
  const ratingCount = v?.ratingCount ?? item.ratingCount ?? crowd?.ratingCount ?? null;
  const source = item.source ?? item.venueRef.split(':')[0];
  /** Ours outright: the atlas researched it, and there is no provider behind it. */
  const ours0wn = source === 'atlas' || item.venueRef.startsWith('wikidata:');
  // Somewhere this household has actually eaten or been: what the drawer opens
  // with, and where "Been again" belongs, both turn on it.
  const been = (visits?.length ?? 0) > 0;
  const sourceName = SOURCE_LABEL[source] ?? source;
  /**
   * A rented photograph, with the signature that lets it through the door.
   *
   * `sig`/`exp` come stamped on the reference (api/sources/photoLinks.js) and
   * are what makes the picture load in a browser that blocks third-party
   * cookies — which is Safari, and soon Chrome — where the session cookie the
   * route used to lean on never arrives. Without them every hero in this
   * drawer was a blank green rectangle; `VenueThumb` has sent them all along,
   * which is why a row's thumbnail worked and the picture it opened did not.
   */
  const photoUri = (p: { ref?: string; url?: string; sig?: string; exp?: number }) =>
    p.url ?? (p.ref
      ? `${API_URL}/api/photos/google?name=${encodeURIComponent(p.ref)}&w=${PHOTO_W}`
        + (p.sig && p.exp ? `&s=${encodeURIComponent(p.sig)}&e=${p.exp}` : '')
      : null);

  const eating = EATING.has(item.category);
  const basket = ctl.menu ? ctl.chosen.length : ctl.order?.items.length ?? 0;
  const experiences = v?.experiences ?? item.experiences ?? [];
  const insideCount = (inside ?? []).filter((i) => !['eat', 'shop', 'facility'].includes(i.kind)).length;
  const insideLabel = experiences.includes('zoo') || experiences.includes('aquarium') ? 'Animals' : 'Rides';
  // Somewhere you eat leads with the two things you want while you are standing
  // in it, because only three or four tabs fit a phone without scrolling.
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    ...(eating ? [
      { value: 'menu' as Tab, label: 'Menu' },
      // What is actually in the basket, which is the picks while the menu is
      // open and the saved order before it has been read (owner, 7 Sep 2026).
      { value: 'order' as Tab, label: `Order${basket ? ` (${basket})` : ''}` },
    ] : []),
    // A park's rides are not an aside in the overview, they are why you are
    // reading it (owner, 4 Sep 2026: "put that in a separate tab please").
    ...(insideCount ? [{ value: 'inside' as Tab, label: `${insideLabel} (${insideCount})` }] : []),
    ...(gettingThere || mapsUrl ? [{ value: 'travel' as Tab, label: 'Getting there' }] : []),
    { value: 'reviews', label: `Reviews${reviews.length ? ` (${reviews.length})` : ''}` },
  ];
  const shown = tabs.some((t) => t.value === tab) ? tab : 'overview';

  const openNow = openState(v);
  /**
   * Everything the screen owes a credit to, as one line.
   *
   * A photograph's licence, the encyclopaedia the description came from, and
   * the provider whose rating and reviews are on screen — gathered rather than
   * printed three times in three places.
   */
  const credits = [...new Set([
    v?.attribution ?? item.attribution ?? null,
    crowd?.attribution ?? null,
  ].flatMap((a) => (a ? String(a).split(' · ') : [])))].join(' · ');
  /** "20 min drive" reads better than "20 min driving"; the sheet's own words. */
  const travelWord = 'drive';
  /**
   * The picture, for the hero.
   *
   * Ours first — an atlas image is served from our own origin and carries an
   * `lqip` so the frame has the photograph's colours before a byte of the real
   * one has arrived. A provider's is fetched at display time and never stored.
   */
  const hero = (() => {
    const owned = item.image;
    // A mark stretched across 220px is a smear; it has its own place below.
    if (owned && owned.source !== 'logo') return { uri: `${API_URL}/api/images/${owned.id}/960`, lqip: owned.lqip ?? null };
    /*
      The first photograph that will actually load, from either list.
      
      A rented reference needs its signature to get through the door, and the
      two lists do not always carry one — preferring whichever list happened to
      be longer put an unsigned reference in the hero and the picture 401'd,
      which on screen is a green rectangle with no explanation.
    */
    const usable = [...(item.photos ?? []), ...(venue?.photos ?? [])]
      .find((ph) => ph.url || (ph.ref && ph.sig && ph.exp));
    const uri = usable ? photoUri(usable) : null;
    return uri ? { uri, lqip: null } : null;
  })();
  /**
   * What is worth knowing before you set off, from what we actually hold.
   *
   * The handoff draws three rows here and fills them with copy it calls
   * placeholder — "Kids' menu", "Dog friendly", "Book ahead on weekends".
   * Those are claims about a business, and a claim we have not read anywhere
   * is one we must not make. So this is the facts on the record, and a place
   * with nothing to say gets no rows rather than three empty ones.
   */
  const highlights: { icon: IconName; title: string; sub: string | null }[] = [
    openNow ? { icon: 'hours' as IconName, title: openNow.state, sub: openNow.detail } : null,
    v?.goodForChildren ?? item.goodForChildren
      ? { icon: 'children' as IconName, title: 'Good for children', sub: null }
      : null,
    item.reservable ? { icon: 'calendar' as IconName, title: 'Takes bookings', sub: null } : null,
    price ? { icon: 'money' as IconName, title: price, sub: 'Typical spend, as the source bands it' } : null,
    item.dwellMinutes > 0 ? { icon: 'clock' as IconName, title: `Allow ${minutes(item.dwellMinutes)}`, sub: null } : null,
  ].filter(Boolean).slice(0, 3) as { icon: IconName; title: string; sub: string | null }[];

  const travelBits = [
    item.distanceKm != null ? `${item.distanceKm} km from ${baseLabel ?? 'base'}` : null,
    item.travelFromBaseMinutes != null ? `about ${item.travelFromBaseMinutes} min` : null,
    item.category !== 'event' && item.dwellMinutes > 0 ? `allow ${minutes(item.dwellMinutes)}` : null,
    item.startsAt ? clock(item.startsAt) : null,
  ].filter(Boolean);

  return (
    <>
    {ctl.staff ? <StaffSheet ctl={ctl} /> : null}
    <Modal visible transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={styles.backdropWrap}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.panel, wide ? styles.panelSide : styles.panelSheet, frameBox]}>

          {/*
            The head is fixed and short, so the tabs — and whichever one you
            came for — start above the fold (owner, 4 Sep 2026).

            The picture leads it (trips V2): the hero first with the way back
            and the two things you do to a place on it, then the name and what
            it is. A title above a photograph reads as a caption for the page;
            a photograph above a title reads as the place.
          */}
          <View style={styles.head}>
            {hero ? (
              <View style={styles.hero}>
                {hero.lqip ? <Image source={{ uri: hero.lqip }} style={StyleSheet.absoluteFill as any} resizeMode="cover" blurRadius={2} accessibilityIgnoresInvertColors /> : null}
                <Image source={{ uri: hero.uri }} style={StyleSheet.absoluteFill as any} resizeMode="cover" accessibilityIgnoresInvertColors />
                <Pressable onPress={onClose} style={[styles.heroTile, styles.heroBack]} accessibilityRole="button" accessibilityLabel="Back">
                  <Icon name="back" size={18} color={INK} />
                </Pressable>
                {/* Cream tiles rather than bare glyphs: a photograph can be any
                    colour, and these have to be legible on all of them. */}
                <View style={styles.heroTiles}>
                  <Pressable onPress={sharePlace} style={styles.heroTile} accessibilityRole="button" accessibilityLabel={`Share ${item.name}`}>
                    <Icon name={shared ? 'check' : 'upload'} size={18} color={INK} />
                  </Pressable>
                  {onShortlist ? (
                    <Pressable onPress={() => onShortlist(item)} style={[styles.heroTile, shortlisted && styles.heroTileOn]} accessibilityRole="button" accessibilityState={{ selected: !!shortlisted }} accessibilityLabel={shortlisted ? `Take ${item.name} off the shortlist` : `Save ${item.name}`}>
                      <Icon name="shortlist" size={18} color={INK} fill fillColor={shortlisted ? LIME : CREAM} strokeWidth={2} />
                    </Pressable>
                  ) : null}
                </View>
                {photos.length > 1 ? (
                  <View style={styles.heroCount}><Text style={styles.heroCountText}>{`1 / ${photos.length}`}</Text></View>
                ) : null}
              </View>
            ) : null}

            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name}>{title}</Text>
                {/* One line, in the handoff's own order: what it is, where, and
                    what stopping there costs the day. */}
                <Text style={styles.meta} numberOfLines={2}>
                  {[typeLine(item), price, item.travelFromBaseMinutes != null ? `+${item.travelFromBaseMinutes} min detour` : null]
                    .filter(Boolean).join(' · ')}
                </Text>
                {/* Their own page, named by its domain — for anywhere you might
                    have to ring, book or check before you set off. */}
                {(v?.website ?? item.website) ? (
                  <Pressable onPress={() => Linking.openURL((v?.website ?? item.website) as string)} style={styles.siteRow} accessibilityRole="link">
                    <Icon name="web" size={13} color={colors.accent} />
                    <Text style={styles.siteText} numberOfLines={1}>{hostOf((v?.website ?? item.website) as string)}</Text>
                  </Pressable>
                ) : null}
                {rating != null ? (
                  <View style={styles.ratingBit}>
                    <Icon name="favourite" size={14} color={colors.accent} fill />
                    <Text style={styles.ratingValue}>{rating.toFixed(1)}</Text>
                    {ratingCount ? <Text style={styles.reviewsText}>{`· ${ratingCount.toLocaleString()} reviews`}</Text> : null}
                  </View>
                ) : null}
                {openNow ? (
                  <IconText name={openNow.open === false ? 'full' : 'booked'} color={openNow.open === false ? colors.inkMuted : colors.accent}>
                    <Text style={{ fontWeight: '700', color: colors.ink }}>{openNow.state}</Text>{openNow.detail ? ` · ${openNow.detail}` : ''}
                  </IconText>
                ) : null}
              </View>
              {/* No × where the hero carries the way back; without a picture
                  there is nothing else to close on. */}
              {hero ? null : (
                <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close"><Icon name="close" size={22} color={colors.ink} /></Pressable>
              )}
            </Row>
            {/* A strip on the 2px ink rule, not a row of pills (Inspire rework,
                8f): the selected tab's underline sits *on* that rule, which is
                what makes the tabs part of the page rather than floating above
                it. Same device as Inspire's own category strip. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabStrip} style={styles.tabStripWrap}>
              {tabs.map((t) => (
                <Pressable key={t.value} onPress={() => setTab(t.value)} accessibilityRole="tab" accessibilityState={{ selected: t.value === shown }}>
                  <View style={[styles.tabItem, t.value === shown && styles.tabItemOn]}>
                    <Text style={[styles.tabText, { color: t.value === shown ? colors.ink : colors.inkMuted }]}>{t.label}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            {venue === undefined ? <Text style={type.tiny}>Fetching from {sourceName}…</Text> : null}
            {error ? <Text style={[type.tiny, { color: colors.dislike }]}>{error}</Text> : null}
          </View>

          {shown === 'menu' ? (
            <View style={{ flex: 1 }}><MenuPanel ctl={ctl} onOrder={() => setTab('order')} /></View>
          ) : shown === 'order' ? (
            <View style={{ flex: 1 }}><OrderPanel ctl={ctl} onMenu={() => setTab('menu')} /></View>
          ) : (
            <ScrollView contentContainerStyle={{ gap: spacing.md, padding: spacing.lg }}>

              {shown === 'overview' ? (
                <View style={{ gap: spacing.sm }}>
                  {/*
                    What this family made of the place, and only that (owner,
                    7 Sep 2026): "it's asking me to rate again on the overview…
                    I'm not sure why I need that… maybe the Been again goes in
                    the reviews section". So somewhere they have been opens with
                    their own stars, collapsed, and the ways of saying they have
                    been again live under Reviews with the rest of the record.
                    Somewhere they have not been keeps the invitation to say so.
                  */}
                  {been ? <FamilyVerdict visits={visits ?? []} members={ctl.members} /> : visits === undefined ? null : capture}

                  {/*
                    The three things worth knowing before you go (trips V2).
                    Facts, every one of them, off the record and the provider —
                    the handoff's own examples ("Kids' menu", "Book ahead on
                    weekends") are placeholders it admits to, and inventing
                    them here would be putting words in a business's mouth. A
                    place we know three things about gets three rows; a place
                    we know none about gets none, rather than three blanks.
                  */}
                  {highlights.length ? (
                    <View style={styles.highlights}>
                      {highlights.map((h) => (
                        <View key={h.title} style={styles.highlight}>
                          <View style={styles.highlightTile}><Icon name={h.icon} size={18} color={colors.ink} /></View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.highlightTitle}>{h.title}</Text>
                            {h.sub ? <Text style={styles.highlightSub}>{h.sub}</Text> : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {v?.summary ?? item.summary ? <Text style={type.body}>{v?.summary ?? item.summary}</Text> : null}
                  {item.reasons.length ? <Wrap>{item.reasons.filter((r) => r.kind !== 'chain').map((r, i) => <Chip key={i} label={r.text} tone={r.kind === 'dislike' || r.kind === 'diet' ? 'dislike' : r.kind === 'note' ? 'neutral' : 'like'} />)}</Wrap> : null}
                  {v?.address ?? item.address ? <IconText name="address">{v?.address ?? item.address}</IconText> : null}
                  {venue === null && !error ? (
                    ours0wn ? (
                      // An atlas place has no provider record to be missing. It
                      // was researched by us from Wikidata, Wikipedia and
                      // Wikimedia, and everything on this screen is that
                      // research — so saying "no signal" would be inventing a
                      // fault to explain the absence of something that was
                      // never going to be there.
                      <IconText name="owned" color={colors.inkMuted}>Epic&#39;s own record — open data we hold outright, so it reads the same with no signal.</IconText>
                    ) : (
                      <IconText name="offline" color={colors.inkMuted}>No signal — showing what is saved on this device.</IconText>
                    )
                  ) : null}
                  {item.venueName ? <IconText name="ticket">At {item.venueName}</IconText> : null}
                  {/* Good for children carries the children's menu with it, and a
                      restaurant serving some vegetarian food is every restaurant:
                      only a genuinely vegetarian place is worth a word (owner,
                      4 Sep 2026). */}
                  {(() => {
                    const cuisines = (v?.cuisines ?? item.cuisines ?? []).map((c) => c.toLowerCase());
                    const veggie = cuisines.some((c) => /vegetarian|vegan/.test(c));
                    const good = [(v?.goodForChildren ?? item.goodForChildren) ? 'children' : null, veggie ? 'vegetarians' : null].filter(Boolean);
                    if (good.length) return <IconText name="children">Good for {good.join(' and ')}</IconText>;
                    return (v?.goodForChildren ?? item.goodForChildren) === false ? <IconText name="children" color={colors.inkMuted}>Not noted as good for children</IconText> : null;
                  })()}
                  {item.reservable != null ? <IconText name="phone">{item.reservable ? 'Takes bookings' : 'Walk-in only'}</IconText> : null}
                  {item.justification ? <Text style={type.small}>"{item.justification}"</Text> : null}
                  <Wrap>
                    {website ? <Button label="Website" icon="external" kind="ghost" onPress={() => Linking.openURL(website)} /> : null}
                    {externalUrl && !mapsUrl ? <Button label={item.category === 'event' ? 'Tickets' : `On ${sourceName}`} kind="ghost" onPress={() => Linking.openURL(externalUrl)} /> : null}
                  </Wrap>

                  {/*
                    The facts grid (8f): two columns, ruled top, bottom and
                    between. Hours on the left, how long to allow on the right —
                    the two things you plan a day around, side by side rather
                    than a paragraph apart.
                  */}
                  <View style={styles.facts}>
                    <View style={styles.fact}>
                      <Text style={styles.factKicker}>Opening hours</Text>
                      {hours.length ? foldHours(hours).map((h, i) => <Text key={i} style={styles.factValue}>{h}</Text>)
                      : ownRecord?.openingHours ? (
                        <Text style={styles.factValue}>{ownRecord.openingHours}</Text>
                      ) : (
                        /* "Not available", never where we looked and failed to
                           find it (Inspire rework, 8f). Which source was asked
                           is our problem; the household only needs to know
                           whether they can plan around it. */
                        <Text style={styles.factValue}>{venue === undefined ? '' : 'Not available'}</Text>
                      )}
                    </View>
                    <View style={[styles.fact, styles.factDivider]}>
                      <Text style={styles.factKicker}>Time to allow</Text>
                      <Text style={styles.factValue}>
                        {item.dwellMinutes > 0 ? minutes(item.dwellMinutes) : 'Not available'}
                      </Text>
                    </View>
                  </View>

                  {/*
                    A business's own mark is not a photograph and is not the
                    hero: it is drawn at the size it was made, on its ground.
                    Everything else is already the full-bleed picture at the top
                    of the screen (8f), and drawing it twice was drawing it
                    twice.
                  */}
                  {item.image?.source === 'logo' ? (
                    <View style={{ gap: 4 }}>
                      <VenueThumb
                        name={title}
                        image={item.image}
                        category={item.category}
                        experiences={experiences}
                        width={140}
                        height={140}
                      />
                      <Text style={type.tiny}>Their own mark, from their website. Shown to identify them; the mark is theirs.</Text>
                    </View>
                  ) : null}

                  {photos.length ? (
                    <View style={{ gap: spacing.sm }}>
                      {photos.map((p, i) => <Hero key={i} uri={photoUri(p)} attribution={p.attribution ?? null} />)}
                    </View>
                  ) : null}


                </View>
              ) : null}

              {shown === 'travel' ? (
                <View style={{ gap: spacing.sm }}>
                  {v?.address ?? item.address ? <IconText name="address">{v?.address ?? item.address}</IconText> : null}
                  {travelBits.length ? <Text style={type.small}>{travelBits.join(' · ')}</Text> : null}
                  {gettingThere}
                  <Wrap>
                    {mapsUrl ? <Button label="Open in Google Maps" icon="map" kind="secondary" onPress={() => Linking.openURL(mapsUrl)} /> : null}
                  </Wrap>
                </View>
              ) : null}

              {shown === 'inside' ? <InsideList inside={inside} busy={insideBusy} full /> : null}

              {shown === 'reviews' ? (
                <View style={{ gap: spacing.sm }}>
                  {/* Ours first: what we ate and what we made of it, then the
                      strangers' (owner, 4 Sep 2026). Saying you have been again
                      is part of the record rather than something the overview
                      asks you for every time you open the place (owner, 7 Sep
                      2026). */}
                  {/* The verdict is the Overview's line and is not repeated
                      here: this tab is the detail behind it, and one screen
                      with two ways to open the same thing is one too many. */}
                  {been ? capture : null}
                  {eating ? <PastMeals ctl={ctl} onRate={() => setTab('order')} /> : null}
                  {ours}
                  {reviews.length ? <Text style={type.h3}>What other people say</Text> : null}
                  {reviews.map((r, i) => (
                    <View key={i} style={styles.review}>
                      <Row style={{ flexWrap: 'wrap', gap: spacing.sm }}>
                        {r.rating != null ? <Stars value={r.rating} size={14} /> : null}
                        <Text style={type.tiny}>{[
                          reviews.length > 1 && i === 0 ? 'best' : reviews.length > 1 && i === reviews.length - 1 ? 'most critical' : null,
                          r.author, r.when,
                        ].filter(Boolean).join(' · ')}</Text>
                      </Row>
                      <Text style={type.body}>{r.text}</Text>
                    </View>
                  ))}
                  {/* Plain words, not an account of which source was asked and
                      what it said (the rule that keeps 429s off a phone). Why
                      we have none is our problem; whether there are any is
                      theirs. */}
                  {venue !== undefined && !reviews.length ? <Text style={type.small}>No reviews yet.</Text> : null}
                  {reviews.length ? <Text style={type.tiny}>{v?.attribution ?? item.attribution ?? ''} · Up to five reviews are available through the API; the rest are on the source's own page.</Text> : null}
                </View>
              ) : null}

              {/* One line, at the very end, 12px grey 700 — not overlaid on the
                  picture and not repeated (8f). This is where a licence is
                  actually satisfied: beside the thing somebody is looking at. */}
              {credits ? <Text style={styles.credit}>{credits}</Text> : null}
            </ScrollView>
          )}

          {/* Pinned, so the one thing to do with a place does not scroll away
              from it. Ink on light, lime on dark — `primary` is already both. */}
          {onAdd && shown !== 'menu' && shown !== 'order' ? (
            <View style={styles.footer}>
              {/*
                Somewhere you eat gets the other thing you do with it beside
                the first (trips V2): a table is booked on the restaurant's own
                page, so this is their site rather than a booking of ours. Only
                where they have one — a button that cannot do what it says is
                worse than no button.
              */}
              {eating && (v?.website ?? item.website) ? (
                <Pressable
                  onPress={() => Linking.openURL((v?.website ?? item.website) as string)}
                  accessibilityRole="link"
                  style={styles.footerSecond}
                >
                  <Text style={styles.footerSecondText}>Book a table</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => onAdd(item)}
                disabled={added}
                accessibilityRole="button"
                style={[styles.footerBtn, added && { opacity: 0.5 }]}
              >
                <View style={styles.footerLabel}>
                  <Icon name={added ? 'keep' : addIcon ?? 'trips'} size={18} color={colors.primaryFg} fill={added} />
                  <Text style={styles.footerText}>{added ? 'In the plan' : addLabel ?? 'Create trip'}</Text>
                </View>
                {/* No arrow beside a second button: two arrows on one bar is
                    two things claiming to be the way on. */}
                {eating && (v?.website ?? item.website) ? null : <Icon name="forward" size={18} color={colors.primaryFg} />}
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // The place, as 8f/9f draws it.
  name: { fontFamily: fonts.heading, fontSize: 32, fontWeight: '800', letterSpacing: -0.96, lineHeight: 34, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.inkMuted },
  ratingBit: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingValue: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: colors.accent },
  // Full-bleed: the head's gutter is given back on both sides.
  // 300 rather than 220 (trips V2): the picture is the first thing the full
  // view is for, and at 220 it read as a banner over a page of text.
  hero: { height: 300, marginHorizontal: -spacing.lg, marginTop: spacing.md, backgroundColor: colors.accentSoft, overflow: 'hidden' },
  heroTiles: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', gap: 8 },
  heroBack: { position: 'absolute', top: 12, left: 12 },
  // Saved says so on the tile itself, not only in the glyph.
  heroTileOn: { backgroundColor: LIME },
  highlights: { gap: 2 },
  highlight: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  // An outline, not a fill: three lime squares down the page would read as
  // three things that had been chosen.
  highlightTile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.lineSoft },
  highlightTitle: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  highlightSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted, marginTop: 1 },
  // Equal width beside the primary, outlined rather than filled: it is the
  // other thing you might do, not the thing we are recommending.
  footerSecond: {
    flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: TARGET,
    borderWidth: BORDER, borderColor: colors.line, paddingVertical: 14,
  },
  footerSecondText: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  siteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 24 },
  siteText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.accent, flexShrink: 1 },
  reviewsText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.accent },
  // CREAM rather than the palette's surface, on purpose: a photograph is a
  // photograph in either theme, and a tile that turns near-black in the dark
  // disappears into half the pictures it sits on.
  heroTile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: CREAM },
  heroCount: { position: 'absolute', right: 12, bottom: 12, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: CREAM },
  heroCountText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: INK },
  // Two columns, ruled top and bottom and between — the handoff's facts grid.
  facts: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.lineSoft, marginTop: spacing.sm },
  fact: { flex: 1, paddingVertical: spacing.md, paddingRight: spacing.md, gap: 4 },
  factDivider: { borderLeftWidth: 1, borderLeftColor: colors.lineSoft, paddingLeft: spacing.md },
  factKicker: { fontFamily: fonts.body, fontSize: 11, fontWeight: '600', letterSpacing: 0.88, textTransform: 'uppercase', color: colors.inkMuted },
  factValue: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  // One line, at the very end of the scroll, in grey 700 — grey 500 fails here.
  credit: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted, marginTop: spacing.xl },
  // Pinned: the action does not scroll away from the thing it acts on.
  footer: {
    flexDirection: 'row', alignItems: 'stretch', gap: 10,
    borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingHorizontal: spacing.lg, paddingTop: 12,
    paddingBottom: (Platform.OS === 'web' ? 'calc(16px + var(--epic-sab))' : 24) as any,
    backgroundColor: colors.bg,
  },
  footerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.primary, paddingHorizontal: 20, minHeight: 56,
  },
  footerLabel: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerText: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.primaryFg },

  backdropWrap: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(29,27,22,0.35)' },
  panel: { backgroundColor: colors.bg },
  // No rule of its own: the tab strip inside it carries the one ink rule that
  // closes the head, and two would read as a boxed-in title.
  head: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 0, gap: spacing.sm },
  panelSide: { width: 460, maxWidth: '100%', height: '100%', borderLeftWidth: BORDER, borderLeftColor: colors.line },
  /**
   * A full-height sheet starts at the very top of the screen, and the app draws
   * under the status bar — so without this the title ran through the clock and
   * the close button sat on the battery (owner, 7 Sep 2026, and quite right:
   * it is the rule the rest of the app keeps). A Modal portals out of the tree,
   * so it cannot inherit the frame's inset and has to take its own.
   */
  panelSheet: {
    width: '100%', height: '100%',
    paddingTop: (Platform.OS === 'web' ? 'var(--epic-sat)' : 0) as any,
  },
  tabStripWrap: { borderBottomWidth: BORDER, borderBottomColor: colors.ink, marginHorizontal: -spacing.lg, paddingHorizontal: spacing.lg },
  tabStrip: { gap: 18, paddingTop: 4 },
  tabItem: { paddingVertical: 6, borderBottomWidth: BORDER, borderBottomColor: 'transparent', marginBottom: -BORDER },
  tabItemOn: { borderBottomColor: colors.ink },
  tabText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600' },
  close: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  review: { gap: 2, paddingTop: spacing.sm, borderTopWidth: BORDER, borderTopColor: colors.line },
});
