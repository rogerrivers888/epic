/**
 * Overview — a read-only health page (design README v2 "Overview"; prototype
 * block `isOverview`). No inputs or controls anywhere on it.
 *
 *   1. NEEDS YOU — only real human decisions, as linked lines, or "Nothing
 *      needs you."
 *   2. HEALTH — Verification, Sources, Accuracy, Spend this month: a dot and a
 *      coloured top rule each, each a link to its page. A tile that cannot
 *      speak (Accuracy still building, no source asked anything this week) is
 *      drawn in the quiet rule colour, never green.
 *   3. COLLECTIONS — Most engaged · Shown but never opened · Reach nobody, "—"
 *      until there are real households, "None yet" where it can speak and a
 *      list is empty.
 *   4. GROWTH — Places known · Facts verified this week · Households, each with
 *      a small trend line.
 *   5. "Recent runs and spend →" to Runs.
 *
 * Everything is the API's (`GET /api/admin/desk/overview`); this file only
 * draws it.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { useDeskGo } from './Desk';
import { AMBER, LIME, Muted, RED, deskApi, desk, fonts, n, saidOf, tabular } from './kit';

type Tone = 'green' | 'amber' | 'red' | 'none';
type Tile = { tone: Tone; title: string; line: string | null };
type CollPick = { key: string; title: string; shown: number | null; opened: number | null; hearted: number | null };
type Point = { week: string; n: number };
type Growth = { n: number | null; line: string | null; series: Point[] };

type OverviewData = {
  needs: { key: 'mapping' | 'defaults'; n: number; label: string; where: string; subs?: string[] }[];
  health: { verification: Tile; sources: Tile; accuracy: Tile; spend: Tile };
  collections:
    | { speaks: false }
    | { speaks: true; mostEngaged: CollPick[]; shownNeverOpened: CollPick[]; reachNobody: CollPick[] };
  growth: { places: Growth; facts: Growth; households: Growth };
};

const TONE: Record<Tone, string> = { green: LIME, amber: AMBER, red: RED, none: desk.inkFaint };

/** The 10px/700 upper-case kicker over each section. */
function Head({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: desk.inkDim }}>{children}</Text>
  );
}

/**
 * Tiles on a 1px hairline grid: four (or three) across on a wide screen, two
 * across below 900, one on a phone.
 */
function Grid({ children, across }: { children: React.ReactNode; across: number }) {
  const width = useViewport().width;
  const cols = width >= 900 ? across : width >= 560 ? 2 : 1;
  const basis = `${100 / cols - 0.5}%` as const;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 1, backgroundColor: desk.rule, borderWidth: 1, borderColor: desk.rule }}>
      {React.Children.map(children, (c) => (c ? <View style={{ flexBasis: basis as unknown as number, flexGrow: 1, minWidth: 0 }}>{c}</View> : null))}
    </View>
  );
}

/**
 * A trend line, drawn here rather than from `admin/charts.tsx`: those follow
 * the light app theme, and this surface is pinned dark. The prototype's own
 * geometry — 120×32, two pixels of lime, the range stretched to 28 of it.
 */
function Spark({ series }: { series: Point[] }) {
  const vals = series.map((p) => p.n);
  if (vals.length < 2) return <View style={{ width: 140, height: 32 }} />;
  const mx = Math.max(...vals);
  const mn = Math.min(...vals);
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 120).toFixed(1)},${(30 - (mx === mn ? 15 : ((v - mn) / (mx - mn)) * 28)).toFixed(1)}`).join(' ');
  return (
    <Svg width={140} height={32} viewBox="0 0 120 32" preserveAspectRatio="none">
      <Polyline points={pts} fill="none" stroke={LIME} strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
}

export function Overview(_props: { canManage?: boolean }) {
  const go = useDeskGo();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    deskApi.get<OverviewData>('/overview')
      .then((d) => { if (live) setData(d); })
      .catch((err) => { if (live) setError(saidOf(err) || 'The overview did not load.'); });
    return () => { live = false; };
  }, []);

  if (error) return <Muted>{error}</Muted>;
  if (!data) return <Muted>Loading…</Muted>;

  const needs = data.needs;
  // A contradicted bulk setting opens Categories with the rows that need
  // review first (`?sort=review`, which Categories reads).
  const openNeed = (k: OverviewData['needs'][number]['key']) =>
    k === 'mapping' ? go('mapping', { view: 'needs' }) : go('categories', { view: null, sort: 'review' });

  const health: { name: string; tile: Tile; on: () => void }[] = [
    { name: 'Verification', tile: data.health.verification, on: () => go('facts', { ftab: 'verification' }) },
    { name: 'Sources', tile: data.health.sources, on: () => go('facts', { ftab: 'verification' }) },
    { name: 'Accuracy', tile: data.health.accuracy, on: () => go('facts', { ftab: 'accuracy' }) },
    { name: 'Spend this month', tile: data.health.spend, on: () => go('runs') },
  ];

  const c = data.collections;
  const colls: { name: string; items: CollPick[] | null }[] = [
    { name: 'Most engaged', items: c.speaks ? c.mostEngaged : null },
    { name: 'Shown but never opened', items: c.speaks ? c.shownNeverOpened : null },
    { name: 'Reach nobody', items: c.speaks ? c.reachNobody : null },
  ];

  const growth: { name: string; g: Growth }[] = [
    { name: 'Places known', g: data.growth.places },
    { name: 'Facts verified this week', g: data.growth.facts },
    { name: 'Households', g: data.growth.households },
  ];

  return (
    <View style={{ gap: 20 }}>
      {/* NEEDS YOU */}
      <View style={{ gap: 10, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18 }}>
        <Head>NEEDS YOU</Head>
        {needs.length === 0 ? (
          <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>Nothing needs you.</Text>
        ) : (
          <View style={{ gap: 6 }}>
            {needs.map((x) => (
              <View key={x.key} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                {/* Shrinks to the frame and wraps: on a phone the line is longer than the screen. */}
                <Press effect="none" onPress={() => openNeed(x.key)} accessibilityRole="link" style={{ flexShrink: 1, maxWidth: '100%' }}>
                  <Text style={{
                    fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', letterSpacing: -0.44, color: desk.ink,
                    borderBottomWidth: 2, borderBottomColor: LIME, paddingBottom: 1,
                  }}>{x.label}</Text>
                </Press>
                <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{x.where}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* HEALTH */}
      <View style={{ gap: 10 }}>
        <Head>HEALTH</Head>
        <Grid across={4}>
          {health.map((h) => (
            <Press key={h.name} effect="none" onPress={h.on} accessibilityRole="link" style={{ flexGrow: 1 }}>
              <View style={{
                flexGrow: 1, backgroundColor: desk.ground, paddingVertical: 16, paddingHorizontal: 18, gap: 8,
                borderTopWidth: 3, borderTopColor: TONE[h.tile.tone],
              }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>{h.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: TONE[h.tile.tone], flexShrink: 0 }} />
                  <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 14, fontWeight: '800', color: desk.ink }}>{h.tile.title}</Text>
                </View>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, minHeight: 16 }}>{h.tile.line ?? ''}</Text>
              </View>
            </Press>
          ))}
        </Grid>
      </View>

      {/* COLLECTIONS */}
      <View style={{ gap: 10, marginTop: 12 }}>
        <Head>COLLECTIONS</Head>
        <Grid across={3}>
          {colls.map((x) => (
            <View key={x.name} style={{ flexGrow: 1, backgroundColor: desk.ground, paddingVertical: 16, paddingHorizontal: 18, gap: 8, minHeight: 120 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '800', color: desk.ink }}>{x.name}</Text>
              {x.items == null ? (
                <>
                  <Text style={{ fontFamily: fonts.heading, fontSize: 22, fontWeight: '800', color: desk.inkDim }}>—</Text>
                  <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>Appears once there are real households</Text>
                </>
              ) : x.items.length === 0 ? (
                // It can speak and the list is empty: that is an answer, said
                // in words — not the dash of a list that cannot speak (CH.11).
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>None yet</Text>
              ) : x.items.map((i) => (
                <Press key={i.key} effect="none" onPress={() => go('collections', { collection: i.key })} accessibilityRole="link" style={{ alignSelf: 'flex-start' }}>
                  <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted, borderBottomWidth: 1, borderBottomColor: desk.ruleStrong }}>{i.title}</Text>
                </Press>
              ))}
            </View>
          ))}
        </Grid>
      </View>

      {/* GROWTH */}
      <View style={{ gap: 10, marginTop: 12 }}>
        <Head>GROWTH</Head>
        <Grid across={3}>
          {growth.map((x) => (
            <View key={x.name} style={{ flexGrow: 1, backgroundColor: desk.ground, paddingVertical: 16, paddingHorizontal: 18, gap: 8 }}>
              <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }}>{x.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
                <Text style={[{
                  fontFamily: fonts.heading, fontSize: 30, fontWeight: '800', letterSpacing: -0.9, lineHeight: 30,
                  color: x.g.n == null ? desk.inkDim : desk.ink,
                }, tabular]}>{n(x.g.n)}</Text>
                <Spark series={x.g.series} />
              </View>
              <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim, minHeight: 16 }}>{x.g.line ?? ''}</Text>
            </View>
          ))}
        </Grid>
      </View>

      <View style={{ marginTop: 12, flexDirection: 'row' }}>
        <Press effect="none" onPress={() => go('runs')} accessibilityRole="link">
          <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.inkMuted, borderBottomWidth: 1.5, borderBottomColor: desk.ruleStrong }}>
            Recent runs and spend →
          </Text>
        </Press>
      </View>
    </View>
  );
}
