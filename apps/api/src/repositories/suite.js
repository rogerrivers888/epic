/**
 * The reporting suite, read from the database Epic actually has.
 *
 * This answers in exactly the shape `domain/reportingFixtures.js` does, which
 * is what lets one set of screens draw either. The difference is what a missing
 * figure looks like: the fixtures always have a number, and this returns
 * **`null` plus a named reason**, because the handoff's seventh non-negotiable
 * is that a gap says what it is — "No payment provider", never "£0".
 *
 * Three disciplines run through every query here.
 *
 *  · **A completed thing is counted from its own table, never from a log.** A
 *    trip is a trip, a rating is a rating, a booking is a booking. The only
 *    things read from `activity_events` are the two nothing else knows: that
 *    somebody was here, and what they were looking at.
 *  · **Flows are summed over the window, stocks are read at its end, rates are
 *    read as they stand.** Nothing is multiplied by a factor, so a period
 *    change cannot scale a count of live subscriptions.
 *  · **Guest-invite households are excluded from every estate denominator by
 *    default** (migration 199). A guest invited to somebody else's trip is a
 *    success, and counting them beside a trial signup makes activation read as
 *    broken while the business works.
 *
 * What is genuinely not knowable today, and why, is collected in `GAPS`. Each
 * one names the thing that would have to exist, so the screen can say it.
 */

import { query } from '../db.js';
import { classExpression } from '../domain/costClass.js';
import { monthBuckets } from '../domain/reportingPeriods.js';
import { listCounterparties, rateHistory } from './counterparties.js';
import { annualPence, readBenefits, readChannels, readTiers } from './pricing.js';

/**
 * The gaps, in the words the screens say out loud.
 *
 * Keyed by family rather than by figure, because one missing thing puts out a
 * dozen figures and repeating the sentence a dozen times is how it comes to be
 * worded three different ways.
 */
export const GAPS = {
  bookings: 'No payment provider',
  hotel: 'No hotel booking provider',
  activity: 'No activity booking provider',
  churn: 'No subscription state — plan history is empty',
  attribution: 'Signup source is not instrumented',
  costByStream: 'Cost is not classified by stream',
  satisfaction: 'Satisfaction is not instrumented',
  forecast: 'No trial conversion history',
  runway: 'No salary or overhead ledger',
  listSize: 'Needs cancellation history',
  commission: 'No commission rate is recorded',
  // Every outbound call is logged with its cost; none of them records whether
  // it came back, or how long it took. Adding that means touching every
  // adapter, which is the attribution spine's build rather than this one.
  providerHealth: 'Provider calls do not record an outcome or a duration',
  // What a supplier we are invoiced by costs is on an invoice nobody has
  // entered. Not nought — unread.
  invoiced: 'Invoiced, not metered',
  channels: 'No payment provider — the channel a subscription came through is not recorded',
};

/** Guest-invite households are out of every denominator unless asked for. */
const NOT_GUEST = "h.origin <> 'guest_invite'";

const int = (v) => (v == null ? 0 : Number(v));
/**
 * A host offer's shape, in the words the app uses for it.
 *
 * `host_offers.shape` is a key — `one_off`, `series`, `anytime` — and a bar
 * chart labelled "one_off" is a database column on a screen.
 */
const SHAPE_WORDS = {
  one_off: 'One-off', oneoff: 'One-off', series: 'A series over weeks',
  anytime: 'Anytime, on request', course: 'A course', tour: 'A tour',
};

/**
 * The latest month of a series against the one three back.
 *
 * Nothing where there is no comparator above zero — the same rule every other
 * change figure in the suite is under.
 */
const quarterOn = (series) => (series && series.length >= 4
  ? change(series[series.length - 1], series[series.length - 4])
  : null);

/** "1 host", "2 hosts" — said properly, because it is on every screen. */
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
/** A share row: a label, a figure, and the bar length as a share of the biggest. */
const row = (label, value, pctOf = null) => ({ label, value, pct: pctOf });

/** Bars sized against the largest in the set, which is how the design draws them. */
function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => (typeof r.value === 'number' ? r.value : 0)));
  return rows.map((r) => ({ ...r, pct: typeof r.value === 'number' ? Math.round((r.value / max) * 100) : 0 }));
}

/**
 * A change, as a percentage, or nothing.
 *
 * The handoff: "A change figure only prints when a full prior window of the
 * same length exists and sums above zero — otherwise it is omitted, never
 * rendered as ∞ or 0%." So this returns `null` rather than a number the reader
 * would take for a measurement.
 */
export function change(now, before) {
  if (before == null || before <= 0 || now == null) return null;
  return Math.round((now / before - 1) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// the estate
// ---------------------------------------------------------------------------

async function estate(period) {
  const { rows: [counts] } = await query(
    `select
       (select count(*)::int from households)                                          as households,
       (select count(*)::int from households h where ${NOT_GUEST} and h.origin <> 'founding') as customers,
       (select count(*)::int from members)                                             as people,
       (select count(*)::int from accounts a join households h on h.id = a.household_id
         where a.status <> 'suspended' and ${NOT_GUEST}
           and exists (select 1 from plans p where p.key = a.plan and p.price_pence is not null)) as paying,
       (select count(*)::int from accounts a join households h on h.id = a.household_id
         where a.status <> 'suspended' and ${NOT_GUEST}
           and exists (select 1 from plans p where p.key = a.plan and p.price_pence is null))    as trial,
       -- Bounded at both ends. A lower bound alone counted the current month
       -- inside "last month", so the figure was not the window's (Codex, 20 Sep 2026).
       (select count(distinct e.household_id)::int from activity_events e
          join households h on h.id = e.household_id
         where e.at >= $1 and e.at < $2 and ${NOT_GUEST})                              as active_window,
       (select count(distinct e.household_id)::int from activity_events e
          join households h on h.id = e.household_id
         where e.at >= now() - interval '90 days' and ${NOT_GUEST})                    as active_90`,
    [period.from, period.to],
  );

  const { rows: origins } = await query(
    `select origin, count(*)::int as households from households group by origin`,
  );
  const ORIGIN_LABELS = {
    founding: 'Founding', signup: 'Signed up', guest_invite: 'Invited as a guest',
    peer: 'In somebody’s household', marketplace: 'From a host’s page',
  };

  // At risk: paying, and nothing opened in thirty days. Derived from the state
  // of the row — the handoff's ninth rule, "instrument entry, derive exit".
  const { rows: [risk] } = await query(
    `select count(*)::int as at_risk
       from accounts a
       join households h on h.id = a.household_id
       join plans p on p.key = a.plan
      where a.status = 'active' and p.price_pence is not null and ${NOT_GUEST}
        and not exists (
          select 1 from activity_events e
           where e.household_id = a.household_id and e.at >= now() - interval '30 days'
        )`,
  );

  return {
    households: int(counts.households),
    customers: int(counts.customers),
    active: int(counts.active_window),
    active90: int(counts.active_90),
    paying: int(counts.paying),
    trial: int(counts.trial),
    atRisk: int(risk.at_risk),
    people: int(counts.people),
    origins: ['founding', 'signup', 'guest_invite', 'peer', 'marketplace'].map((k) => row(
      ORIGIN_LABELS[k],
      int(origins.find((o) => o.origin === k)?.households),
    )),
  };
}

// ---------------------------------------------------------------------------
// money — what the plans people are on are priced at
// ---------------------------------------------------------------------------

/**
 * Contracted subscription revenue over a window.
 *
 * Priced from `account_plan_history` where it has anything to say and from the
 * account as it stands where it does not, which is the same rule
 * `insights.revenueByMonth` already uses. `estimated` says which happened, so
 * the screen can mark it rather than imply a precision it has not got.
 *
 * Nothing here is cash. Epic holds no payment provider, so this is what the
 * plans people are on are worth, and every screen that shows it says so.
 */
async function subscriptionRevenue(from, to) {
  const { rows: [r] } = await query(
    /**
     * Two things this query has to get right, and both were wrong (Codex,
     * 20 Sep 2026):
     *
     *  · **A month is priced at what it was sold at.** It read `ph.plan` from
     *    the history and then took `plans.price_pence` — today's cached price —
     *    and `accounts.status` as it stands. So changing a price rewrote every
     *    prior month, and suspending an account removed it from history. The
     *    history row carries its own `price_pence` and `status` for exactly
     *    this reason, and now they are what is read. `plans.price_pence` is the
     *    fallback only for an account that predates the history table, which is
     *    what `estimated` reports.
     *  · **`to` is exclusive.** `generate_series` to `date_trunc('month', $2)`
     *    put the current month inside "last month", because `to` is the first
     *    instant of this one. It stops a microsecond short now.
     */
    `with months as (
       select generate_series(date_trunc('month', $1::timestamptz),
                              date_trunc('month', $2::timestamptz - interval '1 microsecond'),
                              '1 month') as month
     ),
     state as (
       select m.month, a.id as account_id,
              (select ph.plan from account_plan_history ph
                where ph.account_id = a.id and ph.from_at < m.month + interval '1 month'
                order by ph.from_at desc limit 1)                                 as held_plan,
              (select ph.price_pence from account_plan_history ph
                where ph.account_id = a.id and ph.from_at < m.month + interval '1 month'
                order by ph.from_at desc limit 1)                                 as held_pence,
              (select ph.status from account_plan_history ph
                where ph.account_id = a.id and ph.from_at < m.month + interval '1 month'
                order by ph.from_at desc limit 1)                                 as held_status,
              a.plan                                                              as now_plan,
              a.status                                                            as now_status,
              (a.created_at < m.month + interval '1 month')                       as existed
         from months m
         left join accounts a on true
         left join households h on h.id = a.household_id
        where a.id is null or h.origin <> 'guest_invite'
     ),
     priced as (
       select st.*,
              coalesce(st.held_status, st.now_status)                             as status,
              -- The price on the history row first; the plan's cached price only
              -- where there is no history to read.
              coalesce(st.held_pence, p.price_pence)                              as pence,
              (st.held_plan is null)                                              as estimated
         from state st
         left join plans p on p.key = coalesce(st.held_plan, st.now_plan)
     )
     select coalesce(sum(pence) filter (where existed and status <> 'suspended'), 0)::int as pence,
            count(*) filter (where existed and estimated)::int                            as estimated_rows,
            count(*) filter (where existed)::int                                          as rows_total
       from priced`,
    [from, to],
  );
  return { pence: int(r.pence), estimated: int(r.estimated_rows) === int(r.rows_total) && int(r.rows_total) > 0 };
}

/** Monthly recurring revenue as it stands, by plan — a rate, never scaled. */
async function mrr() {
  const { rows } = await query(
    /**
     * `h.origin <> 'guest_invite'` in the LEFT JOIN condition only made `h`
     * null for a guest — it did not drop the account row — so guests were still
     * counted and still summed (Codex, 20 Sep 2026). The exclusion belongs in
     * the aggregate's own filter, where it actually excludes.
     */
    `select p.key, p.label, p.price_pence,
            count(a.id) filter (where a.status <> 'suspended' and h.origin <> 'guest_invite')::int as households,
            coalesce(sum(p.price_pence) filter (where a.status <> 'suspended' and h.origin <> 'guest_invite'), 0)::int as pence
       from plans p
       left join accounts a on a.plan = p.key
       left join households h on h.id = a.household_id
      group by p.key, p.label, p.price_pence, p.position
      order by p.position`,
  );
  return rows.map((r) => ({
    key: r.key,
    label: r.price_pence
      ? `${r.label} £${(r.price_pence / 100).toFixed(2)} · ${int(r.households)}`
      : `${r.label} · ${int(r.households)}`,
    households: int(r.households),
    pence: int(r.pence),
  }));
}

/** What a booking recorded through Epic was worth, and what came back. */
async function bookings(from, to) {
  const { rows: [b] } = await query(
    `select count(*)::int                                                        as count,
            coalesce(sum(b.amount_pence), 0)::int                                as gross_pence,
            coalesce(sum(b.amount_pence) filter (where b.refunded_at is not null), 0)::int as refunded_pence,
            count(*) filter (where b.refunded_at is not null)::int               as refunded
       from experience_bookings b
      where b.created_at >= $1 and b.created_at < $2
        and b.cancelled_at is null`,
    [from, to],
  );
  return {
    count: int(b.count),
    grossPence: int(b.gross_pence),
    refundedPence: int(b.refunded_pence),
    refunded: int(b.refunded),
  };
}

// ---------------------------------------------------------------------------
// cost — measured, not apportioned
// ---------------------------------------------------------------------------

/**
 * What Epic spent with providers over a window, by class and by provider.
 *
 * `provider_calls` is Epic's own ledger of its own spending, written on every
 * outbound call, so this is measured. The class is derived at read time — see
 * `domain/costClass.js` for why it is not a stored column yet, and what the
 * screens say about that.
 */
async function cost(from, to) {
  const cls = classExpression('c');
  const { rows: byClass } = await query(
    `select ${cls} as class,
            count(*)::int as calls,
            coalesce(sum(c.estimated_cost_usd), 0)::float as usd
       from provider_calls c
      where c.created_at >= $1 and c.created_at < $2
      group by 1 order by 3 desc`,
    [from, to],
  );
  const { rows: byProvider } = await query(
    `select c.provider,
            count(*)::int as calls,
            coalesce(sum(c.estimated_cost_usd), 0)::float as usd,
            count(distinct c.household_id)::int as households
       from provider_calls c
      where c.created_at >= $1 and c.created_at < $2
      group by 1 order by 3 desc, 2 desc`,
    [from, to],
  );
  const { rows: byPurpose } = await query(
    `select c.purpose, ${cls} as class,
            count(*)::int as calls,
            coalesce(sum(c.estimated_cost_usd), 0)::float as usd
       from provider_calls c
      where c.created_at >= $1 and c.created_at < $2
      group by 1, 2 order by 4 desc`,
    [from, to],
  );
  const total = byProvider.reduce((n, p) => n + p.usd, 0);
  return { total, byClass, byProvider, byPurpose };
}

// ---------------------------------------------------------------------------
// the household list
// ---------------------------------------------------------------------------

/**
 * Every household, with what it is on and what it has done.
 *
 * Sorted and filtered on the client on purpose: this is an estate of
 * households, not a million rows, and a round trip per column sort would be
 * slower than the sort — the same choice `/api/admin/people` already made.
 */
async function households(period) {
  const { rows } = await query(
    `select h.id, h.name, h.origin, h.home_label,
            a.id as account_id, a.email, a.plan, a.status, a.trial_ends_on,
            a.created_at as joined, a.last_seen_at,
            p.label as plan_label, p.price_pence,
            (select count(*)::int from members m where m.household_id = h.id)               as people,
            (select count(*)::int from household_places hp where hp.household_id = h.id)    as places,
            (select count(distinct v.visited_on)::int from visits v where v.household_id = h.id) as days_out,
            (select count(*)::int from trips t where t.household_id = h.id and t.end_date > t.start_date) as trips_away,
            (select count(*)::int from experience_bookings b where b.household_id = h.id and b.cancelled_at is null) as bookings,
            (select count(*)::int from ratings r
               join visits v on v.id = r.visit_id where v.household_id = h.id)              as ratings,
            (select max(e.at) from activity_events e where e.household_id = h.id)           as seen_at,
            (select coalesce(sum(c.estimated_cost_usd), 0)::float from provider_calls c
              where c.household_id = h.id and c.created_at >= $1)                           as cost_usd
       from households h
       left join accounts a on a.household_id = h.id and a.member_id is null
       left join plans p on p.key = a.plan
      order by h.created_at`,
    [period.from],
  );

  const now = Date.now();
  return rows.map((r) => {
    const seen = r.seen_at ?? r.last_seen_at;
    const lastSeenDays = seen ? Math.floor((now - new Date(seen).getTime()) / 86400000) : null;
    const paying = r.price_pence != null && r.status === 'active';
    const status = r.status === 'suspended' ? 'cancelled'
      : r.price_pence == null && r.status === 'active' ? 'trial'
        : paying && lastSeenDays != null && lastSeenDays >= 30 ? 'at_risk'
          : r.status === 'active' ? 'live' : r.status;
    return {
      id: r.id,
      accountId: r.account_id,
      name: r.name,
      area: r.home_label ?? null,
      people: int(r.people),
      origin: r.origin,
      plan: r.plan_label ?? r.plan ?? '—',
      monthPence: int(r.price_pence),
      joined: r.joined ? new Date(r.joined).toISOString().slice(0, 10) : null,
      lastSeenDays,
      places: int(r.places),
      daysOut: int(r.days_out),
      tripsAway: int(r.trips_away),
      bookings: int(r.bookings),
      ratings: int(r.ratings),
      costUsd: r.cost_usd,
      status,
      statusNote: status === 'trial' && r.trial_ends_on
        ? `${Math.max(0, Math.ceil((new Date(r.trial_ends_on).getTime() - now) / 86400000))} days left`
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// behaviour — per household per month
// ---------------------------------------------------------------------------

/**
 * The six measures, as a rate: how much one household does in a month.
 *
 * Divided by the households that were **active** in the window, not by every
 * household that exists — the handoff's sixth rule is money per household and
 * engagement per person, and an engagement rate over dormant rows measures the
 * denominator rather than the behaviour.
 */
/**
 * How many households did anything at all in the window.
 *
 * The denominator for every "per household" figure, and it is a union over the
 * tables the acts live in rather than a count of heartbeats: a household that
 * searched twice and never sent a heartbeat did something, and dividing its two
 * searches by a base that excludes it measures the denominator rather than the
 * behaviour.
 */
async function activeBase(period) {
  const { rows: [b] } = await query(
    `select count(*)::int as n from households h
      where ${NOT_GUEST} and (
        exists (select 1 from activity_events e where e.household_id = h.id and e.at >= $1 and e.at < $2)
        or exists (select 1 from searches s where s.household_id = h.id and s.at >= $1 and s.at < $2)
        or exists (select 1 from household_places hp where hp.household_id = h.id and hp.first_seen >= $1 and hp.first_seen < $2)
        or exists (select 1 from visits v where v.household_id = h.id and v.created_at >= $1 and v.created_at < $2)
        or exists (select 1 from trips t where t.household_id = h.id and t.created_at >= $1 and t.created_at < $2)
        or exists (select 1 from experience_bookings eb where eb.household_id = h.id and eb.created_at >= $1 and eb.created_at < $2)
      )`,
    [period.from, period.to],
  );
  return int(b.n);
}

async function behaviourRates(period, base) {
  const { rows: [c] } = await query(
    `select
       (select count(*)::int from searches s join households h on h.id = s.household_id
         where s.at >= $1 and s.at < $2 and ${NOT_GUEST})                               as searches,
       (select count(*)::int from household_places hp join households h on h.id = hp.household_id
         where hp.first_seen >= $1 and hp.first_seen < $2 and ${NOT_GUEST})             as saves,
       (select count(distinct (v.household_id, v.visited_on))::int from visits v
          join households h on h.id = v.household_id
         where v.created_at >= $1 and v.created_at < $2 and ${NOT_GUEST})               as days_out,
       (select count(*)::int from trips t join households h on h.id = t.household_id
         where t.created_at >= $1 and t.created_at < $2 and ${NOT_GUEST}
           and t.end_date > t.start_date)                                               as trips,
       (select count(*)::int from experience_bookings b join households h on h.id = b.household_id
         where b.created_at >= $1 and b.created_at < $2 and ${NOT_GUEST}
           and b.cancelled_at is null)                                                  as attended,
       (select count(*)::int from host_offers o join hosts ho on ho.id = o.host_id
          join households h on h.id = ho.household_id
         where o.published_at >= $1 and o.published_at < $2 and ${NOT_GUEST})           as hosted`,
    [period.from, period.to],
  );
  const months = Math.max(1, period.months);
  const per = (n) => (base ? Math.round((int(n) / base / months) * 100) / 100 : 0);
  return {
    searches: per(c.searches), saves: per(c.saves), out: per(c.days_out),
    trips: per(c.trips), attended: per(c.attended), hosted: per(c.hosted),
    totals: {
      searches: int(c.searches), saves: int(c.saves), out: int(c.days_out),
      trips: int(c.trips), attended: int(c.attended), hosted: int(c.hosted),
    },
  };
}

// ---------------------------------------------------------------------------
// twelve months of history, for anything that can be drilled
// ---------------------------------------------------------------------------

/**
 * One row per month for each drillable metric.
 *
 * Twelve buckets whatever the picker says, because the drill's own window is
 * part of what it means: "the last twelve months" does not become three months
 * because somebody looked at a quarter.
 */
async function history(now) {
  const months = monthBuckets(now);
  const first = months[0].from;

  const monthly = async (sql, params = []) => {
    const { rows } = await query(sql, [first, ...params]);
    const by = new Map(rows.map((r) => [r.month, Number(r.n)]));
    return months.map((m) => by.get(m.key) ?? 0);
  };

  const [signups, engagement, events, searches, saves, out, trips, attended, hosted, costUsd] = await Promise.all([
    monthly(`select to_char(date_trunc('month', a.created_at), 'YYYY-MM') as month, count(*)::int as n
               from accounts a
               join households h on h.id = a.household_id
               left join plans p on p.key = a.plan
              where a.created_at >= $1 and ${NOT_GUEST} and p.price_pence is not null group by 1`),
    monthly(`select to_char(date_trunc('month', e.at), 'YYYY-MM') as month, count(distinct e.household_id)::int as n
               from activity_events e join households h on h.id = e.household_id
              where e.at >= $1 and ${NOT_GUEST} group by 1`),
    monthly(`select to_char(date_trunc('month', o.published_at), 'YYYY-MM') as month, count(*)::int as n
               from host_offers o where o.published_at >= $1 group by 1`),
    monthly(`select to_char(date_trunc('month', s.at), 'YYYY-MM') as month, count(*)::int as n
               from searches s join households h on h.id = s.household_id
              where s.at >= $1 and ${NOT_GUEST} group by 1`),
    monthly(`select to_char(date_trunc('month', hp.first_seen), 'YYYY-MM') as month, count(*)::int as n
               from household_places hp join households h on h.id = hp.household_id
              where hp.first_seen >= $1 and ${NOT_GUEST} group by 1`),
    monthly(`select to_char(date_trunc('month', v.created_at), 'YYYY-MM') as month,
                    count(distinct (v.household_id, v.visited_on))::int as n
               from visits v join households h on h.id = v.household_id
              where v.created_at >= $1 and ${NOT_GUEST} group by 1`),
    monthly(`select to_char(date_trunc('month', t.created_at), 'YYYY-MM') as month, count(*)::int as n
               from trips t join households h on h.id = t.household_id
              where t.created_at >= $1 and ${NOT_GUEST} and t.end_date > t.start_date group by 1`),
    monthly(`select to_char(date_trunc('month', b.created_at), 'YYYY-MM') as month, count(*)::int as n
               from experience_bookings b join households h on h.id = b.household_id
              where b.created_at >= $1 and ${NOT_GUEST} and b.cancelled_at is null group by 1`),
    monthly(`select to_char(date_trunc('month', o.published_at), 'YYYY-MM') as month, count(*)::int as n
               from host_offers o join hosts ho on ho.id = o.host_id
               join households h on h.id = ho.household_id
              where o.published_at >= $1 and ${NOT_GUEST} group by 1`),
    monthly(`select to_char(date_trunc('month', c.created_at), 'YYYY-MM') as month,
                    coalesce(sum(c.estimated_cost_usd), 0)::float as n
               from provider_calls c where c.created_at >= $1 group by 1`),
  ]);

  // Revenue, month by month, from the plan each account was on during it.
  const { rows: revenueRows } = await query(
    `with span as (
       select generate_series(date_trunc('month', $1::timestamptz), date_trunc('month', now()), '1 month') as month
     ),
     state as (
       select s.month, a.id as account_id, a.status,
              coalesce((select ph.plan from account_plan_history ph
                         where ph.account_id = a.id and ph.from_at < s.month + interval '1 month'
                         order by ph.from_at desc limit 1), a.plan) as plan,
              (a.created_at < s.month + interval '1 month') as existed
         from span s
         left join accounts a on true
         left join households h on h.id = a.household_id
        where a.id is null or h.origin <> 'guest_invite'
     )
     select to_char(st.month, 'YYYY-MM') as month,
            coalesce(sum(p.price_pence) filter (where st.existed and st.status <> 'suspended'), 0)::int as pence
       from state st left join plans p on p.key = st.plan
      group by 1 order by 1`,
    [first],
  );
  const byMonth = new Map(revenueRows.map((r) => [r.month, int(r.pence) / 100]));
  const revenue = months.map((m) => byMonth.get(m.key) ?? 0);

  return {
    labels: months.map((m) => m.label),
    keys: months.map((m) => m.key),
    series: {
      signups, revenue, engagement, events,
      searches, saves, out, trips, attended, hosted,
      cost: costUsd,
      // The four streams: only subscriptions has a history. The other three are
      // absent rather than zero, and the drill says which when it is opened.
      subscriptions: revenue, hotel: null, hosting: null, activity: null,
    },
  };
}

/** Twelve months of spend for each provider, for the supplier drill. */
async function supplierHistory(now) {
  const months = monthBuckets(now);
  const { rows } = await query(
    `select c.provider, to_char(date_trunc('month', c.created_at), 'YYYY-MM') as month,
            coalesce(sum(c.estimated_cost_usd), 0)::float as usd,
            count(*)::int as calls
       from provider_calls c
      where c.created_at >= $1
      group by 1, 2`,
    [months[0].from],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.provider)) out.set(r.provider, new Map());
    out.get(r.provider).set(r.month, r.usd);
  }
  return { months, of: (provider) => months.map((m) => out.get(provider)?.get(m.key) ?? 0) };
}

// ---------------------------------------------------------------------------
// what a household does, as shares
// ---------------------------------------------------------------------------

async function engagementShares(period, activeBase) {
  const { rows: [s] } = await query(
    `select
       (select count(distinct s.household_id)::int from searches s join households h on h.id = s.household_id
         where s.at >= $1 and s.at < $2 and ${NOT_GUEST})                                  as searched,
       (select count(distinct hp.household_id)::int from household_places hp join households h on h.id = hp.household_id
         where hp.first_seen >= $1 and hp.first_seen < $2 and ${NOT_GUEST})                as saved,
       (select count(distinct v.household_id)::int from visits v join households h on h.id = v.household_id
         where v.created_at >= $1 and v.created_at < $2 and ${NOT_GUEST})                  as settled,
       (select count(distinct v.household_id)::int from ratings r join visits v on v.id = r.visit_id
          join households h on h.id = v.household_id
         where r.created_at >= $1 and r.created_at < $2 and ${NOT_GUEST})                  as rated,
       (select count(distinct b.household_id)::int from experience_bookings b join households h on h.id = b.household_id
         where b.created_at >= $1 and b.created_at < $2 and ${NOT_GUEST})                  as booked,
       (select count(distinct t.household_id)::int from trip_guests g join trips t on t.id = g.trip_id
          join households h on h.id = t.household_id
         where g.invited_at >= $1 and g.invited_at < $2 and ${NOT_GUEST})                  as invited`,
    [period.from, period.to],
  );
  const each = [
    ['Searched', s.searched], ['Saved a place', s.saved], ['Settled a day out', s.settled],
    ['Rated a day', s.rated], ['Booked something', s.booked], ['Invited someone', s.invited],
  ];
  return each.map(([label, n]) => ({
    label,
    value: int(n),
    of: activeBase,
    pct: pct(int(n), activeBase),
  }));
}

/** Which screens the time went on. `activity_events` is the only thing that knows. */
async function bySurface(period) {
  const { rows } = await query(
    `select coalesce(split_part(e.screen, '.', 1), 'unknown') as surface,
            count(distinct e.household_id)::int as households,
            coalesce(sum(e.seconds), 0)::int as seconds
       from activity_events e
       join households h on h.id = e.household_id
      where e.at >= $1 and e.at < $2 and e.screen is not null and ${NOT_GUEST}
      group by 1 order by 2 desc, 3 desc limit 8`,
    [period.from, period.to],
  );
  return bars(rows.map((r) => row(
    r.surface.charAt(0).toUpperCase() + r.surface.slice(1),
    int(r.households),
  )));
}

/**
 * Visits and time on site.
 *
 * A visit is heartbeats from one household with no gap greater than thirty
 * minutes — a definition rather than a new instrument, so it is derivable from
 * everything collected since the heartbeat started. `new` is a household whose
 * first event ever falls inside the window.
 */
async function visits(period) {
  const { rows: [v] } = await query(
    `with beats as (
       select e.household_id, e.at, e.seconds,
              lag(e.at) over (partition by e.household_id order by e.at) as prev
         from activity_events e
         join households h on h.id = e.household_id
        where e.at >= $1 and e.at < $2 and ${NOT_GUEST}
     ),
     sessions as (
       select household_id, at, seconds,
              sum(case when prev is null or at - prev > interval '30 minutes' then 1 else 0 end)
                over (partition by household_id order by at) as visit
         from beats
     ),
     each as (
       select household_id, visit, coalesce(sum(seconds), 0)::int as seconds
         from sessions group by 1, 2
     )
     select count(*)::int as visits,
            coalesce(round(avg(seconds)), 0)::int as seconds,
            count(distinct household_id)::int as households
       from each`,
    [period.from, period.to],
  );
  const { rows: [n] } = await query(
    `select count(*)::int as fresh
       from households h
      where ${NOT_GUEST}
        and (select min(e.at) from activity_events e where e.household_id = h.id) >= $1
        and (select min(e.at) from activity_events e where e.household_id = h.id) < $2`,
    [period.from, period.to],
  );
  return {
    visits: int(v.visits),
    households: int(v.households),
    newHouseholds: int(n.fresh),
    secondsPerVisit: int(v.seconds),
  };
}

/**
 * Of the thirteen weeks in a quarter, how many had at least one visit.
 *
 * The one figure that says whether Epic is worth *having* rather than worth
 * trying, and the Behaviour screen's closing band.
 */
async function returnBuckets() {
  const { rows } = await query(
    `with weeks as (
       select h.id,
              (select count(distinct date_trunc('week', e.at))::int from activity_events e
                where e.household_id = h.id and e.at >= now() - interval '13 weeks') as weeks,
              exists (select 1 from activity_events e where e.household_id = h.id)    as ever
         from households h
        where ${NOT_GUEST}
     )
     select count(*) filter (where not ever)::int                          as never_opened,
            count(*) filter (where ever and weeks = 0)::int                as lapsed,
            count(*) filter (where weeks between 1 and 3)::int             as w1,
            count(*) filter (where weeks between 4 and 6)::int             as w4,
            count(*) filter (where weeks between 7 and 9)::int             as w7,
            count(*) filter (where weeks >= 10)::int                       as w10,
            count(*)::int                                                  as total
       from weeks`,
  );
  const b = rows[0];
  const total = int(b.total);
  const mk = (label, n) => ({ label, value: int(n), pct: pct(int(n), total) ?? 0, of: total });
  return {
    base: total,
    buckets: [
      mk('Never opened it', b.never_opened),
      mk('Opened before, not this quarter', b.lapsed),
      mk('1 to 3 weeks of 13', b.w1),
      mk('4 to 6 weeks', b.w4),
      mk('7 to 9 weeks', b.w7),
      mk('10 to 13 weeks', b.w10),
    ],
  };
}

// ---------------------------------------------------------------------------
// what a search became, and what a saved place became
// ---------------------------------------------------------------------------

async function searchOutcomes(period) {
  const { rows: asked } = await query(
    `select coalesce(nullif(s.subject, ''), s.surface) as subject, count(*)::int as n
       from searches s join households h on h.id = s.household_id
      where s.at >= $1 and s.at < $2 and ${NOT_GUEST}
      group by 1 order by 2 desc limit 6`,
    [period.from, period.to],
  );
  const { rows: [became] } = await query(
    `select count(*)::int                                            as total,
            count(*) filter (where s.outcome = 'none')::int          as nothing,
            count(*) filter (where s.outcome = 'clicked')::int       as clicked,
            count(*) filter (where s.outcome = 'saved')::int         as saved,
            count(*) filter (where s.outcome = 'tripped')::int       as trip
       from searches s join households h on h.id = s.household_id
      where s.at >= $1 and s.at < $2 and ${NOT_GUEST}`,
    [period.from, period.to],
  );
  const { rows: [funnel] } = await query(
    `select count(distinct s.household_id)::int                                    as searched,
            count(distinct s.household_id) filter (where s.outcome <> 'none')::int as created
       from searches s
       join households h on h.id = s.household_id
      where s.at >= $1 and s.at < $2 and ${NOT_GUEST}`,
    [period.from, period.to],
  );
  const { rows: [firstSave] } = await query(
    `with firsts as (
       select s.household_id, min(s.at) as saved_at
         from searches s join households h on h.id = s.household_id
        where s.outcome in ('saved', 'tripped') and ${NOT_GUEST}
        group by 1
     )
     select coalesce(round(avg(n), 1), 0)::float as before_first_save
       from (
         select f.household_id,
                (select count(*)::int from searches s2
                  where s2.household_id = f.household_id and s2.at <= f.saved_at) as n
           from firsts f
       ) each`,
  );
  const total = int(became.total);
  const share = (n) => (total ? `${pct(int(n), total)}%` : null);
  return {
    asked: bars(asked.map((r) => row(r.subject, int(r.n)))),
    // The four outcomes the search log actually records (`repositories/searches.js`):
    // nothing, a place opened, a place saved, a place put on a trip. An outcome
    // only ever rises, so these do not double-count.
    became: [
      { label: 'Nothing', value: share(became.nothing), pct: pct(int(became.nothing), total) ?? 0 },
      { label: 'A place opened', value: share(became.clicked), pct: pct(int(became.clicked), total) ?? 0 },
      { label: 'A place saved', value: share(became.saved), pct: pct(int(became.saved), total) ?? 0 },
      { label: 'Added to a trip', value: share(became.trip), pct: pct(int(became.trip), total) ?? 0 },
    ],
    becameHighlight: 2,
    funnel: [
      row('Households who searched', int(funnel.searched)),
      row('Created a trip or saved a place', int(funnel.created)),
      row('Created nothing at all', int(funnel.searched) - int(funnel.created)),
      // Lifetime, and labelled as such: how many tries it takes before a
      // household saves anything is not a property of one month.
      row('Searches before the first save, ever', firstSave.before_first_save || null),
    ],
    total,
  };
}

async function savedPlaceOutcomes(period) {
  const { rows: kinds } = await query(
    `select coalesce(nullif(hp.category, ''), coalesce(hp.kind, 'Other')) as category, count(*)::int as n
       from household_places hp join households h on h.id = hp.household_id
      where hp.first_seen >= $1 and hp.first_seen < $2 and ${NOT_GUEST}
      group by 1 order by 2 desc limit 6`,
    [period.from, period.to],
  );
  const { rows: [what] } = await query(
    `select count(*)::int as total,
            count(*) filter (where exists (
              select 1 from trip_stops ts join trips t on t.id = ts.trip_id
               where t.household_id = hp.household_id and ts.venue_ref = hp.venue_ref))::int as on_trip,
            count(*) filter (where exists (
              select 1 from visits v
               where v.household_id = hp.household_id and v.venue_ref = hp.venue_ref))::int  as visited
       from household_places hp join households h on h.id = hp.household_id
      where ${NOT_GUEST}`,
  );
  const total = int(what.total);
  const share = (n) => (total ? `${pct(int(n), total)}%` : null);
  const { rows: [median] } = await query(
    `select coalesce(percentile_cont(0.5) within group (order by n), 0)::float as median
       from (select count(*)::int as n from household_places hp
              join households h on h.id = hp.household_id
             where ${NOT_GUEST} group by hp.household_id) each`,
  );
  return {
    asked: bars(kinds.map((r) => row(r.category, int(r.n)))),
    became: [
      { label: 'Still on a list', value: share(total - int(what.on_trip)), pct: pct(total - int(what.on_trip), total) ?? 0 },
      { label: 'Added to a trip', value: share(what.on_trip), pct: pct(int(what.on_trip), total) ?? 0 },
      { label: 'Actually visited', value: share(what.visited), pct: pct(int(what.visited), total) ?? 0 },
    ],
    becameHighlight: 1,
    funnel: [
      row('Median places saved', median.median || 0),
      row('0 to 4 places · cancel a month', null),
      row('5 to 29 places', null),
      row('30 or more', null),
    ],
    funnelGap: GAPS.listSize,
  };
}

async function daysOutPanel(period) {
  const { rows: kinds } = await query(
    `select coalesce(nullif(v.category, ''), 'Other') as category, count(*)::int as n
       from visits v join households h on h.id = v.household_id
      where v.created_at >= $1 and v.created_at < $2 and ${NOT_GUEST}
      group by 1 order by 2 desc limit 6`,
    [period.from, period.to],
  );
  const { rows: perDay } = await query(
    `select least(n, 4) as n, count(*)::int as days
       from (select count(*)::int as n from visits v
              join households h on h.id = v.household_id
             where v.created_at >= $1 and v.created_at < $2 and ${NOT_GUEST}
             group by v.household_id, v.visited_on) each
      group by 1 order by 1`,
    [period.from, period.to],
  );
  const { rows: [rated] } = await query(
    `select count(distinct (v.household_id, v.visited_on))::int as days,
            count(distinct (v.household_id, v.visited_on)) filter (
              where exists (select 1 from ratings r where r.visit_id = v.id))::int as rated,
            count(*) filter (where r.take = 'loved')::int      as good,
            count(*) filter (where r.take = 'fine')::int       as fine,
            count(*) filter (where r.take = 'not_for_me')::int as poor
       from visits v
       join households h on h.id = v.household_id
       left join ratings r on r.visit_id = v.id
      where v.created_at >= $1 and v.created_at < $2 and ${NOT_GUEST}`,
    [period.from, period.to],
  );
  const days = perDay.reduce((n, r) => n + int(r.days), 0);
  const events = perDay.reduce((n, r) => n + int(r.n) * int(r.days), 0);
  const WORDS = ['One', 'Two', 'Three', 'Four or more'];
  return {
    asked: bars(kinds.map((r) => row(r.category, int(r.n)))),
    became: WORDS.map((w, i) => {
      const found = perDay.find((r) => int(r.n) === i + 1);
      return { label: w, value: days ? `${pct(int(found?.days), days)}%` : null, pct: pct(int(found?.days), days) ?? 0 };
    }),
    becameHighlight: 1,
    becameFoot: row('Average', days ? Math.round((events / days) * 10) / 10 : null),
    funnel: [
      row('Days out', int(rated.days)),
      row('Rated', int(rated.rated)),
      row('Left no signal', int(rated.days) - int(rated.rated)),
      row('Good · fine · poor', `${int(rated.good)} / ${int(rated.fine)} / ${int(rated.poor)}`),
    ],
  };
}

async function tripsPanel(period) {
  const { rows: where } = await query(
    `select coalesce(nullif(t.locality, ''), coalesce(nullif(t.country, ''), 'Unnamed')) as place, count(*)::int as n
       from trips t join households h on h.id = t.household_id
      where t.created_at >= $1 and t.created_at < $2 and ${NOT_GUEST}
      group by 1 order by 2 desc limit 6`,
    [period.from, period.to],
  );
  const { rows: [added] } = await query(
    `select count(*)::int as trips,
            count(*) filter (where t.base_label is not null)::int as hotel,
            count(*) filter (where exists (
              select 1 from trip_stops ts
                join household_places hp on hp.venue_ref = ts.venue_ref and hp.household_id = t.household_id
               where ts.trip_id = t.id and hp.kind = 'food'))::int      as restaurant,
            count(*) filter (where exists (
              select 1 from trip_stops ts
                join household_places hp on hp.venue_ref = ts.venue_ref and hp.household_id = t.household_id
               where ts.trip_id = t.id and hp.kind = 'activity'))::int  as activity,
            coalesce(round(avg(nullif(t.end_date - t.start_date, 0)), 1), 0)::float as nights
       from trips t join households h on h.id = t.household_id
      where t.created_at >= $1 and t.created_at < $2 and ${NOT_GUEST}`,
    [period.from, period.to],
  );
  const trips = int(added.trips);
  const share = (n) => (trips ? `${pct(int(n), trips)}%` : null);
  return {
    asked: bars(where.map((r) => row(r.place, int(r.n)))),
    became: [
      { label: 'A hotel or base', value: share(added.hotel), pct: pct(int(added.hotel), trips) ?? 0 },
      { label: 'A restaurant', value: share(added.restaurant), pct: pct(int(added.restaurant), trips) ?? 0 },
      { label: 'A paid activity', value: share(added.activity), pct: pct(int(added.activity), trips) ?? 0 },
    ],
    becameHighlight: 0,
    funnel: [row('Trips', trips), row('Average', added.nights ? `${added.nights} nights` : null)],
  };
}

async function eventsPanels(period) {
  const { rows: [attended] } = await query(
    `select count(*)::int as bookings,
            coalesce(sum(b.heads), 0)::int as heads,
            count(*) filter (where b.refunded_at is not null)::int as refunded
       from experience_bookings b
      where b.created_at >= $1 and b.created_at < $2 and b.cancelled_at is null`,
    [period.from, period.to],
  );
  const { rows: shapes } = await query(
    `select o.shape, count(*)::int as n from host_offers o
      where o.state = 'live' group by 1 order by 2 desc`,
  );
  // What kind of thing it is, which is a different question from what shape it
  // takes. `category_key` is the taxonomy's word and `category` the host's own.
  const { rows: categories } = await query(
    `select coalesce(nullif(o.category_key, ''), nullif(o.category, ''), 'Not filed') as category,
            count(*)::int as n
       from host_offers o
      where o.state = 'live'
      group by 1 order by 2 desc limit 6`,
  );
  const { rows: [hosts] } = await query(
    `select count(*)::int as hosts,
            count(*) filter (where h.checks <> 'running')::int as approved,
            count(*) filter (where exists (select 1 from host_offers o where o.host_id = h.id and o.state = 'live'))::int as selling,
            count(*) filter (where exists (select 1 from host_offers o where o.host_id = h.id and o.state = 'draft'))::int as started,
            count(*) filter (where exists (select 1 from host_offers o where o.host_id = h.id and o.published_at is not null))::int as published
       from hosts h`,
  );
  const { rows: [scheduled] } = await query(
    `select count(*)::int as n from host_offers o
      where o.state = 'live'
        and coalesce(o.first_date, o.starts_on) between current_date and current_date + 60`,
  );
  return {
    attended: int(attended.bookings),
    heads: int(attended.heads),
    refunded: int(attended.refunded),
    shapes: bars(shapes.map((r) => row(SHAPE_WORDS[r.shape] ?? r.shape, int(r.n)))),
    categories: categories.length ? bars(categories.map((r) => row(r.category, int(r.n)))) : null,
    hosts: {
      total: int(hosts.hosts), approved: int(hosts.approved), selling: int(hosts.selling),
      started: int(hosts.started), published: int(hosts.published),
    },
    scheduled60: int(scheduled.n),
  };
}

// ---------------------------------------------------------------------------
// suppliers — the register, joined to the ledger
// ---------------------------------------------------------------------------

/**
 * The twelve, with what each actually cost.
 *
 * The register says who they are and what the rate is; `provider_calls` says
 * what was spent. They are joined on `provider_key` rather than merged, because
 * a register that carried its own spend figure would be a second version of the
 * ledger and the two would drift.
 *
 * **"Infrastructure" is a cost category, not a supplier** (handoff §5): Fly.io,
 * Neon and Cloudflare R2 each get their own row, their own purpose and their own
 * credential. None of them is on the ledger — they arrive as invoices — so their
 * spend is `null` with a reason rather than nought, which would read as free.
 */
function suppliersFrom(register, costNow, costPrev, supHist, total) {
  const rows = register.map((c) => {
    const now = c.providerKey ? costNow.byProvider.find((p) => p.provider === c.providerKey) : null;
    const before = c.providerKey ? costPrev.byProvider.find((p) => p.provider === c.providerKey) : null;
    const metered = !!c.providerKey;
    const spend = metered ? Math.round((now?.usd ?? 0) * 100) / 100 : null;
    return {
      key: c.key,
      name: c.name,
      direction: c.direction === 'outbound_revenue' ? 'revenue' : 'cost',
      unitName: c.unitName ?? '—',
      unitCost: c.rate?.says ?? null,
      volume: metered ? (now?.calls ?? 0) : null,
      spend,
      expected: metered ? Math.round((before?.usd ?? 0) * 100) / 100 : null,
      // Share of the whole bill, worked out from the two visible columns so the
      // foot adds to a hundred rather than to whatever was typed in.
      share: metered && total ? Math.round(((now?.usd ?? 0) / total) * 1000) / 10 : null,
      series: metered ? supHist.of(c.providerKey) : null,
      status: c.status,
      adapterState: c.adapterState,
      costClass: c.costClass,
      gap: metered ? null : GAPS.invoiced,
    };
  });
  return rows;
}

/**
 * Provider spend, grouped by the counterparty it belongs to.
 *
 * A ledger row whose `provider` matches no counterparty is not a supplier — it
 * is a composite of several, written by a search that asked them all at once.
 * Those are summed into one row named for what they are, so the panel does not
 * invent a supplier called `fixtures+osm+google+ticketmaster`.
 */
function costByCounterparty(register, byProvider) {
  const named = new Map();
  let other = 0;
  for (const p of byProvider) {
    const c = register.find((x) => x.providerKey && x.providerKey === p.provider);
    if (c) named.set(c.name, (named.get(c.name) ?? 0) + p.usd);
    else other += p.usd;
  }
  const rows = [...named.entries()]
    .map(([label, usd]) => row(label, Math.round(usd * 100) / 100))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  if (other > 0) rows.push(row('Several sources at once', Math.round(other * 100) / 100));
  return rows;
}

/**
 * One supplier's record: what it is for, whether it is connected, and its
 * health and spend over the window.
 *
 * Calls and spend are measured. Failures and response time are not — nothing
 * records whether a provider call came back or how long it took — so they are
 * named gaps rather than zeros, which on a health panel would be the most
 * dangerous zero in the whole suite.
 */
export async function readSupplierRecord(key, period) {
  const [register, history] = await Promise.all([listCounterparties(), rateHistory(key)]);
  const c = register.find((x) => x.key === key);
  if (!c) return null;

  const metered = !!c.providerKey;
  let now = { calls: 0, usd: 0 };
  let before = { calls: 0, usd: 0 };
  let series = null;

  if (metered) {
    const [a, b, hist] = await Promise.all([
      cost(period.from, period.to),
      cost(period.prevFrom, period.prevTo),
      supplierHistory(new Date()),
    ]);
    now = a.byProvider.find((p) => p.provider === c.providerKey) ?? now;
    before = b.byProvider.find((p) => p.provider === c.providerKey) ?? before;
    series = hist.of(c.providerKey);
  }

  const spend = metered ? Math.round(now.usd * 100) / 100 : null;
  const expected = metered ? Math.round(before.usd * 100) / 100 : null;

  return {
    supplier: {
      key: c.key,
      name: c.name,
      direction: c.direction,
      purpose: c.purpose,
      usedBy: c.usedBy,
      costClass: c.costClass,
      unitName: c.unitName,
      status: c.status,
      adapterState: c.adapterState,
      credentialMasked: c.credentialMasked,
      credentialExpiry: c.credentialExpiry,
      rotatedAt: c.rotatedAt,
      allowanceNote: c.allowanceNote,
      rate: c.rate,
      history,
    },
    health: {
      calls: metered ? int(now.calls) : null,
      // Nothing records whether a provider call came back, or how long it took.
      // A zero here would be the most dangerous zero in the suite — it would
      // read as "nothing has ever failed" on a health panel.
      failures: null,
      failurePct: null,
      latency: null,
      healthGap: GAPS.providerHealth,
      spend,
      expected,
      /**
       * Derived from the two rows above it, so the panel reconciles on its face
       * — and **absent where there is no window to compare with**.
       *
       * The ledger began in September, so the window before this one is empty
       * for every supplier, and "$103.66 (—)" is the whole of this period's
       * spend presented as a change. The handoff's rule for a change figure is
       * that it prints only where a full prior window exists and sums above
       * zero; the same holds for a variance, and the table on Suppliers now
       * says the same thing (20 Sep 2026, on the live estate).
       */
      variance: spend == null || !expected ? null : Math.round((spend - expected) * 100) / 100,
      variancePct: spend == null || !expected ? null : Math.round(((spend - expected) / expected) * 1000) / 10,
      /** Why there is no comparison, where the figure itself is real. */
      varianceGap: spend != null && !expected ? 'No window before this one to compare with' : null,
      currency: metered ? 'usd' : 'gbp',
      gap: metered ? null : GAPS.invoiced,
    },
    series,
  };
}

// ---------------------------------------------------------------------------
// subscriptions — what we sell and at what price
// ---------------------------------------------------------------------------

/**
 * The tiers, their prices, where they were bought and what they publish.
 *
 * Every price here is a row with a date on it (`plan_prices`), so the screen
 * can edit it without rewriting what anybody has already been charged. The
 * annual figures are derived on the way out rather than stored.
 */
async function subscriptions() {
  const [tiers, benefits, channels] = await Promise.all([readTiers(), readBenefits(), readChannels()]);
  const paying = tiers.reduce((n, t) => n + t.subscribers, 0);
  const mrrPence = tiers.reduce((n, t) => n + t.subscribers * (t.webPence ?? 0), 0);

  return {
    tiers,
    benefits,
    channels,
    publishedAt: benefits.reduce((latest, b) => (b.publishedAt && (!latest || b.publishedAt > latest) ? b.publishedAt : latest), null),
    unpublished: benefits.filter((b) => !b.publishedAt).length,
    standing: {
      mrrPence,
      mrrDelta: null,
      averagePaidPence: paying ? Math.round(mrrPence / paying) : null,
      averagePaidDelta: null,
      onAnnual: null,
      onAnnualOf: paying,
      // Nothing records an annual subscription: `plan_prices` has the discount
      // and `accounts` has no interval, so who is on annual is not knowable.
      onAnnualGap: 'No subscription interval is recorded',
    },
  };
}

// ---------------------------------------------------------------------------
// the whole thing
// ---------------------------------------------------------------------------

/**
 * The estate model, read for real.
 *
 * Returned in the fixtures' shape, so the screens do not branch. Where a figure
 * cannot be known it is `null` and its family is named in `gaps`; where it can,
 * it is measured.
 */
export async function readSuite(period, { now = new Date() } = {}) {
  const [est, subNow, subPrev, mrrRows, bookNow, bookPrev, costNow, costPrev, hist, supHist, register, subs] = await Promise.all([
    estate(period),
    subscriptionRevenue(period.from, period.to),
    subscriptionRevenue(period.prevFrom, period.prevTo),
    mrr(),
    bookings(period.from, period.to),
    bookings(period.prevFrom, period.prevTo),
    cost(period.from, period.to),
    cost(period.prevFrom, period.prevTo),
    history(now),
    supplierHistory(now),
    listCounterparties(),
    subscriptions(),
  ]);

  const base = await activeBase(period);
  const [shares, surfaces, visitRows, back, rates, list] = await Promise.all([
    engagementShares(period, base),
    bySurface(period),
    visits(period),
    returnBuckets(),
    behaviourRates(period, base),
    households(period),
  ]);

  const [searchPanel, savePanel, outPanel, tripPanel, eventPanel] = await Promise.all([
    searchOutcomes(period),
    savedPlaceOutcomes(period),
    daysOutPanel(period),
    tripsPanel(period),
    eventsPanels(period),
  ]);

  /**
   * The book of subscriptions, and it has to balance.
   *
   * `paying` counts accounts on a **priced** plan, so the new and the lost must
   * count the same thing or the book reads "live at the start: −6" — which is
   * what it did when `added` counted every new account, most of which are
   * trials (20 Sep 2026, opening the screen).
   *
   * `signups` therefore counts arrivals onto a priced plan, and `joined` counts
   * every new household beside it, because "six households joined" is a real
   * figure and simply not the same one.
   */
  const { rows: [signups] } = await query(
    `select count(*) filter (where a.created_at >= $1 and a.created_at < $2 and p.price_pence is not null)::int as added,
            count(*) filter (where a.created_at >= $3 and a.created_at < $4 and p.price_pence is not null)::int as before,
            count(*) filter (where a.status = 'suspended' and p.price_pence is not null
                               and a.updated_at >= $1 and a.updated_at < $2)::int as lost,
            count(*) filter (where a.created_at >= $1 and a.created_at < $2)::int as joined,
            count(*) filter (where a.created_at >= $3 and a.created_at < $4)::int as joined_before
       from accounts a
       join households h on h.id = a.household_id
       left join plans p on p.key = a.plan
      where ${NOT_GUEST}`,
    [period.from, period.to, period.prevFrom, period.prevTo],
  );

  const supplierRows = suppliersFrom(register, costNow, costPrev, supHist, costNow.total);
  const mrrPence = mrrRows.reduce((n, p) => n + p.pence, 0);
  const revenue = subNow.pence / 100;
  const cost$ = costNow.total;
  const research = costNow.byClass.find((c) => c.class === 'research')?.usd ?? 0;
  const serve = costNow.byClass.find((c) => c.class === 'serve')?.usd ?? 0;
  const library = costNow.byClass.find((c) => c.class === 'library')?.usd ?? 0;
  const office = costNow.byClass.find((c) => c.class === 'office')?.usd ?? 0;

  // Only subscriptions has revenue, and cost is not classified by stream, so
  // margin exists for the estate and not for a stream. Stated rather than
  // apportioned — an invented allocation is worse than a labelled gap.
  const streams = [
    {
      key: 'subscriptions', label: 'Subscriptions', revenue, cost: null, margin: null, marginPct: null,
      growth: change(subNow.pence, subPrev.pence), perSub: est.paying ? Math.round((mrrPence / 100 / est.paying) * 100) / 100 : null,
      units: est.paying, unitName: 'subscriptions',
      avgUnit: est.paying ? `£${(mrrPence / 100 / est.paying).toFixed(2)}` : null,
      churn: null, series: hist.series.subscriptions, estimated: subNow.estimated,
    },
    { key: 'hotel', label: 'Hotel upsell', revenue: null, cost: null, margin: null, marginPct: null, growth: null, perSub: null, units: null, unitName: 'bookings', avgUnit: null, churn: null, series: null, gap: GAPS.hotel },
    {
      key: 'hosting', label: 'Hosting commission', revenue: null, cost: null, margin: null, marginPct: null,
      growth: null, perSub: null, units: bookNow.count, unitName: 'bookings',
      avgUnit: bookNow.count ? `£${(bookNow.grossPence / 100 / bookNow.count).toFixed(2)}` : null,
      churn: null, series: hist.series.attended, gap: GAPS.commission,
    },
    { key: 'activity', label: 'Activity upsell', revenue: null, cost: null, margin: null, marginPct: null, growth: null, perSub: null, units: null, unitName: 'bookings', avgUnit: null, churn: null, series: null, gap: GAPS.activity },
  ];

  return {
    mock: false,
    basis: 'contracted',
    period,
    gaps: GAPS,
    estate: est,

    overview: {
      measures: [
        {
          key: 'signups', label: 'New subscribers', kind: 'flow', unit: 'count',
          value: int(signups.added), delta: change(int(signups.added), int(signups.before)),
          // What it counts, said on the tile: an arrival onto a priced plan.
          // `joined` is beside it because six households joining and none of
          // them subscribing is the fact somebody needs, not a contradiction.
          sub: int(signups.joined) === int(signups.added)
            ? 'onto a priced plan'
            : `onto a priced plan · ${plural(int(signups.joined), 'household')} joined`,
          expected: int(signups.before) || null,
          series: hist.series.signups,
        },
        {
          key: 'revenue', label: 'Revenue', kind: 'flow', unit: 'money',
          value: revenue, delta: change(subNow.pence, subPrev.pence),
          sub: `contracted · MRR £${(mrrPence / 100).toLocaleString()} a month of it`,
          series: hist.series.revenue,
        },
        {
          key: 'engagement', label: 'Engagement', kind: 'stock', unit: 'count',
          value: est.active, delta: null, sub: 'households active in the period',
          series: hist.series.engagement,
        },
        {
          key: 'events', label: 'Events & hosts', kind: 'fixed', unit: 'count',
          value: eventPanel.scheduled60, delta: null,
          sub: `scheduled next 60 days · ${plural(eventPanel.hosts.selling, 'host')} selling`,
          series: hist.series.events,
        },
      ],
      subscriptions: {
        // opening + new − lost = live, always, because all four count the same
        // thing: an account on a priced plan.
        opening: est.paying - int(signups.added) + int(signups.lost),
        added: int(signups.added),
        lost: int(signups.lost),
        live: est.paying,
        joined: int(signups.joined),
        churnPct: null,
        wasChurnPct: null,
        churnGap: GAPS.churn,
        // Real, and this is what migration 199 was for: how a household arrived
        // is written down, so the arrivals panel is measured rather than guessed.
        arrivals: bars([
          row('Signed up direct', est.origins.find((o) => o.label === 'Signed up')?.value ?? 0),
          row('From a host’s page', est.origins.find((o) => o.label === 'From a host’s page')?.value ?? 0),
          row('Invited to a trip', est.origins.find((o) => o.label === 'Invited as a guest')?.value ?? 0),
          row('In somebody’s household', est.origins.find((o) => o.label === 'In somebody’s household')?.value ?? 0),
        ]),
        arrivalsNote: null,
        sources: null,
        sourcesGap: GAPS.attribution,
      },
      revenue: {
        byStream: bars([
          row('Subscriptions', revenue),
          row('Hotels', null), row('Hosted events', null), row('Paid activities', null),
        ]),
        byStreamGap: GAPS.bookings,
        mrrByPlan: mrrRows.map((p) => row(p.label, p.pence / 100)),
        mrr: mrrPence / 100,
        forecast: null,
        forecastGap: GAPS.forecast,
      },
      engagement: {
        shares,
        shareDeltas: null,
        visits: visitRows.visits,
        newVisits: visitRows.newHouseholds,
        returningVisits: Math.max(0, visitRows.households - visitRows.newHouseholds),
        timeOnSiteSeconds: visitRows.secondsPerVisit,
        timeOnSiteDelta: null,
        activeWeeksPerQuarter: null,
        bySurface: surfaces,
      },
      events: {
        ran: eventPanel.attended,
        scheduled60: eventPanel.scheduled60,
        guests: eventPanel.heads,
        averageParty: eventPanel.attended ? Math.round((eventPanel.heads / eventPanel.attended) * 10) / 10 : null,
        fillPct: null,
        hosts: bars([
          row('Registered', eventPanel.hosts.total),
          row('Approved', eventPanel.hosts.approved),
          row('Selling', eventPanel.hosts.selling),
          row('Started an offer', eventPanel.hosts.started),
        ]),
        selling: null,
        sellingGap: GAPS.commission,
        averageTicket: bookNow.count ? Math.round(bookNow.grossPence / bookNow.count) / 100 : null,
        ratedGoodPct: null,
      },
      standing: {
        directBookings: bookNow.count,
        timeOnSiteSeconds: visitRows.secondsPerVisit,
        timeOnSiteDelta: null,
        satisfactionPct: null,
        satisfactionGap: GAPS.satisfaction,
      },
    },

    money: {
      subscribers: est.paying,
      streams,
      total: {
        revenue, cost: cost$, margin: null, marginPct: null, marginDelta: null,
        perSub: est.paying ? Math.round((revenue / est.paying) * 100) / 100 : null,
        perSubOut: null, perSubKept: null,
        growth: change(subNow.pence, subPrev.pence),
      },
      totalGap: GAPS.costByStream,
      breakdown: {
        subscriptions: {
          mrrMoved: null,
          mrrMovedGap: GAPS.churn,
          forecast: null,
          forecastGap: GAPS.runway,
          /**
           * What it costs, by counterparty rather than by the string the
           * ledger happened to record.
           *
           * `provider_calls.provider` sometimes holds a composite — a search
           * that asked several sources at once logs `fixtures+osm+google` —
           * which is not a supplier and does not belong on a money panel under
           * its own name (epic-59's visual pass, 20 Sep 2026). Anything the
           * register knows keeps its name; everything else is folded into one
           * honest row.
           */
          costs: bars(costByCounterparty(register, costNow.byProvider)),
        },
        hotel: { gap: GAPS.hotel },
        hosting: {
          bookings: [
            row('Bookings recorded', bookNow.count),
            row('Gross recorded', bookNow.grossPence / 100),
            row('Refunded', -(bookNow.refundedPence / 100)),
            row('Commission kept', null),
          ],
          bookingsGap: GAPS.commission,
          gap: null,
        },
        activity: { gap: GAPS.activity },
      },
      /**
       * Gross bookings, and why it is a gap rather than a nought.
       *
       * The figure is labelled *gross bookings* — every stream. Hotels and
       * activities have no provider at all, so there is nothing to count
       * there, and hosted bookings are *recorded* rather than paid. £0 would
       * read as "nobody booked anything", which is a measurement Epic has not
       * made (handoff rule 7). Once bookings do start arriving the figure
       * appears, with a sub-line naming which streams are still missing.
       */
      grossBookings: bookNow.count ? bookNow.grossPence / 100 : null,
      grossBookingsDelta: bookNow.count ? change(bookNow.grossPence, bookPrev.grossPence) : null,
      grossBookingsNote: bookNow.count ? 'hosted events only — no hotel or activity provider' : null,
      refunds: bookNow.count ? bookNow.refundedPence / 100 : null,
      costToServe: {
        total: cost$,
        allocated: serve,
        byKind: bars(costNow.byProvider.map((p) => row(p.provider, Math.round(p.usd * 100) / 100))),
        byClass: [
          row('Library', Math.round(library * 100) / 100),
          row('Serving households', Math.round(serve * 100) / 100),
          row('Back office', Math.round(office * 100) / 100),
          row('Research', Math.round(research * 100) / 100),
        ],
        byPurpose: costNow.byPurpose.map((p) => ({ label: p.purpose, value: Math.round(p.usd * 100) / 100, cls: p.class, calls: p.calls })),
        research: Math.round(research * 100) / 100,
        delta: change(cost$, costPrev.total),
        // Said on the screen, not just here: the class is worked out when the
        // ledger is read, because `provider_calls.class` is not a column yet.
        classDerived: true,
      },
      perSubscriber: null,
      perSubscriberGap: GAPS.bookings,
      unitEconomics: null,
      unitEconomicsGap: GAPS.churn,
    },

    customers: {
      households: list,
      shown: list.length,
      total: est.households,
      paying: est.paying,
      payingMrr: mrrPence / 100,
      trial: est.trial,
      trialConvertPct: null,
      trialGranted: null,
      atRisk: est.atRisk,
    },

    subscriptions: subs,

    suppliers: {
      rows: supplierRows,
      total: Math.round(cost$ * 100) / 100,
      expected: Math.round(costPrev.total * 100) / 100,
      // A forecast of next month's bill needs a trend nobody has enough of yet:
      // the ledger began in September. Named rather than extrapolated from one
      // month, which would be a run rate through a single point.
      expectedNextMonth: null,
      expectedNextMonthDeltaPct: null,
      expectedNextMonthGap: 'Needs more than one month of ledger',
      largest: [...supplierRows].filter((r) => r.spend != null).sort((a, b) => b.spend - a.spend)[0] ?? null,
      currency: 'usd',
    },

    behaviour: {
      base,
      /**
       * The six measures, with a change read off their own twelve-month series.
       *
       * The latest month against the one three back, which is the same span the
       * short run rate uses and long enough that one quiet week does not read as
       * a collapse. `change()` returns nothing where there is no prior figure
       * above zero, so a measure that only started this month shows the value
       * and no change rather than "+∞".
       */
      measures: [
        { key: 'searches', label: 'Searches', value: rates.searches, delta: quarterOn(hist.series.searches), series: hist.series.searches },
        { key: 'saves', label: 'Places saved', value: rates.saves, delta: quarterOn(hist.series.saves), series: hist.series.saves },
        { key: 'out', label: 'Days out', value: rates.out, delta: quarterOn(hist.series.out), series: hist.series.out },
        { key: 'trips', label: 'Trips away', value: rates.trips, delta: quarterOn(hist.series.trips), series: hist.series.trips },
        { key: 'attended', label: 'Events attended', value: rates.attended, delta: quarterOn(hist.series.attended), series: hist.series.attended },
        { key: 'hosted', label: 'Events hosted', value: rates.hosted, delta: quarterOn(hist.series.hosted), series: hist.series.hosted },
      ],
      panels: {
        searches: searchPanel,
        saves: savePanel,
        out: outPanel,
        trips: tripPanel,
        /**
         * Two different questions, and they were being answered with the same
         * bars: `asked` is **what they went to** — the category an offer is
         * filed under — and `became` is **what shape it was** — one-off, a
         * series, anytime on request. Handing both `eventPanel.shapes` drew the
         * same chart twice (20 Sep 2026, the separate audit).
         */
        attended: {
          asked: eventPanel.categories,
          askedGap: 'No offer has a category yet',
          became: eventPanel.shapes,
          becameHighlight: 0,
          funnel: [
            row('Bookings', eventPanel.attended),
            row('Guests', eventPanel.heads),
            row('Refunded', eventPanel.refunded),
            row('Rated good', null),
          ],
          funnelGap: GAPS.satisfaction,
        },
        hosted: {
          // What they run is the shape of the offers they publish, which for
          // hosting is the honest answer to "what they run".
          asked: eventPanel.shapes,
          became: [
            row('Hosts registered', eventPanel.hosts.total),
            row('Approved', eventPanel.hosts.approved),
            row('Selling', eventPanel.hosts.selling),
          ],
          becameHighlight: -1,
          funnel: [
            row('Started an offer', eventPanel.hosts.started),
            row('Published an offer', eventPanel.hosts.published),
            row('Dropped out', Math.max(0, eventPanel.hosts.started - eventPanel.hosts.published)),
            row('Approved hosts selling', `${eventPanel.hosts.selling} of ${eventPanel.hosts.approved}`),
          ],
        },
      },
      returnBuckets: back.buckets,
      returnBase: back.base,
      returnHighlight: -1,
    },

    history: hist,
  };
}

/**
 * One household's record.
 *
 * Two rules from the handoff shape it. Lifetime and ninety-day figures are
 * labelled and never mixed inside one panel; and a booking split sums to its
 * own total, which it does here because both come from the same rows.
 */
export async function readHousehold(id, period, { now = new Date() } = {}) {
  const { rows } = await query(
    `select h.id, h.name, h.origin, h.home_label, h.created_at,
            a.id as account_id, a.email, a.plan, a.status, a.trial_ends_on, a.created_at as joined,
            p.label as plan_label, p.price_pence
       from households h
       left join accounts a on a.household_id = h.id and a.member_id is null
       left join plans p on p.key = a.plan
      where h.id = $1
      limit 1`,
    [id],
  );
  if (!rows.length) return null;
  const h = rows[0];

  const [{ rows: [life] }, { rows: [ninety] }, { rows: plans }, { rows: months }] = await Promise.all([
    query(
      `select (select count(*)::int from household_places hp where hp.household_id = $1)                 as places,
              (select count(*)::int from household_places hp where hp.household_id = $1
                and exists (select 1 from visits v where v.household_id = $1 and v.venue_ref = hp.venue_ref)) as visited,
              (select count(distinct v.visited_on)::int from visits v where v.household_id = $1)         as days_out,
              (select count(*)::int from trips t where t.household_id = $1)                              as trips,
              (select count(*)::int from trips t where t.household_id = $1 and t.end_date > t.start_date) as away,
              (select count(*)::int from trips t where t.household_id = $1 and t.base_label is not null) as bases,
              (select count(*)::int from ratings r join visits v on v.id = r.visit_id
                where v.household_id = $1)                                                               as ratings,
              (select count(*)::int from ratings r join visits v on v.id = r.visit_id
                where v.household_id = $1 and r.take = 'loved')                                          as rated_good,
              (select count(*)::int from experience_bookings b where b.household_id = $1 and b.cancelled_at is null) as bookings,
              (select coalesce(sum(b.amount_pence), 0)::int from experience_bookings b
                where b.household_id = $1 and b.cancelled_at is null)                                    as booked_pence,
              (select coalesce(sum(c.estimated_cost_usd), 0)::float from provider_calls c
                where c.household_id = $1)                                                               as cost_ever_usd,
              (select count(*)::int from searches s where s.household_id = $1)                           as searches`,
      [id],
    ),
    query(
      `select (select count(*)::int from searches s where s.household_id = $1 and s.at >= now() - interval '90 days') as searches,
              (select count(*)::int from search_events e join searches s on s.id = e.search_id
                where s.household_id = $1 and e.kind = 'open' and e.at >= now() - interval '90 days')    as opened,
              (select count(*)::int from searches s where s.household_id = $1
                and s.outcome = 'saved' and s.at >= now() - interval '90 days')                          as saved,
              (select count(*)::int from household_places hp where hp.household_id = $1
                and hp.first_seen >= now() - interval '90 days')                                         as places,
              (select coalesce(sum(c.estimated_cost_usd), 0)::float from provider_calls c
                where c.household_id = $1 and c.created_at >= now() - interval '90 days')                as cost_usd`,
      [id],
    ),
    query(
      // Insert-only: a row is closed by the next one's `from_at`, and carries
      // the price it was sold on rather than the plan's price today. That is
      // what makes a household that upgraded pay the old price for its earlier
      // months, which is the record's own consistency requirement.
      `select ph.plan, ph.status, ph.from_at,
              lead(ph.from_at) over (order by ph.from_at) as to_at,
              coalesce(ph.price_pence, p.price_pence) as price_pence,
              p.label
         from account_plan_history ph
         left join plans p on p.key = ph.plan
        where ph.account_id = $1 order by ph.from_at`,
      [h.account_id],
    ),
    query(
      `select to_char(date_trunc('month', s.at), 'YYYY-MM') as month, count(*)::int as n
         from searches s where s.household_id = $1 and s.at >= $2 group by 1`,
      [id, monthBuckets(now)[0].from],
    ),
  ]);

  const buckets = monthBuckets(now);
  const bySearchMonth = new Map(months.map((m) => [m.month, int(m.n)]));
  const lifeMonths = Math.max(1, Math.round((now - new Date(h.joined ?? h.created_at)) / (30.4 * 86400000)));

  // Lifetime subscription: the plan history where there is one, and months ×
  // today's price where there is not — marked `estimated` so the screen can say
  // so rather than imply a precision the table cannot support.
  const subscriptionPence = plans.length
    ? plans.reduce((n, p) => {
      const from = new Date(p.from_at);
      const to = p.to_at ? new Date(p.to_at) : now;
      const held = Math.max(0, Math.round((to - from) / (30.4 * 86400000)));
      return n + held * int(p.price_pence);
    }, 0)
    : lifeMonths * int(h.price_pence);

  const bookedPence = int(life.booked_pence);
  /**
   * What serving them cost, in the currency it was recorded in.
   *
   * It used to be `cost_ever_usd * 100` treated as pence and subtracted from
   * pound revenue — a margin computed at an implicit 1:1 exchange rate, which
   * is a fabricated figure (Codex, 20 Sep 2026). `provider_calls` records
   * dollars. So the cost stays dollars, the revenue stays pounds, and **there
   * is no margin figure** until somebody decides what rate to convert at. The
   * screen names the gap rather than drawing a number nobody can stand behind.
   */
  const costUsd = life.cost_ever_usd;

  return {
    id: h.id,
    name: h.name,
    area: h.home_label,
    origin: h.origin,
    plan: h.plan_label ?? h.plan,
    monthPence: int(h.price_pence),
    status: h.status,
    joined: h.joined ? new Date(h.joined).toISOString().slice(0, 10) : null,
    lifeMonths,
    plans: { rows: plans.map((p) => ({ plan: p.label ?? p.plan, from: p.from_at, to: p.to_at, pence: int(p.price_pence) })), estimated: plans.length === 0 },
    spend: {
      subscriptionPence,
      subscriptionEstimated: plans.length === 0,
      bookedPence,
      everPence: subscriptionPence + bookedPence,
      yearPence: null,
      previousYearPence: null,
      earnedPence: subscriptionPence,
      costUsd,
      costPence: null,
      marginPence: null,
      marginGap: 'Revenue is in pounds and provider cost in dollars — no exchange rate is set',
      keptFromBookingsPence: null,
    },
    spendGap: GAPS.commission,
    bookings: { total: int(life.bookings), hotels: null, activities: null, events: int(life.bookings), keptPence: null },
    bookingsGap: GAPS.bookings,
    charts: {
      spend: null,
      spendGap: GAPS.bookings,
      searches: buckets.map((b) => bySearchMonth.get(b.key) ?? 0),
      labels: buckets.map((b) => b.label),
    },
    inspire: {
      searches90: int(ninety.searches),
      opened: int(ninety.opened),
      savedFrom: int(ninety.saved),
      topCategory: null,
      searchToSavePct: int(ninety.searches) ? pct(int(ninety.saved), int(ninety.searches)) : null,
    },
    placesPanel: {
      saved: int(life.places),
      addedToTrip: null,
      visited: int(life.visited),
      addedInPeriod: int(ninety.places),
      cancelRisk: null,
      cancelRiskGap: GAPS.listSize,
    },
    tripsPanel: {
      daysSignedOff: int(life.trips),
      daysOut: int(life.days_out),
      away: int(life.away),
      hotels: int(life.bases),
      flights: null,
    },
    eventsPanel: {
      attended: int(life.bookings),
      hosted: 0,
      ratings: int(life.ratings),
      ratedGood: int(life.ratings) ? int(life.rated_good) : null,
      shape: null,
    },
    cost: { everUsd: life.cost_ever_usd, ninetyUsd: ninety.cost_usd },
  };
}
