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
/**
 * The six harvest thresholds are retired (back-office handover 5.1, C50; owner,
 * 28 Sep 2026). Three were duplicates of the desk's own settings and are now
 * views of them, so there is one number for each thing:
 *
 *   sightingFloor → spotMentions         (sightings before we go and look)
 *   distinctHigh  → shareMax / 100       (a word on more places tells you nothing)
 *   minRowFill    → collectionMinPlaces  (places before a collection is shown)
 *
 * Three are deleted: distinctLow (read only by the old Facts screen, which is
 * gone), spreadLimit and saturationLimit (read only by the old filing routes
 * and the Runs funnel, which now use the fixed values below — the values they
 * had in production, never changed from their defaults).
 */
export const SPREAD_LIMIT = 0.35;
export const SATURATION_LIMIT = 1;

export const THRESHOLDS = [
  { key: 'sightingFloor', setting: 'spotMentions', label: 'Review mentions before we go and look', step: 1, min: 1, scale: 1,
    why: 'the same number as Fact automations › Spot' },
  { key: 'distinctHigh', setting: 'shareMax', label: 'Useless above this share', step: 0.05, min: 0.5, max: 1, scale: 100,
    why: 'the same number as Fact automations › Add' },
  { key: 'minRowFill', setting: 'collectionMinPlaces', label: 'Places before a collection is shown', step: 1, min: 1, scale: 1,
    why: 'the same number as the collections rule' },
];

const THRESHOLD_BY_KEY = new Map(THRESHOLDS.map((t) => [t.key, t]));

/** Every threshold, read from the desk's settings (one number for each thing). */
export async function thresholds() {
  const { settings } = await import('../desk/settings.js');
  const { values, meta } = await settings();
  return THRESHOLDS.map((t) => ({
    ...t,
    value: Number(values[t.setting]) / t.scale,
    changed: Boolean(meta[t.setting]?.version > 1),
  }));
}

/** The values alone, keyed, for code that is deciding rather than drawing. */
export async function thresholdValues() {
  const list = await thresholds();
  return { ...Object.fromEntries(list.map((t) => [t.key, t.value])), spreadLimit: SPREAD_LIMIT, saturationLimit: SATURATION_LIMIT };
}

/** Setting a retired threshold sets the desk setting it is a view of. */
export async function setThreshold(key, value, who = 'the owner (passcode)') {
  const spec = THRESHOLD_BY_KEY.get(String(key));
  if (!spec) {
    throw Object.assign(new Error(`${key} is not one of the thresholds; it is set on Fact automations.`), { status: 400, code: 'bad_request' });
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw Object.assign(new Error(`${spec.label} is a number.`), { status: 400, code: 'bad_request' });
  }
  const { setSetting } = await import('../desk/settings.js');
  await setSetting(spec.setting, Math.round(n * spec.scale), { who });
  // One threshold, the shape the route and the old screen read (Codex, 28 Sep 2026).
  return (await thresholds()).find((t) => t.key === spec.key);
}

/**
 * When the bar invariants last ran, and what they found.
 *
 * The owner, 24 Sep 2026: "Surface the result on Overview: when they last ran
 * and what they found. A silent pass and a run that never happened must not
 * look the same." So the record is the thing: no row is "never ran", and a row
 * saying nought is a pass. Kept as one setting holding the last run and a
 * short history rather than a table, because the question is "when did this
 * last run and what did it see", not an audit trail -- and the history is
 * enough to tell a repair that stuck from one that keeps coming back.
 */
const INVARIANTS_KEY = 'invariants.bars';
const HISTORY = 14;

export async function invariantRuns() {
  const { rows } = await query('select value from app_settings where key = $1', [INVARIANTS_KEY]);
  const v = rows[0]?.value;
  if (!v || typeof v !== 'object' || !v.last) return null;
  return { last: v.last, history: Array.isArray(v.history) ? v.history : [] };
}

export async function noteInvariantRun(run) {
  const prior = await invariantRuns();
  const history = [run, ...(prior?.history ?? [])].slice(0, HISTORY);
  await query(
    `insert into app_settings (key, value, updated_at) values ($1, $2, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [INVARIANTS_KEY, JSON.stringify({ last: run, history })],
  );
  return run;
}
