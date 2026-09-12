/**
 * Lookup — one place, one travel time, and what every source has inside it.
 *
 * Owner, 12 Sep 2026: "I want to be able to enter a place, for example, my
 * home, Sunningdale… set the driving distance as 30 minutes, 50 minutes, or 15
 * minutes… set the method of transport: drive, walk, or public transport… see
 * activities and food and drink… see the numbers by provider… click on any one
 * of those numbers to view the actual data… click on one of those activities to
 * then see the actual data that we get… literally the fields that we get."
 *
 * And on the first draft, the same day: "food and drink and activities should
 * be a tab… I'd like it both ways: click on Category Fun and see Google 12 fun
 * activities and this other thing 8 fun activities… the other way around also:
 * click on Google, then see all the activities and what category they fall
 * into… I don't like these big black boxes… the pills should be pills, but
 * where there's lots of information, I should have drop-downs… Within should
 * be a drop-down. Getting There should be a drop-down. Number of Minutes should
 * be right next to it."
 *
 * So the screen is:
 *
 *   one control line   the place, a Look button, Within as a dropdown with the
 *                      minutes box beside it, Getting there as a dropdown
 *   one quiet line     where it resolved to, the ring, how long it took
 *   two tabs           Activities · n  |  Food & drink · n
 *   two lenses         By category — a matrix: categories down, sources across,
 *                      each cell a count you can open; a category opens out
 *                      into its drawers.
 *                      By source — one row per source, what it returned and
 *                      what is inside the ring; a row opens its places.
 *   one thing at a time — a cell or a row opens a list in place of the matrix,
 *                      a place opens its records in place of the list, and a
 *                      crumb head takes you back a level.
 *
 * Nothing is boxed. The design follows what the owner has already approved on
 * Sources and Categories the same day: dropdowns for a choice with many
 * options, hairlines to track rows, blank cells rather than zeros, the chosen
 * tab a flat lime word, the one primary button. Every level is an address:
 *
 *   /admin/lookup?q=Sunningdale&mins=30&mode=drive           the matrix
 *   …&kind=food&lens=source                                   the other tab, the other lens
 *   …&cat=fun&source=google                                   one cell opened: its places
 *   …&cat=fun&sub=play-soft-play&source=atlas                 one drawer's cell
 *   …&place=google%3AChIJ…                                   one place: the records
 *
 * One read makes every number. The API answers with every place inside the
 * travel time and which sources carry it; the tabs, the matrix and the source
 * rows are all counted from that list here. Opening a place is the second read.
 *
 * Layout follows the working agreements: width from `useViewport`, one tree
 * with different styles rather than two returns, nothing over 390px — the
 * matrix scrolls sideways inside the frame.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, LookupItem, LookupOpened, LookupResult, LookupSource } from '../../api';
import { colors, spacing, type, BORDER } from '../../theme';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { CrumbHead } from '../../components/ControlRow';
import { useViewport } from '../../hooks/useViewport';
import { AdminPage, Dropdown, PageHead, Pill, count, plural } from '../kit';
import { asNumber, asOneOf, asText, useQueryState, useRouter, useStickyQuery } from '../../router';

const WIDE = 900;

type Mode = 'drive' | 'walk' | 'transit';
const MODES = ['drive', 'walk', 'transit'] as const;
const MODE_LABEL: Record<Mode, string> = { drive: 'Drive', walk: 'Walk', transit: 'Public transport' };
const MODE_WORD: Record<Mode, string> = { drive: 'by car', walk: 'on foot', transit: 'by public transport' };

type Kind = 'activities' | 'food';
const KINDS = ['activities', 'food'] as const;
const KIND_LABEL: Record<Kind, string> = { activities: 'Activities', food: 'Food & drink' };

type Lens = 'category' | 'source';
const LENSES = ['category', 'source'] as const;

/** The travel times the owner named, and the two either side of them. */
const MINUTES = [15, 30, 45, 60, 90];

/** `sub=none` is the places no drawer has been taught for — a gap, and the one most worth a number. */
const NO_DRAWER = 'none';
/** `cat=none` likewise: a word rather than nothing, because the router drops an empty value (Codex, 12 Sep 2026). */
const NO_CATEGORY = 'none';
/** `source=all` is the column that counts every source together. */
const ALL = 'all';

const MONO = Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' });
const OWNED = new Set(['atlas', 'sweep', 'own']);
/** A source's name as a column heading: short enough to sit over a number. */
const SHORT: Record<string, string> = { osm: 'OSM', google: 'Google', tripadvisor: 'Tripadvisor', fixtures: 'Fixtures', atlas: 'Atlas', sweep: 'Sweep', own: 'Owned' };
const shortOf = (s: LookupSource) => SHORT[s.key] ?? s.label;

export function Lookup() {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { setQuery } = useRouter();

  // The three settings and the four layers, all in the address.
  const [q] = useQueryState<string | null>('q', null, asText);
  const [mins, setMins] = useQueryState<number | null>('mins', 30, asNumber(30));
  const [mode, setMode] = useQueryState<Mode>('mode', 'drive', asOneOf(MODES, 'drive'));
  const [kind] = useQueryState<Kind>('kind', 'activities', asOneOf(KINDS, 'activities'));
  const [lens] = useQueryState<Lens>('lens', 'category', asOneOf(LENSES, 'category'));
  const [cat] = useQueryState<string | null>('cat', null, asText);
  const [sub] = useQueryState<string | null>('sub', null, asText);
  const [source] = useQueryState<string | null>('source', null, asText);
  const [place] = useQueryState<string | null>('place', null, asText);
  useStickyQuery('admin.lookup', ['q', 'mins', 'mode']);
  const minutes = mins ?? 30;

  // What is being typed, before it is asked for. Enter or Look asks.
  const [typed, setTyped] = useState(q ?? '');
  useEffect(() => { setTyped(q ?? ''); }, [q]);
  const ask = () => {
    const next = typed.trim();
    if (!next) return;
    // A new place is a new look; whatever was opened cannot survive it.
    setQuery({ q: next, cat: null, sub: null, source: null, place: null });
  };

  const [result, setResult] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!q) { setResult(null); return; }
    let live = true;
    setBusy(true);
    setError(null);
    api.lookup({ q, minutes, mode })
      .then((r) => { if (live) setResult(r); })
      .catch((e: any) => { if (live) { setResult(null); setError(e?.body?.message ?? e?.message ?? 'The lookup failed.'); } })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [q, minutes, mode]);

  // One place opened: the second read.
  const [opened, setOpened] = useState<LookupOpened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  useEffect(() => {
    if (!q || !place) { setOpened(null); setOpenError(null); return; }
    let live = true;
    setOpened(null);
    setOpenError(null);
    api.lookupPlace({ q, minutes, mode, ref: place })
      .then((r) => { if (live) setOpened(r); })
      .catch((e: any) => { if (live) setOpenError(e?.body?.message ?? e?.message ?? 'Could not open it.'); });
    return () => { live = false; };
  }, [q, minutes, mode, place]);

  // --- names ---------------------------------------------------------------
  const catLabel = useMemo(() => new Map((result?.taxonomy.categories ?? []).map((c) => [c.key, c.label])), [result]);
  const subLabel = useMemo(() => new Map((result?.taxonomy.subcategories ?? []).map((s) => [s.key, s.label])), [result]);
  const nameOfCat = (key: string | null) => (key == null || key === NO_CATEGORY ? 'No category' : catLabel.get(key) ?? key);
  const nameOfSub = (key: string | null) => (key == null || key === NO_DRAWER ? 'No drawer' : subLabel.get(key) ?? key);
  const sourceOf = (key: string): LookupSource | undefined => result?.sources.find((s) => s.key === key);
  const nameOfSource = (key: string | null) => (key == null || key === ALL ? 'Every source' : sourceOf(key)?.label ?? key);

  // --- the one list, and every number from it -------------------------------
  const items = result?.items ?? [];
  const ofKind = useMemo(() => items.filter((i) => i.kind === kind), [items, kind]);
  /** Sources drawn as columns: the ones that were asked and hold something in this half. */
  const columns = useMemo(
    () => (result?.sources ?? []).filter((s) => s.asked && ofKind.some((i) => i.sources.includes(s.key))),
    [result, ofKind],
  );
  const carries = (i: LookupItem, key: string) => key === ALL || i.sources.includes(key);
  const inCat = (i: LookupItem, c: string | null) => c == null || (c === NO_CATEGORY ? i.shelf == null : i.shelf === c);
  const inSub = (i: LookupItem, s: string | null) => s == null || (s === NO_DRAWER ? i.subcategory == null : i.subcategory === s);

  /** The matrix's rows: categories in taxonomy order, each with its drawers. */
  const matrix = useMemo(() => {
    const order = (result?.taxonomy.categories ?? []).map((c) => c.key);
    const cats = [...new Set(ofKind.map((i) => i.shelf ?? NO_CATEGORY))].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    return cats.map((c) => {
      const within = ofKind.filter((i) => inCat(i, c));
      const subOrder = (result?.taxonomy.subcategories ?? []).filter((s) => s.category === c).map((s) => s.key);
      const subs = [...new Set(within.map((i) => i.subcategory ?? NO_DRAWER))]
        .sort((a, b) => (a === NO_DRAWER ? 1 : b === NO_DRAWER ? -1 : (subOrder.indexOf(a) + 1 || 999) - (subOrder.indexOf(b) + 1 || 999)));
      return { key: c, items: within, subs: subs.map((s) => ({ key: s, items: within.filter((i) => inSub(i, s)) })) };
    });
  }, [ofKind, result]);
  /** Food is one shelf, so its drawers are the rows; Activities has several, so its drawers open out under each. By the tab, not by what this ring happened to hold. */
  const flat = kind === 'food';

  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const toggleCat = (c: string) => setOpenCats((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  // --- moving about ----------------------------------------------------------
  const pickKind = (k: Kind) => setQuery({ kind: k === 'activities' ? null : k, cat: null, sub: null, source: null, place: null });
  const pickLens = (l: Lens) => setQuery({ lens: l === 'category' ? null : l, cat: null, sub: null, source: null, place: null });
  const openCell = (c: string | null, s: string | null, src: string) => setQuery({ cat: c, sub: s, source: src, place: null }, { replace: false });
  const openSource = (src: string) => setQuery({ cat: null, sub: null, source: src, place: null }, { replace: false });
  const openPlace = (ref: string) => setQuery({ place: ref }, { replace: false });
  const closeList = () => setQuery({ cat: null, sub: null, source: null, place: null });
  const closePlace = () => setQuery({ place: null });

  const listed = useMemo(
    () => (source ? ofKind.filter((i) => carries(i, source) && inCat(i, cat) && inSub(i, sub)) : []),
    [ofKind, source, cat, sub],
  );
  const failed = (result?.sources ?? []).filter((s) => s.failed);

  const level: 'matrix' | 'list' | 'place' = place ? 'place' : source ? 'list' : 'matrix';
  const crumb = [cat != null && !flat ? nameOfCat(cat) : null, sub != null ? nameOfSub(sub) : null, source ? nameOfSource(source) : null].filter(Boolean).join(' › ');

  return (
    <AdminPage>
      <PageHead title="Lookup" sub="One place, one travel time, and what every source has inside it." />

      {/* --- the control line ------------------------------------------------ */}
      <View style={[styles.controls, !wide && styles.controlsNarrow]}>
        <View style={[styles.search, wide && { width: 300, flexGrow: 0 }]}>
          <Icon name="search" size={14} color={colors.inkMuted} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={ask}
            placeholder="Town, postcode or lat,lng"
            placeholderTextColor={colors.inkFaint}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {typed ? (
            <Press onPress={() => setTyped('')} accessibilityRole="button" accessibilityLabel="Clear" hitSlop={6}>
              <Icon name="close" size={13} color={colors.inkMuted} />
            </Press>
          ) : null}
        </View>
        <Button label="Look" kind="primary" onPress={ask} loading={busy} disabled={!typed.trim()} />
        <View style={styles.within}>
          <Dropdown
            label="Within" value={`${minutes} min`} width={180}
            options={MINUTES.map((m) => ({ key: String(m), label: `${m} minutes`, on: minutes === m }))}
            onPick={(k) => setMins(Number(k))}
          />
          <MinutesBox value={minutes} onChange={(v) => setMins(v)} />
        </View>
        <Dropdown
          label="Getting there" value={MODE_LABEL[mode]} width={200}
          options={MODES.map((m) => ({ key: m, label: MODE_LABEL[m], on: mode === m }))}
          onPick={(k) => setMode(k as Mode)}
        />
      </View>

      {/* --- the quiet line ---------------------------------------------------- */}
      {error ? <Note tone="crit">{error}</Note> : null}
      {busy && !result ? <Note>Looking around {q}… the first look at a ring waits for OpenStreetMap, which can take ten seconds; the next look at it is instant.</Note> : null}
      {!q && !busy ? <Note>Type a place and press Look. The rented sources are asked once and held for twelve hours; our own pools cost nothing to ask.</Note> : null}
      {result ? (
        <View style={{ gap: 2 }}>
          <Text style={type.tiny}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{result.place.label}</Text>
            {result.place.kind ? ` · ${result.place.kind}` : ''}{result.place.where ? ` · ${result.place.where}` : ''}
            {` · within ${result.minutes} min ${MODE_WORD[mode]}, a ring of about ${result.radiusKm} km`}
            {` · ${result.cached ? 'from the cache' : 'fetched'} in ${(result.tookMs / 1000).toFixed(1)}s`}
            {' · travel time is estimated from the distance'}
          </Text>
          {result.capped ? <Note tone="warn">The ring was cut to {result.radiusKm} km: {result.minutes} minutes {MODE_WORD[mode]} reaches further than any source will answer.</Note> : null}
          {failed.map((s) => (
            <Note key={s.key} tone="warn"><Text style={{ fontWeight: '700' }}>{s.label}:</Text> {s.failed!.why}{s.failed!.slow ? ' It was still looking when the search was answered.' : ''} <Text style={{ fontFamily: MONO }}>{s.failed!.error}</Text></Note>
          ))}
        </View>
      ) : null}

      {result ? (
        <>
          {/* --- the tabs, and the lens ------------------------------------- */}
          <View style={styles.tabs}>
            {KINDS.map((k) => (
              <Choice key={k} label={`${KIND_LABEL[k]} · ${count(items.filter((i) => i.kind === k).length)}`} on={kind === k} onPress={() => pickKind(k)} big />
            ))}
            <View style={{ flex: 1 }} />
            {level === 'matrix' ? (
              <View style={styles.lens}>
                <Text style={styles.kicker}>By</Text>
                <Choice label="Category" on={lens === 'category'} onPress={() => pickLens('category')} />
                <Choice label="Source" on={lens === 'source'} onPress={() => pickLens('source')} />
              </View>
            ) : null}
          </View>

          {/* --- one level at a time ------------------------------------------ */}
          {level === 'place' ? (
            <Opened
              opened={opened} error={openError}
              crumb={`${KIND_LABEL[kind]}${crumb ? ` › ${crumb}` : ''}`}
              nameOfCat={nameOfCat} nameOfSub={nameOfSub} nameOfSource={nameOfSource}
              onBack={closePlace}
            />
          ) : null}

          {level === 'list' ? (
            <View>
              <CrumbHead
                onBack={closeList} backLabel="Back to the numbers"
                title={crumb}
                sub={`${KIND_LABEL[kind]} · within ${result.minutes} min ${MODE_WORD[mode]} · nearest first`}
                aside={plural(listed.length, 'place')}
              />
              {wide ? (
                <View style={styles.listHead}>
                  <Text style={[styles.headText, { flex: 3 }]}>Place</Text>
                  <Text style={[styles.headText, { flex: 3 }]}>{cat ? 'Kind · drawer' : 'Kind · category › drawer'}</Text>
                  <Text style={[styles.headText, styles.num]}>Min</Text>
                  <Text style={[styles.headText, styles.num]}>km</Text>
                  <Text style={[styles.headText, styles.numWide]}>Rating</Text>
                  <Text style={[styles.headText, { flex: 2 }]}>Sources</Text>
                </View>
              ) : null}
              {listed.length ? listed.map((i) => (
                <Press key={i.ref} onPress={() => openPlace(i.ref)} accessibilityRole="button" style={({ hovered }: any) => [styles.row, !wide && styles.rowNarrow, hovered && { backgroundColor: colors.well }]}>
                  <Text style={[styles.name, wide && { flex: 3 }]} numberOfLines={2}>{i.name}</Text>
                  <Text style={[type.tiny, wide && { flex: 3 }]} numberOfLines={2}>
                    {i.category} · {cat ? '' : `${nameOfCat(i.shelf)} › `}{nameOfSub(i.subcategory)}
                  </Text>
                  {wide ? (
                    <>
                      <Text style={[styles.cellNum, styles.num]}>{i.travelMinutes}</Text>
                      <Text style={[styles.cellNum, styles.num]}>{i.distanceKm.toFixed(1)}</Text>
                      <Text style={[styles.cellNum, styles.numWide, i.rating == null && { color: colors.inkFaint }]}>{i.rating == null ? '' : `${i.rating} (${count(i.ratingCount)})`}</Text>
                    </>
                  ) : (
                    <Text style={type.tiny}>{i.travelMinutes} min · {i.distanceKm.toFixed(1)} km{i.rating != null ? ` · ${i.rating} (${count(i.ratingCount)})` : ''}</Text>
                  )}
                  <View style={[styles.pills, wide && { flex: 2 }]}>
                    {i.sources.map((s) => <Pill key={s} label={nameOfSource(s)} tone={OWNED.has(s) ? 'accent' : 'plain'} />)}
                  </View>
                </Press>
              )) : <Text style={styles.empty}>Nothing here inside {result.minutes} minutes.</Text>}
            </View>
          ) : null}

          {level === 'matrix' && lens === 'category' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={!wide} contentContainerStyle={{ minWidth: '100%' }}>
              <View style={{ minWidth: (wide ? 190 : 120) + (columns.length + 1) * (wide ? 84 : 58), flex: 1 }}>
                <View style={styles.gridHead}>
                  <Text style={[styles.headText, styles.label, !wide && styles.labelNarrow]}>{flat ? 'Drawer' : 'Category'}</Text>
                  <Text style={[styles.headText, styles.cell, !wide && styles.cellNarrow]}>All</Text>
                  {columns.map((s) => <Text key={s.key} style={[styles.headText, styles.cell, !wide && styles.cellNarrow]} numberOfLines={1}>{shortOf(s)}</Text>)}
                </View>
                {matrix.map((row) => {
                  const open = flat || openCats.has(row.key);
                  const rows = flat
                    ? row.subs.map((s) => ({ key: s.key, label: nameOfSub(s.key), items: s.items, cat: row.key, sub: s.key as string | null, depth: 0 }))
                    : [{ key: row.key, label: nameOfCat(row.key), items: row.items, cat: row.key, sub: null as string | null, depth: 0 },
                      ...(open ? row.subs.map((s) => ({ key: `${row.key}/${s.key}`, label: nameOfSub(s.key), items: s.items, cat: row.key, sub: s.key as string | null, depth: 1 })) : [])];
                  return rows.map((r) => (
                    <View key={r.key} style={[styles.gridRow, r.depth === 1 && styles.gridRowSub]}>
                      <Press
                        disabled={flat || r.depth === 1}
                        onPress={() => toggleCat(r.cat)}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        style={[styles.label, !wide && styles.labelNarrow, styles.labelPress, r.depth === 1 && { paddingLeft: 22 }]}
                      >
                        {!flat && r.depth === 0 ? <Icon name={open ? 'expand' : 'more'} size={13} color={colors.inkMuted} /> : null}
                        <Text style={[type.small, { color: colors.ink, fontWeight: r.depth === 0 ? '700' : '500', flexShrink: 1 }]} numberOfLines={1}>{r.label}</Text>
                        {!flat && r.depth === 0 && wide ? <Text style={type.tiny}>{plural(row.subs.length, 'drawer')}</Text> : null}
                      </Press>
                      <Cell n={r.items.length} strong narrow={!wide} onPress={() => openCell(r.cat, r.sub, ALL)} what={`${r.label}, every source`} />
                      {columns.map((s) => (
                        <Cell key={s.key} n={r.items.filter((i) => i.sources.includes(s.key)).length} narrow={!wide} onPress={() => openCell(r.cat, r.sub, s.key)} what={`${r.label}, ${s.label}`} />
                      ))}
                    </View>
                  ));
                })}
              </View>
            </ScrollView>
          ) : null}
          {level === 'matrix' && lens === 'category' ? (
            <Text style={styles.foot}>A place two sources both returned counts once under each, so the columns add up to more than All. Tap a number for the places behind it{flat ? '' : '; tap a category for its drawers'}.</Text>
          ) : null}

          {level === 'matrix' && lens === 'source' ? (
            <View>
              <View style={styles.gridHead}>
                <Text style={[styles.headText, { flex: 1 }]}>Source</Text>
                <Text style={[styles.headText, styles.cell, styles.cellWide]}>Returned</Text>
                <Text style={[styles.headText, styles.cell, styles.cellWide]}>Within {result.minutes}</Text>
                <View style={{ width: 20 }} />
              </View>
              <SourceRow label="Every source" note="each place counted once" returned={result.totals.returned[kind]} kept={ofKind.length} onPress={() => openSource(ALL)} />
              {result.sources.map((s) => (
                <SourceRow
                  key={s.key} label={s.label} owned={s.layer === 'owned'} asked={s.asked} failed={Boolean(s.failed)}
                  note={!s.asked ? 'opt-in and billed per place — switching it on is the owner’s call'
                    : s.failed ? s.failed.why
                      : s.capped ? `asked up to ${s.reachKm} km of the ${result.radiusKm} km ring, its own limit`
                        : s.layer === 'owned' ? s.note ?? '' : 'rented — fetched at display, never stored'}
                  returned={s.returned[kind]} kept={ofKind.filter((i) => i.sources.includes(s.key)).length}
                  onPress={s.asked ? () => openSource(s.key) : undefined}
                />
              ))}
              <Text style={styles.foot}>Returned is everything the source handed back for this half; Within is what sits inside the ring. Tap a source for its places and what each is filed as.</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// the quiet pieces
// ---------------------------------------------------------------------------

/** A line of information, never a box: a small icon and a sentence. */
function Note({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' | 'crit' }) {
  return (
    <View style={styles.note}>
      <Icon name={tone === 'plain' ? 'info' : 'allergen'} size={13} color={tone === 'crit' ? colors.overrun : colors.inkMuted} />
      <Text style={[type.tiny, { flex: 1 }, tone === 'crit' && { color: colors.overrun }]}>{children}</Text>
    </View>
  );
}

/** One of a few choices in a line: the chosen one is a flat lime word. */
function Choice({ label, on, onPress, big }: { label: string; on: boolean; onPress: () => void; big?: boolean }) {
  return (
    <Press onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.choice, big && styles.choiceBig, on && styles.choiceOn]}>
      <Text style={[big ? type.body : type.small, { color: on ? colors.selectedFg : colors.inkMuted, fontWeight: on ? '700' : '500' }]}>{label}</Text>
    </Press>
  );
}

/** A number you can open. Blank when it is nothing, which reads better than a column of zeros. */
function Cell({ n, onPress, strong, narrow, what }: { n: number; onPress: () => void; strong?: boolean; narrow?: boolean; what: string }) {
  if (!n) return <View style={[styles.cell, narrow && styles.cellNarrow]} />;
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={`${what}: ${n}`} style={({ hovered }: any) => [styles.cell, narrow && styles.cellNarrow, styles.cellPress, hovered && { backgroundColor: colors.well }]}>
      <Text style={[styles.cellNum, strong && { fontWeight: '800' }]}>{count(n)}</Text>
    </Press>
  );
}

/** The minutes, typed: a small box beside the dropdown, committed when you leave it. */
function MinutesBox({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Math.round(Number(text.replace(/[^0-9]/g, '')));
    if (!Number.isFinite(n) || !text.trim()) { setText(String(value)); return; }
    const next = Math.min(180, Math.max(5, n));
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <View style={styles.minutes}>
      <TextInput
        value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit}
        keyboardType="number-pad" returnKeyType="done" selectTextOnFocus
        accessibilityLabel="Minutes" style={styles.minutesInput}
      />
      <Text style={type.tiny}>min</Text>
    </View>
  );
}

function SourceRow({ label, note, owned, asked = true, failed, returned, kept, onPress }: {
  label: string; note: string; owned?: boolean; asked?: boolean; failed?: boolean; returned: number; kept: number; onPress?: () => void;
}) {
  return (
    <Press onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${returned} returned, ${kept} within reach`}
           style={({ hovered }: any) => [styles.gridRow, hovered && onPress && { backgroundColor: colors.well }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 1, paddingVertical: 6, paddingHorizontal: 4 }}>
        <View style={styles.inline}>
          <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{label}</Text>
          {owned ? <Pill label="ours" tone="accent" icon="owned" /> : null}
          {!asked ? <Pill label="not asked" icon="locked" /> : null}
          {failed ? <Pill label="failed" tone="warn" /> : null}
        </View>
        <Text style={type.tiny} numberOfLines={2}>{note}</Text>
      </View>
      <Text style={[styles.cellNum, styles.cell, styles.cellWide, (!asked || !returned) && { color: colors.inkFaint }]}>{asked ? (returned ? count(returned) : '') : '—'}</Text>
      <Text style={[styles.cellNum, styles.cell, styles.cellWide, { fontWeight: '800' }, (!asked || !kept) && { color: colors.inkFaint }]}>{asked ? (kept ? count(kept) : '') : '—'}</Text>
      <View style={{ width: 20, alignItems: 'flex-end' }}>{onPress ? <Icon name="more" size={14} color={colors.inkMuted} /> : null}</View>
    </Press>
  );
}

// ---------------------------------------------------------------------------
// one place opened: the records, field by field
// ---------------------------------------------------------------------------

function Opened({ opened, error, crumb, nameOfCat, nameOfSub, nameOfSource, onBack }: {
  opened: LookupOpened | null; error: string | null; crumb: string;
  nameOfCat: (k: string | null) => string; nameOfSub: (k: string | null) => string; nameOfSource: (k: string) => string;
  onBack: () => void;
}) {
  if (error) return <View><CrumbHead onBack={onBack} title="Could not open it" sub={crumb} /><Note tone="crit">{error}</Note></View>;
  if (!opened) return <View><CrumbHead onBack={onBack} title="Opening…" sub={crumb} /><Note>Fetching the records.</Note></View>;
  const { item, records, resolved } = opened;
  return (
    <View>
      <CrumbHead
        onBack={onBack} backLabel="Back to the list"
        title={item.name}
        sub={`${crumb} · ${item.category} · ${item.shelf === 'food' ? '' : `${nameOfCat(item.shelf)} › `}${nameOfSub(item.subcategory)} · ${item.travelMinutes} min · ${item.distanceKm.toFixed(1)} km`}
        aside={plural(records.length, 'record')}
      />
      <View style={[styles.inline, { paddingVertical: spacing.sm }]}>
        {item.sources.map((s) => <Pill key={s} label={nameOfSource(s)} tone={OWNED.has(s) ? 'accent' : 'plain'} />)}
        <Text style={[type.tiny, { fontFamily: MONO }]}>{item.ref}</Text>
        {item.website ? (
          <Press onPress={() => Linking.openURL(item.website!)} accessibilityRole="link">
            <Text style={[type.tiny, styles.link]} numberOfLines={1}>{item.website}</Text>
          </Press>
        ) : null}
      </View>
      {records.map((r, i) => (
        <RecordFold key={`${r.source}:${i}`} title={r.label} fields={r.fields} startOpen={i === 0} />
      ))}
      {resolved ? <RecordFold title="As Epic resolved it" note="one row from all of them; provenance says which source each field came from" fields={resolved} /> : null}
    </View>
  );
}

/** One record, folded: its name, how full it is, and every field when opened. */
function RecordFold({ title, note, fields, startOpen = false }: { title: string; note?: string; fields: Record<string, unknown>; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const { width } = useViewport();
  const wide = width >= 700;
  const keys = Object.keys(fields);
  const filled = keys.filter((k) => !isBlank(fields[k])).length;
  return (
    <View>
      <Press onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.fold}>
        <Icon name={open ? 'expand' : 'more'} size={14} color={colors.inkMuted} />
        <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{title}</Text>
        <Text style={type.tiny}>{plural(keys.length, 'field')} · {filled} filled{note ? ` · ${note}` : ''}</Text>
      </Press>
      {open ? keys.map((k) => (
        <View key={k} style={[styles.field, !wide && styles.fieldNarrow]}>
          <Text style={[styles.fieldKey, wide && { width: 180 }]} numberOfLines={wide ? 1 : undefined}>{k}</Text>
          <View style={{ flex: 1, minWidth: 0 }}><Value v={fields[k]} /></View>
        </View>
      )) : null}
    </View>
  );
}

const isBlank = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <Text style={[styles.fieldValue, styles.blank]}>{v === null ? 'null' : 'undefined'}</Text>;
  if (typeof v === 'string') {
    if (v === '') return <Text style={[styles.fieldValue, styles.blank]}>""</Text>;
    if (/^https?:\/\//.test(v)) {
      return (
        <Press onPress={() => Linking.openURL(v)} accessibilityRole="link">
          <Text style={[styles.fieldValue, styles.link]}>{v}</Text>
        </Press>
      );
    }
    return <Text style={styles.fieldValue}>{v}</Text>;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return <Text style={styles.fieldValue}>{String(v)}</Text>;
  if (Array.isArray(v) && v.length === 0) return <Text style={[styles.fieldValue, styles.blank]}>[]</Text>;
  if (typeof v === 'object' && Object.keys(v as object).length === 0) return <Text style={[styles.fieldValue, styles.blank]}>{'{}'}</Text>;
  return <Text style={styles.fieldValue}>{JSON.stringify(v, null, 2)}</Text>;
}

const HAIR = 1;

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', zIndex: 20, position: 'relative' },
  controlsNarrow: { gap: spacing.xs },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, minWidth: 200,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: spacing.sm, minHeight: 36, backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, minWidth: 0, ...type.small, color: colors.ink, paddingVertical: 6, outlineStyle: 'none' as any },
  within: { flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 30 },
  minutes: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  minutesInput: {
    width: 52, minHeight: 36, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    textAlign: 'center', ...type.small, color: colors.ink, fontWeight: '700', outlineStyle: 'none' as any,
  },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 2 },

  tabs: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', borderBottomWidth: BORDER, borderBottomColor: colors.line, paddingBottom: 6, marginTop: spacing.sm },
  lens: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kicker: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.inkMuted, marginRight: 4 },
  choice: { paddingHorizontal: 8, paddingVertical: 3 },
  choiceBig: { paddingHorizontal: 10, paddingVertical: 5 },
  choiceOn: { backgroundColor: colors.selected },

  headText: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', color: colors.inkMuted },
  gridHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: HAIR, borderBottomColor: colors.line },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40, borderBottomWidth: HAIR, borderBottomColor: colors.lineSoft },
  gridRowSub: { backgroundColor: colors.surfaceMuted },
  label: { width: 190, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  labelNarrow: { width: 120, flexGrow: 0 },
  labelPress: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 },
  cell: { width: 84, alignItems: 'flex-end', justifyContent: 'center', textAlign: 'right', paddingHorizontal: 6 },
  cellNarrow: { width: 58, paddingHorizontal: 3 },
  cellWide: { width: 96 },
  cellPress: { alignSelf: 'stretch' },
  cellNum: { ...type.small, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  foot: { ...type.tiny, paddingVertical: spacing.sm },

  listHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: HAIR, borderBottomColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: HAIR, borderBottomColor: colors.lineSoft },
  rowNarrow: { flexDirection: 'column', alignItems: 'flex-start', gap: 3 },
  name: { ...type.small, color: colors.ink, fontWeight: '700' },
  num: { width: 48, textAlign: 'right' },
  numWide: { width: 92, textAlign: 'right' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  empty: { ...type.small, color: colors.inkMuted, paddingVertical: spacing.md },

  fold: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: HAIR, borderBottomColor: colors.line, flexWrap: 'wrap' },
  field: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 5, paddingLeft: 22, borderBottomWidth: HAIR, borderBottomColor: colors.lineSoft, alignItems: 'flex-start' },
  fieldNarrow: { flexDirection: 'column', gap: 2 },
  fieldKey: { ...type.tiny, fontFamily: MONO, color: colors.inkMuted, paddingTop: 1 },
  fieldValue: { ...type.tiny, fontFamily: MONO, color: colors.ink },
  blank: { color: colors.inkFaint },
  link: { color: colors.accent, textDecorationLine: 'underline' },
});
