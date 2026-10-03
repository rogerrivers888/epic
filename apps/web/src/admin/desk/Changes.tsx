/**
 * Changes — an audit trail of every change a person makes anywhere in the
 * back office (design README v2 "Changes"; prototype block `isChanges`).
 *
 * When · Who · Area · What changed · Before → After, newest first; the Why
 * sits under Before → After wherever the change carried one (Mapping and
 * Defaults always do). Filter by area and by person, and search. The
 * prototype's rows carry no Undo, so neither do these: undoing is the toast's
 * job at the moment of the change. A change that was later undone is kept and
 * says so, because the trail is of what people did.
 *
 * Address: `?tab=changes&area=Mapping&who=…&q=…` — filters replace, never push.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useViewport } from '../../hooks/useViewport';
import { useDeskParam } from './Desk';
import {
  Dropdown, LH, Muted, SearchBox, T, TCell, THead, TRow, Table, ago, deskApi, desk, fonts, LIME, saidOf, tabular, tableWidth,
  type TCol,
} from './kit';

type Change = {
  id: string; at: string; who: string; area: string; what: string;
  before: string | null; after: string | null; why: string | null;
  undone_at: string | null; undone_by: string | null;
};
type ChangesData = { rows: Change[]; total: number; people: string[]; areas: string[] };

type Key = 'when' | 'who' | 'area' | 'what' | 'change';
// The prototype's widths: What changed takes the room left over (never under
// 240), so at 1440 beside the rail the page never scrolls sideways.
const COLS: TCol<Key>[] = [
  { key: 'when', name: 'When', width: 120 },
  { key: 'who', name: 'Who', width: 100 },
  { key: 'area', name: 'Area', width: 140 },
  { key: 'what', name: 'What changed', width: 240, grow: true },
  { key: 'change', name: 'Before → After', width: 360 },
];
const WIDTH = tableWidth(COLS);

export function Changes(_props: { canManage?: boolean }) {
  const [area, setArea] = useDeskParam('area');
  const [who, setWho] = useDeskParam('who');
  const [q, setQ] = useDeskParam('q');
  const [text, setText] = useState(q);
  const [data, setData] = useState<ChangesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The search box writes the address a beat after the typing stops.
  useEffect(() => { setText(q); }, [q]);
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q) setQ(text.trim(), { replace: true }); }, 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    deskApi.get<ChangesData>('/changes', { area: area || null, who: who || null, q: q || null })
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((err) => { if (live) setError(saidOf(err) || 'The changes did not load.'); });
    return () => { live = false; };
  }, [area, who, q]);

  // A phone stacks each change as two lines — when · who · area, then what
  // changed and before → after — rather than a table whose last two columns
  // sit off the edge of a 390 frame (second audit CH.8).
  const narrow = useViewport().width < 900;
  const areas = data?.areas ?? [];
  const people = data?.people ?? [];

  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, paddingBottom: 4, flexWrap: 'wrap' }}>
        <View style={{ gap: 6, flexShrink: 1 }}>
          <Text style={{ fontFamily: fonts.heading, fontWeight: '800', fontSize: 31, letterSpacing: -1.085, lineHeight: 32, color: desk.ink }}>Changes</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim }}>Every change a person made anywhere in the back office.</Text>
        </View>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={{ fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: desk.inkDim }}>CHANGES</Text>
          <Text style={[{ fontFamily: fonts.body, fontSize: 15, fontWeight: '800', color: desk.ink }, tabular]}>
            {data ? data.total.toLocaleString('en-GB') : '—'}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 6, zIndex: 20 }}>
        <SearchBox value={text} onChange={setText} placeholder="Search changes" width={280} />
        <Dropdown<string>
          label={area || 'All areas'}
          value={area || ''}
          width={200}
          options={[{ key: '', name: 'All areas' }, ...areas.map((a) => ({ key: a, name: a }))]}
          onChange={(v) => setArea(v, { replace: true })}
        />
        <Dropdown<string>
          label={who || 'Everyone'}
          value={who || ''}
          width={180}
          options={[{ key: '', name: 'Everyone' }, ...people.map((p) => ({ key: p, name: p }))]}
          onChange={(v) => setWho(v, { replace: true })}
        />
      </View>

      {error ? <Muted>{error}</Muted> : !data ? <Muted>Loading…</Muted> : narrow ? (
        <View style={{ borderTopWidth: 2, borderTopColor: desk.ruleStrong }}>
          {data.rows.length === 0 ? <Muted>No changes match.</Muted> : null}
          {data.rows.map((c) => (
            <View key={c.id} style={{ gap: 4, paddingVertical: 11, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: desk.rule }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 2 }}>
                <T size={12.5} tone={desk.inkDim}>{ago(c.at)}</T>
                <T size={13} weight="700">{c.who}</T>
                <T size={13} tone={desk.inkMuted}>{c.area}</T>
              </View>
              <T size={13}>{c.what}</T>
              <BeforeAfter c={c} />
            </View>
          ))}
          {data.total > data.rows.length ? <Muted size={12.5}>{more(data)}</Muted> : null}
        </View>
      ) : (
        <Table width={WIDTH} fill>
          <THead cols={COLS} />
          {data.rows.length === 0 ? <Muted>No changes match.</Muted> : null}
          {data.rows.map((c) => (
            <TRow key={c.id} align="baseline" vpad={11}>
              <TCell width={COLS[0].width}><T size={12.5} tone={desk.inkDim}>{ago(c.at)}</T></TCell>
              <TCell width={COLS[1].width}><T size={13} weight="700">{c.who}</T></TCell>
              <TCell width={COLS[2].width}><T size={13} tone={desk.inkMuted}>{c.area}</T></TCell>
              <TCell width={COLS[3].width} grow><T size={13}>{c.what}</T></TCell>
              <TCell width={COLS[4].width}><BeforeAfter c={c} /></TCell>
            </TRow>
          ))}
          {data.total > data.rows.length ? <Muted size={12.5}>{more(data)}</Muted> : null}
        </Table>
      )}
    </View>
  );
}

const more = (d: ChangesData) =>
  `The newest ${d.rows.length.toLocaleString('en-GB')} of ${d.total.toLocaleString('en-GB')} — narrow the search to see older ones.`;

/** Before → After, then the Why and whether it was undone, under it. */
function BeforeAfter({ c }: { c: Change }) {
  return (
    <View>
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, lineHeight: LH(12.5), color: desk.inkMuted }}>
        <Text style={{ color: desk.inkDim }}>{c.before ?? '—'}</Text>
        {' → '}
        <Text style={{ fontWeight: '700', color: desk.link }}>{c.after ?? '—'}</Text>
      </Text>
      {c.why ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: LH(12), color: desk.inkDim, marginTop: 2 }}>{c.why}</Text>
      ) : null}
      {c.undone_at ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 12, lineHeight: LH(12), color: desk.inkDim, marginTop: 2 }}>
          {`Undone ${ago(c.undone_at)}${c.undone_by ? ` by ${c.undone_by}` : ''}`}
        </Text>
      ) : null}
    </View>
  );
}
