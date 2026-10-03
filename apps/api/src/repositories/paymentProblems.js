/**
 * The payment problems log (Stripe build, Phase 7; migration 374).
 *
 * Every money job writes here as it finds something wrong — a payment that
 * failed, a refund Stripe refused, a payout held or bounced, a chargeback at
 * each stage, a reconciliation row that doesn't match — and closes the row
 * itself when Stripe says it is put right. What nobody's job can put right
 * waits for a person, who resolves it with a sentence. The back office reads
 * it through `routes/hostingAdmin.js` (no screen until Claude Design's).
 *
 * Writing never throws into the caller: a problem the log couldn't take is
 * said on the console, and the money job carries on — the log is a record of
 * the job, never a reason for it to fail.
 */

import { query } from '../db.js';

export const GROUPS = Object.freeze({
  guest_payments: ['hold_expired', 'later_charge_failed', 'payment_failed', 'refund_failed'],
  memberships: ['membership_payment_failed'],
  fraud: ['blocked_fraud', 'early_fraud_warning', 'chargeback'],
  host_money: ['payout_failed', 'payout_held', 'host_recovery_waiting', 'near_90_day_limit'],
  our_records: ['reconciliation_mismatch'],
});
export const KINDS = Object.freeze(Object.values(GROUPS).flat());
export const groupOf = (kind) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(kind)) ?? null;

export const KIND_WORDS = Object.freeze({
  hold_expired: 'Card hold expired',
  later_charge_failed: 'Later charge failed',
  payment_failed: 'Payment failed',
  refund_failed: 'Refund failed',
  membership_payment_failed: 'Membership payment failed',
  blocked_fraud: 'Blocked as fraud',
  early_fraud_warning: 'Early fraud warning',
  chargeback: 'Chargeback',
  payout_failed: 'Payout failed',
  payout_held: 'Payout held',
  host_recovery_waiting: 'Host recovery waiting',
  near_90_day_limit: 'Near the 90-day limit',
  reconciliation_mismatch: 'Doesn’t match Stripe',
});

const run = (client) => (client ? (t, p) => client.query(t, p) : query);

/**
 * Write a problem, or bring its row up to date when it is seen again (same `dedupeKey`): the amount, stage and
 * detail follow the latest sighting. A resolved row is opened again only when `reopen` says so — a chargeback
 * that was won and then reversed, say. Never throws.
 */
export async function record({ kind, dedupeKey, amountPence = null, currency = 'gbp', txCount = 1, bookingId = null, householdId = null, hostId = null,
  offerId = null, membershipId = null, stripeRef = null, stage = null, detail = {}, at = null, reopen = false, mode = 'test' }, client = null) {
  if (!KINDS.includes(kind) || !dedupeKey) return null;
  try {
    const { rows: [r] } = await run(client)(
      `insert into payment_problems (kind, dedupe_key, amount_pence, currency, tx_count, booking_id, household_id, host_id, offer_id, membership_id,
                                     stripe_ref, stage, detail, occurred_at, mode)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, coalesce($14::timestamptz, now()), $15)
       on conflict (dedupe_key) do update set
         amount_pence = coalesce(excluded.amount_pence, payment_problems.amount_pence),
         stage = coalesce(excluded.stage, payment_problems.stage),
         detail = payment_problems.detail || excluded.detail,
         stripe_ref = coalesce(excluded.stripe_ref, payment_problems.stripe_ref),
         status = case when $16 then 'open' else payment_problems.status end,
         resolution = case when $16 then null else payment_problems.resolution end,
         resolved_by = case when $16 then null else payment_problems.resolved_by end,
         resolved_at = case when $16 then null else payment_problems.resolved_at end,
         updated_at = now()
       returning *`,
      [kind, dedupeKey, amountPence, currency, txCount, bookingId, householdId, hostId, offerId, membershipId, stripeRef, stage,
        JSON.stringify(detail ?? {}), at, mode, Boolean(reopen)],
    );
    return r;
  } catch (err) {
    console.error(`epic-api: payment problem ${kind} (${dedupeKey}) not written — ${err.message}`);
    return null;
  }
}

/** Close a problem that is put right. `by` is 'epic' (a job saw Stripe put it right), 'stripe', or a person. */
export async function resolve({ id = null, dedupeKey = null, resolution, by, stage = null }, client = null) {
  if (!id && !dedupeKey) return null;
  try {
    const { rows: [r] } = await run(client)(
      `update payment_problems set status = 'resolved', resolution = $3, resolved_by = $4, resolved_at = now(),
              stage = coalesce($5, stage), updated_at = now()
        where (($1::uuid is not null and id = $1::uuid) or ($1::uuid is null and dedupe_key = $2::text)) and status = 'open'
        returning *`,
      [id, dedupeKey, String(resolution ?? '').slice(0, 500) || null, String(by ?? 'epic').slice(0, 200), stage],
    );
    return r ?? null;
  } catch (err) {
    console.error(`epic-api: payment problem ${id ?? dedupeKey} not resolved — ${err.message}`);
    return null;
  }
}

/** Close every open problem whose key starts with `prefix` (a payout paid closes its held and failed rows). */
export async function resolveLike(prefix, { resolution, by = 'epic' }, client = null) {
  try {
    const { rowCount } = await run(client)(
      `update payment_problems set status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now(), updated_at = now()
        where status = 'open' and starts_with(dedupe_key, $1)`,
      [prefix, resolution, by],
    );
    return rowCount;
  } catch (err) {
    console.error(`epic-api: payment problems ${prefix}* not resolved — ${err.message}`);
    return 0;
  }
}

/** Problems, newest first, with their links in words. Filtered by kind, group or status. */
export async function list({ kind = null, group = null, status = null, bookingId = null, hostId = null, limit = 100, offset = 0 } = {}) {
  const kinds = kind ? [kind] : group ? GROUPS[group] ?? [] : KINDS;
  const { rows } = await query(
    `select p.*, o.title as offer_title, h.name as host_name, g.name as household_name
       from payment_problems p
       left join host_offers o on o.id = p.offer_id
       left join hosts h on h.id = p.host_id
       left join households g on g.id = p.household_id
      where p.kind = any($1::text[]) and ($2::text is null or p.status = $2)
        and ($3::uuid is null or p.booking_id = $3) and ($4::uuid is null or p.host_id = $4)
      order by p.occurred_at desc, p.id
      limit $5 offset $6`,
    [kinds, status, bookingId, hostId, Math.min(500, Math.max(1, limit)), Math.max(0, offset)],
  );
  return rows;
}

/**
 * Per kind: transactions, money, open, resolved, and the trend — this 30 days against the 30 before. A kind with
 * nothing in either window says so (null), rather than a trend of nought.
 */
export async function summary({ now = new Date() } = {}) {
  const { rows } = await query(
    `select kind,
            coalesce(sum(tx_count), 0)::int as transactions,
            coalesce(sum(amount_pence), 0)::bigint as pence,
            count(*) filter (where status = 'open')::int as open,
            count(*) filter (where status = 'resolved')::int as resolved,
            count(*) filter (where occurred_at > $1::timestamptz - interval '30 days')::int as last30,
            count(*) filter (where occurred_at <= $1::timestamptz - interval '30 days' and occurred_at > $1::timestamptz - interval '60 days')::int as prior30
       from payment_problems group by kind`,
    [now],
  );
  const by = new Map(rows.map((r) => [r.kind, r]));
  return Object.entries(GROUPS).map(([group, kinds]) => ({
    group,
    kinds: kinds.map((k) => {
      const r = by.get(k);
      const last = r?.last30 ?? 0;
      const prior = r?.prior30 ?? 0;
      return {
        kind: k, words: KIND_WORDS[k],
        transactions: r?.transactions ?? 0, pence: Number(r?.pence ?? 0), open: r?.open ?? 0, resolved: r?.resolved ?? 0,
        trend: last === 0 && prior === 0 ? null : { last30: last, prior30: prior, direction: last > prior ? 'up' : last < prior ? 'down' : 'flat' },
      };
    }),
  }));
}

export const payload = (p) => ({
  id: p.id, kind: p.kind, words: KIND_WORDS[p.kind] ?? p.kind, group: groupOf(p.kind),
  at: p.occurred_at, amountPence: p.amount_pence, currency: p.currency, transactions: p.tx_count,
  bookingId: p.booking_id, householdId: p.household_id, householdName: p.household_name ?? null,
  hostId: p.host_id, hostName: p.host_name ?? null, offerId: p.offer_id, offerTitle: p.offer_title ?? null,
  membershipId: p.membership_id, stripeRef: p.stripe_ref, stage: p.stage, detail: p.detail ?? {},
  status: p.status, resolution: p.resolution, resolvedBy: p.resolved_by, resolvedAt: p.resolved_at, mode: p.mode,
});
