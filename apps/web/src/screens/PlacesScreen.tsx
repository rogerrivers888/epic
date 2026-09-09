import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../components/press';
import { useViewport } from '../hooks/useViewport';
import { Icon, iconFor } from '../components/Icon';
import { api, AtlasCity, AtlasCountry, AtlasHome, AtlasPlace, BrowseItem, HouseholdResponse, TripBrief, Venue, Visit } from '../api';
import { VenueDrawer } from '../components/VenueDrawer';
import { VenueThumb } from '../components/VenueThumb';
import { Flag } from '../components/Flag';
import { Wordmark } from '../components/Wordmark';
import type { TripSeed } from './TripsScreen';
import { asOneOf, asText, useQueryState, useRouter, useStickyQuery } from '../router';
import { MOODS, paths, type Route } from '../routes';
import { colors, fonts, radius, spacing, TARGET, type, BORDER } from '../theme';
import { Button, Card, Chip, Row, StatusLine, Wrap } from '../components/ui';
import { SourcePicker } from '../components/SourcePicker';
import { BeenCapture, VenueRow, VisitForm, VisitSummary, rowsForVisit } from '../components/Visits';
import { getViewer, onViewerChange } from '../viewer';
import { isAdmin } from '../admin';
import { CategoryStrip, PairSwitch, TOP_INSET } from '../components/InspireHeader';
import { ControlButton, ControlRow, CrumbHead, Popover, PopoverGroup, PopoverList, type PopoverOption } from '../components/ControlRow';
import { Crowd, MEDIA_RADIUS } from '../components/InspireBody';
import { EMPTY_LIST, LIST_KEYS, LISTS, PLACE_SORTS, PLACE_SORT_KEYS, epicRating, foodType, inList, sortPlaces, whenLabel, type ListKey, type PlaceSort } from './placesRows';

// Trips still imports these from here.
export { VenueRow, VisitForm, VisitSummary } from '../components/Visits';
export type { VisitCreateBody } from '../components/Visits';

/**
 * Places — rebuilt as a hierarchy (handover v8, 8 Sep 2026, §3).
 *
 * The root is one flat list under a lime band: Near home, the country you
 * live in, and each country you have visited. A country opens to its towns
 * and cities; a town, or Near home, opens to the place list — Activities |
 * Food & drink over a lime band of Been · Loved · Shortlisted, a plain-text
 * control row of Type · Mood · Sort, and rows that carry the household's own
 * mark in a column of its own: the Epic rating.
 *
 * Everything the household says about a place is still in the drawer (owner,
 * 4 Sep 2026): whether they have been, who loved it, the menu, the order,
 * getting there. The row is for finding it.
 */

/** The picture square at the head of a place row: "64px 10px-radius thumbnail". */
const WELL = 64;
/** "…or a 40px outlined type glyph when there is no photo." */
const GLYPH_WELL = 40;
/** The flat flag on a country row: "36×24". */
const FLAG_W = 36;
const FLAG_H = 24;
const GUTTER = 20;

/**
 * An area's lists: something to do, somewhere to eat — and, only where the
 * household has kept somewhere to sleep, somewhere to stay. The handover draws
 * the first two; the third is kept for the areas that have one, because a
 * hotel saved on a trip must not become unreachable.
 */
type Kind = 'do' | 'eat' | 'stay';

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).replace(/-/g, ' ');
/** "Feb 2024" — as precise as a row has room to be. */
const fmtMonth = (iso?: string | null) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString([], { month: 'short', year: 'numeric' }) : null);

// Transport for London's own colours for its lines: the line's identity, not a UI code.
const LINE_COLOURS: Record<string, string> = {
  Bakerloo: '#B36305', Central: '#E32017', Circle: '#FFD300', District: '#00782A', 'Hammersmith & City': '#F3A9BB', Jubilee: '#A0A5A9',
  Metropolitan: '#9B0056', Northern: '#000000', Piccadilly: '#003688', Victoria: '#0098D4', 'Waterloo & City': '#95CDBA', 'Elizabeth line': '#6950A1',
  DLR: '#00A4A7', 'London Overground': '#EE7C0E', Liberty: '#5D6061', Lioness: '#FAA61A', Mildmay: '#0077AD', Suffragette: '#5BBD72', Weaver: '#823A62', Windrush: '#ED1B00', Tram: '#84B817',
};

// `takeaway` is one of these (5 Sep 2026). It has to be, or a chip shop shows
// up under Things to do — being told apart from a restaurant is not the same as
// not being somewhere to eat.
const EATING = ['restaurant', 'cafe', 'pub', 'bar', 'takeaway', 'bakery'];
const SLEEPING = ['hotel', 'lodging'];

/** Which segment a place will show up under, from its category alone. */
const kindOfCategory = (c?: string | null): Kind => (SLEEPING.includes(String(c)) ? 'stay' : EATING.includes(String(c)) ? 'eat' : 'do');

const experiencesOf = (p: AtlasPlace) => (((p.venue ?? {}) as Partial<Venue>).experiences ?? []).filter(Boolean);

/**
 * Which of the lists a place belongs to. A pub is somewhere you drink, so it
 * is Food & drink; a pub with a kitchen is also a thing to do on a Sunday, so
 * it is both.
 */
function kindsOf(p: AtlasPlace): Kind[] {
  const c = p.category ?? '';
  if (SLEEPING.includes(c) || (p.kind as string) === 'stay') return ['stay'];
  if (c === 'restaurant' || c === 'cafe' || c === 'takeaway' || c === 'bakery') return ['eat'];
  if (c === 'pub' || c === 'bar') return experiencesOf(p).length ? ['eat', 'do'] : ['eat'];
  if (!c && p.kind === 'food') return ['eat'];
  return ['do'];
}

/**
 * The kind of thing it is, in the words the Type dropdown uses, for the list
 * being looked at: the drawer it is filed in ("Theme parks & rides", "Castles")
 * — the answer to the question a row is actually asking (owner, 7 Sep 2026) —
 * then whatever the map tagged it, then the cabinet's own name. Food & drink
 * has its own one word (placesRows.ts).
 */
function typeOf(p: AtlasPlace, kind: Kind): string {
  const c = p.category ?? '';
  if (kind === 'stay') {
    const experiences = experiencesOf(p);
    if (experiences.length) return cap(experiences[0]);
    return c === 'lodging' ? 'Places to stay' : 'Hotels';
  }
  if (kind === 'eat') return foodType(p);
  if (c === 'pub' || c === 'bar') return 'Pubs & bars';
  if (c === 'event') return 'Events';
  if (p.subcategoryLabel) return p.subcategoryLabel;
  const experiences = experiencesOf(p);
  if (experiences.length) return cap(experiences[0]);
  if (p.categoryLabel) return p.categoryLabel;
  return c === 'attraction' ? 'Attractions' : 'Other';
}

/** The household's mark on a place, on this device: the chosen viewer's, else the average. */
const myScore = (p: AtlasPlace, viewer: string | null) => {
  if (viewer) return p.scores.find((s) => s.memberId === viewer)?.score ?? null;
  if (!p.scores.length) return null;
  return Math.round((p.scores.reduce((n, s) => n + s.score, 0) / p.scores.length) * 10) / 10;
};

function atlasToVenue(p: AtlasPlace): Venue {
  const [source, ...rest] = p.venueRef.split(':');
  const v = (p.venue ?? {}) as Partial<Venue>;
  return {
    venueRef: p.venueRef, source, sourcePlaceId: rest.join(':'), name: p.name, category: p.category ?? v.category ?? 'attraction',
    cuisines: v.cuisines ?? [], experiences: v.experiences ?? [], allergens: [], dietaryOptions: v.dietaryOptions,
    priceLevel: null, rating: null, goodForChildren: null, lat: p.lat ?? 0, lng: p.lng ?? 0, dishes: [],
    website: v.website ?? null, openingHours: v.openingHours ?? null, address: (v.address as any)?.line1 ?? null, attribution: '© OpenStreetMap contributors',
    household: { visits: p.visits, lastOn: p.lastOn ?? undefined, loved: p.loved, notForMe: p.notForMe, ledger: p.ledger ?? undefined },
  };
}

function venueToBrowseItem(v: Venue): BrowseItem {
  const [source] = v.venueRef.split(':');
  return {
    id: v.venueRef, venueRef: v.venueRef, name: v.name, category: v.category, lat: v.lat, lng: v.lng,
    dwellMinutes: 0, reasons: [], justification: null, startsAt: null, endsAt: null, pinned: false, source,
    cuisines: v.cuisines ?? [], experiences: v.experiences ?? [], address: typeof v.address === 'string' ? v.address : null,
    website: v.website ?? null, openingHours: v.openingHours ?? null,
  };
}

function atlasToBrowseItem(p: AtlasPlace): BrowseItem {
  const v = (p.venue ?? {}) as Partial<Venue>;
  const [source] = p.venueRef.split(':');
  return {
    id: p.venueRef, venueRef: p.venueRef, name: p.name, category: p.category ?? v.category ?? 'attraction', lat: p.lat ?? 0, lng: p.lng ?? 0,
    dwellMinutes: 0, reasons: [], justification: null, startsAt: null, endsAt: null, pinned: false, source,
    cuisines: v.cuisines ?? [], experiences: v.experiences ?? [], address: (v.address as any)?.line1 ?? (typeof v.address === 'string' ? v.address : null), website: v.website ?? null, openingHours: v.openingHours ?? null,
  };
}

/** Inside a list: how it is set. All of it is in the address. */
const CITY_KEYS = ['kind', 'list', 'type', 'mood', 'sort'];
/** The old `status=` addresses still land where they meant to. */
const LEGACY_STATUS: Record<string, ListKey> = { been: 'been', loved: 'loved', special: 'loved', saved: 'short', any: 'been' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export function PlacesScreen({ route, household, refreshHousehold }: {
  /**
   * Which layer the address asks for: the root (`/places`), everything close
   * to home (`/places/home`), one country's towns (`/places/IT`) or one town's
   * places (`/places/GB/London`).
   */
  route: Extract<Route, { name: 'places' }>;
  household: HouseholdResponse | null; refreshHousehold: () => Promise<void>; onPlanTrip?: (p: TripSeed) => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { query, navigate, setQuery } = useRouter();
  const [data, setData] = useState<{ countries: AtlasCountry[]; unplaced: number; home: AtlasHome | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which layer the path asks for.
  const sel = route.scope;
  const atHome = !!sel && 'home' in sel;
  const country = sel && !atHome ? (sel as { country: string; city: string | null }) : null;
  const inArea = atHome || !!country?.city;
  const [places, setPlaces] = useState<AtlasPlace[]>([]);
  const [wherePending, setWherePending] = useState(0);
  // Which place's drawer is open, over whichever layer is showing.
  const openRef = query.get('place');
  const open = openRef ? places.find((p) => p.venueRef === openRef) ?? null : null;
  const setOpen = (p: AtlasPlace | null) => setQuery({ place: p?.venueRef ?? null }, { replace: false });
  // A place found by searching, before it is anything of ours: the drawer shows
  // its details so you can be sure it is the right one.
  const [newVenue, setNewVenue] = useState<Venue | null>(null);
  // A place the household has just added: close the search, show the list it
  // is in, and mark the row (owner, 4 Sep 2026).
  const [landed, setLanded] = useState<{ venueRef: string; kind: Kind } | null>(null);
  /** How tall the head is, so a panel can hang off the bottom of it. */
  const [headH, setHeadH] = useState(0);
  /** Which panel is open over the list, and whether the add-a-place search is. Reset on every move. */
  const [menu, setMenu] = useState<ListMenu>(null);
  const [adding, setAdding] = useState(false);
  const areaName = atHome ? 'home' : country?.city ? `${country.country}.${country.city}` : null;
  useEffect(() => { setMenu(null); setAdding(false); }, [areaName]);
  // How this list was last set, per area: coming back to London should not
  // bring Lisbon's "food only, shortlisted" with it — and the address wins.
  useStickyQuery(areaName ? `places.city.${areaName}` : 'places.root', areaName ? CITY_KEYS : []);

  const refills = useRef(0);

  const members = household?.members ?? [];
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => { setViewer(getViewer(members)); return onViewerChange(setViewer); }, [members.map((m) => m.id).join(',')]);

  const loadAtlas = useCallback(async () => { try { setData(await api.atlas()); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { loadAtlas(); }, [loadAtlas]);

  const countryRow = country ? data?.countries.find((c) => c.code === country.country) ?? null : null;
  const city = countryRow && country?.city ? countryRow.cities.find((c) => c.name === country.city) ?? null : null;
  const home = atHome ? data?.home ?? null : null;

  const loadPlaces = useCallback(async () => {
    if (!inArea || !sel) { setPlaces([]); setWherePending(0); return; }
    try {
      const r = 'home' in sel ? await api.atlasPlaces({ nearHome: true }) : await api.atlasPlaces({ country: sel.country, city: sel.city! });
      setPlaces(r.places); setWherePending(r.wherePending ?? 0);
    } catch (e: any) { setError(e.message); }
  }, [inArea, atHome ? 'home' : country?.country, atHome ? '' : country?.city]);
  useEffect(() => { refills.current = 0; loadPlaces(); }, [loadPlaces]);
  // Postcode, station, pictures and ratings are looked up in the background
  // after the first read; ask again a few times while any row is waiting.
  useEffect(() => {
    if (!wherePending || refills.current >= 6) return;
    const t = setTimeout(() => { refills.current += 1; loadPlaces(); }, 5000);
    return () => clearTimeout(t);
  }, [wherePending, places]);

  const refreshAll = async () => { await loadAtlas(); await loadPlaces(); await refreshHousehold(); };
  const st = useListState(places, viewer);
  const ui = { menu, setMenu, adding, setAdding };

  const homeTown = data?.home?.label ? shortTown(data.home.label) : null;
  const homeCode = data?.home?.countryCode ?? null;

  /** The crumb at every level below the root: back arrow · title · subtitle. */
  const crumb = !sel ? null
    : atHome ? { title: 'Near home', sub: data?.home ? plural(data.home.places, 'place') : null, back: paths.places() }
      : country && !country.city ? {
        title: countryRow?.name ?? country.country,
        sub: countryRow ? (countryRow.code === homeCode ? `${countryRow.cities.length} towns and cities` : plural(countryRow.cities.length, 'city', 'cities')) : null,
        back: paths.places(),
      }
        : { title: country!.city!, sub: countryRow?.name ?? country!.country, back: paths.placesCountry(country!.country) };

  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" stickyHeaderIndices={[0]}>
        {/* One tree, whichever layer the address asks for, so the Web / Mobile
            toggle does not throw the screen's state away (CLAUDE.md). The head
            is lime at the root only; below it the ground is cream, so the lime
            switch inside a list keeps its selected state. */}
        <View style={[styles.head, !sel && styles.headLime]} onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
          <View style={styles.top}>
            <Wordmark height={30} ground={!sel ? colors.lime : colors.bg} />
          </View>
          {!sel ? (
            <View style={styles.rootTitle}>
              <Text style={styles.rootTitleText}>Places</Text>
              <Text style={styles.rootSub}>Everywhere you've been, loved and shortlisted</Text>
            </View>
          ) : crumb ? (
            <View style={styles.crumbWrap}>
              <CrumbHead size={24} onBack={() => navigate(crumb.back)} title={crumb.title} sub={crumb.sub} />
            </View>
          ) : null}
          {inArea && (city || home) ? <ListHead st={st} ui={ui} onLandedShown={() => setLanded(null)} /> : null}
        </View>

        {!sel ? (
          <AtlasRoot data={data} error={error} homeTown={homeTown} onGo={(href) => navigate(href)} />
        ) : null}

        {country && !country.city ? (
          <CountryCities row={countryRow} data={data} onCity={(name) => navigate(paths.placesCity(country.country, name))} />
        ) : null}

        {inArea && (city || home) ? (
          <ListBody
            st={st} ui={ui} places={places} viewer={viewer}
            country={countryRow} city={city} homeArea={home} household={household}
            onOpen={setOpen} onOpenVenue={setNewVenue} openRef={open?.venueRef ?? null}
            landed={landed} onLandedShown={() => setLanded(null)}
            onChanged={refreshAll}
          />
        ) : null}

        {sel && !inArea && !countryRow && data ? (
          <View style={styles.body}><StatusLine tone="warn">Nothing in your atlas for {country?.country} yet.</StatusLine></View>
        ) : null}
      </ScrollView>

      {inArea && (city || home) ? <ListMenus st={st} ui={ui} top={headH} /> : null}

      <VenueDrawer
        item={newVenue ? venueToBrowseItem(newVenue) : open ? atlasToBrowseItem(open) : null}
        baseLabel={city?.name ?? (home ? 'home' : null)}
        onClose={() => { setOpen(null); setNewVenue(null); }}
        onVenue={async (v) => { if (open?.unnamed && v.name) { try { await api.nameAtlasPlace(open.venueRef, v.name); await loadPlaces(); } catch { /* the drawer still shows the fetched name */ } } }}
        capture={(() => {
          const v = newVenue ?? (open ? atlasToVenue(open) : null);
          if (!v) return null;
          const w = countryRow && city ? { country: countryRow.name, countryCode: countryRow.code, locality: city.name } : {};
          const known = newVenue ? !!newVenue.household?.visits || !!newVenue.household?.ledger : !!open;
          return <CapturePanel venue={v} household={household} ctx={w} been={!!(newVenue ? newVenue.household?.visits : open?.visits)} saved={known} onChanged={refreshAll}
            onLanded={(venueRef, kind) => setLanded({ venueRef, kind })} />;
        })()}
        ours={newVenue
          ? <NewPlacePanel venue={newVenue} household={household} ctx={countryRow && city ? { country: countryRow.name, countryCode: countryRow.code, locality: city.name } : {}} onChanged={refreshAll} />
          : open ? <OursPanel place={open} household={household} ctx={countryRow && city ? { country: countryRow.name, countryCode: countryRow.code, locality: city.name } : {}} viewer={viewer} onChanged={refreshAll} onRemoved={() => setOpen(null)} /> : null}
        gettingThere={open ? <GettingThere place={open} /> : null}
      />
    </View>
  );
}

/** "Sunningdale" out of "Fairways, Titlarks Hill, Sunningdale, SL5 0JD". */
function shortTown(label: string): string {
  const parts = label.split(',').map((p) => p.trim()).filter((p) => p && !/\d/.test(p));
  return parts[parts.length - 1] ?? label.split(',')[0].trim();
}

// ---------------------------------------------------------------------------
// The root: near home, the country you live in, and every country visited
// ---------------------------------------------------------------------------

/**
 * "Title 'Places / Everywhere you've been, loved and shortlisted', then one
 * flat scrolling list: Near home — lime 36px tile with a home glyph; United
 * Kingdom — flag, three example cities, count; each country visited — flag,
 * its cities, count. There is no 'Abroad' step."
 */
function AtlasRoot({ data, error, homeTown, onGo }: {
  data: { countries: AtlasCountry[]; unplaced: number; home: AtlasHome | null } | null;
  error: string | null; homeTown: string | null; onGo: (href: string) => void;
}) {
  const homeCode = data?.home?.countryCode ?? null;
  const countries = data?.countries ?? [];
  const homeCountry = homeCode ? countries.find((c) => c.code === homeCode) ?? null : null;
  const others = countries.filter((c) => c.code !== homeCode).sort((a, b) => a.name.localeCompare(b.name));
  const citiesOf = (c: AtlasCountry) => [...c.cities].sort((a, b) => b.places - a.places).slice(0, 3).map((ci) => ci.name).join(' · ');
  return (
    <View style={styles.list}>
      {error ? <View style={styles.gutter}><StatusLine tone="warn">{error}</StatusLine></View> : null}
      {!data ? <Text style={[type.small, styles.gutter, { paddingTop: spacing.md }]}>Loading your atlas…</Text> : null}
      {data && !countries.length && !data.home?.places ? (
        <View style={styles.emptyRoot}>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptyBody}>Heart a place on Inspire or on a trip, or say you have been somewhere, and it lands here under where it is.</Text>
        </View>
      ) : null}
      {data?.home ? (
        <NavRow
          tile={<View style={styles.homeTile}><Icon name="home" size={19} color={colors.selectedFg} strokeWidth={2.1} /></View>}
          label="Near home"
          sub={`${homeTown ?? 'Home'} · within ${data.home.radiusMiles} miles`}
          count={plural(data.home.places, 'place')}
          onPress={() => onGo(paths.placesHome())}
        />
      ) : null}
      {homeCountry ? (
        <NavRow
          tile={<Flag code={homeCountry.code} width={FLAG_W} height={FLAG_H} bare />}
          label={homeCountry.name}
          sub={citiesOf(homeCountry) || 'No places yet'}
          count={plural(homeCountry.places, 'place')}
          onPress={() => onGo(paths.placesCountry(homeCountry.code))}
        />
      ) : null}
      {others.map((c) => (
        <NavRow
          key={c.code}
          tile={<Flag code={c.code} width={FLAG_W} height={FLAG_H} bare />}
          label={c.name}
          sub={citiesOf(c) || 'No places yet'}
          count={plural(c.places, 'place')}
          onPress={() => onGo(paths.placesCountry(c.code))}
        />
      ))}
      {data?.unplaced ? <Text style={[type.tiny, styles.gutter, { paddingTop: spacing.md }]}>{data.unplaced} place{data.unplaced === 1 ? '' : 's'} still being placed on the map.</Text> : null}
    </View>
  );
}

/** One country's towns and cities. */
function CountryCities({ row, data, onCity }: {
  row: AtlasCountry | null; data: { home: AtlasHome | null } | null; onCity: (name: string) => void;
}) {
  const cities = [...(row?.cities ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  if (!row) return data ? <View style={styles.emptyRoot}><Text style={styles.emptyBody}>Nothing in your atlas here yet.</Text></View> : null;
  return (
    <View style={styles.list}>
      {cities.map((ci) => (
        <NavRow
          key={ci.name}
          tile={<Flag code={row.code} width={FLAG_W} height={FLAG_H} bare />}
          label={ci.name}
          sub={ci.nextTrip ? `Next: ${tripWhen(ci.nextTrip)}` : ci.lastTrip ? `Last: ${tripWhen(ci.lastTrip)}` : row.name}
          count={plural(ci.places, 'place')}
          onPress={() => onCity(ci.name)}
        />
      ))}
      {!cities.length ? <View style={styles.emptyRoot}><Text style={styles.emptyBody}>No towns in {row.name} yet.</Text></View> : null}
    </View>
  );
}

/** A row of the hierarchy: tile, label 19/800, sub 13 grey, count 13 grey, chevron. */
function NavRow({ tile, label, sub, count, onPress }: { tile: React.ReactNode; label: string; sub: string; count: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={styles.navRow} accessibilityRole="button" accessibilityLabel={`${label}, ${count}`}>
      <View style={styles.navTile}>{tile}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={styles.navLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.navSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Text style={styles.navCount}>{count}</Text>
      <Icon name="more" size={18} color={colors.ink} strokeWidth={2.2} />
    </Press>
  );
}

/**
 * "Puglia · Aug 2025", and never "Bath · Sep 2026 · Sept 2026": a trip's own
 * name often has the month in it already, and saying it twice reads as a bug.
 */
function tripWhen(t: TripBrief): string {
  const name = (t.label ?? '').split(/\s+[·,]\s+|,\s+then\s+/)[0].trim() || 'A trip';
  if (!t.on) return name;
  const [mon, year] = t.on.split(' ');
  const said = name.toLowerCase();
  return said.includes(mon.slice(0, 3).toLowerCase()) && said.includes(year) ? name : `${name} · ${t.on}`;
}

// ---------------------------------------------------------------------------
// Inside a town, or near home: the place list
// ---------------------------------------------------------------------------

type ListMenu = null | 'type' | 'mood' | 'sort';
type ListUi = { menu: ListMenu; setMenu: (m: ListMenu) => void; adding: boolean; setAdding: (v: boolean) => void };

/**
 * How the list is set, from the address, and everything counted from it. One
 * hook, held by the screen, because the head (sticky, inside the scroll), the
 * rows and the panels (anchored, outside it) are three parts of one list and
 * their counts must not drift apart.
 */
function useListState(places: AtlasPlace[], viewer: string | null) {
  const { query, setQuery } = useRouter();
  const [kind, setKind] = useQueryState<Kind>('kind', 'do', asOneOf(['do', 'eat', 'stay'] as const, 'do'));
  /**
   * The band: Been · Loved · Shortlisted. Been is where the list opens — it
   * includes loved, so it is rarely empty — and only where nothing has been
   * visited yet does an *unasked* list step down to Shortlisted, so a new
   * household does not open on "Nothing here yet". The moment the address
   * says a list, the address wins.
   */
  const [list, setList] = useQueryState<ListKey>('list', 'been', asOneOf(LIST_KEYS, 'been'));
  const [typeF, setTypeF] = useQueryState<string | null>('type', null, asText);
  const [moodF, setMoodF] = useQueryState<string | null>('mood', null, asText);
  const [sort, setSort] = useQueryState<PlaceSort>('sort', 'recent', asOneOf(PLACE_SORT_KEYS, 'recent'));
  // An older address said `status=`; it still means what it meant.
  useEffect(() => {
    const legacy = query.get('status');
    if (legacy && !query.get('list')) setQuery({ list: LEGACY_STATUS[legacy] ?? null, status: null }, { replace: true });
  }, []);

  const counts = useMemo(() => ({
    do: places.filter((p) => kindsOf(p).includes('do')).length,
    eat: places.filter((p) => kindsOf(p).includes('eat')).length,
    stay: places.filter((p) => kindsOf(p).includes('stay')).length,
  }), [places]);
  const hasStay = counts.stay > 0;
  const shown: Kind = kind === 'stay' && !hasStay ? 'do' : kind;
  const inKind = useCallback((p: AtlasPlace) => kindsOf(p).includes(shown), [shown]);
  const onTab = useMemo(() => places.filter(inKind), [places, inKind]);

  const listCounts = useMemo(() => ({
    been: onTab.filter((p) => inList(p, 'been')).length,
    loved: onTab.filter((p) => inList(p, 'loved')).length,
    short: onTab.filter((p) => inList(p, 'short')).length,
  }), [onTab]);
  const asked = query.get('list') != null;
  const showing: ListKey = asked ? list : listCounts.been ? 'been' : listCounts.short ? 'short' : 'been';
  const inShowing = useMemo(() => onTab.filter((p) => inList(p, showing)), [onTab, showing]);

  const moodShown = shown === 'do';
  const matchesMood = (p: AtlasPlace) => !moodShown || !moodF || (p.moods ?? []).includes(moodF as any);
  const matchesType = (p: AtlasPlace) => !typeF || typeOf(p, shown) === typeF;

  const typeCounts = new Map<string, number>();
  inShowing.filter(matchesMood).forEach((p) => { const t = typeOf(p, shown); typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1); });
  const typeOptions: PopoverOption[] = [
    { key: '', label: 'All', count: inShowing.filter(matchesMood).length, on: !typeF },
    ...[...typeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) => ({ key: t, label: t, count: n, on: typeF === t })),
  ];
  const moodCounts = new Map<string, number>();
  inShowing.filter(matchesType).forEach((p) => (p.moods ?? []).forEach((m) => moodCounts.set(m, (moodCounts.get(m) ?? 0) + 1)));
  const moodOptions: PopoverOption[] = [
    { key: '', label: 'Any', count: inShowing.filter(matchesType).length, on: !moodF },
    ...MOODS.filter((m) => moodCounts.has(m)).map((m) => ({ key: m, label: cap(m), count: moodCounts.get(m)!, on: moodF === m })),
  ];
  const sortOptions: PopoverOption[] = PLACE_SORTS.map((s) => ({ key: s.key, label: s.label, on: sort === s.key }));

  const rows = useMemo(
    () => sortPlaces(inShowing.filter((p) => matchesType(p) && matchesMood(p)), sort, viewer),
    [inShowing, typeF, moodF, moodShown, sort, viewer, shown],
  );

  return {
    kind, shown, hasStay, counts, setKind, list: showing, setList, listCounts, inShowing,
    typeF, setTypeF, moodF, setMoodF, moodShown, sort, setSort,
    typeOptions, moodOptions, sortOptions, rows,
  };
}
type ListState = ReturnType<typeof useListState>;

/** Inside the head: the switch, the band, and the control row. */
function ListHead({ st, ui, onLandedShown }: { st: ListState; ui: ListUi; onLandedShown: () => void }) {
  const close = () => ui.setMenu(null);
  const toggle = (m: Exclude<ListMenu, null>) => () => ui.setMenu(ui.menu === m ? null : m);
  const typeLabel = st.typeF ?? (st.shown === 'eat' ? 'Cuisine' : 'Type');
  const moodLabel = st.moodF ? cap(st.moodF) : 'Mood';
  const sortLabel = `Sort: ${PLACE_SORTS.find((s) => s.key === st.sort)?.label ?? 'Most recent'}`;
  return (
    <View style={styles.chrome}>
      <PairSwitch
        value={st.shown}
        options={[
          { value: 'do' as Kind, label: 'Activities' },
          { value: 'eat' as Kind, label: 'Food & drink' },
          // Only where the household has kept somewhere to sleep: a hotel
          // saved on a trip must not become unreachable.
          ...(st.hasStay ? [{ value: 'stay' as Kind, label: 'Stays' }] : []),
        ]}
        onPick={(k) => { st.setKind(k); st.setTypeF(null); if (k !== 'do') st.setMoodF(null); close(); onLandedShown(); }}
      />
      <CategoryStrip
        light
        items={LISTS.map((l) => ({ key: l.key, label: `${l.label} · ${st.listCounts[l.key]}` }))}
        value={st.list}
        onPick={(k) => { st.setList(k as ListKey); st.setTypeF(null); close(); onLandedShown(); }}
      />
      <ControlRow
        left={<ControlButton label={typeLabel} set={!!st.typeF} open={ui.menu === 'type'} onPress={toggle('type')} />}
        centre={st.moodShown ? <ControlButton label={moodLabel} set={!!st.moodF} open={ui.menu === 'mood'} onPress={toggle('mood')} /> : null}
        right={<ControlButton label={sortLabel} set={st.sort !== 'recent'} open={ui.menu === 'sort'} onPress={toggle('sort')} />}
      />
    </View>
  );
}

/** The panels, anchored under the head. */
function ListMenus({ st, ui, top }: { st: ListState; ui: ListUi; top: number }) {
  const close = () => ui.setMenu(null);
  return (
    <>
      <Popover open={ui.menu === 'type'} top={top} onClose={close} align="left">
        <PopoverGroup title={st.shown === 'eat' ? 'Cuisine' : st.shown === 'stay' ? 'Kind of stay' : 'Type'}>
          {st.typeOptions.length > 1
            ? <PopoverList options={st.typeOptions} onPick={(k) => { st.setTypeF(k || null); close(); }} />
            : <Text style={styles.panelNote}>{st.inShowing.length ? 'Nothing here has said what kind of thing it is yet.' : 'Nothing on this list yet, so there is nothing to narrow.'}</Text>}
        </PopoverGroup>
      </Popover>
      <Popover open={ui.menu === 'mood' && st.moodShown} top={top} onClose={close} align="centre">
        <PopoverGroup title="Mood">
          {st.moodOptions.length > 1
            ? <PopoverList options={st.moodOptions} onPick={(k) => { st.setMoodF(k || null); close(); }} />
            : <Text style={styles.panelNote}>Nothing here has been given a mood yet.</Text>}
        </PopoverGroup>
      </Popover>
      <Popover open={ui.menu === 'sort'} top={top} onClose={close} align="right">
        <PopoverGroup title="Sort by">
          <PopoverList options={st.sortOptions} onPick={(k) => { st.setSort(k as PlaceSort); close(); }} />
        </PopoverGroup>
      </Popover>
    </>
  );
}

/** The rows, or the add-a-place search in their place. */
function ListBody({ st, ui, places, viewer, country, city, homeArea, household, onOpen, onOpenVenue, openRef, onChanged, landed, onLandedShown }: {
  st: ListState; ui: ListUi; places: AtlasPlace[]; viewer: string | null;
  country: AtlasCountry | null; city: AtlasCity | null; homeArea: AtlasHome | null; household: HouseholdResponse | null;
  onOpen: (p: AtlasPlace) => void; onOpenVenue: (v: Venue) => void; openRef: string | null; onChanged: () => Promise<void>;
  landed: { venueRef: string; kind: Kind } | null; onLandedShown: () => void;
}) {
  const home = !!homeArea;
  // Something just added: the search closes, the tab follows the place, and
  // the row is marked so the eye finds it.
  useEffect(() => {
    if (!landed) return;
    ui.setAdding(false); ui.setMenu(null);
    st.setKind(landed.kind);
    const p = places.find((x) => x.venueRef === landed.venueRef);
    if (p) st.setList(inList(p, 'loved') ? 'loved' : inList(p, 'been') ? 'been' : 'short');
    st.setTypeF(null); st.setMoodF(null);
  }, [landed?.venueRef]);

  const centre = homeArea ? { lat: homeArea.lat, lng: homeArea.lng } : city?.lat != null && city?.lng != null ? { lat: city.lat, lng: city.lng } : null;
  const searchRadiusKm = homeArea ? Math.round(homeArea.radiusMiles * 1.60934) : 5;
  const ctx = homeArea || !country || !city ? {} : { country: country.name, countryCode: country.code, locality: city.name };
  const title = home ? 'near home' : city?.name ?? 'here';
  const kindLabel = st.shown === 'eat' ? 'food & drink' : st.shown === 'stay' ? 'stays' : 'activities';

  return (
    <View style={styles.listBody}>
      <View style={styles.addRow}>
        <Press onPress={() => { ui.setAdding(!ui.adding); ui.setMenu(null); }} style={styles.addBtn} accessibilityRole="button" accessibilityLabel={ui.adding ? 'Close the search' : 'Add a place'}>
          <Icon name={ui.adding ? 'close' : 'add'} size={15} color={colors.ink} strokeWidth={2.2} />
          <Text style={styles.addText}>{ui.adding ? 'Close' : 'Add a place'}</Text>
        </Press>
      </View>
      {ui.adding ? (
        <View style={styles.gutter}>
          <AddPlace household={household} kind={st.shown} centre={centre} radiusKm={searchRadiusKm} ctx={ctx} wide={false} onAdded={onChanged} onOpen={onOpenVenue} />
        </View>
      ) : (
        <>
          {st.rows.length ? (
            <View>
              {st.rows.map((p) => (
                <PlaceRow
                  key={p.venueRef} place={p} kind={st.shown} viewer={viewer}
                  selected={openRef === p.venueRef || landed?.venueRef === p.venueRef}
                  onPress={() => { onLandedShown(); onOpen(p); }}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyList}>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyBody}>
                {!places.length ? `Nothing ${title} yet. Add a place you know, or heart one on Inspire or a trip.`
                  : st.typeF || st.moodF ? 'Nothing matches — clear a filter.'
                    : `${EMPTY_LIST[st.list]}${st.list === 'been' && st.listCounts.short ? ` ${st.listCounts.short} shortlisted so far.` : ''}`}
              </Text>
              {st.typeF || st.moodF ? (
                <Press onPress={() => { st.setTypeF(null); st.setMoodF(null); }} accessibilityRole="button" style={styles.emptyAction}>
                  <Text style={styles.emptyActionText}>Clear filters</Text>
                </Press>
              ) : null}
            </View>
          )}
          {landed && st.rows.some((p) => p.venueRef === landed.venueRef) ? (
            <View style={styles.gutter}><StatusLine tone="good">{st.rows.find((p) => p.venueRef === landed.venueRef)?.name} is in your places.</StatusLine></View>
          ) : null}
          {st.rows.length ? <Text style={[type.tiny, styles.gutter, { paddingTop: spacing.sm }]}>{st.rows.length} of {st.inShowing.length} {kindLabel} · tap a row for the drawer.</Text> : null}
        </>
      )}
    </View>
  );
}

/**
 * One place, one row (handover v8): a 64px thumbnail or a 40px outlined type
 * glyph; the name; "Pub · Sunningdale"; ★ rating (count) and the date; and,
 * in a column of its own, the Epic rating — the household's own mark, over
 * the crowd's, which stays on the meta line. Rows with no Epic rating leave
 * the column empty.
 */
function PlaceRow({ place, kind, viewer, selected, onPress }: { place: AtlasPlace; kind: Kind; viewer: string | null; selected: boolean; onPress: () => void }) {
  const ours = epicRating(place, viewer);
  const what = typeOf(place, kind);
  const meta = [what, place.locality].filter(Boolean).join(' · ');
  const when = whenLabel(place.lastOn);
  const hasPicture = Boolean(place.image) || Boolean(place.photos?.length);
  return (
    <Press onPress={onPress} style={[styles.prow, selected && styles.rowOn]} accessibilityRole="button" accessibilityLabel={place.name}>
      {hasPicture ? (
        <VenueThumb
          name={place.name} image={place.image} photos={place.photos} category={place.category}
          experiences={(place.venue as Partial<Venue> | null)?.experiences ?? []}
          width={WELL} height={WELL} rounded={MEDIA_RADIUS - 2} credit={false}
        />
      ) : (
        <View style={styles.glyphWell}>
          <View style={styles.glyph}>
            <Icon name={iconFor({ category: place.category, experiences: (place.venue as Partial<Venue> | null)?.experiences ?? [] })} size={20} color={colors.ink} strokeWidth={2} />
          </View>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={[styles.prowName, place.unnamed && { fontStyle: 'italic', color: colors.inkMuted }]} numberOfLines={1}>{place.unnamed ? 'Unnamed place — open for its name' : place.name}</Text>
        {meta ? <Text style={styles.prowMeta} numberOfLines={1}>{meta}</Text> : null}
        <View style={styles.prowLine}>
          {place.rating != null ? <Crowd rating={place.rating} count={place.ratingCount} size={12} brief /> : null}
          {when ? <Text style={[styles.prowMeta, place.rating != null && { marginLeft: 6 }]}>{when}</Text> : null}
        </View>
      </View>
      {ours ? (
        <View style={styles.ours} accessibilityLabel={`Epic rating ${ours.score}, ${ours.by}`}>
          <Text style={styles.oursCaption}>Epic rating</Text>
          <View style={styles.oursBlock}>
            <Icon name="favourite" size={13} color={colors.selectedFg} fill />
            <Text style={styles.oursScore}>{ours.score.toFixed(1)}</Text>
          </View>
          <Text style={styles.oursBy} numberOfLines={1}>{ours.by}</Text>
        </View>
      ) : <View style={styles.oursBlank} />}
    </Press>
  );
}

/**
 * How you get to it, in the drawer (owner, 4 Sep 2026: "we could actually show
 * what line it's on or more information on getting there on the side drawer").
 */
function GettingThere({ place }: { place: AtlasPlace }) {
  const lines = (place.stationLines ?? []).filter(Boolean);
  if (!place.station && !place.postcode) return null;
  const walk = place.stationDistanceM != null ? Math.max(1, Math.round(place.stationDistanceM / 80)) : null;
  const what = place.stationKind === 'tube' ? 'Nearest Underground station'
    : place.stationKind === 'elizabeth-line' ? 'Nearest Elizabeth line station'
    : place.stationKind === 'dlr' ? 'Nearest DLR station'
    : place.stationKind === 'overground' ? 'Nearest Overground station'
    : place.stationKind === 'tram' ? 'Nearest tram stop'
    : place.stationKind === 'metro' ? 'Nearest metro station'
    : 'Nearest station';
  return (
    <View style={styles.getting}>
      <Text style={type.h3}>Getting there</Text>
      {place.station ? (
        <>
          <Text style={type.tiny}>{what}</Text>
          <Text style={type.body}>
            {place.station}
            {walk ? <Text style={type.small}>{`  ${walk} min walk`}</Text> : null}
          </Text>
          {lines.length ? (
            <Wrap>
              {lines.map((l) => (
                <View key={l} style={styles.line}>
                  <View style={[styles.dot, { backgroundColor: LINE_COLOURS[l] ?? colors.inkMuted }]} />
                  <Text style={styles.lineText}>{l}</Text>
                </View>
              ))}
            </Wrap>
          ) : null}
        </>
      ) : null}
      {place.postcode ? <Text style={type.small}>Postcode {place.postcode}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Our side of a place, at the top of the drawer
// ---------------------------------------------------------------------------

/**
 * The one question, at the top of the drawer: did everyone love it. It saves on
 * the tap and then says so; the household's fuller record — history, loved,
 * removing it — is under Ours (owner, 4 Sep 2026).
 */
function CapturePanel({ venue, household, ctx: where, been, saved, onChanged, onLanded }: {
  venue: Venue; household: HouseholdResponse | null; ctx: { country?: string; countryCode?: string; locality?: string }; been: boolean; saved: boolean; onChanged: () => Promise<void>;
  /** It is in the list now: close up and show it there. */
  onLanded: (venueRef: string, kind: Kind) => void;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctx = { label: venue.name, category: venue.category, lat: venue.lat ?? undefined, lng: venue.lng ?? undefined, venue, ...where };
  if (!household) return null;
  // Saying we have been here saves the place as well; there is no second step
  // (owner, 4 Sep 2026: "if I click 'We've been here', it's going to also save it").
  const here = been || done === 'been';
  const kept = saved || done !== null;
  return (
    <View style={styles.capturePanel}>
      {here || kept ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Icon name="booked" size={17} />
          <Text style={[type.h3, { flexShrink: 1 }]}>{here ? 'In your places — you have been here' : 'Saved to your places'}</Text>
        </Row>
      ) : (
        <Text style={type.h3}>Have you been?</Text>
      )}
      {!open ? (
        <Row style={{ flexWrap: 'wrap' }}>
          <Button label={here ? 'Been again' : "We've been here"} kind={here ? 'secondary' : 'primary'} onPress={() => setOpen(true)} />
          {!kept ? <Button label="Save as a place" kind="secondary" loading={busy} onPress={async () => { setBusy(true); try { await api.savePlace(venue.venueRef, 'saved', ctx); setDone('saved'); await onChanged(); onLanded(venue.venueRef, kindOfCategory(venue.category)); } finally { setBusy(false); } }} /> : null}
        </Row>
      ) : (
        <>
          <BeenCapture venue={venue} household={household}
            onCreate={async (body) => { await api.createVisit({ venueRef: venue.venueRef, venueLabel: venue.name, category: venue.category, lat: venue.lat, lng: venue.lng, visitedOn: body.visitedOn, note: body.note, attendeeIds: body.attendeeIds, takes: body.takes, venue: { experiences: venue.experiences, cuisines: venue.cuisines, category: venue.category }, ...where }); }}
            onSaved={async () => { setOpen(false); setDone('been'); await onChanged(); onLanded(venue.venueRef, kindOfCategory(venue.category)); }} />
          <Button label="Close" icon="close" kind="ghost" onPress={() => setOpen(false)} style={{ alignSelf: 'flex-start' }} />
        </>
      )}
    </View>
  );
}

function NewPlacePanel({ venue, household, ctx: where, onChanged }: {
  venue: Venue; household: HouseholdResponse | null; ctx: { country?: string; countryCode?: string; locality?: string }; onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ctx = { label: venue.name, category: venue.category, lat: venue.lat ?? undefined, lng: venue.lng ?? undefined, venue, ...where };

  return (
    <View style={styles.ours2}>
      <Row style={{ flexWrap: 'wrap' }}>
        <Text style={type.h3}>Ours</Text>
        <Chip label="Not in your places yet" />
      </Row>
      <Wrap>
        <Button label="Save to try" kind="secondary" onPress={async () => { await api.savePlace(venue.venueRef, 'saved', ctx); setMsg(`Saved ${venue.name} to try.`); await onChanged(); }} />
      </Wrap>
      {msg ? <StatusLine tone="good">{msg}</StatusLine> : null}
      {adding && household ? (
        <BeenCapture venue={venue} household={household}
          onCreate={async (body) => { await api.createVisit({ venueRef: venue.venueRef, venueLabel: venue.name, category: venue.category, lat: venue.lat, lng: venue.lng, visitedOn: body.visitedOn, note: body.note, attendeeIds: body.attendeeIds, takes: body.takes, venue: { experiences: venue.experiences, cuisines: venue.cuisines, category: venue.category }, ...where }); }}
          onSaved={async () => { setAdding(false); setMsg(`Added ${venue.name} — thank you.`); await onChanged(); }} />
      ) : null}
      <Text style={type.tiny}>Rate the dishes on the Order tab when you have the menu.</Text>
    </View>
  );
}

function OursPanel({ place, household, ctx: where, viewer, onChanged, onRemoved }: { place: AtlasPlace; household: HouseholdResponse | null; ctx: { country?: string; countryCode?: string; locality?: string }; viewer: string | null; onChanged: () => Promise<void>; onRemoved: () => void }) {
  const [detail, setDetail] = useState<{ visits: Visit[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Visit | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const ctx = { label: place.name, category: place.category, lat: place.lat ?? undefined, lng: place.lng ?? undefined, ...where };
  const venue = atlasToVenue(place);
  void myScore(place, viewer);

  const load = useCallback(async () => {
    try { const d = await api.place(place.venueRef); setDetail({ visits: d.visits }); } catch { setDetail({ visits: [] }); }
  }, [place.venueRef]);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.ours2}>
      <Row style={{ flexWrap: 'wrap' }}>
        <Text style={type.h3}>Ours</Text>
        {place.visits ? <Chip label={`Been ${place.visits}×${place.lastOn ? ` · last ${fmtMonth(place.lastOn)}` : ''}`} /> : <Chip label="Shortlisted" />}
        {place.special ? <Chip label="Loved" icon="keep" iconFill /> : null}
      </Row>
      {/* Where this place came from — here, where there is room for all of it,
          rather than on the row (owner, 7 Sep 2026). */}
      {place.onTrips?.length ? (
        <Text style={type.small}>
          {place.visits ? 'Been here on ' : 'Kept for '}
          {[...new Set(place.onTrips.map((t) => tripWhen({ id: t.id, label: t.title, startsOn: null, endsOn: null, on: t.on })))].join(' · ')}
        </Text>
      ) : null}
      <Wrap>
        <Button label={adding ? 'Close' : 'Record a past visit'} icon={adding ? 'close' : undefined} kind="ghost" onPress={() => { setEditing(null); setDetailed(true); setAdding((a) => !a); }} />
        {!place.visits && place.ledger !== 'saved' && !place.special ? <Button label="Save to try" kind="secondary" onPress={async () => { await api.savePlace(place.venueRef, 'saved', ctx); setMsg('Saved to try.'); await onChanged(); }} /> : null}
        {place.visits > 0 && !place.special ? <Button label="We loved it" icon="keep" kind="secondary" onPress={async () => { await api.savePlace(place.venueRef, 'special', ctx); setMsg('Loved — the planner will go further for it.'); await onChanged(); }} /> : null}
      </Wrap>
      {!place.visits && !place.special ? <Text style={type.tiny}>Loved comes after you've been. Record the visit and it appears here.</Text> : null}
      {msg ? <StatusLine tone="good">{msg}</StatusLine> : null}
      {adding && household ? (
        detailed ? (
          <VisitForm venue={venue} household={household} onDone={async () => { setAdding(false); setDetailed(false); await load(); await onChanged(); }} onCancel={() => setDetailed(false)}
            createVia={async (body) => { await api.createVisit({ venueRef: place.venueRef, venueLabel: place.name, category: venue.category, lat: venue.lat, lng: venue.lng, visitedOn: body.visitedOn, note: body.note, attendeeIds: body.attendeeIds, takes: body.takes, venue: body.venue, ...where }); }} />
        ) : (
          <BeenCapture venue={venue} household={household} onMore={() => setDetailed(true)}
            onCreate={async (body) => { await api.createVisit({ venueRef: place.venueRef, venueLabel: place.name, category: venue.category, lat: venue.lat, lng: venue.lng, visitedOn: body.visitedOn, note: body.note, attendeeIds: body.attendeeIds, takes: body.takes, venue: { experiences: venue.experiences, cuisines: venue.cuisines, category: venue.category }, ...where }); }}
            onSaved={async () => { setAdding(false); setMsg('Saved — thank you.'); await load(); await onChanged(); }} />
        )
      ) : null}
      {editing && household ? (
        <VisitForm venue={venue} household={household} onDone={async () => { setEditing(null); await load(); await onChanged(); }} onCancel={() => setEditing(null)}
          initial={{ visitId: editing.id, date: editing.visitedOn, note: editing.note ?? '', rows: rowsForVisit(editing, household.members), attending: (editing.attendees as any[]).map((a) => (typeof a === 'string' ? household.members.find((m) => m.name === a)?.id ?? '' : a.id)).filter(Boolean) }} />
      ) : null}
      {place.note ? <Text style={type.small}>Our note: “{place.note}”</Text> : null}
      {/* Curating means being able to take something out again (owner, 4 Sep 2026). */}
      {place.visits ? null : (
        <Row style={{ flexWrap: 'wrap' }}>
          <Button
            label={confirmRemove ? 'Tap again to remove' : 'Remove from Places'}
            icon={confirmRemove ? 'allergen' : 'close'}
            kind={confirmRemove ? 'danger' : 'ghost'}
            onPress={async () => {
              if (!confirmRemove) { setConfirmRemove(true); return; }
              try { await api.deleteAtlasPlace(place.venueRef); onRemoved(); await onChanged(); }
              catch (e: any) { setMsg(e.message); setConfirmRemove(false); }
            }}
          />
          {confirmRemove ? <Button label="Keep it" kind="ghost" onPress={() => setConfirmRemove(false)} /> : null}
        </Row>
      )}
      {detail?.visits.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={type.h3}>Our history here</Text>
          {detail.visits.map((v) => <VisitSummary key={v.id} visit={v} />)}
        </View>
      ) : detail ? <Text style={type.small}>No visit recorded here yet.</Text> : <Text style={type.tiny}>Loading our history…</Text>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Add a place you already know, by name, near somewhere in the city
// ---------------------------------------------------------------------------

/**
 * Add a place: a search box, and that is all (owner, 4 Sep 2026 — "I'm already
 * in London. I don't need to see any of that stuff… I have my search box.
 * That's it"). The switch above chooses what kind of place; the city, or the
 * radius from home, is where it looks.
 */
function AddPlace({ household, kind, centre, radiusKm, ctx, wide, onAdded, onOpen }: {
  household: HouseholdResponse | null; kind: Kind; centre: { lat: number; lng: number } | null; radiusKm: number;
  ctx: { country?: string; countryCode?: string; locality?: string }; wide: boolean; onAdded: () => Promise<void>;
  /** Open the place in the drawer, where its details, menu and order live. */
  onOpen: (v: Venue) => void;
}) {
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState<{ placeId: string | null; venueRef: string; name: string; where: string | null; kind: string | null; mine: boolean }[]>([]);
  const [sources, setSources] = useState<string[] | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Venue[] | null>(null);
  const [rating, setRating] = useState<Venue | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const admin = wide && isAdmin();
  // One session of typing is one billable session at the provider.
  const session = useRef(uuid());
  const typing = useRef<any>(null);
  // Choosing a prediction puts its name in the box; that must not ask for predictions again.
  const justChose = useRef(false);

  useEffect(() => {
    const text = q.trim();
    if (typing.current) clearTimeout(typing.current);
    if (justChose.current) { justChose.current = false; return; }
    if (text.length < 2) { setSuggestions([]); return; }
    typing.current = setTimeout(async () => {
      try {
        const r = await api.suggestPlaces({ q: text, near: centre ? `${centre.lat},${centre.lng}` : undefined, radiusKm: Math.max(radiusKm, 15), session: session.current, kind });
        setSuggestions(r.suggestions.slice(0, 8));
      } catch { /* the Search button still works */ }
    }, 250);
    return () => { if (typing.current) clearTimeout(typing.current); };
  }, [q, centre?.lat, centre?.lng, kind]);

  const choose = async (venueRef: string, name: string) => {
    justChose.current = true;
    setSuggestions([]); setQ(name); setBusy(true); setMsg(null);
    session.current = uuid();
    try {
      const d = await api.place(venueRef);
      if (d.venue) onOpen({ ...d.venue, household: d.household } as Venue);
      else setMsg("Couldn't open that one.");
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  const search = async () => {
    if (!centre) { setMsg('Nowhere to look from yet — set your home address in Settings.'); return; }
    setSuggestions([]); setBusy(true); setMsg(null);
    try {
      const r = await api.searchPlaces({
        near: `${centre.lat},${centre.lng}`, categories: kind === 'do' ? 'things' : kind === 'eat' ? 'food' : undefined,
        q: q.trim() || undefined, radiusKm, sources: sources?.join(',') || undefined,
      });
      setRes(r.results);
      if (!r.results.length) setMsg('Nothing found nearby. Try the name of the place.');
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  const save = async (v: Venue, status: 'saved' | 'special' = 'saved') => {
    await api.savePlace(v.venueRef, status, { label: v.name, venue: v, category: v.category, lat: v.lat, lng: v.lng, ...ctx });
    setMsg(`Saved ${v.name} to try.`);
    await onAdded();
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.searchRow}>
        <TextInput
          value={q} onChangeText={setQ} autoFocus placeholder="Search for a place" placeholderTextColor={colors.inkFaint}
          style={[styles.input, { flex: 1 }]} onSubmitEditing={search} returnKeyType="search" accessibilityLabel="Search for a place"
        />
        <Button label="Search" icon="search" onPress={search} loading={busy} />
      </View>
      {suggestions.length ? (
        <View style={styles.suggestList}>
          {suggestions.map((sg, i) => (
            <Press key={sg.venueRef} onPress={() => choose(sg.venueRef, sg.name)} style={[styles.suggestRow, i > 0 && styles.rowLine]} accessibilityRole="button">
              <View style={{ width: 22, alignItems: 'center' }}><Icon name={sg.mine ? 'places' : 'address'} size={16} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={type.h3} numberOfLines={1}>{sg.name}</Text>
                {sg.kind || sg.where ? <Text style={type.tiny} numberOfLines={1}>{[sg.kind, sg.where].filter(Boolean).join(' · ')}</Text> : null}
              </View>
            </Press>
          ))}
        </View>
      ) : null}
      {admin ? (
        <Row>
          <Chip label={sources?.length ? `Sources · ${sources.length}` : 'Sources'} selected={!!sources?.length} onPress={() => setShowSources((v) => !v)} />
        </Row>
      ) : null}
      {admin && showSources ? <Card><SourcePicker value={sources} onChange={setSources} /></Card> : null}
      {msg ? <StatusLine tone={msg.startsWith('Added') || msg.startsWith('Saved') ? 'good' : 'warn'}>{msg}</StatusLine> : null}
      {rating && household ? (
        <VisitForm venue={rating} household={household} onDone={async () => { setRating(null); setMsg(`Added ${rating.name} as somewhere you've been.`); await onAdded(); }} onCancel={() => setRating(null)}
          createVia={async (body) => { await api.createVisit({ venueRef: rating.venueRef, venueLabel: rating.name, category: rating.category, lat: rating.lat, lng: rating.lng, visitedOn: body.visitedOn, note: body.note, attendeeIds: body.attendeeIds, takes: body.takes, venue: body.venue, ...ctx }); }} />
      ) : null}
      {res?.slice(0, 40).map((v) => (
        <VenueRow key={v.venueRef} venue={v} stack={!wide} onPress={() => onOpen(v)} action={
          <Row>
            <Button label="Been" kind="secondary" onPress={() => setRating(v)} />
            <Button label="To try" kind="ghost" onPress={() => save(v)} />
          </Row>
        } />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  page: { paddingBottom: spacing.xxl },
  gutter: { paddingHorizontal: GUTTER },
  // The head: the mark, the title or the crumb, and — inside a list — the
  // switch, the band and the control row. Lime at the root only.
  head: { backgroundColor: colors.bg, paddingBottom: 4 },
  headLime: { backgroundColor: colors.lime, paddingBottom: 16 },
  top: { paddingHorizontal: GUTTER, paddingTop: TOP_INSET, minHeight: 40, justifyContent: 'center' },
  rootTitle: { paddingHorizontal: GUTTER, paddingTop: 18, gap: 2 },
  rootTitleText: { fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.78, lineHeight: 28, color: colors.selectedFg },
  rootSub: { fontFamily: fonts.body, fontSize: 13, color: colors.selectedFg },
  crumbWrap: { paddingTop: 14 },
  chrome: { marginTop: 14 },

  list: { paddingTop: 4 },
  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, marginHorizontal: GUTTER, minHeight: TARGET,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  navTile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  homeTile: { width: 36, height: 36, backgroundColor: colors.selected, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontFamily: fonts.heading, fontSize: 19, fontWeight: '800', letterSpacing: -0.38, color: colors.ink },
  navSub: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },
  navCount: { fontFamily: fonts.body, fontSize: 13, color: colors.inkMuted },

  listBody: { paddingTop: 4 },
  addRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: GUTTER },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingVertical: 4 },
  addText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.ink },
  prow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, marginHorizontal: GUTTER, minHeight: TARGET,
    borderBottomWidth: 1, borderBottomColor: colors.lineSoft,
  },
  rowOn: { backgroundColor: colors.accentSoft },
  rowLine: { borderTopWidth: BORDER, borderTopColor: colors.line },
  glyphWell: { width: WELL, height: WELL, alignItems: 'center', justifyContent: 'center' },
  glyph: { width: GLYPH_WELL, height: GLYPH_WELL, borderWidth: 1, borderColor: colors.lineSoft, alignItems: 'center', justifyContent: 'center' },
  prowName: { fontFamily: fonts.body, fontSize: 15, fontWeight: '600', color: colors.ink },
  prowMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  prowLine: { flexDirection: 'row', alignItems: 'center', minHeight: 17 },
  ours: { alignItems: 'center', gap: 2, minWidth: 78, flexShrink: 0 },
  oursCaption: { fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.inkMuted },
  oursBlock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.selected, paddingVertical: 4, paddingHorizontal: 9 },
  oursScore: { fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', letterSpacing: -0.3, color: colors.selectedFg },
  oursBy: { fontFamily: fonts.body, fontSize: 11, color: colors.inkMuted },
  oursBlank: { width: 24 },

  emptyRoot: { paddingHorizontal: GUTTER, paddingVertical: 28, gap: 8 },
  emptyList: { paddingHorizontal: GUTTER, paddingVertical: 28, gap: 8 },
  emptyTitle: { fontFamily: fonts.body, fontSize: 16, fontWeight: '600', color: colors.ink },
  emptyBody: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.inkMuted },
  emptyAction: { minHeight: TARGET - 8, justifyContent: 'center', alignSelf: 'flex-start' },
  emptyActionText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.accent },
  panelNote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkMuted, paddingHorizontal: 12, paddingBottom: 12 },

  body: { paddingHorizontal: GUTTER, paddingBottom: spacing.lg, gap: spacing.md },
  suggestList: { backgroundColor: colors.surface, borderWidth: BORDER, borderColor: colors.line, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, paddingHorizontal: spacing.md, minHeight: TARGET },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  getting: { gap: 4, paddingTop: spacing.sm, borderTopWidth: BORDER, borderTopColor: colors.line },
  // A ring the type colour, so the Northern line's black reads on the dark ground and the Circle line's yellow on the light one.
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: BORDER, borderColor: colors.inkMuted },
  line: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 9, borderRadius: radius.pill, borderWidth: BORDER, borderColor: colors.line },
  lineText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  capturePanel: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.panel },
  ours2: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: BORDER, borderColor: colors.line },
  input: {
    minHeight: TARGET, paddingHorizontal: spacing.md, borderRadius: radius.md,
    borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink,
  },
});
