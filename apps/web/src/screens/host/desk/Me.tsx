/**
 * E13 · Profile and settings (hosting v4, README E13).
 *
 * Face, name, place and response time; Edit profile · See it as guests do;
 * videos when there are any. Then four tabs — Ratings · Checks · Settings ·
 * Help — opening on Ratings. Settings is Payouts first, then Co-hosts (three
 * switches each, payout splits later), the earnings goal, notifications, and
 * Pause / Stop hosting, Stop refused while bookings or payouts are
 * outstanding. Help is contact Epic and report an incident.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Text, TextInput, View } from 'react-native';
import { Press } from '../../../components/press';
import { Icon } from '../../../components/Icon';
import { useRouter, useQueryState, asOneOf } from '../../../router';
import { paths } from '../../../routes';
import { api } from '../../../api';
import { CREAM, DEEP_GREEN, HAIRLINE, INK, INK_MUTED, NEUTRAL, TARGET, fonts } from '../../../theme';
import { Switch } from '../v7/kit';
import { Btn, DeskSheet, Head, Kicker, Loading, Page, RED, Row, Section, Tabs, hx, tx } from './kit';
import { fullDate, gbp, type Cohost, type DeskProfile } from './model';

type Tab = 'ratings' | 'checks' | 'settings' | 'help';
const TABS = ['ratings', 'checks', 'settings', 'help'] as const;

const NOTIFICATIONS: [string, string][] = [
  ['new_booking', 'New booking'],
  ['ask_to_book_request', 'Ask-to-book request'],
  ['under_minimum', 'Under the minimum'],
  ['payout_sent', 'Payout sent'],
  ['payout_held', 'Payout held'],
  ['new_review', 'New review'],
  ['new_tip', 'New tip'],
];

const VIDEO_WORDS: Record<string, string> = { about: 'About me' };

/** "20 Mar 2026" from 'YYYY-MM-DD'. */
const fullDay = (ymd: string | null | undefined) => (ymd ? fullDate(ymd) : null);
const inputStyle = { fontFamily: fonts.body, fontSize: 15, color: INK, borderWidth: 1, borderColor: HAIRLINE, paddingHorizontal: 12, paddingVertical: 10, minHeight: TARGET } as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A ruled row with a deep-green word on the right and the chevron (Ratings, Standing). */
function LinkRow({ title, line, sub, word, onPress, star }: { title: string; line?: string | null; sub?: string | null; word: string; onPress?: (() => void) | null; star?: boolean }) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {star ? <Icon name="favourite" size={15} color={INK} fill /> : null}
          <Text style={tx(15.5, '800')}>{title}</Text>
        </View>
        {line ? <Text style={tx(13, '400', INK_MUTED)}>{line}</Text> : null}
        {sub ? <Text style={tx(12, '400', INK_MUTED)}>{sub}</Text> : null}
      </View>
      <Text style={tx(14, '800', DEEP_GREEN)}>{word}</Text>
      {onPress ? <Icon name="more" size={16} color={INK} /> : null}
    </View>
  );
  return onPress ? <Press onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>{body}</Press> : body;
}

/** A row with a switch; tapping anywhere on it flips it. */
function SwitchRow({ title, line, on, onFlip, disabled }: { title: string; line?: string | null; on: boolean; onFlip: () => void; disabled?: boolean }) {
  return (
    <Press onPress={disabled ? undefined : onFlip} accessibilityRole="switch" accessibilityState={{ checked: on, disabled: Boolean(disabled) }} accessibilityLabel={title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: HAIRLINE, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={tx(15, '700')}>{title}</Text>
        {line ? <Text style={tx(12.5, '400', INK_MUTED)}>{line}</Text> : null}
      </View>
      <Switch on={on} />
    </Press>
  );
}

const sees = (c: { guests: boolean; messages: boolean; money: boolean }) => {
  const parts = [c.guests ? 'guest list' : null, c.messages ? 'messages' : null, c.money ? 'money' : null].filter(Boolean) as string[];
  if (!parts.length) return 'Sees nothing yet';
  const s = parts.join(' · ');
  return `Sees ${s}`;
};

export function DeskMe() {
  const { navigate, back } = useRouter();
  const [tab, setTab] = useQueryState<Tab>('tab', 'ratings', asOneOf(TABS, 'ratings'));
  const [p, setP] = useState<DeskProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.deskProfile().then((x) => { setP(x); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!p) return <Loading error={error} />;

  const h = p.host;
  return (
    <Page>
      <Head back="Host" onBack={() => back(paths.host())} title="Profile and settings" />

      <View style={{ paddingHorizontal: 20, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        {h.photo
          ? <Image source={{ uri: h.photo }} style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: NEUTRAL }} accessibilityIgnoresInvertColors />
          : <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: NEUTRAL, alignItems: 'center', justifyContent: 'center' }}><Text style={hx(24)}>{h.name.slice(0, 1)}</Text></View>}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={hx(24)}>{h.name}</Text>
          <Text style={tx(13.5, '400', INK_MUTED)}>{[h.place, h.responseWords].filter(Boolean).join(' · ') || ' '}</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 16, flexDirection: 'row', gap: 4 }}>
        <Btn label="Edit profile" onPress={() => navigate(paths.hostMe())} style={{ flex: 1 }} />
        <Press onPress={() => navigate(paths.hostProfile(h.id))} accessibilityRole="button"
          style={{ flex: 1, minHeight: TARGET, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: HAIRLINE, backgroundColor: CREAM, paddingHorizontal: 10 }}>
          <Text style={tx(14.5, '800')} numberOfLines={1}>See it as guests do</Text>
        </Press>
      </View>

      {p.videos.length ? (
        <Section title="Videos">
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {p.videos.map((v, i) => {
              const tile = (
                <View style={{ height: 96, borderRadius: 8, backgroundColor: NEUTRAL, justifyContent: 'flex-end', padding: 6 }}>
                  <View style={{ alignSelf: 'flex-start', backgroundColor: INK, paddingHorizontal: 6, paddingVertical: 3 }}>
                    <Text style={tx(12, '800', CREAM)}>{VIDEO_WORDS[v.kind] ?? v.kind}</Text>
                  </View>
                </View>
              );
              return (
                <View key={`${v.kind}-${i}`} style={{ flex: 1, maxWidth: '33%' }}>
                  {v.url
                    ? <Press onPress={() => Linking.openURL(v.url!).catch(() => null)} accessibilityRole="button" accessibilityLabel={VIDEO_WORDS[v.kind] ?? v.kind}>{tile}</Press>
                    : tile}
                </View>
              );
            })}
          </View>
        </Section>
      ) : null}

      <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
        <Tabs<Tab> value={tab} onPick={(k) => setTab(k)}
          tabs={[{ key: 'ratings', label: 'Ratings' }, { key: 'checks', label: 'Checks' }, { key: 'settings', label: 'Settings' }, { key: 'help', label: 'Help' }]} />
      </View>

      {tab === 'ratings' ? <Ratings p={p} /> : null}
      {tab === 'checks' ? <Checks p={p} /> : null}
      {tab === 'settings' ? <Settings p={p} reload={load} /> : null}
      {tab === 'help' ? <Help /> : null}
    </Page>
  );
}

// --- Ratings ---------------------------------------------------------------

function Ratings({ p }: { p: DeskProfile }) {
  const { navigate } = useRouter();
  const r = p.ratings;
  const standing = r.standing;
  const tipsLine = `${plural(r.tips.count, 'tip', 'tips')} · ${gbp(r.tips.pence)} in tips`;
  return (
    <Section title="Ratings">
      <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
        {r.count > 0 ? (
          <LinkRow star={r.avg != null} title={`${r.avg == null ? '—' : r.avg.toFixed(1)} · ${plural(r.count, 'review', 'reviews')}`} line={tipsLine} word="All reviews" onPress={() => navigate(paths.hostReviews())} />
        ) : (
          <LinkRow title={`${plural(r.tips.count, 'tip', 'tips')} · ${gbp(r.tips.pence)}`} line="Tips from your guests · yours in full" word="See" onPress={() => navigate(paths.hostReviews({ tab: 'tips' }))} />
        )}
        <LinkRow title="Standing" line={standing.words} sub={standing.words ? null : standing.reason ?? null} word={standing.words ?? '—'} />
      </View>
    </Section>
  );
}

// --- Checks ----------------------------------------------------------------

const IDENTITY: Record<string, string> = { verified: 'Verified', pending: 'Waiting', failed: 'Didn’t pass', none: 'Not done' };
const CHECKED: Record<string, string> = { passed: 'Checked', submitted: 'Waiting', failed: 'Didn’t pass', none: 'Not done' };

function Checks({ p }: { p: DeskProfile }) {
  const c = p.checks;
  const insurance = c.insurance.expires;
  const lapsed = insurance ? new Date(`${insurance}T12:00:00Z`) < new Date() : false;
  return (
    <Section title="Checks">
      <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
        <Row title="Identity" line={c.identity.on ? `Since ${fullDay(c.identity.on)}` : null} right={IDENTITY[c.identity.state] ?? c.identity.state} muted={c.identity.state !== 'verified'} red={c.identity.state === 'failed'} />
        <Row title="Checked" line={[c.checked.level, c.checked.on ? fullDay(c.checked.on) : null].filter(Boolean).join(' · ') || null}
          right={CHECKED[c.checked.state] ?? c.checked.state} rightSub={c.checked.renewBy ? `Renew by ${fullDay(c.checked.renewBy)}` : null}
          muted={c.checked.state !== 'passed'} red={c.checked.state === 'failed'} />
        <Row title="Insurance" line={null} right={insurance ? `${lapsed ? 'Ended' : 'Until'} ${fullDay(insurance)}` : 'None on file'} muted={!insurance} red={lapsed} />
      </View>
    </Section>
  );
}

// --- Settings --------------------------------------------------------------

type CohostSheet = { kind: 'change'; c: Cohost } | { kind: 'add' } | null;

function Settings({ p, reload }: { p: DeskProfile; reload: () => Promise<unknown> }) {
  const { navigate } = useRouter();
  const s = p.settings;
  const [sheet, setSheet] = useState<CohostSheet>(null);
  const [notes, setNotes] = useState<Record<string, boolean>>(s.notifications);
  const [goal, setGoal] = useState(s.goalPence ? String(Math.round(s.goalPence / 100)) : '');
  const [goalSaved, setGoalSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pause, setPause] = useState(false);
  const [stop, setStop] = useState(false);
  const [busy, setBusy] = useState(false);

  const flipNote = async (key: string) => {
    const next = { ...notes, [key]: !(notes[key] ?? true) };
    setNotes(next);
    try { await api.deskSaveProfile({ notifications: next }); } catch (e: any) { setError(e.message); setNotes(notes); }
  };

  const saveGoal = async () => {
    const t = goal.trim().replace(/[£,\s]/g, '');
    if (t && !/^\d{1,7}$/.test(t)) { setError('A goal is a whole number of pounds.'); return; }
    setError(null);
    try { await api.deskSaveProfile({ goalPence: t ? Number(t) * 100 : null }); setGoalSaved(true); } catch (e: any) { setError(e.message); }
  };

  const act = async (fn: () => Promise<unknown>, done: () => void) => {
    setBusy(true);
    try { await fn(); done(); await reload(); } catch (e: any) { setError(e.message); done(); } finally { setBusy(false); }
  };

  const outstanding = [
    s.outstanding.bookings ? `${plural(s.outstanding.bookings, 'booking', 'bookings')} still to happen` : null,
    s.outstanding.payouts ? `${plural(s.outstanding.payouts, 'payout', 'payouts')} still to be paid` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View>
      {error ? <Text style={[tx(13.5, '600', INK_MUTED), { paddingHorizontal: 20, paddingTop: 14 }]}>{error}</Text> : null}

      <Section title="Payouts">
        <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          <Row title="Stripe account" right={s.payouts.ready ? 'Ready' : 'Not set up'} muted={!s.payouts.ready} />
          <Row title="Tax details" right={s.payouts.tax ?? 'Add tax details'} muted={!s.payouts.tax} onPress={s.payouts.tax ? null : () => navigate(paths.hostEarnings({ tab: 'payouts' }))} />
          <Row title="Earnings" onPress={() => navigate(paths.hostEarnings())} />
        </View>
      </Section>

      <Section title="Co-hosts">
        <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          {s.cohosts.map((c) => (
            <Row key={c.id} title={c.name} line={[sees(c), c.accepted ? null : 'Invited', c.events.length ? plural(c.events.length, 'event', 'events') : null].filter(Boolean).join(' · ')}
              onPress={() => setSheet({ kind: 'change', c })} />
          ))}
          <Press onPress={() => setSheet({ kind: 'add' })} accessibilityRole="button" style={{ paddingVertical: 14, borderTopWidth: 1, borderTopColor: HAIRLINE }}>
            <Text style={tx(15, '800')}>+ Add a co-host</Text>
          </Press>
        </View>
      </Section>

      <Section title="Earnings goal">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={tx(15.5, '800')}>£</Text>
          <TextInput value={goal} onChangeText={(v) => { setGoal(v); setGoalSaved(false); }} keyboardType="number-pad" inputMode="numeric" accessibilityLabel="Earnings goal a month, in pounds"
            onSubmitEditing={saveGoal} style={[inputStyle, { width: 110 }]} />
          <Text style={[tx(13.5, '400', INK_MUTED), { flex: 1 }]}>a month</Text>
          <Btn label={goalSaved ? 'Saved' : 'Save'} kind={goalSaved ? 'grey' : 'ink'} onPress={saveGoal} />
        </View>
      </Section>

      <Section title="Notifications">
        <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          {NOTIFICATIONS.map(([key, label]) => <SwitchRow key={key} title={label} on={notes[key] ?? true} onFlip={() => flipNote(key)} />)}
        </View>
      </Section>

      <Section title="Hosting">
        <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
          {s.stopped ? (
            <Row title="You’ve stopped hosting" />
          ) : (
            <>
              {s.paused
                ? <Row title="Hosting is paused" line="New bookings are stopped" right="Resume" onPress={() => act(() => api.deskPause(false), () => null)} />
                : <Row title="Pause hosting" onPress={() => setPause(true)} />}
              {s.canStop
                ? <Row title="Stop hosting" onPress={() => setStop(true)} />
                : <Row title="Stop hosting" line={outstanding ? `Not while ${outstanding}` : null} dim />}
            </>
          )}
        </View>
      </Section>

      {sheet ? <CohostSheetView sheet={sheet} onClose={() => setSheet(null)} onDone={async () => { setSheet(null); await reload(); }} /> : null}

      {pause ? (
        <DeskSheet title="Pause hosting" onClose={() => setPause(false)}
          footer={(
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="Keep hosting" kind="grey" onPress={() => setPause(false)} style={{ flex: 1 }} />
              <Btn label="Pause hosting" disabled={busy} onPress={() => act(() => api.deskPause(true), () => setPause(false))} style={{ flex: 1 }} />
            </View>
          )}>
          <Text style={tx(15, '400', INK, { lineHeight: 21 })}>New bookings stop. Events already booked still go ahead, and guests aren’t told anything.</Text>
        </DeskSheet>
      ) : null}

      {stop ? (
        <DeskSheet title="Stop hosting" onClose={() => setStop(false)}
          footer={(
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="Keep hosting" kind="grey" onPress={() => setStop(false)} style={{ flex: 1 }} />
              <Btn label="Stop hosting" kind="red" disabled={busy} onPress={() => act(() => api.deskStop(), () => setStop(false))} style={{ flex: 1 }} />
            </View>
          )}>
          <Text style={tx(15, '400', INK, { lineHeight: 21 })}>Your events end and nobody can book them.</Text>
        </DeskSheet>
      ) : null}
    </View>
  );
}

function CohostSheetView({ sheet, onClose, onDone }: { sheet: NonNullable<CohostSheet>; onClose: () => void; onDone: () => void }) {
  const start = sheet.kind === 'change' ? sheet.c : { guests: true, messages: true, money: false };
  const [perm, setPerm] = useState({ guests: start.guests, messages: start.messages, money: start.money });
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = async (k: 'guests' | 'messages' | 'money') => {
    const next = { ...perm, [k]: !perm[k] };
    setPerm(next);
    if (sheet.kind !== 'change') return;
    try { await api.deskChangeCohost(sheet.c.id, { [k]: next[k] }); } catch (e: any) { setError(e.message); setPerm(perm); }
  };

  const invite = async () => {
    if (!name.trim() || !contact.trim()) { setError('A name, and an email or phone.'); return; }
    setBusy(true);
    try { await api.deskAddCohost({ name: name.trim(), contact: contact.trim(), ...perm }); onDone(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (sheet.kind !== 'change') return;
    setBusy(true);
    try { await api.deskChangeCohost(sheet.c.id, { remove: true }); onDone(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <DeskSheet title={sheet.kind === 'change' ? sheet.c.name : 'Add a co-host'} onClose={sheet.kind === 'change' ? onDone : onClose}
      footer={sheet.kind === 'add' ? <Btn label="Send invite" disabled={busy} onPress={invite} /> : null}>
      {sheet.kind === 'add' ? (
        <View style={{ gap: 8 }}>
          <Kicker>Name</Kicker>
          <TextInput value={name} onChangeText={setName} autoFocus accessibilityLabel="Name" style={inputStyle} />
          <Kicker>Email or phone</Kicker>
          <TextInput value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" accessibilityLabel="Email or phone" style={inputStyle} />
        </View>
      ) : sheet.c.events.length ? (
        <Text style={tx(13.5, '400', INK_MUTED)}>{sheet.c.events.map((e) => e.title ?? 'Untitled').join(' · ')}</Text>
      ) : null}
      <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
        <SwitchRow title="Guest list" on={perm.guests} onFlip={() => flip('guests')} />
        <SwitchRow title="Messages" on={perm.messages} onFlip={() => flip('messages')} />
        <SwitchRow title="Money" on={perm.money} onFlip={() => flip('money')} />
      </View>
      <Text style={tx(13, '400', INK_MUTED)}>Payout splits come later.</Text>
      {error ? <Text style={tx(13.5, '600', INK_MUTED)}>{error}</Text> : null}
      {sheet.kind === 'change' ? (
        <Press onPress={busy ? undefined : remove} accessibilityRole="button" style={{ minHeight: TARGET, justifyContent: 'center' }}>
          <Text style={tx(15, '800', RED)}>Remove co-host</Text>
        </Press>
      ) : null}
    </DeskSheet>
  );
}

// --- Help ------------------------------------------------------------------

function Help() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const send = async () => {
    if (!body.trim()) { setError('Say what happened first.'); return; }
    setBusy(true);
    try { const r = await api.deskIncident({ body: body.trim() }); setSent(r.at); setOpen(false); setBody(''); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Section title="Help">
      <View style={{ borderBottomWidth: 1, borderBottomColor: HAIRLINE }}>
        <Row title="Contact Epic" line="hello@epic.day" onPress={() => { Linking.openURL('mailto:hello@epic.day').catch(() => null); }} />
        <Row title="Report an incident" line={sent ? 'Sent to Safety' : null} onPress={() => { setOpen(true); setError(null); }} />
      </View>
      {open ? (
        <DeskSheet title="Report an incident" onClose={() => setOpen(false)} footer={<Btn label="Send to Safety" disabled={busy} onPress={send} />}>
          <Text style={tx(13.5, '400', INK_MUTED)}>Goes straight to Safety. It can’t be deleted.</Text>
          <TextInput value={body} onChangeText={setBody} multiline autoFocus accessibilityLabel="What happened"
            style={[inputStyle, { minHeight: 120, textAlignVertical: 'top' }]} />
          {error ? <Text style={tx(13.5, '600', INK_MUTED)}>{error}</Text> : null}
        </DeskSheet>
      ) : null}
    </Section>
  );
}

