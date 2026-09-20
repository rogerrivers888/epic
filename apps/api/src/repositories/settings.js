/**
 * Non-secret settings the owner changes from the app: which sources are
 * switched off.
 *
 * A provider key never lands here — keys come from Doppler at runtime
 * (CLAUDE.md). This is the switch beside the key, not the key.
 */

import { query } from '../db.js';

export async function sourcesOff() {
  const { rows } = await query("select value from app_settings where key = 'sources.off'");
  return Array.isArray(rows[0]?.value) ? rows[0].value.map(String) : [];
}

export async function setSourcesOff(keys) {
  await query(
    `insert into app_settings (key, value, updated_at) values ('sources.off', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(keys)],
  );
}

/**
 * The thresholds the filing screens judge by.
 *
 * Every one of these is a number somebody guessed on one county, and the
 * Overview says so in red: "provisional · set on Berkshire, revisit after the
 * census" (the Places redesign, 20 Sep 2026). They are settings rather than
 * constants because the whole point is that they will be wrong at first and
 * the owner changes them from the screen when they are — a threshold you have
 * to deploy to move is a threshold nobody moves.
 *
 * `step` is what the screen's − and + do, and it lives here rather than on the
 * screen so that a number and the way it is nudged can never disagree.
 */
export const THRESHOLDS = [
  { key: 'sightingFloor', label: 'Sightings before a word can be asked', value: 2, step: 1, min: 0,
    why: 'candidates below this sit in "too thin to judge"' },
  { key: 'distinctLow', label: 'Distinctive below this share', value: 0.2, step: 0.05, min: 0, max: 1,
    why: 'a word on fewer places than this tells two places apart' },
  { key: 'distinctHigh', label: 'Useless above this share', value: 0.8, step: 0.05, min: 0, max: 1,
    why: 'a word on more places than this tells you nothing' },
  { key: 'saturationLimit', label: 'New words per ten places to settle', value: 1, step: 0.5, min: 0,
    why: 'below this a set can stop reading reviews' },
  { key: 'minRowFill', label: 'Places before a row is shown', value: 4, step: 1, min: 0,
    why: 'a hearted row below this waits quietly' },
  { key: 'spreadLimit', label: 'Facet disagreement that marks a subcategory Mixed', value: 0.35, step: 0.05, min: 0, max: 1,
    why: 'share of places that disagree with the default' },
];

const THRESHOLD_BY_KEY = new Map(THRESHOLDS.map((t) => [t.key, t]));

/** Every threshold with the value in force, which is the owner's where he has set one. */
export async function thresholds() {
  const { rows } = await query("select value from app_settings where key = 'filing.thresholds'");
  const saved = rows[0]?.value && typeof rows[0].value === 'object' ? rows[0].value : {};
  return THRESHOLDS.map((t) => ({
    ...t,
    value: Number.isFinite(Number(saved[t.key])) ? Number(saved[t.key]) : t.value,
    changed: Number.isFinite(Number(saved[t.key])) && Number(saved[t.key]) !== t.value,
  }));
}

/** The values alone, keyed, for code that is deciding rather than drawing. */
export async function thresholdValues() {
  const list = await thresholds();
  return Object.fromEntries(list.map((t) => [t.key, t.value]));
}

export async function setThreshold(key, value) {
  const spec = THRESHOLD_BY_KEY.get(String(key));
  if (!spec) {
    throw Object.assign(new Error(`${key} is not one of the thresholds.`), { status: 400, code: 'bad_request' });
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`${spec.label} is a number.`), { status: 400, code: 'bad_request' });
  }
  // Clamped rather than refused: the screen's − and + can walk a share past
  // its ends, and stopping at the end is what somebody holding one down means.
  // Rounded to the hundredth because the steps are twentieths and floating
  // point would otherwise write 0.30000000000000004 into the settings.
  const lo = spec.min ?? Number.NEGATIVE_INFINITY;
  const hi = spec.max ?? Number.POSITIVE_INFINITY;
  const clamped = Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100;
  const { rows } = await query("select value from app_settings where key = 'filing.thresholds'");
  const saved = rows[0]?.value && typeof rows[0].value === 'object' ? { ...rows[0].value } : {};
  saved[spec.key] = clamped;
  await query(
    `insert into app_settings (key, value, updated_at) values ('filing.thresholds', $1, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(saved)],
  );
  return { ...spec, value: clamped, changed: clamped !== spec.value };
}
