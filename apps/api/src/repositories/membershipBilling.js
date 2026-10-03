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
 * A stamp for when a Stripe read began, from the database's clock — the one every API instance shares — as
 * fixed-width text that compares in order, with a random tail so two reads in one microsecond still differ.
 */
export async function readStamp() {
  const { rows: [r] } = await query(`select lpad((extract(epoch from clock_timestamp()) * 1000000)::bigint::text, 17, '0') as us`);
  return `${r.us}-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
}

/** Raised when a household already has a running membership and Stripe has made it a second one. */
export class SecondMembership extends Error {
  constructor(running) { super('second membership'); this.code = 'second_membership'; this.running = running; }
}

/**
 * Write what Stripe says a subscription is now. Called with a subscription read
 * back from Stripe, never an event's snapshot, and stamped with when that read
 * began: a read that began before the one already stored is dropped, so
 * deliveries finishing out of order can't put an older state back (Codex,
 * 3 Oct 2026). A pause is dated the first time it is seen and cleared when
 * Stripe says it is paid again; a cancelled membership keeps its end; and when
 * it first became paid is kept for good, whatever it is now.
 */
export async function upsertFromSubscription({ householdId, subscriptionId, facts, mode = 'test', pauseReason = null, stamp = null, changedAt = null, pausedFrom = null }) {
  if (!facts.status) return null;
  // First paid: the trial's end, or the start when there was none — once Stripe says it is active, i.e. paid. A pause
  // keeps a date already set but never makes one: a first payment that fails is not revenue (Codex, 3 Oct 2026).
  const paidFrom = facts.status === 'active' ? (facts.trialEnd ?? facts.startedAt ?? new Date()) : null;
  let r;
  try {
    ({ rows: [r] } = await query(
      `insert into memberships (household_id, plan_key, status, stripe_subscription_id, stripe_price_id, monthly_pence, amount_pence, interval,
                                trial_end, current_period_end, cancel_at_period_end, started_at, ended_at, paused_at, pause_reason, mode,
                                paid_from, read_stamp)
       values ($1, $2, $3, $4, $5, $6, $17, $7, $8, $9, $10, coalesce($11, now()), case when $3 = 'cancelled' then coalesce($12::timestamptz, now()) end,
               case when $3 = 'paused' then coalesce($18::timestamptz, now()) end, case when $3 = 'paused' then $13 end, $14, $15, $16)
       on conflict (stripe_subscription_id) do update set
         plan_key = excluded.plan_key,
         status = excluded.status,
         stripe_price_id = excluded.stripe_price_id,
         price_history = case when memberships.monthly_pence is distinct from excluded.monthly_pence
                              then memberships.price_history || jsonb_build_array(jsonb_build_object('until',
                                   -- Never before the last change already recorded: a stale event's time is not this change's.
                                   coalesce(case when $19::timestamptz > coalesce((memberships.price_history->-1->>'until')::timestamptz, '-infinity'::timestamptz)
                                                 then $19::timestamptz end, now()),
                                   'monthlyPence', memberships.monthly_pence))
                              else memberships.price_history end,
         monthly_pence = excluded.monthly_pence,
         amount_pence = excluded.amount_pence,
         interval = excluded.interval,
         trial_end = excluded.trial_end,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         ended_at = case when excluded.status = 'cancelled' then coalesce(memberships.ended_at, excluded.ended_at, now()) else null end,
         -- Kept when it is cancelled while paused: its paid months end where its payments stopped (Codex, 3 Oct 2026).
         -- Dated by Stripe — the unpaid period's start — not by when the event got here (Codex, 3 Oct 2026).
         paused_at = case when excluded.status = 'paused' then coalesce(memberships.paused_at, excluded.paused_at, now())
                          when excluded.status = 'cancelled' then memberships.paused_at else null end,
         pause_reason = case when excluded.status = 'paused' then coalesce($13, memberships.pause_reason) else null end,
         paid_from = coalesce(memberships.paid_from, excluded.paid_from),
         read_stamp = excluded.read_stamp,
         updated_at = now()
       where memberships.read_stamp is null or memberships.read_stamp < excluded.read_stamp
       returning *`,
      [householdId, facts.planKey ?? 'unknown', facts.status, subscriptionId, facts.priceId, facts.monthlyPence ?? 0, facts.interval ?? 'month',
        facts.trialEnd, facts.currentPeriodEnd, facts.cancelAtPeriodEnd ?? false, facts.startedAt, facts.endedAt, pauseReason, mode,
        paidFrom, stamp ?? await readStamp(), facts.amountPence ?? facts.monthlyPence ?? 0, pausedFrom, changedAt],
    ));
  } catch (err) {
    // The household is a member already under another subscription: Stripe has made a second (two Checkouts finished).
    if (err.code === '23505' && err.constraint === 'memberships_one_running_idx') throw new SecondMembership(await runningMembership(householdId));
    throw err;
  }
  if (r) return r;
  // A stale read: nothing written — but a failed payment's reason is still kept on a membership that is paused.
  if (pauseReason) await query("update memberships set pause_reason = coalesce(pause_reason, $2) where stripe_subscription_id = $1 and status = 'paused'", [subscriptionId, pauseReason]);
  return membershipBySubscription(subscriptionId);
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
     on conflict do nothing`,
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
       select id, on_date from (
         select id, reminded_for, case when status = 'trialling' then trial_end else current_period_end end as on_date
           from memberships
          where not cancel_at_period_end
            and ((status = 'trialling' and trial_end > now() and trial_end <= now() + make_interval(days => $1))
              or (status = 'active' and interval = 'year' and current_period_end > now() and current_period_end <= now() + make_interval(days => $1)))
       ) d
        -- Already reminded for that date: left out before the limit, so a full batch of them never starves the rest
        -- (Codex, 3 Oct 2026).
        where d.reminded_for is distinct from d.on_date
        order by on_date limit $2
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

/**
 * One Checkout at a time a household (Codex, 3 Oct 2026). Claims the household's checkout slot — refused while
 * another press is in its first two minutes — and hands back the session the last press opened, for the caller to
 * close at Stripe before opening a new one.
 */
export async function claimCheckout(householdId) {
  const { rows: [r] } = await query(
    `with was as (select id, membership_checkout_id from households where id = $1 for update)
     update households h set membership_checkout_at = clock_timestamp()
       from was
      where h.id = was.id and (h.membership_checkout_at is null or h.membership_checkout_at < now() - interval '2 minutes')
     returning was.membership_checkout_id as previous, h.membership_checkout_at::text as lease`,
    [householdId],
  );
  return r ? { claimed: true, previous: r.previous ?? null, lease: r.lease } : { claimed: false };
}

/**
 * Write the new session down — only while this press still holds the slot. A press that outlived its lease, with
 * another press since, writes nothing and is told so, to close its own session (Codex, 3 Oct 2026).
 */
export async function recordCheckout(householdId, sessionId, lease) {
  const { rowCount } = await query(
    'update households set membership_checkout_id = $2 where id = $1 and membership_checkout_at = $3::timestamptz', [householdId, sessionId, lease]);
  return rowCount === 1;
}

/** A press that failed gives the slot back at once — its own slot, never a later press's. */
export async function releaseCheckout(householdId, lease) {
  await query('update households set membership_checkout_at = null where id = $1 and membership_checkout_at = $2::timestamptz', [householdId, lease]);
}

/** Whether this press still holds the household's checkout slot. */
export async function holdsCheckout(householdId, lease) {
  const { rows: [r] } = await query('select 1 from households where id = $1 and membership_checkout_at = $2::timestamptz', [householdId, lease]);
  return Boolean(r);
}
