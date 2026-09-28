/**
 * Mapping — where each of Google's words points (design README v2, 28 Sep
 * 2026; prototype block `isMapping`).
 *
 * One table with a view control before Filter and Sort: In Epic · Needs a
 * decision · Not in Epic · Decided. A word appears in exactly one view; the
 * header counts switch views when clicked. Every decision keeps its Why, who
 * and when, is undoable (the toast's Undo, and Decided), and is in Changes.
 * The only confirm in the desk is "Exclude this word".
 *
 * The Why of a decision is written the way the prototype writes it — there
 * is no field for it anywhere in the design: a picker edit says what it did
 * ("Added Water parks"), a proposal carries its group ("Not places people
 * visit"), a Keep is "Kept — proposal declined", an exclusion from the row
 * menu is "Excluded by a person".
 *
 * Query: `view` (inepic | needs | notinepic | decided), `word` (the picker is
 * open for it), `kind` (Decided's filter), `q` (the picker's search).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Text, TextInput, View, type ViewStyle } from 'react-native';

import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { useRouter } from '../../router';
import { LIME, ON_LIME, desk, fonts } from '../../theme';
import { useDeskParam } from './Desk';
import {
  InfoTip, Muted, RED, Seg, T, TCell, THead, TRow, Table, ago, deskApi, n, saidOf, sortRows, tableWidth, tabular, useToast,
  type SortState, type TCol,
} from './kit';
import { WordPicker, type Catalogue } from './Picker';

// ---------------------------------------------------------------------------
// What the API answers (apps/api/src/desk/mapping.js)

type Target = { key: string; label: string; category: string; primary: boolean; active: boolean };
type Proposal = {
  id: string | null; group: string; action: string; changeTo: string | null;
  affected: number | null; pointsAtNow?: string | null;
};
type Word = {
  word: string; brings: number; opened: number | null; answer: string; decision: string | null;
  targets: Target[]; facts: { key: string; label: string }[];
  proposal?: Proposal; why?: string | null; decidedBy?: string | null; decidedAt?: string | null;
};
type MappingState = {
  counts: { inEpic: number; needs: number; notInEpic: number; decided: number };
  inEpic: Word[]; needs: Word[]; notInEpic: Word[]; everOpenedSpeaks: boolean;
};
type Decision = { id: string; word: string; kind: string; why: string | null; who: string; at: string; latest: boolean };
type Decided = { rows: Decision[]; total: number };
type Written = { decision?: { id: string }; change?: { id: string } | null };

type View_ = 'inepic' | 'needs' | 'notinepic' | 'decided';
const VIEWS: { key: View_; name: string; count: keyof MappingState['counts']; kicker: string }[] = [
  { key: 'inepic', name: 'In Epic', count: 'inEpic', kicker: 'IN EPIC' },
  { key: 'needs', name: 'Needs a decision', count: 'needs', kicker: 'NEEDS A DECISION' },
  { key: 'notinepic', name: 'Not in Epic', count: 'notInEpic', kicker: 'NOT IN EPIC' },
  { key: 'decided', name: 'Decided', count: 'decided', kicker: 'DECIDED' },
];
const asView = (v: string): View_ => (VIEWS.some((x) => x.key === v) ? (v as View_) : 'inepic');

/** The groups of Needs a decision, in the README's order and words. */
const GROUPS: { key: string; name: string }[] = [
  { key: 'not_places', name: 'Not places people visit' },
  { key: 'fold', name: 'Fold into a bigger subcategory' },
  { key: 'narrow', name: 'Narrow to the ones worth visiting' },
  { key: 'stop_filing', name: 'Stop filing by this word' },
  { key: 'no_suggestion', name: 'No suggestion — choose where it goes' },
];
/** The action button is named for what it does. */
const VERB: Record<string, string> = { exclude: 'Exclude', repoint: 'Repoint', narrow: 'Repoint', make_fact: 'Make a fact' };
const DONE: Record<string, string> = { exclude: 'excluded', repoint: 'repointed', narrow: 'repointed', make_fact: 'made a fact' };
const KINDS = ['Excluded', 'Repointed', 'Narrowed', 'Made a fact', 'Kept', 'Brought back'];

type SortKey = 'word' | 'brings' | 'opened' | 'points';
const SORTS: { key: SortKey; name: string; dir: string; first: 'asc' | 'desc'; label: string }[] = [
  { key: 'brings', name: 'Places it brings in', dir: 'most first', first: 'desc', label: 'places it brings in' },
  { key: 'opened', name: 'Ever opened', dir: 'fewest first', first: 'asc', label: 'ever opened' },
  { key: 'word', name: 'Google’s word', dir: 'A to Z', first: 'asc', label: 'word' },
  { key: 'points', name: 'Where it points', dir: 'A to Z', first: 'asc', label: 'where it points' },
];

type Filter = { key: string; name: string };

const web = Platform.OS === 'web';
const SHADOW: ViewStyle = web ? ({ boxShadow: '0 12px 32px rgba(0,0,0,.5)' } as unknown as ViewStyle) : {};
const pointsOf = (w: Word) => (w.targets[0]?.label ?? (w.answer === 'secondary' ? 'kept as a fact' : w.answer === 'notinepic' ? 'Not in Epic' : 'not answered'));

// ---------------------------------------------------------------------------

export function Mapping({ canManage = false }: { canManage?: boolean }) {
  const narrow = useViewport().width < 900;
  const toast = useToast();
  const { setQuery } = useRouter();
  const [viewRaw] = useDeskParam('view');
  const [word] = useDeskParam('word');
  const [kind, setKind] = useDeskParam('kind');
  const [q, setQ] = useDeskParam('q');
  const view = asView(viewRaw);

  const [state, setState] = useState<MappingState | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [decided, setDecided] = useState<Decided | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'brings', dir: 'desc' });
  const [filters, setFilters] = useState<Filter[]>([]);
  const [menu, setMenu] = useState<'filter' | 'sort' | null>(null);
  const [filterQ, setFilterQ] = useState('');
  const [rowMenu, setRowMenu] = useState<{ word: string; confirming: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        deskApi.get<MappingState>('/mapping'),
        deskApi.get<Catalogue>('/mapping/picker'),
      ]);
      setState(s); setCatalogue(c); setError(null);
    } catch (err) { setError(saidOf(err)); }
  }, []);
  const loadDecided = useCallback(async () => {
    try { setDecided(await deskApi.get<Decided>('/mapping/decisions', { kind: kind || null })); setError(null); } catch (err) { setError(saidOf(err)); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (view === 'decided') void loadDecided(); }, [view, loadDecided]);

  const go = (v: View_, extra: { word?: string | null } = {}) => {
    setMenu(null); setRowMenu(null);
    setQuery({ view: v === 'inepic' ? null : v, word: extra.word ?? null, q: null, kind: null });
  };
  const openWord = (w: string | null) => setQuery({ view: null, word: w, q: null });

  /** Write, reload, and toast with an Undo that names the change. */
  const write = async (call: () => Promise<Written>, said: string): Promise<boolean> => {
    if (!canManage) { toast('Only someone who manages the library can change this.'); return false; }
    if (busy) return false;
    setBusy(true);
    try {
      const out = await call();
      await load();
      if (view === 'decided') await loadDecided();
      const change = out.change?.id;
      toast(said, change ? () => { void undoChange(change); } : null);
      return true;
    } catch (err) { toast(saidOf(err)); return false; } finally { setBusy(false); }
  };
  const undoChange = async (id: string) => {
    try { await deskApi.post(`/undo/${encodeURIComponent(id)}`); await load(); if (view === 'decided') await loadDecided(); toast('Undone'); } catch (err) { toast(saidOf(err)); }
  };
  const undoDecision = async (id: string) => {
    if (!canManage) { toast('Only someone who manages the library can change this.'); return; }
    try { await deskApi.post(`/mapping/decisions/${encodeURIComponent(id)}/undo`); await Promise.all([load(), loadDecided()]); toast('Undone'); } catch (err) { toast(saidOf(err)); }
  };

  const enc = encodeURIComponent;
  const labelOf = (key: string) => catalogue?.subcategories.find((s) => s.key === key)?.label ?? key;
  const factLabel = (key: string) => catalogue?.facts.find((f) => f.key === key)?.label ?? key;

  const exclude = (w: string, why = 'Excluded by a person') =>
    write(() => deskApi.post<Written>(`/mapping/${enc(w)}/exclude`, { why }), `${w} excluded`);
  const bringBack = async (w: string) => {
    // Bringing a word back opens its picker, so you choose where it points.
    if (await write(() => deskApi.post<Written>(`/mapping/${enc(w)}/bring-back`, { why: 'Brought back' }), `${w} brought back`)) openWord(w);
  };

  // --- The picker's edits --------------------------------------------------
  const allWords = useMemo(() => (state ? [...state.inEpic, ...state.needs, ...state.notInEpic] : []), [state]);
  const find = (w: string) => allWords.find((x) => x.word === w) ?? null;
  const toggleSub = (w: string, sub: string) => {
    const cur = find(w); if (!cur) return;
    const subs = cur.targets.map((t) => t.key);
    const primary = cur.targets.find((t) => t.primary)?.key ?? null;
    if (sub === primary) return;
    const removing = subs.includes(sub);
    const next = removing ? subs.filter((s) => s !== sub) : [...subs, sub];
    const name = labelOf(sub);
    void write(
      () => deskApi.put<Written>(`/mapping/${enc(w)}/targets`, { subs: next, primary: primary ?? next[0], why: removing ? `${name} removed` : `Added ${name}` }),
      removing ? `${w} · ${name} removed` : `${w} → ${name}`,
    );
  };
  const makePrimary = (w: string, sub: string) => {
    const cur = find(w); if (!cur) return;
    const name = labelOf(sub);
    void write(
      () => deskApi.put<Written>(`/mapping/${enc(w)}/targets`, { subs: cur.targets.map((t) => t.key), primary: sub, why: `${name} made primary` }),
      `${name} is now the primary subcategory for ${w}`,
    );
  };
  const toggleFact = (w: string, fact: string) => {
    const cur = find(w); if (!cur) return;
    const on = !cur.facts.some((f) => f.key === fact);
    const name = factLabel(fact);
    void write(
      () => deskApi.put<Written>(`/mapping/${enc(w)}/facts`, { fact, on, why: on ? `Added ${name}` : `${name} removed` }),
      `${name} ${on ? 'on' : 'off'} ${w}`,
    );
  };
  const create = async (w: string, label: string, category: string) => {
    if (!canManage) { toast('Only someone who manages the library can change this.'); return; }
    try {
      const made = await deskApi.post<{ key: string; label: string }>('/subcategories', { label, category, wouldBrowse: true });
      const cur = find(w);
      const subs = cur ? cur.targets.map((t) => t.key) : [];
      const primary = cur?.targets.find((t) => t.primary)?.key ?? null;
      const next = subs.includes(made.key) ? subs : [...subs, made.key];
      await write(
        () => deskApi.put<Written>(`/mapping/${enc(w)}/targets`, { subs: next, primary: primary ?? made.key, why: `Added ${made.label} (new subcategory)` }),
        `${made.label} made · ${w} → ${made.label}`,
      );
    } catch (err) { toast(saidOf(err)); }
  };

  // --- Needs a decision ------------------------------------------------------
  const decide = (w: Word, action: 'apply' | 'keep', group: string) => {
    const p = w.proposal; if (!p?.id) return;
    void write(
      () => deskApi.post<Written>(`/mapping/proposals/${enc(p.id!)}`, { action, why: action === 'keep' ? 'Kept — proposal declined' : group }),
      action === 'keep' ? `${w.word} kept as it is` : `${w.word} ${DONE[p.action] ?? 'decided'}`,
    );
  };

  // --- The table views -----------------------------------------------------
  const tableWords = useMemo(() => {
    if (!state) return [];
    let list = view === 'notinepic' ? state.notInEpic : state.inEpic;
    // A word opened from elsewhere (Needs a decision, Brought back) is drawn
    // at the top of In Epic with its picker open, as the prototype does.
    if (view === 'inepic' && word && !list.some((w) => w.word === word)) {
      const w = [...state.needs, ...state.inEpic].find((x) => x.word === word);
      if (w) list = [w, ...list];
    }
    for (const f of filters) {
      const [k, v] = [f.key.slice(0, f.key.indexOf(':')), f.key.slice(f.key.indexOf(':') + 1)];
      if (k === 'state') {
        if (v === 'mapped') list = list.filter((w) => w.targets.length > 0);
        else if (v === 'secondary') list = list.filter((w) => w.answer === 'secondary');
        else if (v === 'nobodyopened') list = list.filter((w) => w.opened === 0);
        else if (v === 'big') list = list.filter((w) => w.brings > 100);
      }
      if (k === 'cat') list = list.filter((w) => w.targets.some((t) => t.primary && t.category === v));
      if (k === 'sub') list = list.filter((w) => w.targets.some((t) => t.key === v));
      if (k === 'fact') list = list.filter((w) => w.facts.some((x) => x.key === v));
    }
    const sorted = sortRows(list, sort, (w, key) => (key === 'word' ? w.word : key === 'brings' ? w.brings : key === 'opened' ? w.opened : pointsOf(w)));
    // The opened word stays at the top whatever the sort.
    if (view === 'inepic' && word) {
      const i = sorted.findIndex((w) => w.word === word);
      if (i > 0) sorted.unshift(sorted.splice(i, 1)[0]);
    }
    return sorted;
  }, [state, view, word, filters, sort]);

  const filterOptions = useMemo(() => {
    if (!state || !catalogue) return [];
    const words = view === 'notinepic' ? state.notInEpic : state.inEpic;
    const count = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;
    const opts: { key: string; name: string; kind: string; note: string }[] = [
      { key: 'state:mapped', name: 'Answered', kind: 'STATE', note: count(words.filter((w) => w.targets.length).length, 'word', 'words') },
      { key: 'state:secondary', name: 'Kept as a fact', kind: 'STATE', note: count(words.filter((w) => w.answer === 'secondary').length, 'word', 'words') },
      // "Nobody ever opened one" only where the corpus can speak.
      ...(state.everOpenedSpeaks ? [{ key: 'state:nobodyopened', name: 'Nobody ever opened one', kind: 'STATE', note: count(words.filter((w) => w.opened === 0).length, 'word', 'words') }] : []),
      { key: 'state:big', name: 'Brings over 100 places', kind: 'STATE', note: count(words.filter((w) => w.brings > 100).length, 'word', 'words') },
      ...catalogue.categories.map((c) => ({ key: `cat:${c.key}`, name: c.label, kind: 'CATEGORY', note: count(catalogue.subcategories.filter((s) => s.category === c.key).length, 'subcategory', 'subcategories') })),
      ...catalogue.subcategories.map((s) => ({ key: `sub:${s.key}`, name: s.label, kind: 'SUBCATEGORY', note: `${count(words.filter((w) => w.targets.some((t) => t.key === s.key)).length, 'word points', 'words point')} here` })),
      ...catalogue.facts.filter((f) => f.kind === 'yesno').map((f) => ({ key: `fact:${f.key}`, name: f.label, kind: 'FACT', note: `${count(words.filter((w) => w.facts.some((x) => x.key === f.key)).length, 'word carries', 'words carry')} it` })),
    ];
    const fq = filterQ.trim().toLowerCase();
    return opts.filter((o) => !fq || o.name.toLowerCase().includes(fq) || o.kind.toLowerCase().includes(fq)).slice(0, 60);
  }, [state, catalogue, view, filterQ]);

  if (error && !state) return <Muted>{error}</Muted>;
  if (!state || !catalogue) return <Muted>Loading…</Muted>;

  const sortSpec = SORTS.find((s) => s.key === sort?.key) ?? SORTS[0];
  const shownCount = view === 'notinepic' ? state.notInEpic.length : state.inEpic.length;

  // ------------------------------------------------------------------------
  return (
    <View style={{ gap: 18 }}>
      {/* Title and the four counts, each a door to its view. */}
      <View style={{
        flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'flex-start' : 'flex-end', justifyContent: 'space-between',
        gap: narrow ? 14 : 24, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18, zIndex: 20,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 }}>
          <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink, flexShrink: 1 }}>Where each of Google’s words points</Text>
          <InfoTip text="Google files every place under its own words. Each word points at the subcategories its places land in — one primary, any others as well — and may carry facts. A word that is not a day out is excluded, and its places leave Epic unless another word keeps them." />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: narrow ? 18 : 30, flexWrap: 'wrap' }}>
          {VIEWS.map((v) => {
            const on = v.key === view;
            const x = state.counts[v.count];
            const fg = on ? LIME : v.key === 'needs' && x ? desk.ink : desk.inkDim;
            return (
              <Press key={v.key} effect="none" onPress={() => go(v.key)}>
                <View style={{ gap: 2 }}>
                  <Text style={{ fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: fg }}>{v.kicker}</Text>
                  <Text style={[{ fontFamily: fonts.body, fontSize: 15, fontWeight: on ? '800' : '600', color: fg }, tabular]}>{n(x)}</Text>
                </View>
              </Press>
            );
          })}
        </View>
      </View>

      {/* The view control, then Filter and Sort. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', zIndex: 15 }}>
        <View style={{ maxWidth: '100%', flexShrink: 1 }}>
          <Seg options={VIEWS.map((v) => ({ key: v.key, name: v.name }))} value={view} onChange={(v) => go(v)} pad={16} />
        </View>
        <ToolButton
          icon="filters"
          label={filters.length ? `${filters.length} ${filters.length === 1 ? 'filter' : 'filters'}` : 'Filter'}
          lit={filters.length > 0}
          onPress={() => { setFilterQ(''); setMenu(menu === 'filter' ? null : 'filter'); }}
        />
        <ToolButton icon="sort" label={`Sorted by ${sortSpec.label} ${sort?.dir === 'asc' ? '↑' : '↓'}`} onPress={() => setMenu(menu === 'sort' ? null : 'sort')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, flex: 1, minWidth: 0, paddingTop: 2 }}>
          {filters.map((f) => (
            <Press key={f.key} effect="none" onPress={() => setFilters(filters.filter((x) => x.key !== f.key))}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: LIME, paddingVertical: 5, paddingHorizontal: 11 }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: ON_LIME }}>{f.name}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: ON_LIME, opacity: 0.55 }}>×</Text>
              </View>
            </Press>
          ))}
          {!filters.length && view !== 'needs' && view !== 'decided' ? (
            <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim, paddingTop: 4 }}>Everything · {n(shownCount)} words</Text>
          ) : null}
        </View>
      </View>

      {menu === 'sort' ? (
        <View style={{ borderWidth: 1, borderColor: desk.ruleStrong, backgroundColor: desk.well, width: 460, maxWidth: '100%' }}>
          {SORTS.map((o) => {
            const on = sort?.key === o.key;
            return (
              <Press key={o.key} effect="none" onPress={() => { setSort({ key: o.key, dir: on && sort?.dir !== 'asc' ? 'asc' : o.first }); setMenu(null); }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
                  <View style={{ width: 14, alignItems: 'center' }}><Icon name={on ? 'check' : 'add'} size={13} color={on ? LIME : desk.ink} /></View>
                  <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 13, fontWeight: on ? '700' : '500', color: on ? LIME : desk.ink }}>{o.name}</Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 11.5, color: desk.inkDim }}>{o.dir}</Text>
                </View>
              </Press>
            );
          })}
        </View>
      ) : null}

      {menu === 'filter' ? (
        <View style={{ borderWidth: 1, borderColor: desk.ruleStrong, backgroundColor: desk.well, width: 760, maxWidth: '100%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
            <Icon name="search" size={14} color={desk.inkDim} />
            <TextInput
              value={filterQ}
              onChangeText={setFilterQ}
              placeholder="Filter by a category, subcategory, fact or state"
              placeholderTextColor={desk.inkDim}
              style={[{ flex: 1, minWidth: 0, color: desk.ink, fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', padding: 0 }, web ? ({ outlineStyle: 'none' } as object) : null]}
            />
            <Press effect="none" onPress={() => setMenu(null)}><Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>close</Text></Press>
          </View>
          <View style={{ maxHeight: 330, overflow: 'scroll' as ViewStyle['overflow'], paddingVertical: 6 }}>
            {filterOptions.map((o) => {
              const on = filters.some((f) => f.key === o.key);
              return (
                <Press key={o.key} effect="none" onPress={() => setFilters(on ? filters.filter((f) => f.key !== o.key) : [...filters, { key: o.key, name: o.name }])}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, paddingHorizontal: 14, flexWrap: narrow ? 'wrap' : 'nowrap' }}>
                    <View style={{ width: 14, alignItems: 'center' }}><Icon name={on ? 'check' : 'add'} size={13} color={on ? LIME : desk.ink} /></View>
                    <Text style={{ width: narrow ? 180 : 280, fontFamily: fonts.body, fontSize: 13, fontWeight: on ? '700' : '500', color: on ? LIME : desk.ink }}>{o.name}</Text>
                    <Text style={{ width: 130, fontFamily: fonts.body, fontSize: 11.5, letterSpacing: 0.46, fontWeight: '700', color: desk.inkDim }}>{o.kind}</Text>
                    <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>{o.note}</Text>
                  </View>
                </Press>
              );
            })}
          </View>
        </View>
      ) : null}

      {error ? <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: RED }}>{error}</Text> : null}

      {view === 'needs' ? (
        <NeedsView state={state} narrow={narrow} onDecide={decide} onChoose={(w) => openWord(w)} onExclude={(w) => void exclude(w)} />
      ) : null}

      {view === 'decided' ? (
        <DecidedView
          decided={decided}
          kind={kind}
          onKind={(k) => setKind(k ?? '', { replace: true })}
          onOpen={(d) => (d.kind === 'Excluded' ? go('notinepic') : openWord(d.word))}
          onUndo={(d) => void undoDecision(d.id)}
        />
      ) : null}

      {view === 'inepic' || view === 'notinepic' ? (
        <WordTable
          words={tableWords}
          out={view === 'notinepic'}
          narrow={narrow}
          speaks={state.everOpenedSpeaks}
          sort={sort}
          onSort={setSort}
          open={word}
          onToggle={(w) => openWord(word === w ? null : w)}
          rowMenu={rowMenu}
          onRowMenu={setRowMenu}
          onExclude={(w) => { setRowMenu(null); void exclude(w); }}
          onBringBack={(w) => void bringBack(w)}
          picker={(w) => (
            <WordPicker
              key={w.word}
              word={w.word}
              catalogue={catalogue}
              subs={w.targets.map((t) => t.key)}
              primary={w.targets.find((t) => t.primary)?.key ?? null}
              facts={w.facts.map((f) => f.key)}
              query={q}
              onQuery={(v) => setQ(v, { replace: true })}
              onToggleSub={(s) => toggleSub(w.word, s)}
              onMakePrimary={(s) => makePrimary(w.word, s)}
              onToggleFact={(f) => toggleFact(w.word, f)}
              onCreate={(label, category) => void create(w.word, label, category)}
              onClose={() => openWord(null)}
            />
          )}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The toolbar's Filter and Sort buttons

function ToolButton({ icon, label, lit, onPress }: { icon: 'filters' | 'sort'; label: string; lit?: boolean; onPress: () => void }) {
  const fg = lit ? LIME : desk.inkMuted;
  return (
    <Press effect="none" onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: lit ? LIME : desk.ruleStrong, paddingVertical: 9, paddingHorizontal: 14 }}>
        <Icon name={icon} size={14} color={fg} />
        <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: fg }}>{label}</Text>
        <Icon name="expand" size={13} color={fg} />
      </View>
    </Press>
  );
}

// ---------------------------------------------------------------------------
// In Epic and Not in Epic: one table

function WordTable({ words, out, narrow, speaks, sort, onSort, open, onToggle, rowMenu, onRowMenu, onExclude, onBringBack, picker }: {
  words: Word[]; out: boolean; narrow: boolean; speaks: boolean;
  sort: SortState<SortKey>; onSort: (s: SortState<SortKey>) => void;
  open: string; onToggle: (w: string) => void;
  rowMenu: { word: string; confirming: boolean } | null; onRowMenu: (m: { word: string; confirming: boolean } | null) => void;
  onExclude: (w: string) => void; onBringBack: (w: string) => void;
  picker: (w: Word) => React.ReactNode;
}) {
  const cols: TCol<string>[] = out
    ? [
      { key: 'word', name: 'Word', width: 250, first: 'asc' },
      { key: 'brings', name: 'Brings in', width: 120, first: 'desc' },
      { key: 'why', name: 'Why it’s out', width: 240, sortable: false },
      { key: 'who', name: 'Decided by', width: 150, sortable: false },
      { key: 'when', name: 'When', width: 110, sortable: false },
      { key: 'back', name: '', width: 130, sortable: false },
    ]
    : [
      { key: 'word', name: 'Google’s word', width: 250, first: 'asc' },
      { key: 'brings', name: 'Brings in', width: 120, first: 'desc' },
      {
        key: 'opened', name: 'Ever opened', width: 120, first: 'asc',
        tip: speaks ? undefined : 'Fewer than two households have ever opened a place, so this cannot say anything yet.',
      },
      { key: 'points', name: 'Points at', width: 440, first: 'asc' },
      { key: 'menu', name: '', width: 40, sortable: false },
    ];
  const width = tableWidth(cols);
  if (!words.length) return <Muted>{out ? 'No word is out of Epic.' : 'No word matches.'}</Muted>;
  return (
    <View style={{ zIndex: 1 }}>
      <Table width={width}>
        <THead cols={cols} sort={sort as SortState<string>} onSort={(s) => onSort(s as SortState<SortKey>)} />
        {words.map((w) => {
          const isOpen = open === w.word && !out;
          const menuOpen = rowMenu?.word === w.word;
          return (
            <View key={w.word} style={{ borderBottomWidth: 1, borderBottomColor: desk.rule, backgroundColor: isOpen ? desk.lifted : 'transparent', zIndex: menuOpen ? 30 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 11, paddingHorizontal: 8 }}>
                <TCell width={250}><T weight="600">{w.word}</T></TCell>
                <TCell width={120}><T num weight={w.brings > 100 ? '800' : '400'}>{n(w.brings)}</T></TCell>
                {out ? (
                  <>
                    <TCell width={240}><T size={12.5} tone={desk.inkMuted}>{w.why ?? '—'}</T></TCell>
                    <TCell width={150}><T size={12.5} tone={desk.inkMuted}>{w.decidedBy ?? '—'}</T></TCell>
                    <TCell width={110}><T size={12.5} tone={desk.inkDim}>{ago(w.decidedAt)}</T></TCell>
                    <TCell width={130}>
                      <Press effect="none" onPress={() => onBringBack(w.word)}>
                        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: LIME }}>Bring it back</Text>
                      </Press>
                    </TCell>
                  </>
                ) : (
                  <>
                    <TCell width={120}>
                      {/* Null is "cannot speak": a dash, never a nought. */}
                      <T num tone={w.opened === 0 ? RED : desk.inkMuted}>{w.opened == null ? '—' : w.opened === 0 ? 'never' : n(w.opened)}</T>
                    </TCell>
                    <TCell width={440}>
                      <Press effect="none" onPress={() => onToggle(w.word)}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', flexShrink: 1 }}>
                            {!w.targets.length && !w.facts.length ? (
                              <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '600', color: w.answer === 'secondary' ? desk.inkMuted : LIME }}>{pointsOf(w)}</Text>
                            ) : null}
                            {w.targets.map((t, i) => (
                              <Chip key={t.key} primary={i === 0} name={t.label + (i === 0 && w.targets.length > 1 ? ' (primary)' : '')} />
                            ))}
                            {w.facts.map((f) => <Chip key={f.key} fact name={f.label} />)}
                          </View>
                          <Icon name={isOpen ? 'collapse' : 'expand'} size={13} color={desk.inkDim} />
                        </View>
                      </Press>
                    </TCell>
                    <TCell width={40} style={{ alignItems: 'flex-end', position: 'relative' }}>
                      <Press effect="none" onPress={() => onRowMenu(menuOpen ? null : { word: w.word, confirming: false })} accessibilityLabel={`More for ${w.word}`}>
                        <View style={{ paddingHorizontal: 6 }}><Icon name="menu" size={16} color={desk.inkDim} /></View>
                      </Press>
                      {menuOpen ? (
                        <View style={[{
                          position: 'absolute', top: 24, right: 0, width: 300, zIndex: 30, backgroundColor: desk.picked,
                          borderWidth: 1, borderColor: desk.ruleStrong,
                        }, SHADOW]}>
                          {rowMenu?.confirming ? (
                            <View style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>
                              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.ink, lineHeight: 19.5 }}>
                                Exclude {w.word}? Its {n(w.brings)} places will leave Epic.
                              </Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                                <Press effect="none" onPress={() => onExclude(w.word)}>
                                  <Text style={{ backgroundColor: RED, color: ON_LIME, paddingVertical: 7, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700' }}>Exclude</Text>
                                </Press>
                                <Press effect="none" onPress={() => onRowMenu(null)}>
                                  <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>Cancel</Text>
                                </Press>
                              </View>
                            </View>
                          ) : (
                            <Press effect="none" onPress={() => onRowMenu({ word: w.word, confirming: true })}>
                              <Text style={{ paddingVertical: 10, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink }}>Exclude this word</Text>
                            </Press>
                          )}
                        </View>
                      ) : null}
                    </TCell>
                  </>
                )}
              </View>
              {isOpen ? (
                <View style={{ paddingTop: 4, paddingBottom: 20, paddingRight: 8, paddingLeft: narrow ? 8 : 268 }}>
                  {picker(w)}
                </View>
              ) : null}
            </View>
          );
        })}
      </Table>
      <Text style={{ paddingTop: 4, fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>click a column header to sort</Text>
    </View>
  );
}

/** A Points-at chip: the primary lime, others lime-ruled, facts outlined with a tag. */
function Chip({ name, primary, fact }: { name: string; primary?: boolean; fact?: boolean }) {
  const fg = fact ? desk.inkMuted : primary ? ON_LIME : LIME;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, paddingHorizontal: 9, borderWidth: 1.5,
      borderColor: fact ? desk.ruleStrong : LIME, backgroundColor: primary && !fact ? LIME : 'transparent',
    }}>
      {fact ? <Icon name="tag" size={11} color={fg} /> : null}
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: fg }}>{name}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Needs a decision

function NeedsView({ state, narrow, onDecide, onChoose, onExclude }: {
  state: MappingState; narrow: boolean;
  onDecide: (w: Word, action: 'apply' | 'keep', group: string) => void;
  onChoose: (w: string) => void; onExclude: (w: string) => void;
}) {
  if (!state.needs.length) return <Muted>Nothing needs a decision.</Muted>;
  const cols: TCol[] = [
    { key: 'word', name: 'Google’s word', width: 180 },
    { key: 'from', name: 'Points at now', width: 200 },
    { key: 'to', name: 'Change to', width: narrow ? 300 : 380 },
    { key: 'affected', name: 'Places affected', width: 130 },
    { key: 'act', name: '', width: 180 },
  ];
  const width = tableWidth(cols, 24);
  return (
    <View style={{ gap: 18 }}>
      {GROUPS.map((g) => {
        const rows = state.needs.filter((w) => (w.proposal?.group ?? 'no_suggestion') === g.key);
        if (!rows.length) return null;
        const none = g.key === 'no_suggestion';
        return (
          <View key={g.key} style={{ gap: 10, paddingTop: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 14, fontWeight: '800', color: desk.ink }}>{g.name}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: desk.rule }} />
            </View>
            <Table width={width}>
              <THead cols={cols} gap={24} />
              {rows.map((w) => {
                const p = w.proposal!;
                return (
                  <TRow key={w.word} gap={24}>
                    <TCell width={180}>
                      <Press effect="none" onPress={() => onChoose(w.word)}><T weight="600">{w.word}</T></Press>
                    </TCell>
                    <TCell width={200}><T size={13} tone={desk.inkMuted}>{p.pointsAtNow ?? 'not answered'}</T></TCell>
                    <TCell width={narrow ? 300 : 380}><T size={13}>{none ? 'No suggestion — choose where it goes' : p.changeTo ?? '—'}</T></TCell>
                    <TCell width={130}><T num>{n(none ? w.brings : p.affected)}</T></TCell>
                    <TCell width={180}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        {none ? (
                          <>
                            <ActButton label="Choose" onPress={() => onChoose(w.word)} />
                            <ActButton label="Exclude" quiet onPress={() => onExclude(w.word)} />
                          </>
                        ) : (
                          <>
                            <ActButton label={VERB[p.action] ?? 'Apply'} lime onPress={() => onDecide(w, 'apply', g.name)} />
                            <ActButton label="Keep" quiet onPress={() => onDecide(w, 'keep', g.name)} />
                          </>
                        )}
                      </View>
                    </TCell>
                  </TRow>
                );
              })}
            </Table>
          </View>
        );
      })}
    </View>
  );
}

function ActButton({ label, onPress, lime, quiet }: { label: string; onPress: () => void; lime?: boolean; quiet?: boolean }) {
  return (
    <Press effect="none" onPress={onPress}>
      <Text style={{
        backgroundColor: lime ? LIME : 'transparent', color: lime ? ON_LIME : quiet ? desk.inkMuted : desk.ink,
        borderWidth: 1.5, borderColor: lime ? LIME : desk.ruleStrong, paddingVertical: 6, paddingHorizontal: 12,
        fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700',
      }}>{label}</Text>
    </Press>
  );
}

// ---------------------------------------------------------------------------
// Decided

function DecidedView({ decided, kind, onKind, onOpen, onUndo }: {
  decided: Decided | null; kind: string; onKind: (k: string | null) => void;
  onOpen: (d: Decision) => void; onUndo: (d: Decision) => void;
}) {
  const cols: TCol[] = [
    { key: 'word', name: 'Google’s word', width: 200 },
    { key: 'kind', name: 'Decision', width: 130 },
    { key: 'why', name: 'Why', width: 360 },
    { key: 'who', name: 'Decided by', width: 150 },
    { key: 'when', name: 'When', width: 120 },
    { key: 'undo', name: '', width: 80 },
  ];
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>Decision</Text>
        <View style={{ maxWidth: '100%', flexShrink: 1 }}>
          <Seg
            options={[{ key: '', name: 'All' }, ...KINDS.map((k) => ({ key: k, name: k }))]}
            value={KINDS.includes(kind) ? kind : ''}
            onChange={(k) => onKind(k || null)}
            pad={14}
            size={12.5}
          />
        </View>
      </View>
      {!decided ? <Muted>Loading…</Muted> : (
        <Table width={tableWidth(cols, 24)}>
          <THead cols={cols} gap={24} />
          {!decided.rows.length ? <Muted>No decisions yet.</Muted> : null}
          {decided.rows.map((d) => (
            <TRow key={d.id} gap={24}>
              <TCell width={200}><Press effect="none" onPress={() => onOpen(d)}><T weight="600">{d.word}</T></Press></TCell>
              <TCell width={130}><T size={13}>{d.kind}</T></TCell>
              <TCell width={360}><T size={12.5} tone={desk.inkMuted}>{d.why ?? '—'}</T></TCell>
              <TCell width={150}><T size={12.5} tone={desk.inkMuted}>{d.who}</T></TCell>
              <TCell width={120}><T size={12.5} tone={desk.inkDim}>{ago(d.at)}</T></TCell>
              <TCell width={80}>
                {/* Only the newest live decision on a word can be taken back. */}
                {d.latest ? (
                  <Press effect="none" onPress={() => onUndo(d)}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted, borderBottomWidth: 1, borderBottomColor: desk.ruleStrong, alignSelf: 'flex-start' }}>Undo</Text>
                  </Press>
                ) : null}
              </TCell>
            </TRow>
          ))}
          {decided.total > decided.rows.length ? (
            <Text style={{ paddingTop: 8, fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>The newest {n(decided.rows.length)} of {n(decided.total)}.</Text>
          ) : null}
        </Table>
      )}
    </View>
  );
}
