/**
 * E6 · At risk (hosting v4, README E6).
 *
 * Per event under its minimum near decides-by: an amber block with Booked ·
 * Min · Decides (Decides wider, never wraps), a bar with a tick at the
 * minimum and one line on what happens; then the actions — Share the link,
 * Lower the minimum (never on a Depends-on-numbers event: it would raise what
 * guests have already paid), Change the date, Call it off now (red). Events
 * called off in the last month show the refunds made.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { api } from '../../../api';
import { AMBER, CREAM, HAIRLINE, INK, INK_MUTED, TARGET, fonts } from '../../../theme';
import { LANES } from '../v7/model';
import { Bar, Btn, Cell, DeskSheet, Empty, Head, Loading, Page, RED, Section, hx, tx } from './kit';
import { dayWords, gbp, shortDate, type AtRisk } from './model';

type Risk = AtRisk['atRisk'][number];

const plain = (e: unknown, fallback: string) => {
  const m = e instanceof Error ? e.message : '';
  return !m || /^HTTP \d+/.test(m) ? fallback : m;
};
/** "20 Sep" from 'YYYY-MM-DD'. */
const dayMonth = (ymd: string) => shortDate(ymd);

export function DeskAtRisk() {
  const { navigate, back } = useRouter();
  const [data, setData] = useState<AtRisk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lowering, setLowering] = useState<Risk | null>(null);
  const [calling, setCalling] = useState<Risk | null>(null);
  const load = useCallback(() => {
    api.deskAtRisk().then((d) => { setData(d); setError(null); }).catch((e) => setError(plain(e, 'At risk could not be loaded. Try again in a moment.')));
  }, []);
  useEffect(load, [load]);

  const head = <Head back="Host" onBack={() => back(paths.host())} title="At risk" />;
  if (!data) return <Page>{head}<Loading error={error} /></Page>;

  return (
    <Page>
      {head}
      {data.atRisk.length === 0 && data.calledOff.length === 0 ? <Section><Empty>Nothing at risk.</Empty></Section> : null}

      {data.atRisk.map((r) => (
        <View key={`${r.offerId}-${r.sessionId}`} style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          <View style={{ backgroundColor: AMBER, padding: 14, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <Text style={[hx(19), { flex: 1 }]}>{r.title ?? 'Your event'}</Text>
              <View style={{ backgroundColor: LANES[r.lane].bg, paddingHorizontal: 7, paddingVertical: 3 }}><Text style={tx(12, '800', LANES[r.lane].fg)}>{LANES[r.lane].tag}</Text></View>
            </View>
            <View style={{ flexDirection: 'row', gap: 3 }}>
              <Cell kicker="Booked" value={String(r.booked)} ground={CREAM} />
              <Cell kicker="Min" value={String(r.min)} ground={CREAM} />
              <Cell kicker="Decides" value={dayWords(r.decidesOn)} ground={CREAM} flex={1.5} />
            </View>
            {/* No maximum comes with an at-risk event; the scale leaves room past the minimum. */}
            <Bar value={r.booked} of={r.max ?? Math.max(r.booked, r.min)} tick={r.min} />
            <Text style={tx(13.5, '600')}>{r.line}</Text>
          </View>
          <View style={{ marginTop: 14, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
            <Action label="Share the link" onPress={() => navigate(paths.hostEvent(r.offerId, { sheet: 'share' }))} />
            {r.byNumbers ? null : <Action label="Lower the minimum" onPress={() => setLowering(r)} />}
            <Action label="Change the date" onPress={() => navigate(paths.hostEvent(r.offerId, { session: r.sessionId, sheet: 'dates' }))} />
            <Action label="Call it off now" red onPress={() => setCalling(r)} />
          </View>
        </View>
      ))}

      {data.calledOff.length ? (
        <Section title="Called off">
          {data.calledOff.map((c) => {
            const heads = c.booked ?? c.refunds.reduce((n, x) => n + x.heads, 0);
            return (
              <View key={`${c.offerId}-${c.on}`} style={{ gap: 2 }}>
                <Text style={tx(15.5, '800')}>{c.title ?? 'Your event'}</Text>
                <Text style={tx(13, '400', INK_MUTED)}>Called off {dayMonth(c.on)}{heads ? ` · ${heads}${c.max ? ` of ${c.max}` : ''} booked` : ''}</Text>
                <View style={{ marginTop: 10, borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
                  {c.refunds.map((x, i) => (
                    <Line key={`${x.household}-${i}`} left={`${x.household} · ${x.heads}`} right={`${gbp(x.pence)} refunded`} />
                  ))}
                  <Line left="Refunded" right={`${gbp(c.totalPence)} · ${dayMonth(c.on)}`} />
                </View>
              </View>
            );
          })}
        </Section>
      ) : null}

      {lowering ? <LowerSheet r={lowering} onClose={() => setLowering(null)} onDone={() => { setLowering(null); load(); }} /> : null}
      {calling ? <CallOffSheet r={calling} onClose={() => setCalling(null)} onDone={() => { setCalling(null); load(); }} /> : null}
    </Page>
  );
}

function Action({ label, onPress, red }: { label: string; onPress: () => void; red?: boolean }) {
  return (
    <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TARGET, paddingVertical: 12, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
      <Text style={tx(15.5, '800', red ? RED : INK)}>{label}</Text>
      <Icon name="more" size={16} color={INK} />
    </Press>
  );
}

function Line({ left, right }: { left: string; right: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
      <Text style={[tx(14, '400', INK_MUTED), { flex: 1 }]}>{left}</Text>
      <Text style={tx(14, '800')}>{right}</Text>
    </View>
  );
}

function LowerSheet({ r, onClose, onDone }: { r: Risk; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(String(Math.max(1, r.min - 1)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(text);
  const ok = /^\d+$/.test(text) && n >= 1 && n < r.min;
  const save = () => {
    if (!ok || busy) return;
    setBusy(true); setError(null);
    api.deskLowerMinimum(r.offerId, n)
      .then(onDone)
      .catch((e) => { setBusy(false); setError(plain(e, 'The minimum could not be changed. Try again in a moment.')); });
  };
  return (
    <DeskSheet title="Lower the minimum" onClose={onClose}
      footer={<Btn label={busy ? 'Saving…' : 'Lower the minimum'} onPress={save} disabled={!ok || busy} />}>
      <Text style={tx(15.5, '800')}>{r.title ?? 'Your event'}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TextInput value={text} onChangeText={(t) => setText(t.replace(/\D/g, '').slice(0, 3))} onSubmitEditing={save}
          keyboardType="number-pad" inputMode="numeric" accessibilityLabel="New minimum" selectTextOnFocus
          style={{ width: 72, height: TARGET, borderWidth: 1, borderColor: INK, backgroundColor: CREAM, paddingHorizontal: 10, fontFamily: fonts.body, fontSize: 18, fontWeight: '800', color: INK, textAlign: 'center' }} />
        <Text style={tx(14, '400', INK_MUTED)}>was {r.min} · {r.booked} booked</Text>
      </View>
      {error ? <Text style={tx(13.5, '600')}>{error}</Text> : null}
    </DeskSheet>
  );
}

function CallOffSheet({ r, onClose, onDone }: { r: Risk; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    if (busy) return;
    setBusy(true); setError(null);
    const body = r.lane === 'weekly' ? { sessionIds: [r.sessionId], reason: 'numbers' as const } : { reason: 'numbers' as const };
    api.laneCancel(r.offerId, body)
      .then(onDone)
      .catch((e) => { setBusy(false); setError(plain(e, 'It could not be called off. Try again in a moment.')); });
  };
  return (
    <DeskSheet title="Call it off now" onClose={onClose}
      footer={<>
        <Btn label={busy ? 'Calling it off…' : 'Call it off'} kind="red" onPress={go} disabled={busy} />
        <Btn label="Keep it on" kind="grey" onPress={onClose} />
      </>}>
      <Text style={tx(15.5, '800')}>{r.title ?? 'Your event'}</Text>
      <Text style={tx(14, '400')}>Everyone booked gets a full refund and is told now</Text>
      {error ? <Text style={tx(13.5, '600')}>{error}</Text> : null}
    </DeskSheet>
  );
}
