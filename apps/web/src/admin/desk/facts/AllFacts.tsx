/**
 * All facts, a fact's page, and the places that have it (README v2 "All
 * facts"; prototype `isAllFacts`, `isFactSum`, `isFact`).
 *
 * "Is Epic looking for this fact?" and "does a place have it?" never share a
 * list: the list and the fact page answer the first, the drill-down the
 * second. The list is read-only; the fact page can stop looking for a fact in
 * one subcategory (Remove), and the drill-down can correct one place's answer
 * (Edit) — both logged in Changes, both undoable from the toast.
 */

import React, { useMemo, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { Press } from '../../../components/press';
import { useViewport } from '../../../hooks/useViewport';
import { useCrumbs, useDeskGo, useDeskParam, type Crumb } from '../Desk';
import {
  Dropdown, HeadCount, Kicker, LIME, Muted, PageTitle, RED, SearchBox, T, TCell, THead, TRow, Table,
  SideToggle, deskApi, desk, fonts, n, sortRows, tableWidth, tabular, useSide, type SortState, type TCol,
} from '../kit';
import { OptPill } from '../categories/shared';
import { FactTabs, HoverTitle, LoadLine, Title, nameWidth, plural, useDebounced, useDesk, useWrite } from './shared';

// ---------------------------------------------------------------------------
// Shapes (apps/api/src/desk/facts.js)
// ---------------------------------------------------------------------------

type Status = 'active' | 'gathering' | 'ignored' | 'unattached';
type FactRow = {
  fact: string; label: string; standard: boolean; subcategories: string; subcategoryCount: number | null;
  places: number | null; status: Status; statusText: string; isNew: boolean; reason: string | null;
};
type AllFactsResp = { counts: { facts: number; active: number; gathering: number; ignored: number; unattached?: number }; rows: FactRow[] };
type Catalogue = { categories: { key: string; label: string }[]; subcategories: { key: string; label: string; category: string }[] };

type Band = { name: string; means: string };
type CostRow = { country: string; currency: string; free: string; cheap: string; mid: string; dear: string };
type FactPageResp = {
  fact: string; label: string; kind: string; standard: boolean; status: Status; statusText: string; isNew: boolean;
  places: number | null; needed?: number;
  definition?: { shape: string; line: string | null; bands?: Band[]; cost?: CostRow[] };
  subcategories?: { key: string; label: string; category: string; categoryKey: string; places: number | null; status: Status; isNew: boolean; note: string | null }[];
  conflicts: number; conflictLine: string | null;
};
type PlaceRow = {
  ref: string; name: string | null; area: string | null; county: string | null; country: string | null; postcode: string | null;
  how: string | null; answer: string | null; current: string | null;
  /** Our own sources that said yes, each with the words it used and a link where one is held. */
  evidence?: Evidence[];
  families?: string | null;
};
type Evidence = { source: string; word: string; quote: string | null; url: string | null };
export type PlacesResp = {
  fact: string; label: string; kind: string; standard: boolean; sub: string | null; subLabel: string | null; categoryLabel: string | null;
  options: { key: string; label: string }[]; rows: PlaceRow[]; total: number;
  /** Null for a standard fact nobody has asked about: "—", never 0. */
  lookedFor: number | null; foundAt: number;
  counties: string[]; countries: string[]; postcodes: string[];
  queued: number;
  queue: { ref: string; place: string | null; line: string; conflict: boolean }[];
  outcomes: { ref: string; place: string | null; outcome: string; key: string; source: string; at: string }[];
};

const STATUS_OPTS: { key: string; name: string }[] = [
  { key: '', name: 'All statuses' }, { key: 'active', name: 'Active' }, { key: 'gathering', name: 'Gathering evidence' }, { key: 'ignored', name: 'Ignored' },
  { key: 'unattached', name: 'Not found yet' },
];
const ORDER: Record<Status, number> = { active: 0, gathering: 1, ignored: 2, unattached: 3 };

// ---------------------------------------------------------------------------
// All facts
// ---------------------------------------------------------------------------

export function AllFacts() {
  const go = useDeskGo();
  const [q, setQ] = useDeskParam('q');
  const [cat, setCat] = useDeskParam('cat');
  const [sub, setSub] = useDeskParam('sub');
  const [state, setState] = useDeskParam('state');
  const [text, setText] = useState(q);
  const typed = useDebounced(text);
  React.useEffect(() => { if (typed !== q) setQ(typed, { replace: true }); }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  // The sort is part of the address: `sort=places`, `sort=-subs`; Fact ascending is the default.
  const [sortRaw, setSortRaw] = useDeskParam('sort');
  const sort: SortState = sortRaw
    ? { key: sortRaw.replace(/^-/, ''), dir: sortRaw.startsWith('-') ? 'desc' : 'asc' }
    : { key: 'name', dir: 'asc' };
  const setSort = (s: SortState) => setSortRaw(!s || (s.key === 'name' && s.dir === 'asc') ? '' : `${s.dir === 'desc' ? '-' : ''}${s.key}`, { replace: true });

  // Food & drink · Things to do (round 3): the API keeps the facts looked for on that side.
  const [side] = useSide();
  const load = useDesk<AllFactsResp>('/facts', { q: q || null, cat: cat || null, sub: sub || null, status: state || null, side: side || null });
  const cata = useDesk<Catalogue>('/mapping/picker');
  useCrumbs([{ name: 'Facts' }], []);

  const all = load.data?.rows ?? [];
  const factW = nameWidth(all.map((r) => r.label));
  const cols: TCol[] = [
    { key: 'name', name: 'Fact', width: factW, first: 'asc' },
    // The other three equal (README v2), wide enough for "Ignored · Removed by a person" on one line.
    { key: 'subs', name: 'Subcategories', width: 200, first: 'desc' },
    { key: 'places', name: 'Places with it', width: 200, first: 'asc' },
    { key: 'status', name: 'Status', width: 200, first: 'asc' },
  ];
  const rows = sortRows(all, sort, (r, k) => (k === 'name' ? r.label
    : k === 'subs' ? (r.standard ? 9999 : r.subcategoryCount)
      : k === 'places' ? r.places
        : ORDER[r.status]));

  const cats = cata.data?.categories ?? [];
  const subs = (cata.data?.subcategories ?? []).filter((s) => !cat || s.category === cat).sort((a, b) => a.label.localeCompare(b.label));
  const counts = load.data?.counts;

  return (
    <>
      <FactTabs on="all" />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', paddingBottom: 4, zIndex: 20 }}>
        <PageTitle tip="Every fact Epic looks for, once each. Active means our sources confirmed it at 2 or more places in a subcategory; Gathering evidence means confirmed at 1; Not found yet means no subcategory has it yet, though we still look for it; Ignored means it tells a family nothing.">All facts</PageTitle>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 26, flexWrap: 'wrap' }}>
          <HeadCount label="Facts" n={n(counts?.facts)} />
          <HeadCount label="Active" n={n(counts?.active)} tone={desk.link} />
          <HeadCount label="Gathering evidence" n={n(counts?.gathering)} tone={desk.inkMuted} />
          <HeadCount label="Ignored" n={n(counts?.ignored)} tone={desk.inkDim} />
          <HeadCount label="Not found yet" n={n(counts?.unattached)} tone={desk.inkDim} />
        </View>
      </View>
      <View style={{ marginTop: 12 }}><SideToggle /></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12, zIndex: 15 }}>
        <SearchBox value={text} onChange={setText} placeholder="Search facts" width={260} />
        <Dropdown
          label={cats.find((c) => c.key === cat)?.label ?? 'All categories'}
          value={cat}
          options={[{ key: '', name: 'All categories' }, ...cats.map((c) => ({ key: c.key, name: c.label }))]}
          onChange={(v) => { setCat(v, { replace: true }); if (sub) setSub('', { replace: true }); }}
          listWidth={220}
        />
        <Dropdown
          label={subs.find((s) => s.key === sub)?.label ?? (cata.data?.subcategories ?? []).find((s) => s.key === sub)?.label ?? 'All subcategories'}
          value={sub}
          options={[{ key: '', name: 'All subcategories' }, ...subs.map((s) => ({ key: s.key, name: s.label }))]}
          onChange={(v) => setSub(v, { replace: true })}
          listWidth={220}
        />
        <Dropdown
          label={STATUS_OPTS.find((o) => o.key === state)?.name ?? 'All statuses'}
          value={state}
          options={STATUS_OPTS}
          onChange={(v) => setState(v, { replace: true })}
          listWidth={220}
        />
      </View>
      {!load.data ? <LoadLine load={load} what="The facts" /> : (
        <Table width={tableWidth(cols)}>
          <THead cols={cols} sort={sort} onSort={setSort} />
          {rows.length === 0 ? <Muted>No facts match.</Muted> : rows.map((r) => (
            <TRow key={r.fact} vpad={11} onPress={() => go('facts', { fact: r.fact })}>
              {/* The prototype's row sits on a 15px line (23.25px) inside 11px by 8px: 46px a row. */}
              <TCell width={factW} style={{ minHeight: 23.25, justifyContent: 'center' }}><T weight="700">{r.label}</T></TCell>
              <TCell width={200}>
                {/* An Ignored fact names its subcategories; cut to one line, the whole list is its hover title. */}
                <HoverTitle title={r.subcategories}><T tone={desk.inkMuted} num lines={1}>{r.subcategories}</T></HoverTitle>
              </TCell>
              <TCell width={200}><T weight="800" num>{n(r.places)}</T></TCell>
              <TCell width={200}><View style={{ minHeight: 20, justifyContent: 'center' }}><T size={13} tone={desk.inkMuted}>{r.statusText}</T></View></TCell>
            </TRow>
          ))}
        </Table>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// A fact's page
// ---------------------------------------------------------------------------

export function FactPage({ fact, canManage }: { fact: string; canManage: boolean }) {
  const go = useDeskGo();
  const load = useDesk<FactPageResp>(`/facts/${encodeURIComponent(fact)}`);
  const write = useWrite(load.reload);
  const f = load.data;
  useCrumbs([{ name: 'Facts', go: () => go('facts') }, { name: f?.label ?? '' }], [f?.label]);
  if (!f) return <LoadLine load={load} what="This fact" />;

  const openPlaces = (sub?: string) => go('facts', { fact, places: '1', sub: sub ?? null });
  const def = f.definition;

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18 }}>
        <View style={{ gap: 10 }}>
          <Title>{f.label}</Title>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T size={13} tone={desk.inkMuted}>{f.statusText}</T>
            {f.isNew ? <T size={13} tone={desk.inkMuted}>New</T> : null}
          </View>
        </View>
        <View style={{ gap: 2 }}>
          <Kicker>Places with it</Kicker>
          <Press effect="none" onPress={f.places == null ? undefined : () => openPlaces()}>
            <Text style={[{ fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: desk.ink }, tabular]}>{n(f.places)}</Text>
          </Press>
        </View>
      </View>
      {f.conflictLine ? <T size={13} tone={desk.inkMuted}>{f.conflictLine}</T> : null}

      {f.standard ? (
        <View style={{ gap: 8, maxWidth: 760 }}>
          <Kicker>Definition</Kicker>
          {def?.line ? <Text style={{ fontFamily: fonts.body, fontSize: 13.5, lineHeight: 21, color: desk.ink }}>{def.line}</Text> : null}
          {def?.bands?.length ? (
            <View style={{ marginTop: 6 }}>
              <Table width={tableWidth([{ width: 220 }, { width: 240 }])}>
                <THead cols={[{ key: 'band', name: 'Band', width: 220 }, { key: 'means', name: 'Means', width: 240 }]} />
                {def.bands.map((b) => (
                  <TRow key={b.name}>
                    <TCell width={220}><T weight="700">{b.name}</T></TCell>
                    <TCell width={240}><T size={13} tone={desk.inkMuted}>{b.means}</T></TCell>
                  </TRow>
                ))}
              </Table>
            </View>
          ) : null}
          {def?.cost?.length ? (
            <View style={{ marginTop: 6 }}>
              <CostTable rows={def.cost} />
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, paddingTop: 8 }}>Per person, for one visit.</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <SubsTable
          f={f}
          canManage={canManage}
          onOpenSub={(key) => go('categories', { sub: key })}
          onPlaces={(key) => openPlaces(key)}
          onRemove={(s) => write(
            () => deskApi.post<{ id: string }>(`/subcategories/${encodeURIComponent(s.key)}/facts/${encodeURIComponent(f.fact)}/remove`),
            `${f.label} removed from ${s.label} · it stays removed`,
          )}
        />
      )}
    </>
  );
}

function CostTable({ rows }: { rows: CostRow[] }) {
  const cols: TCol[] = [
    { key: 'country', name: 'Country', width: 140 }, { key: 'cur', name: 'Currency', width: 90 }, { key: 'free', name: 'Free', width: 80 },
    { key: 'cheap', name: 'Cheap', width: 120 }, { key: 'mid', name: 'Mid', width: 120 }, { key: 'dear', name: 'Dear', width: 120 },
  ];
  return (
    <Table width={tableWidth(cols)}>
      <THead cols={cols} />
      {rows.map((r) => (
        <TRow key={r.country}>
          <TCell width={140}><T weight="700">{r.country}</T></TCell>
          <TCell width={90}><T size={13} tone={desk.inkMuted}>{r.currency}</T></TCell>
          <TCell width={80}><T size={13} tone={desk.inkMuted}>{r.free}</T></TCell>
          <TCell width={120}><T size={13} tone={desk.inkMuted}>{r.cheap}</T></TCell>
          <TCell width={120}><T size={13} tone={desk.inkMuted}>{r.mid}</T></TCell>
          <TCell width={120}><T size={13} tone={desk.inkMuted}>{r.dear}</T></TCell>
        </TRow>
      ))}
    </Table>
  );
}

type SubRow = NonNullable<FactPageResp['subcategories']>[number];

function SubsTable({ f, canManage, onOpenSub, onPlaces, onRemove }: {
  f: FactPageResp; canManage: boolean; onOpenSub: (key: string) => void; onPlaces: (key: string) => void; onRemove: (s: SubRow) => void;
}) {
  const cols: TCol[] = [
    { key: 'sub', name: 'Subcategory', width: 240 }, { key: 'cat', name: 'Category', width: 150 },
    { key: 'places', name: 'Places with it', width: 360 }, { key: 'x', name: '', width: 110 },
  ];
  const list = f.subcategories ?? [];
  return (
    <Table width={tableWidth(cols)}>
      <THead cols={cols} />
      {list.length === 0 ? <Muted size={13}>No subcategory looks for it.</Muted> : list.map((s) => (
        <TRow key={s.key}>
          <TCell width={240}>
            <Press effect="none" onPress={() => onOpenSub(s.key)}><T weight="700">{s.label}</T></Press>
          </TCell>
          <TCell width={150}><T size={13} tone={desk.inkMuted}>{s.category}</T></TCell>
          <TCell width={360}>
            {s.status === 'active' ? (
              <Press effect="none" onPress={() => onPlaces(s.key)} style={{ alignSelf: 'flex-start' }}>
                <Text style={[{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '800', color: desk.ink, borderBottomWidth: 1.5, borderBottomColor: LIME, paddingBottom: 1 }, tabular]}>{n(s.places)}</Text>
              </Press>
            ) : <T size={12.5} tone={desk.inkDim}>{s.note ?? ''}</T>}
          </TCell>
          <TCell width={110} style={{ alignItems: 'flex-end' }}>
            {canManage ? (
              <Press effect="none" onPress={() => onRemove(s)} accessibilityLabel="Stop looking for it here">
                <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted, borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 5, paddingHorizontal: 12 }}>Remove</Text>
              </Press>
            ) : null}
          </TCell>
        </TRow>
      ))}
    </Table>
  );
}

// ---------------------------------------------------------------------------
// The places that have it
// ---------------------------------------------------------------------------

/** The Facts tab's drill-down (`?tab=facts&fact=<key>&places=1`, optional `sub`). */
export function FactPlaces({ fact, canManage }: { fact: string; canManage: boolean }) {
  const go = useDeskGo();
  const [sub] = useDeskParam('sub');
  return (
    <PlacesDrill
      fact={fact}
      sub={sub || null}
      canManage={canManage}
      crumbs={(d) => (d?.standard
        // A standard fact's places sit one level under Facts: "Facts / Duration".
        ? [{ name: 'Facts', go: () => go('facts') }, { name: d.label }]
        : [
          { name: 'Facts', go: () => go('facts') },
          { name: d?.label ?? '', go: () => go('facts', { fact }) },
          { name: d?.subLabel ?? 'Places with it' },
        ])}
    />
  );
}

const HOW_MIN = 140;
const EDIT_W = 150;
const OUTCOME_TONE: Record<string, string> = { verified: LIME, conflict: RED, no: desk.ink };

/**
 * The places that have a fact (README v2 drill-down; prototype `isFact`):
 * Place · (Answer) · Area · How we know · Edit, filters and a search in the
 * address, "Looked for at N places · found at M" under it, and beside it the
 * fact's VERIFICATION column from our own tables. Used by the Facts tab and
 * by a subcategory's fact (Categories › a subcategory › a fact).
 */
export function PlacesDrill({ fact, sub, canManage, crumbs }: {
  fact: string; sub: string | null; canManage: boolean; crumbs: (d: PlacesResp | null) => Crumb[];
}) {
  const go = useDeskGo();
  const { width } = useViewport();
  const narrow = width < 900;
  const [q, setQ] = useDeskParam('q');
  const [country, setCountry] = useDeskParam('country');
  const [county, setCounty] = useDeskParam('county');
  const [postcode, setPostcode] = useDeskParam('pc');
  const [text, setText] = useState(q);
  const typed = useDebounced(text);
  React.useEffect(() => { setText(q); }, [q]);
  React.useEffect(() => { if (typed !== q) setQ(typed, { replace: true }); }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState<string | null>(null);
  const load = useDesk<PlacesResp>(`/facts/${encodeURIComponent(fact)}/places`, {
    sub, country: country || null, county: county || null, postcode: postcode || null, q: q || null,
  });
  const write = useWrite(load.reload);
  const d = load.data;
  useCrumbs(crumbs(d), [d?.label, d?.subLabel, d?.standard, fact, sub]);

  const multi = d ? d.kind !== 'yesno' : false;
  // The left column's own width: the table fills it, "How we know" takes what
  // is left (never under 140, prototype template 272-279), and where even
  // that does not fit — a range's Answer column at 1440 beside VERIFICATION —
  // Place gives up the difference rather than the table running under the
  // column beside it (audit, 28 Sep 2026).
  const [leftW, setLeftW] = useState(0);
  const cols = useMemo(() => {
    const fixed = (multi ? 110 : 0) + 160 + HOW_MIN + EDIT_W + 16 * (multi ? 4 : 3);
    const placeW = leftW && !narrow ? Math.max(150, Math.min(230, leftW - fixed)) : 230;
    const c: TCol[] = [{ key: 'place', name: 'Place', width: placeW }];
    if (multi) c.push({ key: 'answer', name: 'Answer', width: 110 });
    c.push({ key: 'area', name: 'Area', width: 160 }, { key: 'how', name: 'How we know', width: HOW_MIN, grow: true }, { key: 'edit', name: '', width: EDIT_W });
    return c;
  }, [multi, leftW, narrow]);
  const placeW = cols[0].width;
  // An open Edit sizes to its pills, but never past the column: what the other
  // cells leave at their least (a range's five bands wrap between pills there).
  const editMax = leftW && !narrow
    ? Math.max(EDIT_W, leftW - (placeW + (multi ? 110 : 0) + 160 + HOW_MIN + 16 * (multi ? 4 : 3)))
    : 340;

  if (!d) return <LoadLine load={load} what="These places" />;
  const found = `${multi ? 'Answered at' : 'Found at'} ${plural(d.foundAt, 'place')}`;
  const where = d.sub ? [d.categoryLabel, d.subLabel].filter(Boolean).join(' › ') : d.standard ? 'Standard fact · every place' : null;
  const looked = `${multi ? 'Asked at' : 'Looked for at'} ${d.lookedFor == null ? '—' : n(d.lookedFor)} places · ${multi ? 'answered at' : 'found at'} ${n(d.foundAt)}`;
  const drop = (label: string, all: string, values: string[], value: string, set: (v: string, o?: { replace?: boolean }) => void) => (
    <Dropdown
      key={label}
      label={value || all}
      value={value}
      width={170}
      options={[{ key: '', name: all }, ...values.map((c) => ({ key: c, name: c }))]}
      onChange={(v) => set(v, { replace: true })}
    />
  );

  return (
    <>
      <View style={{ gap: 6, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18 }}>
        <Title>{d.label}</Title>
        <Text style={[{ fontFamily: fonts.body, fontSize: 15, fontWeight: '800', color: desk.link }, tabular]}>{found}</Text>
        {where ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{where}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', zIndex: 15 }}>
        <SearchBox value={text} onChange={setText} placeholder="Search places" width={narrow ? Math.min(260, width - 32) : 260} />
        {drop('country', 'All countries', d.countries, country, setCountry)}
        {drop('county', 'All counties', d.counties, county, setCounty)}
        {drop('pc', 'All postcodes', d.postcodes, postcode, setPostcode)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 36, alignItems: 'flex-start' }}>
        <View onLayout={(e) => setLeftW(Math.floor(e.nativeEvent.layout.width))} style={{ flexGrow: 1, flexShrink: 1, flexBasis: narrow ? '100%' : 640, minWidth: 0 }}>
          <Table width={tableWidth(cols, 16, 0)} fill>
            <THead cols={cols} gap={16} pad={0} />
            {d.rows.length === 0 ? <Muted size={13}>No places match.</Muted> : d.rows.map((p) => {
              const open = editing === p.ref;
              return (
                <TRow key={p.ref} gap={16} pad={0}>
                  <TCell width={placeW}><T weight="700">{p.name ?? 'A place we cannot name'}</T></TCell>
                  {multi ? <TCell width={110}><T size={13} weight="700">{p.answer ?? '—'}</T></TCell> : null}
                  <TCell width={160}><T size={13} tone={desk.inkMuted}>{p.area ?? '—'}</T></TCell>
                  <TCell width={HOW_MIN} grow><HowWeKnow how={p.how} evidence={p.evidence ?? []} /></TCell>
                  {/* Sized to its pills when open, so "Don't know" stays on one line (audit, 28 Sep 2026). */}
                  <View style={{ minWidth: EDIT_W, maxWidth: editMax, flexShrink: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                    {!canManage ? null : open ? d.options.map((o) => (
                      <OptPill
                        key={o.key}
                        label={o.label}
                        on={o.key === p.current}
                        onPress={() => {
                          setEditing(null);
                          write(
                            () => deskApi.put<{ id: string }>(`/places/${encodeURIComponent(p.ref)}/facts/${encodeURIComponent(d.fact)}`, { option: o.key }),
                            `${d.label} on ${p.name ?? p.ref} → ${o.label} · logged as a correction`,
                          );
                        }}
                      />
                    )) : (
                      <Press effect="none" onPress={() => setEditing(p.ref)}>
                        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>Edit</Text>
                      </Press>
                    )}
                  </View>
                </TRow>
              );
            })}
            {d.total > d.rows.length ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, paddingTop: 8 }}>{`The first ${n(d.rows.length)} of ${n(d.total)} — narrow with the filters to see the rest`}</Text>
            ) : null}
            <Text style={[{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, paddingTop: 8 }, tabular]}>{looked}</Text>
          </Table>
        </View>
        <View style={{
          width: narrow ? '100%' : 340, gap: 12,
          borderLeftWidth: narrow ? 0 : 1, borderLeftColor: desk.rule, paddingLeft: narrow ? 0 : 28,
          borderTopWidth: narrow ? 1 : 0, borderTopColor: desk.rule, paddingTop: narrow ? 18 : 0,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <Kicker>Verification</Kicker>
            <Press effect="none" onPress={() => go('facts', { ftab: 'verification', view: 'backlog', feature: d.label })}>
              <Text style={[{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted }, tabular]}>{n(d.queued)} in the queue</Text>
            </Press>
          </View>
          {d.queue.map((x) => (
            <View key={x.ref} style={{ gap: 2, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
              <T size={13} weight="700">{x.place ?? 'A place we cannot name'}</T>
              <T size={12} tone={x.conflict ? RED : desk.inkDim}>{x.line}</T>
            </View>
          ))}
          <View style={{ paddingTop: 8 }}><Kicker>Recent outcomes</Kicker></View>
          {d.outcomes.length === 0 ? <T size={12.5} tone={desk.inkDim}>None yet.</T> : d.outcomes.map((o, i) => (
            <View key={`${o.ref}-${i}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
              <View style={{ flex: 1, minWidth: 0 }}><T size={12.5} weight="700">{o.place ?? 'A place we cannot name'}</T></View>
              <T size={12} weight="800" tone={OUTCOME_TONE[o.key] ?? desk.inkDim}>{o.outcome}</T>
              <T size={11.5} tone={desk.inkDim}>{o.source}</T>
            </View>
          ))}
        </View>
      </View>
    </>
  );
}

/**
 * How we know, for one place (owner, round 3, 29 Sep 2026): the sources in
 * one line, then each source's own words — italic, one line, the whole of it
 * on a press — and a link to the page it came from where we hold one. Only
 * our own sources are here; Families are counted in the line, never quoted.
 */
function HowWeKnow({ how, evidence }: { how: string | null; evidence: Evidence[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={{ gap: 4, minWidth: 0 }}>
      <T size={12.5} tone={desk.inkMuted}>{how ?? '—'}</T>
      {evidence.filter((e) => e.quote || e.url).map((e) => {
        const isOpen = open === e.source;
        return (
          <View key={e.source} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '700', color: desk.inkDim }}>{e.word}</Text>
            {e.quote ? (
              <Press effect="none" onPress={() => setOpen(isOpen ? null : e.source)} style={{ flex: 1, minWidth: 0 }} accessibilityLabel={isOpen ? 'Show one line' : 'Show the whole quote'}>
                <Text numberOfLines={isOpen ? undefined : 1} style={{ fontFamily: fonts.body, fontSize: 12, fontStyle: 'italic', color: desk.inkMuted }}>{`“${e.quote}”`}</Text>
              </Press>
            ) : <View style={{ flex: 1 }} />}
            {e.url ? (
              <Press effect="none" onPress={() => { void Linking.openURL(e.url!); }} accessibilityRole="link" accessibilityLabel={`Open the ${e.word} page`}>
                <Icon name="external" size={13} color={desk.inkDim} />
              </Press>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
