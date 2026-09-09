import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { Press } from '../components/press';
import { api, BrowseItem, HouseholdResponse, InspireItem, InspireNear, MoodKey, OwnedImage, Place, VenuePhotoRef, Intake } from '../api';
import { useHere } from '../hooks/useHere';
import { colors, fonts, spacing, TARGET, type } from '../theme';
import { Icon } from '../components/Icon';
import { AskRow, IntakeStrip } from '../components/voice/IntakeStrip';
/** A spoken mood → the shelf it leads with (the same words the API's VIBE_TO_CATEGORY uses). */
const VIBE_MOOD: Record<string, string> = { fun: 'fun', cultural: 'culture', active: 'activity', relaxed: 'relaxing' };
import { VenueDrawer } from '../components/VenueDrawer';
import { WhereSearch } from '../components/WhereSearch';
import { PlacePicker } from '../components/PlacePicker';
import { useViewport } from '../hooks/useViewport';
import { asList, asNumber, asOneOf, useQueryState, useRouter, useStickyQuery } from '../router';
import { paths, withQuery, ACTIVITY_CATEGORIES, FOOD_CATEGORIES, type Route } from '../routes';
import { CategoryStrip, InspireTop, MenuBar, ModeSwitch } from '../components/InspireHeader';
import { BoxRow, ControlButton, ControlRow, CrumbHead, Popover, PopoverFooter, PopoverGroup, PopoverList, type PopoverOption } from '../components/ControlRow';
import { CardWide, Carousel, EmptyMatch, FoodRow, SubRow, TRAVEL } from '../components/InspireBody';
import { TRAVEL_MODES, type TravelMode } from '../components/TravelSheet';
import { activeCount, howFarShort, keeps, sortItems, HOW_FAR, PRICE_BANDS, PRICE_KEYS, RATING_FLOORS, SORTS, SORT_KEYS, type Filters, type InspireSort } from './inspireList';
import type { OpenTripOptions } from './PlanScreen';

/**
 * Inspire — the home screen (handover v8, 8 Sep 2026, §2; owner, 5 Sep 2026,
 * "Supporting docs/Roam Inspire").
 *
 * Epic opens on what there is to do, not on a form. The head says where you
 * are looking, which half of the app you are in and which category; under it
 * is one plain-text control row — Where · Filters · Sort — and everything
 * below is drawn from one retrieved pool.
 *
 * Three rules this screen is built to:
 *
 *  - **One pool.** `/api/inspire/near` makes one place search and hands back
 *    every venue once, each already carrying the moods it belongs to, the
 *    journey to it and how long this household would stay. Every control on
 *    this screen is composed from that array in memory (screens/inspireList.ts).
 *    Tapping Culture, narrowing to an hour or picking a price band never asks
 *    a provider anything (Requirements: options come from one pool).
 *  - **A control opens a panel under the row it belongs to**, anchored, with a
 *    transparent scrim behind it, and the list it is changing stays in view.
 *  - **Nothing here is written down.** The answer carries a provider's names,
 *    photos and ratings, which are rented, so `/api/inspire/near` is absent
 *    from `offline/policy.ts` and never reaches IndexedDB. What is remembered
 *    between visits is what the household *chose* — where they were looking
 *    and how they had it filtered — which is theirs.
 */

/**
 * How many of a shelf go across before "All 41" is the way to the rest — and,
 * because the screen only asks Google about what it is actually drawing, how
 * many places each shelf costs a lookup for. The two must be the same number:
 * asking about six and drawing twelve is what left half the squares without a
 * star (owner, 8 Sep 2026: "I want to see it on every single square").
 */
const ACROSS = 12;
/** What `/api/places/ratings` will answer about at once. */
const BATCH = 24;
/** The How far the screen opens on. */
const HOW_FAR_DEFAULT = 60;

const MOOD_LABEL: Record<string, string> = {
  fun: 'Fun', food: 'Food', culture: 'Culture',
  // Sport is the ticket and the membership; Active is what you turn up and do
  // (owner, 5 Sep 2026). The key is `activity` because the atlas already has a
  // category called `active` that means something else.
  sport: 'Sport', activity: 'Active',
  adrenaline: 'Adrenaline', relaxing: 'Relaxing', outdoors: 'Outdoors',
};

/** Where a drawer says "it depends", the place's own words decide whether it keeps the rain off, or suits children. */
const INDOOR_WORDS = /\b(museum|gallery|galleries|cinema|bowling|arcade|soft play|play ?centre|trampoline|climbing|bouldering|swimming|pool|leisure centre|aquarium|theatre|library|escape room|ice rink|skating|laser|indoor|shopping|market hall|cathedral|abbey|church|castle|palace|house|hall)\b/i;
const OUTDOOR_WORDS = /\b(garden|arboretum|park|common|woodland|forest|beach|coast|lake|river|reservoir|hill|moor|peak|trail|walk|nature reserve|viewpoint|lido|farm|zoo|safari|racecourse|golf|outdoor|meadow|heath)\b/i;
const KIDS_WORDS = /\b(kids?|children|family|soft play|play|trampoline|zoo|farm|aquarium|adventure|theme park|bowling|cinema|swimming|lido|safari|dinosaur|lego|animal|wildlife|climbing|ice rink)\b/i;

type Menu = null | 'where' | 'filters' | 'sort';

/**
 * What this tab remembers between visits when the address itself is silent.
 *
 * `place` and `within` are absent because a drawer and a sub-category are not a
 * way of being set, they are something open on one page.
 *
 * `by` — how you are travelling — is absent for a harder-won reason. It is the
 * one setting that can empty the screen on its own: an hour's walk holds four
 * places around Sunningdale where an hour's drive holds a hundred and seventy
 * two, and Thorpe Park is twenty minutes away by car and nearly two hours on
 * foot. Remembering a tap somebody made once, forever, meant opening the app
 * days later to a screen with almost nothing on it and no clue why (owner,
 * 7 Sep 2026: "where have all these activities gone?"). It still follows you
 * around while you are here — it is in the address — it just does not outlive
 * the visit. When Settings grows the handoff's "Default travel mode" that is
 * where a standing choice belongs, and this can read it.
 */
const KEYS = ['at', 'where', 'locality', 'from', 'travel', 'rating', 'price', 'sort', 'who', 'intake'];

/**
 * What travels with you when you move around this tab, and what does not.
 *
 * Where you are looking and how you are filtering it describe *you*, so they
 * follow: the town, the ceiling, the rating floor, the price band, the order.
 * Two things belong to the page you are leaving and must be dropped, or they
 * arrive somewhere they mean nothing (owner, 7 Sep 2026): `place`, the drawer
 * open *over* a page, and `within`, a drawer inside one category — Museums
 * means nothing in Sport.
 */
const CARRIED = ['at', 'where', 'locality', 'from', 'travel', 'by', 'rating', 'price', 'sort', 'who', 'intake'];

/**
 * "Nowhere, deliberately." The address says `at=unset` when somebody chose
 * "Somewhere else…" and has not yet said where: the home address is not to be
 * fallen back on, the lists are emptied, and the Where control reads "Set your
 * location" until a town is named (handover v8, "unknown-location state").
 */
const UNSET = 'unset';

/** "51.48160,-0.61130" — enough to look around the same town, and no more. */
const placeFromQuery = (q: URLSearchParams): Place | null => {
  const at = q.get('at');
  if (!at || at === UNSET) return null;
  const [lat, lng] = at.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: q.get('where') ?? `${lat}, ${lng}`, locality: q.get('locality') };
};
const placeToQuery = (p: Place | null, from: 'here' | 'search' | null): Record<string, string | null> => (p
  ? {
    at: `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`,
    where: p.label,
    locality: p.locality && p.locality !== p.label ? p.locality : null,
    from: from === 'here' ? 'here' : null,
  }
  : { at: null, where: null, locality: null, from: null });

/**
 * "Fairways, Titlarks Hill, Ascot, SL5 0JD" is where somebody lives; "Ascot" is
 * where they are. The town is the last part of the address that is not a
 * postcode, which is true of every address the map gives us and of every area
 * name, where there is only one part to begin with.
 */
export function shortPlace(label: string | null | undefined): string {
  if (!label) return 'here';
  const parts = label.split(',').map((p) => p.trim()).filter((p) => p && !/\d/.test(p));
  return parts[parts.length - 1] ?? label.split(',')[0].trim();
}

const cap1 = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/-/g, ' ') : s);

/**
 * The atlas's eight words, said in a way that does not collide with a shelf.
 * `active` is the atlas's word for anything under "sports venue" — what the
 * place *is* — and there is a shelf called Active, which is what a day there
 * is *like*.
 */
const ATLAS_WORD: Record<string, string> = { active: 'Sports venue' };

/** What each subcategory is called, from the answer that carried it. */
type Drawers = Map<string, string>;

/**
 * The one word for what kind of place this is: the drawer it is filed in
 * ("Castles & houses"), else the atlas's own category, else a search tag.
 */
function kindOf(item: InspireItem, drawers: Drawers): string {
  const drawer = item.subcategory ? drawers.get(item.subcategory) : null;
  if (drawer) return drawer;
  if (item.atlasCategory) return cap1(ATLAS_WORD[item.atlasCategory] ?? item.atlasCategory);
  const tag = item.experiences?.[0];
  if (tag) return cap1(tag);
  return item.category === 'attraction' ? '' : cap1(item.category);
}

/**
 * The kind of place the API found, in the word the strip uses. A bar is not a
 * pub and a bakery is not a café (owner, 8 Sep 2026).
 */
const FOOD_KINDS: Record<string, string> = {
  restaurant: 'restaurants', cafe: 'cafes', pub: 'pubs', bar: 'bars', bakery: 'bakeries', takeaway: 'takeaway',
};
const FOOD_LABELS: Record<string, string> = {
  restaurants: 'Restaurants', pubs: 'Pubs', bars: 'Bars', cafes: 'Cafés', bakeries: 'Bakeries', takeaway: 'Takeaway',
};
/**
 * The first cuisine a place has said, or nothing. The sweep writes "not said"
 * where the venue's own page did not say, and that is a fact about our
 * research, not a cuisine to list a restaurant under.
 */
const NO_CUISINE = /^(not said|unknown|none|other|n\/a)$/i;
const cuisineOf = (i: InspireItem): string | null => i.cuisines.find((c) => c && !NO_CUISINE.test(c)) ?? null;
/** The key a drawer list writes for the places no drawer holds. */
const OTHER = 'other';
/** Everything in the category, as one list — the food "All restaurants · by rating" row, and an activities category with no drawers. */
const ALL = 'all';

export function InspireScreen({ route, household, onOpenTrip, onPlanner, onCreateTrip }: {
  /** Which layer of Inspire the address asks for: the shelves, one shelf opened, or the search. */
  route: Extract<Route, { name: 'inspire' }>;
  household: HouseholdResponse | null;
  onOpenTrip?: (tripId: string, opts?: OpenTripOptions) => void;
  /**
   * The call to action on a place (owner, 5 Sep 2026): "for each place that I
   * click through, I should have a call to action: Create trip, because that
   * should then take me into the trips."
   */
  onCreateTrip?: (p: { place: Place; seed: { venueRef: string; name: string; category?: string | null; lat?: number | null; lng?: number | null; image?: OwnedImage | null; photos?: VenuePhotoRef[] | null } }) => void;
  /** The other way to ask: say what the day is for and let Epic think about it. */
  onPlanner?: () => void;
  /** Kept for the shell; Food is a half of this screen now, not a door. */
  onFood?: () => void;
}) {
  const { width } = useViewport();
  const wide = width >= 900;
  const { href, query, navigate, setQuery, back } = useRouter();
  // How this screen was last set, filled in only when the address is silent.
  useStickyQuery('inspire', KEYS);

  const home: Place | null = household?.household.home ?? null;
  const members = household?.members ?? [];

  const searching = route.searching;
  const mode = route.mode;
  const pick = route.pick;
  const chosen = placeFromQuery(query);
  const fromHere = query.get('from') === 'here';
  /**
   * Nowhere to look from: chosen deliberately, or — once the household has
   * answered and there is no home address — simply not known. Not before the
   * household has answered: for that half-second nothing is known yet, which
   * is not the same as knowing there is nowhere.
   */
  const unknown = query.get('at') === UNSET || (household != null && !chosen && !home);
  const setWhere = (p: Place | null, from: 'here' | 'search' | null) => setQuery(placeToQuery(p, from), { replace: false });
  /**
   * "Somewhere else…" is a state of this visit, not a standing choice. The
   * address carries it (the lists have to empty and the control has to say so)
   * and the tab's memory would keep it — which is `by=walk` all over again: a
   * screen with nothing on it, days later, and no clue why. So an `at=unset`
   * that was not chosen in this visit is put back to home.
   */
  const choseElsewhere = useRef(false);
  const goUnknown = () => { choseElsewhere.current = true; setQuery({ at: UNSET, where: null, locality: null, from: null }, { replace: false }); };
  useEffect(() => {
    if (query.get('at') === UNSET && !choseElsewhere.current) setQuery({ at: null, where: null, locality: null, from: null }, { replace: true });
  }, [query.get('at')]);

  const [travel, setTravel] = useQueryState<number | null>('travel', HOW_FAR_DEFAULT, asNumber(HOW_FAR_DEFAULT));
  const [travelBy, setTravelBy] = useQueryState<TravelMode>('by', 'drive', asOneOf(['drive', 'transit', 'walk'], 'drive'));
  const [rating, setRating] = useQueryState<number>('rating', 0, asNumber(0));
  const [price, setPrice] = useQueryState<string>('price', 'any', asOneOf(PRICE_KEYS, 'any'));
  const [sort, setSort] = useQueryState<InspireSort>('sort', 'rating', asOneOf(SORT_KEYS, 'rating'));
  const [who] = useQueryState<string[]>('who', [], asList);
  /**
   * The layer inside an open category or kind: nothing (the list of drawers),
   * one drawer, `all` (everything in it as one list) or `other` (what no
   * drawer holds). Written as it is — `all` is a page here, not a default.
   */
  const [within, setWithin] = useQueryState<string | null>('within', null, { read: (raw) => raw || null, write: (v) => v || null });
  /** The spoken request these results answer, if any (voice intake, C5 / R5b). */
  const intakeId = query.get('intake');
  const [menu, setMenu] = useState<Menu>(null);
  const toggle = (m: Exclude<Menu, null>) => () => setMenu((cur) => (cur === m ? null : m));
  const close = () => setMenu(null);
  /**
   * How tall the head is, so a panel can hang off the bottom of it. Measured
   * rather than worked out: the head is one band taller in some states, and a
   * panel pinned to a guessed number would float over the band or leave a
   * stripe of the list showing above it.
   */
  const [headH, setHeadH] = useState(0);

  const hereQuery = () => {
    const kept = new URLSearchParams();
    for (const k of CARRIED) { const v = query.get(k); if (v != null) kept.set(k, v); }
    const q = kept.toString();
    return q ? `?${q}` : '';
  };
  /** One address out of a path and a change to the query, for the taps that do both at once. */
  const here = (base: string, patch: Record<string, string | null>) => withQuery(href, patch, base);
  /** Move to a mode and a pick, carrying how the screen is set. `reset` drops the filters too. */
  const goTo = (m: 'activities' | 'food', p: string | null, reset = false) => {
    setMenu(null);
    const base = paths.inspireMode(m, p);
    const patch: Record<string, string | null> = { place: null, within: null };
    if (reset) { patch.rating = null; patch.price = null; patch.sort = null; }
    navigate(withQuery(paths.inspire() + hereQuery(), patch, base));
  };

  const [pool, setPool] = useState<InspireNear | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Where the phone is, when the browser will say without being asked.
  //
  // Roger, 5 Sep 2026: "We should identify the location from the user's mobile
  // browser." A cold permission prompt on load is still not the way to do it —
  // once refused, the browser remembers and will not ask again, which would
  // cost this feature permanently on that phone. So: if permission has already
  // been granted, the fix is taken silently and the screen opens on where they
  // are standing; if it has not, the offer is a row in the Where panel.
  // Nothing here ever triggers a prompt the household did not ask for.
  const me = useHere();
  const askedSilently = useRef(false);
  const chosenNow = useRef(chosen);
  chosenNow.current = chosen;
  const unknownNow = useRef(query.get('at') === UNSET);
  unknownNow.current = query.get('at') === UNSET;
  useEffect(() => {
    if (askedSilently.current || !me.supported) return;
    askedSilently.current = true;
    const permissions = (globalThis as any).navigator?.permissions;
    if (!permissions?.query) return;
    permissions.query({ name: 'geolocation' })
      .then(async (status: any) => {
        // Only when nobody has said where: a link that names a town means that
        // town, whoever opens it and wherever they are standing — and a
        // deliberate "somewhere else" is not to be answered with the phone.
        if (status.state === 'granted' && !chosenNow.current && !unknownNow.current) {
          const p = await me.ask();
          if (p && !chosenNow.current && !unknownNow.current) setWhere(p, 'here');
        }
      })
      .catch(() => null);
  }, [me.supported]);

  const useHereNow = async () => { const p = await me.ask(); if (p) setWhere(p, 'here'); };

  // Where somebody said, which wins over home: the most deliberate answer to
  // "where" is the one on screen, and it is in the address so it travels.
  const centre = unknown ? null : chosen ?? home;
  const load = useCallback(async () => {
    if (!centre) { setPool(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await api.inspireNear({
        lat: centre.lat, lng: centre.lng,
        label: centre.label, locality: centre.locality ?? null,
        // How you are getting there is what the travel times are *of*.
        mode: travelBy,
      });
      setPool(r);
    } catch (e: any) {
      setPool(null);
      setError(e?.message ?? 'Epic could not look around just now.');
    } finally {
      setLoading(false);
    }
  }, [centre?.lat, centre?.lng, centre?.label, travelBy]);

  useEffect(() => { void load(); }, [load]);

  const placeName = shortPlace(pool?.place.locality ?? centre?.locality ?? centre?.label);
  /** The town, and only the town — never "near" (owner, 8 Sep 2026). */
  const whereName = centre ? placeName : '';
  const homeTown = home ? shortPlace(home.locality ?? home.label) : null;

  const attending = who.length ? new Set(who) : null;
  const coming = members.filter((m) => !attending || attending.has(m.id));
  const minorComing = coming.some((m) => m.isMinor);
  /**
   * Who is coming ranks; it does not exclude (Requirements: allergens exclude,
   * preferences rank). A day with a child in it leads with the places built
   * for one, and a day without leads with everything else — as a stable
   * pre-order under whichever sort is chosen.
   */
  const forWhoever = (i: InspireItem): number => {
    const kid = i.atlasCategory === 'family' || i.atlasCategory === 'animals';
    if (!kid) return 0;
    return minorComing ? -1 : 1;
  };

  /**
   * The crowd's number for the places on screen.
   *
   * Owner, 7 Sep 2026: "move Google to once per place we show… I do not want to
   * compromise on data." So the screen asks about what it is drawing rather
   * than about the whole pool, in batches, as the household moves around — and
   * the answers accumulate here. A match is stored server-side for good, so the
   * second sight of a place is cheap and the third is free.
   *
   * The one time it asks about more than it draws is a rating floor: "4.0+"
   * over a list nobody has been asked about would be an empty list, so setting
   * one asks about everything in the mode and the list fills in.
   */
  const [crowd, setCrowd] = useState<Record<string, { rating: number | null; ratingCount: number | null }>>({});
  const askedFor = useRef<Set<string>>(new Set());
  /** Why the stars are missing, when the source could not be asked at all. */
  const [ratingsOff, setRatingsOff] = useState<string | null>(null);
  const askAbout = useCallback((rows: InspireItem[]) => {
    const want = rows.filter((i) => i.rating == null && !askedFor.current.has(i.venueRef) && i.lat != null && i.lng != null);
    if (!want.length) return;
    for (const i of want) askedFor.current.add(i.venueRef);
    void (async () => {
      for (let at = 0; at < want.length; at += BATCH) {
        const batch = want.slice(at, at + BATCH);
        try {
          const d = await api.placeRatings(batch.map((i) => ({ ref: i.venueRef, name: i.name, lat: i.lat, lng: i.lng })));
          // The source refused — out of allowance, most likely. Nothing is
          // written down: a square must not say "No ratings yet" about a place
          // nobody managed to ask about. The reason is said once, in words.
          if (d.sourceError) {
            for (const i of batch) askedFor.current.delete(i.venueRef);
            setRatingsOff(d.sourceError);
            return;
          }
          setCrowd((c) => {
            const next = { ...c };
            for (const i of batch) next[i.venueRef] = d.ratings[i.venueRef] ?? { rating: null, ratingCount: null };
            return next;
          });
        } catch {
          for (const i of batch) askedFor.current.delete(i.venueRef);
        }
      }
    })();
  }, []);
  const crowdOf = useCallback((i: InspireItem) => ({
    rating: i.rating ?? crowd[i.venueRef]?.rating ?? null,
    ratingCount: i.ratingCount ?? crowd[i.venueRef]?.ratingCount ?? null,
    known: i.rating != null || crowd[i.venueRef] !== undefined,
  }), [crowd]);

  /** Every drawer the answer named, so a card can print its own word for itself. */
  const drawers: Drawers = useMemo(
    () => new Map((pool?.moods ?? []).flatMap((m) => (m.subcategories ?? []).map((sc) => [sc.key, sc.label] as const))),
    [pool],
  );
  const label = useCallback(
    (key: string) => pool?.moods.find((m) => m.key === key)?.label ?? MOOD_LABEL[key] ?? FOOD_LABELS[key] ?? cap1(key),
    [pool],
  );

  /**
   * Somewhere to eat is a *kind of place*, not a place that happens to serve
   * food (owner, 7 Sep 2026, twice). The sweep's own places and the food
   * categories are the answer; an attraction with a café is an attraction.
   */
  const isFood = useCallback((i: InspireItem) => i.source === 'scout' || Boolean(FOOD_KINDS[i.category]), []);
  const inMode = useMemo(() => (pool?.items ?? []).filter((i) => (mode === 'food' ? isFood(i) : !isFood(i))), [pool, mode, isFood]);

  /** Which category or kind a place is in, in the strip's own keys. */
  const inCategory = useCallback((i: InspireItem, key: string) => (mode === 'food' ? FOOD_KINDS[i.category] === key : i.moods.includes(key)), [mode]);
  /** The one word the Type sort orders by. */
  const typeOf = useCallback((i: InspireItem) => (mode === 'food' ? cap1(cuisineOf(i) ?? (FOOD_KINDS[i.category] === 'restaurants' ? 'Restaurant' : FOOD_LABELS[FOOD_KINDS[i.category]] ?? '')) : kindOf(i, drawers)), [mode, drawers]);

  const filters: Filters = { travel, rating, price };
  const active = activeCount(filters, pick);
  /** The pool, narrowed by every filter and put in order. One pass, no calls. */
  const shown = useMemo(
    () => sortItems([...inMode].sort((a, b) => forWhoever(a) - forWhoever(b)).filter((i) => keeps(i, filters, crowdOf)), sort, crowdOf, typeOf),
    [inMode, travel, rating, price, sort, crowdOf, typeOf, minorComing],
  );

  /**
   * What the strip offers, per mode: only what is actually here, in the
   * taxonomy's own order and words (owner, 7 Sep 2026). `all` leads both and
   * is the absence of a pick rather than a category of its own.
   */
  const stripItems = useMemo(() => {
    const all = { key: ALL, label: 'All' };
    if (mode === 'food') {
      const kinds = new Set(inMode.map((i) => FOOD_KINDS[i.category]).filter(Boolean));
      return [all, ...FOOD_CATEGORIES.filter((k) => !pool || kinds.has(k)).map((k) => ({ key: k, label: FOOD_LABELS[k] }))];
    }
    const cats = (pool?.moods ?? []).filter((m) => m.key !== 'food' && (m.count ?? 0) > 0).map((m) => ({ key: m.key, label: m.label }));
    return [all, ...(pool ? cats : ACTIVITY_CATEGORIES.map((k) => ({ key: k, label: label(k) })))];
  }, [mode, pool, label, inMode]);
  const categories = stripItems.filter((s) => s.key !== ALL);

  /** The shelves (All, in Activities): every category with something in it, filtered and ordered. */
  /**
   * The mood a spoken request asked for leads the shelves (voice intake, C5 /
   * R5b): "something active" puts Active first when it has anything, and the
   * rest follow in their usual order. The shelf is not opened as a page,
   * because within an hour of most homes it is thin and an empty page says
   * nothing matches (9 Sep 2026).
   */
  const [leadMood, setLeadMood] = useState<string | null>(null);
  /** The spoken request being answered, once the strip has loaded it. */
  const [ask, setAsk] = useState<Intake | null>(null);
  /**
   * The answer to a spoken request: one curated list, pictures and all, not a
   * category's drawers (owner, 9 Sep 2026). Indoors when they said rain or
   * indoors, for children when children are in the picture, the mood's
   * shelves first, the kinds named first of all. A place's drawer says whether
   * it is indoors or for kids (back office › Shelves); where the drawer says
   * "it depends", the place's own words decide.
   */
  const answer = useMemo(() => {
    const f = ask?.resolved.filter;
    if (!intakeId || !f || (f.indoors == null && !f.kids && !f.moods.length && !f.wantTypes.length)) return null;
    const words = (i: InspireItem) => `${i.name} ${i.category} ${i.subcategory ?? ''} ${(i.experiences ?? []).join(' ')}`.toLowerCase();
    const indoorsSaid = (i: InspireItem) => i.indoor === true || (i.indoor == null && INDOOR_WORDS.test(words(i)) && !OUTDOOR_WORDS.test(words(i)));
    const outdoorsSaid = (i: InspireItem) => i.indoor === false || (i.indoor == null && OUTDOOR_WORDS.test(words(i)));
    const kidsOk = (i: InspireItem) => i.forKids === true || i.goodForChildren === true || (i.forKids == null && i.goodForChildren == null && KIDS_WORDS.test(words(i)));
    const kept = shown.filter((i) =>
      (f.indoors !== true || indoorsSaid(i))
      && (f.indoors !== false || outdoorsSaid(i))
      && (!f.kids || kidsOk(i)));
    const rank = (i: InspireItem) => (f.wantTypes.some((t) => words(i).includes(t)) ? 0 : 1) * 10 + (f.moods.length && !i.moods.some((m) => f.moods.includes(m)) ? 1 : 0);
    return [...kept].sort((a, b) => rank(a) - rank(b));
  }, [ask, intakeId, shown]);
  const shelves = useMemo(
    () => categories.map((c) => ({ key: c.key, label: c.label, items: shown.filter((i) => inCategory(i, c.key)) })).filter((s) => s.items.length)
      .sort((a, b) => Number(b.key === leadMood) - Number(a.key === leadMood)),
    [categories, shown, inCategory, leadMood],
  );

  /** Inside one category or kind: what is in it, after the filters. */
  const inPick = useMemo(() => {
    if (!pick) return [];
    if (mode === 'food' && !(FOOD_CATEGORIES as readonly string[]).includes(pick)) {
      // An older address named a cuisine straight under Food; it still answers.
      return shown.filter((i) => i.cuisines.includes(pick));
    }
    return shown.filter((i) => inCategory(i, pick));
  }, [shown, pick, mode, inCategory]);
  /** Whether the pick is a kind of place (Food) or a category (Activities), rather than a bare cuisine. */
  const pickIsCategory = !!pick && (mode === 'activities' || (FOOD_CATEGORIES as readonly string[]).includes(pick));

  /** The drawers inside the pick, with what is in each: the sub-category list. */
  const subRows = useMemo((): { key: string; label: string; count: number }[] => {
    if (!pick || !pickIsCategory) return [];
    if (mode === 'food') {
      const by = new Map<string, number>();
      let other = 0;
      for (const i of inPick) { const c = cuisineOf(i); if (c) by.set(c, (by.get(c) ?? 0) + 1); else other += 1; }
      const rows = [...by.entries()].sort((a, b) => cap1(a[0]).localeCompare(cap1(b[0]))).map(([key, count]) => ({ key, label: cap1(key), count }));
      if (other) rows.push({ key: OTHER, label: 'Everything else', count: other });
      return rows;
    }
    const subs = pool?.moods.find((m) => m.key === pick)?.subcategories ?? [];
    const rows = subs.map((sc) => ({ key: sc.key, label: sc.label, count: inPick.filter((i) => i.subcategory === sc.key).length })).filter((r) => r.count);
    const other = inPick.filter((i) => !i.subcategory || !subs.some((sc) => sc.key === i.subcategory)).length;
    if (other && rows.length) rows.push({ key: OTHER, label: 'Everything else', count: other });
    return rows;
  }, [pick, pickIsCategory, mode, inPick, pool]);

  /**
   * Which layer is drawn inside a pick. A category with no drawers at all has
   * no list of drawers to show, so it goes straight to its places.
   */
  const layer: 'subs' | 'list' = !pick ? 'list' : !pickIsCategory ? 'list' : within ? 'list' : subRows.length ? 'subs' : 'list';
  const listed = useMemo(() => {
    if (!pick) return [];
    if (!pickIsCategory || within == null || within === ALL) return inPick;
    if (mode === 'food') {
      if (within === OTHER) return inPick.filter((i) => !cuisineOf(i));
      return inPick.filter((i) => cuisineOf(i) === within);
    }
    if (within === OTHER) return inPick.filter((i) => !i.subcategory || !subRows.some((r) => r.key === i.subcategory && r.key !== OTHER));
    return inPick.filter((i) => i.subcategory === within);
  }, [pick, pickIsCategory, within, inPick, mode, subRows]);
  const listTitle = !pick ? ''
    : !pickIsCategory ? cap1(pick)
      : layer === 'subs' || within == null || within === ALL ? (layer === 'subs' ? label(pick) : `All ${label(pick).toLowerCase()}`)
        : within === OTHER ? 'Everything else'
          : mode === 'food' ? cap1(within) : drawers.get(within) ?? cap1(within);
  const listCount = layer === 'subs' ? inPick.length : listed.length;

  // Whichever list is actually on screen is the one worth asking about — and,
  // under a rating floor, the whole of the mode, so the floor can be honest.
  useEffect(() => {
    if (rating > 0) { askAbout(inMode); return; }
    askAbout(pick ? listed : shelves.flatMap((sh) => sh.items.slice(0, ACROSS)));
  }, [pick, listed, shelves, rating, inMode, askAbout]);

  /** The place, opened — `?place=…` over whichever list is showing. */
  const asDrawerItem = (item: InspireItem) => ({
    id: item.venueRef, venueRef: item.venueRef, name: item.name, category: item.category,
    lat: item.lat, lng: item.lng, dwellMinutes: item.dwellMinutes, reasons: [], justification: null,
    startsAt: null, endsAt: null, pinned: false,
    rating: item.rating, ratingCount: item.ratingCount, priceLevel: item.priceLevel,
    image: item.image ?? null,
    photos: item.photos,
    summary: item.summary ?? null, attribution: item.attribution.join(' · ') || null,
    distanceKm: item.distanceKm, travelFromBaseMinutes: item.travelMinutes,
    source: item.source,
  } as BrowseItem);
  const open = (item: InspireItem) => { setMenu(null); setQuery({ place: item.venueRef }, { replace: false }); };
  const openedRef = query.get('place');
  const drawer = useMemo(
    () => { const it = openedRef ? (pool?.items ?? []).find((i) => i.venueRef === openedRef) : null; return it ? asDrawerItem(it) : null; },
    [openedRef, pool],
  );
  const closeDrawer = () => setQuery({ place: null }, { replace: false });

  /**
   * The heart in the drawer: keep this place, or take it back out. Keeping it
   * is what fills Places' Shortlisted list ("heart something while browsing to
   * shortlist it for later"); taking it out removes it from the atlas rather
   * than marking it dismissed — an un-tapped heart means "I did not mean to
   * keep that", not "not for us". A place the household has been to cannot be
   * removed, and the API says so; the heart is then put back.
   */
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const isKept = (i: InspireItem) => kept[i.venueRef] ?? ['saved', 'special'].includes(i.household?.ledger ?? '');
  const keep = async (i: InspireItem) => {
    const now = !isKept(i);
    setKept((k) => ({ ...k, [i.venueRef]: now }));
    try {
      if (now) await api.savePlace(i.venueRef, 'saved', { label: i.name, category: i.category, lat: i.lat, lng: i.lng });
      else await api.deleteAtlasPlace(i.venueRef);
    } catch (e: any) {
      setKept((k) => ({ ...k, [i.venueRef]: !now }));
      setNotice(e?.message ?? 'That could not be saved just now.');
    }
  };
  const openedItem = openedRef ? (pool?.items ?? []).find((i) => i.venueRef === openedRef) ?? null : null;

  // --- the controls' words ---------------------------------------------------
  const travelDraw = TRAVEL[travelBy];
  // Before the household has answered there is no town to name yet, and
  // "1 hr · " with nothing after the dot reads as broken rather than pending.
  const whereLabel = unknown ? 'Set your location' : whereName ? `${howFarShort(travel)} · ${whereName}${fromHere ? ' (you)' : ''}` : howFarShort(travel);
  const whereSpoken = unknown ? 'Set your location' : `Within ${howFarShort(travel)} of ${whereName}, ${travelBy === 'walk' ? 'on foot' : travelBy === 'transit' ? 'by public transport' : 'driving'}`;
  const filtersLabel = active ? `Filters (${active})` : 'Filters';
  const sortLabel = SORTS[mode].find((s) => s.key === sort)?.label ?? 'Rating';
  const clearFilters = () => { setMenu(null); navigate(withQuery(paths.inspire() + hereQuery(), { rating: null, price: null, within: null, place: null }, paths.inspireMode(mode, null))); };

  /** The counts in the Filters panel: live, and each one cross-filtered by the other two. */
  const scope = pick && pickIsCategory ? inMode.filter((i) => inCategory(i, pick)) : pick ? inMode.filter((i) => i.cuisines.includes(pick)) : inMode;
  const countWith = (f: Filters, rows: InspireItem[] = scope) => rows.filter((i) => keeps(i, f, crowdOf)).length;
  const ratingOptions: PopoverOption[] = RATING_FLOORS.map((r) => ({ key: String(r.key), label: r.label, count: countWith({ ...filters, rating: r.key }), on: rating === r.key }));
  const priceOptions: PopoverOption[] = PRICE_BANDS.map((b) => ({ key: b.key, label: b.label, count: countWith({ ...filters, price: b.key }), on: price === b.key }));
  const typeOptions: PopoverOption[] = [
    { key: ALL, label: 'All', count: countWith(filters, inMode), on: !pick },
    ...categories.map((c) => ({ key: c.key, label: c.label, count: countWith(filters, inMode.filter((i) => inCategory(i, c.key))), on: pick === c.key })),
  ];
  const pricesKnown = inMode.some((i) => i.priceLevel != null);

  const fromOptions: PopoverOption[] = [
    ...(home ? [{ key: 'home', label: `${homeTown} · home`, on: !chosen && !unknown }] : []),
    ...(me.supported ? [{ key: 'here', label: fromHere ? `Using your location · ${whereName}` : 'Use my location', on: fromHere }] : []),
    ...(chosen && !fromHere ? [{ key: 'chosen', label: chosen.label, on: true }] : []),
    { key: 'elsewhere', label: 'Somewhere else…', on: false },
  ];
  const pickFrom = (k: string) => {
    if (k === 'home') { setWhere(null, null); close(); }
    else if (k === 'here') { close(); void useHereNow(); }
    else if (k === 'elsewhere') { goUnknown(); }
    else close();
  };

  // The search is a whole screen, drawn in the tab so the tab bar stays put.
  if (searching) {
    return (
      <WhereSearch
        home={home}
        onClose={() => back(paths.inspire() + hereQuery())}
        onPick={(p) => navigate(here(paths.inspire(), placeToQuery(p, 'search')), { replace: true })}
        onPlanner={onPlanner}
      />
    );
  }

  /** What an empty list says, and the one tap out of it. */
  const emptyBody = `No places within ${howFarShort(travel)} · ${whereName} match these filters.`;
  const nothingDrawn = !loading && !!pool && (pick ? (layer === 'subs' ? subRows.length === 0 : listed.length === 0) : mode === 'food' ? shown.length === 0 : shelves.length === 0);

  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.scroll} stickyHeaderIndices={[0]} keyboardShouldPersistTaps="handled">
        {/* The head of the screen: the mark, which half, which category, and
            the control row. Sticky, because the strip is how you move around
            this tab and it should not scroll away from you. */}
        <View style={styles.header} onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
          <InspireTop />
          <MenuBar>
            {/* Switching halves puts the filters and the order back to their
                defaults — a £ band chosen for lunch is not a £ band for a
                castle — and keeps where you are looking. */}
            <ModeSwitch mode={mode} onMode={(m) => goTo(m, null, true)} />
            <CategoryStrip
              items={stripItems}
              value={pick && pickIsCategory ? pick : ALL}
              onPick={(k) => goTo(mode, k === ALL ? null : k)}
              align={mode === 'food' ? 'left' : 'centre'}
            />
          </MenuBar>
          <ControlRow
            left={(
              <ControlButton
                icon={travelDraw.icon}
                label={whereLabel}
                spoken={whereSpoken}
                set={unknown || travel !== HOW_FAR_DEFAULT}
                open={menu === 'where'}
                onPress={toggle('where')}
              />
            )}
            centre={<ControlButton label={filtersLabel} set={active > 0} open={menu === 'filters'} onPress={toggle('filters')} />}
            right={<ControlButton label={`Sort: ${sortLabel}`} set={sort !== 'rating'} open={menu === 'sort'} onPress={toggle('sort')} />}
          />
        </View>

        <View style={[styles.column, wide && styles.columnWide]}>
          {/* Voice (handoff, 8 Sep 2026). With a reading open (?intake=), its
              question is the title and its facts the chip row (C5, R5b);
              otherwise one grey row under the band: "Or just ask" (R5). */}
          {intakeId ? (
            <IntakeStrip intakeId={intakeId} household={household} onReask={() => navigate(paths.say({ for: 'inspire' }))} onLoaded={(i) => { setAsk(i); setLeadMood(VIBE_MOOD[i.resolved.vibe ?? ''] ?? null); }} />
          ) : (
            <AskRow onPress={() => navigate(paths.say({ for: 'inspire' }))} />
          )}
          {loading && !pool ? (
            <View style={styles.waiting}>
              <ActivityIndicator color={colors.icon} />
              <Text style={type.small}>Looking around {placeName}…</Text>
            </View>
          ) : null}

          {unknown && !loading ? (
            <EmptyMatch
              title="Where are you?"
              body="Epic needs somewhere to look from. Use your location, go from home, or search for a town."
              action="Set your location"
              onAction={() => setMenu('where')}
            />
          ) : null}

          {error ? <EmptyMatch title={`Nothing came back for ${placeName}`} body={error} action="Try again" onAction={load} /> : null}

          {pool && !loading && !unknown ? (
            <>
              {/* Why every square is missing its star, said once and in plain
                  words, on a day the source has actually refused. */}
              {ratingsOff ? (
                <View style={[styles.gutter, styles.notice]}>
                  <Icon name="info" size={14} color={colors.ink} />
                  <Text style={[type.small, { flex: 1, color: colors.ink }]}>{ratingsOff}</Text>
                </View>
              ) : null}

              {/* The answer to what was asked: one list, with pictures. */}
              {answer && !pick && mode === 'activities' ? (
                <View style={styles.gutter}>
                  <Text style={type.small}>
                    {answer.length ? `${answer.length} place${answer.length === 1 ? '' : 's'}` : 'Nothing'}
                    {ask?.resolved.filter.indoors === true ? ' indoors' : ask?.resolved.filter.indoors === false ? ' outdoors' : ''}
                    {ask?.resolved.filter.kids ? ' for the kids' : ''}
                    {` within ${howFarShort(travel)} of ${placeName}`}
                    {answer.length ? '' : ' that Epic knows yet — everything nearby is below.'}
                  </Text>
                  {answer.length ? (
                    <View style={styles.cards}>
                      {answer.map((i) => <CardWide key={i.venueRef} item={i} crowd={crowdOf(i)} travel={travelDraw} onOpen={() => open(i)} />)}
                    </View>
                  ) : null}
                  <Pressable onPress={() => navigate(withQuery(href, { intake: null }, paths.inspire()))} accessibilityRole="button" style={{ paddingVertical: 8 }}>
                    <Text style={[type.small, { color: colors.accent, fontWeight: '600' }]}>{answer.length ? 'Show everything nearby instead ›' : 'Everything nearby ›'}</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* All: shelves per category, each "All N ›". Empty shelves are dropped. */}
              {!pick && mode === 'activities' && !(answer && answer.length) ? shelves.map((sh) => (
                <Carousel
                  key={sh.key}
                  title={sh.label}
                  count={sh.items.length}
                  items={sh.items.slice(0, ACROSS)}
                  onAll={() => goTo('activities', sh.key)}
                  onOpen={open}
                  crowdOf={crowdOf}
                  travel={travelDraw}
                />
              )) : null}

              {/* Food, All: text rows, no image slots. */}
              {!pick && mode === 'food' ? (
                <View>
                  {shown.map((i) => (
                    <FoodRow key={i.venueRef} item={i} kind={typeOf(i) || null} standing={(i as any).standing ?? null} crowd={crowdOf(i)} travel={travelDraw} onOpen={() => open(i)} />
                  ))}
                </View>
              ) : null}

              {/* Inside a category or a kind: the section title row, then the
                  drawers or the places. The back arrow always returns to All. */}
              {pick ? (
                <View style={styles.drill}>
                  <CrumbHead
                    onBack={() => goTo(mode, null)}
                    backLabel="All"
                    title={listTitle}
                    aside={listCount ? `${listCount} place${listCount === 1 ? '' : 's'}` : null}
                  />
                  {layer === 'subs' ? (
                    <View>
                      {mode === 'food' ? (
                        <SubRow label={`All ${label(pick).toLowerCase()} · by rating`} count={inPick.length} onPress={() => { setSort('rating'); setWithin(ALL, { replace: false }); }} />
                      ) : null}
                      {subRows.map((r) => (
                        <SubRow key={r.key} label={r.label} count={r.count} onPress={() => setWithin(r.key, { replace: false })} />
                      ))}
                    </View>
                  ) : mode === 'food' ? (
                    <View>
                      {listed.map((i) => (
                        <FoodRow key={i.venueRef} item={i} kind={typeOf(i) || null} standing={(i as any).standing ?? null} crowd={crowdOf(i)} travel={travelDraw} onOpen={() => open(i)} />
                      ))}
                    </View>
                  ) : (
                    <View style={styles.cards}>
                      {listed.map((i) => (
                        <CardWide key={i.venueRef} item={i} crowd={crowdOf(i)} travel={travelDraw} onOpen={() => open(i)} />
                      ))}
                    </View>
                  )}
                </View>
              ) : null}

              {nothingDrawn ? (
                inMode.length === 0 ? (
                  <EmptyMatch
                    title={mode === 'food' ? `Nothing to eat around ${placeName} yet` : `Nothing to do around ${placeName} yet`}
                    body={mode === 'food'
                      ? 'The sweep has not reached this area yet, so there is nothing to draw here.'
                      : 'The atlas has nothing illustrated near here yet. Try another town.'}
                    action="Somewhere else"
                    onAction={() => setMenu('where')}
                  />
                ) : (
                  <EmptyMatch body={emptyBody} action="Clear filters" onAction={clearFilters} />
                )
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>

      {/* The panels, anchored under the control row. Where has two groups —
          How far and From — or, with nowhere to look from, the question. */}
      <Popover open={menu === 'where'} top={headH} onClose={close} align="left" maxHeight={420}>
        {unknown ? (
          <View style={styles.unknown}>
            <Text style={styles.unknownTitle}>Where are you?</Text>
            <Text style={styles.unknownBody}>
              {me.error ?? "Search for a town or postcode to see what's nearby."}
            </Text>
            <PlacePicker kind="area" autoFocus value={null} placeholder="Town, city or postcode" onPick={(p) => { if (p) { setWhere(p, 'search'); close(); } }} />
            {home ? (
              <Press onPress={() => { setWhere(null, null); close(); }} accessibilityRole="button" style={styles.suggest}>
                <Text style={styles.suggestLabel}>{homeTown}</Text>
                <Text style={styles.suggestSub}>Home</Text>
              </Press>
            ) : null}
            {me.supported ? (
              <Press onPress={() => { close(); void useHereNow(); }} accessibilityRole="button" style={styles.tryAgain}>
                <Icon name="here" size={16} color={colors.primaryFg} strokeWidth={2.2} />
                <Text style={styles.tryAgainText}>{me.error ? 'Try my location again' : 'Use my location'}</Text>
              </Press>
            ) : null}
          </View>
        ) : (
          <>
            <PopoverGroup title="How far">
              <BoxRow
                options={HOW_FAR.map((h) => ({ key: String(h.minutes), label: h.label, on: travel === h.minutes }))}
                onPick={(k) => { setTravel(Number(k)); close(); }}
              />
              {/* The way of getting there is what the minutes are measured in,
                  so it sits with them rather than as a control of its own. */}
              <View style={styles.ways}>
                {TRAVEL_MODES.map((m) => {
                  const on = m.key === travelBy;
                  return (
                    <Press key={m.key} onPress={() => setTravelBy(m.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.way, on && styles.wayOn]}>
                      <Icon name={m.icon} size={14} color={on ? colors.ink : colors.inkMuted} strokeWidth={2} />
                      <Text style={[styles.wayText, on && styles.wayTextOn]}>{m.label}</Text>
                    </Press>
                  );
                })}
              </View>
            </PopoverGroup>
            <PopoverGroup title="From">
              <PopoverList options={fromOptions} onPick={pickFrom} dense />
            </PopoverGroup>
          </>
        )}
      </Popover>

      <Popover open={menu === 'filters'} top={headH} onClose={close} align="centre" maxHeight={440}>
        <PopoverGroup title="Rating">
          <BoxRow options={ratingOptions} onPick={(k) => setRating(Number(k))} />
        </PopoverGroup>
        <PopoverGroup title={mode === 'food' ? 'Price' : 'Cost'}>
          <BoxRow options={priceOptions} onPick={(k) => setPrice(k)} />
          {!pricesKnown ? <Text style={styles.panelNote}>Nothing around {placeName} has a price yet, so only Any has anything in it.</Text> : null}
        </PopoverGroup>
        <PopoverGroup title={mode === 'food' ? 'Venue' : 'Activity type'}>
          <PopoverList options={typeOptions} onPick={(k) => goTo(mode, k === ALL ? null : k)} dense />
        </PopoverGroup>
        {active ? <PopoverFooter label="Clear filters" onPress={clearFilters} /> : null}
      </Popover>

      <Popover open={menu === 'sort'} top={headH} onClose={close} align="right">
        <PopoverGroup title="Sort by">
          <PopoverList options={SORTS[mode].map((s) => ({ key: s.key, label: s.label, on: sort === s.key }))} onPick={(k) => { setSort(k as InspireSort); close(); }} dense />
        </PopoverGroup>
      </Popover>

      <VenueDrawer
        item={drawer}
        baseLabel={placeName}
        onClose={closeDrawer}
        addLabel="Create trip"
        addIcon="trips"
        shortlisted={openedItem ? isKept(openedItem) : false}
        onShortlist={async () => { if (openedItem) await keep(openedItem); }}
        // Why the heart sprang back, said inside the drawer where the heart
        // is — a line under the list would be hidden behind it on a phone.
        capture={notice ? (
          <Press onPress={() => setNotice(null)} style={styles.notice} accessibilityRole="button">
            <Icon name="info" size={14} color={colors.ink} />
            <Text style={[type.small, { flex: 1, color: colors.ink }]}>{notice}</Text>
          </Press>
        ) : null}
        onAdd={onCreateTrip ? (it) => {
          closeDrawer();
          onCreateTrip({
            place: { ref: it.venueRef, label: it.name, lat: it.lat as number, lng: it.lng as number },
            seed: { venueRef: it.venueRef, name: it.name, category: it.category, lat: it.lat, lng: it.lng, image: it.image, photos: it.photos },
          });
        } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xxl },
  // The head of the tab: cream, and carrying the block rule that closes it.
  header: { backgroundColor: colors.bg },
  // Half a centimetre of air between the controls and the first thing they
  // control (owner, 7 Sep 2026).
  column: { gap: spacing.xl, paddingTop: 20 },
  columnWide: { maxWidth: 1120, width: '100%', alignSelf: 'center' },
  gutter: { paddingHorizontal: spacing.lg },
  drill: { gap: 10 },
  cards: { gap: 22 },
  waiting: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },

  ways: { flexDirection: 'row', gap: 14, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 },
  way: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  wayOn: { borderBottomColor: colors.ink },
  wayText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted },
  wayTextOn: { color: colors.ink },
  panelNote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.inkMuted, paddingHorizontal: 12, paddingBottom: 6 },

  unknown: { padding: 12, paddingBottom: 8, gap: 10 },
  unknownTitle: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', letterSpacing: -0.34, color: colors.ink },
  unknownBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.inkMuted },
  suggest: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, minHeight: TARGET, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  suggestLabel: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.ink },
  suggestSub: { fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  tryAgain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, paddingVertical: 13, paddingHorizontal: 14, marginTop: 6, marginBottom: 4, minHeight: TARGET },
  tryAgainText: { fontFamily: fonts.body, fontSize: 14, fontWeight: '600', color: colors.primaryFg },
});
