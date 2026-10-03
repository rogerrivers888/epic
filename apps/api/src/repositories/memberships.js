/**
 * Who is a member — the one place every report asks.
 *
 * "Count memberships, not accounts" (Roger, 3 Oct 2026). A member is a
 * household with a paid or trialling membership **in Stripe**, and nothing else
 * makes one: an account on a priced plan is a label an administrator chose, not
 * a membership somebody bought. Every member, subscriber, MRR and average-price
 * figure in the back office reads from here, so the rule lives once.
 *
 * Each household that is not a guest is exactly one of:
 *
 *  · `member_paid`      — a paid membership in Stripe. The only kind that feeds
 *                         MRR and the average price.
 *  · `member_trialling` — a trialling membership in Stripe. A member, shown as
 *                         "trialling", and out of MRR until it converts.
 *  · `complimentary`    — the Founding household, or a household whose lead
 *                         account is on a hand-given free plan (`owner`,
 *                         `friend`). Shown at £0 and never in MRR. `trial` and
 *                         `standard` are not hand-given and are not on the list.
 *  · `invited`          — the lead account was invited and has never signed in,
 *                         and the household is not complimentary.
 *  · `none`             — everything else: not a member.
 *
 * Guest-invite households (`households.origin = 'guest_invite'`) are never
 * members or customers, so they are not classified at all.
 *
 * **No membership is billed yet.** The schema holds no Stripe record of a
 * household membership — no customer id, no subscription id, no membership
 * table; only hosting Pro is billed, and that is money code owned elsewhere. So
 * `billedMemberships()` answers an empty list, every household falls through
 * to complimentary, invited or none, and members, trialling, MRR and the
 * average price are all nought today. `MEMBERSHIP_BILLING` says so in every
 * payload (`billed: false`) so a screen can say "Not billed yet" rather than
 * draw a £0 that reads as "nobody pays".
 */

import { query } from '../db.js';

/** False until household memberships are billed through Stripe. */
export const MEMBERSHIP_BILLING = false;

/** Plans an administrator gives away by hand. Not `trial`, not `standard`. */
export const COMPLIMENTARY_PLANS = ['owner', 'friend'];

/** The five classes, in the order a screen lists them. */
export const CLASSES = ['member_paid', 'member_trialling', 'complimentary', 'invited', 'none'];

/** What each class is called on a screen. */
export const CLASS_WORDS = {
  member_paid: 'Member',
  member_trialling: 'Trialling',
  complimentary: 'Complimentary',
  invited: 'Invited',
  none: 'Not a member',
};

/** The note a screen prints where MRR or an average would be. */
export const NOT_BILLED = 'Not billed yet';

/**
 * The memberships Stripe knows about — **the one place to plug Stripe in**.
 *
 * Returns one entry per household with a live membership:
 *   `{ householdId, state: 'paid' | 'trialling', planKey, monthlyPence, startedAt, endedAt }`
 * where `monthlyPence` is what the membership is billed a month (an annual
 * membership divided by twelve) and `endedAt` is null while it runs.
 *
 * Empty today, on purpose: there is no Stripe record of a household membership
 * anywhere in the schema yet, and inventing one from `accounts.plan` is exactly
 * the account counting this module exists to stop.
 */
// When Stripe plugs in here, two things follow (Codex, 3 Oct 2026): lifetime spend must be summed over each
// membership's billing periods (startedAt → endedAt), not today's price × the account's age; and a closed period's
// stock must classify the memberships running at that period's end, so classification will need an as-of date.
export async function billedMemberships() {
  // Stripe goes here: read the household memberships it holds and answer them in
  // the shape above, then set MEMBERSHIP_BILLING to true. Nothing else in the
  // reports has to change.
  return [];
}

/**
 * Every non-guest household, classified.
 *
 * The lead account is the household's own (`member_id is null`); where a
 * household has more than one, the earliest that is not suspended speaks for
 * it. People are the household's member profiles, or its accounts where there
 * are more of those (an invited account is a person before they have a
 * profile) — never both added together, which would count the lead twice.
 */
export async function classifyHouseholds({ householdId = null } = {}) {
  const [{ rows }, billed] = await Promise.all([
    query(
      `select h.id, h.origin, h.created_at,
              lead.id as account_id, lead.plan, lead.status as lead_status,
              greatest(
                (select count(*) from members m where m.household_id = h.id),
                (select count(*) from accounts a where a.household_id = h.id and a.status <> 'suspended')
              )::int as people
         from households h
         left join lateral (
           select a.id, a.plan, a.status
             from accounts a
            where a.household_id = h.id and a.member_id is null
            order by (a.status = 'suspended'), a.created_at
            limit 1
         ) lead on true
        where h.origin <> 'guest_invite'
          and ($1::uuid is null or h.id = $1::uuid)
        order by h.created_at`,
      [householdId],
    ),
    billedMemberships(),
  ]);
  const byHousehold = new Map(billed.filter((b) => !b.endedAt).map((b) => [b.householdId, b]));

  return rows.map((r) => {
    const bill = byHousehold.get(r.id) ?? null;
    let cls;
    if (bill?.state === 'paid') cls = 'member_paid';
    else if (bill?.state === 'trialling') cls = 'member_trialling';
    else if (r.origin === 'founding'
      || (COMPLIMENTARY_PLANS.includes(r.plan) && r.lead_status !== 'suspended')) cls = 'complimentary';
    else if (r.lead_status === 'invited') cls = 'invited';
    else cls = 'none';
    return {
      householdId: r.id,
      cls,
      word: CLASS_WORDS[cls],
      planKey: bill?.planKey ?? r.plan ?? null,
      // Only a paid membership is worth anything a month; complimentary is £0.
      monthlyPence: cls === 'member_paid' ? Number(bill.monthlyPence) || 0 : 0,
      people: Number(r.people) || 0,
      leadStatus: r.lead_status ?? null,
      suspended: r.lead_status === 'suspended',
      startedAt: bill?.startedAt ?? null,
    };
  });
}

/** One household's class, or null for a guest or a household that is not there. */
export async function classifyHousehold(householdId) {
  const [row] = await classifyHouseholds({ householdId });
  return row ?? null;
}

/**
 * The counts every report shows, from one classification.
 *
 * `averagePence` is null — never nought — when there is no paid member, because
 * an average of nobody is not a price.
 */
export function summarise(classified) {
  const n = (cls) => classified.filter((h) => h.cls === cls).length;
  const paid = classified.filter((h) => h.cls === 'member_paid');
  const members = classified.filter((h) => h.cls === 'member_paid' || h.cls === 'member_trialling');
  const mrrPence = paid.reduce((s, h) => s + h.monthlyPence, 0);
  const byPlan = {};
  for (const h of members) {
    const k = h.planKey ?? 'unknown';
    byPlan[k] ??= { paid: 0, trialling: 0, mrrPence: 0 };
    if (h.cls === 'member_paid') { byPlan[k].paid += 1; byPlan[k].mrrPence += h.monthlyPence; } else byPlan[k].trialling += 1;
  }
  return {
    billed: MEMBERSHIP_BILLING,
    billedNote: MEMBERSHIP_BILLING ? null : NOT_BILLED,
    members: members.length,
    paid: paid.length,
    trialling: n('member_trialling'),
    complimentary: n('complimentary'),
    invited: n('invited'),
    notMembers: n('none'),
    households: classified.length,
    peopleCovered: members.reduce((s, h) => s + h.people, 0),
    mrrPence,
    averagePence: paid.length ? Math.round(mrrPence / paid.length) : null,
    byPlan,
  };
}

/** The counts, read. */
export async function readMemberships() {
  return summarise(await classifyHouseholds());
}

/**
 * Membership revenue over a window, in pence: each paid membership's monthly
 * price for every month of the window it was running.
 *
 * Nought today, because nothing is billed — and `estimated` false, because a
 * nought that comes from "no membership exists" is a measurement, not a guess.
 */
export async function membershipRevenue(from, to) {
  const months = monthStarts(from, to);
  const billed = (await billedMemberships()).filter((b) => b.state === 'paid');
  let pence = 0;
  for (const m of months) {
    for (const b of billed) if (runsIn(b, m)) pence += Number(b.monthlyPence) || 0;
  }
  return { pence, estimated: false };
}

/**
 * Memberships a month at a time, keyed `YYYY-MM`: how many were running, how
 * many of those were paid, and what the paid ones were billed (pence).
 */
export async function membershipMonths(keys) {
  const billed = await billedMemberships();
  return keys.map((key) => {
    const m = new Date(`${key}-01T00:00:00Z`);
    const running = billed.filter((b) => runsIn(b, m));
    const paid = running.filter((b) => b.state === 'paid');
    return {
      month: key,
      members: running.length,
      paid: paid.length,
      pence: paid.reduce((s, b) => s + (Number(b.monthlyPence) || 0), 0),
    };
  });
}

/** Membership revenue a month at a time, keyed `YYYY-MM`, for a twelve-month chart. */
export async function membershipRevenueByMonth(keys) {
  return (await membershipMonths(keys)).map((m) => m.pence);
}

/**
 * Memberships that started and ended in a window — the book's new and lost.
 *
 * Both nought today. `lost` counts a membership that ended, never an account
 * that was suspended: suspending a login is not a cancellation.
 */
export async function membershipMoves(from, to) {
  const billed = await billedMemberships();
  const inside = (at) => at && new Date(at) >= new Date(from) && new Date(at) < new Date(to);
  return {
    added: billed.filter((b) => inside(b.startedAt)).length,
    lost: billed.filter((b) => inside(b.endedAt)).length,
  };
}

/** New memberships a month at a time, keyed `YYYY-MM`. */
export async function membershipStartsByMonth(keys) {
  const billed = await billedMemberships();
  return keys.map((key) => billed.filter((b) => b.startedAt && String(new Date(b.startedAt).toISOString()).slice(0, 7) === key).length);
}

function monthStarts(from, to) {
  const out = [];
  const end = new Date(to);
  const d = new Date(from);
  let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  while (m < end) {
    out.push(m);
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  }
  return out;
}

function runsIn(b, monthStart) {
  const next = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const started = b.startedAt ? new Date(b.startedAt) < next : true;
  const running = !b.endedAt || new Date(b.endedAt) >= monthStart;
  return started && running;
}
