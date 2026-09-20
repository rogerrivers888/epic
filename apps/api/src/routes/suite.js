/**
 * The reporting suite's API — `/api/admin/suite`.
 *
 * Six screens and three drills read from **one** answer for the reporting part.
 * That is deliberate: the handoff's list of what each section needs ("an estate
 * summary, a revenue/cost ledger by stream and cost class, a supplier register
 * with rate history, a household list with per-household activity, and twelve
 * months of history for every metric that can be drilled") is one model looked
 * at several ways, and splitting it into six endpoints would let two of them
 * disagree about the same figure.
 *
 * Two sections are **editing screens, not reports**, and they have their own
 * endpoints because they write: Subscriptions sets tiers, prices and published
 * benefits, and the supplier record corrects and confirms a rate. Both write
 * through the insert-only tables (`plan_prices`, `counterparty_rates`), so a
 * price change closes a row and opens another and last quarter stays true.
 *
 * Three things this router is careful about.
 *
 *  · **The period is resolved here, not on the client.** The prototype
 *    expressed a window as a multiplier and multiplied at the call site, which
 *    is how a count of live subscriptions comes to be scaled by 11.4. Here
 *    every figure comes back already correct for the window, and the client
 *    never multiplies anything.
 *  · **Mock and real answer in the same shape.** `?data=mock` returns the
 *    handoff's numbers model; the default reads the database. The screens have
 *    one code path, and no invented figure can leak into a real answer — the
 *    fixtures live on the server and are chosen by an explicit flag. A **write**
 *    is refused outright in mock mode: editing a fixture would look like it had
 *    worked and change nothing.
 *  · **No secret passes through here.** "Rotate the credential" records a
 *    masked hint and a date. The key itself is injected by Doppler, which the
 *    owner configures by hand (CLAUDE.md), and an endpoint that accepted one
 *    would be a place for it to be written down.
 */

import express from 'express';
import { can, requires } from '../access.js';
import { DEFAULT_PERIOD, PERIODS, resolvePeriod } from '../domain/reportingPeriods.js';
import { fixtureHousehold, fixtureSupplier, fixtures, scaleFixtures } from '../domain/reportingFixtures.js';
import { readHousehold, readSuite, readSupplierRecord } from '../repositories/suite.js';
import * as pricing from '../repositories/pricing.js';
import * as register from '../repositories/counterparties.js';
import { writeAudit } from '../repositories/roles.js';

const router = express.Router();

/** `?data=mock` and nothing else turns the fixtures on. */
const wantsMock = (req) => String(req.query.data ?? '').toLowerCase() === 'mock';

const periodOf = (req) => resolvePeriod(String(req.query.period ?? DEFAULT_PERIOD));

const actor = (req) => ({
  actorId: req.account?.id ?? null,
  actorLabel: req.account?.email ?? 'the owner (passcode)',
});

/**
 * Every write here lands in the audit trail.
 *
 * A price change and a rate confirmation are both things somebody will want to
 * ask "who did that and when" about, and `admin_audit` is where the rest of the
 * back office already answers it. An audit row never fails an action
 * (`writeAudit` swallows its own errors), so this is not in the happy path.
 */
const trail = (req, action, subjectType, subjectId, after) => writeAudit({
  ...actor(req), action, subjectType, subjectId, subjectLabel: subjectId, after,
});

/**
 * A write while the fixtures are on is refused, not silently dropped.
 *
 * The mock estate has no rows behind it. Letting a price edit appear to succeed
 * against it would be the worst of both: the screen would say "published" and
 * nothing would have changed anywhere.
 */
function refuseIfMock(req) {
  if (!wantsMock(req)) return null;
  return {
    status: 409,
    body: { error: 'mock_data', message: 'Turn mock data off to change anything — there is nothing behind it to change.' },
  };
}

// ---------------------------------------------------------------------------
// the reporting model
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/suite — the whole estate model for one window.
 *
 * `view_reporting` sees it. Money is `view_financials`, and rather than dropping
 * the section a caller who does not hold it gets it marked `withheld`: a missing
 * panel reads as "there is nothing here", which is a different and wrong fact
 * (the rule the rest of the back office already works to).
 */
router.get('/', requires('view_reporting'), async (req, res, next) => {
  try {
    const period = periodOf(req);
    const mock = wantsMock(req);

    const model = mock
      ? { basis: 'fixtures', gaps: {}, ...scaleFixtures(fixtures(), period) }
      : await readSuite(period);

    res.json({ ...withhold(model, req), mock, period, periods: PERIODS });
  } catch (err) { next(err); }
});

/**
 * Take the money out for a caller who may not see it.
 *
 * **Server-side, not on the screen.** `view_reporting` and `view_financials`
 * are two capabilities, and the whole `money` section, subscription revenue,
 * supplier spend and every rate were coming back to anybody holding the first
 * (Codex, 20 Sep 2026). Drawing them or not is a courtesy; what is in the
 * answer is the boundary.
 *
 * Withheld rather than deleted: the rest of the back office already works this
 * way, because a section that vanishes reads as "there is nothing here" and a
 * section marked withheld reads as "you may not see this", and those are
 * different facts (`routes/admin.js`).
 */
export function withhold(model, req) {
  if (can(req, 'view_financials')) return model;

  const hide = (rows) => (Array.isArray(rows) ? null : rows);
  return {
    ...model,
    money: null,
    subscriptions: null,
    suppliers: null,
    overview: {
      ...model.overview,
      // Revenue is a money measure and is on Overview's face.
      measures: model.overview.measures.map((m) => (m.unit === 'money'
        ? { ...m, value: null, delta: null, series: null, withheld: true }
        : m)),
      revenue: null,
      events: { ...model.overview.events, selling: hide(model.overview.events.selling), averageTicket: null },
    },
    customers: {
      ...model.customers,
      households: model.customers.households.map((h) => ({ ...h, monthPence: 0, costUsd: undefined })),
      payingMrr: null,
    },
    /**
     * The drill's own twelve months, too.
     *
     * `history.series` is what "Open the chart" draws, so leaving revenue and
     * the four streams in it handed over the whole year a month at a time — the
     * redaction's own test caught this, which is what it was written for.
     */
    history: {
      ...model.history,
      series: Object.fromEntries(Object.entries(model.history.series)
        .map(([k, v]) => [k, MONEY_SERIES.has(k) ? null : v])),
    },
    withheld: ['view_financials'],
  };
}

/** The twelve-month series that are money, and therefore behind the capability. */
const MONEY_SERIES = new Set(['revenue', 'cost', 'subscriptions', 'hotel', 'hosting', 'activity']);

/**
 * GET /api/admin/suite/customers — the household list, on its own.
 *
 * Customers is advertised to `view_accounts`, which the built-in support role
 * holds — and it was reading the whole estate model, which needs
 * `view_reporting`, so support saw the rail item and got a 403 on opening it
 * (Codex, 20 Sep 2026). The list is an accounts question, so it has an
 * accounts-gated read.
 *
 * The money columns still need `view_financials`: a support account sees who
 * the households are and what they do, and not what they pay.
 */
router.get('/customers', requires('view_accounts'), async (req, res, next) => {
  try {
    const period = periodOf(req);
    const mock = wantsMock(req);
    const model = mock ? scaleFixtures(fixtures(), period) : await readSuite(period);
    const money = can(req, 'view_financials');
    const c = model.customers;
    return res.json({
      mock,
      period,
      customers: money ? c : {
        ...c,
        households: c.households.map((h) => ({ ...h, monthPence: 0, costUsd: undefined })),
        payingMrr: null,
      },
      gaps: model.gaps ?? {},
      withheld: money ? [] : ['view_financials'],
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/admin/suite/household/:id — the record behind one row of Customers.
 *
 * A separate call because it is a separate page with its own address, and
 * because the list is already the largest part of the model above.
 */
router.get('/household/:id', requires('view_accounts'), async (req, res, next) => {
  try {
    const period = periodOf(req);
    const mock = wantsMock(req);
    const household = mock ? fixtureHousehold(req.params.id) : await readHousehold(req.params.id, period);
    if (!household) return res.status(404).json({ error: 'not_found', message: 'No such household.' });
    /**
     * The support role holds `view_accounts` and explicitly no money access,
     * and this was returning subscription spend, booking spend, provider cost
     * and margin regardless (Codex, 20 Sep 2026). What they pay is withheld;
     * who they are and what they do is not.
     */
    if (can(req, 'view_financials')) return res.json({ mock, period, household });
    return res.json({
      mock,
      period,
      household: { ...household, monthPence: 0, spend: null, bookings: null, cost: null, charts: { ...household.charts, spend: null } },
      withheld: ['view_financials'],
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Subscriptions — the editing screen
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/suite/subscriptions — the tiers, what each is sold at on each
 * channel, where they were bought, and the published benefits.
 *
 * Behind `view_financials` rather than `view_reporting`: this is the price list.
 */
router.get('/subscriptions', requires('view_financials'), async (req, res, next) => {
  try {
    const mock = wantsMock(req);
    // The fixtures answer in the reader's own shape, so there is nothing to
    // translate here — which is the point of holding them server-side.
    if (mock) return res.json({ mock: true, ...fixtures().subscriptions });

    const [tiers, benefits, channels, standing] = await Promise.all([
      pricing.readTiers(),
      pricing.readBenefits(),
      pricing.readChannels(),
      pricing.readStanding(),
    ]);
    const publishedAt = benefits.reduce((latest, b) => (b.publishedAt && (!latest || b.publishedAt > latest) ? b.publishedAt : latest), null);
    return res.json({
      mock: false,
      tiers,
      benefits,
      channels,
      publishedAt,
      unpublished: benefits.filter((b) => !b.publishedAt).length,
      standing,
    });
  } catch (err) { next(err); }
});

/**
 * PUT /api/admin/suite/subscriptions/price — set a tier's price in one channel.
 *
 * Closes the row in force and inserts a new one. The panel says what this
 * means, and it is true: existing subscriptions keep the row they were sold on.
 */
router.put('/subscriptions/price', requires('manage_plans'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const { planKey, channel, amountPence, discountPct, note } = req.body ?? {};
    const who = actor(req);
    const row = await pricing.setPrice({
      planKey, channel,
      amountPence: Number(amountPence),
      discountPct: discountPct == null ? undefined : Number(discountPct),
      by: who.actorLabel,
      note,
    });
    await trail(req, 'plan.price.set', 'plan', `${planKey}/${channel}`, { amountPence: Number(amountPence), discountPct });
    return res.json({ price: row });
  } catch (err) { next(err); }
});

router.post('/subscriptions/benefits', requires('manage_plans'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const benefit = await pricing.addBenefit({ label: req.body?.label, values: req.body?.values });
    await trail(req, 'plan.benefit.add', 'benefit', benefit.id, { label: benefit.label });
    return res.status(201).json({ benefit });
  } catch (err) { next(err); }
});

router.patch('/subscriptions/benefits/:id', requires('manage_plans'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const { label, values, position } = req.body ?? {};
    const benefit = await pricing.setBenefit({ id: req.params.id, label, values, position });
    await trail(req, 'plan.benefit.set', 'benefit', req.params.id, { label, values });
    return res.json({ benefit });
  } catch (err) { next(err); }
});

router.delete('/subscriptions/benefits/:id', requires('manage_plans'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const out = await pricing.removeBenefit(req.params.id);
    await trail(req, 'plan.benefit.remove', 'benefit', req.params.id, {});
    return res.json(out);
  } catch (err) { next(err); }
});

/** Publish everything outstanding, and say when. */
router.post('/subscriptions/publish', requires('manage_plans'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const out = await pricing.publishBenefits();
    await trail(req, 'plan.benefits.publish', 'benefit', 'all', out);
    return res.json(out);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the supplier record — also an editing screen
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/suite/supplier/:key — what the integration is for, whether the
 * pipe is plugged in, and how it has behaved over the selected window.
 *
 * Every figure in the health panel scales with the period, **including the
 * failure denominator** — a failure rate whose numerator moves and whose
 * denominator does not is worse than no figure.
 */
router.get('/supplier/:key', requires('view_reporting'), async (req, res, next) => {
  try {
    const period = periodOf(req);
    if (wantsMock(req)) {
      const record = fixtureSupplier(req.params.key, period);
      if (!record) return res.status(404).json({ error: 'not_found', message: 'No such supplier.' });
      return res.json({ mock: true, period, ...record });
    }
    const record = await readSupplierRecord(req.params.key, period);
    if (!record) return res.status(404).json({ error: 'not_found', message: 'No such supplier.' });
    return res.json({ mock: false, period, ...record });
  } catch (err) { next(err); }
});

/**
 * PUT /api/admin/suite/supplier/:key/rate — write a new rate row.
 *
 * `says` is the sentence on the provider's own page: "1.5% + 20p" is not one
 * number, and what was confirmed is the sentence. Writing it stamps it
 * confirmed, because somebody has just read it.
 */
router.put('/supplier/:key/rate', requires('manage_settings'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const who = actor(req);
    const { says, amount, unit, currency, sourceUrl } = req.body ?? {};
    const rate = await register.setRate(req.params.key, {
      says, amount: amount == null || amount === '' ? null : Number(amount),
      unit, currency, sourceUrl, by: who.actorLabel,
    });
    await trail(req, 'counterparty.rate.set', 'counterparty', req.params.key, { says });
    return res.json({ rate });
  } catch (err) { next(err); }
});

/** Stamp the rate as still right, without changing it. */
router.post('/supplier/:key/confirm', requires('manage_settings'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const rate = await register.confirmRate(req.params.key, { by: actor(req).actorLabel });
    await trail(req, 'counterparty.rate.confirm', 'counterparty', req.params.key, {});
    return res.json({ rate });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/suite/supplier/:key/credential — record that the key was
 * rotated, and what it now ends in.
 *
 * **This never receives a key.** `masked` is a reminder — the last few
 * characters and what the credential is scoped to — and the real value is in
 * Doppler, which the owner sets by hand. An endpoint that accepted the secret
 * would be a place for it to be written down, which is the one thing CLAUDE.md
 * forbids outright.
 */
router.post('/supplier/:key/credential', requires('manage_settings'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const masked = String(req.body?.masked ?? '').trim();
    // A guard rather than trust: anything that looks like a live key is refused
    // outright, whatever the caller meant by it.
    if (/^(sk-|sk_live|pk_live|AIza|ta_[A-Za-z0-9]{12})/.test(masked) && !masked.includes('…')) {
      return res.status(400).json({
        error: 'looks_like_a_secret',
        message: 'That looks like the key itself. This field holds a masked reminder — the key lives in Doppler.',
      });
    }
    const out = await register.rotateCredential(req.params.key, { masked, expiry: req.body?.expiry });
    await trail(req, 'counterparty.credential.rotate', 'counterparty', req.params.key, { masked });
    return res.json({ counterparty: out });
  } catch (err) { next(err); }
});

/**
 * POST /api/admin/suite/supplier/:key/adapter — turn the integration off or on.
 *
 * The one destructive-feeling control on the record, and the screen draws it
 * red for that reason. Where the counterparty is a search source it flips the
 * estate's own switch (`sources/index.js`) as well as the register, so the
 * calls actually stop — `stopped` in the answer says whether they did.
 *
 * Where it is **not** a search source — Fly.io, Neon, Stripe, the app stores —
 * there is no switch to flip and `stopped` is false. Turning it off records
 * that the register says off; it does not stop an invoice. The screen says
 * which, because a red button that only records an intention is worse than no
 * button at all (epic-59, 20 Sep 2026, who found this claiming otherwise).
 */
router.post('/supplier/:key/adapter', requires('manage_settings'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const on = req.body?.on !== false;
    const out = await register.setAdapter(req.params.key, { on });
    await trail(req, on ? 'counterparty.adapter.enable' : 'counterparty.adapter.disable', 'counterparty', req.params.key, { on });
    return res.json({ counterparty: out });
  } catch (err) { next(err); }
});

/** Correct what the register says the integration is for. */
router.patch('/supplier/:key', requires('manage_settings'), async (req, res, next) => {
  try {
    const stop = refuseIfMock(req);
    if (stop) return res.status(stop.status).json(stop.body);
    const out = await register.describe(req.params.key, req.body ?? {});
    await trail(req, 'counterparty.describe', 'counterparty', req.params.key, req.body ?? {});
    return res.json({ counterparty: out });
  } catch (err) { next(err); }
});

export default router;
