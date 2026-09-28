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
import { Text, View } from 'react-native';

import { Press } from '../../../components/press';
import { useCrumbs, useDeskGo, useDeskParam } from '../Desk';
import {
  Dropdown, HeadCount, Kicker, LIME, Muted, PageTitle, Pills, SearchBox, T, TCell, THead, TRow, Table,
  deskApi, desk, fonts, n, sortRows, tableWidth, tabular, type SortState, type TCol,
} from '../kit';
import { FactTabs, LoadLine, Title, nameWidth, plural, useDebounced, useDesk, useWrite } from './shared';

// ---------------------------------------------------------------------------
// Shapes (apps/api/src/desk/facts.js)
// ---------------------------------------------------------------------------

type Status = 'active' | 'gathering' | 'ignored';
type FactRow = {
  fact: string; label: string; standard: boolean; subcategories: string; subcategoryCount: number | null;
  places: number | null; status: Status; statusText: string; isNew: boolean; reason: string | null;
};
type AllFactsResp = { counts: { facts: number; active: number; gathering: number; ignored: number }; rows: FactRow[] };
type Catalogue = { categories: { key: string; label: string }[]; subcategories: { key: string; label: string; category: string }[] };

type Band = { name: string; means: string };
type CostRow = { country: string; currency: string; free: string; cheap: string; mid: string; dear: string };
type FactPageResp = {
  fact: string; label: string; kind: string; standard: boolean; status: Status; statusText: string; isNew: boolean;
  places: number | null; needed?: number;
  definition?: { shape: string; line: string | null; bands?: Band[]; cost?: CostRow[] };
  subcategories?: { key: string; label: string; category: string; categoryKey: string; places: number; status: Status; isNew: boolean; note: string | null }[];
  conflicts: number; conflictLine: string | null;
};
type PlaceRow = {
  ref: string; name: string | null; area: string | null; county: string | null; country: string | null; postcode: string | null;
  how: string | null; answer: string | null; current: string | null;
};
type PlacesResp = {
  fact: string; label: string; kind: string; standard: boolean; sub: string | null; subLabel: string | null; categoryLabel: string | null;
  options: { key: string; label: string }[]; rows: PlaceRow[]; total: number; lookedFor: number; foundAt: number;
  counties: string[]; countries: string[]; postcodes: string[];
};

const STATUS_OPTS: { key: string; name: string }[] = [
  { key: '', name: 'All statuses' }, { key: 'active', name: 'Active' }, { key: 'gathering', name: 'Gathering evidence' }, { key: 'ignored', name: 'Ignored' },
];
const ORDER: Record<Status, number> = { active: 0, gathering: 1, ignored: 2 };

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
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });

  const load = useDesk<AllFactsResp>('/facts', { q: q || null, cat: cat || null, sub: sub || null, status: state || null });
  const cata = useDesk<Catalogue>('/mapping/picker');
  useCrumbs([{ name: 'Facts' }], []);

  const all = load.data?.rows ?? [];
  const factW = nameWidth(all.map((r) => r.label));
  const cols: TCol[] = [
    { key: 'name', name: 'Fact', width: factW, first: 'asc' },
    { key: 'subs', name: 'Subcategories', width: 150, first: 'asc' },
    { key: 'places', name: 'Places with it', width: 150, first: 'asc' },
    { key: 'status', name: 'Status', width: 150, first: 'asc' },
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
        <PageTitle tip="Every fact Epic looks for, once each. Active means we’re finding it at places; Gathering evidence means we’ve seen it mentioned but not confirmed enough yet; Ignored means it tells a family nothing.">All facts</PageTitle>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 26, flexWrap: 'wrap' }}>
          <HeadCount label="Facts" n={n(counts?.facts)} />
          <HeadCount label="Active" n={n(counts?.active)} tone={LIME} />
          <HeadCount label="Gathering evidence" n={n(counts?.gathering)} tone={desk.inkMuted} />
          <HeadCount label="Ignored" n={n(counts?.ignored)} tone={desk.inkDim} />
        </View>
      </View>
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
            <TRow key={r.fact} onPress={() => go('facts', { fact: r.fact })}>
              <TCell width={factW}><T weight="700">{r.label}</T></TCell>
              <TCell width={150}><T tone={desk.inkMuted} num lines={1}>{r.subcategories}</T></TCell>
              <TCell width={150}><T weight="800" num>{n(r.places)}</T></TCell>
              <TCell width={150}><View style={{ minHeight: 20, justifyContent: 'center' }}><T size={13} tone={desk.inkMuted} lines={1}>{r.statusText}</T></View></TCell>
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

export function FactPlaces({ fact, canManage }: { fact: string; canManage: boolean }) {
  const go = useDeskGo();
  const [sub] = useDeskParam('sub');
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const [country, setCountry] = useState('');
  const [county, setCounty] = useState('');
  const [postcode, setPostcode] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const load = useDesk<PlacesResp>(`/facts/${encodeURIComponent(fact)}/places`, {
    sub: sub || null, country: country || null, county: county || null, postcode: postcode || null, q: q || null,
  });
  const write = useWrite(load.reload);
  const d = load.data;
  useCrumbs([
    { name: 'Facts', go: () => go('facts') },
    { name: d?.label ?? '', go: () => go('facts', { fact }) },
    { name: d?.subLabel ?? 'Places with it' },
  ], [d?.label, d?.subLabel, fact]);

  const multi = d ? d.kind !== 'yesno' : false;
  const cols = useMemo(() => {
    const c: TCol[] = [{ key: 'place', name: 'Place', width: 230 }];
    if (multi) c.push({ key: 'answer', name: 'Answer', width: 110 });
    c.push({ key: 'area', name: 'Area', width: 160 }, { key: 'how', name: 'How we know', width: 180 }, { key: 'edit', name: '', width: 150 });
    return c;
  }, [multi]);

  if (!d) return <LoadLine load={load} what="These places" />;
  const found = `${multi ? 'Answered at' : 'Found at'} ${plural(d.foundAt, 'place')}`;
  const where = d.sub ? [d.categoryLabel, d.subLabel].filter(Boolean).join(' › ') : d.standard ? 'Standard fact · every place' : null;
  const looked = multi
    ? `Asked at ${n(d.lookedFor)} places · answered at ${n(d.foundAt)}`
    : `Looked for at ${n(d.lookedFor)} places · found at ${n(d.foundAt)}`;

  return (
    <>
      <View style={{ gap: 6, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18 }}>
        <Title>{d.label}</Title>
        <Text style={{ fontFamily: fonts.body, fontSize: 15, fontWeight: '800', color: LIME }}>{found}</Text>
        {where ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{where}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', zIndex: 15 }}>
        <SearchBox value={text} onChange={setText} placeholder="Search places" width={260} />
        <Dropdown label={country || 'All countries'} value={country} width={170}
          options={[{ key: '', name: 'All countries' }, ...d.countries.map((c) => ({ key: c, name: c }))]} onChange={setCountry} />
        <Dropdown label={county || 'All counties'} value={county} width={170}
          options={[{ key: '', name: 'All counties' }, ...d.counties.map((c) => ({ key: c, name: c }))]} onChange={setCounty} />
        <Dropdown label={postcode || 'All postcodes'} value={postcode} width={170}
          options={[{ key: '', name: 'All postcodes' }, ...d.postcodes.map((c) => ({ key: c, name: c }))]} onChange={setPostcode} />
      </View>
      <View>
        <Table width={tableWidth(cols, 16, 0)}>
          <THead cols={cols} gap={16} pad={0} />
          {d.rows.length === 0 ? <Muted size={13}>No places match.</Muted> : d.rows.map((p) => {
            const open = editing === p.ref;
            return (
              <TRow key={p.ref} gap={16} pad={0}>
                <TCell width={230}><T weight="700">{p.name ?? p.ref}</T></TCell>
                {multi ? <TCell width={110}><T size={13} weight="700">{p.answer ?? '—'}</T></TCell> : null}
                <TCell width={160}><T size={13} tone={desk.inkMuted}>{p.area ?? '—'}</T></TCell>
                <TCell width={180}><T size={12.5} tone={desk.inkMuted}>{p.how ?? '—'}</T></TCell>
                <TCell width={150} style={{ alignItems: 'flex-end' }}>
                  {!canManage ? null : open ? (
                    <Pills
                      options={d.options.map((o) => ({ key: o.key, name: o.label }))}
                      value={p.current}
                      onChange={(opt) => {
                        setEditing(null);
                        const word = d.options.find((o) => o.key === opt)?.label ?? opt;
                        write(
                          () => deskApi.put<{ id: string }>(`/places/${encodeURIComponent(p.ref)}/facts/${encodeURIComponent(d.fact)}`, { option: opt }),
                          `${d.label} on ${p.name ?? p.ref} → ${word} · logged as a correction`,
                        );
                      }}
                    />
                  ) : (
                    <Press effect="none" onPress={() => setEditing(p.ref)}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>Edit</Text>
                    </Press>
                  )}
                </TCell>
              </TRow>
            );
          })}
          {d.total > d.rows.length ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, paddingTop: 8 }}>{`The first ${n(d.rows.length)} of ${n(d.total)} — narrow with the filters to see the rest`}</Text>
          ) : null}
          <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, paddingTop: 8 }}>{looked}</Text>
        </Table>
      </View>
    </>
  );
}
