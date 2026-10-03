/**
 * E7 · All events (hosting v4, README E7).
 *
 * One filter row — All · Private · Public, and a Kind dropdown opening a
 * sheet — both kept in the address (?vis=, ?kind=). Grouped Live · Helping
 * with · Drafts · Finished, an empty group left out. Each row: a 54px photo,
 * title, the next date and booked/max (or the draft's step, or how it ended),
 * the lane tag and the status chip. Finished rows at 70%. A draft opens the
 * wizard; everything else its event page. "Insights" top right.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { asOneOf, useQueryState, useRouter } from '../../../router';
import { HOST_LANES, paths, type HostLane } from '../../../routes';
import { api } from '../../../api';
import { CREAM, HAIRLINE, INACTIVE, INK, INK_MUTED, MOSS } from '../../../theme';
import { LANES, LANE_ORDER } from '../v7/model';
import { DeskSheet, Empty, Head, Loading, Page, Photo, Section, StatusChip, Tabs, tx } from './kit';
import { LANE_TAG, dayWords, shortDate, type DeskEvents as Events, type EventRow } from './model';

type Vis = 'all' | 'private' | 'public';
type Kind = HostLane | 'all';
const VIS: readonly Vis[] = ['all', 'private', 'public'];
const KINDS: readonly Kind[] = ['all', ...HOST_LANES];

const GROUPS: { key: keyof Events; title: string }[] = [
  { key: 'live', title: 'Live' },
  { key: 'helping', title: 'Helping with' },
  { key: 'drafts', title: 'Drafts' },
  { key: 'finished', title: 'Finished' },
];

const plain = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  return !m || /^HTTP \d+/.test(m) ? 'Your events could not be loaded. Try again in a moment.' : m;
};
/** "27 Sep" from 'YYYY-MM-DD'. */
const dayMonth = (ymd: string) => shortDate(ymd);

function lineOf(r: EventRow): string | null {
  if (r.group === 'drafts') return r.draft ? `Step ${r.draft.step} of ${r.draft.of}` : null;
  if (r.group === 'finished') return [r.endedOn ? `Ended ${dayMonth(r.endedOn)}` : 'Ended', r.came != null ? `${r.came} came` : null].filter(Boolean).join(' · ');
  if (!r.next) return null;
  if (r.next.booked == null) return dayWords(r.next.date);
  return `${dayWords(r.next.date)} · ${r.next.booked}${r.next.max ? ` of ${r.next.max}` : ' booked'}`;
}

export function DeskEvents() {
  const { navigate, back } = useRouter();
  const [vis, setVis] = useQueryState<Vis | null>('vis', 'all', asOneOf(VIS, 'all'));
  const [kind, setKind] = useQueryState<Kind | null>('kind', 'all', asOneOf(KINDS, 'all'));
  const [data, setData] = useState<Events | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => { api.deskEvents().then(setData).catch((e) => setError(plain(e))); }, []);

  const head = (
    <Head back="Host" onBack={() => back(paths.host())} title="All events"
      right={<Press onPress={() => navigate(paths.hostInsights())} accessibilityRole="link"><Text style={tx(15, '800', MOSS)}>Insights</Text></Press>} />
  );
  if (!data) return <Page>{head}<Loading error={error} /></Page>;

  const keep = (r: EventRow) =>
    (vis === 'all' || (vis === 'private') === (r.visibility === 'invite'))
    && (kind === 'all' || r.lane === kind);
  const groups = GROUPS.map((g) => ({ ...g, rows: data[g.key].filter(keep) })).filter((g) => g.rows.length > 0);

  return (
    <Page>
      {head}
      <View style={{ paddingHorizontal: 20, paddingTop: 14, flexDirection: 'row', gap: 3 }}>
        <View style={{ flex: 3 }}>
          <Tabs tabs={[{ key: 'all', label: 'All' }, { key: 'private', label: 'Private' }, { key: 'public', label: 'Public' }]}
            value={vis ?? 'all'} onPick={(k) => setVis(k, { replace: true })} />
        </View>
        <Press onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={`Kind: ${kind === 'all' || !kind ? 'All kinds' : LANE_TAG[kind]}`}
          style={{ flex: 1.3, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: HAIRLINE, backgroundColor: CREAM, paddingHorizontal: 6 }}>
          <Text style={tx(13.5, '800')} numberOfLines={1}>{kind === 'all' || !kind ? 'All kinds' : LANE_TAG[kind]}</Text>
          <Icon name="expand" size={14} color={INK} />
        </Press>
      </View>

      {groups.length === 0 ? (
        <Section><Empty>{GROUPS.some((g) => data[g.key].length) ? 'No events match.' : 'No events yet.'}</Empty></Section>
      ) : groups.map((g) => (
        <Section key={g.key} title={`${g.title} · ${g.rows.length}`}>
          <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
            {g.rows.map((r) => (
              <EventLine key={r.id} r={r} onPress={() => navigate(r.older ? paths.hostOffer(r.id) : r.group === 'drafts' ? paths.hostSetup(r.id) : paths.hostEvent(r.id))} />
            ))}
          </View>
        </Section>
      ))}

      {picking ? (
        <DeskSheet title="Kind" onClose={() => setPicking(false)}>
          {(['all', ...LANE_ORDER] as Kind[]).map((k) => {
            const on = (kind ?? 'all') === k;
            return (
              <Press key={k} onPress={() => { setKind(k, { replace: true }); setPicking(false); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
                <Text style={tx(15.5, on ? '800' : '600')}>{k === 'all' ? 'All kinds' : LANE_TAG[k]}</Text>
                {on ? <Icon name="check" size={18} color={INK} /> : null}
              </Press>
            );
          })}
        </DeskSheet>
      ) : null}
    </Page>
  );
}

function EventLine({ r, onPress }: { r: EventRow; onPress: () => void }) {
  const line = lineOf(r);
  // An offer from before the lanes carries no lane tag of its own.
  const lane = r.lane ? LANES[r.lane] : { tag: 'Older', bg: INACTIVE, fg: INK };
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={r.title ?? 'Untitled'}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: HAIRLINE }, r.group === 'finished' && { opacity: 0.7 }]}>
      <Photo uri={r.photo} height={54} style={{ width: 54 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={tx(15.5, '800')}>{r.title ?? 'Untitled'}</Text>
        {line ? <Text style={tx(13, '400', INK_MUTED)}>{line}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <View style={{ backgroundColor: lane.bg, paddingHorizontal: 7, paddingVertical: 3 }}><Text style={tx(12, '800', lane.fg)}>{lane.tag}</Text></View>
        <View><StatusChip chip={r.chip} words={r.chipWords} /></View>
      </View>
    </Press>
  );
}
