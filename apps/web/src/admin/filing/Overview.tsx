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
 *
 * **It has a phone layout** (owner, 25 Sep 2026: at 390px "the whole
 * Overview overflows the frame"). The four queues go two by two, the runs
 * wrap onto two lines each, the thresholds drop under the runs, and the two
 * check lines wrap their sentence with the mark still on the end. One tree in
 * both layouts: the width decides style, never which children render.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { Press } from '../../components/press';
import { useViewport } from '../../hooks/useViewport';
import { desk, fonts, LIME } from '../../theme';
import { Act, Band, Kicker, Mark, Value, WARN, tabular } from './desk';
import type { FilingOverview, Threshold } from '../../api';

/** The shell's phone breakpoint, the same one the desk's Band uses. */
const PHONE = 900;

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
  const narrow = useViewport().width < PHONE;
  return (
    <>
      <Band
        title={`${data.waiting.toLocaleString()} ${data.waiting === 1 ? 'thing waits' : 'things wait'} on a human`}
        right={(
          <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: desk.inkDim, flexShrink: 1 }}>
            {scope(data)}
          </Text>
        )}
      />

      {/* Four up, hairline gaps, no radius and no box — the grid's own
          background shows through as the rule between the cards. Two by two
          on a phone: four across at 390 is four columns of nothing. */}
      <View style={{
        flexDirection: 'row',
        flexWrap: narrow ? 'wrap' : 'nowrap',
        gap: 1,
        backgroundColor: desk.rule,
        borderWidth: 1,
        borderColor: desk.rule,
      }}>
        {data.queues.map((q) => (
          <Press key={`${q.kicker}-${q.what}`} effect="none" onPress={() => onGo(q.go)}
                 accessibilityRole="button"
                 style={narrow ? { flexGrow: 1, flexBasis: '48%' } : { flex: 1 }}>
            <View style={{
              flex: 1,
              backgroundColor: desk.ground,
              paddingHorizontal: narrow ? 14 : 20,
              paddingTop: narrow ? 14 : 18,
              paddingBottom: narrow ? 16 : 20,
              gap: narrow ? 6 : 9,
              minHeight: narrow ? 150 : 172,
            }}>
              <Kicker>{q.kicker}</Kicker>
              <Text style={{
                fontFamily: fonts.heading,
                fontSize: narrow ? 34 : 44,
                fontWeight: '800',
                letterSpacing: narrow ? -1.36 : -1.76,
                lineHeight: narrow ? 34 : 44,
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

      <Checks data={data} />

      <View style={{
        flexDirection: narrow ? 'column' : 'row',
        gap: narrow ? 28 : 40,
        alignItems: narrow ? 'stretch' : 'flex-start',
        borderTopWidth: 2,
        borderTopColor: desk.ruleStrong,
        paddingTop: 20,
      }}>
        <View style={{ flex: narrow ? undefined : 1, minWidth: 0, gap: 12 }}>
          <Kicker>WHAT THE MACHINE DID WHILE YOU WERE OUT</Kicker>
          <View>
            {data.runs.length === 0 ? (
              <Text style={{ fontFamily: fonts.body, fontSize: 13, color: desk.inkDim, paddingVertical: 11 }}>
                Nothing has run yet.
              </Text>
            ) : data.runs.map((r) => (
              /* Four columns on a desk; two lines on a phone — the name and
                 when it ran, then what it did and what it cost. */
              <View key={r.id} style={{
                flexDirection: 'row',
                flexWrap: narrow ? 'wrap' : 'nowrap',
                alignItems: 'center',
                gap: narrow ? 10 : 16,
                rowGap: narrow ? 3 : 0,
                paddingVertical: 11,
                borderBottomWidth: 1,
                borderBottomColor: desk.rule,
              }}>
                <View style={narrow ? { flexGrow: 1, flexBasis: '55%', minWidth: 0 } : { width: 220, flexGrow: 0, flexShrink: 0 }}>
                  <Value weight="700">{r.name}</Value>
                </View>
                <View style={narrow ? { flexGrow: 0, flexShrink: 0 } : { width: 120, flexGrow: 0, flexShrink: 0 }}>
                  <Value tone="dim" size={12.5}>{when(r.at)}</Value>
                </View>
                <View style={narrow ? { flexGrow: 1, flexBasis: '70%', minWidth: 0 } : { flex: 1, minWidth: 0 }}>
                  <Value tone="muted" size={12.5}>{line(r)}</Value>
                </View>
                <View style={{ width: narrow ? undefined : 80, flexGrow: narrow ? 1 : 0, flexShrink: 0, alignItems: 'flex-end' }}>
                  <Value weight="700" numeric>{money(r.cost)}</Value>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={{
          width: narrow ? undefined : 520,
          flexGrow: 0,
          flexShrink: 0,
          gap: 12,
          borderLeftWidth: narrow ? 0 : 1,
          borderLeftColor: desk.rule,
          borderTopWidth: narrow ? 1 : 0,
          borderTopColor: desk.rule,
          paddingLeft: narrow ? 0 : 30,
          paddingTop: narrow ? 20 : 0,
        }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Kicker>THRESHOLDS</Kicker>
            <Text style={{ fontFamily: fonts.body, fontSize: 11.5, fontWeight: '700', color: WARN, flexShrink: 1 }}>
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

/**
 * One line with a rule down its left and a mark on its end.
 *
 * Both check lines are this, so they wrap the same way: the sentence shrinks
 * and wraps inside the frame and the mark stays on the end of it, rather
 * than the sentence running under the mark and off the edge.
 */
function Line({ colour, children, mark }: { colour: string; children: React.ReactNode; mark: React.ReactNode }) {
  return (
    <View style={{
      flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 4,
      borderLeftWidth: 2, borderLeftColor: colour, paddingLeft: 14, paddingVertical: 2,
    }}>
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: '700', color: colour, flexShrink: 1 }}>
        {children}
      </Text>
      {mark}
    </View>
  );
}

/**
 * The bar invariants: when they last ran, and what they found.
 *
 * One line. Three states, and the first two must not look alike: never run,
 * ran and found nothing, ran and found something. "A silent pass and a run that
 * never happened must not look the same" (owner, 24 Sep 2026). The reasoning
 * is behind the mark, as the house rule requires.
 */
function Checks({ data }: { data: FilingOverview }) {
  const r = data.invariants?.last ?? null;
  if (!r) {
    return (
      <Line colour={WARN} mark={(
        <Mark label="WHY" tone="warn"
              title={'Three invariants run at every deploy and once a day: no active drawer without a bar, no drawer '
                + 'whose places were never judged against its bar, and no rule left pointing at a retired drawer. '
                + 'Until the first run there is no record, and no record is not the same as a clean one.'} />
      )}>
        The bar checks have never run
      </Line>
    );
  }
  const orphans = r.orphans ?? [];
  const found = r.bare.length + r.unjudged.length + orphans.length;
  // An orphaned rule is never repaired by the check, so it is a warning until somebody decides where it goes.
  const tone: 'warn' | 'lime' | 'dim' = r.error || r.left.length || (r.stillBare ?? []).length || orphans.length ? 'warn' : found ? 'lime' : 'dim';
  const colour = tone === 'warn' ? WARN : tone === 'lime' ? LIME : desk.inkDim;
  const said = r.error
    ? `failed — ${r.error}`
    : found === 0
      ? 'nothing found'
      : [
        r.bare.length ? `${r.bare.length} drawer${r.bare.length === 1 ? '' : 's'} with no bar, ${(r.inherited ?? []).length} given one` : null,
        r.unjudged.length ? `${r.unjudged.length} unjudged, ${r.rescored.toLocaleString()} places rescored` : null,
        (r.stillBare ?? []).length ? `${r.stillBare.length} still with no bar` : null,
        r.left.length ? `${r.left.length} still unjudged` : null,
        orphans.length ? `${orphans.length} orphaned rule${orphans.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ');
  const detail = [
    ...r.bare.map((k) => `${(r.inherited ?? []).includes(k) ? 'given a bar' : 'no bar'}: ${k}`),
    ...r.unjudged.map((d) => `unjudged: ${d.key} (${d.places} places)`),
    ...r.left.map((k) => `still unjudged: ${k}`),
    ...orphans.map((o) => `orphaned rule: ${o.scope}:${o.subject} → ${o.subcategory ?? 'nothing'}`),
  ];
  return (
    <Line colour={colour} mark={(
      <Mark label={detail.length ? 'WHAT' : 'WHY'} tone={tone === 'dim' ? 'dim' : tone}
            title={detail.length
              ? detail.join('\n')
              : 'Every active drawer has a bar, every drawer with places has at least one judged against it, and no '
                + 'rule points at a retired drawer. This is a pass, not an absence: the check ran and looked.'} />
    )}>
      Bar checks ran {when(r.ranAt)} ({r.trigger}) — {said}
    </Line>
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
  /*
   * One line, not a paragraph.
   *
   * "No prose on screen. No commentary captions. If something needs explaining
   * it goes behind an information icon" — the handoff's own rule, which the
   * first version of this broke with three lines of reasoning (the
   * side-by-side audit, 21 Sep 2026). But hiding it entirely breaks the rule
   * it exists to serve: a queue at nought reads as good news unless the
   * screen says it could not look. So the fact is one line, attached to the
   * numbers it qualifies, and the reasoning is behind the icon.
   */
  return (
    <Line colour={WARN} mark={(
      <Mark
        label="WHY"
        tone="warn"
        title={'Nothing here can tell a mapping nobody wants from one nobody has been offered, so a word '
          + 'bringing in places that have never been opened is not yet evidence of anything. The same floor '
          + "governs the audit's nobody-goes signal, the Mapping table's never-opened colour and this number."}
      />
    )}>
      Demand cannot be read yet — {u.why}
    </Line>
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
