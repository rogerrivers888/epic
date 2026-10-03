/**
 * Hosting › Hosts (hosting v4): BO8c the list, and with ?host=<id> one host's
 * page with its own tabs (?htab=): Overview (BO8d), Profile and videos (BO8q),
 * Reviews (BO8r), Events, Money, Changes.
 *
 * Corrections from the handover (§3, §5) that override the artboards: "Host
 * type" is Kind; the fee goes by rating (20 / 15 / 10), never "Epic Trusted";
 * a host is paid 72 hours after each session — the number is the setting's,
 * read from the server, never written here.
 *
 * No prose on the screen: every column, figure and heading explains itself on
 * hover. An empty cell is a dash. Lines, not boxes — except the guest preview.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { useQueryState, asOneOf, asText, asFlag, useRouter } from '../../router';
import { colors, house, spacing, type, BORDER } from '../../theme';
import { Icon } from '../../components/Icon';
import { Press } from '../../components/press';
import { mediaUrl } from '../../components/hosting';
import { useViewport } from '../../hooks/useViewport';
import { Ladder, Num, Word, Blank, Act, Stat, Kicker, Tick, Progress, type Col } from '../table';
import { FilterRow, Dropdown, TextAction, type DropdownOption } from '../kit';
import { Explain, type Tip } from '../explain';
import { KIND_WORDS, KIND_OPTIONS, Opens, amberTone, liveTone, ownerAct, useLoad, useOpen, useSorted, gbp, when } from './kit';
import { paths } from '../../routes';

// ---------------------------------------------------------------------------
// shared with Events.tsx
// ---------------------------------------------------------------------------

/** A tip written in place. */
export const tip = (title: string, body: string): Tip => [title, body] as const;

/** Options for a Dropdown from a list and the value in force. */
export const optionsOf = (list: { key: string; label: string }[], value: string): DropdownOption[] =>
  list.map((o) => ({ key: o.key, label: o.label, on: o.key === value }));
export const labelOf = (list: { key: string; label: string }[], value: string) => list.find((o) => o.key === value)?.label ?? list[0]?.label ?? '';

/** A column's sort, held in the query under its own names so two tables never share one. */
export function useSortState(prefix: string, keys: readonly string[], dflt: string | null) {
  const [sort, setSort] = useQueryState<string | null>(`${prefix}sort`, dflt, { read: (r) => (keys.includes(r) ? r : null), write: (v) => (v == null || v === dflt ? null : v) });
  const [desc, setDesc] = useQueryState<boolean>(`${prefix}desc`, false, asFlag);
  const onSort = (k: string) => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(false); } };
  return { sort, desc, onSort };
}

export type Tone = 'plain' | 'live' | 'attention' | 'refusal' | 'muted';
/**
 * A state word in its colour role (handoff §1.10): lime for live, amber for
 * waiting or missing, red for refusal or mismatch only.
 */
export function Said({ children, tone = 'plain' }: { children: React.ReactNode; tone?: Tone }) {
  const c = tone === 'live' ? liveTone() : tone === 'attention' ? amberTone() : tone === 'refusal' ? colors.overrun : tone === 'muted' ? colors.inkMuted : colors.ink;
  return <Text numberOfLines={1} style={[s.word, { color: c }, (tone === 'live' || tone === 'attention' || tone === 'refusal') && { fontWeight: '700' }]}>{children}</Text>;
}

/** The search box at the end of a filter row: typed, then written to the query once the typing stops. */
export function SearchBox({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (text === value) return undefined;
    const t = setTimeout(() => onCommit(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={s.search}>
      <Icon name="search" size={13} color={colors.inkMuted} strokeWidth={2.2} />
      <TextInput value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={colors.inkMuted}
                 accessibilityLabel={placeholder} style={s.searchInput} />
    </View>
  );
}

/** One fact: what it is on the left, what it says on the right, on one line. */
export function Fact({ label, tip: t, children }: { label: string; tip?: Tip | null; children: React.ReactNode }) {
  return (
    <Explain tip={t ?? null} style={s.fact}>
      <Text style={s.factLabel} numberOfLines={1}>{label}</Text>
      <View style={s.factValue}>{typeof children === 'string' ? <Text style={s.factText} numberOfLines={1}>{children}</Text> : children}</View>
    </Explain>
  );
}

/** A block: an uppercase kicker over a 2px rule, the facts hanging under it. */
export function Block({ title, tip: t, children, basis = 300 }: { title: string; tip?: Tip | null; children: React.ReactNode; basis?: number }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: basis, minWidth: 0, gap: 0 }}>
      <View style={s.blockHead}><Kicker tip={t ?? null}>{title}</Kicker></View>
      {children}
    </View>
  );
}

/** The way back to a list, with how many it holds. */
export function Back({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press effect="none" onPress={onPress} accessibilityRole="link" accessibilityLabel={label} style={s.back}>
      <Icon name="back" size={13} color={colors.inkMuted} strokeWidth={2.2} />
      <Text style={s.backWord}>{label}</Text>
    </Press>
  );
}

/** The band at the top of a page: kicker, title, and its figures on the right. */
export function Band({ kicker, kickerTip, title, stats }: {
  kicker: string; kickerTip?: Tip | null; title: string; stats: { label: string; value: React.ReactNode; tip: Tip }[];
}) {
  const { width } = useViewport();
  return (
    <View style={s.band}>
      <View style={{ flexGrow: 1, flexBasis: 260, minWidth: 0, gap: 4 }}>
        <Kicker tip={kickerTip ?? null}>{kicker}</Kicker>
        <Text style={[s.title, width < 900 && s.titlePhone]} numberOfLines={1}>{title}</Text>
      </View>
      <View style={s.stats}>
        {stats.map((x) => <Stat key={x.label} label={x.label} value={x.value} tip={x.tip} />)}
      </View>
    </View>
  );
}

/** Something that did not load, or was refused, said plainly. */
export const Failed = ({ children }: { children: React.ReactNode }) => <Text style={s.failed}>{children}</Text>;
export const Waiting = () => <Text style={s.waiting}>Loading…</Text>;

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);
export const stars = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1));
const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).replace(/_/g, ' ') : w);
export const stateWord = (st: string | null | undefined, waitingOn?: string[] | null) => (st ? ({
  draft: 'Draft', in_review: 'In review', approved: `Approved · waiting on ${(waitingOn ?? []).join(', ') || 'Checked'}`, live: 'Live', paused: 'Paused', ended: 'Ended',
  called_off: 'Called off', declined: 'Declined', changes_requested: 'Changes asked for',
} as Record<string, string>)[st] ?? cap(st) : '—');
export const stateTone = (st: string | null | undefined): Tone => (st === 'live' ? 'live' : st === 'approved' || st === 'in_review' ? 'attention' : st === 'called_off' ? 'refusal' : st === 'ended' ? 'muted' : 'plain');

// ---------------------------------------------------------------------------
// payloads
// ---------------------------------------------------------------------------

type HostRow = {
  id: string; name: string; town: string | null; hosting: 'Public' | 'Private only' | null; kinds: string[];
  live: number; rating: number | null; feeNow: number | null; verified: boolean; checked: string; payouts: string; tax: boolean;
  status: 'hosting' | 'not_live' | 'paused' | 'stopped';
};
type HostsPayload = { rows: HostRow[]; capped: boolean };

type Progress = {
  rate: number; ratedEvents: number; avg: number | null;
  next: { pct: number; ratedEvents: number; avgAtLeast: number; eventsToGo: number; avgOk: boolean } | null;
} | null;

type HostDetail = {
  host: { id: string; name: string; town: string | null; photo: string | null; since: string | null; paused: boolean; stopped: boolean; adult: boolean | null };
  trust: {
    verified: { state: string; on: string | null };
    checked: { state: string; level: string | null; on: string | null; submittedAt: string | null };
    insurance: { expires: string | null };
  };
  money: {
    stripe: string; tax: string | null; takenPence: number; epicPence: number; paidOutPence: number;
    nextPayout: { pence: number; on: string | null; state: string; holdReason: string | null } | null;
  };
  fee: { override: number | null; progress: Progress; now: number | null; intro: { daysLeft: number; bookingsLeft: number } | null };
  ratings: { reviews: number; avg: number | null; ratedEvents: number };
  standing: { words: string | null; level?: string; reason?: string };
  events: { id: string; title: string; kind: string | null; state: string; visibility: string; startsOn: string | null }[];
  canRemove: boolean;
  outstanding: { bookings: number; payouts: number };
};

type Video = {
  id: string; where: string; offerId?: string; url: string | null; uploaded: string | null; seconds: number | null;
  ai: string | null; reasons?: string[]; approvedAt?: string | null; transcript: string | null;
};
type VideosPayload = { profile: { name: string; town: string | null; photo: string | null; line: string | null }; videos: Video[] };

type Review = { id: string; date: string | null; event: string; offerId: string; household: string; householdId?: string; bookingId?: string | null; rating: number | null; review: string | null; reply: string | null; shown: boolean };
type ReviewsPayload = { rows: Review[]; capped: boolean };

type Change = { id: string; subjectKind: string; subjectId: string; field: string; before: unknown; after: unknown; why: string | null; by: string | null; byLabel: string | null; approvalId: string | null; at: string };
type ChangesPayload = { changes: Change[]; limit: number; capped: boolean };

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------

const STATUS = [{ key: 'all', label: 'All' }, { key: 'hosting', label: 'Hosting' }, { key: 'not_live', label: 'Not live' }, { key: 'paused', label: 'Paused' }, { key: 'stopped', label: 'Removed' }];
const STATUS_KEYS = STATUS.map((o) => o.key);
const HOSTING = [{ key: 'all', label: 'All' }, { key: 'public', label: 'Public' }, { key: 'private', label: 'Private only' }];
const FLAG = [{ key: 'none', label: 'None' }, { key: 'checked', label: 'Checked needed' }, { key: 'tax', label: 'Missing tax details' }, { key: 'rating', label: 'Rating below 4' }];
const KIND_KEYS = KIND_OPTIONS.map((o) => o.key);
const STATUS_WORD: Record<HostRow['status'], string> = { hosting: 'Hosting', not_live: 'Not live', paused: 'Paused', stopped: 'Removed' };
const statusTone = (st: HostRow['status']): Tone => (st === 'hosting' ? 'live' : st === 'paused' ? 'attention' : st === 'stopped' ? 'muted' : 'plain');

const CHECKED_WORD: Record<string, string> = { none: '—', submitted: 'Submitted', passed: 'Passed', failed: 'Failed' };
const IDENTITY_WORD: Record<string, string> = { none: '—', pending: 'Pending', verified: 'Verified', failed: 'Failed' };
const STRIPE_WORD: Record<string, string> = { none: 'Not started', pending: 'Pending', ready: 'Active' };
const PAYOUT_WORD: Record<string, string> = { scheduled: 'Scheduled', held: 'Held', released: 'Released', paid: 'Paid', failed: 'Failed' };

const HOST_TABS = ['overview', 'profile', 'reviews', 'events', 'money', 'changes'] as const;
type HostTab = typeof HOST_TABS[number];
const HOST_TAB_WORDS: Record<HostTab, string> = { overview: 'Overview', profile: 'Profile and videos', reviews: 'Reviews', events: 'Events', money: 'Money', changes: 'Changes' };

// ---------------------------------------------------------------------------
// BO8c — the list
// ---------------------------------------------------------------------------

export function HostsTab({ canManage }: { canManage: boolean }) {
  const [host, setHost] = useQueryState<string | null>('host', null, asText);
  if (host) return <HostPage id={host} canManage={canManage} onBack={() => setHost(null, { replace: false })} />;
  return <HostList onOpen={(id) => setHost(id, { replace: false })} />;
}

const HOST_SORTS = ['name', 'hosting', 'live', 'rating', 'fee', 'verified', 'checked', 'payouts', 'tax', 'status'] as const;

function HostList({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useQueryState('hstatus', 'all', asOneOf(STATUS_KEYS, 'all'));
  const [kind, setKind] = useQueryState('hkind', 'all', asOneOf(KIND_KEYS, 'all'));
  const [hosting, setHosting] = useQueryState('hhosting', 'all', asOneOf(['all', 'public', 'private'], 'all'));
  const [flag, setFlag] = useQueryState('hflag', 'none', asOneOf(['none', 'checked', 'tax', 'rating'], 'none'));
  const [q, setQ] = useQueryState<string>('hq', '', asText);
  const { sort, desc, onSort } = useSortState('h', HOST_SORTS, null);

  const { data, error } = useLoad<HostsPayload>(() => api.hostingAdmin<HostsPayload>('/hosts', {
    status: status === 'all' ? null : status, kind: kind === 'all' ? null : kind,
    hosting: hosting === 'all' ? null : hosting, flag: flag === 'none' ? null : flag, q: q || null,
  }), [status, kind, hosting, flag, q]);

  const rows = useSorted(data?.rows, sort, desc, (r, k) => {
    switch (k) {
      case 'name': return r.name;
      case 'hosting': return r.hosting;
      case 'live': return r.live;
      case 'rating': return r.rating;
      case 'fee': return r.feeNow;
      case 'verified': return r.verified ? 1 : 0;
      case 'checked': return r.checked === 'none' ? null : r.checked;
      case 'payouts': return r.payouts;
      case 'tax': return r.hosting ? (r.tax ? 1 : 0) : null;
      case 'status': return STATUS_WORD[r.status];
      default: return null;
    }
  });

  const all = data?.rows ?? [];
  const n = (k: number) => (data?.capped ? `${k}+` : String(k));
  const columns: Col<HostRow>[] = [
    { key: 'name', label: 'Host', sort: 'name', grow: true, tip: tip('Host', 'Name and where they host. Opens everything about them.'),
      cell: (r) => (
        <Text numberOfLines={1} style={s.word}>
          <Text style={s.strong}>{r.name}</Text>
          {r.town ? <Text style={{ color: colors.inkMuted }}>{`  ${r.town}`}</Text> : null}
        </Text>
      ) },
    { key: 'hosting', label: 'Hosting', sort: 'hosting', width: 110, tip: tip('Hosting', 'Public, or private only. A dash: nothing past a draft yet.'),
      cell: (r) => (r.hosting ? <Word>{r.hosting}</Word> : <Blank />) },
    { key: 'live', label: 'Live', sort: 'live', width: 56, align: 'right', tip: tip('Live', 'Events live now.'), cell: (r) => <Num n={r.live || null} /> },
    { key: 'rating', label: 'Rating', sort: 'rating', width: 66, align: 'right', tip: tip('Rating', 'Average across rated events, reviews shown only.'),
      cell: (r) => (r.rating == null ? <Blank /> : <Said tone={r.rating < 4 ? 'attention' : 'plain'}>{stars(r.rating)}</Said>) },
    { key: 'fee', label: 'Fee now', sort: 'fee', width: 78, align: 'right', tip: tip('Fee now', 'Her own commission on public bookings made today: 20% to start, 15% after 5 rated events averaging 4.5, 10% after 10 averaging 4.8, or an override. 0% in the intro. A dash: no public events.'),
      cell: (r) => (r.feeNow == null ? <Blank /> : <Text style={s.num}>{pct(r.feeNow)}</Text>) },
    { key: 'verified', label: 'Verified', sort: 'verified', width: 76, align: 'centre', tip: tip('Verified', 'Stripe identity check passed.'),
      cell: (r) => (r.verified ? <Tick on /> : <Blank />) },
    { key: 'checked', label: 'Checked', sort: 'checked', width: 96, align: 'centre', tip: tip('Checked', 'DBS, insurance and references. Only needed for drop off.'),
      cell: (r) => (r.checked === 'passed' ? <Tick on /> : r.checked === 'none' ? <Blank /> : <Said tone={r.checked === 'failed' ? 'refusal' : 'attention'}>{CHECKED_WORD[r.checked] ?? r.checked}</Said>) },
    { key: 'payouts', label: 'Payouts', sort: 'payouts', width: 86, align: 'centre', tip: tip('Payouts', 'Stripe Connect active, so payouts can be sent.'),
      cell: (r) => (r.payouts === 'ready' ? <Tick on /> : r.payouts === 'pending' ? <Said tone="attention">Pending</Said> : <Blank />) },
    { key: 'tax', label: 'Tax details', sort: 'tax', width: 92, align: 'centre', tip: tip('Tax details', 'On file for DAC7. Payouts are held without them.'),
      cell: (r) => (r.tax ? <Tick on /> : r.hosting ? <Said tone="attention">Missing</Said> : <Blank />) },
    { key: 'status', label: 'Status', sort: 'status', width: 96, tip: tip('Status', 'Hosting (something live), not live, paused, or removed.'),
      cell: (r) => <Said tone={statusTone(r.status)}>{STATUS_WORD[r.status]}</Said> },
  ];

  return (
    <View style={{ gap: 16 }}>
      <Band kicker="Hosting · Hosts" title={data ? `${n(all.length)} ${all.length === 1 ? 'host' : 'hosts'}` : 'Hosts'}
            stats={[
              { label: 'Public', value: data ? n(all.filter((r) => r.hosting === 'Public').length) : '—', tip: tip('Public', 'Of the hosts listed, those with at least one public event.') },
              { label: 'Private only', value: data ? n(all.filter((r) => r.hosting === 'Private only').length) : '—', tip: tip('Private only', 'Of the hosts listed, those who have only ever hosted private events.') },
              { label: 'Missing tax', value: data ? n(all.filter((r) => r.hosting && !r.tax).length) : '—', tip: tip('Missing tax', 'Of the hosts listed, those hosting with no tax details on file. Their payouts are held.') },
              { label: 'Rating below 4', value: data ? n(all.filter((r) => r.rating != null && r.rating < 4).length) : '—', tip: tip('Rating below 4', 'Of the hosts listed, those whose average is under 4.') },
            ]} />
      <FilterRow>
        <Dropdown label="STATUS" value={labelOf(STATUS, status)} options={optionsOf(STATUS, status)} onPick={(k) => setStatus(k)} width={200} />
        <Dropdown label="KIND" value={labelOf(KIND_OPTIONS, kind)} options={optionsOf(KIND_OPTIONS, kind)} onPick={(k) => setKind(k)} width={200} />
        <Dropdown label="HOSTING" value={labelOf(HOSTING, hosting)} options={optionsOf(HOSTING, hosting)} onPick={(k) => setHosting(k)} width={200} />
        <Dropdown label="FLAG" value={labelOf(FLAG, flag)} options={optionsOf(FLAG, flag)} onPick={(k) => setFlag(k)} width={220} />
        <SearchBox value={q} onCommit={(v) => setQ(v)} placeholder="Name or town" />
      </FilterRow>
      {error ? <Failed>{error}</Failed> : !data ? <Waiting /> : (
        <Ladder columns={columns} rows={rows} keyOf={(r) => r.id} onRow={(r) => onOpen(r.id)} label={(r) => `Open ${r.name}`}
                sort={sort} desc={desc} onSort={onSort} dense
                phoneRow={(r) => ({
                  name: r.name, note: r.town ?? undefined,
                  chips: [
                    { key: 'status', word: STATUS_WORD[r.status], lead: true, tip: columns[9].tip },
                    ...(r.hosting ? [{ key: 'hosting', word: r.hosting, tip: columns[1].tip }] : []),
                    ...(r.feeNow != null ? [{ key: 'fee', word: `fee ${pct(r.feeNow)}`, tip: columns[4].tip }] : []),
                    ...(r.rating != null ? [{ key: 'rating', word: `rated ${stars(r.rating)}`, tip: columns[3].tip }] : []),
                  ],
                })}
                empty={<Blank />} />
      )}
      {data?.capped ? <Explain tip={tip('The first 1,000', 'The list stops at 1,000 hosts, newest first. Narrow the filters to see the rest.')}><Word muted>First 1,000 only</Word></Explain> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// one host — the page and its tabs
// ---------------------------------------------------------------------------

function HostPage({ id, canManage, onBack }: { id: string; canManage: boolean; onBack: () => void }) {
  const [tab, setTab] = useQueryState<HostTab>('htab', 'overview', asOneOf(HOST_TABS, 'overview'));
  const { data, error, reload } = useLoad<HostDetail>(() => api.hostingAdmin<HostDetail>(`/hosts/${encodeURIComponent(id)}`), [id]);

  if (error) return <View style={{ gap: 14 }}><Back label="Hosts" onPress={onBack} /><Failed>{error}</Failed></View>;
  if (!data) return <View style={{ gap: 14 }}><Back label="Hosts" onPress={onBack} /><Waiting /></View>;

  const h = data.host;
  const isPublic = data.events.some((e) => e.visibility === 'public' && e.state !== 'draft');
  const hosting = isPublic ? 'Public' : data.events.some((e) => e.state !== 'draft') ? 'Private only' : null;
  const live = data.events.filter((e) => e.state === 'live').length;
  const feeNow = !isPublic ? null : data.fee.now ?? null;
  const kicker = ['Host', hosting, h.town, h.stopped ? 'Removed' : h.paused ? 'Paused' : null].filter(Boolean).join(' · ');

  return (
    <View style={{ gap: 16 }}>
      <Back label="Hosts" onPress={onBack} />
      <Band kicker={kicker} title={h.name}
            stats={[
              { label: 'Live', value: live ? String(live) : '—', tip: tip('Live', 'Events live now.') },
              { label: 'Rating', value: stars(data.ratings.avg), tip: tip('Rating', `Average across ${data.ratings.ratedEvents} rated events, ${data.ratings.reviews} reviews shown.`) },
              { label: 'Fee now', value: pct(feeNow), tip: tip('Fee now', data.fee.override != null ? 'Her fee is overridden: this rate, on public bookings made from today.' : 'The step her rating has reached, or 0% while her intro lasts, on public bookings made from today. A dash: no public events.') },
              { label: 'Paid out', value: gbp(data.money.paidOutPence || null), tip: tip('Paid out', 'Total paid to her, all time.') },
              { label: 'Standing', value: data.standing.words ?? '—', tip: tip('Standing', data.standing.words ? 'Good, at risk, or under review — from her rating, late changes and open complaints.' : data.standing.reason ?? 'Not enough to say.') },
            ]} />
      <SubTabs value={tab} onPick={(t) => setTab(t)} />
      {tab === 'overview' ? <Overview d={data} canManage={canManage} hosting={hosting} reload={reload} onReviews={() => setTab('reviews')} /> : null}
      {tab === 'profile' ? <ProfileAndVideos id={id} /> : null}
      {tab === 'reviews' ? <Reviews id={id} canManage={canManage} /> : null}
      {tab === 'events' ? <HostEvents d={data} /> : null}
      {tab === 'money' ? <HostMoney d={data} isPublic={isPublic} /> : null}
      {tab === 'changes' ? <HostChanges id={id} /> : null}
    </View>
  );
}

function SubTabs({ value, onPick }: { value: HostTab; onPick: (t: HostTab) => void }) {
  return (
    <View style={s.subTabs}>
      {HOST_TABS.map((k) => (
        <Press key={k} effect="none" onPress={() => onPick(k)} accessibilityRole="tab" accessibilityState={{ selected: value === k }}
               style={[s.subTab, value === k && s.subTabOn]}>
          <Text style={[s.subTabWord, value === k && s.subTabWordOn]}>{HOST_TAB_WORDS[k]}</Text>
        </Press>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO8d — overview
// ---------------------------------------------------------------------------

function Overview({ d, canManage, hosting, reload, onReviews }: { d: HostDetail; canManage: boolean; hosting: string | null; reload: () => void; onReviews: () => void }) {
  const t = d.trust;
  const p = d.fee.progress;
  return (
    <View style={{ gap: 26 }}>
      <View style={s.blocks}>
        <Block title="Profile">
          <Fact label="Age" tip={tip('Age', 'Her date of birth confirms she is over 18. The date is never shown.')}>
            {d.host.adult == null ? <Blank /> : d.host.adult ? <Said>18+</Said> : <Said tone="refusal">Under 18</Said>}
          </Fact>
          <Fact label="Joined" tip={tip('Joined', 'When her host profile was made.')}>{when(d.host.since?.slice(0, 10))}</Fact>
          <Fact label="Hosts in" tip={tip('Hosts in', 'The town on her profile.')}>{d.host.town ?? '—'}</Fact>
          <Fact label="Hosting" tip={tip('Hosting', 'Public, or private only.')}>{hosting ?? '—'}</Fact>
        </Block>
        <Block title="Trust">
          <Fact label="Verified" tip={tip('Verified', 'Identity check through Stripe. Result and date only.')}>
            {t.verified.state === 'verified' ? <Said>{`Stripe · ${when(t.verified.on)}`}</Said>
              : t.verified.state === 'none' ? <Blank /> : <Said tone={t.verified.state === 'failed' ? 'refusal' : 'attention'}>{IDENTITY_WORD[t.verified.state] ?? t.verified.state}</Said>}
          </Fact>
          <Fact label="Checked" tip={tip('Checked', 'DBS, insurance and references. Needed for drop-off events.')}>
            {t.checked.state === 'passed' ? <Said>{[t.checked.level?.toUpperCase(), when(t.checked.on)].filter(Boolean).join(' · ')}</Said>
              : t.checked.state === 'submitted' ? <Said tone="attention">{`Submitted · ${when(t.checked.submittedAt)}`}</Said>
                : t.checked.state === 'failed' ? <Said tone="refusal">Failed</Said> : <Blank />}
          </Fact>
          <Fact label="Insurance" tip={tip('Insurance', 'The date her cover runs to.')}>{t.insurance.expires ? `To ${when(t.insurance.expires)}` : '—'}</Fact>
        </Block>
        <Block title="Money">
          <MoneyFacts d={d} />
        </Block>
      </View>

      <View style={s.blocks}>
        <Block title={d.fee.override != null ? `Fee · ${pct(d.fee.override)} · override` : p ? `Fee · ${pct(p.rate)}` : 'Fee'}
               tip={tip(d.fee.override != null ? 'Overridden' : `Why ${p ? pct(p.rate) : 'a dash'}`,
                 d.fee.override != null ? 'Set by the owner with a reason; see Changes. Bookings made after it only.'
                   : p ? `${p.ratedEvents} rated events averaging ${p.avg ?? '—'}. 20% to start, 15% after 5 rated events averaging 4.5 or more, 10% after 10 averaging 4.8 or more.`
                     : 'The fee steps are not set in Settings yet.')}>
          {!p ? <Fact label="Step">—</Fact> : !p.next ? (
            <Fact label="Next step" tip={tip('Next step', 'She is on the lowest step there is.')}>—</Fact>
          ) : (
            <>
              <Fact label={`To ${pct(p.next.pct)}`} tip={tip(`To ${pct(p.next.pct)}`, `${p.next.ratedEvents} rated events averaging ${p.next.avgAtLeast} or more.`)}>
                <Said>{p.next.eventsToGo ? `${p.next.eventsToGo} rated events to go` : p.next.avgOk ? 'Reached' : 'Events reached · average not yet'}</Said>
              </Fact>
              <Meter label="Rated events" now={p.ratedEvents} of={p.next.ratedEvents} words={`${p.ratedEvents} of ${p.next.ratedEvents}`}
                     t={tip('Rated events', 'Events with at least one rating shown, against the number the next step needs.')} />
              <Meter label="Average" now={p.avg ?? 0} of={p.next.avgAtLeast} words={`${p.avg == null ? '—' : p.avg.toFixed(1)} of ${p.next.avgAtLeast}`}
                     t={tip('Average', 'Her average rating, against the average the next step needs.')} />
            </>
          )}
        </Block>
        <Block title="Ratings">
          <Fact label="Average" tip={tip('Average', 'Across rated events, reviews shown only.')}>{stars(d.ratings.avg)}</Fact>
          <Fact label="Reviews" tip={tip('Reviews', 'Reviews shown to guests. Every review, hidden ones too, is on Reviews.')}>
            <Press effect="none" onPress={onReviews} accessibilityRole="link">
              <Text style={s.factText}>{d.ratings.reviews ? `${d.ratings.reviews} · see all` : 'See all'}</Text>
            </Press>
          </Fact>
          <Fact label="Rated events" tip={tip('Rated events', 'Events with at least one rating shown.')}>{d.ratings.ratedEvents ? String(d.ratings.ratedEvents) : '—'}</Fact>
        </Block>
        <Block title="Standing">
          <Fact label="Now" tip={tip('Standing', d.standing.words ? 'Good, at risk, or under review — from her rating, late changes in 90 days and open complaints.' : d.standing.reason ?? 'Not enough to say.')}>
            {d.standing.words ? <Said tone={d.standing.level === 'good' ? 'plain' : 'attention'}>{d.standing.words}</Said> : <Blank />}
          </Fact>
        </Block>
      </View>

      <View>
        <View style={s.blockHead}><Kicker tip={tip('Events', 'Her events, most recently changed first.')}>{`Events · ${d.events.length}`}</Kicker></View>
        <EventsLadder events={d.events} />
      </View>

      <HostActions d={d} canManage={canManage} reload={reload} />
    </View>
  );
}

function Meter({ label, now, of, words, t }: { label: string; now: number; of: number; words: string; t: Tip }) {
  return (
    <Explain tip={t} style={s.fact}>
      <Text style={s.factLabel} numberOfLines={1}>{label}</Text>
      <View style={[s.factValue, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        <View style={{ width: 90 }}><Progress of={of ? now / of : 0} /></View>
        <Text style={s.factText} numberOfLines={1}>{words}</Text>
      </View>
    </Explain>
  );
}

function MoneyFacts({ d }: { d: HostDetail }) {
  const m = d.money;
  const np = m.nextPayout;
  return (
    <>
      <Fact label="Stripe Connect" tip={tip('Stripe Connect', 'Her payout account. Epic never holds bank details.')}>
        <Said tone={m.stripe === 'ready' ? 'plain' : m.stripe === 'pending' ? 'attention' : 'muted'}>{STRIPE_WORD[m.stripe] ?? m.stripe}</Said>
      </Fact>
      <Fact label="Tax details" tip={tip('Tax details', 'Held for the DAC7 return. Masked here.')}>
        {m.tax ? <Said>{m.tax}</Said> : <Said tone="attention">Missing</Said>}
      </Fact>
      <Fact label="Taken" tip={tip('Taken', 'Charges that succeeded on her events, all time.')}>{gbp(m.takenPence || null)}</Fact>
      <Fact label="Epic took" tip={tip('Epic took', 'Epic’s share of those charges, at each booking’s own rate.')}>{gbp(m.epicPence || null)}</Fact>
      <Fact label="Paid out" tip={tip('Paid out', 'Total paid to her, all time.')}>{gbp(m.paidOutPence || null)}</Fact>
      <Fact label="Next payout" tip={tip('Next payout', np?.state === 'held' ? `Held: ${np.holdReason ?? 'no reason recorded'}.` : 'Released after each session at the time set in Settings if nobody has complained, or earlier on a guest’s yes or a review. A complaint holds it.')}>
        {np ? <Said tone={np.state === 'held' ? 'attention' : 'plain'}>{`${gbp(np.pence)} · ${np.state === 'held' ? 'held' : when(np.on)}`}</Said> : <Blank />}
      </Fact>
    </>
  );
}

type ActKind = 'pause' | 'fee' | 'remove';

function HostActions({ d, canManage, reload }: { d: HostDetail; canManage: boolean; reload: () => void }) {
  const [acting, setActing] = useState<ActKind | null>(null);
  const [why, setWhy] = useState('');
  const [feePct, setFeePct] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; words: string } | null>(null);
  const h = d.host;

  const open = (k: ActKind) => { setActing(acting === k ? null : k); setWhy(''); setFeePct(d.fee.override == null ? '' : String(d.fee.override)); setSaid(null); };
  const send = async () => {
    if (!acting) return;
    setBusy(true); setSaid(null);
    try {
      if (acting === 'pause') {
        await api.hostingAdminPost(`/hosts/${h.id}/pause`, { paused: !h.paused, why: why.trim() || null });
        setSaid({ ok: true, words: h.paused ? 'Hosting resumed' : 'Hosting paused' });
      } else if (acting === 'fee') {
        const v = feePct.trim() === '' ? null : Number(feePct.trim().replace('%', ''));
        if (v != null && !(Number.isFinite(v) && v >= 0 && v <= 100)) { setSaid({ ok: false, words: 'A percentage, 0 to 100, or blank for none.' }); setBusy(false); return; }
        const out = await ownerAct('POST', `/hosts/${h.id}/fee-override`, { pct: v, why: why.trim() },
          { change: v == null ? `Clear ${h.name}’s fee override` : `Set ${h.name}’s fee to ${pct(v)} on bookings made after approval`, why: why.trim(), affected: { count: 1, unit: 'hosts' } });
        setSaid({ ok: true, words: out === 'filed' ? 'Sent to Approvals' : v == null ? 'Override cleared' : `Fee set to ${pct(v)}` });
      } else {
        const out = await ownerAct('POST', `/hosts/${h.id}/remove`, { why: why.trim() },
          { change: `Remove ${h.name} as a host and end their events`, why: why.trim(), affected: { count: 1, unit: 'hosts' } });
        setSaid({ ok: true, words: out === 'filed' ? 'Sent to Approvals' : 'Host removed' });
      }
      setActing(null);
      reload();
    } catch (e: any) {
      setSaid({ ok: false, words: e?.message ?? 'That didn’t go through.' });
    } finally { setBusy(false); }
  };

  const removeTip = d.canRemove
    ? tip('Remove host', 'Needs the owner signed in and a reason. Goes to Approvals.')
    : tip('Remove host', `Refused while bookings or payouts are outstanding: ${d.outstanding.bookings} bookings and ${d.outstanding.payouts} payouts.`);

  return (
    <View style={{ gap: 12, borderTopWidth: BORDER, borderTopColor: colors.ruleMuted, paddingTop: 15 }}>
      <View style={s.actions}>
        {canManage && !h.stopped ? <Act label={h.paused ? 'Resume hosting' : 'Pause hosting'} icon={h.paused ? 'play' : 'pause'} tone="secondary" onPress={() => open('pause')} /> : null}
        {!h.stopped ? (
          <Explain tip={tip('Override fee', 'Needs the owner signed in and a reason. Goes to Approvals. Bookings made after it only.')} cursor="pointer">
            <Act label="Override fee" icon="locked" tone="secondary" onPress={() => open('fee')} />
          </Explain>
        ) : null}
        {!h.stopped ? (
          <Explain tip={removeTip} cursor={d.canRemove ? 'pointer' : 'help'}>
            <Act label="Remove host" icon="locked" tone="secondary" disabled={!d.canRemove} onPress={() => open('remove')} />
          </Explain>
        ) : null}
      </View>
      {acting ? (
        <View style={s.form}>
          {acting === 'fee' ? (
            <TextInput value={feePct} onChangeText={setFeePct} placeholder="% · blank for none" placeholderTextColor={colors.inkMuted}
                       keyboardType="numeric" accessibilityLabel="Fee override, percent" style={[s.input, { width: 140 }]} />
          ) : null}
          <TextInput value={why} onChangeText={setWhy} placeholder={acting === 'pause' ? 'Why (optional)' : 'Why'} placeholderTextColor={colors.inkMuted}
                     accessibilityLabel="Why" style={[s.input, { flexGrow: 1, flexBasis: 220, minWidth: 0 }]} maxLength={500} />
          <Act label={acting === 'pause' ? (h.paused ? 'Resume' : 'Pause') : acting === 'fee' ? 'Set fee' : 'Remove'} tone="solid" small
               disabled={busy || (acting !== 'pause' && !why.trim())} onPress={send} />
          <TextAction label="Cancel" tone="muted" onPress={() => setActing(null)} />
        </View>
      ) : null}
      {said ? <Text style={[s.word, { color: said.ok ? colors.accent : colors.overrun }]}>{said.words}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// her events, and her money
// ---------------------------------------------------------------------------

type HostEvent = HostDetail['events'][number];

function EventsLadder({ events }: { events: HostEvent[] }) {
  const { setQuery } = useRouter();
  const [sort, setSort] = useState<string | null>(null);
  const [desc, setDesc] = useState(false);
  const rows = useSorted(events, sort, desc, (e, k) => (k === 'title' ? e.title : k === 'kind' ? (e.kind ? KIND_WORDS[e.kind] ?? e.kind : null) : k === 'state' ? stateWord(e.state) : k === 'starts' ? e.startsOn : k === 'vis' ? e.visibility : null));
  const columns: Col<HostEvent>[] = [
    { key: 'title', label: 'Event', sort: 'title', grow: true, tip: tip('Event', 'As titled by the host. Opens the event.'), cell: (e) => <Word strong>{e.title}</Word> },
    { key: 'kind', label: 'Kind', sort: 'kind', width: 100, tip: tip('Kind', 'One-off, weekly, course or on request.'),
      cell: (e) => (e.kind ? <Word>{KIND_WORDS[e.kind] ?? e.kind}</Word> : <Blank />) },
    { key: 'vis', label: 'Visibility', sort: 'vis', width: 100, tip: tip('Visibility', 'Public, or private.'), cell: (e) => <Word>{e.visibility === 'public' ? 'Public' : 'Private'}</Word> },
    { key: 'state', label: 'Status', sort: 'state', width: 210, tip: tip('Status', 'Draft, in review, approved and waiting on Checked, live, paused, called off or ended.'),
      cell: (e) => <Said tone={stateTone(e.state)}>{stateWord(e.state)}</Said> },
    { key: 'starts', label: 'Starts', sort: 'starts', width: 80, align: 'right', tip: tip('Starts', 'The first date it runs.'), cell: (e) => (e.startsOn ? <Text style={s.num}>{when(e.startsOn)}</Text> : <Blank />) },
  ];
  return (
    <Ladder columns={columns} rows={rows} keyOf={(e) => e.id} dense label={(e) => `Open ${e.title}`}
            onRow={(e) => setQuery({ tab: 'events', event: e.id, host: null, htab: null }, { replace: false })}
            sort={sort} desc={desc} onSort={(k) => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(false); } }}
            empty={<Blank />} />
  );
}

function HostEvents({ d }: { d: HostDetail }) {
  return <EventsLadder events={d.events} />;
}

function HostMoney({ d, isPublic }: { d: HostDetail; isPublic: boolean }) {
  const p = d.fee.progress;
  return (
    <View style={s.blocks}>
      <Block title="Money"><MoneyFacts d={d} /></Block>
      <Block title="Fee">
        <Fact label="Fee now" tip={tip('Fee now', 'Her rate on public bookings made from today. Each booking keeps the rate it was made at.')}>{pct(!isPublic ? null : d.fee.override ?? p?.rate ?? null)}</Fact>
        <Fact label="Override" tip={tip('Override', 'A rate the owner set by hand, with a reason; see Changes.')}>{pct(d.fee.override)}</Fact>
        <Fact label="Next step" tip={tip('Next step', 'The rate her rating earns next, and what it needs.')}>
          {p?.next ? `${pct(p.next.pct)} · ${p.next.ratedEvents} rated events at ${p.next.avgAtLeast}+` : '—'}
        </Fact>
      </Block>
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO8q — profile and every video
// ---------------------------------------------------------------------------

function ProfileAndVideos({ id }: { id: string }) {
  const { data, error } = useLoad<VideosPayload>(() => api.hostingAdmin<VideosPayload>(`/hosts/${encodeURIComponent(id)}/videos`), [id]);
  const [picked, setPicked] = useState<string | null>(null);
  const [transcript, setTranscript] = useState(false);
  const [sort, setSort] = useState<string | null>(null);
  const [desc, setDesc] = useState(false);
  const rows = useSorted(data?.videos, sort, desc, (v, k) => (k === 'where' ? v.where : k === 'len' ? v.seconds : k === 'up' ? v.uploaded : k === 'ai' ? v.ai : k === 'ok' ? v.approvedAt ?? null : null));
  if (error) return <Failed>{error}</Failed>;
  if (!data) return <Waiting />;
  const pr = data.profile;
  const photo = mediaUrl(pr.photo);
  const sel = data.videos.find((v) => v.id === picked) ?? null;
  const columns: Col<Video>[] = [
    { key: 'where', label: 'Video', sort: 'where', grow: true, tip: tip('Video', 'Where it is shown: her profile, an event, or an event’s hello.'), cell: (v) => <Word strong>{v.where}</Word> },
    { key: 'len', label: 'Length', sort: 'len', width: 70, align: 'right', tip: tip('Length', 'Minutes and seconds.'), cell: (v) => (v.seconds == null ? <Blank /> : <Text style={s.num}>{mmss(v.seconds)}</Text>) },
    { key: 'up', label: 'Uploaded', sort: 'up', width: 90, align: 'right', tip: tip('Uploaded', 'When she uploaded it.'), cell: (v) => (v.uploaded ? <Text style={s.num}>{when(v.uploaded.slice(0, 10))}</Text> : <Blank />) },
    { key: 'ai', label: 'AI verdict', sort: 'ai', width: 140, tip: tip('AI verdict', 'What the AI found when the video was submitted. A dash: not checked.'),
      cell: (v) => (v.ai ? <Said tone={v.ai === 'Clear' ? 'plain' : 'attention'}>{v.ai}</Said> : <Blank />),
      cellTip: (v) => (v.reasons?.length ? tip('AI verdict', v.reasons.join(' · ')) : null) },
    { key: 'ok', label: 'Approved', sort: 'ok', width: 90, align: 'right', tip: tip('Approved', 'When a person approved the event it belongs to.'), cell: (v) => (v.approvedAt ? <Text style={s.num}>{when(v.approvedAt.slice(0, 10))}</Text> : <Blank />) },
  ];
  return (
    <View style={s.blocks}>
      <Block title="Her profile, as guests see it" basis={340} tip={tip('As guests see it', 'Drawn on the household app’s own ground.')}>
        <View style={s.preview}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {photo ? <Image source={{ uri: photo }} style={s.face} accessibilityLabel={pr.name} />
              : <View style={[s.face, { backgroundColor: house.warm, alignItems: 'center', justifyContent: 'center' }]}><Text style={s.previewName}>{pr.name.charAt(0)}</Text></View>}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.previewName} numberOfLines={1}>{pr.name}</Text>
              {pr.town ? <Text style={s.previewMuted} numberOfLines={1}>{pr.town}</Text> : null}
            </View>
          </View>
          {pr.line ? <Text style={s.previewLine}>{pr.line}</Text> : null}
        </View>
      </Block>
      <Block title={`Every video she has uploaded · ${data.videos.length}`} basis={560}>
        <Ladder columns={columns} rows={rows} keyOf={(v) => v.id} dense onRow={(v) => { setPicked(picked === v.id ? null : v.id); setTranscript(false); }}
                highlight={(v) => v.id === picked} label={(v) => `Play ${v.where}`}
                sort={sort} desc={desc} onSort={(k) => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(false); } }}
                empty={<Blank />} />
        {sel ? (
          <View style={{ gap: 0, marginTop: 14 }}>
            <View style={s.blockHead}><Kicker>The one selected</Kicker></View>
            {Platform.OS === 'web' && mediaUrl(sel.url) ? (
              <View style={s.player}>
                {React.createElement('video', { key: sel.id, src: mediaUrl(sel.url) ?? undefined, controls: true, autoPlay: true, playsInline: true, preload: 'metadata', style: { width: '100%', height: '100%', objectFit: 'contain' } })}
              </View>
            ) : null}
            <Fact label="Video" tip={tip('Video', 'Where it is shown, and how long it runs.')}>{[sel.where, sel.seconds == null ? null : mmss(sel.seconds)].filter(Boolean).join(' · ')}</Fact>
            <Fact label="Uploaded" tip={tip('Uploaded', 'When she uploaded it.')}>{sel.uploaded ? when(sel.uploaded.slice(0, 10)) : '—'}</Fact>
            <Fact label="AI verdict" tip={tip('AI verdict', sel.reasons?.length ? sel.reasons.join(' · ') : 'What the AI found when the video was submitted.')}>{sel.ai ?? '—'}</Fact>
            <Fact label="Approved" tip={tip('Approved', 'When a person approved the event it belongs to.')}>{sel.approvedAt ? when(sel.approvedAt.slice(0, 10)) : '—'}</Fact>
            <Fact label="Transcript" tip={tip('Transcript', 'What she says in it, as the AI heard it.')}>
              {sel.transcript ? <TextAction label={transcript ? 'Close' : 'Open'} onPress={() => setTranscript(!transcript)} /> : <Blank />}
            </Fact>
            {transcript && sel.transcript ? <Text style={s.transcript}>{sel.transcript}</Text> : null}
          </View>
        ) : null}
      </Block>
    </View>
  );
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// BO8r — every review
// ---------------------------------------------------------------------------

const RATINGS = [{ key: 'all', label: 'All' }, ...[5, 4, 3, 2, 1].map((n) => ({ key: String(n), label: String(n) }))];
const SHOWN = [{ key: 'all', label: 'All' }, { key: 'shown', label: 'Shown' }, { key: 'hidden', label: 'Hidden' }];
const REVIEW_SORTS = ['date', 'event', 'household', 'rating', 'review', 'reply', 'shown'] as const;

function Reviews({ id, canManage }: { id: string; canManage: boolean }) {
  const { data, error, reload } = useLoad<ReviewsPayload>(() => api.hostingAdmin<ReviewsPayload>(`/hosts/${encodeURIComponent(id)}/reviews`), [id]);
  const [event, setEvent] = useQueryState<string>('revent', 'all', asText);
  const [rating, setRating] = useQueryState('rrating', 'all', asOneOf(RATINGS.map((r) => r.key), 'all'));
  const [shown, setShown] = useQueryState('rshown', 'all', asOneOf(['all', 'shown', 'hidden'], 'all'));
  const { sort, desc, onSort } = useSortState('r', REVIEW_SORTS, null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const open = useOpen();

  const events = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of data?.rows ?? []) if (!seen.has(r.offerId)) seen.set(r.offerId, r.event);
    return [{ key: 'all', label: 'All events' }, ...[...seen].map(([key, label]) => ({ key, label }))];
  }, [data]);
  const filtered = useMemo(() => (data?.rows ?? []).filter((r) =>
    (event === 'all' || r.offerId === event) && (rating === 'all' || r.rating === Number(rating))
    && (shown === 'all' || (shown === 'shown' ? r.shown : !r.shown))), [data, event, rating, shown]);
  const rows = useSorted(filtered, sort, desc, (r, k) => (k === 'date' ? r.date : k === 'event' ? r.event : k === 'household' ? r.household : k === 'rating' ? r.rating : k === 'review' ? r.review : k === 'reply' ? (r.reply ? 1 : 0) : k === 'shown' ? (r.shown ? 1 : 0) : null));

  const toggle = async (r: Review) => {
    setBusy(r.id); setFault(null);
    try { await api.hostingAdminPost(`/reviews/${r.id}/shown`, { shown: !r.shown }); reload(); }
    catch (e: any) { setFault(e?.message ?? 'That didn’t go through.'); }
    finally { setBusy(null); }
  };

  if (error) return <Failed>{error}</Failed>;
  if (!data) return <Waiting />;
  const dim = (r: Review, node: React.ReactNode) => (r.shown ? node : <View style={{ opacity: 0.45 }}>{node}</View>);
  const columns: Col<Review>[] = [
    { key: 'date', label: 'Date', sort: 'date', width: 64, tip: tip('Date', 'When the review was left.'), cell: (r) => dim(r, r.date ? <Word>{when(r.date)}</Word> : <Blank />) },
    { key: 'event', label: 'Event', sort: 'event', width: 220, tip: tip('Event', 'Which event it was for. Opens it; the rest of the row opens the booking it was left on.'), cell: (r) => dim(r, <Opens to={paths.hostingRecord('event', r.offerId)}>{r.event}</Opens>) },
    { key: 'household', label: 'Household', sort: 'household', width: 160, tip: tip('Household', 'Who left it. Opens their record in Customers.'), cell: (r) => dim(r, <Opens to={r.householdId ? paths.customer(r.householdId) : null}>{r.household}</Opens>) },
    { key: 'rating', label: 'Rating', sort: 'rating', width: 60, align: 'right', tip: tip('Rating', 'Out of 5.'), cell: (r) => dim(r, <Num n={r.rating} />) },
    { key: 'review', label: 'Review', sort: 'review', grow: true, tip: tip('Review', 'In their words. Hover for the full text.'),
      cellTip: (r) => (r.review ? tip('Review', r.review) : null),
      cell: (r) => dim(r, r.review ? <Text style={s.word} numberOfLines={1}>{r.review}</Text> : <Blank />) },
    { key: 'reply', label: 'Reply', sort: 'reply', width: 70, align: 'centre', tip: tip('Reply', 'Whether the host replied. Hover a tick for the reply.'),
      cellTip: (r) => (r.reply ? tip('Reply', r.reply) : null),
      cell: (r) => dim(r, r.reply ? <Tick on /> : <Blank />) },
    { key: 'shown', label: 'Shown', sort: 'shown', width: 120, stops: true, tip: tip('Shown', canManage ? 'Shown on the event page, or hidden by us. Press to change.' : 'Shown on the event page, or hidden by us.'),
      cell: (r) => (canManage ? (
        <Press effect="none" onPress={() => toggle(r)} disabled={busy === r.id} accessibilityRole="switch" accessibilityState={{ checked: r.shown }}
               accessibilityLabel={r.shown ? 'Hide this review' : 'Show this review'} style={s.toggleRow}>
          <View style={[s.toggle, r.shown && s.toggleOn]}><View style={[s.knob, r.shown && s.knobOn]} /></View>
          <Text style={[s.word, !r.shown && { color: colors.inkMuted }]}>{r.shown ? 'Shown' : 'Hidden'}</Text>
        </Press>
      ) : <Said tone={r.shown ? 'plain' : 'muted'}>{r.shown ? 'Shown' : 'Hidden'}</Said>) },
  ];
  return (
    <View style={{ gap: 12 }}>
      <FilterRow>
        <Dropdown label="EVENT" value={labelOf(events, event)} options={optionsOf(events, event)} onPick={(k) => setEvent(k)} width={300} />
        <Dropdown label="RATING" value={labelOf(RATINGS, rating)} options={optionsOf(RATINGS, rating)} onPick={(k) => setRating(k)} width={160} />
        <Dropdown label="SHOWN" value={labelOf(SHOWN, shown)} options={optionsOf(SHOWN, shown)} onPick={(k) => setShown(k)} width={160} />
      </FilterRow>
      {fault ? <Failed>{fault}</Failed> : null}
      <Ladder columns={columns} rows={rows} keyOf={(r) => r.id} dense sort={sort} desc={desc} onSort={onSort}
              // A review opens the booking it was left on, or its event when it names none (K15 §3).
              onRow={(r) => open(r.bookingId ? paths.hostingRecord('booking', r.bookingId) : paths.hostingRecord('event', r.offerId))}
              label={(r) => `Open what ${r.household}’s review was left on`}
              empty={<Word muted>No reviews match.</Word>} />
      <Explain tip={tip('Listed', data.capped ? 'The newest 500 reviews only.' : 'Hidden reviews stay listed, dimmed.')}>
        <Word muted>{`${rows.length} of ${data.rows.length}${data.capped ? '+' : ''}`}</Word>
      </Explain>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Changes — everything changed about this host
// ---------------------------------------------------------------------------

const brief = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v !== 'object') return String(v);
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 1) { const x = entries[0][1]; return x == null ? '—' : typeof x === 'boolean' ? (x ? 'Yes' : 'No') : String(x); }
  return JSON.stringify(v);
};
const FIELD_WORD: Record<string, string> = { paused: 'Paused', fee_override_pct: 'Fee override', removed: 'Removed' };

function HostChanges({ id }: { id: string }) {
  const open = useOpen();
  const { data, error } = useLoad<ChangesPayload>(() => api.hostingAdmin<ChangesPayload>('/changes', { kind: 'host', subject: id }), [id]);
  const [sort, setSort] = useState<string | null>(null);
  const [desc, setDesc] = useState(false);
  const rows = useSorted(data?.changes, sort, desc, (c, k) => (k === 'at' ? c.at : k === 'field' ? c.field : k === 'before' ? brief(c.before) : k === 'after' ? brief(c.after) : k === 'why' ? c.why : k === 'by' ? c.by : null));
  if (error) return <Failed>{error}</Failed>;
  if (!data) return <Waiting />;
  const columns: Col<Change>[] = [
    { key: 'at', label: 'When', sort: 'at', width: 110, tip: tip('When', 'When it was changed.'), cell: (c) => <Word>{when(c.at, true)}</Word> },
    { key: 'field', label: 'What', sort: 'field', width: 130, tip: tip('What', 'The thing that changed.'), cell: (c) => <Word strong>{FIELD_WORD[c.field] ?? cap(c.field)}</Word> },
    { key: 'before', label: 'Before', sort: 'before', width: 90, tip: tip('Before', 'Its value before.'), cell: (c) => <Text style={s.word} numberOfLines={1}>{brief(c.before)}</Text> },
    { key: 'after', label: 'After', sort: 'after', width: 90, tip: tip('After', 'Its value after.'), cell: (c) => <Text style={s.word} numberOfLines={1}>{brief(c.after)}</Text> },
    { key: 'why', label: 'Why', sort: 'why', grow: true, tip: tip('Why', 'The reason given. Hover for all of it.'), cellTip: (c) => (c.why ? tip('Why', c.why) : null),
      cell: (c) => (c.why ? <Text style={s.word} numberOfLines={1}>{c.why}</Text> : <Blank />) },
    { key: 'by', label: 'By', sort: 'by', width: 180, tip: tip('By', 'Who changed it, and the approval it went through if any.'),
      cellTip: (c) => (c.approvalId ? tip('Approval', c.approvalId) : null),
      cell: (c) => (c.by ? <Text style={s.word} numberOfLines={1}>{c.approvalId ? `${c.by} · approved` : c.by}</Text> : <Blank />) },
  ];
  return (
    <View style={{ gap: 10 }}>
      <Ladder columns={columns} rows={rows} keyOf={(c) => c.id} dense sort={sort} desc={desc}
              onSort={(k) => { if (sort === k) setDesc(!desc); else { setSort(k); setDesc(false); } }}
              // A change opens on Changes, filtered to everything changed about that same thing (K15 §3).
              onRow={(c) => open(paths.hosting('changes', { what: c.subjectKind, subject: c.subjectId }))} label={() => 'Every change to this host, on Changes'}
              empty={<Blank />} />
      {data.capped ? <Explain tip={tip('Newest only', `The newest ${data.limit} changes. Older ones are not in this list.`)}><Word muted>{`Newest ${data.limit} only`}</Word></Explain> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  word: { ...type.body, fontSize: 13.5, color: colors.ink },
  strong: { fontWeight: '700' },
  num: { ...type.body, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  failed: { ...type.small, color: colors.overrun },
  waiting: { ...type.small, color: colors.inkMuted },

  search: { flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderBottomColor: colors.ruleMuted, minHeight: 32, width: 220 },
  searchInput: { ...type.small, flex: 1, minWidth: 0, color: colors.ink, paddingVertical: 4, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null) },

  band: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.xl, flexWrap: 'wrap', borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, paddingBottom: 16 },
  title: { ...type.title, fontSize: 29, lineHeight: 32, letterSpacing: -1 },
  titlePhone: { fontSize: 24, lineHeight: 26 },
  stats: { flexDirection: 'row', alignItems: 'flex-end', gap: 30, flexWrap: 'wrap' },

  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  backWord: { ...type.small, color: colors.inkMuted, fontWeight: '600' },

  subTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, borderBottomWidth: 1, borderBottomColor: colors.ruleMuted },
  subTab: { paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  subTabOn: { borderBottomColor: colors.lime },
  subTabWord: { ...type.small, fontSize: 13.5, fontWeight: '500', color: colors.inkMuted },
  subTabWordOn: { fontWeight: '800', color: colors.ink },

  blocks: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 36, rowGap: 24, alignItems: 'flex-start' },
  blockHead: { paddingBottom: 8, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  factLabel: { ...type.small, fontSize: 13, color: colors.inkMuted, width: 120 },
  factValue: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  factText: { ...type.body, fontSize: 13.5, color: colors.ink, textAlign: 'right' },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  form: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  input: { ...type.small, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.ruleMuted, paddingVertical: 6, minHeight: 32, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null) },

  // The guest preview: the one place a box is allowed, on the household's own cream.
  preview: { marginTop: 12, backgroundColor: house.ground, padding: 18, gap: 12, borderWidth: 1, borderColor: house.rule },
  face: { width: 52, height: 52, borderRadius: 26 },
  previewName: { ...type.h2, fontSize: 18, color: house.ink },
  previewMuted: { ...type.small, color: house.inkMuted },
  previewLine: { ...type.body, fontSize: 14, color: house.ink },
  player: { height: 260, backgroundColor: colors.ink, marginTop: 10 },
  transcript: { ...type.small, color: colors.ink, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggle: { width: 28, height: 16, borderWidth: 1, borderColor: colors.ruleMuted, justifyContent: 'center', paddingHorizontal: 2 },
  toggleOn: { backgroundColor: colors.selected, borderColor: colors.selected },
  knob: { width: 10, height: 10, backgroundColor: colors.inkMuted },
  knobOn: { backgroundColor: colors.selectedFg, alignSelf: 'flex-end' },
});
