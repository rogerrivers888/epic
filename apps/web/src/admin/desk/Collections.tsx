/**
 * Collections (renamed from Ideas) — the rows families see in Inspire (design
 * README v2 "Collections"; prototype blocks `isRows` and `isHousehold`).
 *
 * The list: "N collections" with its (i), New collection and See as a
 * household, the shared location filter, and a compact sortable table —
 * Collection · Places (or "Places within reach") · Shown to · Shown · Opened ·
 * Hearted. Engagement reads "—" until there are real households (the API's
 * `null`). A row opens the editor above the table, filled in; New collection
 * opens it empty. The editor's right side is What it would return, and a
 * place there opens a side drawer.
 *
 * Who sees a collection is derived from its rule and shown in the list only;
 * the editor has no audience line and no Cancel — the single × closes it.
 *
 * Query: `collection` (a key, or 'new'), `view` ('household'), `place` (the
 * side drawer's place), `state` (See as a household's five states). Opening
 * something pushes; a state replaces.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Platform, ScrollView, Text, TextInput, View, type ViewStyle } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { CREAM, INK, LIME, ON_LIME, PALETTES, desk, fonts } from '../../theme';
import { useCrumbs, useDeskParam } from './Desk';
import {
  Dropdown, InfoTip, Kicker, LocationFilter, Muted, RED, Seg, T, TCell, THead, TRow, Table,
  deskApi, locParams, n, saidOf, sortRows, tableWidth, tabular, useLocation, useToast,
  type SortState, type TCol,
} from './kit';
import { RulePicker, type Catalogue, type RuleKind } from './Picker';

// ---------------------------------------------------------------------------
// What the API answers (apps/api/src/desk/collections.js)

type Item = { id: string; not: boolean };
type Cost = 'Free' | 'Cheap' | 'Mid' | 'Dear';
type Rule = {
  cats: Item[]; subs: Item[]; facts: Item[];
  ages: [number, number] | null; dur: [number, number] | null; cost: Cost[];
  // Two the handover's own collections need; carried through, not edited here.
  ageSpan?: boolean; primaryCat?: string | null;
};
type Row = {
  key: string; title: string; copy: string | null; rule: Rule; audience: { key: string; label: string };
  /** Null where the location filter cannot speak; `placesAtLeast` where it is a floor. */
  places: number | null; placesAtLeast?: boolean; shown: number | null; opened: number | null; hearted: number | null;
  /** Still written in the older form, and the pills cannot say it exactly: its words. */
  legacyText?: string | null;
};
type Filter = {
  unknown?: boolean; where: string; label?: string; chip?: string; approx?: boolean; capped?: boolean; message?: string;
  /** Can't-speak (location.js `filterSays`): whether its counts speak, whether they are floors, and why. */
  speaks?: boolean; atLeast?: boolean; why?: string | null;
} | null;
type List = { rows: Row[]; count: number; engagementSpeaks: boolean; atLeast: boolean; filter: Filter };
type Preview = { count: number | null; atLeast?: boolean; anywhere?: number; examples: { ref: string; name: string; sub: string; subLabel: string; town: string | null }[] };
type Card = {
  ref: string; name: string | null; image: string | null; sub: string | null; town: string | null; sentence: string | null;
  facts: { name: string; value: string | null }[]; collections: { key: string; title: string }[];
};
type Saved = { key: string; created: boolean; change?: { id: string } | null };

const EMPTY: Rule = { cats: [], subs: [], facts: [], ages: null, dur: null, cost: [] };
const COSTS: { key: Cost; name: string }[] = [
  { key: 'Free', name: 'Free' }, { key: 'Cheap', name: '£' }, { key: 'Mid', name: '££' }, { key: 'Dear', name: '£££' },
];
const TIP = 'A collection is a row families see in Inspire. Its rule decides which places it gathers, from any category. Who sees it follows from the rule — a 0–3 collection is shown to households with someone that age.';

const web = Platform.OS === 'web';
const noOutline = web ? ({ outlineStyle: 'none' } as object) : null;
const hasRule = (r: Rule) => r.cats.length > 0 || r.subs.length > 0 || r.facts.length > 0 || !!r.ages || !!r.dur || r.cost.length > 0 || !!r.primaryCat;
const qs = (p: Record<string, string | number>) => {
  const s = Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return s ? `?${s}` : '';
};

// ---------------------------------------------------------------------------

export function Collections({ canManage = false }: { canManage?: boolean }) {
  const [view] = useDeskParam('view');
  const [place, setPlace] = useDeskParam('place');
  return (
    <>
      {view === 'household' ? <Household /> : <CollectionList canManage={canManage} />}
      {place ? <PlaceDrawer placeRef={place} onClose={() => setPlace('', { replace: false })} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The list and its editor

type ColKey = 'title' | 'places' | 'audience' | 'shown' | 'opened' | 'hearted';
const SORT_KEYS: ColKey[] = ['title', 'places', 'audience', 'shown', 'opened', 'hearted'];

function CollectionList({ canManage }: { canManage: boolean }) {
  const narrow = useViewport().width < 900;
  const toast = useToast();
  const { setQuery } = useRouter();
  const { loc, setAnswer } = useLocation();
  const [open] = useDeskParam('collection');
  const [list, setList] = useState<List | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [minPlaces, setMinPlaces] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The sort is part of the address (owner rule), written only when it is not
  // the default (Collection, A to Z); a sort replaces, never pushes.
  const [sortRaw, setSortRaw] = useDeskParam('sort');
  const sort: SortState<ColKey> = useMemo(() => {
    const [k, d] = sortRaw.split('.');
    return SORT_KEYS.includes(k as ColKey) ? { key: k as ColKey, dir: d === 'desc' ? 'desc' : 'asc' } : { key: 'title', dir: 'asc' };
  }, [sortRaw]);
  const setSort = (next: SortState<ColKey>) => setSortRaw(next && !(next.key === 'title' && next.dir === 'asc') ? `${next.key}.${next.dir}` : '', { replace: true });

  const params = useMemo(() => locParams(loc), [loc]);
  const load = useCallback(async () => {
    try {
      const out = await deskApi.get<List>('/collections', params);
      setList(out); setError(null);
      const f = out.filter;
      setAnswer(f ? { known: !f.unknown, label: f.label ?? null, chip: f.chip ?? null, approx: f.approx, capped: f.capped } : null);
    } catch (err) { setError(saidOf(err)); }
  }, [params, setAnswer]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    deskApi.get<Catalogue>('/mapping/picker').then(setCatalogue).catch((err) => setError(saidOf(err)));
    deskApi.get<{ values: Record<string, unknown> }>('/settings')
      .then((s) => setMinPlaces(typeof s.values.collectionMinPlaces === 'number' ? s.values.collectionMinPlaces : null))
      .catch(() => setMinPlaces(null));
  }, []);

  const within = Boolean(list?.filter && !list.filter.unknown);
  const cols: TCol<ColKey>[] = [
    { key: 'title', name: 'Collection', width: 300, first: 'asc' },
    // Places ascends first, so the thinnest come first for the chosen location.
    { key: 'places', name: within ? 'Places within reach' : 'Places', width: within ? 140 : 90, first: 'asc' },
    { key: 'audience', name: 'Shown to', width: 260, first: 'asc' },
    { key: 'shown', name: 'Shown', width: 90, first: 'desc' },
    { key: 'opened', name: 'Opened', width: 90, first: 'desc' },
    { key: 'hearted', name: 'Hearted', width: 90, first: 'desc' },
  ];
  const rows = useMemo(() => sortRows(list?.rows ?? [], sort, (r, k) => {
    if (k === 'title') return r.title;
    if (k === 'audience') return r.audience.label;
    return r[k as 'places' | 'shown' | 'opened' | 'hearted'];
  }), [list, sort]);

  const editing = open === 'new' ? null : list?.rows.find((r) => r.key === open) ?? null;
  const editorOpen = open === 'new' || !!editing;

  // Opening the editor is a step, so it pushes.
  const openRow = (key: string | null) => setQuery({ collection: key, place: null }, { replace: false });
  // The list is the tab's root: no breadcrumb (and none left over from See as a household).
  useCrumbs([], []);

  if (error && !list) return <Muted>{error}</Muted>;

  return (
    <View style={{ gap: 18 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap',
        borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18, zIndex: 20,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32.2, color: desk.ink }}>
            {list ? `${n(list.count)} ${list.count === 1 ? 'collection' : 'collections'}` : 'Collections'}
          </Text>
          <InfoTip text={TIP} width={380} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Press effect="none" onPress={() => setQuery({ view: 'household', collection: null, place: null }, { replace: false })}>
            <Text style={{ borderWidth: 1.5, borderColor: desk.ruleStrong, color: desk.inkMuted, paddingVertical: 9, paddingHorizontal: 16, fontFamily: fonts.body, fontSize: 13, lineHeight: 20.15, fontWeight: '700' }}>See as a household</Text>
          </Press>
          <Press effect="none" onPress={() => openRow('new')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: LIME, paddingVertical: 10, paddingHorizontal: 16 }}>
              <Icon name="add" size={14} color={ON_LIME} />
              <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 20.15, fontWeight: '700', color: ON_LIME }}>New collection</Text>
            </View>
          </Press>
        </View>
      </View>

      <LocationFilter />

      {editorOpen && catalogue ? (
        <Editor
          key={open}
          row={editing}
          catalogue={catalogue}
          narrow={narrow}
          params={params}
          within={within}
          canManage={canManage}
          onClose={() => openRow(null)}
          onPlace={(ref) => setQuery({ place: ref }, { replace: false })}
          onSaved={async (title, created, change) => {
            openRow(null);
            await load();
            toast(`${title} ${created ? 'added' : 'saved'}`, change ? async () => {
              try { await deskApi.post(`/undo/${encodeURIComponent(change)}`); setError(null); await load(); toast('Undone'); } catch (err) { setError(saidOf(err)); }
            } : null);
          }}
        />
      ) : null}

      {error ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: RED }}>{error}</Text> : null}

      {!list ? <Muted>Loading…</Muted> : (
        <View style={{ marginTop: 6 }}>
          <Table width={tableWidth(cols, 24)}>
            <THead cols={cols} sort={sort} onSort={setSort} gap={24} />
            {!rows.length ? <Muted>No collections yet.</Muted> : null}
            {rows.map((r) => {
              const thin = minPlaces != null && r.places != null && r.places < minPlaces;
              // The open row is the picked colour (prototype #232120); a click
              // on it opens it again rather than closing it — the × closes.
              return (
                <TRow key={r.key} gap={24} vpad={11} lifted={open === r.key} onPress={() => { if (open !== r.key) openRow(r.key); }}>
                  <TCell width={300}>
                    <View style={{ gap: 2 }}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20.9, fontWeight: '700', color: desk.ink }}>{r.title}</Text>
                      {r.copy ? <Text style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: 18.6, color: desk.inkDim }}>{r.copy}</Text> : null}
                    </View>
                  </TCell>
                  <TCell width={within ? 140 : 90}>
                    {/* Null is "cannot say" — a dash, with why on hover; a floor reads "N+". */}
                    <View {...(r.places == null && list.filter?.why ? ({ title: list.filter.why } as object) : {})}>
                      <T num tone={thin || r.places == null ? desk.inkDim : desk.ink}>{r.places == null ? '—' : `${n(r.places)}${r.placesAtLeast ? '+' : ''}`}</T>
                    </View>
                  </TCell>
                  <TCell width={260}><T size={12.5} tone={desk.inkMuted}>{r.audience.label}</T></TCell>
                  <TCell width={90}><T size={13} num tone={desk.inkDim}>{n(r.shown)}</T></TCell>
                  <TCell width={90}><T size={13} num tone={desk.inkDim}>{n(r.opened)}</T></TCell>
                  <TCell width={90}><T size={13} num tone={desk.inkDim}>{n(r.hearted)}</T></TCell>
                </TRow>
              );
            })}
          </Table>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The editor: new and existing, the same screen

function Editor({ row, catalogue, narrow, params, within, canManage, onClose, onPlace, onSaved }: {
  row: Row | null; catalogue: Catalogue; narrow: boolean; params: Record<string, string | number>; within: boolean; canManage: boolean;
  onClose: () => void; onPlace: (ref: string) => void; onSaved: (title: string, created: boolean, change: string | null) => void;
}) {
  const [title, setTitle] = useState(row?.title ?? '');
  const [copy, setCopy] = useState(row?.copy ?? '');
  // A row still written in the older form that the pills cannot say exactly
  // opens with no pills: its rule is shown in words, read-only, and whatever
  // is picked here replaces it on Save (audit, 28 Sep 2026 — pills that
  // returned a different set from the list's count were a lie).
  const legacy = row?.legacyText ?? null;
  const [rule, setRule] = useState<Rule>(() => (row && !legacy ? JSON.parse(JSON.stringify(row.rule)) as Rule : { ...EMPTY }));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // What it would return, asked again as the rule changes (debounced).
  useEffect(() => {
    if (!hasRule(rule)) { setPreview(null); return; }
    const mine = ++seq.current;
    setPreviewing(true);
    const t = setTimeout(() => {
      deskApi.post<Preview>(`/collections/preview${qs(params)}`, { rule })
        .then((p) => { if (mine === seq.current) { setPreview(p); setError(null); } })
        .catch((err) => { if (mine === seq.current) setError(saidOf(err)); })
        .finally(() => { if (mine === seq.current) setPreviewing(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [rule, params]);

  const any = hasRule(rule);
  const count = preview?.count ?? 0;
  const countSpeaks = preview?.count != null;
  // Save is judged on the whole estate (the server's rule): a rule that
  // returns nothing within this location's reach may still be a collection.
  const anywhere = preview?.anywhere ?? count;
  const ready = title.trim().length > 0 && any && !!preview && anywhere > 0 && !previewing;
  const saveLabel = !title.trim() ? 'Give it a title' : !any ? 'Add a rule' : previewing || !preview ? 'Counting…' : !anywhere ? 'Returns nothing' : 'Save';

  const toggle = (kind: RuleKind, id: string) => setRule((r) => {
    const list = r[kind];
    return { ...r, [kind]: list.some((x) => x.id === id) ? list.filter((x) => x.id !== id) : [...list, { id, not: false }] };
  });
  const flip = (kind: RuleKind, id: string) => setRule((r) => ({ ...r, [kind]: r[kind].map((x) => (x.id === id ? { ...x, not: !x.not } : x)) }));
  const nameOf = (kind: RuleKind, id: string) => (kind === 'cats' ? catalogue.categories.find((c) => c.key === id)?.label
    : kind === 'subs' ? catalogue.subcategories.find((s) => s.key === id)?.label
      : catalogue.facts.find((f) => f.key === id)?.label) ?? id;

  const save = async () => {
    if (!ready || saving) return;
    if (!canManage) { setError('Only someone who manages the library can change this.'); return; }
    setSaving(true);
    try {
      const body = { title: title.trim(), copy: copy.trim(), rule };
      const out = row
        ? await deskApi.put<Saved>(`/collections/${encodeURIComponent(row.key)}`, body)
        : await deskApi.post<Saved>('/collections', body);
      onSaved(title.trim(), out.created, out.change?.id ?? null);
    } catch (err) { setError(saidOf(err)); } finally { setSaving(false); }
  };

  const range = (key: 'ages' | 'dur', lo: string, hi: string) => {
    const a = lo === '' ? null : Number(lo); const b = hi === '' ? null : Number(hi);
    setRule((r) => ({ ...r, [key]: a == null && b == null ? null : [a ?? 0, b ?? (key === 'ages' ? 99 : 12)] }));
  };

  const input = (style: object) => [{ backgroundColor: desk.well, borderWidth: 1.5, borderColor: desk.ruleStrong }, style, noOutline];

  return (
    <View style={{ gap: 16, borderTopWidth: 2, borderTopColor: LIME, borderBottomWidth: 1, borderBottomColor: desk.rule, backgroundColor: desk.lifted, paddingTop: 18, paddingHorizontal: narrow ? 14 : 20, paddingBottom: 20, zIndex: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Kicker>{row ? 'EDIT COLLECTION' : 'NEW COLLECTION'}</Kicker>
        <Press effect="none" onPress={onClose} accessibilityLabel="Close">
          <View style={{ paddingHorizontal: 4 }}><Icon name="close" size={20} color={desk.inkDim} /></View>
        </Press>
      </View>
      <View style={{ flexDirection: narrow ? 'column' : 'row', gap: 32, alignItems: narrow ? 'stretch' : 'flex-start' }}>
        {/* Left: title, copy line, which places, ages, duration, cost. */}
        <View style={{ flex: narrow ? undefined : 1, flexBasis: narrow ? undefined : 560, minWidth: 0, gap: 14 }}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title — what a household reads"
            placeholderTextColor={desk.inkDim}
            style={input({ color: desk.ink, fontFamily: fonts.heading, fontSize: 18, fontWeight: '800', paddingVertical: 10, paddingHorizontal: 12 })}
          />
          <TextInput
            value={copy}
            onChangeText={setCopy}
            placeholder="Copy line — the sentence that makes the title land"
            placeholderTextColor={desk.inkDim}
            style={input({ color: desk.inkMuted, fontFamily: fonts.body, fontSize: 13.5, paddingVertical: 9, paddingHorizontal: 12 })}
          />
          <View style={{ paddingTop: 6 }}><Kicker>WHICH PLACES</Kicker></View>
          {legacy ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19.4, color: desk.inkMuted }}>
              <Text style={{ fontWeight: '700', color: desk.inkDim }}>Written in the older form · </Text>{legacy}
            </Text>
          ) : null}
          <View style={{ gap: 8 }}>
            {([['cats', 'CATEGORY'], ['subs', 'SUB-CATEGORY'], ['facts', 'FACT']] as [RuleKind, string][]).filter(([kind]) => rule[kind].length > 0).map(([kind, name]) => (
              // Only groups with pills: README v2 "Empty groups show nothing",
              // which wins on layout over the prototype's always-drawn labels
              // (second audit, C.25). Pills in a group are any of; groups must all hold.
              <View key={kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 20 }}>
                  <Text style={{ width: 120, fontFamily: fonts.body, fontSize: 11, lineHeight: 17, fontWeight: '700', letterSpacing: 0.66, color: desk.inkDim }}>{name}</Text>
                  {rule[kind].map((x) => (
                    <View key={x.id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: x.not ? 'transparent' : LIME,
                      borderWidth: 1.5, borderColor: x.not ? desk.ruleStrong : LIME, paddingVertical: 4, paddingHorizontal: 10,
                    }}>
                      <Press effect="none" onPress={() => flip(kind, x.id)} accessibilityLabel="Switch between is and is not">
                        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: x.not ? desk.inkMuted : ON_LIME }}>{(x.not ? 'not ' : '') + nameOf(kind, x.id)}</Text>
                      </Press>
                      <Press effect="none" onPress={() => toggle(kind, x.id)} accessibilityLabel={`Remove ${nameOf(kind, x.id)}`}>
                        <View style={{ opacity: 0.55 }}><Icon name="close" size={12} color={x.not ? desk.inkMuted : ON_LIME} /></View>
                      </Press>
                    </View>
                  ))}
              </View>
            ))}
          </View>
          {/* The two parts of a handover rule the pills cannot draw, said as
              read-only lines with a × to clear them (audit 2). */}
          {rule.primaryCat ? (
            <ReadOnlyPart
              text={`Only places whose main category is ${nameOf('cats', rule.primaryCat)}`}
              onClear={() => setRule((r) => ({ ...r, primaryCat: null }))}
            />
          ) : null}
          {rule.ageSpan && rule.ages ? (
            <ReadOnlyPart
              text={`Ages: covers from ≤${rule.ages[0]} to ≥${rule.ages[1]}`}
              onClear={() => setRule((r) => ({ ...r, ageSpan: false }))}
            />
          ) : null}
          <RulePicker catalogue={catalogue} isOn={(k, id) => rule[k].some((x) => x.id === id)} onToggle={toggle} />
          <View style={{ gap: 10, paddingTop: 4 }}>
            <RangeLine label="Ages" value={rule.ages} onChange={(lo, hi) => range('ages', lo, hi)} onClear={() => setRule((r) => ({ ...r, ages: null }))} />
            <RangeLine label="Duration" value={rule.dur} onChange={(lo, hi) => range('dur', lo, hi)} onClear={() => setRule((r) => ({ ...r, dur: null }))} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ width: 70, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted }}>Cost</Text>
              <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: desk.ruleStrong }}>
                {COSTS.map((c, i) => {
                  const on = rule.cost.includes(c.key);
                  return (
                    <Press key={c.key} effect="none" onPress={() => setRule((r) => ({ ...r, cost: on ? r.cost.filter((x) => x !== c.key) : [...r.cost, c.key] }))}>
                      <Text style={{
                        paddingVertical: 6, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 12.5, fontWeight: on ? '700' : '600',
                        backgroundColor: on ? LIME : 'transparent', color: on ? ON_LIME : desk.inkDim, borderLeftWidth: i ? 1 : 0, borderLeftColor: desk.ruleStrong,
                      }}>{c.name}</Text>
                    </Press>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* Right: what it would return. */}
        <View style={{
          width: narrow ? undefined : 340, gap: 12,
          borderLeftWidth: narrow ? 0 : 1, borderLeftColor: desk.rule, paddingLeft: narrow ? 0 : 26,
          borderTopWidth: narrow ? 1 : 0, borderTopColor: desk.rule, paddingTop: narrow ? 16 : 0,
        }}>
          <Kicker>WHAT IT WOULD RETURN</Kicker>
          <Text style={[{ fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.78, color: any || legacy ? desk.ink : desk.inkDim }, tabular]}>
            {!any
              // An older rule not yet rewritten returns what the list counts.
              ? (legacy && row ? `${n(row.places)}${row.placesAtLeast ? '+' : ''} ${row.places === 1 && !row.placesAtLeast ? 'place' : 'places'}${within ? ' within reach' : ''}` : 'Pick a category, subcategory or fact')
              // While a rule is being counted the line says so, never the
              // last rule's number (audit 2).
              : previewing || !preview ? 'Counting…' : !countSpeaks ? '— within reach' : `${n(count)}${preview.atLeast ? '+' : ''} ${count === 1 && !preview.atLeast ? 'place' : 'places'}${within ? ' within reach' : ''}`}
          </Text>
          {any && preview && count > 0 && !preview.examples.length ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>None of these has a name we hold yet</Text>
          ) : null}
          <View>
            {(any ? preview?.examples ?? [] : []).map((p) => (
              <Press key={p.ref} effect="none" onPress={() => onPlace(p.ref)}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
                  <Text style={{ flexShrink: 1, fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink, borderBottomWidth: 1.5, borderBottomColor: LIME, paddingBottom: 1 }}>{p.name}</Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>{p.subLabel}</Text>
                </View>
              </Press>
            ))}
          </View>
          {error ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: RED }}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 6 }}>
            <Press effect="none" disabled={!ready} onPress={() => void save()}>
              <Text style={{
                backgroundColor: ready ? LIME : desk.off, color: ready ? ON_LIME : desk.inkDim, paddingVertical: 11, paddingHorizontal: 18,
                fontFamily: fonts.body, fontSize: 13, fontWeight: '700',
              }}>{saving ? 'Saving…' : saveLabel}</Text>
            </Press>
          </View>
        </View>
      </View>
    </View>
  );
}

/** A rule part the pills cannot draw: its words, and a × that clears it. */
function ReadOnlyPart({ text, onClear }: { text: string; onClear: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {/* Under the pills, lined up with them. */}
      <View style={{ width: 120 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: desk.ruleStrong, paddingVertical: 4, paddingHorizontal: 10, flexShrink: 1 }}>
        <Text style={{ flexShrink: 1, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted }}>{text}</Text>
        <Press effect="none" onPress={onClear} accessibilityLabel={`Clear: ${text}`}>
          <View style={{ opacity: 0.55 }}><Icon name="close" size={12} color={desk.inkMuted} /></View>
        </Press>
      </View>
    </View>
  );
}

/** "Ages  [from] to [to]  clear" — numbers typed into small boxes, never a stepper. */
function RangeLine({ label, value, onChange, onClear }: {
  label: string; value: [number, number] | null; onChange: (lo: string, hi: string) => void; onClear: () => void;
}) {
  // The boxes hold what was typed. A range with only one end still needs the
  // other for the rule (0, or 99 / 12), but that default is never written
  // into the empty box — typing there would append to it ("99" + "12").
  const [typed, setTyped] = useState<{ lo: string; hi: string }>(() => ({ lo: value ? String(value[0]) : '', hi: value ? String(value[1]) : '' }));
  const lo = typed.lo;
  const hi = typed.hi;
  const set = (next: { lo: string; hi: string }) => { setTyped(next); onChange(next.lo, next.hi); };
  const box = { width: 64, backgroundColor: desk.well, borderWidth: 1, borderColor: desk.ruleStrong, color: desk.ink, fontFamily: fonts.body, fontSize: 13, fontWeight: '600' as const, paddingVertical: 7, paddingHorizontal: 9 };
  const digits = (s: string) => s.replace(/\D/g, '');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ width: 70, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted }}>{label}</Text>
      <TextInput value={lo} onChangeText={(v) => set({ lo: digits(v), hi })} placeholder="from" placeholderTextColor={desk.inkDim} inputMode="numeric" style={[box, noOutline]} />
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>to</Text>
      <TextInput value={hi} onChangeText={(v) => set({ lo, hi: digits(v) })} placeholder="to" placeholderTextColor={desk.inkDim} inputMode="numeric" style={[box, noOutline]} />
      {value ? (
        <Press effect="none" onPress={() => { setTyped({ lo: '', hi: '' }); onClear(); }}><Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>clear</Text></Press>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The side drawer for a place

function PlaceDrawer({ placeRef, onClose }: { placeRef: string; onClose: () => void }) {
  const { width, height, framed, origin } = useViewport();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setCard(null); setError(null);
    deskApi.get<Card>(`/places/${encodeURIComponent(placeRef)}/card`)
      .then((c) => { if (live) setCard(c); })
      .catch((err) => { if (live) setError(saidOf(err)); });
    return () => { live = false; };
  }, [placeRef]);
  // A Modal portals out of the tree, so inside the phone frame it is pinned to
  // the frame's own box, not the whole window (CLAUDE.md).
  const frame: ViewStyle = framed && origin
    ? { position: 'absolute', left: origin.x, top: origin.y, width, height, overflow: 'hidden' }
    : { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 };
  const sheetWidth = Math.min(420, width);
  const where = [card?.sub, card?.town].filter(Boolean).join(' · ');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={frame}>
        <Press effect="none" onPress={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }} accessibilityLabel="Close" />
        <View style={[{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: sheetWidth, backgroundColor: desk.ground,
          borderLeftWidth: 1, borderLeftColor: desk.ruleStrong,
        }, web ? ({ boxShadow: '-16px 0 40px rgba(0,0,0,.5)' } as unknown as ViewStyle) : null]}>
          <ScrollView>
            <View style={{ height: 220, backgroundColor: desk.rule }}>
              {card?.image ? <Image source={{ uri: card.image }} style={[{ width: '100%', height: 220 }, web ? ({ filter: 'grayscale(1)' } as object) : null]} resizeMode="cover" /> : null}
              <Press effect="none" onPress={onClose} accessibilityLabel="Close" style={{ position: 'absolute', top: 12, right: 14 }}>
                <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: desk.ground }}>
                  <Icon name="close" size={18} color={desk.ink} />
                </View>
              </Press>
            </View>
            <View style={{ gap: 14, paddingTop: 20, paddingHorizontal: 22, paddingBottom: 28 }}>
              {error ? <Muted pad={false}>{error}</Muted> : !card ? <Muted pad={false}>Loading…</Muted> : (
                <>
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontFamily: fonts.heading, fontSize: 24, fontWeight: '800', letterSpacing: -0.72, lineHeight: 26.4, color: desk.ink }}>{card.name ?? 'A place we hold no name for'}</Text>
                    {where ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{where}</Text> : null}
                  </View>
                  {card.sentence ? <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: desk.inkMuted, lineHeight: 20.9 }}>{card.sentence}</Text> : null}
                  <View style={{ marginTop: 4 }}>
                    <View style={{ paddingBottom: 8 }}><Kicker>FACTS</Kicker></View>
                    {card.facts.map((f) => (
                      <View key={f.name} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
                        <Text style={{ width: 150, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 19.4, color: desk.inkDim }}>{f.name}</Text>
                        <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 20.15, fontWeight: '700', color: f.value == null ? desk.inkDim : desk.ink }}>{f.value ?? 'Don’t know'}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ marginTop: 4 }}>
                    <View style={{ paddingBottom: 8 }}><Kicker>IN COLLECTIONS</Kicker></View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {card.collections.map((c) => (
                        <Text key={c.key} style={{ borderWidth: 1, borderColor: desk.ruleStrong, color: desk.inkMuted, fontFamily: fonts.body, fontSize: 12, paddingVertical: 4, paddingHorizontal: 9 }}>{c.title}</Text>
                      ))}
                      {!card.collections.length ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>None</Text> : null}
                    </View>
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// See as a household

type HouseRow = {
  key: string; title: string; copy: string | null; live: boolean; person: boolean;
  /** Places within reach; null for a row that is not live (never a nought). */
  places: number | null; placesAtLeast?: boolean; audience: string; hearted: boolean; heartedBy: string | null;
  shelf: { ref: string; name: string; kind: string | null }[];
};
type House = {
  households: { id: string; name: string }[];
  household?: { id: string; name: string; home: string | null };
  members?: { id: string; name: string; age: number | null; adult: boolean }[];
  hearts?: { key: string; title: string; member: string | null; memberId?: string | null; days: number; fading: boolean }[];
  /** What "near you" means for this household; null where it has no home we can place. */
  reach?: { label: string | null; minutes: number; speaks: boolean; atLeast: boolean } | null;
  fadeDays?: number;
  rows?: HouseRow[];
  minPlaces?: number;
};
type HouseState = 'list' | 'first' | 'inspire' | 'thin' | 'named';
const HOUSE_STATES: { key: HouseState; name: string }[] = [
  { key: 'list', name: 'The list' }, { key: 'first', name: 'First heart' }, { key: 'inspire', name: 'Inspire' },
  { key: 'thin', name: 'Waiting row' }, { key: 'named', name: 'Named rows' },
];
const asHouseState = (v: string): HouseState => (HOUSE_STATES.some((x) => x.key === v) ? (v as HouseState) : 'list');
const STATE_NOTE: Record<HouseState, string> = {
  list: 'Every row is live. A row is a title and a rule over facts — nothing is ever filed into one.',
  first: 'The first heart asks whose list this is. One tap, sticky, never asked again in the session.',
  inspire: 'Hearted rows rise to the top, and two or three unhearted ones stay mixed in so discovery does not stop.',
  thin: 'A hearted row below minimum fill waits quietly rather than showing an empty shelf.',
  named: 'Each adult sees their own day. With nobody chosen it falls back to the plain title, and a child never sees it. A child’s name only ever goes on something positive.',
};
/** The rows the prototype draws for Named rows, where we hold them. */
const NAMED_ROWS = ['dayyourself', 'older', 'bigkids', 'teen', 'sneaky'];

/** The phone is drawn in the app's own light colours: cream, ink, the grey ladder. */
const APP = PALETTES.light;

/**
 * See as a household — a preview (prototype `isHousehold`, logic.js
 * 2343–2535). The rows, their counts and shelves come from the API for the
 * chosen household; the hearts and "whose list is this" are the screen's own
 * and are never written anywhere (audit decision, 28 Sep 2026: this is a
 * preview, and it must not change a real household's hearts). They start
 * from the household's real, unfaded hearts.
 */
function Household() {
  const narrow = useViewport().width < 900;
  const toast = useToast();
  const { setQuery } = useRouter();
  const [stateRaw, setStateRaw] = useDeskParam('state');
  const state = asHouseState(stateRaw);
  const setState = (s: HouseState) => setStateRaw(s === 'list' ? '' : s);
  const [house, setHouse] = useState<House | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  // Preview hearts: row key → the member it is attributed to (null: nobody yet).
  const [hearts, setHearts] = useState<Map<string, string | null>>(new Map());
  const [heartDays, setHeartDays] = useState<Map<string, number>>(new Map());

  useCrumbs([{ name: 'Collections', go: () => setQuery({ view: null, state: null }, { replace: false }) }, { name: 'See as a household' }], [setQuery]);

  // Asked again only when the household changes. The desk's location filter
  // is not part of it — a household sees what is within its own reach — so a
  // state change or a filter elsewhere never reloads it and never throws away
  // the preview's hearts (audit 2, 28 Sep 2026).
  useEffect(() => {
    let live = true;
    deskApi.get<House>('/collections/as-household', { household: id })
      .then((h) => {
        if (!live) return;
        setHouse(h); setError(null);
        // Every heart, fading ones too: a fading heart is listed as such and
        // no longer lifts its row.
        setHearts(new Map((h.hearts ?? []).map((x) => [x.key, x.memberId ?? null])));
        setHeartDays(new Map((h.hearts ?? []).map((x) => [x.key, x.days])));
      })
      .catch((err) => { if (live) setError(saidOf(err)); });
    return () => { live = false; };
  }, [id]);

  const members = house?.members ?? [];
  const ownerM = members.find((m) => m.id === owner) ?? null;
  const min = house?.minPlaces ?? 4;
  const all = house?.rows ?? [];
  // A personalised row is never shown to a child who is looking (D6).
  const visible = all.filter((r) => !(r.person && ownerM && !ownerM.adult));
  const fadeDays = house?.fadeDays ?? 120;
  const fadingKey = (key: string) => (heartDays.get(key) ?? 0) >= fadeDays;
  // A fading heart no longer lifts its row (D7).
  const isHearted = (r: HouseRow) => hearts.has(r.key) && !fadingKey(r.key);
  /** Places within the household's reach; null where that cannot be said. */
  const here = (r: HouseRow): number | null => (r.live ? r.places : 0);
  /** Waiting: hearted, live, and an exact count under the minimum. */
  const thinHere = (r: HouseRow) => { const x = here(r); return r.live && x != null && !r.placesAtLeast && x < min; };
  const titleOf = (r: HouseRow) => (r.person ? (ownerM?.adult ? `${r.title}, ${ownerM.name}` : r.title) : r.title);

  const phoneRows: HouseRow[] = (() => {
    if (state === 'inspire') {
      const h1 = visible.filter((r) => isHearted(r) && r.live && !thinHere(r));
      const rest = visible.filter((r) => !isHearted(r) && r.live).slice(0, 6);
      const mixed: HouseRow[] = [];
      h1.forEach((r, i) => { mixed.push(r); if (i === 1 && rest[0]) mixed.push(rest[0]); });
      return [...mixed, ...rest.slice(1, 4)];
    }
    if (state === 'thin') {
      const t = visible.filter((r) => isHearted(r) && thinHere(r));
      const pad = visible.filter((r) => isHearted(r) && r.live && !thinHere(r)).slice(0, 2);
      // Nothing hearted is waiting: the prototype draws the dog row in its place.
      const lead = t.length ? t : visible.filter((r) => r.key === 'dog');
      const leadKeys = new Set(lead.map((r) => r.key));
      return [...lead, ...pad.filter((r) => !leadKeys.has(r.key)), ...visible.filter((r) => !isHearted(r) && r.live && !leadKeys.has(r.key)).slice(0, 3)];
    }
    if (state === 'named') return NAMED_ROWS.map((k) => visible.find((r) => r.key === k)).filter((r): r is HouseRow => !!r);
    return visible.filter((r) => r.live);
  })();

  // A fading heart reads as not hearted on the phone, so a tap there hearts
  // it afresh; the list's "unheart" takes any heart away.
  const heart = (r: HouseRow, off = false) => {
    const on = off || isHearted(r);
    // The first heart asks whose list it is (prototype `toggleHeart`).
    if (!owner && !on) { setState('first'); return; }
    const next = new Map(hearts);
    const days = new Map(heartDays);
    if (on) { next.delete(r.key); days.delete(r.key); } else { next.set(r.key, owner); days.set(r.key, 0); }
    setHearts(next); setHeartDays(days);
    toast(`${titleOf(r)} ${on ? 'unhearted' : 'hearted'}`);
  };
  const choose = (m: { id: string | null; name: string }, said: string) => { setOwner(m.id); toast(said); };

  return (
    <View style={{ gap: 20 }}>
      <View style={{
        flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'flex-start' : 'center', gap: 20,
        borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 16, zIndex: 20,
      }}>
        <Text style={{ flex: narrow ? undefined : 1, fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32.2, color: desk.ink }}>What the household sees</Text>
        <View style={{ maxWidth: '100%' }}>
          <Seg options={HOUSE_STATES} value={state} onChange={(s) => { setState(s); if (s === 'first') setOwner(null); }} pad={18} size={12.5} />
        </View>
      </View>

      {house && house.households.length > 1 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, zIndex: 15 }}>
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>Household</Text>
          <Dropdown
            label={house.household?.name ?? 'Choose'}
            options={house.households.map((h) => ({ key: h.id, name: h.name }))}
            value={house.household?.id ?? null}
            onChange={(v) => { setId(v); setOwner(null); }}
            width={240}
          />
        </View>
      ) : null}

      {error ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: RED }}>{error}</Text> : !house ? <Muted>Loading…</Muted> : !house.household ? <Muted>No household has an account yet.</Muted> : (
        <View style={{ flexDirection: narrow ? 'column' : 'row', gap: 40, alignItems: 'flex-start' }}>
          {/* The phone. */}
          <View style={{ gap: 10, maxWidth: '100%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="mobile" size={13} color={desk.inkDim} />
              <Kicker>PREVIEW · THE EPIC APP · 390PX</Kicker>
            </View>
            <View style={{ padding: 12, backgroundColor: desk.well, borderWidth: 1, borderColor: desk.ruleStrong, borderRadius: 34, maxWidth: '100%' }}>
              <View style={{ width: 390, maxWidth: '100%', backgroundColor: CREAM, borderRadius: 24, overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingHorizontal: 18, paddingBottom: 12 }}>
                  <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 19, letterSpacing: -0.57, color: INK }}>{state === 'inspire' ? 'Inspire' : 'Rows'}</Text>
                  {ownerM ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: APP.inkMuted }}>{ownerM.name}’s hearts</Text> : null}
                </View>
                {state === 'first' && !owner ? (
                  <View style={{ gap: 12, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: APP.ruleSoft, backgroundColor: APP.warm }}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 16, fontWeight: '700', lineHeight: 20.8, color: INK }}>Whose list is this?</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      {members.map((m) => (
                        <Press key={m.id} effect="none" style={{ flex: 1 }} onPress={() => choose(m, `Hearts now attributed to ${m.name}`)}>
                          <View style={{ alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: INK, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', color: INK }}>{m.name.slice(0, 1)}</Text>
                            </View>
                            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: INK }}>{m.name}{!m.adult && m.age != null ? ` · ${m.age}` : ''}</Text>
                          </View>
                        </Press>
                      ))}
                    </View>
                    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: APP.inkMuted }}>Asked once. Every heart after this is attributed to them.</Text>
                  </View>
                ) : null}
                <View style={{ paddingTop: 2, paddingBottom: 20 }}>
                  {phoneRows.map((r) => {
                    const hearted = isHearted(r);
                    const n_ = here(r);
                    const notReady = !r.live;
                    const waiting = hearted && thinHere(r);
                    // The prototype's `phoneRow`: a waiting row says so; a live
                    // one its copy line, or how many places are near — never a
                    // number we could not count.
                    const near = n_ == null ? '' : `${n_}${r.placesAtLeast ? '+' : ''} ${n_ === 1 && !r.placesAtLeast ? 'place' : 'places'} near you`;
                    const sub = notReady ? (r.copy || '') : waiting ? 'Nothing near you this week — it comes back when there is' : (r.copy || near);
                    // The shelf's frame is drawn even with nothing named on it (the prototype).
                    const showShelf = hearted && r.live && !waiting;
                    const fg = notReady ? APP.decor : INK;
                    return (
                      <View key={r.key} style={{ gap: 3, paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: APP.lineSoft, backgroundColor: hearted ? APP.warm : 'transparent' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <Text style={{ fontFamily: fonts.heading, fontSize: 16.5, fontWeight: '800', letterSpacing: -0.33, color: fg }}>{titleOf(r)}</Text>
                              {waiting ? (
                                <Text style={{ fontFamily: fonts.body, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.38, borderWidth: 1, borderColor: APP.inkMuted, color: APP.inkMuted, paddingVertical: 1, paddingHorizontal: 5 }}>WAITING</Text>
                              ) : null}
                              {notReady ? (
                                <Text style={{ fontFamily: fonts.body, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.38, borderWidth: 1, borderStyle: 'dashed', borderColor: APP.decor, color: APP.inkMuted, paddingVertical: 1, paddingHorizontal: 5 }}>NOT READY YET</Text>
                              ) : null}
                            </View>
                            {sub ? <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 18.2, color: APP.inkMuted }}>{sub}</Text> : null}
                          </View>
                          <Press effect="none" onPress={() => heart(r)} accessibilityLabel={hearted ? `Unheart ${titleOf(r)}` : `Heart ${titleOf(r)}`} style={{ paddingTop: 2 }}>
                            <Icon name="keep" size={21} color={notReady ? APP.decor : INK} fill={hearted} />
                          </Press>
                        </View>
                        {showShelf ? (
                          <View style={{ flexDirection: 'row', gap: 8, paddingTop: 7 }}>
                            {r.shelf.map((p) => (
                              <View key={p.ref} style={{ width: 106, gap: 5 }}>
                                <View style={{ width: 106, height: 74, borderRadius: 8, backgroundColor: APP.warm, borderWidth: 1, borderStyle: 'dashed', borderColor: APP.ruleMuted, justifyContent: 'flex-end', padding: 7 }}>
                                  <Text style={{ fontFamily: fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.3, lineHeight: 12, color: APP.inkMuted }}>{p.kind ?? ''}</Text>
                                </View>
                                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '600', lineHeight: 14.4, color: INK }}>{p.name}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {!phoneRows.length ? <Text style={{ paddingVertical: 20, paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 13, color: APP.inkMuted }}>Nothing shows for this household yet.</Text> : null}
                </View>
              </View>
            </View>
          </View>

          {/* What this state shows. */}
          <View style={{ flex: narrow ? undefined : 1, minWidth: 0, gap: 13, alignSelf: 'stretch' }}>
            <Kicker>WHAT THIS STATE SHOWS</Kicker>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted, lineHeight: 20.8 }}>{STATE_NOTE[state]}</Text>
            {/* What "near you" is judged against: the household's own home and reach. */}
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim, lineHeight: 19.4 }}>
              {house.reach
                ? `Near you: within ${house.reach.minutes} min of ${house.reach.label ?? 'home'} by car${house.reach.speaks ? '' : ' · the census has not covered it yet'}`
                : 'This household has no home set, so nothing can be judged near it.'}
            </Text>
            {state === 'named' || state === 'first' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.69, color: desk.inkDim }}>SEEN AS</Text>
                {[...members.filter((m) => m.adult), { id: null as string | null, name: 'Nobody yet' }].map((m) => {
                  const on = owner === m.id;
                  return (
                    <Press key={m.id ?? 'nobody'} effect="none" onPress={() => choose(m, m.id ? `Seen as ${m.name}` : 'Seen as nobody yet')}>
                      <Text style={{
                        borderWidth: 1.5, borderColor: on ? LIME : desk.ruleStrong, backgroundColor: on ? LIME : 'transparent',
                        color: on ? ON_LIME : desk.inkMuted, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', paddingVertical: 5, paddingHorizontal: 11,
                      }}>{m.name}</Text>
                    </Press>
                  );
                })}
              </View>
            ) : null}
            <View style={{ gap: 9, borderTopWidth: 1, borderTopColor: desk.rule, paddingTop: 14 }}>
              {all.filter((r) => hearts.has(r.key)).map((r) => {
                const who = members.find((m) => m.id === hearts.get(r.key))?.name ?? '';
                const days = heartDays.get(r.key) || 1;
                const fading = fadingKey(r.key);
                return (
                  <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: desk.rule, flexWrap: 'wrap' }}>
                    <Text style={{ width: 230, fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink }}>{titleOf(r)}</Text>
                    <Text style={{ width: 110, fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted }}>{who}</Text>
                    <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12, color: fading ? RED : desk.inkDim }}>
                      {fading ? `hearted ${Math.round(days / 30)} months ago · fading` : `hearted ${days} ${days === 1 ? 'day' : 'days'} ago`}
                    </Text>
                    <Press effect="none" onPress={() => heart(r, true)}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>unheart</Text>
                    </Press>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
