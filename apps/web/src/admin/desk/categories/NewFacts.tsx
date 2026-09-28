/**
 * New facts: the Categories header count's drill (`?tab=categories&view=new`).
 * Every fact the machine made Active in the last 30 days, with what it rests
 * on; Remove takes it off that subcategory for good.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Press } from '../../../components/press';
import { useViewport } from '../../../hooks/useViewport';
import { useCrumbs, useDeskGo } from '../Desk';
import { LIME, Muted, Table, deskApi, desk, fonts, n, saidOf, tabular, useToast } from '../kit';
import { Count, Failed, undoChanges, type Change } from './shared';

type Row = {
  sub: string; subLabel: string; fact: string; label: string; activeSince: string;
  places: number; mentioned: number; confirmed: number; pct: number | null;
  /** "31%", or "<1%" for a fact that is there at under half a percent — never a rounded 0%. Null over no places. */
  pctText?: string | null;
};

const daysAgo = (at: string) => {
  const d = Math.floor((Date.now() - new Date(at).getTime()) / 86400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export function NewFacts({ canManage }: { canManage: boolean }) {
  const go = useDeskGo();
  const toast = useToast();
  const [data, setData] = useState<{ total: number; rows: Row[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Re-said once the list arrives: the desk clears the trail when the tab first draws.
  useCrumbs([{ name: 'Categories', go: () => go('categories') }, { name: 'New facts' }], [data == null]);

  useEffect(() => {
    let live = true;
    setErr(null);
    deskApi.get<{ total: number; rows: Row[] }>('/categories/new-facts').then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [tick]);

  const remove = async (r: Row) => {
    try {
      const c = await deskApi.post<Change>(`/subcategories/${encodeURIComponent(r.sub)}/facts/${encodeURIComponent(r.fact)}/remove`);
      toast(`${r.label} removed from ${r.subLabel} · it won’t be added again`, () => undoChanges([c.id], toast, reload));
      reload();
    } catch (e) { toast(saidOf(e)); }
  };

  const evidence = (r: Row) => {
    const pct = r.pctText ?? (r.pct == null ? null : `${r.pct}%`);
    return [
      `Mentioned at ${n(r.mentioned)} ${r.mentioned === 1 ? 'place' : 'places'}`,
      `confirmed on ${n(r.confirmed)} by our own sources`,
      pct == null ? null : `found on ${pct} of places`,
    ].filter(Boolean).join(' · ');
  };

  // Subcategory 220 · New fact 190 · What we have (the prototype's flex column: it
  // takes the room there is, and wraps rather than pushing Remove off the page) ·
  // Added 110 · 90, on an 18px gap. On a phone the table scrolls sideways at a
  // fixed width instead.
  const cols = [220, 190, 420, 110, 90];
  const tableW = cols.reduce((s, w) => s + w, 0) + 18 * (cols.length - 1) + 16;
  const narrow = useViewport().width < 900;
  const flexCol = narrow ? { width: cols[2] } : { flex: 1, minWidth: 300 };
  const Frame = ({ children }: { children: React.ReactNode }) => (narrow
    ? <Table width={tableW}>{children}</Table>
    : <View style={{ alignSelf: 'stretch' }}>{children}</View>);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, paddingBottom: 4 }}>
        <View style={{ gap: 6, flexShrink: 1 }}>
          <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>New facts</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>Facts the machine added in the last 30 days. Remove any that are wrong. It won’t add them again.</Text>
        </View>
        <Count label="New facts" n={data ? n(data.total) : '—'} align="flex-start" />
      </View>

      {err ? <Failed err={err} /> : !data ? <Muted>Loading</Muted> : (
        <View style={{ marginTop: 10 }}>
          <Frame>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingTop: 12, paddingBottom: 9, paddingHorizontal: 8 }}>
              {['Subcategory', 'New fact', 'What we have', 'Added', ''].map((h, i) => (
                <Text key={i} style={[i === 2 ? flexCol : { width: cols[i] }, { fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.inkDim }]}>{h}</Text>
              ))}
            </View>
            {data.rows.length === 0 ? <Muted>Nothing added in the last 30 days.</Muted> : null}
            {data.rows.map((r) => (
              <View key={`${r.sub}|${r.fact}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
                <View style={{ width: cols[0], minWidth: 0 }}>
                  <Press effect="none" onPress={() => go('categories', { sub: r.sub })}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkMuted }}>{r.subLabel}</Text>
                  </Press>
                </View>
                <View style={{ width: cols[1], minWidth: 0, alignItems: 'flex-start' }}>
                  <Press effect="none" onPress={() => go('categories', { sub: r.sub, fact: r.fact })}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 13.5, fontWeight: '700', color: desk.ink, borderBottomWidth: 1.5, borderBottomColor: LIME, paddingBottom: 2 }}>{r.label}</Text>
                  </Press>
                </View>
                <Text style={[flexCol, { fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted }, tabular]}>{evidence(r)}</Text>
                <Text style={{ width: cols[3], fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{daysAgo(r.activeSince)}</Text>
                <View style={{ width: cols[4], flexDirection: 'row', justifyContent: 'flex-end' }}>
                  {canManage ? (
                    <Press effect="none" onPress={() => remove(r)}>
                      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted, borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 5, paddingHorizontal: 12 }}>Remove</Text>
                    </Press>
                  ) : null}
                </View>
              </View>
            ))}
          </Frame>
        </View>
      )}
    </View>
  );
}
