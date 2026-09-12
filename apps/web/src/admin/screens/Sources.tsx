/**
 * Sources — every app and API Epic uses, every field each one offers, and
 * which of those fields the code actually reads.
 *
 * The owner, 12 Sep 2026: "a screen that shows all of the apps and APIs that
 * we use, what they give us, and, very specifically, every single field that
 * we utilise… a deduped master list of fields… an ownership tag so that, for
 * sources where we can own the data, I can filter at the top… for the ones that
 * we can keep the data for, I want to see some information about how much data
 * they have and how good the quality of the data is."
 *
 * Three rounds of his review the same day shaped what is drawn:
 *
 *   - "If you don't tell me what things mean, then your UI is completely
 *     useless" — so the one line of guidance sits above the rows, in words.
 *   - "If that's supposed to just say there are 2 providers that give us that
 *     data, then it should just say 2… when I click on that row… just list out
 *     the 2 providers… without any of the repetitive detail… a tick box rather
 *     than a square box." So a row is the field, how many providers have it
 *     and how many we read it from; open it and the providers are a list, a
 *     tick against each, bold where we read it, and the provider's own name
 *     for the field beside it. No sentence is repeated per provider.
 *   - "I hate this design… these big white boxes" (on Categories, the same
 *     day) — so nothing here is boxed: sections are a kicker over one ink
 *     rule, rows sit on hairlines, controls are plain text with a chevron,
 *     and there is one primary button on the page, the correctness run.
 *
 * "I don't want you just showing a huge scroll ever": the screen opens on one
 * domain, chosen from a control; "All domains" is there for a search.
 *
 * The correctness bench: "I would like the option to run correctness at any
 * time… I can say what I want to run it on… it should show me the data, what
 * it's running it on, what it's returned, and then I can make my decisions on
 * a piece-by-piece basis."
 *
 * The filters travel in the address (`/admin/sources?domain=service&use=unused`).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { api, Keep, OwnedFact, SourceBenchDecision, SourceBenchIndex, SourceBenchResult, SourceBenchRow, SourceBenchRun, SourceField, SourceProvider, SourcesReport } from '../../api';
import { colors, spacing, type, BORDER } from '../../theme';
import { Icon } from '../../components/Icon';
import { Button, Row, Stepper } from '../../components/ui';
import { useViewport } from '../../hooks/useViewport';
import { asText, useQueryState } from '../../router';
import { AdminPage, Choice, Dropdown, PageHead, Section, TextAction, ago, count, day } from '../kit';

const WIDE = 900;

type Use = 'all' | 'used' | 'unused';

const KEEP_WORD: Record<Keep, string> = { own: 'keep for good', id: 'identifier only', none: 'nothing kept' };
const USE_WORD: Record<Use, string> = { all: 'Every field', used: 'In use', unused: 'Not in use' };

// Only what differs from the default is written to the address (CLAUDE.md).
const useCodec = { read: (raw: string): Use | null => (raw === 'used' || raw === 'unused' ? raw : null), write: (v: Use) => (v === 'all' ? null : v) };
const listCodec = { read: (raw: string): string[] | null => (raw ? raw.split(',').filter(Boolean) : null), write: (v: string[] | null) => (v && v.length ? v.join(',') : null) };
const offCodec = { read: (raw: string): boolean | null => (raw === '0' ? false : null), write: (v: boolean) => (v ? null : '0') };
/** Opens on one domain rather than a scroll of 180 rows; 'all' is spelled out when asked for. */
const domainCodec = { read: (raw: string): string | null => (raw ? raw : null), write: (v: string) => (v === 'identity' ? null : v) };

export function Sources() {
  const { width } = useViewport();
  const wide = width >= WIDE;

  const [data, setData] = useState<SourcesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [domain, setDomain] = useQueryState<string>('domain', 'identity', domainCodec);
  const [use, setUse] = useQueryState<Use>('use', 'all', useCodec);
  /** null is every provider; a list is exactly those. */
  const [picked, setPicked] = useQueryState<string[] | null>('providers', null, listCodec);
  const [hideEmpty, setHideEmpty] = useQueryState<boolean>('hide', true, offCodec);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [openProvider, setOpenProvider] = useState<string | null>(null);

  useEffect(() => {
    api.adminSources().then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, []);

  const allProviders = data?.providers ?? [];
  const byKey = useMemo(() => new Map(allProviders.map((p) => [p.key, p])), [allProviders]);
  const chosen = useMemo(() => new Set(picked ?? allProviders.map((p) => p.key)), [picked, allProviders]);
  const inDomain = useMemo(() => (data?.fields ?? []).filter((f) => domain === 'all' || f.domain === domain), [data, domain]);

  const providers = useMemo(() => allProviders.filter((p) => chosen.has(p.key) && (!hideEmpty || inDomain.some((f) => f.cells[p.key]))), [allProviders, chosen, hideEmpty, inDomain]);
  const shownKeys = useMemo(() => new Set(providers.map((p) => p.key)), [providers]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inDomain.map((f) => {
      const cells = Object.entries(f.cells).filter(([k]) => shownKeys.has(k));
      const read = cells.filter(([, c]) => c.status === 'used').length;
      return { ...f, offeredBy: cells.length, readFrom: read, cellsShown: cells };
    }).filter((f) => {
      if (use === 'used' && !f.readFrom) return false;
      if (use === 'unused' && f.readFrom) return false;
      if (picked && !f.offeredBy) return false;
      if (needle && !`${f.label} ${f.note ?? ''} ${f.cellsShown.map(([, c]) => c.path).join(' ')}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [inDomain, use, picked, q, shownKeys]);

  const factAt = useMemo(() => {
    const m = new Map<string, OwnedFact>();
    for (const f of data?.owned.facts ?? []) m.set(`${f.provider}:${f.field}`, f);
    return m;
  }, [data]);

  const grouped = useMemo(() => {
    const out: { domain: SourcesReport['domains'][number]; rows: typeof rows }[] = [];
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

  const domainLabel = domain === 'all' ? 'All domains' : (data?.domains.find((d) => d.key === domain)?.label ?? domain);
  const providersLabel = picked ? `${chosen.size} of ${allProviders.length}` : `All ${allProviders.length}`;
  const totals = data ? { used: data.fields.filter((f) => f.used).length, owned: data.providers.filter((p) => p.keep === 'own').length } : null;

  return (
    <AdminPage>
      <PageHead
        title="Sources"
        sub={data ? `Every provider, every field, and which of them we read. What each provider offers was read from its reference on ${day(data.checkedOn)}.` : 'Every provider, every field, and which of them we read.'}
      />
      {error ? <Text style={[type.small, styles.error]}>{error}</Text> : null}
      {totals && data ? (
        <Text style={type.small}>
          <Text style={styles.k}>{count(data.providers.length)}</Text> providers, {totals.owned} we may keep for good · <Text style={styles.k}>{count(data.fields.length)}</Text> master fields, {totals.used} read by the code and {data.fields.length - totals.used} offered by somebody and read by nobody · <Text style={styles.k}>{count(data.owned.places)}</Text> owned places, {count(data.owned.done)} fully researched.
        </Text>
      ) : null}

      {/* ---- the fields ---------------------------------------------------- */}
      <Section title="Fields" style={{ zIndex: 20 }}>
        <View style={styles.controls}>
          <Dropdown
            label="Domain" value={domainLabel} width={240}
            options={[...(data?.domains ?? []).map((d) => ({ key: d.key, label: d.label, on: domain === d.key, count: data?.fields.filter((f) => f.domain === d.key).length ?? null })),
              { key: 'all', label: 'All domains', on: domain === 'all', count: data?.fields.length ?? null }]}
            onPick={setDomain}
          />
          <Dropdown
            label="Fields" value={USE_WORD[use]} width={200}
            options={(['all', 'used', 'unused'] as Use[]).map((u) => ({ key: u, label: USE_WORD[u], on: use === u }))}
            onPick={(k) => setUse(k as Use)}
          />
          <Dropdown
            label="Providers" value={providersLabel} width={300} multi
            quick={[{ key: '_all', label: 'All' }, { key: '_none', label: 'None' }, { key: '_keep:own', label: 'Keep for good' }, { key: '_keep:id', label: 'Identifier only' }, { key: '_keep:none', label: 'Nothing kept' }]}
            options={allProviders.map((p) => ({ key: p.key, label: p.label, on: chosen.has(p.key), group: KEEP_WORD[p.keep], count: inDomain.filter((f) => f.cells[p.key]).length || null }))}
            onPick={pickProvider}
          />
          <Choice label="Hide providers with nothing here" on={hideEmpty} onPress={() => setHideEmpty(!hideEmpty)} />
          <View style={styles.search}>
            <Icon name="search" size={13} color={colors.inkMuted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Find a field or a path" placeholderTextColor={colors.inkFaint} style={styles.searchInput} autoCapitalize="none" />
            {q ? <TextAction label="clear" tone="muted" onPress={() => setQ('')} /> : null}
          </View>
        </View>

        {/* The guidance, in words, where the rows start. */}
        <Text style={[type.tiny, styles.guide]}>
          Each row is one field. <Text style={styles.k}>Have it</Text> is how many of the providers on screen offer it; <Text style={styles.k}>we read</Text> is how many of those the code takes it from. Open a row to see them: a tick against every provider that has it, in bold where we read it, and beside each the provider's own name for the field. The grey word under a field is the best we may keep it as. {rows.length} of {data?.fields.length ?? 0} fields · {providers.length} of {allProviders.length} providers.
        </Text>

        <View style={styles.tHead}>
          <Text style={[styles.headText, { flex: 1 }]}>Field</Text>
          <Text style={[styles.headText, styles.num]}>Have it</Text>
          <Text style={[styles.headText, styles.num]}>We read</Text>
          <View style={{ width: 20 }} />
        </View>

        {grouped.map(({ domain: d, rows: here }) => (
          <View key={d.key}>
            {domain === 'all' ? <Text style={styles.domainText}>{d.label} <Text style={{ fontWeight: '400', color: colors.inkMuted }}>· {d.what}</Text></Text> : null}
            {here.map((f) => (
              <View key={f.key}>
                <Press
                  onPress={() => setOpen(open === f.key ? null : f.key)}
                  style={({ hovered }: any) => [styles.row, hovered ? styles.rowHover : null, open === f.key ? styles.rowOpen : null]}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open === f.key }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.small, { color: colors.ink, fontWeight: f.readFrom ? '600' : '400' }]} numberOfLines={1}>{f.label}</Text>
                    <Text style={type.tiny}>{f.keep ? KEEP_WORD[f.keep] : 'not read'}{f.note ? ` · ${f.note}` : ''}</Text>
                  </View>
                  <Text style={[type.small, styles.num, { color: colors.ink }]}>{f.offeredBy || '–'}</Text>
                  <Text style={[type.small, styles.num, { color: f.readFrom ? colors.ink : colors.inkMuted }]}>{f.readFrom || '–'}</Text>
                  <View style={{ width: 20, alignItems: 'flex-end' }}><Icon name={open === f.key ? 'collapse' : 'expand'} size={12} color={colors.inkMuted} /></View>
                </Press>
                {open === f.key ? <ProviderList field={f} providers={providers} factAt={factAt} wide={wide} /> : null}
              </View>
            ))}
          </View>
        ))}
        {!rows.length ? <Text style={[type.small, { paddingVertical: spacing.md }]}>No field matches those filters.</Text> : null}
      </Section>

      {/* ---- what we hold -------------------------------------------------- */}
      <Section title="What we hold">
        <Held data={data} byKey={byKey} shown={chosen} />
      </Section>

      <Correctness data={data} />

      {/* ---- the providers ------------------------------------------------- */}
      <Section title="Providers">
        <Text style={[type.tiny, styles.guide]}>One line each; open one for its terms, its key and what it costs. A key is reported present or absent, never shown.</Text>
        {allProviders.filter((p) => chosen.has(p.key)).map((p) => (
          <View key={p.key}>
            <Press onPress={() => setOpenProvider(openProvider === p.key ? null : p.key)} style={({ hovered }: any) => [styles.row, hovered && styles.rowHover, openProvider === p.key && styles.rowOpen]} accessibilityRole="button" accessibilityState={{ expanded: openProvider === p.key }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.small, { color: colors.ink, fontWeight: '600' }]}>{p.label} <Text style={{ fontWeight: '400', color: colors.inkMuted }}>· {KEEP_WORD[p.keep]}</Text></Text>
                <Text style={type.tiny}>{p.usedCount} read · {p.offeredCount} offered and not read · asked {count(p.calls.days30)} times in 30 days{p.envKey ? ` · ${p.envKey} ${p.hasKey ? 'present' : 'absent'}` : ''}{p.switchedOff ? ' · switched off in Settings' : ''}</Text>
              </View>
              <Icon name={openProvider === p.key ? 'collapse' : 'expand'} size={12} color={colors.inkMuted} />
            </Press>
            {openProvider === p.key ? <ProviderDetail p={p} searchable={data?.searchable[p.key] ?? false} /> : null}
          </View>
        ))}
        <Text style={[type.tiny, { paddingTop: spacing.sm }]}>Sample data (fixtures) is Epic's own and is not a provider. The local scout is a Claude run over council and venue pages rather than a data source; it is under Services.</Text>
      </Section>

      {/* ---- services ------------------------------------------------------ */}
      <Section title="Services">
        <Text style={[type.tiny, styles.guide]}>What we pay for that yields no field about a place.</Text>
        {(data?.services ?? []).map((s) => (
          <View key={s.key} style={[styles.row, wide && { alignItems: 'flex-start' }]}>
            <View style={wide ? { width: 170 } : { width: '100%' }}>
              <Text style={[type.small, { color: colors.ink, fontWeight: '600' }]}>{s.label}</Text>
              <Text style={type.tiny}>{s.unit} · key {s.hasKey ? 'present' : 'absent'}</Text>
            </View>
            <Text style={[type.small, { flex: 1, minWidth: 0 }]}>{s.what}</Text>
            <View style={{ width: 130, alignItems: 'flex-end' }}>
              <Text style={type.tiny}>{count(s.calls.days30)} in 30 days · {count(s.calls.all)} all time</Text>
              {s.console ? <Link label={s.console.label} url={s.console.url} /> : null}
            </View>
          </View>
        ))}
      </Section>
    </AdminPage>
  );
}

function Link({ label, url }: { label: string; url: string }) {
  return (
    <Press onPress={() => Linking.openURL(url)} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Text style={[type.tiny, { color: colors.ink, textDecorationLine: 'underline' }]} numberOfLines={1}>{label}</Text>
      <Icon name="external" size={11} color={colors.inkMuted} />
    </Press>
  );
}

/** A tick: bold ink where we read the field, grey where the provider merely has it. */
function Tick({ read }: { read: boolean }) {
  return <View style={{ width: 18, alignItems: 'center' }}><Icon name="check" size={14} color={read ? colors.ink : colors.inkFaint} strokeWidth={read ? 3 : 2} /></View>;
}

/** One row opened: the providers that have the field, listed, nothing repeated. */
function ProviderList({ field, providers, factAt, wide }: {
  field: SourceField; providers: SourceProvider[]; factAt: Map<string, OwnedFact>; wide: boolean;
}) {
  const named = providers.filter((p) => field.cells[p.key]);
  return (
    <View style={styles.list}>
      {!named.length ? <Text style={type.small}>No provider on screen has this.</Text> : null}
      {named.map((p) => {
        const c = field.cells[p.key];
        const read = c.status === 'used';
        const fact = factAt.get(`${p.key}:${field.key}`);
        return (
          <View key={p.key} style={[styles.listRow, wide && { flexDirection: 'row', alignItems: 'center', gap: spacing.md }]}>
            <Row style={wide ? { width: 230 } : undefined}>
              <Tick read={read} />
              <Text style={[type.small, { color: read ? colors.ink : colors.inkMuted, fontWeight: read ? '700' : '400' }]}>{p.label}</Text>
              <Text style={type.tiny}> · {KEEP_WORD[p.keep]}</Text>
            </Row>
            <Text style={[styles.mono, { flex: 1, minWidth: 0 }]} numberOfLines={2}>{c.path}</Text>
            {read && p.keep === 'own' ? (
              <Text style={[type.tiny, wide && { width: 250, textAlign: 'right' }]}>
                {fact ? `held for ${count(fact.held)} of ${count(fact.of)} owned places (${fact.coverage ?? 0}%) · oldest ${ago(fact.oldest)}` : 'nothing held yet'}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ProviderDetail({ p, searchable }: { p: SourceProvider; searchable: boolean }) {
  const line = (k: string, v: string | null | undefined) => (v ? <Text style={type.tiny}><Text style={styles.k}>{k} </Text>{v}</Text> : null);
  return (
    <View style={styles.list}>
      {line('Licence', p.licence)}
      {line('Keeps', p.retention)}
      {line('Credit', p.attribution)}
      {line('Cost', p.cost)}
      {line('Lands in', p.lands)}
      {p.note ? <Text style={type.tiny}>{p.note}</Text> : null}
      <Text style={type.tiny}>Asked <Text style={styles.k}>{count(p.calls.days30)}</Text> times in 30 days · {count(p.calls.all)} all time{p.calls.last ? ` · last ${ago(p.calls.last)}` : p.calls.all ? '' : ' · never through the ledger'}</Text>
      {p.owned ? <Text style={type.tiny}>Holds <Text style={styles.k}>{count(p.owned.facts)}</Text> facts across {p.owned.fields} fields on {count(p.owned.records)} places{p.owned.oldest ? ` · oldest ${ago(p.owned.oldest)}` : ''}{p.owned.images ? ` · ${count(p.owned.images.n)} pictures` : ''}</Text> : null}
      <Row style={{ gap: spacing.md, flexWrap: 'wrap' }}>
        {p.docs ? <Link label="Provider reference" url={p.docs} /> : null}
        {p.console ? <Link label={p.console.label} url={p.console.url} /> : null}
        <Text style={styles.mono} numberOfLines={1}>{p.file}</Text>
      </Row>
      {!searchable && p.envKey && !p.hasKey ? <Text style={type.tiny}>No key on this API right now, so nothing this provider offers reaches the app from here.</Text> : null}
    </View>
  );
}

/** The quantity-and-quality rows for what we may keep, for the providers on screen. */
function Held({ data, byKey, shown }: { data: SourcesReport | null; byKey: Map<string, SourceProvider>; shown: Set<string> }) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const labelOf = new Map((data?.fields ?? []).map((f) => [f.key, f.label]));
  const rows = (data?.owned.facts ?? []).filter((f) => shown.has(f.provider)).sort((a, b) => b.held - a.held);
  const lib = data?.owned.library;
  return (
    <View>
      {lib ? (
        <Text style={[type.tiny, styles.guide]}>
          <Text style={styles.k}>{count(data?.owned.places)}</Text> owned places, {count(data?.owned.done)} researched to the end · <Text style={styles.k}>{count(lib.attractions.reduce((n, a) => n + a.n, 0))}</Text> atlas attractions, {count(lib.attractions.reduce((n, a) => n + a.with_summary, 0))} with a description · <Text style={styles.k}>{count(Object.values(lib.images).reduce((n, i) => n + i.n, 0))}</Text> pictures we own ({Object.entries(lib.images).map(([k, v]) => `${byKey.get(k)?.short ?? k} ${v.n}`).join(', ') || 'none yet'}) · <Text style={styles.k}>{count(Object.values(lib.localities).reduce((n, v) => n + v, 0))}</Text> areas · <Text style={styles.k}>{count(lib.transitStops.n)}</Text> stations. For each field below: how many owned places carry it from that provider, what share that is, how sure the source was, and how old the oldest fact is.
        </Text>
      ) : null}
      <View style={styles.tHead}>
        <Text style={[styles.headText, { flex: 2 }]}>Field</Text>
        <Text style={[styles.headText, { flex: 2 }]}>From</Text>
        <Text style={[styles.headText, styles.num]}>Places</Text>
        <Text style={[styles.headText, styles.num]}>Share</Text>
        {wide ? <Text style={[styles.headText, styles.num]}>Sure</Text> : null}
        {wide ? <Text style={[styles.headText, styles.numWide]}>Oldest</Text> : null}
        {wide ? <Text style={[styles.headText, styles.numWide]}>Newest</Text> : null}
      </View>
      {!rows.length ? <Text style={[type.small, { paddingVertical: spacing.sm }]}>No owned facts yet. A place is researched once a household shortlists, saves or visits it.</Text> : null}
      {rows.map((r) => (
        <View key={`${r.provider}:${r.field}`} style={styles.row}>
          <Text style={[type.small, { flex: 2, color: colors.ink }]} numberOfLines={1}>{labelOf.get(r.field) ?? r.field}</Text>
          <Text style={[type.small, { flex: 2 }]} numberOfLines={1}>{byKey.get(r.provider)?.label ?? r.provider}</Text>
          <Text style={[type.small, styles.num]}>{count(r.held)}</Text>
          <Text style={[type.small, styles.num]}>{r.coverage == null ? '–' : `${r.coverage}%`}</Text>
          {wide ? <Text style={[type.small, styles.num]}>{r.confidence == null ? '–' : r.confidence.toFixed(2)}</Text> : null}
          {wide ? <Text style={[type.small, styles.numWide]}>{ago(r.oldest)}</Text> : null}
          {wide ? <Text style={[type.small, styles.numWide]}>{ago(r.newest)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// the correctness bench
// ---------------------------------------------------------------------------

const VERDICT_WORD: Record<SourceBenchRow['verdict'], string> = { agree: 'Agree', differ: 'Differ', unknown: 'Read both', ours_missing: 'Only theirs', theirs_missing: 'Only ours' };

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
    <Section title="Correctness" style={{ zIndex: 10 }}>
      <Text style={[type.small, styles.guide]}>
        Is what we kept actually right? Pick an owned source, the fields and how many places; the same places are fetched from Google now and compared field by field. Every place costs one Google Place Details request, through the ledger like any other call. Google's values are shown here for you to read and are not kept: a run stores our value, the verdict and your decision. "Read both" means the rule could not judge it, so it is yours to call.
      </Text>
      <View style={styles.controls}>
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
        <View style={{ width: 170 }}>
          <Stepper label="Places" value={sample} min={1} max={index?.max ?? 50} onChange={setSample} />
        </View>
        <Button label={busy ? 'Checking…' : 'Run the check'} onPress={run} loading={busy} disabled={!index?.canRun || !asked.length} />
        <Text style={type.tiny}>
          {index?.canRun === false ? 'The Google key is not set on this API, so there is nothing to check against.' : `About $${(cents / 100).toFixed(2)} at list price for ${sample} place${sample === 1 ? '' : 's'}; up to ${index?.max ?? 50} a run.`}
        </Text>
      </View>
      {error ? <Text style={[type.small, styles.error]}>{error}</Text> : null}

      {result ? <BenchTable run={result.run} rows={result.rows} problems={result.problems} live labelOf={labelOf} onDecide={decide} note={`Asked for ${result.asked}; ${result.found} had a Google identifier and facts from ${providerLabel}.`} /> : null}

      <Text style={[styles.kicker, { paddingTop: spacing.md, paddingBottom: 4 }]}>Runs so far</Text>
      {!index?.runs.length ? <Text style={type.small}>No run yet.</Text> : null}
      {(index?.runs ?? []).map((r) => (
        <Press key={r.id} onPress={() => { setOpenRun(openRun?.id === r.id ? null : r); setResult(null); }} style={({ hovered }: any) => [styles.row, hovered && styles.rowHover, openRun?.id === r.id && styles.rowOpen]} accessibilityRole="button">
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.small, { color: colors.ink }]}>{day(r.ranAt)} · {(data?.providers.find((p) => p.key === r.provider)?.label) ?? r.provider} · {r.sample} places</Text>
            <Text style={type.tiny} numberOfLines={1}>{r.fields.map((f) => labelOf.get(f) ?? f).join(', ')}</Text>
          </View>
          <Text style={type.tiny}>{r.agreed} agree · {r.differed} differ · {r.unknown} read both · ${(r.costCents / 100).toFixed(2)}</Text>
          <Icon name={openRun?.id === r.id ? 'collapse' : 'expand'} size={12} color={colors.inkMuted} />
        </Press>
      ))}
      {openRun ? <BenchTable run={openRun} rows={openRun.rows} problems={[]} live={false} labelOf={labelOf} onDecide={decide} note="A past run: our values and the verdicts were kept; Google's values were shown once and not stored." /> : null}
    </Section>
  );
}

function BenchTable({ run, rows, problems, live, labelOf, onDecide, note }: {
  run: SourceBenchRun; rows: SourceBenchRow[]; problems: string[]; live: boolean; labelOf: Map<string, string>;
  onDecide: (runId: string, i: number, d: SourceBenchDecision | null) => void; note: string;
}) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  return (
    <View style={{ paddingTop: spacing.sm }}>
      <Text style={[type.small, styles.guide]}>
        <Text style={styles.k}>{count(run.compared)}</Text> pairs compared · <Text style={styles.k}>{count(run.agreed)}</Text> agree{run.compared ? ` (${Math.round((run.agreed / run.compared) * 100)}%)` : ''} · <Text style={styles.k}>{count(run.differed)}</Text> differ · <Text style={styles.k}>{count(run.unknown)}</Text> for you to read · {run.calls} Google requests, ${(run.costCents / 100).toFixed(2)}. {note}
      </Text>
      {problems.map((p, i) => <Text key={i} style={[type.tiny, styles.error]}>{p}</Text>)}
      {wide ? (
        <View style={styles.tHead}>
          <Text style={[styles.headText, { flex: 2 }]}>Place</Text>
          <Text style={[styles.headText, { flex: 1.4 }]}>Field</Text>
          <Text style={[styles.headText, { flex: 3 }]}>Ours</Text>
          <Text style={[styles.headText, { flex: 3 }]}>Google, now</Text>
          <Text style={[styles.headText, { flex: 1.6 }]}>Verdict</Text>
          <Text style={[styles.headText, { flex: 2.2 }]}>Your call</Text>
        </View>
      ) : null}
      {rows.map((r, i) => (
        <View key={`${r.venueRef}:${r.field}`} style={[styles.row, wide ? { alignItems: 'flex-start' } : { flexDirection: 'column', alignItems: 'stretch', gap: 2 }]}>
          <Text style={[type.small, { color: colors.ink }, wide && { flex: 2 }]} numberOfLines={2}>{r.name}</Text>
          <Text style={[type.small, wide && { flex: 1.4 }]}>{labelOf.get(r.field) ?? r.field}</Text>
          <Text style={[type.tiny, wide && { flex: 3 }]}>{!wide ? 'Ours: ' : ''}{r.ours ?? '–'}</Text>
          <Text style={[type.tiny, wide && { flex: 3 }]}>{!wide ? 'Google: ' : ''}{live ? (r.theirs ?? '–') : 'not kept'}</Text>
          <View style={wide ? { flex: 1.6 } : undefined}>
            <Text style={[type.small, { color: r.verdict === 'differ' ? colors.ink : colors.inkMuted, fontWeight: r.verdict === 'differ' ? '700' : '500' }]}>{VERDICT_WORD[r.verdict]}</Text>
            <Text style={type.tiny}>{r.note}</Text>
          </View>
          <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 2 }, wide && { flex: 2.2 }]}>
            {(['ours', 'theirs', 'both'] as SourceBenchDecision[]).map((d) => (
              <Choice key={d} label={d === 'ours' ? 'Ours' : d === 'theirs' ? 'Theirs' : 'Both fine'} on={r.decision === d} onPress={() => onDecide(run.id, i, r.decision === d ? null : d)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  k: { color: colors.ink, fontWeight: '700' },
  kicker: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.inkMuted },
  error: { color: colors.ink, fontWeight: '600', paddingVertical: 4 },
  guide: { paddingVertical: spacing.sm, lineHeight: 18 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.sm, zIndex: 20 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 240, borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 4 },
  searchInput: { flex: 1, ...type.small, color: colors.ink, outlineStyle: 'none' as any, backgroundColor: 'transparent' },

  tHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: BORDER, borderBottomColor: colors.line },
  headText: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', color: colors.inkMuted },
  num: { width: 56, textAlign: 'right', fontVariant: ['tabular-nums'] as any },
  numWide: { width: 90, textAlign: 'right' },
  domainText: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700', color: colors.ink, paddingTop: spacing.md, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, minHeight: 40 },
  rowHover: { backgroundColor: colors.well },
  rowOpen: { backgroundColor: colors.well },
  list: { paddingVertical: spacing.sm, paddingLeft: spacing.md, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  listRow: { gap: 2 },
  mono: { ...type.tiny, color: colors.ink, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' as any },
});
