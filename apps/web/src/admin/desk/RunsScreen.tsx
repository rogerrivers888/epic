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
import { View } from 'react-native';

import { api } from '../../api';
import { DecisionLog, Runs } from '../filing/Runs';
import type { Decision, Trail } from '../filing/types';
import { useCrumbs, useDeskGo, useDeskParam } from './Desk';
import { Muted, Seg, saidOf, useToast } from './kit';

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
  const asked = useRef(new Set<string>());

  useCrumbs(log ? [{ name: 'Runs', go: () => go('runs') }, { name: 'Decision log' }] : [], [log]);

  useEffect(() => {
    let live = true;
    api.adminFilingRuns()
      .then((d) => { if (live) setRuns(d); })
      .catch((err) => { if (live) setError(saidOf(err) || 'The runs did not load.'); });
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
      <Seg
        options={[
          { key: 'runs', name: 'Runs' },
          { key: 'log', name: `Decision log${decisions ? ` · ${decisions.decisions.length}` : ''}` },
        ]}
        value={log ? 'log' : 'runs'}
        onChange={(k) => setView(k === 'log' ? 'log' : '')}
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
