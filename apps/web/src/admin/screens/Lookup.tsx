/**
 * Lookup — one place, one travel time, and what every source has inside it.
 *
 * Owner, 12 Sep 2026: "I want to be able to enter a place, for example, my
 * home, Sunningdale… set the driving distance as 30 minutes, 50 minutes, or 15
 * minutes… set the method of transport: drive, walk, or public transport… see
 * activities and food and drink… see the numbers by provider… click on any one
 * of those numbers to view the actual data… click on one of those activities to
 * then see the actual data that we get… literally the fields that we get for
 * that data and the data that's actually returned in those fields."
 *
 * "The purpose of this screen is for me to be able to work at speed to
 * understand gaps in our platform, be it the data quality or the volume of data
 * that we're getting for any location."
 *
 * So it is three layers, and every one of them is an address:
 *
 *   /admin/lookup?q=Sunningdale&mins=30&mode=drive          the counts, by source
 *   …&kind=activities&source=google                          one number opened: its places
 *   …&sub=soft-play                                          narrowed to one drawer
 *   …&place=google%3AChIJ…                                   one place opened: the records
 *
 * One read makes every number. The API answers with every place inside the
 * travel time and which sources carry it; the tiles, the two tables and the
 * drawer chips are all counted from that list here, so narrowing to soft play
 * is instant and never asks a provider anything. Opening a place is the one
 * second read — the records are big and most of them are never looked at.
 *
 * The rented sources are asked through the same cache as every screen in the
 * app, so a second look at the same ring costs nothing; the first look waits
 * for OpenStreetMap properly, because this is somebody wanting the whole
 * answer rather than a spinner wanting to stop.
 *
 * Layout follows the working agreements: width from `useViewport`, one tree
 * with different styles rather than two returns, nothing over 390px. The
 * record column sits to the right on a wide screen and above the list on a
 * phone — the same two children, `row-reverse` against `column`.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, LookupItem, LookupOpened, LookupResult, LookupSource } from '../../api';
import { colors, radius, spacing, type, BORDER } from '../../theme';
import { Icon } from '../../components/Icon';
import { Button, Row, Segmented, Stepper, Wrap } from '../../components/ui';
import { useViewport } from '../../hooks/useViewport';
import { AdminPage, Banner, Column, DataTable, FilterChip, FilterRow, PageHead, Panel, Pill, Tile, TileRow, count, plural } from '../kit';
import { asNumber, asOneOf, asText, useQueryState, useRouter, useStickyQuery } from '../../router';

const WIDE = 1000;

type Mode = 'drive' | 'walk' | 'transit';
const MODES = ['drive', 'walk', 'transit'] as const;
const MODE_WORD: Record<Mode, string> = { drive: 'by car', walk: 'on foot', transit: 'by public transport' };

type Kind = 'activities' | 'food';
const KINDS = ['activities', 'food'] as const;
const KIND_LABEL: Record<Kind, string> = { activities: 'Activities', food: 'Food & drink' };

/** The travel times the owner named, and the two either side of them. */
const MINUTES = [15, 30, 45, 60, 90];

/** `sub=none` is the places no drawer has been taught for — a gap, and the one most worth a number. */
const NO_DRAWER = 'none';

const MONO = Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' });

export function Lookup() {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const { setQuery } = useRouter();

  // The three settings, and the three layers, all in the address.
  const [q, setQ] = useQueryState<string | null>('q', null, asText);
  const [mins, setMins] = useQueryState<number | null>('mins', 30, asNumber(30));
  const [mode, setMode] = useQueryState<Mode>('mode', 'drive', asOneOf(MODES, 'drive'));
  const [kind] = useQueryState<Kind | null>('kind', null, asOneOf(KINDS, null));
  const [source] = useQueryState<string | null>('source', null, asText);
  const [sub, setSub] = useQueryState<string | null>('sub', null, asText);
  const [place] = useQueryState<string | null>('place', null, asText);
  useStickyQuery('admin.lookup', ['q', 'mins', 'mode']);

  const minutes = mins ?? 30;

  // What is being typed, before it is asked for. Enter or Go asks.
  const [typed, setTyped] = useState(q ?? '');
  useEffect(() => { setTyped(q ?? ''); }, [q]);
  const ask = () => {
    const next = typed.trim();
    if (!next) return;
    // A new place is a new look: the opened record cannot survive it, the
    // number and drawer that were open may — comparing two towns on the same
    // setting is exactly what this is for.
    setQuery({ q: next, place: null });
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

  // --- every number, from the one list ------------------------------------
  const subLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of result?.taxonomy.subcategories ?? []) m.set(s.key, s.label);
    for (const c of result?.taxonomy.categories ?? []) m.set(`cat:${c.key}`, c.label);
    return m;
  }, [result]);
  const nameOfSub = (key: string | null) => (key ? subLabel.get(key) ?? key : 'no drawer');
  const nameOfShelf = (key: string | null) => (key ? subLabel.get(`cat:${key}`) ?? key : '—');

  const items = result?.items ?? [];
  const inDrawer = (i: LookupItem) => !sub || (sub === NO_DRAWER ? i.subcategory == null : i.subcategory === sub);
  const narrowed = useMemo(() => items.filter(inDrawer), [items, sub]);
  const ofKind = (k: Kind) => narrowed.filter((i) => i.kind === k);
  const carrying = (list: LookupItem[], key: string) => list.filter((i) => i.sources.includes(key)).length;

  /** The drawers present in one half, counted before the drawer filter so the chips do not vanish when one is picked. */
  const drawersOf = (k: Kind) => {
    const tallies = new Map<string, number>();
    for (const i of items) if (i.kind === k) tallies.set(i.subcategory ?? NO_DRAWER, (tallies.get(i.subcategory ?? NO_DRAWER) ?? 0) + 1);
    return [...tallies.entries()].sort((a, b) => b[1] - a[1]);
  };

  const failed = (result?.sources ?? []).filter((s) => s.failed);
  const sourceLabel = (key: string) => result?.sources.find((s) => s.key === key)?.label ?? key;

  /** A number opened: which half, which source. */
  const open = (k: Kind, s: string) => setQuery({ kind: k, source: s, place: null }, { replace: false });

  const listed = kind && source ? ofKind(kind).filter((i) => source === 'all' || i.sources.includes(source)) : [];

  const columns: Column<LookupItem & { id: string }>[] = [
    { key: 'name', head: 'Place', width: 3, sort: (r) => r.name, cell: (r) => <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]} numberOfLines={2}>{r.name}</Text> },
    {
      key: 'what', head: 'What', width: 3, sort: (r) => `${r.category} ${r.shelf ?? ''} ${r.subcategory ?? ''}`,
      cell: (r) => <Text style={type.tiny} numberOfLines={2}>{r.category} · {nameOfShelf(r.shelf)} › {nameOfSub(r.subcategory)}</Text>,
    },
    { key: 'min', head: 'Min', width: 1, align: 'right', sort: (r) => r.travelMinutes, cell: (r) => <Text style={[type.small, styles.num]}>{r.travelMinutes}</Text> },
    { key: 'km', head: 'km', width: 1, align: 'right', sort: (r) => r.distanceKm, cell: (r) => <Text style={[type.small, styles.num]}>{r.distanceKm.toFixed(1)}</Text>, wideOnly: true },
    {
      key: 'rating', head: 'Rating', width: 1, align: 'right', sort: (r) => r.rating ?? -1, wideOnly: true,
      cell: (r) => <Text style={[type.small, styles.num, r.rating == null && { color: colors.inkFaint }]}>{r.rating == null ? '—' : `${r.rating} (${count(r.ratingCount)})`}</Text>,
    },
    {
      key: 'sources', head: 'Sources', width: 2, sort: (r) => r.sources.length,
      cell: (r) => <Wrap style={{ gap: 4 }}>{r.sources.map((s) => <Pill key={s} label={sourceLabel(s)} tone={s === 'atlas' || s === 'sweep' || s === 'own' ? 'accent' : 'plain'} />)}</Wrap>,
    },
  ];

  return (
    <AdminPage>
      <PageHead
        title="Lookup"
        sub="One place, one travel time, and what every source has inside it — the numbers first, then the places behind a number, then the fields behind a place."
      />

      {/* --- where, how far, how ------------------------------------------- */}
      <Panel title="Where, and how far">
        <View style={styles.search}>
          <Icon name="search" size={15} color={colors.inkMuted} />
          <TextInput
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={ask}
            placeholder="A town, a postcode, or lat,lng — Sunningdale, SL5 0LT, 51.39,-0.63"
            placeholderTextColor={colors.inkFaint}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {typed ? (
            <Press onPress={() => setTyped('')} accessibilityRole="button" accessibilityLabel="Clear">
              <Icon name="close" size={14} color={colors.inkMuted} />
            </Press>
          ) : null}
          <Button label="Look" kind="primary" onPress={ask} loading={busy} disabled={!typed.trim()} />
        </View>

        <View style={[styles.settings, !wide && styles.settingsNarrow]}>
          <View style={{ gap: 6, flex: 1, minWidth: 0 }}>
            <Text style={styles.settingLabel}>Within</Text>
            <FilterRow>
              {MINUTES.map((m) => <FilterChip key={m} label={`${m} min`} on={minutes === m} onPress={() => setMins(m)} />)}
            </FilterRow>
            <View style={{ maxWidth: 260 }}>
              <Stepper label="Or any number of minutes" value={minutes} min={5} max={180} onChange={(v) => setMins(v)} />
            </View>
          </View>
          <View style={{ gap: 6, flex: 1, minWidth: 0 }}>
            <Text style={styles.settingLabel}>Getting there</Text>
            <Segmented<Mode>
              value={mode}
              onChange={(m) => setMode(m)}
              options={[
                { value: 'drive', label: 'Drive', icon: 'driving' },
                { value: 'walk', label: 'Walk', icon: 'walking' },
                { value: 'transit', label: 'Public transport', icon: 'transit' },
              ]}
            />
            <Text style={type.tiny}>
              Travel time is worked out from the distance and a speed for the mode — the same estimate every card in the app carries — so "30 min" is a ring, not a route.
            </Text>
          </View>
        </View>
      </Panel>

      {error ? <Banner tone="crit">{error}</Banner> : null}
      {busy && !result ? (
        <Banner tone="accent">Looking around {q}… the first look at a ring waits for OpenStreetMap, which can take ten seconds. The next look at it is instant.</Banner>
      ) : null}

      {result ? (
        <>
          {/* --- what was looked at ------------------------------------------ */}
          <Banner tone="plain">
            <Text style={{ fontWeight: '700' }}>{result.place.label}</Text>
            {result.place.kind ? ` · ${result.place.kind}` : ''}
            {result.place.where ? ` · ${result.place.where}` : ''}
            {` · ${result.place.lat.toFixed(4)}, ${result.place.lng.toFixed(4)}`}
            {` — within ${result.minutes} min ${MODE_WORD[mode]}, a ring of about ${result.radiusKm} km`}
            {` · ${result.cached ? 'from the cache' : 'fetched'} in ${(result.tookMs / 1000).toFixed(1)}s`}
          </Banner>
          {result.capped ? (
            <Banner tone="warn">
              <Text style={{ fontWeight: '700' }}>The ring was cut to {result.radiusKm} km. </Text>
              {result.minutes} minutes {MODE_WORD[mode]} reaches further than any source will answer — Google looks up to 50 km, OpenStreetMap to 25 — so what is beyond that ring was not asked for.
            </Banner>
          ) : null}
          {failed.map((s) => (
            <Banner key={s.key} tone="warn">
              <Text style={{ fontWeight: '700' }}>{s.label}: </Text>{s.failed!.why}
              {s.failed!.slow ? ' It was still looking when the search was answered.' : ''}
              {' '}<Text style={[type.tiny, { fontFamily: MONO }]}>{s.failed!.error}</Text>
            </Banner>
          ))}

          <TileRow>
            <Tile label={`Places within ${result.minutes} min`} value={count(narrowed.length)} sub={sub ? `in ${nameOfSub(sub === NO_DRAWER ? null : sub)}` : 'activities and food together'} />
            <Tile label="Activities" value={count(ofKind('activities').length)} sub="somewhere to go" tone="accent" onPress={() => open('activities', 'all')} />
            <Tile label="Food & drink" value={count(ofKind('food').length)} sub="somewhere to eat" tone="accent" onPress={() => open('food', 'all')} />
            <Tile label="Sources asked" value={count(result.sources.length)} sub={failed.length ? `${plural(failed.length, 'source')} failed` : 'every one answered'} tone={failed.length ? 'warn' : 'ok'} />
          </TileRow>

          {/* --- the numbers, by source, per half ---------------------------- */}
          <View style={[styles.halves, !wide && styles.halvesNarrow]}>
            {KINDS.map((k) => {
              const list = ofKind(k);
              const drawers = drawersOf(k);
              return (
                <View key={k} style={{ flex: 1, minWidth: 0 }}>
                  <Panel title={`${KIND_LABEL[k]} · ${count(list.length)}`} sub="Places carrying each source. A place two sources both returned counts once, under both." padded={false}>
                    <View style={styles.sourceHead}>
                      <Text style={[styles.sourceCell, { flex: 3 }]}>Source</Text>
                      <Text style={[styles.sourceCell, styles.right]}>Returned</Text>
                      <Text style={[styles.sourceCell, styles.right]}>Within {result.minutes}</Text>
                    </View>
                    <SourceRow
                      label="Everything" note="every source together, each place counted once" layer="rented"
                      returned={result.totals.returned[k]} kept={list.length}
                      on={kind === k && source === 'all'} onPress={() => open(k, 'all')}
                    />
                    {result.sources.map((s) => (
                      <SourceRow
                        key={s.key} label={s.label} note={s.layer === 'owned' ? s.note : s.failed ? s.failed.why : 'rented — fetched at display, never stored'}
                        layer={s.layer} failed={Boolean(s.failed)}
                        returned={s.returned[k]} kept={carrying(list, s.key)}
                        on={kind === k && source === s.key} onPress={() => open(k, s.key)}
                      />
                    ))}
                    <View style={styles.drawers}>
                      <Text style={styles.settingLabel}>By drawer</Text>
                      {drawers.length ? (
                        <FilterRow>
                          {drawers.map(([key, n]) => (
                            <FilterChip
                              key={key}
                              label={key === NO_DRAWER ? 'No drawer' : nameOfSub(key)}
                              count={n}
                              on={sub === key}
                              onPress={() => setSub(sub === key ? null : key)}
                            />
                          ))}
                        </FilterRow>
                      ) : <Text style={type.tiny}>Nothing here to file.</Text>}
                    </View>
                  </Panel>
                </View>
              );
            })}
          </View>

          {/* --- a number opened, and a place opened -------------------------- */}
          <View style={[styles.split, wide ? styles.splitWide : styles.splitNarrow]}>
            {/* The record column only takes its share when a place is open; otherwise the list has the width. */}
            <View style={[styles.recordCol, !wide && { width: '100%' }, wide && !place && { flex: 0 }]}>
              {place ? (
                <Opened
                  opened={opened}
                  error={openError}
                  nameOfShelf={nameOfShelf}
                  nameOfSub={nameOfSub}
                  sourceLabel={sourceLabel}
                  onClose={() => setQuery({ place: null })}
                />
              ) : null}
            </View>

            <View style={[styles.listCol, !wide && { width: '100%' }]}>
              {kind && source ? (
                <Panel
                  title={`${source === 'all' ? 'Every source' : sourceLabel(source)} · ${KIND_LABEL[kind]} · ${plural(listed.length, 'place')}`}
                  sub={`${sub ? `In ${sub === NO_DRAWER ? 'no drawer' : nameOfSub(sub)} · ` : ''}nearest first. Tap a place for every field each source returned.`}
                  padded={false}
                  right={<Button label="Close" icon="close" kind="secondary" onPress={() => setQuery({ kind: null, source: null, place: null })} />}
                >
                  <DataTable
                    rows={listed.map((i) => ({ ...i, id: i.ref }))}
                    columns={columns}
                    initialSort={{ key: 'min', dir: 'asc' }}
                    onRow={(r) => setQuery({ place: r.ref }, { replace: false })}
                    empty={<Text style={type.small}>Nothing from {source === 'all' ? 'any source' : sourceLabel(source)} inside {result.minutes} minutes{sub ? ' in that drawer' : ''}.</Text>}
                  />
                </Panel>
              ) : (
                <View style={styles.hint}>
                  <Icon name="info" size={14} color={colors.inkMuted} />
                  <Text style={type.tiny}>Tap a number above to see the places behind it.</Text>
                </View>
              )}
            </View>
          </View>
        </>
      ) : null}

      {!q && !busy ? (
        <View style={styles.hint}>
          <Icon name="info" size={14} color={colors.inkMuted} />
          <Text style={type.tiny}>Type a place and press Look. The rented sources are asked once and held for twelve hours; our own three pools cost nothing to ask.</Text>
        </View>
      ) : null}
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// one row of the source table
// ---------------------------------------------------------------------------

function SourceRow({ label, note, layer, failed, returned, kept, on, onPress }: {
  label: string; note: string | null; layer: LookupSource['layer']; failed?: boolean;
  returned: number; kept: number; on: boolean; onPress: () => void;
}) {
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${returned} returned, ${kept} within reach`}
      style={({ hovered }: any) => [styles.sourceRow, on && styles.sourceRowOn, hovered && !on && { backgroundColor: colors.well }]}
    >
      <View style={{ flex: 3, minWidth: 0, gap: 1 }}>
        <Row style={{ gap: 6, alignItems: 'center' }}>
          <Text style={[type.small, { color: colors.ink, fontWeight: '700', flexShrink: 1 }]} numberOfLines={2}>{label}</Text>
          {layer === 'owned' ? <Pill label="ours" tone="accent" icon="owned" /> : null}
          {failed ? <Pill label="failed" tone="warn" /> : null}
        </Row>
        {note ? <Text style={type.tiny} numberOfLines={2}>{note}</Text> : null}
      </View>
      <Text style={[styles.sourceNum, styles.right, returned === 0 && { color: colors.inkFaint }]}>{count(returned)}</Text>
      <Text style={[styles.sourceNum, styles.right, { fontWeight: '800' }, kept === 0 && { color: colors.inkFaint }]}>{count(kept)}</Text>
    </Press>
  );
}

// ---------------------------------------------------------------------------
// one place opened: the records, field by field
// ---------------------------------------------------------------------------

function Opened({ opened, error, nameOfShelf, nameOfSub, sourceLabel, onClose }: {
  opened: LookupOpened | null; error: string | null;
  nameOfShelf: (k: string | null) => string; nameOfSub: (k: string | null) => string; sourceLabel: (k: string) => string;
  onClose: () => void;
}) {
  if (error) return <Panel title="Could not open it" right={<Button label="Close" icon="close" kind="secondary" onPress={onClose} />}><Banner tone="crit">{error}</Banner></Panel>;
  if (!opened) return <Panel title="Opening…"><Text style={type.small}>Fetching the records.</Text></Panel>;
  const { item, records, resolved } = opened;
  return (
    <View style={{ gap: spacing.md }}>
      <Panel
        title={item.name}
        sub={`${item.category} · ${nameOfShelf(item.shelf)} › ${nameOfSub(item.subcategory)} · ${item.travelMinutes} min · ${item.distanceKm.toFixed(1)} km · ${item.ref}`}
        right={<Button label="Close" icon="close" kind="secondary" onPress={onClose} />}
      >
        <Wrap style={{ gap: 4 }}>
          {item.sources.map((s) => <Pill key={s} label={sourceLabel(s)} tone={s === 'atlas' || s === 'sweep' || s === 'own' ? 'accent' : 'plain'} />)}
        </Wrap>
        {item.website ? (
          <Press onPress={() => Linking.openURL(item.website!)} accessibilityRole="link">
            <Text style={[type.tiny, styles.link]} numberOfLines={1}>{item.website}</Text>
          </Press>
        ) : null}
        <Text style={type.tiny}>
          {plural(records.length, 'record')} — one per source that returned this place, exactly as it arrived. The last panel is the one row Epic resolved from them.
        </Text>
      </Panel>

      {records.map((r, i) => (
        <Panel key={`${r.source}:${i}`} title={r.label} sub={filledLine(r.fields)} padded={false}>
          <Fields fields={r.fields} />
        </Panel>
      ))}

      {resolved ? (
        <Panel title="As Epic resolved it" sub={`${filledLine(resolved)} — provenance says which source each field came from`} padded={false}>
          <Fields fields={resolved} />
        </Panel>
      ) : null}
    </View>
  );
}

/** "31 fields · 22 filled" — the data-quality number a record has. */
function filledLine(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields);
  const filled = keys.filter((k) => !isBlank(fields[k])).length;
  return `${plural(keys.length, 'field')} · ${filled} filled`;
}

const isBlank = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

function Fields({ fields }: { fields: Record<string, unknown> }) {
  const { width } = useViewport();
  const wide = width >= 700;
  return (
    <View>
      {Object.entries(fields).map(([k, v]) => (
        <View key={k} style={[styles.field, !wide && styles.fieldNarrow]}>
          <Text style={[styles.fieldKey, wide && { width: 180 }]} numberOfLines={wide ? 1 : undefined}>{k}</Text>
          <View style={{ flex: 1, minWidth: 0 }}><Value v={v} /></View>
        </View>
      ))}
    </View>
  );
}

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

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.md,
    paddingLeft: spacing.sm, paddingRight: 4, paddingVertical: 4, backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, minWidth: 0, ...type.small, color: colors.ink, paddingVertical: 6, outlineStyle: 'none' as any },

  settings: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  settingsNarrow: { flexDirection: 'column', gap: spacing.md },
  settingLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.inkMuted },

  halves: { flexDirection: 'row', gap: spacing.md },
  halvesNarrow: { flexDirection: 'column' },

  sourceHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 6, borderBottomWidth: BORDER, borderBottomColor: colors.line,
  },
  sourceCell: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', color: colors.inkMuted, width: 84 },
  sourceRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: BORDER, borderBottomColor: colors.line,
  },
  sourceRowOn: { backgroundColor: colors.selected },
  sourceNum: { ...type.body, color: colors.ink, width: 84, fontVariant: ['tabular-nums'] },
  right: { textAlign: 'right' },
  num: { fontVariant: ['tabular-nums'], color: colors.ink },
  drawers: { padding: spacing.md, gap: 6 },

  split: { gap: spacing.md, alignItems: 'flex-start' },
  // The record column is the first child and sits on the right: row-reverse
  // wide, column narrow, and the tree is the same either way.
  splitWide: { flexDirection: 'row-reverse' },
  splitNarrow: { flexDirection: 'column' },
  recordCol: { flex: 2, minWidth: 0 },
  listCol: { flex: 3, minWidth: 0 },

  hint: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center', padding: spacing.md },

  field: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 5, borderBottomWidth: BORDER, borderBottomColor: colors.line, alignItems: 'flex-start' },
  fieldNarrow: { flexDirection: 'column', gap: 2 },
  fieldKey: { ...type.tiny, fontFamily: MONO, color: colors.inkMuted, paddingTop: 1 },
  fieldValue: { ...type.tiny, fontFamily: MONO, color: colors.ink },
  blank: { color: colors.inkFaint },
  link: { color: colors.accent, textDecorationLine: 'underline' },
});
