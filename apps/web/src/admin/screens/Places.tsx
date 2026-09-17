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
  type CompareColumn, type CompareRow, type RawSource, type PlaceHistoryRow, type FactDef } from '../../api';
import { AdminPage, ago, day, pounds } from '../kit';
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
  const [lens, setLens] = useQueryState<Lens>('lens', 'coverage', asOneOf(LENSES, 'coverage'));
  const [cat, setCat] = useQueryState<string>('cat', '', asText);
  const [sub, setSub] = useQueryState<string>('sub', '', asText);
  const [place, setPlace] = useQueryState<string>('place', '', asText);
  const [pictures, setPictures] = useQueryState<boolean>('pictures', false, asFlag);
  const [readyFor, setReadyFor] = useQueryState<string>('ready', '', asText);

  // `by` does double duty on purpose, exactly as the boards spell it: on a ring
  // it is how you are travelling, and on a level it is what the rows are. They
  // never appear together — a ring has no county breakdown — so one word in the
  // address covers both and neither is ever ambiguous.
  const ring = within != null;
  const mode = ring ? ((MODES as readonly string[]).includes(by) ? by : 'drive') : 'drive';
  const breakdownBy = !ring ? (((BY as readonly string[]).includes(by) ? by : 'county') as By) : 'county';

  if (pictures) return <PicturesBoard onClose={() => setPictures(false)} />;
  if (readyFor) return <ReadyBarBoard sub={readyFor} canManage={canManage} onClose={() => setReadyFor('')} />;
  if (place) return <PlaceBoard refId={place} canManage={canManage} onClose={() => setPlace('')} phone={phone} />;
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
  const [sort, setSort] = useState('known');
  const [desc, setDesc] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.adminCountries().then(setData).catch(() => setData({ countries: [], refreshedAt: null })); }, []);
  useEffect(load, [load]);

  const totals = useMemo(() => (data?.countries ?? []).reduce((acc, c) => ({
    known: acc.known + c.known, owned: acc.owned + c.owned, identified: acc.identified + c.identified,
    readyCount: acc.readyCount + c.readyCount, sum: acc.sum + (c.avgScore ?? 0) * c.known, n: acc.n + (c.avgScore == null ? 0 : c.known),
  }), { known: 0, owned: 0, identified: 0, readyCount: 0, sum: 0, n: 0 }), [data]);

  const rows = useMemo(() => {
    const list = [...(data?.countries ?? [])];
    const key: Record<string, (c: PlaceCountry) => number | string> = {
      name: (c) => c.name, known: (c) => c.known, owned: (c) => c.owned, identified: (c) => c.identified,
      ready: (c) => c.ready ?? -1, score: (c) => c.avgScore ?? -1, travel: (c) => c.built,
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
    { key: 'travel', label: 'Travel times', tip: 'travelTimes', width: 160, align: 'right', sort: 'travel', stops: true,
      cell: (c) => (c.travel === 'ready'
        ? <Word muted>{`Ready · ${c.cells.toLocaleString()} areas`}</Word>
        : c.known === 0 ? <Blank />
        : canManage
          ? <Act label="Work them out" small onPress={() => { setBusy(true); api.adminReindexPlaces(false).finally(() => { setBusy(false); load(); }); }} />
          : <Word muted>{c.travel === 'part' ? `${c.built.toLocaleString()} of ${c.cells.toLocaleString()}` : 'none'}</Word>) },
  ];

  return (
    <AdminPage>
      <Band kicker="EVERYWHERE EPIC HAS LOOKED" title="Select a country" stats={
        <Five stats={{
          known: totals.known, owned: totals.owned, identified: totals.identified,
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
        <Act label="Add a country" tone="secondary" disabled={!canManage} onPress={() => {}} />
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
  const [missing, setMissing] = useState<string | null>(null);

  const q = useMemo(() => ({ where, within: within ?? undefined, by: ring ? mode : undefined }), [where, within, ring, mode]);
  useEffect(() => { setLevel(null); api.adminPlaceArea(q).then(setLevel).catch(() => setLevel(null)); }, [q]);

  if (!level) return <AdminPage><Waiting /></AdminPage>;

  // BO2l — Places at 390. The one number you would check on a train is ready %,
  // so the phone draws its own board rather than a squeeze of the desk one.
  if (phone && lens === 'coverage' && !ring && level.areaKind !== 'country') {
    return <PlacesPhone level={level} q={q} lens={lens} onLens={props.onLens} onWhere={props.onWhere} onUp={props.onUp} />;
  }

  const body = (() => {
    if (lens === 'category' && sub) return <PlacesBoard q={q} cat={cat} sub={sub} onPlace={props.onPlace} onBar={props.onBar} canManage={props.canManage} missing={missing} onMissing={setMissing} />;
    if (lens === 'category') return <CategoryBoard q={q} cat={cat} onCat={props.onCat} onSub={props.onSub} canManage={props.canManage} />;
    if (lens === 'source') return <SourceBoard q={q} onSub={props.onSub} />;
    if (lens === 'quality') return <QualityBoard q={q} onPlace={props.onPlace} canManage={props.canManage} />;
    if (lens === 'demand') return <DemandLens q={q} canManage={props.canManage} onCollect={() => props.onLens('collect')} />;
    if (lens === 'collect') return <CollectBoard q={q} level={level} canManage={props.canManage} />;
    if (ring) return <RingBoard q={q} onSub={props.onSub} onLens={props.onLens} onWithin={props.onWithin} />;
    if (level.areaKind === 'country') return <BreakdownBoard q={q} by={props.breakdownBy} onBy={props.onBy} onWhere={props.onWhere} />;
    return <CoverageBoard q={q} onWhere={props.onWhere} onMissing={(f) => { setMissing(f); props.onLens('category'); }} />;
  })();

  return (
    <AdminPage>
      <Trail level={level} onUp={props.onUp} onWhere={props.onWhere} />
      <Band kicker={kickerOf(level)} title={level.name} stats={<Five stats={level.stats} ring={ring} />} />
      <LensRow lens={lens} onLens={props.onLens}
               right={ring
                 ? <RingChooser minutes={within ?? 30} mode={mode} onMinutes={props.onWithin} onMode={props.onBy} cells={level.cells} />
                 : <AreaSearch onWhere={props.onWhere} />} />
      {body}
    </AdminPage>
  );
}

const AREA_WORD: Record<string, string> = { country: 'COUNTRY', county: 'COUNTY', town: 'TOWN', postcode: 'POSTCODE DISTRICT' };

const kickerOf = (l: PlaceLevel) => {
  // A ring drawn round a town says TOWN, not POSTCODE: what it is drawn round is
  // a fact about the place, and the ring is how far out from it.
  if (l.kind === 'ring') return `${AREA_WORD[l.fromKind ?? 'postcode'] ?? 'POSTCODE'} · ${l.minutes} MINUTES BY ${MODE_LABEL[l.mode ?? 'drive'].toUpperCase()}`;
  return AREA_WORD[l.areaKind] ?? 'AREA';
};

/** The way back up, and what the level above holds. */
function Trail({ level, onUp, onWhere }: { level: PlaceLevel; onUp: () => void; onWhere: (slug: string) => void }) {
  if (!level.trail.length) return null;
  const last = level.trail[level.trail.length - 1];
  return (
    <View style={styles.trail}>
      <Press effect="none" onPress={() => (level.trail.length > 1 ? onWhere(last.slug) : onUp())}
             accessibilityRole="button" accessibilityLabel={`Back to ${last.label}`} style={styles.trailBack}>
        <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
        <Text style={styles.trailWord}>{last.label}</Text>
      </Press>
      <Text style={styles.trailNote}>{`· ${last.known.toLocaleString()} known · ${last.owned.toLocaleString()} owned`}</Text>
    </View>
  );
}

/** The band: a kicker, the name at 31px, the figures to the right, one rule under. */
function Band({ kicker, title, stats, right }: { kicker: string; title: string; stats?: React.ReactNode; right?: React.ReactNode }) {
  const { width } = useViewport();
  return (
    <View style={styles.band}>
      <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
        <Kicker>{kicker}</Kicker>
        <Text style={[styles.title, width < PHONE && styles.titlePhone]}>{title}</Text>
      </View>
      {stats}
      {right}
    </View>
  );
}

/** The five numbers every level prints. */
function Five({ stats, ring }: { stats: PlaceStats; ring?: boolean }) {
  return (
    <View style={styles.five}>
      <Stat label="Known" value={stats.known.toLocaleString()} tip="known" />
      <Stat label="Owned" value={stats.owned.toLocaleString()} tip="owned" />
      <Stat label="Identified only" value={stats.identified.toLocaleString()} tip="identifiedOnly" accent />
      <Stat label="Ready" value={stats.ready == null ? '—' : `${stats.ready}%`} tip={ring ? 'readyShort' : 'ready'} />
      <Stat label="Avg score" value={stats.avgScore == null ? '—' : stats.avgScore} tip="avgScore" />
    </View>
  );
}

/** CUT BY — the six lenses, the chosen one a flat lime word with a rule under it. */
function LensRow({ lens, onLens, right }: { lens: Lens; onLens: (l: Lens) => void; right?: React.ReactNode }) {
  return (
    <View style={styles.lensRow}>
      <View style={styles.lensLeft}>
        <Kicker>Cut by</Kicker>
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
function RingChooser({ minutes, mode, onMinutes, onMode, cells }: {
  minutes: number; mode: string; onMinutes: (m: number) => void; onMode: (m: string) => void; cells: number | null;
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
          {MODES.map((m) => (
            <Press key={m} effect="none" onPress={() => onMode(m)} accessibilityRole="button"
                   accessibilityState={{ selected: mode === m }} accessibilityLabel={MODE_LABEL[m]}
                   style={[styles.segItem, mode === m && styles.segItemOn]}>
              <Text style={[styles.segWord, mode === m && styles.segWordOn]}>{MODE_LABEL[m]}</Text>
            </Press>
          ))}
        </View>
      </View>
    </Explain>
  );
}

/** A county, a town or a postcode. A full postcode opens the ring chooser. */
function AreaSearch({ onWhere }: { onWhere: (slug: string, opts?: { within?: number | null; by?: string }) => void }) {
  const [q, setQ] = useState('');
  const [out, setOut] = useState<Awaited<ReturnType<typeof api.adminPlaceSearch>> | null>(null);
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
                  <Press key={b} effect="none" accessibilityRole="button" accessibilityLabel={`${out.postcode!.label} within ${bandLabel(b)}`}
                         onPress={() => { setQ(''); setOut(null); onWhere(out.postcode!.label.toLowerCase().replace(/\s+/g, '-'), { within: b, by: 'drive' }); }}
                         style={styles.suggestBand}>
                    <Text style={styles.segWord}>{bandLabel(b)}</Text>
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

function BreakdownBoard({ q, by, onBy, onWhere }: {
  q: any; by: By; onBy: (b: string) => void;
  onWhere: (slug: string, opts?: { within?: number | null; by?: string }) => void;
}) {
  const [data, setData] = useState<{ rows: PlaceAreaRow[]; totals: PlaceStats } | null>(null);
  const [sort, setSort] = useState('searches');
  const [desc, setDesc] = useState(true);
  useEffect(() => {
    setData(null);
    api.adminPlaceBreakdown({ ...q, by, sort, desc: desc ? undefined : '0' }).then(setData).catch(() => setData({ rows: [], totals: { known: 0, owned: 0, identified: 0, readyCount: 0, ready: null, avgScore: null } }));
  }, [q, by, sort, desc]);

  const columns: Col<PlaceAreaRow>[] = [
    { key: 'name', label: BY_LABEL[by], tip: by === 'county' ? 'county' : by === 'city' ? 'cityOrTown' : 'whereRow',
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

  const worst = data?.rows[0] ?? null;
  return (
    <>
      <View style={styles.subRow}>
        <Kicker>Break it down by</Kicker>
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
        {worst ? <Act label={`Collect in ${worst.name}`} icon="download" onPress={() => onWhere(worst.slug, {})} /> : null}
      </Footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// BO2b — a county's coverage: towns and outcodes together
// ---------------------------------------------------------------------------

function CoverageBoard({ q, onWhere, onMissing }: {
  q: any; onWhere: (slug: string) => void; onMissing: (fact: string) => void;
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
          <Kicker>Where</Kicker>
          {data ? <Text style={styles.rowNote}>{`${data.towns} of ${data.allTowns || data.towns} towns · ${data.outcodes} outcodes`}</Text> : null}
        </View>
        <View style={{ flex: 1 }} />
        <Act label={`Refresh the counts${data?.refreshedAt ? ` · ${ago(data.refreshedAt)}` : ''}`} tone="secondary" disabled={refreshing}
             onPress={() => { setRefreshing(true); api.adminRefreshPlaceCounts().finally(() => { setRefreshing(false); load(); }); }} />
      </View>
      {data ? (
        <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.slug} onRow={(r) => onWhere(r.slug)}
                empty={<Word muted>Nothing indexed under this county yet.</Word>} />
      ) : <Waiting />}
      <Footer>
        <Act label="Collect here" icon="download" onPress={() => onMissing('picture')} />
      </Footer>
    </>
  );
}

// ---------------------------------------------------------------------------
// BO2c / BO2o / BO2p — the category ladder, driven by the taxonomy
// ---------------------------------------------------------------------------

function CategoryBoard({ q, cat, onCat, onSub, canManage }: {
  q: any; cat: string; onCat: (c: string) => void; onSub: (s: string) => void; canManage: boolean;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceCategories>> | null>(null);
  const [hideFull, setHideFull] = useState(false);
  useEffect(() => { setData(null); api.adminPlaceCategories({ ...q, cat: cat || undefined }).then(setData).catch(() => setData(null)); }, [q, cat]);

  // The words the boards use: "a picture, what it is, opening hours".
  const factLabel = useMemo(() => new Map(Object.entries(NEEDS_WORD)), [data]);

  // One category open: its subcategories, every one of them, the empty ones
  // included — "an empty subcategory is the finding" (BO2p).
  if (cat) {
    const c = data?.categories.find((x) => x.key === cat) ?? null;
    return (
      <>
        {data && c ? <SubcategoryLadder rows={c.subcategories} onSub={onSub} factLabel={factLabel} canManage={canManage} inRing={q.within != null} /> : <Waiting />}
        <Footer left={<Press effect="none" onPress={() => onCat('')} accessibilityRole="button" accessibilityLabel="Back to every category">
          <Text style={styles.trailWord}>← Every category</Text>
        </Press>}>
          {c ? <Act label={`Collect ${c.label.toLowerCase()} places here`} icon="download" onPress={() => {}} disabled={!canManage} /> : null}
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
    { key: 'label', label: 'Our category', tip: 'ourCategory', grow: true,
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
        : <Act label="Collect" small tone="secondary" disabled={!canManage} onPress={() => {}} />) },
  ];

  return (
    <>
      {!ring ? (
        <View style={styles.subRow}>
          <View style={{ flex: 1 }} />
          <Act label={hideFull ? `Show me all ${flat.length}` : `Hide the ones with places · ${withPlaces}`}
               tone="secondary" onPress={() => setHideFull(!hideFull)} />
        </View>
      ) : null}
      {!data ? <Waiting /> : ring ? (
        <Ladder columns={catColumns} rows={all} keyOf={(c) => c.key} onRow={(c) => onCat(c.key)}
                highlight={(c) => c.searches > 0 && c.empty / Math.max(1, c.searches) > 0.2} />
      ) : (
        <SubcategoryLadder rows={shown} onSub={onSub} factLabel={factLabel} canManage={canManage} inRing={false}
                           groupLabel={(s) => {
                             const c = all.find((x) => x.key === s.category);
                             return c ? `${c.label.toUpperCase()} · ${c.subcategories.length} SUBCATEGORIES` : null;
                           }} />
      )}
      <Footer>
        <Act label="Collect here" icon="download" disabled={!canManage} onPress={() => {}} />
      </Footer>
    </>
  );
}

function SubcategoryLadder({ rows, onSub, factLabel, canManage, inRing, groupLabel }: {
  rows: (PlaceCategory['subcategories'][number] & { categoryLabel?: string })[];
  onSub: (s: string) => void; factLabel: Map<string, string>; canManage: boolean; inRing: boolean;
  groupLabel?: (s: any) => string | null;
}) {
  const columns: Col<any>[] = [
    { key: 'label', label: 'Our subcategory', tip: 'ourSubcategory', grow: true,
      cell: (s) => <Text style={[styles.rowName, s.known === 0 && styles.rowNameEmpty]}>{s.label}</Text> },
    { key: 'known', label: 'Known', tip: 'known', width: 96, align: 'right', cell: (s) => <Num n={s.known || null} /> },
    { key: 'owned', label: 'Owned', tip: 'owned', width: 88, align: 'right', cell: (s) => <Num n={s.owned || null} /> },
    ...(inRing ? [{ key: 'ident', label: 'Identified only', tip: 'identifiedOnly', width: 140, align: 'right', cell: (s: any) => <Num n={s.identified || null} /> } as Col<any>] : []),
    { key: 'ready', label: 'Ready', tip: inRing ? 'readyShort' : 'ready', width: 96, align: 'right', cell: (s) => <Pct v={s.ready} min={48} /> },
    { key: 'score', label: 'Avg score', tip: 'avgScoreSubcategory', width: 104, align: 'right', cell: (s) => <Num n={s.avgScore} /> },
    ...(inRing
      ? ([
          { key: 'searches', label: 'Searches', tip: 'searchesRing', width: 104, align: 'right', cell: (s: any) => <Num n={s.searches || null} /> },
          { key: 'empty', label: 'Came back empty', tip: 'empty', width: 134, align: 'right',
            cell: (s: any) => <Num n={s.empty || null} strong={s.empty > 0} accent={s.searches > 0 && s.empty === s.searches} /> },
        ] as Col<any>[])
      : ([
          { key: 'needs', label: 'What it needs', tip: 'whatItNeeds', width: 300, align: 'left', stops: true,
            cell: (s: any) => (s.known === 0
              ? <Act label="Go and find some" icon="download" small disabled={!canManage} onPress={() => {}} />
              : s.barSet
                ? <Text style={styles.needs}>{s.needs.map((f: string) => factLabel.get(f) ?? f).join(', ')}</Text>
                : <Word muted>not set</Word>) },
        ] as Col<any>[])),
    ...(inRing ? ([{ key: 'go', label: '', width: 78, align: 'right', stops: true,
      cell: (s: any) => (s.known > 0
        ? <Icon name="more" size={15} strokeWidth={2} color={colors.inkMuted} />
        : <Act label="Collect" small tone="secondary" disabled={!canManage} onPress={() => {}} />) }] as Col<any>[]) : []),
  ];
  return (
    <Ladder columns={columns} rows={rows} keyOf={(s) => s.key}
            onRow={(s) => (s.known > 0 ? onSub(s.key) : undefined)}
            highlight={(s) => s.known === 0}
            groupOf={groupLabel
              ? (s, prev) => (!prev || prev.category !== s.category ? <Text style={styles.group}>{groupLabel(s)}</Text> : null)
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
    { key: 'label', label: 'Our subcategory', tip: 'ourSubcategory', grow: true, cell: (r) => <Text style={styles.rowName}>{r.label}</Text> },
    ...data.sources.map((s): Col<PlaceSourceRow> => ({
      key: s.key, label: s.label, tip: tipForSource(s.key), width: s.key === 'tripadvisor' ? 112 : 100, align: 'right',
      // A source never asked reads "not asked", never as nothing. The two are
      // different facts and the screen has to keep them apart.
      cell: (r) => (r.counts[s.key] == null ? <NotAsked /> : <Num n={r.counts[s.key] || null} />),
      cellTip: (r) => (r.counts[s.key] == null ? 'notAsked' : tipForSource(s.key)),
    })),
    { key: 'one', label: 'One source only', tip: 'oneSourceOnly', width: 132, align: 'right',
      cell: (r) => <Num n={r.oneOnly || null} strong accent={r.oneOnly > 0} /> },
    { key: 'googleOnly', label: 'Google only', tip: 'googleOnlyNoName', width: 132, align: 'right',
      cell: (r) => <Num n={r.googleOnly || null} /> },
  ];
  return (
    <>
      <View style={styles.subRow}>
        <Kicker>{`Our subcategory · ${data.rows.length} of ${data.rows.length} · most held first`}</Kicker>
      </View>
      <Ladder columns={columns} rows={data.rows} keyOf={(r) => r.key} onRow={(r) => onSub(r.key)}
              empty={<Word muted>Nothing indexed here yet.</Word>} />
    </>
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
  const { width } = useViewport();
  useEffect(() => { setData(null); setPicked(new Set()); api.adminPlaceQuality(q).then(setData).catch(() => setData(null)); }, [q]);
  if (!data) return <Waiting />;

  const most = Math.max(1, ...data.bands.map((b) => b.n));
  const columns: Col<PlaceQuality['worth'][number]>[] = [
    { key: 'tick', label: '', width: 26, align: 'left', stops: true,
      cell: (r) => <Box on={picked.has(r.ref)} onPress={() => setPicked(toggle(picked, r.ref))} label={r.name ?? r.ref} /> },
    { key: 'name', label: 'Place', tip: 'placeWorth', grow: true,
      cell: (r) => (
        <View style={styles.nameCell}>
          <Text style={[styles.rowName, !r.name && styles.refName]}>{r.name ?? r.ref}</Text>
          <Text style={styles.rowNote}>{[r.subcategory, r.outcode, sourcesSentence(r.sources)].filter(Boolean).join(' · ')}</Text>
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
          <Kicker>Data score</Kicker>
          <View style={{ gap: 7, marginTop: 9 }}>
            {data.bands.map((b) => (
              <Explain key={b.band} tip="dataScoreBand" style={styles.barRow}>
                <Text style={styles.barLabel}>{b.band}</Text>
                <View style={styles.barTrack}>
                  <View style={{ width: `${Math.round((b.n / most) * 100)}%`, height: 18, backgroundColor: colors.selected }} />
                </View>
                <Text style={styles.barN}>{b.n.toLocaleString()}</Text>
              </Explain>
            ))}
          </View>
          <View style={{ height: spacing.lg }} />
          <Kicker>Oldest fact</Kicker>
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
          <Kicker>Worth owning next</Kicker>
          <View style={{ height: 9 }} />
          <Ladder columns={columns} rows={data.worth} keyOf={(r) => r.ref}
                  empty={<Word muted>Everything here is already owned.</Word>} />
        </View>
      </View>
      <Footer left={picked.size ? <Text style={styles.selected}>{`${picked.size} selected`}</Text> : null}>
        <Act label={picked.size ? `Curate these ${picked.size} · free` : 'Curate them · free'} tone="secondary"
             disabled={!canManage || !picked.size} onPress={() => {}} />
        {/* A button that spends says what it costs, and one with nothing chosen
            does not claim a price it cannot know. */}
        <Act label={picked.size ? `Ask Google about these ${picked.size} · ${pounds(Math.ceil(picked.size * 1.4))}` : 'Ask Google about them'}
             disabled={!canManage || !picked.size} onPress={() => {}} />
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
    { key: 'known', label: 'We know of', tip: 'weKnowOf', width: 100, align: 'right', cell: (r) => <Num n={r.known ?? null} /> },
    { key: 'fault', label: 'Fault', tip: 'fault', width: 190, align: 'left', stops: true,
      cell: (r) => (r.act === 'collect'
        ? <Act label="Collect here" icon="download" small tone={r.fault === 'empty-always' ? 'primary' : 'secondary'}
               disabled={!canManage} onPress={onCollect} />
        : <Word>{r.shortFault}</Word>) },
  ];

  return (
    <>
      <View style={styles.subRow}>
        <View style={styles.five}>
          <Stat label="Searches" value={data.totals.searches.toLocaleString()} tip="searches" />
          <Stat label="Came back empty" value={data.totals.empty.toLocaleString()} tip="emptyTotal" accent />
          <Stat label="Clicked nothing" value={data.totals.noClick.toLocaleString()} tip="noClick" />
          <Stat label="Never tripped" value={data.totals.noTrip.toLocaleString()} tip="neverTripped" />
        </View>
      </View>
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
        <Kicker>This ring</Kicker>
        <View style={styles.ringRow}>
          <RingFact label="Nearest postcode area" tip="nearestPostcodeArea" value={f.cellLabel ?? '—'} />
          <RingFact label="Postcode areas in reach" tip="postcodeAreasInReach" value={`${f.cellsInReach.toLocaleString()} of ${f.cellsTotal.toLocaleString()}`} />
          <RingFact label="Rows read" tip="rowsRead" value={String(f.rowsRead)} />
          <RingFact label="Distances computed" tip="distancesComputed" value={f.distancesComputed ? String(f.distancesComputed) : 'none'} />
          <RingFact label="Travel times worked out" tip="travelTimesWorkedOut" value={f.builtAt ? day(f.builtAt) : 'not yet'} />
          <RingFact label="Provider spend" tip="providerSpend" value={pounds(f.spendPence)} />
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

const SHOW = ['not-ready', 'ready', 'all'] as const;
const SHOW_LABEL: Record<string, string> = { 'not-ready': 'Not ready', ready: 'Ready', all: 'All' };

function PlacesBoard({ q, cat, sub, onPlace, onBar, canManage, missing, onMissing }: {
  q: any; cat: string; sub: string; onPlace: (ref: string) => void; onBar: (s: string) => void;
  canManage: boolean; missing: string | null; onMissing: (f: string | null) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceList>> | null>(null);
  const [show, setShow] = useState<string>('not-ready');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('missing');
  const [desc, setDesc] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    setData(null);
    api.adminPlaceList({ ...q, cat: cat || undefined, sub, show, q: query || undefined, missing: missing || undefined, sort, desc: desc ? undefined : '0' })
      .then(setData).catch(() => setData(null));
  }, [q, cat, sub, show, query, missing, sort, desc]);

  const counted = data?.counted ?? [];
  const facts: FactDef[] = data?.facts ?? [];
  const nameless = data?.rows.filter((r) => !r.name && picked.has(r.ref)).length ?? 0;

  const columns: Col<PlaceRow>[] = [
    { key: 'tick', label: '', width: 26, align: 'left', stops: true,
      cell: (r) => <Box on={picked.has(r.ref)} onPress={() => setPicked(toggle(picked, r.ref))} label={r.name ?? r.ref} /> },
    { key: 'name', label: 'Place', tip: 'placeRow', grow: true,
      // A nameless row is the finding: Google is the only source that has ever
      // seen this place, so there is no name we are allowed to hold.
      cell: (r) => <Text style={[styles.rowName, !r.name && styles.refName]} numberOfLines={1}>{r.name ?? r.ref}</Text> },
    { key: 'unseen', label: 'Unseen by', tip: 'unseenBy', width: 104, align: 'left', sort: 'unseen',
      cell: (r) => (r.unseenBy.length === 0 ? <Blank />
        : r.unseenBy.length === 1 ? <Word muted>{sourceWord(r.unseenBy[0])}</Word>
        : <Text style={styles.dotted}>{r.unseenBy.length}</Text>),
      cellTip: (r) => (r.unseenBy.length > 1
        ? [`Unseen by ${r.unseenBy.length} sources`, `${listWords(r.unseenBy.map(sourceWord))} have never returned it.`] as const
        : 'unseenBy') },
    { key: 'where', label: 'Where', tip: 'wherePlace', width: 74, align: 'left', cell: (r) => <Word muted>{r.outcode ?? '—'}</Word> },
    { key: 'score', label: 'Score', tip: barTip(data?.bar ?? [], facts), width: 74, align: 'right', sort: 'score',
      cell: (r) => (r.barSet ? <ScoreCell v={r.score} strong /> : <Word muted>not set</Word>) },
    ...facts.map((f): Col<PlaceRow> => ({
      key: f.key, label: f.short, tip: [f.label, f.explain] as const, width: 76, align: 'centre',
      cell: (r) => (r.facts[f.key] === 'n/a' ? <Na /> : <Tick on={r.facts[f.key] !== 'no'} />),
      cellTip: (r) => (r.facts[f.key] === 'n/a' ? 'notCounted' : [f.label, f.explain] as const),
    })),
    { key: 'missing', label: 'Missing', tip: missingTip(data?.bar ?? [], facts), width: 84, align: 'right', sort: 'missing',
      cell: (r) => <Num n={r.missing || null} strong /> },
    { key: 'go', label: '', width: 28, align: 'right', cell: () => <Icon name="more" size={15} strokeWidth={2} color={colors.inkMuted} /> },
  ];

  const notReady = data?.rows.filter((r) => !r.ready).length ?? 0;
  return (
    <>
      <View style={styles.subRow}>
        <View style={styles.lensLeft}>
          <Kicker>Show</Kicker>
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
            <Press effect="none" onPress={() => onMissing(null)} accessibilityRole="button" accessibilityLabel="Stop filtering by what is missing">
              <Text style={styles.chipOff}>{`missing ${facts.find((f) => f.key === missing)?.short.toLowerCase() ?? missing} ✕`}</Text>
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
            <Text style={styles.rowNote}>{`${data.rows.length} of ${data.stats.known.toLocaleString()}${show === 'not-ready' ? ' not ready' : ''}`}</Text>
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
        <Act label={picked.size ? `Curate these ${picked.size} · free` : 'Curate them · free'} tone="secondary"
             disabled={!canManage || !picked.size} onPress={() => {}} />
        {/* Fetching a name is the one thing on this board that spends, and the
            button says what it costs before it is pressed. Only the rows we hold
            no name for cost anything: the rest are already ours to print. */}
        <Act label={nameless ? `Fetch the ${nameless} name${nameless === 1 ? '' : 's'} · ${pounds(Math.ceil(nameless * 1.4))}`
                             : picked.size ? 'Nothing to fetch · we hold every name' : 'Fetch the names'}
             disabled={!canManage || !nameless} onPress={() => {}} />
      </Footer>
    </>
  );
}

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

function CollectBoard({ q, level, canManage }: { q: any; level: PlaceLevel; canManage: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceSources>> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(['osm', 'atlas', 'own']));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setData(null); api.adminPlaceSources(q).then(setData).catch(() => setData(null)); }, [q]);
  if (!data) return <Waiting />;

  const known = level.stats.known;
  const identified = level.stats.identified;
  const rows = data.sources.map((s) => {
    const held = data.rows.reduce((n, r) => n + (r.counts[s.key] ?? 0), 0);
    return {
      ...s,
      held,
      // The staleness rule, said on the row: a place is not asked again inside
      // twelve months unless something about it has changed.
      would: s.key === 'google' ? identified : Math.max(0, known - held),
      pence: s.paid ? (s.key === 'google' ? 1.4 : 0) : 0,
    };
  });
  const chosen = rows.filter((r) => picked.has(r.key));
  const cost = chosen.reduce((n, r) => n + r.would * r.pence, 0);

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
      width: 140, align: 'right', cell: (r) => (r.asked ? <Word muted>somewhere</Word> : <NotAsked />),
      cellTip: (r) => (r.asked ? null : 'notAsked') },
    { key: 'held', label: 'Already held', tip: 'known', width: 130, align: 'right', cell: (r) => <Num n={r.held || null} /> },
    { key: 'would', label: 'Would ask about', tip: ['Would ask about', `How many places here this source has not been asked about, after the ${STALE_MONTHS}-month rule.`] as const,
      width: 150, align: 'right', cell: (r) => <Num n={r.would || null} strong /> },
    { key: 'cost', label: 'What it would cost', tip: 'providerSpend', width: 160, align: 'right',
      cell: (r) => (r.paid ? <Word>{pounds(Math.round(r.would * r.pence))}</Word> : <Word muted>free</Word>) },
  ];

  return (
    <>
      <View style={styles.subRow}><Kicker>What we could get here</Kicker></View>
      <Ladder columns={columns} rows={rows} keyOf={(r) => r.key} />
      <Footer left={<Text style={styles.selected}>{`${chosen.length} source${chosen.length === 1 ? '' : 's'} · ${pounds(Math.round(cost))}`}</Text>}>
        <Act label="Work out the scores again · free" tone="secondary" disabled={!canManage || busy}
             onPress={() => { setBusy(true); api.adminRescorePlaces().finally(() => setBusy(false)); }} />
        {/* One action, not a row per provider. */}
        <Act label={`Ask them all · ${cost ? pounds(Math.round(cost)) : 'free'}`} icon="download"
             disabled={!canManage || busy || !chosen.length}
             onPress={() => { setBusy(true); api.adminReindexPlaces(false).finally(() => setBusy(false)); }} />
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

function PlaceBoard({ refId, canManage, onClose, phone }: { refId: string; canManage: boolean; onClose: () => void; phone: boolean }) {
  const [tab, setTab] = useQueryState<PlaceTab>('tab', 'record', asOneOf(PLACE_TABS, 'record'));
  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
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
          <View style={styles.five}>
            <Stat label="Score" value={place.score ?? '—'} tip="scoreNow" />
            <Stat label="Have · missing" value={`${place.have} · ${place.missingCount}`}
                  tip={['Have · missing', `Counts only the ${place.have + place.missingCount} facts this kind of place is judged on. Everything else is recorded when we have it and never counts against the score.`]} />
            <Stat label="Unseen by" value={place.unseen.length} tip="unseenByPlace" accent />
            <Stat label="Pictures" value={place.pictures.filter((p) => p.owned).length} tip="pictures" />
            <Stat label="Oldest fact" value={place.oldestFact ? ago(place.oldestFact) : 'never'} tip="oldestFactStalest" />
          </View>
        )
      } />

      <View style={styles.lensRow}>
        <View style={styles.lensLeft}>
          <Kicker>Looking at</Kicker>
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
          <Act label="Curate it · free" tone="secondary" disabled={!canManage} onPress={() => {}} />
          <Act label="Compare all three · £0.014" disabled={!canManage} onPress={() => setTab('compare')} />
        </View>
      </View>

      {tab === 'record' ? <RecordTab place={place} canManage={canManage} onSaved={load} /> : null}
      {tab === 'compare' ? <CompareTab refId={refId} /> : null}
      {tab === 'score' ? <ScoreTab refId={refId} canManage={canManage} /> : null}
      {tab === 'pictures' ? <PlacePicturesTab place={place} canManage={canManage} /> : null}
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
  const { width } = useViewport();

  useEffect(() => { api.adminPlaceReach(place.ref).then(setReach).catch(() => setReach(null)); }, [place.ref]);

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
                    ? <Na tip="notRequired" />
                    : <Blank />}
              </View>
              <Text style={[styles.fieldMeta, { width: 84 }]}>{f.source ?? '—'}</Text>
              <Text style={[styles.fieldMeta, { width: 92 }]}>{f.checked ? day(f.checked) : f.value ? '—' : 'never'}</Text>
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
                  <Act label={f.action === 'write' ? 'Write' : f.action === 'find' ? 'Find' : f.action === 'read' ? 'Read' : 'Ask'}
                       small tone="secondary" onPress={() => { setEditing(f.key); setDraft(''); }} />
                ) : null}
              </View>
              <Press effect="none" onPress={() => setOpen(open === f.key ? null : f.key)} hitSlop={8}
                     accessibilityRole="button" accessibilityLabel={`Open ${f.label}`} style={{ width: 26, alignItems: 'flex-end' }}>
                <Icon name={open === f.key ? 'collapse' : 'expand'} size={15} strokeWidth={2} color={colors.inkMuted} />
              </Press>
            </View>
            {open === f.key ? (
              <View style={styles.expand}>
                <Detail label="Reference" value={f.source ? `${f.source}${f.checked ? ` · ${day(f.checked)}` : ''}` : 'we hold none'} />
                <Detail label="Raw value" value={f.value ? `"${f.value}"` : '—'} />
                <Detail label="Counts towards ready" value={f.counted == null ? '—' : f.counted ? 'yes' : 'no, recorded only'} />
                {f.note ? <Detail label="Note" value={f.note} /> : null}
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
        <Kicker>{`Pictures · ${place.pictures.filter((p) => p.owned).length} owned`}</Kicker>
        <View style={styles.thumbs}>
          {place.pictures.length === 0 ? <Word muted>None yet.</Word> : place.pictures.slice(0, 6).map((p, i) => (
            // A picture can be linked to the place and to its atlas row at once,
            // so the position is part of the key.
            <Explain key={`${p.id}-${i}`} tip={p.owned ? null : 'rented'} style={[styles.thumb, !p.owned && { opacity: 0.5 }]}>
              <View style={styles.thumbImage} />
              <Text style={styles.thumbNote}>{p.owned ? (p.source ?? 'ours') : 'rented'}</Text>
            </Explain>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Act label="Look on Commons · free" small tone="secondary" disabled={!canManage} onPress={() => {}} />
          <Act label="Ask a household" small tone="secondary" disabled={!canManage} onPress={() => {}} />
        </View>

        <View style={{ height: spacing.lg }} />
        <Kicker>Not checked</Kicker>
        <Explain tip={['Free sources', `${place.unseenFree} source${place.unseenFree === 1 ? '' : 's'} have never been asked about this place and cost nothing to ask.`]}
                 style={styles.notChecked}>
          <Text style={styles.notCheckedBig}>{place.unseenFree}</Text>
          <Text style={styles.notCheckedWord}>free sources</Text>
          <View style={{ flex: 1 }} />
          <Act label="Run them" small tone="secondary" disabled={!canManage || !place.unseenFree} onPress={() => {}} />
        </Explain>
        <Explain tip={['Paid sources', `${place.unseenPaid} source${place.unseenPaid === 1 ? '' : 's'} have never been asked and would spend. Google is £0.014 a place; Tripadvisor comes out of this month's allowance.`]}
                 style={[styles.notChecked, { borderBottomWidth: 0 }]}>
          <Text style={styles.notCheckedBig}>{place.unseenPaid}</Text>
          <Text style={styles.notCheckedWord}>paid sources</Text>
          <View style={{ flex: 1 }} />
          <Act label="£0.014 · ask" small tone="secondary" disabled={!canManage || !place.unseenPaid} onPress={() => {}} />
        </Explain>

        <View style={{ height: spacing.lg }} />
        <Kicker>This place in other systems</Kicker>
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
function CompareTab({ refId }: { refId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminPlaceCompare>> | null>(null);
  const [match, setMatch] = useState(false);
  useEffect(() => { setData(null); api.adminPlaceCompare(refId, match).then(setData).catch(() => setData(null)); }, [refId, match]);
  if (!data) return <Waiting />;

  const say = (v: unknown): string => {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? (x as any).label ?? (x as any).key ?? JSON.stringify(x) : String(x))).join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
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
          <Text style={[styles.fieldName, { width: 180 }]}>{fieldWord(r.key)}</Text>
          {data.columns.map((c) => {
            const has = Boolean(r.keys[c.key]);
            const v = say(r.cells[c.key]);
            return (
              <View key={c.key} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {!has && c.note ? <Explain tip="notAsked"><Word muted>{c.note}</Word></Explain>
                  : v ? <Text style={styles.fieldValue} numberOfLines={2}>{v}</Text>
                  : <Blank />}
                {c.key === 'ours' && v && data.ours.includes(r.key) ? (
                  <Explain tip="editableColumn"><Text style={styles.editWord}>Edit</Text></Explain>
                ) : null}
              </View>
            );
          })}
          <Text style={[styles.fieldMeta, { width: 160 }]}>{data.columns[0].note ?? (r.keys.ours ? 'ours' : 'we hold none')}</Text>
        </View>
      ))}
      <Footer left={<Text style={styles.rowNote}>{data.columns.map((c) => `${c.label}: ${c.filled ?? 0} of ${c.of ?? 0}`).join('  ·  ')}</Text>}>
        {!match ? <Act label="Match it by name and distance · £0.014" onPress={() => setMatch(true)} /> : null}
      </Footer>
    </>
  );
}

const fieldWord = (k: string) => k.replace(/_/g, ' ').replace(/^ta /, 'Tripadvisor ').replace(/^./, (c) => c.toUpperCase());

/** BO2i — how it scored, and what that is worth. */
function ScoreTab({ refId, canManage }: { refId: string; canManage: boolean }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.adminScore>> | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setData(null); api.adminScore(refId).then(setData).catch(() => setData(null)); }, [refId]);
  useEffect(load, [load]);
  const { width } = useViewport();
  if (!data) return <View><Waiting /><Word muted>Nothing has been scored for this place yet — it has not been swept or claimed.</Word></View>;

  const out = Math.round(data.epicScore * 10);
  const owned = Math.round(data.ownedScore * 10);
  const weights = data.weights ?? {};

  return (
    <>
      <View style={styles.subRow}>
        <View style={styles.five}>
          <Stat label="Our score" value={out} tip="ourScore" accent big />
          <Stat label="Without the licensed bit" value={owned} tip="withoutTheLicensedBit" big />
        </View>
        <View style={{ flex: 1 }} />
        <Act label="Work it out again · 1 Google call, £0.014" disabled={!canManage || busy}
             onPress={() => { setBusy(true); load(); setBusy(false); }} />
      </View>
      <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Kicker>Inputs</Kicker>
          <View style={{ height: 9 }} />
          <View style={styles.recordHead}>
            <Explain tip="input" style={{ flex: 1 }}><Text style={styles.headLabelSmall}>Input</Text></Explain>
            <Explain tip="whatItGaveUs" style={{ width: 150 }}><Text style={styles.headLabelSmall}>What it gave us</Text></Explain>
            <Explain tip="worth" style={{ width: 130 }}><Text style={[styles.headLabelSmall, { textAlign: 'right' }]}>{`Worth · adds to ${out}`}</Text></Explain>
            <Explain tip="ownedInput" style={{ width: 150 }}><Text style={[styles.headLabelSmall, { textAlign: 'right' }]}>Owned</Text></Explain>
          </View>
          {data.parts.map((p) => {
            const keep = p.key !== 'crowd';
            return (
              <View key={p.key} style={styles.recordRow}>
                <Text style={[styles.fieldValue, { flex: 1 }]}>{p.label}</Text>
                <View style={{ width: 150 }}>
                  {p.note ? <Word muted>{p.note}</Word> : <Text style={styles.fieldStrong}>{sayPoints(p.points)}</Text>}
                </View>
                <View style={{ width: 130, alignItems: 'flex-end' }}>
                  {p.intoEpic ? <Num n={Math.round(p.intoEpic * 10)} /> : <Blank />}
                </View>
                <View style={{ width: 150, alignItems: 'flex-end' }}>
                  <Text style={[styles.fieldMeta, keep && { color: colors.accent, fontWeight: '700' }]}>
                    {keep ? 'yes, ours' : 'no'}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
        <View style={[styles.side, { width: 400 }, width < 1100 && { width: '100%', borderLeftWidth: 0, paddingLeft: 0 }]}>
          <Kicker>Weights</Kicker>
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

const sayPoints = (p: number | null) => (p == null ? '—' : String(Math.round(p * 100) / 100));
const weightRows = (w: any) => {
  const out: { label: string; value: string; tip: any }[] = [];
  for (const [band, n] of Object.entries(w.crowd ?? {})) out.push({ label: `What the crowd said · ${band}`, value: String(n), tip: 'weight' });
  for (const [band, n] of Object.entries(w.count ?? {})) out.push({ label: `How many said it · ${band}`, value: String(n), tip: 'weight' });
  if (w.accoladeStack) out.push({ label: 'Accolades stack at', value: String(w.accoladeStack), tip: 'weight' });
  if (w.prior) out.push({ label: 'Starting assumption', value: String(w.prior), tip: 'weightAssumption' });
  if (w.priorWeight) out.push({ label: 'What that assumption counts for', value: String(w.priorWeight), tip: 'weightAssumptionCounts' });
  if (w.composite) out.push({ label: 'The three-way split', value: Object.values(w.composite).join(' / '), tip: 'weightSplit' });
  return out;
};

/** The pictures on one place, with every licence field. */
function PlacePicturesTab({ place, canManage }: { place: PlaceDetail; canManage: boolean }) {
  const [sel, setSel] = useState(0);
  const { width } = useViewport();
  const owned = place.pictures;
  if (!owned.length) {
    return (
      <View style={{ gap: spacing.md }}>
        <Word muted>No picture we own.</Word>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Act label="Look on Commons · free" tone="secondary" disabled={!canManage} onPress={() => {}} />
          <Act label="Ask a household" tone="secondary" disabled={!canManage} onPress={() => {}} />
        </View>
      </View>
    );
  }
  const p = owned[Math.min(sel, owned.length - 1)];
  return (
    <View style={[styles.split, width < 1100 && { flexDirection: 'column' }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Kicker>{`${owned.length} picture${owned.length === 1 ? '' : 's'}`}</Kicker>
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
  const [q, setQ] = useState('');
  const [facet, setFacet] = useState('');
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
            <Kicker>{`${data.pictures.length.toLocaleString()} pictures`}</Kicker>
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
            <Kicker>The one selected</Kicker>
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

function ReadyBarBoard({ sub, canManage, onClose }: { sub: string; canManage: boolean; onClose: () => void }) {
  const [data, setData] = useState<ReadyBars | null>(null);
  const [pick, setPick] = useState(sub);
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
          <Kicker>{`${data.subcategories.length} subcategories`}</Kicker>
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
          <Kicker>{`A ${singular(row?.label ?? pick)} is ready when it has · ${(row?.places ?? 0).toLocaleString()} in Britain`}</Kicker>
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
            <Kicker>If saved</Kicker>
            <View style={styles.effectRow}>
              <EffectFact label="Ready now" tip="readyNow" big={effect?.shareNow == null ? '—' : `${effect.shareNow}%`} small={effect ? effect.readyNow.toLocaleString() : ''} />
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
        <Kicker>{kickerOf(level)}</Kicker>
        <Text style={styles.titlePhone}>{level.name}</Text>
      </View>

      <View style={styles.phoneGrid}>
        <Stat label="Known" value={level.stats.known.toLocaleString()} tip="known" />
        <Stat label="Owned" value={level.stats.owned.toLocaleString()} tip="owned" />
        <Stat label="Identified only" value={level.stats.identified.toLocaleString()} tip="identifiedOnly" accent />
        <Stat label="Ready" value={level.stats.ready == null ? '—' : `${level.stats.ready}%`} tip="ready" />
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
  group: { ...type.tiny, fontSize: 11, fontWeight: '700', letterSpacing: 0.99, textTransform: 'uppercase', color: colors.inkMuted, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
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
  phoneGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md, columnGap: spacing.xl },
  phoneRow: { gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  chipWord: { ...type.tiny, fontSize: 11.5, color: colors.ink },
});
