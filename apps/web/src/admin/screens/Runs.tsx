/**
 * Runs — the monitor.
 *
 * Starting a collection run happens on Places, where you find the gap: every
 * *Collect here* button there carries its own scope. **This page only watches.**
 * It exists because runs take hours, spend money and die when a deploy lands
 * mid-flight, so one page has to answer "what is going, what did it cost, what
 * failed" without the operator having to remember which county they were in. It
 * does no area browsing of its own.
 *
 * The one thing it insists on: **ours is kept separate from theirs.** A hundred
 * and thirty-two of the first three hundred and forty-one menu failures were
 * Epic's own bugs, and folded into the same list they read as a hundred and
 * thirty-two restaurants with broken websites. On their own, above theirs, they
 * are a morning's work.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { colors, spacing, type, BORDER } from '../../theme';
import { useViewport } from '../../hooks/useViewport';
import { asText, useQueryState } from '../../router';
import { api, type RunsList, type Run, type RunFailures } from '../../api';
import { AdminPage, ago, pounds } from '../kit';
import { Explain } from '../explain';
import { Ladder, Num, Word, Blank, Progress, Act, Footer, Kicker, Stat, type Col } from '../table';

const PHONE = 900;

export function Runs({ canManage }: { canManage: boolean }) {
  const [run, setRun] = useQueryState<string>('run', '', asText);
  const [view, setView] = useQueryState<string>('view', '', asText);
  const { width } = useViewport();

  if (run && view === 'failures') return <FailuresBoard runKey={run} canManage={canManage} onClose={() => { setView(''); setRun(''); }} />;
  return width < PHONE ? <RunsPhone canManage={canManage} onFailures={(k) => { setRun(k); setView('failures'); }} />
    : <RunsBoard canManage={canManage} onFailures={(k) => { setRun(k); setView('failures'); }} />;
}

// ---------------------------------------------------------------------------
// BO3a — the run list
// ---------------------------------------------------------------------------

function RunsBoard({ canManage, onFailures }: { canManage: boolean; onFailures: (key: string) => void }) {
  const [data, setData] = useState<RunsList | null>(null);
  const load = useCallback(() => { api.adminRuns().then(setData).catch(() => setData(null)); }, []);
  useEffect(load, [load]);
  if (!data) return <AdminPage><Waiting /></AdminPage>;

  const columns: Col<Run>[] = [
    { key: 'run', label: 'The run', tip: 'theRun', grow: true,
      cell: (r) => (
        <View style={{ minWidth: 0 }}>
          <Text style={[styles.rowName, r.state === 'running' && styles.strong]}>{r.label}</Text>
        </View>
      ),
      cellTip: (r) => [r.label, r.explain] as const },
    { key: 'where', label: 'Where it got to', tip: 'whereItGotTo', width: 170, align: 'left',
      cell: (r) => (
        <View style={{ gap: 4, width: '100%' }}>
          <Text style={[styles.state, r.state === 'running' && { color: colors.accent, fontWeight: '700' }]}>{r.where}</Text>
          {r.state === 'running' && r.progress != null ? <Progress of={r.progress} /> : null}
          {r.stranded ? <Text style={styles.stranded}>{`killed by ${r.stranded.why}`}</Text> : null}
        </View>
      ) },
    { key: 'costs', label: 'Costs', tip: 'costs', width: 130, align: 'right', cell: (r) => <Word>{r.costs}</Word> },
    { key: 'cap', label: 'Cap', tip: 'cap', width: 150, align: 'right',
      cell: (r) => (r.cap === 'none' ? <Word muted>none</Word> : <Word strong={r.capLeft != null}>{r.cap}</Word>) },
    { key: 'last', label: 'Last run', tip: 'lastRun', width: 150, align: 'right',
      cell: (r) => (r.state === 'running' && r.startedAt ? <Word muted>{`started ${ago(r.startedAt)}`}</Word>
        : r.lastAt ? <Word muted>{ago(r.lastAt)}</Word> : <Blank />) },
    { key: 'act', label: '', width: 130, align: 'right', stops: true,
      cell: (r) => (
        <Act label={r.state === 'running' ? 'Watch it' : r.action} small
             tone={r.state === 'running' || r.action === 'See failures' || r.action === 'Open it' ? 'secondary' : 'primary'}
             disabled={!canManage && r.action !== 'See failures' && r.state !== 'running'}
             onPress={() => (r.key === 'menus' ? onFailures('menus') : r.key === 'rescore' ? api.adminRescorePlaces().then(load) : load())} />
      ) },
  ];

  const stranded = data.stranded[0] ?? null;
  return (
    <AdminPage>
      <View style={styles.band}>
        <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
          <Kicker>Runs that spend</Kicker>
          <Text style={styles.title}>Collect</Text>
        </View>
        <View style={styles.five}>
          <Stat label="Running" value={data.running} tip="running" />
          <Stat label="Spent this month" value={pounds(data.spentPence)} tip="spentThisMonth" />
          <Stat label="Of a ceiling of" value={pounds(data.ceilingPence)} tip="ceiling" />
          <Stat label="Needs looking at" value={data.needsLooking} tip="needsLookingAt" accent />
        </View>
      </View>

      <Ladder columns={columns} rows={data.runs} keyOf={(r) => r.key}
              highlight={(r) => r.state === 'running'} />

      <Footer>
        {stranded ? (
          <Act label={`Pick up the ${new Date(stranded.started_at).toLocaleDateString([], { day: 'numeric', month: 'long' })} run`}
               tone="solid" disabled={!canManage} onPress={load} />
        ) : null}
      </Footer>
    </AdminPage>
  );
}

// ---------------------------------------------------------------------------
// BO3b — one run's failures, ours kept separate
// ---------------------------------------------------------------------------

function FailuresBoard({ runKey, canManage, onClose }: { runKey: string; canManage: boolean; onClose: () => void }) {
  const [data, setData] = useState<RunFailures | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<{ venue_ref: string; label: string; why: string }[] | null>(null);
  useEffect(() => { api.adminRunFailures(runKey).then(setData).catch(() => setData(null)); }, [runKey]);

  const see = (cause: string, ours?: string) => {
    setOpen(`${cause}:${ours ?? ''}`); setRows(null);
    api.adminRunFailing(runKey, { cause, ours }).then((r) => setRows(r.rows)).catch(() => setRows([]));
  };

  if (!data) return <AdminPage><Waiting /></AdminPage>;
  const t = data.totals;
  return (
    <AdminPage>
      <View style={styles.trail}>
        <Press effect="none" onPress={onClose} accessibilityRole="button" accessibilityLabel="Back to the runs" style={styles.trailBack}>
          <Icon name="back" size={15} strokeWidth={2.2} color={colors.accent} />
          <Text style={styles.trailWord}>Collect</Text>
        </Press>
        <Text style={styles.trailNote}>· 8 runs</Text>
      </View>
      <View style={styles.band}>
        <View style={{ flexGrow: 1, flexBasis: 240, minWidth: 0, gap: 5 }}>
          <Kicker>{`Read the menus${t.last ? ` · ${ago(t.last)}` : ''}`}</Kicker>
          <Text style={styles.title}>{`${(t.failed ?? 0).toLocaleString()} could not be read`}</Text>
        </View>
        <View style={styles.five}>
          <Stat label="Tried" value={(t.tried ?? 0).toLocaleString()} tip="tried" />
          <Stat label="Read" value={(t.read ?? 0).toLocaleString()} tip="read" />
          <Stat label="Our own fault" value={(t.ours ?? 0).toLocaleString()} tip="oursFault" accent />
        </View>
      </View>

      {/* Ours, on its own and above theirs, where it cannot be skimmed past. */}
      <View style={{ gap: 9 }}>
        <Kicker accent>{`Ours · ${t.ours ?? 0} of the ${t.failed ?? 0}`}</Kicker>
        <View style={styles.oursBlock}>
          {data.ours.length === 0 ? <View style={{ padding: 14 }}><Word muted>None of the failures were ours.</Word></View> : data.ours.map((c, i) => (
            <React.Fragment key={c.key}>
              <View style={[styles.causeRow, i === data.ours.length - 1 && { borderBottomWidth: 0 }]}>
                <Explain tip="oursFaultRow" style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.causeLabel, styles.strong]}>{c.label}</Text>
                </Explain>
                <Text style={[styles.causeN, styles.strong]}>{c.n.toLocaleString()}</Text>
                <View style={{ width: 150, alignItems: 'flex-start' }}>
                  <Act label={`See the ${c.n}`} small tone="secondary" onPress={() => see('ours', c.key)} />
                </View>
              </View>
              {open === `ours:${c.key}` ? <Behind rows={rows} /> : null}
            </React.Fragment>
          ))}
        </View>
      </View>

      <View style={{ gap: 9 }}>
        <Kicker>{`Theirs · ${(t.failed ?? 0) - (t.ours ?? 0)} of the ${t.failed ?? 0}`}</Kicker>
        <View>
          {data.theirs.map((c, i) => (
            <React.Fragment key={c.key}>
              <View style={[styles.causeRow, i === data.theirs.length - 1 && { borderBottomWidth: 0 }]}>
                <Explain tip={['Their side', `How many failed this way. Nothing we can fix by deploying. ${c.fix}`]} style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.causeLabel}>{c.label}</Text>
                </Explain>
                <Text style={styles.causeN}>{c.n.toLocaleString()}</Text>
                <View style={{ width: 150, alignItems: 'flex-start' }}>
                  <Act label="See them" small tone="secondary" onPress={() => see(c.key)} />
                </View>
              </View>
              {open === `${c.key}:` ? <Behind rows={rows} /> : null}
            </React.Fragment>
          ))}
          {data.theirs.length === 0 ? <Word muted>Nothing outstanding on their side.</Word> : null}
        </View>
      </View>

      <Footer>
        <Act label="Retry just ours · free" tone="secondary" disabled={!canManage || !(t.ours ?? 0)} onPress={() => {}} />
      </Footer>
    </AdminPage>
  );
}

const Behind = ({ rows }: { rows: { venue_ref: string; label: string; why: string }[] | null }) => (
  <View style={styles.behind}>
    {!rows ? <Waiting /> : rows.length === 0 ? <Word muted>Nothing behind this one now.</Word> : rows.slice(0, 40).map((r) => (
      <View key={r.venue_ref} style={styles.behindRow}>
        <Text style={styles.behindName} numberOfLines={1}>{r.label}</Text>
        <Text style={styles.behindWhy} numberOfLines={1}>{r.why}</Text>
      </View>
    ))}
  </View>
);

// ---------------------------------------------------------------------------
// BO3c — Collect at 390
// ---------------------------------------------------------------------------

/**
 * The phone view, and why this one rather than Demand: the thing that goes wrong
 * unattended is a run dying on a deploy, and that needs answering within the
 * hour. Nothing on Demand does.
 */
function RunsPhone({ canManage, onFailures }: { canManage: boolean; onFailures: (key: string) => void }) {
  const [data, setData] = useState<RunsList | null>(null);
  useEffect(() => { api.adminRuns().then(setData).catch(() => setData(null)); }, []);
  if (!data) return <AdminPage><Waiting /></AdminPage>;

  const going = data.runs.find((r) => r.state === 'running') ?? null;
  const menus = data.runs.find((r) => r.key === 'menus') ?? null;
  const stranded = data.stranded[0] ?? null;
  const needs = data.needsLooking;

  return (
    <AdminPage>
      <View style={styles.bandPhone}>
        <Kicker>Today</Kicker>
        <Text style={styles.titlePhone}>
          {going ? `One run going, ${needs} need${needs === 1 ? 's' : ''} you` : needs ? `${needs} need${needs === 1 ? 's' : ''} you` : 'Nothing needs you'}
        </Text>
      </View>

      {going ? (
        <View style={styles.goingCard}>
          <View style={styles.goingHead}>
            <Text style={styles.rowName}>{going.label}</Text>
            <Text style={styles.goingN}>{going.where.replace(/^Running · /, '')}</Text>
          </View>
          <Progress of={going.progress ?? 0} height={5} />
          <View style={styles.goingFoot}>
            <Text style={styles.rowNote}>{going.startedAt ? `Started ${ago(going.startedAt)}` : ''}</Text>
            <Text style={styles.rowNote}>{going.free ? 'nothing spent' : going.costs}</Text>
          </View>
        </View>
      ) : null}

      {stranded ? (
        <View style={styles.phoneRow}>
          <View style={{ gap: 2 }}>
            <Text style={styles.rowName}>{`A run from ${new Date(stranded.started_at).toLocaleDateString([], { day: 'numeric', month: 'long' })} never picked up`}</Text>
            <Text style={styles.rowNote}>{stranded.scope ?? 'harvest'}</Text>
          </View>
          <View style={styles.phoneFacts}>
            <Text style={styles.rowNote}>Killed by</Text>
            <Text style={styles.phoneFact}>a deploy</Text>
          </View>
          <Act label="Pick it up" tone="solid" disabled={!canManage} onPress={() => {}} />
        </View>
      ) : null}

      {menus && (menus.ours ?? 0) > 0 ? (
        <View style={styles.phoneRow}>
          <View style={{ gap: 2 }}>
            <Text style={styles.rowName}>{`${menus.ours} menu failures were ours`}</Text>
            <Text style={styles.rowNote}>menus</Text>
          </View>
          <View style={styles.phoneFacts}>
            <Text style={styles.rowNote}>Of all the failures</Text>
            <Text style={styles.phoneFact}>{`${menus.ours} ours · ${(menus.failed ?? 0) - (menus.ours ?? 0)} theirs`}</Text>
          </View>
          <Act label="See them" tone="secondary" onPress={() => onFailures('menus')} />
        </View>
      ) : null}

      <View style={styles.spend}>
        <Kicker>Spend</Kicker>
        <Explain tip="spentThisMonthCeiling" style={{ gap: 3 }}>
          <Text style={styles.spendBig}>{pounds(data.spentPence)}</Text>
          <Text style={styles.rowNote}>{`of ${pounds(data.ceilingPence)} this month`}</Text>
        </Explain>
        <Progress of={data.ceilingPence ? data.spentPence / data.ceilingPence : 0} height={5} />
        <Explain tip="runTripadvisorCap" style={styles.spendRow}>
          <Text style={styles.rowNote}>Tripadvisor</Text>
          <Text style={styles.phoneFact}>{`${data.tripadvisor.left} of ${data.tripadvisor.of} left`}</Text>
        </Explain>
      </View>
    </AdminPage>
  );
}

const Waiting = () => <View style={{ paddingVertical: spacing.xl }}><ActivityIndicator color={colors.accent} /></View>;

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    gap: spacing.xl, flexWrap: 'wrap',
    borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 17,
  },
  bandPhone: { gap: 5, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 14 },
  title: { ...type.title, fontSize: 31, letterSpacing: -1.08, lineHeight: 33 },
  titlePhone: { ...type.title, fontSize: 25, letterSpacing: -0.9, lineHeight: 28 },
  five: { flexDirection: 'row', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap' },

  trail: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  trailBack: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trailWord: { ...type.small, fontSize: 13, fontWeight: '700', color: colors.accent },
  trailNote: { ...type.small, fontSize: 12.5, color: colors.inkMuted },

  rowName: { ...type.body, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  rowNote: { ...type.tiny, fontSize: 12, color: colors.inkMuted },
  strong: { fontWeight: '700' },
  state: { ...type.small, fontSize: 13, color: colors.ink },
  stranded: { ...type.tiny, fontSize: 11.5, color: colors.accent, fontWeight: '700' },

  oursBlock: { backgroundColor: colors.surfaceMuted },
  causeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  causeLabel: { ...type.body, fontSize: 13.5, color: colors.ink },
  causeN: { ...type.body, fontSize: 14, color: colors.ink, width: 100, textAlign: 'right', fontVariant: ['tabular-nums'] },
  behind: { paddingHorizontal: 14, paddingVertical: 10, gap: 6, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  behindRow: { flexDirection: 'row', gap: 10, alignItems: 'baseline' },
  behindName: { ...type.small, fontSize: 12.5, fontWeight: '600', color: colors.ink, width: 220 },
  behindWhy: { ...type.tiny, fontSize: 11.5, color: colors.inkMuted, flex: 1 },

  goingCard: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 14, paddingVertical: 13, gap: 8 },
  goingHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  goingN: { ...type.tiny, fontSize: 12, fontWeight: '700', color: colors.accent },
  goingFoot: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  phoneRow: { gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  phoneFacts: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  phoneFact: { ...type.tiny, fontSize: 12, fontWeight: '700', color: colors.ink },
  spend: { borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 14, gap: 8 },
  spendBig: { ...type.title, fontSize: 24, fontWeight: '800', color: colors.ink },
  spendRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
