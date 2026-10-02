/**
 * E12 · Insights (hosting v4, README E12).
 *
 * The last 30 days, an event at a time: views, bookings, conversion, and a
 * stacked bar of where the bookings came from (Epic search · Your link ·
 * Invites) under one legend. Then repeat guests — or why it can't say yet —
 * and what sells out fastest.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../../api';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { HAIRLINE, INACTIVE, INK, INK_MUTED, LIGHT_GREY, LIME } from '../../../theme';
import { Empty, Head, Kicker, Loading, Page, hx, tx } from './kit';
import type { DeskInsights as Insights } from './model';

const SOURCES = [
  { key: 'search', label: 'Epic search', color: INK },
  { key: 'link', label: 'Your link', color: LIME },
  { key: 'invites', label: 'Invites', color: LIGHT_GREY },
] as const;

export function DeskInsights() {
  const { back } = useRouter();
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.deskInsights().then((d) => { if (live) setData(d); }).catch(() => { if (live) setError('Your insights could not be loaded. Try again in a moment.'); });
    return () => { live = false; };
  }, []);
  if (!data) return <Loading error={error} />;

  const r = data.repeat;
  const fast = data.sellsOutFastest;
  return (
    <Page>
      <Head back="Host" onBack={() => back(paths.hostEvents())} title="Insights" />
      <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
        <Kicker style={{ paddingBottom: 10 }}>Last 30 days</Kicker>
        {data.events.length ? data.events.map((e) => (
          <View key={e.offerId} style={{ borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 14, paddingBottom: 12, gap: 10 }}>
            <Text style={tx(15.5, '800')}>{e.title ?? 'Your event'}</Text>
            <View style={{ flexDirection: 'row' }}>
              <Stat label="Views" value={String(e.views)} />
              <Stat label="Bookings" value={String(e.bookings)} />
              <Stat label="Conversion" value={e.conversionPct == null ? '—' : `${e.conversionPct}%`} />
            </View>
            <SourceBar s={e.sources} />
          </View>
        )) : <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}><Empty>Nothing live in the last 30 days.</Empty></View>}
        {data.events.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 12 }}>
            {SOURCES.map((s) => (
              <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 10, height: 10, backgroundColor: s.color }} />
                <Text style={tx(13, '400')}>{s.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: 20, paddingTop: 20 }}>
        <View style={{ flex: 1, backgroundColor: INACTIVE, padding: 12, gap: 4 }}>
          <Text style={tx(12.5, '400', INK_MUTED)}>Repeat guests</Text>
          <Text style={hx(28)}>{r.pct == null ? '—' : `${r.pct}%`}</Text>
          <Text style={tx(12.5, '400', INK_MUTED)}>{r.pct == null ? (r.reason ?? '') : `${r.came} of ${r.of} came back`}</Text>
        </View>
        {fast ? (
          <View style={{ flex: 1, backgroundColor: INACTIVE, padding: 12, gap: 4 }}>
            <Text style={tx(12.5, '400', INK_MUTED)}>Sells out fastest</Text>
            <Text style={tx(15.5, '800')}>{fast.title ?? 'Your event'}</Text>
            <Text style={tx(12.5, '400', INK_MUTED)}>full in {fast.days} {fast.days === 1 ? 'day' : 'days'} on average</Text>
          </View>
        ) : null}
      </View>
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={tx(12.5, '400', INK_MUTED)}>{label}</Text>
      <Text style={tx(16, '800')}>{value}</Text>
    </View>
  );
}

/** Where the bookings came from, one bar; an empty rule when nobody booked. */
function SourceBar({ s }: { s: Insights['events'][number]['sources'] }) {
  const total = s.search + s.link + s.invites;
  if (!total) return <View style={{ height: 8, backgroundColor: HAIRLINE }} />;
  return (
    <View style={{ flexDirection: 'row', height: 8, gap: 2 }}
      accessibilityLabel={SOURCES.map((x) => `${x.label} ${s[x.key]}`).join(', ')}>
      {SOURCES.filter((x) => s[x.key] > 0).map((x) => <View key={x.key} style={{ flex: s[x.key], backgroundColor: x.color }} />)}
    </View>
  );
}
