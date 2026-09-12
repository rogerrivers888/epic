/**
 * Back office › Hosting: pitch review and the trust ladder.
 *
 * Two things only a reviewer does, because the brief keeps them off the host:
 *
 *   * **Read a first pitch** within 48 hours (Events v4 H2). The checklist is
 *     what we look at — what you will actually do, what they go home with, who
 *     it suits, who it does not, the photos. Pass it live, or send it back
 *     with a note. Coaching, not rejection: the note is required when it goes
 *     back, and the host reads it on their draft.
 *   * **Set a host's trust level.** Verified is the baseline once checks pass;
 *     Checked and Epic Trusted are earned and set here, never by the host.
 *
 * And the reports: what a guest said was wrong, resolved when somebody has
 * looked. The full due-diligence workflow behind the ladder is out of scope
 * this round; the states it needs are here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { api, AdminHosting, TrustLevel } from '../../api';
import { colors, fonts, spacing, type, BORDER, TARGET } from '../../theme';
import { Button, Row, Segmented, StatusLine } from '../../components/ui';
import { AdminPage, Banner, PageHead, Panel, Pill, Tile, TileRow, ago } from '../kit';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { SHAPE_LABEL, TRUST_LABEL, TYPE_LABEL, VENUE_LABEL, metaLine, money, priceWords } from '../../components/hosting';

const CHECKS = [
  { key: 'what', label: 'What you will actually do' }, { key: 'home', label: 'What they go home with' }, { key: 'suits', label: 'Who it suits' }, { key: 'notSuits', label: 'Who it does not suit' }, { key: 'photos', label: 'Photos' },
] as const;

export function Hosting({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<AdminHosting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.adminHosting()); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, decision: 'live' | 'changes') => {
    setBusy(true);
    try { await api.decideOffer(id, decision, note.trim() || null, { ...(data?.inReview.find((o) => o.id === id)?.checklist ?? {}), ...checks }); setOpen(null); setNote(''); setChecks({}); await load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const setTrust = async (id: string, body: { trust?: TrustLevel; checks?: 'running' | 'passed' }) => {
    try { await api.setHostTrust(id, body); await load(); } catch (e: any) { setError(e.message); }
  };

  const waiting = data?.inReview ?? [];
  const overdue = waiting.filter((o) => o.submittedAt && Date.now() - new Date(o.submittedAt).getTime() > 48 * 3600_000).length;

  return (
    <AdminPage>
      <PageHead title="Hosting" sub="Read a first pitch within 48 hours, set a host's trust level, act on reports. A host never sets their own level." />
      {error ? <Banner tone="crit">{error}</Banner> : null}
      <TileRow>
        <Tile label="Pitches waiting" value={String(waiting.length)} tone={overdue ? 'crit' : waiting.length ? 'warn' : 'ok'} sub={overdue ? `${overdue} past 48 hours` : 'within the promise'} />
        <Tile label="Hosts" value={String(data?.hosts.length ?? 0)} sub={`${data?.hosts.filter((h) => h.checks === 'running').length ?? 0} with checks running`} />
        <Tile label="Open reports" value={String(data?.reports.length ?? 0)} tone={data?.reports.length ? 'warn' : 'plain'} />
      </TileRow>

      <Panel title="Pitches to read" sub="Coaching, not rejection: a note is required when one goes back.">
        {!waiting.length ? <Text style={type.small}>Nothing waiting.</Text> : waiting.map((o) => {
          const isOpen = open === o.id;
          return (
            <View key={o.id} style={styles.pitch}>
              <Press onPress={() => { setOpen(isOpen ? null : o.id); setNote(''); setChecks({}); }} accessibilityRole="button">
                <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                      <Pill label={SHAPE_LABEL[o.shape]} />
                      {o.hostType ? <Pill label={TYPE_LABEL[o.hostType]} tone="accent" /> : null}
                      <Pill label={TRUST_LABEL[o.hostTrust]} />
                      {o.commentary ? <Pill label="Reads like a tour" tone="crit" /> : null}
                    </Row>
                    <Text style={type.h3}>{o.title ?? 'Untitled'}</Text>
                    <Text style={type.small}>{o.hostName} · {metaLine(o)} · {priceWords(o)} · {VENUE_LABEL[o.venue]}</Text>
                  </View>
                  <Text style={type.tiny}>{o.submittedAt ? ago(o.submittedAt) : ''}</Text>
                </Row>
              </Press>
              {isOpen ? (
                <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                  {o.description ? <Text style={type.body}>{o.description}</Text> : null}
                  {o.whyYou ? <Text style={type.body}><Text style={{ fontWeight: '700' }}>Why them: </Text>{o.whyYou}</Text> : null}
                  {o.outcome ? <Text style={type.body}><Text style={{ fontWeight: '700' }}>By the end: </Text>{o.outcome}</Text> : null}
                  {o.regulated ? <Text style={type.small}>Regulated city ({o.regulated.country}): {o.regulated.answer === 'licensed' ? 'holds a licence' : o.regulated.answer === 'no_commentary' ? 'no heritage commentary' : 'unanswered'}.</Text> : null}
                  <Text style={styles.label}>What we look at</Text>
                  {CHECKS.map((c) => {
                    const v = checks[c.key] ?? o.checklist[c.key];
                    return (
                      <Row key={c.key} style={{ justifyContent: 'space-between' }}>
                        <Text style={type.body}>{c.label}</Text>
                        <View style={{ width: 220 }}>
                          <Segmented value={v === 'clear' ? 'clear' : v === 'missing' ? 'missing' : 'note'} options={[{ value: 'clear', label: 'Clear' }, { value: 'missing', label: 'Missing' }, { value: 'note', label: 'Note' }]} onChange={(k) => setChecks({ ...checks, [c.key]: k === 'note' ? (v !== 'clear' && v !== 'missing' ? v : 'One is dark — we may ask for another') : k })} />
                        </View>
                      </Row>
                    );
                  })}
                  <TextInput value={note} onChangeText={setNote} multiline placeholder="What would make it stronger. The host reads this on their draft." placeholderTextColor={colors.inkFaint} style={styles.input} />
                  {canManage ? (
                    <Row>
                      <Button label="Pass it · live" icon="check" loading={busy} onPress={() => void decide(o.id, 'live')} />
                      <Button label="Send it back with the note" kind="secondary" disabled={!note.trim()} loading={busy} onPress={() => void decide(o.id, 'changes')} />
                    </Row>
                  ) : <StatusLine>Reading only — deciding needs “Review hosts and offers”.</StatusLine>}
                </View>
              ) : null}
            </View>
          );
        })}
      </Panel>

      <Panel title="Hosts" sub="Verified is the baseline once checks pass. Checked and Epic Trusted are set here.">
        {!data?.hosts.length ? <Text style={type.small}>Nobody hosts yet.</Text> : data.hosts.map((h) => (
          <View key={h.id} style={styles.host}>
            <View style={{ flex: 1, gap: 2 }}>
              <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                <Text style={type.h3}>{h.name}</Text>
                {h.type ? <Pill label={TYPE_LABEL[h.type]} tone="accent" /> : null}
                {h.openReports ? <Pill label={`${h.openReports} report${h.openReports === 1 ? '' : 's'}`} tone="crit" /> : null}
              </Row>
              <Text style={type.small}>{[h.location, `${h.liveOffers} live`, h.inReview ? `${h.inReview} in review` : null, h.payoutStatus === 'connected' ? 'payouts on' : 'no payouts', h.taxReference ? `tax ${h.taxReference}` : 'no tax ref', h.idDocument ? `ID: ${h.idDocument.replace('_', ' ')}` : 'no ID named', h.insuranceConfirmed ? 'insurance confirmed' : null].filter(Boolean).join(' · ')}</Text>
            </View>
            <View style={{ gap: 6, width: 300 }}>
              <Segmented value={h.checks} options={[{ value: 'running', label: 'Checks running' }, { value: 'passed', label: 'Checks passed' }]} onChange={(v) => canManage && void setTrust(h.id, { checks: v as any })} />
              <Segmented value={h.trust} options={[{ value: 'verified', label: 'Verified' }, { value: 'checked', label: 'Checked' }, { value: 'trusted', label: 'Trusted' }]} onChange={(v) => canManage && void setTrust(h.id, { trust: v as TrustLevel })} />
            </View>
          </View>
        ))}
      </Panel>

      <Panel title="Reports" sub="What a guest said was wrong. Resolved when somebody has looked.">
        {!data?.reports.length ? <Text style={type.small}>None open.</Text> : data.reports.map((r) => (
          <Row key={r.id} style={styles.report}>
            <Icon name="alert" size={16} color={colors.overrun} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.h3}>{r.hostName}{r.title ? ` · ${r.title}` : ''}</Text>
              <Text style={type.body}>{r.reason}</Text>
              <Text style={type.tiny}>{ago(r.at)}</Text>
            </View>
            {canManage ? <Button label="Resolved" kind="secondary" onPress={async () => { await api.resolveHostReport(r.id); await load(); }} /> : null}
          </Row>
        ))}
      </Panel>
      <Text style={type.tiny}>Payouts: {money(0)} moved. Epic has no payment provider connected; bookings are recorded and honoured, and nothing is charged.</Text>
    </AdminPage>
  );
}

const styles = StyleSheet.create({
  pitch: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft },
  label: { fontFamily: fonts.body, fontSize: 12, fontWeight: '700', color: colors.inkMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: { minHeight: 72, paddingHorizontal: spacing.md, paddingTop: 10, borderWidth: BORDER, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 14, color: colors.ink, fontFamily: fonts.body },
  host: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft, flexWrap: 'wrap' },
  report: { alignItems: 'flex-start', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.ruleSoft, minHeight: TARGET },
});
