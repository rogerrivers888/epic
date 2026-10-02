/**
 * E10 · Fees (hosting v4, README E10, corrected by the handover §3).
 *
 * The rate on public bookings in lime, and why. The path to 10% is by
 * rating: 20% to start → 15% after 5 rated events averaging 4.5+ → 10% after
 * 10 averaging 4.8+ — the ladder comes from the server, never spelled here.
 * Progress on rated events and average, what moves you back, every booking's
 * fee with its reason, the host's own link with Copy, and the private-event
 * prices.
 */

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../../api';
import { showToast } from '../../../components/Toast';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { HAIRLINE, INACTIVE, INK, INK_MUTED, LIME } from '../../../theme';
import { Bar, Btn, Empty, Head, Kicker, Loading, Page, Section, hx, tx } from './kit';
import { gbp, type DeskFees as Fees } from './model';

const pounds = (p: number) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DeskFees() {
  const { back } = useRouter();
  const [data, setData] = useState<Fees | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.deskFees().then((d) => { if (live) setData(d); }).catch(() => { if (live) setError('Your fees could not be loaded. Try again in a moment.'); });
    return () => { live = false; };
  }, []);
  if (!data) return <Loading error={error} />;

  const top = data.ladder.length ? data.ladder[data.ladder.length - 1].pct : null;
  const copy = () => {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clip?.writeText) { showToast('Copying isn’t available here.'); return; }
    clip.writeText(data.link.url).then(() => showToast('Link copied')).catch(() => showToast('That didn’t copy. Try again.'));
  };
  const priv = data.private;
  const privateLines = [
    priv.eventPence != null ? `${gbp(priv.eventPence)} an event${priv.proPence != null ? `, or Pro ${gbp(priv.proPence)} a month` : ''}` : priv.proPence != null ? `Pro ${gbp(priv.proPence)} a month` : null,
    priv.paymentFeePct != null ? `${priv.paymentFeePct}% on payments through Epic, card fees included` : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <Page>
      <Head back="Host" onBack={() => back(paths.host())} title="Fees" />

      <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
        <View style={{ backgroundColor: LIME, padding: 16, paddingTop: 18, gap: 4 }}>
          {data.privateOnly ? (
            <>
              <Kicker color={INK}>Your fee on payments through Epic</Kicker>
              <Text style={hx(46)}>{priv.paymentFeePct == null ? '—' : `${priv.paymentFeePct}%`}</Text>
              <Text style={[tx(13.5, '700'), { paddingTop: 6 }]}>Card fees included · plus {privateLines[0] ?? '—'}</Text>
            </>
          ) : (
            <>
              <Kicker color={INK}>Your rate on public bookings</Kicker>
              <Text style={hx(46)}>{data.ratePct == null ? '—' : `${data.ratePct}%`}</Text>
              <Text style={[tx(13.5, '700'), { paddingTop: 6 }]}>{data.why}</Text>
            </>
          )}
        </View>
      </View>

      {data.ladder.length && !data.privateOnly ? (
        <Section title={top != null ? `The path to ${top}%` : 'The path'}>
          <View style={{ flexDirection: 'row', gap: 3 }}>
            {data.ladder.map((step) => (
              <View key={step.pct} style={{ flex: 1, backgroundColor: step.current ? LIME : INACTIVE, padding: 10, paddingBottom: 12, gap: 4 }}
                accessibilityLabel={`${step.pct}%: ${step.words}${step.current ? ' (your rate)' : ''}`}>
                <Text style={hx(20)}>{step.pct}%</Text>
                <Text style={tx(12, '400', step.current ? INK : INK_MUTED)}>{step.words}</Text>
              </View>
            ))}
          </View>
          {data.progress ? (
            <View style={{ gap: 10, paddingTop: 4 }}>
              <Progress label="Rated events" figure={`${data.progress.ratedEvents} of ${data.progress.of}`} value={data.progress.ratedEvents} of={data.progress.of} />
              <Progress label="Average" figure={`${data.progress.avg == null ? '—' : data.progress.avg} of ${data.progress.avgNeeded}`} value={data.progress.avg ?? 0} of={data.progress.avgNeeded} />
            </View>
          ) : null}
          {data.movesBack ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 12, flexWrap: 'wrap' }}>
              <Text style={tx(13.5, '400')}>Moves you back</Text>
              <Text style={tx(13.5, '800')}>{data.movesBack.words}</Text>
            </View>
          ) : null}
        </Section>
      ) : null}

      <Section title="Every booking">
        <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          {data.bookings.length ? data.bookings.map((b, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={tx(15, '800')}>{[b.title, b.household].filter(Boolean).join(' · ')}</Text>
                <Text style={tx(13, '400', INK_MUTED)}>{b.reasonWords}</Text>
              </View>
              <Text style={[tx(14.5, '800'), { width: 52 }]}>{b.ratePct == null ? '—' : `${b.ratePct}%`}</Text>
              <Text style={[tx(14.5, '800'), { width: 64, textAlign: 'right' }]}>{b.feePence == null ? '—' : pounds(b.feePence)}</Text>
            </View>
          )) : <View style={{ borderTopWidth: 1, borderTopColor: HAIRLINE }}><Empty>No bookings yet.</Empty></View>}
        </View>
      </Section>

      <Section title="Your link">
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, backgroundColor: INACTIVE, paddingHorizontal: 12, justifyContent: 'center', minHeight: 44 }}>
            <Text style={tx(14.5, '500')} numberOfLines={1} ellipsizeMode="middle" selectable>{data.link.url.replace(/^https?:\/\//, '')}</Text>
          </View>
          <Btn label="Copy" icon="copy" onPress={copy} />
        </View>
        {data.link.ratePct != null ? <Text style={tx(14, '800')}>Bookings through your link: {data.link.ratePct}%</Text> : null}
      </Section>

      {privateLines.length ? (
        <Section title="Private events">
          <View style={{ gap: 4 }}>
            {privateLines.map((l) => <Text key={l} style={tx(14, '600')}>{l}</Text>)}
          </View>
        </Section>
      ) : null}
    </Page>
  );
}

function Progress({ label, figure, value, of }: { label: string; figure: string; value: number; of: number }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={tx(13.5, '400')}>{label}</Text>
        <Text style={tx(13.5, '800')}>{figure}</Text>
      </View>
      <Bar value={value} of={of} fill={LIME} ground={HAIRLINE} />
    </View>
  );
}
