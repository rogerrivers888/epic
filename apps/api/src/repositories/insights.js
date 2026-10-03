/**
 * The business side of the back office: what Epic earns, what it costs to run,
 * and what that leaves.
 *
 * Two honesty rules, both taken from the Parcelvision reporting suite the owner
 * asked this to mirror:
 *
 *  - **A gap is labelled, never drawn as a zero.** PV's revenue screen says in
 *    as many words that subscription revenue is absent because Stripe is not
 *    connected, rather than showing £0 and letting somebody read it as "nobody
 *    is paying". Revenue here is **paid memberships only** (Roger, 3 Oct 2026:
 *    "Count memberships, not accounts"), read from `memberships.js`; no
 *    membership is billed yet, so it is nought and the screens say "Not billed
 *    yet". Cash collected is not knowable from this database.
 *  - **Cost is real.** `provider_calls` is Epic's own ledger of its own
 *    spending, written on every outbound call, so cost per household is measured
 *    rather than apportioned.
 */

import { query } from '../db.js';
import { classifyHouseholds, membershipMonths, readMemberships, summarise } from './memberships.js';

// ---------------------------------------------------------------------------
// what is earned
// ---------------------------------------------------------------------------

/**
 * Monthly recurring revenue, by plan, as it stands today.
 *
 * Members, not accounts (Roger, 3 Oct 2026): `households` is member households
 * on the plan (paid or trialling in Stripe), `mrr_pence` is what the paid ones
 * are billed, and `unpriced` is the complimentary households on it — the
 * Founding household and anybody given `owner` or `friend` by hand — because
 * "how many people use this for free" is a business number too. Nothing is
 * billed yet, so every plan's members and MRR are nought.
 */
export async function mrrByPlan() {
  const [{ rows }, classified] = await Promise.all([
    query('select key, label, price_pence from plans order by position, key'),
    classifyHouseholds(),
  ]);
  const { byPlan } = summarise(classified);
  return rows.map((p) => {
    const on = byPlan[p.key] ?? { paid: 0, trialling: 0, mrrPence: 0 };
    return {
      key: p.key,
      label: p.label,
      price_pence: p.price_pence,
      households: on.paid + on.trialling,
      paid: on.paid,
      trialling: on.trialling,
      mrr_pence: on.mrrPence,
      unpriced: classified.filter((h) => h.cls === 'complimentary' && h.planKey === p.key).length,
    };
  });
}

/**
 * Membership revenue month by month.
 *
 * What paid memberships were billed in each month, and how many members were
 * running — never what the plans accounts were on were priced at (Roger, 3 Oct
 * 2026). Nought while nothing is billed; the months still come back, so a chart
 * of nothing is a chart rather than an empty screen that looks broken.
 */
export async function revenueByMonth({ months = 12 } = {}) {
  const { rows } = await query(
    `select to_char(generate_series(date_trunc('month', now()) - (($1 - 1) || ' months')::interval,
                                    date_trunc('month', now()), '1 month'), 'YYYY-MM') as month`,
    [months],
  );
  const by = await membershipMonths(rows.map((r) => r.month));
  return by.map((m) => ({ month: m.month, households: m.members, revenue_pence: m.pence, paying: m.paid }));
}

// ---------------------------------------------------------------------------
// what it costs
// ---------------------------------------------------------------------------

/** Provider spend by month, across the estate — the cost line under the revenue one. */
export async function costByMonth({ months = 12 } = {}) {
  const { rows } = await query(
    `select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
            count(*)::int as calls,
            coalesce(sum(estimated_cost_usd), 0)::float as cost_usd
       from provider_calls
      where created_at >= date_trunc('month', now()) - (($1 - 1) || ' months')::interval
      group by 1 order by 1`,
    [months],
  );
  return rows;
}

/** Which providers the money goes to. */
export async function costByProvider({ days = 30 } = {}) {
  const { rows } = await query(
    `select provider,
            count(*)::int as calls,
            coalesce(sum(estimated_cost_usd), 0)::float as cost_usd,
            count(distinct household_id)::int as households
       from provider_calls
      where created_at >= now() - ($1 || ' days')::interval
      group by provider
      order by cost_usd desc, calls desc`,
    [String(days)],
  );
  return rows;
}

/** What each household costs to serve, which is the number that decides a price. */
export async function costByHousehold({ days = 30 } = {}) {
  const { rows } = await query(
    `select household_id,
            count(*)::int as calls,
            coalesce(sum(estimated_cost_usd), 0)::float as cost_usd
       from provider_calls
      where household_id is not null and created_at >= now() - ($1 || ' days')::interval
      group by household_id`,
    [String(days)],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// the estate at a glance
// ---------------------------------------------------------------------------

/**
 * The headline figures.
 *
 * Everything here is a count of something real. Where a figure would need a
 * payment provider to be true it is not invented: `revenue_pence` is contracted,
 * not collected, and the tile that shows it says which.
 */
export async function estateTotals() {
  const [{ rows }, m] = await Promise.all([query(
    `select
       (select count(*)::int from households)                                                 as households,
       -- Customers only: staff accounts have no household (migration 318), so
       -- they are excluded from every "accounts" figure the estate reports.
       (select count(*)::int from accounts where household_id is not null)                     as accounts,
       (select count(*)::int from accounts where household_id is not null and status = 'active')    as active_accounts,
       (select count(*)::int from accounts where household_id is not null and status = 'invited')   as invited,
       (select count(*)::int from accounts where household_id is not null and status = 'suspended') as suspended,
       (select count(*)::int from accounts where household_id is not null and created_at >= date_trunc('month', now())) as joined_this_month,
       (select count(*)::int from members)                                                    as people,
       (select count(*)::int from household_places)                                           as places,
       (select count(*)::int from trips)                                                      as trips,
       (select count(*)::int from visits)                                                     as visits,
       (select count(*)::int from ratings)                                                    as ratings,
       (select count(*)::int from api_sessions where revoked_at is null and expires_at > now()) as live_devices,
       (select coalesce(sum(estimated_cost_usd), 0)::float from provider_calls
         where created_at >= date_trunc('month', now()))                                      as cost_month_usd,
       (select coalesce(sum(estimated_cost_usd), 0)::float from provider_calls)               as cost_ever_usd,
       (select count(*)::int from provider_calls where created_at >= date_trunc('month', now())) as calls_month`,
  ), readMemberships()]);
  // Members, not accounts (Roger, 3 Oct 2026): the membership counts beside the
  // account ones, from the classification every report shares.
  return {
    ...rows[0],
    members: m.members,
    trialling: m.trialling,
    complimentary: m.complimentary,
    invited_households: m.invited,
    people_covered: m.peopleCovered,
    // Counts only: MRR is money and travels in the financials block, never in
    // the totals every back-office reader gets.
    billed: m.billed,
  };
}

/**
 * How far into the month the estate is against its own ceilings — the number
 * that matters when every household draws on one set of free allowances.
 */
export async function ceilingPressure() {
  const { rows } = await query(
    `select a.id as account_id, a.email, a.monthly_call_bound,
            (select count(*)::int from provider_calls c
              where c.household_id = a.household_id and c.created_at >= date_trunc('month', now())) as calls
       from accounts a
      where a.household_id is not null`,
  );
  return rows;
}
