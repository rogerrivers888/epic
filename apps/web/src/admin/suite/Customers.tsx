/**
 * Customers — who they are, and one household's whole record.
 *
 * A search box, two sets of chips, and a table where every header sorts. The
 * filters are in the address and *replace* rather than push, so the back button
 * walks the pages somebody visited rather than every chip they tried; opening a
 * household pushes, because that is a move.
 *
 * At risk is the one alarm-red thing on the screen, and the handoff allows at
 * most one per screen. It is derived from the state of the row — paying, and
 * nothing opened in thirty days — rather than instrumented, which is the ninth
 * rule: instrument entry, derive exit.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Press } from '../../components/press';
import { asOneOf, asText, useQueryState, useStickyQuery } from '../../router';
import { colors, spacing, type } from '../../theme';
import {
  Bars, Cell, Chip, ChipGroup, FilterBar, HeadStats, NO_OUTLINE, SearchBox, Standing, SuiteHead,
  SuitePage, SuitePanel, SuiteTable, TwoLine, Trouble, Waiting, type Col,
} from './pieces';
import { api, ApiError } from '../../api';
import { SuiteControls, suiteKicker, useCustomers, useFormatters, useHouseholdRecord, useSuiteControls } from './useSuite';
import { HouseholdRecordView } from './HouseholdRecord';
import { joinedDay, lastSeen, share, sortRows, statusWord, type HouseholdRow } from './model';

const PLANS = ['All', 'Household', 'Solo', 'Annual', 'Trial', 'Standard'] as const;
const STATUSES = ['All', 'Live', 'Trial', 'At risk', 'Cancelled'] as const;
type Plan = typeof PLANS[number];
type Status = typeof STATUSES[number];
const SORTS = ['name', 'plan', 'monthPence', 'joined', 'lastSeenDays', 'places', 'daysOut', 'bookings', 'ratings', 'status'] as const;
type SortKey = typeof SORTS[number];

export function Customers({ canSeeMoney, canManage }: { canSeeMoney: boolean; canManage: boolean }) {
  const { period, setPeriod, source, setSource } = useSuiteControls();
  useStickyQuery('admin.suite.customers', ['q', 'plan', 'status', 'sort', 'dir', 'guests']);
  const [q, setQ] = useQueryState<string>('q', '', asText);
  const [plan, setPlan] = useQueryState<Plan>('plan', 'All', asOneOf(PLANS, 'All'));
  const [status, setStatus] = useQueryState<Status>('status', 'All', asOneOf(STATUSES, 'All'));
  const [sort, setSort] = useQueryState<SortKey>('sort', 'places', asOneOf(SORTS, 'places'));
  const [dir, setDir] = useQueryState<'up' | 'down'>('dir', 'down', asOneOf(['up', 'down'] as const, 'down'));
  const [householdId, setHouseholdId] = useQueryState<string>('household', '', asText);
  /**
   * Whether guests are in the list.
   *
   * Rule 4: "Guest-invite households are ~15% of the estate and ~4% of revenue;
   * **the default view excludes them**." A guest invited to somebody else's trip
   * is a household of its own and a success, and counting them beside a trial
   * signup makes activation read as broken while the business works. The chip
   * is there because they are real and somebody will want to see them.
   */
  const [guests, setGuests] = useQueryState<boolean>('guests', false, {
    read: (r) => r === '1', write: (v) => (v ? '1' : null),
  });

  // The list alone, through the accounts-gated read — not the whole estate
  // model, which needs `view_reporting` (Codex, 20 Sep 2026).
  const { customers, gaps, error, reading, reload } = useCustomers(period, source);
  const [trialBusy, setTrialBusy] = useState<'grant' | 'extend' | null>(null);
  const [inviting, setInviting] = useState(false);
  /**
   * The link, where Epic could not send it itself.
   *
   * "I don't want to claim a name. I want to send an invite" (4 Sep 2026) — and
   * where no mail sender is configured the honest answer is the link itself, to
   * be sent by hand, rather than a screen that says "invited" and did nothing.
   */
  const [invitation, setInvitation] = useState<{ url: string; email: string | null; delivery?: string } | null>(null);
  const [plans, setPlans] = useState<{ key: string; label: string }[]>([]);

  useEffect(() => {
    if (!canManage) return;
    (async () => {
      try { setPlans((await api.adminPlans()).plans.filter((p) => p.active).map((p) => ({ key: p.key, label: p.label }))); }
      catch { /* the form falls back to the default plan */ }
    })();
  }, [canManage]);
  const [trouble, setTrouble] = useState<string | null>(null);
  const fmt = useFormatters(null, null);
  const { record, error: recordError, reload: reloadRecord } = useHouseholdRecord(householdId || null, period, source);

  /**
   * Grant or extend a thirty-day trial.
   *
   * `PATCH /api/accounts/:id` already puts an account on a plan and sets its
   * trial end date, and already writes an `account_plan_history` row for the
   * change — which is what makes the household record's lifetime subscription
   * figure agree with its plan history afterwards.
   */
  const trial = useCallback(async (what: 'grant' | 'extend') => {
    if (!record?.accountId) return;
    setTrialBusy(what);
    try {
      const ends = new Date();
      ends.setDate(ends.getDate() + 30);
      await api.updateAccount(record.accountId, {
        ...(what === 'grant' ? { plan: 'trial', status: 'active' } : {}),
        trialEndsOn: ends.toISOString().slice(0, 10),
      });
      await reloadRecord();
      await reload();
    } catch (e: unknown) {
      // Said where the action was taken, in plain words.
      setTrouble(e instanceof ApiError ? e.message : 'Could not reach Epic.');
    } finally {
      setTrialBusy(null);
    }
  }, [record?.accountId, reloadRecord, reload]);

  const controls = <SuiteControls period={period} setPeriod={setPeriod} source={source} setSource={setSource} />;

  if (error) {
    return <SuitePage><SuiteHead title="Customers" right={controls} /><Trouble says={error} onRetry={reload} /></SuitePage>;
  }
  if (!customers) {
    return <SuitePage><SuiteHead title="Customers" right={controls} /><Waiting says={reading ? 'Reading the households…' : undefined} /></SuitePage>;
  }

  // The record is a layer inside this screen — its own address, its own crumb.
  if (householdId) {
    return (
      <HouseholdRecordView
        record={record}
        error={recordError}
        gaps={gaps}
        onBack={() => setHouseholdId('')}
        onTrial={canManage ? trial : undefined}
        trialBusy={trialBusy}
        controls={controls}
        kicker={suiteKicker(source, period)}
      />
    );
  }

  const everyone = customers.households;
  const all = guests ? everyone : everyone.filter((h) => h.origin !== 'guest_invite');
  const guestCount = everyone.length - everyone.filter((h) => h.origin !== 'guest_invite').length;
  const needle = q.trim().toLowerCase();
  let rows = all.filter((h) => (needle
    ? `${h.name} ${h.area ?? ''}`.toLowerCase().includes(needle)
    : true));
  if (plan !== 'All') rows = rows.filter((h) => h.plan === plan);
  if (status !== 'All') rows = rows.filter((h) => statusWord(h).startsWith(status));
  rows = sortRows(rows, sort, dir === 'down' ? -1 : 1);

  const onSort = (key: string) => {
    if (key === sort) { setDir(dir === 'down' ? 'up' : 'down', { replace: true }); return; }
    setSort(key as SortKey, { replace: true });
    setDir('down', { replace: true });
  };

  // A cancelled household is still a row you can read, at `#cfcac7` — the
  // handoff's own value, which is `mutedOnInk` here. It used to be only the
  // status cell that dimmed, so the row read as live with one grey word in it.
  const gone = (h: HouseholdRow) => h.status === 'cancelled';

  const columns: Col<HouseholdRow>[] = [
    {
      key: 'name', label: 'Household', grow: true, align: 'left', sort: 'name',
      cell: (h) => (
        <TwoLine
          top={h.name}
          bottom={[h.area, h.people ? `${h.people} ${h.people === 1 ? 'person' : 'people'}` : null].filter(Boolean).join(' · ') || null}
          muted={gone(h)}
        />
      ),
    },
    { key: 'plan', label: 'Plan', width: 92, align: 'left', sort: 'plan', cell: (h) => <Cell muted left>{h.plan}</Cell> },
    {
      key: 'mo', label: '£ / mo', width: 66, sort: 'monthPence',
      cell: (h) => (canSeeMoney
        ? <Cell strong={!gone(h)} muted={gone(h)}>{h.monthPence ? fmt.revenue.money(h.monthPence, { pence: true }) : '—'}</Cell>
        // Withheld, and it says so in words rather than printing the name of
        // the capability at somebody (rule 7).
        : <Cell muted gap="Withheld">{null}</Cell>),
    },
    { key: 'joined', label: 'Joined', width: 86, sort: 'joined', cell: (h) => <Cell muted>{joinedDay(h.joined)}</Cell> },
    { key: 'seen', label: 'Last seen', width: 86, sort: 'lastSeenDays', cell: (h) => <Cell muted>{lastSeen(h.lastSeenDays)}</Cell> },
    { key: 'places', label: 'Places', width: 64, sort: 'places', cell: (h) => <Cell muted={gone(h)}>{String(h.places)}</Cell> },
    { key: 'out', label: 'Days out', width: 74, sort: 'daysOut', cell: (h) => <Cell muted={gone(h)}>{String(h.daysOut)}</Cell> },
    { key: 'bookings', label: 'Bookings', width: 78, sort: 'bookings', cell: (h) => <Cell muted={gone(h)}>{String(h.bookings)}</Cell> },
    { key: 'ratings', label: 'Ratings', width: 68, sort: 'ratings', cell: (h) => <Cell muted={gone(h)}>{String(h.ratings)}</Cell> },
    {
      // The last figure column is right-aligned and this one is left-aligned,
      // so without a gap of its own "9" and "Live" read as one string. The
      // table's 10px row gap is not enough where two alignments meet.
      key: 'status', label: 'Status', width: 140, align: 'left', sort: 'status', pad: 14,
      cell: (h) => <Cell left alarm={h.status === 'at_risk'} muted={h.status === 'cancelled'}>{statusWord(h)}</Cell>,
    },
  ];

  return (
    <SuitePage>
      <SuiteHead title="Customers" kicker={suiteKicker(source, period)} right={controls} />

      {/* The summary the Households screen used to carry at the top of it
          (owner, 20 Sep 2026). Households is retired; these are the facts
          about the estate that only it was saying. */}
      {customers.estate ? (
        <HeadStats
          items={[
            { label: 'Households', value: fmt.plain.count(customers.estate.households), sub: `${fmt.plain.count(customers.estate.people)} people` },
            { label: 'Invited, not in', value: fmt.plain.count(customers.estate.invited), sub: 'a link was sent' },
            { label: 'Suspended', value: fmt.plain.count(customers.estate.suspended), sub: 'signed out, data kept' },
            { label: 'Signed in now', value: fmt.plain.count(customers.estate.signedIn), sub: 'on at least one device' },
          ]}
        />
      ) : null}

      {/* Inviting somebody is the one thing Accounts did that Customers did not
          (owner, 20 Sep 2026: "we should have invite, we should add that to the
          customer screen"). An e-mail address and a plan; the link goes out if
          a sender is configured, and if it is not the screen hands back the
          link to send by hand rather than pretending it was delivered. */}
      {canManage ? (
        <Invite
          plans={plans}
          busy={!!inviting}
          onInvite={async (body) => {
            setInviting(true);
            setTrouble(null);
            try {
              const r = await api.addAccount({ ...body, invite: true });
              setInvitation(r.invitation ? { ...r.invitation, email: r.account.email } : null);
              await reload();
              return true;
            } catch (e: unknown) {
              setTrouble(e instanceof ApiError ? e.message : 'Could not reach Epic.');
              return false;
            } finally {
              setInviting(false);
            }
          }}
          invitation={invitation}
          onDone={() => setInvitation(null)}
        />
      ) : null}

      {trouble ? <Text style={[type.small, { color: colors.overrun }]}>{trouble}</Text> : null}

      <FilterBar right={(
        <Text style={type.small}>
          {`${rows.length} of ${all.length} shown · ${customers.total.toLocaleString()} households`}
        </Text>
      )}>
        <SearchBox value={q} onChange={(v) => setQ(v, { replace: true })} placeholder="Search a name or an area" />
        <ChipGroup label="Plan">
          {PLANS.map((p) => <Chip key={p} label={p} on={plan === p} onPress={() => setPlan(p, { replace: true })} />)}
        </ChipGroup>
        <ChipGroup label="Status">
          {STATUSES.map((s) => <Chip key={s} label={s} on={status === s} onPress={() => setStatus(s, { replace: true })} />)}
        </ChipGroup>
        {guestCount || guests ? (
          <ChipGroup label="Guests">
            <Chip
              label={guests ? `${guestCount} included` : `${guestCount} hidden`}
              on={guests}
              onPress={() => setGuests(!guests, { replace: true })}
            />
          </ChipGroup>
        ) : null}
      </FilterBar>

      <View style={{ gap: spacing.sm }}>
        <SuiteTable
          columns={columns}
          rows={rows}
          sort={sort}
          dir={dir === 'down' ? -1 : 1}
          onSort={onSort}
          onRow={(h) => setHouseholdId(h.id)}
          empty={needle || plan !== 'All' || status !== 'All'
            ? 'No household matches that.'
            : 'No households yet.'}
        />
      </View>

      {/* How the estate arrived. Rule 4 — "origin slices everything" — and the
          reason the list above hides guests by default: they are a sixth of the
          households and a twenty-fifth of the revenue, and counting them beside
          a trial signup makes activation read as broken. */}
      <SuitePanel title="How they arrived">
        <Bars
          rows={customers.origins ?? null}
          gap="Origin is not recorded"
          format={(v) => fmt.plain.count(typeof v === 'number' ? v : null)}
        />
      </SuitePanel>

      <Standing
        items={[
          {
            label: 'Paying',
            value: fmt.plain.count(customers.paying),
            sub: canSeeMoney ? `${fmt.revenue.money(customers.payingMrr)} a month` : undefined,
          },
          {
            label: 'On trial',
            value: fmt.plain.count(customers.trial),
            sub: customers.trialConvertPct == null
              ? undefined
              : `${customers.trialConvertPct}% convert · ${customers.trialGranted} granted by hand`,
          },
          {
            label: 'At risk',
            value: fmt.plain.count(customers.atRisk),
            sub: 'paying, nothing opened in 30 days',
          },
        ]}
      />

      {/* Small-n honesty, said once where it applies: a share of a dozen
          households is a count, not a percentage. */}
      {customers.total < 30 ? (
        <Text style={type.tiny}>
          {`Shares on the other screens read as counts while the estate is this small — ${share(customers.paying, customers.total)} paying.`}
        </Text>
      ) : null}
    </SuitePage>
  );
}

/**
 * Invite somebody, from the screen that lists everybody.
 *
 * The owner, 20 Sep 2026, retiring the Accounts tab: "we should have invite, we
 * should add that to the customer screen."
 *
 * A closed row until it is opened, because the common case on this screen is
 * reading the list rather than adding to it, and a form permanently open above
 * a table is a form in the way. The fields are rules rather than boxes, which
 * is the back office's own grammar.
 */
function Invite({ plans, busy, onInvite, invitation, onDone }: {
  plans: { key: string; label: string }[];
  busy: boolean;
  onInvite: (body: { email: string; name?: string; plan?: string }) => Promise<boolean>;
  invitation: { url: string; email: string | null; delivery?: string } | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<string | null>(null);

  // The link Epic could not send itself. Shown until it is dismissed, because
  // it is the only copy: it is not stored anywhere a screen can read again.
  if (invitation) {
    return (
      <View style={inviteStyles.done}>
        <Text style={[type.small, { color: colors.ink, flexShrink: 1, minWidth: 0 }]}>
          {invitation.delivery === 'email'
            ? `Invitation sent to ${invitation.email ?? 'them'}.`
            : `Invitation made for ${invitation.email ?? 'them'} — Epic has no sender, so send this link: ${invitation.url}`}
        </Text>
        <Press effect="none" onPress={onDone} accessibilityRole="button">
          <Text style={inviteStyles.action}>Done</Text>
        </Press>
      </View>
    );
  }

  if (!open) {
    return (
      <View style={{ alignSelf: 'flex-start' }}>
        <Press effect="none" onPress={() => setOpen(true)} accessibilityRole="button" style={inviteStyles.opener}>
          <Text style={inviteStyles.action}>Invite someone</Text>
        </Press>
      </View>
    );
  }

  const send = async () => {
    if (!email.trim()) return;
    const ok = await onInvite({ email: email.trim(), name: name.trim() || undefined, plan: plan ?? undefined });
    if (ok) { setOpen(false); setEmail(''); setName(''); setPlan(null); }
  };

  return (
    <View style={inviteStyles.form}>
      <View style={inviteStyles.field}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          onSubmitEditing={send}
          placeholder="Their e-mail"
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          accessibilityLabel="Their e-mail"
          style={inviteStyles.input as any}
        />
      </View>
      <View style={inviteStyles.field}>
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={send}
          placeholder="Their name, if you know it"
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel="Their name"
          style={inviteStyles.input as any}
        />
      </View>
      {plans.length ? (
        <ChipGroup label="Plan">
          {plans.map((p) => <Chip key={p.key} label={p.label} on={plan === p.key} onPress={() => setPlan(plan === p.key ? null : p.key)} />)}
        </ChipGroup>
      ) : null}
      <Press effect="none" onPress={send} accessibilityRole="button" disabled={busy || !email.trim()}>
        <Text style={[inviteStyles.action, (busy || !email.trim()) && { color: colors.inkMuted, textDecorationLine: 'none' }]}>
          {busy ? 'Sending…' : 'Send the invitation'}
        </Text>
      </Press>
      <Press effect="none" onPress={() => setOpen(false)} accessibilityRole="button">
        <Text style={[type.small, { color: colors.inkMuted }]}>Cancel</Text>
      </Press>
    </View>
  );
}

const inviteStyles = StyleSheet.create({
  opener: { borderBottomWidth: 1.5, borderBottomColor: colors.accent, alignSelf: 'flex-start' },
  action: { ...type.small, fontSize: 12.5, color: colors.accent, fontWeight: '700' },
  form: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  // A rule underneath, never a box round (owner, 12 Sep 2026).
  field: { minWidth: 200, flexGrow: 1, flexBasis: 200, borderBottomWidth: 1, borderBottomColor: colors.ruleMuted, paddingBottom: 4 },
  input: {
    backgroundColor: 'transparent', borderWidth: 0,
    color: colors.ink, fontFamily: type.body.fontFamily, fontSize: 13,
    // `outlineStyle` is web-only and not in React Native's TextStyle; the kit
    // names the cast once so it is not repeated at every field (pieces.tsx).
    ...NO_OUTLINE,
  },
  done: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap',
    borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: spacing.md, paddingVertical: spacing.sm,
  },
});
