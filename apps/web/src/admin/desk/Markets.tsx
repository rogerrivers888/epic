/**
 * Markets (ADMIN › Markets). Epic — Markets: design brief, step 4.
 *
 * The markets list and a market's page: how Epic speaks in each country, its
 * cost bands, which owned sources apply there, and what is missing before it
 * could go live. Not translation — no country switcher, no flags, nothing shown
 * to a customer. Reads only for now; setting cost bands, wiring sources and
 * going live are a later increment, so the go-live checklist SAYS WHAT IS
 * MISSING rather than offering a disabled control (owner, 29 Sep 2026).
 *
 * The Markets artboard was never drawn, so this layout is the build's own and
 * should be reconciled with Design rather than adopted by default.
 *
 * Everything here is the API's (`GET /api/admin/desk/markets` and
 * `/markets/:code`); this file only draws it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { Press } from '../../components/press';
import { useDeskGo, useDeskParam, useCrumbs } from './Desk';
import { Wording } from './Wording';
import {
  AMBER, LIME, Muted, deskApi, desk, fonts, useToast,
  InfoTip, Kicker, PageTitle, SectionTitle, T,
  Table, THead, TRow, TCell, TextLink, n, dayMonth,
  type TCol, type SortState, sortRows, tableWidth,
} from './kit';

type Band = { symbol: string; min: number; max: number | null; basis: string; set_by?: string | null; at?: string | null };
type SourceState = 'connected' | 'absent' | 'notConnected';
type Source = { id: string; state: SourceState; note?: string | null };
type Checklist = { costBands: boolean; area: boolean; sources: boolean };
type Market = {
  code: string; name: string; status: 'live' | 'soft' | 'groundwork';
  currency: string; distanceUnit: string; tempUnit: string;
  areaCode: { name?: string; pattern?: string; searchBy?: string } | null;
  midLevelName: string; dateFormat: string; defaultTimezone: string; defaultWordingLocale: string;
  costBands: Band[] | null; costBandsSetBy: string | null; costBandsAt: string | null;
  sources: Source[]; sourcesConnected: number; sourcesCanExist: number; places: number;
  statusSetBy: string | null; statusAt: string | null;
  checklist: Checklist; ready: boolean;
};
type Blocked = { code: string | null; name: string; note: string | null };
type MarketDetail = Market & { notApplicable: string[] };

const CURRENCY_SYMBOL: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', TRY: '₺', AED: 'AED ' };
const SOURCE_LABEL: Record<string, string> = {
  osm: 'OpenStreetMap', wikidata: 'Wikidata', wikipedia: 'Wikipedia', site: 'Venue websites',
  fsa: 'FSA food hygiene register', ons: 'ONS postcode directory', 'historic-england': 'Historic England listings',
  niah: 'NIAH', nrhp: 'National Register of Historic Places',
};
const STATUS_NAME: Record<Market['status'], string> = { live: 'Live', soft: 'Soft launch', groundwork: 'Groundwork' };

/** A minor-unit amount (pence, cents) in the market's currency. */
function money(minor: number, currency: string): string {
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const major = minor / 100;
  return `${sym}${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

/** A cost band as a range: "Free", "under £10", "£10–25", "over £25". */
function bandRange(b: Band, currency: string): string {
  if (b.min === 0 && b.max === 0) return 'Free';
  // The first paid band starts at the smallest coin (min 1), so it reads "under
  // its ceiling", not "£0.01–£10".
  if (b.max != null && b.min <= 1) return `under ${money(b.max, currency)}`;
  if (b.max == null) return `over ${money(b.min, currency)}`;
  return `${money(b.min, currency)}–${money(b.max, currency).replace(CURRENCY_SYMBOL[currency] ?? '', '')}`;
}

/**
 * The cost-band editor: two per-person thresholds a person types, never derived
 * from prices (owner, 29 Sep 2026). The first band runs up to the first
 * threshold, the second between the two, the third above — Free is always £0, and
 * the symbols come from the market's currency. Seeded from the current bands, or
 * empty for a market that has none; typed into a small box, no steppers.
 */
function CostBandEditor({ code, currency, bands, onSaved, toast }: {
  code: string; currency: string; bands: Band[] | null;
  onSaved: () => void; toast: (msg: string, undo?: () => Promise<void>) => void;
}) {
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const majorOf = (minor: number | null | undefined) => (minor == null ? '' : String(minor / 100));
  // Seed from the current bands: the first paid band's ceiling, and the second's.
  const seeded = Array.isArray(bands) && bands.length === 4;
  const seedT1 = seeded ? majorOf(bands![1].max) : '';
  const seedT2 = seeded ? majorOf(bands![2].max) : '';
  const [t1, setT1] = useState(seedT1);
  const [t2, setT2] = useState(seedT2);
  // Re-seed when the market's bands change — after a save or an Undo reload — so
  // the boxes never keep an undone value that a later Change would reapply (Codex).
  useEffect(() => { setT1(seedT1); setT2(seedT2); }, [seedT1, seedT2]);
  const [busy, setBusy] = useState(false);
  const a = Number(t1); const b = Number(t2);
  const valid = t1.trim() !== '' && t2.trim() !== '' && Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > a;
  const preview = valid
    ? `Free · ${sym} under ${sym}${a} · ${sym}${sym} ${sym}${a}–${b} · ${sym}${sym}${sym} over ${sym}${b}, a person`
    : 'Two amounts a person pays: where the first band tops out, and where the second does.';
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const res = await deskApi.post<{ change?: string }>(`/markets/${encodeURIComponent(code)}/cost-bands`,
        { t1: Math.round(a * 100), t2: Math.round(b * 100) });
      onSaved();
      const changeId = res?.change;
      if (changeId) toast(`Cost bands set for ${code}`, async () => { await deskApi.post(`/undo/${changeId}`, {}); onSaved(); });
    } catch (err) { toast((err as Error)?.message || 'Could not set the bands.'); }
    finally { setBusy(false); }
  };
  const box = { fontFamily: fonts.body, fontSize: 13.5, color: desk.ink, paddingVertical: 2, paddingHorizontal: 6, backgroundColor: desk.well, borderWidth: 1, borderColor: desk.rule, width: 90 } as const;
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <T tone={desk.inkDim} size={12.5}>{sym} up to</T>
        <TextInput value={t1} onChangeText={setT1} inputMode="decimal" placeholder="e.g. 15" placeholderTextColor={desk.inkFaint} onSubmitEditing={save} style={box} />
        <T tone={desk.inkDim} size={12.5}>{sym}{sym} up to</T>
        <TextInput value={t2} onChangeText={setT2} inputMode="decimal" placeholder="e.g. 40" placeholderTextColor={desk.inkFaint} onSubmitEditing={save} style={box} />
        {valid ? <TextLink tone={LIME} onPress={save}>{busy ? 'Setting…' : seeded ? 'Change' : 'Set'}</TextLink> : null}
      </View>
      <T tone={desk.inkFaint} size={12}>{preview}</T>
    </View>
  );
}

/** Bands are set only when the array has entries — an empty array is "not set". */
const hasBands = (m: { costBands: Band[] | null }): boolean => Array.isArray(m.costBands) && m.costBands.length > 0;

/** The one-line reason under a status. */
function statusReason(m: Market): string {
  if (m.status === 'live') return m.statusAt ? `since ${dayMonth(m.statusAt)}` : 'live';
  if (m.status === 'soft') return 'invited households only';
  return 'shown to visitors, not launched';
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

type ColKey = 'name' | 'status' | 'currency' | 'units' | 'bands' | 'places' | 'sources';

function MarketsList() {
  const go = useDeskGo();
  useCrumbs([], []);
  const [data, setData] = useState<{ markets: Market[]; blocked: Blocked[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<ColKey>>({ key: 'status', dir: 'asc' });
  const [showBlocked, setShowBlocked] = useState(false);

  useEffect(() => {
    let live = true;
    deskApi.get<{ markets: Market[]; blocked: Blocked[] }>('/markets')
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(err?.message || 'Markets did not load.'); });
    return () => { live = false; };
  }, []);

  const cols: TCol<ColKey>[] = [
    { key: 'name', name: 'Market', width: 190, first: 'asc' },
    { key: 'status', name: 'Status', width: 210, first: 'asc' },
    { key: 'currency', name: 'Currency', width: 90, first: 'asc' },
    { key: 'units', name: 'Units', width: 130, first: 'asc' },
    { key: 'bands', name: 'Cost bands', width: 150, first: 'asc' },
    { key: 'places', name: 'Places', width: 90, first: 'desc' },
    { key: 'sources', name: 'Sources', width: 130, first: 'desc' },
  ];

  const rows = useMemo(() => {
    if (!data) return [];
    const order = { live: 0, soft: 1, groundwork: 2 } as const;
    return sortRows(data.markets, sort, (m, k) => {
      if (k === 'name') return m.name;
      if (k === 'status') return order[m.status];
      if (k === 'currency') return m.currency;
      if (k === 'units') return m.distanceUnit;
      if (k === 'bands') return hasBands(m) ? 1 : 0;
      if (k === 'places') return m.places;
      if (k === 'sources') return m.sourcesConnected;
      return 0;
    });
  }, [data, sort]);

  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>Loading…</Muted>;

  return (
    <View style={{ gap: 18 }}>
      <PageTitle tip="A market is a country Epic knows how to speak in — its currency, units, area shape, middle level, timezone and cost bands. Not translation, and never shown to a customer.">Markets</PageTitle>

      <Table width={tableWidth(cols, 22)}>
        <THead cols={cols} sort={sort} onSort={setSort} gap={22} />
        {rows.map((m) => {
          return (
            <TRow key={m.code} gap={22} vpad={11} onPress={() => go('markets', { market: m.code })}>
              <TCell width={190}><T weight="700">{m.name}</T></TCell>
              <TCell width={210}>
                <View>
                  <T tone={m.status === 'live' ? LIME : desk.ink}>{STATUS_NAME[m.status]}</T>
                  <T size={12} tone={desk.inkDim}>{statusReason(m)}</T>
                </View>
              </TCell>
              <TCell width={90}><T tone={desk.inkMuted}>{m.currency}</T></TCell>
              <TCell width={130}><T tone={desk.inkMuted}>{m.distanceUnit} · °{m.tempUnit}</T></TCell>
              <TCell width={150}>
                {hasBands(m)
                  ? <T tone={desk.inkMuted}>{m.costBands!.length} bands</T>
                  : <T tone={AMBER}>Not set</T>}
              </TCell>
              <TCell width={90}><T num tone={desk.inkDim}>{n(m.places)}</T></TCell>
              <TCell width={130}>
                <T num tone={m.sourcesConnected < m.sourcesCanExist ? AMBER : desk.inkDim}>{m.sourcesConnected} of {m.sourcesCanExist} connected</T>
              </TCell>
            </TRow>
          );
        })}
      </Table>

      {/* Blocked markets — read-only, from the code constant (never rows), never
          drawn as broken. Vietnam is the one that catches people out. */}
      <View style={{ gap: 8, marginTop: 12 }}>
        <SectionTitle tip="Google's terms forbid the Maps Platform in these territories. Enforced in code, not a setting; no data is fetched or stored for them.">Blocked</SectionTitle>
        <T tone={desk.inkDim}>Google's terms forbid its data here.</T>
        {(() => {
          const vn = data.blocked.find((b) => b.code === 'VN');
          const rest = data.blocked.filter((b) => b.code !== 'VN');
          return (
            <View style={{ gap: 4 }}>
              {vn ? <T tone={desk.inkMuted}>{vn.name} — a real holiday destination; searches for it fail cleanly.</T> : null}
              {showBlocked
                ? rest.map((b) => <T key={b.name} tone={desk.inkMuted}>{b.name}{b.note ? ` — ${b.note}` : ''}</T>)
                : <TextLink onPress={() => setShowBlocked(true)}>{`and ${rest.length} more →`}</TextLink>}
            </View>
          );
        })()}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// A market's page
// ---------------------------------------------------------------------------

function speaksRows(m: Market): { label: string; value: string; amber?: boolean }[] {
  const area = m.areaCode?.name
    ? `${m.areaCode.name}${m.areaCode.pattern ? ` (${m.areaCode.pattern})` : ''}`
    : 'not loaded — searches by town only until it is';
  return [
    { label: 'Currency', value: m.currency },
    { label: 'Distance', value: m.distanceUnit },
    { label: 'Temperature', value: `°${m.tempUnit}` },
    { label: 'Area code', value: area, amber: !m.areaCode?.name },
    { label: 'Middle level', value: `${m.midLevelName} — replaces "county" everywhere Epic says it` },
    { label: 'Dates', value: m.dateFormat },
    { label: 'Timezone', value: m.defaultTimezone },
    { label: 'Wording seed', value: m.defaultWordingLocale },
  ];
}

/** One go-live check: met, or a plain statement of what it needs (owner: never a
 *  disabled control — the check names what is missing). */
function GoLiveRow({ ok, label, need }: { ok: boolean; label: string; need: string }) {
  if (ok) return <T tone={LIME}>✓ {label}</T>;
  return <T tone={AMBER}>— {label} · {need}</T>;
}

function MarketPage({ code, canManage }: { code: string; canManage: boolean }) {
  const go = useDeskGo();
  const toast = useToast();
  const [m, setM] = useState<MarketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useCrumbs([{ name: 'Markets', go: () => go('markets') }, { name: m?.name ?? code }], [m?.name, code]);

  // A sequence number so only the latest load's result is applied: a stale
  // refresh (e.g. one fired before an undo) cannot overwrite a newer one, and a
  // load in flight when the market changes or the page unmounts is discarded.
  const reqRef = React.useRef(0);
  const load = React.useCallback(() => {
    const seq = reqRef.current + 1;
    reqRef.current = seq;
    deskApi.get<MarketDetail>(`/markets/${encodeURIComponent(code)}`)
      .then((d) => {
        if (seq !== reqRef.current) return;
        if (d) { setM(d); setError(null); } else setError('That market did not load.');
      })
      .catch((err) => { if (seq === reqRef.current) setError(err?.message || 'That market did not load.'); });
  }, [code]);
  useEffect(() => { setM(null); setError(null); load(); return () => { reqRef.current += 1; }; }, [load]);

  const connect = async (sourceId: string) => {
    try {
      const res = await deskApi.post<{ change?: string }>(`/markets/${encodeURIComponent(code)}/sources/${encodeURIComponent(sourceId)}/connect`, {});
      load();
      // Only a real connection gets a toast, and its Undo carries this change's
      // own id — so submitting Connect twice never replaces a live Undo with a
      // no-op one, and an Undo that fails says so rather than throwing.
      if (res.change) {
        const changeId = res.change;
        toast(`${SOURCE_LABEL[sourceId] ?? sourceId} connected`, async () => {
          try { await deskApi.post(`/undo/${changeId}`, {}); load(); }
          catch (err) { toast((err as Error)?.message || 'Could not undo that.'); }
        });
      }
    } catch (err) { toast((err as Error)?.message || 'Could not connect that source.'); }
  };

  if (error) return <Muted>{error}</Muted>;
  if (!m) return <Muted>Loading…</Muted>;

  // What is missing before it could go live — said in words, not a disabled
  // control (owner). Each unmet item names what it needs.
  const missing: string[] = [];
  if (!m.checklist.costBands) missing.push('Cost bands — a per-person judgement for this market');
  if (!m.checklist.area) missing.push('Area handling — the postcode/ZIP shape is not loaded');
  if (!m.checklist.sources) missing.push('Sources — an everywhere source is missing or not yet wired');

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 3 }}>
        <Kicker>{STATUS_NAME[m.status].toUpperCase()} · {statusReason(m)}</Kicker>
        <PageTitle>{m.name}</PageTitle>
      </View>

      <View style={{ gap: 8 }}>
        <SectionTitle>How Epic speaks here</SectionTitle>
        {speaksRows(m).map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', gap: 12 }}>
            <T tone={desk.inkDim} size={12.5}>{r.label}</T>
            <T tone={r.amber ? AMBER : desk.inkMuted}>{r.value}</T>
          </View>
        ))}
      </View>

      <View style={{ gap: 8 }}>
        <SectionTitle tip="A per-market judgement a person sets — never derived from prices, never inherited. Places are sorted into bands by their own price; the bands are not calculated.">Cost bands</SectionTitle>
        {hasBands(m) ? (
          <>
            <T tone={desk.inkDim} size={12.5}>{m.costBandsSetBy ? `set by ${m.costBandsSetBy}${m.costBandsAt ? ` · ${dayMonth(m.costBandsAt)}` : ''}` : ''}</T>
            {m.costBands!.map((b) => (
              <View key={b.symbol} style={{ flexDirection: 'row', gap: 12 }}>
                <T weight="700" size={13}>{b.symbol}</T>
                <T tone={desk.inkMuted}>{bandRange(b, m.currency)}</T>
              </View>
            ))}
          </>
        ) : <T tone={AMBER}>Not set — a judgement is needed. A market without bands shows cost as "don't know".</T>}
        {canManage ? <CostBandEditor code={code} currency={m.currency} bands={m.costBands} onSaved={load} toast={toast} /> : null}
      </View>

      <View style={{ gap: 8 }}>
        <SectionTitle tip="Three states, and they mean different things. Connected: answering here. Doesn't exist here: nothing to connect, and not counted against the market. Not connected yet: exists here but nobody has wired it up.">Our sources here</SectionTitle>
        <T tone={desk.inkDim} size={12.5}>{m.sourcesConnected} of {m.sourcesCanExist} connected</T>
        {m.sources.map((s) => {
          const label = SOURCE_LABEL[s.id] ?? s.id;
          if (s.state === 'connected') return <T key={s.id} tone={desk.inkMuted}>{label}</T>;
          if (s.state === 'absent') return <T key={s.id} tone={desk.inkFaint}>{label} — nothing to connect; its facts read "don't know here", never "no"</T>;
          return (
            <View key={s.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <T weight="700" tone={AMBER}>{label} — not connected yet{s.note ? ` (${s.note})` : ''}</T>
              {canManage ? <TextLink tone={LIME} onPress={() => connect(s.id)}>Connect</TextLink> : null}
            </View>
          );
        })}
      </View>

      <View style={{ gap: 8 }}>
        <SectionTitle>Before it goes live</SectionTitle>
        {/* Never one button: each unmet check names what it needs and (where the
            action exists) carries it. "Go live" is always visible, inert with
            "N things first" until ready — the Exclude-confirmation pattern. */}
        <GoLiveRow ok={m.checklist.costBands} label="Cost bands" need="a per-person judgement for this market" />
        <GoLiveRow ok={m.checklist.area} label="Area handling" need={`the ${m.areaCode?.name ?? 'postcode/ZIP'} shape is not loaded`} />
        <GoLiveRow ok={m.checklist.sources} label="Sources" need="a source that exists here is not connected — Connect it above" />
        <View style={{ marginTop: 6 }}>
          {m.ready
            ? <T tone={LIME} weight="700">Go live in {m.name} →</T>
            : <T tone={desk.inkFaint}>Go live in {m.name} — {missing.length} thing{missing.length === 1 ? '' : 's'} first</T>}
        </View>
      </View>

      {m.notApplicable.length > 0 ? (
        <View style={{ gap: 6 }}>
          <SectionTitle tip="A subcategory not offered in this market at all — its count reads 'not applicable here', not 0. Behaviour settled; the screen for setting it is provisional.">Not offered here</SectionTitle>
          {m.notApplicable.map((s) => <T key={s} tone={desk.inkMuted}>{s}</T>)}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

export function Markets({ canManage }: { canManage: boolean }) {
  const go = useDeskGo();
  const [market] = useDeskParam('market');
  const [ns] = useDeskParam('ns');
  const wording = !!ns;
  return (
    <View style={{ gap: 16 }}>
      {/* Markets | Wording — the two views of this tab (design v2.2). */}
      <View style={{ flexDirection: 'row', gap: 0, borderWidth: 1, borderColor: desk.ruleStrong, alignSelf: 'flex-start' }}>
        {[['Markets', !wording, () => go('markets')], ['Wording', wording, () => go('markets', { ns: 'interface' })]].map(([label, on, onPress], i) => (
          <Press key={label as string} onPress={onPress as () => void}>
            <View style={{ paddingVertical: 6, paddingHorizontal: 14, backgroundColor: on ? LIME : 'transparent', borderLeftWidth: i ? 1 : 0, borderColor: desk.ruleStrong }}>
              <T tone={on ? '#201e1d' : desk.inkDim} weight={on ? '700' : '600'}>{label as string}</T>
            </View>
          </Press>
        ))}
      </View>
      {wording ? <Wording canManage={canManage} /> : market ? <MarketPage code={market} canManage={canManage} /> : <MarketsList />}
    </View>
  );
}
