/**
 * Review on a flagged default (README v2: "Review opens the inspect view"):
 * the places in the subcategory with a confirmed answer for the fact, each
 * answer beside the default, the ones that say otherwise first. Answers are
 * compared in the screens' bands, as the flag itself is.
 * Address: `?tab=categories&sub=<key>&fact=<key>&view=review`.
 */

import React from 'react';
import { Text, View } from 'react-native';

import { useCrumbs, useDeskGo } from '../Desk';
import { AMBER, Muted, T, TCell, THead, TRow, Table, desk, fonts, n, tableWidth, tabular, type TCol } from '../kit';
import { LoadLine, Title, useDesk } from '../facts/shared';

type ReviewResp = {
  sub: string; subLabel: string; categoryLabel: string; fact: string; label: string; value: string | null;
  confirmed: number; agree: number; disagree: number;
  rows: { ref: string; name: string | null; area: string | null; answer: string | null; agrees: boolean | null; how: string | null }[];
};

const COLS: TCol[] = [
  { key: 'place', name: 'Place', width: 230 }, { key: 'answer', name: 'Its answer', width: 190 },
  { key: 'vs', name: 'Against the default', width: 170 }, { key: 'area', name: 'Area', width: 160 }, { key: 'how', name: 'How we know', width: 200 },
];

export function Review({ sub, fact }: { sub: string; fact: string }) {
  const go = useDeskGo();
  const load = useDesk<ReviewResp>(`/subcategories/${encodeURIComponent(sub)}/defaults/${encodeURIComponent(fact)}/review`);
  const d = load.data;
  useCrumbs([
    { name: 'Categories', go: () => go('categories') },
    { name: d?.subLabel ?? '…', go: () => go('categories', { sub }) },
    { name: d ? `Review · ${d.label}` : '…' },
  ], [d?.subLabel, d?.label, sub]);
  if (!d) return <LoadLine load={load} what="This review" />;

  return (
    <>
      <View style={{ gap: 6, borderBottomWidth: 2, borderBottomColor: desk.ruleStrong, paddingBottom: 18 }}>
        <Title>{`${d.label}: ${d.value ?? 'Not set'}`}</Title>
        <Text style={[{ fontFamily: fonts.body, fontSize: 15, fontWeight: '800', color: d.disagree ? AMBER : desk.ink }, tabular]}>
          {d.confirmed ? `${n(d.disagree)} of ${n(d.confirmed)} confirmed places say otherwise` : 'No confirmed places yet'}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>{d.categoryLabel} › {d.subLabel}</Text>
      </View>
      <Table width={tableWidth(COLS)}>
        <THead cols={COLS} />
        {d.rows.length === 0 ? <Muted size={13}>No place here has a confirmed answer yet.</Muted> : d.rows.map((r) => (
          <TRow key={r.ref}>
            <TCell width={230}><T weight="700" tone={r.name ? desk.ink : desk.inkDim}>{r.name ?? 'A place we cannot name'}</T></TCell>
            <TCell width={190}><T size={13} weight="700">{r.answer ?? '—'}</T></TCell>
            <TCell width={170}>
              <T size={13} weight={r.agrees ? '400' : '700'} tone={r.agrees == null ? desk.inkDim : r.agrees ? desk.inkMuted : AMBER}>
                {r.agrees == null ? '—' : r.agrees ? 'Agrees' : 'Says otherwise'}
              </T>
            </TCell>
            <TCell width={160}><T size={13} tone={desk.inkMuted}>{r.area ?? '—'}</T></TCell>
            <TCell width={200}><T size={12.5} tone={desk.inkMuted}>{r.how ?? '—'}</T></TCell>
          </TRow>
        ))}
      </Table>
    </>
  );
}
