/**
 * Household memberships as Stripe bills them (register L8, Phase 4, 3 Oct 2026).
 *
 * One row per Stripe subscription. Only Stripe's own events write here
 * (sources/membership.js): the return page from Checkout never makes anybody a
 * member. The reports read it through `billedMemberships()` in
 * repositories/memberships.js, and nothing else decides who is a member.
 */

import { query } from '../db.js';

/** The household's Stripe customer, or null. */
export async function customerOf(householdId) {
  const { rows: [r] } = await query('select stripe_customer_id from households where id = $1', [householdId]);
  return r?.stripe_customer_id ?? null;
}

/** Keep the first customer made: two presses at once both make one at Stripe (same idempotency key, same id). */
export async function setCustomer(householdId, customerId) {
  const { rows: [r] } = await query(
    // A customer already another household's is never taken over: that would fail every later event for it.
    `update households set stripe_customer_id = coalesce(stripe_customer_id, $2)
      where id = $1 and not exists (select 1 from households o where o.stripe_customer_id = $2 and o.id <> $1)
     returning stripe_customer_id`,
    [householdId, customerId],
  );
  return r?.stripe_customer_id ?? customerOf(householdId);
}

export async function householdByCustomer(customerId) {
  const { rows: [r] } = await query('select id from households where stripe_customer_id = $1', [customerId]);
  return r?.id ?? null;
}

/** The household's membership that is still running — trialling, active or paused — or null. */
export async function runningMembership(householdId) {
  const { rows: [r] } = await query(
    `select * from memberships where household_id = $1 and status <> 'cancelled' order by started_at desc limit 1`,
    [householdId],
  );
  return r ?? null;
}

/** The household's newest membership, running or not: what Settings shows. */
export async function latestMembership(householdId) {
  const { rows: [r] } = await query('select * from memberships where household_id = $1 order by (status <> \'cancelled\') desc, started_at desc limit 1', [householdId]);
  return r ?? null;
}

export async function membershipBySubscription(subscriptionId) {
  const { rows: [r] } = await query('select * from memberships where stripe_subscription_id = $1', [subscriptionId]);
  return r ?? null;
}

/**
 * Write what Stripe says a subscription is now. Called with a subscription read
 * back from Stripe, never an event's snapshot, so the order events arrive in
 * does not matter. A pause is dated the first time it is seen and cleared when
 * Stripe says it is paid again; a cancelled membership keeps its end.
 */
export async function upsertFromSubscription({ householdId, subscriptionId, facts, mode = 'test', pauseReason = null }) {
  if (!facts.status) return null;
  const { rows: [r] } = await query(
    `insert into memberships (household_id, plan_key, status, stripe_subscription_id, stripe_price_id, monthly_pence, interval,
                              trial_end, current_period_end, cancel_at_period_end, started_at, ended_at, paused_at, pause_reason, mode)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, now()), $12,
             case when $3 = 'paused' then now() end, case when $3 = 'paused' then $13 end, $14)
     on conflict (stripe_subscription_id) do update set
       plan_key = excluded.plan_key,
       status = excluded.status,
       stripe_price_id = excluded.stripe_price_id,
       monthly_pence = excluded.monthly_pence,
       interval = excluded.interval,
       trial_end = excluded.trial_end,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       ended_at = case when excluded.status = 'cancelled' then coalesce(memberships.ended_at, excluded.ended_at, now()) else null end,
       paused_at = case when excluded.status = 'paused' then coalesce(memberships.paused_at, now()) else null end,
       pause_reason = case when excluded.status = 'paused' then coalesce($13, memberships.pause_reason) else null end,
       updated_at = now()
     returning *`,
    [householdId, facts.planKey ?? 'unknown', facts.status, subscriptionId, facts.priceId, facts.monthlyPence ?? 0, facts.interval ?? 'month',
      facts.trialEnd, facts.currentPeriodEnd, facts.cancelAtPeriodEnd ?? false, facts.startedAt, facts.endedAt, pauseReason, mode],
  );
  return r;
}

/** A plan's current website price, with the Stripe Price already made for it in this mode, if any. */
export async function webPrice(planKey, mode = 'test') {
  const { rows: [r] } = await query(
    `select pp.id, pp.plan_key, pp.amount_pence, pl.label, spp.stripe_price_id
       from plan_prices pp
       join plans pl on pl.key = pp.plan_key
       left join stripe_plan_prices spp on spp.plan_price_id = pp.id and spp.mode = $2
      where pp.plan_key = $1 and pp.channel = 'web' and pp.effective_to is null
      order by pp.effective_from desc limit 1`,
    [planKey, mode],
  );
  return r ?? null;
}

export async function rememberPrice({ planPriceId, mode = 'test', productId, priceId }) {
  await query(
    `insert into stripe_plan_prices (plan_price_id, mode, stripe_product_id, stripe_price_id) values ($1, $2, $3, $4)
     on conflict (plan_price_id, mode) do nothing`,
    [planPriceId, mode, productId, priceId],
  );
}

/**
 * Memberships whose reminder is due: a trial ending within `days`, or an annual
 * renewal within `days`, not already reminded for that date. Claimed here — the
 * date written and a fresh cancel token (two random UUIDs, 244 bits) made in one statement — so two runs
 * never send it twice; a send that fails gives the claim back (`unclaimReminder`).
 */
export async function claimRemindersDue({ days = 7, limit = 50 } = {}) {
  const { rows } = await query(
    `with due as (
       select id, case when status = 'trialling' then trial_end else current_period_end end as on_date
         from memberships
        where not cancel_at_period_end
          and ((status = 'trialling' and trial_end > now() and trial_end <= now() + make_interval(days => $1))
            or (status = 'active' and interval = 'year' and current_period_end > now() and current_period_end <= now() + make_interval(days => $1)))
        order by 2 limit $2
     )
     update memberships m set reminded_for = due.on_date, cancel_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), updated_at = now()
       from due
      where m.id = due.id and m.reminded_for is distinct from due.on_date
     returning m.*, due.on_date`,
    [days, limit],
  );
  return rows;
}

export async function unclaimReminder(id, onDate) {
  await query('update memberships set reminded_for = null, cancel_token = null where id = $1 and reminded_for = $2', [id, onDate]);
}

/** Claim the reminder for one membership (Stripe's own three-day warning, the backstop), if it has not gone for that date. */
export async function claimReminderFor(id) {
  const { rows: [r] } = await query(
    `update memberships set reminded_for = case when status = 'trialling' then trial_end else current_period_end end,
            cancel_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), updated_at = now()
      where id = $1 and status in ('trialling', 'active') and not cancel_at_period_end
        and reminded_for is distinct from (case when status = 'trialling' then trial_end else current_period_end end)
     returning *, reminded_for as on_date`,
    [id],
  );
  return r ?? null;
}

export async function membershipByCancelToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const { rows: [r] } = await query(
    `select m.*, h.stripe_customer_id from memberships m join households h on h.id = m.household_id
      where m.cancel_token = $1 and m.status <> 'cancelled'`,
    [token],
  );
  return r ?? null;
}

/** Who a household's membership mail goes to: its own lead account first, then its earliest, never one suspended or not yet signed in. */
export async function leadOf(householdId) {
  const { rows: [r] } = await query(
    `select a.email, a.name, h.name as household_name from households h
       left join lateral (select email, name from accounts where household_id = h.id and status not in ('suspended', 'invited') order by (member_id is null) desc, created_at limit 1) a on true
      where h.id = $1`,
    [householdId],
  );
  return r ?? null;
}

/** Every membership, for the reports (repositories/memberships.js › billedMemberships). */
export async function allMemberships() {
  const { rows } = await query('select * from memberships order by started_at');
  return rows;
}
