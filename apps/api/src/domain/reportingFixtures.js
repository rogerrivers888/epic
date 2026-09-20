/**
 * The numbers model — what the reporting suite looks like with a business in it.
 *
 * The owner, 20 Sep 2026: "Some data doesn't exist. I would like to be able to
 * have a little toggle for 'Show mock data' so that we can see what this looks
 * like until such time as we have real data coming in, and then I can toggle
 * back to real data when I wish."
 *
 * So this is the estate the handoff specifies ("Reporting & overview" →
 * `README.md` → "The numbers model"), held server-side rather than in the web
 * bundle for two reasons: the screens then have exactly one code path, mock or
 * real, and no invented figure can ever be shipped to a household's device.
 *
 * **One internally consistent estate.** Every cross-total the handoff asks to
 * reconcile does:
 *
 *   revenue      3851 + 3092 + 1315 +  986 = 9244
 *   cost         2715 +   47 +   91 +   11 + 62 = 2926
 *   by kind      1127 + 1104 + 318 + 255 + 60 + 62 = 2926
 *   margin       9244 − 2926 = 6318, and 6318 / 9244 = 68.3%
 *   gross       24736 + 6575 + 9860 = 41171
 *   suppliers   1104 + 1067 + 318 + 246 + 60 + 45 + 44 + 18 + 15 + 9 = 2926
 *   per sub      6.65 + 5.34 + 2.27 + 1.70 = 15.96, out 5.05, kept 10.91
 *
 * Two places where the handoff's own figures do not close, left as the handoff
 * has them rather than quietly corrected, because these are the signed-off
 * fixtures and the screens are what is being reviewed:
 *
 *  · **MRR by plan.** £5.99 × 321 + £8.99 × 211 + £100/yr × 47 is £4,211, not
 *    the £3,851 that appears in nine other places. The prototype's own panel
 *    reads 1897 / 1602 / 352 = 3851, so the components are kept and the £3,851
 *    that everything else is derived from stands.
 *  · **The stream histories.** The four streams sum to £9,244 in the latest
 *    month, which is the month every screen shows. They do not sum to the
 *    stated total for the eleven months before it; those series are indicative
 *    shapes for the drill chart.
 *
 * Flows are stated **per month**, and `scaleFixtures()` puts them on the
 * selected window. Stocks and rates are stated as they stand and are never
 * scaled — the one rule the prototype kept breaking.
 */

import { monthBuckets } from './reportingPeriods.js';

/** A month is the unit every flow below is quoted in. */
const MONTH_DAYS = 30.4;

export const FIXTURE_SUBSCRIBERS = 579;

/** Twelve months of total revenue, Oct 25 → Sep 26. */
const REVENUE_SERIES = [6640, 7210, 7880, 6980, 7340, 7910, 8460, 8120, 8690, 9130, 8160, 9244];

const STREAM_SERIES = {
  subscriptions: [2600, 2740, 2860, 2980, 3080, 3190, 3310, 3420, 3520, 3640, 3720, 3851],
  hotel: [1180, 1420, 1610, 1780, 1960, 2140, 2320, 2480, 2660, 2810, 2940, 3092],
  hosting: [520, 590, 650, 700, 760, 820, 890, 960, 1030, 1120, 1210, 1315],
  activity: [680, 710, 740, 770, 800, 830, 860, 880, 910, 940, 960, 986],
};

/** Per household per month — the Behaviour measures, at household scope. */
const BEHAVIOUR_SERIES = {
  searches: [5.2, 5.5, 5.8, 6.0, 6.3, 6.5, 6.7, 6.8, 6.9, 7.0, 7.0, 7.1],
  saves: [1.5, 1.6, 1.7, 1.8, 2.0, 2.1, 2.2, 2.2, 2.3, 2.3, 2.3, 2.4],
  out: [0.58, 0.6, 0.63, 0.65, 0.68, 0.7, 0.7, 0.72, 0.73, 0.74, 0.75, 0.76],
  trips: [0.09, 0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.15, 0.16, 0.17, 0.17, 0.18],
  attended: [0.06, 0.07, 0.08, 0.08, 0.09, 0.1, 0.11, 0.11, 0.12, 0.13, 0.13, 0.14],
  hosted: [0.02, 0.02, 0.03, 0.03, 0.03, 0.04, 0.04, 0.04, 0.04, 0.05, 0.05, 0.05],
};

const HOUSEHOLDS = [
  { id: 'okonkwo', name: 'Okonkwo', area: 'Brockley', people: 4, plan: 'Household', monthPence: 899, joined: '2025-03-12', lastSeenDays: 2, places: 31, daysOut: 4, bookings: 3, ratings: 9, status: 'live', statusNote: null, origin: 'signup' },
  { id: 'ibrahim', name: 'Ibrahim', area: 'Chorlton', people: 5, plan: 'Household', monthPence: 899, joined: '2026-05-05', lastSeenDays: 0, places: 38, daysOut: 7, bookings: 6, ratings: 14, status: 'live', statusNote: null, origin: 'marketplace' },
  { id: 'dasgupta', name: 'Dasgupta', area: 'Stockbridge', people: 2, plan: 'Annual', monthPence: 833, joined: '2025-09-22', lastSeenDays: 0, places: 47, daysOut: 6, bookings: 5, ratings: 12, status: 'live', statusNote: null, origin: 'signup' },
  { id: 'achebe', name: 'Achebe-Lynch', area: 'Kings Heath', people: 4, plan: 'Household', monthPence: 899, joined: '2026-02-17', lastSeenDays: 3, places: 26, daysOut: 5, bookings: 4, ratings: 8, status: 'live', statusNote: null, origin: 'peer' },
  { id: 'fenwick', name: 'Fenwick', area: 'Jesmond', people: 1, plan: 'Solo', monthPence: 599, joined: '2026-01-04', lastSeenDays: 1, places: 18, daysOut: 3, bookings: 2, ratings: 5, status: 'live', statusNote: null, origin: 'signup' },
  { id: 'marchetti', name: 'Marchetti', area: 'Headingley', people: 3, plan: 'Trial', monthPence: 0, joined: '2026-08-09', lastSeenDays: 6, places: 12, daysOut: 2, bookings: 1, ratings: 2, status: 'trial', statusNote: '9 days left', origin: 'marketplace' },
  { id: 'novak', name: 'Novák', area: 'Shawlands', people: 2, plan: 'Trial', monthPence: 0, joined: '2026-09-02', lastSeenDays: 5, places: 9, daysOut: 1, bookings: 1, ratings: 1, status: 'trial', statusNote: '16 days left', origin: 'signup' },
  { id: 'whitcombe', name: 'Whitcombe', area: 'Totterdown', people: 1, plan: 'Solo', monthPence: 599, joined: '2026-07-14', lastSeenDays: 11, places: 7, daysOut: 1, bookings: 0, ratings: 0, status: 'live', statusNote: null, origin: 'guest_invite' },
  { id: 'bell', name: 'Bell', area: 'Kirkstall', people: 2, plan: 'Solo', monthPence: 599, joined: '2025-11-30', lastSeenDays: 34, places: 5, daysOut: 0, bookings: 0, ratings: 0, status: 'at_risk', statusNote: null, origin: 'signup' },
  { id: 'osei', name: 'Osei', area: 'Hyde Park', people: 4, plan: 'Household', monthPence: 899, joined: '2026-04-08', lastSeenDays: 4, places: 22, daysOut: 4, bookings: 3, ratings: 6, status: 'live', statusNote: null, origin: 'marketplace' },
  { id: 'rahman', name: 'Rahman', area: 'Levenshulme', people: 5, plan: 'Annual', monthPence: 833, joined: '2025-10-19', lastSeenDays: 7, places: 34, daysOut: 5, bookings: 4, ratings: 10, status: 'live', statusNote: null, origin: 'signup' },
  { id: 'redgrave', name: 'Redgrave', area: 'Didsbury', people: 3, plan: 'Household', monthPence: 0, joined: '2025-06-21', lastSeenDays: 58, places: 14, daysOut: 0, bookings: 0, ratings: 3, status: 'cancelled', statusNote: '4 Sep', origin: 'guest_invite' },
];

/**
 * Twelve counterparties, not ten.
 *
 * "Infrastructure" was a cost category pretending to be a supplier; the handoff
 * breaks it into the three real ones — Fly.io £26, Neon £19, Cloudflare R2 £15 —
 * each with its own purpose, credential and health, which is what the supplier
 * record needs. The three still sum to the £60 the cost-to-serve panel shows.
 *
 * `credential` is a **masked hint and nothing else**. A secret never lives in
 * this repo or in this database: everything deployed is injected by Doppler,
 * which the owner configures by hand (CLAUDE.md). What the record can hold is
 * the last four characters, what the key is scoped to, and when it was rotated.
 */
const SUPPLIERS = [
  {
    key: 'anthropic', name: 'anthropic', direction: 'cost', unitName: 'plan and menu read',
    unitCost: '£0.26 each', volume: 4289, spend: 1104, expected: 1034,
    series: [720, 760, 800, 840, 870, 900, 930, 960, 1000, 1040, 1060, 1104],
    purpose: 'Writes the day plan itself, and reads restaurant menus into structured dishes so a place can be searched on what it serves.',
    usedBy: 'Trips · Inspire · Places', costClass: 'serve', status: 'live', adapterState: 'enabled',
    credentialMasked: 'sk-ant-…9f2c · org Epic Ltd', credentialExpiry: 'No expiry set', confirmed: '2026-09-18T00:00:00.000Z',
    failed: 14, latency: '2.4s p95', allowanceNote: 'No cap · spend alert at £1,500',
  },
  {
    key: 'google-places', name: 'google Places (New)', direction: 'cost', unitName: '20 place details',
    unitCost: '3.2p', volume: 33356, spend: 1067, expected: 905,
    series: [640, 680, 720, 760, 800, 840, 880, 920, 960, 1000, 1020, 1067],
    purpose: 'The place catalogue — names, opening hours, photos and ratings for everything a household can search.',
    usedBy: 'Places · Inspire', costClass: 'library', status: 'live', adapterState: 'enabled',
    credentialMasked: 'AIza…Kd41 · restricted to server IPs', credentialExpiry: 'Rotates 4 Dec 26', confirmed: '2026-09-12T00:00:00.000Z',
    failed: 62, latency: '340ms p95', allowanceNote: 'Allowance exhausted · billed on overage',
  },
  {
    key: 'google-routes', name: 'google-routes', direction: 'cost', unitName: 'travel matrix',
    unitCost: '£1.00', volume: 318, spend: 318, expected: 286,
    series: [210, 224, 238, 246, 258, 266, 272, 284, 292, 300, 308, 318],
    purpose: 'Travel times between every pair of places in a day, so the running order is drivable rather than theoretical.',
    usedBy: 'Trips', costClass: 'serve', status: 'live', adapterState: 'enabled',
    credentialMasked: 'AIza…Kd41 · shared with Places', credentialExpiry: 'Rotates 4 Dec 26', confirmed: '2026-03-20T00:00:00.000Z',
    failed: 2, latency: '610ms p95', allowanceNote: 'No cap',
  },
  {
    key: 'stripe', name: 'Stripe', direction: 'cost', unitName: 'charge or payout',
    unitCost: '1.5% + 20p', volume: 1204, spend: 246, expected: 214,
    series: [160, 172, 180, 188, 196, 204, 210, 218, 226, 234, 238, 246],
    purpose: 'Takes subscription and booking payments, and pays hosts out through Connect.',
    usedBy: 'Subscriptions · Bookings · Host payouts', costClass: 'serve', status: 'live', adapterState: 'enabled',
    credentialMasked: 'sk_live_…7be3 · restricted key', credentialExpiry: 'No expiry set', confirmed: '2026-09-09T00:00:00.000Z',
    failed: 3, latency: '480ms p95', allowanceNote: 'No cap',
  },
  {
    key: 'tripadvisor', name: 'tripadvisor', direction: 'cost', unitName: 'content lookup',
    unitCost: '1.5p → 0.9p', volume: 3124, spend: 45, expected: 61,
    series: [74, 72, 70, 68, 66, 64, 62, 58, 54, 50, 48, 45],
    purpose: 'Second-opinion ratings and review counts where Google is thin.',
    usedBy: 'Places', costClass: 'library', status: 'degraded', adapterState: 'enabled',
    credentialMasked: 'ta_…c19 · sandbox tier', credentialExpiry: 'Expires 12 Nov 26', confirmed: '2026-08-30T00:00:00.000Z',
    failed: 214, latency: '1.9s p95', allowanceNote: '260 places left this month',
  },
  {
    key: 'mapbox', name: 'Mapbox', direction: 'cost', unitName: '1,000 map tiles',
    unitCost: '£0.42', volume: 104000, spend: 44, expected: 44,
    series: [42, 43, 44, 44, 43, 44, 45, 44, 44, 43, 44, 44],
    purpose: 'Draws every map in the app.',
    usedBy: 'Places · Trips', costClass: 'serve', status: 'live', adapterState: 'enabled',
    credentialMasked: 'pk.…8a2 · URL restricted', credentialExpiry: 'No expiry set', confirmed: '2026-08-25T00:00:00.000Z',
    failed: 0, latency: '90ms p95', allowanceNote: '200k tiles free, then billed',
  },
  {
    key: 'fly', name: 'Fly.io', direction: 'cost', unitName: 'app hosting',
    unitCost: 'monthly', volume: null, spend: 26, expected: 25,
    series: [22, 22, 23, 23, 24, 24, 24, 25, 25, 25, 26, 26],
    purpose: 'Runs the API and the background workers.',
    usedBy: 'Everything', costClass: 'office', status: 'live', adapterState: 'enabled',
    credentialMasked: 'Org token · CI only', credentialExpiry: 'No expiry set', confirmed: null,
    failed: null, latency: '—', allowanceNote: 'Autoscale ceiling 4 machines',
  },
  {
    key: 'neon', name: 'Neon', direction: 'cost', unitName: 'Postgres',
    unitCost: 'monthly', volume: null, spend: 19, expected: 18,
    series: [16, 16, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19],
    purpose: 'The database — households, places, trips, events, the ledger.',
    usedBy: 'Everything', costClass: 'office', status: 'live', adapterState: 'enabled',
    credentialMasked: 'Connection string in Doppler', credentialExpiry: 'No expiry set', confirmed: null,
    failed: null, latency: '12ms p95', allowanceNote: 'Storage 20GB of 50GB',
  },
  {
    key: 'openai', name: 'OpenAI · speech', direction: 'cost', unitName: 'minute transcribed',
    unitCost: '£0.044', volume: 412, spend: 18, expected: 11,
    series: [4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 16, 18],
    purpose: 'Turns a spoken "we fancy a pub lunch near the coast" into a search.',
    usedBy: 'Voice intake', costClass: 'serve', status: 'trial', adapterState: 'wired',
    credentialMasked: 'sk-…41bd · personal account', credentialExpiry: 'No expiry set', confirmed: '2026-06-16T00:00:00.000Z',
    failed: 9, latency: '1.1s p95', allowanceNote: 'Trial credit £40 remaining',
  },
  {
    key: 'r2', name: 'Cloudflare R2', direction: 'cost', unitName: 'object storage',
    unitCost: 'monthly', volume: null, spend: 15, expected: 15,
    series: [13, 13, 14, 14, 14, 14, 15, 15, 15, 15, 15, 15],
    purpose: 'Stores place photos and cached provider responses.',
    usedBy: 'Places · Inspire', costClass: 'library', status: 'live', adapterState: 'enabled',
    credentialMasked: 'R2 token · scoped to epic-media', credentialExpiry: 'No expiry set', confirmed: null,
    failed: null, latency: '—', allowanceNote: 'No cap',
  },
  {
    key: 'osm', name: 'OSM · Overpass · Wikidata', direction: 'cost', unitName: 'keyless lookup',
    unitCost: '£0', volume: 14900, spend: 15, expected: 15,
    series: [14, 14, 15, 15, 14, 15, 15, 15, 15, 14, 15, 15],
    purpose: 'Free geography — footpaths, parks, transport stops, and facts Google does not hold.',
    usedBy: 'Places · Inspire', costClass: 'library', status: 'live', adapterState: 'enabled',
    credentialMasked: 'None · keyless', credentialExpiry: '—', confirmed: null,
    failed: 318, latency: '2.8s p95', allowanceNote: 'Fair use · self-throttled',
  },
  {
    key: 'stores', name: 'Apple · Google stores', direction: 'cost', unitName: 'in-app charge',
    unitCost: '15%', volume: 62, spend: 9, expected: 12,
    series: [15, 15, 14, 14, 13, 13, 12, 12, 11, 10, 10, 9],
    purpose: 'Commission on subscriptions bought inside the iOS app.',
    usedBy: 'Subscriptions', costClass: 'serve', status: 'live', adapterState: 'enabled',
    credentialMasked: 'App Store Connect · Epic Ltd', credentialExpiry: 'Agreement renews 1 Jan 27', confirmed: null,
    failed: null, latency: '—', allowanceNote: 'Small-business rate 15%',
  },
];

/**
 * The three tiers, and what each is sold at in each channel.
 *
 * Solo 321 + Household 258 = 579, the same estate the rest of the model counts:
 * Household's 258 is the 211 paying monthly plus the 47 on annual.
 *
 * Annual is **derived, never stored** — `round(monthly × 12 × (1 −
 * discount/100))` — so the tile, the panel and the revenue line cannot disagree
 * about it. `iosUpliftPct` is what the App Store price is above the website
 * one, which is the figure that says whether the uplift covers Apple's 15% cut.
 */
const TIER_SPEC = [
  { key: 'solo', label: 'Solo', note: 'one login', webPence: 599, iosPence: 699, discountPct: 10, subscribers: 321, series: [193, 206, 218, 225, 238, 250, 263, 276, 289, 302, 311, 321] },
  { key: 'household', label: 'Household', note: 'six logins', webPence: 899, iosPence: 999, discountPct: 7, subscribers: 258, series: [155, 165, 175, 181, 191, 201, 212, 222, 232, 242, 250, 258] },
  { key: 'pro', label: 'Pro', note: 'not launched', webPence: 1299, iosPence: 1499, discountPct: 10, subscribers: 0, series: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
];

const annual = (pence, discountPct) => Math.round(pence * 12 * (1 - discountPct / 100));

const TIERS = TIER_SPEC.map((t) => ({
  ...t,
  active: true,
  androidPence: null,
  annualWebPence: annual(t.webPence, t.discountPct),
  annualIosPence: annual(t.iosPence, t.discountPct),
  iosUpliftPct: Math.round((t.iosPence / t.webPence - 1) * 100),
  /** Subscribers × the website monthly price. A what-if, and labelled as one. */
  revenueAtThisPricePence: t.subscribers * t.webPence,
  priceSetAt: '2026-09-19T00:00:00.000Z',
  history: [{ channel: 'web', pence: t.webPence, discountPct: t.discountPct, from: '2026-09-19T00:00:00.000Z', to: null, by: 'the owner', note: 'Settled 19 Sep 2026' }],
}));

/** The published benefits matrix, one row per benefit with a cell per tier. */
const BENEFITS = [
  ['Logins included', '1', '6', '6'],
  ['Saved places', 'Unlimited', 'Unlimited', 'Unlimited'],
  ['Day plans generated a month', '20', '60', 'Unlimited'],
  ['Trips and running order', 'Yes', 'Yes', 'Yes'],
  ['Group trips and guest invites', '—', 'Yes', 'Yes'],
  ['Hotel and activity booking', 'Yes', 'Yes', 'Yes'],
  ['Host tools and event wizard', '—', '—', 'Yes'],
  ['Commission on hosted events', '15%', '15%', '10%'],
  ['Priority support', '—', '—', 'Yes'],
].map(([label, solo, household, pro], i) => ({
  id: `benefit-${i}`,
  label,
  values: { solo, household, pro },
  position: i,
  publishedAt: '2026-09-19T00:00:00.000Z',
}));

/**
 * The four streams, and the detail rows under each.
 *
 * `avgUnit` is a **number** and not "£17.77": the stock/flow rule's second
 * consequence is that derived copy comes from the same scaled numbers as the
 * figure it sits under and never from a hardcoded string, and a pre-formatted
 * one neither converts under Per subscriber nor restates with the period.
 *
 * `details` are what the table indents under each stream — the channels the
 * money actually came through. They deliberately carry **no cost and no
 * margin**: cost allocates at stream level only, and a margin against a detail
 * row would be an apportionment nobody asked for (handoff §2).
 */
const STREAMS = [
  {
    key: 'subscriptions', label: 'Subscriptions', revenue: 3851, cost: 2715, margin: 1136, marginPct: 29.5,
    growth: 9.2, perSub: 6.65, units: 579, unitName: 'subscriptions', avgUnit: 6.65, churn: '3.8%',
    details: [
      { label: 'Household £8.99', units: 211, revenue: 1897, avgUnit: 8.99, growth: 11 },
      { label: 'Solo £5.99', units: 321, revenue: 1602, avgUnit: 4.99, growth: 7.4 },
      { label: 'Annual £100', units: 47, revenue: 352, avgUnit: 7.49, growth: 14 },
    ],
  },
  {
    key: 'hotel', label: 'Hotel upsell', revenue: 3092, cost: 47, margin: 3045, marginPct: 98.5,
    growth: 22, perSub: 5.34, units: 174, unitName: 'bookings', avgUnit: 17.77, churn: null,
    details: [
      { label: 'LiteAPI direct · 13%', units: 139, revenue: 2395, avgUnit: 17.23, growth: 24 },
      { label: 'Booking.com · 11%', units: 35, revenue: 697, avgUnit: 19.91, growth: 14 },
    ],
  },
  {
    key: 'hosting', label: 'Hosting commission', revenue: 1315, cost: 91, margin: 1224, marginPct: 93.1,
    growth: 22, perSub: 2.27, units: 118, unitName: 'bookings', avgUnit: 11.14, churn: null,
    details: [
      { label: 'Marketplace · 15%', units: 92, revenue: 1022, avgUnit: 11.11, growth: 26 },
      { label: 'Host’s own link · 5%', units: 26, revenue: 293, avgUnit: 11.27, growth: 9 },
      // The first ninety days are free, so those bookings earned nothing and
      // are **not** a third slice of the 118 that did. Shown as a memo row with
      // no units, because adding them would stop the column reconciling.
      { label: 'First 90 days · 0%', units: null, revenue: 0, avgUnit: 0, growth: null, memo: '14 bookings' },
    ],
  },
  {
    key: 'activity', label: 'Activity upsell', revenue: 986, cost: 11, margin: 975, marginPct: 98.9,
    growth: 6, perSub: 1.7, units: 209, unitName: 'bookings', avgUnit: 4.72, churn: null,
    details: [
      { label: 'Viator · 10%', units: 121, revenue: 571, avgUnit: 4.72, growth: 7 },
      { label: 'GetYourGuide · 9%', units: 88, revenue: 415, avgUnit: 4.72, growth: 4 },
    ],
  },
];

/** A bar or key-value row: a label, a figure, and optionally a share of the row above it. */
/**
 * A bar or key-value row: a label, a figure, and optionally a share of the
 * biggest beside it.
 *
 * `rate: true` marks a figure that does **not** move with the period — an
 * average, a median, a per-something. Inferring it from the magnitude was the
 * obvious shortcut and it was wrong: "4.2 searches before the first save" is
 * above one and became 48 over a year (20 Sep 2026).
 */
const row = (label, value, pct = null, opts = {}) => ({ label, value, pct, ...opts });
const rate = (label, value) => row(label, value, null, { rate: true });

/**
 * Bar lengths, as a share of the biggest in the set.
 *
 * The design draws a bar row against the largest figure rather than against a
 * total, so the longest bar is always full and the rest are read against it.
 */
const bars = (rows) => {
  const max = Math.max(1, ...rows.map((r) => (typeof r.value === 'number' ? r.value : 0)));
  return rows.map((r) => ({ ...r, pct: typeof r.value === 'number' ? Math.round((r.value / max) * 100) : 0 }));
};

/**
 * The whole model, with every flow quoted per month.
 *
 * Read the shape here rather than in the route: this is the contract the five
 * screens are written against, and the real reader (`repositories/suite.js`)
 * answers in exactly the same shape with nulls where nothing is knowable.
 */
export function fixtures() {
  return {
    estate: {
      households: 1284,
      customers: 1088,
      active: 862,
      paying: 579,
      trial: 182,
      atRisk: 48,
      people: 3612,
      // 1 + 743 + 196 + 148 + 196 = 1,284, the whole estate. Guest invites are
      // 15% of it, which is why the customer list hides them by default.
      origins: bars([
        row('Founding', 1),
        row('Signed up', 743),
        row('Invited as a guest', 196),
        row('In somebody’s household', 148),
        row('From a host’s page', 196),
      ]),
    },

    // -----------------------------------------------------------------------
    // Overview
    // -----------------------------------------------------------------------
    overview: {
      measures: [
        { key: 'signups', label: 'New subscribers', kind: 'flow', unit: 'count', value: 96, delta: 30, sub: 'on an expected {expected}', expected: 74, series: [58, 62, 60, 68, 64, 72, 70, 78, 76, 84, 88, 96] },
        { key: 'revenue', label: 'Revenue', kind: 'flow', unit: 'money', value: 9244, delta: 16, sub: '· MRR £3,851 a month of it', series: REVENUE_SERIES },
        { key: 'engagement', label: 'Engagement', kind: 'stock', unit: 'count', value: 862, delta: 8, sub: 'households active in the period', series: [610, 640, 668, 690, 712, 738, 762, 784, 806, 828, 844, 862] },
        { key: 'events', label: 'Events & hosts', kind: 'fixed', unit: 'count', value: 128, delta: 15, sub: 'scheduled next 60 days · 41 hosts', series: [62, 68, 74, 72, 82, 88, 94, 98, 108, 114, 120, 128] },
      ],
      subscriptions: {
        opening: 506,
        added: 96,
        lost: 23,
        live: 579,
        churnPct: 3.8,
        wasChurnPct: 4.4,
        arrivals: [row('Signed up direct', 54, 100), row('Booked first', 21, 39), row('Invited to a trip', 16, 30), row('Second household', 5, 9)],
        arrivalsNote: 'The {21} who booked something before they subscribed are the best cohort Epic has.',
        sources: [row('Apple App Store', 31, 100), row('Google Play', 22, 71), row('Instagram', 18, 58), row('Google search', 12, 39), row('A host’s page', 9, 29), row('A friend', 4, 13)],
        sourcesNote: 'Store listings bring 55% of new subscribers. Instagram is what drives them to the listing.',
      },
      revenue: {
        byStream: [row('Subscriptions', 3851, 100), row('Hotels', 3092, 80), row('Hosted events', 1315, 34), row('Paid activities', 986, 26)],
        byStreamNote: 'Subscription was 74% of revenue last November and is 42% now.',
        mrrByPlan: [row('Household £8.99 · 211', 1897), row('Solo £5.99 · 321', 1602), row('Annual £100 · 47', 352), row('Trial · 182', 0)],
        mrr: 3851,
        forecast: {
          today: 3851,
          steps: [row('+ trials converting at 48%', 412), row('+ upgrades to Household', 190), row('− churn at 3.8%', -143)],
          total: 4310,
        },
      },
      engagement: {
        shares: [row('Searched', 94, 94), row('Saved a place', 71, 71), row('Settled a day out', 58, 58), row('Rated a day', 44, 44), row('Booked something', 21, 21), row('Invited someone', 19, 19)],
        shareDeltas: [3, 4, 2, 6, 5, 4],
        visits: 3940,
        newVisits: 1120,
        returningVisits: 2820,
        timeOnSiteSeconds: 372,
        timeOnSiteDelta: 41,
        activeWeeksPerQuarter: 5,
        bySurface: [row('Places', 94, 94), row('Inspire', 81, 81), row('Trips', 76, 76), row('Settings', 38, 38), row('Host', 9, 9)],
      },
      events: {
        ran: 34,
        scheduled60: 128,
        guests: 248,
        averageParty: 2.1,
        fillPct: 68,
        hosts: [row('Approved', 88, 100), row('Selling', 41, 47), row('Sold out an event', 22, 25), row('Cancelled one', 9, 10)],
        selling: [row('Marketplace · 15%', 1022), row('Host’s own link · 5%', 293), row('First 90 days · 0%', 0)],
        averageTicket: 34,
        ratedGoodPct: 78,
      },
      standing: {
        directBookings: 459,
        timeOnSiteSeconds: 372,
        timeOnSiteDelta: 41,
        satisfactionPct: 71,
      },
    },

    // -----------------------------------------------------------------------
    // Money
    // -----------------------------------------------------------------------
    money: {
      subscribers: FIXTURE_SUBSCRIBERS,
      streams: STREAMS.map((s) => ({ ...s, series: STREAM_SERIES[s.key] })),
      total: { revenue: 9244, cost: 2926, margin: 6318, marginPct: 68.3, marginDelta: 2.1, perSub: 15.96, perSubOut: 5.05, perSubKept: 10.91, growth: 16 },
      breakdown: {
        subscriptions: {
          mrrMoved: [row('Opening MRR', 3608), row('New subscriptions', 512), row('Upgrades', 190), row('Downgrades', -116), row('Churn, 23 subscriptions', -143), row('Closing MRR', 3851)],
          forecast: [row('MRR today', 3851), row('Growing at', '+9.2% / mo'), row('Forecast next month', 4310), row('Forecast in 12 months', 9840), row('Runway', '12.2 months')],
          forecastNote: 'Cash and overhead are hand-entered — Epic holds no salary or overhead ledger.',
          costs: [row('Search & discovery', 1127), row('Planning & generation', 1104), row('Routing', 318), row('Payment and store fees', 120), row('Infrastructure', 46), row('Margin', 1136)],
        },
        hotel: {
          channels: [row('LiteAPI direct · 13%', 2395, 100), row('Booking.com · 11%', 697, 29)],
          blendedRate: '12.5%',
          drivers: [row('Multi-day trips settled', 1853), row('Of those, a hotel added', 174), row('Attach rate', '9.4% +1.3pt'), row('Average booking', 142), row('Commission per booking', 17.77)],
          driversNote: 'A percentage point of attach rate is worth £329 a month.',
          costs: [row('Revenue', 3092), row('Payment fees', -39), row('Infrastructure', -8), row('Margin · 98.5%', 3045)],
        },
        hosting: {
          ownVsThird: [row('Own hosts · gross', 6575), row('Own hosts · take rate', '20.0%'), row('Own hosts · per booking', 11.14), row('Third party · gross', 9860), row('Third party · take rate', '10.0%'), row('Third party · per booking', 4.72)],
          ownVsThirdNote: 'Own-host share of bookings is 36%, up 7pt in three months.',
          selling: [row('Marketplace · 15%', 1022, 100), row('Host’s link · 5%', 293, 29), row('First 90 days · 0%', 0, 0)],
          costs: [row('Revenue', 1315), row('Stripe Connect', -82), row('Payment processing', -5), row('Infrastructure', -4), row('Margin · 93.1%', 1224)],
        },
        activity: {
          channels: [row('Viator · 10%', 571, 100), row('GetYourGuide · 9%', 415, 73)],
          drivers: [row('Bookings', 209), row('Average basket', 47), row('Commission per booking', 4.72)],
          costs: [row('Revenue', 986), row('Payment and infrastructure', -11), row('Margin · 98.9%', 975)],
        },
      },
      grossBookings: 41171,
      refunds: 188,
      costToServe: {
        total: 2926,
        allocated: 2864,
        byKind: [row('Search & discovery', 1127), row('Planning & generation', 1104), row('Routing', 318), row('Payment and store fees', 255), row('Infrastructure', 60)],
        byClass: [row('Serving households', 2864), row('Research', 62)],
        research: 62,
      },
      perSubscriber: { subscription: 6.65, hotel: 5.34, hosting: 2.27, activity: 1.7, total: 15.96, out: 5.05, kept: 10.91 },
      unitEconomics: { ltv: 284, churnPct: 3.8, lifeMonths: 26, cac: 41, paybackMonths: 3.8 },
    },

    // -----------------------------------------------------------------------
    // Subscriptions — the editing screen
    // -----------------------------------------------------------------------
    //
    // Three tiers and what each is sold at, on two channels. The App Store
    // price is higher because Apple keeps 15%, and the panel says so: every
    // subscriber steered to the website is worth 11.6% more.
    //
    // "Revenue at this price" is subscribers × the web monthly, which is a
    // what-if and deliberately not the MRR — the MRR is £3,851 because 47
    // households are on annual at a discount. Two figures that mean different
    // things, so they are labelled differently rather than reconciled.
    subscriptions: {
      tiers: TIERS,
      benefits: BENEFITS,
      channels: {
        rows: [
          { key: 'web', label: 'Our website · Stripe', subscribers: 571, pence: 379100, feePence: 12800 },
          { key: 'ios', label: 'Apple App Store', subscribers: 8, pence: 6000, feePence: 900 },
          { key: 'android', label: 'Google Play', subscribers: null, pence: null, feePence: null },
        ],
        note: 'Apple keeps 15% against 3.4% through the web. Every subscriber steered to the website is worth 11.6% more.',
        net: [row('Website', 3663, 100), row('App Store', 51, 2)],
        blendedFeePct: 3.6,
        // What the bill would be if every subscriber had bought through Apple —
        // the size of the lever, said as a number rather than as advice.
        ifEveryoneUsedApplePence: -44100,
        mrrAfterFeesPence: 371400,
      },
      publishedAt: '2026-09-19T00:00:00.000Z',
      unpublished: 0,
      standing: {
        mrrPence: 385100,
        mrrDelta: 9.2,
        averagePaidPence: 665,
        averagePaidDelta: 3.3,
        onAnnual: 47,
        onAnnualOf: 579,
        onAnnualNote: '8% · the lever nobody is pulling',
      },
    },

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    customers: {
      households: HOUSEHOLDS,
      shown: HOUSEHOLDS.length,
      total: 1284,
      paying: 579,
      payingMrr: 3851,
      trial: 182,
      trialConvertPct: 48,
      trialGranted: 34,
      atRisk: 48,
    },

    // -----------------------------------------------------------------------
    // Suppliers
    // -----------------------------------------------------------------------
    suppliers: {
      rows: SUPPLIERS,
      total: 2926,
      expected: 2640,
      expectedNextMonth: 3180,
      expectedNextMonthDeltaPct: 8.7,
    },

    // -----------------------------------------------------------------------
    // Behaviour
    // -----------------------------------------------------------------------
    behaviour: {
      base: 862,
      measures: [
        { key: 'searches', label: 'Searches', value: 7.1, delta: 6, series: BEHAVIOUR_SERIES.searches },
        { key: 'saves', label: 'Places saved', value: 2.4, delta: 9, series: BEHAVIOUR_SERIES.saves },
        { key: 'out', label: 'Days out', value: 0.76, delta: 6, series: BEHAVIOUR_SERIES.out },
        { key: 'trips', label: 'Trips away', value: 0.18, delta: 20, series: BEHAVIOUR_SERIES.trips },
        { key: 'attended', label: 'Events attended', value: 0.14, delta: 27, series: BEHAVIOUR_SERIES.attended },
        { key: 'hosted', label: 'Events hosted', value: 0.05, delta: 25, series: BEHAVIOUR_SERIES.hosted },
      ],
      panels: {
        searches: {
          asked: [row('Food and drink', '31%', 100), row('Outdoors', '22%', 71), row('Museums and culture', '16%', 52), row('Family activities', '14%', 45), row('Events', '11%', 35), row('Everything else', '6%', 19)],
          became: [row('Nothing', '67%', 100), row('A place saved', '21%', 31), row('Added to a trip', '9%', 13), row('A booking', '3%', 4)],
          becameHighlight: 1,
          funnel: [row('Households who searched', 810), row('Created a trip or saved a place', '612 · 76%'), row('Created nothing at all', '198 · 24%'), rate('Searches before the first save', 4.2)],
        },
        saves: {
          asked: [row('Food and drink', '34%', 100), row('Outdoors', '23%', 68), row('Family activities', '17%', 50), row('Museums and culture', '15%', 44), row('Events', '11%', 32)],
          became: [row('Still on a list', '54%', 100), row('Added to a trip', '31%', 57), row('Actually visited', '19%', 35), row('Removed again', '8%', 15)],
          becameHighlight: 1,
          funnel: [rate('Median places saved', 14), row('0 to 4 places · cancel a month', '9.1%'), row('5 to 29 places', '3.4%'), row('30 or more', '1.4%')],
        },
        out: {
          asked: [row('A meal out', '34%', 100), row('Parks and outdoors', '22%', 65), row('A paid activity', '17%', 50), row('A museum or gallery', '14%', 41), row('A hosted event', '8%', 24), row('Everything else', '5%', 15)],
          became: [row('One', '41%', 100), row('Two', '34%', 83), row('Three', '18%', 44), row('Four or more', '7%', 17)],
          becameHighlight: 1,
          becameFoot: rate('Average', 1.9),
          funnel: [row('Days out', 1966), row('Rated', '1,204 · 61%'), row('Left no signal', '762 · 39%'), row('Good · fine · poor', '71 / 22 / 7')],
        },
        trips: {
          asked: [row('UK coast', '34%', 100), row('A UK city', '28%', 82), row('Countryside', '19%', 56), row('Europe', '14%', 41), row('Further', '5%', 15)],
          became: [row('A hotel', '61%', 100), row('A restaurant', '44%', 72), row('A paid activity', '31%', 51), row('A hosted event', '14%', 23), row('Flights', '12%', 20)],
          becameHighlight: 0,
          funnel: [row('Two nights', '48%'), row('Three nights', '27%'), row('Four to six', '17%'), row('A week or more', '8%'), row('Average', '2.8 nights')],
        },
        attended: {
          asked: [row('A workshop', '29%', 100), row('A walk or tour', '24%', 83), row('Something food', '21%', 72), row('Something for kids', '17%', 59), row('Sport', '9%', 31)],
          became: [row('One-off', '68%', 100), row('A series over weeks', '22%', 32), row('Anytime, on request', '10%', 15)],
          becameHighlight: 0,
          funnel: [row('Rated good', '78%'), row('Booked the same host again', '23%'), row('Left no signal', '22%'), rate('Average party', 2.1)],
        },
        hosted: {
          asked: [row('One-off', '61%', 100), row('A series over weeks', '24%', 39), row('Anytime, on request', '15%', 25)],
          became: [row('Events run this month', 34), row('Fill rate', '68%'), row('Sold out', '22 of 34'), row('Cancelled', '9 of 34')],
          becameHighlight: -1,
          funnel: [row('Started the wizard', 37), row('Published an offer', 23), row('Dropped out', 14), row('Approved hosts selling', '41 of 88')],
        },
      },
      /**
       * How often a household came back. The figure and the bar are the same
       * number here — a share of all 1,284 households — so `pct` carries it
       * too rather than being left null, which drew six 3px stubs and said
       * nothing (20 Sep 2026, looking at the screen).
       */
      returnBuckets: [
        row('Never opened it', 4, 4),
        row('Opened before, not this quarter', 12, 12),
        row('1 to 3 weeks of 13', 31, 31),
        row('4 to 6 weeks', 28, 28),
        row('7 to 9 weeks', 16, 16),
        row('10 to 13 weeks', 9, 9),
      ],
      returnBase: 1284,
      returnHighlight: 3,
    },

    // -----------------------------------------------------------------------
    // twelve months, for anything that can be drilled
    // -----------------------------------------------------------------------
    //
    // A fixed window: "the last twelve months" does not become three months
    // because somebody looked at a quarter, so `scaleFixtures` leaves this
    // alone. Behaviour series are held as **estate totals** here, the same as
    // the real reader returns them, and the Behaviour screen divides by its own
    // base for the per-household view — otherwise the drill would be showing a
    // rate in mock mode and a count in real mode under the same heading.
    history: history(),
  };
}

function history() {
  const months = monthBuckets(new Date());
  const estate = (rates) => rates.map((v) => Math.round(v * 862));
  return {
    labels: months.map((m) => m.label),
    keys: months.map((m) => m.key),
    series: {
      signups: [58, 62, 60, 68, 64, 72, 70, 78, 76, 84, 88, 96],
      revenue: REVENUE_SERIES,
      engagement: [610, 640, 668, 690, 712, 738, 762, 784, 806, 828, 844, 862],
      events: [62, 68, 74, 72, 82, 88, 94, 98, 108, 114, 120, 128],
      subscriptions: STREAM_SERIES.subscriptions,
      hotel: STREAM_SERIES.hotel,
      hosting: STREAM_SERIES.hosting,
      activity: STREAM_SERIES.activity,
      cost: [2180, 2240, 2310, 2280, 2360, 2450, 2540, 2610, 2690, 2760, 2840, 2926],
      searches: estate(BEHAVIOUR_SERIES.searches),
      saves: estate(BEHAVIOUR_SERIES.saves),
      out: estate(BEHAVIOUR_SERIES.out),
      trips: estate(BEHAVIOUR_SERIES.trips),
      attended: estate(BEHAVIOUR_SERIES.attended),
      hosted: estate(BEHAVIOUR_SERIES.hosted),
    },
  };
}

/**
 * The record behind one household on the Customers list.
 *
 * Derived from the row rather than held separately, so the list and the record
 * cannot disagree — the handoff's consistency requirement, which the prototype
 * met the same way. The lifetime subscription figure walks the plan history, so
 * a household that upgraded pays the old price for its earlier months.
 */
export function fixtureHousehold(id) {
  const h = HOUSEHOLDS.find((x) => x.id === id);
  if (!h) return null;

  const now = new Date('2026-09-20T00:00:00Z');
  const joined = new Date(`${h.joined}T00:00:00Z`);
  const lifeMonths = Math.max(1, Math.round((now - joined) / (MONTH_DAYS * 86400000)));

  // A Household plan was Solo for its first 40% — the upgrade the record's
  // subscription history names, and what makes the lifetime figure disagree
  // with "months × today's price" in the right direction.
  const soloMonths = h.plan === 'Household' ? Math.round(lifeMonths * 0.4) : 0;
  const subscriptionPence = soloMonths * 599 + (lifeMonths - soloMonths) * h.monthPence;

  const bookingsEver = Math.round((h.bookings * lifeMonths) / 3);
  const hotels = Math.round(bookingsEver * 0.3);
  const activities = Math.round(bookingsEver * 0.45);
  const events = Math.max(0, bookingsEver - hotels - activities);
  const bookedPence = bookingsEver * 6200;

  const bookedYearPence = h.bookings * 4 * 6200;
  const spentYearPence = h.monthPence * Math.min(12, lifeMonths) + bookedYearPence;
  const spentPrevPence = Math.round(spentYearPence / 1.38);

  const earnedPence = subscriptionPence + Math.round(bookedPence * 0.12);
  const costPence = Math.round(h.daysOut * 410 + h.places * 17 + lifeMonths * 140);

  const intensity = h.places / 24 + h.daysOut / 6;
  const wobble = [0.82, 0.88, 0.95, 0.78, 0.9, 0.97, 1.06, 0.92, 1.04, 1.1, 0.94, 1.15];

  return {
    ...h,
    lifeMonths,
    plans: { soloMonths, upgraded: soloMonths > 0 },
    spend: {
      subscriptionPence,
      bookedPence,
      everPence: subscriptionPence + bookedPence,
      yearPence: spentYearPence,
      previousYearPence: spentPrevPence,
      earnedPence,
      costPence,
      marginPence: earnedPence - costPence,
    },
    bookings: { total: bookingsEver, hotels, activities, events, keptPence: Math.round(bookedPence * 0.12) },
    charts: {
      spend: wobble.map((w, i) => Math.round((h.monthPence + (bookedYearPence / 12) * w) * (0.78 + i * 0.035))),
      searches: wobble.map((w, i) => Math.round((2 + intensity * 5) * w * (0.8 + i * 0.03))),
    },
    inspire: {
      searches90: Math.round(21 * intensity + 9),
      opened: Math.round(13 * intensity + 4),
      savedFrom: Math.round(4 * intensity + 1),
      topCategory: h.places > 25 ? 'Food and drink' : 'Outdoors',
      searchToSavePct: Math.round(18 + intensity * 9),
    },
    placesPanel: {
      saved: h.places,
      addedToTrip: Math.round(h.places * 0.42),
      visited: Math.round(h.places * 0.26),
      addedInPeriod: Math.round(h.places * 0.12),
      cancelRisk: h.places >= 30 ? '1.4% a month' : h.places >= 15 ? '2.6% a month' : h.places >= 5 ? '4.2% a month' : '9.1% a month',
    },
    tripsPanel: {
      daysSignedOff: Math.round(h.daysOut * 1.6),
      daysOut: h.daysOut,
      away: Math.round(h.daysOut * 0.3),
      hotels: Math.round(h.bookings * 0.5),
      flights: h.bookings > 4 ? 1 : 0,
    },
    eventsPanel: {
      attended: Math.round(h.bookings * 0.4),
      hosted: 0,
      ratings: h.ratings,
      ratedGood: h.ratings ? Math.round(h.ratings * 0.72) : null,
      shape: h.bookings > 3 ? 'One-off' : 'A series',
    },
  };
}

/**
 * One supplier's record, in the shape the reader answers in.
 *
 * Derived from the same row the table draws, so the record and the list cannot
 * disagree about spend — the same discipline the household record is under.
 * Every figure in the health panel is on the window, **including the failure
 * denominator**: a failure count that scales against a call count that does not
 * would read as a rate ten times worse than it is.
 */
export function fixtureSupplier(key, period) {
  const base = SUPPLIERS.find((s) => s.key === key);
  if (!base) return null;
  const factor = factorFor(period);
  const at = (v) => (v == null ? null : Math.round(v * factor * 100) / 100);

  const spend = at(base.spend);
  const expected = at(base.expected);
  const calls = base.volume == null ? null : Math.round(base.volume * factor);
  const failures = base.failed == null ? null : Math.round(base.failed * factor);

  return {
    supplier: {
      key: base.key,
      name: base.name,
      direction: base.direction === 'cost' ? 'inbound_cost' : 'outbound_revenue',
      purpose: base.purpose,
      usedBy: base.usedBy,
      costClass: base.costClass,
      unitName: base.unitName,
      status: base.status,
      adapterState: base.adapterState,
      credentialMasked: base.credentialMasked,
      credentialExpiry: base.credentialExpiry,
      rotatedAt: null,
      allowanceNote: base.allowanceNote,
      rate: { says: base.unitCost, amount: null, unit: base.unitName, currency: 'GBP', confirmedAt: base.confirmed ?? null, confirmedBy: base.confirmed ? 'the owner' : null, sourceUrl: null },
      history: [{ says: base.unitCost, from: '2026-09-19T00:00:00.000Z', to: null, confirmedAt: base.confirmed ?? null, confirmedBy: null, sourceUrl: null }],
    },
    health: {
      calls,
      failures,
      failurePct: failures == null || !calls ? null : Math.round((failures / calls) * 1000) / 10,
      latency: base.latency,
      healthGap: null,
      spend,
      expected,
      variance: spend == null || expected == null ? null : Math.round((spend - expected) * 100) / 100,
      variancePct: spend == null || !expected ? null : Math.round(((spend - expected) / expected) * 1000) / 10,
      currency: 'gbp',
      gap: null,
    },
    series: base.series,
  };
}

/**
 * Put the model's monthly flows on the window that is being asked for.
 *
 * `kind` decides, and only `flow` moves. A stock is a count at a moment and a
 * rate is already "a month"; multiplying either is the mistake this whole file
 * is arranged to prevent.
 */
export function scaleFixtures(model, period) {
  const factor = factorFor(period);
  const scale = (v) => (typeof v === 'number' ? Math.round(v * factor * 100) / 100 : v);
  const scaleRows = (rows) => rows?.map((r) => ({ ...r, value: scale(r.value) }));

  const m = structuredClone(model);

  m.period = { key: period.key, label: period.label, months: period.months, factor };

  /**
   * A sentence under a figure names the same number the figure does.
   *
   * The handoff: "Derived copy must come from the same scaled numbers as the
   * figure it sits under, never a hardcoded string." So a note written as
   * "The {21} who booked something…" has its `{21}` replaced with 21 on the
   * selected window — and at three months it reads "the 62", not "the 21".
   */
  const fillNote = (text) => (typeof text === 'string'
    ? text.replace(/\{(\d+(?:\.\d+)?)\}/g, (_, n) => Math.round(Number(n) * factor).toLocaleString())
    : text);

  m.overview.measures = m.overview.measures.map((mm) => (mm.kind === 'flow'
    ? { ...mm, value: scale(mm.value), expected: scale(mm.expected) }
    : mm));

  const s = m.overview.subscriptions;
  s.added = scale(s.added);
  s.lost = scale(s.lost);
  s.opening = Math.round(s.live - s.added + s.lost);
  s.arrivals = scaleRows(s.arrivals);
  s.sources = scaleRows(s.sources);

  s.arrivalsNote = fillNote(s.arrivalsNote);
  s.sourcesNote = fillNote(s.sourcesNote);

  m.overview.revenue.byStream = scaleRows(m.overview.revenue.byStream);
  m.overview.engagement.visits = scale(m.overview.engagement.visits);
  m.overview.engagement.newVisits = scale(m.overview.engagement.newVisits);
  m.overview.engagement.returningVisits = scale(m.overview.engagement.returningVisits);
  m.overview.events.ran = scale(m.overview.events.ran);
  m.overview.events.guests = scale(m.overview.events.guests);
  m.overview.events.selling = scaleRows(m.overview.events.selling);
  m.overview.standing.directBookings = scale(m.overview.standing.directBookings);

  m.money.streams = m.money.streams.map((st) => ({
    ...st,
    revenue: scale(st.revenue),
    cost: scale(st.cost),
    margin: scale(st.margin),
    units: st.units == null ? null : scale(st.units),
    // `avgUnit` is a rate — what one booking was worth — and never scales.
    details: st.details?.map((d) => ({
      ...d,
      revenue: scale(d.revenue),
      units: d.units == null ? null : scale(d.units),
    })),
  }));
  m.money.total = { ...m.money.total, revenue: scale(m.money.total.revenue), cost: scale(m.money.total.cost), margin: scale(m.money.total.margin) };
  for (const k of Object.keys(m.money.breakdown)) {
    const b = m.money.breakdown[k];
    for (const field of Object.keys(b)) if (Array.isArray(b[field])) b[field] = scaleRows(b[field]);
  }
  m.money.grossBookings = scale(m.money.grossBookings);
  m.money.refunds = scale(m.money.refunds);
  m.money.costToServe = {
    ...m.money.costToServe,
    total: scale(m.money.costToServe.total),
    allocated: scale(m.money.costToServe.allocated),
    research: scale(m.money.costToServe.research),
    byKind: scaleRows(m.money.costToServe.byKind),
    byClass: scaleRows(m.money.costToServe.byClass),
  };

  /**
   * Subscriptions.
   *
   * Almost nothing here moves with the picker, and that is the point. A price
   * is a price; a tier's subscriber count is a stock; MRR and the average price
   * paid are rates and are said "a month". The only flows are what each channel
   * took over the window and the fee that came off it.
   */
  m.subscriptions.channels = {
    ...m.subscriptions.channels,
    rows: m.subscriptions.channels.rows.map((r) => ({
      ...r,
      pence: r.pence == null ? null : Math.round(r.pence * factor),
      feePence: r.feePence == null ? null : Math.round(r.feePence * factor),
    })),
    net: scaleRows(m.subscriptions.channels.net),
    mrrAfterFeesPence: m.subscriptions.channels.mrrAfterFeesPence,
    ifEveryoneUsedApplePence: Math.round(m.subscriptions.channels.ifEveryoneUsedApplePence * factor),
  };

  /**
   * Behaviour's panels.
   *
   * The tiles are rates — how much one household does in a month — and never
   * move. The panels underneath are a mix: a share ("31%", "67%") is a share
   * whatever the window, and a count (810 households who searched, 1,966 days
   * out, 34 events run, 37 who started the wizard) is a flow. Leaving the
   * counts monthly while every other screen moved was the stock/flow rule
   * broken in the one place it is hardest to see (20 Sep 2026).
   */
  for (const key of Object.keys(m.behaviour.panels)) {
    const panel = m.behaviour.panels[key];
    // A number in these lists is a count; a string is already a share or an
    // average and is left exactly as it is.
    /**
     * A number in these lists is a count and is whole — 2,389.5 households did
     * not search for anything. A row marked `rate` is an average or a median
     * and stays exactly as it is, and a string is already a share.
     */
    const scaleCounts = (rows) => rows?.map((r) => (
      typeof r.value === 'number' && !r.rate
        ? { ...r, value: Math.round(r.value * factor) }
        : r));
    panel.asked = scaleCounts(panel.asked);
    panel.became = scaleCounts(panel.became);
    panel.funnel = scaleCounts(panel.funnel);
    if (panel.becameFoot) panel.becameFoot = { ...panel.becameFoot };
  }
  // How often a household came back is a fixed window — thirteen weeks of a
  // quarter — and its own denominator. Neither moves with the picker.

  m.suppliers.rows = m.suppliers.rows.map((r) => ({
    ...r,
    // Volume scales with the period, like the spend it prices, and `expected`
    // is the same window rather than a monthly average — the handoff's own
    // worked example of the stock/flow rule.
    volume: r.volume == null ? null : Math.round(r.volume * factor),
    spend: scale(r.spend),
    expected: scale(r.expected),
    // Share is worked out from the spend rather than stated, so the column adds
    // to a hundred and the row reconciles with the two beside it.
    share: Math.round((r.spend / model.suppliers.total) * 1000) / 10,
    // Failures scale with the calls that produced them: a numerator that moves
    // against a denominator that does not is worse than no figure at all.
    failed: r.failed == null ? null : Math.round(r.failed * factor),
    gap: null,
  }));
  m.suppliers.total = scale(m.suppliers.total);
  m.suppliers.expected = scale(m.suppliers.expected);
  m.suppliers.largest = [...m.suppliers.rows].sort((a, b) => b.spend - a.spend)[0] ?? null;

  return m;
}

/**
 * How many months of flow the window holds.
 *
 * The prototype's own factors, and they are only used in mock mode: a real
 * answer comes from a date-range query, and this exists so that the fixtures
 * behave the way the real numbers will when the picker is moved.
 */
function factorFor(period) {
  switch (period.key) {
    case 'last-30-days': return 1;
    case 'this-month': return 1;
    case 'last-month': return 0.92;
    case 'last-3-months': return 2.95;
    default: return 11.4;
  }
}
