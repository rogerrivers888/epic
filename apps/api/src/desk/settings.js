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
  if (spec.kind === 'cost') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad(`${key} is bands per country`);
    for (const [country, v] of Object.entries(value)) {
      if (!/^[A-Z]{2}$/.test(country) || !Array.isArray(v?.bands) || !v.currency) throw bad(`${key}.${country} needs a currency and bands`);
    }
    return value;
  }
  throw bad(`${key} cannot be set here`);
}

/** How a value reads in the Changes log. */
export function said(key, value) {
  if (value == null) return '—';
  const unit = SETTINGS[key]?.unit;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') return unit === '%' ? `${value}%` : unit === '£' ? `£${value}` : String(value);
  return Array.isArray(value) ? value.map((b) => b.label).join(' · ') : JSON.stringify(value);
}

/**
 * Change one setting. Refused where the value is the same shape and number as
 * it already is (a change that changes nothing is not written down). Logged in
 * `bo_settings_log` and in Changes under Fact automations, in one transaction.
 */
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
    await logChange({
      client: c, who, area: 'Fact automations', what: what ?? `Setting · ${key}`,
      before: said(key, before), after: said(key, value),
      subjectType: 'setting', subjectId: key, undo: { kind: 'setting', key, value: before },
    });
    return { changed: true, value, version };
  });
  forget();
  return out;
}
