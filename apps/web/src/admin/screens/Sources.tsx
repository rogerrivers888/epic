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
 * And on the first cut of it, the same day: "If you don't tell me what things
 * mean, then your UI is completely useless, so you need some guidance at the
 * top." So the legend is the first thing in the matrix, always visible, drawn
 * with the actual marks. "If the provider doesn't have any fields within that
 * category, then they should be hidden for the column… we shouldn't have a dot
 * if they don't have anything." So a column with nothing in the chosen domain
 * is gone, and a cell with nothing is blank. "Just a dropdown with tick boxes."
 * So the three filters are dropdowns, the providers one with tick boxes.
 * "Thin lines… clean it up." So rows sit on hairlines, not boxes.
 *
 * The correctness bench lives at the foot: "I would like the option to run
 * correctness at any time… I can say what I want to run it on… it should show
 * me the data, what it's running it on, what it's returned, and then I can make
 * my decisions on a piece-by-piece basis."
 *
 * The filters travel in the address (`/admin/sources?domain=service&use=unused`)
 * so that "the fields we do not read" is a URL that can be sent to somebody.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, SourceBenchDecision, SourceBenchIndex, SourceBenchResult, SourceBenchRow, SourceBenchRun, Keep, OwnedFact, SourceField, SourceProvider, SourceService, SourcesReport } from '../../api';
import { colors, radius, spacing, type } from '../../theme';
import { Icon } from '../../components/Icon';
import { Button, Row, Segmented, Stepper, Wrap } from '../../components/ui';
import { useViewport } from '../../hooks/useViewport';
import { asText, useQueryState } from '../../router';
import { AdminPage, Banner, DataTable, Dropdown, PageHead, Panel, Pill, Tile, TileRow, Toggle, ago, count, day } from '../kit';

const WIDE = 900;

type Use = 'all' | 'used' | 'unused';

const KEEP_WORD: Record<Keep, string> = { own: 'Keep for good', id: 'Identifier only', none: 'Nothing kept' };
const KEEP_SHORT: Record<Keep, string> = { own: 'keep', id: 'ID', none: 'none' };
const KEEP_TONE: Record<Keep, 'ok' | 'warn' | 'plain'> = { own: 'ok', id: 'warn', none: 'plain' };
const USE_WORD: Record<Use, string> = { all: 'Every field', used: 'In use', unused: 'Not in use' };

// Only what differs from the default is written to the address (CLAUDE.md).
const useCodec = { read: (raw: string): Use | null => (raw === 'used' || raw === 'unused' ? raw : null), write: (v: Use) => (v === 'all' ? null : v) };
const listCodec = { read: (raw: string): string[] | null => (raw ? raw.split(',').filter(Boolean) : null), write: (v: string[] | null) => (v && v.length ? v.join(',') : null) };
const offCodec = { read: (raw: string): boolean | null => (raw === '0' ? false : null), write: (v: boolean) => (v ? null : '0') };

export function Sources() {
  const { width } = useViewport();
  const wide = width >= WIDE;

  const [data, setData] = useState<SourcesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [domain, setDomain] = useQueryState<string | null>('domain', null, asText);
  const [use, setUse] = useQueryState<Use>('use', 'all', useCodec);
  /** null is every provider; a list is exactly those. */
  const [picked, setPicked] = useQueryState<string[] | null>('providers', null, listCodec);
  const [hideEmpty, setHideEmpty] = useQueryState<boolean>('hide', true, offCodec);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.adminSources().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, []);

  const allProviders = data?.providers ?? [];
  const chosen = useMemo(() => new Set(picked ?? allProviders.map((p) => p.key)), [picked, allProviders]);

  // Rows in the chosen domain, before the use filter: what decides whether a
  // provider has anything to show in this category at all.
  const inDomain = useMemo(() => (data?.fields ?? []).filter((f) => !domain || f.domain === domain), [data, domain]);

  const providers = useMemo(() => allProviders.filter((p) => {
    if (!chosen.has(p.key)) return false;
    if (hideEmpty && !inDomain.some((f) => f.cells[p.key])) return false;
    return true;
  }), [allProviders, chosen, hideEmpty, inDomain]);
  const shownKeys = useMemo(() => new Set(providers.map((p) => p.key)), [providers]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inDomain.filter((f) => {
      // "In use" is judged against the providers left on screen: with the rented
      // columns hidden, a rating is a field nobody we may keep from supplies.
      const cells = Object.entries(f.cells).filter(([k]) => shownKeys.has(k));
      const usedHere = cells.some(([, c]) => c.status === 'used');
      if (use === 'used' && !usedHere) return false;
      if (use === 'unused' && usedHere) return false;
      if (picked && !cells.length) return false;
      if (needle && !`${f.label} ${f.note ?? ''} ${cells.map(([, c]) => c.path).join(' ')}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [inDomain, use, picked, q, shownKeys]);

  const factAt = useMemo(() => {
    const m = new Map<string, OwnedFact>();
    for (const f of data?.owned.facts ?? []) m.set(`${f.provider}:${f.field}`, f);
    return m;
  }, [data]);

  const totals = useMemo(() => {
    if (!data) return null;
    const used = data.fields.filter((f) => f.used).length;
    return { providers: data.providers.length, owned: data.providers.filter((p) => p.keep === 'own').length, fields: data.fields.length, used, unused: data.fields.length - used, places: data.owned.places };
  }, [data]);

  const grouped = useMemo(() => {
    const out: { domain: SourcesReport['domains'][number]; rows: SourceField[] }[] = [];
    for (const d of data?.domains ?? []) {
      const here = rows.filter((r) => r.domain === d.key);
      if (here.length) out.push({ domain: d, rows: here });
    }
    return out;
  }, [rows, data]);

  const pickProvider = (key: string) => {
    const all = allProviders.map((p) => p.key);
    if (key === '_all') return setPicked(null);
    if (key === '_none') return setPicked(['_']);
    if (key.startsWith('_keep:')) return setPicked(allProviders.filter((p) => p.keep === key.slice(6)).map((p) => p.key));
    const next = new Set(picked ?? all);
    if (next.has(key)) next.delete(key); else next.add(key);
    next.delete('_');
    setPicked(next.size === all.length ? null : [...next]);
  };

  const domainLabel = domain ? (data?.domains.find((d) => d.key === domain)?.label ?? domain) : 'All domains';
  const providersLabel = picked ? `${chosen.size} of ${allProviders.length}` : `All ${allProviders.length}`;

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

      <Panel title="The matrix" padded={false}>
        {/* The legend first, always, drawn with the marks themselves. */}
        <View style={styles.legend}>
          <Row style={styles.legendItem}><Mark status="used" /><Text style={type.small}><Text style={styles.k}>Read</Text> — the code takes this field from this provider today.</Text></Row>
          <Row style={styles.legendItem}><Mark status="offered" /><Text style={type.small}><Text style={styles.k}>Offered</Text> — the provider has it and we do not ask for it. Blank: the provider does not have it.</Text></Row>
          <Row style={styles.legendItem}><View style={styles.legendHead}><Text style={styles.cellHeadText}>OSM</Text><Text style={styles.keepWord}>keep</Text></View><Text style={[type.small, { flex: 1 }]}><Text style={styles.k}>Under each provider</Text> — what its licence lets us keep: <Text style={styles.k}>keep</Text> for good, <Text style={styles.k}>ID</Text> the identifier only, <Text style={styles.k}>none</Text> nothing past the session. The grey word under a field is the best of those among the providers we read it from.</Text></Row>
        </View>

        <View style={styles.controls}>
          <Dropdown
            label="Domain" value={domainLabel} width={240}
            options={[{ key: '_all', label: 'All domains', on: !domain, count: data?.fields.length ?? null },
              ...(data?.domains ?? []).map((d) => ({ key: d.key, label: d.label, on: domain === d.key, count: data?.fields.filter((f) => f.domain === d.key).length ?? null }))]}
            onPick={(k) => setDomain(k === '_all' ? null : k)}
          />
          <Dropdown
            label="Fields" value={USE_WORD[use]} width={220}
            options={(['all', 'used', 'unused'] as Use[]).map((u) => ({ key: u, label: USE_WORD[u], on: use === u }))}
            onPick={(k) => setUse(k as Use)}
          />
          <Dropdown
            label="Providers" value={providersLabel} width={300} multi
            quick={[{ key: '_all', label: 'All' }, { key: '_none', label: 'None' }, { key: '_keep:own', label: 'Keep for good' }, { key: '_keep:id', label: 'Identifier only' }, { key: '_keep:none', label: 'Nothing kept' }]}
            options={allProviders.map((p) => ({ key: p.key, label: p.label, on: chosen.has(p.key), group: KEEP_WORD[p.keep], count: inDomain.filter((f) => f.cells[p.key]).length || null }))}
            onPick={pickProvider}
          />
          <Toggle label="Hide providers with nothing here" on={hideEmpty} onPress={() => setHideEmpty(!hideEmpty)} />
          <View style={styles.search}>
            <Icon name="search" size={14} color={colors.inkMuted} />
            <TextInput
              value={q} onChangeText={setQ}
              placeholder="Find a field or a path"
              placeholderTextColor={colors.inkFaint}
              style={styles.searchInput}
              autoCapitalize="none"
            />
            {q ? (
              <Press onPress={() => setQ('')} accessibilityRole="button" accessibilityLabel="Clear">
                <Icon name="close" size={13} color={colors.inkMuted} />
              </Press>
            ) : null}
          </View>
          <Text style={type.tiny}>{rows.length} of {data?.fields.length ?? 0} fields · {providers.length} of {allProviders.length} providers</Text>
        </View>

        {/* The grid scrolls sideways on its own, so many provider columns fit a
            390px frame without the page growing wider than the phone. */}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }}>
          <View style={{ minWidth: LABEL_W + providers.length * CELL_W }}>
            <View style={styles.gridHead}>
              <View style={{ width: LABEL_W }}><Text style={styles.headText}>Field</Text></View>
              {providers.map((p) => (
                <View key={p.key} style={styles.cellHead}>
                  <Text style={styles.cellHeadText} numberOfLines={2}>{p.short}</Text>
                  <Text style={styles.keepWord}>{KEEP_SHORT[p.keep]}</Text>
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
                        <Text style={type.tiny}>{f.keep ? KEEP_WORD[f.keep] : 'Not read'}</Text>
                      </View>
                      {providers.map((p) => {
                        const c = f.cells[p.key];
                        return (
                          <View key={p.key} style={styles.cell} accessibilityLabel={c ? `${p.label}: ${c.status} (${c.path})` : `${p.label}: not offered`}>
                            {c ? <Mark status={c.status} /> : null}
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
        <OwnedTable data={data} providers={allProviders} />
      </Panel>

      <Correctness data={data} />

      <Panel title="The providers" sub="What each one is, on what terms, and how often it is asked. A key is reported present or absent, never shown.">
        <Wrap style={{ gap: spacing.sm }}>
          {allProviders.filter((p) => chosen.has(p.key)).map((p) => <ProviderCard key={p.key} p={p} searchable={data?.searchable[p.key] ?? false} />)}
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

// ---------------------------------------------------------------------------
// the correctness bench
// ---------------------------------------------------------------------------

const VERDICT_WORD: Record<SourceBenchRow['verdict'], string> = { agree: 'Agree', differ: 'Differ', unknown: 'Read both', ours_missing: 'Only theirs', theirs_missing: 'Only ours' };
const VERDICT_TONE: Record<SourceBenchRow['verdict'], 'ok' | 'warn' | 'plain' | 'accent'> = { agree: 'ok', differ: 'warn', unknown: 'plain', ours_missing: 'accent', theirs_missing: 'plain' };

function Correctness({ data }: { data: SourcesReport | null }) {
  const [index, setIndex] = useState<SourceBenchIndex | null>(null);
  const [provider, setProvider] = useState('osm');
  const [fields, setFields] = useState<string[]>(['name', 'address', 'phone', 'website', 'lat_lng']);
  const [sample, setSample] = useState(10);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SourceBenchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<SourceBenchRun | null>(null);

  const load = useCallback(() => api.sourceBenchRuns().then(setIndex).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const labelOf = useMemo(() => new Map((data?.fields ?? []).map((f) => [f.key, f.label])), [data]);
  const owned = (data?.providers ?? []).filter((p) => p.keep === 'own' && (index?.providers ?? []).includes(p.key));
  const providerLabel = owned.find((p) => p.key === provider)?.label ?? provider;
  // Only fields this provider is read for: a bench of Wikipedia's phone numbers would be a bench of nothing.
  const offer = (index?.fields ?? []).filter((f) => data?.fields.find((x) => x.key === f)?.cells[provider]?.status === 'used');
  const asked = fields.filter((f) => offer.includes(f));
  const cents = sample * (index?.centsPerCall ?? 2.5);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const out = await api.runSourceBench({ provider, fields: asked, sample });
      setResult(out); setOpenRun(null);
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const decide = async (runId: string, i: number, decision: SourceBenchDecision | null) => {
    try {
      const { run: saved } = await api.sourceBenchDecide(runId, i, decision);
      setResult((r) => (r && r.run.id === runId ? { ...r, run: saved, rows: r.rows.map((row, j) => (j === i ? { ...row, decision } : row)) } : r));
      setOpenRun((r) => (r && r.id === runId ? saved : r));
      setIndex((ix) => (ix ? { ...ix, runs: ix.runs.map((r) => (r.id === runId ? saved : r)) } : ix));
    } catch (e: any) { setError(e.message); }
  };

  return (
    <Panel title="Correctness" sub="Is what we kept actually right? Pick an owned source, the fields and how many places; it fetches the same places from Google now and compares them field by field.">
      <Text style={type.small}>
        Every place in the sample costs one Google Place Details request, which goes through the ledger like any other call. Google's values are shown here for you to read and are not kept: a run stores our value, the verdict and your decision. "Read both" means the rule could not judge it — hours written in two grammars, say — so it is yours to call.
      </Text>

      <View style={styles.benchForm}>
        <Dropdown
          label="Check" value={providerLabel} width={260}
          options={owned.map((p) => ({ key: p.key, label: p.label, on: p.key === provider, count: p.owned?.records ?? null }))}
          onPick={(k) => { setProvider(k); setFields((f) => f.filter((x) => data?.fields.find((y) => y.key === x)?.cells[k]?.status === 'used')); }}
        />
        <Dropdown
          label="Fields" value={asked.length ? `${asked.length} chosen` : 'None'} width={260} multi
          quick={[{ key: '_all', label: 'All' }, { key: '_none', label: 'None' }]}
          options={offer.map((f) => ({ key: f, label: labelOf.get(f) ?? f, on: asked.includes(f) }))}
          onPick={(k) => setFields(k === '_all' ? offer : k === '_none' ? [] : asked.includes(k) ? asked.filter((x) => x !== k) : [...asked, k])}
        />
        <View style={{ width: 220 }}>
          <Stepper label="Places" value={sample} min={1} max={index?.max ?? 50} onChange={setSample} />
        </View>
        <Button label={busy ? 'Checking…' : 'Run the check'} onPress={run} loading={busy} disabled={!index?.canRun || !asked.length} icon="refresh" />
        <Text style={type.tiny}>
          {index?.canRun === false ? 'The Google key is not set on this API, so there is nothing to check against.' : `About $${(cents / 100).toFixed(2)} at list price for ${sample} place${sample === 1 ? '' : 's'}; up to ${index?.max ?? 50} a run.`}
        </Text>
      </View>

      {error ? <Banner tone="crit">{error}</Banner> : null}

      {result ? <BenchTable run={result.run} rows={result.rows} problems={result.problems} live labelOf={labelOf} onDecide={decide} note={`Asked for ${result.asked}; ${result.found} had a Google identifier and facts from ${providerLabel}.`} /> : null}

      <Text style={[type.small, { color: colors.ink, fontWeight: '700', marginTop: spacing.sm }]}>Runs so far</Text>
      <DataTable
        rows={(index?.runs ?? []).map((r) => ({ ...r, id: r.id }))}
        onRow={(r) => { setOpenRun(openRun?.id === r.id ? null : r); setResult(null); }}
        empty={<Text style={type.small}>No run yet.</Text>}
        columns={[
          { key: 'when', head: 'When', width: 2, sort: (r) => r.ranAt, cell: (r) => <Text style={type.small}>{day(r.ranAt)} · {ago(r.ranAt)}</Text> },
          { key: 'provider', head: 'Checked', width: 2, cell: (r) => <Text style={type.small}>{(data?.providers.find((p) => p.key === r.provider)?.label) ?? r.provider}</Text> },
          { key: 'fields', head: 'Fields', width: 3, wideOnly: true, cell: (r) => <Text style={type.small} numberOfLines={1}>{r.fields.map((f) => labelOf.get(f) ?? f).join(', ')}</Text> },
          { key: 'sample', head: 'Places', width: 1, align: 'right', cell: (r) => <Text style={type.small}>{r.sample}</Text> },
          { key: 'agreed', head: 'Agree', width: 1, align: 'right', cell: (r) => <Text style={type.small}>{r.agreed}</Text> },
          { key: 'differed', head: 'Differ', width: 1, align: 'right', cell: (r) => <Text style={type.small}>{r.differed}</Text> },
          { key: 'unknown', head: 'Read both', width: 1, align: 'right', wideOnly: true, cell: (r) => <Text style={type.small}>{r.unknown}</Text> },
          { key: 'cost', head: 'Cost', width: 1, align: 'right', wideOnly: true, cell: (r) => <Text style={type.small}>${(r.costCents / 100).toFixed(2)}</Text> },
        ]}
      />
      {openRun ? <BenchTable run={openRun} rows={openRun.rows} problems={[]} live={false} labelOf={labelOf} onDecide={decide} note="A past run: our values and the verdicts were kept; Google's values were shown once and not stored." /> : null}
    </Panel>
  );
}

function BenchTable({ run, rows, problems, live, labelOf, onDecide, note }: {
  run: SourceBenchRun; rows: SourceBenchRow[]; problems: string[]; live: boolean; labelOf: Map<string, string>;
  onDecide: (runId: string, i: number, d: SourceBenchDecision | null) => void; note: string;
}) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  return (
    <View style={{ gap: spacing.sm }}>
      <TileRow>
        <Tile label="Compared" value={count(run.compared)} sub="place × field pairs both sides had" />
        <Tile label="Agree" value={count(run.agreed)} tone="ok" sub={run.compared ? `${Math.round((run.agreed / run.compared) * 100)}% of those compared` : ''} />
        <Tile label="Differ" value={count(run.differed)} tone="warn" sub="worth reading one at a time" />
        <Tile label="Read both" value={count(run.unknown)} sub="the rule could not judge, or one side had nothing" />
        <Tile label="Cost" value={`$${(run.costCents / 100).toFixed(2)}`} sub={`${run.calls} Google requests`} />
      </TileRow>
      <Text style={type.tiny}>{note}</Text>
      {problems.map((p, i) => <Banner key={i} tone="warn">{p}</Banner>)}
      <View>
        {wide ? (
          <View style={styles.benchHead}>
            <Text style={[styles.headText, { flex: 2 }]}>Place</Text>
            <Text style={[styles.headText, { flex: 1.4 }]}>Field</Text>
            <Text style={[styles.headText, { flex: 3 }]}>Ours</Text>
            <Text style={[styles.headText, { flex: 3 }]}>Google, now</Text>
            <Text style={[styles.headText, { flex: 1.2 }]}>Verdict</Text>
            <Text style={[styles.headText, { flex: 2.4 }]}>Your call</Text>
          </View>
        ) : null}
        {rows.map((r, i) => (
          <View key={`${r.venueRef}:${r.field}`} style={[styles.benchRow, wide && styles.benchRowWide]}>
            <View style={wide ? { flex: 2, minWidth: 0 } : undefined}><Text style={[type.small, { color: colors.ink }]} numberOfLines={2}>{r.name}</Text></View>
            <View style={wide ? { flex: 1.4 } : undefined}><Text style={type.small}>{labelOf.get(r.field) ?? r.field}</Text></View>
            <View style={wide ? { flex: 3, minWidth: 0 } : undefined}><Text style={type.tiny}>{!wide ? 'Ours: ' : ''}{r.ours ?? '—'}</Text></View>
            <View style={wide ? { flex: 3, minWidth: 0 } : undefined}><Text style={type.tiny}>{!wide ? 'Google: ' : ''}{live ? (r.theirs ?? '—') : 'not kept'}</Text></View>
            <View style={wide ? { flex: 1.2 } : undefined}><Pill label={VERDICT_WORD[r.verdict]} tone={VERDICT_TONE[r.verdict]} /><Text style={type.tiny}>{r.note}</Text></View>
            <View style={wide ? { flex: 2.4 } : undefined}>
              <Segmented<'ours' | 'theirs' | 'both' | 'none'>
                value={r.decision ?? 'none'}
                options={[{ value: 'ours', label: 'Ours' }, { value: 'theirs', label: 'Theirs' }, { value: 'both', label: 'Both' }, { value: 'none', label: '—' }]}
                onChange={(v) => onDecide(run.id, i, v === 'none' ? null : v)}
              />
            </View>
          </View>
        ))}
      </View>
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

const HAIR = 1;

const styles = StyleSheet.create({
  k: { color: colors.ink, fontWeight: '700' },
  legend: { padding: spacing.md, gap: 6, borderBottomWidth: HAIR, borderBottomColor: colors.line },
  legendItem: { gap: spacing.sm, alignItems: 'flex-start' },
  legendHead: { width: 34, alignItems: 'center' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, padding: spacing.md, zIndex: 20 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, width: 260,
    borderWidth: HAIR, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 7, backgroundColor: colors.surface, minHeight: 36,
  },
  searchInput: { flex: 1, ...type.small, color: colors.ink, outlineStyle: 'none' as any },

  gridHead: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.md, paddingVertical: 6, borderTopWidth: HAIR, borderBottomWidth: HAIR, borderColor: colors.line, backgroundColor: colors.well },
  headText: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', color: colors.inkMuted },
  cellHead: { width: CELL_W, alignItems: 'center', gap: 2 },
  cellHeadText: { ...type.tiny, fontSize: 9, lineHeight: 11, textAlign: 'center', color: colors.ink, fontWeight: '700' },
  keepWord: { ...type.tiny, fontSize: 9, lineHeight: 11, color: colors.inkMuted },

  domainRow: { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 4, borderBottomWidth: HAIR, borderBottomColor: colors.line },
  domainText: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.ink },
  gridRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 6, borderBottomWidth: HAIR, borderBottomColor: colors.line, minHeight: 40 },
  rowHover: { backgroundColor: colors.well },
  rowOpen: { backgroundColor: colors.well },
  cell: { width: CELL_W, alignItems: 'center', justifyContent: 'center' },
  markUsed: { width: 16, height: 16, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  markOffered: { width: 16, height: 16, borderWidth: HAIR, borderColor: colors.ink, backgroundColor: 'transparent' },

  detail: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, backgroundColor: colors.well, borderBottomWidth: HAIR, borderBottomColor: colors.line },
  detailRow: { gap: 2 },
  mono: { ...type.tiny, color: colors.ink, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' as any },

  benchForm: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, zIndex: 20 },
  benchHead: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: HAIR, borderBottomColor: colors.line },
  benchRow: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: HAIR, borderBottomColor: colors.line },
  benchRowWide: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },

  card: { flexGrow: 1, flexBasis: 320, minWidth: 280, maxWidth: 520, borderWidth: HAIR, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, gap: 6, backgroundColor: colors.surface },
  link: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
