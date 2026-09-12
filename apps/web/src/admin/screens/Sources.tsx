/**
 * Sources — every app and API Epic uses, every field each one offers, and
 * which of those fields the code actually reads.
 *
 * The owner, 12 Sep 2026: "a screen that shows all of the apps and APIs that
 * we use, what they give us, and, very specifically, every single field that
 * we utilise… a deduped master list of fields, and then columns for each one of
 * the providers… an ownership tag so that, for sources where we can own the
 * data, I can filter at the top… for the ones that we can keep the data for, I
 * want to see some information about how much data they have and how good the
 * quality of the data is."
 *
 * Three things the screen keeps honest:
 *
 *   1. **Used and offered are different marks.** A filled square is a field the
 *      code reads today, held to the adapters by a test. An outlined square is
 *      a field the provider documents and we do not ask for — read by hand from
 *      their reference, and the date that was done is printed at the top.
 *   2. **The ownership filter hides providers, not fields.** "Own for good"
 *      takes the rented columns away and leaves the rows, so a gap in what we
 *      may keep shows as an empty row rather than vanishing.
 *   3. **Quantity and quality are live numbers, not adjectives.** For an owned
 *      provider a cell says how many places hold the field, what share of the
 *      owned records that is, how sure the source was and how old the oldest
 *      fact is — all from place_facts. Correctness against the world is a
 *      bench that is not built yet, and the screen does not pretend otherwise.
 *
 * The filters travel in the address (`/admin/sources?domain=service&use=unused`)
 * so that "the fields we do not read" is a URL that can be sent to somebody.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, Keep, OwnedFact, SourceField, SourceProvider, SourceService, SourcesReport } from '../../api';
import { colors, radius, spacing, type, BORDER } from '../../theme';
import { Icon } from '../../components/Icon';
import { Row, Wrap } from '../../components/ui';
import { useViewport } from '../../hooks/useViewport';
import { asText, useQueryState } from '../../router';
import { AdminPage, Banner, DataTable, FilterChip, FilterRow, PageHead, Panel, Pill, Tile, TileRow, ago, count, day } from '../kit';

const WIDE = 900;

type Use = 'all' | 'used' | 'unused';
type KeepFilter = 'all' | Keep;

const KEEP_WORD: Record<Keep, string> = { own: 'Own for good', id: 'Identifier only', none: 'Nothing kept' };
const KEEP_TONE: Record<Keep, 'ok' | 'warn' | 'plain'> = { own: 'ok', id: 'warn', none: 'plain' };

// Only what differs from the default is written to the address (CLAUDE.md).
const useCodec = { read: (raw: string): Use | null => (raw === 'used' || raw === 'unused' ? raw : null), write: (v: Use) => (v === 'all' ? null : v) };
const keepCodec = { read: (raw: string): KeepFilter | null => (raw === 'own' || raw === 'id' || raw === 'none' ? raw : null), write: (v: KeepFilter) => (v === 'all' ? null : v) };

export function Sources() {
  const { width } = useViewport();
  const wide = width >= WIDE;

  const [data, setData] = useState<SourcesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [domain, setDomain] = useQueryState<string | null>('domain', null, asText);
  const [use, setUse] = useQueryState<Use>('use', 'all', useCodec);
  const [keep, setKeep] = useQueryState<KeepFilter>('keep', 'all', keepCodec);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.adminSources().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, []);

  // The ownership filter takes columns away; the rows stay and go empty.
  const providers = useMemo(
    () => (data?.providers ?? []).filter((p) => keep === 'all' || p.keep === keep),
    [data, keep],
  );
  const shownKeys = useMemo(() => new Set(providers.map((p) => p.key)), [providers]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.fields.filter((f) => {
      if (domain && f.domain !== domain) return false;
      // "In use" is judged against the providers left on screen: with the rented
      // columns hidden, a rating is a field nobody we may keep from supplies.
      const cells = Object.entries(f.cells).filter(([k]) => shownKeys.has(k));
      const usedHere = cells.some(([, c]) => c.status === 'used');
      if (use === 'used' && !usedHere) return false;
      if (use === 'unused' && usedHere) return false;
      if (keep !== 'all' && !cells.length) return false;
      if (needle && !`${f.label} ${f.note ?? ''} ${cells.map(([, c]) => c.path).join(' ')}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, domain, use, keep, q, shownKeys]);

  const factAt = useMemo(() => {
    const m = new Map<string, OwnedFact>();
    for (const f of data?.owned.facts ?? []) m.set(`${f.provider}:${f.field}`, f);
    return m;
  }, [data]);

  const totals = useMemo(() => {
    if (!data) return null;
    const used = data.fields.filter((f) => f.used).length;
    return {
      providers: data.providers.length,
      owned: data.providers.filter((p) => p.keep === 'own').length,
      fields: data.fields.length,
      used,
      unused: data.fields.length - used,
      places: data.owned.places,
    };
  }, [data]);

  const grouped = useMemo(() => {
    const out: { domain: SourcesReport['domains'][number]; rows: SourceField[] }[] = [];
    for (const d of data?.domains ?? []) {
      const here = rows.filter((r) => r.domain === d.key);
      if (here.length) out.push({ domain: d, rows: here });
    }
    return out;
  }, [rows, data]);

  return (
    <AdminPage>
      <PageHead
        title="Sources"
        sub={data ? `Every provider, every field, and which of them we read. What each provider offers was read from its reference on ${day(data.checkedOn)}.` : 'Every provider, every field, and which of them we read.'}
      />

      {error ? <Banner tone="crit">{error}</Banner> : null}

      {totals ? (
        <TileRow>
          <Tile label="Providers" value={count(totals.providers)} sub={`${totals.owned} we may keep for good`} />
          <Tile label="Master fields" value={count(totals.fields)} sub="deduplicated across every provider" />
          <Tile label="In use" value={count(totals.used)} sub="read by the code today" tone="ok" />
          <Tile label="Not in use" value={count(totals.unused)} sub="offered by somebody, asked for by nobody" tone="warn" onPress={() => setUse('unused')} />
          <Tile label="Owned places" value={count(totals.places)} sub={`${count(data?.owned.done)} fully researched`} tone="accent" />
        </TileRow>
      ) : null}

      <Panel title="The matrix" sub="A filled square is a field we read. An outlined one is offered and not asked for. Tap a row for the paths and, for owned providers, how much we hold." padded={false}>
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <FilterRow>
            <FilterChip label="Every field" on={use === 'all'} onPress={() => setUse('all')} />
            <FilterChip label="In use" on={use === 'used'} onPress={() => setUse('used')} />
            <FilterChip label="Not in use" on={use === 'unused'} onPress={() => setUse('unused')} />
            <View style={styles.divider} />
            <FilterChip label="Every provider" on={keep === 'all'} onPress={() => setKeep('all')} />
            <FilterChip label="Own for good" on={keep === 'own'} onPress={() => setKeep('own')} />
            <FilterChip label="Identifier only" on={keep === 'id'} onPress={() => setKeep('id')} />
            <FilterChip label="Nothing kept" on={keep === 'none'} onPress={() => setKeep('none')} />
          </FilterRow>
          <FilterRow>
            <FilterChip label="All domains" on={!domain} onPress={() => setDomain(null)} />
            {(data?.domains ?? []).map((d) => (
              <FilterChip key={d.key} label={d.label} on={domain === d.key} onPress={() => setDomain(domain === d.key ? null : d.key)} />
            ))}
          </FilterRow>
          <View style={styles.search}>
            <Icon name="search" size={15} color={colors.inkMuted} />
            <TextInput
              value={q} onChangeText={setQ}
              placeholder="A field, or a provider's own name for it — parking, servesBeer, opening_hours"
              placeholderTextColor={colors.inkFaint}
              style={styles.searchInput}
              autoCapitalize="none"
            />
            {q ? (
              <Press onPress={() => setQ('')} accessibilityRole="button" accessibilityLabel="Clear">
                <Icon name="close" size={14} color={colors.inkMuted} />
              </Press>
            ) : null}
          </View>
          <Text style={type.tiny}>{rows.length} of {data?.fields.length ?? 0} fields · {providers.length} of {data?.providers.length ?? 0} providers</Text>
        </View>

        {/* The grid scrolls sideways on its own, so twenty provider columns fit
            a 390px frame without the page growing wider than the phone. */}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
          <View style={{ minWidth: LABEL_W + providers.length * CELL_W }}>
            {/* A plain row, not `Row`: that one has a gap, and a gap in the head
                that the body rows do not share walks the labels off their columns. */}
            <View style={styles.gridHead}>
              <View style={{ width: LABEL_W }}><Text style={styles.headText}>Field</Text></View>
              {providers.map((p) => (
                <View key={p.key} style={styles.cellHead}>
                  <Text style={styles.cellHeadText} numberOfLines={2}>{p.short}</Text>
                  <KeepDot keep={p.keep} />
                </View>
              ))}
            </View>

            {grouped.map(({ domain: d, rows: here }) => (
              <View key={d.key}>
                <View style={styles.domainRow}>
                  <Text style={styles.domainText}>{d.label}</Text>
                  <Text style={type.tiny}> · {d.what}</Text>
                </View>
                {here.map((f) => (
                  <View key={f.key}>
                    <Press
                      onPress={() => setOpen(open === f.key ? null : f.key)}
                      style={({ hovered }: any) => [styles.gridRow, hovered ? styles.rowHover : null, open === f.key ? styles.rowOpen : null]}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open === f.key }}
                    >
                      <View style={{ width: LABEL_W, paddingRight: spacing.sm }}>
                        <Text style={[type.small, { color: colors.ink }]} numberOfLines={1}>{f.label}</Text>
                        <Row style={{ gap: 6 }}>
                          {f.keep ? <Text style={type.tiny}>{KEEP_WORD[f.keep]}</Text> : <Text style={type.tiny}>Not read</Text>}
                        </Row>
                      </View>
                      {providers.map((p) => {
                        const c = f.cells[p.key];
                        return (
                          <View key={p.key} style={styles.cell} accessibilityLabel={c ? `${p.label}: ${c.status} (${c.path})` : `${p.label}: not offered`}>
                            {c ? <Mark status={c.status} /> : <View style={styles.none} />}
                          </View>
                        );
                      })}
                    </Press>
                    {open === f.key ? <RowDetail field={f} providers={providers} factAt={factAt} wide={wide} /> : null}
                  </View>
                ))}
              </View>
            ))}
            {!rows.length ? <View style={{ padding: spacing.lg }}><Text style={type.small}>No field matches those filters.</Text></View> : null}
          </View>
        </ScrollView>
      </Panel>

      <Panel title="What we hold" sub="For the providers we may keep: how many of the owned places carry each field, how sure the source was, and how old the oldest fact is." padded={false}>
        <OwnedTable data={data} providers={data?.providers ?? []} />
      </Panel>

      <Panel title="The providers" sub="What each one is, on what terms, and how often it is asked. A key is reported present or absent, never shown.">
        <Wrap style={{ gap: spacing.sm }}>
          {providers.map((p) => <ProviderCard key={p.key} p={p} searchable={data?.searchable[p.key] ?? false} />)}
        </Wrap>
        <Text style={type.tiny}>Sample data (fixtures) is Epic's own and is not a provider. The local scout is a Claude run over council and venue pages rather than a data source; it is under Services.</Text>
      </Panel>

      <Panel title="Services" sub="What we pay for that yields no field about a place." padded={false}>
        <DataTable<SourceService & { id: string }>
          rows={(data?.services ?? []).map((s) => ({ ...s, id: s.key }))}
          columns={[
            { key: 'label', head: 'Service', width: 2, cell: (s) => <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{s.label}</Text> },
            { key: 'what', head: 'What it does', width: 5, cell: (s) => <Text style={type.small}>{s.what}</Text> },
            { key: 'unit', head: 'Billed in', width: 2, wideOnly: true, cell: (s) => <Text style={type.small}>{s.unit}</Text> },
            { key: 'key', head: 'Key', width: 1, cell: (s) => <Pill label={s.hasKey ? 'present' : 'absent'} tone={s.hasKey ? 'ok' : 'warn'} /> },
            { key: 'calls', head: '30 days', width: 1, align: 'right', sort: (s) => s.calls.days30, cell: (s) => <Text style={type.small}>{count(s.calls.days30)}</Text> },
            { key: 'all', head: 'All time', width: 1, align: 'right', wideOnly: true, sort: (s) => s.calls.all, cell: (s) => <Text style={type.small}>{count(s.calls.all)}</Text> },
            { key: 'console', head: 'Console', width: 2, wideOnly: true, cell: (s) => s.console ? <Link label={s.console.label} url={s.console.url} /> : <Text style={type.tiny}>—</Text> },
          ]}
        />
      </Panel>
    </AdminPage>
  );
}

const LABEL_W = 180;
const CELL_W = 48;

/** Filled for read, outlined for offered. Ink either way: a mark, not a colour. */
function Mark({ status }: { status: 'used' | 'offered' }) {
  return status === 'used'
    ? <View style={styles.markUsed}><Icon name="check" size={11} color={colors.primaryFg} strokeWidth={3} /></View>
    : <View style={styles.markOffered} />;
}

function KeepDot({ keep }: { keep: Keep }) {
  return <View style={[styles.keepDot, keep === 'own' ? styles.keepOwn : keep === 'id' ? styles.keepId : styles.keepNone]} />;
}

function Link({ label, url }: { label: string; url: string }) {
  return (
    <Press onPress={() => Linking.openURL(url)} accessibilityRole="link" style={styles.link}>
      <Text style={[type.tiny, { color: colors.ink, textDecorationLine: 'underline' }]} numberOfLines={1}>{label}</Text>
      <Icon name="external" size={11} color={colors.inkMuted} />
    </Press>
  );
}

/** One row opened: every provider's own path for the field, and what we hold of it. */
function RowDetail({ field, providers, factAt, wide }: {
  field: SourceField; providers: SourceProvider[]; factAt: Map<string, OwnedFact>; wide: boolean;
}) {
  const named = providers.filter((p) => field.cells[p.key]);
  return (
    <View style={styles.detail}>
      {field.note ? <Text style={[type.small, { marginBottom: spacing.xs }]}>{field.note}</Text> : null}
      {!named.length ? <Text style={type.small}>No provider on screen offers this.</Text> : null}
      {named.map((p) => {
        const c = field.cells[p.key];
        const fact = factAt.get(`${p.key}:${field.key}`);
        return (
          <View key={p.key} style={[styles.detailRow, wide && { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }]}>
            <View style={wide ? { width: 150 } : undefined}>
              <Row style={{ gap: 6 }}>
                <Mark status={c.status} />
                <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{p.label}</Text>
              </Row>
              <Text style={type.tiny}>{KEEP_WORD[p.keep]}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.mono}>{c.path}</Text>
              <Text style={type.tiny}>{c.status === 'used' ? `Read today · ${p.lands}` : 'Offered by the provider; the code does not ask for it.'}</Text>
            </View>
            {p.keep === 'own' ? (
              <View style={wide ? { width: 260 } : { marginTop: 4 }}>
                {fact ? (
                  <Text style={type.tiny}>
                    Held for <Text style={{ color: colors.ink, fontWeight: '700' }}>{count(fact.held)}</Text> of {count(fact.of)} owned places ({fact.coverage ?? 0}%)
                    {fact.confidence != null ? ` · confidence ${fact.confidence}` : ''} · oldest {ago(fact.oldest)}
                  </Text>
                ) : (
                  <Text style={type.tiny}>{c.status === 'used' ? 'Nothing held yet.' : 'Not collected.'}</Text>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** The quantity-and-quality table for what we may keep. */
function OwnedTable({ data, providers }: { data: SourcesReport | null; providers: SourceProvider[] }) {
  const byKey = new Map(providers.map((p) => [p.key, p]));
  const labelOf = new Map((data?.fields ?? []).map((f) => [f.key, f.label]));
  const rows = (data?.owned.facts ?? [])
    .map((f) => ({ ...f, id: `${f.provider}:${f.field}`, providerLabel: byKey.get(f.provider)?.label ?? f.provider, fieldLabel: labelOf.get(f.field) ?? f.field }));
  const lib = data?.owned.library;
  return (
    <View>
      {lib ? (
        <View style={{ padding: spacing.md, paddingBottom: 0 }}>
          <TileRow>
            <Tile label="Owned places" value={count(data?.owned.places)} sub={`${count(data?.owned.done)} researched to the end`} />
            <Tile label="Atlas attractions" value={count(lib.attractions.reduce((n, a) => n + a.n, 0))} sub={`${count(lib.attractions.reduce((n, a) => n + a.with_summary, 0))} with a description`} />
            <Tile label="Pictures we own" value={count(Object.values(lib.images).reduce((n, i) => n + i.n, 0))} sub={Object.entries(lib.images).map(([k, v]) => `${byKey.get(k)?.short ?? k} ${v.n}`).join(' · ') || 'none yet'} />
            <Tile label="Areas" value={count(Object.values(lib.localities).reduce((n, v) => n + v, 0))} sub={Object.entries(lib.localities).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none yet'} />
            <Tile label="Stations" value={count(lib.transitStops.n)} sub={`${count(lib.householdPlaces.with_station)} household places with a nearest station`} />
          </TileRow>
        </View>
      ) : null}
      <DataTable
        rows={rows}
        initialSort={{ key: 'held', dir: 'desc' }}
        empty={<Text style={type.small}>No owned facts yet. A place is researched once a household shortlists, saves or visits it.</Text>}
        columns={[
          { key: 'field', head: 'Field', width: 2, sort: (r) => r.fieldLabel, cell: (r) => <Text style={[type.small, { color: colors.ink }]}>{r.fieldLabel}</Text> },
          { key: 'provider', head: 'From', width: 2, sort: (r) => r.providerLabel, cell: (r) => <Text style={type.small}>{r.providerLabel}</Text> },
          { key: 'held', head: 'Places', width: 1, align: 'right', sort: (r) => r.held, cell: (r) => <Text style={type.small}>{count(r.held)}</Text> },
          { key: 'coverage', head: 'Coverage', width: 1, align: 'right', sort: (r) => r.coverage ?? 0, cell: (r) => <Text style={type.small}>{r.coverage == null ? '—' : `${r.coverage}%`}</Text> },
          { key: 'confidence', head: 'Confidence', width: 1.3, align: 'right', wideOnly: true, sort: (r) => r.confidence ?? 0, cell: (r) => <Text style={type.small}>{r.confidence == null ? '—' : r.confidence.toFixed(2)}</Text> },
          { key: 'oldest', head: 'Oldest', width: 1.4, align: 'right', wideOnly: true, sort: (r) => r.oldest, cell: (r) => <Text style={type.small}>{ago(r.oldest)}</Text> },
          { key: 'newest', head: 'Newest', width: 1.4, align: 'right', wideOnly: true, sort: (r) => r.newest, cell: (r) => <Text style={type.small}>{ago(r.newest)}</Text> },
        ]}
      />
    </View>
  );
}

function ProviderCard({ p, searchable }: { p: SourceProvider; searchable: boolean }) {
  return (
    <View style={styles.card}>
      <Row style={{ alignItems: 'flex-start', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{p.label}</Text>
          <Text style={type.tiny}>{p.licence}</Text>
        </View>
        <Pill label={KEEP_WORD[p.keep]} tone={KEEP_TONE[p.keep]} />
      </Row>
      <Text style={type.tiny}><Text style={styles.k}>Keeps </Text>{p.retention}</Text>
      <Text style={type.tiny}><Text style={styles.k}>Credit </Text>{p.attribution}</Text>
      {p.cost ? <Text style={type.tiny}><Text style={styles.k}>Cost </Text>{p.cost}</Text> : null}
      <Text style={type.tiny}><Text style={styles.k}>Lands in </Text>{p.lands}</Text>
      {p.note ? <Text style={type.tiny}>{p.note}</Text> : null}
      <Row style={{ gap: spacing.sm, flexWrap: 'wrap' }}>
        <Pill label={`${p.usedCount} read`} tone="ok" />
        <Pill label={`${p.offeredCount} offered, not read`} tone={p.offeredCount ? 'warn' : 'plain'} />
        {p.envKey ? <Pill label={p.hasKey ? `${p.envKey} present` : `${p.envKey} absent`} tone={p.hasKey ? 'ok' : 'warn'} icon="locked" /> : <Pill label="no key needed" />}
        {p.switchedOff ? <Pill label="switched off in Settings" tone="warn" /> : null}
      </Row>
      <Text style={type.tiny}>
        Asked <Text style={{ color: colors.ink, fontWeight: '700' }}>{count(p.calls.days30)}</Text> times in 30 days · {count(p.calls.all)} all time
        {p.calls.last ? ` · last ${ago(p.calls.last)}` : p.calls.all ? '' : ' · never through the ledger'}
      </Text>
      {p.owned ? (
        <Text style={type.tiny}>
          Holds <Text style={{ color: colors.ink, fontWeight: '700' }}>{count(p.owned.facts)}</Text> facts across {p.owned.fields} fields on {count(p.owned.records)} places
          {p.owned.oldest ? ` · oldest ${ago(p.owned.oldest)}` : ''}
          {p.owned.images ? ` · ${count(p.owned.images.n)} pictures` : ''}
        </Text>
      ) : null}
      <Row style={{ gap: spacing.md, flexWrap: 'wrap' }}>
        {p.docs ? <Link label="Provider reference" url={p.docs} /> : null}
        {p.console ? <Link label={p.console.label} url={p.console.url} /> : null}
        <Text style={styles.mono} numberOfLines={1}>{p.file}</Text>
      </Row>
      {!searchable && p.envKey && !p.hasKey ? <Text style={type.tiny}>No key on this API right now, so nothing this provider offers reaches the app from here.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { width: BORDER, alignSelf: 'stretch', backgroundColor: colors.line, marginHorizontal: 4 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 7, backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, ...type.small, color: colors.ink, outlineStyle: 'none' as any },

  gridHead: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.md, paddingVertical: 6, borderTopWidth: BORDER, borderBottomWidth: BORDER, borderColor: colors.line, backgroundColor: colors.well },
  headText: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', color: colors.inkMuted },
  cellHead: { width: CELL_W, alignItems: 'center', gap: 3 },
  cellHeadText: { ...type.tiny, fontSize: 9, lineHeight: 11, textAlign: 'center', color: colors.ink, fontWeight: '700' },
  keepDot: { width: 8, height: 8, borderWidth: BORDER, borderColor: colors.ink },
  keepOwn: { backgroundColor: colors.ink },
  keepId: { backgroundColor: colors.surface },
  keepNone: { borderStyle: 'dashed' as any, backgroundColor: colors.surface },

  domainRow: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 4, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  domainText: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.ink },
  gridRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 6, borderBottomWidth: BORDER, borderBottomColor: colors.line, minHeight: 40 },
  rowHover: { backgroundColor: colors.well },
  rowOpen: { backgroundColor: colors.surfaceMuted },
  cell: { width: CELL_W, alignItems: 'center', justifyContent: 'center' },
  markUsed: { width: 16, height: 16, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  markOffered: { width: 16, height: 16, borderWidth: BORDER, borderColor: colors.ink, backgroundColor: colors.surface },
  none: { width: 4, height: 4, backgroundColor: colors.line },

  detail: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, backgroundColor: colors.surfaceMuted, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  detailRow: { gap: 2 },
  mono: { ...type.tiny, color: colors.ink, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' as any },

  card: { flexGrow: 1, flexBasis: 320, minWidth: 280, maxWidth: 520, borderWidth: BORDER, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, gap: 6, backgroundColor: colors.surface },
  k: { color: colors.ink, fontWeight: '700' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
