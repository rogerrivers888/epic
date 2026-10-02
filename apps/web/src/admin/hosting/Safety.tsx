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
import { useLoad, useSorted, gbp, when } from './kit';
import { Band, Loading, Said, TableHead, amber, red, tip, useSortParam } from './Money';

type Safety = {
  checked: { hostId: string; host: string; state: string; on: string | null; insuranceExpires: string | null; dropOffEvents: number }[];
  ratings: { hostId: string; host: string; avg: number | null; reviews: number }[] | null;
  ratingsReason: string | null;
  complaints: { id: string; kind: 'complaint' | 'guarantee_claim'; host: string | null; event: string | null; household: string | null; reason: string | null; at: string; autoPayLimit: number | null }[];
  noShows: { id: string; host: string | null; event: string | null; household: string | null; at: string }[];
  incidents: { id: string; host: string | null; event: string | null; children: string[]; reporter: 'host' | 'guest' | 'staff'; body: string; at: string }[];
};
type Checked = Safety['checked'][number];
type Rating = NonNullable<Safety['ratings']>[number] & { cantSpeak?: boolean };
type Complaint = Safety['complaints'][number];
type NoShow = Safety['noShows'][number];
type Incident = Safety['incidents'][number];

const CHECKED_WORDS: Record<string, string> = { none: 'Missing', submitted: 'Submitted', passed: 'Passed', failed: 'Failed' };
const KIND_OF_CLAIM: Record<string, string> = { complaint: 'Complaint', guarantee_claim: 'Guarantee claim' };
const REPORTER: Record<string, string> = { host: 'Host', guest: 'Guest', staff: 'Epic' };
const DAY = 86_400_000;
/** Days until a date, negative once it has gone. */
const daysTo = (d: string | null) => (d ? Math.floor((new Date(`${d}T23:59:59Z`).getTime() - Date.now()) / DAY) : null);

export function SafetyTab({ canManage }: { canManage: boolean }) {
  const { data, error, reload } = useLoad(() => api.hostingAdmin<Safety>('/safety'), []);
  const ck = useSortParam('ksort');
  const rt = useSortParam('tsort');
  const cl = useSortParam('csort');
  const ns = useSortParam('nsort');
  const ic = useSortParam('isort');

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

  if (!data) return <Loading error={error} reload={reload} />;

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
    { key: 'host', label: 'Host', sort: 'host', grow: true, tip: tip('Host', 'Hosts with an event for under-18s that is live, approved or in review.'), cell: (r) => <Word>{r.host}</Word> },
    { key: 'state', label: 'Checked', sort: 'state', width: 130, tip: tip('Checked', 'DBS and references. Missing or failed is red; submitted and not yet passed is amber.'),
      cell: (r) => <Said colour={r.state === 'none' || r.state === 'failed' ? red() : r.state === 'submitted' ? amber() : undefined}>{CHECKED_WORDS[r.state] ?? r.state}</Said> },
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
    { key: 'host', label: 'Host', sort: 'host', grow: true, tip: tip('Host', 'Hosts the rating rule has caught.'), cell: (r) => (r.cantSpeak ? <Blank /> : <Word>{r.host}</Word>) },
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
    { key: 'kind', label: 'What', sort: 'kind', width: 140, tip: tip('What', 'A complaint holds the host’s payout until it is resolved. A guarantee claim is paid automatically under the limit; above it, it goes to Approvals.'),
      cell: (r) => <Word>{KIND_OF_CLAIM[r.kind] ?? r.kind}</Word> },
    { key: 'household', label: 'Guest household', sort: 'household', width: 170, tip: tip('Guest household', 'Who raised it.'), cell: (r) => (r.household ? <Word>{r.household}</Word> : <Blank />) },
    { key: 'host', label: 'Host', sort: 'host', width: 150, tip: tip('Host', 'Whose event.'), cell: (r) => (r.host ? <Word>{r.host}</Word> : <Blank />) },
    { key: 'event', label: 'Event', sort: 'event', width: 200, tip: tip('Event', 'Which event.'), cell: (r) => (r.event ? <Word>{r.event}</Word> : <Blank />) },
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
    { key: 'host', label: 'Host', sort: 'host', width: 180, tip: tip('Host', 'Who did not turn up.'), cell: (r) => (r.host ? <Word>{r.host}</Word> : <Blank />) },
    { key: 'event', label: 'Event', sort: 'event', grow: true, tip: tip('Event', 'Which event. Every booking on it is refunded in full, automatically.'), cell: (r) => (r.event ? <Word>{r.event}</Word> : <Blank />) },
    { key: 'household', label: 'Reported by', sort: 'household', width: 180, tip: tip('Reported by', 'The household that said the host did not come.'), cell: (r) => (r.household ? <Word>{r.household}</Word> : <Blank />) },
    { key: 'at', label: 'Date', sort: 'at', width: 120, tip: tip('Date', 'When it was reported.'), cell: (r) => <Word>{when(r.at)}</Word> },
  ];

  // ---- Incidents: never deleted, so no action column at all.
  const incidentCols: Col<Incident>[] = [
    { key: 'at', label: 'When', sort: 'at', width: 120, tip: tip('When', 'When it was recorded.'), cell: (r) => <Word>{when(r.at, true)}</Word> },
    { key: 'host', label: 'Host', sort: 'host', width: 160, tip: tip('Host', 'Whose session.'), cell: (r) => (r.host ? <Word>{r.host}</Word> : <Blank />) },
    { key: 'event', label: 'Event', sort: 'event', width: 200, tip: tip('Event', 'Which event.'), cell: (r) => (r.event ? <Word>{r.event}</Word> : <Blank />) },
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
              tip={tip('Claim auto-pay limit', 'A guarantee claim under it is paid automatically; above it, it goes to Approvals. Set in Settings.')} />
        <Stat label="Caught by rating" value={data.ratings == null ? '—' : data.ratings.length.toLocaleString()}
              tip={data.ratings == null ? tip('Caught by rating', data.ratingsReason ?? 'The rating rule is not set yet.') : tip('Caught by rating', 'Hosts the rating rule has caught.')} />
        <Stat label="No-shows" value={data.noShows.length.toLocaleString()} tip={tip('No-shows', 'Open reports. Refunded in full automatically.')} />
      </Band>

      <View>
        <TableHead tip={tip('Checked', 'Expiring or missing, with the drop-off events it affects.')}>Checked</TableHead>
        <Ladder columns={checkedCols} rows={checked} keyOf={(r) => r.hostId} sort={ck.sort} desc={ck.desc} onSort={ck.onSort} empty={<Blank />} />
      </View>

      <View>
        <TableHead tip={tip('Ratings', 'Hosts caught by the rating rule (Settings).')}>Ratings</TableHead>
        <Ladder columns={ratingsReason ? ratingCols.map((c) => ({ ...c, cellTip: () => ratingsReason })) : ratingCols}
                rows={ratingShown} keyOf={(r) => r.hostId} sort={rt.sort} desc={rt.desc} onSort={rt.onSort} empty={<Blank />} />
      </View>

      <View>
        <TableHead tip={tip('Complaints and guarantee claims', 'Open ones. Resolving or declining is recorded in Changes.')}>Complaints and guarantee claims</TableHead>
        <Ladder columns={complaintCols} rows={complaints} keyOf={(r) => r.id} sort={cl.sort} desc={cl.desc} onSort={cl.onSort} empty={<Blank />}
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
        <TableHead tip={tip('Host no-shows', 'Refunded in full automatically.')}>Host no-shows</TableHead>
        <Ladder columns={noShowCols} rows={noShows} keyOf={(r) => r.id} sort={ns.sort} desc={ns.desc} onSort={ns.onSort} empty={<Blank />} />
      </View>

      <View>
        <TableHead tip={tip('Incidents', 'During a session, especially with children. Kept for good: an incident can’t be deleted.')}>Incidents</TableHead>
        <Ladder columns={incidentCols} rows={incidents} keyOf={(r) => r.id} sort={ic.sort} desc={ic.desc} onSort={ic.onSort} empty={<Blank />} />
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

