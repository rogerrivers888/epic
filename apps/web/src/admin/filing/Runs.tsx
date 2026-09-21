/**
 * Runs — the only screen that answers "is this working?"
 *
 * Three questions, and none of them is answerable from a list of runs with a
 * cost beside each (which is what this replaces):
 *
 *  1. **Where does the volume die?** A harvest reads 620 places, raises 1,480
 *     raw phrases, and 24 reach a person. Every one of those steps can be the
 *     broken one, and a single "63 words" tells you nothing about which.
 *  2. **Is the queue growing?** A backlog total looks identical whether you are
 *     slowly catching up or slowly losing. Raised against decided, per week,
 *     is the only shape that separates them.
 *  3. **What has been decided?** Which is the Decision log, below.
 *
 * It has to be readable cold, so every number carries its own scope in words
 * rather than relying on a column header, and the diagnosis of a bad drop is
 * written out — "the resolver is not collapsing" — rather than left as a shape
 * for somebody to interpret.
 */

import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Press } from '../../components/press';
import { LIME, ON_LIME, desk, fonts } from '../../theme';
import { Act, Band, Cell, Col, Head, Kicker, Nothing, Row, Value, WARN, tabular } from './desk';
import type { Decision, RunRow, Saturation, Trail, Trigger, RunWeek } from './types';

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** The tallest a funnel bar or a week column is drawn. */
const BAR = 104;

/**
 * A time the way a person says it.
 *
 * Shared with the Overview's run list on purpose: two screens describing the
 * same run as "2 hours ago" and "20 Sept" would look like two different runs.
 */
function when(iso: string | null): string {
  if (!iso) return '\u2014';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 8) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function Runs({
  headline, scope, triggers, live, runs, weeks, clears, saturation,
  onTrigger, onStop, onOpenStage, stage, onStage,
}: {
  /** "The queue grew by 43 last week", or "You are 12 ahead of the harvest". */
  headline: string;
  /** "Berkshire · 105 places loaded · harvests read beyond it". */
  scope: string;
  triggers: Trigger[];
  /** The run in flight, if there is one. Runs take hours; this is not optional. */
  live: { name: string; scope: string; funnel: { name: string; count: number; done: boolean }[] } | null;
  runs: RunRow[];
  weeks: RunWeek[];
  /**
   * Whether deciding outruns raising, said plainly. A single backlog total
   * cannot say this, which is the whole reason the chart is here.
   */
  clears: { says: string; note: string; ever: boolean };
  saturation: Saturation[];
  onTrigger: (key: Trigger['key']) => void;
  onStop: () => void;
  onOpenStage: (runId: string, stageKey: string) => void;
  /**
   * Which stage of which run is open, and what is in it.
   *
   * `count` is null where the stage cannot be listed and the run did not
   * record it — unknown, not nought. And `exact: false` means the list is a
   * subset: on a repeat run the funnel counts every word that passed through
   * while the list holds only the ones that run raised for the first time.
   * `listNote` carries that sentence and has to be drawn, or a shorter list
   * than the count reads as a shortfall (epic-f4, 21 Sep 2026).
   */
  stage: {
    runId: string; key: string; name: string; note: string;
    items: string[]; subs: string;
    count: number | null; listed: number; more: number;
    recorded: boolean; exact: boolean; listNote: string | null;
  } | null;
  onStage: (runId: string | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const mostRaised = Math.max(1, ...weeks.map((w) => Math.max(w.raised, w.decided)));

  return (
    <>
      <Band title={headline} right={<Value tone="dim" size={12.5}>{scope}</Value>} />

      {/*
        Before it runs. A run is minutes of attention and a crawl against other
        people's sites; both get stated up front, with the money, so nobody
        starts one to see what happens.
      */}
      <View style={{
        flexDirection: 'row', gap: 1, backgroundColor: desk.rule,
        borderWidth: 1, borderColor: desk.rule,
      }}>
        {triggers.map((t) => (
          <View key={t.key} style={{ flex: 1, backgroundColor: desk.ground, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 18, gap: 9 }}>
            <Kicker>Before it runs</Kicker>
            <Value size={14.5} weight="800">{t.name}</Value>
            <Value size={12.5} tone="muted">{t.scope}</Value>
            <Value size={12} tone="dim">{t.sources}{t.rate ? ` · ${t.rate}` : ''}</Value>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 }}>
              <Press effect="sink" onPress={() => onTrigger(t.key)} accessibilityRole="button">
                <View style={{
                  backgroundColor: t.cost === '£0.00' ? LIME : 'transparent',
                  borderWidth: 1.5, borderColor: LIME,
                  paddingVertical: 10, paddingHorizontal: 16,
                }}>
                  <Text style={{
                    fontFamily: fonts.body, fontSize: 13, fontWeight: '700',
                    color: t.cost === '£0.00' ? ON_LIME : LIME,
                  }}>
                    {t.action}
                  </Text>
                </View>
              </Press>
              {/* The price before the click, every time. */}
              <Value size={12.5} weight="700" tone={t.cost === '£0.00' ? 'dim' : 'ink'}>{t.cost}</Value>
            </View>
          </View>
        ))}
      </View>

      {live ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: LIME, paddingLeft: 16, paddingTop: 12, paddingBottom: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <Value size={14} weight="800">{live.name}</Value>
            <Value size={12.5} tone="dim">{live.scope}</Value>
            <View style={{ flex: 1 }} />
            <Act label="Stop it" tone="warn" onPress={onStop} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
            {live.funnel.map((s) => (
              <View key={s.name} style={{ minWidth: 96, gap: 5 }}>
                <Text style={{
                  fontFamily: fonts.heading, fontSize: 17, fontWeight: '800',
                  color: s.done ? LIME : desk.inkDim, ...tabular,
                }}>
                  {s.done && s.count != null ? s.count.toLocaleString() : '\u2014'}
                </Text>
                <Value size={11} tone="dim">{s.name}</Value>
                <View style={{ height: 3, backgroundColor: s.done ? LIME : desk.rule }} />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 11 }}>
        <Kicker>Runs · where the volume dies</Kicker>
        <View>
          {runs.length === 0 ? <Nothing>Nothing has run yet.</Nothing> : null}
          {runs.map((r) => {
            const isOpen = open === r.id;
            return (
              <View key={r.id} style={{
                borderBottomWidth: 1, borderBottomColor: desk.rule,
                backgroundColor: isOpen ? desk.lifted : 'transparent',
              }}>
                <Press effect="none" accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                  onPress={() => { const next = isOpen ? null : r.id; setOpen(next); onStage(next); }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 18, paddingVertical: 13, paddingHorizontal: 8 }}>
                    <View style={{ width: 250, flexGrow: 0, flexShrink: 0, minWidth: 0 }}>
                      <Value weight="700">{r.name}</Value>
                      <View style={{ marginTop: 3 }}>
                        {/* Relative, not an ISO string. "2026-09-20T16:03:16.352Z"
                            is a timestamp somebody has to decode; the handoff
                            asks for the time a person would say. */}
                        <Value size={11.5} tone="dim">{`${when(r.at)} · ${r.scope}`}</Value>
                      </View>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-end', gap: 7 }}>
                      {r.funnel.map((s) => (
                        // The worst drop is enlarged, reddened and thick-ruled.
                        // At most one stage per run carries it, so the eye
                        // lands on the broken step and not on the biggest
                        // number, which is always "places read".
                        <View key={s.key} style={{ flex: 1, minWidth: 0, gap: 4 }}>
                          <Text style={{
                            fontFamily: fonts.heading,
                            fontSize: s.bad ? 19 : 14,
                            fontWeight: '800',
                            lineHeight: s.bad ? 21 : 16,
                            color: s.bad ? WARN : s.key === 'waiting' ? LIME : desk.ink,
                            ...tabular,
                          }}>
                            {/*
                              A stage a run never wrote down has an *unknown*
                              count, not a count of nought. Every run from
                              before the funnel was recorded is in that state,
                              and `.toLocaleString()` on it took the whole
                              screen down (21 Sep 2026).
                            */}
                            {s.count == null ? '\u2014' : s.count.toLocaleString()}
                          </Text>
                          <Text style={{
                            fontFamily: fonts.body, fontSize: 10.5, lineHeight: 13,
                            color: s.bad ? WARN : desk.inkDim,
                          }}>
                            {s.name}
                          </Text>
                          <View style={{
                            height: s.bad ? 3 : 1,
                            backgroundColor: s.bad ? WARN : s.key === 'waiting' ? LIME : desk.rule,
                          }} />
                        </View>
                      ))}
                    </View>
                    <View style={{ width: 210, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
                      {/*
                        Three readings, not two. A run that did not write its
                        middle down is neither healthy nor broken — it is
                        unknown, and drawing it in the same dim as "drop-off
                        looks normal" would claim something nobody measured
                        (epic-f4, 21 Sep 2026).
                      */}
                      <Value size={12.5} weight={r.recorded ? '700' : '500'}
                             tone={!r.recorded ? 'faint' : r.healthy ? 'dim' : 'warn'}>
                        {r.diagnosis}
                      </Value>
                      <View style={{ marginTop: 3 }}>
                        <Value size={12} tone="dim">
                          {`${r.cost ? `£${r.cost.toFixed(2)}` : '£0.00'} · ${r.sources}`}
                        </Value>
                      </View>
                    </View>
                  </View>
                </Press>

                {isOpen ? (
                  <View style={{ gap: 10, paddingLeft: 268, paddingRight: 8, paddingBottom: 18, paddingTop: 2 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
                      {r.funnel.map((s) => {
                        const on = stage?.runId === r.id && stage.key === s.key;
                        return (
                          <Act key={s.key} label={s.name} tone={on ? 'ink' : 'dim'} ruled={on}
                            onPress={() => onOpenStage(r.id, s.key)} />
                        );
                      })}
                    </View>
                    {r.curves?.length ? (
                      <View style={{ gap: 6, paddingTop: 4 }}>
                        <Kicker>SATURATION, PER DRAWER · WORST FIRST</Kicker>
                        {r.curves.slice(0, 8).map((c) => (
                          <View key={c.subcategory} style={{
                            flexDirection: 'row', alignItems: 'baseline', gap: 14,
                            paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: desk.rule,
                          }}>
                            <View style={{ width: 200, flexGrow: 0, flexShrink: 0 }}>
                              <Value size={12.5} weight="600">{c.subcategory}</Value>
                            </View>
                            <View style={{ width: 90, flexGrow: 0, flexShrink: 0 }}>
                              <Value size={12.5} numeric tone="dim">{c.sampled} read</Value>
                            </View>
                            <View style={{ width: 110, flexGrow: 0, flexShrink: 0 }}>
                              <Value size={12.5} numeric>{c.newWordsPerTen} per ten</Value>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              {/*
                                Three verdicts, not two. A drawer that taught
                                nothing *because there was nothing to read* is
                                the one that most needs the next pass — and it
                                looks identical to a finished one unless it is
                                said (epic-f4, 21 Sep 2026).
                              */}
                              <Value size={12} tone={c.nothingToRead ? 'warn' : c.settled ? 'dim' : 'ink'}>
                                {c.nothingToRead
                                  ? 'nothing to read about these — the next pass needs somewhere else to look'
                                  : c.settled ? 'settled' : 'still producing words · read more'}
                              </Value>
                            </View>
                          </View>
                        ))}
                        {r.curves.length > 8 ? (
                          <Value size={12} tone="dim">and {r.curves.length - 8} more drawers</Value>
                        ) : null}
                      </View>
                    ) : null}

                    {stage?.runId === r.id ? (
                      <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                          <Kicker>{stage.name}</Kicker>
                          {/* Unknown is an em dash, never a nought. */}
                          <Value size={12.5} weight="800" numeric>
                            {stage.count == null ? '\u2014' : stage.count.toLocaleString()}
                          </Value>
                          <Value size={12} tone="dim">{stage.note}</Value>
                        </View>
                        {stage.listNote ? (
                          <Value size={12} tone="dim">{stage.listNote}</Value>
                        ) : null}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {stage.items.length === 0 ? (
                            <Value size={12} tone="dim">Nothing in this stage.</Value>
                          ) : null}
                          {stage.items.map((w) => (
                            <View key={w} style={{ borderWidth: 1, borderColor: desk.ruleStrong, paddingVertical: 4, paddingHorizontal: 9 }}>
                              <Value tone="muted" size={12}>{w}</Value>
                            </View>
                          ))}
                          {stage.more ? (
                            <Value size={12} tone="dim">and {stage.more.toLocaleString()} more</Value>
                          ) : null}
                        </View>
                        <Value size={12} tone="dim">{stage.subs}</Value>
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      <View style={{
        flexDirection: 'row', gap: 40, alignItems: 'flex-start',
        borderTopWidth: 2, borderTopColor: desk.ruleStrong, paddingTop: 20,
      }}>
        <View style={{ width: 560, flexGrow: 0, flexShrink: 0, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Kicker>Raised against decided · per week</Kicker>
            <Value size={11.5} tone="dim">candidates</Value>
          </View>
          <View style={{
            flexDirection: 'row', alignItems: 'flex-end', gap: 22, height: 132,
            borderBottomWidth: 1, borderBottomColor: desk.rule, paddingBottom: 2,
          }}>
            {weeks.map((w) => (
              <View key={w.label} style={{ flex: 1, gap: 6, alignItems: 'stretch' }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: BAR }}>
                  <View style={{ flex: 1, height: Math.max(2, (w.raised / mostRaised) * BAR), backgroundColor: WARN }} />
                  <View style={{ flex: 1, height: Math.max(2, (w.decided / mostRaised) * BAR), backgroundColor: LIME }} />
                </View>
                <Value size={11} tone="dim">{w.label}</Value>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
            <Value size={11.5} weight="700" tone="warn">
              {`raised ${weeks[weeks.length - 1]?.raised ?? 0} last week`}
            </Value>
            <Value size={11.5} weight="700" tone="lime">
              {`decided ${weeks[weeks.length - 1]?.decided ?? 0} last week`}
            </Value>
          </View>
          {/*
            "At this rate the backlog never clears" is the sentence a backlog
            total cannot say, and it is the point of the chart.
          */}
          <View style={{
            borderLeftWidth: 2, borderLeftColor: clears.ever ? LIME : WARN,
            paddingLeft: 13, paddingVertical: 3,
          }}>
            <Value size={14.5} weight="800" tone={clears.ever ? 'lime' : 'warn'}>{clears.says}</Value>
            <View style={{ marginTop: 3 }}><Value size={12} tone="dim">{clears.note}</Value></View>
          </View>
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Kicker>Saturation · new words per ten places</Kicker>
            <Value size={11.5} tone="dim">with what is waiting beside it</Value>
          </View>
          <View>
            {saturation.map((s) => {
              const most = Math.max(1, ...s.trend);
              return (
                <View key={s.set} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 16,
                  paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: desk.rule,
                }}>
                  <View style={{ width: 190, flexGrow: 0, flexShrink: 0 }}>
                    <Value size={13} weight="600">{s.set}</Value>
                  </View>
                  <View style={{ width: 64, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
                    <Text style={{
                      fontFamily: fonts.heading, fontSize: 15, fontWeight: '800',
                      color: s.tone === 'settled' ? desk.inkDim : LIME, ...tabular,
                    }}>
                      {s.rate.toFixed(1)}
                    </Text>
                  </View>
                  <View style={{ width: 110, flexGrow: 0, flexShrink: 0, flexDirection: 'row', gap: 3, justifyContent: 'flex-end', alignItems: 'flex-end' }}>
                    {s.trend.map((v, i) => (
                      <View key={i} style={{
                        width: 9, height: Math.max(4, (v / most) * 40),
                        backgroundColor: v <= 1 ? desk.ruleStrong : LIME,
                      }} />
                    ))}
                  </View>
                  <View style={{ width: 110, flexGrow: 0, flexShrink: 0, alignItems: 'flex-end' }}>
                    <Value size={12.5} weight="700" tone={s.waiting ? 'lime' : 'dim'}>
                      {s.waiting ? `${s.waiting} waiting` : 'nothing waiting'}
                    </Value>
                  </View>
                  {/*
                    Three verdicts and not two. A set at 0.4 with a queue has
                    stopped growing and is *not* finished, and that used to look
                    identical to finished.
                  */}
                  <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>
                    <Value size={12} weight={s.tone === 'stuck' ? '800' : '400'}
                      tone={s.tone === 'stuck' ? 'warn' : s.tone === 'growing' ? 'muted' : 'dim'}>
                      {s.verdict}
                    </Value>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// The decision log
// ---------------------------------------------------------------------------

const LOG_COLS: Col[] = [
  { w: 250, label: 'Word' },
  { w: 250, label: 'Set' },
  { w: 'auto', label: 'Decision' },
  { w: 190, label: 'When', align: 'right' },
];

const DECISIONS: { key: Decision['decision'] | 'all'; name: string }[] = [
  { key: 'all', name: 'Everything' },
  { key: 'approved', name: 'Approved' },
  { key: 'ignored', name: 'Ignored' },
  { key: 'merged', name: 'Merged' },
  { key: 'parked', name: 'Parked' },
  { key: 'rejected', name: 'Rejected' },
  { key: 'held', name: 'Held' },
];

/**
 * The decision log.
 *
 * Every decision any screen in this section makes writes here — promoting a
 * candidate and whether it went in as a gate, ignoring one, approving into a
 * set, parking, merging, rejecting. Without it there is no answer to "what did
 * I do last Tuesday", which is the difference between traceable and auditable.
 */
export function DecisionLog({
  rows, sets, decision, onDecision, set, onSet, trailFor,
}: {
  rows: Decision[];
  sets: { key: string; name: string }[];
  decision: Decision['decision'] | 'all';
  onDecision: (d: Decision['decision'] | 'all') => void;
  set: string | 'all';
  onSet: (s: string | 'all') => void;
  /** A word's whole trail: seen → held → validated → approved → asked of n. */
  trailFor: (word: string) => Trail | null;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <Band
        title={`${rows.length} ${rows.length === 1 ? 'decision' : 'decisions'}`}
        right={<Value tone="dim" size={12.5}>newest first · every row opens that word’s trail</Value>}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Kicker>Decision</Kicker>
          {DECISIONS.map((d) => (
            <Act key={d.key} label={d.name} tone={d.key === decision ? 'ink' : 'dim'}
              ruled={d.key === decision} onPress={() => onDecision(d.key)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Kicker>Set</Kicker>
          <Act label="Every set" tone={set === 'all' ? 'ink' : 'dim'} ruled={set === 'all'}
            onPress={() => onSet('all')} />
          {sets.map((s) => (
            <Act key={s.key} label={s.name} tone={s.key === set ? 'ink' : 'dim'}
              ruled={s.key === set} onPress={() => onSet(s.key)} />
          ))}
        </View>
      </View>

      <View>
        <Head cols={LOG_COLS} />
        {rows.length === 0 ? <Nothing>Nothing has been decided yet.</Nothing> : null}
        {rows.map((d) => {
          const isOpen = open === d.id;
          const trail = isOpen ? trailFor(d.word) : null;
          return (
            <View key={d.id} style={{
              borderBottomWidth: 1, borderBottomColor: desk.rule,
              backgroundColor: isOpen ? desk.lifted : 'transparent',
            }}>
              <Press effect="none" accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                onPress={() => setOpen(isOpen ? null : d.id)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 11, paddingHorizontal: 8 }}>
                  <Cell col={LOG_COLS[0]}><Value weight="600">{d.word}</Value></Cell>
                  <Cell col={LOG_COLS[1]}><Value size={12.5} tone="dim">{d.set ?? '—'}</Value></Cell>
                  <Cell col={LOG_COLS[2]}>
                    {/* Approved is the only lime one: it is the only decision that adds something. */}
                    <Value size={13} weight="700" tone={d.decision === 'approved' ? 'lime' : d.decision === 'ignored' || d.decision === 'rejected' ? 'dim' : 'ink'}>
                      {d.said}
                    </Value>
                  </Cell>
                  <Cell col={LOG_COLS[3]}><Value size={12.5} tone="dim">{d.at}</Value></Cell>
                </View>
              </Press>
              {isOpen && trail ? (
                <View style={{ paddingLeft: 268, paddingRight: 8, paddingBottom: 16 }}>
                  {trail.steps.map((s, i) => {
                    const last = i === trail.steps.length - 1;
                    return (
                      <View key={i} style={{
                        flexDirection: 'row', alignItems: 'flex-start', gap: 16,
                        paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: desk.rule,
                      }}>
                        <View style={{ width: 66, flexGrow: 0, flexShrink: 0 }}>
                          <Value size={12.5} weight="700" tone={last ? 'lime' : 'dim'}>{s.when}</Value>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Value size={12.5} tone={last ? 'ink' : 'muted'}>{s.what}</Value>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </>
  );
}
