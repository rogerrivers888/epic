/**
 * The event page, as a guest sees it (guest handoff G2–G5, and G23 on the web).
 *
 *   Title and place · the lane chip (and Drop off) · the host row with "Ask Kate"
 *   on its right · When and Price · Going ahead? when there's a minimum · the
 *   lane's extras (running order · every session · by the end and the session
 *   plan · when the host is free) · Who it's for · Refunds · then the footer:
 *   the price and one button by state — Book · Ask to book · Join the waiting
 *   list · Full.
 *
 * Opened from Epic it sits in the app under the tab bar; found on Google it is
 * the same page on epic.day, with the wordmark where the back button was and
 * no tab bar. Everything on it comes from two reads: the event and what booking
 * it allows right now (routes/guestBookings.js `booking/options`).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Share } from 'react-native';
import { api, type Experience, type GuestOptions, type PaymentsConfig } from '../../api';
import { paths, withQuery } from '../../routes';
import { useRouter } from '../../router';
import { signedIn } from '../../session';
import { mediaUrl } from '../../components/hosting';
import {
  AMBER, AMBER_DARK, Buttons, Facts, Field, Foot, GoingAhead, GuestPage, GuestSheet, HostRow, INK_MUTED, Kick, LANE_TAG, Para, PhotoHead, Rows,
  Tags, Title, Waiting, dayWords, firstName, gbp, useToast,
} from './kit';

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const plusMin = (hhmm: string, min: number) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + min; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const lengthWords = (min: number) => (min % 60 === 0 ? `${min / 60} hour${min === 60 ? '' : 's'}` : `${min} min`);

/** When, by lane: "Sun 12 Oct · 10:00–13:00", "Saturdays · 10:00–12:00", "8 Saturdays · 26 Sep – 14 Nov · 09:00", "On request · 2 hours". */
export function whenWords(o: Experience, opt: GuestOptions | null): string {
  const t = o.startsAt ? `${o.startsAt}${o.endsAt ? `–${o.endsAt}` : ''}` : '';
  const ss = opt?.sessions ?? [];
  if (o.lane === 'onrequest') {
    const len = opt?.slots[0]?.lengths?.[0] ?? o.durationMin ?? null;
    return `On request${len ? ` · ${lengthWords(len)}` : ''}`;
  }
  if (o.lane === 'weekly') {
    const day = ss[0]?.date ? WEEKDAY[weekdayOf(ss[0].date)] : o.weekday != null ? WEEKDAY[o.weekday] : null;
    return [day ? `${day}s` : 'Weekly', t].filter(Boolean).join(' · ');
  }
  if (o.lane === 'course' && ss.length) {
    const day = WEEKDAY[weekdayOf(ss[0].date)];
    const short = (d: string) => dayWords(d).split(' ').slice(1).join(' ');
    return `${ss.length} ${day}s · ${short(ss[0].date)} – ${short(ss[ss.length - 1].date)}${o.startsAt ? ` · ${o.startsAt}` : ''}`;
  }
  const first = ss[0]?.date ?? o.startsOn;
  return [first ? dayWords(first) : null, t].filter(Boolean).join(' · ');
}

/** Price, as the footer and the facts say it: "£84" over "now · £28 each if 12 come". */
export function priceWords(o: Experience, opt: GuestOptions | null): { big: string; small: string } {
  const p = opt?.price;
  const mode = p?.mode ?? o.priceMode ?? 'free';
  if (mode === 'free' || !(p?.pence || p?.totalPence)) return { big: 'Free', small: '' };
  if (mode === 'by_numbers' && p?.totalPence && p.nowEach != null) {
    const most = o.maxCount ?? null;
    return { big: gbp(p.nowEach), small: most ? `now · ${gbp(Math.ceil(p.totalPence / most))} each if ${most} come` : 'now' };
  }
  const who = opt?.who;
  const kidsOnly = Boolean(who?.dropOff) || (who?.ageMax != null && who.ageMax < 18);
  const each = kidsOnly ? 'a child' : p?.per === 'booking' ? `up to ${who?.partyMax ?? 2} people` : 'each';
  const child = p?.childPence != null && !kidsOnly && p.per !== 'booking' ? ` · ${gbp(p.childPence)} a child` : '';
  if (o.lane === 'weekly') return { big: gbp(p?.pence ?? null), small: `${each === 'each' ? 'a session' : `${each}, each session`}${child}` };
  if (o.lane === 'course') return { big: gbp(p?.pence ?? null), small: `${each === 'each' ? 'each' : each} · all ${opt?.sessions.length ?? o.sessions ?? ''} sessions`.replace(' ·  ', ' · ') + child };
  return { big: gbp(p?.pence ?? null), small: `${each}${child}` };
}

/** Who it's for: "Ages 6–10 · drop off", "Adults only · 18+", "All ages · parents stay". */
export function whoWords(opt: GuestOptions | null, o: Experience): string {
  const w = opt?.who ?? { ageMin: o.ageMin ?? null, ageMax: o.ageMax ?? null, dropOff: false, adultsOnly: false, partyMax: null };
  const ages = w.adultsOnly ? 'Adults only · 18+' : w.ageMin != null && w.ageMax != null ? `Ages ${w.ageMin}–${w.ageMax}` : w.ageMin != null ? `Ages ${w.ageMin} and up` : w.ageMax != null ? `Up to age ${w.ageMax}` : 'All ages';
  const kids = (w.ageMax ?? 99) < 18 || (w.ageMin ?? 0) < 18;
  const stay = w.dropOff ? 'drop off' : !w.adultsOnly && kids ? 'parents stay' : null;
  return [ages, stay].filter(Boolean).join(' · ');
}

/** "Saturdays 13:00 to 17:00 · pick a time when you ask", from the slots the host is free for. */
function freeWords(opt: GuestOptions | null): string | null {
  const slots = opt?.slots ?? [];
  if (!slots.length) return null;
  const byDay = new Map<number, { from: string; to: string }>();
  for (const s of slots) {
    const d = weekdayOf(s.date); const len = Math.min(...(s.lengths.length ? s.lengths : [60]));
    const from = s.times[0]; const to = plusMin(s.times[s.times.length - 1], len);
    const was = byDay.get(d);
    byDay.set(d, was ? { from: was.from < from ? was.from : from, to: was.to > to ? was.to : to } : { from, to });
  }
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => byDay.has(d));
  const parts = order.slice(0, 2).map((d) => `${WEEKDAY[d]}s ${byDay.get(d)!.from} to ${byDay.get(d)!.to}`);
  return `${parts.join(' · ')}${order.length > 2 ? ' and more' : ''} · pick a time when you ask`;
}

export function EventPage({ id, webPage, linkToken, inviteToken }: { id: string; webPage: boolean; linkToken?: string | null; inviteToken?: string | null }) {
  const { navigate, back, path } = useRouter();
  const [data, setData] = useState<{ offer: Experience; payments: PaymentsConfig } | null>(null);
  const [opt, setOpt] = useState<GuestOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'ask' | 'account' | null>(null);
  const [question, setQuestion] = useState('');
  const [joined, setJoined] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.experience(id, inviteToken, linkToken).then(setData).catch((e) => setError(e?.message ?? 'That event didn’t load.'));
    api.guestOptions(id, { l: linkToken, i: inviteToken }).then(setOpt).catch(() => setOpt(null));
  }, [id, linkToken, inviteToken]);

  const o = data?.offer ?? null;
  const price = useMemo(() => (o ? priceWords(o, opt) : { big: '', small: '' }), [o, opt]);
  if (!o) return <Waiting error={error} />;

  const host = o.host;
  const first = firstName(host?.name);
  const keep = (href: string) => withQuery(href, { l: linkToken ?? null, i: inviteToken ?? null });
  const here = keep(paths.experience(o.id));
  const logIn = () => navigate(`${paths.login()}?next=${encodeURIComponent(here)}`);

  const share = async () => {
    const url = Platform.OS === 'web' && typeof location !== 'undefined' ? `${location.origin}${here}` : here;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).share) await (navigator as any).share({ title: o.title ?? 'Epic', url });
      else if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) { await navigator.clipboard.writeText(url); toast.show('Link copied'); }
      else await Share.share({ message: url });
    } catch { /* closed the share sheet */ }
  };

  const askSend = async () => {
    const t = question.trim();
    if (!t) return;
    try {
      await api.chatAsk('offer', o.id, { title: t, body: null, tag: { kind: 'offer_aspect', ref: 'offer' }, audience: 'host_only' });
      setSheet(null); setQuestion('');
      toast.show(host?.replyWords ? `Sent · ${host.replyWords}` : 'Sent');
    } catch (e: any) { toast.show(e?.message ?? 'That didn’t send.'); }
  };

  const join = async () => {
    if (joined != null) return;
    if (!signedIn()) { setSheet('account'); return; }
    // A weekly event's list is per session: the first one that is full (Codex, 3 Oct 2026).
    const sessionId = o.lane === 'weekly' ? (opt?.sessions.find((x) => x.placesLeft === 0)?.id ?? opt?.sessions[0]?.id ?? null) : null;
    try { const r = await api.guestWaitlist(o.id, { sessionId, linkToken: linkToken ?? null, inviteToken: inviteToken ?? null }); setJoined(r.position); toast.show(`You’re #${r.position} on the waiting list`); }
    catch (e: any) { toast.show(e?.message ?? 'That didn’t go through.'); }
  };

  // ---- blocks
  const lane = o.lane ?? 'oneoff';
  const tags = [LANE_TAG[lane], ...(opt?.who.dropOff ? [{ label: 'Drop off', bg: AMBER, fg: LANE_TAG.course.fg }] : [])];
  const ga = o.goingAhead;
  const most = o.maxCount ?? null;
  const sessions = opt?.sessions ?? [];
  const blocks: React.ReactNode[] = [
    <Title key="t" title={o.title ?? 'An event'} line={o.venueArea ?? o.venueLabel ?? null} />,
    <Tags key="tags" items={tags} />,
    host ? (
      <HostRow key="host" face={mediaUrl(host.photo)} name={host.name} line={host.replyWords ? host.replyWords.replace(/^u/, 'U') : host.location ?? ''}
               onPress={() => navigate(webPage ? paths.hostProfile(host.id) : paths.hostProfile(host.id))}
               ask={{ label: `Ask ${first}`, onPress: () => setSheet('ask') }} />
    ) : null,
    <Facts key="facts" items={[{ label: 'When', value: whenWords(o, opt) }, { label: 'Price', value: [price.big, price.small].filter(Boolean).join(' ') }]} weights={[1.3, 1]} />,
  ];
  if (ga && !ga.calledOff) {
    const cheaper = opt?.price.mode === 'by_numbers' && opt.price.totalPence && most ? ` The more come, the less each pays: ${gbp(Math.ceil(opt.price.totalPence / most))} each if ${most} come.` : '';
    blocks.push(<GoingAhead key="ga" boxes={[{ label: 'Needs', value: String(ga.min) }, { label: 'Booked so far', value: String(ga.booked) }, { label: 'Decided', value: ga.decidesOn ? dayWords(ga.decidesOn) : '—' }]}
                            line={`If it falls short it’s called off and you get everything back.${cheaper}`} />);
  }
  if (lane === 'oneoff' && o.runningOrder?.length) {
    blocks.push(<Kick key="ro-k" top={4}>Running order</Kick>, <Rows key="ro" items={o.runningOrder.map((r, i) => ({ key: `ro${i}`, title: r.title, value: r.time ?? '' }))} />);
  }
  if (lane === 'weekly' && sessions.length) {
    blocks.push(<Kick key="s-k" top={4}>Every session</Kick>, <Rows key="s" items={sessions.map((x) => {
      const taken = most != null && x.placesLeft != null ? most - x.placesLeft : null;
      return { key: x.id, title: dayWords(x.date), value: taken != null && most != null ? `${taken} of ${most} booked` : '', valueColor: x.placesLeft != null && x.placesLeft <= 1 ? AMBER_DARK : INK_MUTED, weight: '700' as const };
    })} />);
  }
  if (lane === 'course') {
    if (o.outcome) blocks.push(<Kick key="end-k" top={4}>By the end</Kick>, <Para key="end">{o.outcome}</Para>);
    if (sessions.length) {
      blocks.push(<Kick key="plan-k" top={4}>Session plan</Kick>, <Rows key="plan" items={sessions.map((x, i) => ({ key: x.id, title: x.topic ?? o.weeks?.[i]?.title ?? `Session ${i + 1}`, value: dayWords(x.date).split(' ').slice(1).join(' ') }))} />);
    }
  }
  if (lane === 'onrequest') {
    const free = freeWords(opt);
    if (free) blocks.push(<Kick key="free-k" top={4}>{`When ${first} is free`}</Kick>, <Para key="free">{free}</Para>);
  }
  const collect = opt?.who.dropOff && o.endsAt ? ` · Collect at ${o.endsAt}` : '';
  blocks.push(<Kick key="who-k" top={4}>Who it’s for</Kick>, <Para key="who">{whoWords(opt, o) + collect}</Para>);
  const refunds = opt?.refundWords ?? o.refundWords ?? null;
  if (refunds) blocks.push(<Kick key="rf-k" top={4}>Refunds</Kick>, <Para key="rf">{refunds}</Para>);

  // ---- footer, by state (README: Book · Ask to book · Join the waiting list · Full)
  const action = opt?.action ?? 'closed';
  const full = action === 'full' || action === 'waitlist';
  const bookHref = keep(paths.experienceBook(o.id));
  const foot = action === 'book' ? <Foot price={price.big} sub={price.small} label="Book" onPress={() => navigate(bookHref)} />
    : action === 'ask' ? <Foot price={price.big} sub={price.small} label="Ask to book" onPress={() => navigate(bookHref)} />
      : action === 'waitlist' ? <Foot price="Full" sub={most ? `${most} of ${most} booked` : null} label={joined != null ? `You’re #${joined} on the list` : 'Join the waiting list'} tone={joined != null ? 'grey' : 'ink'} onPress={join} />
        : action === 'full' ? <Foot price="Full" sub={most ? `${most} of ${most} booked` : null} label="Full" disabled onPress={() => {}} />
          : <Foot price={price.big} sub={price.small} label={action === 'finished' ? 'Finished' : 'Not taking bookings'} disabled onPress={() => {}} />;
  void full;

  const sheets = sheet === 'ask' ? (
    <GuestSheet title={`Ask ${first}`} onClose={() => setSheet(null)}>
      {signedIn() ? (
        <>
          <Field value={question} onChange={setQuestion} placeholder="Your question" height={96} maxLength={2000} />
          <Para color={INK_MUTED}>Phone numbers and payment details stay hidden until you book.</Para>
          <Buttons items={[{ label: 'Send', tone: 'ink', onPress: askSend }]} />
        </>
      ) : (
        <>
          <Para color={INK_MUTED}>Make a free account so {first} can answer you. No subscription.</Para>
          <Buttons items={[{ label: 'Continue with Google', onPress: logIn }, { label: 'Use my email', onPress: logIn }]} />
        </>
      )}
    </GuestSheet>
  ) : sheet === 'account' ? (
    <GuestSheet title="Join the waiting list" onClose={() => setSheet(null)}>
      <Para color={INK_MUTED}>Make a free account so we can tell you when a place comes free. No subscription.</Para>
      <Buttons items={[{ label: 'Continue with Google', onPress: logIn }, { label: 'Use my email', onPress: logIn }]} />
    </GuestSheet>
  ) : null;

  return (
    <GuestPage
      head={<PhotoHead uri={mediaUrl(o.photos[0] ?? null)} webPage={webPage} onBack={() => back(paths.inspire())} onShare={share} />}
      foot={foot}
      overlay={<>{toast.node}{sheets}</>}>
      {blocks}
    </GuestPage>
  );
  void path;
}
