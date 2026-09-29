/**
 * The Markets tab (ADMIN › Markets). Epic — Markets: design brief, step 4.
 *
 * Reads for the markets list and a market's page, and the wording store the
 * wording screen edits. Not translation: en-GB and en-US, and a rule for
 * choosing between them (see `domain/wording.js`). Every edit is logged in
 * Changes and says who made it.
 *
 * Blocked markets are never rows — they are the code constant
 * (`domain/markets.js`), read here for the read-only list the screen shows.
 */

import { query, withTransaction } from '../db.js';
import { logChange } from './changes.js';
import { BLOCKED_MARKETS } from '../domain/markets.js';
import { NAMESPACES, hasDrifted } from '../domain/wording.js';

/* ------------------------------------------------------------------ markets */

/** The markets list: every market with its places count. */
export async function listMarkets() {
  const { rows } = await query(
    `select m.*, coalesce(p.n, 0)::int as places
       from markets m
       left join (select upper(country_code) as cc, count(*) n from place_index group by upper(country_code)) p
         on p.cc = m.code
      order by array_position(array['live','soft','groundwork'], m.status), m.name`);
  return rows.map(marketView);
}

/** One market, with its not-applicable subcategories. */
export async function getMarket(code) {
  const c = String(code || '').toUpperCase();
  const { rows } = await query('select * from markets where code = $1', [c]);
  if (!rows[0]) return null;
  const [{ n }] = (await query('select count(*)::int n from place_index where upper(country_code) = $1', [c])).rows;
  const { rows: subs } = await query(
    'select subcategory, applicable, set_by, at from market_subcategories where market_code = $1 order by subcategory', [c]);
  return {
    ...marketView({ ...rows[0], places: n }),
    notApplicable: subs.filter((s) => !s.applicable).map((s) => s.subcategory),
  };
}

/**
 * Wire up a source that exists in a market but was not connected yet — the
 * Connect action on the market page. Absent sources (they cannot exist here)
 * and already-connected ones are refused. Logged and undoable.
 */
export async function connectSource(code, sourceId, who) {
  if (!who) throw bad('a change says who made it');
  const c = String(code || '').toUpperCase();
  return withTransaction(async (client) => {
    const { rows: [m] } = await client.query('select sources from markets where code = $1 for update', [c]);
    if (!m) throw bad(`no market ${c}`);
    const src = (m.sources ?? []).find((s) => s.id === sourceId);
    if (!src) throw bad(`${c} has no source ${sourceId}`);
    if (src.state === 'absent') throw bad(`${sourceId} cannot exist in ${c}`);
    if (src.state === 'connected') return { ok: true, unchanged: true };
    const next = (m.sources ?? []).map((s) => (s.id === sourceId ? { id: s.id, state: 'connected' } : s));
    await client.query('update markets set sources = $2, updated_at = now() where code = $1', [c, JSON.stringify(next)]);
    const change = await logChange({ client, who, area: 'Markets', what: `connected ${sourceId} in ${c}`,
      before: src.state, after: 'connected', subjectType: 'market', subjectId: `${c}/source/${sourceId}`,
      undo: { kind: 'market_source', code: c, sourceId, before: src } });
    return { ok: true, change: change.id };
  });
}

/** Undo a source connection — restore its prior state and note. */
export async function undoMarketSource({ change, who }) {
  const u = change.undo ?? {};
  const { markUndone } = await import('./changes.js');
  return withTransaction(async (client) => {
    const { rows: [m] } = await client.query('select sources from markets where code = $1 for update', [u.code]);
    if (m) {
      const next = (m.sources ?? []).map((s) => (s.id === u.sourceId ? u.before : s));
      await client.query('update markets set sources = $2, updated_at = now() where code = $1', [u.code, JSON.stringify(next)]);
    }
    await markUndone({ id: change.id, who, client });
  });
}

/** The nine prohibited territories, from the code constant — never rows. */
export function blockedMarkets() {
  return BLOCKED_MARKETS.map((m) => ({ code: m.code, name: m.name, note: m.note ?? null }));
}

/**
 * A market as the screen wants it: camel-cased, with the "before it goes live"
 * checklist derived rather than stored, so it cannot drift from the data.
 */
function marketView(m) {
  const costBands = m.cost_bands ?? null;
  const sources = m.sources ?? [];
  // A source absent in a country is not counted against it. Of the ones that
  // CAN exist here (connected or not-yet-connected), how many are connected.
  const canExist = sources.filter((s) => s.state !== 'absent');
  const connected = sources.filter((s) => s.state === 'connected').length;
  const checklist = {
    // Cost bands set (a judgement made), or "don't know" until then.
    costBands: Array.isArray(costBands) && costBands.length > 0,
    // The area shape known (a code type and pattern), or town-only until loaded.
    area: m.area_code != null,
    // The sources that exist everywhere must be present and connected, and
    // nothing that exists here is left unconnected. An empty or thin source
    // list is not ready (Codex — do not fail open); a source that cannot exist
    // here never counts against it (design v2.2).
    sources: ['osm', 'wikidata', 'wikipedia', 'site'].every(
      (id) => sources.some((s) => s.id === id && s.state === 'connected'))
      && !sources.some((s) => s.state === 'notConnected'),
  };
  return {
    code: m.code,
    name: m.name,
    status: m.status,
    currency: m.currency,
    distanceUnit: m.distance_unit,
    tempUnit: m.temp_unit,
    areaCode: m.area_code ?? null,
    midLevelName: m.mid_level_name,
    dateFormat: m.date_format,
    defaultTimezone: m.default_timezone,
    defaultWordingLocale: m.default_wording_locale,
    costBands,
    // Who set the bands and when — a market judgement, made together, so the
    // first band's attribution is the set's.
    costBandsSetBy: Array.isArray(costBands) && costBands[0] ? costBands[0].set_by ?? null : null,
    costBandsAt: Array.isArray(costBands) && costBands[0] ? costBands[0].at ?? null : null,
    sources,
    sourcesConnected: connected,
    sourcesCanExist: canExist.length,
    places: m.places ?? 0,
    statusSetBy: m.status_set_by ?? null,
    statusAt: m.status_at ?? null,
    checklist,
    ready: checklist.costBands && checklist.area && checklist.sources,
  };
}

/* ----------------------------------------------------------------- wording */

const nsOk = (ns) => { if (!NAMESPACES.includes(ns)) throw bad(`${ns} is not a wording namespace`); };
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

/**
 * A namespace's wording, with a status per row the screen renders:
 *   same         — no en-US: an assertion the two are identical (the normal state)
 *   changed      — an en-US is written and current
 *   needs-review — a machine suggestion waiting for a person
 *   drift        — the English moved on since the en-US was written
 */
export async function listWording(namespace) {
  nsOk(namespace);
  const { rows } = await query(
    `select namespace, key, en_gb, en_us, suggestion, machine_allowed,
            en_gb_version, en_gb_version_when_us_written, set_by, at
       from market_wording where namespace = $1 order by key`, [namespace]);
  return rows.map((r) => ({
    namespace: r.namespace,
    key: r.key,
    enGB: r.en_gb,
    enUS: r.en_us,
    suggestion: r.suggestion,
    machineAllowed: r.machine_allowed,
    setBy: r.set_by,
    at: r.at,
    status: wordingStatus(r),
  }));
}

function wordingStatus(r) {
  if (hasDrifted(r)) return 'drift';
  if (r.en_us != null && r.en_us !== '') return 'changed';
  if (r.suggestion) return 'needs-review';
  return 'same';
}

/**
 * Keys referenced in a non-default locale that are still not in the vocabulary —
 * "what is left to register", not raw history. A miss is only ever logged for a
 * genuinely absent key (one with no en-GB to fall back to, register 6), so it is
 * resolved the moment the key is registered with its en-GB source, whatever its
 * en-US state (Codex). Derived from current state, so a resolved miss drops out.
 *
 * Note: this is not the American-translation work list — a present key with a
 * blank en-US is "same" (the normal state), never a miss. Telling "reviewed,
 * judged identical" from "never examined" for those is the wording screen's job
 * (the open fourth-state question, owner 29 Sep 2026).
 */
export async function wordingMisses() {
  const { rows } = await query(
    `select wm.namespace, wm.key, wm.locale, wm.seen, wm.first_seen, wm.last_seen
       from wording_misses wm
       left join market_wording w on w.namespace = wm.namespace and w.key = wm.key
      where wm.locale <> 'en-GB'
        and (w.namespace is null or w.en_gb is null or w.en_gb = '')
      order by wm.seen desc, wm.last_seen desc`);
  return rows;
}

/**
 * Write an en-US variant. Snapshots the en-GB version it was written against, so
 * a later English edit shows as drift (register/design). Collection copy is
 * handwritten — no machine may set it, and the DB constraint enforces that too.
 */
export async function setEnUs(namespace, key, text, who) {
  nsOk(namespace);
  if (!who) throw bad('a change says who made it');
  // The write and its audit record are one transaction: a wording change that
  // Changes did not record, or a record for a change that did not land, are
  // both worse than an error (Codex).
  // Whitespace-only is not an American form; it clears the en-US back to "same".
  const value = (text ?? '').trim() || null;
  return withTransaction(async (client) => {
    const { rows: [prev] } = await client.query(
      `select en_us, suggestion, en_gb_version, en_gb_version_when_us_written, set_by, at
         from market_wording where namespace = $1 and key = $2 for update`, [namespace, key]);
    if (!prev) throw bad(`no wording ${namespace}/${key}`);
    // Re-submitting the same en-US against newer English is the design's "Still
    // right": it refreshes the drift snapshot and resolves the drift, so it is
    // NOT a no-op (Codex). A true no-op is the value unchanged, no suggestion to
    // resolve, and no drift to clear.
    const drifted = prev.en_us != null && prev.en_gb_version_when_us_written != null
      && prev.en_gb_version !== prev.en_gb_version_when_us_written;
    if ((prev.en_us ?? null) === value && prev.suggestion == null && !drifted) return { ok: true, unchanged: true };
    await client.query(
      `update market_wording
          set en_us = $3::text,
              en_gb_version_when_us_written = case when $3::text is null then null else en_gb_version end,
              suggestion = null, set_by = $4, at = now(), updated_at = now()
        where namespace = $1 and key = $2`, [namespace, key, value, who]);
    const change = await logChange({ client, who, area: 'Markets', what: `wording en-US: ${key}`,
      before: prev.en_us, after: value ?? '(cleared)', subjectType: 'wording', subjectId: `${namespace}/${key}`,
      // The whole prior en-US state, so undo restores it exactly — value, the
      // English version it was written against, and any suggestion (Codex).
      undo: { kind: 'wording', namespace, key, field: 'en_us',
        value: prev.en_us, writtenAgainst: prev.en_gb_version_when_us_written, suggestion: prev.suggestion,
        setBy: prev.set_by, at: prev.at } });
    // The change id, so the screen can offer an immediate Undo toast (Codex).
    return { ok: true, change: change.id };
  });
}

/**
 * Set the en-GB source — creating the key if it does not exist yet, so there is
 * a way to register a wording row (a clean database starts empty; keys are the
 * app's own user-visible strings). Editing an existing one bumps the version, so
 * any en-US written against the old English is flagged as drift; the en-US is
 * left alone for a person to judge.
 */
export async function setEnGb(namespace, key, text, who) {
  nsOk(namespace);
  if (!who) throw bad('a change says who made it');
  text = (text ?? '').trim();
  if (!text) throw bad('en-GB is the source and cannot be blank');
  return withTransaction(async (client) => {
    const { rows: [prev] } = await client.query(
      'select en_gb, en_gb_version from market_wording where namespace = $1 and key = $2 for update', [namespace, key]);
    // Re-saving the same English changes nothing — and must not make a matching
    // en-US look drifted (Codex).
    if (prev && prev.en_gb === text) return { ok: true, unchanged: true };
    await client.query(
      `insert into market_wording (namespace, key, en_gb, machine_allowed) values ($1, $2, $3, $4)
       on conflict (namespace, key) do update
          set en_gb = excluded.en_gb, en_gb_version = market_wording.en_gb_version + 1, updated_at = now()`,
      // Collection copy is handwritten only, so a collection row is never
      // machine-allowed (the DB constraint enforces it too).
      [namespace, key, text, namespace !== 'collection']);
    const change = await logChange({ client, who, area: 'Markets', what: `wording en-GB: ${key}`,
      before: prev?.en_gb ?? null, after: text, subjectType: 'wording', subjectId: `${namespace}/${key}`,
      // Undo of an edit restores the old English AND its version, so a matching
      // en-US un-drifts (Codex); undo of a create removes the row.
      undo: prev
        ? { kind: 'wording', namespace, key, field: 'en_gb', value: prev.en_gb, version: prev.en_gb_version }
        : { kind: 'wording', namespace, key, field: 'en_gb', created: true } });
    return { ok: true, created: !prev, change: change.id };
  });
}

/**
 * Undo a wording edit — restore the previous value, or remove a row that this
 * change created. Part of the desk's Undo flow (every human decision is
 * undoable, README principle 2); dispatched from the /undo route by kind.
 */
export async function undoWording({ change, who }) {
  const u = change.undo ?? {};
  const { markUndone } = await import('./changes.js');
  return withTransaction(async (client) => {
    if (u.created) {
      await client.query('delete from market_wording where namespace = $1 and key = $2', [u.namespace, u.key]);
    } else if (u.field === 'en_us') {
      // Restore the whole prior en-US state — value, its drift snapshot and any
      // suggestion — so the undo is exact.
      await client.query(
        `update market_wording
            set en_us = $3::text, en_gb_version_when_us_written = $4, suggestion = $5,
                set_by = $6, at = $7, updated_at = now()
          where namespace = $1 and key = $2`,
        [u.namespace, u.key, u.value ?? null, u.writtenAgainst ?? null, u.suggestion ?? null,
          u.setBy ?? null, u.at ?? null]);
    } else {
      // Restore the English and its version, so an en-US written against it is
      // no longer read as drifted.
      await client.query(
        `update market_wording set en_gb = $3, en_gb_version = $4, updated_at = now()
          where namespace = $1 and key = $2`, [u.namespace, u.key, u.value, u.version ?? 1]);
    }
    await markUndone({ id: change.id, who, client });
  });
}
