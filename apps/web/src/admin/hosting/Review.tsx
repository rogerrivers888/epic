/**
 * Hosting › Review (hosting v4, BO8a the queue, BO8b one event).
 *
 * The queue is the events a person has to read; `?event=<id>` opens one. The
 * handover's corrections apply (§3): "Host type" is **Kind** (One-off · Weekly
 * · Course · On request), and approving with anything missing makes the event
 * "Approved · waiting on …" — live once the last of it is done. Approve is
 * never blocked by the screen; the server alone refuses the one thing approval
 * cannot fix (a date already gone), and that refusal is shown as it is said.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { asOneOf, asText, useQueryState, useRouter } from '../../router';
import { withQuery } from '../../routes';
import { useViewport } from '../../hooks/useViewport';
import { Press } from '../../components/press';
import { Icon } from '../../components/Icon';
import { mediaUrl } from '../../components/hosting';
import { AMBER_DARK, BORDER, CREAM, INK, colors, desk, fonts, onThemeChange, spacing, type } from '../../theme';
import { Banner, Dropdown, FilterRow, PageHead } from '../kit';
import { Explain, type Tip } from '../explain';
import { Act, Blank, Footer, Kicker, Ladder, Stat, Tick, Word, type Col } from '../table';
import { KIND_OPTIONS, KIND_WORDS, gbp, useLoad, useSorted, when } from './kit';

// ---------------------------------------------------------------------------
// payloads (routes/hostingAdmin.js)
// ---------------------------------------------------------------------------

type Ai = { verdict: 'clear' | 'review' | string; reasons: string[] } | null;

type QueueRow = {
  offerId: string;
  title: string | null;
  host: string | null;
  hostId: string;
  kind: string | null;
  visibility: string | null;
  state: string;
  waitingOn?: string[] | null;
  submittedAt: string | null;
  hoursLeft: number | null;
  ai: Ai;
  changesRequested: { reasons?: string[]; note?: string | null; at?: string } | null;
};

type Queue = { rows: QueueRow[]; wentLiveToday: number; reviewHours: number | null; capped: boolean };

type CheckState = 'done' | 'missing' | 'not_needed';

type OneEvent = {
  event: QueueRow & {
    summary: string | null;
    description: string | null;
    photo: string | null;
    startsOn: string | null;
    startsAt: string | null;
    pricePence: number | null;
    priceMode: string | null;
    ageMin: number | null;
    ageMax: number | null;
    parents: 'stay' | 'drop_off' | null;
    venueArea: string | null;
    video: { url: string | null; transcript: string | null; flags: { at: string | null; reason: string }[] } | null;
  };
  checklist: { key: 'verified' | 'checked' | 'payouts' | 'profile' | 'adult'; label: string; state: CheckState }[];
  reasons: string[];
};

// ---------------------------------------------------------------------------
// shared words
// ---------------------------------------------------------------------------

const STATUS = ['requires', 'waiting', 'all'] as const;
type Status = typeof STATUS[number];
const STATUS_WORDS: Record<Status, string> = { requires: 'Requires review', waiting: 'Waiting on the host', all: 'All' };
const KINDS = ['all', 'oneoff', 'weekly', 'course', 'onrequest'] as const;
const SORTS = ['event', 'host', 'kind', 'submitted', 'left', 'ai', 'flags'] as const;

/**
 * Amber, for "attention". The back office is dark by default and the desk's
 * amber is drawn for that ground; on a light back office it is the app's own
 * darker amber, because the bright one does not read on cream.
 */
function useAmber() {
  const [light, setLight] = useState(() => Platform.OS === 'web' && typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'light');
  useEffect(() => onThemeChange((t) => setLight(t === 'light')), []);
  return light ? AMBER_DARK : desk.amber;
}

/** "8 h", "2 h over", "40 min" — of the review window. */
function timeLeft(h: number | null): string {
  if (h == null) return '—';
  const abs = Math.abs(h);
  const words = abs < 1 ? `${Math.max(1, Math.round(abs * 60))} min` : `${Math.round(abs)} h`;
  return h < 0 ? `${words} over` : words;
}

function verdictWords(ai: Ai): string | null {
  if (!ai) return null;
  if (ai.verdict === 'clear') return 'Clear';
  if (ai.verdict === 'review') return ai.reasons[0] ? `Requires review · ${ai.reasons[0]}` : 'Requires review';
  if (ai.verdict === 'skipped') return 'Not checked';
  return 'Checking';
}

function flagWords(r: QueueRow): string | null {
  const parts: string[] = [];
  const n = r.ai?.verdict === 'review' ? r.ai.reasons.length : 0;
  if (n) parts.push(String(n));
  if (r.state === 'approved') parts.push(`Waiting on ${(r.waitingOn ?? []).join(', ') || 'Checked'}`);
  else if (r.state === 'draft' && r.changesRequested) parts.push('Changes asked');
  return parts.length ? parts.join(' · ') : null;
}

// ---------------------------------------------------------------------------
// the tab
// ---------------------------------------------------------------------------

export function ReviewTab({ canManage }: { canManage: boolean }) {
  const [event] = useQueryState<string>('event', '', asText);
  return event ? <OneEventView id={event} canManage={canManage} /> : <QueueView />;
}

// ---------------------------------------------------------------------------
// BO8a — the queue
// ---------------------------------------------------------------------------

function QueueView() {
  const amber = useAmber();
  const [status, setStatus] = useQueryState<Status>('status', 'requires', asOneOf(STATUS, 'requires'));
  const [kind, setKind] = useQueryState<typeof KINDS[number]>('kind', 'all', asOneOf(KINDS, 'all'));
  const [sort, setSort] = useQueryState<typeof SORTS[number]>('sort', 'left', asOneOf(SORTS, 'left'));
  const [desc, setDesc] = useQueryState<boolean>('desc', false, { read: (r) => r === '1', write: (v) => (v ? '1' : null) });
  const [, setEvent] = useQueryState<string>('event', '', asText);

  const { data, error } = useLoad<Queue>(
    () => api.hostingAdmin<Queue>('/review', { status, kind: kind === 'all' ? null : kind }),
    [status, kind],
  );
  const hours = data?.reviewHours;
  const windowWords = hours != null ? `the ${hours} hours we promise hosts` : 'the review window';

  const rows = useSorted(data?.rows, sort, desc, (r, k) => {
    switch (k) {
      case 'event': return r.title?.toLowerCase() ?? null;
      case 'host': return r.host?.toLowerCase() ?? null;
      case 'kind': return r.kind ? KIND_WORDS[r.kind] ?? r.kind : null;
      case 'submitted': return r.submittedAt;
      case 'left': return r.hoursLeft;
      case 'ai': return verdictWords(r.ai);
      case 'flags': return (r.ai?.verdict === 'review' ? r.ai.reasons.length : 0) + (r.state !== 'in_review' ? 0.5 : 0);
      default: return null;
    }
  });

  const overdue = data ? data.rows.filter((r) => r.hoursLeft != null && r.hoursLeft < 0).length : null;
  const needsPerson = data ? data.rows.filter((r) => r.state === 'in_review' && r.ai?.verdict !== 'clear').length : null;

  const columns: Col<QueueRow>[] = [
    { key: 'event', label: 'Event', grow: true, sort: 'event', tip: ['Event', 'The event as the host titled it.'],
      cell: (r) => <Word strong>{r.title ?? '—'}</Word> },
    { key: 'host', label: 'Host', width: 150, sort: 'host', tip: ['Host', 'Who submitted it.'],
      cell: (r) => (r.host ? <Word>{r.host}</Word> : <Blank />) },
    { key: 'kind', label: 'Kind', width: 96, sort: 'kind', tip: ['Kind', 'One-off, Weekly, Course or On request.'],
      cell: (r) => (r.kind ? <Word>{KIND_WORDS[r.kind] ?? r.kind}</Word> : <Blank />) },
    { key: 'submitted', label: 'Submitted', width: 116, sort: 'submitted', tip: ['Submitted', 'When the host pressed publish.'],
      cell: (r) => (r.submittedAt ? <Word>{when(r.submittedAt, true)}</Word> : <Blank />) },
    { key: 'left', label: 'Time left', width: 96, align: 'right', sort: 'left',
      tip: ['Time left', `Of ${windowWords}. Amber under 12 hours, red once overdue.`],
      cell: (r) => (r.hoursLeft == null ? <Blank /> : (
        <Text style={[s.cellNum, r.hoursLeft < 0 ? { color: colors.overrun, fontWeight: '700' } : r.hoursLeft < 12 ? { color: amber, fontWeight: '700' } : null]}>
          {timeLeft(r.hoursLeft)}
        </Text>
      )) },
    { key: 'ai', label: 'AI verdict', width: 340, sort: 'ai',
      tip: ['AI verdict', 'Clear, or Requires review with the first reason. A dash when the video has not been checked yet.'],
      cellTip: (r) => (r.ai && r.ai.reasons.length > 1 ? ['AI verdict', r.ai.reasons.join(' · ')] : null),
      cell: (r) => {
        const w = verdictWords(r.ai);
        if (!w) return <Blank />;
        return <Text style={[s.cellWord, r.ai?.verdict === 'clear' ? { color: colors.accent, fontWeight: '700' } : r.ai?.verdict === 'review' ? { color: amber } : { color: colors.inkMuted }]}>{w}</Text>;
      } },
    { key: 'flags', label: 'Flags', width: 170, sort: 'flags',
      tip: ['Flags', 'How many separate things the AI flagged, and what an approved event still waits on, or the host’s changes.'],
      cell: (r) => { const w = flagWords(r); return w ? <Word>{w}</Word> : <Blank />; } },
  ];

  return (
    <View style={{ gap: spacing.lg }}>
      <PageHead kicker="Hosting · Review" title="Waiting for review"
        right={(
          <View style={s.stats}>
            <Stat label="In this list" value={data ? (data.capped ? `first ${data.rows.length}` : data.rows.length) : '—'}
              tip={['In this list', 'Events matching the filters, oldest submitted first from the server.']} />
            <Stat label="Requires review" value={needsPerson ?? '—'}
              tip={['Requires review', 'In review and not cleared by the AI. These are the only ones a person has to open.']} />
            <Stat label="Overdue" value={overdue ?? '—'} tip={['Overdue', `Past ${windowWords}.`]} />
            <Stat label="Went live today" value={data ? data.wentLiveToday : '—'}
              tip={['Went live today', 'Events that went live today. The AI found nothing and every check was in place, so nobody had to open them — or a reviewer approved them.']} />
          </View>
        )} />

      <FilterRow>
        <Dropdown label="Status" value={STATUS_WORDS[status]} width={220}
          options={STATUS.map((k) => ({ key: k, label: STATUS_WORDS[k], on: status === k }))}
          onPick={(k) => setStatus(k as Status)} />
        <Dropdown label="Kind" value={KIND_OPTIONS.find((o) => o.key === kind)?.label ?? 'All'} width={200}
          options={KIND_OPTIONS.map((o) => ({ key: o.key, label: o.label, on: kind === o.key }))}
          onPick={(k) => setKind(k as typeof KINDS[number])} />
      </FilterRow>

      {error ? <Banner tone="crit">{error}</Banner> : null}

      {data ? (
        <Ladder columns={columns} rows={rows} keyOf={(r) => r.offerId}
          sort={sort} desc={desc}
          onSort={(k) => { if (k === sort) setDesc(!desc); else { setSort(k as typeof SORTS[number]); setDesc(false); } }}
          onRow={(r) => setEvent(r.offerId, { replace: false })}
          label={(r) => `Open ${r.title ?? 'event'}`}
          empty={<Blank />}
          phoneRow={(r) => ({
            name: r.title ?? '—',
            note: [r.host, r.kind ? KIND_WORDS[r.kind] : null].filter(Boolean).join(' · ') || undefined,
            chips: [
              { key: 'left', word: timeLeft(r.hoursLeft), lead: r.hoursLeft != null && r.hoursLeft < 12, tip: columns[4].tip },
              { key: 'ai', word: verdictWords(r.ai) ?? '—', tip: columns[5].tip },
              ...(flagWords(r) ? [{ key: 'flags', word: flagWords(r)!, tip: columns[6].tip }] : []),
            ],
          })} />
      ) : error ? null : <Text style={type.small}>…</Text>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// BO8b — one event
// ---------------------------------------------------------------------------

const CHECK_TIPS: Record<string, Tip> = {
  verified: ['Verified', 'The Stripe identity check passed. We keep the result and the date, never the document.'],
  checked: ['Checked', 'DBS, insurance and references, needed for drop off and where the event asks for it. Approving with it missing makes the event Approved · waiting on Checked; it goes live once Checked is done.'],
  payouts: ['Payouts', 'Stripe Connect is active, so money can reach the host.'],
  profile: ['Profile', 'Photo, name and the about-you line are filled in.'],
  adult: ['18+', 'The date of birth confirms the host is over 18. The date itself is never shown.'],
};

function OneEventView({ id, canManage }: { id: string; canManage: boolean }) {
  const amber = useAmber();
  const { width } = useViewport();
  const wide = width >= 1000;
  const { href, back } = useRouter();
  const { data, error, reload } = useLoad<OneEvent>(() => api.hostingAdmin<OneEvent>(`/review/${encodeURIComponent(id)}`), [id]);

  // Ask for changes: ticked reasons, reasons added here, and a note.
  const [ticked, setTicked] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [declining, setDeclining] = useState(false);
  const [declineWhy, setDeclineWhy] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'changes' | 'decline'>(null);
  const [said, setSaid] = useState<{ tone: 'ok' | 'crit'; words: string } | null>(null);

  useEffect(() => { setTicked([]); setAdded([]); setNote(''); setDeclining(false); setDeclineWhy(''); setSaid(null); }, [id]);

  const goBack = () => back(withQuery(href, { event: null }));
  const allReasons = useMemo(() => [...(data?.reasons ?? []), ...added.filter((a) => !(data?.reasons ?? []).includes(a))], [data, added]);

  const act = async (what: 'approve' | 'changes' | 'decline') => {
    setBusy(what); setSaid(null);
    try {
      if (what === 'approve') {
        const out = await api.hostingAdminPost<{ outcome: 'live' | 'approved'; waitingOn?: string[] }>(`/review/${encodeURIComponent(id)}/approve`);
        setSaid({ tone: 'ok', words: out.outcome === 'live' ? 'Live' : `Approved · waiting on ${(out.waitingOn ?? []).join(', ') || 'Checked'}` });
      } else if (what === 'changes') {
        // The newest reason typed here is the one saved to the list for next
        // time; the server adds it to the reasons itself, so it is not sent twice.
        const fresh = added.filter((a) => ticked.includes(a) && !(data?.reasons ?? []).includes(a));
        const addReason = fresh.length ? fresh[fresh.length - 1] : undefined;
        const reasons = ticked.filter((r) => r !== addReason);
        await api.hostingAdminPost(`/review/${encodeURIComponent(id)}/changes`, { reasons, addReason, note: note.trim() || undefined });
        setSaid({ tone: 'ok', words: 'Changes sent to the host' });
      } else {
        await api.hostingAdminPost(`/review/${encodeURIComponent(id)}/decline`, { reason: declineWhy.trim() });
        setSaid({ tone: 'ok', words: 'Declined' });
        setDeclining(false);
      }
      reload();
    } catch (e: any) {
      setSaid({ tone: 'crit', words: e?.message ?? 'That didn’t go through.' });
    } finally {
      setBusy(null);
    }
  };

  const ev = data?.event;
  const verdict = ev ? verdictWords(ev.ai) : null;
  const flags = ev?.ai?.verdict === 'review' ? ev.ai.reasons.length : 0;
  const open = ev?.state === 'in_review';

  return (
    <View style={{ gap: spacing.lg }}>
      <Press onPress={goBack} accessibilityRole="link" style={s.backLink}>
        <Icon name="back" size={14} color={colors.ink} strokeWidth={2.2} />
        <Text style={s.backWords}>Review</Text>
      </Press>

      {error ? <Banner tone="crit">{error}</Banner> : null}

      {ev ? (
        <>
          <PageHead
            kicker={[ev.title, ev.host, ev.kind ? KIND_WORDS[ev.kind] : null].filter(Boolean).join(' · ')}
            title={ev.title ?? '—'}
            right={(
              <View style={s.stats}>
                <Stat label="Time left" tip={['Time left', 'Of the review window we promise hosts. Amber under 12 hours, red once overdue.']}
                  value={<Text style={ev.hoursLeft == null ? null : ev.hoursLeft < 0 ? { color: colors.overrun } : ev.hoursLeft < 12 ? { color: amber } : null}>{timeLeft(ev.hoursLeft)}</Text>} />
                <Stat label="AI verdict" tip={['AI verdict', 'What the AI made of the listing and the offer video. It never passes an event by itself.']}
                  value={<Text style={ev.ai?.verdict === 'review' ? { color: amber } : ev.ai?.verdict === 'clear' ? { color: colors.accent } : null}>{ev.ai?.verdict === 'review' ? 'Requires review' : verdict ?? '—'}</Text>} />
                <Stat label="Flags" tip={['Flags', 'Separate things the AI flagged.']} value={ev.ai ? flags : '—'} />
                <Stat label="Status" tip={['Status', 'Where the event is now: in review, live, approved and waiting on Checked, back with the host, or ended.']}
                  value={stateWords(ev.state, ev.waitingOn)} />
              </View>
            )} />

          {said ? <Banner tone={said.tone === 'ok' ? 'accent' : 'crit'}>{said.words}</Banner> : null}

          <View style={[s.split, wide ? s.splitWide : null]}>
            {/* Left: the guest card, then the video and what the AI saw. */}
            <View style={[s.col, wide ? { flex: 1.1 } : null]}>
              <View style={{ gap: 8 }}>
                <Kicker tip={['As guests will see it', 'The event card as it will appear to guests once it is live.']}>As guests will see it</Kicker>
                <GuestCard ev={ev} />
              </View>

              <View style={{ gap: 8 }}>
                <Kicker tip={ev.video?.transcript ? ['Transcript', ev.video.transcript] : ['The offer video', 'The host’s video for this event. A dash when there is none.']}>The offer video</Kicker>
                {ev.video?.url ? <OfferVideo url={mediaUrl(ev.video.url)!} /> : <Blank />}
                <Ladder<{ at: string | null; reason: string }>
                  dense
                  rows={ev.video?.flags ?? []}
                  keyOf={(f, i) => `${i}-${f.reason}`}
                  empty={<Blank />}
                  columns={[
                    { key: 'reason', label: 'What the AI saw', grow: true, tip: ['What the AI saw', 'As the reviewer and the host would read it.'],
                      cell: (f) => <Word>{f.reason}</Word> },
                    { key: 'at', label: 'Checked', width: 120, tip: ['Checked', 'When the AI read the video. The check gives no time inside the video.'],
                      cell: (f) => (f.at ? <Word muted>{when(f.at, true)}</Word> : <Blank />) },
                  ]} />
              </View>
            </View>

            {/* Right: the checklist and the three acts. */}
            <View style={[s.col, wide ? { flex: 1 } : null]}>
              <View style={{ gap: 4 }}>
                <Kicker tip={['Checklist', 'What the host has in place. Missing items do not block Approve; approving records that you have checked them.']}>Checklist</Kicker>
                {data!.checklist.map((c) => (
                  <Explain key={c.key} tip={c.state === 'not_needed' ? [c.label, 'Not needed for this event.'] : CHECK_TIPS[c.key]} style={s.checkRow}>
                    <Text style={s.checkLabel}>{c.label}</Text>
                    {c.state === 'done' ? <Tick on />
                      : c.state === 'missing' ? <Text style={[s.cellWord, { color: amber, fontWeight: '700' }]}>Missing</Text>
                        : <Blank />}
                  </Explain>
                ))}
              </View>

              {canManage && open ? (
                <View style={{ gap: 10 }}>
                  <Kicker tip={['Ask for changes', 'Tick what the host must change. Add a reason saves it to this list for next time. The note goes with them.']}>Ask for changes</Kicker>
                  <Dropdown label="Reasons" multi width={340}
                    value={ticked.length ? `${ticked.length} ticked` : 'Choose'}
                    options={[
                      ...allReasons.map((r) => ({ key: r, label: r, on: ticked.includes(r) })),
                      { key: '__add', label: 'Add a reason', on: false },
                    ]}
                    onPick={(k) => {
                      if (k === '__add') { setAdding(true); return; }
                      setTicked((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]));
                    }} />
                  {adding ? (
                    <View style={s.addRow}>
                      <TextInput value={draft} onChangeText={setDraft} placeholder="Add a reason" placeholderTextColor={colors.inkMuted}
                        style={[s.input, { flex: 1 }]} maxLength={120} autoFocus
                        onSubmitEditing={() => addReason(draft)} />
                      <Act small label="Add" onPress={() => addReason(draft)} disabled={!draft.trim()} />
                      <Act small tone="secondary" label="Cancel" onPress={() => { setAdding(false); setDraft(''); }} />
                    </View>
                  ) : null}
                  {ticked.length ? (
                    <View style={s.pills}>
                      {ticked.map((r) => (
                        <View key={r} style={s.pill}>
                          <Text style={s.pillWord}>{r}</Text>
                          <Press onPress={() => setTicked((t) => t.filter((x) => x !== r))} accessibilityRole="button"
                            accessibilityLabel={`Remove ${r}`} hitSlop={6}>
                            <Icon name="close" size={12} color={colors.ink} strokeWidth={2.4} />
                          </Press>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <TextInput value={note} onChangeText={setNote} placeholder="A note to the host" placeholderTextColor={colors.inkMuted}
                    multiline style={[s.input, s.note]} maxLength={1000} />

                  {declining ? (
                    <View style={{ gap: 6 }}>
                      <Kicker tip={['Why it is declined', 'Required. The host sees it.']}>Why it is declined</Kicker>
                      <TextInput value={declineWhy} onChangeText={setDeclineWhy} placeholder="The reason the host will see" placeholderTextColor={colors.inkMuted}
                        style={s.input} maxLength={500} autoFocus />
                    </View>
                  ) : null}

                  <Footer>
                    <Act tone="solid" label={busy === 'approve' ? '…' : 'Approve'} icon="check" onPress={() => act('approve')} disabled={busy != null} />
                    <Act label={busy === 'changes' ? '…' : 'Send changes to host'} icon="send" onPress={() => act('changes')}
                      disabled={busy != null || (!ticked.length && !note.trim())} />
                    {declining
                      ? <>
                          <Act tone="secondary" label={busy === 'decline' ? '…' : 'Decline'} onPress={() => act('decline')} disabled={busy != null || !declineWhy.trim()} />
                          <Act tone="secondary" label="Cancel" onPress={() => { setDeclining(false); setDeclineWhy(''); }} />
                        </>
                      : <Act tone="secondary" label="Decline" onPress={() => setDeclining(true)} disabled={busy != null} />}
                  </Footer>
                </View>
              ) : null}
            </View>
          </View>
        </>
      ) : error ? null : <Text style={type.small}>…</Text>}
    </View>
  );

  function addReason(text: string) {
    const r = text.trim().slice(0, 120);
    if (!r) return;
    setAdded((a) => (a.includes(r) ? a : [...a, r]));
    setTicked((t) => (t.includes(r) ? t : [...t, r]));
    setDraft(''); setAdding(false);
  }
}

function stateWords(state: string, waitingOn?: string[] | null): string {
  switch (state) {
    case 'in_review': return 'In review';
    case 'approved': return `Approved · waiting on ${(waitingOn ?? []).join(', ') || 'Checked'}`;
    case 'live': return 'Live';
    case 'draft': return 'With the host';
    case 'ended': return 'Ended';
    default: return state;
  }
}

/** The card a guest will see: cream ground, ink type, whatever the back office is set to. */
function GuestCard({ ev }: { ev: OneEvent['event'] }) {
  const ages = ev.ageMin != null && ev.ageMax != null ? `ages ${ev.ageMin} to ${ev.ageMax}`
    : ev.ageMin != null ? `ages ${ev.ageMin}+` : ev.ageMax != null ? `up to ${ev.ageMax}` : null;
  const line = [
    ev.startsOn ? when(ev.startsOn) : null,
    ev.startsAt,
    ages,
    ev.parents === 'drop_off' ? 'drop off' : ev.parents === 'stay' ? 'parents stay' : null,
    ev.venueArea,
  ].filter(Boolean).join(' · ');
  const price = ev.priceMode === 'free' || (!ev.priceMode && ev.pricePence == null) ? 'Free' : ev.pricePence != null ? `${gbp(ev.pricePence)} each` : '—';
  const photo = mediaUrl(ev.photo);
  return (
    <View style={s.card}>
      {photo && Platform.OS === 'web'
        ? React.createElement('img', { src: photo, alt: '', style: { width: '100%', height: 180, objectFit: 'cover', display: 'block' } })
        : null}
      <View style={{ padding: 16, gap: 6 }}>
        <Text style={s.cardTitle}>{ev.title ?? '—'}</Text>
        {line ? <Text style={s.cardLine}>{line}</Text> : null}
        {ev.summary ? <Text style={s.cardLine} numberOfLines={2}>{ev.summary}</Text> : null}
        <View style={s.cardFoot}>
          <Text style={s.cardPrice}>{price}</Text>
          <View style={s.cardBook}><Text style={s.cardBookWord}>Book</Text></View>
        </View>
      </View>
    </View>
  );
}

function OfferVideo({ url }: { url: string }) {
  if (Platform.OS === 'web') {
    return React.createElement('video', { src: url, controls: true, preload: 'metadata', style: { width: '100%', maxHeight: 360, background: INK, display: 'block' } });
  }
  return (
    <Press onPress={() => Linking.openURL(url)} accessibilityRole="link" style={s.backLink}>
      <Icon name="play" size={14} color={colors.ink} />
      <Text style={s.backWords}>Play the video</Text>
    </Press>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 34, alignItems: 'flex-end' },
  cellNum: { ...type.body, fontSize: 13.5, color: colors.ink, fontVariant: ['tabular-nums'], textAlign: 'right' },
  cellWord: { ...type.body, fontSize: 13.5, color: colors.ink },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  backWords: { ...type.small, fontSize: 13, fontWeight: '700', color: colors.ink },
  split: { gap: spacing.xl },
  splitWide: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { gap: spacing.xl, minWidth: 0 },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  checkLabel: { ...type.body, fontSize: 13.5, color: colors.ink },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink, paddingVertical: 8, borderBottomWidth: BORDER, borderBottomColor: colors.ruleMuted, backgroundColor: 'transparent' },
  note: { minHeight: 72, textAlignVertical: 'top' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: colors.accentSoft },
  pillWord: { ...type.small, fontSize: 12.5, color: colors.ink, fontWeight: '600' },
  // The guest-view preview is the one box the back office draws (§1.9), and
  // it is pinned to the app's own light ground: cream, ink, square.
  card: { backgroundColor: CREAM, borderWidth: 1, borderColor: INK, maxWidth: 420 },
  cardTitle: { fontFamily: fonts.heading, fontSize: 18, fontWeight: '800', color: INK, letterSpacing: -0.3 },
  cardLine: { fontFamily: fonts.body, fontSize: 13, color: INK, lineHeight: 18 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  cardPrice: { fontFamily: fonts.body, fontSize: 14, fontWeight: '700', color: INK },
  cardBook: { backgroundColor: INK, paddingHorizontal: 14, paddingVertical: 7 },
  cardBookWord: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: CREAM },
});
