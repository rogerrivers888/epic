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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { colors, spacing, type, BORDER } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { asFlag, asNumber, asOneOf, asText, useQueryState, useRouter } from '../../router';
import { api, type PlaceLevel, type PlaceStats, type PlaceCountry, type PlaceAreaRow, type PlaceCoverageRow,
  type PlaceCategory, type PlaceSourceDef, type PlaceSourceRow, type PlaceQuality, type DemandRow, type DemandTotals,
  type PlaceRing, type PlaceRow, type PlaceDetail, type PictureIndex, type ReadyBars, type BarEffect, type BarFact,
  type CompareColumn, type CompareRow, type RawSource, type PlaceHistoryRow, type FactDef, type PlaceLabel } from '../../api';
import { AdminPage, ago, day, pounds, since } from '../kit';
import { Explain } from '../explain';
import { Ladder, Num, Word, Blank, NotAsked, NoMatch, Na, Tick, Pct, ScoreCell, Bar, Progress, Act, Footer, Kicker, Stat, type Col } from '../table';

/** How a required fact is said in a sentence, rather than as a column header. */
const NEEDS_WORD: Record<string, string> = {
  picture: 'a picture', what_it_is: 'what it is', hours: 'opening hours',
  menu: 'a menu', prices: 'prices', step_free: 'step-free',
};

const LENSES = ['coverage', 'category', 'source', 'quality', 'demand', 'collect'] as const;
type Lens = typeof LENSES[number];
const LENS_LABEL: Record<Lens, string> = {
  coverage: 'Coverage', category: 'Category', source: 'Source', quality: 'Quality', demand: 'Demand', collect: 'Collect',
};

const BY = ['county', 'city', 'postcode'] as const;
type By = typeof BY[number];
const BY_LABEL: Record<By, string> = { county: 'County', city: 'City or town', postcode: 'Postcode district' };

const BANDS = [30, 60, 90];
const MODES = ['drive', 'walk', 'transit'] as const;
const MODE_LABEL: Record<string, string> = { drive: 'Car', walk: 'Walk', transit: 'Transit' };
const bandLabel = (m: number) => (m === 60 ? '1 hour' : `${m} min`);

/** The phone draws its own board rather than a squeeze of this one (BO2l). */
const PHONE = 900;

export function Places({ canManage }: { canManage: boolean }) {
  const { width } = useViewport();
  const phone = width < PHONE;

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
  const ring = within != null;
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
      <PlaceBoard refId={place} canManage={canManage} phone={phone}
                  tab={tab} onTab={setTab}
                  onClose={() => { setPlace(''); setTab('record'); }} />
    );
  }
  if (!where) return <Countries onPick={(slug) => setWhere(slug)} onPictures={() => setPictures(true)} onBar={() => setReadyFor('restaurants')} canManage={canManage} />;

  return (
    <Level
      where={where} within={within} mode={mode} ring={ring} breakdownBy={breakdownBy}
      lens={lens} cat={cat} sub={sub} phone={phone} canManage={canManage}
      onWhere={(slug, opts) => { setWhere(slug); setWithin(opts?.within ?? null); setBy(opts?.by ?? ''); setCat(''); setSub(''); }}
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
    { key: 'searches', label: 'Searches', note: '30 days', tip: 'searches', width: 140, align: 'right', sort: 'searches',
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
        <Act label="Add a country" tone="secondary" disabled onPress={() => {}} />
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
  onWhere: (slug: string, opts?: { within?: number | null; by?: string }) => void;
  onLens: (l: Lens) => void; onBy: (b: string) => void; onWithin: (m: number | null) => void;
  onCat: (c: string) => void; onSub: (s: string) => void; onPlace: (ref: string) => void;
  onPictures: () => void; onBar: (sub: string) => void; onUp: () => void;
}) {
  const { where, within, mode, ring, lens, cat, sub, phone } = props;
  const [level, setLevel] = useState<PlaceLevel | null>(null);
  // In the address: "the places here missing a menu" is a piece of work, and a
  // piece of work is a link you can send somebody (17 Sep 2026, the
  // verification audit — it was component state and nothing could set it).
  const [missing, setMissing] = useQueryState<string>('missing', '', asText);
  const [names, setNames] = useState<{ cat?: string; sub?: string; subs?: number; needs?: string[] }>({});

  const q = useMemo(() => ({ where, within: within ?? undefined, by: ring ? mode : undefined }), [where, within, ring, mode]);
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
  useEffect(() => {
    setLevel(null); setNoSuchArea(null);
    api.adminPlaceArea(scoped as any)
      .then((l) => { setLevel(l); setNoSuchArea(null); })
      .catch((e: any) => setNoSuchArea(e?.body?.message ?? 'Nothing here by that name yet.'));
  }, [scoped]);

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
        <View style={[styles.search, { width: 320 }]}><AreaSearch onWhere={props.onWhere} /></View>
      </AdminPage>
    );
  }
  if (!level) return <AdminPage><Waiting /></AdminPage>;

  // BO2l — Places at 390. The one number you would check on a train is ready %,
  // so the phone draws its own board rather than a squeeze of the desk one.
  if (phone && lens === 'coverage' && !ring && level.areaKind !== 'country') {
    return <PlacesPhone level={level} q={q} lens={lens} onLens={props.onLens} onWhere={props.onWhere} onUp={props.onUp} />;
  }

  const body = (() => {
    if (lens === 'category' && sub) return <PlacesBoard q={q} cat={cat} sub={sub} onPlace={props.onPlace} onBar={props.onBar} canManage={props.canManage} missing={missing || null} onMissing={(f) => setMissing(f ?? '')} onNames={setNames} onWiden={props.onWithin} within={within} />;
    if (lens === 'category') return <CategoryBoard q={q} cat={cat} onCat={props.onCat} onSub={props.onSub} canManage={props.canManage} onNames={setNames} onWiden={props.onWithin} within={within} onCollect={() => props.onLens('collect')} />;
    if (lens === 'source') return <SourceBoard q={q} onSub={props.onSub} />;
    if (lens === 'quality') return <QualityBoard q={q} onPlace={props.onPlace} canManage={props.canManage} />;
    if (lens === 'demand') return <DemandLens q={q} canManage={props.canManage} onCollect={() => props.onLens('collect')} />;
    if (lens === 'collect') return <CollectBoard q={q} level={level} canManage={props.canManage} cat={cat} sub={sub} />;
    if (ring) return <RingBoard q={q} onSub={props.onSub} onLens={props.onLens} onWithin={props.onWithin} />;
    if (level.areaKind === 'country') return <BreakdownBoard q={q} by={props.breakdownBy} onBy={props.onBy} onWhere={props.onWhere} canManage={props.canManage}
                                                             onCollectIn={(slug) => { props.onWhere(slug); props.onLens('collect'); }} />;
    return <CoverageBoard q={q} onWhere={props.onWhere} onCollect={() => props.onLens('collect')} />;
  })();

  // Where the level is standing: the category, then the subcategory. Each is a
  // step back out, and each renames the board and its five numbers.
  const deep = [
    // A ring is a step in its own right: the board's breadcrumb reads
    // "Great Britain · SL4 1QN · 30 minutes by car · Family · Playgrounds".
    ...(ring ? [{ label: `${level.name} · ${within} minutes by ${MODE_LABEL[mode].toLowerCase()}`, onPress: (cat || sub) ? () => { props.onCat(''); props.onSub(''); } : undefined }] : []),
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
            stats={lens === 'demand' ? null : <Five stats={level.stats} ring={ring} kind={lens === 'category' && sub ? names.sub ?? null : null} needs={names.needs ?? null} />} />
      <LensRow lens={lens} onLens={props.onLens}
               right={ring
                 ? <RingChooser minutes={within ?? 30} mode={mode} onMinutes={props.onWithin} onMode={props.onBy}
                                cells={level.cells} modesBuilt={level.modesBuilt} />
                 : <AreaSearch onWhere={props.onWhere} />} />
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
  level: PlaceLevel; onUp: () => void; onWhere: (slug: string) => void;
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
  return (
    <View style={styles.lensRow}>
      <View style={styles.lensLeft}>
        <Kicker tip="sectionCutBy">Cut by</Kicker>
        <View style={styles.lenses}>
          {LENSES.map((l) => (
            <Explain key={l} tip={l === 'collect' ? 'collect' : null} cursor="pointer">
              <Press effect="none" onPress={() => onLens(l)} accessibilityRole="tab"
                     accessibilityState={{ selected: lens === l }} accessibilityLabel={LENS_LABEL[l]}
                     style={[styles.lens, lens === l && styles.lensOn]}>
                <Text style={[styles.lensWord, lens === l && styles.lensWordOn]}>{LENS_LABEL[l]}</Text>
              </Press>
            </Explain>
          ))}
        </View>
      </View>
      {right}
    </View>
  );
}

/** 30 min · 1 hour · 90 min, by car, walking or transit. */
function RingChooser({ minutes, mode, onMinutes, onMode, cells, modesBuilt }: {
  minutes: number; mode: string; onMinutes: (m: number) => void; onMode: (m: string) => void; cells: number | null;
  /** Which ways of getting about the matrix can answer here; undefined means "do not know, offer them all". */
  modesBuilt?: string[];
}) {
  return (
    <Explain tip={['How far out', cells == null
      ? 'The driving time between every postcode area is worked out once, so answering this does no sums.'
      : `${cells.toLocaleString()} postcode areas are within ${minutes} minutes of here. That was worked out once, so answering this does no sums.`]}>
      <View style={styles.chooser}>
        <View style={styles.segment}>
          {BANDS.map((b) => (
            <Press key={b} effect="none" onPress={() => onMinutes(b)} accessibilityRole="button"
                   accessibilityState={{ selected: minutes === b }} accessibilityLabel={bandLabel(b)}
                   style={[styles.segItem, minutes === b && styles.segItemOn]}>
              <Text style={[styles.segWord, minutes === b && styles.segWordOn]}>{bandLabel(b)}</Text>
            </Press>
          ))}
        </View>
        <View style={styles.segment}>
          {MODES.map((m) => {
            // A way of getting about the matrix has not been built here cannot
            // answer, and a ring drawn in it comes back empty with nothing to
            // say why. The word stays — removing a control is the owner's call
            // — and says what it is waiting for (17 Sep 2026).
            const built = !modesBuilt || modesBuilt.includes(m);
            return (
              <Explain key={m} tip={built ? null : (['Not worked out yet', `The reachability matrix has not been built for ${MODE_LABEL[m].toLowerCase()} here. It is a free run, on Runs.`] as const)}>
                <Press effect="none" onPress={() => (built ? onMode(m) : undefined)} accessibilityRole="button"
                       disabled={!built}
                       accessibilityState={{ selected: mode === m, disabled: !built }} accessibilityLabel={MODE_LABEL[m]}
                       style={[styles.segItem, mode === m && styles.segItemOn]}>
                  <Text style={[styles.segWord, mode === m && styles.segWordOn, !built && styles.segWordOff]}>{MODE_LABEL[m]}</Text>
                </Press>
              </Explain>
            );
          })}
        </View>
      </View>
    </Explain>
  );
}

/** A county, a town or a postcode. A full postcode opens the ring chooser. */
function AreaSearch({ onWhere }: { onWhere: (slug: string, opts?: { within?: number | null; by?: string }) => void }) {
  const [q, setQ] = useState('');
  const [out, setOut] = useState<Awaited<ReturnType<typeof api.adminPlaceSearch>> | null>(null);
  const [band, setBand] = useState(30);
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
        <TextInput value={q} onChangeText={setQ} placeholder="A county, town or postcode"
                   placeholderTextColor={colors.inkMuted} style={styles.searchInput}
                   accessibilityLabel="Search for a county, town or postcode" />
      </View>
      {out && (out.areas.length || out.postcode) ? (
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
                   onPress={() => { setQ(''); setOut(null); onWhere(a.slug); }} style={styles.suggestRow}>
              <Text style={styles.suggestName}>{a.name}</Text>
              <Text style={styles.suggestKind}>{a.parent ? `${a.kind} · ${a.parent}` : a.kind}</Text>
            </Press>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const Waiting = () => <View style={{ paddingVertical: spacing.xl, alignItems: 'flex-start' }}><ActivityIndicator color={colors.accent} /></View>;

// ---------------------------------------------------------------------------
// BO2a / BO2n — the level, cut by county, city or postcode district
// ---------------------------------------------------------------------------

function BreakdownBoard({ q, by, onBy, onWhere, onCollectIn, canManage }: {
  q: any; by: By; onBy: (b: string) => void; canManage: boolean;
  onWhere: (slug: string, opts?: { within?: number | null; by?: string }) => void;
  onCollectIn: (slug: string) => void;
}) {
  const [data, setData] = useState<{ rows: PlaceAreaRow[]; all: number; totals: PlaceStats } | null>(null);
  // In the address: the board's own URL carries `&sort=empty.desc`, and a board
  // you cannot send somebody is half a board (Codex, 17 Sep 2026).
  const [sort, setSort] = useQueryState<string>('sort', 'searches', asText);
  const [desc, setDesc] = useQueryState<boolean>('desc', true, { read: (r) => r !== '0', write: (v) => (v ? null : '0') });
  useEffect(() => {
    setData(null);
    api.adminPlaceBreakdown({ ...q, by, sort, desc: desc ? undefined : '0' }).then(setData).catch(() => setData({ rows: [], all: 0, totals: { known: 0, owned: 0, claimed: 0, identified: 0, readyCount: 0, ready: null, avgScore: null } }));
  }, [q, by, sort, desc]);

  const columns: Col<PlaceAreaRow>[] = [
    { key: 'name', label: BY_LABEL[by], note: data ? `${data.rows.length.toLocaleString()} of ${data.all.toLocaleString()}` : undefined,
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
    { key: 'searches', label: 'Searches', note: '30 days', tip: 'searches', width: 130, align: 'right', sort: 'searches', cell: (r) => <Num n={r.searches || null} /> },
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
                onRow={(r) => onWhere(r.slug)} highlight={(r) => r.slug === worst?.slug}
                sort={sort} desc={desc}
                onSort={(k) => { if (k === sort) setDesc(!desc); else { setSort(k); setDesc(true); } }}
                empty={<Word muted>Nothing indexed here yet.</Word>} />
      ) : <Waiting />}
      <Footer>
        <Act label="Add a country" tone="secondary" disabled onPress={() => {}} />
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
  q: any; onWhere: (slug: string) => void; onCollect: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceCoverage>> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(() => { setData(null); api.adminPlaceCoverage(q).then(setData).catch(() => setData(null)); }, [q]);
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
      <View style={styles.subRow}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9 }}>
          <Kicker tip="sectionWhere">Where</Kicker>
          {data ? <Text style={styles.rowNote}>{`${data.towns} of ${data.allTowns || data.towns} towns · ${data.outcodes} outcodes`}</Text> : null}
        </View>
        <View style={{ flex: 1 }} />
        {/* `ago()` starts at a day, and the one thing this label exists to say
            is how stale the counts are (Codex, 17 Sep 2026). */}
        <Act label={`Refresh the counts${data?.refreshedAt ? ` · ${since(data.refreshedAt)}` : ''}`} tone="secondary" disabled={refreshing}
             onPress={() => { setRefreshing(true); api.adminRefreshPlaceCounts().finally(() => { setRefreshing(false); load(); }); }} />
      </View>
      {data ? (
        <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.slug} onRow={(r) => onWhere(r.slug)}
                empty={<Word muted>Nothing indexed under this county yet.</Word>} />
      ) : <Waiting />}
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

function CategoryBoard({ q, cat, onCat, onSub, canManage, onNames, onWiden, within, onCollect }: {
  q: any; cat: string; onCat: (c: string) => void; onSub: (s: string) => void; canManage: boolean;
  /** Collect lives inside Places, so every one of these opens its lens. */
  onCollect: () => void;
  onNames: (n: { cat?: string; sub?: string; subs?: number; needs?: string[] }) => void;
  onWiden: (m: number) => void; within: number | null;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceCategories>> | null>(null);
  const [hideFull, setHideFull] = useState(false);
  // Subcategories, or every provider's own word for a kind of place. Both are
  // driven by the vocabulary rather than by the data, so an empty one is the
  // finding either way.
  const [by, setBy] = useQueryState<'subcategories' | 'labels'>('words', 'subcategories', asOneOf(['subcategories', 'labels'] as const, 'subcategories'));
  useEffect(() => {
    setData(null);
    api.adminPlaceCategories({ ...q, cat: cat || undefined, words: by === 'labels' ? 'labels' : undefined })
      .then(setData).catch(() => setData(null));
  }, [q, cat, by]);

  // The words the boards use: "a picture, what it is, opening hours".
  const factLabel = useMemo(() => new Map(Object.entries(NEEDS_WORD)), []);
  const open = data?.categories.find((x) => x.key === cat) ?? null;
  // The band above needs this board's own words for the level it is standing on.
  useEffect(() => {
    onNames({ cat: open?.label, subs: open?.subcategories.length ?? data?.subcategories });
  }, [open, data, onNames]);

  // One category open: its subcategories, every one of them, the empty ones
  // included — "an empty subcategory is the finding" (BO2p).
  if (cat) {
    const c = open;
    return (
      <>
        {data && c
          ? <SubcategoryLadder rows={c.subcategories} onSub={onSub} factLabel={factLabel} canManage={canManage}
                               inRing={q.within != null} of={c.subcategories.length} onCollect={onCollect} />
          : <Waiting />}
        <Footer>
          {q.within != null && (within ?? 30) < 90
            ? <Act label={`Widen to ${bandLabel((within ?? 30) === 30 ? 60 : 90)}`} tone="secondary" onPress={() => onWiden((within ?? 30) === 30 ? 60 : 90)} />
            : null}
          {c ? <Act label={`Collect ${c.label.toLowerCase()} places here`} icon="download" disabled={!canManage} onPress={onCollect} /> : null}
        </Footer>
      </>
    );
  }

  // A ring is one area, so its rows are the eight categories (BO2o). An area
  // with a ladder under it lists every subcategory under its category heading
  // (BO2c). Both are driven by the taxonomy, not the data.
  const ring = q.within != null;
  const all = data?.categories ?? [];
  const flat = all.flatMap((c) => c.subcategories.map((s) => ({ ...s, categoryLabel: c.label })));
  const shown = hideFull ? flat.filter((s) => s.known === 0) : flat;
  const withPlaces = flat.filter((s) => s.known > 0).length;

  const catColumns: Col<PlaceCategory>[] = [
    { key: 'label', label: 'Our category', note: `${all.length} of ${all.length}`, tip: 'ourCategory', grow: true,
      cell: (c) => (
        <View style={styles.nameCell}>
          <Text style={styles.rowName}>{c.label}</Text>
          <Text style={styles.rowNote}>{`${c.subcategories.length} subcategories`}</Text>
        </View>
      ) },
    { key: 'known', label: 'Known', tip: 'known', width: 104, align: 'right', cell: (c) => <Num n={c.known || null} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 96, align: 'right', cell: (c) => <Num n={c.owned || null} /> },
    { key: 'ident', label: 'Identified only', tip: 'identifiedOnly', width: 140, align: 'right', cell: (c) => <Num n={c.identified || null} /> },
    { key: 'ready', label: 'Ready', tip: 'readyShort', width: 104, align: 'right', cell: (c) => <Pct v={c.ready} strong min={52} /> },
    { key: 'score', label: 'Avg score', tip: 'avgScoreCategory', width: 110, align: 'right', cell: (c) => <Num n={c.avgScore} /> },
    { key: 'searches', label: 'Searches', note: '30 days', tip: ring ? 'searchesRing' : 'searches', width: 104, align: 'right', cell: (c) => <Num n={c.searches || null} /> },
    { key: 'empty', label: 'Came back empty', note: 'of those searches', tip: 'empty', width: 134, align: 'right',
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
          <Act label={hideFull ? `Show me all ${flat.length}` : `Hide the ones with places · ${withPlaces}`}
               tone="secondary" onPress={() => setHideFull(!hideFull)} />
        </View>
      ) : null}
      {!data ? <Waiting /> : by === 'labels' ? (
        <LabelLadder rows={data.labels ?? []} />
      ) : ring ? (
        <Ladder columns={catColumns} rows={all} keyOf={(c) => c.key} onRow={(c) => onCat(c.key)}
                highlight={(c) => c.searches > 0 && c.empty / Math.max(1, c.searches) > 0.2} />
      ) : (
        <SubcategoryLadder rows={shown} onSub={onSub} factLabel={factLabel} canManage={canManage} inRing={false}
                           of={data.subcategories} onCollect={onCollect}
                           groupOfCategory={(key) => all.find((x) => x.key === key) ?? null} />
      )}
      <Footer>
        {/* The board's own footer word for the same act as the switch above: show
            me only the ones with nothing in them. */}
        {!ring && !hideFull && flat.length - withPlaces > 0
          ? <Act label={`Show me just the ${flat.length - withPlaces}`} tone="secondary" onPress={() => setHideFull(true)} />
          : null}
        {q.within != null && (within ?? 30) < 90
          ? <Act label={`Widen to ${bandLabel((within ?? 30) === 30 ? 60 : 90)}`} tone="secondary" onPress={() => onWiden((within ?? 30) === 30 ? 60 : 90)} />
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
  const judged = useMemo(() => rows.filter((r: any) => r.barSet && (r.needs ?? []).length), [rows]);
  const setsItApart = useCallback(
    (fact: string) => judged.length >= 2 && !judged.every((r: any) => (r.needs ?? []).includes(fact)),
    [judged],
  );

  const columns: Col<any>[] = [
    { key: 'label', label: 'Our subcategory', note: of ? `${rows.length} of ${of}` : undefined, tip: 'ourSubcategory', grow: true,
      cell: (s) => <Text style={[styles.rowName, s.known === 0 && styles.rowNameEmpty]}>{s.label}</Text> },
    { key: 'known', label: 'Known', tip: 'known', width: 96, align: 'right', cell: (s) => <Num n={s.known || null} /> },
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
            // The heading row carries the category's own totals in the same
            // columns the rows under it use — the board prints them, and a
            // heading with no figures is a heading you cannot read a table by.
            groupOf={groupOfCategory
              ? (s, prev) => {
                  if (prev && prev.category === s.category) return null;
                  const c = groupOfCategory(s.category);
                  if (!c) return null;
                  return (
                    <View style={styles.groupRow}>
                      <Text style={[styles.group, { flex: 1 }]}>{`${c.label.toUpperCase()} · ${c.subcategories.length} subcategories`}</Text>
                      <Text style={[styles.groupNum, { width: 96 }]}>{c.known ? c.known.toLocaleString() : '—'}</Text>
                      <Text style={[styles.groupNum, { width: 88 }]}>{c.owned ? c.owned.toLocaleString() : '—'}</Text>
                      <Text style={[styles.groupNum, { width: 96 }]}>{c.ready == null ? '—' : `${c.ready}%`}</Text>
                      <Text style={[styles.groupNum, { width: 104 }]}>{c.avgScore ?? '—'}</Text>
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
          <Text style={[styles.rowName, !r.name && styles.refName]}>{r.name ?? r.ref}</Text>
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
        <Act label={picked.size ? `Ask Google about these ${picked.size} · ${pounds(Math.round(picked.size * 1.4))}` : 'Ask Google about them'}
             disabled={!canManage || !picked.size || busy != null}
             onPress={() => { setBusy('google'); api.adminAskAboutPlaces([...picked]).finally(() => { setBusy(null); setPicked(new Set()); }); }} />
      </Footer>
    </>
  );
}

const beenWord = (band: string) => ({ thousands: 'thousands', many: 'many', hundreds: 'hundreds', few: 'a few' } as Record<string, string>)[band] ?? band;
const sourcesSentence = (s: string[]) =>
  (s.length === 0 ? null : s.length === 1 ? `${sourceWord(s[0])} only` : s.length === 2 ? `${sourceWord(s[0])} and ${sourceWord(s[1])}` : s.map(sourceWord).join(', '));
const sourceWord = (k: string) => ({ google: 'Google', osm: 'OSM', atlas: 'Atlas', sweep: 'the sweep', tripadvisor: 'Tripadvisor', own: 'ours' } as Record<string, string>)[k] ?? k;

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
      {data.figuresFrom ? (
        <View style={styles.subRow}>
          <Word muted>{`${data.figuresFrom.name}'s figures — ${data.figuresFrom.why}.`}</Word>
        </View>
      ) : null}
      <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.subject ?? 'anything'}
              highlight={(r) => r.fault === 'empty-always'}
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
              empty={<Word muted>Nothing in reach yet.</Word>} />
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
        {(q.within ?? 30) < 90 ? <Act label={`Widen to ${bandLabel((q.within ?? 30) === 30 ? 60 : 90)}`} tone="secondary" onPress={() => onWithin((q.within ?? 30) === 30 ? 60 : 90)} /> : null}
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

const SHOW = ['not-ready', 'ready', 'all'] as const;
const SHOW_LABEL: Record<string, string> = { 'not-ready': 'Not ready', ready: 'Ready', all: 'All' };

function PlacesBoard({ q, cat, sub, onPlace, onBar, canManage, missing, onMissing, onNames, onWiden, within }: {
  q: any; cat: string; sub: string; onPlace: (ref: string) => void; onBar: (s: string) => void;
  canManage: boolean; missing: string | null; onMissing: (f: string | null) => void;
  onNames: (n: { cat?: string; sub?: string; subs?: number; needs?: string[] }) => void;
  onWiden: (m: number) => void; within: number | null;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceList>> | null>(null);
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
  const [bar, setBar] = useState<ReadyBars['subcategories'][number] | null>(null);
  useEffect(() => { api.adminReadyBars().then((b) => setBar(b.subcategories.find((x) => x.key === sub) ?? null)).catch(() => setBar(null)); }, [sub]);
  useEffect(() => { onNames({ sub: bar?.label ?? sub, cat: bar?.categoryLabel, needs: bar?.facts.filter((f) => f.required).map((f) => f.fact) }); }, [bar, sub, onNames]);

  const reload = useCallback(() => {
    setData(null);
    api.adminPlaceList({ ...q, cat: cat || undefined, sub, show, q: query || undefined, missing: missing || undefined, sort, desc: desc ? undefined : '0' })
      .then(setData).catch(() => setData(null));
  }, [q, cat, sub, show, query, missing, sort, desc]);
  useEffect(reload, [reload]);

  const counted = data?.counted ?? [];
  const facts: FactDef[] = data?.facts ?? [];
  const nameless = data?.rows.filter((r) => !r.name && picked.has(r.ref)).length ?? 0;

  const columns: Col<PlaceRow>[] = [
    { key: 'tick', label: '', width: 26, align: 'left', stops: true,
      cell: (r) => <Box on={picked.has(r.ref)} onPress={() => setPicked(toggle(picked, r.ref))} label={r.name ?? r.ref} /> },
    { key: 'name', label: 'Place', tip: 'placeRow', grow: true,
      // A nameless row is the finding: Google is the only source that has ever
      // seen this place, so there is no name we are allowed to hold.
      cell: (r) => (
        <View style={styles.nameCell}>
          <Text style={[styles.rowName, !(r.name ?? fetched[r.ref]) && styles.refName]} numberOfLines={1}>{r.name ?? fetched[r.ref] ?? r.ref}</Text>
          {!r.name && fetched[r.ref] ? <Text style={styles.rowNote}>fetched · not kept</Text> : null}
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
                  empty={<Word muted>Nothing here that is {show === 'ready' ? 'ready' : 'not ready'}.</Word>} />
        </>
      ) : <Waiting />}
      <Footer left={
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
          {picked.size ? <Text style={styles.selected}>{`${picked.size} selected`}</Text> : null}
          <Press effect="none" onPress={() => onBar(sub)} accessibilityRole="button" accessibilityLabel="What counts as ready here">
            <Text style={styles.trailWord}>What counts as ready here</Text>
          </Press>
        </View>
      }>
        {q.within != null && (within ?? 30) < 90
          ? <Act label={`Widen to ${bandLabel((within ?? 30) === 30 ? 60 : 90)}`} tone="secondary" onPress={() => onWiden((within ?? 30) === 30 ? 60 : 90)} />
          : null}
        <Act label={busy === 'curate' ? 'Curating…' : picked.size ? `Curate these ${picked.size} · free` : 'Curate them · free'} tone="secondary"
             disabled={!canManage || !picked.size || busy != null}
             onPress={() => { setBusy('curate'); api.adminCuratePlaces([...picked]).finally(() => { setBusy(null); setPicked(new Set()); reload(); }); }} />
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
                 .finally(() => { setBusy(null); setPicked(new Set()); reload(); });
             }} />
      </Footer>
    </>
  );
}

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
      <Ladder columns={columns} rows={rows} keyOf={(r) => r.key} />
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
  pictures: 'Pictures', raw: 'What each source returned', history: 'History',
};

function PlaceBoard({ refId, canManage, onClose, phone, tab, onTab }: {
  refId: string; canManage: boolean; onClose: () => void; phone: boolean;
  /** Held by the screen above, so closing the drawer takes `?tab=` with it. */
  tab: PlaceTab; onTab: (t: PlaceTab) => void;
}) {
  const setTab = onTab;
  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [curating, setCurating] = useState(false);
  const load = useCallback(() => {
    setPlace(null); setError(null);
    api.adminPlace(refId).then(setPlace).catch((e: any) => setError(e?.body?.message ?? 'Nothing indexed under that ref yet.'));
  }, [refId]);
  useEffect(load, [load]);

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
      <Band kicker={kicker} title={place.name ?? place.ref} stats={
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
            <Stat label="Pictures" value={place.pictures.filter((p) => p.owned).length} tip="pictures" mark />
            <Stat label="Oldest fact" value={place.oldestFact ? ago(place.oldestFact) : 'never'} tip="oldestFactPlace" mark />
          </View>
        )
      } />

      <View style={styles.lensRow}>
        <View style={styles.lensLeft}>
          <Kicker tip="sectionLookingAt">Looking at</Kicker>
          <View style={styles.lenses}>
            {PLACE_TABS.map((t) => (
              <Press key={t} effect="none" onPress={() => setTab(t)} accessibilityRole="tab"
                     accessibilityState={{ selected: tab === t }} accessibilityLabel={PLACE_TAB_LABEL[t]}
                     style={[styles.lens, tab === t && styles.lensOn]}>
                <Text style={[styles.lensWord, tab === t && styles.lensWordOn]}>{PLACE_TAB_LABEL[t]}</Text>
              </Press>
            ))}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Act label={curating ? 'Curating…' : 'Curate it · free'} tone="secondary" disabled={!canManage || curating}
               onPress={() => { setCurating(true); api.adminCuratePlaces([refId]).finally(() => { setCurating(false); load(); }); }} />
          <Act label="Compare all three · £0.014" disabled={!canManage} onPress={() => setTab('compare')} />
        </View>
      </View>

      {tab === 'record' ? <RecordTab place={place} canManage={canManage} onSaved={load} /> : null}
      {tab === 'compare' ? <CompareTab refId={refId} canManage={canManage} onEdit={() => setTab('record')} /> : null}
      {tab === 'score' ? <ScoreTab refId={refId} canManage={canManage} /> : null}
      {tab === 'pictures' ? <PlacePicturesTab place={place} canManage={canManage} onFound={load} /> : null}
      {tab === 'raw' ? <RawTab refId={refId} /> : null}
      {tab === 'history' ? <HistoryTab refId={refId} /> : null}
    </AdminPage>
  );
}

/** BO2r — every field with its source, and Edit on the ones that are ours. */
function RecordTab({ place, canManage, onSaved }: { place: PlaceDetail; canManage: boolean; onSaved: () => void }) {
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
              <View style={{ width: 72 }}>
                {f.editable && canManage ? (
                  <Explain tip="editableValue">
                    <Press effect="none" onPress={() => { setEditing(f.key); setDraft(String(f.value ?? '')); }}
                           accessibilityRole="button" accessibilityLabel={`Edit ${f.label}`} style={styles.edit}>
                      <Icon name="edit" size={11} strokeWidth={2} color={colors.inkMuted} />
                      <Text style={styles.editWord}>Edit</Text>
                    </Press>
                  </Explain>
                ) : f.action && canManage ? (
                  // Each of these runs the thing that would fill the hole,
                  // rather than opening the same edit box Edit opens: Write
                  // researches it from the open sources, Find looks for the
                  // venue's own page or a picture we may keep, Read reads their
                  // menu, Ask asks the paid source and says what it cost
                  // (17 Sep 2026, the verification audit).
                  <Act label={busy === f.key ? '…' : (ACTION_WORD[f.action as FieldAction] ?? 'Ask')}
                       small tone="secondary" disabled={busy != null}
                       onPress={() => runFor(f.key, f.action as FieldAction)} />
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
            <Explain key={`${p.id}-${i}`} tip={p.owned ? null : 'rented'} style={[styles.thumb, !p.owned && { opacity: 0.5 }]}>
              {/* The picture, not a grey box. The ids were in hand and the panel
                  drew N empty squares under the words "N owned" (17 Sep 2026,
                  the verification audit). */}
              <View style={styles.thumbImage}>
                <Image source={{ uri: api.imageUrl(p.id, 240) }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
              </View>
              <Text style={styles.thumbNote} numberOfLines={1}>{p.owned ? (p.source ?? 'ours') : 'rented'}</Text>
            </Explain>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {/* Curate is the run that looks for a picture we are allowed to keep;
              asking a household is a message and needs a sender key, which is
              the owner's to add — so it says so rather than doing nothing. */}
          <Act label={busy === 'commons' ? 'Looking…' : 'Look on Commons · free'} small tone="secondary" disabled={!canManage || busy != null}
               onPress={() => { setBusy('commons'); api.adminFindPictures([place.ref]).finally(() => { setBusy(null); onSaved(); }); }} />
          <Act label="Ask a household · needs a sender" small tone="secondary" disabled onPress={() => {}} />
        </View>

        <View style={{ height: spacing.lg }} />
        <Kicker tip="sectionNotChecked">Not checked</Kicker>
        {/* Which sources, not just how many: the board's own tooltip says "open it
            to see which and run them", so the row opens (Codex, 17 Sep 2026). */}
        {([['free', place.unseen.filter((u) => !u.paid)], ['paid', place.unseen.filter((u) => u.paid)]] as const).map(([which, list], i) => (
          <React.Fragment key={which}>
            <Explain tip={which === 'free'
              ? ['Free sources', `${list.map((u) => u.label).join(', ') || 'Nothing'} ${list.length === 1 ? 'has' : 'have'} never been asked about this place. Nothing to spend.`]
              : ['Paid sources', `${list.map((u) => u.label).join(', ') || 'Nothing'} ${list.length === 1 ? 'has' : 'have'} never been asked. Google is £0.014 a place; Tripadvisor comes out of this month's allowance.`]}
                     style={[styles.notChecked, i === 1 && { borderBottomWidth: 0 }]}>
              <Press effect="none" onPress={() => setOpenSources(openSources === which ? null : which)}
                     accessibilityRole="button" accessibilityLabel={`The ${which} sources nobody has asked`}
                     style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Text style={styles.notCheckedBig}>{list.length}</Text>
                <Text style={styles.notCheckedWord}>{`${which} sources`}</Text>
                <View style={{ flex: 1 }} />
                <Icon name={openSources === which ? 'collapse' : 'expand'} size={15} strokeWidth={2} color={colors.inkMuted} />
              </Press>
              <Act label={which === 'free' ? 'Run them' : `${pounds(Math.round(list.length * 1.4))} · ask`} small tone="secondary"
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
        {place.ids.map((id, i) => (
          <View key={id.key} style={[styles.idRow, i === place.ids.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={styles.idLabel}>{id.label}</Text>
            {id.value
              ? <Text style={styles.idValue} numberOfLines={1}>{id.value}</Text>
              : id.state === 'no-match' ? <Explain tip="noMatch"><NoMatch /></Explain>
              : <Explain tip="notAsked"><NotAsked /></Explain>}
          </View>
        ))}
      </View>
    </View>
  );
}

const Detail = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

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
  const say = (v: unknown): string => {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) {
      const parts = v.map((x) => (x && typeof x === 'object' ? (x as any).label ?? (x as any).key ?? (x as any).name ?? '' : String(x))).filter(Boolean);
      return parts.join(', ');
    }
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'object') {
      const held = Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== '' && x !== false);
      if (!held.length) return '';
      return held.map(([k, x]) => (x === true ? fieldWord(k).toLowerCase() : `${fieldWord(k).toLowerCase()} ${say(x)}`)).join(', ');
    }
    return String(v);
  };
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
          <Explain key={c.key} tip={c.key === 'ours' ? 'ours' : c.key === 'google' ? 'google' : 'sourceTripadvisor'} style={{ flex: 1 }}>
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

      <Footer left={<Text style={styles.rowNote}>{data.columns.map((c) => `${c.label}: ${c.filled ?? 0} of ${c.of ?? 0}`).join('  ·  ')}</Text>}>
        {!match ? <Act label="Match it by name and distance · £0.014" disabled={!canManage} onPress={() => setMatch(true)} /> : null}
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

  const out = Math.round(data.epicScore * 10);
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
              <View style={{ width: 130, alignItems: 'flex-end' }}>
                {/* Law 3: nothing held is a dash, never a nought. */}
                {i.worth ? <Num n={i.worth} /> : <Blank />}
              </View>
              <View style={{ width: 150, alignItems: 'flex-end' }}>
                <Text style={[styles.fieldMeta, i.owned && { color: colors.accent, fontWeight: '700' }]}>
                  {i.owned ? (i.held ? 'yes, ours' : 'would be') : 'no'}
                </Text>
              </View>
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
  const [sel, setSel] = useState(0);
  const [looking, setLooking] = useState(false);
  const { width } = useViewport();
  const owned = place.pictures;
  if (!owned.length) {
    return (
      <View style={{ gap: spacing.md }}>
        <Word muted>No picture we own.</Word>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {/* Curate is the run that looks for a picture we may keep; asking a
              household is a message, and a message needs a sender key the owner
              has to add — so it says so rather than doing nothing. */}
          <Act label={looking ? 'Looking…' : 'Look on Commons · free'} tone="secondary" disabled={!canManage || looking}
               onPress={() => { setLooking(true); api.adminFindPictures([place.ref]).finally(() => { setLooking(false); onFound(); }); }} />
          <Act label="Ask a household · needs a sender" tone="secondary" disabled onPress={() => {}} />
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
function RawTab({ refId }: { refId: string }) {
  const [data, setData] = useState<{ ref: string; sources: RawSource[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setData(null); api.adminPlaceRaw(refId).then(setData).catch(() => setData(null)); }, [refId]);
  if (!data) return <Waiting />;
  return (
    <View>
      {data.sources.map((s) => (
        <React.Fragment key={s.key}>
          <Press effect="none" onPress={() => setOpen(open === s.key ? null : s.key)} accessibilityRole="button"
                 accessibilityLabel={s.label} style={styles.recordRow}>
            <Explain tip={[s.label, s.explain]} style={{ width: 180 }}><Text style={styles.fieldName}>{s.label}</Text></Explain>
            <View style={{ flex: 1 }}>
              {s.state === 'not-asked' ? <Explain tip="notAsked"><NotAsked /></Explain>
                : s.state === 'no-match' ? <Explain tip="noMatch"><NoMatch /></Explain>
                : <Text style={styles.fieldValue}>{`${s.fields.length} field${s.fields.length === 1 ? '' : 's'}`}</Text>}
            </View>
            <Text style={[styles.fieldMeta, { width: 140 }]}>{s.id ?? '—'}</Text>
            <Text style={[styles.fieldMeta, { width: 110 }]}>{s.lastSeen ? day(s.lastSeen) : '—'}</Text>
            <Icon name={open === s.key ? 'collapse' : 'expand'} size={15} strokeWidth={2} color={colors.inkMuted} />
          </Press>
          {open === s.key ? (
            <View style={styles.expand}>
              {s.fields.length === 0 ? <Word muted>Nothing held from this source.</Word> : s.fields.map((f) => (
                <View key={f.field} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{f.field}</Text>
                  <Text style={styles.detailValue}>{typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)}</Text>
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
            <Press key={f.key} effect="none" onPress={() => setFacet(facet === f.key ? '' : f.key)}
                   accessibilityRole="button" accessibilityState={{ selected: facet === f.key }} accessibilityLabel={f.label}
                   style={[styles.facet, facet === f.key && styles.facetOn]}>
              <Text style={[styles.facetWord, facet === f.key && styles.facetWordOn]}>{f.label}</Text>
              <Text style={[styles.facetN, facet === f.key && { color: colors.onLime }]}>{f.n ? f.n.toLocaleString() : '—'}</Text>
            </Press>
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

const Fact = ({ label, value, strong, link, onPress, last }: { label: string; value: string; strong?: boolean; link?: string | null; onPress?: () => void; last?: boolean }) => (
  <View style={[styles.factRow, last && { borderBottomWidth: 0 }]}>
    <Text style={styles.factLabel}>{label}</Text>
    {link
      ? <Press effect="none" onPress={onPress} accessibilityRole="link" accessibilityLabel={label} style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.factValue, { color: colors.accent }]} numberOfLines={1}>{value}</Text>
        </Press>
      : <Text style={[styles.factValue, strong && styles.strong]} numberOfLines={2}>{value}</Text>}
  </View>
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
            {data.subcategories.map((s) => (
              <Press key={s.key} effect="none" onPress={() => setPick(s.key)} accessibilityRole="button"
                     accessibilityState={{ selected: pick === s.key }} accessibilityLabel={s.label}
                     style={[styles.pickRow, pick === s.key && styles.pickRowOn, !s.set && { opacity: 0.6 }]}>
                <Text style={[styles.pickName, pick === s.key && { color: colors.selectedFg, fontWeight: '700' }]} numberOfLines={1}>{s.label}</Text>
                <Text style={[styles.pickN, pick === s.key && { color: colors.onLime }]}>
                  {s.set ? `${s.facts.filter((f) => f.required).length} fact${s.facts.filter((f) => f.required).length === 1 ? '' : 's'}` : 'not set'}
                </Text>
              </Press>
            ))}
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
                <Text style={[styles.fieldMeta, { width: 150, textAlign: 'right' }]}>{d.required ? `weight ${d.weight}` : '—'}</Text>
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
  onLens: (l: Lens) => void; onWhere: (slug: string) => void; onUp: () => void;
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
            <Press key={l} effect="none" onPress={() => onLens(l)} accessibilityRole="tab"
                   accessibilityState={{ selected: lens === l }} accessibilityLabel={LENS_LABEL[l]}
                   style={[styles.segItem, lens === l && styles.segItemOn]}>
              <Text style={[styles.segWord, lens === l && styles.segWordOn]}>{LENS_LABEL[l]}</Text>
            </Press>
          ))}
        </View>
      </ScrollView>

      {!data ? <Waiting /> : data.rows.map((r, i) => (
        <Press key={r.slug} effect="none" onPress={() => onWhere(r.slug)} accessibilityRole="button"
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
  five: { flexDirection: 'row', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap' },

  // the way back
  trail: { flexDirection: 'row', alignItems: 'center', gap: 11, flexWrap: 'wrap' },
  trailBack: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trailWord: { ...type.small, fontSize: 13, fontWeight: '700', color: colors.accent },
  trailNote: { ...type.small, fontSize: 12.5, color: colors.inkMuted },

  // the lens row
  lensRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, flexWrap: 'wrap' },
  lensLeft: { flexDirection: 'row', alignItems: 'center', gap: 20, flexWrap: 'wrap' },
  lenses: { flexDirection: 'row', alignItems: 'center', gap: 20, flexWrap: 'wrap' },
  lens: { paddingBottom: 3, borderBottomWidth: BORDER, borderBottomColor: 'transparent' },
  lensOn: { borderBottomColor: colors.selected },
  lensWord: { ...type.small, fontSize: 13.5, fontWeight: '500', color: colors.inkMuted },
  lensWordOn: { fontWeight: '700', color: colors.accent },

  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, flexWrap: 'wrap' },

  // the ring chooser
  chooser: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
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
  suggestBands: { flexDirection: 'row', gap: 6 },
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
