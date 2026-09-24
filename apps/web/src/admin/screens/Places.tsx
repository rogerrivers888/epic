/**
 * Places — what do we know, where, and how good is it.
 *
 * The home of the work. Five back-office screens that were each bound to a
 * different table — the atlas harvest, the postcode sweep, the coverage lens
 * over the two of them, the same lens at close range, and a Lookup that stored
 * nothing at all — become one screen bound to a question, over one written-down
 * index of every place Epic has ever seen.
 *
 * The grammar, and it does not change between levels:
 *
 *   · **The same five numbers print at every level** — known, owned, identified
 *     only, ready, average data score. A country, a county, a ring, a category
 *     and a subcategory all read the same way.
 *   · **The address is the page.** `?where=` is the level, `?lens=` is how it is
 *     cut, `?cat=` / `?sub=` is how far down the ladder, `?place=` is one place
 *     over any of them. Only what differs from the default is written down; a
 *     move pushes and a filter replaces.
 *   · **Every cell is a doorway.** A cell that represents a row of work opens at
 *     its own address, so a piece of work is a link you can send somebody.
 *   · **Collect lives here.** Starting a collection run happens where you find
 *     the gap, and every action carries its own scope. Runs only watches.
 *   · **Every figure explains itself on hover**, and a cell inherits its
 *     column's explanation, so a column cannot ship with figures nobody can read
 *     (explain.tsx, tips.ts).
 *
 * Nothing on this screen is a provider's content. Names come from an owned
 * record, from the atlas or from OpenStreetMap; a `google:` ref nobody owns has
 * no name here at all, and the nameless row *is* the finding.
 */

import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { colors, spacing, type, BORDER } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { useSession } from '../../hooks/useSession';
import { asFlag, asNumber, asOneOf, asText, useQueryState, useRouter } from '../../router';
import { api, type PlaceLevel, type PlaceStats, type PlaceCountry, type PlaceAreaRow, type PlaceCoverageRow,
  type PlaceCategory, type HouseholdRow, type PlaceSourceDef, type PlaceSourceRow, type PlaceQuality, type DemandRow, type DemandTotals,
  type PlaceRing, type PlaceRow, type PlaceDetail, type PictureIndex, type ReadyBars, type BarEffect, type BarFact,
  type CompareColumn, type CompareRow, type RawSource, type PlaceHistoryRow, type FactDef, type PlaceLabel, type PlaceCensusRow } from '../../api';
import { AdminPage, Dropdown, ago, day, pounds, since } from '../kit';
import { Explain, type TipKey } from '../explain';
import { Ladder, Num, Word, Blank, NotAsked, NoMatch, Na, Tick, Pct, ScoreCell, Bar, Progress, Act, Footer, Kicker, Stat, type Col } from '../table';

/** How a required fact is said in a sentence, rather than as a column header. */
const NEEDS_WORD: Record<string, string> = {
  picture: 'a picture', what_it_is: 'what it is', hours: 'opening hours',
  menu: 'a menu', prices: 'prices', step_free: 'step-free',
};

const LENSES = ['census', 'coverage', 'category', 'source', 'quality', 'demand', 'collect'] as const;
/** What each way of cutting the same places is for. */
const LENS_TIP: Record<string, TipKey> = {
  census: 'lensCensus', coverage: 'lensCoverage', category: 'lensCategory', source: 'lensSource',
  quality: 'lensQuality', demand: 'lensDemand', collect: 'collect',
};
type Lens = typeof LENSES[number];
const LENS_LABEL: Record<Lens, string> = {
  census: 'Census', coverage: 'Coverage', category: 'Category', source: 'Source', quality: 'Quality', demand: 'Demand', collect: 'Collect',
};

const BY = ['county', 'city', 'postcode'] as const;
type By = typeof BY[number];
const BY_LABEL: Record<By, string> = { county: 'County', city: 'City or town', postcode: 'Postcode district' };

// How far to look around a postcode, and the first of them is what a postcode
// board opens on (owner, 20 Sep 2026: "5 minutes, which should be the
// default"). Five is the tightest the matrix can honestly answer: it is read
// with the edge allowance the sector centres need (EDGE_MINUTES, five minutes
// either way), so this band is the sector and its immediate neighbours rather
// than a precise five-minute drive.
const BANDS = [5, 30, 60, 90];
const MODES = ['drive', 'walk', 'transit'] as const;
const MODE_LABEL: Record<string, string> = { drive: 'Car', walk: 'Walk', transit: 'Transit' };
const bandLabel = (m: number) => (m === 60 ? '1 hour' : `${m} minutes`);
/** The next band out, or nothing when the board is already at the widest. */
const widerThan = (m: number | null) => BANDS.find((b) => b > (m ?? BANDS[0])) ?? null;

/**
 * How an outcode is opened, from wherever it is picked.
 *
 * Its categories, because nothing is filed under an outcode; the first band,
 * because that is what a postcode board opens on; and by car, because the
 * chooser has to say how you are travelling for the band to mean anything.
 * Written into the address at the moment of the move, so the page says what it
 * draws rather than leaving the default to be inferred from an absence.
 */
const intoArea = (kind: string) => (kind === 'postcode' ? { lens: 'category' as Lens, within: BANDS[0], by: 'drive' } : undefined);

/** The phone draws its own board rather than a squeeze of this one (BO2l). */
const PHONE = 900;

// ---------------------------------------------------------------------------
// coming back is not a new question
// ---------------------------------------------------------------------------

/**
 * What each board answered last time, so going back draws it at once.
 *
 * Opening a place replaces the board with the place, and closing it built the
 * board again from nothing: a waiting state, four requests, and a second or two
 * of a screen that looks like it is doing research (owner, 20 Sep 2026: "When I
 * click back after going into a venue, it should be instant. At the moment
 * there's a big delay, so it looks like it's researching").
 *
 * So every board draws its last answer immediately and asks again quietly
 * behind it. Nothing here is a provider's: these are our own boards' replies,
 * they live in the tab and go when it does, and anything that changes a place
 * clears the lot (`forgetBoards`) rather than leaving a board insisting on what
 * was true a moment ago.
 */
const ANSWERED = new Map<string, unknown>();
/** Enough for a session's worth of going in and out; the oldest goes first. */
const ANSWERED_MAX = 60;
const rememberAnswer = (key: string, value: unknown) => {
  ANSWERED.delete(key);
  ANSWERED.set(key, value);
  while (ANSWERED.size > ANSWERED_MAX) ANSWERED.delete(ANSWERED.keys().next().value as string);
};
/** Anything that changes a place: the boards have to ask again. */
const forgetBoards = () => ANSWERED.clear();

/**
 * The last answer first, then the true one.
 *
 * `key` is the whole question — every parameter that changes the answer — so
 * two different boards never read each other's reply. A board that has never
 * been asked waits exactly as it did before.
 */
function useFresh<T>(key: string, get: () => Promise<T>, onError?: (e: any) => void): [T | null, () => void] {
  const [value, setValue] = useState<T | null>(() => (ANSWERED.get(key) as T) ?? null);
  const [asked, askAgain] = useReducer((n: number) => n + 1, 0);
  // Held in a ref so a fetch written inline in the render does not count as a
  // change: the key says what is being asked, and the key is the dependency.
  const getRef = React.useRef(get);
  getRef.current = get;
  const errRef = React.useRef(onError);
  errRef.current = onError;
  useEffect(() => {
    const had = (ANSWERED.get(key) as T) ?? null;
    setValue(had);
    let live = true;
    getRef.current()
      // Only if this is still the question being asked. A reply that arrives
      // after the board has moved on — or after something changed the place and
      // the refresh already landed — must not write itself down as the answer,
      // or going back draws what was true before the change (Codex, 20 Sep
      // 2026).
      .then((d) => { if (!live) return; rememberAnswer(key, d); setValue(d); })
      // A board showing last time's answer keeps it when the refresh fails:
      // blanking a page that is on the screen and correct, because the second
      // ask timed out, is worse than the stale minute it saves.
      //
      // Unless the answer is that it is not ours to see or not there any more.
      // A 401, 403 or 404 is not a bad line — it is the true answer, and
      // holding the old page up against it shows a place that has been deleted
      // or a board somebody's roles no longer open (Codex, 20 Sep 2026).
      .catch((e: any) => {
        if (!live) return;
        const settled = [401, 403, 404].includes(Number(e?.status));
        if (settled) ANSWERED.delete(key);
        if (settled || !had) { setValue(null); errRef.current?.(e); }
      });
    return () => { live = false; };
  }, [key, asked]);
  return [value, askAgain];
}

export function Places({ canManage }: { canManage: boolean }) {
  const { width } = useViewport();
  const phone = width < PHONE;

  // Whose boards these are. The answers a board keeps are one account's — sign
  // out and sign in as somebody else in the same tab and the last account's
  // reply would be drawn, for a moment, to somebody whose roles may not open it
  // (Codex, 20 Sep 2026). Changing who is signed in forgets the lot.
  const { account, isOwner } = useSession();
  const who = account?.id ?? (isOwner ? 'owner' : 'nobody');
  useEffect(() => { forgetBoards(); }, [who]);

  const [where, setWhere] = useQueryState<string>('where', '', asText);
  const [within, setWithin] = useQueryState<number | null>('within', null, asNumber(null));
  const [by, setBy] = useQueryState<string>('by', '', asText);
  const [lensAsked, setLens] = useQueryState<Lens>('lens', 'coverage', asOneOf(LENSES, 'coverage'));
  const [cat, setCat] = useQueryState<string>('cat', '', asText);
  const [sub, setSub] = useQueryState<string>('sub', '', asText);
  // The boards print `?…&cat=family` and `?…&cat=family&sub=playgrounds` with no
  // lens on them, because naming a category *is* choosing the category lens.
  // Without this those two addresses landed on the coverage board and silently
  // dropped the category, which is law 8 failing on the two deepest boards
  // (Codex, 17 Sep 2026).
  const lens: Lens = (cat || sub) && lensAsked === 'coverage' ? 'category' : lensAsked;
  const [place, setPlace] = useQueryState<string>('place', '', asText);
  // Lifted, so closing the drawer can take it with it: `?tab=score` used to
  // survive on a level board that has no tabs (17 Sep 2026).
  const [tab, setTab] = useQueryState<PlaceTab>('tab', 'record', asOneOf(PLACE_TABS, 'record'));
  // `?pictures=all`, as BO2j spells it. `1` is still read, so an older link
  // still opens (17 Sep 2026, the verification audit).
  const [pictures, setPictures] = useQueryState<boolean>('pictures', false, {
    read: (raw) => raw === 'all' || raw === '1' || raw === 'true',
    write: (v) => (v ? 'all' : null),
  });
  const [readyFor, setReadyFor] = useQueryState<string>('ready', '', asText);

  // `by` does double duty on purpose, exactly as the boards spell it: on a ring
  // it is how you are travelling, and on a level it is what the rows are. They
  // never appear together — a ring has no county breakdown — so one word in the
  // address covers both and neither is ever ambiguous.
  // `?within=0` is how the address spells "this postcode on its own": the
  // dropdown offers it beside the bands, and it has to be a value rather than
  // an absence because a postcode with nothing said opens on the first band.
  const ring = within != null && within > 0;
  const mode = ring ? ((MODES as readonly string[]).includes(by) ? by : 'drive') : 'drive';
  const breakdownBy = !ring ? (((BY as readonly string[]).includes(by) ? by : 'county') as By) : 'county';

  // Closing a layer takes its own settings with it.
  //
  // `?tab=score` survived a closed place drawer, `?q=` survived a closed
  // Pictures board — and `q` is the picture search on one board and the
  // place-name filter on another, so a search left behind became a filter
  // somewhere else (17 Sep 2026, the verification audit).
  if (pictures) return <PicturesBoard onClose={() => setPictures(false)} />;
  if (readyFor) return <ReadyBarBoard sub={readyFor} canManage={canManage} onClose={() => setReadyFor('')} onPick={setReadyFor} />;
  if (place) {
    return (
      <PlaceBoard refId={place} canManage={canManage}
                  tab={tab} onTab={setTab}
                  onClose={() => { setPlace(''); setTab('record'); }} />
    );
  }
  if (!where) return <Countries onPick={(slug) => setWhere(slug)} onPictures={() => setPictures(true)} onBar={() => setReadyFor('restaurants')} canManage={canManage} />;

  return (
    <Level
      where={where} within={within} mode={mode} ring={ring} breakdownBy={breakdownBy}
      lens={lens} cat={cat} sub={sub} phone={phone} canManage={canManage}
      onWhere={(slug, opts) => {
        setWhere(slug); setWithin(opts?.within ?? null); setBy(opts?.by ?? ''); setCat(''); setSub('');
        // An outcode lands on its categories, and the address says so —
        // BO2o is `/admin/places?where=sl4-1qn&within=30&by=drive&lens=category`.
        // Nothing is filed *under* an outcode, so the board that lists what is
        // underneath an area had nothing to draw and said "nothing indexed"
        // over a hundred and eighty-seven places (owner, 18 Sep 2026).
        if (opts?.lens) setLens(opts.lens);
      }}
      onLens={(l) => { setLens(l); setSub(''); }}
      onBy={setBy} onWithin={setWithin}
      onCat={setCat} onSub={setSub} onPlace={setPlace}
      onPictures={() => setPictures(true)} onBar={(s) => setReadyFor(s)}
      onUp={() => { setWhere(''); setWithin(null); setCat(''); setSub(''); }}
    />
  );
}

// ---------------------------------------------------------------------------
// BO2m — select a country
// ---------------------------------------------------------------------------

function Countries({ onPick, onPictures, onBar, canManage }: {
  onPick: (slug: string) => void; onPictures: () => void; onBar: () => void; canManage: boolean;
}) {
  const [data, setData] = useState<{ countries: PlaceCountry[]; refreshedAt: string | null } | null>(null);
  // In the address, so a sorted board is a link somebody can be sent.
  const [sort, setSort] = useQueryState<string>('sort', 'known', asText);
  const [desc, setDesc] = useQueryState<boolean>('desc', true, { read: (r) => r !== '0', write: (v) => (v ? null : '0') });
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { api.adminCountries().then(setData).catch(() => setData({ countries: [], refreshedAt: null })); }, []);
  useEffect(load, [load]);

  const totals = useMemo(() => (data?.countries ?? []).reduce((acc, c) => ({
    known: acc.known + c.known, owned: acc.owned + c.owned, claimed: acc.claimed + c.claimed, identified: acc.identified + c.identified,
    readyCount: acc.readyCount + c.readyCount, sum: acc.sum + (c.avgScore ?? 0) * c.known, n: acc.n + (c.avgScore == null ? 0 : c.known),
  }), { known: 0, owned: 0, claimed: 0, identified: 0, readyCount: 0, sum: 0, n: 0 }), [data]);

  const rows = useMemo(() => {
    const list = [...(data?.countries ?? [])];
    const key: Record<string, (c: PlaceCountry) => number | string> = {
      name: (c) => c.name, known: (c) => c.known, owned: (c) => c.owned, identified: (c) => c.identified,
      ready: (c) => c.ready ?? -1, score: (c) => c.avgScore ?? -1, travel: (c) => c.built,
      searches: (c) => c.searches,
    };
    const k = key[sort] ?? key.known;
    list.sort((a, b) => {
      const av = k(a), bv = k(b);
      if (typeof av === 'string') return desc ? String(bv).localeCompare(av) : av.localeCompare(String(bv));
      return desc ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
    return list;
  }, [data, sort, desc]);

  const columns: Col<PlaceCountry>[] = [
    { key: 'name', label: 'Country', tip: 'country', grow: true, sort: 'name',
      cell: (c) => <Text style={[styles.rowName, c.known === 0 && { color: colors.inkMuted, fontWeight: '600' }]}>{c.name}</Text> },
    { key: 'known', label: 'Known', tip: 'known', width: 110, align: 'right', sort: 'known', cell: (c) => <Num n={c.known || null} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 100, align: 'right', sort: 'owned', cell: (c) => <Num n={c.owned || null} /> },
    { key: 'ident', label: 'Identified only', tip: 'identifiedOnly', width: 150, align: 'right', sort: 'identified', cell: (c) => <Num n={c.identified || null} /> },
    { key: 'ready', label: 'Ready', tip: 'ready', width: 110, align: 'right', sort: 'ready', cell: (c) => <Pct v={c.ready} strong min={52} /> },
    { key: 'score', label: 'Avg score', tip: 'avgScore', width: 120, align: 'right', sort: 'score', cell: (c) => <Num n={c.avgScore} /> },
    // BO2m's Searches heading is one line (audit, 18 Sep 2026).
    { key: 'searches', label: 'Searches', tip: 'searches', width: 140, align: 'right', sort: 'searches',
      cell: (c) => <Num n={c.searches || null} /> },
    { key: 'travel', label: 'Travel times', tip: 'travelTimes', width: 160, align: 'right', sort: 'travel', stops: true,
      cell: (c) => (c.travel === 'ready'
        ? <Word muted>{`Ready · ${c.cells.toLocaleString()} areas`}</Word>
        : c.known === 0 ? <Blank />
        : canManage
          // This is the dependency the whole board exists to surface, so the
          // button has to do the thing: the matrix is built by the reach layer,
          // not by reindexing places (Codex, 17 Sep 2026).
          ? <Act label={busy === c.slug ? 'Working them out…' : 'Work them out'} small disabled={busy != null}
                 onPress={() => { setBusy(c.slug); api.adminBuildReach().finally(() => { setBusy(null); load(); }); }} />
          : <Word muted>{c.travel === 'part' ? `${c.built.toLocaleString()} of ${c.cells.toLocaleString()}` : 'none'}</Word>) },
  ];

  return (
    <AdminPage>
      <Band kicker="EVERYWHERE EPIC HAS LOOKED" title="Select a country" stats={
        <Five stats={{
          known: totals.known, owned: totals.owned, claimed: totals.claimed, identified: totals.identified,
          readyCount: totals.readyCount, ready: totals.known ? Math.round((totals.readyCount / totals.known) * 100) : null,
          avgScore: totals.n ? Math.round(totals.sum / totals.n) : null,
        }} />
      } />
      {data ? (
        <Ladder columns={columns} rows={rows} keyOf={(c) => c.slug}
                onRow={(c) => (c.known ? onPick(c.slug) : undefined)}
                highlight={(c) => c.known > 0 && c.slug === rows[0]?.slug}
                /* The same stacked row BO2l draws a county's towns with: the
                   name, how many we know there, and the figures as chips. */
                phoneRow={(c) => ({
                  name: c.name,
                  note: `${c.known.toLocaleString()} known`,
                  chips: [
                    { key: 'ready', word: `ready ${c.ready == null ? '—' : `${c.ready}%`}`, tip: 'ready', lead: true },
                    { key: 'owned', word: `owned ${c.owned.toLocaleString()}`, tip: 'owned' },
                    { key: 'ident', word: `identified only ${c.identified.toLocaleString()}`, tip: 'identifiedOnly' },
                    { key: 'score', word: `score ${c.avgScore == null ? '—' : c.avgScore}`, tip: 'avgScore' },
                  ],
                })}
                sort={sort} desc={desc}
                onSort={(k) => { if (k === sort) setDesc(!desc); else { setSort(k); setDesc(true); } }} />
      ) : <Waiting />}
      <Footer>
        <Act label="Pictures" icon="picture" tone="secondary" onPress={onPictures} />
        <Act label="What counts as ready" tone="secondary" onPress={onBar} />
        {/* A country is a row in `localities` and its cells are stamped from the
            places in it, so adding one is the owner's to do in the back office's
            own data screens rather than a button that guesses. Said plainly
            rather than drawn as a control that does nothing. */}
        <Explain tip="addACountry"><Act label="Add a country" tone="secondary" disabled onPress={() => {}} /></Explain>
      </Footer>
      {busy ? <Waiting /> : null}
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// the level — one header, six lenses
// ---------------------------------------------------------------------------

function Level(props: {
  where: string; within: number | null; mode: string; ring: boolean; breakdownBy: By;
  lens: Lens; cat: string; sub: string; phone: boolean; canManage: boolean;
  onWhere: (slug: string, opts?: { within?: number | null; by?: string; lens?: Lens }) => void;
  onLens: (l: Lens) => void; onBy: (b: string) => void; onWithin: (m: number | null, opts?: { replace?: boolean }) => void;
  onCat: (c: string) => void; onSub: (s: string) => void; onPlace: (ref: string) => void;
  onPictures: () => void; onBar: (sub: string) => void; onUp: () => void;
}) {
  const { where, within, mode, ring, lens, cat, sub, phone } = props;
  // In the address: "the places here missing a menu" is a piece of work, and a
  // piece of work is a link you can send somebody (17 Sep 2026, the
  // verification audit — it was component state and nothing could set it).
  const [missing, setMissing] = useQueryState<string>('missing', '', asText);
  const [names, setNames] = useState<{ cat?: string; sub?: string; subs?: number; needs?: string[] }>({});

  const q = useMemo(() => ({ where, within: ring ? within ?? undefined : undefined, by: ring ? mode : undefined }), [where, within, ring, mode]);
  // The five numbers follow how far down the ladder the board is standing: a
  // category prints the category's, a subcategory prints the subcategory's
  // (Codex, 17 Sep 2026).
  const scoped = useMemo(
    () => ({ ...q, ...(lens === 'category' && cat ? { cat } : {}), ...(lens === 'category' && sub ? { sub } : {}) }),
    [q, lens, cat, sub],
  );
  /**
   * A name we have never heard of is an answer, not a blank page.
   *
   * `/area` answers 404 for one, and the screen sat on its waiting state for
   * ever — an address somebody typed or was sent drew nothing at all (17 Sep
   * 2026, the verification audit). The way out is the search box, so it is the
   * thing the page offers.
   */
  const [noSuchArea, setNoSuchArea] = useState<string | null>(null);
  const [level, refreshLevel] = useFresh(
    JSON.stringify(['area', scoped]),
    () => api.adminPlaceArea(scoped as any).then((l) => { setNoSuchArea(null); return l; }),
    (e: any) => setNoSuchArea(e?.body?.message ?? 'Nothing here by that name yet.'),
  );
  // A name we could not find belongs to the address that was typed, not to the
  // next one: without this, a board drawn straight out of the cache still wore
  // the last address's "nothing here by that name" until its refresh landed.
  useEffect(() => { setNoSuchArea(null); }, [scoped]);

  // Whether the level we are holding is the one the address asks for.
  //
  // A board keeps its last answer while the next one is on its way, and an
  // effect that runs on the render where the address has moved but the answer
  // has not reads the *previous* level. That is how Great Britain came to be
  // drawn as "5 minutes by car": clicking the country from a postcode ran the
  // rule below against the postcode's own level and wrote a band into the
  // country's address (owner, 20 Sep 2026 — "it's telling me 5 minutes by car,
  // which is clearly a nonsense for the whole country"). So everything that
  // follows from the level asks this first.
  const levelIsHere = level != null && (level.areaKind === 'ring'
    ? (level.area ?? String(level.name ?? '').toLowerCase().replace(/\s+/g, '-')) === where
    : level.slug === where);

  // An address that says nothing about how far out gets the default, and says
  // so. Every way of *picking* an outcode already writes the band (`intoArea`);
  // this is the one that was typed, bookmarked or shared before the band
  // existed. It replaces rather than pushes, because it is how the page is set
  // rather than a move (routes law, §13.14) — and it writes `0` when the
  // district itself is what is wanted, so this never fights the chooser.
  useEffect(() => {
    // A postcode district, and a full postcode — which has no area to be, so
    // the API answers it as a ring whether or not one was asked for. Both open
    // at the first band and both say so in the address (Codex, 20 Sep 2026:
    // the district rule alone never fired on a full postcode).
    const unsaid = within == null
      // Nought minutes means "just here", and a full postcode has no here to
      // be just: the API draws the first band round it whatever this says, so
      // the address is corrected to the band that is actually being drawn
      // rather than left claiming a scope that does not exist (Codex, 20 Sep
      // 2026).
      || (within === 0 && level?.areaKind === 'ring' && !level?.area);
    if (!levelIsHere) return;
    // The other way round: a band in the address of something that cannot have
    // one. The API answers a country or a county as itself whatever `within`
    // says, so the word sat there drawing nothing and claiming a ring — it is
    // taken out rather than left to mislead the next person the link is sent
    // to (20 Sep 2026).
    if (within != null && level?.areaKind !== 'ring' && level?.areaKind !== 'postcode') {
      props.onWithin(null, { replace: true });
      return;
    }
    if (!unsaid) return;
    if (level?.areaKind === 'postcode' || level?.areaKind === 'ring') props.onWithin(BANDS[0], { replace: true });
  }, [level, levelIsHere, within, props.onWithin]);

  if (noSuchArea) {
    return (
      <AdminPage>
        <View style={styles.trail}>
          <Press effect="none" onPress={props.onUp} accessibilityRole="button" accessibilityLabel="All countries" style={styles.trailBack}>
            <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
            <Text style={styles.trailWord}>All countries</Text>
          </Press>
        </View>
        <Band kicker="NOT A PLACE WE KNOW" title={where} stats={null} />
        <View style={styles.subRow}><Word muted>{noSuchArea}</Word></View>
        <View style={[styles.search, { width: 320 }]}><AreaSearch onWhere={props.onWhere} onPlace={props.onPlace} /></View>
      </AdminPage>
    );
  }
  if (!level) return <AdminPage><Waiting /></AdminPage>;

  // BO2l — Places at 390. The one number you would check on a train is ready %,
  // so the phone draws its own board rather than a squeeze of the desk one.
  if (phone && lens === 'coverage' && !ring && level.areaKind !== 'country' && level.areaKind !== 'postcode') {
    return <PlacesPhone level={level} q={q} lens={lens} onLens={props.onLens} onWhere={props.onWhere} onUp={props.onUp} />;
  }

  // An outcode has no coverage board, because nothing is filed under it — so
  // the lens it defaults to has to be the one that has something to draw. The
  // navigation writes `lens=category` into the address when you pick one, and
  // this covers arriving any other way: a typed address, a shared link, the
  // back button (owner, 18 Sep 2026 — SL5 pasted in showed an empty board).
  // The same shape as the rule above, where naming a category *is* choosing the
  // category lens.
  // A ring drawn round an outcode is still standing on the outcode, so the two
  // rules below hold inside it as well — they read `areaKind`, which a ring
  // answers 'ring' to (20 Sep 2026, when the first band became the default and
  // every outcode became a ring).
  const onAPostcode = level?.areaKind === 'postcode'
    || (level?.areaKind === 'ring' && (level?.fromKind == null || level?.fromKind === 'postcode'));
  const lensHere: Lens = lens === 'coverage' && onAPostcode ? 'category' : lens;


  // A ring is a ring because the answer on the screen is one, not because the
  // address carries a `within`. A country with a stray band in its address is
  // still a country, and drawing it as one hid the search box and put "5
  // minutes by car" in the breadcrumb over the whole of Great Britain (owner,
  // 20 Sep 2026).
  const ringHere = levelIsHere && level.areaKind === 'ring';

  const body = (() => {
    if (lensHere === 'category' && sub) return <PlacesBoard q={q} cat={cat} sub={sub} onPlace={props.onPlace} onBar={props.onBar} canManage={props.canManage} missing={missing || null} onMissing={(f) => setMissing(f ?? '')} onNames={setNames} onWiden={props.onWithin} within={within} />;
    if (lensHere === 'category') return <CategoryBoard q={q} cat={cat} onCat={props.onCat} onSub={props.onSub} canManage={props.canManage} onNames={setNames} onWiden={props.onWithin} within={within} onCollect={() => props.onLens('collect')} areaKind={level.areaKind} />;
    // The census is of the postcode district, whatever ring is drawn round it:
    // a ring's own slug is the matrix cell (`sector:SL5 0`), and the census
    // board reads its `where` as an outcode, so it drew a blank board for every
    // ring (20 Sep 2026).
    if (lensHere === 'census') return <CensusBoard where={level.areaKind === 'ring' ? where : level.slug} />;
    if (lensHere === 'source') return <SourceBoard q={q} onSub={props.onSub} />;
    if (lensHere === 'quality') return <QualityBoard q={q} onPlace={props.onPlace} canManage={props.canManage} />;
    if (lensHere === 'demand') return <DemandLens q={q} canManage={props.canManage} onCollect={() => props.onLens('collect')} />;
    if (lensHere === 'collect') return <CollectBoard q={q} level={level} canManage={props.canManage} cat={cat} sub={sub} />;
    if (ringHere) return <RingBoard q={q} onSub={props.onSub} onLens={props.onLens} onWithin={props.onWithin} />;
    if (level.areaKind === 'country') return <BreakdownBoard q={q} by={props.breakdownBy} onBy={props.onBy} onWhere={props.onWhere} canManage={props.canManage}
                                                             onCollectIn={(slug) => { props.onWhere(slug); props.onLens('collect'); }} />;
    return <CoverageBoard q={q} onWhere={props.onWhere} onCollect={() => props.onLens('collect')} />;
  })();

  // Where the level is standing: the category, then the subcategory. Each is a
  // step back out, and each renames the board and its five numbers.
  const deep = [
    // A ring is a step in its own right: the board's breadcrumb reads
    // "Great Britain · SL4 1QN · 30 minutes by car · Family · Playgrounds".
    ...(ringHere ? [{ label: `${level.name} · ${level.minutes ?? within} minutes by ${MODE_LABEL[level.mode ?? mode].toLowerCase()}`, onPress: (cat || sub) ? () => { props.onCat(''); props.onSub(''); } : undefined }] : []),
    ...(lens === 'category' && cat ? [{ label: names.cat ?? cat, onPress: sub ? () => props.onSub('') : undefined }] : []),
    ...(lens === 'category' && sub ? [{ label: names.sub ?? sub }] : []),
  ];
  const title = (lens === 'category' && sub ? names.sub : lens === 'category' && cat ? names.cat : null) ?? level.name;
  const kicker = lens === 'category' && sub ? `SUBCATEGORY · ${(names.cat ?? cat).toUpperCase()}`
    : lens === 'category' && cat ? `CATEGORY · ${names.subs ?? ''} SUBCATEGORIES`.replace(' · ', ' · ').trim()
    : lens === 'demand' ? `${kickerOf(level)} · LAST 30 DAYS`
    : kickerOf(level);

  return (
    <AdminPage>
      <Trail level={level} onUp={props.onUp} onWhere={props.onWhere} extra={deep}
             onSelf={() => { props.onCat(''); props.onSub(''); props.onLens('coverage'); }} />
      <Band kicker={kicker} title={title}
            stats={lens === 'demand' ? null : <Five stats={level.stats} ring={ringHere} kind={lens === 'category' && sub ? names.sub ?? null : null} needs={names.needs ?? null} />} />
      {/* The word that is underlined is the board you are on, not the word in
          the address — otherwise an outcode drew its categories under a lit
          "Coverage" (18 Sep 2026). */}
      {/* A postcode is a place on the map, so what belongs beside it is how far
          out to look — not another search box.
          BO2o puts the bands and the modes here and nothing else, and the owner
          said the same of SL5 (19 Sep 2026: "There's not supposed to be a
          postcode search box… What should be here is the toggle for 30 minutes,
          1 hour, 90 minutes… car, walk, or transit"). The search box stays
          everywhere above a postcode, which is where searching for one is the
          thing you came to do. */}
      <LensRow lens={lensHere} onLens={props.onLens}
               right={ringHere || (levelIsHere && level.areaKind === 'postcode')
                 ? <RingChooser minutes={ringHere ? level.minutes ?? within : 0} mode={level.mode ?? mode} onMinutes={props.onWithin}
                                /* Only where taking the ring away leaves a board to
                                   stand on: a postcode district. A full postcode has
                                   no area behind it, and a ring round a town would
                                   drop onto the town, which has no chooser to come
                                   back by (Codex, 20 Sep 2026). */
                                here={level.areaKind === 'postcode' || (level.fromKind === 'postcode' && level.area) ? level.name : null}
                                /* How you are travelling only means something inside a
                                   ring, so choosing it draws one at the first band —
                                   the same act as picking a way to travel in the search
                                   box, which has always drawn the ring. Otherwise the
                                   word lights nothing and the board does not move. */
                                onMode={(m) => { props.onBy(m); if (!ringHere) props.onWithin(BANDS[0]); }}
                                cells={level.cells} modesBuilt={level.modesBuilt} />
                 : <AreaSearch onWhere={props.onWhere} onPlace={props.onPlace} />} />
      {body}
    </AdminPage>
  );
}

const AREA_WORD: Record<string, string> = { country: 'COUNTRY', county: 'COUNTY', town: 'TOWN', postcode: 'POSTCODE DISTRICT' };

const kickerOf = (l: PlaceLevel) => {
  // A ring drawn round a town says TOWN, not POSTCODE: what it is drawn round is
  // a fact about the place, and the ring is how far out from it.
  // A ring says POSTCODE, not POSTCODE DISTRICT — BO2o spells it, and the
  // kicker already has the ring's own words after it to carry (17 Sep 2026).
  if (l.kind === 'ring') {
    const from = !l.fromKind || l.fromKind === 'postcode' ? 'POSTCODE' : (AREA_WORD[l.fromKind] ?? 'POSTCODE');
    return `${from} · ${l.minutes} MINUTES BY ${MODE_LABEL[l.mode ?? 'drive'].toUpperCase()}`;
  }
  return AREA_WORD[l.areaKind] ?? 'AREA';
};

/**
 * The way back up: the whole chain, not the last link.
 *
 * The boards read `← Great Britain · SL4 1QN · 30 minutes by car · Family ·
 * Playgrounds`, so a category and a subcategory are steps you can take back out
 * of rather than something you leave by a footer link (Codex, 17 Sep 2026).
 */
function Trail({ level, onUp, onWhere, onSelf, extra = [] }: {
  level: PlaceLevel; onUp: () => void; onWhere: (slug: string, opts?: { lens?: Lens }) => void;
  /** Back to the level itself, out of whatever is open over it. */
  onSelf?: () => void;
  /** The steps below the level itself — the ring, the category, the subcategory. */
  extra?: { label: string; onPress?: () => void }[];
}) {
  const up = level.trail[level.trail.length - 1] ?? null;
  if (!up && !extra.length) {
    // At the top of the ladder the only way back is out of the country.
    return (
      <View style={styles.trail}>
        <Press effect="none" onPress={onUp} accessibilityRole="button" accessibilityLabel="All countries" style={styles.trailBack}>
          <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
          <Text style={styles.trailWord}>All countries</Text>
        </Press>
      </View>
    );
  }
  const steps = [
    ...level.trail.map((t) => ({ label: t.label, onPress: () => onWhere(t.slug) })),
    // The level itself is a step you can go back to, not a label: from a
    // subcategory, tapping the county is how you leave the ladder.
    ...(extra.length && !extra[0].label.startsWith(level.name) ? [{ label: level.name, onPress: onSelf }] : []),
    ...extra,
  ];
  // The arrow is one step back — the last crumb before where you are now, and
  // never a step with nothing behind it (Codex, 17 Sep 2026).
  const back = [...steps].slice(0, -1).reverse().find((t) => t.onPress)?.onPress
    ?? (up ? () => onWhere(up.slug) : onUp);
  return (
    <View style={styles.trail}>
      <Press effect="none" onPress={back}
             accessibilityRole="button" accessibilityLabel="Back" style={styles.trailBack}>
        <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
      </Press>
      {steps.map((t, i) => (
        <React.Fragment key={`${t.label}-${i}`}>
          {i ? <Text style={styles.trailNote}>·</Text> : null}
          {t.onPress
            ? <Press effect="none" onPress={t.onPress} accessibilityRole="button" accessibilityLabel={t.label}>
                <Text style={styles.trailWord}>{t.label}</Text>
              </Press>
            : <Text style={i === steps.length - 1 ? styles.trailNote : styles.trailWord}>{t.label}</Text>}
        </React.Fragment>
      ))}
      {!extra.length && up
        ? <Text style={styles.trailNote}>{`· ${up.known.toLocaleString()} known · ${up.owned.toLocaleString()} owned`}</Text>
        : null}
    </View>
  );
}

/** The band: a kicker, the name at 31px, the figures to the right, one rule under. */
function Band({ kicker, title, stats, right }: { kicker: string; title: string; stats?: React.ReactNode; right?: React.ReactNode }) {
  const { width } = useViewport();
  return (
    <View style={styles.band}>
      <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
        <Kicker tip="sectionLevel">{kicker}</Kicker>
        <Text style={[styles.title, width < PHONE && styles.titlePhone]}>{title}</Text>
      </View>
      {stats}
      {right}
    </View>
  );
}

/**
 * A figure, or the em dash that means we hold none.
 *
 * Law 3 is about the whole screen, not about the table: printing `0` in the band
 * over a column of dashes said two different things about the same fact
 * (Codex, 17 Sep 2026).
 */
const said = (n: number | null | undefined) => (n ? n.toLocaleString() : '—');

/** The five numbers every level prints. */
function Five({ stats, ring, kind = null, needs = null }: {
  stats: PlaceStats; ring?: boolean;
  /** On a subcategory board the two per-kind figures say what *that* kind needs. */
  kind?: string | null; needs?: string[] | null;
}) {
  const readyTip = kind && needs?.length
    ? ([`Ready`, `${kindWord(kind)} is ready with ${listWords(needs.map((f) => NEEDS_WORD[f] ?? f))}. Nothing else counts against it.`] as const)
    : (ring ? 'readyShort' : 'ready');
  const scoreTip = kind
    ? ([`Average score`, `The mean data score of these ${stats.known.toLocaleString()} places, 0 to 100.`] as const)
    : ('avgScore' as const);
  // BO2l, "Places at 390": four figures in two columns, not seven in a row that
  // cannot fit. Claimed and the average score are the two the design leaves off
  // the phone — they are the finer read, and the phone is the glance.
  const { width } = useViewport();
  if (width < PHONE) {
    return (
      <View style={styles.fourGrid}>
        {/* Two rows of two rather than a wrapping row: a percentage flexBasis
            does not hold here, and the design's `1fr 1fr` is a grid, not a
            wrap (BO2l). */}
        <View style={styles.fourRow}>
          <View style={styles.fourCell}><Stat label="Known" value={said(stats.known)} tip="known" /></View>
          <View style={styles.fourCell}><Stat label="Owned" value={said(stats.owned)} tip="owned" /></View>
        </View>
        <View style={styles.fourRow}>
          <View style={styles.fourCell}><Stat label="Identified only" value={said(stats.identified)} tip="identifiedOnly" accent /></View>
          <View style={styles.fourCell}><Stat label="Ready" value={stats.ready == null ? '—' : `${stats.ready}%`} tip={readyTip} mark /></View>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.five}>
      <Stat label="Known" value={said(stats.known)} tip="known" />
      <Stat label="Owned" value={said(stats.owned)} tip="owned" />
      {/* Claimed is its own answer: a household said the place matters and we
          still hold nothing about it, which is the shortest list of places
          worth researching. It used to be folded into Owned, so coverage read
          better than it was (Codex, 17 Sep 2026). */}
      <Stat label="Claimed" value={said(stats.claimed)} tip="claimed" />
      <Stat label="Identified only" value={said(stats.identified)} tip="identifiedOnly" accent />
      <Stat label="Ready" value={stats.ready == null ? '—' : `${stats.ready}%`} tip={readyTip} mark />
      <Stat label="Avg score" value={stats.avgScore == null ? '—' : stats.avgScore} tip={scoreTip} mark />
    </View>
  );
}

/** CUT BY — the six lenses, the chosen one a flat lime word with a rule under it. */
function LensRow({ lens, onLens, right }: { lens: Lens; onLens: (l: Lens) => void; right?: React.ReactNode }) {
  // On a phone the label goes above the words rather than beside them: "Cut by"
  // plus six lenses is wider than the frame however the six are drawn, and the
  // row must stay one line of lenses (BO2l draws it clipped, ending "Qua…").
  const { width } = useViewport();
  const narrow = width < PHONE;
  return (
    <View style={styles.lensRow}>
      {/* No label in front of the lenses. The words are the menu and say what
          they are; "Cut by" was a heading for a control that needs none (owner,
          19 Sep 2026: "I don't understand what the 'Cut by' is in front of
          Coverage and Category. You can remove that. We just need the menu"). */}
      <View style={[styles.lensLeft, narrow && styles.lensLeftPhone, narrow && styles.lensLeftPhoneWidth]}>
        {/* BO2l draws this row clipped, ending in "Qua…" — six words will not
            fit 390 and must not be allowed to wrap into a block either. A
            sideways scroller keeps every lens reachable and the row one line. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.lenses}
                    style={narrow ? [styles.lensScrollPhone, { width: '100%' }] : { flexShrink: 1, minWidth: 0 }}>
          {/* All six, not one: the lens words are this board's main control and
              five of them said nothing on hover (18 Sep 2026, the separate
              audit). */}
          {LENSES.map((l) => (
            <Explain key={l} tip={LENS_TIP[l]} cursor="pointer">
              <Press effect="none" onPress={() => onLens(l)} accessibilityRole="tab"
                     accessibilityState={{ selected: lens === l }} accessibilityLabel={LENS_LABEL[l]}
                     style={[styles.lens, lens === l && styles.lensOn]}>
                <Text style={[styles.lensWord, lens === l && styles.lensWordOn]}>{LENS_LABEL[l]}</Text>
              </Press>
            </Explain>
          ))}
        </ScrollView>
      </View>
      {right}
    </View>
  );
}

/** 30 min · 1 hour · 90 min, by car, walking or transit. */
function RingChooser({ minutes, here, mode, onMinutes, onMode, cells, modesBuilt }: {
  /**
   * The band in force, or 0 on a board showing the postcode district itself.
   *
   * A list rather than three words, and the first band rather than nothing, is
   * the owner's (20 Sep 2026): "instead of it being 30 minutes, 1 hour, 90
   * minutes, can it please be a dropdown then… 5 minutes, which should be the
   * default". The district on its own is kept as the first choice in the list,
   * because it is the only way back to the census's own count — SL5 is 92
   * places and five minutes' drive of it is 113.
   */
  minutes: number | null;
  /** What the board is standing on, or null when there is nothing to stand on without a ring. */
  here: string | null;
  mode: string; onMinutes: (m: number) => void; onMode: (m: string) => void; cells: number | null;
  /** Which ways of getting about the matrix can answer here; undefined means "do not know, offer them all". */
  modesBuilt?: string[];
}) {
  const ring = minutes != null && minutes > 0;
  // With no ring and nowhere to stand still, the board is showing the first
  // band — the API draws one whether or not it was asked for — so the control
  // says that rather than naming a scope that is not on the screen.
  const chosen = ring ? bandLabel(minutes as number) : here ? `${here} only` : bandLabel(BANDS[0]);
  // While the list is open the explanation stands down: it is drawn over the
  // list, and the list is what you opened it to use (owner, 20 Sep 2026: "this
  // hover-over box keeps overlaying the dropdown so that I can't actually
  // interact with the dropdown").
  const [listOpen, setListOpen] = useState(false);
  return (
    <View style={styles.chooser}>
      <Explain tip={listOpen ? null : ['How far out', !ring || cells == null
        ? 'How far to look around this place. The driving time between every postcode area is worked out once, so answering this does no sums.'
        : `${cells.toLocaleString()} postcode areas are within ${bandLabel(minutes as number)} of here. That was worked out once, so answering this does no sums.`]}>
        <Dropdown label="How far" value={chosen} width={200} onOpenChange={setListOpen}
                  options={[
                    // Named, not "no ring": a list whose first line is an
                    // absence reads as a way of clearing the control rather
                    // than as a place to stand.
                    ...(here ? [{ key: '0', label: `${here} only`, on: !ring }] : []),
                    ...BANDS.map((b) => ({ key: String(b), label: bandLabel(b), on: minutes === b })),
                  ]}
                  onPick={(k) => onMinutes(Number(k))} />
      </Explain>
      <View style={styles.segment}>
        {MODES.map((m) => {
          // A way of getting about the matrix has not been built here cannot
          // answer, and a ring drawn in it comes back empty with nothing to
          // say why. The word stays — removing a control is the owner's call
          // — and says what it is waiting for (17 Sep 2026).
          const built = !modesBuilt || modesBuilt.includes(m);
          // Lit only once there is a ring, for the same reason the list says
          // the district's own name rather than a band: with no ring the board
          // is the district's own places, and a lit Car said it was half an
          // hour's drive — 92 places drawn under the chooser for 2,815 (owner,
          // 20 Sep 2026: "a minute ago there were a lot more … now suddenly
          // it's reduced significantly").
          const on = ring && mode === m;
          return (
            <Explain key={m} tip={built ? null : (['Not worked out yet', `The reachability matrix has not been built for ${MODE_LABEL[m].toLowerCase()} here. It is a free run, on Runs.`] as const)}>
              <Press effect="none" onPress={() => (built ? onMode(m) : undefined)} accessibilityRole="button"
                     disabled={!built}
                     accessibilityState={{ selected: on, disabled: !built }} accessibilityLabel={MODE_LABEL[m]}
                     style={[styles.segItem, on && styles.segItemOn]}>
                <Text style={[styles.segWord, on && styles.segWordOn, !built && styles.segWordOff]}>{MODE_LABEL[m]}</Text>
              </Press>
            </Explain>
          );
        })}
      </View>
    </View>
  );
}

/** A county, a town or a postcode. A full postcode opens the ring chooser. */
function AreaSearch({ onWhere, onPlace }: {
  onWhere: (slug: string, opts?: { within?: number | null; by?: string; lens?: Lens }) => void;
  /** A place found by name opens straight into its drawer. */
  onPlace: (ref: string) => void;
}) {
  const [q, setQ] = useState('');
  const [out, setOut] = useState<Awaited<ReturnType<typeof api.adminPlaceSearch>> | null>(null);
  const [band, setBand] = useState(BANDS[0]);
  const [mode] = useState<string>('drive');
  useEffect(() => {
    if (q.trim().length < 2) { setOut(null); return; }
    const t = setTimeout(() => { api.adminPlaceSearch(q.trim()).then(setOut).catch(() => setOut(null)); }, 220);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <View style={{ width: 280, flexGrow: 0 }}>
      <View style={styles.search}>
        <Icon name="search" size={15} strokeWidth={2} color={colors.inkMuted} />
        {/* A name is the obvious thing to type, so the box says it takes one. */}
        <TextInput value={q} onChangeText={setQ} placeholder="A county, town, postcode or place"
                   placeholderTextColor={colors.inkMuted} style={styles.searchInput}
                   accessibilityLabel="Search for a county, town, postcode or place" />
      </View>
      {out && !out.areas.length && !out.postcode && !(out.places ?? []).length && !(out.elsewhere ?? []).length ? (
        // Never nothing. A box that does nothing when you type into it reads as
        // broken, and this one did (owner, 18 Sep 2026: "when I search for
        // Sunningdale, nothing happens").
        <View style={styles.suggest}>
          <View style={styles.suggestRow}><Text style={styles.suggestKind}>Nothing here by that name.</Text></View>
        </View>
      ) : null}
      {out && (out.areas.length || out.postcode || (out.places ?? []).length || (out.elsewhere ?? []).length) ? (
        <View style={styles.suggest}>
          {out.postcode ? (
            <View style={styles.suggestPostcode}>
              <Text style={styles.suggestName}>{out.postcode.label}</Text>
              <View style={styles.suggestBands}>
                {BANDS.map((b) => (
                  <Press key={b} effect="none" accessibilityRole="button" accessibilityState={{ selected: band === b }}
                         accessibilityLabel={`${out.postcode!.label} within ${bandLabel(b)}`}
                         onPress={() => setBand(b)} style={[styles.suggestBand, band === b && styles.segItemOn]}>
                    <Text style={[styles.segWord, band === b && styles.segWordOn]}>{bandLabel(b)}</Text>
                  </Press>
                ))}
              </View>
              {/* Both choosers, as the board draws them: how far out, and how
                  you are getting there. */}
              <View style={styles.suggestBands}>
                {MODES.map((m) => (
                  <Press key={m} effect="none" accessibilityRole="button" accessibilityState={{ selected: mode === m }}
                         accessibilityLabel={MODE_LABEL[m]}
                         onPress={() => { const label = out.postcode!.label.toLowerCase().replace(/\s+/g, '-'); setQ(''); setOut(null); onWhere(label, { within: band, by: m }); }}
                         style={[styles.suggestBand, mode === m && styles.segItemOn]}>
                    <Text style={[styles.segWord, mode === m && styles.segWordOn]}>{MODE_LABEL[m]}</Text>
                  </Press>
                ))}
              </View>
            </View>
          ) : null}
          {out.areas.map((a) => (
            <Press key={a.slug} effect="none" accessibilityRole="button" accessibilityLabel={a.name}
                   onPress={() => { setQ(''); setOut(null); onWhere(a.slug, intoArea(a.kind)); }} style={styles.suggestRow}>
              <Text style={styles.suggestName}>{a.name}</Text>
              <Text style={styles.suggestKind}>
                {[a.parent ? `${a.kind} · ${a.parent}` : a.kind,
                  a.known == null ? null : a.known ? `${a.known.toLocaleString()} known` : 'we hold none',
                ].filter(Boolean).join(' · ')}
              </Text>
            </Press>
          ))}
          {/* A town the open map knows and we hold no area for: it opens the
              outcode it sits in, because that is a board we can draw. The row
              says so rather than pretending we have a Sunningdale board. */}
          {(out.elsewhere ?? []).map((e) => (
            <Press key={e.slug + e.name} effect="none" accessibilityRole="button" accessibilityLabel={`${e.name} — opens ${e.outcode}`}
                   onPress={() => { setQ(''); setOut(null); onWhere(e.slug, intoArea('postcode')); }} style={styles.suggestRow}>
              <Text style={styles.suggestName}>{e.name}</Text>
              <Text style={styles.suggestKind}>
                {[`${e.kind} · opens ${e.outcode}`, e.known ? `${e.known.toLocaleString()} known` : 'we hold none', e.where]
                  .filter(Boolean).join(' · ')}
              </Text>
            </Press>
          ))}
          {(out.places ?? []).map((pl) => (
            <Press key={pl.ref} effect="none" accessibilityRole="button" accessibilityLabel={pl.name}
                   onPress={() => { setQ(''); setOut(null); onPlace(pl.ref); }} style={styles.suggestRow}>
              <Text style={styles.suggestName}>{pl.name}</Text>
              <Text style={styles.suggestKind}>{pl.where ? `place · ${pl.where}` : 'place'}</Text>
            </Press>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const Waiting = () => <View style={{ paddingVertical: spacing.xl, alignItems: 'flex-start' }}><ActivityIndicator color={colors.accent} /></View>;

/**
 * A board that could not be read, said so.
 *
 * The alternative was worse than useless: a failed request fabricated an empty
 * dataset with noughts in every column, so a network fault, an expired session
 * and a county with nothing in it all drew the same board — and a collection
 * decision made off that is made off a number that was never true (Codex, 19 Sep
 * 2026). This is the back office, so it says what actually went wrong rather
 * than the one sentence the app would give a household.
 */
const Trouble = ({ why, onRetry }: { why: string; onRetry: () => void }) => (
  <View style={{ paddingVertical: spacing.xl, alignItems: 'flex-start', gap: spacing.sm }}>
    <Word muted>{why}</Word>
    <Act label="Try again" tone="secondary" onPress={onRetry} />
  </View>
);

// ---------------------------------------------------------------------------
// BO2a / BO2n — the level, cut by county, city or postcode district
// ---------------------------------------------------------------------------

function BreakdownBoard({ q, by, onBy, onWhere, onCollectIn, canManage }: {
  q: any; by: By; onBy: (b: string) => void; canManage: boolean;
  onWhere: (slug: string, opts?: { within?: number | null; by?: string; lens?: Lens }) => void;
  onCollectIn: (slug: string) => void;
}) {
  const [data, setData] = useState<{ rows: PlaceAreaRow[]; all: number; totals: PlaceStats } | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  // In the address: the board's own URL carries `&sort=empty.desc`, and a board
  // you cannot send somebody is half a board (Codex, 17 Sep 2026).
  const [sort, setSort] = useQueryState<string>('sort', 'searches', asText);
  const [desc, setDesc] = useQueryState<boolean>('desc', true, { read: (r) => r !== '0', write: (v) => (v ? null : '0') });
  const load = useCallback(() => {
    setData(null); setWhy(null);
    api.adminPlaceBreakdown({ ...q, by, sort, desc: desc ? undefined : '0' })
      .then(setData)
      .catch((e) => setWhy(e?.message || 'That board could not be read.'));
  }, [q, by, sort, desc]);
  useEffect(load, [load]);

  const columns: Col<PlaceAreaRow>[] = [
    // The note belongs to the board, not to the component. BO2a's *County*
    // heading is bare; BO2n's *City or town* carries "8 of 1,204", because that
    // is the one that is a slice of something much longer (audit, 18 Sep 2026).
    { key: 'name', label: BY_LABEL[by],
      note: by !== 'county' && data ? `${data.rows.length.toLocaleString()} of ${data.all.toLocaleString()}` : undefined,
      tip: by === 'county' ? 'county' : by === 'city' ? 'cityOrTown' : 'whereRow',
      grow: true, sort: 'name',
      cell: (r) => (
        <View style={styles.nameCell}>
          <Text style={styles.rowName}>{r.name}</Text>
          {r.parent ? <Text style={styles.rowNote}>{r.parent}</Text> : null}
        </View>
      ) },
    { key: 'known', label: 'Known', tip: 'known', width: 110, align: 'right', sort: 'known', cell: (r) => <Num n={r.known || null} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 100, align: 'right', sort: 'owned', cell: (r) => <Num n={r.owned || null} /> },
    { key: 'ident', label: 'Identified only', tip: 'identifiedOnly', width: 150, align: 'right', sort: 'identified', cell: (r) => <Num n={r.identified || null} /> },
    { key: 'ready', label: 'Ready', tip: 'ready', width: 110, align: 'right', sort: 'ready', cell: (r) => <Pct v={r.ready} strong min={52} /> },
    { key: 'score', label: 'Avg score', tip: 'avgScore', width: 120, align: 'right', sort: 'score', cell: (r) => <Num n={r.avgScore} /> },
    // BO2a prints "30 days" under Searches and BO2n does not — the same
    // component, two boards, one note (audit, 18 Sep 2026).
    { key: 'searches', label: 'Searches', note: by === 'county' ? '30 days' : undefined, tip: 'searches', width: 130, align: 'right', sort: 'searches', cell: (r) => <Num n={r.searches || null} /> },
    { key: 'empty', label: 'Came back empty', note: 'of those searches', tip: 'empty', width: 160, align: 'right', sort: 'empty',
      cell: (r) => <Num n={r.empty || null} accent={r.empty > 0 && r.searches > 0 && r.empty / r.searches > 0.2} strong={r.empty > 0} /> },
  ];

  // The one to collect in is the biggest hole, not the top of whatever sort you
  // happen to be under. The board names Greater Manchester on a list ordered by
  // Known, because its Came back empty dwarfs everything else (Codex, 17 Sep).
  const worst = useMemo(() => {
    const rows = data?.rows ?? [];
    if (!rows.length) return null;
    const holes = rows.filter((r) => r.searches > 0);
    if (holes.length) return [...holes].sort((a, b) => b.empty - a.empty || b.searches - a.searches)[0];
    return [...rows].sort((a, b) => (a.ready ?? 0) - (b.ready ?? 0) || b.known - a.known)[0];
  }, [data]);
  return (
    <>
      <View style={styles.subRow}>
        <Kicker tip="sectionBreakDown">Break it down by</Kicker>
        <View style={styles.lenses}>
          {BY.map((b) => (
            <Explain key={b} tip={b === 'city' ? 'cityOrTown' : null} cursor="pointer">
              <Press effect="none" onPress={() => onBy(b)} accessibilityRole="tab"
                     accessibilityState={{ selected: by === b }} accessibilityLabel={BY_LABEL[b]}
                     style={[styles.lens, by === b && styles.lensOn]}>
                <Text style={[styles.lensWord, by === b && styles.lensWordOn]}>{BY_LABEL[b]}</Text>
              </Press>
            </Explain>
          ))}
        </View>
      </View>
      {data ? (
        <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.slug}
                onRow={(r) => onWhere(r.slug, intoArea(r.kind))}
                highlight={(r) => r.slug === worst?.slug}
                /* The address writes `sort=empty.desc` and the column is keyed
                   `empty`, so the header compared the two and never matched —
                   the rows sorted correctly and nothing said which column they
                   were sorted by (audit, 18 Sep 2026). */
                sort={sort.split('.')[0]} desc={desc}
                onSort={(k) => { if (k === sort.split('.')[0]) setDesc(!desc); else { setSort(k); setDesc(true); } }}
                /* BO2l's stacked row: the county, what we know there, and the
                   figures as chips. */
                phoneRow={(r) => ({
                  name: r.name,
                  note: `${BY_LABEL[by].toLowerCase()} · ${r.known.toLocaleString()} known`,
                  chips: [
                    { key: 'ready', word: `ready ${r.ready == null ? '—' : `${r.ready}%`}`, tip: 'ready', lead: true },
                    { key: 'owned', word: `owned ${r.owned.toLocaleString()}`, tip: 'owned' },
                    { key: 'ident', word: `identified only ${r.identified.toLocaleString()}`, tip: 'identifiedOnly' },
                    ...(r.searches ? [{ key: 'searches', word: `${r.searches.toLocaleString()} searches`, tip: 'searches' as const }] : []),
                  ],
                })}
                empty={<Word muted>Nothing indexed here yet.</Word>} />
      ) : why ? <Trouble why={why} onRetry={load} /> : <Waiting />}
      <Footer>
        <Explain tip="addACountry"><Act label="Add a country" tone="secondary" disabled onPress={() => {}} /></Explain>
        {/* Where the gap is, on the Collect lens — the same door every other
            board's Collect opens (Codex, 17 Sep 2026). */}
        {worst ? <Act label={`Collect in ${worst.name}`} icon="download" disabled={!canManage} onPress={() => onCollectIn(worst.slug)} /> : null}
      </Footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// BO2b — a county's coverage: towns and outcodes together
// ---------------------------------------------------------------------------

function CoverageBoard({ q, onWhere, onCollect }: {
  q: any; onWhere: (slug: string, opts?: { lens?: Lens }) => void; onCollect: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceCoverage>> | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  // The catch used to set the *loading* state, so a board that could not be read
  // span for ever and never said why (Codex, 19 Sep 2026, the same fault as the
  // breakdown's noughts wearing the other mask).
  const load = useCallback(() => {
    setData(null); setWhy(null);
    api.adminPlaceCoverage(q).then(setData).catch((e) => setWhy(e?.message || 'That board could not be read.'));
  }, [q]);
  useEffect(load, [load]);

  const columns: Col<PlaceCoverageRow>[] = [
    { key: 'name', label: 'Where', tip: 'whereRow', grow: true,
      cell: (r) => (
        <View style={styles.nameCell}>
          <Text style={styles.rowName}>{r.name}</Text>
          <Text style={styles.rowNote}>{r.kind === 'postcode' ? (r.within ? `outcode · ${r.within}` : 'outcode') : 'town'}</Text>
        </View>
      ) },
    { key: 'known', label: 'Known', tip: 'known', width: 92, align: 'right', cell: (r) => <Num n={r.known || null} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 82, align: 'right', cell: (r) => <Num n={r.owned || null} /> },
    { key: 'ready', label: 'Ready', tip: 'ready', width: 104, align: 'right', cell: (r) => <Pct v={r.ready} strong min={52} /> },
    { key: 'picture', label: 'Picture', tip: 'pictureFact', width: 92, align: 'right', cell: (r) => <Pct v={r.picture} min={48} /> },
    { key: 'description', label: 'Description', tip: 'whatItIsFact', width: 104, align: 'right', cell: (r) => <Pct v={r.description} min={48} /> },
    { key: 'hours', label: 'Hours', tip: 'openingHours', width: 84, align: 'right', cell: (r) => <Pct v={r.hours} min={48} /> },
    { key: 'website', label: 'Website', tip: 'website', width: 84, align: 'right', cell: (r) => <Pct v={r.website} min={48} /> },
    { key: 'menu', label: 'Menu', tip: 'menu', width: 84, align: 'right', cell: (r) => <Pct v={r.menu} min={48} /> },
    { key: 'shelf', label: 'Shelf', tip: 'shelf', width: 84, align: 'right', cell: (r) => <Pct v={r.shelf} min={48} /> },
  ];

  return (
    <>
      {/* The counts line and the refresh button are gone (owner, 18 Sep 2026:
          "remove all of that. I don't want any prose"). The heading names the
          board; how stale a figure is belongs on the figure, not in a sentence
          above the table. Refreshing them is on Runs, where the other rebuilds
          are. */}
      <View style={styles.subRow}>
        <Kicker tip="sectionWhere">Where</Kicker>
        <View style={{ flex: 1 }} />
      </View>
      {data ? (
        <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.slug}
                onRow={(r) => onWhere(r.slug, intoArea(r.kind))}
                /* "County" was printed whatever the level was, so an outcode
                   was told nothing was indexed under a county (owner, 18 Sep
                   2026: "SL5 is not a county, it is a postcode"). */
                empty={<Word muted>Nothing indexed here yet.</Word>}
                /* BO2l, "Places at 390": the name, what kind of place and how
                   many we know there, then the four facts as chips. The
                   design's own words — "what it is", not "Description" — and
                   Ready leads, because Ready is what the row is about. */
                phoneRow={(r) => ({
                  name: r.name,
                  note: `${r.kind === 'postcode' ? 'outcode' : 'town'} · ${r.known.toLocaleString()} known`,
                  chips: [
                    { key: 'ready', word: `ready ${r.ready == null ? '—' : `${r.ready}%`}`, tip: 'ready', lead: true },
                    { key: 'picture', word: `picture ${r.picture == null ? '—' : `${r.picture}%`}`, tip: 'pictureFact' },
                    { key: 'what', word: `what it is ${r.description == null ? '—' : `${r.description}%`}`, tip: 'whatItIsFact' },
                    { key: 'menu', word: `menu ${r.menu == null ? '—' : `${r.menu}%`}`, tip: 'menu' },
                  ],
                })} />
      ) : why ? <Trouble why={why} onRetry={load} /> : <Waiting />}
      <Footer>
        {/* Collect lives inside Places, and this is the door to it: the lens that
            says what could be got here, which sources could supply it, and what
            each would cost. It used to land on the category ladder. */}
        <Act label="Collect here" icon="download" onPress={onCollect} />
      </Footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// BO2c / BO2o / BO2p — the category ladder, driven by the taxonomy
// ---------------------------------------------------------------------------

function CategoryBoard({ q, cat, onCat, onSub, canManage, onNames, onWiden, within, onCollect, areaKind }: {
  /** What kind of area the board is standing on — an outcode reads like a ring. */
  areaKind?: string | null;
  q: any; cat: string; onCat: (c: string) => void; onSub: (s: string) => void; canManage: boolean;
  /** Collect lives inside Places, so every one of these opens its lens. */
  onCollect: () => void;
  onNames: (n: { cat?: string; sub?: string; subs?: number; needs?: string[] }) => void;
  onWiden: (m: number) => void; within: number | null;
}) {
  const [hideFull, setHideFull] = useState(false);
  // Subcategories, or every provider's own word for a kind of place. Both are
  // driven by the vocabulary rather than by the data, so an empty one is the
  // finding either way.
  const [by, setBy] = useQueryState<'subcategories' | 'labels'>('words', 'subcategories', asOneOf(['subcategories', 'labels'] as const, 'subcategories'));
  const [data] = useFresh(
    JSON.stringify(['categories', q, cat, by]),
    () => api.adminPlaceCategories({ ...q, cat: cat || undefined, words: by === 'labels' ? 'labels' : undefined }),
  );

  // The words the boards use: "a picture, what it is, opening hours".
  const factLabel = useMemo(() => new Map(Object.entries(NEEDS_WORD)), []);
  const open = data?.categories.find((x) => x.key === cat) ?? null;
  // The band above needs this board's own words for the level it is standing on.
  useEffect(() => {
    onNames({ cat: open?.label, subs: open?.subcategories.length ?? data?.subcategories });
  }, [open, data, onNames]);

  // Held here rather than in the address: eight rows re-order in the hand, and a
  // board whose headings do nothing when you click them is a board that looks
  // broken (owner, 19 Sep 2026: "I should be able to sort on the column headers
  // as well. That's not working").
  //
  // Above the one-category branch below, not beside the board that uses it: a
  // hook after an early return is a different number of hooks on the render
  // that opens a category, and React throws the whole screen away rather than
  // draw it (20 Sep 2026 — "Epic stopped working", then Try again worked,
  // because a remount reads the category straight off the address).
  const [catSort, setCatSort] = useState<string>('known');
  const [catDesc, setCatDesc] = useState(true);

  // One category open: its subcategories, every one of them, the empty ones
  // included — "an empty subcategory is the finding" (BO2p).
  if (cat) {
    const c = open;
    return (
      <>
        {data && c ? (
          <>
            {/* Where the subcategories actually are. It used to sit above the
                whole board, which is where the board no longer lists any. */}
            <View style={styles.subRow}>
              <View style={{ flex: 1 }} />
              <Act label={hideFull ? `Show me all ${c.subcategories.length}` : `Hide the ones with places · ${c.subcategories.filter((x) => x.known > 0).length}`}
                   tone="secondary" onPress={() => setHideFull(!hideFull)} />
            </View>
            <SubcategoryLadder rows={hideFull ? c.subcategories.filter((x) => x.known === 0) : c.subcategories}
                               onSub={onSub} factLabel={factLabel} canManage={canManage}
                               inRing={q.within != null} of={c.subcategories.length} onCollect={onCollect} />
          </>
        ) : <Waiting />}
        <Footer>
          {q.within != null && widerThan(within)
            ? <Act label={`Widen to ${bandLabel(widerThan(within) as number)}`} tone="secondary" onPress={() => onWiden(widerThan(within) as number)} />
            : null}
          {c ? <Act label={`Collect ${c.label.toLowerCase()} places here`} icon="download" disabled={!canManage} onPress={onCollect} /> : null}
        </Footer>
      </>
    );
  }

  // The category lens shows categories. Every level, collapsed, and a category
  // opens its subcategories in place.
  //
  // A ring and an outcode always did; a country, a county and a town went
  // straight to all fifty-nine subcategories under their category headings,
  // which is a page you read rather than a board you act on (owner, 19 Sep
  // 2026: "I click on City, and I click on Categories. The categories should be
  // collapsed, but at the moment they're expanded, so you can see all the
  // subcategories"). BO2c's rule — every subcategory listed, the empty ones
  // included, because an empty one is the finding — is kept exactly, one click
  // in, which is where BO2p already puts it.
  const ring = q.within != null || areaKind === 'postcode';
  const all = data?.categories ?? [];
  const flat = all.flatMap((c) => c.subcategories.map((s) => ({ ...s, categoryLabel: c.label })));
  const shown = hideFull ? flat.filter((s) => s.known === 0) : flat;
  const withPlaces = flat.filter((s) => s.known > 0).length;

  // Sorted in the hand. `label` is a word and everything else is a figure, and a
  // figure nobody has — a category with no places and so no average — sorts to
  // the bottom whichever way round it is asked for, because "we do not know" is
  // not a small number.
  const sortedCats = [...all].sort((a: any, b: any) => {
    if (catSort === 'label') return (catDesc ? -1 : 1) * String(a.label).localeCompare(String(b.label));
    const av = a[catSort]; const bv = b[catSort];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (catDesc ? -1 : 1) * (Number(av) - Number(bv));
  });

  const catColumns: Col<PlaceCategory>[] = [
    { key: 'label', label: 'Our category', note: `${all.length} of ${all.length}`, tip: 'ourCategory', grow: true, sort: 'label',
      cell: (c) => (
        <View style={styles.nameCell}>
          <Text style={styles.rowName}>{c.label}</Text>
          <Text style={styles.rowNote}>{`${c.subcategories.length} subcategories`}</Text>
        </View>
      ) },
    { key: 'known', label: 'Known', tip: 'known', width: 96, align: 'right', sort: 'known', cell: (c) => <Num n={c.known || null} /> },
    { key: 'showable', label: 'Can show', width: 104, align: 'right', sort: 'showable',
      tip: ['Can show', 'How many of them a household could actually be shown: we hold a name for them that is ours to show. The rest are real places known to us only by a provider\u2019s identifier — they count as Known, and they are why the app lists fewer than this board does.'],
      cell: (c) => <Num n={c.showable || null} strong accent={Boolean(c.known) && (c.showable ?? 0) < c.known / 2} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 96, align: 'right', sort: 'owned', cell: (c) => <Num n={c.owned || null} /> },
    { key: 'ident', label: 'Identified only', tip: 'identifiedOnly', width: 140, align: 'right', sort: 'identified', cell: (c) => <Num n={c.identified || null} /> },
    { key: 'ready', label: 'Ready', tip: 'readyShort', width: 104, align: 'right', sort: 'ready', cell: (c) => <Pct v={c.ready} strong min={52} /> },
    { key: 'score', label: 'Avg score', tip: 'avgScoreCategory', width: 110, align: 'right', sort: 'avgScore', cell: (c) => <Num n={c.avgScore} /> },
    { key: 'searches', label: 'Searches', note: '30 days', tip: ring ? 'searchesRing' : 'searches', width: 104, align: 'right', sort: 'searches', cell: (c) => <Num n={c.searches || null} /> },
    { key: 'empty', label: 'Came back empty', note: 'of those searches', tip: 'empty', width: 134, align: 'right', sort: 'empty',
      cell: (c) => <Num n={c.empty || null} strong={c.empty > 0} accent={c.searches > 0 && c.empty === c.searches} /> },
    { key: 'go', label: '', width: 78, align: 'right', stops: true,
      cell: (c) => (c.known > 0
        ? <Icon name="more" size={15} strokeWidth={2} color={colors.inkMuted} />
        : <Act label="Collect" small tone="secondary" disabled={!canManage} onPress={onCollect} />) },
  ];

  return (
    <>
      {!ring ? (
        <View style={styles.subRow}>
          <View style={{ flex: 1 }} />
          {/* Our own drawers, or every provider's own word for a kind of place.
              Both listed whole, because an empty one is the finding. */}
          <View style={styles.segment}>
            {(['subcategories', 'labels'] as const).map((k) => (
              <Press key={k} effect="none" onPress={() => setBy(k)} accessibilityRole="tab"
                     accessibilityState={{ selected: by === k }} accessibilityLabel={k === 'labels' ? 'Labels' : 'Subcategories'}
                     style={[styles.segItem, by === k && styles.segItemOn]}>
                <Text style={[styles.segWord, by === k && styles.segWordOn]}>{k === 'labels' ? 'Labels' : 'Subcategories'}</Text>
              </Press>
            ))}
          </View>
        </View>
      ) : null}
      {!data ? <Waiting /> : by === 'labels' ? (
        <LabelLadder rows={data.labels ?? []} />
      ) : (
        <Ladder columns={catColumns} rows={sortedCats} keyOf={(c) => c.key} onRow={(c) => onCat(c.key)}
                sort={catSort} desc={catDesc}
                onSort={(k) => { if (k === catSort) setCatDesc(!catDesc); else { setCatSort(k); setCatDesc(true); } }}
                highlight={(c) => c.searches > 0 && c.empty / Math.max(1, c.searches) > 0.2}
                /* BO2l's stacked row. Eight columns of figures will not fit 390
                   whatever you do to them, and this board is now where an
                   outcode lands (18 Sep 2026). */
                phoneRow={(c) => ({
                  name: c.label,
                  note: `${c.subcategories.length} subcategories · ${c.known.toLocaleString()} known`,
                  chips: [
                    { key: 'ready', word: `ready ${c.ready == null ? '—' : `${c.ready}%`}`, tip: 'readyShort', lead: true },
                    { key: 'owned', word: `owned ${c.owned.toLocaleString()}`, tip: 'owned' },
                    { key: 'ident', word: `identified only ${c.identified.toLocaleString()}`, tip: 'identifiedOnly' },
                    ...(c.searches ? [{ key: 'searches', word: `${c.searches.toLocaleString()} searches`, tip: 'searches' as const }] : []),
                  ],
                })} />
      )}
      <Footer>
        {/* The board's own footer word for the same act as the switch above: show
            me only the ones with nothing in them. */}
        {!ring && !hideFull && flat.length - withPlaces > 0
          ? <Act label={`Show me just the ${flat.length - withPlaces}`} tone="secondary" onPress={() => setHideFull(true)} />
          : null}
        {q.within != null && widerThan(within)
          ? <Act label={`Widen to ${bandLabel(widerThan(within) as number)}`} tone="secondary" onPress={() => onWiden(widerThan(within) as number)} />
          : null}
        <Act label={q.within != null ? 'Collect in this ring' : 'Collect here'} icon="download" disabled={!canManage} onPress={onCollect} />
      </Footer>
    </>
  );
}

/**
 * BO2c's other half — every provider's own word for a kind of place.
 *
 * Driven by the vocabulary, not by the data: a word we have written a rule for
 * and nothing lands on is as much a finding as an empty drawer.
 */
function LabelLadder({ rows }: { rows: PlaceLabel[] }) {
  const columns: Col<PlaceLabel>[] = [
    { key: 'label', label: 'Their word', tip: 'ourLabel', grow: true,
      cell: (l) => (
        <View style={styles.nameCell}>
          <Text style={[styles.rowName, l.known === 0 && styles.rowNameEmpty]}>{l.label}</Text>
          <Text style={styles.rowNote}>{l.key}</Text>
        </View>
      ) },
    { key: 'points', label: 'Points at', tip: 'pointsAt', width: 200, align: 'left',
      cell: (l) => (l.pointsAt ? <Word muted>{l.pointsAt}</Word> : <Blank />) },
    { key: 'known', label: 'Known', tip: 'known', width: 96, align: 'right', cell: (l) => <Num n={l.known || null} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 88, align: 'right', cell: (l) => <Num n={l.owned || null} /> },
    { key: 'ready', label: 'Ready', tip: 'ready', width: 96, align: 'right', cell: (l) => <Pct v={l.ready} min={48} /> },
    { key: 'score', label: 'Avg score', tip: 'avgScore', width: 104, align: 'right', cell: (l) => <Num n={l.avgScore} /> },
  ];
  return <Ladder columns={columns} rows={rows} keyOf={(l) => l.key} highlight={(l) => l.known === 0}
                 phoneRow={(l) => ({
                   name: l.label,
                   note: l.known ? `${l.known.toLocaleString()} known` : 'nothing lands on it',
                   chips: [
                     ...(l.pointsAt ? [{ key: 'points', word: l.pointsAt, tip: 'pointsAt' as const, lead: true }] : []),
                     ...(l.known ? [
                       { key: 'owned', word: `owned ${(l.owned ?? 0).toLocaleString()}`, tip: 'owned' as const },
                       { key: 'ready', word: `ready ${l.ready == null ? '—' : `${l.ready}%`}`, tip: 'ready' as const },
                     ] : []),
                   ],
                 })}
                 empty={<Word muted>No words have been taught yet.</Word>} />;
}

function SubcategoryLadder({ rows, onSub, factLabel, canManage, inRing, of, groupOfCategory, onCollect }: {
  rows: (PlaceCategory['subcategories'][number] & { categoryLabel?: string })[];
  onSub: (s: string) => void; factLabel: Map<string, string>; canManage: boolean; inRing: boolean;
  onCollect?: () => void;
  /** How many there are at all, so the header can say "9 of 9". */
  of?: number;
  /** The category a group heading belongs to, so the heading carries its figures. */
  groupOfCategory?: (key: string) => PlaceCategory | null;
}) {
  /**
   * Which of a subcategory's required facts is the one that sets it apart.
   *
   * A fact the others on this ladder do not all need. The board draws that one
   * in ink and the rest muted — "picture, what it is, hours, **a menu**" —
   * because the menu is the whole reason a restaurant's bar is not a museum's.
   * `needsStrong` was defined and never used (17 Sep 2026, the verification
   * audit).
   */
  const { width: ladderWidth } = useViewport();
  const judged = useMemo(() => rows.filter((r: any) => r.barSet && (r.needs ?? []).length), [rows]);
  const setsItApart = useCallback(
    (fact: string) => judged.length >= 2 && !judged.every((r: any) => (r.needs ?? []).includes(fact)),
    [judged],
  );

  const columns: Col<any>[] = [
    // BO2p, inside a ring, carries "9 of 9"; BO2c, a county's subcategories,
    // has a bare heading. One component, two boards (audit, 18 Sep 2026).
    { key: 'label', label: 'Our subcategory', note: inRing && of ? `${rows.length} of ${of}` : undefined, tip: 'ourSubcategory', grow: true,
      cell: (s) => <Text style={[styles.rowName, s.known === 0 && styles.rowNameEmpty]}>{s.label}</Text> },
    { key: 'known', label: 'Known', tip: 'known', width: 90, align: 'right', cell: (s) => <Num n={s.known || null} /> },
    { key: 'showable', label: 'Can show', width: 100, align: 'right',
      tip: ['Can show', 'How many of them a household could actually be shown: we hold a name for them that is ours to show. The rest are real places known to us only by a provider\u2019s identifier.'],
      cell: (s) => <Num n={s.showable || null} strong accent={Boolean(s.known) && (s.showable ?? 0) < s.known / 2} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 88, align: 'right', cell: (s) => <Num n={s.owned || null} /> },
    ...(inRing ? [{ key: 'ident', label: 'Identified only', tip: 'identifiedOnly', width: 140, align: 'right', cell: (s: any) => <Num n={s.identified || null} /> } as Col<any>] : []),
    { key: 'ready', label: 'Ready', tip: inRing ? 'readyShort' : 'ready', width: 96, align: 'right', cell: (s) => <Pct v={s.ready} min={48} /> },
    { key: 'score', label: 'Avg score', tip: inRing ? 'avgScoreSubcategory' : 'avgScore', width: 104, align: 'right', cell: (s) => <Num n={s.avgScore} /> },
    ...(inRing
      ? ([
          { key: 'searches', label: 'Searches', tip: 'searchesRing', width: 104, align: 'right', cell: (s: any) => <Num n={s.searches || null} /> },
          { key: 'empty', label: 'Came back empty', tip: 'empty', width: 134, align: 'right',
            cell: (s: any) => <Num n={s.empty || null} strong={s.empty > 0} accent={s.searches > 0 && s.empty === s.searches} /> },
        ] as Col<any>[])
      : ([
          { key: 'needs', label: 'What it needs', tip: 'whatItNeeds', width: 300, align: 'left', stops: true,
            cell: (s: any) => (s.known === 0
              ? <Act label="Go and find some" icon="download" small disabled={!canManage} onPress={() => onCollect?.()} />
              : s.barSet
                ? (
                  // The distinguishing fact in ink, as the board draws it: a
                  // restaurant differs from its siblings by needing a menu, and
                  // that is the word worth seeing. `needsStrong` was defined
                  // and never used (17 Sep 2026, the verification audit).
                  <Text style={styles.needs}>
                    {s.needs.map((f: string, i: number) => (
                      <Text key={f} style={setsItApart(f) ? styles.needsStrong : undefined}>
                        {`${i ? ', ' : ''}${factLabel.get(f) ?? f}`}
                      </Text>
                    ))}
                  </Text>
                )
                : <Word muted>not set</Word>) },
        ] as Col<any>[])),
    ...(inRing ? ([{ key: 'go', label: '', width: 78, align: 'right', stops: true,
      cell: (s: any) => (s.known > 0
        ? <Icon name="more" size={15} strokeWidth={2} color={colors.inkMuted} />
        : <Act label="Collect" small tone="secondary" disabled={!canManage} onPress={() => onCollect?.()} />) }] as Col<any>[]) : []),
  ];
  return (
    <Ladder columns={columns} rows={rows} keyOf={(s) => s.key}
            onRow={(s) => (s.known > 0 ? onSub(s.key) : undefined)}
            highlight={(s) => s.known === 0}
            /* BO2l's stacked row. "What it needs" is left off: it is a list of
               words per row, and on a phone it belongs to the subcategory's own
               page rather than to a glance down a list. */
            phoneRow={(s: any) => ({
              name: s.label,
              note: s.known ? `${s.known.toLocaleString()} known` : 'we hold none',
              chips: s.known ? [
                { key: 'ready', word: `ready ${s.ready == null ? '—' : `${s.ready}%`}`, tip: 'ready', lead: true },
                { key: 'owned', word: `owned ${(s.owned ?? 0).toLocaleString()}`, tip: 'owned' },
                { key: 'score', word: `score ${s.avgScore == null ? '—' : s.avgScore}`, tip: 'avgScore' },
              ] : [],
            })}
            // The heading row carries the category's own totals in the same
            // columns the rows under it use — the board prints them, and a
            // heading with no figures is a heading you cannot read a table by.
            groupOf={groupOfCategory
              ? (s, prev) => {
                  if (prev && prev.category === s.category) return null;
                  const c = groupOfCategory(s.category);
                  if (!c) return null;
                  // A phone has no columns to line up with, so the heading is
                  // the name and its figures on one wrapped line — the fixed
                  // widths below add up to 684 and the frame is 390 (measured,
                  // 18 Sep 2026).
                  if (ladderWidth < PHONE) {
                    return (
                      <View style={styles.groupRowPhone}>
                        <Explain tip="ourCategory">
                          <Text style={styles.group}>{`${c.label.toUpperCase()} · ${c.subcategories.length} subcategories`}</Text>
                        </Explain>
                        <View style={styles.groupFigures}>
                          <Explain tip="known"><Text style={styles.groupNum}>{c.known ? `${c.known.toLocaleString()} known` : 'we hold none'}</Text></Explain>
                          {c.owned ? <Explain tip="owned"><Text style={styles.groupNum}>{`${c.owned.toLocaleString()} owned`}</Text></Explain> : null}
                          {c.ready == null ? null : <Explain tip="readyShort"><Text style={styles.groupNum}>{`ready ${c.ready}%`}</Text></Explain>}
                          {c.avgScore == null ? null : <Explain tip="avgScoreCategory"><Text style={styles.groupNum}>{`score ${c.avgScore}`}</Text></Explain>}
                        </View>
                      </View>
                    );
                  }
                  return (
                    // A heading is a thing you hover: these eight were the only
                    // headings on the board that explained nothing (18 Sep 2026,
                    // the heading census).
                    <View style={styles.groupRow}>
                      <Explain tip="ourCategory" style={{ flex: 1 }}>
                        <Text style={styles.group}>{`${c.label.toUpperCase()} · ${c.subcategories.length} subcategories`}</Text>
                      </Explain>
                      <Explain tip="known" style={{ width: 96, alignItems: 'flex-end' }}>
                        <Text style={styles.groupNum}>{c.known ? c.known.toLocaleString() : '—'}</Text>
                      </Explain>
                      <Explain tip="owned" style={{ width: 88, alignItems: 'flex-end' }}>
                        <Text style={styles.groupNum}>{c.owned ? c.owned.toLocaleString() : '—'}</Text>
                      </Explain>
                      <Explain tip="readyShort" style={{ width: 96, alignItems: 'flex-end' }}>
                        <Text style={styles.groupNum}>{c.ready == null ? '—' : `${c.ready}%`}</Text>
                      </Explain>
                      <Explain tip="avgScoreCategory" style={{ width: 104, alignItems: 'flex-end' }}>
                        <Text style={styles.groupNum}>{c.avgScore ?? '—'}</Text>
                      </Explain>
                      <View style={{ width: 300 }} />
                    </View>
                  );
                }
              : undefined}
            empty={<Word muted>Nothing here.</Word>} />
  );
}

// ---------------------------------------------------------------------------
// BO2d — the source lens
// ---------------------------------------------------------------------------


/**
 * The census board: what exists here, per drawer, for nothing.
 *
 * The data policy's area board (owner, 19 Sep 2026). It is defined as much by
 * what it cannot do as by what it shows: **nothing on it can spend money.**
 * Every figure was written down when the census ran, and a census asks Google
 * only for identifiers — the tier that costs nothing — so this is the one board
 * in the back office that can be read all day for free. It says so in its own
 * header, because somebody who does not know that will use it more carefully
 * than they need to.
 *
 * Two counts per drawer, not one. **Found** is how many places that question
 * actually surfaced, which is the answer to "how many are there". **Filed** is
 * one per place, which is the shelving answer. They differ by the overlap with
 * other drawers — a golf course in a wood is both — and showing only the second
 * had golf reading nought in Ascot while Google had just returned two courses.
 *
 * A hole is a finding, so a drawer that found nothing keeps its row, and a
 * cross-check nobody has run reads as a dash rather than a nought: "nobody has
 * checked" and "there are none" are different facts, and this board is read for
 * exactly that difference.
 */
function CensusBoard({ where }: { where: string }) {
  const [reach, setReach] = useState<'outcode' | '30' | '60'>('outcode');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceCensus>> | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const load = useCallback(() => {
    setData(null); setWhy(null);
    api.adminPlaceCensus({ where, reach })
      .then(setData)
      .catch((e) => setWhy(e?.message || 'That board could not be read.'));
  }, [where, reach]);
  useEffect(load, [load]);

  const livesOn = data?.livesOn;
  const columns: Col<PlaceCensusRow>[] = [
    { key: 'drawer', label: 'Drawer', tip: 'lensCensus', grow: true,
      cell: (r) => (
        <View style={styles.nameCell}>
          <Text style={styles.rowName}>{r.subcategory}</Text>
          <Text style={styles.rowNote}>{r.category}</Text>
        </View>
      ) },
    // A count built from a slice Google truncated is a floor, and must never
    // be drawn as a total (owner, 20 Sep 2026). The "at least" is the whole
    // point: the number is true as a minimum and false as an answer.
    { key: 'found', label: 'Found', tip: 'censusFound', width: 96, align: 'right',
      cell: (r) => ((r.saturated ?? 0) > 0
        ? <Explain tip="censusFloor"><Text style={styles.rowName}>{`at least ${r.surfaced ?? 0}`}</Text></Explain>
        : <Num n={r.surfaced || null} />) },
    { key: 'filed', label: 'Filed', tip: 'censusFiled', width: 150, align: 'right',
      cell: (r) => {
        const gap = (r.surfaced ?? 0) - (r.filed ?? 0);
        // Whose shelf the surplus went to. The gap on its own says a place
        // lives somewhere else; this says where, which is what the owner came
        // to the board to see (20 Sep 2026).
        const on = (livesOn?.[r.subcategory] ?? []).slice(0, 2);
        return (
          <View style={styles.nameCell}>
            <Text style={styles.rowName}>{r.filed ?? 0}{gap > 0 ? ` +${gap}` : ''}</Text>
            {gap > 0 && on.length ? (
              <Text style={styles.rowNote} numberOfLines={1}>
                {`on ${on.map((x) => `${x.subcategory} ${x.n}`).join(', ')}`}
              </Text>
            ) : null}
          </View>
        );
      } },
    { key: 'osm', label: 'Open map', tip: 'censusCheck', width: 96, align: 'right',
      cell: (r) => <Num n={r.osm} /> },
    { key: 'fhrs', label: 'Hygiene', tip: 'censusCheck', width: 88, align: 'right',
      cell: (r) => <Num n={r.fhrs} /> },
    { key: 'scored', label: 'Scored', tip: 'censusScored', width: 84, align: 'right',
      cell: (r) => <Num n={r.scored || null} /> },
    { key: 'cut', label: 'Cut off', tip: 'censusCutOff', width: 84, align: 'right',
      cell: (r) => <Num n={r.saturated || null} /> },
    // Neither in nor out, and never hidden. A count drawn with these out of
    // sight is a floor reading as a total: Bloomsbury showed 3 places with
    // hundreds sitting here, on the board taxonomy decisions come from (owner,
    // 24 Sep 2026 — "the fourth time today a diagnostic has spoken when it
    // could not see").
    { key: 'unresolved', label: 'Unresolved', tip: 'censusUnresolved', width: 104, align: 'right',
      cell: (r) => <Num n={r.unresolved || null} /> },
    // Which kind of question the count came from. Text is the one to open a
    // few of before trusting the number (owner, 21 Sep 2026).
    { key: 'sourced', label: 'Found by', tip: 'censusSourced', width: 92, align: 'right',
      cell: (r) => (
        <Text style={styles.rowNote}>
          {r.sourced === 'text' ? `text ${r.text_count ?? 0}`
            : r.sourced === 'mixed' ? `mixed${(r.text_count ?? 0) > 0 ? ` · text ${r.text_count}` : ''}`
            : (r.sourced ?? '')}
        </Text>
      ) },
  ];

  return (
    <>
      <View style={styles.censusHead}>
        <View style={styles.censusReach}>
          {([['outcode', data?.where ?? where.toUpperCase()], ['30', '30 min'], ['60', '1 hour']] as const).map(([k, label]) => (
            <Press key={k} effect="none" onPress={() => setReach(k as 'outcode' | '30' | '60')}
                   accessibilityRole="tab" accessibilityState={{ selected: reach === k }}
                   style={[styles.lens, reach === k && styles.lensOn]}>
              <Text style={[styles.lensWord, reach === k && styles.lensWordOn]}>{label}</Text>
            </Press>
          ))}
        </View>
        <Explain tip="censusFree">
          <Text style={styles.censusFree}>
            {`FREE · ${data?.outcodes?.length ?? 1} OUTCODE${(data?.outcodes?.length ?? 1) === 1 ? '' : 'S'} · CENSUSED ${data?.newest ? day(data.newest) : 'NEVER'}`}
          </Text>
        </Explain>
      </View>
      {data?.rented ? (
        <Explain tip="censusRented">
          <Text style={styles.censusFree}>
            {`RENTED COORDS \u00b7 ${data.rented.held} HELD HERE \u00b7 ${data.rented.expiringSoon} GO WITHIN 7 DAYS`
              + (data.rented.droppedInNinetyDays
                ? ` \u00b7 ${data.rented.droppedInNinetyDays} DROPPED IN 90 DAYS (ESTATE-WIDE)`
                : ' \u00b7 NONE DROPPED YET')}
          </Text>
        </Explain>
      ) : null}
      {data ? (
        data.rows.length ? (
          <Ladder columns={columns} rows={data.rows} keyOf={(r) => `${r.category}/${r.subcategory}`} />
        ) : (
          <Text style={styles.censusNone}>
            Nothing here has been censused yet. The census runs on the first search of an area, and costs nothing.
          </Text>
        )
      ) : why ? <Trouble why={why} onRetry={load} /> : <Waiting />}
      {data?.empties?.length ? <FoundNothing rows={data.empties} /> : null}
    </>
  );
}

/**
 * The drawers that found nothing, and where.
 *
 * The board's grouped rows lose this: a subcategory with nothing across
 * thirty-nine outcodes and one with nothing in a single outcode read exactly
 * the same. It is also the list the owner came to the board for (20 Sep 2026),
 * because it is the difference between a place that has no zoo and a question
 * of ours that is not reaching one.
 *
 * Nothing here is a failure, so nothing here is red. It is a list of places to
 * go and look at, and it stays shut until somebody asks for it.
 */
function FoundNothing({ rows }: { rows: { category: string; subcategory: string; outcode: string }[] }) {
  const [open, setOpen] = useState(false);
  // Grouped by drawer, because "spas: nowhere in GU18, GU20, GU25" is one
  // finding and three rows is three.
  const byDrawer = new Map<string, { category: string; outcodes: string[] }>();
  for (const r of rows) {
    const k = r.subcategory;
    const hit = byDrawer.get(k) ?? { category: r.category, outcodes: [] };
    hit.outcodes.push(r.outcode);
    byDrawer.set(k, hit);
  }
  const drawers = [...byDrawer.entries()].sort((a, b) => b[1].outcodes.length - a[1].outcodes.length);
  return (
    <View style={styles.nothingWrap}>
      <Press effect="none" onPress={() => setOpen((v) => !v)} accessibilityRole="button"
             accessibilityState={{ expanded: open }} style={styles.nothingHead}>
        <Explain tip="censusNothing">
          <Text style={styles.censusFree}>
            {`FOUND NOTHING · ${drawers.length} DRAWER${drawers.length === 1 ? '' : 'S'} · ${rows.length} ROW${rows.length === 1 ? '' : 'S'}`}
          </Text>
        </Explain>
        <Icon name={open ? 'expand' : 'expand'} size={16} />
      </Press>
      {open ? drawers.map(([sub, d]) => (
        <View key={sub} style={styles.nothingRow}>
          <View style={styles.nameCell}>
            <Text style={styles.rowName}>{sub}</Text>
            <Text style={styles.rowNote}>{d.category}</Text>
          </View>
          <Text style={[styles.rowNote, styles.nothingWhere]} numberOfLines={2}>
            {d.outcodes.length > 8 ? `${d.outcodes.slice(0, 8).join(' ')} +${d.outcodes.length - 8} more` : d.outcodes.join(' ')}
          </Text>
        </View>
      )) : null}
    </View>
  );
}

function SourceBoard({ q, onSub }: { q: any; onSub: (s: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceSources>> | null>(null);
  useEffect(() => { setData(null); api.adminPlaceSources(q).then(setData).catch(() => setData(null)); }, [q]);
  if (!data) return <Waiting />;

  const columns: Col<PlaceSourceRow>[] = [
    // "5 of 59" is the finding: the ones not listed are the ones nothing landed in.
    { key: 'label', label: 'Our subcategory', note: `${data.rows.length} of ${data.subcategories} · most held first`,
      tip: 'ourSubcategory', grow: true, cell: (r) => <Text style={styles.rowName}>{r.label}</Text> },
    ...data.sources.map((s): Col<PlaceSourceRow> => ({
      key: s.key, label: s.label, tip: tipForSource(s.key), width: s.key === 'tripadvisor' ? 112 : 100, align: 'right',
      // A source never asked reads "not asked", never as nothing. The two are
      // different facts and the screen has to keep them apart.
      cell: (r) => (r.counts[s.key] == null ? <NotAsked /> : <Num n={r.counts[s.key] || null} />),
      cellTip: (r) => (r.counts[s.key] == null
        ? ([`${s.label} · not asked`, `We have never spent a call asking ${s.label} about the places here, so there is nothing to count. Different from asking and finding nothing.`] as const)
        : tipForSource(s.key)),
    })),
    { key: 'one', label: 'One source only', tip: 'oneSourceOnly', width: 132, align: 'right',
      cell: (r) => <Num n={r.oneOnly || null} strong accent={r.oneOnly > 0} /> },
    { key: 'googleOnly', label: 'Google only', tip: 'googleOnlyNoName', width: 132, align: 'right',
      cell: (r) => <Num n={r.googleOnly || null} /> },
  ];
  return (
    <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.key} onRow={(r) => onSub(r.key)}
            /* One chip per source that has anything, plus the two figures this
               board exists for: how many places rest on a single source, and
               how many on Google alone. A source never asked is left off
               rather than drawn as a nought — the distinction the wide table
               keeps with "not asked". */
            phoneRow={(r) => ({
              name: r.label,
              note: `${r.known.toLocaleString()} known`,
              chips: [
                ...data.sources
                  .map((sc) => ({ sc, n: r.counts[sc.key] }))
                  .filter((x): x is { sc: typeof data.sources[number]; n: number } => x.n != null && x.n > 0)
                  .map(({ sc, n }) => ({ key: sc.key, word: `${sc.label.toLowerCase()} ${n.toLocaleString()}`, tip: tipForSource(sc.key) })),
                ...(r.oneOnly ? [{ key: 'one', word: `one source only ${r.oneOnly.toLocaleString()}`, tip: 'oneSourceOnly' as const, lead: true }] : []),
                ...(r.googleOnly ? [{ key: 'gonly', word: `Google only ${r.googleOnly.toLocaleString()}`, tip: 'googleOnlyNoName' as const }] : []),
              ],
            })}
            empty={<Word muted>Nothing indexed here yet.</Word>} />
  );
}

const tipForSource = (key: string) => ({
  google: 'google', osm: 'openstreetmap', atlas: 'sourceAtlas', sweep: 'sourceSweep',
  tripadvisor: 'sourceTripadvisor', own: 'ours',
} as Record<string, any>)[key] ?? null;

// ---------------------------------------------------------------------------
// BO2e — the quality lens
// ---------------------------------------------------------------------------

function QualityBoard({ q, onPlace, canManage }: { q: any; onPlace: (ref: string) => void; canManage: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceQuality>> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // What asking about the selection would cost, from the API rather than a
  // figure in the bundle (Codex, 18 Sep 2026).
  const [askQuote, setAskQuote] = useState<number | null>(null);
  useEffect(() => {
    if (!picked.size) { setAskQuote(0); return undefined; }
    let live = true;
    setAskQuote(null);
    api.adminAskQuote([...picked]).then((q) => { if (live) setAskQuote(q.pence); }).catch(() => { if (live) setAskQuote(null); });
    return () => { live = false; };
  }, [picked]);
  const [busy, setBusy] = useState<string | null>(null);
  const { width } = useViewport();
  useEffect(() => { setData(null); setPicked(new Set()); api.adminPlaceQuality(q).then(setData).catch(() => setData(null)); }, [q]);
  if (!data) return <Waiting />;

  // A share of the whole, not of the biggest band — and the unscored are drawn,
  // so the five bands and it add up to the KNOWN above them (Codex, 17 Sep).
  const bands = [...data.bands, ...(data.unscored ? [{ band: 'not scored', n: data.unscored }] : [])];
  const whole = Math.max(1, bands.reduce((n, b) => n + b.n, 0));
  const columns: Col<PlaceQuality['worth'][number]>[] = [
    { key: 'tick', label: '', width: 26, align: 'left', stops: true,
      cell: (r) => <Box on={picked.has(r.ref)} onPress={() => setPicked(toggle(picked, r.ref))} label={r.name ?? r.ref} /> },
    { key: 'name', label: 'Place', tip: 'placeWorth', grow: true,
      cell: (r) => (
        <View style={styles.nameCell}>
          {/* A stand-in is not a name. The sweep finds a place through Google,
              may not keep Google's name, and writes the words that found it —
              "(wildlife park)" — until an OpenStreetMap match gives it one we
              may keep. Drawn as a name it read as broken data; drawn as what it
              is, it reads as work waiting (owner, 18 Sep 2026). */}
          {r.standIn ? (
            <Explain tip="standInName" cursor="help">
              <Text style={[styles.rowName, styles.refName]}>{`Unnamed ${String(r.name ?? '').replace(/^\(|\)$/g, '')}`}</Text>
            </Explain>
          ) : (
            <Text style={[styles.rowName, !r.name && styles.refName]}>{r.name ?? r.ref}</Text>
          )}
          {/* Why it is on this list. A place a household has saved is the
              shortest route to something worth doing, so it says so (Codex,
              17 Sep 2026). */}
          <Text style={styles.rowNote}>
            {[r.ownership === 'claimed' ? 'a household saved it' : null, r.subcategory, r.outcode, sourcesSentence(r.sources)]
              .filter(Boolean).join(' · ')}
          </Text>
        </View>
      ) },
    { key: 'been', label: 'Been there', tip: 'beenThere', width: 120, align: 'right',
      // A place nothing rating-bearing has returned gets no figure at all, and
      // the cell says why rather than printing a nought.
      cell: (r) => (r.been ? <Word>{beenWord(r.been)}</Word> : <Blank />),
      cellTip: (r) => (r.been ? 'beenThere' : 'nothingToCount') },
    { key: 'rating', label: 'Rating', tip: 'rating', width: 110, align: 'right',
      cell: (r) => (r.rating ? <Word>{r.rating}</Word> : <Blank />),
      cellTip: (r) => (r.rating ? 'rating' : 'noRating') },
    { key: 'score', label: 'Score', tip: 'scoreWeights', width: 110, align: 'right', cell: (r) => <Num n={r.score} /> },
    { key: 'open', label: '', width: 124, align: 'right', stops: true, cell: (r) => <Act label="Open it" small onPress={() => onPlace(r.ref)} /> },
  ];

  return (
    <>
      <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
        <View style={[styles.distribution, width < 1100 && { width: '100%' }]}>
          <Kicker tip="sectionDataScore">Data score</Kicker>
          <View style={{ gap: 7, marginTop: 9 }}>
            {bands.map((b) => (
              <Explain key={b.band} tip={b.band === 'not scored' ? 'unscored' : 'dataScoreBand'} style={styles.barRow}>
                <Text style={styles.barLabel}>{b.band}</Text>
                <View style={styles.barTrack}>
                  <View style={{ width: `${Math.round((b.n / whole) * 100)}%`, height: 18, backgroundColor: colors.selected }} />
                </View>
                <Text style={styles.barN}>{b.n ? b.n.toLocaleString() : '—'}</Text>
              </Explain>
            ))}
          </View>
          <View style={{ height: spacing.lg }} />
          <Kicker tip="sectionOldestFact">Oldest fact</Kicker>
          <View style={{ marginTop: 6 }}>
            {data.stale.map((s, i) => (
              <Explain key={s.key} tip={s.key === 'over12' ? 'oldestFactOver12' : s.key === 'never' ? 'oldestFactNever' : 'oldestFactBand'}
                       style={[styles.staleRow, i === data.stale.length - 1 && { borderBottomWidth: 0 }]}>
                <Text style={[styles.staleLabel, s.key === 'over12' && styles.strong, s.key === 'never' && { color: colors.inkMuted }]}>{s.label}</Text>
                <Text style={[styles.staleN, s.key === 'over12' && [styles.strong, { color: colors.accent }]]}>{s.n ? s.n.toLocaleString() : '—'}</Text>
              </Explain>
            ))}
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Kicker tip="sectionWorthOwningNext">Worth owning next</Kicker>
          <View style={{ height: 9 }} />
          <Ladder columns={columns} rows={data.worth} keyOf={(r) => r.ref}
                  onRow={(r) => onPlace(r.ref)}
                  /* Tapping the row is the door on a phone, so "Open it" is not
                     a chip: a button in a list of figures reads as a figure. */
                  phoneRow={(r: any) => ({
                    name: r.name ?? r.ref,
                    note: [r.ownership === 'claimed' ? 'a household saved it' : null, r.subcategory, r.outcode]
                      .filter(Boolean).join(' · ') || null,
                    chips: [
                      { key: 'score', word: `score ${r.score == null ? '—' : r.score}`, tip: 'scoreWeights', lead: true },
                      ...(r.been ? [{ key: 'been', word: `been ${r.been.toLocaleString()}`, tip: 'beenThere' as const }] : []),
                      ...(r.rating != null ? [{ key: 'rating', word: `rating ${r.rating}`, tip: 'rating' as const }] : []),
                    ],
                  })}
                  empty={<Word muted>Everything here is already owned.</Word>} />
        </View>
      </View>
      <Footer left={picked.size ? <Text style={styles.selected}>{`${picked.size} selected`}</Text> : null}>
        <Act label={busy === 'curate' ? 'Curating…' : picked.size ? `Curate these ${picked.size} · free` : 'Curate them · free'} tone="secondary"
             disabled={!canManage || !picked.size || busy != null}
             onPress={() => { setBusy('curate'); api.adminCuratePlaces([...picked]).finally(() => { setBusy(null); setPicked(new Set()); }); }} />
        {/* A button that spends says what it costs, and one with nothing chosen
            does not claim a price it cannot know. Asking Google needs a key the
            owner has to add, so it says that rather than doing nothing. */}
        {/* The price is the API's, not a figure in the bundle: 1.4p was the old
            one, a place we have never matched needs two requests and a cached
            one costs nothing, so the board was quoting something the ceiling
            would never charge (Codex, 18 Sep 2026). */}
        <Act label={picked.size ? `Ask Google about these ${picked.size} · ${askQuote == null ? '…' : pounds(Math.round(askQuote))}` : 'Ask Google about them'}
             disabled={!canManage || !picked.size || busy != null}
             onPress={() => { setBusy('google'); api.adminAskAboutPlaces([...picked]).finally(() => { setBusy(null); setPicked(new Set()); }); }} />
      </Footer>
    </>
  );
}

const beenWord = (band: string) => ({ thousands: 'thousands', many: 'many', hundreds: 'hundreds', few: 'a few' } as Record<string, string>)[band] ?? band;
const sourcesSentence = (s: string[]) =>
  (s.length === 0 ? null : s.length === 1 ? `${sourceWord(s[0])} only` : s.length === 2 ? `${sourceWord(s[0])} and ${sourceWord(s[1])}` : s.map(sourceWord).join(', '));
// Every source that can reach the index, said the way the board says it. A key
// with no word printed itself — a row read "wikidata only" (18 Sep 2026, the
// separate audit).
const sourceWord = (k: string) => ({
  google: 'Google', osm: 'OSM', atlas: 'Atlas', sweep: 'the sweep', tripadvisor: 'Tripadvisor',
  own: 'ours', wikidata: 'Wikidata', wikipedia: 'Wikipedia', commons: 'Commons',
  photo: 'a household photograph', council: 'the council', mapillary: 'Mapillary',
} as Record<string, string>)[k] ?? k;

const toggle = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
};

/** A square box, ticked or not. Square corners, like everything else. */
const Box = ({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) => (
  <Press effect="none" onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
         accessibilityLabel={`Select ${label}`} hitSlop={8} style={[styles.box, on && styles.boxOn]}>
    {on ? <Icon name="check" size={13} strokeWidth={2.6} color={colors.selectedFg} /> : null}
  </Press>
);

// ---------------------------------------------------------------------------
// BO2f — the demand lens
// ---------------------------------------------------------------------------

function DemandLens({ q, canManage, onCollect }: { q: any; canManage: boolean; onCollect: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceDemand>> | null>(null);
  const { navigate } = useRouter();
  useEffect(() => { setData(null); api.adminPlaceDemand(q).then(setData).catch(() => setData(null)); }, [q]);
  if (!data) return <Waiting />;

  const columns: Col<DemandRow>[] = [
    { key: 'label', label: 'What was asked for', tip: 'whatWasAskedFor', grow: true,
      cell: (r) => (
        <View style={styles.nameCell}>
          <Text style={[styles.rowName, !r.subject && { fontWeight: '600' }]}>{r.label}</Text>
          {!r.subject ? <Text style={styles.rowNote}>no subject given</Text> : null}
        </View>
      ) },
    { key: 'searches', label: 'Searches', tip: 'searches', width: 104, align: 'right', cell: (r) => <Num n={r.searches || null} /> },
    { key: 'empty', label: 'Came back empty', tip: 'empty', width: 130, align: 'right',
      cell: (r) => <Num n={r.empty || null} strong={r.empty > 0} accent={r.fault === 'empty-always' || r.fault === 'no-places'} /> },
    { key: 'noClick', label: 'Clicked nothing', tip: 'noClick', width: 130, align: 'right',
      cell: (r) => <Num n={r.noClick || null} strong={r.fault === 'wrong-places'} accent={r.fault === 'wrong-places'} /> },
    { key: 'noTrip', label: 'Never tripped', tip: 'neverTripped', width: 130, align: 'right',
      cell: (r) => <Num n={r.noTrip || null} strong={r.fault === 'thin-places'} accent={r.fault === 'thin-places'} /> },
    { key: 'known', label: 'We know of', tip: 'weKnowOf', width: 100, align: 'right', cell: (r) => <Num n={r.known || null} /> },
    { key: 'fault', label: 'Fault', tip: 'fault', width: 220, align: 'left', stops: true,
      // The word *and* the way out of it. Drawing only the button meant "No
      // places" — one of the three faults the whole screen is built around —
      // was never printed anywhere (17 Sep 2026, the verification audit).
      cell: (r) => (r.act === 'collect'
        ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Word>{r.shortFault}</Word>
            <Act label="Collect here" icon="download" small tone={r.fault === 'empty-always' ? 'primary' : 'secondary'}
                 disabled={!canManage} onPress={onCollect} />
          </View>
        )
        : <Word>{r.shortFault}</Word>) },
  ];

  return (
    <>
      <View style={styles.subRow}>
        <View style={styles.five}>
          <Stat label="Searches" value={data.totals.searches.toLocaleString()} tip="searches" />
          <Stat label="Came back empty" value={data.totals.empty.toLocaleString()} tip="emptyTotal" accent />
          <Stat label="Clicked nothing" value={data.totals.noClick.toLocaleString()} tip="noClick" mark />
          <Stat label="Never tripped" value={data.totals.noTrip.toLocaleString()} tip="neverTripped" mark />
        </View>
      </View>
      {/* Whose figures these are, where they are not this area's own: a point
          search is recorded against a county, so a town with no cells of its
          own reads its county's (17 Sep 2026). Said once, above the ladder. */}
      {/* Whose figures these are, in three words with the reason behind a hover:
          a sentence on a board is prose, and there is none on these screens
          (README law 1; 18 Sep 2026, the separate audit). */}
      {data.figuresFrom ? (
        <View style={styles.subRow}>
          <Explain tip={['Whose figures', `These are ${data.figuresFrom.name}'s, because ${data.figuresFrom.why}.`]}>
            <Kicker>{`${data.figuresFrom.name}'s figures`}</Kicker>
          </Explain>
        </View>
      ) : null}
      <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.subject ?? 'anything'}
              highlight={(r) => r.fault === 'empty-always'}
              phoneRow={(r: any) => ({
                name: r.label,
                note: `${(r.searches ?? 0).toLocaleString()} ${r.searches === 1 ? 'search' : 'searches'} · we know of ${(r.known ?? 0).toLocaleString()}`,
                chips: [
                  ...(r.faultLabel ? [{ key: 'fault', word: r.faultLabel, tip: 'fault' as const, lead: true }] : []),
                  ...(r.empty ? [{ key: 'empty', word: `empty ${r.empty.toLocaleString()}`, tip: 'empty' as const }] : []),
                  ...(r.noClick ? [{ key: 'noClick', word: `clicked nothing ${r.noClick.toLocaleString()}`, tip: 'noClick' as const }] : []),
                  ...(r.noTrip ? [{ key: 'noTrip', word: `never tripped ${r.noTrip.toLocaleString()}`, tip: 'neverTripped' as const }] : []),
                ],
              })}
              empty={<Word muted>Nothing has been searched for here yet.</Word>} />
      <Footer>
        <Act label="Open these in Demand" tone="secondary" onPress={() => navigate(`/admin/demand?where=${encodeURIComponent(q.where)}`)} />
      </Footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// BO2g — a town and its ring, read from the matrix
// ---------------------------------------------------------------------------

function RingBoard({ q, onSub, onLens, onWithin }: {
  q: any; onSub: (s: string) => void; onLens: (l: Lens) => void; onWithin: (m: number) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceRing>> | null>(null);
  useEffect(() => { setData(null); api.adminPlaceRing(q).then(setData).catch(() => setData(null)); }, [q]);
  if (!data) return <Waiting />;

  const columns: Col<PlaceRing['rows'][number]>[] = [
    { key: 'label', label: 'What is in reach', tip: 'whatIsInReach', grow: true,
      cell: (r) => <Text style={[styles.rowName, r.known === 0 && styles.rowNameEmpty]}>{r.label}</Text> },
    { key: 'known', label: 'Known', tip: 'known', width: 110, align: 'right', cell: (r) => <Num n={r.known || null} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 100, align: 'right', cell: (r) => <Num n={r.owned || null} /> },
    { key: 'ready', label: 'Ready', tip: 'ready', width: 100, align: 'right', cell: (r) => (r.ready == null ? <Blank /> : <Word>{`${r.ready}%`}</Word>) },
    { key: 'score', label: 'Avg score', tip: 'avgScore', width: 120, align: 'right', cell: (r) => <Num n={r.avgScore} /> },
    { key: 'searches', label: 'Searches', note: '30 days', tip: 'searches', width: 150, align: 'right',
      cell: (r) => <Num n={r.searches || null} strong={r.known === 0 && r.searches > 0} accent={r.known === 0 && r.searches > 0} /> },
    { key: 'nearest', label: 'Nearest', tip: 'nearest', width: 150, align: 'right',
      cell: (r) => <Word muted>{r.nearest == null ? `none within ${q.within ?? 30}` : `${r.nearest} min`}</Word> },
  ];

  const f = data.ring;
  return (
    <>
      <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.key}
              onRow={(r) => (r.known > 0 ? onSub(r.key) : undefined)}
              highlight={(r) => r.known === 0 && r.searches > 0}
              empty={(
                // Two different facts, and they used to read the same: a
                // postcode the travel-time matrix has never heard of answered as
                // an ordinary empty ring (Codex, 18 Sep 2026).
                <Word muted>{data.cellKnown === false
                  ? 'We hold no travel times for this postcode yet, so nothing can be worked out from it.'
                  : 'Nothing in reach yet.'}</Word>
              )} />
      <View style={styles.ringFacts}>
        <Kicker tip="sectionThisRing">This ring</Kicker>
        <View style={styles.ringRow}>
          <RingFact label="Nearest postcode area" tip="nearestPostcodeArea" value={f.cellLabel ?? '—'} />
          <RingFact label="Postcode areas in reach" tip="postcodeAreasInReach" value={`${f.cellsInReach.toLocaleString()} of ${f.cellsTotal.toLocaleString()}`} />
          <RingFact label="Rows read" tip="rowsRead" value={String(f.rowsRead)} />
          <RingFact label="Distances computed" tip="distancesComputed" value={f.distancesComputed ? String(f.distancesComputed) : 'none'} />
          <RingFact label="Travel times worked out" tip="travelTimesWorkedOut"
                    value={f.builtAt ? `${day(f.builtAt)}${f.estimated ? ' · estimated' : ' · routed'}` : 'not yet'} />
          <RingFact label="A few minutes generous" tip="edgeMinutes" value={`${f.edgeMinutes} min`} />
          {/* £0.00, not £0: this is a money figure and it reads as one. */}
          <RingFact label="Provider spend" tip="providerSpend" value={`£${(f.spendPence / 100).toFixed(2)}`} />
        </View>
      </View>
      <Footer>
        {widerThan(q.within ?? null) ? <Act label={`Widen to ${bandLabel(widerThan(q.within ?? null) as number)}`} tone="secondary" onPress={() => onWithin(widerThan(q.within ?? null) as number)} /> : null}
        <Act label="Collect in this ring" icon="download" onPress={() => onLens('collect')} />
      </Footer>
    </>
  );
}

const RingFact = ({ label, value, tip }: { label: string; value: string; tip: any }) => (
  <Explain tip={tip} style={{ gap: 2 }}>
    <Text style={styles.ringLabel}>{label}</Text>
    <Text style={styles.ringValue}>{value}</Text>
  </Explain>
);

// ---------------------------------------------------------------------------
// BO2q — the places themselves
// ---------------------------------------------------------------------------

/** What each hole's own button says, and the run behind it. */
type FieldAction = 'write' | 'find' | 'read' | 'ask';
const ACTION_WORD: Record<FieldAction, string> = {
  write: 'Write', find: 'Find', read: 'Read', ask: `Ask · ${pounds(3)}`,
};

/**
 * The same four acts, said as a sentence rather than as a verb.
 *
 * "Ask · £0.03" does not say who is being asked, and the owner read it and had
 * to guess: "I'm assuming that's Google, but ask who?" (20 Sep 2026). These sit
 * inside the opened row, where there is room for the whole sentence.
 */
const ACTION_SAYS: Record<FieldAction, string> = {
  write: 'Research it from its own website · free',
  find: 'Look for one we may keep · free',
  read: 'Read it from their site · free',
  ask: `Ask Google for it · ${pounds(3)}`,
};

/**
 * The two ways of reading a subcategory, and the default is the household's.
 *
 * Owner, 20 Sep 2026: "I want the default view to be what the user sees… if I
 * switch to user view, then I should just see the first 10." Everything we hold
 * is the other one — the board this screen has always drawn, which is the index
 * rather than a list anybody is shown.
 */
const VIEWS = ['household', 'everything'] as const;
type PlaceView = typeof VIEWS[number];
const VIEW_LABEL: Record<PlaceView, string> = { household: 'What a household sees', everything: 'Everything we hold' };

const SHOW = ['not-ready', 'ready', 'all'] as const;
const SHOW_LABEL: Record<string, string> = { 'not-ready': 'Not ready', ready: 'Ready', all: 'All' };

function PlacesBoard({ q, cat, sub, onPlace, onBar, canManage, missing, onMissing, onNames, onWiden, within }: {
  q: any; cat: string; sub: string; onPlace: (ref: string) => void; onBar: (s: string) => void;
  canManage: boolean; missing: string | null; onMissing: (f: string | null) => void;
  onNames: (n: { cat?: string; sub?: string; subs?: number; needs?: string[] }) => void;
  onWiden: (m: number) => void; within: number | null;
}) {
  // In the address, all three: what is shown, what it is sorted by, and which
  // way round — so a piece of work is a link somebody can be sent.
  const [show, setShow] = useQueryState<typeof SHOW[number]>('show', 'not-ready', asOneOf(SHOW, 'not-ready'));
  const [query, setQuery] = useQueryState<string>('q', '', asText);
  const [sort, setSort] = useQueryState<string>('sort', 'missing', asText);
  const [desc, setDesc] = useQueryState<boolean>('desc', true, { read: (r) => r !== '0', write: (v) => (v ? null : '0') });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  /** Names fetched from a provider for this screen alone. Never stored. */
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const [bars] = useFresh(JSON.stringify(['ready-bars']), () => api.adminReadyBars());
  const bar = bars?.subcategories.find((x) => x.key === sub) ?? null;
  useEffect(() => { onNames({ sub: bar?.label ?? sub, cat: bar?.categoryLabel, needs: bar?.facts.filter((f) => f.required).map((f) => f.fact) }); }, [bar, sub, onNames]);

  const [view, setView] = useQueryState<PlaceView>('view', 'household', asOneOf(VIEWS, 'household'));

  // Each view asks its own question, and only the one being read: the
  // household's ten and the whole index are different boards, and asking both
  // every time would double the work to draw one of them.
  const [data, reload] = useFresh<Awaited<ReturnType<typeof api.adminPlaceList>> | null>(
    JSON.stringify(['places', q, cat, sub, show, query, missing, sort, desc, view]),
    () => (view === 'everything'
      ? api.adminPlaceList({ ...q, cat: cat || undefined, sub, show, q: query || undefined, missing: missing || undefined, sort, desc: desc ? undefined : '0' })
      : Promise.resolve(null)),
  );
  // Which ten. In the address, because a page is a page somebody can be sent —
  // and it goes back to the first whenever the question changes, since page
  // four of a different subcategory is not where anybody was.
  const [page, setPage] = useQueryState<number>('page', 1, asNumber(1));
  const [seen] = useFresh<Awaited<ReturnType<typeof api.adminHouseholdView>> | null>(
    JSON.stringify(['household', q, cat, sub, view, page]),
    () => (view === 'household'
      ? api.adminHouseholdView({ ...q, cat: cat || undefined, sub, limit: 10, page: page > 1 ? page : undefined })
      : Promise.resolve(null)),
  );
  useEffect(() => { if (page !== 1) setPage(1, { replace: true }); }, [q, cat, sub]);

  const counted = data?.counted ?? [];
  const facts: FactDef[] = data?.facts ?? [];
  const nameless = data?.rows.filter((r) => !r.name && picked.has(r.ref)).length ?? 0;

  const columns: Col<PlaceRow>[] = [
    { key: 'tick', label: '', width: 26, align: 'left', stops: true,
      cell: (r) => <Box on={picked.has(r.ref)} onPress={() => setPicked(toggle(picked, r.ref))} label={r.name ?? r.ref} /> },
    { key: 'name', label: 'Place', tip: 'placeRow', grow: true,
      // A nameless row is the finding: Google is the only source that has ever
      // seen this place, so there is no name we are allowed to hold. It is said
      // in words, with the identifier as the note under it — printed as the
      // name, a row read as a place called ChIJnVzfWQCBdkgRt1-Lo8I5wII (owner,
      // 20 Sep 2026: "we're not displaying random strings"). The household's
      // own view leaves these out altogether.
      cell: (r) => (
        <View style={styles.nameCell}>
          <Text style={[styles.rowName, !(r.name ?? fetched[r.ref]) && styles.refName]} numberOfLines={1}>
            {r.name ?? fetched[r.ref] ?? 'No name we may show'}
          </Text>
          {!r.name ? <Text style={styles.rowNote} numberOfLines={1}>{fetched[r.ref] ? 'fetched · not kept' : r.ref}</Text> : null}
        </View>
      ) },
    { key: 'unseen', label: 'Unseen by', tip: 'unseenBy', width: 104, align: 'left', sort: 'unseen',
      cell: (r) => (r.unseenBy.length === 0 ? <Blank />
        : r.unseenBy.length === 1 ? <Word muted>{sourceWord(r.unseenBy[0])}</Word>
        : <Text style={styles.dotted}>{r.unseenBy.length}</Text>),
      cellTip: (r) => (r.unseenBy.length > 1
        ? [`Unseen by ${r.unseenBy.length} sources`, `${listWords(r.unseenBy.map(sourceWord))} have never returned it.`] as const
        : 'unseenBy') },
    { key: 'where', label: 'Where', tip: 'wherePlace', width: 74, align: 'left', cell: (r) => <Word muted>{r.outcode ?? '—'}</Word> },
    { key: 'score', label: 'Score', tip: barTip(data?.bar ?? [], facts), width: 74, align: 'right', sort: 'score',
      // A score out of a hundred, not a share: the band above it prints 52 and a
      // column that printed 52% would be a second meaning for the same figure.
      cell: (r) => (r.barSet ? <ScoreCell v={r.score} strong /> : <Word muted>not set</Word>) },
    ...facts.map((f): Col<PlaceRow> => {
      const counted = (data?.counted ?? []).includes(f.key);
      // The board greys a column this kind of place is not judged on, header and
      // all, so you can see at a glance which of them count.
      const notCounted = ['Not counted', `${kindWord(bar?.label ?? sub)} is not judged on this, so it never counts against the score. The bar is set per kind of place.`] as const;
      return {
        key: f.key, label: f.short, muted: Boolean(data) && !counted,
        tip: counted
          ? ([f.label, `${f.explain} Tap the heading to list only the places missing it.`] as const)
          : notCounted,
        width: 76, align: 'centre',
        // Tapping the heading lists only the places missing that fact. The API
        // has always supported it and nothing called it, so a filter the board
        // offered was unreachable (17 Sep 2026, the verification audit).
        onHeader: counted ? () => onMissing(missing === f.key ? null : f.key) : undefined,
        headerOn: missing === f.key,
        cell: (r) => (r.facts[f.key] === 'n/a' ? <Na tip={notCounted} /> : <Tick on={r.facts[f.key] !== 'no'} />),
        cellTip: (r) => (r.facts[f.key] === 'n/a' ? notCounted : ([f.label, f.explain] as const)),
      };
    }),
    { key: 'missing', label: 'Missing', tip: missingTip(data?.bar ?? [], facts), width: 84, align: 'right', sort: 'missing',
      cell: (r) => <Num n={r.missing || null} strong /> },
    { key: 'go', label: '', width: 28, align: 'right', cell: () => <Icon name="more" size={15} strokeWidth={2} color={colors.inkMuted} /> },
  ];

  const notReady = data?.rows.filter((r) => !r.ready).length ?? 0;
  return (
    <>
      {/* Which of the two boards this is. First on the page, above the reading
          that follows from it, and two words rather than a box — the back
          office picks from a control, never a tile (12 Sep 2026). */}
      <View style={styles.subRow}>
        <View style={styles.lensLeft}>
          <Kicker tip={['Reading', 'What a household sees is our own order over what we hold — the first ten, nothing nameless, and no provider asked. Everything we hold is the index itself: every place any source has ever seen here, however little we know about it.']}>Reading</Kicker>
          <View style={styles.lenses}>
            {VIEWS.map((v) => (
              <Press key={v} effect="none" onPress={() => setView(v)} accessibilityRole="tab"
                     accessibilityState={{ selected: view === v }} accessibilityLabel={VIEW_LABEL[v]}
                     style={[styles.lens, view === v && styles.lensOn]}>
                <Text style={[styles.lensWord, view === v && styles.lensWordOn]}>{VIEW_LABEL[v]}</Text>
              </Press>
            ))}
          </View>
        </View>
      </View>
      {view === 'household' ? <HouseholdSeen data={seen} onPlace={onPlace} page={page} onPage={(n) => setPage(n, { replace: true })} /> : (
      <>
      <View style={styles.subRow}>
        <View style={styles.lensLeft}>
          <Kicker tip="sectionShow">Show</Kicker>
          <View style={styles.lenses}>
            {SHOW.map((s) => (
              <Press key={s} effect="none" onPress={() => setShow(s)} accessibilityRole="tab"
                     accessibilityState={{ selected: show === s }} accessibilityLabel={SHOW_LABEL[s]}
                     style={[styles.lens, show === s && styles.lensOn]}>
                <Text style={[styles.lensWord, show === s && styles.lensWordOn]}>{SHOW_LABEL[s]}</Text>
              </Press>
            ))}
          </View>
          {missing ? (
            <Press effect="none" onPress={() => onMissing(null)} accessibilityRole="button" accessibilityLabel="Stop filtering by what is missing"
                   style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={styles.chipOff}>{`missing ${facts.find((f) => f.key === missing)?.short.toLowerCase() ?? missing}`}</Text>
              <Icon name="close" size={12} strokeWidth={2.4} color={colors.accent} />
            </Press>
          ) : null}
        </View>
        <View style={{ flex: 1 }} />
        <View style={[styles.search, { width: 260 }]}>
          <Icon name="search" size={15} strokeWidth={2} color={colors.inkMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="A place by name"
                     placeholderTextColor={colors.inkMuted} style={styles.searchInput} accessibilityLabel="Find a place by name" />
        </View>
      </View>
      {data ? (
        <>
          <View style={{ paddingBottom: 6 }}>
            <Text style={styles.rowNote}>
              {show === 'not-ready'
                ? `${data.rows.length} of ${data.notReady.toLocaleString()} not ready`
                : show === 'ready'
                  ? `${data.rows.length} of ${(data.stats.readyCount ?? 0).toLocaleString()} ready`
                  : `${data.rows.length} of ${data.stats.known.toLocaleString()}`}
            </Text>
          </View>
          <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.ref} onRow={(r) => onPlace(r.ref)}
                  sort={sort} desc={desc}
                  onSort={(k) => { if (k === sort) setDesc(!desc); else { setSort(k); setDesc(true); } }}
                  /* BO2q's stacked row. This board is the one that never got a
                     phone layout: a fact column per thing a place can be missing
                     put Hours at 608px inside a 390px frame, with nothing to
                     scroll it into view (19 Sep 2026, the 390px audit). The
                     facts become chips, which is what chips are for — and the
                     ones this kind of place is not judged on stay out, rather
                     than reading as things it lacks. */
                  phoneRow={(r) => ({
                    name: r.standIn
                      ? <Explain tip="standInName"><Text style={[styles.rowName, styles.refName]}>{`Unnamed ${String(r.name ?? '').replace(/^\(|\)$/g, '')}`}</Text></Explain>
                      : <Text style={[styles.rowName, !r.name && styles.refName]}>{r.name ?? 'No name we may show'}</Text>,
                    note: [r.outcode, r.unseenBy?.length ? `unseen by ${r.unseenBy.length}` : null]
                      .filter(Boolean).join(' · '),
                    chips: [
                      { key: 'score', word: `score ${r.score == null ? '—' : r.score}`, tip: 'scoreWeights' as const, lead: true },
                      // Only the facts this kind of place is judged on, and only
                      // the ones it is missing. The wide board greys what does
                      // not count; a chip that says "no menu" about a playground
                      // would read as a gap rather than as not applicable, which
                      // is the one thing the per-kind bar exists to prevent.
                      ...facts
                        .filter((f) => (data?.counted ?? []).includes(f.key) && r.facts[f.key] === 'no')
                        .map((f) => ({
                          key: f.key,
                          word: `no ${f.short.toLowerCase()}`,
                          tip: [f.label, f.explain] as const,
                        })),
                    ],
                  })}
                  empty={<Word muted>Nothing here that is {show === 'ready' ? 'ready' : 'not ready'}.</Word>} />
        </>
      ) : <Waiting />}
      </>
      )}
      <Footer left={
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
          {picked.size ? <Text style={styles.selected}>{`${picked.size} selected`}</Text> : null}
          <Press effect="none" onPress={() => onBar(sub)} accessibilityRole="button" accessibilityLabel="What counts as ready here">
            <Text style={styles.trailWord}>What counts as ready here</Text>
          </Press>
        </View>
      }>
        {q.within != null && widerThan(within)
          ? <Act label={`Widen to ${bandLabel(widerThan(within) as number)}`} tone="secondary" onPress={() => onWiden(widerThan(within) as number)} />
          : null}
        {/* Both act on rows ticked in the index table, so they belong to that
            view: the household's list has nothing to tick, and two disabled
            buttons under it would be dead controls about somebody else's
            board. */}
        {view === 'everything' ? (
        <>
        <Act label={busy === 'curate' ? 'Curating…' : picked.size ? `Curate these ${picked.size} · free` : 'Curate them · free'} tone="secondary"
             disabled={!canManage || !picked.size || busy != null}
             onPress={() => { setBusy('curate'); api.adminCuratePlaces([...picked]).finally(() => { setBusy(null); setPicked(new Set()); forgetBoards(); reload(); }); }} />
        {/* Fetching a name is the one thing on this board that spends, and the
            button says what it costs before it is pressed. Only the rows we hold
            no name for cost anything: the rest are already ours to print. */}
        <Act label={busy === 'google' ? 'Asking…'
                     : nameless ? `Fetch the ${nameless} name${nameless === 1 ? '' : 's'} · ${pounds(Math.round(nameless * 1.4))}`
                     : picked.size ? 'Nothing to fetch · we hold every name' : 'Fetch the names'}
             disabled={!canManage || !nameless || busy != null}
             onPress={() => {
               setBusy('google');
               api.adminAskAboutPlaces(data?.rows.filter((r) => picked.has(r.ref) && !r.name).map((r) => r.ref) ?? [])
                 // Held for this screen and not written down: a provider's name
                 // is rented, and the row it fills stops being a bare id only
                 // while you are looking at it.
                 .then((r) => setFetched((f) => ({ ...f, ...Object.fromEntries(r.names.map((n) => [n.ref, n.name])) })))
                 .finally(() => { setBusy(null); setPicked(new Set()); forgetBoards(); reload(); });
             }} />
        </>
        ) : null}
      </Footer>
    </>
  );
}

/**
 * BO2s — the first ten, as a household would be shown them.
 *
 * The board this screen has always drawn answers "how complete is our data",
 * which is not a question anybody outside this building asks. This one answers
 * the owner's (20 Sep 2026): "I want the default view to be what the user
 * sees… if I switch to user view, then I should just see the first 10."
 *
 * Three things make it that list rather than a prettier index:
 *
 *   · **Our own order.** The Epic score — ours, derived, and the only ranking
 *     that survives a provider going (data policy, 19 Sep 2026). A place nobody
 *     has scored sorts below one that has and says "not scored" rather than
 *     printing a nought, because we do not know is not a low mark.
 *   · **Nothing nameless.** A `google:` reference we own nothing about has no
 *     name we may hold, and it is not a row a household may ever see. The count
 *     held back is printed instead, so the gap is a number rather than silence.
 *   · **No picture in the row, on purpose.** The owner: "I don't need to see the
 *     picture… When I click into it, I should be able to see the picture." The
 *     column says whether there is one; the place's own Pictures tab is where
 *     they are.
 */
function HouseholdSeen({ data, onPlace, page, onPage }: {
  data: Awaited<ReturnType<typeof api.adminHouseholdView>> | null;
  onPlace: (ref: string) => void;
  /** Which ten, one-based — a household scrolls for these, so this board has them too. */
  page: number; onPage: (n: number) => void;
}) {
  if (!data) return <Waiting />;
  const columns: Col<HouseholdRow>[] = [
    { key: 'name', label: 'Place', tip: ['The place', 'The name we hold and may show, and under it what we say it is. Both are ours — an owned record, the atlas, or OpenStreetMap.'], grow: true,
      // Hidden overflow as well as one line: a cell in a column that grows has
      // no width of its own, so a long line ran straight across the score and
      // the ticks beside it (20 Sep 2026, on the deployed board).
      cell: (r) => (
        <View style={[styles.nameCell, { overflow: 'hidden' }]}>
          <Text style={styles.rowName} numberOfLines={1}>{r.name}</Text>
          <Text style={styles.rowNote} numberOfLines={1}>
            {r.what ?? ([r.cuisines.slice(0, 2).join(' · '), r.chain ? 'a chain' : null].filter(Boolean).join(' · ') || 'nothing written about it yet')}
          </Text>
        </View>
      ) },
    { key: 'epic', label: 'Our score', width: 96, align: 'right',
      tip: ['The Epic score', 'Ours, and derived: Google\u2019s rating and review count with our own signals — visits, household ratings, rank and recency. Never a stored copy of anybody\u2019s number.'],
      cell: (r) => (r.epicScore == null ? <Word muted>not scored</Word> : <ScoreCell v={r.epicScore} strong />) },
    { key: 'standing', label: 'Standing', width: 96, align: 'left',
      tip: ['What the crowd says', 'A band, never a rating: the figure it was made from is a provider\u2019s and was never written down.'],
      cell: (r) => (r.standing ? <Word>{STANDING_WORD[r.standing] ?? r.standing}</Word> : <Blank />) },
    { key: 'been', label: 'How many', width: 92, align: 'left',
      tip: ['How many have been', 'A band, from the review count. The count itself is a provider\u2019s and is not kept.'],
      cell: (r) => (r.howMany ? <Word muted>{beenWord(r.howMany)}</Word> : <Blank />) },
    { key: 'where', label: 'Where', tip: 'wherePlace', width: 74, align: 'left', cell: (r) => <Word muted>{r.outcode ?? '—'}</Word> },
    { key: 'picture', label: 'Picture', width: 74, align: 'centre',
      tip: ['A picture we may show', 'Whether we hold one that is ours to publish. Open the place to see it — the Pictures tab holds every one we have.'],
      cell: (r) => <Tick on={Boolean(r.picture)} /> },
    { key: 'hours', label: 'Hours', width: 66, align: 'centre', tip: ['Opening hours', 'Ours, from the venue\u2019s own page or the open map.'], cell: (r) => <Tick on={r.hours} /> },
    { key: 'menu', label: 'Menu', width: 66, align: 'centre', tip: ['A menu we have read', 'Read from the venue\u2019s own page — menu, order, stars is the path this feeds.'], cell: (r) => <Tick on={r.menu} /> },
    { key: 'go', label: '', width: 28, align: 'right', cell: () => <Icon name="more" size={15} strokeWidth={2} color={colors.inkMuted} /> },
  ];
  return (
    <>
      <View style={{ paddingBottom: 6 }}>
        {/* What the ten were chosen from, what was held back, and what it cost:
            nothing. The board says the last one out loud because every other
            way of seeing a place as a household sees it goes to a provider. */}
        <Text style={styles.rowNote}>
          {[
            data.rows.length
              // Which ten of how many, so the page says where in the list it is
              // rather than always claiming to be the first.
              ? `${(data.from + 1).toLocaleString()}\u2013${(data.from + data.rows.length).toLocaleString()} of ${data.named.toLocaleString()}`
              : 'Nothing here a household could be shown yet',
            data.nameless ? `${data.nameless.toLocaleString()} with no name we may show ${data.nameless === 1 ? 'is' : 'are'} not here` : null,
            data.unscored ? `${data.unscored.toLocaleString()} not scored yet` : null,
            'nothing asked of a provider',
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.ref} onRow={(r) => onPlace(r.ref)}
              phoneRow={(r) => ({
                name: r.name,
                note: r.what ?? r.outcode ?? '',
                chips: [
                  { key: 'epic', word: r.epicScore == null ? 'not scored' : `score ${r.epicScore}`, lead: true },
                  ...(r.standing ? [{ key: 'standing', word: STANDING_WORD[r.standing] ?? r.standing }] : []),
                  ...(r.picture ? [] : [{ key: 'picture', word: 'no picture' }]),
                ],
              })}
              empty={<Word muted>
                {data.nameless
                  ? `Nothing here has a name we may show. ${data.nameless.toLocaleString()} ${data.nameless === 1 ? 'place is' : 'places are'} known here by a provider\u2019s identifier alone.`
                  : 'Nothing here yet.'}
              </Word>} />
      <Footer left={data.named > data.rows.length
        ? <Text style={styles.rowNote}>{`Page ${page} of ${Math.max(1, Math.ceil(data.named / 10)).toLocaleString()}`}</Text>
        : null}>
        {/* A household scrolls; a board pages. Both are the same act — show me
            the ones after these (owner, 20 Sep 2026: "users can also go to the
            next 10 and the next 10"). */}
        {page > 1 ? <Act label="The ten before" tone="secondary" onPress={() => onPage(page - 1)} /> : null}
        {data.from + data.rows.length < data.named
          ? <Act label={`The next ${Math.min(10, data.named - (data.from + data.rows.length))}`} onPress={() => onPage(page + 1)} />
          : null}
      </Footer>
    </>
  );
}

/** Our word for the crowd, the same four the sweep uses. */
const STANDING_WORD: Record<string, string> = { top: 'Top', high: 'High', good: 'Good', mixed: 'Mixed' };

/** "A playground", "A restaurant" — the kind of place, said the way a sentence needs it. */
const kindWord = (label: string) => {
  const one = label.replace(/ (&|and) .*$/, '').replace(/s$/, '');
  return `${/^[aeiou]/i.test(one) ? 'An' : 'A'} ${one.toLowerCase()}`;
};

const listWords = (w: string[]) => (w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);

/** The score column explains its own weights, read from the bar in force. */
const barTip = (bar: BarFact[], facts: FactDef[]) => {
  if (!bar.length) return 'scoreNow' as const;
  const said = bar.map((b) => `${(facts.find((f) => f.key === b.fact)?.short ?? b.fact).toLowerCase()} ${b.weight}`).join(', ');
  return ['Score', `Weighted completeness over the ${bar.length} facts this kind of place needs — ${said}. Equal completeness scores equally, and missing the heaviest costs most.`] as const;
};
const missingTip = (bar: BarFact[], facts: FactDef[]) => {
  if (!bar.length) return 'missing' as const;
  const said = listWords(bar.map((b) => (facts.find((f) => f.key === b.fact)?.short ?? b.fact).toLowerCase()));
  return ['Missing', `Of the ${bar.length} facts this kind of place needs — ${said} — how many we do not hold. Sortable.`] as const;
};

// ---------------------------------------------------------------------------
// the Collect lens
// ---------------------------------------------------------------------------

/**
 * What we could get for this area, which sources could supply it, and what each
 * would cost.
 *
 * The one view in this package that is written down rather than drawn: the
 * design's README lists it under "Still to design" and describes it exactly —
 * "a picklist of sources with when each was last asked, a staleness rule so a
 * place is not re-asked inside twelve months unless something changed, and one
 * *ask them all* action instead of a row per provider". That is what this is.
 *
 * Starting a run happens here, where the gap is. Runs only watches.
 */
const STALE_MONTHS = 12;

function CollectBoard({ q, level, canManage, cat, sub }: {
  q: any; level: PlaceLevel; canManage: boolean; cat: string; sub: string;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceSources>> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(['osm', 'atlas', 'own']));
  const [busy, setBusy] = useState(false);
  /** What happened when it was pressed — including the ceiling saying no. */
  const [said, setSaid] = useState<string | null>(null);
  /**
   * What the run would actually do, from the run's own arithmetic.
   *
   * Every figure in the footer and the last two columns comes from here rather
   * than from a copy of the rules kept on the screen, which is what let the
   * board quote four figures for a run of fifty places (17 Sep 2026).
   */
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof api.adminCollectQuote>> | null>(null);
  useEffect(() => { setData(null); api.adminPlaceSources(q).then(setData).catch(() => setData(null)); }, [q]);
  useEffect(() => {
    setQuote(null);
    api.adminCollectQuote({ ...q, cat: cat || undefined, sub: sub || undefined, sources: [...picked] })
      .then(setQuote).catch(() => setQuote(null));
  }, [q, cat, sub, picked]);
  if (!data) return <Waiting />;

  const known = level.stats.known;
  // How many each source would be asked about, and what that would cost —
  // both from the quote, so the board and the run agree by construction.
  const wouldFor = (key: string) => {
    if (!quote) return null;
    if (key === 'google') return quote.would.google;
    if (key === 'tripadvisor') return quote.would.tripadvisor;
    // The three open sources are one research pass, so they share its figure.
    return picked.has(key) ? quote.would.free : null;
  };
  const rows = data.sources.map((s) => {
    const held = data.rows.reduce((n, r) => n + (r.counts[s.key] ?? 0), 0);
    return { ...s, held, would: wouldFor(s.key) };
  });
  const chosen = rows.filter((r) => picked.has(r.key));
  // Money, from the quote. Tripadvisor costs no money at all — it is bounded by
  // a monthly count of locations — and the screen used to price it at nought
  // per place, which read as free rather than as capped (17 Sep 2026).
  const cost = quote?.spendPence ?? 0;

  const columns: Col<typeof rows[number]>[] = [
    { key: 'tick', label: '', width: 26, align: 'left', stops: true,
      cell: (r) => <Box on={picked.has(r.key)} onPress={() => setPicked(toggle(picked, r.key))} label={r.label} /> },
    { key: 'label', label: 'Source', tip: 'collect', grow: true,
      cell: (r) => (
        <View style={styles.nameCell}>
          <Text style={styles.rowName}>{r.label}</Text>
          <Text style={styles.rowNote}>{r.explain}</Text>
        </View>
      ),
      cellTip: (r) => [r.label, r.explain] as const },
    { key: 'asked', label: 'Last asked', tip: ['Last asked', `When this source was last asked about a place here. Nothing is asked again inside ${STALE_MONTHS} months unless something about the place has changed.`] as const,
      width: 140, align: 'right',
      // The date, not the word "somewhere". The column promises when, and all
      // it used to be given was a boolean (17 Sep 2026, the verification audit).
      cell: (r) => (r.askedHere ? <Word muted>{day(r.askedHere)}</Word> : <NotAsked />),
      cellTip: (r) => (r.askedHere
        ? null
        : ([r.label, r.asked
          ? `${r.label} has been asked about places elsewhere, and about none here.`
          : `${r.label} has never been asked about a place anywhere.`] as const)) },
    { key: 'held', label: 'Already held', tip: 'known', width: 130, align: 'right', cell: (r) => <Num n={r.held || null} /> },
    { key: 'would', label: 'Would ask about',
      tip: ['Would ask about', `How many places this run would ask this source about — after the ${quote?.staleMonths ?? STALE_MONTHS}-month rule, and capped at the ${quote?.limit ?? 50} the run takes at a time. The run's own figure, not an estimate.`] as const,
      width: 150, align: 'right',
      cell: (r) => (picked.has(r.key) ? <Num n={r.would || null} strong /> : <Word muted>—</Word>) },
    { key: 'cost', label: 'What it would cost', tip: 'providerSpend', width: 160, align: 'right',
      cell: (r) => {
        if (!r.paid) return <Word muted>free</Word>;
        if (!picked.has(r.key)) return <Word muted>—</Word>;
        // Tripadvisor costs no money: it is bounded by a monthly count of
        // locations instead, and "£0.00" read as free rather than as capped
        // (17 Sep 2026).
        if (r.key === 'tripadvisor') {
          return <Word>{`${r.would ?? 0} of ${quote?.tripadvisorLeft ?? 0} left`}</Word>;
        }
        return <Word>{pounds(Math.round(quote?.spendPence ?? 0))}</Word>;
      } },
  ];

  return (
    <>
      <View style={styles.subRow}><Kicker tip="sectionWhatWeCouldGet">What we could get here</Kicker></View>
      <Ladder columns={columns} rows={rows} keyOf={(r) => r.key}
              phoneRow={(r: any) => ({
                name: r.label,
                note: r.would == null ? 'not asked here' : `${(r.would ?? 0).toLocaleString()} to ask about`,
                chips: [
                  { key: 'cost', word: r.free ? 'free' : pounds(Math.round(quote?.spendPence ?? 0)), tip: 'providerSpend', lead: !r.free },
                  ...(r.held != null ? [{ key: 'held', word: `${r.held.toLocaleString()} already held`, tip: 'known' as const }] : []),
                ],
              })} />
      {/* Said once, because the board cannot promise otherwise: the three free
          sources are one research pass. `own.js` reads the venue's own page,
          the open map and the encyclopedias together and cannot be asked for
          one of them alone, so ticking any of the three runs all three (Codex,
          17 Sep 2026). The rows still say what each has given us. */}
      <View style={styles.subRow}>
        <Word muted>The three free sources are one pass — our own research reads all three together.</Word>
      </View>
      <Footer left={<Text style={styles.selected}>{said ?? [
        `${chosen.length} source${chosen.length === 1 ? '' : 's'} · ${cost ? pounds(Math.round(cost)) : 'free'}`,
        quote ? ` · ${quote.places} place${quote.places === 1 ? '' : 's'} this run` : '',
        // The places the twelve-month rule leaves alone, said before the run
        // rather than found missing afterwards.
        quote && (quote.fresh.free || quote.fresh.google || quote.fresh.tripadvisor)
          ? ` · ${Math.max(quote.fresh.free, quote.fresh.google, quote.fresh.tripadvisor)} asked inside ${quote.staleMonths} months, left alone`
          : '',
      ].join('')}</Text>}>
        <Act label="Work out the scores again · free" tone="secondary" disabled={!canManage || busy}
             onPress={() => { setBusy(true); api.adminRescorePlaces().finally(() => setBusy(false)); }} />
        {/* One action, not a row per provider — and it carries the scope it was
            pressed in, which is the whole idea of Collect living inside Places
            (Codex, 17 Sep 2026: it used to throw both away and reindex). */}
        <Act label={busy ? 'Going…' : `Ask them all · ${cost ? pounds(Math.round(cost)) : 'free'}`} icon="download"
             disabled={!canManage || busy || !chosen.length}
             onPress={() => {
               setBusy(true); setSaid(null);
               api.adminCollect({ ...q, cat: cat || undefined, sub: sub || undefined, sources: [...picked] })
                 .then((r) => setSaid([
                   `Going: ${r.places} places, ${r.free} free`,
                   r.google ? `, ${r.google} to Google at ${pounds(r.spendPence)}` : '',
                   r.tripadvisor ? `, ${r.tripadvisor} to Tripadvisor` : '',
                   // Said out loud rather than swallowed: Tripadvisor's ceiling
                   // is counted in calls, so the ones it left out are named.
                   r.tripadvisorCapped ? ` (${r.tripadvisorCapped} left out — ${r.tripadvisorLeft} Tripadvisor calls left this month)` : '',
                   // The staleness rule, reported rather than only promised:
                   // asking again inside twelve months buys the same answer
                   // twice (Codex, 17 Sep 2026).
                   (r.fresh?.google || r.fresh?.tripadvisor || r.fresh?.free)
                     ? `. ${Math.max(r.fresh.google, r.fresh.tripadvisor, r.fresh.free)} asked inside the last ${r.staleMonths} months, so left alone`
                     : '',
                   '.',
                 ].join('')))
                 .catch((e: any) => setSaid(e?.body?.message ?? 'That could not be started.'))
                 .finally(() => setBusy(false));
             }} />
      </Footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// BO2h / BO2i / BO2r — one place
// ---------------------------------------------------------------------------

const PLACE_TABS = ['record', 'compare', 'score', 'pictures', 'raw', 'history'] as const;
type PlaceTab = typeof PLACE_TABS[number];
const PLACE_TAB_LABEL: Record<PlaceTab, string> = {
  record: 'The record', compare: 'Ours beside theirs', score: 'How it scored',
  pictures: 'Pictures', raw: 'Sources', history: 'History',
};
const PLACE_TAB_TIP: Record<PlaceTab, TipKey> = {
  record: 'tabTheRecord', compare: 'tabOursBesideTheirs', score: 'tabHowItScored',
  pictures: 'tabPictures', raw: 'tabWhatEachSourceReturned', history: 'tabHistory',
};

// `phone` used to be handed in here and never read: the drawer's own narrow
// layout comes from `useViewport` inside each tab, which is the rule (CLAUDE.md
// — never read the window directly), so the prop was a claim the component did
// not honour (18 Sep 2026, the separate audit).
function PlaceBoard({ refId, canManage, onClose, tab, onTab }: {
  refId: string; canManage: boolean; onClose: () => void;
  /** Held by the screen above, so closing the drawer takes `?tab=` with it. */
  tab: PlaceTab; onTab: (t: PlaceTab) => void;
}) {
  const setTab = onTab;
  // The drawer is told it is 390 wide by the frame, like everything else — never
  // the window (CLAUDE.md).
  const { width } = useViewport();
  const narrow = width < PHONE;
  const [error, setError] = useState<string | null>(null);
  /** What the drawer is doing, in the words the menu used to say it. */
  const [busyWord, setBusyWord] = useState<string | null>(null);
  const [place, refresh] = useFresh(
    JSON.stringify(['place', refId]),
    () => api.adminPlace(refId).then((p) => { setError(null); return p; }),
    (e: any) => setError(e?.body?.message ?? 'Nothing indexed under that ref yet.'),
  );
  // Anything that changes this place changes the boards behind it, so the
  // reload the drawer's own buttons call forgets what they were told.
  const load = useCallback(() => { forgetBoards(); refresh(); }, [refresh]);
  useEffect(() => { setError(null); }, [refId]);

  if (error) {
    return (
      <AdminPage>
        <Band kicker="PLACE" title="Not in the index" />
        <Word muted>{error}</Word>
        <Footer><Act label="Back" tone="secondary" onPress={onClose} /></Footer>
      </AdminPage>
    );
  }
  if (!place) return <AdminPage><Waiting /></AdminPage>;

  const kicker = [
    place.subcategory ? place.subcategory.replace(/-/g, ' ').toUpperCase() : 'UNSHELVED',
    place.ownership === 'identified' ? 'IDENTIFIED ONLY' : place.ownership.toUpperCase(),
  ].join(' · ');

  return (
    <AdminPage>
      <View style={styles.trail}>
        <Press effect="none" onPress={onClose} accessibilityRole="button" accessibilityLabel="Back" style={styles.trailBack}>
          <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
          <Text style={styles.trailWord}>Back</Text>
        </Press>
        {place.areas.map((a, i) => <Text key={`${a.slug}-${i}`} style={styles.trailNote}>{`· ${a.name}`}</Text>)}
      </View>
      <Band kicker={kicker} title={place.name ?? 'No name we may show'} stats={
        tab === 'score' ? null : (
          // BO2h's four and BO2r's five, which are the same drawer: DATA
          // SCORE · READY · OLDEST FACT · SEEN BY, plus what BO2r adds. Ready
          // and Seen by were missing, and their words sat unused in tips.ts
          // (17 Sep 2026, the verification audit).
          <View style={styles.five}>
            <Stat label="Data score" value={place.score ?? '—'} tip="dataScore" mark />
            <Stat label="Ready" value={place.ready ? 'Yes' : 'No'} tip="ready" mark />
            <Stat label="Have · missing" value={`${place.have} · ${place.missingCount}`} mark
                  tip={['Have · missing', `Counts only the ${place.have + place.missingCount} facts this kind of place is judged on. Everything else is recorded when we have it and never counts against the score.`]} />
            <Stat label="Seen by" value={place.seenBy} tip="seenBy" mark />
            <Stat label="Unseen by" value={place.unseen.length} tip="unseenByPlace" accent mark />
            {/* What we could actually show: a mark that belongs to somebody
                else is not a picture of this place. */}
            <Stat label="Pictures" value={place.pictures.filter((p) => p.owned && p.belongsHere !== false).length} tip="pictures" mark />
            <Stat label="Oldest fact" value={place.oldestFact ? ago(place.oldestFact) : 'never'} tip="oldestFactPlace" mark />
          </View>
        )
      } />

      <View style={styles.lensRow}>
        <View style={[styles.lensLeft, narrow && styles.lensLeftPhone, narrow && styles.lensLeftPhoneWidth]}>
          <Kicker tip="sectionLookingAt">Looking at</Kicker>
          {/* The same sideways scroller the board's own lens row uses, and for
              the same reason. Six tab names are 719px wide and the drawer is
              390: laid out flat, "What each source returned" and "History" were
              off the edge of a phone with nothing to scroll to them, so two of
              the drawer's six tabs could not be reached at all (19 Sep 2026,
              the 390px audit). */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.lenses}
                      style={narrow ? [styles.lensScrollPhone, { width: '100%' }] : { flexShrink: 1, minWidth: 0 }}>
            {/* Six words, six hovers: they are the headings of this drawer, and
                they were the last labels on it that explained nothing (18 Sep
                2026, the separate audit). */}
            {PLACE_TABS.map((t) => (
              <Explain key={t} tip={PLACE_TAB_TIP[t]} cursor="pointer">
                <Press effect="none" onPress={() => setTab(t)} accessibilityRole="tab"
                       accessibilityState={{ selected: tab === t }} accessibilityLabel={PLACE_TAB_LABEL[t]}
                       style={[styles.lens, tab === t && styles.lensOn]}>
                  <Text style={[styles.lensWord, tab === t && styles.lensWordOn]}>{PLACE_TAB_LABEL[t]}</Text>
                </Press>
              </Explain>
            ))}
          </ScrollView>
        </View>
        {/* Wraps on a phone: three actions with their prices on them are wider
            than the frame, and the third — "Ask Google about it" — is BO2r's own
            primary action (19 Sep 2026, the 390px audit). */}
        {/* One list, not a row of words nobody can tell apart.

            The owner, 20 Sep 2026: "I don't know what 'curate it free' is
            supposed to mean or do, and compare all 3, and ask Google about it
            when we've already asked Google about it… Looking at it, we should
            just have a menu, and that's it." So every act this drawer can
            perform is in one place, each says plainly what it does and what it
            costs, and the price is the API's own figure rather than one typed
            on a screen. Asking again lives on Sources, where it can say when we
            last asked. */}
        <Dropdown label="Do something" value={busyWord ?? 'Choose'} width={300}
                  options={[
                    { on: false, key: 'research', label: 'Research it from its own website · free', group: 'Free, from what it publishes' },
                    { on: false, key: 'picture', label: 'Look for a picture we may keep · free', group: 'Free, from what it publishes' },
                    { on: false, key: 'menu', label: 'Read its menu · free', group: 'Free, from what it publishes' },
                    { on: false, key: 'ask', label: `Ask Google about this one place · ${place.askPence ? pounds(Math.round(place.askPence)) : 'free'}`, group: 'Spends' },
                    { on: false, key: 'compare', label: `Put ours beside theirs · ${place.comparePence ? pounds(Math.round(place.comparePence)) : 'free'}`, group: 'Spends' },
                  ]}
                  onPick={(k) => {
                    if (!canManage || busyWord) return;
                    if (k === 'compare') { setTab('compare'); return; }
                    const run = k === 'ask' ? api.adminAskAboutPlaces([refId])
                      : k === 'picture' ? api.adminFindPictures([refId])
                      : k === 'menu' ? api.scoutReadMenus(1, refId)
                      : api.adminCuratePlaces([refId]);
                    setBusyWord(k === 'ask' ? 'Asking Google…' : k === 'picture' ? 'Looking…' : k === 'menu' ? 'Reading the menu…' : 'Researching…');
                    Promise.resolve(run).finally(() => { setBusyWord(null); load(); });
                  }} />
      </View>

      {tab === 'record' ? <RecordTab place={place} canManage={canManage} onSaved={load} /> : null}
      {tab === 'compare' ? <CompareTab refId={refId} canManage={canManage} onEdit={() => setTab('record')} /> : null}
      {tab === 'score' ? <ScoreTab refId={refId} canManage={canManage} /> : null}
      {tab === 'pictures' ? <PlacePicturesTab place={place} canManage={canManage} onFound={load} /> : null}
      {tab === 'raw' ? <RawTab refId={refId} canManage={canManage} onDone={load} /> : null}
      {tab === 'history' ? <HistoryTab refId={refId} /> : null}
    </AdminPage>
  );
}

/** BO2r — every field with its source, and Edit on the ones that are ours. */
function RecordTab({ place, canManage, onSaved }: { place: PlaceDetail; canManage: boolean; onSaved: () => void }) {
  const { navigate } = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [reach, setReach] = useState<{ rule: string | null; places: number; counties: number; onlyThis: boolean } | null>(null);
  const [openSources, setOpenSources] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { width } = useViewport();

  useEffect(() => { api.adminPlaceReach(place.ref).then(setReach).catch(() => setReach(null)); }, [place.ref]);

  /**
   * A hole offers the thing that would fill it, and pressing it runs that thing.
   *
   * The API marks each hole with the action that fills it and the buttons all
   * opened the edit box instead, so four of them did nothing at all (17 Sep
   * 2026, the verification audit). Ask is the only one that spends, and it is
   * the only one that says a price.
   */
  const runFor = async (key: string, action: FieldAction) => {
    setBusy(key);
    try {
      if (action === 'write') await api.adminCuratePlaces([place.ref]);
      else if (action === 'find') {
        // The website first, because everything else is read off it; a picture
        // is the other thing Find is offered for.
        if (key === 'website') await api.adminCuratePlaces([place.ref]);
        else await api.adminFindPictures([place.ref]);
      } else if (action === 'read') await api.scoutReadMenus(1, place.ref);
      else if (action === 'ask') await api.adminAskAboutPlaces([place.ref]);
    } catch { /* the row stays a hole, and says so */ }
    setBusy(null);
    onSaved();
  };

  const save = async (key: string) => {
    setSaving(true);
    try { await api.adminEditPlace({ ref: place.ref, field: key, value: draft }); setEditing(null); onSaved(); }
    finally { setSaving(false); }
  };

  return (
    <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.recordHead}>
          <Explain tip="field" style={{ width: 128 }}><Text style={styles.headLabelSmall}>Field</Text></Explain>
          <Explain tip="whatWeHold" style={{ flex: 1 }}><Text style={styles.headLabelSmall}>What we hold</Text></Explain>
          <Explain tip="source" style={{ width: 84 }}><Text style={styles.headLabelSmall}>Source</Text></Explain>
          <Explain tip="checked" style={{ width: 92 }}><Text style={styles.headLabelSmall}>Checked</Text></Explain>
          <View style={{ width: 72 }} />
          <Explain tip="openTheRow" style={{ width: 26 }}><Text style={styles.headLabelSmall} /></Explain>
        </View>
        {place.record.map((f) => (
          <React.Fragment key={f.key}>
            <View style={styles.recordRow}>
              <Text style={[styles.fieldName, !f.value && { color: colors.inkMuted }]}>{f.label}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                {f.value
                  ? <Text style={styles.fieldValue}>{f.value}</Text>
                  : f.notCounted
                    ? <Na tip={['Not required', `${kindWord(place.subcategory ?? 'this kind of place')} is not judged on this, so it never counts against the score.`]} />
                    : <Blank />}
              </View>
              <Text style={[styles.fieldMeta, { width: 84 }]}>{f.source ?? '—'}</Text>
              <Text style={[styles.fieldMeta, { width: 92 }]}>
                {f.checked === 'never' ? 'never' : f.checked ? day(f.checked) : '—'}
              </Text>
              {/* The act that fills this hole is in the row when it is opened,
                  not in the row itself.
                  The owner, 20 Sep 2026: "we shouldn't have a button that's
                  inserted in a row that then moves the date into another area…
                  the menu read, I think, should just be in the down arrow or in
                  an actions tab, but at the moment it's not very nicely
                  designed, not very clean." A button that appears on some rows
                  and not others shifts every column beside it, which is what
                  moved the dates. */}
              <View style={{ width: 72, flexDirection: 'row', gap: 6, justifyContent: 'flex-end' }}>
                {f.editable && canManage ? (
                  <Explain tip="editableValue">
                    <Press effect="none" onPress={() => { setEditing(f.key); setDraft(String(f.value ?? '')); }}
                           accessibilityRole="button" accessibilityLabel={`Edit ${f.label}`} style={styles.edit}>
                      <Icon name="edit" size={11} strokeWidth={2} color={colors.inkMuted} />
                      <Text style={styles.editWord}>Edit</Text>
                    </Press>
                  </Explain>
                ) : null}
              </View>
              <Press effect="none" onPress={() => setOpen(open === f.key ? null : f.key)} hitSlop={8}
                     accessibilityRole="button" accessibilityLabel={`Open ${f.label}`} style={{ width: 26, alignItems: 'flex-end' }}>
                <Icon name={open === f.key ? 'collapse' : 'expand'} size={15} strokeWidth={2} color={colors.inkMuted} />
              </Press>
            </View>
            {open === f.key ? (
              <View style={styles.expand}>
                <Detail label="Reference" value={f.reference ?? (f.source ? `${f.source}${f.checked ? ` · ${day(f.checked)}` : ''}` : 'we hold none')} />
                <Detail label="Raw value" value={f.value ? `"${f.value}"` : '—'} />
                <Detail label="Set by" value={f.note ?? (f.source ? sourceWord(f.source) : 'nothing yet')} />
                <Detail label="Counts towards ready" value={f.counted == null ? '—' : f.counted ? 'yes' : 'no, recorded only'} />
                {f.action && canManage ? (
                  <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
                    {/* Who is being asked, not just "Ask". A price with no name
                        beside it is a question nobody can answer: "the opening
                        hours say Ask for 3p. I'm assuming that's Google, but
                        ask who?" (owner, 20 Sep 2026.) */}
                    <Act label={busy === f.key ? 'Asking…' : (ACTION_SAYS[f.action as FieldAction] ?? 'Ask Google')}
                         small tone="secondary" disabled={busy != null}
                         onPress={() => runFor(f.key, f.action as FieldAction)} />
                  </View>
                ) : null}
              </View>
            ) : null}
            {editing === f.key ? (
              <View style={styles.expand}>
                <View style={styles.editRow}>
                  <TextInput value={draft} onChangeText={setDraft} style={styles.editInput}
                             accessibilityLabel={`${f.label} value`} placeholder={f.label} placeholderTextColor={colors.inkMuted} />
                  <Act label="Save" tone="solid" small disabled={saving} onPress={() => save(f.key)} />
                  <Act label="Cancel" tone="secondary" small onPress={() => setEditing(null)} />
                </View>
                {f.key === 'subcategory' && reach && !reach.onlyThis ? (
                  <Explain tip="thisIsTheRuleNotThisPlace" style={styles.ruleWarn}>
                    <Text style={styles.ruleWarnBig}>{`Changes every ${reach.rule ?? 'place this rule catches'}`}</Text>
                    <Text style={styles.ruleWarnSmall}>{`${reach.places.toLocaleString()} places · ${reach.counties.toLocaleString()} counties`}</Text>
                  </Explain>
                ) : null}
              </View>
            ) : null}
          </React.Fragment>
        ))}
      </View>

      <View style={[styles.side, width < 1100 && { width: '100%', borderLeftWidth: 0, paddingLeft: 0 }]}>
        <Kicker tip="sectionPicturesOnPlace">{`Pictures · ${place.pictures.filter((p) => p.owned).length} owned`}</Kicker>
        <View style={styles.thumbs}>
          {place.pictures.length === 0 ? <Word muted>None yet.</Word> : place.pictures.slice(0, 6).map((p, i) => (
            // A picture can be linked to the place and to its atlas row at once,
            // so the position is part of the key.
            // A mark taken off the site of the place this one sits inside is
            // not this place's picture, and the tile says so rather than
            // leaving an airport's logo looking like a restaurant's (owner, 20
            // Sep 2026). It is dimmed and named, never quietly deleted.
            <Explain key={`${p.id}-${i}`}
                     tip={p.belongsHere === false
                       ? ['Not this place\u2019s mark', 'This was taken off the website we hold for the venue, and that website is a page on somebody else\u2019s site — an airport, a shopping centre, a brewery. The mark on it belongs to them. New ones are refused; this one is still here and should not be shown.']
                       : (p.owned ? null : 'rented')}
                     style={[styles.thumb, (!p.owned || p.belongsHere === false) && { opacity: 0.5 }]}>
              {/* The picture, not a grey box. The ids were in hand and the panel
                  drew N empty squares under the words "N owned" (17 Sep 2026,
                  the verification audit). */}
              <View style={styles.thumbImage}>
                <Image source={{ uri: api.imageUrl(p.id, 240) }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
              </View>
              <Text style={styles.thumbNote} numberOfLines={1}>
                {p.belongsHere === false ? 'not this place' : p.owned ? (p.source ?? 'ours') : 'rented'}
              </Text>
            </Explain>
          ))}
        </View>
        {/* No buttons under the thumbnails.
            The owner, 20 Sep 2026: "I don't understand what 'Look on Commons
            Free' is underneath the image and what 'households have sent' is…
            You can remove the text. Looking at it, we should just have a menu,
            and that's it." Looking for a picture is in the drawer's own menu
            now; the queue of what households have sent is a board of its own,
            reached from the Pictures tab where a picture is the subject. */}

        <View style={{ height: spacing.lg }} />
        <Kicker tip="sectionNotChecked">Not checked</Kicker>
        {/* Which sources, not just how many: the board's own tooltip says "open it
            to see which and run them", so the row opens (Codex, 17 Sep 2026). */}
        {([['free', place.unseen.filter((u) => !u.paid)], ['paid', place.unseen.filter((u) => u.paid)]] as const).map(([which, list], i) => (
          <React.Fragment key={which}>
            <Explain tip={which === 'free'
              ? ['Free sources', `${list.map((u) => u.label).join(', ') || 'Nothing'} ${list.length === 1 ? 'has' : 'have'} never been asked about this place. Nothing to spend.`]
              : ['Paid sources', `${list.map((u) => `${u.label}${u.pence ? ` (${pounds(Math.round(u.pence))} a place)` : ''}`).join(', ') || 'Nothing'} ${list.length === 1 ? 'has' : 'have'} never been asked. Tripadvisor also comes out of this month's allowance.`]}
                     style={[styles.notChecked, i === 1 && { borderBottomWidth: 0 }]}>
              <Press effect="none" onPress={() => setOpenSources(openSources === which ? null : which)}
                     accessibilityRole="button" accessibilityLabel={`The ${which} sources nobody has asked`}
                     style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Text style={styles.notCheckedBig}>{list.length}</Text>
                <Text style={styles.notCheckedWord}>{`${which} sources`}</Text>
                <View style={{ flex: 1 }} />
                <Icon name={openSources === which ? 'collapse' : 'expand'} size={15} strokeWidth={2} color={colors.inkMuted} />
              </Press>
              {/* Each source's own price, added up — it multiplied the count by
                  Google's old 1.4p, so it charged Tripadvisor at Google's rate
                  and both at the wrong one (18 Sep 2026, the separate audit). */}
              <Act label={which === 'free' ? 'Run them'
                : `${pounds(Math.round(list.reduce((n, u) => n + (u.pence ?? 0), 0)))} · ask`} small tone="secondary"
                   disabled={!canManage || !list.length || busy != null}
                   onPress={() => { setBusy(which); (which === 'free' ? api.adminCuratePlaces([place.ref]) : api.adminAskAboutPlaces([place.ref])).finally(() => { setBusy(null); onSaved(); }); }} />
            </Explain>
            {openSources === which ? (
              <View style={styles.expand}>
                {list.length === 0 ? <Word muted>Every one of them has been asked.</Word> : list.map((u) => (
                  <View key={u.key} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{u.label}</Text>
                    <Text style={styles.detailValue}>{u.explain}</Text>
                    <Text style={styles.fieldMeta}>{u.pence ? `£${(u.pence / 100).toFixed(3)} each` : 'free'}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </React.Fragment>
        ))}

        <View style={{ height: spacing.lg }} />
        <Kicker tip="sectionOtherSystems">This place in other systems</Kicker>
        {/* The label hovers as well as the state: an identifier is the thing
            that makes the next question free, and the row said nothing about
            itself (18 Sep 2026, the separate audit). */}
        {place.ids.map((id, i) => (
          <Explain key={id.key} tip={[id.label, id.value
            ? `The identifier ${id.label === 'Ours' ? 'we filed it under' : `${id.label} knows it by`}. Holding it is what makes the next question about this place a single call rather than a search and a call.`
            : `We hold no ${id.label} identifier for this place, so asking ${id.label === 'Ours' ? 'about it' : id.label} means matching it by name and position first.`]}
            style={[styles.idRow, i === place.ids.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={styles.idLabel}>{id.label}</Text>
            {id.value
              ? <Text style={styles.idValue} numberOfLines={1}>{id.value}</Text>
              : id.state === 'no-match' ? <Explain tip="noMatch"><NoMatch /></Explain>
              : <Explain tip="notAsked"><NotAsked /></Explain>}
          </Explain>
        ))}
      </View>
    </View>
  );
}

const DETAIL_TIP: Record<string, TipKey> = {
  Reference: 'detailReference', 'Raw value': 'detailRawValue', 'Set by': 'detailSetBy',
  'Counts towards ready': 'detailCountsTowardsReady',
};
const Detail = ({ label, value }: { label: string; value: string }) => (
  <Explain tip={DETAIL_TIP[label] ?? null} style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </Explain>
);

/**
 * A value, said rather than serialised.
 *
 * An empty object is a blank, not `{}`; an object of facts is its facts in
 * words; and nothing is ever printed as JSON, which is a database's own output
 * and not a thing anybody reads (Codex, 17 Sep 2026). Module-level, because the
 * comparison and the raw record both print provider values and only one of them
 * had this — the raw tab was calling JSON.stringify (18 Sep 2026, the separate
 * audit).
 */
function saidValue(v: unknown): string {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) {
    const parts = v.map((x) => (x && typeof x === 'object' ? (x as any).label ?? (x as any).key ?? (x as any).name ?? '' : String(x))).filter(Boolean);
    return parts.join(', ');
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'object') {
    const held = Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== '' && x !== false);
    if (!held.length) return '';
    return held.map(([k, x]) => (x === true ? fieldWord(k).toLowerCase() : `${fieldWord(k).toLowerCase()} ${saidValue(x)}`)).join(', ');
  }
  return String(v);
}

/** BO2h — ours beside each provider's, field by field. Only ours is editable. */
function CompareTab({ refId, canManage, onEdit }: { refId: string; canManage: boolean; onEdit: (field: string) => void }) {
  const { navigate } = useRouter();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceCompare>> | null>(null);
  const [match, setMatch] = useState(false);
  const [reach, setReach] = useState<{ rule: string | null; places: number; counties: number; onlyThis: boolean } | null>(null);
  useEffect(() => { setData(null); api.adminPlaceCompare(refId, match).then(setData).catch(() => setData(null)); }, [refId, match]);
  useEffect(() => { api.adminPlaceReach(refId).then(setReach).catch(() => setReach(null)); }, [refId]);
  if (!data) return <Waiting />;

  /**
   * A value, said rather than serialised.
   *
   * An empty object is a blank, not `{}`; an object of facts is its facts in
   * words; and nothing is ever printed as JSON, which is a database's own
   * output and not a thing anybody reads (Codex, 17 Sep 2026).
   */
  const say = saidValue;
  /** Four facts, kept apart: we hold it, we never asked, no such place, off here. */
  const missing = (c: CompareColumn) =>
    (c.state === 'off' ? <Explain tip={['Not switched on', `${c.label} is not switched on in this environment, so there was nothing to ask.`]}><Word muted>not switched on</Word></Explain>
      : c.state === 'no-match' ? <Explain tip="noMatch"><NoMatch /></Explain>
      : <Explain tip="notAsked"><NotAsked /></Explain>);
  return (
    <>
      <View style={styles.recordHead}>
        <Explain tip="fact" style={{ width: 180 }}><Text style={styles.headLabelSmall}>Fact</Text></Explain>
        {data.columns.map((c) => (
          <Explain key={c.key}
                   tip={c.key !== 'ours' ? (c.key === 'google' ? 'google' : 'sourceTripadvisor')
                     // The header prints which of ours it is — "The atlas", "The
                     // sweep", "Owned record" — so the hover has to say the same
                     // thing the header says (18 Sep 2026, the separate audit).
                     : c.label === 'Ours' ? 'ours'
                       : ['Ours', `What we hold ourselves on this place, and it came from ${c.label.toLowerCase()}. Every value here is ours to keep; a provider's never lands in it.`]}
                   style={{ flex: 1 }}>
            <Text style={[styles.headLabelSmall, c.key === 'ours' && { color: colors.accent }]}>{c.label}</Text>
          </Explain>
        ))}
        <Explain tip="whereOursCameFrom" style={{ width: 160 }}><Text style={styles.headLabelSmall}>Where ours came from</Text></Explain>
      </View>
      {data.rows.map((r) => (
        <View key={r.key} style={styles.recordRow}>
          <Text style={[styles.fieldName, { width: 180 }]}>{r.label ?? fieldWord(r.key)}</Text>
          {data.columns.map((c) => {
            const v = say(r.cells[c.key]);
            return (
              <View key={c.key} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {/* A whole column that was never asked says so on every row of
                    it: three different facts had collapsed into one dash
                    (Codex, 17 Sep 2026). */}
                {c.state !== 'held' ? missing(c)
                  : v ? <Text style={styles.fieldValue} numberOfLines={2}>{v}</Text>
                  /* Our own hole is said in words, not as a dash: the board is
                     read for what is absent, and "we hold none" is the finding
                     (18 Sep 2026, the separate audit). A provider's blank cell
                     stays a dash — they answered, they just hold nothing. */
                  : c.key === 'ours' ? <Explain tip="weHoldNoneOfThis"><Word muted>we hold none</Word></Explain>
                  : <Blank />}
                {c.key === 'ours' && v && r.editable && canManage ? (
                  <Explain tip="editableColumn">
                    <Press effect="none" onPress={() => onEdit(r.keys.ours as string)} accessibilityRole="button"
                           accessibilityLabel={`Edit ${r.label ?? r.key}`} style={styles.edit}>
                      <Icon name="edit" size={11} strokeWidth={2} color={colors.inkMuted} />
                      <Text style={styles.editWord}>Edit</Text>
                    </Press>
                  </Explain>
                ) : null}
              </View>
            );
          })}
          <Text style={[styles.fieldMeta, { width: 160 }]}>{r.from ?? '—'}</Text>
        </View>
      ))}

      {/* Changing the shelf changes the rule, not the place. How far it would
          travel is said before it travels. */}
      {reach && !reach.onlyThis ? (
        <View style={{ gap: 8, marginTop: spacing.lg }}>
          <Kicker tip="sectionChangingTheShelf">Changing the shelf</Kicker>
          <Explain tip="thisIsTheRuleNotThisPlace" style={styles.ruleWarn}>
            <Text style={styles.ruleWarnBig}>{`Changes every ${reach.rule ?? 'place this rule catches'}`}</Text>
            <Text style={styles.ruleWarnSmall}>{`${reach.places.toLocaleString()} places · ${reach.counties.toLocaleString()} counties`}</Text>
          </Explain>
          {/* BO2h carries the action beside the warning: how far a change would
              travel is said here, and the rule itself is changed on Categories,
              where the rule lives. It was drawn with no way out of it (17 Sep
              2026, the verification audit). */}
          <View style={{ flexDirection: 'row' }}>
            <Act label="Change the rule" tone="secondary" icon="edit"
                 onPress={() => navigate('/admin/categories')} />
          </View>
        </View>
      ) : null}

      <Footer left={(
        <Explain tip="howMuchEachColumnFilled">
          <Text style={styles.rowNote}>{data.columns.map((c) => `${c.label}: ${c.filled ?? 0} of ${c.of ?? 0}`).join('  ·  ')}</Text>
        </Explain>
      )}>
        {/* The price comes from the API. It was written into the bundle as
            £0.014 — the old figure, about half the real one (Codex, 18 Sep
            2026) — and a price a screen holds itself goes stale the day it
            moves. */}
        {!match ? (
          <Act label={`Match it by name and distance · ${data.matchPence ? pounds(Math.round(data.matchPence)) : 'free'}`}
               disabled={!canManage} onPress={() => setMatch(true)} />
        ) : null}
      </Footer>
    </>
  );
}

const fieldWord = (k: string) => k.replace(/_/g, ' ').replace(/^ta /, 'Tripadvisor ').replace(/^./, (c) => c.toUpperCase());

/** BO2i — how it scored, and what that is worth. */
function ScoreTab({ refId, canManage }: { refId: string; canManage: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminScore>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const load = useCallback(() => {
    setData(null);
    api.adminScore(refId)
      .then((d) => { setData(d.scored === false ? null : d); setMissing(d.scored === false); })
      .catch(() => setMissing(true));
  }, [refId]);
  useEffect(load, [load]);
  const { width } = useViewport();
  if (missing) return <Word muted>Not scored — this place has not been swept or claimed.</Word>;
  if (!data) return <Waiting />;

  // The figure the board prints, and the scale the contributions are already on
  // — said by the API rather than worked out again here (Codex, 18 Sep 2026).
  const out = data.outOf ?? Math.round(data.epicScore * 10);
  const owned = Math.round(data.ownedScore * 10);
  const weights = data.weights ?? {};
  const chained = (data.chainWeight ?? 1) !== 1;

  return (
    <>
      <View style={styles.subRow}>
        <View style={styles.five}>
          <Stat label="Our score" value={out} tip="ourScore" accent big />
          <Stat label="Without the licensed bit" value={owned} tip="withoutTheLicensedBit" big />
        </View>
        <View style={{ flex: 1 }} />
        {/* Free, and it says so. `score()` is pure and recomputes from what we
            already hold; asking a provider for a fresh rating is a collection
            run, and that lives on Places where the spending is said out loud
            (Codex, 17 Sep 2026 — the button used to name a price it never
            charged, and reload rather than recalculate). */}
        <Act label={busy ? 'Working it out…' : 'Work it out again · free'} disabled={!canManage || busy}
             onPress={() => { setBusy(true); api.adminRescoreOne(refId).finally(() => { setBusy(false); load(); }); }} />
      </View>
      <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Kicker tip="sectionInputs">Inputs</Kicker>
          <View style={{ height: 9 }} />
          <View style={styles.recordHead}>
            <Explain tip="input" style={{ flex: 1 }}><Text style={styles.headLabelSmall}>Input</Text></Explain>
            <Explain tip="whatItGaveUs" style={{ width: 170 }}><Text style={styles.headLabelSmall}>What it gave us</Text></Explain>
            <Explain tip="worth" style={{ width: 130 }}><Text style={[styles.headLabelSmall, { textAlign: 'right' }]}>{`Worth · adds to ${out}`}</Text></Explain>
            <Explain tip="ownedInput" style={{ width: 150 }}><Text style={[styles.headLabelSmall, { textAlign: 'right' }]}>Owned</Text></Explain>
          </View>
          {data.inputs.map((i) => (
            <View key={i.key} style={styles.recordRow}>
              <Text style={[styles.fieldValue, { flex: 1 }]}>{i.label}</Text>
              {/* The word the input gave us, and behind it the arithmetic that
                  got there — which is what the column header promises. */}
              {/* "How we got to this **word**" — the finished sentence, which
                  sat in tips.ts unused while the screen showed the unfinished
                  one. The crowd and the count each have their own written
                  explanation; anything else carries the arithmetic the API
                  hands back (17 Sep 2026, the verification audit). */}
              <Explain
                tip={i.key === 'crowd' ? 'howWeGotToHigh'
                  : i.key === 'count' ? 'howWeGotToVeryBusy'
                    : i.how ? ([`How we got to this word`, i.how] as const) : null}
                style={{ width: 170 }}>
                {i.held
                  ? <Text style={styles.fieldStrong}>{sayInput(i.value, i.kind)}</Text>
                  : <Word muted>{noneWord(i.key)}</Word>}
              </Explain>
              {/* These two cells are hand-rolled, so they do not inherit their
                  column's hover the way a Ladder's do — and they were the only
                  figures on the tab that explained nothing (18 Sep 2026, the
                  separate audit). */}
              <Explain tip={i.worth
                ? [`Worth ${i.worth}`, `Of the ${out} this place scores, ${i.worth} ${i.worth === 1 ? 'point comes' : 'points come'} from ${i.label.toLowerCase()}. Its weight is ${weights[i.key] ?? '—'}.`]
                : ['Worth nothing yet', `We hold nothing for ${i.label.toLowerCase()}, so it adds nothing. Filling it is worth up to ${weights[i.key] ?? '—'}.`]}
                style={{ width: 130, alignItems: 'flex-end' }}>
                {/* Law 3: nothing held is a dash, never a nought. */}
                {i.worth ? <Num n={i.worth} /> : <Blank />}
              </Explain>
              <Explain tip={i.owned
                ? [i.held ? 'Ours' : 'Would be ours', 'This input comes from something we may keep for good, so it counts towards the score without the licensed bit.']
                : ['Rented', 'This input comes from a licensed provider. It counts towards our score and not towards the one beside it, which is what we would still have if they went.']}
                style={{ width: 150, alignItems: 'flex-end' }}>
                <Text style={[styles.fieldMeta, i.owned && { color: colors.accent, fontWeight: '700' }]}>
                  {i.owned ? (i.held ? 'yes, ours' : 'would be') : 'no'}
                </Text>
              </Explain>
            </View>
          ))}
          {chained ? (
            <View style={styles.recordRow}>
              <Text style={[styles.fieldValue, { flex: 1 }]}>How many of it there are</Text>
              <Explain tip={['A weight on the end', 'Being a group multiplies the total rather than being taken off an input, so a chain people genuinely rate keeps most of what it earned.']}
                       style={{ width: 170 }}>
                <Text style={styles.fieldStrong}>{`× ${data.chainWeight}`}</Text>
              </Explain>
              <View style={{ width: 130, alignItems: 'flex-end' }}><Word muted>applied to the total</Word></View>
              <View style={{ width: 150 }} />
            </View>
          ) : null}
        </View>
        <View style={[styles.side, { width: 400 }, width < 1100 && { width: '100%', borderLeftWidth: 0, paddingLeft: 0 }]}>
          <Kicker tip="sectionWeights">Weights</Kicker>
          <View style={{ height: 6 }} />
          {weightRows(weights).map((w, i, all) => (
            <Explain key={w.label} tip={w.tip} style={[styles.weightRow, i === all.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={styles.weightLabel}>{w.label}</Text>
              <Text style={styles.weightValue}>{w.value}</Text>
            </Explain>
          ))}
        </View>
      </View>
    </>
  );
}

/** The word or the figure an input gave us, said the way the board says it. */
const sayInput = (v: unknown, kind: string): string => {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (kind === 'yes-no') return v ? 'yes' : 'no';
  if (kind === 'count') return Number(v).toLocaleString();
  return String(v);
};

/** What "we hold none of this" is called, per input. Never a nought. */
const noneWord = (key: string) => ({
  crowd: 'not held', count: 'not held', accolades: 'none found',
  menuItems: 'no menu read', cuisines: 'not said', website: 'none',
  summary: 'not written', openingHours: 'not known',
} as Record<string, string>)[key] ?? 'not held';

/**
 * The weights, read out of the module rather than retyped.
 *
 * Every constant the score actually used, under the name the code gives it: a
 * screen that put the board's words over different quantities would be worse
 * than no screen (Codex, 17 Sep 2026).
 */
const weightRows = (w: any) => {
  const out: { label: string; value: string; tip: any }[] = [];
  for (const [band, n] of Object.entries(w.crowd ?? {})) out.push({ label: `What the crowd said · ${band}`, value: String(n), tip: 'weight' });
  for (const [band, n] of Object.entries(w.count ?? {})) out.push({ label: `How many said it · ${band}`, value: String(n), tip: 'weight' });
  if (w.crowdSplit) out.push({ label: 'The crowd: band against count', value: `${w.crowdSplit.band} / ${w.crowdSplit.count}`, tip: 'weight' });
  const acc = Object.entries(w.accolade ?? {});
  if (acc.length) {
    out.push({ label: 'An accolade · most to least', value: `${Math.max(...acc.map(([, v]) => Number(v)))} to ${Math.min(...acc.map(([, v]) => Number(v)))}`, tip: 'weight' });
    out.push({ label: 'Accolades stack at', value: String(w.accoladeStack), tip: 'weight' });
  }
  for (const [k, n] of Object.entries(w.substance ?? {})) out.push({ label: `What we own · ${k}`, value: String(n), tip: 'weight' });
  if (w.composite) {
    out.push({
      label: Object.keys(w.composite).length === 3 ? 'The three-way split' : 'The split, with nothing licensed',
      value: Object.entries(w.composite).map(([k, v]) => `${k} ${v}`).join(' / '),
      tip: 'weightSplit',
    });
  }
  if (w.owned) out.push({ label: 'And with the licensed part out', value: Object.entries(w.owned).map(([k, v]) => `${k} ${v}`).join(' / '), tip: 'weightSplit' });
  // These two are the rating's own arithmetic, not a subcategory floor: the
  // board's words for them describe a different quantity, so they carry the
  // code's (Codex, 17 Sep 2026).
  if (w.prior) out.push({ label: 'A rating with nobody behind it starts at', value: String(w.prior), tip: 'weightAssumption' });
  if (w.priorWeight) out.push({ label: 'Reviews before a rating speaks for itself', value: String(w.priorWeight), tip: 'weightAssumptionCounts' });
  for (const [k, n] of Object.entries(w.chain ?? {})) out.push({ label: `How many of it there are · ${k}`, value: String(n), tip: 'weight' });
  return out;
};

/** The pictures on one place, with every licence field. */
function PlacePicturesTab({ place, canManage, onFound }: { place: PlaceDetail; canManage: boolean; onFound: () => void }) {
  const { navigate } = useRouter();
  const [sel, setSel] = useState(0);
  const [looking, setLooking] = useState(false);
  const { width } = useViewport();
  const owned = place.pictures;
  if (!owned.length) {
    return (
      <View style={{ gap: spacing.md }}>
        <Word muted>No picture we own.</Word>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {/* Here, where a picture is the subject and the words mean something.
              They are off the record tab's panel, which is a list of facts
              (owner, 20 Sep 2026). */}
          <Act label={looking ? 'Looking…' : 'Look for one we may keep · free'} tone="secondary" disabled={!canManage || looking}
               onPress={() => { setLooking(true); api.adminFindPictures([place.ref]).finally(() => { setLooking(false); onFound(); }); }} />
          <Act label="What households have sent" tone="secondary" icon="preview"
               onPress={() => navigate(`/admin/queue?kind=photo${place.areas[0]?.slug ? `&where=${encodeURIComponent(place.areas[0].slug)}` : ''}`)} />
        </View>
      </View>
    );
  }
  const p = owned[Math.min(sel, owned.length - 1)];
  return (
    <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Kicker tip="sectionPicturesOnPlace">{`${owned.length} picture${owned.length === 1 ? '' : 's'}`}</Kicker>
        <View style={styles.grid}>
          {owned.map((x, i) => (
            <Press key={`${x.id}-${i}`} effect="none" onPress={() => setSel(i)} accessibilityRole="button"
                   accessibilityLabel={x.title ?? 'Picture'} style={[styles.card, i === sel && styles.cardOn]}>
              <View style={styles.cardImage}>
                <Image source={{ uri: api.imageUrl(x.id, 400) }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>{x.title ?? 'Untitled'}</Text>
              <Text style={styles.cardNote} numberOfLines={1}>{[x.source, x.licence].filter(Boolean).join(' · ')}</Text>
            </Press>
          ))}
        </View>
      </View>
      <View style={[styles.side, { width: 392 }, width < 1100 && { width: '100%', borderLeftWidth: 0, paddingLeft: 0 }]}>
        <PictureFacts p={p} />
      </View>
    </View>
  );
}

/** BO2r — literally the fields each source returned. */
/**
 * Sources — who we have asked about this place, when, and what to do next.
 *
 * The owner, 20 Sep 2026: "whether we create a sources tab that says, 'We asked
 * Google a month ago. Do you want to ask them again? Do you want to go get some
 * other sources?'" It was already the tab that listed what each source
 * returned; what it could not do was the second half of that sentence. Now each
 * row says when it last answered and carries the one act that applies to it, at
 * the price the API works out — and the free three say out loud that they are
 * one pass, because asking one of them asks all three.
 */
function RawTab({ refId, canManage = false, onDone }: { refId: string; canManage?: boolean; onDone?: () => void }) {
  const [data, setData] = useState<{ ref: string; sources: RawSource[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = useCallback(() => { api.adminPlaceRaw(refId).then(setData).catch(() => setData(null)); }, [refId]);
  useEffect(() => { setData(null); reload(); }, [refId, reload]);
  // Free is our own research pass over the open map and the encyclopedias;
  // Google is the only one on this drawer that spends.
  const FREE = new Set(['osm', 'wikidata', 'wikipedia', 'commons', 'own', 'atlas', 'sweep']);
  const run = (key: string) => {
    if (!canManage || busy) return;
    setBusy(key);
    const call = FREE.has(key) ? api.adminCuratePlaces([refId]) : api.adminAskAboutPlaces([refId]);
    Promise.resolve(call).finally(() => { setBusy(null); reload(); onDone?.(); });
  };
  if (!data) return <Waiting />;
  return (
    <View>
      {/* Four columns with no names on them: the one board in the drawer with
          no header row at all (18 Sep 2026, the separate audit). */}
      <View style={styles.recordHead}>
        <Explain tip="rawSource" style={{ width: 180 }}><Text style={styles.headLabelSmall}>Source</Text></Explain>
        <Explain tip="rawWhatItReturned" style={{ flex: 1 }}><Text style={styles.headLabelSmall}>What it returned</Text></Explain>
        <Explain tip="rawTheirIdentifier" style={{ width: 140 }}><Text style={styles.headLabelSmall}>Their identifier</Text></Explain>
        <Explain tip="rawLastAnswered" style={{ width: 110 }}><Text style={styles.headLabelSmall}>Last answered</Text></Explain>
        <Explain tip={['Ask them', 'Asking again is the only thing to decide on this tab, so it is the only button on it. The free three are one pass — our own research reads the open map and the encyclopedias together — and Google is the one that spends.']}
                 style={{ width: 132 }}><Text style={styles.headLabelSmall}>Ask them</Text></Explain>
        <View style={{ width: 15 }} />
      </View>
      {data.sources.map((s) => (
        <React.Fragment key={s.key}>
          <Press effect="none" onPress={() => setOpen(open === s.key ? null : s.key)} accessibilityRole="button"
                 accessibilityLabel={s.label} style={styles.recordRow}>
            <Explain tip={[s.label, s.explain]} style={{ width: 180 }}><Text style={styles.fieldName}>{s.label}</Text></Explain>
            <View style={{ flex: 1 }}>
              {s.state === 'not-asked' ? <Explain tip="notAsked"><NotAsked /></Explain>
                : s.state === 'no-match' ? <Explain tip="noMatch"><NoMatch /></Explain>
                : s.state === 'matched' ? (
                  <Explain tip={s.rented ? 'matchedNotKept' : 'matchedHeldElsewhere'}>
                    <Text style={styles.fieldValue}>{s.rented ? 'Matched · nothing kept' : 'Matched · held elsewhere'}</Text>
                  </Explain>
                )
                  : <Text style={styles.fieldValue}>{`${s.fields.length} field${s.fields.length === 1 ? '' : 's'}`}</Text>}
            </View>
            <Text style={[styles.fieldMeta, { width: 140 }]}>{s.id ?? '—'}</Text>
            <Text style={[styles.fieldMeta, { width: 110 }]}>{s.lastSeen ? day(s.lastSeen) : '—'}</Text>
            {/* The one decision on this tab, on the row it belongs to. A source
                that has never answered is asked; one that answered months ago is
                asked again; and the word says which, so nobody has to remember
                what "curate" meant. */}
            <View style={{ width: 132 }}>
              <Act small tone="secondary" disabled={!canManage || busy != null}
                   label={busy === s.key ? 'Asking…' : s.lastSeen ? 'Ask again' : 'Ask'}
                   onPress={() => run(s.key)} />
            </View>
            <Icon name={open === s.key ? 'collapse' : 'expand'} size={15} strokeWidth={2} color={colors.inkMuted} />
          </Press>
          {open === s.key ? (
            <View style={styles.expand}>
              {s.fields.length === 0 ? (
                <Word muted>{s.state === 'matched'
                  ? (s.rented
                    ? 'We hold their identifier and nothing else — this source is rented, and is read live.'
                    : 'Matched here; what this source gave us is kept in its own place rather than as fields on this record.')
                  : 'Nothing held from this source.'}</Word>
              ) : s.fields.map((f) => (
                <View key={f.field} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{f.field}</Text>
                  <Text style={styles.detailValue}>{saidValue(f.value) || '—'}</Text>
                  <Text style={styles.fieldMeta}>{`${f.licence} · ${f.retention}`}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
}

/** BO2r — which run changed what. */
function HistoryTab({ refId }: { refId: string }) {
  const [rows, setRows] = useState<PlaceHistoryRow[] | null>(null);
  useEffect(() => { setRows(null); api.adminPlaceHistory(refId).then((r) => setRows(r.rows)).catch(() => setRows([])); }, [refId]);
  if (!rows) return <Waiting />;
  if (!rows.length) return <Word muted>Nothing has changed this place yet.</Word>;
  return (
    <View>
      <View style={styles.recordHead}>
        <Explain tip="historyWhen" style={{ width: 150 }}><Text style={styles.headLabelSmall}>When</Text></Explain>
        <Explain tip="historyWhatChanged" style={{ flex: 1 }}><Text style={styles.headLabelSmall}>What changed</Text></Explain>
        <Explain tip="historyWho" style={{ width: 180 }}><Text style={styles.headLabelSmall}>Who or what did it</Text></Explain>
        <Explain tip="historyCost" style={{ width: 90, alignItems: 'flex-end' }}><Text style={styles.headLabelSmall}>What it cost</Text></Explain>
      </View>
      {rows.map((r, i) => (
        <View key={`${r.at}-${i}`} style={styles.recordRow}>
          <Text style={[styles.fieldMeta, { width: 150 }]}>{day(r.at)}</Text>
          <Text style={[styles.fieldValue, { flex: 1 }]}>{r.what}</Text>
          <Text style={[styles.fieldMeta, { width: 180 }]}>{r.who ?? (r.kind === 'call' ? 'a run' : '—')}</Text>
          <Text style={[styles.fieldMeta, { width: 90, textAlign: 'right' }]}>{r.usd ? pounds(Math.round(r.usd * 100 * 0.79)) : ''}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO2j — pictures we own
// ---------------------------------------------------------------------------

function PicturesBoard({ onClose }: { onClose: () => void }) {
  // In the address: the board's own URL is `?pictures=all&q=castle+winter`, and
  // a picture search you cannot send somebody is half a search.
  // `pic`, not `q`. `q` is the place-name filter on BO2q, and one key with two
  // meanings meant a picture search left in the address became a place filter
  // once you drilled into a subcategory (17 Sep 2026, the verification audit).
  const [q, setQ] = useQueryState<string>('pic', '', asText);
  const [facet, setFacet] = useQueryState<string>('facet', '', asText);
  const [data, setData] = useState<PictureIndex | null>(null);
  const [sel, setSel] = useState(0);
  const { width } = useViewport();
  useEffect(() => {
    setData(null);
    const t = setTimeout(() => { api.adminPictures({ q: q || undefined, facet: facet || undefined }).then(setData).catch(() => setData(null)); }, q ? 220 : 0);
    return () => clearTimeout(t);
  }, [q, facet]);

  const p = data?.pictures[Math.min(sel, Math.max(0, data.pictures.length - 1))] ?? null;
  return (
    <AdminPage>
      <View style={styles.trail}>
        <Press effect="none" onPress={onClose} accessibilityRole="button" accessibilityLabel="Back" style={styles.trailBack}>
          <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
          <Text style={styles.trailWord}>Back</Text>
        </Press>
      </View>
      <Band kicker="PICTURES" title="Pictures" stats={
        <View style={styles.five}>
          <Stat label="Owned" value={(data?.counts.owned ?? 0).toLocaleString()} tip="owned" />
          <Stat label="From households" value={data?.counts.household ? data.counts.household.toLocaleString() : '—'} tip="fromHouseholds" />
          <Stat label="Places with no picture" value={(data?.counts.noPicture ?? 0).toLocaleString()} tip="placesWithNoPicture" accent />
        </View>
      } />
      <View style={styles.subRow}>
        <View style={[styles.search, { width: 330 }]}>
          <Icon name="search" size={15} strokeWidth={2} color={colors.inkMuted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search every picture we own"
                     placeholderTextColor={colors.inkMuted} style={styles.searchInput} accessibilityLabel="Search the pictures" />
        </View>
        <View style={styles.facets}>
          {(data?.facets ?? []).map((f) => (
            <Explain key={f.key} cursor="pointer"
                     tip={[f.label, `${(f.n ?? 0).toLocaleString()} of the pictures we hold came from ${f.label.toLowerCase()}. Tap to see only those.`]}>
              <Press effect="none" onPress={() => setFacet(facet === f.key ? '' : f.key)}
                     accessibilityRole="button" accessibilityState={{ selected: facet === f.key }} accessibilityLabel={f.label}
                     style={[styles.facet, facet === f.key && styles.facetOn]}>
                <Text style={[styles.facetWord, facet === f.key && styles.facetWordOn]}>{f.label}</Text>
                <Text style={[styles.facetN, facet === f.key && { color: colors.onLime }]}>{f.n ? f.n.toLocaleString() : '—'}</Text>
              </Press>
            </Explain>
          ))}
        </View>
      </View>
      {!data ? <Waiting /> : (
        <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Kicker tip="sectionPicturesHere">{`${data.matching.toLocaleString()} pictures`}</Kicker>
            <View style={styles.grid}>
              {data.pictures.map((x, i) => (
                <Press key={x.id} effect="none" onPress={() => setSel(i)} accessibilityRole="button"
                       accessibilityLabel={x.title ?? 'Picture'} style={[styles.card, i === sel && styles.cardOn, !x.attribution && { opacity: 0.55 }]}>
                  {x.attribution ? (
                    <View style={styles.cardImage}>
                      <Image source={{ uri: api.imageUrl(x.id, 400) }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
                    </View>
                  ) : (
                    // A picture we may keep but cannot credit is not publishable,
                    // and the tile says which of the two it is.
                    <View style={[styles.cardImage, styles.cardMissing]}><Text style={styles.cardNote}>attribution missing</Text></View>
                  )}
                  <Text style={styles.cardTitle} numberOfLines={1}>{x.title ?? 'Untitled'}</Text>
                  <Text style={styles.cardNote} numberOfLines={1}>{[x.source, x.licence].filter(Boolean).join(' · ')}</Text>
                </Press>
              ))}
              {data.pictures.length === 0 ? <Word muted>Nothing matches that.</Word> : null}
            </View>
          </View>
          <View style={[styles.side, { width: 392 }, width < 1100 && { width: '100%', borderLeftWidth: 0, paddingLeft: 0 }]}>
            <Kicker tip="sectionTheOneSelected">The one selected</Kicker>
            {p ? <PictureFacts p={p} /> : <Word muted>Pick one.</Word>}
          </View>
        </View>
      )}
    </AdminPage>
  );
}

/** Every licence field on one picture, with the attribution page as a link. */
function PictureFacts({ p }: { p: any }) {
  const open = (url: string | null) => { if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener'); };
  return (
    <View>
      <View style={styles.hero}>
        <Image source={{ uri: api.imageUrl(p.id, 900) }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
      </View>
      <Text style={styles.heroTitle}>{p.title ?? 'Untitled'}</Text>
      <Fact label="On the place" value={p.onPlace ? `${p.onPlace}${p.role ? ` · ${p.role}` : ''}` : '—'} />
      <Fact label="Licence" value={p.licence ?? '—'} strong />
      <Fact label="Photographer" value={p.creator ?? '—'} />
      <Fact label="Credit as" value={p.credit ?? '—'} />
      <Fact label="Attribution page" value={p.page ?? '—'} link={p.page} onPress={() => open(p.page)} />
      <Fact label="Licence page" value={p.licenceUrl ?? '—'} link={p.licenceUrl} onPress={() => open(p.licenceUrl)} />
      <Fact label="Size" value={p.width && p.height ? `${p.width.toLocaleString()} × ${p.height.toLocaleString()}${p.bytes ? ` · ${(p.bytes / 1_048_576).toFixed(1)} MB` : ''}` : '—'} />
      <Fact label="Fetched" value={p.fetchedAt ? day(p.fetchedAt) : '—'} last />
    </View>
  );
}

/** Every licence field explains itself; eight of them explained nothing. */
const PICTURE_FACT_TIP: Record<string, TipKey> = {
  'Where it came from': 'pictureWhereFrom', 'On the place': 'pictureOnThePlace',
  Licence: 'pictureLicence', Photographer: 'picturePhotographer', 'Credit as': 'pictureCreditAs',
  'Attribution page': 'pictureAttributionPage', 'Licence page': 'pictureLicencePage',
  Size: 'pictureSize', Fetched: 'pictureFetched',
};
const Fact = ({ label, value, strong, link, onPress, last }: { label: string; value: string; strong?: boolean; link?: string | null; onPress?: () => void; last?: boolean }) => (
  <Explain tip={PICTURE_FACT_TIP[label] ?? null} style={[styles.factRow, last && { borderBottomWidth: 0 }]}>
    <Text style={styles.factLabel}>{label}</Text>
    {link
      ? <Press effect="none" onPress={onPress} accessibilityRole="link" accessibilityLabel={label} style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.factValue, { color: colors.accent }]} numberOfLines={1}>{value}</Text>
        </Press>
      : <Text style={[styles.factValue, strong && styles.strong]} numberOfLines={2}>{value}</Text>}
  </Explain>
);

// ---------------------------------------------------------------------------
// BO2k — what counts as ready, composed rather than coded
// ---------------------------------------------------------------------------

function ReadyBarBoard({ sub, canManage, onClose, onPick }: {
  sub: string; canManage: boolean; onClose: () => void; onPick: (s: string) => void;
}) {
  const [data, setData] = useState<ReadyBars | null>(null);
  // The address names the kind of place, so a composed bar is a link.
  const pick = sub;
  const setPick = onPick;
  const [draft, setDraft] = useState<BarFact[] | null>(null);
  const [held, setHeld] = useState<{ places: number; held: Record<string, number> } | null>(null);
  const [effect, setEffect] = useState<BarEffect | null>(null);
  const [saving, setSaving] = useState(false);
  const { width } = useViewport();

  const load = useCallback(() => { api.adminReadyBars().then(setData).catch(() => setData(null)); }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const row = data?.subcategories.find((s) => s.key === pick);
    setDraft(row ? row.facts.map((f) => ({ ...f })) : null);
    setEffect(null);
    api.adminReadyBarFacts(pick).then(setHeld).catch(() => setHeld(null));
  }, [data, pick]);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    api.adminReadyBarEffect(pick, draft).then((e) => { if (live) setEffect(e); }).catch(() => {});
    return () => { live = false; };
  }, [draft, pick]);

  if (!data || !draft) return <AdminPage><Waiting /></AdminPage>;
  const row = data.subcategories.find((s) => s.key === pick);
  const facts = data.facts;
  const changed = JSON.stringify(draft) !== JSON.stringify(row?.facts ?? []);

  return (
    <AdminPage>
      <View style={styles.trail}>
        <Press effect="none" onPress={onClose} accessibilityRole="button" accessibilityLabel="Back" style={styles.trailBack}>
          <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
          <Text style={styles.trailWord}>Back</Text>
        </Press>
      </View>
      <Band kicker="THE BAR, PER KIND OF PLACE · SET NATIONALLY" title="What counts as ready" />
      <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
        <View style={[{ width: 260 }, width < 1100 && { width: '100%' }]}>
          <Kicker tip="sectionSubcategoriesHere">{`${data.subcategories.length} subcategories`}</Kicker>
          <ScrollView style={{ maxHeight: 520 }}>
            {/* Each row says what its own bar is, on hover: fifty-one rows of
                "N facts" with no explanation of which (18 Sep 2026, the
                separate audit). */}
            {data.subcategories.map((s) => {
              const need = s.facts.filter((f) => f.required);
              return (
                <Explain key={s.key} cursor="pointer"
                         tip={[s.label, s.set
                           ? `${(s.places ?? 0).toLocaleString()} in Britain. Ready here means ${need.map((f) => (data.facts.find((x) => x.key === f.fact)?.label ?? f.fact).toLowerCase()).join(', ') || 'nothing yet'}.`
                           : `${(s.places ?? 0).toLocaleString()} in Britain, and nobody has said what ready means for them yet — so none of them can be ready.`]}>
                  <Press effect="none" onPress={() => setPick(s.key)} accessibilityRole="button"
                         accessibilityState={{ selected: pick === s.key }} accessibilityLabel={s.label}
                         style={[styles.pickRow, pick === s.key && styles.pickRowOn, !s.set && { opacity: 0.6 }]}>
                    <Text style={[styles.pickName, pick === s.key && { color: colors.selectedFg, fontWeight: '700' }]} numberOfLines={1}>{s.label}</Text>
                    <Text style={[styles.pickN, pick === s.key && { color: colors.onLime }]}>
                      {s.set ? `${need.length} fact${need.length === 1 ? '' : 's'}` : 'not set'}
                    </Text>
                  </Press>
                </Explain>
              );
            })}
          </ScrollView>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Kicker tip="sectionReadyWhen">{`A ${singular(row?.label ?? pick)} is ready when it has · ${(row?.places ?? 0).toLocaleString()} in Britain`}</Kicker>
          <View style={{ height: 9 }} />
          {facts.map((f) => {
            const d = draft.find((x) => x.fact === f.key)!;
            const n = held?.held?.[f.key] ?? null;
            return (
              <View key={f.key} style={styles.barFactRow}>
                <Press effect="none" accessibilityRole="switch" accessibilityState={{ checked: d.required }}
                       accessibilityLabel={`${f.label} required`} disabled={!canManage}
                       onPress={() => setDraft(draft.map((x) => (x.fact === f.key ? { ...x, required: !x.required } : x)))}
                       style={[styles.switch, d.required && styles.switchOn]}>
                  <View style={[styles.knob, d.required && styles.knobOn]} />
                </Press>
                <Explain tip={[f.label, f.explain]} style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.fieldValue, d.required && styles.strong, !d.required && { color: colors.inkMuted }]}>
                    {d.required ? f.label : 'not required'}
                  </Text>
                  <Text style={styles.rowNote}>
                    {d.required && n != null ? `${n.toLocaleString()} of ${(row?.places ?? 0).toLocaleString()} have one` : d.required ? f.short : f.label}
                  </Text>
                </Explain>
                <Explain tip={d.required
                  ? ['Weight', `What this fact is worth in the data score for a ${singular(row?.label ?? pick)} — out of a hundred, before the group multiplier. Requiring a fact and weighting it are two different decisions: the bar says whether a place is ready, the weight says how much the record is worth.`]
                  : ['Not required', 'A place here is ready without it. It can still carry weight in the score.']}
                  style={{ width: 150, alignItems: 'flex-end' }}>
                  <Text style={[styles.fieldMeta, { textAlign: 'right' }]}>{d.required ? `weight ${d.weight}` : '—'}</Text>
                </Explain>
              </View>
            );
          })}

          <View style={styles.effect}>
            <Kicker tip="sectionIfSaved">If saved</Kicker>
            <View style={styles.effectRow}>
              <EffectFact label={`${row?.label ?? 'These'} ready now`} tip="restaurantsReadyNow"
                          big={effect?.shareNow == null ? '—' : `${effect.shareNow}%`} small={effect ? effect.readyNow.toLocaleString() : ''} />
              <EffectFact label="After the change" tip="afterTheChange" big={effect?.shareAfter == null ? '—' : `${effect.shareAfter}%`} small={effect ? effect.readyAfter.toLocaleString() : ''} />
              <EffectFact label="Places that stop being ready" tip="placesThatStopBeingReady" big={effect ? String(effect.stopBeingReady) : '—'} />
              <EffectFact label="Counties whose figure moves" tip="countiesWhoseFigureMoves" big={effect ? String(effect.countiesMoved) : '—'} />
              <EffectFact label="Britain overall" tip="britainOverall"
                          big={effect && effect.britainNow != null ? `${effect.britainNow}% → ${effect.britainAfter}%` : '—'} />
            </View>
          </View>

          <Footer>
            <Act label="Leave it as it was" tone="secondary" disabled={!changed}
                 onPress={() => setDraft(row ? row.facts.map((f) => ({ ...f })) : null)} />
            <Act label={effect ? `Save, and work out ${effect.rescore.toLocaleString()} places again` : 'Save'}
                 tone="solid" disabled={!canManage || !changed || saving}
                 onPress={() => { setSaving(true); api.adminSaveReadyBar(pick, draft).then(load).finally(() => setSaving(false)); }} />
          </Footer>
        </View>
      </View>
    </AdminPage>
  );
}

const singular = (label: string) => label.replace(/ & .*$/, '').replace(/s$/, '').toLowerCase();

const EffectFact = ({ label, big, small, tip }: { label: string; big: string; small?: string; tip: any }) => (
  <Explain tip={tip} style={{ gap: 2, minWidth: 120 }}>
    <Text style={styles.ringLabel}>{label}</Text>
    <Text style={styles.effectBig}>{big}</Text>
    {small ? <Text style={styles.rowNote}>{small}</Text> : null}
  </Explain>
);

// ---------------------------------------------------------------------------
// BO2l — Places at 390
// ---------------------------------------------------------------------------

/**
 * The phone board, not a squeeze of the desk one.
 *
 * Four of the five numbers in a two-by-two — average score is the one that does
 * not need answering on a train — the lenses as a single row of words that
 * scrolls, and each area as a name over the facts as chips, so nothing has to
 * fit across a table on a 390px screen.
 */
function PlacesPhone({ level, q, lens, onLens, onWhere, onUp }: {
  level: PlaceLevel; q: any; lens: Lens;
  onLens: (l: Lens) => void; onWhere: (slug: string, opts?: { lens?: Lens }) => void; onUp: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceCoverage>> | null>(null);
  useEffect(() => { setData(null); api.adminPlaceCoverage(q).then(setData).catch(() => setData(null)); }, [q]);

  return (
    <AdminPage>
      <View style={styles.trail}>
        <Press effect="none" onPress={() => (level.trail.length ? onWhere(level.trail[level.trail.length - 1].slug) : onUp())}
               accessibilityRole="button" accessibilityLabel="Back" style={styles.trailBack}>
          <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
          <Text style={styles.trailWord}>{level.trail[level.trail.length - 1]?.label ?? 'Countries'}</Text>
        </Press>
      </View>
      <View style={{ gap: 5, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 14 }}>
        <Kicker tip="sectionLevel">{kickerOf(level)}</Kicker>
        <Text style={styles.titlePhone}>{level.name}</Text>
      </View>

      <View style={styles.phoneGrid}>
        <View style={styles.phoneCell}><Stat label="Known" value={said(level.stats.known)} tip="known" /></View>
        <View style={styles.phoneCell}><Stat label="Owned" value={said(level.stats.owned)} tip="owned" /></View>
        <View style={styles.phoneCell}><Stat label="Identified only" value={said(level.stats.identified)} tip="identifiedOnly" accent /></View>
        <View style={styles.phoneCell}><Stat label="Ready" value={level.stats.ready == null ? '—' : `${level.stats.ready}%`} tip="ready" /></View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.segment}>
          {LENSES.map((l) => (
            <Explain key={l} tip={LENS_TIP[l]} cursor="pointer">
              <Press effect="none" onPress={() => onLens(l)} accessibilityRole="tab"
                     accessibilityState={{ selected: lens === l }} accessibilityLabel={LENS_LABEL[l]}
                     style={[styles.segItem, lens === l && styles.segItemOn]}>
                <Text style={[styles.segWord, lens === l && styles.segWordOn]}>{LENS_LABEL[l]}</Text>
              </Press>
            </Explain>
          ))}
        </View>
      </ScrollView>

      {!data ? <Waiting /> : data.rows.map((r, i) => (
        <Press key={r.slug} effect="none" onPress={() => onWhere(r.slug, intoArea(r.kind))} accessibilityRole="button"
               accessibilityLabel={r.name} style={[styles.phoneRow, i === data.rows.length - 1 && { borderBottomWidth: 0 }]}>
          <View style={{ gap: 2 }}>
            <Text style={styles.rowName}>{r.name}</Text>
            <Text style={styles.rowNote}>{`${r.kind === 'postcode' ? 'outcode' : 'town'} · ${r.known.toLocaleString()} known`}</Text>
          </View>
          <View style={styles.chips}>
            <PhoneChip label="ready" v={r.ready} tip="ready" strong />
            <PhoneChip label="picture" v={r.picture} tip="pictureFact" />
            <PhoneChip label="what it is" v={r.description} tip="whatItIsFact" />
            <PhoneChip label="menu" v={r.menu} tip="menu" />
          </View>
        </Press>
      ))}
    </AdminPage>
  );
}

const PhoneChip = ({ label, v, tip, strong }: { label: string; v: number | null; tip: any; strong?: boolean }) => (
  <Explain tip={tip} style={styles.chip}>
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.selected, opacity: 0.05 + Math.max(0, Math.min(100, v ?? 0)) / 100 * 0.35 }]} pointerEvents="none" />
    <Text style={[styles.chipWord, strong && styles.strong]}>{`${label} ${v == null ? '—' : `${v}%`}`}</Text>
  </Explain>
);

const styles = StyleSheet.create({
  // the band
  band: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    gap: spacing.xl, flexWrap: 'wrap',
    borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 17,
  },
  title: { ...type.title, fontSize: 31, letterSpacing: -1.08, lineHeight: 33 },
  titlePhone: { fontSize: 25, letterSpacing: -0.9, lineHeight: 27 },
  // Wraps inside itself on a phone rather than being sized to its content and
  // pushed off the 390px frame (live phone audit, 18 Sep 2026).
  // BO2l: `grid-template-columns:1fr 1fr;gap:12px 14px`.
  groupRowPhone: { gap: 5, paddingTop: 14, paddingBottom: 6 },
  groupFigures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 },

  fourGrid: { rowGap: 12, flexGrow: 1, flexBasis: 240, minWidth: 0, alignSelf: 'stretch' },
  fourRow: { flexDirection: 'row', columnGap: 14 },
  fourCell: { flex: 1, minWidth: 0 },

  five: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap',
    flexGrow: 1, flexBasis: 240, minWidth: 0,
  },

  // the way back
  trail: { flexDirection: 'row', alignItems: 'center', gap: 11, flexWrap: 'wrap' },
  trailBack: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trailWord: { ...type.small, fontSize: 13, fontWeight: '700', color: colors.accent },
  trailNote: { ...type.small, fontSize: 12.5, color: colors.inkMuted },

  // the lens row
  // The census board. Rules rather than boxes, the same as Categories.
  censusHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.md, paddingBottom: spacing.md },
  censusReach: { flexDirection: 'row', gap: spacing.xs },
  censusFree: { ...type.label, marginBottom: 0, marginTop: 0 },
  censusNone: { ...type.body, paddingVertical: spacing.lg },
  nothingWrap: { borderTopWidth: 2, borderColor: colors.ink, marginTop: spacing.lg },
  nothingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  nothingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: BORDER, borderColor: colors.line },
  nothingWhere: { flex: 1, minWidth: 0, textAlign: 'right' },
  // Above the board under it. Every View react-native-web draws is
  // position:relative with z-index 0, which makes a stacking context of each
  // one, so the list inside this row paints *under* the table however high its
  // own z-index is — the ladder's headings showed through the open list (20 Sep
  // 2026). The same fix every other board with a list over a table uses.
  lensRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, flexWrap: 'wrap', zIndex: 20 },
  // The label-above-lenses column has to be told it may be narrower than its
  // content, or it takes the width of six lenses and carries the row off the
  // frame with it (measured at 390, 18 Sep 2026).
  lensLeftPhoneWidth: { width: '100%', maxWidth: '100%' },
  lensLeft: { flexDirection: 'row', alignItems: 'center', gap: 20, flexWrap: 'wrap' },
  // A phone stacks them: the label, then the lenses on one scrolling line.
  lensLeftPhone: { flexDirection: 'column', alignItems: 'stretch', gap: 8, alignSelf: 'stretch', minWidth: 0 },
  lensScrollPhone: { alignSelf: 'stretch', minWidth: 0 },
  lenses: { flexDirection: 'row', alignItems: 'center', gap: 20, flexWrap: 'wrap' },
  lens: { paddingBottom: 3, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  lensOn: { borderBottomColor: colors.selected },
  lensWord: { ...type.small, fontSize: 13.5, fontWeight: '500', color: colors.inkMuted },
  lensWordOn: { fontWeight: '700', color: colors.accent },

  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, flexWrap: 'wrap' },

  // the ring chooser
  chooser: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', zIndex: 20 },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.ruleMuted },
  segItem: { paddingHorizontal: 14, paddingVertical: 8 },
  segItemOn: { backgroundColor: colors.selected },
  segWordOff: { color: colors.inkMuted },
  segWord: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.inkMuted },
  segWordOn: { fontWeight: '700', color: colors.selectedFg },

  // the search box
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.ruleMuted, paddingHorizontal: 13, paddingVertical: 9 },
  searchInput: { ...type.small, fontSize: 13.5, color: colors.ink, flex: 1, outlineStyle: 'none' as any },
  suggest: { borderWidth: 1, borderTopWidth: 0, borderColor: colors.ruleMuted, backgroundColor: colors.surface },
  suggestRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 13, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  suggestPostcode: { paddingHorizontal: 13, paddingVertical: 9, gap: 7, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
  suggestBands: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  suggestBand: { borderWidth: 1, borderColor: colors.ruleMuted, paddingHorizontal: 11, paddingVertical: 5 },
  suggestName: { ...type.small, fontSize: 13.5, fontWeight: '700', color: colors.ink },
  suggestKind: { ...type.tiny, color: colors.inkMuted },

  // rows
  nameCell: { minWidth: 0, gap: 1 },
  rowName: { ...type.body, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  rowNameEmpty: { fontWeight: '700' },
  rowNote: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted },
  refName: { fontWeight: '400', color: colors.inkMuted, letterSpacing: 0.1 },
  needs: { ...type.small, fontSize: 12.5, color: colors.inkMuted },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  group: { ...type.tiny, fontSize: 11, fontWeight: '700', letterSpacing: 0.99, textTransform: 'uppercase', color: colors.inkMuted },
  groupNum: { ...type.small, fontSize: 13, color: colors.inkMuted, textAlign: 'right', fontVariant: ['tabular-nums'] },
  needsStrong: { fontWeight: '700', color: colors.ink },
  strong: { fontWeight: '700' },
  selected: { ...type.small, fontSize: 12.5, color: colors.inkMuted },
  dotted: { ...type.body, fontSize: 13.5, fontWeight: '700', color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.decor, borderStyle: 'dotted' },
  chipOff: { ...type.tiny, fontSize: 11.5, fontWeight: '700', color: colors.accent },

  box: { width: 18, height: 18, borderWidth: 1.5, borderColor: colors.decor, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.selected, borderColor: colors.selected },

  // the quality lens
  split: { flexDirection: 'row', gap: spacing.xl, alignItems: 'flex-start' },
  distribution: { width: 430, flexGrow: 0 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { ...type.small, fontSize: 12.5, color: colors.inkMuted, width: 58 },
  barTrack: { flex: 1, height: 18, backgroundColor: colors.lineSoft },
  barN: { ...type.small, fontSize: 13, color: colors.ink, width: 52, textAlign: 'right', fontVariant: ['tabular-nums'] },
  staleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  staleLabel: { ...type.small, fontSize: 13, color: colors.ink, flex: 1 },
  staleN: { ...type.small, fontSize: 13.5, color: colors.ink, width: 70, textAlign: 'right', fontVariant: ['tabular-nums'] },

  // the ring's own facts
  ringFacts: { borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 15, gap: 11 },
  ringRow: { flexDirection: 'row', gap: 34, flexWrap: 'wrap' },
  ringLabel: { ...type.tiny, fontSize: 12, color: colors.inkMuted },
  ringValue: { ...type.small, fontSize: 13.5, fontWeight: '600', color: colors.ink },

  // one place
  recordHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, paddingBottom: 8, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
  headLabelSmall: { ...type.tiny, fontSize: 12, fontWeight: '600', color: colors.inkMuted },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  fieldName: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.ink, width: 128 },
  fieldValue: { ...type.small, fontSize: 13, color: colors.ink },
  fieldStrong: { ...type.small, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  fieldMeta: { ...type.tiny, fontSize: 12.5, color: colors.inkMuted },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  editWord: { ...type.tiny, fontSize: 11.5, fontWeight: '700', color: colors.inkMuted },
  expand: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 13, paddingVertical: 11, gap: 7, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  detailRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  detailLabel: { ...type.tiny, fontSize: 11, color: colors.inkMuted, width: 104 },
  detailValue: { ...type.tiny, fontSize: 12, color: colors.ink, flex: 1 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editInput: { flex: 1, height: 40, borderWidth: BORDER, borderColor: colors.selected, backgroundColor: colors.surface, paddingHorizontal: 11, ...type.small, fontSize: 13, color: colors.ink, outlineStyle: 'none' as any },
  ruleWarn: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 15, paddingVertical: 13, gap: 3 },
  ruleWarnBig: { ...type.body, fontSize: 17, fontWeight: '700', color: colors.ink },
  ruleWarnSmall: { ...type.small, fontSize: 13, fontWeight: '600', color: colors.accent },

  side: { width: 404, flexGrow: 0, borderLeftWidth: BORDER, borderLeftColor: colors.ruleMuted, paddingLeft: 22 },
  thumbs: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginVertical: 10 },
  thumb: { width: 116, gap: 4 },
  thumbImage: { height: 74, backgroundColor: colors.lineSoft, overflow: 'hidden' },
  thumbNote: { ...type.tiny, fontSize: 11, color: colors.inkMuted },
  notChecked: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  notCheckedBig: { ...type.title, fontSize: 18, fontWeight: '800', color: colors.ink },
  notCheckedWord: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.ink },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  idLabel: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted, width: 104 },
  idValue: { ...type.tiny, fontSize: 12, color: colors.ink, flex: 1 },

  weightRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  weightLabel: { ...type.small, fontSize: 12.5, color: colors.inkMuted, flex: 1 },
  weightValue: { ...type.small, fontSize: 13, color: colors.ink, width: 60, textAlign: 'right', fontVariant: ['tabular-nums'] },

  // pictures
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  card: { width: 168, gap: 4 },
  cardOn: { },
  cardImage: { height: 120, backgroundColor: colors.lineSoft, borderWidth: BORDER, borderColor: 'transparent', overflow: 'hidden' },
  cardMissing: { borderStyle: 'dashed', borderWidth: 1, borderColor: colors.decor, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  cardTitle: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.ink },
  cardNote: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted },
  hero: { height: 196, backgroundColor: colors.lineSoft, marginBottom: 10, overflow: 'hidden' },
  heroTitle: { ...type.title, fontSize: 17, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  factLabel: { ...type.tiny, fontSize: 12, color: colors.inkMuted, width: 124 },
  factValue: { ...type.small, fontSize: 12.5, color: colors.ink, flex: 1 },
  facets: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  facet: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: colors.ruleMuted, paddingHorizontal: 12, paddingVertical: 8 },
  facetOn: { backgroundColor: colors.selected, borderColor: colors.selected },
  facetWord: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.ink },
  facetWordOn: { color: colors.selectedFg, fontWeight: '700' },
  facetN: { ...type.tiny, fontSize: 11, color: colors.inkMuted },

  // the ready bar
  pickRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  pickRowOn: { backgroundColor: colors.selected },
  pickName: { ...type.small, fontSize: 13, color: colors.ink, flex: 1, minWidth: 0 },
  pickN: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted },
  barFactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  switch: { width: 44, height: 24, padding: 2, borderWidth: 1, borderColor: colors.decor, justifyContent: 'center' },
  switchOn: { backgroundColor: colors.selected, borderColor: colors.selected },
  knob: { width: 20, height: 20, backgroundColor: colors.decor },
  knobOn: { backgroundColor: colors.selectedFg, alignSelf: 'flex-end' },
  effect: { borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 12, gap: 8, marginTop: spacing.md },
  effectRow: { flexDirection: 'row', gap: 28, flexWrap: 'wrap', backgroundColor: colors.surfaceMuted, paddingHorizontal: 16, paddingVertical: 14 },
  effectBig: { ...type.title, fontSize: 22, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },

  // the phone board
  // Two by two, as the board draws it. A wrapping row put three on one line and
  // orphaned READY — the one number you would check on a train.
  phoneGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.xl },
  phoneCell: { width: '46%', minWidth: 140 },
  phoneRow: { gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  chipWord: { ...type.tiny, fontSize: 11.5, color: colors.ink },
});
