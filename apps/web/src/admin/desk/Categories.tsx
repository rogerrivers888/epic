/**
 * Categories (back-office handover, 28 Sep 2026; design README v2
 * "Categories" and "Location filter").
 *
 * Four layers, each with its own address:
 *   - the subcategory list (`?tab=categories`, `q`, `cat`), with the bulk bar
 *     and the related-subcategory adder;
 *   - New facts (`view=new`), the header count's drill;
 *   - a subcategory's page (`sub`): its defaults, then its facts;
 *   - one fact at that subcategory (`sub` + `fact`): the places that have it.
 *
 * Humans decide here; nothing starts a job. Every write is logged in Changes
 * by the API and the toast offers its Undo.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { useCrumbs, useDeskGo, useDeskParam } from './Desk';
import {
  AMBER, Dropdown, LIME, LocationFilter, Muted, ON_LIME, RED, SearchBox, SideToggle, THead, Table, TextLink, Tick, deskApi, desk, fonts,
  locParams, n, onSide, saidOf, sortRows, tabular, useLocation, useSide, useToast, type SortState, type TCol,
} from './kit';
import { Count, FACT_ORDER, Failed, HowTip, PillBar, count, factName, undoChanges, type Change, type Option } from './categories/shared';
import { HoverTitle } from './facts/shared';
import { SubPage } from './categories/SubPage';
import { Review } from './categories/Review';
import { FactAtSub } from './categories/FactAtSub';
import { NewFacts } from './categories/NewFacts';

type Related = { key: string; label: string; why: 'linked' | 'shared' };
type Row = {
  key: string; label: string; category: string; categoryLabel: string;
  /** Null where the location filter cannot say (can't-speak): drawn "—". */
  places: number | null; atLeast?: boolean; facts: number; related: Related[];
  /** Person-set defaults most of its confirmed places contradict (`?sort=review` puts these first). */
  contradicted?: number;
  /** The subcategory's synonyms for the search ("swim" finds the pools). */
  terms?: string | null;
};
type Filter =
  | { unknown: true; where: string; message: string }
  | {
    unknown?: false; where: string; label: string; minutes: number; mode: string; chip: string; approx?: boolean; capped?: boolean;
    /** location.js's can't-speak: false where the census has not covered the area; `why` says so, and why a count is a floor. */
    speaks?: boolean; atLeast?: boolean; why?: string | null;
  };
type ListResponse = {
  counts: { subcategories: number; places: number; within?: number | null; facts: number; newFacts: number };
  rows: Row[];
  defaultFacts: { key: string; label: string; options: Option[] }[];
  atLeast: boolean;
  filter: Filter | null;
  categories: { key: string; label: string }[];
};

export function Categories({ canManage = false }: { canManage?: boolean }) {
  const [sub] = useDeskParam('sub');
  const [fact] = useDeskParam('fact');
  const [view] = useDeskParam('view');
  if (view === 'new') return <NewFacts canManage={canManage} />;
  if (view === 'gaps') return <GapReport />;
  if (sub && fact && view === 'review') return <Review sub={sub} fact={fact} />;
  if (sub && fact) return <FactAtSub sub={sub} fact={fact} canManage={canManage} />;
  if (sub) return <SubPage sub={sub} canManage={canManage} />;
  return <SubList canManage={canManage} />;
}

// ---------------------------------------------------------------------------
// The subcategory list
// ---------------------------------------------------------------------------

type ColKey = 'name' | 'cat' | 'places' | 'facts' | 'related';
const COL_KEYS: ColKey[] = ['name', 'cat', 'places', 'facts', 'related'];

/**
 * The list's sort, as the address spells it (a sort is part of the address):
 * `sort=places` ascending, `sort=-facts` descending, `sort=review` the
 * subcategories with a contradicted default first (Overview links here).
 * Name ascending is the default and not written.
 */
function sortOf(raw: string): SortState<ColKey> | 'review' {
  if (raw === 'review') return 'review';
  const desc = raw.startsWith('-');
  const k = (desc ? raw.slice(1) : raw) as ColKey;
  return COL_KEYS.includes(k) ? { key: k, dir: desc ? 'desc' : 'asc' } : { key: 'name', dir: 'asc' };
}
const sortText = (s: SortState<ColKey>) => (!s || (s.key === 'name' && s.dir === 'asc') ? '' : `${s.dir === 'desc' ? '-' : ''}${s.key}`);

const hover = Platform.OS === 'web';

function SubList({ canManage }: { canManage: boolean }) {
  const go = useDeskGo();
  const toast = useToast();
  const { width } = useViewport();
  const narrow = width < 900;
  const { loc, setAnswer } = useLocation();
  const [q, setQ] = useDeskParam('q');
  const [cat, setCat] = useDeskParam('cat');
  const [side] = useSide();
  const [data, setData] = useState<ListResponse | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [sortRaw, setSortRaw] = useDeskParam('sort');
  const sorted = sortOf(sortRaw);
  const sort: SortState<ColKey> = sorted === 'review' ? null : sorted;
  const setSort = (s: SortState<ColKey>) => setSortRaw(sortText(s), { replace: true });
  const [ticked, setTicked] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [text, setText] = useState(q);

  useCrumbs([{ name: 'Categories' }], []);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // The search box writes the address a beat after the typing stops; a filter replaces.
  useEffect(() => { setText(q); }, [q]);
  useEffect(() => {
    const t = setTimeout(() => { if (text !== q) setQ(text, { replace: true }); }, 250);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = locParams(loc);
  const paramKey = JSON.stringify(params);
  useEffect(() => {
    let live = true;
    setErr(null);
    deskApi.get<ListResponse>('/categories', params).then((d) => {
      if (!live) return;
      setData(d);
      const f = d.filter;
      setAnswer(f ? (f.unknown ? { known: false, label: null, chip: null } : { known: true, label: f.label, chip: f.chip, approx: f.approx, capped: f.capped }) : null);
    }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [paramKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const within = Boolean(data?.filter && !data.filter.unknown);
  const plus = data?.atLeast ? '+' : '';
  const needle = q.trim().toLowerCase();
  const all = data?.rows ?? [];
  const shown = useMemo(() => {
    const f = all
      .filter((r) => onSide(side, [r.category]))
      .filter((r) => !cat || r.category === cat)
      .filter((r) => !needle || r.label.toLowerCase().includes(needle) || r.categoryLabel.toLowerCase().includes(needle) || (r.terms ?? '').includes(needle));
    if (sorted === 'review') {
      return [...f].sort((a, b) => (b.contradicted ?? 0) - (a.contradicted ?? 0) || a.label.localeCompare(b.label));
    }
    // Ties fall back to the name, so equal rows keep one order from load to load.
    return sortRows(f, sort, (r, k) => (
      k === 'name' ? r.label : k === 'cat' ? r.categoryLabel : k === 'places' ? r.places : k === 'facts' ? r.facts : r.related.length
    ), (r) => r.label);
  }, [all, cat, needle, sortRaw, side]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = Boolean(needle || cat || side);

  const cols: TCol<ColKey>[] = [
    { key: 'name', name: 'Subcategory', width: 240 },
    { key: 'cat', name: 'Category', width: 130 },
    { key: 'places', name: within ? 'Within reach' : 'Places', width: 80, first: 'asc' },
    {
      key: 'facts', name: 'Facts', width: 80, first: 'desc',
      tip: 'The facts our own sources have confirmed at places in this subcategory — Active at 2 or more, Gathering evidence at 1 — for Water parks: wave machine, toddler pool, flumes. The same links as Subcategories on Facts. Click the number to see them.',
    },
    {
      key: 'related', name: 'Related', width: 400, first: 'desc',
      tip: 'Other subcategories that belong alongside this one — either because the same places are filed in both, or because a person linked them. Click one to open it.',
    },
  ];
  const GAP = 18;
  const tableW = 20 + GAP + cols.reduce((s, c) => s + c.width, 0) + GAP * (cols.length - 1) + 16;

  const allOn = shown.length > 0 && shown.every((r) => ticked.includes(r.key));
  const liveTicked = ticked.filter((k) => all.some((r) => r.key === k));

  const unlink = async (row: Row, other: Related) => {
    try {
      const c = await deskApi.post<Change>(`/subcategories/${encodeURIComponent(row.key)}/related`, { other: other.key, on: false });
      toast(`${other.label} removed from ${row.label}`, () => undoChanges([c.id], toast, reload));
      reload();
    } catch (e) { toast(saidOf(e)); }
  };
  const link = async (row: Row, other: { key: string; label: string }) => {
    try {
      const c = await deskApi.post<Change>(`/subcategories/${encodeURIComponent(row.key)}/related`, { other: other.key });
      toast(`${row.label} linked to ${other.label}`, () => undoChanges([c.id], toast, reload));
      reload();
    } catch (e) { toast(saidOf(e)); }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, paddingBottom: 4, zIndex: 45 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>Subcategories</Text>
          <HowTip text="Every subcategory Epic files places under. Tick some to set a fact for all of them at once; open one to see its defaults and the facts Epic looks for there." />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 30, maxWidth: '100%', flexShrink: 1 }}>
          <Count label="Subcategories" n={data ? n(data.counts.subcategories) : '—'} />
          {/* The estate's total whatever the location says (the prototype); the column shows what is within reach. */}
          <Count label="Places" n={data ? n(data.counts.places) : '—'} />
          <Count label="Facts" n={data ? n(data.counts.facts) : '—'} />
          <Count label="New facts" n={data ? n(data.counts.newFacts) : '—'} lime onPress={() => go('categories', { view: 'new' })} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
        <SideToggle />
        <TextLink onPress={() => go('categories', { view: 'gaps' })}>Gap report</TextLink>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, zIndex: 42 }}>
        <SearchBox value={text} onChange={setText} placeholder="Search every subcategory" width={narrow ? Math.min(280, width - 32) : 280} />
        <Dropdown
          label={cat ? data?.categories.find((c) => c.key === cat)?.label ?? 'All categories' : 'All categories'}
          value={cat || 'all'}
          width={240}
          options={[{ key: 'all', name: 'All categories' }, ...(data?.categories ?? []).filter((c) => onSide(side, [c.key])).map((c) => ({ key: c.key, name: c.label }))]}
          onChange={(v) => setCat(v === 'all' ? '' : v, { replace: true })}
        />
        {filtered && data ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{shown.length} of {data.rows.length}</Text> : null}
      </View>
      {/* Above the bulk bar: the reach dropdown opens over it. */}
      <View style={{ zIndex: 38 }}><LocationFilter /></View>

      {canManage && liveTicked.length ? (
        <BulkBar
          subs={liveTicked}
          facts={data?.defaultFacts ?? []}
          onClear={() => setTicked([])}
          onDone={(ids, line) => {
            setTicked([]);
            toast(line, () => undoChanges(ids, toast, reload));
            reload();
          }}
        />
      ) : null}

      {err ? <Failed err={err} /> : !data ? <Muted>Loading</Muted> : (
        <Table width={tableW}>
          <THead
            cols={cols}
            sort={sort}
            onSort={setSort}
            gap={GAP}
            lead={canManage ? <Tick on={allOn} onPress={() => setTicked(allOn ? [] : shown.map((r) => r.key))} /> : <View style={{ width: 20 }} />}
          />
          {shown.length === 0 ? <Muted>No subcategories match.</Muted> : null}
          {shown.map((r) => (
            <ListRow
              key={r.key}
              row={r}
              plus={plus}
              why={data.filter && !data.filter.unknown ? data.filter.why ?? null : null}
              narrow={narrow}
              canManage={canManage}
              ticked={ticked.includes(r.key)}
              onTick={() => setTicked((t) => (t.includes(r.key) ? t.filter((x) => x !== r.key) : [...t, r.key]))}
              open={() => go('categories', { sub: r.key })}
              openFacts={() => go('categories', { sub: r.key })}
              openOther={(k) => go('categories', { sub: k })}
              adding={adding === r.key}
              toggleAdd={() => setAdding((a) => (a === r.key ? null : r.key))}
              catalogue={all}
              categories={data.categories}
              onLink={(o) => link(r, o)}
              onUnlink={(o) => unlink(r, o)}
            />
          ))}
        </Table>
      )}
    </View>
  );
}

function ListRow({
  row, plus, why, narrow, canManage, ticked, onTick, open, openFacts, openOther, adding, toggleAdd, catalogue, categories, onLink, onUnlink,
}: {
  row: Row; plus: string; why: string | null; narrow: boolean; canManage: boolean; ticked: boolean; onTick: () => void;
  open: () => void; openFacts: () => void; openOther: (k: string) => void;
  adding: boolean; toggleAdd: () => void; catalogue: Row[]; categories: { key: string; label: string }[];
  onLink: (o: { key: string; label: string }) => void; onUnlink: (o: Related) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: desk.rule }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 18, paddingVertical: 12, paddingHorizontal: 8, backgroundColor: ticked ? desk.picked : 'transparent' }}>
        {canManage ? <Tick on={ticked} onPress={onTick} /> : <View style={{ width: 20 }} />}
        <View style={{ width: 240, minWidth: 0 }}>
          <Press effect="none" onPress={open}>
            <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: desk.ink }}>{row.label}</Text>
          </Press>
        </View>
        <Text style={{ width: 130, fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted }}>{row.categoryLabel}</Text>
        {/* Within reach: "—" where the filter cannot speak, "N+" where the count is a floor; the reason on hover. */}
        <View style={{ width: 80 }}>
          <HoverTitle title={row.places == null || row.atLeast ? why ?? '' : ''}>
            <Text style={[{ fontFamily: fonts.body, fontSize: 13.5, color: row.places == null ? desk.inkDim : row.places ? desk.ink : RED }, tabular]}>
              {count(row.places, row.atLeast ?? Boolean(plus) ? '+' : '')}
            </Text>
          </HoverTitle>
        </View>
        <View style={{ width: 80 }}>
          <Press effect="none" onPress={openFacts}>
            <Text style={[{ fontFamily: fonts.body, fontSize: 13.5, color: row.facts ? desk.ink : desk.inkDim }, tabular]}>{n(row.facts)}</Text>
          </Press>
        </View>
        <View style={{ width: 400, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 6 }}>
          {row.related.map((x) => (
            <Press
              key={x.key}
              effect="none"
              onHoverIn={hover ? () => setOver(x.key) : undefined}
              onHoverOut={hover ? () => setOver(null) : undefined}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Press effect="none" onPress={() => openOther(x.key)}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.ink }}>{x.label}</Text>
                </Press>
                {/* Only a link a person made can be taken off here; a pair that shares places is related by its places. */}
                {canManage && x.why === 'linked' ? (
                  <Press effect="none" onPress={() => onUnlink(x)} accessibilityLabel={`Remove ${x.label}`}>
                    <View style={{ paddingHorizontal: 2, opacity: !hover || over === x.key ? 1 : 0 }}><Icon name="close" size={12} color={desk.inkDim} /></View>
                  </Press>
                ) : null}
              </View>
            </Press>
          ))}
          {canManage ? (
            <Press effect="none" onPress={toggleAdd}>
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>+ Add related</Text>
            </Press>
          ) : null}
        </View>
      </View>
      {adding ? (
        <View style={{ paddingLeft: narrow ? 46 : 486, paddingRight: 8, paddingBottom: 16 }}>
          <RelatedAdder row={row} catalogue={catalogue} categories={categories} onClose={toggleAdd} onLink={onLink} onUnlink={onUnlink} />
        </View>
      ) : null}
    </View>
  );
}

/** "+ Add related": search every subcategory, or browse by category. */
function RelatedAdder({ row, catalogue, categories, onClose, onLink, onUnlink }: {
  row: Row; catalogue: Row[]; categories: { key: string; label: string }[]; onClose: () => void;
  onLink: (o: { key: string; label: string }) => void; onUnlink: (o: Related) => void;
}) {
  const [q, setQ] = useState('');
  const [browse, setBrowse] = useState(row.category);
  const needle = q.trim().toLowerCase();
  const others = catalogue.filter((o) => o.key !== row.key);
  const opt = (o: Row, withCat: boolean) => {
    const r = row.related.find((z) => z.key === o.key);
    const shared = r && r.why !== 'linked';
    const note = [withCat ? o.categoryLabel : null, shared ? 'shares places' : null].filter(Boolean).join(' · ');
    return (
      <Press
        key={o.key}
        effect="none"
        onPress={shared ? undefined : () => (r ? onUnlink(r) : onLink({ key: o.key, label: o.label }))}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, paddingHorizontal: 14 }}>
          <View style={{ width: 14 }}>
            {r ? <Icon name="check" size={13} color={LIME} /> : <Icon name="add" size={13} color={desk.ink} />}
          </View>
          <Text style={{ flex: withCat ? undefined : 1, width: withCat ? 220 : undefined, minWidth: 0, fontFamily: fonts.body, fontSize: 13.5, fontWeight: r ? '700' : '500', color: r ? LIME : desk.ink }}>{o.label}</Text>
          {note ? <Text style={{ flex: withCat ? 1 : undefined, minWidth: 0, fontFamily: fonts.body, fontSize: withCat ? 12 : 11.5, color: desk.inkDim }}>{note}</Text> : null}
        </View>
      </Press>
    );
  };
  return (
    <View style={{ width: 560, maxWidth: '100%', borderWidth: 1, borderColor: desk.ruleStrong, backgroundColor: desk.well }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
        <Icon name="search" size={14} color={desk.inkDim} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search every subcategory"
          placeholderTextColor={desk.inkDim}
          autoFocus
          style={[{ flex: 1, minWidth: 0, color: desk.ink, fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', padding: 0 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
        />
        <Press effect="none" onPress={onClose}><Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>close</Text></Press>
      </View>
      {needle ? (
        <View style={{ paddingVertical: 6, minHeight: 220 }}>
          {others.filter((o) => o.label.toLowerCase().includes(needle)).slice(0, 12).map((o) => opt(o, true))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: 220 }}>
          <View style={{ width: 200, borderRightWidth: 1, borderRightColor: desk.rule, paddingVertical: 6 }}>
            {categories.map((c) => {
              const on = browse === c.key;
              const count = catalogue.filter((o) => o.category === c.key).length;
              return (
                <Press key={c.key} effect="none" onPress={() => setBrowse(c.key)}>
                  <View style={{ gap: 2, paddingVertical: 7, paddingHorizontal: 14, backgroundColor: on ? desk.picked : 'transparent' }}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: on ? '700' : '500', color: on ? desk.ink : desk.inkMuted }}>{c.label}</Text>
                    <Text style={{ fontFamily: fonts.body, fontSize: 11, color: desk.inkDim }}>{count} {count === 1 ? 'subcategory' : 'subcategories'}</Text>
                  </View>
                </Press>
              );
            })}
          </View>
          <View style={{ flex: 1, minWidth: 0, paddingVertical: 6 }}>
            {others.filter((o) => o.category === browse).sort((a, b) => a.label.localeCompare(b.label)).map((o) => opt(o, false))}
          </View>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The bulk bar
// ---------------------------------------------------------------------------

/**
 * "4 selected · Set a fact" → the fact → its value → "Applies to 212 places
 * without their own answer · 9 keep their own" and Set. Logged in Changes
 * under Defaults with that line as the Why.
 */
function BulkBar({ subs, facts, onClear, onDone }: {
  subs: string[]; facts: { key: string; label: string; options: Option[] }[];
  onClear: () => void; onDone: (ids: string[], line: string) => void;
}) {
  const toast = useToast();
  const [fact, setFact] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [impact, setImpact] = useState<{ applies: number; keep: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const ordered = FACT_ORDER.map((k) => facts.find((f) => f.key === k)).filter(Boolean) as typeof facts;
  const def = ordered.find((f) => f.key === fact) ?? null;
  const opt = def?.options.find((o) => o.key === value) ?? null;
  const subsKey = subs.join(',');

  useEffect(() => {
    setImpact(null);
    if (!fact) return;
    let live = true;
    deskApi.get<{ applies: number; keep: number }>('/categories/impact', { subs: subsKey, fact })
      .then((r) => { if (live) setImpact(r); })
      .catch(() => { if (live) setImpact(null); });
    return () => { live = false; };
  }, [fact, subsKey]);

  const apply = async () => {
    if (!def || !opt || busy) return;
    setBusy(true);
    try {
      const why = impact ? `Applies to ${impact.applies} places without their own answer · ${impact.keep} keep their own` : null;
      const out = await deskApi.post<{ changes: Change[] }>('/categories/defaults', { subs, fact: def.key, option: opt.key, why, bulk: true });
      const name = factName(def.key, def.label);
      setFact(null); setValue(null);
      onDone(out.changes.map((c) => c.id), `${name}: ${opt.label} set on ${subs.length} ${subs.length === 1 ? 'subcategory' : 'subcategories'}`);
    } catch (e) {
      toast(saidOf(e));
    } finally { setBusy(false); }
  };

  return (
    <View style={{
      gap: 12, borderTopWidth: 2, borderTopColor: LIME, borderBottomWidth: 1, borderBottomColor: desk.rule,
      paddingVertical: 13, paddingHorizontal: 8, backgroundColor: desk.lifted, zIndex: 32,
    }}>
      {/* Raised over the row under it, so the fact list opens above the summary line and Set (audit, 28 Sep 2026). */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, position: 'relative', zIndex: 5 }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '800', color: desk.ink }}>{subs.length} selected</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>·</Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.inkMuted }}>Set a fact</Text>
        <Dropdown
          label={def ? factName(def.key, def.label) : 'Choose a fact'}
          value={fact}
          width={190}
          listWidth={210}
          options={ordered.map((f) => ({ key: f.key, name: factName(f.key, f.label) }))}
          onChange={(k) => { setFact(k); setValue(null); }}
        />
        {def ? (
          <PillBar
            options={def.options.map((o) => ({ key: o.key, name: o.label }))}
            value={value}
            onChange={setValue}
            padH={14}
          />
        ) : null}
        <View style={{ flexGrow: 1 }} />
        <Press effect="none" onPress={() => { setFact(null); setValue(null); onClear(); }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>Clear</Text>
        </Press>
      </View>
      {def && opt ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, position: 'relative', zIndex: 1 }}>
          <Text style={[{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted }, tabular]}>
            {impact ? `Applies to ${n(impact.applies)} places without their own answer · ${n(impact.keep)} keep their own` : 'Counting the places it reaches'}
          </Text>
          <Press effect="none" onPress={apply} disabled={busy}>
            <Text style={{ backgroundColor: LIME, color: ON_LIME, paddingVertical: 9, paddingHorizontal: 16, fontFamily: fonts.body, fontSize: 13, fontWeight: '700' }}>
              Set {factName(def.key, def.label)}: {opt.label} on {subs.length}
            </Text>
          </Press>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The gap report (`view=gaps`, round 3, 29 Sep 2026)
// ---------------------------------------------------------------------------

type GapWord = { word: string; primary: boolean; brings: number };
type GapRow = {
  key: string; label: string; category: string; categoryLabel: string; places: number;
  words: GapWord[]; noWord: boolean;
  /** Null where the category cannot say (too few drawers, a median of nought); `thinWhy` says why. */
  thin: boolean | null; thinWhy: string | null; median: number | null;
  suggest: { word: string; brings: number; state: 'undecided' | 'proposed' }[];
};
type GapResponse = { rows: GapRow[]; counts: { subcategories: number; noWord: number; thin: number; flagged: number } };

/**
 * Every subcategory with the Google words feeding it (primary and secondary)
 * and its places; flagged where no word points at it, or where it holds
 * under a quarter of its category's median. Beside a flag, the unanswered
 * words whose names fit it — a door to that word in Mapping, never a change
 * made from here.
 */
function GapReport() {
  const go = useDeskGo();
  const [side] = useSide();
  const narrow = useViewport().width < 900;
  const [data, setData] = useState<GapResponse | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useCrumbs([{ name: 'Categories', go: () => go('categories') }, { name: 'Gap report' }], []);
  useEffect(() => {
    let live = true;
    deskApi.get<GapResponse>('/categories/gaps').then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, []);
  const rows = useMemo(() => {
    const on = (data?.rows ?? []).filter((r) => onSide(side, [r.category]));
    // The flagged first — no word at all, then thin — each in the list's own order.
    const rank = (r: GapRow) => (r.noWord ? 0 : r.thin ? 1 : 2);
    return on.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r);
  }, [data, side]);
  const GAP = 18;
  const cols: TCol[] = [
    { key: 'name', name: 'Subcategory', width: 220, sortable: false },
    { key: 'cat', name: 'Category', width: 120, sortable: false },
    { key: 'places', name: 'Places', width: 80, sortable: false },
    { key: 'words', name: 'Google words feeding it', width: 340, sortable: false, tip: 'Every Google word pointing here, as its primary or as a secondary. Primary words are lime.' },
    { key: 'flag', name: 'Flag', width: 200, sortable: false, tip: 'No word points here; or thin — fewer than a quarter of the median places of the subcategories in its category.' },
    { key: 'suggest', name: 'Words that might fit', width: 240, sortable: false, tip: 'Google words nobody has placed yet, or with a proposal waiting, whose names match this subcategory. Opens the word in Mapping.' },
  ];
  const tableW = GAP * (cols.length - 1) + cols.reduce((a, c) => a + c.width, 0) + 16;
  const shownFlagged = rows.filter((r) => r.noWord || r.thin === true).length;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>Gap report</Text>
          <HowTip text="Which subcategories no Google word feeds, and which hold far fewer places than the others in their category. A suggested word opens in Mapping, where a person decides." />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 30 }}>
          <Count label="Subcategories" n={data ? n(rows.length) : '—'} />
          <Count label="No word" n={data ? n(rows.filter((r) => r.noWord).length) : '—'} />
          <Count label="Thin" n={data ? n(rows.filter((r) => r.thin === true).length) : '—'} />
        </View>
      </View>
      <SideToggle />
      {err ? <Failed err={err} /> : !data ? <Muted>Counting every subcategory’s words and places</Muted> : (
        <>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{n(shownFlagged)} flagged of {n(rows.length)}, flagged first</Text>
          <Table width={tableW}>
            <THead cols={cols} gap={GAP} />
            {rows.length === 0 ? <Muted>No subcategories on this side.</Muted> : null}
            {rows.map((r) => (
              <View key={r.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: GAP, paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
                <View style={{ width: 220 }}>
                  <Press effect="none" onPress={() => go('categories', { sub: r.key })}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: desk.ink }}>{r.label}</Text>
                  </Press>
                </View>
                <Text style={{ width: 120, fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted }}>{r.categoryLabel}</Text>
                <Text style={[{ width: 80, fontFamily: fonts.body, fontSize: 13.5, color: r.places ? desk.ink : RED }, tabular]}>{n(r.places)}</Text>
                <View style={{ width: 340, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }}>
                  {r.words.length ? r.words.map((w) => (
                    <Press key={w.word} effect="none" onPress={() => go('mapping', { word: w.word })}>
                      <Text style={[{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: w.primary ? '700' : '500', color: w.primary ? LIME : desk.inkMuted }, tabular]}>
                        {w.word} {n(w.brings)}
                      </Text>
                    </Press>
                  )) : <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>none</Text>}
                </View>
                <View style={{ width: 200 }}>
                  {r.noWord ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: RED }}>No word points here</Text>
                    : r.thin ? <Text style={[{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: AMBER }, tabular]}>Thin · {r.categoryLabel}’s median is {n(r.median)}</Text>
                      : r.thin === null ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>{r.thinWhy ?? '—'}</Text>
                        : <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>—</Text>}
                </View>
                <View style={{ width: 240, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }}>
                  {r.suggest.map((w) => (
                    <Press key={w.word} effect="none" onPress={() => go('mapping', w.state === 'proposed' ? { view: 'needs' } : { word: w.word })}>
                      <Text style={[{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.ink, borderBottomWidth: 1, borderBottomColor: desk.ruleStrong }, tabular]}>
                        {w.word}{w.state === 'proposed' ? ' (proposed)' : ''} {n(w.brings)}
                      </Text>
                    </Press>
                  ))}
                  {!r.suggest.length && (r.noWord || r.thin) ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>no unplaced word fits</Text> : null}
                </View>
              </View>
            ))}
          </Table>
          {narrow ? <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>the table scrolls sideways</Text> : null}
        </>
      )}
    </View>
  );
}
