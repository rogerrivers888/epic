/**
 * Runs — reached from the corner "Runs" link and Overview's "Recent runs and
 * spend →", never a tab (prototype blocks `isRuns` and `isLog`).
 *
 * The same two views the old filing desk had — Runs (where the volume dies,
 * raised against decided, saturation) and the Decision log — drawn by
 * `../filing/Runs.tsx` from `/api/admin/filing/runs` and `/decisions`. What
 * is gone is every control that starts or stops a job: design README v2,
 * "Humans decide; the machine runs itself. There are no buttons that start
 * jobs." So no triggers and no Stop are passed, and the kit draws neither.
 *
 * Address: `?tab=runs`, `&view=log` for the Decision log, `&state=` the
 * decision filter and `&key=` the set filter there.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../../api';
import { DecisionLog, Runs } from '../filing/Runs';
import type { Decision, Trail } from '../filing/types';
import { useCrumbs, useDeskGo, useDeskParam } from './Desk';
import { AMBER, LIME, Muted, RED, Seg, deskApi, desk, fonts, saidOf, tabular, useToast } from './kit';

/** The Overview's Spend tile, from the same endpoint's numbers (`/overview/spend`). */
type Spend = {
  tone: 'green' | 'amber' | 'red'; title: string; line: string;
  google: { spent: number; budget: number }; claude: { spent: number; budget: number };
};
const SPEND_TONE = { green: LIME, amber: AMBER, red: RED } as const;

type RunsData = Awaited<ReturnType<typeof api.adminFilingRuns>>;
type DecisionsData = Awaited<ReturnType<typeof api.adminFilingDecisions>>;
type StageData = Awaited<ReturnType<typeof api.adminFilingStage>> & { runId: string };

const DECISION_KEYS: Decision['decision'][] = ['approved', 'ignored', 'merged', 'parked', 'rejected', 'held'];

export function RunsScreen() {
  const go = useDeskGo();
  const toast = useToast();
  const [view, setView] = useDeskParam('view');
  const [stateRaw, setDecision] = useDeskParam('state');
  const [setRaw, setSet] = useDeskParam('key');
  const log = view === 'log';
  const decision: Decision['decision'] | 'all' = (DECISION_KEYS as string[]).includes(stateRaw) ? stateRaw as Decision['decision'] : 'all';
  const decisionSet = setRaw || 'all';

  const [runs, setRuns] = useState<RunsData | null>(null);
  const [decisions, setDecisions] = useState<DecisionsData | null>(null);
  const [stage, setStage] = useState<StageData | null>(null);
  const [trails, setTrails] = useState<Record<string, Trail>>({});
  const [error, setError] = useState<string | null>(null);
  // The month's spend heads the page: Overview's Spend tile and its "Recent
  // runs and spend →" both land here (second audit CH.4). Unknown stays "—".
  const [spend, setSpend] = useState<Spend | null>(null);
  const [spendSaid, setSpendSaid] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  useCrumbs(log ? [{ name: 'Runs', go: () => go('runs') }, { name: 'Decision log' }] : [], [log]);

  useEffect(() => {
    let live = true;
    api.adminFilingRuns()
      .then((d) => { if (live) setRuns(d); })
      .catch((err) => { if (live) setError(saidOf(err) || 'The runs did not load.'); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    deskApi.get<Spend>('/overview/spend')
      .then((d) => { if (live) setSpend(d); })
      .catch((err) => { if (live) setSpendSaid(saidOf(err) || 'The spend did not load.'); });
    return () => { live = false; };
  }, []);

  // Loaded on both views: the segment's own label carries the count.
  useEffect(() => {
    let live = true;
    api.adminFilingDecisions({
      decision: decision === 'all' ? undefined : decision,
      set: decisionSet === 'all' ? undefined : decisionSet,
    })
      .then((d) => { if (live) setDecisions(d); })
      .catch((err) => { if (live) setError(saidOf(err) || 'The decision log did not load.'); });
    return () => { live = false; };
  }, [decision, decisionSet]);

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 6, borderLeftWidth: 3, borderLeftColor: spend ? SPEND_TONE[spend.tone] : desk.inkFaint, paddingLeft: 14, paddingVertical: 2 }}>
        <Text style={{ fontFamily: fonts.heading, fontSize: 10, fontWeight: '700', letterSpacing: 0.7, color: desk.inkDim }}>SPEND THIS MONTH</Text>
        <Text style={[{ fontFamily: fonts.body, fontSize: 15, fontWeight: '800', color: spend ? desk.ink : desk.inkDim }, tabular]}>
          {spend ? spend.title : '—'}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: desk.inkDim }}>{spend ? spend.line : spendSaid ?? 'Loading…'}</Text>
      </View>

      <Seg
        options={[
          { key: 'runs', name: 'Runs' },
          { key: 'log', name: `Decision log${decisions ? ` · ${decisions.decisions.length}` : ''}` },
        ]}
        value={log ? 'log' : 'runs'}
        // The Decision log is a layer (it has a crumb), so the move pushes.
        onChange={(k) => setView(k === 'log' ? 'log' : '', { replace: false })}
      />

      {error ? <Muted>{error}</Muted> : null}

      {!log ? (
        runs ? (
          <Runs
            headline={runs.headline}
            scope={runs.scope}
            live={runs.live}
            runs={runs.runs}
            weeks={runs.weeks}
            clears={runs.clears}
            saturation={runs.saturation}
            onOpenStage={(runId, key) => {
              api.adminFilingStage(runId, key)
                .then((out) => setStage({ ...out, runId }))
                .catch(() => toast('That stage did not load.'));
            }}
            stage={stage}
            // Closing a run closes whatever it had open, so a stage cannot
            // outlive the run it belongs to.
            onStage={(runId) => { if (!runId) setStage(null); }}
          />
        ) : error ? null : <Muted>Loading…</Muted>
      ) : decisions ? (
        <DecisionLog
          rows={decisions.decisions}
          sets={decisions.sets}
          decision={decision}
          onDecision={(d) => setDecision(d === 'all' ? '' : d, { replace: true })}
          set={decisionSet}
          onSet={(s) => setSet(s === 'all' ? '' : s, { replace: true })}
          trailFor={(word) => {
            if (trails[word]) return trails[word];
            // Asked once: this runs on every draw while the trail is on its way.
            if (asked.current.has(word)) return null;
            asked.current.add(word);
            api.adminFilingTrail(word)
              .then((t) => setTrails((was) => ({ ...was, [word]: t.trail })))
              .catch(() => { asked.current.delete(word); });
            return null;
          }}
        />
      ) : error ? null : <Muted>Loading…</Muted>}
    </View>
  );
}
