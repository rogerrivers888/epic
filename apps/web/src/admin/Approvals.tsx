/**
 * The Approvals queue (G11, 1 Oct 2026).
 *
 * An agent that needs a privileged action files a request; the owner, signed in
 * personally, approves or declines with one click — logged with his name. On
 * approval the server runs exactly the recorded call under the owner's identity
 * and shows the result; a failed one can be approved again. The buttons are
 * shown to everyone but work only when elevated.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Approval, ApprovalBrief, api, ApiError } from '../api';
import { useSession } from '../hooks/useSession';
import { colors, spacing, type } from '../theme';
import { Button } from '../components/ui';
import { AdminPage, PageHead, Panel, ago } from './kit';
import { useRouter } from '../router';
import { paths } from '../routes';

const ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
/**
 * What a request is about, read from the call it will run, when that names
 * something the back office has a record for (K15 §3, Roger, 3 Oct 2026: every
 * name opens what it refers to). Null for a call that names nothing.
 */
export function subjectOf(request: string | null | undefined): { words: string; href: string } | null {
  const path = String(request ?? '').replace(/^[A-Z]+\s+/, '').split('?')[0];
  let m = path.match(new RegExp(`^/api/admin/hosting/hosts/${ID}(/|$)`, 'i'));
  if (m) return { words: 'Open the host', href: paths.hostingRecord('host', m[1]) };
  m = path.match(new RegExp(`^/api/admin/hosting/money/payouts/${ID}(/|$)`, 'i'));
  if (m) return { words: 'Open the payout', href: paths.hostingRecord('payout', m[1]) };
  m = path.match(new RegExp(`^/api/admin/hosting/(?:review|events)/${ID}(/|$)`, 'i'));
  if (m) return { words: 'Open the event', href: paths.hostingRecord('event', m[1]) };
  if (/^\/api\/admin\/hosting\/settings\//.test(path)) return { words: 'Open hosting settings', href: paths.hosting('settings') };
  if (/^\/api\/admin\/hosting\/changes\//.test(path)) return { words: 'Open hosting changes', href: paths.hosting('changes', { what: 'setting' }) };
  return null;
}

/** Any older numbers filed beside the brief, as "12 places" pairs. The brief itself is drawn on its own. */
const numbersLine = (n: Approval['numbers']) =>
  n && typeof n === 'object'
    ? Object.entries(n).filter(([k, v]) => k !== 'brief' && (typeof v === 'number' || typeof v === 'string')).map(([k, v]) => `${v} ${k}`).join(', ')
    : '';

/** The brief the server required at filing (routes/admin.js), or null on a request filed before it was. */
const briefOf = (n: Approval['numbers']): ApprovalBrief | null => {
  // Every field and its type, the way the server checked it at filing — a
  // malformed stored value is "no brief", never a crash (Codex, 1 Oct 2026).
  const b = n && typeof n === 'object' ? (n as { brief?: any }).brief : null;
  const said = (v: unknown) => typeof v === 'string' && v.trim() !== '';
  const whole = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  return b && typeof b === 'object' && said(b.chat) && said(b.why) && said(b.change)
    && b.affected && typeof b.affected === 'object' && whole(b.affected.count) && said(b.affected.unit)
    && whole(b.costPence)
    ? (b as ApprovalBrief) : null;
};

const pounds = (pence: number) =>
  pence === 0 ? '£0 — free' : `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One line of the brief: a short ink label and the plain-English answer. */
function Said({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
      <Text style={[type.tiny, { color: colors.inkMuted, width: 96, fontWeight: '700' }]}>{label}</Text>
      <Text style={[type.small, { color: colors.ink, flex: 1 }]}>{children}</Text>
    </View>
  );
}

/**
 * @param standalone  On its own rail screen it always draws, with an empty
 *   state, so the owner who clicked "Approvals" is never shown a blank page.
 *   Embedded on the Overview it stays silent (returns null) when nothing waits.
 * @param onCount  Reports the number in review after every load, so the rail's
 *   "Approvals (n)" badge keeps up with an approval decided here.
 */
export function Approvals({ standalone = false, onCount }: { standalone?: boolean; onCount?: (n: number) => void } = {}) {
  const { access } = useSession();
  const { navigate } = useRouter();
  const elevated = Boolean(access?.elevated);
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = (await api.approvals('review')).approvals;
      setRows(got);
      setError(null);
      onCount?.(got.length);
    } catch (e: any) {
      // Leave `rows` null (not loaded) and say so — a failed read is not an
      // empty queue. Embedded on the Overview this still draws nothing; on its
      // own screen it shows the error, never a false "nothing is waiting".
      setError(e instanceof ApiError ? e.message : 'Could not reach the approvals queue. Try again.');
    }
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (id: string, decision: 'approved' | 'declined') => {
    const was = rows?.find((r) => r.id === id);
    setBusy(id); setError(null);
    try {
      const out = await api.decideApproval(id, decision);
      // Show what happened before the card clears from the review list.
      const d = was?.description ?? 'The request';
      if (decision === 'declined') setNotice(`${d} — ${was?.state === 'unknown' ? 'closed' : 'declined'}.`);
      else if (out.result?.ok) setNotice(`${d} — done. ${out.result.message}`);
      else if (out.approval.state === 'unknown') setNotice(`${d} — outcome unknown: ${out.result?.message ?? ''} Check before retrying.`);
      else setNotice(`${d} — did not run (${out.result?.status}): ${out.result?.message ?? ''} It can be approved again.`);
      await load();
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally { setBusy(null); }
  };

  // Three states are kept apart, not conflated (Codex, 1 Oct 2026): not-yet-
  // loaded (`rows` null, no error) is loading, not empty; a failed read carries
  // an error, not an empty queue; only a successful load of zero rows is empty.
  const loaded = rows !== null;
  const loading = !loaded && !error;
  const empty = loaded && rows!.length === 0 && !notice && !error;
  // Embedded on the Overview, stay out of the way until a load returns rows. On
  // its own rail screen, always draw — the owner who clicked "Approvals" gets an
  // answer (loading, error, empty, or the list), never a blank page.
  if (!standalone && (!loaded || (rows!.length === 0 && !notice))) return null;
  const list = rows ?? [];
  return (
    <Panel title="Waiting for you" sub="An agent has asked to do something only you may authorise.">
      {error ? <Text style={[type.small, { color: colors.overrun }]}>{error}</Text> : null}
      {notice ? <Text style={[type.small, { color: colors.ink }]}>{notice}</Text> : null}
      {!elevated ? (
        <Text style={[type.small, { color: colors.ink }]}>Sign in with your e-mail link to approve or decline these.</Text>
      ) : null}
      {loading ? <Text style={type.small}>Reading the queue…</Text> : null}
      {empty ? (
        <Text style={type.small}>Nothing is waiting for you right now. When an agent asks to do something only you may authorise, it appears here.</Text>
      ) : null}
      {list.map((r) => {
        const nums = numbersLine(r.numbers);
        const brief = briefOf(r.numbers);
        const failed = r.state === 'failed';
        const unknown = r.state === 'unknown';
        const subject = subjectOf(r.request);
        return (
          <View key={r.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, gap: 4 }}>
            <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>{r.description}</Text>
            {subject ? (
              <Text style={[type.small, { color: colors.ink, textDecorationLine: 'underline', alignSelf: 'flex-start' }]} accessibilityRole="link"
                    onPress={() => navigate(subject.href)}>{subject.words}</Text>
            ) : null}
            {/* The plain-English brief first (owner, 1 Oct 2026): who asked, why,
                what changes, how much, what it costs — then the technical call. */}
            {brief ? (
              <View style={{ gap: 3, paddingVertical: 2 }}>
                <Said label="Asked by">{brief.chat}</Said>
                <Said label="Why">{brief.why}</Said>
                <Said label="What changes">{brief.change}</Said>
                <Said label="Affects">{`${brief.affected.count.toLocaleString('en-GB')} ${brief.affected.unit}`}</Said>
                <Said label="Expected cost">{pounds(brief.costPence)}</Said>
              </View>
            ) : (
              <Text style={[type.small, { color: colors.ink, fontWeight: '700' }]}>No plain-English brief — filed before one was required. Decline it and ask for it to be filed again.</Text>
            )}
            {/* The exact call, in full — the brief is the agent's account of it; this is what executes. */}
            <Text style={[type.tiny, { color: colors.inkMuted, marginTop: 2 }]}>
              {`The technical call: ${nums ? `${nums} · ` : ''}${r.request}`}
            </Text>
            <Text style={type.tiny}>{`Filed from session ${r.session_label ?? r.requested_label ?? 'an agent'} · ${ago(r.created_at)}`}</Text>
            {/* The exact call that will run, so the owner authorises what he sees —
                the description is the agent's claim; this is what executes. */}
            {r.payload != null && Object.keys(r.payload as object).length > 0 ? (
              <Text style={[type.tiny, { color: colors.inkMuted, fontFamily: 'monospace' as any }]}>
                {`It will send: ${JSON.stringify(r.payload)}`}
              </Text>
            ) : null}
            {failed && r.result ? (
              <Text style={[type.tiny, { color: colors.overrun }]}>{`Last run failed (${r.result.status}): ${r.result.message} — approve to try again.`}</Text>
            ) : null}
            {unknown && r.result ? (
              <Text style={[type.tiny, { color: colors.overrun }]}>{`Ran, but the outcome is unknown: ${r.result.message} Check whether it happened before doing anything — it will NOT run again automatically.`}</Text>
            ) : null}
            {elevated ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 2 }}>
                {/* An unknown run must not be re-run blindly: only close it once checked. */}
                {/* No brief, no approval: the owner cannot authorise what he has not been told. */}
                {unknown || !brief ? null : <Button kind="primary" label={failed ? 'Approve & run again' : 'Approve & run'} loading={busy === r.id} onPress={() => void decide(r.id, 'approved')} />}
                <Button kind="secondary" label={unknown ? 'Checked — close' : 'Decline'} loading={busy === r.id} onPress={() => void decide(r.id, 'declined')} />
              </View>
            ) : null}
          </View>
        );
      })}
    </Panel>
  );
}

/**
 * The rail's Approvals screen — the panel on its own page, with a heading, so
 * "Approvals" in the menu lands somewhere that explains itself whether or not
 * anything is waiting (owner, 1 Oct 2026: "put the approvals list somewhere
 * obvious"). The queue used to live only on the unlisted estate Overview.
 */
export function ApprovalsScreen({ onCount, title = 'Approvals' }: { onCount?: (n: number) => void; title?: string }) {
  return (
    <AdminPage>
      <PageHead
        title={title}
        sub="Actions an agent has asked you to authorise. Approving runs the exact recorded call under your name and shows the result; declining closes it."
      />
      <Approvals standalone onCount={onCount} />
    </AdminPage>
  );
}
