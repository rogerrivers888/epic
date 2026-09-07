import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, GroupItem, GroupItemInput, GroupItemKind, GroupParticipant, Place, TripDetail, TripGroup } from '../api';
import { colors, fonts, radius, spacing, TARGET, type } from '../theme';
import { Button, Card, Chip, Meter, Row, Segmented, StatusLine, Wrap } from './ui';
import { Icon, IconName } from './Icon';
import { QrCode } from './QrCode';
import { InviteEdit, InviteEditor, InviteLanding, InvitePageData, coverUri, pageFromGroup } from './InvitePage';
import { JoinScreen } from '../screens/JoinScreen';
import { DateRangePicker } from './DateRangePicker';
import { PlacePicker } from './PlacePicker';
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useViewport } from '../hooks/useViewport';
import { getViewer } from '../viewer';
import { paths } from '../routes';

/**
 * The group, from the organiser's side.
 *
 * Setting one up is four numbered questions in the owner's order (4 Sep 2026):
 * what everyone must do, how people get in, how often Roam chases, and what you
 * are charging for. They read as a wizard the first time — numbered, the one
 * you are on is the one that is open — and are a settings page ever after,
 * because the second visit is always "the coach quote came back higher".
 *
 * Chasing appears above them only once somebody has joined: an empty group is
 * not behind on anything.
 */


/**
 * The five things setting a group up asks, in the order they build on each
 * other. Each carries a line saying what it is for, because a title and a count
 * assume the organiser already knows what a group is — and they do not (owner,
 * 4 Sep 2026). The same five are the wizard on the first run and the settings
 * afterwards.
 */
type StepKey = 'what' | 'wanted' | 'chasing' | 'invite';
/**
 * `next` names the step it leads to, so the button says where it is going
 * rather than "Next"; `skip` says what skipping this one means, because "Skip"
 * on its own asks the organiser to guess what they are giving up.
 */
const STEPS: { key: StepKey; title: string; blurb?: string; next: string; skip?: string }[] = [
  // Step 1 carries its own headers — Trip name, Trip numbers — so a title and a
  // sentence above them would be saying it twice (owner, 7 Sep 2026).
  { key: 'what', title: 'Trip details', next: "Next · What's on the trip", skip: 'Skip — name it later' },
  {
    key: 'wanted',
    title: "What's on the trip?",
    blurb: 'Everything people are coming for, and what it costs them. Mandatory things are chased until each person has booked; optional ones just need a yes or no.',
    next: 'Next · Reminders',
    skip: 'Skip — nothing is mandatory',
  },
  { key: 'chasing', title: 'Reminders', blurb: 'Roam writes to whoever still has something outstanding, so you never ask twice.', next: 'Next · Ask them in' },  // "None" is one of the frequencies, so this step has no skip
  { key: 'invite', title: 'Ask them in', blurb: 'A code to hold up, a link, a WhatsApp group, or the names you already know.', next: "That's my group set up" },
];

const WIDE = 1000;
const money = (p?: number | null) => (p == null ? '—' : `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`);
const longDay = (iso?: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const day = (iso?: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '');
const daysUntil = (iso?: string | null) => (iso ? Math.round((new Date(`${iso.slice(0, 10)}T12:00:00`).getTime() - Date.now()) / 86400000) : null);
const ICON: Record<GroupItemKind, IconName> = { stay: 'hotel', activity: 'ticket', fee: 'money' };
const pence = (text: string) => (text.trim() === '' ? null : Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100));
const numberOrNull = (text: string) => (text.trim() === '' ? null : Math.max(0, Math.round(Number(text.replace(/[^0-9]/g, '')))));

/** A number is typed, never nudged (owner, 4 Sep 2026). */
function NumberBox({ value, onChange, onCommit, onFocus, placeholder, width = 88, prefix }: {
  value: string; onChange: (v: string) => void; onCommit?: () => void; onFocus?: () => void;
  placeholder?: string; width?: number; prefix?: string;
}) {
  // The box is the control, so the box takes the focus ring — a browser drawing
  // its own outline round the input inside it is a box in a box (owner, 4 Sep 2026).
  const [on, setOn] = useState(false);
  return (
    <View style={[styles.numberBox, { width }, on && styles.numberBoxOn]}>
      {prefix ? <Text style={[type.small, { color: colors.inkMuted }]}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => { setOn(true); onFocus?.(); }}
        onBlur={() => { setOn(false); onCommit?.(); }}
        onSubmitEditing={onCommit}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
        style={styles.numberInput}
      />
    </View>
  );
}

/** One of the four numbered questions: open, or folded to a line. */
function Block({ n, title, blurb, summary, open, onToggle, children }: {
  n: number; title: string; blurb?: string; summary: string; open: boolean; onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <Card style={{ gap: open ? spacing.sm : 0 }}>
      <Pressable onPress={onToggle} accessibilityRole="button">
        <Row style={{ alignItems: 'flex-start' }}>
          <View style={[styles.blockNumber, open && { backgroundColor: colors.primary }]}>
            <Text style={[styles.blockNumberText, open && { color: colors.primaryFg }]}>{n}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.h3}>{title}</Text>
            <Text style={type.small}>{summary}</Text>
          </View>
          <Icon name={open ? 'collapse' : 'expand'} size={16} />
        </Row>
      </Pressable>
      {open && blurb ? <Text style={type.small}>{blurb}</Text> : null}
      {open ? children : null}
    </Card>
  );
}


export function GroupPanel({ d, onChanged, onPage }: {
  d: TripDetail; onChanged?: () => Promise<void>;
  /** True while a page of the group's own has the screen, so the trip's chrome can stand down. */
  onPage?: (on: boolean) => void;
}) {
  const { width } = useViewport();
  const wide = width >= WIDE;
  const [g, setG] = useState<TripGroup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [block, setBlock] = useState<number | null>(1);
  // The invite page is a page, not a panel: writing it or looking at it takes
  // the whole screen, because that is the shape the guest will see it in.
  const [page, setPage] = useState<null | 'edit' | 'preview' | 'journey'>(null);
  // The wizard's place is kept here, so going off to the invite page and coming
  // back returns to the step it was left on rather than to step 1 (owner,
  // 7 Sep 2026: "If I preview and click back, it should take me back to step 5").
  const [step, setStep] = useState(0);
  useEffect(() => { onPage?.(page !== null); }, [page, onPage]);
  useEffect(() => () => onPage?.(false), [onPage]);
  // Which event has the panel: 'new', an item's id, or nothing. Held here
  // because the form takes the whole step over.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<InviteEdit | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.tripGroup(d.trip.id);
      setG('group' in r && r.group === null ? null : (r as TripGroup));
    } catch (e: any) { setError(e.message); } finally { setLoaded(true); }
  }, [d.trip.id]);
  useEffect(() => { load(); }, [load]);

  /** Every write returns the whole group, so the screen is never guessing. */
  const run = async (fn: () => Promise<TripGroup>) => {
    setBusy(true); setError(null);
    try { setG(await fn()); await onChanged?.(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (!loaded) return <Text style={type.small}>Loading…</Text>;
  if (!g) return <StartGroup d={d} onCreated={(created) => { setG(created); void onChanged?.(); }} />;

  const { group, items, participants, summary, reminders, warnings } = g;
  const active = participants.filter((p) => !p.withdrawnAt);
  const notJoined = active.filter((p) => !p.joinedAt);
  const left = participants.filter((p) => p.withdrawnAt);
  const days = daysUntil(group.wantedBy);
  const settingUp = !active.some((p) => p.joinedAt && !p.memberId);
  const wanted = items.filter((i) => i.kind !== 'fee' || !i.pricing);
  const costs = items.filter((i) => Boolean(i.pricing));
  const toGo = items.filter((i) => i.required && i.outstanding > 0);
  const owed = costs.reduce((n, i) => n + (i.money?.duePence ?? 0), 0);
  const gotIn = costs.reduce((n, i) => n + (i.money?.paidPence ?? 0), 0);

  const setItem = (id: string, body: Partial<GroupItemInput>) => run(() => api.updateGroupItem(group.id, id, body));

  // --- what is still outstanding, once there is somebody to chase ------------
  const chase = (
    <View style={{ gap: spacing.md }}>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={type.h2}>Still to chase</Text>
          <Text style={type.small}>{summary.joined} of {group.expectedCount ?? '—'} joined</Text>
        </Row>
        <Text style={type.small}>
          {group.wantedBy
            ? days != null && days >= 0 ? `Everything wanted by ${day(group.wantedBy)} — ${days} day${days === 1 ? '' : 's'} to go` : `Wanted by ${day(group.wantedBy)}`
            : 'No date set, so nobody is being chased yet.'}
          {summary.heads ? ` · ${summary.heads} head${summary.heads === 1 ? '' : 's'}` : ''}
          {group.minimumCount ? ` · needs ${group.minimumCount}` : ''}
        </Text>
        <Meter used={summary.complete} limit={Math.max(1, summary.joined)} label={`${summary.complete} of ${summary.joined} have done everything`} />
        {group.minimumCount && summary.heads < group.minimumCount ? (
          <View style={styles.warnBox}>
            <Icon name="allergen" size={15} color={colors.overrun} />
            <Text style={[type.small, { flex: 1 }]}>
              {group.minimumCount - summary.heads} more needed by {day(group.wantedBy)} or the trip is cancelled.
            </Text>
          </View>
        ) : null}
      </Card>

      {notJoined.length ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row><Icon name="person" size={16} /><Text style={type.h3}>{notJoined.length} {notJoined.length === 1 ? 'person has' : 'people have'} not joined</Text></Row>
            <Text style={[type.small, { color: colors.overrun, fontWeight: '700' }]}>{notJoined.length}</Text>
          </Row>
          <Text style={type.small}>{notJoined.map((p) => p.name).join(', ')}</Text>
        </Card>
      ) : null}

      {toGo.map((i) => (
        <Card key={i.id}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Row style={{ flex: 1, alignItems: 'flex-start' }}>
              <View style={{ paddingTop: 2 }}><Icon name={ICON[i.kind]} size={16} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.h3}>{i.label}</Text>
                <Text style={type.small}>{itemLine(i)}</Text>
              </View>
            </Row>
            <Text style={[type.small, { fontWeight: '700', color: colors.overrun }]}>{i.outstanding}</Text>
          </Row>
          <Meter used={i.done} limit={Math.max(1, summary.joined)} />
          {i.outstandingNames.length ? <Text style={type.small}>Waiting on: {i.outstandingNames.join(', ')}</Text> : null}
        </Card>
      ))}

      {warnings.length ? (
        <Card style={{ borderColor: colors.overrun }}>
          <Row><Icon name="allergen" size={16} color={colors.overrun} /><Text style={type.h3}>Worth a look</Text></Row>
          {warnings.map((w, n) => (
            <Text key={n} style={type.small}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{w.name}</Text> has “{w.item}” for {w.said}. The trip is {w.wanted}.
            </Text>
          ))}
        </Card>
      ) : null}
    </View>
  );

  // --- the four questions ---------------------------------------------------
  // Each step's content, written once: the wizard shows one at a time, the
  // settings page shows them folded.
  const content: Record<StepKey, React.ReactNode> = {
    what: <WhatThisIs group={g} onChange={(body) => run(() => api.updateGroup(group.id, body))} />,
    wanted: editing !== null ? (
      <EventForm
        group={g}
        item={editing === 'new' ? null : items.find((i) => i.id === editing) ?? null}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={(body) => {
          const id = editing === 'new' ? null : editing;
          setEditing(null);
          void run(() => (id ? api.updateGroupItem(group.id, id, body) : api.addGroupItem(group.id, body)));
        }}
        onRemove={editing === 'new' ? undefined : () => { const id = editing; setEditing(null); void run(() => api.removeGroupItem(group.id, id)); }}
        onSettle={editing === 'new' ? undefined : (body) => { const id = editing; void run(() => api.closeGroupItem(group.id, id, body)); }}
      />
    ) : (
      <>
        {/* One row per thing on the trip, and tapping it opens everything about
            it: what it is, when, what it costs, and who takes the money. There
            is no second step it is "priced in" (owner, 7 Sep 2026). */}
        {items.map((i) => (
          <Pressable key={i.id} style={styles.wantedRow} onPress={() => setEditing(i.id)} accessibilityRole="button">
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={styles.itemIcon}><Icon name={ICON[i.kind]} size={16} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Row><Text style={[type.h3, { flex: 1 }]}>{i.label}</Text><Icon name="edit" size={14} color={colors.inkMuted} /></Row>
                {itemMeta(i, group.paymentMode) ? <Text style={type.small}>{itemMeta(i, group.paymentMode)}</Text> : null}
                {costNow(i) ? <Text style={[type.small, { color: colors.accent }]}>{costNow(i)}</Text> : null}
              </View>
            </Row>
            <Row style={{ marginTop: spacing.sm }}>
              <View style={{ flex: 1 }} />
              <MustAsk value={i.required} onChange={(must) => setItem(i.id, { required: must })} />
            </Row>
          </Pressable>
        ))}
        {items.length === 0 ? <Text style={type.small}>Nothing on this trip yet.</Text> : null}
        <Pressable onPress={() => setEditing('new')} style={styles.addRow} accessibilityRole="button">
          <Icon name="add" size={16} />
          <Text style={[type.h3, { flex: 1 }]}>Add your own event</Text>
          <Icon name="more" size={16} />
        </Pressable>
      </>
    ),
    chasing: <Chasing group={g} settingUp={settingUp} onChange={(body) => run(() => api.updateGroup(group.id, body))} />,
    invite: (
      <Invite
        group={g}
        settingUp={settingUp}
        onChange={(body) => run(() => api.updateGroup(group.id, body))}
        onAdd={(body) => run(() => api.addGroupParticipant(group.id, body))}
        onEdit={() => { setDraft(null); setPage('edit'); }}
        onPreview={() => { setDraft(null); setPage('preview'); }}
      />
    ),
  };

  const summaries: Record<StepKey, string> = {
    what: `${group.name ?? 'Unnamed'}${group.expectedCount ? ` · ${group.expectedCount} expected` : ''}${group.minimumCount ? ` · needs ${group.minimumCount}` : ''}`,
    wanted: `${items.filter((i) => i.required).length} mandatory, ${items.filter((i) => !i.required).length} optional${costs.length ? ` · ${costs.length} priced` : ''}`,
    chasing: !reminders.on ? 'Off — you are chasing them yourself'
      : reminders.next ? `${reminders.cadence} — next on ${day(reminders.next.date)}`
      : group.wantedBy ? 'Every reminder has been sent' : 'Set a date and Roam will chase',
    invite: settingUp ? 'Nobody asked in yet' : `${summary.joined} joined of ${group.expectedCount ?? '—'}`,
  };

  // What the link opens: written here, and previewed with the same component
  // the guest is served, so "exactly as the link will show it" is a fact.
  if (page) {
    const base = pageFromGroup(g);
    const shown: InvitePageData = draft
      ? { ...base, invite: { ...base.invite, coverKind: draft.coverKind, coverUrl: draft.coverUrl, title: draft.inviteTitle || base.invite.title, summary: draft.inviteSummary, howItWorks: draft.howItWorks } }
      : base;
    return (
      <View style={{ gap: spacing.md }}>
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        {page === 'edit' ? (
          <InviteEditor
            data={base}
            draft={draft}
            tripPhotos={tripPhotos(d)}
            saving={busy}
            onClose={() => setPage(null)}
            onPreview={(body) => { setDraft(body); setPage('preview'); }}
            onSave={async (body) => { await run(() => api.updateGroup(group.id, body)); setDraft(null); setPage(null); }}
          />
        ) : page === 'journey' ? (
          /* The rest of what the link opens: the account, the household and
             Book your itinerary, exactly as a guest gets them and with nothing
             written down (owner, 7 Sep 2026). */
          <JoinScreen token={group.inviteToken} preview onExit={() => setPage('preview')} />
        ) : (
          /* The whole page, CTA and all, because "exactly as the link will show
             it" includes the button they will press — and pressing it walks the
             journey rather than stopping at the picture of it. */
          <InviteLanding
            data={shown}
            narrow={!wide}
            backLabel={draft ? 'Back to edit' : 'Back to the group'}
            onBack={() => setPage(draft ? 'edit' : null)}
            onNext={() => setPage('journey')}
          />
        )}
      </View>
    );
  }

  // First run: one step at a time, each saying what it is for.
  if (!group.setupDone) {
    return (
      <View style={{ gap: spacing.md }}>
        {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
        <Wizard
          content={content}
          summaries={summaries}
          at={step}
          onAt={setStep}
          bare={editing !== null}
          onDone={() => run(() => api.updateGroup(group.id, { setupDone: true }))}
          onSkip={(key) => { if (key === 'chasing' && group.remindersOn) void run(() => api.updateGroup(group.id, { remindersOn: false })); }}
        />
      </View>
    );
  }

  const blocks = (
    <View style={{ gap: spacing.md }}>
      {STEPS.map((s, n) => (
        <Block
          key={s.key}
          n={n + 1}
          title={s.title}
          blurb={s.blurb}
          summary={summaries[s.key]}
          open={block === n + 1}
          onToggle={() => setBlock(block === n + 1 ? null : n + 1)}
        >
          {content[s.key]}
        </Block>
      ))}
    </View>
  );

  const roster = (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.h2}>{settingUp ? 'Who you have added' : 'Everyone'}</Text>
        <Text style={type.small}>{active.length} · {summary.heads} heads</Text>
      </Row>
      {settingUp ? <Text style={type.small}>Nobody has joined yet. A name added here means their join lands on that row rather than making a second one.</Text> : null}
      {active.map((p) => (
        <PersonRow
          key={p.id}
          p={p}
          items={items}
          open={openPerson === p.id}
          busy={busy}
          onOpen={() => setOpenPerson(openPerson === p.id ? null : p.id)}
          onMark={(itemId, body) => run(() => api.markGroupItem(group.id, p.id, itemId, body))}
          onChange={(body) => run(() => api.updateGroupParticipant(group.id, p.id, body))}
          onRemind={() => run(() => api.chaseGroup(group.id, { participantIds: [p.id] }))}
        />
      ))}
      {left.length ? (
        <View style={{ gap: 4, marginTop: spacing.sm }}>
          <Text style={type.label}>DROPPED OUT</Text>
          {left.map((p) => (
            <Row key={p.id} style={{ justifyContent: 'space-between' }}>
              <Text style={type.small}>{p.name} · left {when(p.withdrawnAt)}</Text>
              <Chip label="Back in" onPress={() => run(() => api.updateGroupParticipant(group.id, p.id, { withdrawn: false }))} />
            </Row>
          ))}
        </View>
      ) : null}
    </Card>
  );

  // The trip itself can be called off by its own minimum; say so above everything.
  const cancelled = group.cancelledAt ? (
    <Card style={{ borderColor: colors.overrun }}>
      <Row><Icon name="allergen" size={16} color={colors.overrun} /><Text style={type.h2}>This trip was called off</Text></Row>
      <Text style={type.small}>{group.cancelledNote} Everybody has been told, and nothing was taken from anyone.</Text>
    </Card>
  ) : null;

  return (
    <View style={{ gap: spacing.md }}>
      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      {cancelled}
      <View style={wide ? styles.columns : undefined}>
        <View style={wide ? styles.colLeft : undefined}>{settingUp ? blocks : chase}</View>
        <View style={wide ? styles.colRight : { marginTop: spacing.md }}>{settingUp ? roster : <View style={{ gap: spacing.md }}>{roster}{blocks}</View>}</View>
      </View>
    </View>
  );
}

/**
 * Pictures this trip already has, offered as the invite's cover. They stay
 * references — `photo:<name>` is fetched through the API at display and the
 * bytes are never written down, because a provider's photograph is rented
 * (Technical Constraints §4).
 */
function tripPhotos(d: TripDetail): string[] {
  const out: string[] = [];
  for (const s of d.shortlist) {
    const p = s.venue?.photos?.[0];
    const url = p?.url ?? (p?.ref ? `photo:${p.ref}` : null);
    if (url && !out.includes(url)) out.push(url);
    if (out.length >= 6) break;
  }
  return out;
}

/** The one line under an item's name: what is done, or who has said yes. */
function itemLine(i: GroupItem) {
  if (i.pricing) return costLine(i);
  return i.required
    ? `${i.confirmed} booked${i.declared ? ` · ${i.declared} said so` : ''} · ${i.outstanding} to go`
    : `${i.coming} coming (${i.heads} head${i.heads === 1 ? '' : 's'}) · ${i.notComing} not · ${i.outstanding} haven't said`;
}

/** A soft label: what kind of cost this is, in two words. */
function Tag({ children }: { children: React.ReactNode }) {
  return <View style={styles.tag}><Text style={styles.tagText}>{children}</Text></View>;
}

/** "£1,000 to get back · depends on numbers" — what it is, before what it costs. */
function costHead(i: GroupItem) {
  if (i.state === 'cancelled') return `Called off — ${i.cancelledNote ?? 'it did not reach its minimum'}`;
  if (i.pricing === 'variable') return `${money(i.totalPence)} to get back · depends on numbers`;
  return `${money(i.amountPence)} each · same for everyone`;
}

/** "£25 each at 40 · no more than £50" — the figure the organiser will get. */
function costRange(i: GroupItem) {
  const m = i.money;
  if (!m) return '';
  if (i.state === 'closed') return `${money(i.settledPence)} each × ${i.settledHeads}`;
  if (i.pricing !== 'variable') return '';
  const at = m.expected ?? m.shares;
  return m.likelyPence ? `${money(m.likelyPence)} each at ${at} · no more than ${money(m.ceilingPence)}` : '';
}

/** A cost, in one line: what it is worth knowing before opening it. */
function costLine(i: GroupItem) {
  const m = i.money;
  if (!m) return '';
  if (i.state === 'cancelled') return `Called off — ${i.cancelledNote ?? 'it did not reach its minimum'}`;
  if (i.state === 'closed') return `${money(i.settledPence)} each × ${i.settledHeads} · ${money(m.paidPence)} in, ${money(m.duePence)} owed · due ${day(i.dueOn)}`;
  if (i.pricing === 'fixed') return `${money(i.amountPence)} each · ${money(m.paidPence)} in, ${money(m.duePence)} owed`;
  return `${money(i.totalPence)} to get back · no more than ${money(m.ceilingPence)} each · ${m.shares} on it${m.minimum ? `, needs ${m.minimum}` : ''}`;
}


/**
 * The first run: one step at a time, with what the step is for at the top of
 * it, and a way past anything that does not apply. Nothing here is compulsory —
 * every step can be skipped and changed later from the same five blocks.
 */
function Wizard({ content, summaries, onDone, onSkip, bare, at, onAt }: {
  content: Record<StepKey, React.ReactNode>; summaries: Record<StepKey, string>; onDone: () => void;
  onSkip?: (key: StepKey) => void;
  /** A step that has handed the panel to a form of its own: its title and its footer would be two conversations at once. */
  bare?: boolean;
  /** Which step, held by the panel so a trip to the invite page comes back to it. */
  at: number;
  onAt: (n: number) => void;
}) {
  const setAt = onAt;
  const step = STEPS[at];
  const last = at === STEPS.length - 1;
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.label}>Step {at + 1} of {STEPS.length}</Text>
      </Row>
      <View style={styles.progress}>
        {STEPS.map((s, i) => <View key={s.key} style={[styles.progressBar, i <= at && { backgroundColor: colors.accent }]} />)}
      </View>
      {bare ? null : (
        <>
          <Text style={type.h2}>{step.title}</Text>
          {step.blurb ? <Text style={type.small}>{step.blurb}</Text> : null}
        </>
      )}
      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>{content[step.key]}</View>
      {/* Next names where it goes, which is a sentence, not a word: on a phone
          it takes its own line and Back and Skip sit under it, rather than
          three controls sharing 390px and the third running off the edge
          (owner, 6 Sep 2026: "The 'What must everyone do?' goes off the side of
          the page"). */}
      {bare ? null : (
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        <Button label={step.next} icon={last ? 'check' : 'forward'} onPress={() => (last ? onDone() : setAt(at + 1))} />
        <Row style={{ alignItems: 'center' }}>
          {at > 0 ? <Button label="Back" icon="back" kind="ghost" onPress={() => setAt(at - 1)} /> : null}
          <View style={{ flex: 1 }} />
          {/* Skipping is a sentence you can read, not a button competing with Next. */}
          {!last && step.skip ? (
            <Pressable onPress={() => { onSkip?.(step.key); setAt(at + 1); }} accessibilityRole="button" style={{ paddingHorizontal: spacing.sm, paddingVertical: 6 }}>
              <Text style={[type.small, { color: colors.accent, fontWeight: '700' }]} numberOfLines={1}>{step.skip}</Text>
            </Pressable>
          ) : null}
        </Row>
      </View>
      )}
    </Card>
  );
}

/** Step 1: what it is called, and the three numbers that describe its size. */
function WhatThisIs({ group: g, onChange }: { group: TripGroup; onChange: (body: any) => void }) {
  const [at, setAt] = useState<'minimum' | 'expecting' | 'maximum' | null>(null);
  const [name, setName] = useState(g.group.name ?? '');
  const [minimum, setMinimum] = useState(g.group.minimumCount == null ? '' : String(g.group.minimumCount));
  const [expected, setExpected] = useState(g.group.expectedCount == null ? '' : String(g.group.expectedCount));
  const [maximum, setMaximum] = useState(g.group.maximumCount == null ? '' : String(g.group.maximumCount));
  useEffect(() => { setName(g.group.name ?? ''); }, [g.group.name]);
  const save = () => onChange({
    name: name.trim(),
    minimumCount: numberOrNull(minimum),
    expectedCount: numberOrNull(expected),
    maximumCount: numberOrNull(maximum),
  });
  return (
    <View style={{ gap: spacing.lg }}>
      {/* Headers, not a step title and a sentence about it (owner, 7 Sep 2026:
          "what I'd like is a header above the name, like 'Trip Name'… Don't
          want any capitals"). */}
      <View style={{ gap: 6 }}>
        <Text style={styles.section}>Trip name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={save}
          placeholder="What to call it"
          placeholderTextColor={colors.inkFaint}
          style={styles.input}
        />
      </View>

      {/* The sentence belongs to the header above it, and the boxes need room of
          their own (owner, 7 Sep 2026: "there's no room to breathe"). */}
      <View>
        <Text style={styles.section}>Trip numbers</Text>
        <Text style={[type.small, { marginTop: 4, marginBottom: spacing.lg }]}>Trip numbers can affect the price, and whether the trip or an activity goes ahead.</Text>
        <Row style={{ gap: spacing.lg }}>
          <View>
            <Text style={styles.fieldLabel}>Minimum</Text>
            <NumberBox value={minimum} onChange={setMinimum} onCommit={save} onFocus={() => setAt('minimum')} />
          </View>
          <View>
            <Text style={styles.fieldLabel}>Expecting</Text>
            <NumberBox value={expected} onChange={setExpected} onCommit={save} onFocus={() => setAt('expecting')} />
          </View>
          <View>
            <Text style={styles.fieldLabel}>Maximum</Text>
            <NumberBox value={maximum} onChange={setMaximum} onCommit={save} onFocus={() => setAt('maximum')} />
          </View>
        </Row>
        <View style={{ marginTop: spacing.lg }}>
          <SizePanel group={g} minimum={minimum} expected={expected} maximum={maximum} at={at} />
        </View>
      </View>
    </View>
  );
}

/**
 * What the three numbers mean, said as three separate facts rather than one
 * paragraph (v2 handover, step 1): what happens under the minimum, what happens
 * at the maximum, and what the expected number does to a shared cost — worked
 * through with the group's own biggest cost so it is a figure, not a rule.
 */
function SizePanel({ group: g, minimum, expected, maximum, at }: {
  group: TripGroup; minimum: string; expected: string; maximum: string; at: string | null;
}) {
  const min = numberOrNull(minimum) ?? g.group.minimumCount;
  const exp = numberOrNull(expected) ?? g.group.expectedCount;
  const max = numberOrNull(maximum) ?? g.group.maximumCount;
  // The biggest cost that moves with numbers is the one worth working through.
  const variable = g.items.filter((i) => i.pricing === 'variable' && i.totalPence).sort((a, b) => (b.totalPence ?? 0) - (a.totalPence ?? 0))[0];
  const at_ = (n: number | null | undefined) => (variable?.totalPence && n ? Math.ceil(variable.totalPence / n) : null);
  const lines: { icon: IconName; on: boolean; text: React.ReactNode }[] = [
    {
      icon: 'household', on: at === 'minimum',
      text: min
        ? <><Text style={styles.panelStrong}>Under {min}</Text> and the trip is called off — everybody is told and nothing is taken.</>
        : <><Text style={styles.panelStrong}>No minimum:</Text> the trip goes ahead regardless.</>,
    },
    {
      icon: 'locked', on: at === 'maximum',
      text: max
        ? <><Text style={styles.panelStrong}>At {max}</Text> it's full: the link stops taking people.</>
        : <><Text style={styles.panelStrong}>No maximum:</Text> no cap on group numbers.</>,
    },
    // Only worth a line once there is an expectation to divide by: an empty
    // box does not need explaining, it needs a number (owner, 7 Sep 2026).
    ...(exp ? [{
      icon: 'money' as IconName, on: at === 'expecting',
      text: (
        <>Shared costs divide by <Text style={styles.panelStrong}>{exp}</Text> until people actually join{variable && at_(exp) && at_(min)
          ? <> — {variable.label} at {money(variable.totalPence)} reads as <Text style={styles.panelStrong}>{money(at_(exp))}–{money(at_(min))} each</Text></>
          : ''}.</>
      ),
    }] : []),
  ];
  return (
    <View style={styles.panel}>
      {lines.map((l, i) => (
        <Row key={i} style={{ alignItems: 'flex-start' }}>
          <View style={{ paddingTop: 2 }}><Icon name={l.icon} size={16} /></View>
          <Text style={[type.small, { flex: 1 }, l.on && { color: colors.ink }]}>{l.text}</Text>
        </Row>
      ))}
    </View>
  );
}

/** The front door: what a group is, before there is one. */
/**
 * The Group tab before there is a group: a page somebody who tapped Group by
 * accident can scan in five seconds (owner, 4 Sep 2026). A headline, one
 * sentence, a picture of what it does, three bullets, one button — and nothing
 * to fill in, because every question is asked in the wizard afterwards.
 */
function StartGroup({ d, onCreated }: { d: TripDetail; onCreated: (g: TripGroup) => void }) {
  const { width } = useViewport();
  const wide = width >= 720;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      onCreated(await api.createTripGroup(d.trip.id, {
        name: d.trip.title ?? d.trip.place?.label ?? undefined,
        organiserMemberId: getViewer(d.attendees),
      }));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.hero, wide && { flexDirection: 'row', alignItems: 'center', gap: spacing.xl }]}>
        <View style={{ flex: 1, gap: spacing.sm }}>
          <Text style={[styles.hugeText, wide && { fontSize: 38, lineHeight: 40 }]}>Create a group trip.{'\n'}Everyone pays their share.</Text>
          <Text style={styles.heroSub}>
            Build the trip, invite a group, and set the reminders and the money once.
          </Text>
        </View>
        <GroupScene wide={wide} />
      </View>

      <View style={wide ? styles.sellGrid : { gap: spacing.sm }}>
        {SELL.map((f, i) => (
          <View key={f.title} style={[styles.sell, wide && styles.sellThird]}>
            <View style={styles.sellIcon}><Text style={styles.sellNumber}>{i + 1}</Text></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.sellTitle}>{f.title}</Text>
              <Text style={type.small}>{f.line}</Text>
            </View>
          </View>
        ))}
      </View>

      {error ? <StatusLine tone="warn">{error}</StatusLine> : null}
      <Button label={busy ? 'Setting it up…' : 'Create a group trip'} icon="forward" onPress={start} />
      <Text style={[type.small, { textAlign: 'center' }]}>Three minutes · five questions.</Text>
    </View>
  );
}

/**
 * The picture, because the sentence cannot be made short enough: the trip on
 * the left, and three of the people on it each holding their own bill.
 *
 * The faces are real people (owner, 4 Sep 2026), three Unsplash portraits
 * served by us rather than hot-linked, so the page costs no third-party request
 * and works with no signal. Provenance and licence: public/people/README.md.
 * Drop other files in and rename them here and nothing else changes.
 */
const FACES = ['/people/1.jpg', '/people/2.jpg', '/people/3.jpg'];

function GroupScene({ wide }: { wide: boolean }) {
  const rows = [
    { y: 42, amount: '£15' },
    { y: 90, amount: '£15' },
    { y: 138, amount: '£15' },
  ];
  return (
    <View style={[styles.scene, wide && { width: 300, height: 190 }]}>
      <Svg width="100%" height="100%" viewBox="0 0 300 186">
        <Defs>
          {rows.map((r, i) => <ClipPath key={r.y} id={`face${i}`}><Circle cx={168} cy={r.y} r={16} /></ClipPath>)}
        </Defs>

        {/* the trip itself */}
        <Rect x={14} y={28} width={92} height={124} rx={10} fill={colors.surface} stroke={colors.ink} strokeWidth={2} />
        <Rect x={28} y={44} width={64} height={9} rx={4.5} fill={colors.ink} opacity={0.85} />
        <Rect x={28} y={60} width={44} height={6} rx={3} fill={colors.ink} opacity={0.25} />
        <Rect x={28} y={76} width={64} height={20} rx={4} fill={colors.mint} />
        <Rect x={28} y={106} width={64} height={6} rx={3} fill={colors.ink} opacity={0.25} />
        <Rect x={28} y={119} width={38} height={6} rx={3} fill={colors.ink} opacity={0.25} />

        {rows.map((r, i) => (
          <G key={r.y}>
            <Line x1={106} y1={90} x2={150} y2={r.y} stroke={colors.ink} strokeWidth={1.2} strokeOpacity={0.3} strokeDasharray="3 4" />
            <Circle cx={168} cy={r.y} r={16} fill={colors.surfaceMuted} stroke={colors.ink} strokeWidth={2} />
            {FACES[i] ? (
              <SvgImage x={152} y={r.y - 16} width={32} height={32} href={{ uri: FACES[i] }} preserveAspectRatio="xMidYMid slice" clipPath={`url(#face${i})`} />
            ) : (
              <G>
                {/* a person, rather than their initial */}
                <Circle cx={168} cy={r.y - 4} r={5.4} fill={colors.ink} opacity={0.75} />
                <Path d={`M158.5 ${r.y + 12} a9.8 9.8 0 0 1 19 0 z`} fill={colors.ink} opacity={0.75} />
              </G>
            )}
            {/* their own share, paid their own way */}
            <Rect x={194} y={r.y - 13} width={74} height={26} rx={6} fill={colors.ink} />
            <SvgText x={231} y={r.y + 5} fontSize={13} fontWeight="800" fill={colors.bg} textAnchor="middle" fontFamily={fonts.body}>{r.amount}</SvgText>
          </G>
        ))}
        <SvgText x={231} y={178} fontSize={11} fontWeight="700" fill={colors.ink} opacity={0.55} textAnchor="middle" fontFamily={fonts.body}>and 21 more</SvgText>
      </Svg>
    </View>
  );
}

/**
 * Three lines, one sentence each.
 *
 * The middle one is deliberately not "we collect the cash and pay you
 * directly": Roam holds no money yet, so it works out every share and tells you
 * who has paid, and you are paid directly. The day a payment account exists
 * that line becomes the owner's original.
 */
const SELL: { title: string; line: string }[] = [
  { title: 'Mandatory or not, you choose', line: 'Say what everyone must do and what is only being asked about.' },
  { title: 'Add your own events', line: 'A coach, a band, a boat: they pay you directly, or Roam collects and pays you out.' },
  { title: 'A minimum and a maximum', line: 'Under the minimum nothing runs and nothing is taken; at the maximum the link stops taking people.' },
];

/** The two-word answer to what a row is: chased, or counted. */
function MustAsk({ value, onChange }: { value: boolean; onChange: (must: boolean) => void }) {
  return (
    <View style={styles.mustAsk}>
      <Pressable onPress={() => onChange(true)} style={[styles.mustAskHalf, value && styles.mustAskOn]} accessibilityRole="button">
        <Text style={[styles.mustAskText, value && styles.mustAskTextOn]} numberOfLines={1}>Mandatory</Text>
      </Pressable>
      <Pressable onPress={() => onChange(false)} style={[styles.mustAskHalf, !value && styles.mustAskOn]} accessibilityRole="button">
        <Text style={[styles.mustAskText, !value && styles.mustAskTextOn]} numberOfLines={1}>Optional</Text>
      </Pressable>
    </View>
  );
}

/** A row's second line: when it is, what it costs, and where it is booked. */
/**
 * The one line under an event's name: when it is, what it costs, and where the
 * money goes. Everything about one event is in one place now — there is no
 * second step it is "priced in" (owner, 7 Sep 2026: "I don't understand what
 * step 3 is when I've already created my event in step 2").
 */
function itemMeta(i: GroupItem, mode: 'direct' | 'roam') {
  const bits: string[] = [];
  if (i.startsOn) bits.push(`${day(i.startsOn)}${i.startsAt ? ` ${i.startsAt}` : ''}`);
  else if (i.detail) bits.push(i.detail);
  if (i.pricing === 'fixed' && i.amountPence) bits.push(`${money(i.amountPence)} each`);
  if (i.pricing === 'variable' && i.totalPence) bits.push(`${money(i.totalPence)} split by numbers`);
  if (i.pricing) bits.push((i.paymentMode ?? mode) === 'roam' ? 'Roam collects' : 'paid to you');
  if (i.minimumCount) bits.push(`needs ${i.minimumCount}`);
  if (i.closesOn) bits.push(`by ${day(i.closesOn)}`);
  if (i.bookWhere === 'yourself') bits.push('book your own');
  if (i.bookWhere === 'there') bits.push('pay there');
  return bits.join(' · ');
}

/** What a running shared cost is doing, in one line rather than four. */
function costNow(i: GroupItem) {
  const m = i.money;
  if (!m) return null;
  if (i.state === 'cancelled') return `Called off — ${i.cancelledNote ?? 'it did not reach its minimum'}`;
  if (i.state === 'closed') {
    return i.settledPence == null
      ? 'Closed with nobody on it — nothing to pay'
      : `Settled at ${money(i.settledPence)} each · payment due ${day(i.dueOn)}`;
  }
  if (i.pricing !== 'variable') return null;
  const each = m.likelyPence ?? m.perSharePence;
  return `${each ? `About ${money(each)} each · ` : ''}nothing is taken until the deadline, ${day(m.closesOn)}`;
}

/** Adding an event of the organiser's own: its own screen, from the v2 handover. */
/**
 * Adding your own event is its own screen, not a form grown at the foot of the
 * list (handover screen 07; owner, 6 Sep 2026: "Adding your own event then
 * takes you into a part where you can't see anything"). On a phone that is the
 * difference between a form and a form you have to scroll six rows to find.
 */
/**
 * One event, everything about it — over two screens, because it is a real form
 * and a phone is 390px wide (owner, 7 Sep 2026: "I feel like maybe this needs
 * to be split into 2 steps because it's looking very long here").
 *
 *   What it is · the date, the time, whether everyone is expected, where to
 *                meet and anything else they should know
 *   The money  · what it costs, how few it can run with, the deadline for
 *                saying yes, and who takes the money
 *
 * It is the same screen whether the event is being made or changed, and it
 * carries the price, because who takes the money and how much are facts about
 * the event and not about the group.
 *
 * A price is per person. A household pays for the heads it brings, which is the
 * same arithmetic said once instead of twice.
 */
function EventForm({ group: g, item, busy, onSave, onClose, onRemove, onSettle }: {
  group: TripGroup;
  item: GroupItem | null;
  busy: boolean;
  onSave: (body: GroupItemInput) => void;
  onClose: () => void;
  onRemove?: () => void;
  onSettle?: (body: { action: 'close' | 'extend' | 'cancel' | 'reopen'; closesOn?: string }) => void;
}) {
  const [page, setPage] = useState<0 | 1>(0);
  const [label, setLabel] = useState(item?.label ?? '');
  // A new event starts on the day the trip does; one that has never had a date
  // is not given one behind the organiser's back.
  const [on, setOn] = useState(item ? (item.startsOn ?? '') : (g.trip.startDate ?? ''));
  const [at, setAt] = useState(item?.startsAt ?? '');
  const [must, setMust] = useState(item?.required ?? false);
  const [meet, setMeet] = useState<Place | null>(item?.meet?.label ? { label: item.meet.label, lat: item.meet.lat ?? 0, lng: item.meet.lng ?? 0 } : null);
  const [note, setNote] = useState(item?.guestNote ?? '');
  const [price, setPrice] = useState<'free' | 'fixed' | 'variable'>(item?.pricing ?? 'free');
  const [amount, setAmount] = useState(item?.amountPence != null ? String(item.amountPence / 100) : '');
  const [total, setTotal] = useState(item?.totalPence != null ? String(item.totalPence / 100) : '');
  const [minimum, setMinimum] = useState(item?.minimumCount != null ? String(item.minimumCount) : '');
  const [deadline, setDeadline] = useState(item?.closesOn ?? '');
  const [mode, setMode] = useState<'direct' | 'roam'>(item?.paymentMode ?? g.group.paymentMode);
  const [said, setSaid] = useState<string | null>(null);

  const body = (): GroupItemInput => ({
    kind: item?.kind ?? 'activity', label: label.trim(), required: must, perHead: true,
    pricing: price === 'free' ? null : price,
    amountPence: price === 'fixed' ? pence(amount) : null,
    totalPence: price === 'variable' ? pence(total) : null,
    paymentMode: price === 'free' ? null : mode,
    minimumCount: numberOrNull(minimum),
    // The date people have to have said yes by. It is what a minimum is counted
    // on, and what a shared price is worked out on, so it is asked for whenever
    // either of those exists — not only when the price moves (owner, 7 Sep 2026).
    closesOn: deadline || null,
    startsOn: on || null, startsAt: at || null,
    meet: meet ? { label: meet.label, lat: meet.lat || null, lng: meet.lng || null } : null,
    guestNote: note.trim() || null,
    bookWhere: item?.bookWhere ?? (price === 'free' ? null : 'roam'),
  });

  const save = () => {
    if (!label.trim()) { setSaid('Give it a name.'); setPage(0); return; }
    if (price === 'fixed' && !pence(amount)) { setSaid('Say what it costs each, or make it free.'); return; }
    if (price === 'variable' && !pence(total)) { setSaid('Say what the whole thing costs.'); return; }
    // A price worked out on a headcount has to have a day it is worked out on,
    // or it never settles and nobody is ever billed.
    if (price === 'variable' && !deadline) { setSaid('Give it a deadline — that is the day the price is fixed and the bill goes out.'); return; }
    onSave(body());
  };

  const m = item?.money;
  const wantsDeadline = price !== 'free' || Boolean(numberOrNull(minimum));

  return (
    <View style={{ gap: spacing.xl }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.label}>{item ? 'Edit event' : 'Add your own event'} · {page + 1} of 2</Text>
          <Text style={type.h2}>{page === 0 ? 'What it is' : 'Numbers and money'}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}><Icon name="close" size={18} /></Pressable>
      </Row>

      {page === 0 ? (
        <>
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput value={label} onChangeText={setLabel} placeholder="Coach from Reading" placeholderTextColor={colors.inkFaint} style={styles.input} autoFocus={!item} />
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={styles.fieldLabel}>Event date</Text>
            <DayPick value={on} onChange={setOn} />
            <Row style={{ gap: spacing.md, alignItems: 'center' }}>
              <Text style={[styles.fieldLabel, { marginBottom: 0 }]}>Start time</Text>
              <TextInput value={at} onChangeText={setAt} placeholder="19:30" placeholderTextColor={colors.inkFaint} style={[styles.input, { width: 104, textAlign: 'center' }]} />
            </Row>
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={styles.section}>Mandatory or optional</Text>
            <Segmented
              value={must ? 'must' : 'ask'}
              options={[{ value: 'must', label: 'Mandatory' }, { value: 'ask', label: 'Optional' }]}
              onChange={(v) => setMust(v === 'must')}
            />
            <Text style={type.small}>
              {must
                ? 'Everyone is expected on it, and is chased until they have booked.'
                : 'People say yes or no, and only those who say yes are counted or charged.'}
            </Text>
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={styles.section}>Where to meet</Text>
            <PlacePicker value={meet} onPick={setMeet} near={null} placeholder="Search an address or a landmark" />
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={styles.section}>Any other details</Text>
            <TextInput
              value={note} onChangeText={setNote} multiline
              placeholder="What to bring, what time to be there, anything they should know"
              placeholderTextColor={colors.inkFaint} style={[styles.input, { minHeight: 80, paddingTop: spacing.sm }]}
            />
          </View>

          {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
          <Button label="Next · Numbers and money" icon="forward" onPress={() => { setSaid(null); setPage(1); }} />
          <Button label="Cancel" kind="ghost" onPress={onClose} />
        </>
      ) : (
        <>
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.section}>Price</Text>
            <Segmented
              value={price}
              options={[{ value: 'free' as const, label: 'Free' }, { value: 'fixed' as const, label: 'Same each' }, { value: 'variable' as const, label: 'By numbers' }]}
              onChange={setPrice}
            />
            {price === 'fixed' ? (
              <Row style={{ gap: spacing.md, alignItems: 'center' }}>
                <NumberBox value={amount} onChange={setAmount} prefix="£" width={116} />
                <Text style={[type.small, { flex: 1 }]}>each, whoever comes</Text>
              </Row>
            ) : null}
            {price === 'variable' ? (
              <Row style={{ gap: spacing.md, alignItems: 'center' }}>
                <NumberBox value={total} onChange={setTotal} prefix="£" width={116} />
                <Text style={[type.small, { flex: 1 }]}>in total, split by the number of people who come</Text>
              </Row>
            ) : null}
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={styles.section}>Fewest it can run with</Text>
            <Row style={{ gap: spacing.md, alignItems: 'center' }}>
              <NumberBox value={minimum} onChange={setMinimum} width={116} />
              <Text style={[type.small, { flex: 1 }]}>
                {numberOrNull(minimum)
                  ? `Under ${numberOrNull(minimum)} by the deadline and it is called off — everybody is told and nothing is taken.`
                  : 'Leave it empty and it runs whoever says yes.'}
              </Text>
            </Row>
          </View>

          {wantsDeadline ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={styles.section}>Deadline to say yes</Text>
              <DayPick value={deadline} onChange={setDeadline} />
            </View>
          ) : null}

          {price !== 'free' ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={styles.section}>Who takes the money</Text>
              <Segmented
                value={mode}
                options={[{ value: 'direct' as const, label: 'Straight to you' }, { value: 'roam' as const, label: 'Roam collects' }]}
                onChange={setMode}
              />
              <Text style={type.small}>
                {mode === 'roam'
                  ? 'Roam takes it with their booking and pays it out to you.'
                  : 'They pay you however you normally do it, and you tick it off here.'}
              </Text>
            </View>
          ) : null}

          {/* A cost that is already running: the two things that can happen to it
              early, in the words for what they do. */}
          {item && onSettle && item.pricing === 'variable' && item.state === 'open' && m ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={styles.section}>This one is running</Text>
              <Text style={type.small}>{m.shares} on it so far. Roam settles it on the deadline by itself — these are for when it changes.</Text>
              <Wrap>
                <Chip label="Settle it now" icon="check" onPress={() => onSettle({ action: 'close' })} />
                <Chip label="Give it a week" icon="hours" onPress={() => onSettle({ action: 'extend', closesOn: plusWeek(m.closesOn) })} />
                <Chip label="Call it off" icon="close" onPress={() => onSettle({ action: 'cancel' })} />
              </Wrap>
            </View>
          ) : null}
          {item && onSettle && item.state !== 'open' ? (
            <Wrap><Chip label="Put it back" icon="refresh" onPress={() => onSettle({ action: 'reopen' })} /></Wrap>
          ) : null}

          {said ? <StatusLine tone="warn">{said}</StatusLine> : null}
          <Button label={item ? 'Save' : 'Add it'} icon={item ? 'check' : 'forward'} loading={busy} onPress={save} />
          <Row>
            <Button label="Back" kind="ghost" icon="back" onPress={() => setPage(0)} />
            <View style={{ flex: 1 }} />
            {/* Nothing is deleted out from under somebody who has paid for it. */}
            {onRemove && !item?.money?.paidPence ? <Button label="Delete" kind="danger" icon="delete" onPress={onRemove} /> : null}
          </Row>
        </>
      )}
    </View>
  );
}
function Invite({ group: g, settingUp, onChange, onAdd, onEdit, onPreview }: {
  group: TripGroup; settingUp: boolean; onChange: (body: any) => void; onAdd: (body: any) => void;
  onEdit: () => void; onPreview: () => void;
}) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const written = Boolean(g.group.invite.summary || g.group.invite.howItWorks.length || g.group.invite.coverUrl);

  // The invite is its own page (`/join/<token>`), not a query on whatever page
  // the organiser happened to be on when they copied it.
  const link = useMemo(() => {
    const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://roam.app';
    return `${base}${paths.join(g.group.inviteToken)}`;
  }, [g.group.inviteToken]);
  const message = `${g.group.name ?? 'A trip'} — say you're coming and see what's needed: ${link}`;

  return (
    <View style={{ gap: spacing.md }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <QrCode value={link} size={132} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={type.h3}>Point a phone at this</Text>
          <Text style={type.small}>It opens their own list. No account, no password.</Text>
          <Text style={[type.small, { color: colors.accent }]} selectable numberOfLines={2}>{link}</Text>
          <Pressable onPress={() => onChange({ newLink: true })} accessibilityRole="button" hitSlop={6}>
            <Text style={type.small}>Replace this link</Text>
          </Pressable>
        </View>
      </Row>
      {/* Three chips on one line, as the handover draws them: a long label
          wraps the row onto three and the step stops fitting a phone (owner,
          7 Sep 2026: "It was more compact, so you could fit everything on"). */}
      <Wrap>
        <Chip
          label={copied ? 'Copied' : 'Copy link'}
          icon={copied ? 'check' : 'copy'}
          onPress={async () => {
            if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
              await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000);
            }
          }}
        />
        <Chip
          label="WhatsApp"
          icon="message"
          onPress={() => { if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(`https://wa.me/?text=${encodeURIComponent(message)}`); }}
        />
        <Chip label={g.group.closed ? 'Closed' : 'Open'} icon={g.group.closed ? 'locked' : 'check'} selected={!g.group.closed} onPress={() => onChange({ closed: !g.group.closed })} />
      </Wrap>

      {/* Names are the exception, not the way in: the link is. So this is a
          line you open when you have some, not a form in everybody's way. */}
      {adding ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.section}>Add the ones you know</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Their name" placeholderTextColor={colors.inkFaint} style={styles.input} />
          <TextInput value={contact} onChangeText={setContact} placeholder="Mobile or email, so Roam can remind them" placeholderTextColor={colors.inkFaint} style={styles.input} autoCapitalize="none" />
          <Row>
            <Button label="Add them" kind="secondary" onPress={() => { if (!name.trim()) return; onAdd({ name: name.trim(), contact: contact.trim() || undefined }); setName(''); setContact(''); }} />
            <Button label="Done" kind="ghost" onPress={() => setAdding(false)} />
          </Row>
          <Text style={type.small}>Anyone holding the link can join. A name added first means their join lands on that row.</Text>
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} accessibilityRole="button">
          <Row><Icon name="add" size={16} color={colors.accent} /><Text style={[type.h3, { color: colors.accent }]}>Add the ones you know</Text></Row>
        </Pressable>
      )}

      {/* What the link opens (Epic 3): the one thing on this step the organiser
          writes rather than shares. */}
      <Card>
        <Row style={{ alignItems: 'flex-start' }}>
          <View style={styles.pagePreview}>
            {coverUri(g.group.invite.coverUrl, 240)
              ? <Image source={{ uri: coverUri(g.group.invite.coverUrl, 240)! }} style={styles.pagePreviewImg} accessibilityIgnoresInvertColors />
              : <View style={styles.pagePreviewBlank}><View style={styles.pagePreviewBar} /><View style={[styles.pagePreviewBar, { width: '50%' }]} /></View>}
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={type.h3}>What the link opens</Text>
            <Text style={type.small}>
              {g.group.invite.summary
                ? `“${g.group.invite.summary.slice(0, 70)}${g.group.invite.summary.length > 70 ? '…' : ''}”`
                : 'Your summary, what they get, how it works. Written from the trip — change any of it.'}
            </Text>
            <Row style={{ marginTop: 4 }}>
              <Pressable onPress={onEdit} accessibilityRole="button">
                <Row><Icon name="edit" size={16} color={colors.accent} /><Text style={[type.h3, { color: colors.accent }]}>{written ? 'Edit' : 'Write it'}</Text></Row>
              </Pressable>
              {/* Nothing to preview until there is something written (owner,
                  7 Sep 2026: "there should be no preview… because it hasn't been
                  edited or created yet. I think it should be 'edit' first"). */}
              {written ? (
                <Pressable onPress={onPreview} accessibilityRole="button" style={{ marginLeft: spacing.md }}>
                  <Row><Icon name="preview" size={16} color={colors.accent} /><Text style={[type.h3, { color: colors.accent }]}>Preview</Text></Row>
                </Pressable>
              ) : null}
            </Row>
          </View>
        </Row>
      </Card>
    </View>
  );
}

const plusWeek = (iso?: string | null) => {
  const d = iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`) : new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
};

/**
 * A date, written the way it is said, with a calendar to change it — not a box
 * of hyphens (owner, 4 Sep 2026).
 */
function DayPick({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: spacing.sm }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button">
        <Row>
          <Icon name="calendar" size={16} />
          <Text style={type.h3}>{value ? longDay(value) : 'Pick a date'}</Text>
          <Icon name={open ? 'collapse' : 'expand'} size={14} />
        </Row>
      </Pressable>
      {open ? (
        <DateRangePicker
          single
          start={value || null}
          end={value || null}
          onApply={(start) => { onChange(start); setOpen(false); }}
        />
      ) : null}
    </View>
  );
}

/**
 * Step 4, and the settings block it becomes: one date, one tone, the dates that
 * fall out of them, and the actual message. Nothing about delivery here — that
 * belongs on the chase screen, not on the screen where it is being set up.
 */
function Chasing({ group: g, settingUp, onChange }: {
  group: TripGroup; settingUp: boolean; onChange: (body: any) => void;
}) {
  const [pick, setPick] = useState(false);
  const r = g.reminders;
  const sent = r.schedule.filter((x) => x.done).length;
  const daysBefore = g.trip.startDate && g.group.wantedBy ? daysUntilFrom(g.group.wantedBy, g.trip.startDate) : null;

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.dateCard}>
        {/* The date is the control, not the pencil beside it. */}
        <Pressable onPress={() => setPick(!pick)} accessibilityRole="button" accessibilityLabel="Change the date">
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.fieldLabel}>Everything booked by</Text>
              <Text style={type.h2}>{longDay(g.group.wantedBy) || 'Pick a date'}</Text>
              {daysBefore != null && daysBefore > 0 ? <Text style={type.small}>{daysBefore} days before you go</Text> : null}
            </View>
            <Icon name="edit" size={16} />
          </Row>
        </Pressable>
        {pick ? (
          <DateRangePicker
            single
            inline
            start={g.group.wantedBy}
            end={g.group.wantedBy}
            onApply={(start) => { onChange({ wantedBy: start }); setPick(false); }}
            onCancel={() => setPick(false)}
          />
        ) : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={styles.section}>Reminder frequency</Text>
        {/* None is a frequency, not a way out of the step (owner, 7 Sep 2026:
            "the 'I'll chase them myself' option should be on the reminder
            frequency, not how firm… we should also have an option for None"). */}
        <Segmented
          value={r.on ? g.group.cadence : 'none'}
          options={[
            ...r.cadences.map((c) => ({ value: c.key, label: `${c.label} · ${c.runs}` })),
            { value: 'none', label: 'None' },
          ]}
          onChange={(c) => onChange(c === 'none' ? { remindersOn: false } : { remindersOn: true, cadence: c })}
        />
        {!r.on ? <Text style={type.small}>Nobody is chased. You are doing it yourself.</Text> : null}
      </View>

      {r.on && r.schedule.length ? (
        <View style={styles.timeline}>
          {r.schedule.map((x) => (
            <View key={x.date} style={{ flex: 1, gap: 6 }}>
              <View style={styles.timelineDot}><View style={[styles.timelineDotInner, x.done && { backgroundColor: colors.inkFaint }]} /></View>
              <Text style={type.small}>{day(x.date)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {r.on && r.preview ? (
        <View style={styles.previewBox}>
          <Text style={[type.small, { color: colors.headerSub }]}>
            <Text style={{ fontWeight: '700' }}>What they'll get{r.next ? `, ${day(r.next.date)}` : ''}: </Text>
            “{r.preview}”
          </Text>
        </View>
      ) : null}

      {settingUp || !r.on ? null : <Text style={type.small}>{sent} of {r.schedule.length} sent.</Text>}
    </View>
  );
}

/** Whole days between two dates, which is what "14 days before you go" means. */
function daysUntilFrom(from?: string | null, to?: string | null) {
  if (!from || !to) return null;
  return Math.round((new Date(`${to.slice(0, 10)}T12:00:00`).getTime() - new Date(`${from.slice(0, 10)}T12:00:00`).getTime()) / 86400000);
}

function PersonRow({ p, items, open, busy, onOpen, onMark, onChange, onRemind }: {
  p: GroupParticipant; items: GroupItem[]; open: boolean; busy: boolean;
  onOpen: () => void; onMark: (itemId: string, body: any) => void; onChange: (body: any) => void; onRemind: () => void;
}) {
  const [note, setNote] = useState(p.note ?? '');
  const done = items.filter((i) => i.required).length - p.outstanding.length;
  return (
    <View style={styles.person}>
      <Pressable onPress={onOpen} accessibilityRole="button">
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Row>
              <Text style={type.h3}>{p.name}</Text>
              {p.memberId ? <Chip label="You" selected /> : null}
              {p.heads > 1 ? <Chip label={`Household of ${p.heads}`} icon="household" /> : null}
            </Row>
            {p.brings ? <Text style={type.small}>With {p.brings}</Text> : null}
            <Text style={type.small}>
              {!p.joinedAt ? `Not joined${p.invitedAt ? ` · link sent ${when(p.invitedAt)}` : ''}`
                : p.outstanding.length ? `${p.outstanding.map((o) => o.label).slice(0, 2).join(', ')}${p.outstanding.length > 2 ? ` and ${p.outstanding.length - 2} more` : ''} outstanding`
                : 'All done'}
              {p.lastRemindedAt ? ` · chased ${when(p.lastRemindedAt)}` : ''}
            </Text>
          </View>
          <Icon name={open ? 'collapse' : 'more'} size={16} />
        </Row>
      </Pressable>
      {open ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {items.map((i) => {
            const s = p.states[i.id];
            const label = !s ? 'Nothing yet'
              : s.status === 'declared' ? `Their word: ${s.whereBooked ?? 'booked elsewhere'}${s.bookingRef ? ` · ${s.bookingRef}` : ''}`
              : s.status === 'booked' ? `Booked${s.bookingRef ? ` · ${s.bookingRef}` : ''}`
              : s.status === 'paid' ? `Paid ${money(s.amountPence ?? i.amountPence)} · ${when(s.on)}`
              : s.status === 'in' ? 'Coming' : 'Not coming';
            return (
              <Row key={i.id} style={{ justifyContent: 'space-between' }}>
                <Row style={{ flex: 1 }}>
                  <Icon name={ICON[i.kind]} size={14} color={s ? colors.like : colors.inkMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={type.small}>{i.label}</Text>
                    <Text style={type.small}>{label}</Text>
                  </View>
                </Row>
                {i.kind === 'fee'
                  ? <Chip label={s?.status === 'paid' ? 'Paid' : 'Mark as paid'} selected={s?.status === 'paid'} onPress={() => onMark(i.id, { status: s?.status === 'paid' ? 'clear' : 'paid' })} />
                  : <Chip label={s ? 'Undo' : 'Mark done'} selected={Boolean(s)} onPress={() => onMark(i.id, { status: s ? 'clear' : 'booked' })} />}
              </Row>
            );
          })}
          <Text style={type.label}>Their household</Text>
          <Row>
            <NumberBox value={String(p.heads)} onChange={(v) => onChange({ heads: Math.max(1, Number(v) || 1) })} width={72} />
            <TextInput
              value={p.brings ?? ''}
              onChangeText={(v) => onChange({ brings: v })}
              placeholder="Who else is coming"
              placeholderTextColor={colors.inkFaint}
              style={[styles.input, { flex: 1 }]}
            />
          </Row>
          <Text style={type.label}>A note, just for you</Text>
          <TextInput value={note} onChangeText={setNote} onBlur={() => note !== (p.note ?? '') && onChange({ note })} placeholder="They never see this" placeholderTextColor={colors.inkFaint} style={styles.input} />
          {p.reminders.length ? <Text style={type.small}>Chased {p.reminders.length} time{p.reminders.length === 1 ? '' : 's'} — last {when(p.lastRemindedAt)}</Text> : null}
          <Wrap>
            {p.contact
              ? <Chip
                  label={p.contact}
                  icon={p.contactKind === 'email' ? 'info' : 'phone'}
                  onPress={() => { if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(`${p.contactKind === 'email' ? 'mailto:' : 'tel:'}${p.contact}`); }}
                />
              : <Chip label="No way to reach them" icon="allergen" />}
            <Chip label="Remind now" icon="forward" onPress={onRemind} />
            <Chip label="They're out" icon="close" onPress={() => onChange({ withdrawn: true })} />
          </Wrap>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Headers inside a step, in the words a person would say them, not shouted
  // in capitals (owner, 7 Sep 2026).
  section: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  fieldLabel: { fontFamily: fonts.body, fontSize: 13, fontWeight: '600', color: colors.inkMuted, marginBottom: 4 },
  pagePreview: { width: 76, height: 92, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.mint, borderWidth: 1, borderColor: colors.line },
  pagePreviewImg: { width: '100%', height: '100%' },
  pagePreviewBlank: { flex: 1, backgroundColor: colors.surface, margin: 8, padding: 6, gap: 5, justifyContent: 'flex-end' },
  pagePreviewBar: { height: 5, borderRadius: 2, backgroundColor: colors.line },
  columns: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  blockNumber: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  blockNumberText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '800', color: colors.inkMuted },
  numberBox: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm,
    minHeight: TARGET - 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  numberBoxOn: { borderColor: colors.accent, borderWidth: 2 },
  numberInput: { flex: 1, textAlign: 'center', fontFamily: fonts.body, fontSize: 17, fontWeight: '700', color: colors.ink, minWidth: 40, outlineStyle: 'none' as any },
  wantedRow: { gap: 6, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line },
  hero: {
    // The one mint field in light; in dark the header ground is the page ground,
    // so a rule gives the panel its edge back.
    backgroundColor: colors.headerBg, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.line,
  },
  scene: { width: 280, height: 175, alignSelf: 'center' },
  eyebrow: { fontFamily: fonts.body, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: colors.headerSub },
  hugeText: { fontFamily: fonts.heading, fontSize: 34, lineHeight: 36, fontWeight: '800', letterSpacing: -1, color: colors.ink },
  heroSub: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.headerSub, maxWidth: 520 },
  sellGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  sell: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  sellHalf: { width: '48%', flexGrow: 1 },
  sellThird: { width: '31%', flexGrow: 1, minWidth: 220 },
  sellNumber: { fontFamily: fonts.heading, fontSize: 17, fontWeight: '800', color: colors.ink },
  sellIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  sellTitle: { fontFamily: fonts.heading, fontSize: 16, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  dateCard: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  timeline: { flexDirection: 'row', gap: spacing.sm },
  timelineDot: { height: 12, justifyContent: 'center' },
  timelineDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  previewBox: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  tagText: { fontFamily: fonts.body, fontSize: 12, fontWeight: '600', color: colors.headerSub },
  mustAsk: { flexDirection: 'row', borderRadius: radius.md, backgroundColor: colors.surfaceMuted, padding: 2, gap: 2 },
  mustAskHalf: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm },
  mustAskOn: { backgroundColor: colors.primary },
  mustAskText: { fontFamily: fonts.body, fontSize: 13, fontWeight: '700', color: colors.inkMuted },
  mustAskTextOn: { color: colors.primaryFg },
  itemIcon: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  panel: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  panelStrong: { fontWeight: '700', color: colors.ink },
  progress: { flexDirection: 'row', gap: 3 },
  progressBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.line },
  colLeft: { flex: 1, minWidth: 0 },
  colRight: { width: 380 },
  input: {
    minHeight: TARGET, paddingHorizontal: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, fontSize: 15, color: colors.ink, fontFamily: fonts.body,
    // The focus ring is the leaf, not the browser's blue (style guide).
    outlineColor: colors.accent as any, outlineWidth: 2 as any, outlineOffset: 1 as any,
  },
  person: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm, marginTop: spacing.sm },
  warnBox: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.overrun, backgroundColor: colors.overrunSoft },
});
