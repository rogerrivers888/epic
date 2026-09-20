/**
 * The front door: what to do on a Tuesday.
 *
 * Four queues, what the machine did while you were out, and the six numbers
 * every other screen judges by. The title counts things that wait on a
 * *person* — the machine has done what it can and these are the decisions
 * left — so a queue at nought is drawn grey rather than hidden, because
 * "nothing waiting" is worth seeing.
 *
 * Two things here are deliberately not the cheerful reading:
 *
 *   - **The thresholds say they are provisional, in red.** They were set on
 *     one district of hand-written data. The handoff is explicit that the
 *     screen should say so, and it keeps saying so until somebody has moved
 *     them against real coverage.
 *   - **A queue at nought can mean "I could not see".** An audit that found
 *     nothing is not a clean taxonomy, and the demand signal cannot speak at
 *     all until the corpus has opens. Where that is why a number is nought,
 *     the screen says it in words rather than letting the nought read as good
 *     news.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../components/press';
import { desk, fonts, LIME } from '../../theme';
import { Act, Band, DeskSection, Kicker, Value, WARN, tabular } from './desk';
import type { FilingOverview, Threshold } from '../../api';

/** A time said the way a person would say it. */
function when(iso: string | null): string {
  if (!iso) return '—';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 8) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const money = (usd: number) => (usd ? `£${usd.toFixed(2)}` : '£0.00');

export function Overview({ data, onGo, canManage, onThreshold }: {
  data: FilingOverview;
  onGo: (where: string) => void;
  /** Without it the thresholds are shown and not offered: they are what every
   *  other screen judges by, so a reader should still see where the lines are. */
  canManage: boolean;
  onThreshold: (key: string, value: number) => void;
}) {
  return (
    <>
      <Band
        title={`${data.waiting.toLocaleString()} ${data.waiting === 1 ? 'thing waits' : 'things wait'} on a human`}
        right={(
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim }}>
            {scope(data)}
          </Text>
        )}
      />

      {/* Four up, hairline gaps, no radius and no box — the grid's own
          background shows through as the rule between the cards. */}
      <View style={{
        flexDirection: 'row',
        gap: 1,
        backgroundColor: desk.rule,
        borderWidth: 1,
        borderColor: desk.rule,
      }}>
        {data.queues.map((q) => (
          <Press key={`${q.kicker}-${q.what}`} effect="none" onPress={() => onGo(q.go)}
                 accessibilityRole="button" style={{ flex: 1 }}>
            <View style={{
              flex: 1,
              backgroundColor: desk.ground,
              paddingHorizontal: 20,
              paddingTop: 18,
              paddingBottom: 20,
              gap: 9,
              minHeight: 172,
            }}>
              <Kicker>{q.kicker}</Kicker>
              <Text style={{
                fontFamily: fonts.heading,
                fontSize: 44,
                fontWeight: '800',
                letterSpacing: -1.76,
                lineHeight: 44,
                color: q.count === 0 ? desk.inkDim : q.tone === 'warn' ? WARN : LIME,
                ...tabular,
              }}>
                {q.count.toLocaleString()}
              </Text>
              <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: desk.ink }}>
                {q.what}
              </Text>
              <View style={{ marginTop: 'auto' }}>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>{q.where}</Text>
              </View>
            </View>
          </Press>
        ))}
      </View>

      <BlindNote data={data} />

      <View style={{
        flexDirection: 'row',
        gap: 40,
        alignItems: 'flex-start',
        borderTopWidth: 2,
        borderTopColor: desk.ruleStrong,
        paddingTop: 20,
      }}>
        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <Kicker>WHAT THE MACHINE DID WHILE YOU WERE OUT</Kicker>
          <View>
            {data.runs.length === 0 ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim, paddingVertical: 11 }}>
                Nothing has run yet.
              </Text>
            ) : data.runs.map((r) => (
              <View key={r.id} style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                paddingVertical: 11,
                borderBottomWidth: 1,
                borderBottomColor: desk.rule,
              }}>
                <View style={{ width: 220, flexGrow: 0, flexShrink: 0 }}>
                  <Value weight="700">{r.name}</Value>
                </View>
                <View style={{ width: 120, flexGrow: 0, flexShrink: 0 }}>
                  <Value tone="dim" size={12.5}>{when(r.at)}</Value>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Value tone="muted" size={12.5}>{line(r)}</Value>
                </View>
                <View style={{ width: 80, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
                  <Value weight="700" numeric>{money(r.cost)}</Value>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={{
          width: 520,
          flexGrow: 0,
          flexShrink: 0,
          gap: 12,
          borderLeftWidth: 1,
          borderLeftColor: desk.rule,
          paddingLeft: 30,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Kicker>THRESHOLDS</Kicker>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '700', color: WARN }}>
              provisional · set on one district, revisit after the census
            </Text>
          </View>
          <View>
            {data.thresholds.map((t) => (
              <Stepper key={t.key} t={t} canManage={canManage} onChange={onThreshold} />
            ))}
          </View>
        </View>
      </View>
    </>
  );
}

/** Where the numbers come from, said plainly. */
function scope(data: FilingOverview): string {
  const n = data.unengaged.impressions;
  if (!n) return 'nothing has been shown to a household yet';
  return `${n.toLocaleString()} things shown to a household so far`;
}

/** "63 words raised · 24 validated · 620 places read", with the empty clauses gone. */
function line(r: FilingOverview['runs'][number]): string {
  const bits: string[] = [];
  if (r.words) bits.push(`${r.words.toLocaleString()} words raised`);
  bits.push(`${r.places.toLocaleString()} places read`);
  if (r.state && r.state !== 'done') bits.push(r.state);
  return bits.join(' · ');
}

/**
 * What the screen could not see.
 *
 * Drawn only when it changes how the numbers above should be read. A nought
 * that means "nothing to do" and a nought that means "I could not look" are
 * different, and the second one is the dangerous one to leave unsaid.
 */
function BlindNote({ data }: { data: FilingOverview }) {
  const u = data.unengaged;
  const blind = u.share === null && u.why;
  if (!blind) return null;
  return (
    <View style={{ borderLeftWidth: 2, borderLeftColor: WARN, paddingLeft: 14, paddingVertical: 4, gap: 4 }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: WARN }}>
        Demand cannot be read yet
      </Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkMuted, lineHeight: 19 }}>
        {u.why}. Until it can, nothing here can tell a mapping nobody wants from one nobody has been
        offered — so a word bringing in places that have never been opened is not yet evidence of
        anything.
      </Text>
    </View>
  );
}

/**
 * A number, and the two ways to move it.
 *
 * Typed into a box would be the house rule for a number (owner, "never a
 * plus/minus on a number"), but these are the exception the drawing makes and
 * makes deliberately: they are shares as often as counts, they are nudged
 * rather than chosen, and the step is a property of the threshold rather than
 * of the person. The value is still shown in the box, so it reads as a number
 * and not as a slider.
 */
function Stepper({ t, canManage, onChange }: {
  t: Threshold; canManage: boolean; onChange: (key: string, value: number) => void;
}) {
  const move = (by: number) => {
    const next = Math.round((t.value + by) * 100) / 100;
    const lo = t.min ?? Number.NEGATIVE_INFINITY;
    const hi = t.max ?? Number.POSITIVE_INFINITY;
    onChange(t.key, Math.min(hi, Math.max(lo, next)));
  };
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: desk.rule,
    }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '600', color: desk.ink }}>
          {t.label}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 11, color: desk.inkDim, marginTop: 2 }}>{t.why}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 0, flexShrink: 0 }}>
        {canManage ? <Act label="−" tone="dim" ruled={false} onPress={() => move(-t.step)} /> : null}
        <View style={{
          width: 58,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: t.changed ? LIME : desk.ruleStrong,
          paddingVertical: 5,
          paddingHorizontal: 4,
        }}>
          <Text style={{
            fontFamily: fonts.heading,
            fontSize: 13.5,
            fontWeight: '800',
            color: LIME,
            ...tabular,
          }}>
            {t.value}
          </Text>
        </View>
        {canManage ? <Act label="+" tone="dim" ruled={false} onPress={() => move(t.step)} /> : null}
      </View>
    </View>
  );
}
