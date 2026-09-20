/**
 * What Epic sells, at what price, and what it says you get.
 *
 * The Subscriptions screen is an **editing screen, not a report** (handoff §3),
 * so this is a read-and-write repository rather than a reader. Two disciplines
 * make it safe to edit:
 *
 *  · **A price is inserted, never updated.** Changing a price closes the row in
 *    force and writes a new one, so a subscription keeps the row it was sold on
 *    and last quarter's revenue cannot be rewritten by today's decision. It is
 *    the handoff's eighth non-negotiable and the reason `plan_prices` exists at
 *    all beside `plans.price_pence`.
 *  · **Annual is derived, never stored.** `round(monthly × 12 × (1 −
 *    discount/100))`, per channel. Two stored numbers can disagree; one number
 *    and a rule cannot.
 *
 * `plans.price_pence` is kept in step with the web price on every write,
 * because six older screens read it — it is the current-price cache, and the
 * history is here.
 */

import { query, withTransaction } from '../db.js';

/** The three tiers the screen is about, in the order it draws them. */
export const TIERS = ['solo', 'household', 'pro'];
export const CHANNELS = ['web', 'ios', 'android'];

const int = (v) => (v == null ? 0 : Number(v));

/** `round(monthly × 12 × (1 − discount/100))`, in pence. */
export const annualPence = (monthlyPence, discountPct) =>
  Math.round(monthlyPence * 12 * (1 - Number(discountPct || 0) / 100));

/**
 * The tiers, their current price in each channel, and how many are on them.
 *
 * Subscribers are counted from `accounts`, so a tier nobody is on reads as
 * "none yet" rather than as a price with an invisible denominator.
 */
export async function readTiers() {
  const { rows: plans } = await query(
    `select p.key, p.label, p.note, p.price_pence, p.active, p.position,
            (select count(*)::int from accounts a
               join households h on h.id = a.household_id
              where a.plan = p.key and a.status <> 'suspended' and h.origin <> 'guest_invite') as subscribers
       from plans p
      where p.key = any($1::text[])
      order by p.position, p.key`,
    [TIERS],
  );

  const { rows: prices } = await query(
    `select plan_key, channel, amount_pence, annual_discount_pct, effective_from, created_by, note
       from plan_prices
      where effective_to is null
      order by plan_key, channel`,
  );

  // Every price this tier has ever been sold at, newest first — what makes the
  // panel able to say "changing a price writes a new row" and mean it.
  const { rows: history } = await query(
    `select plan_key, channel, amount_pence, annual_discount_pct, effective_from, effective_to, created_by, note
       from plan_prices
      order by plan_key, channel, effective_from desc`,
  );

  return plans.map((p) => {
    const of = (channel) => prices.find((r) => r.plan_key === p.key && r.channel === channel) ?? null;
    const web = of('web');
    const ios = of('ios');
    const discount = Number(web?.annual_discount_pct ?? 0);
    return {
      key: p.key,
      label: p.label,
      note: p.note,
      active: p.active,
      subscribers: int(p.subscribers),
      webPence: web ? int(web.amount_pence) : null,
      iosPence: ios ? int(ios.amount_pence) : null,
      androidPence: null,
      discountPct: discount,
      annualWebPence: web ? annualPence(int(web.amount_pence), discount) : null,
      annualIosPence: ios ? annualPence(int(ios.amount_pence), Number(ios.annual_discount_pct ?? discount)) : null,
      /**
       * What the App Store price is above the website one, per cent.
       *
       * Shown because it is the one number that says whether the uplift covers
       * Apple's 15% cut or merely gestures at it.
       */
      iosUpliftPct: web && ios && int(web.amount_pence)
        ? Math.round((int(ios.amount_pence) / int(web.amount_pence) - 1) * 100)
        : null,
      /** Subscribers × the website monthly price — a what-if, and labelled as one. */
      revenueAtThisPricePence: web ? int(p.subscribers) * int(web.amount_pence) : null,
      priceSetAt: web?.effective_from ?? null,
      history: history
        .filter((r) => r.plan_key === p.key)
        .map((r) => ({
          channel: r.channel,
          pence: int(r.amount_pence),
          discountPct: Number(r.annual_discount_pct ?? 0),
          from: r.effective_from,
          to: r.effective_to,
          by: r.created_by,
          note: r.note,
        })),
    };
  });
}

/**
 * Set a tier's price in one channel.
 *
 * Closes whatever is in force and inserts the new row in one transaction, so
 * there is never a moment with two current prices or none. Returns the row it
 * wrote, so the screen can say when it happened rather than guess.
 */
export async function setPrice({ planKey, channel, amountPence, discountPct, by, note }) {
  if (!TIERS.includes(planKey)) throw Object.assign(new Error('Not a tier.'), { status: 400, code: 'bad_plan' });
  if (!CHANNELS.includes(channel)) throw Object.assign(new Error('Not a channel.'), { status: 400, code: 'bad_channel' });
  const pence = Math.round(Number(amountPence));
  if (!Number.isFinite(pence) || pence < 0) throw Object.assign(new Error('Not a price.'), { status: 400, code: 'bad_price' });
  const discount = Math.min(90, Math.max(0, Number(discountPct ?? 0)));

  return withTransaction(async (client) => {
    const { rows: [before] } = await client.query(
      `select amount_pence, annual_discount_pct from plan_prices
        where plan_key = $1 and channel = $2 and effective_to is null
        order by effective_from desc limit 1`,
      [planKey, channel],
    );
    // Nothing changed is not a price change: writing a row that says the same
    // thing would put a date on a decision nobody took.
    if (before && int(before.amount_pence) === pence && Number(before.annual_discount_pct) === discount) {
      return { changed: false };
    }

    await client.query(
      'update plan_prices set effective_to = now() where plan_key = $1 and channel = $2 and effective_to is null',
      [planKey, channel],
    );
    const { rows: [row] } = await client.query(
      `insert into plan_prices (plan_key, channel, amount_pence, annual_discount_pct, created_by, note)
       values ($1, $2, $3, $4, $5, $6)
       returning id, plan_key, channel, amount_pence, annual_discount_pct, effective_from`,
      [planKey, channel, pence, discount, by ?? null, note ?? null],
    );

    // The website price is the one `plans` caches, because it is the one the
    // older screens mean by "what this plan costs".
    if (channel === 'web') {
      await client.query('update plans set price_pence = $2, updated_at = now() where key = $1', [planKey, pence]);
    }
    return { changed: true, row };
  });
}

/**
 * The published benefits matrix.
 *
 * `publishedAt` is null on a row somebody has edited since it was last
 * published, which is what makes "unpublished changes" a fact about the data
 * rather than a flag in a browser tab that a refresh would lose.
 */
export async function readBenefits() {
  const { rows } = await query(
    'select id, label, values, position, published_at, updated_at from plan_benefits order by position, created_at',
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    values: r.values ?? {},
    position: r.position,
    publishedAt: r.published_at,
  }));
}

export async function setBenefit({ id, label, values, position }) {
  const { rows: [row] } = await query(
    `update plan_benefits
        set label        = coalesce($2, label),
            values       = coalesce($3::jsonb, values),
            position     = coalesce($4, position),
            -- An edit un-publishes the row it changed, and nothing else.
            published_at = null,
            updated_at   = now()
      where id = $1
      returning id`,
    [id, label ?? null, values ? JSON.stringify(values) : null, position ?? null],
  );
  if (!row) throw Object.assign(new Error('No such benefit.'), { status: 404, code: 'not_found' });
  return row;
}

export async function addBenefit({ label, values }) {
  const clean = String(label ?? '').trim();
  if (!clean) throw Object.assign(new Error('A benefit needs a name.'), { status: 400, code: 'bad_label' });
  const { rows: [row] } = await query(
    `insert into plan_benefits (label, values, position)
     values ($1, coalesce($2::jsonb, '{}'::jsonb),
             coalesce((select max(position) + 1 from plan_benefits), 0))
     returning id, label, values, position, published_at`,
    [clean, values ? JSON.stringify(values) : null],
  );
  return row;
}

export async function removeBenefit(id) {
  const { rowCount } = await query('delete from plan_benefits where id = $1', [id]);
  if (!rowCount) throw Object.assign(new Error('No such benefit.'), { status: 404, code: 'not_found' });
  return { removed: true };
}

/** Publish everything outstanding, and say when. */
export async function publishBenefits() {
  const { rows } = await query(
    'update plan_benefits set published_at = now() where published_at is null returning id',
  );
  const { rows: [when] } = await query('select max(published_at) as at from plan_benefits');
  return { published: rows.length, publishedAt: when?.at ?? null };
}

/**
 * Where subscriptions were bought, and what the channel kept.
 *
 * Epic holds no payment provider, so this cannot be measured yet: there is no
 * record of which channel a subscription came through and no fee to read. The
 * shape is returned with nulls and the screen says which — a zero here would
 * read as "nobody bought through Apple", which is a different and wrong fact.
 */
export async function readChannels() {
  const { rows: [counts] } = await query(
    `select count(*)::int as subscribers,
            coalesce(sum(p.price_pence), 0)::int as pence
       from accounts a
       join households h on h.id = a.household_id
       join plans p on p.key = a.plan
      where a.status <> 'suspended' and p.price_pence is not null and h.origin <> 'guest_invite'`,
  );
  return {
    // Everything Epic has is a plan somebody was put on by hand, which is the
    // website channel by default and the only one there is.
    rows: [
      { key: 'web', label: 'Our website · Stripe', subscribers: int(counts.subscribers), pence: int(counts.pence), feePence: null },
      { key: 'ios', label: 'Apple App Store', subscribers: null, pence: null, feePence: null },
      { key: 'android', label: 'Google Play', subscribers: null, pence: null, feePence: null },
    ],
    blendedFeePct: null,
    netPence: null,
    ifEveryoneUsedApplePence: null,
    mrrAfterFeesPence: null,
  };
}

/**
 * The three figures at the foot of the Subscriptions screen.
 *
 * MRR is a rate and never scales with the period picker. "On annual" cannot be
 * answered at all: `plan_prices` holds the annual discount, but `accounts` has
 * no interval, so who is actually paying yearly is not written down anywhere.
 * Named rather than guessed.
 */
export async function readStanding() {
  const tiers = await readTiers();
  const paying = tiers.reduce((n, t) => n + t.subscribers, 0);
  const mrrPence = tiers.reduce((n, t) => n + t.subscribers * (t.webPence ?? 0), 0);
  return {
    mrrPence,
    mrrDelta: null,
    averagePaidPence: paying ? Math.round(mrrPence / paying) : null,
    averagePaidDelta: null,
    onAnnual: null,
    onAnnualOf: paying,
    onAnnualGap: 'No subscription interval is recorded',
  };
}
