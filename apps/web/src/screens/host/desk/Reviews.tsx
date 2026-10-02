/**
 * E11 · Reviews (hosting v4, README E11).
 *
 * The rating, review and tip count; the star breakdown (a row filters the
 * list to that rating, again clears it); the rating or the count over six
 * months; what guests mention; then the list, All · Needs a reply · With a
 * tip. One public reply per review, and Report. A tip left without a review
 * is its own row with no reply.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { useRouter, useQueryState, asOneOf } from '../../../router';
import { paths } from '../../../routes';
import { api } from '../../../api';
import { DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, TARGET, fonts } from '../../../theme';
import { Bar, Btn, DeskSheet, Empty, Head, Kicker, Loading, Page, Section, Tabs, TextTabs, amberText, hx, tx } from './kit';
import { gbp, monthWords, shortDate, type DeskReviews as Payload, type Review } from './model';

type ListTab = 'all' | 'reply' | 'tips';
const LIST_TABS = ['all', 'reply', 'tips'] as const;
const asStars = {
  read: (raw: string) => (/^[1-5]$/.test(raw) ? Number(raw) : null),
  write: (v: number | null) => (v == null ? null : String(v)),
};

/** "1 Oct" from 'YYYY-MM-DD'. */
const shortDay = (ymd: string | null) => (ymd ? shortDate(ymd) : '');
const needsReply = (r: Review) => r.kind === 'review' && !r.reply;
const inputStyle = { fontFamily: fonts.body, fontSize: 15, color: INK, borderWidth: 1, borderColor: HAIRLINE, paddingHorizontal: 12, paddingVertical: 10, minHeight: TARGET, backgroundColor: 'transparent' } as const;

function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }} accessibilityLabel={`${n} ${n === 1 ? 'star' : 'stars'}`}>
      {Array.from({ length: n }, (_, i) => <Icon key={i} name="favourite" size={size} color={INK} fill />)}
    </View>
  );
}

export function DeskReviews() {
  const { back } = useRouter();
  const [d, setD] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useQueryState<ListTab>('tab', 'all', asOneOf(LIST_TABS, 'all'));
  const [stars, setStars] = useQueryState<number | null>('stars', null, asStars);
  const [over, setOver] = useState<'rating' | 'reviews'>('rating');
  const [reporting, setReporting] = useState<Review | null>(null);

  const load = useCallback(() => api.deskReviews().then((x) => { setD(x); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading error={error} />;

  const maxStar = Math.max(1, ...d.stars.map((s) => s.count));
  const months = d.overTime.months;
  const list = d.reviews.filter((r) => (tab === 'reply' ? needsReply(r) : tab === 'tips' ? (r.tipPence ?? 0) > 0 : true) && (stars == null || r.stars === stars));

  return (
    <Page>
      <Head back="Host" onBack={() => back(paths.host())} title="Reviews" />

      <View style={{ paddingHorizontal: 20, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {d.avg != null ? <Icon name="favourite" size={40} color={INK} fill /> : null}
          <Text style={hx(46)}>{d.avg == null ? '—' : d.avg.toFixed(1)}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={tx(15, '800')}>{d.count} {d.count === 1 ? 'review' : 'reviews'}</Text>
          <Text style={tx(13, '400', INK_MUTED)}>{d.tips.count} {d.tips.count === 1 ? 'tip' : 'tips'} · {gbp(d.tips.pence)} in tips</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
        {[5, 4, 3, 2, 1].map((n) => {
          const count = d.stars.find((s) => s.stars === n)?.count ?? 0;
          const on = stars === n;
          return (
            <Press key={n} onPress={() => setStars(on ? null : n)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${n} stars: ${count}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 29, backgroundColor: on ? INACTIVE : 'transparent' }}>
              <View style={{ width: 30, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={tx(13, '800')}>{n}</Text>
                <Icon name="favourite" size={12} color={INK} fill />
              </View>
              <View style={{ flex: 1 }}><Bar value={count} of={maxStar} height={8} ground={INACTIVE} fill={n >= 4 ? DEEP_GREEN : n === 3 ? HAIRLINE : amberText} /></View>
              <Text style={[tx(13, '800'), { width: 28, textAlign: 'right' }]}>{count}</Text>
            </Press>
          );
        })}
      </View>

      <Section>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Kicker>Over time</Kicker>
          <View style={{ width: 140 }}>
            <Tabs<'rating' | 'reviews'> value={over} onPick={setOver} height={32} tabs={[{ key: 'rating', label: 'Rating' }, { key: 'reviews', label: 'Reviews' }]} />
          </View>
        </View>
        <OverTime months={months} over={over} />
        {(() => {
          const line = over === 'rating' ? d.overTime.ratingLine : countLine(months);
          return line ? <Text style={tx(13.5, '800', DEEP_GREEN)}>{line}</Text> : null;
        })()}
      </Section>

      {d.mentions.length ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {d.mentions.map((m) => (
            <View key={m.label} style={{ backgroundColor: INACTIVE, paddingHorizontal: 9, paddingVertical: 7 }}>
              <Text style={tx(13, '600')}>{m.label} · {m.count}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <TextTabs<ListTab> value={tab} onPick={(k) => setTab(k)}
          tabs={[{ key: 'all', label: 'All' }, { key: 'reply', label: d.needsReply ? `Needs a reply · ${d.needsReply}` : 'Needs a reply' }, { key: 'tips', label: 'With a tip' }]} />
        {stars != null ? (
          <Press onPress={() => setStars(null)} accessibilityRole="button" accessibilityLabel={`Clear the ${stars} star filter`}
            style={{ marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: LIME, paddingHorizontal: 9, paddingVertical: 6 }}>
            <Text style={tx(13, '800')}>{stars}</Text>
            <Icon name="favourite" size={12} color={INK} fill />
            <Icon name="close" size={14} color={INK} />
          </Press>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        {list.length ? list.map((r) => <ReviewRow key={r.id} r={r} onReplied={load} onReport={() => setReporting(r)} />) : <Empty>Nothing here.</Empty>}
      </View>

      {reporting ? <ReportSheet r={reporting} onClose={() => setReporting(null)} onDone={() => { setReporting(null); load(); }} /> : null}
    </Page>
  );
}

/** "About 7 a month · 7 so far in October": the months before this one, then this one. */
function countLine(months: Payload['overTime']['months']): string | null {
  if (!months.length) return null;
  const last = months[months.length - 1];
  const before = months.slice(0, -1);
  const soFar = `${last.count} so far in ${monthWords(last.month)}`;
  if (!before.length) return soFar;
  const avg = Math.round(before.reduce((n, m) => n + m.count, 0) / before.length);
  return `About ${avg} a month · ${soFar}`;
}

function OverTime({ months, over }: { months: Payload['overTime']['months']; over: 'rating' | 'reviews' }) {
  const H = 44;
  const maxCount = Math.max(1, ...months.map((m) => m.count));
  const height = (m: Payload['overTime']['months'][number]) => {
    if (over === 'reviews') return Math.max(3, (m.count / maxCount) * H);
    if (m.avg == null) return 0;
    return Math.max(6, Math.min(1, (m.avg - 3) / 2) * H); // the top two stars, so a 0.1 move shows
  };
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-end' }}>
        {months.map((m, i) => {
          const lastOne = i === months.length - 1;
          const value = over === 'rating' ? (m.avg == null ? '—' : m.avg.toFixed(1)) : String(m.count);
          return (
            <View key={m.month} style={{ flex: 1, gap: 4, alignItems: 'stretch' }}>
              <Text style={[tx(12, '800'), { textAlign: 'center' }]}>{value}</Text>
              <View style={{ height: H, justifyContent: 'flex-end' }}>
                <View style={{ height: height(m), backgroundColor: lastOne ? LIME : HAIRLINE }} />
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {months.map((m, i) => (
          <Text key={m.month} style={[tx(12, i === months.length - 1 ? '800' : '500', i === months.length - 1 ? INK : INK_MUTED), { flex: 1, textAlign: 'center' }]}>{monthWords(m.month, true)}</Text>
        ))}
      </View>
    </View>
  );
}

function ReviewRow({ r, onReplied, onReport }: { r: Review; onReplied: () => void; onReport: () => void }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const body = text.trim();
    if (!body) { setError('Write a reply first.'); return; }
    setBusy(true);
    try { await api.deskReply(r.id, body); setReplying(false); setText(''); onReplied(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={{ paddingVertical: 14, borderTopWidth: 1, borderTopColor: HAIRLINE, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={[tx(15.5, '800'), { flex: 1 }]} numberOfLines={1}>{r.who}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {r.stars ? <Stars n={r.stars} /> : null}
          {r.tipPence ? <Text style={tx(13.5, '800')}>{r.stars ? '· ' : ''}{gbp(r.tipPence)} tip</Text> : null}
        </View>
      </View>
      <Text style={tx(13, '400', INK_MUTED)}>{[r.title, shortDay(r.on)].filter(Boolean).join(' · ')}</Text>
      {r.text ? <Text style={tx(15, '400', INK, { lineHeight: 21 })}>{r.text}</Text> : null}

      {r.reply ? (
        <View style={{ backgroundColor: INACTIVE, padding: 12, gap: 4, marginTop: 4 }}>
          <Kicker>Your reply</Kicker>
          <Text style={tx(14, '400', INK, { lineHeight: 20 })}>{r.reply}</Text>
        </View>
      ) : null}

      {replying ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <TextInput value={text} onChangeText={setText} multiline autoFocus accessibilityLabel={`Reply to ${r.who}`}
            style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]} />
          {error ? <Text style={tx(13, '600', INK_MUTED)}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn label="Cancel" kind="grey" onPress={() => { setReplying(false); setError(null); }} style={{ flex: 1 }} />
            <Btn label="Post reply" disabled={busy} onPress={send} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 18, marginTop: 4 }}>
          {r.kind === 'review' && !r.reply ? (
            <Press onPress={() => setReplying(true)} accessibilityRole="button" accessibilityLabel={`Reply to ${r.who}`}><Text style={tx(13.5, '800', DEEP_GREEN)}>Reply</Text></Press>
          ) : null}
          {r.reported
            ? <Text style={tx(13.5, '700', INK_MUTED)}>Reported</Text>
            : <Press onPress={onReport} accessibilityRole="button" accessibilityLabel={`Report ${r.who}`}><Text style={tx(13.5, '800', INK_MUTED)}>Report</Text></Press>}
        </View>
      )}
    </View>
  );
}

function ReportSheet({ r, onClose, onDone }: { r: Review; onClose: () => void; onDone: () => void }) {
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    const reason = why.trim();
    if (!reason) { setError('Say why first.'); return; }
    setBusy(true);
    try { await api.deskReport(r.id, reason); onDone(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <DeskSheet title="Report" onClose={onClose} footer={<Btn label="Send report" disabled={busy} onPress={send} />}>
      <Text style={tx(14, '700')}>{r.who}{r.title ? ` · ${r.title}` : ''}</Text>
      <Kicker>Why</Kicker>
      <TextInput value={why} onChangeText={setWhy} multiline autoFocus accessibilityLabel="Why"
        style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]} />
      {error ? <Text style={tx(13, '600', INK_MUTED)}>{error}</Text> : null}
    </DeskSheet>
  );
}
