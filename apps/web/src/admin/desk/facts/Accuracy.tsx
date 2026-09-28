/**
 * Accuracy: the machine against what families said after visiting (README v2
 * "Accuracy"; prototype `isAccuracy`, `isAccFact`).
 *
 * It tests the rules and the sources, not the places. Under ten answers a
 * figure is "Building", never a percentage; under 90% it is red. The headline
 * and its chart always show every source; the Source control filters the
 * table and the health view it opens. "Disagreement" (machine against
 * families) is never "conflict" (our own sources against each other).
 */

import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { Press } from '../../../components/press';
import { useViewport } from '../../../hooks/useViewport';
import { useCrumbs, useDeskGo, useDeskParam } from '../Desk';
import {
  LH, LIME, Muted, ON_LIME, PageTitle, SearchBox, T, TCell, THead, TRow, Table,
  desk, fonts, n, sortRows, tableWidth, tabular, type SortState, type TCol,
} from '../kit';
import { DeskLineChart, percentScale } from './Chart';
import { SmallSeg } from './Verification';
import {
  BackLink, FactTabs, LoadLine, MACHINE_SOURCES, SRC_NAME, Title, dayMon, monShort, monthYear, nameWidth, pctCell, plural, useDesk, type Fig,
} from './shared';

// ---------------------------------------------------------------------------
// Shapes (apps/api/src/desk/accuracy.js)
// ---------------------------------------------------------------------------

type SubFig = Fig & { key: string; label: string; facts?: number };
type Row = Fig & { key: string; label: string; subcategories: number | SubFig[] };
type AccResp = {
  headline: Fig;
  series: (Fig & { at: string })[];
  /** Every name the table could show, whatever the view or source (sizes the first column once). */
  names?: { facts: string[]; categories: string[]; subcategories: string[] };
  sources: (Fig & { key: string; label: string })[];
  source: string | null;
  sourceCompared: number | null;
  view: 'fact' | 'category';
  table: Row[];
};
type HealthResp = {
  kind: 'fact' | 'category' | 'subcategory'; key: string; label: string;
  headline: Fig; subcategoryCount: number; factCount: number;
  bySource: (Fig & { key: string; label: string })[];
  second: { by: 'fact' | 'subcategory'; rows: SubFig[] };
};
type DisResp = { source: string; label: string; rows: { ref: string; place: string | null; subcategory: string | null; fact: string | null; sourceSaid: string; familiesSaid: string; date: string }[] };

type Kind = 'fact' | 'category' | 'subcategory';
const NOWRAP = (Platform.OS === 'web' ? { whiteSpace: 'nowrap' } : {}) as object;
const kindOf = (raw: string): Kind | null => (raw === 'fact' || raw === 'category' || raw === 'subcategory' ? raw : null);

export function Accuracy() {
  const [kindRaw] = useDeskParam('kind');
  const [key] = useDeskParam('key');
  const kind = kindOf(kindRaw);
  return kind && key ? <Health kind={kind} rowKey={key} /> : <Main />;
}

/** "Building" or a percentage, in its weight and colour. */
function Pct({ f, size = 13.5 }: { f: Fig; size?: number }) {
  const c = pctCell(f);
  return <Text numberOfLines={1} style={[{ fontFamily: fonts.body, fontSize: size, fontWeight: c.weight, color: c.tone }, tabular]}>{c.text}</Text>;
}

// ---------------------------------------------------------------------------
// The main page
// ---------------------------------------------------------------------------

function Main() {
  const go = useDeskGo();
  const narrow = useViewport().width < 900;
  const [src, setSrc] = useDeskParam('src');
  const [by, setBy] = useDeskParam('by');
  const [chart, setChart] = useDeskParam('chart');
  const view = by === 'category' ? 'category' : 'fact';
  const daily = chart === 'daily';
  // The sort is part of the address (`?sort=answered.desc`), worst accuracy first by default.
  const [sortRaw, setSortRaw] = useDeskParam('sort');
  const sort: SortState = (() => {
    const [key, dir] = sortRaw.split('.');
    return key && (dir === 'asc' || dir === 'desc') ? { key, dir } : { key: 'acc', dir: 'asc' };
  })();
  const setSort = (x: SortState) => setSortRaw(x && !(x.key === 'acc' && x.dir === 'asc') ? `${x.key}.${x.dir}` : '', { replace: true });
  const [openCats, setOpenCats] = useState<string[]>([]);
  const load = useDesk<AccResp>('/accuracy', { view, source: src || null, chart: daily ? 'daily' : null });
  useCrumbs([{ name: 'Facts', go: () => go('facts') }, { name: 'Accuracy' }], []);
  const a = load.data;

  const series = a?.series ?? [];
  const values = series.map((p) => p.accuracy);
  const scale = percentScale(values);
  const k = series.length;
  const labels = series.map((p, i) => (daily
    ? ((k - 1 - i) % 7 === 0 ? (i === k - 1 ? 'Today' : dayMon(p.at)) : '')
    : monShort(p.at)));
  const when = (i: number) => (daily ? (i === k - 1 ? 'today' : dayMon(series[i].at)) : monthYear(series[i].at));
  const tip = (i: number) => {
    const p = series[i];
    return p.accuracy == null ? `Building · ${plural(p.answered, 'answer')} · ${when(i)}` : `${p.accuracy}% · ${when(i)}`;
  };

  const table = a?.table ?? [];
  // Sized once from every fact name (and category name) there is, whatever
  // the view or the source, so neither the column nor the toolbar measured to
  // it moves when either changes (prototype `accFactW`, logic.js 3345; audit
  // 28 Sep 2026). The formula's 96px of slack is what an indented
  // subcategory name at 13px sits in, on one line.
  const names = a?.names;
  const nameW = names
    ? Math.max(nameWidth(names.facts), nameWidth(names.categories) + 18)
    : nameWidth(table.map((r) => r.label));
  const cols: TCol[] = [
    { key: 'name', name: view === 'category' ? 'Category' : 'Fact', width: nameW, first: 'asc' },
    { key: 'subs', name: 'Subcategories', width: 150, first: 'desc' },
    { key: 'answered', name: 'Families answered', width: 150, first: 'desc' },
    { key: 'agreed', name: 'Machine agreed', width: 150, first: 'desc' },
    { key: 'acc', name: 'Accuracy', width: 150, first: 'asc' },
    { key: 'dis', name: 'Disagreements', width: 150, first: 'desc' },
  ];
  const width = tableWidth(cols, 24);
  const val = (r: Fig & { label: string; subcategories?: number | SubFig[] }, key: string) => (
    key === 'name' ? r.label
      : key === 'subs' ? (Array.isArray(r.subcategories) ? r.subcategories.length : r.subcategories ?? null)
        : key === 'answered' ? r.answered
          : key === 'agreed' ? r.agreed
            : key === 'dis' ? r.disagreements
              : r.accuracy);
  const byName = (r: { label: string }) => r.label;
  const rows = sortRows(table, sort, val, byName);

  const openRow = (kind: Kind, key: string) => go('facts', { ftab: 'accuracy', kind, key, src: src || null });
  const bySrc = new Map((a?.sources ?? []).map((s) => [s.key, s]));
  const srcOpts = [{ key: '', name: 'All sources', f: a?.headline }, ...MACHINE_SOURCES.map((s) => ({ key: s, name: SRC_NAME[s], f: bySrc.get(s) }))];

  return (
    <>
      <FactTabs on="accuracy" />
      <View style={{ zIndex: 20 }}>
        <PageTitle tip="How often the machine’s automatic answers matched what families told us after visiting. It tests the rules and sources, not individual places.">Accuracy</PageTitle>
      </View>
      {!a ? <LoadLine load={load} what="Accuracy" /> : (
        <>
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: narrow ? 24 : 72, alignItems: 'stretch', justifyContent: narrow ? 'flex-start' : 'flex-end',
            borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18,
          }}>
            <View style={{ justifyContent: 'center', gap: 6 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: desk.inkMuted }}>Machine agreed with families</Text>
              <Text style={[{
                fontFamily: fonts.heading, fontSize: 56, fontWeight: '800', letterSpacing: -2.24, lineHeight: 56,
                color: a.headline.accuracy == null ? desk.inkDim : LIME,
              }, tabular]}>{a.headline.accuracy == null ? 'Building' : `${a.headline.accuracy}%`}</Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{`from ${plural(a.headline.answered, 'family answer')}`}</Text>
            </View>
            <View style={{ width: narrow ? '100%' : 620, maxWidth: '100%', flexShrink: 1, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <SmallSeg
                  options={[{ key: 'monthly', name: 'Monthly' }, { key: 'daily', name: 'Last 30 days' }]}
                  value={daily ? 'daily' : 'monthly'}
                  onChange={(v) => setChart(v === 'daily' ? 'daily' : '', { replace: true })}
                  padV={6} padH={12} size={12}
                />
              </View>
              <DeskLineChart
                series={values} labels={labels} tip={tip} color={LIME} lo={scale.lo} hi={scale.hi}
                fmt={(v) => `${Math.round(v)}%`} height={150} axisWidth={32} gap={6}
                blank={daily ? 'Every day has fewer than 10 answers — Building' : 'Every month has fewer than 10 answers — Building'}
              />
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginTop: 12, width, maxWidth: '100%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap', flexShrink: 1, maxWidth: '100%' }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>Source</Text>
              {/* Each segment carries its own 1px rule, pulled back over its
                  neighbour's, so a row that wraps on a phone closes as a clean
                  grid rather than leaving a stray left rule at a line's start. */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingTop: 1, paddingLeft: 1, alignSelf: 'flex-start', flexShrink: 1, maxWidth: '100%' }}>
                {srcOpts.map((o) => {
                  const on = o.key === src;
                  const f = o.f ?? { accuracy: null, building: true };
                  return (
                    <Press key={o.key || 'all'} effect="none" onPress={() => setSrc(o.key, { replace: true })}>
                      <View style={{
                        flexDirection: 'row', alignItems: 'baseline', gap: 7, paddingVertical: 7, paddingHorizontal: 14,
                        backgroundColor: on ? LIME : 'transparent', borderWidth: 1, borderColor: desk.ruleStrong, marginTop: -1, marginLeft: -1,
                      }}>
                        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: on ? '700' : '600', color: on ? ON_LIME : desk.inkDim }}>{o.name}</Text>
                        <Text style={[{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '800', color: on ? ON_LIME : desk.inkMuted }, tabular]}>
                          {f.accuracy == null ? 'Building' : `${f.accuracy}%`}
                        </Text>
                      </View>
                    </Press>
                  );
                })}
              </View>
              {src && a.sourceCompared != null ? (
                <Text style={[{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }, tabular]}>{`${n(a.sourceCompared)} answers compared`}</Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <Text style={[{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }, NOWRAP]}>View by</Text>
              <SmallSeg
                options={[{ key: 'fact', name: 'Fact' }, { key: 'category', name: 'Category' }]}
                value={view}
                onChange={(v) => { setBy(v === 'category' ? 'category' : '', { replace: true }); setOpenCats([]); }}
              />
            </View>
          </View>

          <View style={{ marginTop: 10 }}>
            <Table width={width}>
              <THead cols={cols} sort={sort} onSort={setSort} gap={24} />
              {rows.length === 0 ? <Muted>No family answers to compare yet.</Muted> : rows.map((r) => {
                if (view === 'fact') {
                  return (
                    <TRow key={r.key} gap={24} onPress={() => openRow('fact', r.key)}>
                      <AccCells r={r} nameW={nameW} subs={typeof r.subcategories === 'number' ? r.subcategories : 0} />
                    </TRow>
                  );
                }
                const subs = Array.isArray(r.subcategories) ? sortRows(r.subcategories, sort, val, byName) : [];
                const open = openCats.includes(r.key);
                return (
                  <View key={r.key}>
                    <TRow gap={24} onPress={() => setOpenCats((o) => (open ? o.filter((x) => x !== r.key) : [...o, r.key]))}>
                      <AccCells r={r} nameW={nameW} subs={subs.length} caret={open ? 'open' : 'shut'} />
                    </TRow>
                    {open ? subs.map((s) => (
                      <Press key={s.key} effect="none" onPress={() => openRow('subcategory', s.key)}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24, paddingVertical: 9, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: desk.rule, backgroundColor: desk.lifted }}>
                          <TCell width={nameW}><View style={{ paddingLeft: 18 }}><Text numberOfLines={1} style={[{ fontFamily: fonts.body, fontSize: 13, lineHeight: LH(13), color: desk.inkMuted }, NOWRAP]}>{s.label}</Text></View></TCell>
                          <TCell width={150}><T size={13} tone={desk.inkDim} num>{s.facts == null ? '' : n(s.facts)}</T></TCell>
                          <TCell width={150}><T size={13} tone={desk.inkMuted} num>{n(s.answered)}</T></TCell>
                          <TCell width={150}><T size={13} tone={desk.inkMuted} num>{n(s.agreed)}</T></TCell>
                          <TCell width={150}><Pct f={s} size={13} /></TCell>
                          <TCell width={150}><T size={13} tone={desk.inkMuted} num>{n(s.disagreements)}</T></TCell>
                        </View>
                      </Press>
                    )) : null}
                  </View>
                );
              })}
            </Table>
          </View>
        </>
      )}
    </>
  );
}

function AccCells({ r, nameW, subs, caret }: { r: Row; nameW: number; subs: number; caret?: 'open' | 'shut' }) {
  return (
    <>
      <TCell width={nameW}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {caret ? <View style={{ width: 10 }}><Icon name={caret === 'open' ? 'expand' : 'more'} size={11} color={desk.inkDim} /></View> : null}
          <T weight="700">{r.label}</T>
        </View>
      </TCell>
      <TCell width={150}><T tone={desk.inkMuted} num>{n(subs)}</T></TCell>
      <TCell width={150}><T num>{n(r.answered)}</T></TCell>
      <TCell width={150}><T num>{n(r.agreed)}</T></TCell>
      <TCell width={150}><Pct f={r} /></TCell>
      <TCell width={150}><T num>{n(r.disagreements)}</T></TCell>
    </>
  );
}

// ---------------------------------------------------------------------------
// A row's health view
// ---------------------------------------------------------------------------

const SRC_COLS: TCol[] = [
  { key: 'src', name: 'Source', width: 150 }, { key: 'answered', name: 'Families answered', width: 140 },
  { key: 'agreed', name: 'Machine agreed', width: 140 }, { key: 'acc', name: 'Accuracy', width: 140 }, { key: 'dis', name: 'Disagreements', width: 140 },
];

function Health({ kind, rowKey }: { kind: Kind; rowKey: string }) {
  const go = useDeskGo();
  const narrow = useViewport().width < 900;
  const [src, setSrc] = useDeskParam('src');
  const [q, setQ] = useState('');
  const path = `/accuracy/${kind}/${encodeURIComponent(rowKey)}`;
  const load = useDesk<HealthResp>(path);
  const dis = useDesk<DisResp>(src ? `${path}/disagreements` : null, { source: src || null });
  const h = load.data;
  useCrumbs([
    { name: 'Facts', go: () => go('facts') },
    { name: 'Accuracy', go: () => go('facts', { ftab: 'accuracy' }) },
    { name: h?.label ?? '' },
  ], [h?.label]);
  if (!h) return <LoadLine load={load} what="This row" />;

  const isSub = kind === 'subcategory';
  const count = isSub ? plural(h.factCount, 'fact') : plural(h.subcategoryCount, 'subcategory', 'subcategories');
  const line = h.headline.accuracy == null
    ? `Building · ${plural(h.headline.answered, 'family answer')} so far`
    : `Machine agreed ${n(h.headline.agreed)} of ${plural(h.headline.answered, 'family answer')} · ${h.headline.accuracy}% · ${count}`;
  const splitTitle = isSub ? 'By fact' : 'By subcategory';
  const splitCols: TCol[] = [
    { key: 'name', name: isSub ? 'Fact' : 'Subcategory', width: 160 }, { key: 'answered', name: 'Families answered', width: 120 },
    { key: 'agreed', name: 'Machine agreed', width: 120 }, { key: 'acc', name: 'Accuracy', width: 120 },
  ];
  const disCols: TCol[] = [
    { key: 'place', name: 'Place', width: 240 }, { key: 'b', name: isSub ? 'Fact' : 'Subcategory', width: 180 },
    { key: 'src', name: 'Source said', width: 120 }, { key: 'fam', name: 'Families said', width: 120 }, { key: 'date', name: 'Date', width: 100 },
  ];
  const needle = q.trim().toLowerCase();
  const disRows = (dis.data?.rows ?? []).filter((r) => !needle || String(r.place ?? '').toLowerCase().includes(needle));
  const sectionTitle = { fontFamily: fonts.heading, fontSize: 17, fontWeight: '800' as const, letterSpacing: -0.17, color: desk.ink, paddingBottom: 10 };

  return (
    <>
      <View style={{ gap: 8, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18 }}>
        <BackLink label="Accuracy" onPress={() => go('facts', { ftab: 'accuracy', src: src || null })} />
        <Title>{h.label}</Title>
        <Text style={[{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted }, tabular]}>{line}</Text>
      </View>
      <View style={{ flexDirection: narrow ? 'column' : 'row', gap: narrow ? 26 : 56, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <View style={{ maxWidth: '100%' }}>
          <Text style={sectionTitle}>By source</Text>
          <Table width={tableWidth(SRC_COLS, 24)}>
            <THead cols={SRC_COLS} gap={24} pad={8} />
            {h.bySource.map((s) => {
              const on = src === s.key;
              return (
                <TRow key={s.key} gap={24} lifted={on} onPress={() => { setSrc(on ? '' : s.key, { replace: true }); setQ(''); }}>
                  <TCell width={150}><T weight="700">{SRC_NAME[s.key] ?? s.label}</T></TCell>
                  <TCell width={140}><T num>{n(s.answered)}</T></TCell>
                  <TCell width={140}><T num>{n(s.agreed)}</T></TCell>
                  <TCell width={140}><Pct f={s} /></TCell>
                  <TCell width={140}><T num weight="700">{n(s.disagreements)}</T></TCell>
                </TRow>
              );
            })}
          </Table>
        </View>
        <View style={{ maxWidth: '100%' }}>
          <Text style={sectionTitle}>{splitTitle}</Text>
          <Table width={tableWidth(splitCols, 24)}>
            <THead cols={splitCols} gap={24} pad={8} />
            {h.second.rows.length === 0 ? <Muted size={13}>No family answers yet.</Muted> : h.second.rows.map((s) => (
              <TRow key={s.key} gap={24}>
                <TCell width={160}><T weight="700">{s.label}</T></TCell>
                <TCell width={120}><T num>{n(s.answered)}</T></TCell>
                <TCell width={120}><T num>{n(s.agreed)}</T></TCell>
                <TCell width={120}><Pct f={s} /></TCell>
              </TRow>
            ))}
          </Table>
        </View>
      </View>
      <View style={{ gap: 10, marginTop: 12 }}>
        {!src ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 13.5, color: desk.inkDim, paddingVertical: 6 }}>Pick a source to see its disagreements</Text>
        ) : !dis.data ? <LoadLine load={dis} what="The disagreements" /> : (
          <>
            <Text style={{ fontFamily: fonts.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: desk.ink }}>
              {`${SRC_NAME[src] ?? dis.data.label} · ${plural(dis.data.rows.length, 'disagreement')}`}
            </Text>
            <SearchBox value={q} onChange={setQ} placeholder="Search places" width={260} />
            <Table width={tableWidth(disCols, 24, 0)}>
              <THead cols={disCols} gap={24} pad={0} />
              {disRows.length === 0 ? <Muted size={13}>No disagreements match.</Muted> : disRows.map((r, i) => (
                <View key={`${r.ref}|${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 24, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
                  <TCell width={240}><T weight="700">{r.place ?? r.ref}</T></TCell>
                  <TCell width={180}><T size={13} tone={desk.inkMuted}>{(isSub ? r.fact : r.subcategory) ?? '—'}</T></TCell>
                  <TCell width={120}><T size={13} tone={desk.inkMuted}>{r.sourceSaid}</T></TCell>
                  <TCell width={120}><T size={13} tone={desk.inkMuted}>{r.familiesSaid}</T></TCell>
                  <TCell width={100}><T size={12.5} tone={desk.inkDim}>{dayMon(r.date)}</T></TCell>
                </View>
              ))}
            </Table>
          </>
        )}
      </View>
    </>
  );
}
