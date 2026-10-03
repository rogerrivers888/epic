/**
 * Back office › Hosting › Safety (hosting v4, BO8k): who is at risk, or about
 * to be let down. Five full-width tables — Checked expiring or missing, with
 * the drop-off events it affects; hosts the rating rule has caught; open
 * complaints and guarantee claims (Resolve / Decline for anyone who manages
 * hosting); host no-shows; incidents, which are never deleted, so there is no
 * delete here and the database refuses one anyway.
 *
 * The rating rule and the claim auto-pay limit are still to set (handover §7):
 * until they are, the server says ratings is null with a reason, and this
 * screen draws a dash whose hover is that reason rather than an empty list
 * that would read as "nobody caught".
 */

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../../api';
import { colors, type } from '../../theme';
import { Ladder, Num, Word, Blank, Act, Stat, type Col } from '../table';
import { Opens, useLoad, useOpen, useSorted, gbp, when } from './kit';
import { useQueryState, asText, useRouter } from '../../router';
import { paths } from '../../routes';
import { ComplaintRecord } from './Records';
import { Band, Loading, Said, TableHead, amber, red, tip, useSortParam } from './Money';

type Safety = {
  checked: { hostId: string; host: string; state: string; on: string | null; insuranceExpires: string | null; dropOffEvents: number }[];
  ratings: { hostId: string; host: string; avg: number | null; reviews: number }[] | null;
  ratingsReason: string | null;
  complaints: { id: string; kind: 'complaint' | 'guarantee_claim'; hostId?: string | null; host: string | null; offerId?: string | null; event: string | null; householdId?: string | null; household: string | null; bookingId?: string | null; reason: string | null; at: string; autoPayLimit: number | null }[];
  noShows: { id: string; hostId?: string | null; host: string | null; offerId?: string | null; event: string | null; householdId?: string | null; household: string | null; bookingId?: string | null; at: string }[];
  incidents: { id: string; hostId?: string | null; host: string | null; offerId?: string | null; event: string | null; children: string[]; reporter: 'host' | 'guest' | 'staff'; body: string; at: string }[];
  reports?: { id: string; hostId: string; host: string; offerId?: string | null; event: string | null; reason: string; at: string }[];
  /** Verified hosts Stripe is asking for ID again (L7): taken up in Stripe by a person, never sent to the host. */
  idAskedAgain?: { hostId: string; host: string; asks: string[]; verifiedOn: string | null; stripeAccount: string | null }[];
};
type Checked = Safety['checked'][number];
type Rating = NonNullable<Safety['ratings']>[number] & { cantSpeak?: boolean };
type Complaint = Safety['complaints'][number];
type NoShow = Safety['noShows'][number];
type Incident = Safety['incidents'][number];
type Report = NonNullable<Safety['reports']>[number];
type AskedAgain = NonNullable<Safety['idAskedAgain']>[number];

const CHECKED_WORDS: Record<string, string> = { none: 'Missing', submitted: 'Submitted', passed: 'Passed', failed: 'Failed' };
const KIND_OF_CLAIM: Record<string, string> = { complaint: 'Complaint', guarantee_claim: 'Guarantee claim' };
const REPORTER: Record<string, string> = { host: 'Host', guest: 'Guest', staff: 'Epic' };
const DAY = 86_400_000;
/** Days until a date, negative once it has gone. */
const daysTo = (d: string | null) => (d ? Math.floor((new Date(`${d}T23:59:59Z`).getTime() - Date.now()) / DAY) : null);

/** Where a name opens (K15 §3): its record, or plain words when the row does not say which. */
const hostHref = (id: string | null | undefined) => (id ? paths.hostingRecord('host', id) : null);
const eventHref = (id: string | null | undefined) => (id ? paths.hostingRecord('event', id) : null);
const householdHref = (id: string | null | undefined) => (id ? paths.customer(id) : null);

export function SafetyTab({ canManage }: { canManage: boolean }) {
  // A complaint or no-show opened from a table is a record on this tab (K15 §3).
  const [complaint] = useQueryState<string | null>('complaint', null, asText);
  // Back is wherever it was opened from, or the bare tab when it was a link.
  const { back } = useRouter();
  if (complaint) return <ComplaintRecord id={complaint} onBack={() => back(paths.hosting('safety'))} />;
  return <SafetyTables canManage={canManage} />;
}

function SafetyTables({ canManage }: { canManage: boolean }) {
  const open = useOpen();
  const { data, error, reload } = useLoad(() => api.hostingAdmin<Safety>('/safety'), []);
  const ck = useSortParam('ksort');
  const rt = useSortParam('tsort');
  const cl = useSortParam('csort');
  const ns = useSortParam('nsort');
  const ic = useSortParam('isort');
  const rp = useSortParam('rpsort');
  const ia = useSortParam('iasort');
  const [reportError, setReportError] = useState<string | null>(null);

  /** The complaint being closed, and why — Resolve and Decline both ask for a line. */
  const [closing, setClosing] = useState<{ id: string; state: 'resolved' | 'declined' } | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const checked = useSorted(data?.checked, ck.sort, ck.desc, (r, k) => (
    k === 'host' ? r.host : k === 'state' ? CHECKED_WORDS[r.state] ?? r.state : k === 'on' ? r.on : k === 'insurance' ? r.insuranceExpires : k === 'dropoff' ? r.dropOffEvents : null));
  const ratingRows: Rating[] = data?.ratings ?? [];
  const ratings = useSorted(ratingRows, rt.sort, rt.desc, (r, k) => (k === 'host' ? r.host : k === 'avg' ? r.avg : k === 'reviews' ? r.reviews : null));
  const complaints = useSorted(data?.complaints, cl.sort, cl.desc, (r, k) => (
    k === 'at' ? r.at : k === 'kind' ? KIND_OF_CLAIM[r.kind] : k === 'household' ? r.household : k === 'host' ? r.host : k === 'event' ? r.event : k === 'reason' ? r.reason : null));
  const noShows = useSorted(data?.noShows, ns.sort, ns.desc, (r, k) => (k === 'host' ? r.host : k === 'event' ? r.event : k === 'household' ? r.household : k === 'at' ? r.at : null));
  const incidents = useSorted(data?.incidents, ic.sort, ic.desc, (r, k) => (
    k === 'at' ? r.at : k === 'host' ? r.host : k === 'event' ? r.event : k === 'reporter' ? REPORTER[r.reporter] : k === 'children' ? r.children.length : k === 'body' ? r.body : null));

  const reports = useSorted(data?.reports, rp.sort, rp.desc, (r, k) => (k === 'host' ? r.host : k === 'event' ? r.event : k === 'reason' ? r.reason : k === 'at' ? r.at : null));

  const askedAgain = useSorted(data?.idAskedAgain, ia.sort, ia.desc, (r, k) => (k === 'host' ? r.host : k === 'verified' ? r.verifiedOn : null));

  if (!data) return <Loading error={error} reload={reload} />;
  const askedCols: Col<AskedAgain>[] = [
    { key: 'host', label: 'Host', sort: 'host', width: 180, tip: tip('Host', 'A host whose ID check passed.'), cell: (r) => <Word>{r.host}</Word> },
    { key: 'asks', label: 'What Stripe asks for', grow: true, tip: tip('What Stripe asks for', 'From Stripe’s requirements on their account. The host is not asked; take it up in Stripe.'), cell: (r) => <Word>{r.asks.join(', ')}</Word> },
    { key: 'verified', label: 'ID checked', sort: 'verified', width: 110, tip: tip('ID checked', 'The day Stripe confirmed their ID.'), cell: (r) => (r.verifiedOn ? <Word>{when(r.verifiedOn)}</Word> : <Blank />) },
    { key: 'account', label: 'Stripe account', width: 200, tip: tip('Stripe account', 'To find them in Stripe.'), cell: (r) => (r.stripeAccount ? <Word>{r.stripeAccount}</Word> : <Blank />) },
  ];

  const close = async () => {
    if (!closing) return;
    setBusy(true); setFailed(null);
    try {
      await api.hostingAdminPost(`/complaints/${closing.id}/resolve`, { state: closing.state, why: why.trim() || null });
      setClosing(null); setWhy(''); reload();
    } catch (e) {
      setFailed(e instanceof ApiError ? e.message : 'That didn’t save.');
    } finally { setBusy(false); }
  };

  // ---- Checked
  const checkedCols: Col<Checked>[] = [
    { key: 'host', label: 'Host', sort: 'host', grow: true, tip: tip('Host', 'Hosts with an event for under-18s that is live, approved or in review. Opens the host.'), cell: (r) => <Word>{r.host}</Word> },
    { key: 'state', label: 'Checked', sort: 'state', width: 130, tip: tip('Checked', 'DBS and references. Missing or submitted and not yet passed is amber; failed is red.'),
      cell: (r) => <Said colour={r.state === 'failed' ? red() : r.state === 'none' || r.state === 'submitted' ? amber() : undefined}>{CHECKED_WORDS[r.state] ?? r.state}</Said> },
    { key: 'on', label: 'Checked on', sort: 'on', width: 120, tip: tip('Checked on', 'When Checked was passed.'), cell: (r) => (r.on ? <Word>{when(r.on)}</Word> : <Blank />) },
    { key: 'insurance', label: 'Insurance ends', sort: 'insurance', width: 150, tip: tip('Insurance ends', 'Amber within 30 days; red once it has ended.'),
      cell: (r) => {
        const d = daysTo(r.insuranceExpires);
        return d == null ? <Blank /> : <Said colour={d < 0 ? red() : d <= 30 ? amber() : undefined}>{when(r.insuranceExpires)}</Said>;
      } },
    { key: 'dropoff', label: 'Drop-off events', sort: 'dropoff', width: 140, align: 'right', tip: tip('Drop-off events', 'Live or approved drop-off events this affects. A public drop-off event never goes live without Checked.'),
      cell: (r) => <Num n={r.dropOffEvents} /> },
  ];

  // ---- Ratings: a dash row that says why when the rule is still to set.
  const ratingCols: Col<Rating>[] = [
    { key: 'host', label: 'Host', sort: 'host', grow: true, tip: tip('Host', 'Hosts the rating rule has caught. Opens the host.'), cell: (r) => (r.cantSpeak ? <Blank /> : <Word>{r.host}</Word>) },
    { key: 'avg', label: 'Average', sort: 'avg', width: 110, align: 'right', tip: tip('Average', 'Across shown guest reviews.'),
      cell: (r) => (r.avg == null ? <Blank /> : <Text style={s.num}>{r.avg.toFixed(1)}</Text>) },
    { key: 'reviews', label: 'Reviews', sort: 'reviews', width: 110, align: 'right', tip: tip('Reviews', 'Shown guest reviews.'), cell: (r) => (r.cantSpeak ? <Blank /> : <Num n={r.reviews} />) },
  ];
  const ratingsReason = data.ratings == null ? tip('Ratings', data.ratingsReason ?? 'The rating rule is not set yet.') : null;
  const ratingShown: Rating[] = data.ratings == null ? [{ hostId: 'none', host: '', avg: null, reviews: 0, cantSpeak: true }] : ratings;

  // ---- Complaints and guarantee claims
  const limit = data.complaints[0]?.autoPayLimit ?? null;
  const complaintCols: Col<Complaint>[] = [
    { key: 'at', label: 'When', sort: 'at', width: 120, tip: tip('When', 'When it was raised.'), cell: (r) => <Word>{when(r.at, true)}</Word> },
    { key: 'kind', label: 'What', sort: 'kind', width: 140, tip: tip('What', 'A complaint or a guarantee claim. While it is open it holds the payout for that session until somebody resolves or declines it here. Nothing is paid or refunded automatically yet: a claim is settled by hand.'),
      cell: (r) => <Word>{KIND_OF_CLAIM[r.kind] ?? r.kind}</Word> },
    { key: 'household', label: 'Guest household', sort: 'household', width: 170, tip: tip('Guest household', 'Who raised it. Opens their record in Customers.'), cell: (r) => <Opens to={householdHref(r.householdId)}>{r.household}</Opens> },
    { key: 'host', label: 'Host', sort: 'host', width: 150, tip: tip('Host', 'Whose event. Opens the host.'), cell: (r) => <Opens to={hostHref(r.hostId)}>{r.host}</Opens> },
    { key: 'event', label: 'Event', sort: 'event', width: 200, tip: tip('Event', 'Which event. Opens it; the rest of the row opens the complaint.'), cell: (r) => <Opens to={eventHref(r.offerId)}>{r.event}</Opens> },
    { key: 'reason', label: 'What happened', sort: 'reason', grow: true, tip: tip('What happened', 'In the household’s words.'),
      cell: (r) => (r.reason ? <Text style={s.word} numberOfLines={1}>{r.reason}</Text> : <Blank />),
      cellTip: (r) => (r.reason ? tip('What happened', r.reason) : null) },
    ...(canManage ? [{
      key: 'act', label: '', width: 190, align: 'right' as const, stops: true,
      cell: (r: Complaint) => (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Act label="Resolve" small onPress={() => { setClosing({ id: r.id, state: 'resolved' }); setWhy(''); setFailed(null); }} disabled={busy} />
          <Act label="Decline" small tone="secondary" onPress={() => { setClosing({ id: r.id, state: 'declined' }); setWhy(''); setFailed(null); }} disabled={busy} />
        </View>
      ),
    }] : []),
  ];

  // ---- No-shows
  const noShowCols: Col<NoShow>[] = [
    { key: 'host', label: 'Host', sort: 'host', width: 180, tip: tip('Host', 'Who did not turn up. Opens the host.'), cell: (r) => <Opens to={hostHref(r.hostId)}>{r.host}</Opens> },
    { key: 'event', label: 'Event', sort: 'event', grow: true, tip: tip('Event', 'Which event. Opens it; the rest of the row opens the report. The session’s payout is held while the report is open; nothing is refunded automatically yet.'), cell: (r) => <Opens to={eventHref(r.offerId)}>{r.event}</Opens> },
    { key: 'household', label: 'Reported by', sort: 'household', width: 180, tip: tip('Reported by', 'The household that said the host did not come. Opens their record in Customers.'), cell: (r) => <Opens to={householdHref(r.householdId)}>{r.household}</Opens> },
    { key: 'at', label: 'Date', sort: 'at', width: 120, tip: tip('Date', 'When it was reported.'), cell: (r) => <Word>{when(r.at)}</Word> },
  ];

  // ---- Reports: "Report this host" from a profile or an event page (guest handoff G25).
  const reportCols: Col<Report>[] = [
    { key: 'host', label: 'Host', sort: 'host', width: 180, tip: tip('Host', 'Who was reported. The row opens the host.'), cell: (r) => <Word>{r.host}</Word> },
    { key: 'event', label: 'Event', sort: 'event', width: 220, tip: tip('Event', 'The event page it was sent from; a dash when it came from the profile. Opens the event.'), cell: (r) => <Opens to={eventHref(r.offerId)}>{r.event}</Opens> },
    { key: 'reason', label: 'What they said', sort: 'reason', grow: true, tip: tip('What they said', 'In the reporter’s words.'), cell: (r) => <Word>{r.reason}</Word> },
    { key: 'at', label: 'Date', sort: 'at', width: 110, tip: tip('Date', 'When it was sent.'), cell: (r) => <Word>{when(r.at)}</Word> },
    ...(canManage ? [{ key: 'act', label: '', width: 110, stops: true, tip: tip('Done', 'Looked into and closed.'),
      cell: (r: Report) => <Act label="Done" tone="secondary" small onPress={() => { setReportError(null); api.hostingAdminPost(`/reports/${r.id}/resolve`, {}).then(reload).catch((e) => setReportError(e?.message ?? 'That didn’t save.')); }} /> }] : []),
  ];

  // ---- Incidents: never deleted, so no action column at all.
  const incidentCols: Col<Incident>[] = [
    { key: 'at', label: 'When', sort: 'at', width: 120, tip: tip('When', 'When it was recorded.'), cell: (r) => <Word>{when(r.at, true)}</Word> },
    { key: 'host', label: 'Host', sort: 'host', width: 160, tip: tip('Host', 'Whose session. Opens the host.'), cell: (r) => <Opens to={hostHref(r.hostId)}>{r.host}</Opens> },
    { key: 'event', label: 'Event', sort: 'event', width: 200, tip: tip('Event', 'Which event. An incident has no record of its own yet, so the row opens the event.'), cell: (r) => <Opens to={eventHref(r.offerId)}>{r.event}</Opens> },
    { key: 'reporter', label: 'Reported by', sort: 'reporter', width: 110, tip: tip('Reported by', 'Host, guest or Epic.'), cell: (r) => <Word>{REPORTER[r.reporter] ?? r.reporter}</Word> },
    { key: 'children', label: 'Children', sort: 'children', width: 90, align: 'right', tip: tip('Children', 'Children involved.'),
      cell: (r) => (r.children.length ? <Num n={r.children.length} /> : <Blank />),
      cellTip: (r) => (r.children.length ? tip('Children', r.children.join(', ')) : null) },
    { key: 'body', label: 'What happened', sort: 'body', grow: true, tip: tip('What happened', 'As it was recorded. An incident can’t be deleted.'),
      cell: (r) => <Text style={s.word} numberOfLines={1}>{r.body}</Text>, cellTip: (r) => tip('What happened', r.body) },
  ];

  const missing = data.checked.filter((r) => r.state !== 'passed').length;
  const expiring = data.checked.filter((r) => { const d = daysTo(r.insuranceExpires); return d != null && d <= 30; }).length;
  return (
    <View style={{ gap: 26 }}>
      <Band kicker="Hosting · Safety" title="Who is at risk, or about to be let down">
        <Stat label="Checked needed" value={missing.toLocaleString()} tip={tip('Checked needed', 'Hosts of under-18 events without Checked passed.')} />
        <Stat label="Expiring" value={expiring.toLocaleString()} tip={tip('Expiring', 'Insurance ending in the next 30 days, or already ended.')} />
        <Stat label="Claims open" value={data.complaints.length.toLocaleString()} tip={tip('Claims open', 'Complaints and guarantee claims not closed.')} />
        {/* The limit rides on each open claim, so with none open there is nothing to read it from: a dash. */}
        <Stat label="Auto-pay limit"
              value={!data.complaints.length ? '—' : limit != null ? gbp(limit) : <Text style={{ color: amber() }}>To set</Text>}
              tip={tip('Claim auto-pay limit', 'The setting a guarantee claim will be paid automatically under, once that is built. Today nothing is paid automatically: every claim is settled by hand. Set in Settings.')} />
        <Stat label="Caught by rating" value={data.ratings == null ? '—' : data.ratings.length.toLocaleString()}
              tip={data.ratings == null ? tip('Caught by rating', data.ratingsReason ?? 'The rating rule is not set yet.') : tip('Caught by rating', 'Hosts the rating rule has caught.')} />
        <Stat label="No-shows" value={data.noShows.length.toLocaleString()} tip={tip('No-shows', 'Open reports. Each holds the session’s payout until it is resolved; nothing is refunded automatically yet.')} />
        <Stat label="Host reports" value={(data.reports?.length ?? 0).toLocaleString()} tip={tip('Host reports', 'Open reports sent from a host’s profile or an event page.')} />
        <Stat label="ID asked again" value={(data.idAskedAgain?.length ?? 0).toLocaleString()} tip={tip('ID asked again', 'Verified hosts Stripe is asking for ID again. Never sent to the host.')} />
      </Band>

      <View>
        <TableHead tip={tip('Checked', 'Expiring or missing, with the drop-off events it affects.')}>Checked</TableHead>
        <Ladder columns={checkedCols} rows={checked} keyOf={(r) => r.hostId} onRow={(r) => open(paths.hostingRecord('host', r.hostId))} label={(r) => `Open ${r.host}`} sort={ck.sort} desc={ck.desc} onSort={ck.onSort} empty={<Blank />} />
      </View>

      <View>
        <TableHead tip={tip('Ratings', 'Hosts caught by the rating rule (Settings).')}>Ratings</TableHead>
        <Ladder columns={ratingsReason ? ratingCols.map((c) => ({ ...c, cellTip: () => ratingsReason })) : ratingCols}
                rows={ratingShown} keyOf={(r) => r.hostId} onRow={(r) => { if (!r.cantSpeak) open(paths.hostingRecord('host', r.hostId)); }} label={(r) => `Open ${r.host}`} sort={rt.sort} desc={rt.desc} onSort={rt.onSort} empty={<Blank />} />
      </View>

      <View>
        <TableHead tip={tip('Complaints and guarantee claims', 'Open ones. Resolving or declining is recorded in Changes.')}>Complaints and guarantee claims</TableHead>
        <Ladder columns={complaintCols} rows={complaints} keyOf={(r) => r.id} onRow={(r) => open(paths.hostingRecord('complaint', r.id))} label={(r) => `Open the ${KIND_OF_CLAIM[r.kind] ?? 'complaint'}`} sort={cl.sort} desc={cl.desc} onSort={cl.onSort} empty={<Blank />}
                highlight={(r) => closing?.id === r.id} />
        {closing && canManage ? (
          <View style={s.closing}>
            <TextInput value={why} onChangeText={setWhy} placeholder="Why" placeholderTextColor={colors.inkMuted}
                       style={s.input} accessibilityLabel="Why" autoFocus onSubmitEditing={close} />
            <Act label={closing.state === 'resolved' ? 'Resolve' : 'Decline'} tone="solid" onPress={close} disabled={busy} />
            <Act label="Cancel" tone="secondary" onPress={() => { setClosing(null); setFailed(null); }} disabled={busy} />
            {failed ? <Text style={[type.small, { color: red() }]}>{failed}</Text> : null}
          </View>
        ) : null}
      </View>

      <View>
        <TableHead tip={tip('ID asked again', 'Verified hosts Stripe is asking for ID again. Take it up in Stripe; the row goes when Stripe stops asking.')}>ID asked again</TableHead>
        <Ladder columns={askedCols} rows={askedAgain} keyOf={(r) => r.hostId} onRow={(r) => open(paths.hostingRecord('host', r.hostId))} label={(r) => `Open ${r.host}`} sort={ia.sort} desc={ia.desc} onSort={ia.onSort} empty={<Blank />} />
      </View>

      <View>
        <TableHead tip={tip('Host reports', 'Sent from a host’s profile or an event page. Open ones, newest first.')}>Host reports</TableHead>
        {reportError ? <Text style={[type.small, { color: red() }]}>{reportError}</Text> : null}
        <Ladder columns={reportCols} rows={reports} keyOf={(r) => r.id} onRow={(r) => open(paths.hostingRecord('host', r.hostId))} label={(r) => `Open ${r.host}`} sort={rp.sort} desc={rp.desc} onSort={rp.onSort} empty={<Blank />} />
      </View>

      <View>
        <TableHead tip={tip('Host no-shows', 'Open reports that the host did not come. Each holds the session’s payout until somebody resolves it; nothing is refunded automatically yet, so any refund is made by hand.')}>Host no-shows</TableHead>
        <Ladder columns={noShowCols} rows={noShows} keyOf={(r) => r.id} onRow={(r) => open(paths.hostingRecord('complaint', r.id))} label={() => 'Open the no-show report'} sort={ns.sort} desc={ns.desc} onSort={ns.onSort} empty={<Blank />} />
      </View>

      <View>
        <TableHead tip={tip('Incidents', 'During a session, especially with children. Kept for good: an incident can’t be deleted.')}>Incidents</TableHead>
        <Ladder columns={incidentCols} rows={incidents} keyOf={(r) => r.id} onRow={(r) => { const to = eventHref(r.offerId) ?? hostHref(r.hostId); if (to) open(to); }} label={() => 'Open the event it happened at'} sort={ic.sort} desc={ic.desc} onSort={ic.onSort} empty={<Blank />} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  num: { ...type.body, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  word: { ...type.body, fontSize: 13.5, color: colors.ink },
  closing: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 12 },
  input: { ...type.body, fontSize: 13.5, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.ruleMuted, paddingVertical: 6, minWidth: 320, flexGrow: 1, maxWidth: 560 },
});

