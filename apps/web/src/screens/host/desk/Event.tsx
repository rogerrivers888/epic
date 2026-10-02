/**
 * E8 · one event (hosting v4, README E8).
 *
 * Photo, lane tag + status + visibility, the title, Date · Booked · Decides
 * by; five actions in one row — Share · Message · Dates · Edit · More; the
 * session chips for Weekly and Course; then Guests · Waiting list · Money.
 * A co-host sees the same page with a grey line under the title, only Share
 * and Message, and only the tabs they are allowed.
 *
 * The sheets are query state (?sheet=share|dates|edit|more|cancel): Dates is
 * Change date (handover §3.3), with a preview of old → new before anything
 * moves; Cancel needs a reason before its red button will act.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon, type IconName } from '../../../components/Icon';
import { QrCode } from '../../../components/QrCode';
import { showToast } from '../../../components/Toast';
import { useRouter } from '../../../router';
import { paths } from '../../../routes';
import { api } from '../../../api';
import { AMBER, CREAM, DEEP_GREEN, HAIRLINE, INACTIVE, INK, INK_MUTED, LIME, LIME_TINT, TARGET } from '../../../theme';
import { DateBox, TimeBox, Switch } from '../v7/kit';
import { Btn, Cell, DeskSheet, Empty, Head, Kicker, LaneTag, Loading, Page, Photo, RED, StatusChip, TextTabs, hx, tx } from './kit';
import { LANE_TAG, dayWords, gbp, type DeskEvent, type Guest } from './model';

type Sheet = 'share' | 'dates' | 'edit' | 'more' | 'cancel';
type TabKey = 'guests' | 'waitlist' | 'money';
const CHIP_WORDS: Record<string, string> = { on: 'On', waiting: 'Waiting on numbers', request: 'Request', changed: 'Changed', in_review: 'In review', draft: 'Draft', finished: 'Finished', called_off: 'Called off', cohost: 'Co-host' };

export function DeskEventScreen({ offerId }: { offerId: string }) {
  const { navigate, back, query, setQuery } = useRouter();
  const session = query.get('session');
  const sheet = (query.get('sheet') as Sheet | null) ?? null;
  const [d, setD] = useState<DeskEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api.deskEvent(offerId, session).then((r) => { setD(r); setError(null); }).catch((e) => setError(e.message)), [offerId, session]);
  useEffect(() => { void load(); }, [load]);
  const open = (s: Sheet | null) => setQuery({ sheet: s }, { replace: s == null });
  const tabs = useMemo(() => {
    if (!d) return [];
    const t: { key: TabKey; label: string }[] = [];
    if (d.view.guests) t.push({ key: 'guests', label: 'Guests' }, { key: 'waitlist', label: 'Waiting list' });
    if (d.view.money) t.push({ key: 'money', label: 'Money' });
    return t;
  }, [d]);
  const tabParam = query.get('tab') as TabKey | null;
  const tab: TabKey | null = tabs.find((x) => x.key === tabParam)?.key ?? tabs[0]?.key ?? null;

  if (!d) return <Loading error={error} />;
  const e = d.event;
  const multi = d.sessions.length > 1;
  const sel = d.sessions.find((s) => s.id === d.sessionId) ?? null;
  const visibility = [e.visibility === 'public' ? 'Public' : 'Private', e.parents === 'drop_off' ? 'drop off' : null].filter(Boolean).join(' · ');
  const actions: { key: Sheet | 'message'; label: string; icon: IconName; show: boolean }[] = [
    { key: 'share', label: 'Share', icon: 'share', show: true },
    { key: 'message', label: 'Message', icon: 'message', show: d.view.messages },
    { key: 'dates', label: 'Dates', icon: 'calendar', show: d.view.dates && e.lane !== 'onrequest' },
    { key: 'edit', label: 'Edit', icon: 'edit', show: d.view.edit },
    { key: 'more', label: 'More', icon: 'menu', show: d.view.owner },
  ];
  return (
    <Page>
      <Head back="All events" onBack={() => back(paths.hostEvents())} />
      <Photo uri={e.photo} height={168} radius={0} />
      <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <LaneTag words={LANE_TAG[e.lane]} />
          <StatusChip chip={e.chip} words={CHIP_WORDS[e.chip] ?? e.chip} />
          <Text style={tx(13, '400', INK_MUTED)}>{visibility}</Text>
        </View>
        <Text style={hx(25)} accessibilityRole="header">{e.title}</Text>
        {!d.view.owner ? (
          <Text style={tx(13, '400', INK_MUTED)}>
            You co-host with {d.view.ownerName ?? 'the host'} · you see {[d.view.guests ? 'guest list' : null, d.view.messages ? 'messages' : null, d.view.money ? 'money' : null].filter(Boolean).join(' and ') || 'the event'}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: HAIRLINE, paddingVertical: 12, gap: 8 }}>
          <Fact flex={1.5} k="Date" v={e.date ? `${dayWords(sel?.date ?? e.date.date)}${(sel?.time ?? e.date.time) ? ` · ${sel?.time ?? e.date.time}` : ''}` : '—'} />
          <Fact k="Booked" v={`${sel?.booked ?? e.booked}${(sel?.max ?? e.maxCount) ? ` of ${sel?.max ?? e.maxCount}` : ''}`} />
          <Fact k="Decides by" v={e.decidesBy === 'day_before' ? 'Day before' : e.decidesBy ? dayWords(e.decidesBy) : '—'} />
        </View>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {actions.filter((a) => a.show).map((a) => (
            <Press key={a.key} onPress={() => (a.key === 'message' ? navigate(paths.hostOfferChat(e.id)) : open(a.key))} accessibilityRole="button" accessibilityLabel={a.label}
              style={{ flex: 1, height: 58, backgroundColor: INACTIVE, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <Icon name={a.icon} size={18} color={INK} />
              <Text style={tx(13, '700')} numberOfLines={1}>{a.label}</Text>
            </Press>
          ))}
        </View>
        {multi && (e.lane === 'weekly' || e.lane === 'course') ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
            {d.sessions.map((s) => (
              <Press key={s.id} onPress={() => setQuery({ session: s.id }, { replace: true })} accessibilityRole="tab" accessibilityState={{ selected: s.id === d.sessionId }}
                style={{ backgroundColor: s.id === d.sessionId ? LIME : INACTIVE, paddingHorizontal: 10, paddingVertical: 8, gap: 2, minWidth: 86 }}>
                <Text style={tx(13, '800')}>{dayWords(s.date)}</Text>
                <Text style={tx(12, '400', INK_MUTED)}>{s.state === 'cancelled' || s.state === 'called_off' ? 'Called off' : s.finished ? 'Finished' : `${s.booked}${s.max ? ` of ${s.max}` : ''}`}</Text>
              </Press>
            ))}
          </View>
        ) : null}
        {tab ? <TextTabs tabs={tabs} value={tab} onPick={(k) => setQuery({ tab: k === 'guests' ? null : k }, { replace: true })} /> : null}
        {tab === 'guests' ? <Guests d={d} reload={load} /> : null}
        {tab === 'waitlist' ? <Waitlist d={d} reload={load} /> : null}
        {tab === 'money' ? <Money d={d} /> : null}
      </View>

      {sheet === 'share' ? <ShareSheet d={d} onClose={() => open(null)} /> : null}
      {sheet === 'dates' && d.view.dates ? <ChangeDateSheet d={d} onClose={() => open(null)} onDone={() => { open(null); void load(); }} /> : null}
      {sheet === 'edit' && d.view.edit ? <EditSheet d={d} onClose={() => open(null)} onDone={() => { open(null); void load(); }} /> : null}
      {sheet === 'more' && d.view.owner ? (
        <DeskSheet title="More" onClose={() => open(null)}>
          <SheetRow label="Preview as guests see it" onPress={() => navigate(paths.experience(e.id))} />
          <SheetRow label="Run it again" onPress={() => navigate(paths.hostLane(e.lane))} />
          <SheetRow label="Insights" onPress={() => navigate(paths.hostInsights())} />
          <SheetRow label="Cancel event" red onPress={() => open('cancel')} />
        </DeskSheet>
      ) : null}
      {sheet === 'cancel' && d.view.owner ? <CancelSheet d={d} onClose={() => open(null)} onDone={() => { open(null); void load(); }} /> : null}
    </Page>
  );
}

const Fact = ({ k, v, flex = 1 }: { k: string; v: string; flex?: number }) => (
  <View style={{ flex, gap: 2 }}>
    <Text style={tx(12.5, '400', INK_MUTED)}>{k}</Text>
    <Text style={tx(15, '800')} numberOfLines={1}>{v}</Text>
  </View>
);

const SheetRow = ({ label, onPress, red }: { label: string; onPress: () => void; red?: boolean }) => (
  <Press onPress={onPress} accessibilityRole="button" style={{ minHeight: TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: HAIRLINE, paddingVertical: 12 }}>
    <Text style={tx(15.5, '700', red ? RED : INK)}>{label}</Text>
    <Icon name="more" size={16} color={red ? RED : INK} />
  </Press>
);

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

function childLine(g: Guest) {
  if (!g.children.length) return `${g.heads} ${g.heads === 1 ? 'person' : 'people'}`;
  const ages = g.children.map((c) => c.age ?? c.ageFromDob).filter((a): a is number => a != null);
  const n = g.children.length;
  return `${n} ${n === 1 ? 'child' : 'children'}${ages.length ? ` · ${ages.length === 1 ? 'age' : 'ages'} ${ages.length === 1 ? ages[0] : `${ages.slice(0, -1).join(', ')} and ${ages.at(-1)}`}` : ''}`;
}

function answerLine(g: Guest) {
  const a = g.answers as Record<string, unknown>;
  const bits: string[] = [];
  for (const c of g.children) bits.push(...c.needs);
  for (const k of ['dietary', 'needs', 'bring', 'note', 'plusOne', 'nights']) {
    const v = a?.[k];
    if (typeof v === 'string' && v.trim()) bits.push(v.trim());
    else if (Array.isArray(v)) bits.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  return bits.length ? bits.join(' · ') : null;
}

function Guests({ d, reload }: { d: DeskEvent; reload: () => void }) {
  const sel = d.sessions.find((s) => s.id === d.sessionId);
  const [marking, setMarking] = useState(false);
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const guests = d.guests ?? [];
  const live = guests.filter((g) => g.status !== 'Refunded');
  const heads = live.reduce((n, g) => n + g.heads, 0);
  const save = async () => {
    try {
      const r = await api.deskAttendance(d.event.id, sel!.id, Object.entries(marks).map(([bookingId, present]) => ({ bookingId, present })));
      setSaved(`Saved · ${r.in} in, ${r.out} out`); setMarking(false); reload();
    } catch (e: any) { showToast(e.message); }
  };
  if (!guests.length) return <Empty>Nobody has booked this one yet.</Empty>;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
        <Text style={tx(14.5, '800')}>{heads} booked · {live.length} {live.length === 1 ? 'booking' : 'bookings'}</Text>
        {sel?.finished && !marking ? <Btn label="Mark attendance" kind="lime" onPress={() => { setMarking(true); setSaved(null); setMarks(Object.fromEntries(live.map((g) => [g.bookingId, g.present ?? true]))); }} /> : null}
      </View>
      {saved ? <Text style={[tx(13.5, '700', DEEP_GREEN), { paddingBottom: 8 }]}>{saved}</Text> : null}
      {guests.map((g) => {
        const line = answerLine(g);
        const parentPhones = g.children.map((c) => c.parentPhone).filter(Boolean);
        return (
          <View key={g.bookingId} style={{ borderTopWidth: 1, borderTopColor: HAIRLINE, paddingVertical: 14, gap: 4, flexDirection: 'row' }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={tx(15.5, '800')}>{g.name} <Text style={tx(13, '400', INK_MUTED)}>{childLine(g)}</Text></Text>
              {line ? <Text style={tx(13.5, '400')}>{line}</Text> : null}
              {parentPhones.length ? <Text style={tx(13, '700', DEEP_GREEN)}>Parent · {parentPhones[0]}</Text> : g.phone ? <Text style={tx(13, '700', DEEP_GREEN)}>{g.phone}</Text> : null}
            </View>
            {marking && g.status !== 'Refunded' ? (
              <View style={{ flexDirection: 'row', gap: 2, alignSelf: 'center' }}>
                {([['In', true], ['Out', false]] as const).map(([w, v]) => (
                  <Press key={w} onPress={() => setMarks((m) => ({ ...m, [g.bookingId]: v }))} accessibilityRole="radio" accessibilityState={{ selected: marks[g.bookingId] === v }}
                    style={{ minWidth: 44, minHeight: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: marks[g.bookingId] === v ? LIME : INACTIVE }}>
                    <Text style={tx(13, '800')}>{w}</Text>
                  </Press>
                ))}
              </View>
            ) : (
              <Text style={tx(13, '800', g.status === 'Refunded' ? INK_MUTED : DEEP_GREEN)}>{g.present === false ? 'Out' : g.status}</Text>
            )}
          </View>
        );
      })}
      {marking ? <Btn label="Save" onPress={() => void save()} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

function Waitlist({ d, reload }: { d: DeskEvent; reload: () => void }) {
  const w = d.waitlist;
  const [on, setOn] = useState(Boolean(w?.on));
  const flip = async () => {
    try { const r = await api.deskWaitlist(d.event.id, !on); setOn(r.on); reload(); } catch (e: any) { showToast(e.message); }
  };
  const left = (iso: string | null) => (iso ? `${Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000))} h left` : '');
  return (
    <View style={{ paddingTop: 12, gap: 8 }}>
      {d.view.owner ? (
        <Press onPress={() => void flip()} accessibilityRole="switch" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
          <Text style={tx(15, '700')}>Waiting list</Text>
          <Switch on={on} />
        </Press>
      ) : null}
      {on && w?.people.length ? w.people.map((p) => (
        <View key={p.position} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingVertical: 12 }}>
          <Text style={hx(18)}>{p.position}</Text>
          <Text style={[tx(15, '700'), { flex: 1 }]}>{p.household} · {p.party}</Text>
          {p.offered ? <View style={{ backgroundColor: AMBER, paddingHorizontal: 7, paddingVertical: 3 }}><Text style={tx(12, '800')}>Offered · {left(p.expiresAt)}</Text></View> : null}
        </View>
      )) : on ? <Empty>Nobody is waiting yet.</Empty> : null}
    </View>
  );
}

function Money({ d }: { d: DeskEvent }) {
  const m = d.money;
  if (!m) return null;
  if (m.private) {
    return (
      <View style={{ paddingTop: 12, gap: 3 }}>
        <Cell kicker="Event fee" value={m.eventFee === 'included' ? 'Included in Pro' : m.eventFee === 'paid' ? 'Paid' : '—'} />
        {m.booked ? <Cell kicker="Collected" value={gbp(m.booked)} /> : null}
      </View>
    );
  }
  return (
    <View style={{ paddingTop: 12, gap: 3 }}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        <Cell kicker="Booked" value={gbp(m.booked)} />
        <Cell kicker="Epic fee" value={gbp(m.fee)} />
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        <Cell kicker="Refunds" value={gbp(m.refunds)} />
        <Cell kicker="You get" value={gbp(m.youGetPence ?? 0)} ground={LIME_TINT} />
      </View>
      {(m.payouts ?? []).map((p, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: HAIRLINE, paddingVertical: 10 }}>
          <Text style={tx(14, '600')}>{dayWords(p.on)}</Text>
          <Text style={tx(14, '800')}>{gbp(p.pence)} · {p.state === 'paid' ? 'Paid' : p.state === 'held' ? 'Held' : 'Due'}</Text>
        </View>
      ))}
      <Text style={tx(12.5, '400', INK_MUTED)}>Paid 72 h after each session</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// sheets
// ---------------------------------------------------------------------------

function ShareSheet({ d, onClose }: { d: DeskEvent; onClose: () => void }) {
  const copy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) { await navigator.clipboard.writeText(d.event.link); showToast('Link copied'); }
    } catch { showToast('Couldn’t copy — select the link instead.'); }
  };
  return (
    <DeskSheet title="Share" onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: HAIRLINE, padding: 10 }}>
        <Text style={[tx(13.5, '600'), { flex: 1 }]} numberOfLines={1} selectable>{d.event.link}</Text>
        <Btn label="Copy" icon="copy" onPress={() => void copy()} />
      </View>
      <Kicker>For posters</Kicker>
      <View style={{ alignItems: 'center', padding: 12, backgroundColor: CREAM }}><QrCode value={d.event.link} size={160} /></View>
      <Kicker>For social</Kicker>
      <View style={{ backgroundColor: INK }}>
        <Photo uri={d.event.photo} height={180} radius={0} />
        <Text style={[hx(20, CREAM), { padding: 12 }]}>{d.event.title}</Text>
      </View>
    </DeskSheet>
  );
}

const ymd = (dt: Date) => dt.toISOString().slice(0, 10);

function ChangeDateSheet({ d, onClose, onDone }: { d: DeskEvent; onClose: () => void; onDone: () => void }) {
  const upcoming = d.sessions.filter((s) => s.state === 'scheduled' && !s.finished);
  const [sessionId, setSessionId] = useState<string | null>(upcoming.find((s) => s.id === d.sessionId)?.id ?? upcoming[0]?.id ?? null);
  const s = upcoming.find((x) => x.id === sessionId) ?? null;
  const [scope, setScope] = useState<'this' | 'after'>('this');
  const [toDate, setToDate] = useState<string | null>(null);
  const [toTime, setToTime] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.laneChangeDate>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const later = s ? upcoming.filter((x) => x.date > s.date).length : 0;
  useEffect(() => {
    setPreview(null); setErr(null);
    if (!s || !toDate) return;
    let gone = false;
    api.laneChangeDate(d.event.id, { sessionId: s.id, toDate, toTime: toTime && toTime !== s.time ? toTime : null, scope, preview: true })
      .then((r) => { if (!gone) setPreview(r); }).catch((e) => { if (!gone) setErr(e.message); });
    return () => { gone = true; };
  }, [s?.id, toDate, toTime, scope]);
  if (!s) return <DeskSheet title="Change date" onClose={onClose}><Empty>There is no session left to move.</Empty></DeskSheet>;
  const go = async () => {
    setBusy(true);
    try {
      await api.laneChangeDate(d.event.id, { sessionId: s.id, toDate: toDate!, toTime: toTime && toTime !== s.time ? toTime : null, scope });
      showToast(preview?.guests ? `Moved · ${preview.guests} ${preview.guests === 1 ? 'guest' : 'guests'} told` : 'Moved'); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <DeskSheet title="Change date" onClose={onClose}
      footer={<Btn label={busy ? 'Moving…' : preview ? 'Move it' : 'Pick the new date'} onPress={() => void go()} disabled={!preview || busy} />}>
      {upcoming.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
          {upcoming.map((x) => (
            <Press key={x.id} onPress={() => setSessionId(x.id)} accessibilityRole="radio" accessibilityState={{ selected: x.id === sessionId }}
              style={{ backgroundColor: x.id === sessionId ? LIME : INACTIVE, paddingHorizontal: 10, paddingVertical: 8 }}>
              <Text style={tx(13, '800')}>{dayWords(x.date)}</Text>
            </Press>
          ))}
        </View>
      ) : null}
      {later ? (
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {([['this', 'This session only'], ['after', 'This and all after it']] as const).map(([k, w]) => (
            <Press key={k} onPress={() => setScope(k)} accessibilityRole="radio" accessibilityState={{ selected: scope === k }}
              style={{ flex: 1, minHeight: TARGET, alignItems: 'center', justifyContent: 'center', backgroundColor: scope === k ? LIME : INACTIVE }}>
              <Text style={tx(13.5, scope === k ? '800' : '600')}>{w}</Text>
            </Press>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <View style={{ flex: 2 }}><DateBox value={toDate} words={toDate ? dayWords(toDate) : ''} onPick={setToDate} from={ymd(new Date())} placeholder="New date" /></View>
        <View style={{ flex: 1 }}><TimeBox value={toTime ?? s.time} onChange={setToTime} /></View>
      </View>
      {preview ? (
        <View style={{ gap: 6 }}>
          {preview.moved.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[tx(13.5, '600', INK_MUTED), { textDecorationLine: 'line-through' }]}>{dayWords(m.from.date)}{m.from.time ? ` · ${m.from.time}` : ''}</Text>
              <Icon name="forward" size={14} color={INK} />
              <Text style={tx(13.5, '800')}>{dayWords(m.to.date)}{m.to.time ? ` · ${m.to.time}` : ''}</Text>
            </View>
          ))}
          {preview.guests ? <Text style={tx(13.5, '400')}>{preview.guests} booked {preview.guests === 1 ? 'is' : 'are'} moved and told. Anyone it doesn’t suit can cancel for a full refund.</Text> : null}
          {d.event.decidesBy && d.event.decidesBy !== 'day_before' ? <Text style={tx(13.5, '400')}>Decides-by moves with it.</Text> : null}
          {preview.late ? <View style={{ backgroundColor: AMBER, padding: 10 }}><Text style={tx(13.5, '700')}>Within 48 hours: this counts against your standing</Text></View> : null}
        </View>
      ) : null}
      {err ? <Text style={tx(13.5, '600', RED)}>{err}</Text> : null}
    </DeskSheet>
  );
}

function EditSheet({ d, onClose, onDone }: { d: DeskEvent; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState('');
  const [max, setMax] = useState(d.event.maxCount ? String(d.event.maxCount) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const most = Math.max(0, ...d.sessions.filter((s) => !s.finished).map((s) => s.booked));
  const save = async () => {
    const body: { description?: string; maxCount?: number } = {};
    if (description.trim()) body.description = description.trim();
    const n = Number(max.replace(/\D/g, ''));
    if (max && n !== d.event.maxCount) body.maxCount = n;
    if (!Object.keys(body).length) { onClose(); return; }
    setBusy(true);
    try { await api.deskEdit(d.event.id, body); showToast('Saved'); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const rules: [string, string][] = [
    ['Description, photos, running order', 'Yes · guests are told'],
    ['Date', 'Through Change date'],
    ['Price', 'Fixed for people booked'],
    ['Most', most ? `Not below the ${most} booked` : 'Any'],
  ];
  return (
    <DeskSheet title="Edit" onClose={onClose} footer={<Btn label={busy ? 'Saving…' : 'Save'} onPress={() => void save()} disabled={busy} />}>
      {rules.map(([k, v]) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: HAIRLINE, paddingTop: 10 }}>
          <Text style={[tx(14, '700'), { flex: 1 }]}>{k}</Text>
          <Text style={tx(13.5, '400', INK_MUTED)}>{v}</Text>
        </View>
      ))}
      <Kicker>New description</Kicker>
      <TextInput value={description} onChangeText={setDescription} multiline placeholder="Leave empty to keep it as it is" placeholderTextColor={INK_MUTED}
        style={[tx(15), { borderWidth: 1, borderColor: HAIRLINE, padding: 10, minHeight: 96, textAlignVertical: 'top' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} accessibilityLabel="New description" />
      <Kicker>Most people</Kicker>
      <TextInput value={max} onChangeText={(t) => setMax(t.replace(/\D/g, '').slice(0, 5))} keyboardType="number-pad" accessibilityLabel="Most people"
        style={[tx(16, '700'), { borderWidth: 1, borderColor: HAIRLINE, padding: 10, width: 96 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
      {err ? <Text style={tx(13.5, '600', RED)}>{err}</Text> : null}
    </DeskSheet>
  );
}

const REASONS = [['illness', 'Illness'], ['weather', 'Weather'], ['venue', 'Venue problem'], ['numbers', 'Not enough people'], ['other', 'Something else']] as const;
type Reason = typeof REASONS[number][0];

function CancelSheet({ d, onClose, onDone }: { d: DeskEvent; onClose: () => void; onDone: () => void }) {
  const upcoming = d.sessions.filter((s) => s.state === 'scheduled' && !s.finished);
  const multi = upcoming.length > 1;
  const [scope, setScope] = useState<'session' | 'whole'>(multi ? 'session' : 'whole');
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const target = upcoming.find((s) => s.id === d.sessionId) ?? upcoming[0] ?? null;
  const soonest = scope === 'whole' ? upcoming[0] : target;
  const late = soonest ? (new Date(`${soonest.date}T${soonest.time ?? '00:00'}:00`).getTime() - Date.now()) < 48 * 3_600_000 : false;
  const ready = reason && (reason !== 'other' || note.trim());
  const go = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const r = await api.laneCancel(d.event.id, { sessionIds: scope === 'session' && target ? [target.id] : null, reason: reason!, note: note.trim() || null });
      showToast(r.refunds ? `Cancelled · ${r.refunds} ${r.refunds === 1 ? 'refund' : 'refunds'} on the way` : 'Cancelled'); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <DeskSheet title="Cancel" onClose={onClose}
      footer={<Btn label={busy ? 'Cancelling…' : ready ? (scope === 'whole' ? 'Cancel the event' : 'Cancel this session') : 'Choose why first'} kind={ready ? 'red' : 'grey'} onPress={() => void go()} disabled={!ready || busy} />}>
      {multi ? (
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {([['session', target ? `This session · ${dayWords(target.date)}` : 'This session'], ['whole', 'The whole event']] as const).map(([k, w]) => (
            <Press key={k} onPress={() => setScope(k)} accessibilityRole="radio" accessibilityState={{ selected: scope === k }}
              style={{ flex: 1, minHeight: TARGET, alignItems: 'center', justifyContent: 'center', backgroundColor: scope === k ? LIME : INACTIVE, paddingHorizontal: 6 }}>
              <Text style={tx(13.5, scope === k ? '800' : '600')} numberOfLines={1}>{w}</Text>
            </Press>
          ))}
        </View>
      ) : null}
      <Kicker>Why</Kicker>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
        {REASONS.map(([k, w]) => (
          <Press key={k} onPress={() => setReason(k)} accessibilityRole="radio" accessibilityState={{ selected: reason === k }}
            style={{ backgroundColor: reason === k ? LIME : INACTIVE, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' }}>
            <Text style={tx(13.5, reason === k ? '800' : '600')}>{w}</Text>
          </Press>
        ))}
      </View>
      {reason === 'other' ? (
        <TextInput value={note} onChangeText={setNote} placeholder="What happened" placeholderTextColor={INK_MUTED} accessibilityLabel="What happened"
          style={[tx(15), { borderWidth: 1, borderColor: HAIRLINE, padding: 10 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]} />
      ) : null}
      <Text style={tx(14, '600')}>Everyone booked gets a full refund and is told now.</Text>
      {late ? <View style={{ backgroundColor: AMBER, padding: 10 }}><Text style={tx(13.5, '700')}>This counts against your standing</Text></View> : null}
      {err ? <Text style={tx(13.5, '600', RED)}>{err}</Text> : null}
    </DeskSheet>
  );
}
