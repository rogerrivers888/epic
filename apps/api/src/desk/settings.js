/**
 * The back office's settings: one table, read at run time, every change
 * logged with who, when, before and after (handover 5.1, "Epic — Back office
 * handover", 28 Sep 2026).
 *
 * Every rule the machine follows — how many sources must agree, how often a
 * fact is re-checked, how thin a collection may be — is a row here, so
 * changing one is a person's decision that the Changes log records, and
 * nothing that reads a rule can disagree with the screen that shows it.
 */

import { query, withTransaction } from '../db.js';
import { logChange } from './changes.js';

/**
 * What each setting is, for validation and for the screens. `min`/`max` bound
 * a number; `kind` says how the value is shaped. The labels are the words the
 * Fact automations sentences use beside each stepper.
 */
export const SETTINGS = {
  spotMentions:        { kind: 'int', min: 1, max: 20, unit: 'mention' },
  suggestReviews:      { kind: 'int', min: 1, max: 20, unit: 'review' },
  verifySources:       { kind: 'int', min: 1, max: 5, unit: 'source' },
  venueWins:           { kind: 'bool' },
  addPlaces:           { kind: 'int', min: 1, max: 50, unit: 'place' },
  shareMax:            { kind: 'int', min: 50, max: 100, step: 5, unit: '%' },
  recheckPhysical:     { kind: 'int', min: 1, max: 60, unit: 'month' },
  recheckAccess:       { kind: 'int', min: 1, max: 60, unit: 'month' },
  recheckFood:         { kind: 'int', min: 1, max: 60, unit: 'month' },
  suggestExpiry:       { kind: 'int', min: 1, max: 365, unit: 'day' },
  askPerVisit:         { kind: 'int', min: 0, max: 5, unit: 'question' },
  familiesSettle:      { kind: 'int', min: 1, max: 20, unit: 'family' },
  familiesWrong:       { kind: 'int', min: 1, max: 20, unit: 'family' },
  collectionMinPlaces: { kind: 'int', min: 1, max: 50, unit: 'place' },
  sourceSlow:          { kind: 'int', min: 1, max: 100, unit: '%' },
  sourceFailing:       { kind: 'int', min: 1, max: 100, unit: '%' },
  budgetGoogle:        { kind: 'int', min: 0, max: 100000, unit: '£' },
  budgetClaude:        { kind: 'int', min: 0, max: 100000, unit: '£' },
  // Which open-map extracts Epic keeps its own copy of (handover 5.3). Config,
  // not a button: setting it starts the load. EPIC_OSM_EXTRACT overrides it.
  osmRegions:          { kind: 'regions', allowed: ['great-britain', 'ireland-and-northern-ireland'] },
  // What Google's billing says: usage before credit, credit left and when it
  // expires. Seeded from the console (29 Sep 2026) until the BigQuery export
  // is read; the Overview spend tile judges budgets on usage, not on credit.
  billing:             { kind: 'billing' },
  // What Anthropic's console says Claude cost this month, in dollars, and the
  // prepaid credit left (owner, 29 Sep 2026) — the ledger's figure is an
  // estimate at whichever rate each caller assumed.
  claudeBilling:       { kind: 'claudeBilling' },
  ageBands:            { kind: 'bands' },
  durationBands:       { kind: 'bands' },
  costBands:           { kind: 'cost' },
};

/**
 * The defaults, for a database that has not run migration 266 yet and for the
 * tests. The migration seeds the same values; the table wins whenever it
 * answers.
 */
export const DEFAULTS = {
  spotMentions: 1, suggestReviews: 2, verifySources: 1, venueWins: true, addPlaces: 2, shareMax: 90,
  recheckPhysical: 12, recheckAccess: 6, recheckFood: 6, suggestExpiry: 30, askPerVisit: 1,
  familiesSettle: 2, familiesWrong: 2, collectionMinPlaces: 4, sourceSlow: 5, sourceFailing: 15,
  budgetGoogle: 50, budgetClaude: 30,
  osmRegions: [],
  billing: null,
  claudeBilling: null,
  ageBands: [
    { key: 'babies', label: 'Babies under 2', from: 0, to: 1 },
    { key: 'toddlers', label: 'Toddlers 2–4', from: 2, to: 4 },
    { key: 'young', label: 'Young children 5–8', from: 5, to: 8 },
    { key: 'older', label: 'Older children 9–12', from: 9, to: 12 },
    { key: 'teens', label: 'Teens 13–17', from: 13, to: 17 },
    { key: 'adults', label: 'Adults 18+', from: 18, to: 99 },
  ],
  durationBands: [
    { key: 'under1', label: 'Under 1 hour', from: 0, to: 59 },
    { key: '1to2', label: '1–2 hours', from: 60, to: 120 },
    { key: '2to3', label: '2–3 hours', from: 121, to: 180 },
    { key: 'half', label: 'Half a day', from: 181, to: 300 },
    { key: 'full', label: 'A full day', from: 301, to: 720 },
  ],
  costBands: {
    GB: { currency: 'GBP', bands: [{ key: 'Free', label: 'Free', to: 0 }, { key: 'Cheap', label: 'Cheap', under: 10 }, { key: 'Mid', label: 'Mid', from: 10, to: 25 }, { key: 'Dear', label: 'Dear', over: 25 }] },
    IE: { currency: 'EUR', bands: [{ key: 'Free', label: 'Free', to: 0 }, { key: 'Cheap', label: 'Cheap', under: 12 }, { key: 'Mid', label: 'Mid', from: 12, to: 30 }, { key: 'Dear', label: 'Dear', over: 30 }] },
  },
};

let cache = null;
let cachedAt = 0;
const TTL_MS = 5_000;
export const forget = () => { cache = null; };

/** Every setting, the table's value where it has one. */
export async function settings() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const { rows } = await query('select key, value, version, updated_by, updated_at from bo_settings')
    .catch(() => ({ rows: [] }));
  const values = { ...DEFAULTS };
  const meta = {};
  for (const r of rows) {
    if (!(r.key in SETTINGS)) continue;
    values[r.key] = r.value;
    meta[r.key] = { version: r.version, by: r.updated_by, at: r.updated_at };
  }
  cache = { values, meta };
  cachedAt = Date.now();
  return cache;
}

/** One setting's value. */
export async function setting(key) {
  const { values } = await settings();
  return values[key];
}

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

/** Whether a value is a shape this setting takes, returned cleaned. */
export function validate(key, value) {
  const spec = SETTINGS[key];
  if (!spec) throw bad(`${key} is not a setting`);
  if (spec.kind === 'bool') {
    if (typeof value !== 'boolean') throw bad(`${key} is a switch: true or false`);
    return value;
  }
  if (spec.kind === 'int') {
    const n = Number(value);
    if (!Number.isInteger(n)) throw bad(`${key} is a whole number`);
    if (n < spec.min || n > spec.max) throw bad(`${key} is between ${spec.min} and ${spec.max}`);
    return n;
  }
  if (spec.kind === 'bands') {
    if (!Array.isArray(value) || !value.length) throw bad(`${key} is a list of bands`);
    for (const b of value) {
      if (!b || typeof b.label !== 'string' || !b.label.trim() || typeof b.key !== 'string') throw bad(`every band in ${key} has a key and a label`);
    }
    return value;
  }
  if (spec.kind === 'regions') {
    if (!Array.isArray(value) || value.some((r) => !spec.allowed.includes(r))) throw bad(`${key} is a list of: ${spec.allowed.join(', ')}`);
    return [...new Set(value)];
  }
  if (spec.kind === 'billing') {
    if (value === null) return null;
    const ok = value && typeof value === 'object'
      && Number.isFinite(Number(value.usageGbp)) && Number.isFinite(Number(value.creditGbp))
      && /^\d{4}-\d{2}-\d{2}$/.test(String(value.creditExpires ?? '')) && /^\d{4}-\d{2}$/.test(String(value.month ?? ''));
    if (!ok) throw bad(`${key} needs month (YYYY-MM), usageGbp, creditGbp and creditExpires (YYYY-MM-DD)`);
    return { month: String(value.month), usageGbp: Number(value.usageGbp), paidGbp: Number(value.paidGbp ?? 0), creditGbp: Number(value.creditGbp),
      creditTotalGbp: value.creditTotalGbp == null ? null : Number(value.creditTotalGbp), creditExpires: String(value.creditExpires),
      source: String(value.source ?? 'console'), at: String(value.at ?? new Date().toISOString()) };
  }
  if (spec.kind === 'claudeBilling') {
    if (value === null) return null;
    const ok = value && typeof value === 'object' && Number.isFinite(Number(value.usd)) && /^\d{4}-\d{2}$/.test(String(value.month ?? ''));
    if (!ok) throw bad(`${key} needs month (YYYY-MM) and usd`);
    return { month: String(value.month), usd: Number(value.usd), gbp: value.gbp == null ? null : Number(value.gbp),
      creditUsd: value.creditUsd == null ? null : Number(value.creditUsd),
      source: String(value.source ?? 'Anthropic console'), at: String(value.at ?? new Date().toISOString()) };
  }
  if (spec.kind === 'cost') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad(`${key} is bands per country`);
    for (const [country, v] of Object.entries(value)) {
      if (!/^[A-Z]{2}$/.test(country) || !Array.isArray(v?.bands) || !v.currency) throw bad(`${key}.${country} needs a currency and bands`);
    }
    return value;
  }
  throw bad(`${key} cannot be set here`);
}

/**
 * A Fact automations setting's row, as the screen reads it, with `{}` where
 * the value goes (prototype `RULE_STEPS`, `RULE_HOUSEKEEPING`). Changes'
 * "What changed" is composed here from the key and the new value — never
 * taken from the client, which could write anything into the audit trail
 * (second audit CH.6). A key with no row reads "Setting · <key>".
 */
export const SENTENCES = {
  spotMentions: 'A review mentions a feature at a place → we go and look for it on our own sources · {} mention',
  suggestReviews: 'A household is shown “reviewers mention a sauna” during its search once {} separate reviews say so and none say no',
  verifySources: 'Verified: {} or more of our own sources say yes and none say no · venue page, OpenStreetMap, Wikipedia, Wikidata',
  venueWins: 'When our sources disagree, the venue’s own website wins',
  addPlaces: 'Once verified at {} or more places, it joins the subcategory’s facts, looked for as each place comes up · listed under New facts',
  shareMax: 'Not added if more than {}% of places already have it — it tells a family nothing · access and age facts are exempt',
  recheckPhysical: 'Physical features are re-checked every {} months',
  recheckAccess: 'Access features are re-checked every {} months',
  recheckFood: 'Food and dietary facts are re-checked every {} months',
  askPerVisit: 'Ask families about a fact after their visit, only where it matters to them — a toddler pool only to households with a toddler · at most {} question per visit',
  familiesSettle: '{} or more families agreeing, none disagreeing, settles a fact',
  familiesWrong: 'If {} or more families say a fact is wrong, it’s hidden and re-checked when next due; if our sources confirm it again, the next families who visit are asked',
  suggestExpiry: 'A suggestion still in the backlog is dropped after {} days',
  osmRegions: 'Our own copy of the open map is kept for · {}',
  billing: 'Google billing · {}',
  claudeBilling: 'Claude billing · {}',
};

/** "What changed" for a setting set to `value`: its row with the value filled in. */
export function sentenceFor(key, value) {
  const row = SENTENCES[key];
  if (!row) return `Setting · ${key}`;
  const words = typeof value === 'number' ? String(value)
    : Array.isArray(value) ? (value.length ? value.join(', ') : 'nowhere')
      : value && typeof value === 'object' && 'usd' in value ? `${value.month}: $${value.usd.toFixed(2)}${value.creditUsd == null ? '' : `, $${value.creditUsd.toFixed(2)} credit left`}`
      : value && typeof value === 'object' && 'usageGbp' in value ? `${value.month}: usage £${value.usageGbp.toFixed(2)}, £${value.creditGbp.toFixed(2)} credit left, expires ${value.creditExpires}`
        : '';
  return row.replace('{}', words);
}

/** How a value reads in the Changes log. */
export function said(key, value) {
  if (value == null) return '—';
  const unit = SETTINGS[key]?.unit;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') return unit === '%' ? `${value}%` : unit === '£' ? `£${value}` : String(value);
  if (Array.isArray(value)) return value.length ? value.map((b) => (typeof b === 'string' ? b : b.label)).join(' · ') : 'None';
  if (typeof value === 'object' && 'usd' in value) return `$${value.usd.toFixed(2)} used`;
  if (typeof value === 'object' && 'usageGbp' in value) return `£${value.usageGbp.toFixed(2)} used · £${value.creditGbp.toFixed(2)} credit`;
  return JSON.stringify(value);
}

/**
 * Change one setting. Refused where the value is the same shape and number as
 * it already is (a change that changes nothing is not written down). Logged in
 * `bo_settings_log` and in Changes under Fact automations, in one transaction.
 */
// `what` is for the server's own callers only (the undo route's "Undo · …");
// the PUT route never passes the client's words through.
export async function setSetting(key, raw, { who, what = null } = {}) {
  const value = validate(key, raw);
  const out = await withTransaction(async (c) => {
    const { rows: [was] } = await c.query('select value, version from bo_settings where key = $1 for update', [key]);
    const before = was ? was.value : DEFAULTS[key];
    if (JSON.stringify(before) === JSON.stringify(value)) return { changed: false, value };
    const version = (was?.version ?? 0) + 1;
    await c.query(
      `insert into bo_settings (key, value, version, updated_by, updated_at) values ($1, $2::jsonb, $3, $4, now())
       on conflict (key) do update set value = excluded.value, version = excluded.version,
         updated_by = excluded.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), version, who]);
    await c.query(
      'insert into bo_settings_log (key, version, before, after, who) values ($1, $2, $3::jsonb, $4::jsonb, $5)',
      [key, version, JSON.stringify(before ?? null), JSON.stringify(value), who]);
    // The change's id goes back to the screen, so the toast's Undo names it.
    const change = await logChange({
      client: c, who, area: 'Fact automations', what: what ?? sentenceFor(key, value),
      before: said(key, before), after: said(key, value),
      subjectType: 'setting', subjectId: key, undo: { kind: 'setting', key, value: before },
    });
    return { changed: true, value, version, change: change.id };
  });
  forget();
  return out;
}
