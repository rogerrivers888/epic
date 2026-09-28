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
 * side drawer's place).
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
  places: number; shown: number | null; opened: number | null; hearted: number | null;
};
type Filter = { unknown?: boolean; where: string; label?: string; chip?: string; approx?: boolean; capped?: boolean; message?: string } | null;
type List = { rows: Row[]; count: number; engagementSpeaks: boolean; atLeast: boolean; filter: Filter };
type Preview = { count: number; examples: { ref: string; name: string; sub: string; subLabel: string; town: string | null }[] };
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
      {place ? <PlaceDrawer placeRef={place} onClose={() => setPlace('')} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The list and its editor

type ColKey = 'title' | 'places' | 'audience' | 'shown' | 'opened' | 'hearted';

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
  const [sort, setSort] = useState<SortState<ColKey>>({ key: 'title', dir: 'asc' });

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

  const openRow = (key: string | null) => setQuery({ collection: key, place: null });
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
          <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>
            {list ? `${n(list.count)} ${list.count === 1 ? 'collection' : 'collections'}` : 'Collections'}
          </Text>
          <InfoTip text={TIP} width={380} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Press effect="none" onPress={() => setQuery({ view: 'household', collection: null, place: null })}>
            <Text style={{ borderWidth: 1.5, borderColor: desk.ruleStrong, color: desk.inkMuted, paddingVertical: 9, paddingHorizontal: 16, fontFamily: fonts.body, fontSize: 13, fontWeight: '700' }}>See as a household</Text>
          </Press>
          <Press effect="none" onPress={() => openRow('new')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: LIME, paddingVertical: 10, paddingHorizontal: 16 }}>
              <Icon name="add" size={14} color={ON_LIME} />
              <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: ON_LIME }}>New collection</Text>
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
          onPlace={(ref) => setQuery({ place: ref })}
          onSaved={async (title, created, change) => {
            openRow(null);
            await load();
            toast(`${title} ${created ? 'added' : 'saved'}`, change ? async () => {
              try { await deskApi.post(`/undo/${encodeURIComponent(change)}`); await load(); toast('Undone'); } catch (err) { toast(saidOf(err)); }
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
              const thin = minPlaces != null && r.places < minPlaces;
              return (
                <TRow key={r.key} gap={24} lifted={open === r.key} onPress={() => openRow(open === r.key ? null : r.key)}>
                  <TCell width={300}>
                    <View style={{ gap: 2 }}>
                      <T weight="700">{r.title}</T>
                      {r.copy ? <T size={12} tone={desk.inkDim}>{r.copy}</T> : null}
                    </View>
                  </TCell>
                  <TCell width={within ? 140 : 90}><T num tone={thin ? desk.inkDim : desk.ink}>{n(r.places)}{list.atLeast ? '+' : ''}</T></TCell>
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
  const toast = useToast();
  const [title, setTitle] = useState(row?.title ?? '');
  const [copy, setCopy] = useState(row?.copy ?? '');
  const [rule, setRule] = useState<Rule>(() => (row ? JSON.parse(JSON.stringify(row.rule)) as Rule : { ...EMPTY }));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  // What it would return, asked again as the rule changes (debounced).
  useEffect(() => {
    if (!hasRule(rule)) { setPreview(null); return; }
    const mine = ++seq.current;
    setPreviewing(true);
    const t = setTimeout(() => {
      deskApi.post<Preview>(`/collections/preview${qs(params)}`, { rule })
        .then((p) => { if (mine === seq.current) setPreview(p); })
        .catch((err) => { if (mine === seq.current) toast(saidOf(err)); })
        .finally(() => { if (mine === seq.current) setPreviewing(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [rule, params, toast]);

  const any = hasRule(rule);
  const count = preview?.count ?? 0;
  const ready = title.trim().length > 0 && any && !!preview && count > 0 && !previewing;
  const saveLabel = !title.trim() ? 'Give it a title' : !any ? 'Add a rule' : previewing || !preview ? 'Counting…' : !count ? 'Returns nothing' : 'Save';

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
    if (!canManage) { toast('Only someone who manages the library can change this.'); return; }
    setSaving(true);
    try {
      const body = { title: title.trim(), copy: copy.trim(), rule };
      const out = row
        ? await deskApi.put<Saved>(`/collections/${encodeURIComponent(row.key)}`, body)
        : await deskApi.post<Saved>('/collections', body);
      onSaved(title.trim(), out.created, out.change?.id ?? null);
    } catch (err) { toast(saidOf(err)); } finally { setSaving(false); }
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
          <View style={{ gap: 8 }}>
            {([['cats', 'CATEGORY'], ['subs', 'SUB-CATEGORY'], ['facts', 'FACT']] as [RuleKind, string][]).map(([kind, name]) => (
              // Empty groups show nothing. Pills in a group are any of; groups must all hold.
              rule[kind].length ? (
                <View key={kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Text style={{ width: 120, fontFamily: fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: desk.inkDim }}>{name}</Text>
                  {rule[kind].map((x) => (
                    <View key={x.id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: x.not ? 'transparent' : LIME,
                      borderWidth: 1.5, borderColor: x.not ? desk.ruleStrong : LIME, paddingVertical: 4, paddingHorizontal: 10,
                    }}>
                      <Press effect="none" onPress={() => flip(kind, x.id)} accessibilityLabel="Switch between is and is not">
                        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: x.not ? desk.inkMuted : ON_LIME }}>{(x.not ? 'not ' : '') + nameOf(kind, x.id)}</Text>
                      </Press>
                      <Press effect="none" onPress={() => toggle(kind, x.id)} accessibilityLabel={`Remove ${nameOf(kind, x.id)}`}>
                        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', opacity: 0.55, color: x.not ? desk.inkMuted : ON_LIME }}>×</Text>
                      </Press>
                    </View>
                  ))}
                </View>
              ) : null
            ))}
          </View>
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
          <Text style={[{ fontFamily: fonts.heading, fontSize: 26, fontWeight: '800', letterSpacing: -0.78, color: any ? desk.ink : desk.inkDim }, tabular]}>
            {!any ? 'Pick a category, subcategory or fact' : !preview ? '…' : `${n(count)} ${count === 1 ? 'place' : 'places'}${within ? ' within reach' : ''}`}
          </Text>
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

/** "Ages  [from] to [to]  clear" — numbers typed into small boxes, never a stepper. */
function RangeLine({ label, value, onChange, onClear }: {
  label: string; value: [number, number] | null; onChange: (lo: string, hi: string) => void; onClear: () => void;
}) {
  const lo = value ? String(value[0]) : '';
  const hi = value ? String(value[1]) : '';
  const box = { width: 64, backgroundColor: desk.well, borderWidth: 1, borderColor: desk.ruleStrong, color: desk.ink, fontFamily: fonts.body, fontSize: 13, fontWeight: '600' as const, paddingVertical: 7, paddingHorizontal: 9 };
  const digits = (s: string) => s.replace(/\D/g, '');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ width: 70, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted }}>{label}</Text>
      <TextInput value={lo} onChangeText={(v) => onChange(digits(v), hi)} placeholder="from" placeholderTextColor={desk.inkDim} inputMode="numeric" style={[box, noOutline]} />
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>to</Text>
      <TextInput value={hi} onChangeText={(v) => onChange(lo, digits(v))} placeholder="to" placeholderTextColor={desk.inkDim} inputMode="numeric" style={[box, noOutline]} />
      {value ? (
        <Press effect="none" onPress={onClear}><Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>clear</Text></Press>
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
                        <Text style={{ width: 150, fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{f.name}</Text>
                        <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: f.value == null ? desk.inkDim : desk.ink }}>{f.value ?? 'Don’t know'}</Text>
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
  key: string; title: string; copy: string | null; places: number; audience: string; hearted: boolean; shown: boolean; why: string | null;
  shelf?: { ref: string; name: string; kind: string | null }[];
};
type House = {
  households: { id: string; name: string }[];
  household?: { id: string; name: string; home: string | null };
  members?: { id: string; name: string; age: number | null; adult: boolean }[];
  hearts?: { key: string; title: string; member: string | null; days: number; fading: boolean }[];
  fadeDays?: number;
  shown: HouseRow[]; hidden: HouseRow[];
};
type HouseState = 'list' | 'first' | 'inspire' | 'thin' | 'named';
const HOUSE_STATES: { key: HouseState; name: string }[] = [
  { key: 'list', name: 'The list' }, { key: 'first', name: 'First heart' }, { key: 'inspire', name: 'Inspire' },
  { key: 'thin', name: 'Waiting row' }, { key: 'named', name: 'Named rows' },
];
const STATE_NOTE: Record<HouseState, string> = {
  list: 'Every row is live. A row is a title and a rule over facts — nothing is ever filed into one.',
  first: 'The first heart asks whose list this is. One tap, sticky, never asked again in the session.',
  inspire: 'Hearted rows rise to the top, and two or three unhearted ones stay mixed in so discovery does not stop.',
  thin: 'A hearted row below minimum fill waits quietly rather than showing an empty shelf.',
  named: 'Each adult sees their own day. With nobody chosen it falls back to the plain title, and a child never sees it. A child’s name only ever goes on something positive.',
};

/** The phone is drawn in the app's own light colours: cream, ink, the grey ladder. */
const APP = PALETTES.light;

function Household() {
  const narrow = useViewport().width < 900;
  const { setQuery } = useRouter();
  const { loc } = useLocation();
  const [house, setHouse] = useState<House | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<HouseState>('list');
  const [owner, setOwner] = useState<string | null>(null);

  useCrumbs([{ name: 'Collections', go: () => setQuery({ view: null }) }, { name: 'See as a household' }], [setQuery]);

  useEffect(() => {
    let live = true;
    deskApi.get<House>('/collections/as-household', { ...locParams(loc), household: id })
      .then((h) => { if (live) { setHouse(h); setError(null); } })
      .catch((err) => { if (live) setError(saidOf(err)); });
    return () => { live = false; };
  }, [id, loc]);

  const members = house?.members ?? [];
  const ownerName = members.find((m) => m.id === owner)?.name ?? null;
  const shown = house?.shown ?? [];
  // A hearted row too thin to show waits (the Waiting row state shows it).
  const waiting = (house?.hidden ?? []).filter((r) => r.hearted && r.why?.startsWith('Too thin'));
  const rows: (HouseRow & { waiting?: boolean })[] = state === 'thin' ? [...waiting.map((r) => ({ ...r, waiting: true })), ...shown] : shown;

  return (
    <View style={{ gap: 20 }}>
      <View style={{
        flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'flex-start' : 'center', gap: 20,
        borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 16, zIndex: 20,
      }}>
        <Text style={{ flex: narrow ? undefined : 1, fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>What the household sees</Text>
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

      {error ? <Muted>{error}</Muted> : !house ? <Muted>Loading…</Muted> : !house.household ? <Muted>No household has an account yet.</Muted> : (
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
                  {ownerName ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: APP.inkMuted }}>{ownerName}’s hearts</Text> : null}
                </View>
                {state === 'first' && !owner ? (
                  <View style={{ gap: 12, paddingTop: 14, paddingHorizontal: 18, paddingBottom: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: APP.ruleSoft, backgroundColor: APP.warm }}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 16, fontWeight: '700', lineHeight: 20.8, color: INK }}>Whose list is this?</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      {members.map((m) => (
                        <Press key={m.id} effect="none" style={{ flex: 1 }} onPress={() => setOwner(m.id)}>
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
                  {rows.map((r) => (
                    <View key={r.key} style={{ gap: 3, paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: APP.lineSoft, backgroundColor: r.hearted ? APP.warm : 'transparent' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Text style={{ fontFamily: fonts.heading, fontSize: 16.5, fontWeight: '800', letterSpacing: -0.33, color: INK }}>{r.title}</Text>
                            {r.waiting ? (
                              <Text style={{ fontFamily: fonts.body, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.38, borderWidth: 1, borderColor: APP.inkMuted, color: APP.inkMuted, paddingVertical: 1, paddingHorizontal: 5 }}>WAITING</Text>
                            ) : null}
                          </View>
                          {r.copy ? <Text style={{ fontFamily: fonts.body, fontSize: 13, lineHeight: 18.2, color: APP.inkMuted }}>{r.copy}</Text> : null}
                        </View>
                        <View style={{ paddingTop: 2 }}>
                          <Icon name="keep" size={21} color={INK} fill={r.hearted} />
                        </View>
                      </View>
                      {state === 'inspire' && r.shelf?.length ? (
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
                  ))}
                  {!rows.length ? <Text style={{ paddingVertical: 20, paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 13, color: APP.inkMuted }}>Nothing shows for this household yet.</Text> : null}
                </View>
              </View>
            </View>
          </View>

          {/* What this state shows. */}
          <View style={{ flex: narrow ? undefined : 1, minWidth: 0, gap: 13, alignSelf: 'stretch' }}>
            <Kicker>WHAT THIS STATE SHOWS</Kicker>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted, lineHeight: 20.8 }}>{STATE_NOTE[state]}</Text>
            {state === 'named' || state === 'first' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '700', letterSpacing: 0.69, color: desk.inkDim }}>SEEN AS</Text>
                {[...members.filter((m) => m.adult), { id: null as string | null, name: 'Nobody yet' }].map((m) => {
                  const on = owner === m.id;
                  return (
                    <Press key={m.id ?? 'nobody'} effect="none" onPress={() => setOwner(m.id)}>
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
              {(house.hearts ?? []).map((h) => (
                <View key={`${h.key}-${h.member}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: desk.rule, flexWrap: 'wrap' }}>
                  <Text style={{ width: 230, fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink }}>{h.title}</Text>
                  <Text style={{ width: 110, fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted }}>{h.member ?? '—'}</Text>
                  <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12, color: h.fading ? RED : desk.inkDim }}>
                    {h.fading ? `hearted ${Math.round(h.days / 30)} months ago · fading` : `hearted ${h.days} ${h.days === 1 ? 'day' : 'days'} ago`}
                  </Text>
                </View>
              ))}
            </View>
            {house.hidden.length ? (
              <View style={{ gap: 6, paddingTop: 6 }}>
                <Kicker>NOT SHOWN HERE · {house.hidden.length}</Kicker>
                {house.hidden.map((r) => (
                  <View key={r.key} style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap', paddingVertical: 4 }}>
                    <Text style={{ width: 230, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted }}>{r.title}</Text>
                    <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>{r.why}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}
