/**
 * Excluded facts: Feature · Subcategory · Why (README v2 "Excluded facts";
 * prototype `isExFacts`). A fact a person removed has Put back; a fact
 * ignored for being on nearly every place has Include anyway (handover C41).
 * Both are logged in Changes and undoable from the toast.
 */

import React from 'react';
import { Text, View } from 'react-native';

import { Press } from '../../../components/press';
import { useCrumbs, useDeskGo } from '../Desk';
import { Kicker, Muted, T, TCell, THead, TRow, Table, ago, deskApi, desk, fonts, n, tableWidth, tabular, type TCol } from '../kit';
import { FactTabs, LoadLine, Title, useDesk, useWrite } from './shared';

type ExRow = {
  fact: string; label: string; sub: string; subLabel: string; why: string;
  action: 'put_back' | 'include_anyway' | null; removedBy: string | null; removedAt: string | null;
};

const COLS: TCol[] = [
  { key: 'feature', name: 'Feature', width: 220 }, { key: 'sub', name: 'Subcategory', width: 240 },
  { key: 'why', name: 'Why', width: 260 }, { key: 'x', name: '', width: 120 },
];

export function Excluded({ canManage }: { canManage: boolean }) {
  const go = useDeskGo();
  const load = useDesk<{ rows: ExRow[] }>('/facts/excluded');
  const write = useWrite(load.reload);
  useCrumbs([{ name: 'Facts', go: () => go('facts') }, { name: 'Excluded facts' }], []);
  const rows = load.data?.rows ?? [];

  const whyOf = (r: ExRow) => (r.action === 'put_back'
    ? `Removed by ${r.removedBy ?? 'a person'}${r.removedAt ? ` · ${ago(r.removedAt)}` : ''}`
    : r.why);

  return (
    <>
      <FactTabs on="excluded" />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', paddingBottom: 4 }}>
        <View style={{ gap: 6 }}>
          <Title>Excluded facts</Title>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>Features the machine won’t look for, and why.</Text>
        </View>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Kicker>Excluded</Kicker>
          <Text style={[{ fontFamily: fonts.heading, fontSize: 15, fontWeight: '800', color: desk.ink }, tabular]}>{load.data ? n(rows.length) : '—'}</Text>
        </View>
      </View>
      {!load.data ? <LoadLine load={load} what="Excluded facts" /> : (
        <Table width={tableWidth(COLS)}>
          <THead cols={COLS} />
          {rows.length === 0 ? <Muted>Nothing excluded.</Muted> : rows.map((r) => (
            <TRow key={`${r.sub}|${r.fact}`}>
              <TCell width={220}><T weight="700">{r.label}</T></TCell>
              <TCell width={240}>
                <Press effect="none" onPress={() => go('categories', { sub: r.sub })}><T size={13} tone={desk.inkMuted}>{r.subLabel}</T></Press>
              </TCell>
              <TCell width={260}><T size={12.5} tone={desk.inkDim}>{whyOf(r)}</T></TCell>
              <TCell width={120} style={{ alignItems: 'flex-end' }}>
                {canManage && r.action ? (
                  <Press effect="none" onPress={() => write(
                    () => deskApi.post<{ id: string }>(`/facts/excluded/${encodeURIComponent(r.sub)}/${encodeURIComponent(r.fact)}`, { mode: r.action }),
                    r.action === 'put_back' ? `${r.label} put back on ${r.subLabel}` : `${r.label} included anyway on ${r.subLabel}`,
                  )}>
                    <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: desk.inkMuted, borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 5, paddingHorizontal: 12 }}>
                      {r.action === 'put_back' ? 'Put back' : 'Include anyway'}
                    </Text>
                  </Press>
                ) : null}
              </TCell>
            </TRow>
          ))}
        </Table>
      )}
    </>
  );
}
