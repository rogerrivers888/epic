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
import { scaleFor } from '../domain/costBand.js';
import { OUTCODE_FROM, PCDS_FROM as AS_PCDS, nullCountryAddresses, FOUND_IT } from '../repositories/placeIndex.js';
import { countryFromAddresses } from '../domain/countryFromAddress.js';
import { disagreements } from '../domain/countrySignals.js';
import { ownedRecordSql } from '../domain/placeIndex.js';

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

/**
 * The area-key check (markets step 6, owner 2 Oct 2026): what the (country, slug)
 * area key and the full-postcode country rule would meet on this database, read
 * before migration 326 is written so its stop-and-name check rests on counts, not an
 * assumption. Read-only, uncapped where it names rows — the owner asked to see any
 * unprefixed non-GB area before the migration exists — and every figure the ONS
 * table is needed for says it cannot speak when that table is empty.
 *
 * The postcode rule being checked: a settled non-GB country may be overridden to GB
 * only by a FULL postcode that ONS holds (`postcodes.pcds`), never by an outcode —
 * W12 is a London outcode and a Dublin routing key, and an Eircode's four-character
 * second part can never be a GB pcds.
 */
export async function areaKeyCheck() {
  const n = async (sql, params = []) => (await query(sql, params)).rows;
  const [{ loaded }] = await n('select exists (select 1 from postcodes) as loaded');
  const placesByCountry = await n(`select coalesce(upper(country_code), '(none)') as country, count(*)::int as places
      from place_index group by 1 order by 2 desc`);
  const localitiesByCountry = await n(`select upper(country_code) as country, kind, count(*)::int as n
      from localities group by 1, 2 order by 1, 2`);
  // Every non-GB locality whose slug does not carry its country — the rows the
  // migration's check would stop on. Uncapped on purpose.
  const unprefixed = await n(`select slug, name, kind, upper(country_code) as country from localities
      where upper(country_code) <> 'GB' and slug <> lower(country_code)
        and slug not like lower(country_code) || '-%' order by country, kind, slug`);
  const areaCountsByCountry = await n(`select upper(country_code) as country, count(*)::int as rows,
      count(distinct area_slug)::int as areas from area_counts group by 1 order by 1`);
  const nonGbPlacesFiledByArea = await n(`select upper(pi.country_code) as country, count(*)::int as links
      from place_areas pa join place_index pi on pi.venue_ref = pa.venue_ref
     where upper(pi.country_code) <> 'GB' group by 1 order by 1`);
  // What today's outcode rule and the full-postcode rule each do to places with a
  // postcode whose country is not GB (or not known).
  const rule = loaded ? await n(`
      select coalesce(upper(pi.country_code), '(none)') as country,
             count(*)::int as with_postcode,
             count(*) filter (where exists (select 1 from postcodes p where p.outcode = upper(${OUTCODE_FROM('r.postcode')})))::int as outcode_rule_says_gb,
             -- Exact membership of the GB-only ONS list is the whole rule: every pcds has a
             -- three-character second part, so an Eircode can never be one (Codex: no
             -- separate syntax filter, which would drop special postcodes such as GIR 0AA).
             count(*) filter (where exists (select 1 from postcodes p where p.pcds = ${AS_PCDS('r.postcode')}))::int as full_postcode_rule_says_gb
        from place_index pi join place_records r on r.venue_ref = pi.venue_ref
       where r.postcode is not null and upper(pi.country_code) is distinct from 'GB'
       group by 1 order by 1`) : null;
  // The places a postcode cannot settle at all: no country, and neither rule finds
  // the postcode in the GB list — Channel Islands, Isle of Man, a malformed value or
  // somewhere abroad. Named, uncapped (owner, 2 Oct 2026: 21 of them on production).
  const unsettled = loaded ? await n(`
      select pi.venue_ref, r.name, r.postcode, r.address
        from place_index pi join place_records r on r.venue_ref = pi.venue_ref
       where r.postcode is not null and pi.country_code is null
         and not exists (select 1 from postcodes p where p.outcode = upper(${OUTCODE_FROM('r.postcode')}))
         and not exists (select 1 from postcodes p where p.pcds = ${AS_PCDS('r.postcode')})
       order by r.postcode, pi.venue_ref`) : null;
  // Every place settled outside GB, with the address it was settled from — the
  // owner asked for what settled and what did not, not a count (2 Oct 2026). Listed
  // whole while the set is small; past 500 it says it is the first 500.
  const { rows: [{ n: nonGbTotal }] } = await query(
    `select count(*)::int as n from place_index where country_code is not null and upper(country_code) <> 'GB'`);
  const nonGbPlaces = await n(`
      select pi.venue_ref, upper(pi.country_code) as country, r.name, r.postcode,
             -- The CURRENT reverse-geocoded address, labelled as such: a country may
             -- have come from a source area or a postcode, and the geocode may have
             -- changed since (Codex). Whether it names this country is computed below.
             (select f.value #>> '{}' from place_facts f where f.venue_ref = pi.venue_ref
                and f.field = 'address' and f.source = 'nominatim' and f.expires_at is null) as current_geocoded_address
        from place_index pi left join place_records r on r.venue_ref = pi.venue_ref
       where pi.country_code is not null and upper(pi.country_code) <> 'GB'
       order by 2, r.name nulls last, pi.venue_ref limit 500`);
  for (const p of nonGbPlaces) {
    const named = p.current_geocoded_address ? countryFromAddresses([p.current_geocoded_address]).code : null;
    p.geocode_names = named;
    p.geocode_agrees = named == null ? null : named === p.country;
  }
  // Every place still without a country that holds an address, and why its address
  // did not settle it.
  const addressVerdicts = (await nullCountryAddresses(null, undefined, { limit: null })).map((r) => {
    if (r.source_country) return { venue_ref: r.venue_ref, addresses: r.addresses, country: null, reason: 'a source area names its country; settle reads that first' };
    const v = countryFromAddresses(r.addresses ?? []);
    return { venue_ref: r.venue_ref, addresses: r.addresses, country: v.code, reason: v.reason ?? null };
  });
  // A place with no country and no reverse-geocoded address never reaches the pass;
  // it is named here with that as its reason, so "not settled" always says why.
  const noGeocode = await n(`
      select pi.venue_ref, r.name, r.address from place_index pi
        left join place_records r on r.venue_ref = pi.venue_ref
       where pi.country_code is null and (r.address is not null or r.postcode is not null)
         and not exists (select 1 from place_facts f where f.venue_ref = pi.venue_ref and f.field = 'address'
                          and f.source = 'nominatim' and f.expires_at is null)
       order by pi.venue_ref`);
  for (const r of noGeocode) {
    addressVerdicts.push({ venue_ref: r.venue_ref, addresses: [], country: null, reason: 'no reverse-geocoded address held', name: r.name, address: r.address });
  }
  // Postcodes that are not postcodes — 00000 and its kind — across the whole corpus,
  // so a placeholder is seen for what it is wherever it sits.
  const placeholderPostcodes = await n(`
      select postcode, count(*)::int as places from place_records
       -- Unambiguous sentinels only: a run of four or more zeros, and words. A
       -- repeated digit can be a real code abroad (1111 is a four-digit postcode
       -- somewhere), so it is never called a placeholder (Codex).
       where btrim(postcode) ~* '^(0{4,}|x{3,}|-+|n/?a|none|tbc|tba|unknown)$'
       group by 1 order by 2 desc`);
  // Migration 357, confirmed from the database itself rather than from the deploy
  // having finished: whether it is recorded, and the key and check it left behind.
  const { rows: [m357] } = await query(`
    select (select array_agg(a.attname::text order by k.ord)
              from pg_constraint c
              cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
             where c.conrelid = 'area_counts'::regclass and c.contype = 'p') as area_counts_key,
           exists (select 1 from pg_constraint where conname = 'localities_slug_names_its_country') as slug_check,
           (select column_default from information_schema.columns
             where table_name = 'area_counts' and column_name = 'country_code') as country_default`);
  // Recorded-as-applied needs the runner's own table; a database built some other
  // way (the test helper) has none, and then the answer is "cannot say", not false.
  const { rows: [{ ledger }] } = await query(`select to_regclass('schema_migrations') is not null as ledger`);
  m357.recorded = ledger
    ? (await query(`select exists (select 1 from schema_migrations where name like '357\\_%') as r`)).rows[0].r
    : null;
  m357.recordedReason = ledger ? null : 'this database has no schema_migrations table';
  // What the places with no country are (owner, 2 Oct 2026: "they outnumber the
  // foreign places a hundred to one and nobody has said what they are"). Counted
  // whole, by the evidence each has; then a sample with what we own of them.
  const { rows: [noCountry] } = await query(`
    select count(*)::int as total,
           count(*) filter (where pi.lat is not null)::int as with_point,
           count(*) filter (where pi.subcategory is not null)::int as with_shelf,
           count(*) filter (where r.venue_ref is not null)::int as with_record,
           count(*) filter (where r.address is not null or r.postcode is not null)::int as with_address,
           count(*) filter (where exists (select 1 from place_facts f where f.venue_ref = pi.venue_ref
                                            and f.field = 'address' and f.source = 'nominatim' and f.expires_at is null))::int as with_geocode
      from place_index pi left join place_records r on r.venue_ref = pi.venue_ref
     where pi.country_code is null`);
  const noCountryBy = {
    ownership: await n(`select ownership, count(*)::int as places from place_index where country_code is null group by 1 order by 2 desc`),
    refKind: await n(`select split_part(venue_ref, ':', 1) as ref_kind, count(*)::int as places from place_index where country_code is null group by 1 order by 2 desc`),
    // Tallied in the database: only the combinations cross the wire, not a row a place (Codex).
    sources: await n(`select sources, count(*)::int as places from (
                        select coalesce(string_agg(distinct s.source, '+' order by s.source), '(none)') as sources
                          from place_index pi left join place_index_sources s on s.venue_ref = pi.venue_ref and (${FOUND_IT('s')})
                         where pi.country_code is null group by pi.venue_ref) x
                       group by 1 order by 2 desc`),
    firstSeen: await n(`select to_char(date_trunc('month', first_seen), 'YYYY-MM') as month, count(*)::int as places
                          from place_index where country_code is null group by 1 order by 1`),
    derivedBy: await n(`select coalesce(derived_by, '(none)') as derived_by, count(*)::int as places from place_index where country_code is null group by 1 order by 2 desc`),
  };
  const noCountrySample = await n(`
      select pi.venue_ref, pi.ownership, pi.subcategory, pi.first_seen, r.name,
             -- Only a source that found it: a paid provider asked with no match keeps a
             -- row without an id, and that is not a finding (Codex; FOUND_IT).
             (select string_agg(s.source, '+' order by s.source) from place_index_sources s
               where s.venue_ref = pi.venue_ref and (${FOUND_IT('s')})) as sources
        from place_index pi left join place_records r on r.venue_ref = pi.venue_ref
       where pi.country_code is null
       order by md5(pi.venue_ref) limit 30`);
  return {
    checkedAt: new Date().toISOString(),
    noCountry, noCountryBy, noCountrySample,
    migration357: m357,
    nonGbTotal, nonGbPlaces, nonGbListed: nonGbPlaces.length < nonGbTotal ? `first ${nonGbPlaces.length} of ${nonGbTotal}` : 'all',
    addressVerdicts, placeholderPostcodes,
    unsettled,
    placesByCountry, localitiesByCountry, unprefixed, areaCountsByCountry, nonGbPlacesFiledByArea,
    postcodeRule: rule,
    postcodeRuleReason: loaded ? null : 'the ONS postcode table is empty here, so neither rule can be read',
  };
}

/**
 * Where a place's own text contradicts its stamped country (owner, 2 Oct 2026: "a
 * stamp that contradicts owned text is the one case where the evidence is probably
 * better than the pin"). Read-only, and a check rather than a rule: it changes no
 * country. Every settled place holding an owned record is read, a page at a time,
 * so the totals are whole; the list names the first 300 by how many signals object.
 */
export async function countryContradictions() {
  const { rows: mk } = await query('select code, currency from markets');
  const currency = new Map(mk.map((m) => [m.code, m.currency]));
  const currencyOf = (c) => currency.get(c) ?? null;
  const bySignal = { address: 0, phone: 0, website: 0, currency: 0 };
  const byCountry = new Map();
  let checked = 0; let flagged = 0; let twoOrMore = 0;
  const list = [];
  let after = '';
  for (;;) {
    const { rows } = await query(`
      select pi.venue_ref, upper(pi.country_code) as country, r.name, r.phone, r.website, r.price_range,
             coalesce(jsonb_agg(jsonb_build_object('source', f.source, 'value', f.value #>> '{}') order by f.source)
                        filter (where f.venue_ref is not null), '[]'::jsonb)
               -- And the record's own address, which a back-office edit writes only
               -- there (Codex), labelled as the record's.
               -- Only when no fact already holds it: compose() copies the winning fact
               -- there, and it is not a second piece of evidence (Codex).
               || case when r.address is not null
                        and not bool_or(coalesce(f.value #>> '{}' = r.address, false))
                       then jsonb_build_array(jsonb_build_object('source', 'record', 'value', r.address))
                       else '[]'::jsonb end as addresses
        from place_index pi
        join place_records r on r.venue_ref = pi.venue_ref
        left join place_facts f on f.venue_ref = pi.venue_ref and f.field = 'address' and f.expires_at is null
       where pi.country_code is not null and pi.venue_ref > $1
         -- A record that holds something of ours; an empty placeholder row is not
         -- owned text and must not swell the checked total (Codex).
         and ${ownedRecordSql('r')}
       group by pi.venue_ref, pi.country_code, r.name, r.phone, r.website, r.price_range, r.address
       order by pi.venue_ref limit 5000`, [after]);
    if (!rows.length) break;
    for (const r of rows) {
      checked += 1;
      const d = disagreements({ country: r.country, addresses: r.addresses ?? [], phone: r.phone, website: r.website, priceRange: r.price_range }, currencyOf);
      if (!d.length) continue;
      flagged += 1;
      const kinds = new Set(d.map((x) => x.signal)); // a signal counts once a place
      if (kinds.size >= 2) twoOrMore += 1;
      for (const k of kinds) bySignal[k] += 1;
      byCountry.set(r.country, (byCountry.get(r.country) ?? 0) + 1);
      list.push({ venue_ref: r.venue_ref, name: r.name, stamped: r.country, signals: d });
    }
    after = rows[rows.length - 1].venue_ref;
  }
  const kindsOf = (p) => new Set(p.signals.map((x) => x.signal)).size;
  list.sort((a, b) => kindsOf(b) - kindsOf(a) || a.venue_ref.localeCompare(b.venue_ref));
  return {
    checkedAt: new Date().toISOString(),
    checked, flagged, twoOrMore, bySignal,
    byStampedCountry: Object.fromEntries(byCountry),
    places: list.slice(0, 300),
    listed: list.length > 300 ? `first 300 of ${list.length}` : 'all',
  };
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

/**
 * Set a market's cost bands — the per-person money ranges a human judges, never
 * derived from price data (owner, 29 Sep 2026). The caller gives the two internal
 * thresholds in the currency's minor units: under `t1` is the first paid band,
 * `t1`–`t2` the second, `t2` and over the third; Free is exactly 0. Kept half-open
 * [min, max) — min inclusive, max exclusive, a null max unbounded — so the bands
 * never overlap and every price lands in exactly one (migration 300). The symbols
 * come from the market's own currency. `basis` is 'judgement' by default — a
 * human's call — and could later be 'prices' if ever read from real pricing.
 * Logged and undoable; the whole prior bands set is kept so undo is exact,
 * including restoring a market to "not known yet" (null).
 */
/** A one-line summary of a bands set for the change log — "not set" when null. */
function bandsSummary(bands, currency) {
  if (!Array.isArray(bands) || bands.length < 4) return 'not set';
  const sym = scaleFor(currency)[1] ?? '';
  const money = (minor) => { const major = minor / 100; return `${sym}${Number.isInteger(major) ? major : major.toFixed(2)}`; };
  return `${sym} up to ${money(bands[1].max)} · ${sym}${sym} up to ${money(bands[2].max)}`;
}

export async function setCostBands(code, { t1, t2, basis = 'judgement' }, who) {
  if (!who) throw bad('a change says who made it');
  if (basis !== 'judgement' && basis !== 'prices') throw bad("basis is 'judgement' or 'prices'");
  const c = String(code || '').toUpperCase();
  const a = Number(t1);
  const b = Number(t2);
  // Whole minor units, checked BEFORE any rounding so a fractional minor unit is
  // rejected, not silently floored; the first paid band starts at 1 so the first
  // threshold must exceed it (t1 = 1 would make an empty [1, 1) band); ascending.
  if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 1 || b <= a) {
    throw bad('the two thresholds must be whole minor units with 1 < first < second');
  }
  return withTransaction(async (client) => {
    const { rows: [m] } = await client.query('select currency, cost_bands from markets where code = $1 for update', [c]);
    if (!m) throw bad(`no market ${c}`);
    const scale = scaleFor(m.currency);
    const at = new Date().toISOString().slice(0, 10);
    const bands = [
      { symbol: scale[0], min: 0, max: 0, basis, set_by: who, at },
      { symbol: scale[1], min: 1, max: a, basis, set_by: who, at },
      { symbol: scale[2], min: a, max: b, basis, set_by: who, at },
      { symbol: scale[3], min: b, max: null, basis, set_by: who, at },
    ];
    await client.query('update markets set cost_bands = $2, updated_at = now() where code = $1', [c, JSON.stringify(bands)]);
    // The change log's fields are text, so the bands go in as a readable summary
    // (not [object Object]); the whole prior set is kept in `undo` for an exact
    // restore, including back to "not set".
    const change = await logChange({ client, who, area: 'Markets', what: `set cost bands for ${c}`,
      before: bandsSummary(m.cost_bands, m.currency), after: bandsSummary(bands, m.currency),
      subjectType: 'market', subjectId: `${c}/cost-bands`,
      undo: { kind: 'market_cost_bands', code: c, before: m.cost_bands ?? null } });
    return { ok: true, change: change.id, bands };
  });
}

/** Undo a cost-bands change — restore the market's prior bands (or null). */
export async function undoCostBands({ change, who }) {
  const u = change.undo ?? {};
  const { markUndone } = await import('./changes.js');
  return withTransaction(async (client) => {
    await client.query('update markets set cost_bands = $2, updated_at = now() where code = $1',
      [u.code, u.before == null ? null : JSON.stringify(u.before)]);
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

/** The US subcategory a `sub.<key>` wording key stands for; null otherwise. */
const subOf = (key) => (key.startsWith('sub.') ? key.slice('sub.'.length) : null);

/**
 * A namespace's wording, each row with the status the screen renders. Blank
 * means one thing only — someone looked and judged the two the same; an
 * untouched key is "not-looked-at", never blank (design v2.2).
 *   not-applicable — a subcategory not offered in the US at all (sub. keys)
 *   drift          — the English moved on since the en-US was written
 *   needs-review   — a machine suggestion waiting for a person
 *   changed        — an en-US written and current
 *   same           — looked at and left identical
 *   not-looked-at  — nobody has judged it; Americans see the British line
 *
 * `usCount` accompanies subcategory keys: how many US places are in it — a real
 * "0 places in the US" (look harder) is a different thing from "not applicable
 * here", and reads differently.
 */
export async function listWording(namespace) {
  nsOk(namespace);
  const { rows } = await query(
    `select namespace, key, en_gb, en_us, suggestion, machine_allowed,
            en_gb_version, en_gb_version_when_us_written, set_by, at, looked_at, looked_at_by
       from market_wording where namespace = $1 order by key`, [namespace]);

  // Subcategory keys carry a US not-applicable flag and a US place count.
  const subs = rows.map((r) => subOf(r.key)).filter(Boolean);
  const naSet = new Set();
  const usCount = new Map();
  if (subs.length) {
    const { rows: na } = await query(
      `select subcategory from market_subcategories where market_code = 'US' and applicable = false and subcategory = any($1)`, [subs]);
    na.forEach((x) => naSet.add(x.subcategory));
    // Places filed under the subcategory as their primary shelf, in the US. This
    // counts primary filing; full membership (a place also filed here as a
    // secondary) would join place_subcategories, which matters once the US holds
    // real places — today it is groundwork and this is ~0 either way.
    const { rows: cnt } = await query(
      `select subcategory, count(*)::int n from place_index where upper(country_code) = 'US' and subcategory = any($1) group by subcategory`, [subs]);
    cnt.forEach((x) => usCount.set(x.subcategory, x.n));
  }

  return rows.map((r) => {
    const sub = subOf(r.key);
    const notApplicable = sub != null && naSet.has(sub);
    const status = wordingStatus(r, notApplicable);
    return {
      namespace: r.namespace,
      key: r.key,
      subcategory: sub,
      enGB: r.en_gb,
      enUS: r.en_us,
      suggestion: r.suggestion,
      machineAllowed: r.machine_allowed,
      setBy: r.set_by,
      at: r.at,
      status,
      // What is left to look at — the "Only what's left" filter, and the
      // "N left" on each namespace tab.
      left: status === 'not-looked-at' || status === 'needs-review' || status === 'drift',
      // Only subcategory keys carry a US count.
      usCount: sub != null ? (usCount.get(sub) ?? 0) : null,
    };
  });
}

function wordingStatus(r, notApplicable) {
  if (notApplicable) return 'not-applicable';
  if (hasDrifted(r)) return 'drift';
  if (r.suggestion) return 'needs-review';
  if (r.en_us != null && r.en_us !== '') return 'changed';
  // Looked at and left the same, or never examined at all.
  return r.looked_at != null ? 'same' : 'not-looked-at';
}

/**
 * "Same in both" — a person looked and judged the two identical. Records that it
 * was looked at (en-US stays blank), so it stops reading "not looked at".
 */
export async function markSame(namespace, key, who) {
  nsOk(namespace);
  if (!who) throw bad('a change says who made it');
  return withTransaction(async (client) => {
    const { rows: [prev] } = await client.query(
      `select looked_at, looked_at_by, suggestion, en_us, en_gb_version_when_us_written
         from market_wording where namespace = $1 and key = $2 for update`, [namespace, key]);
    if (!prev) throw bad(`no wording ${namespace}/${key}`);
    if (prev.looked_at != null && prev.suggestion == null && prev.en_us == null) return { ok: true, unchanged: true };
    // "Same in both" means the two ARE identical: it looks the key over, clears
    // any separate American form and its drift snapshot, and dismisses any
    // machine suggestion (the reject path).
    await client.query(
      `update market_wording
          set looked_at = now(), looked_at_by = $3, suggestion = null,
              en_us = null, en_gb_version_when_us_written = null, updated_at = now()
        where namespace = $1 and key = $2`, [namespace, key, who]);
    const change = await logChange({ client, who, area: 'Markets', what: `wording same in both: ${key}`,
      before: prev.en_us, after: 'looked at · same in both', subjectType: 'wording', subjectId: `${namespace}/${key}`,
      // Undo restores the prior looked-at state, any en-US and its snapshot, and
      // any suggestion this dismissed.
      undo: { kind: 'wording_looked', namespace, key, lookedAt: prev.looked_at, lookedAtBy: prev.looked_at_by,
        suggestion: prev.suggestion, enUs: prev.en_us, writtenAgainst: prev.en_gb_version_when_us_written } });
    return { ok: true, change: change.id };
  });
}

/** Undo a "Same in both": the key goes back to "not looked at". */
export async function undoWordingLooked({ change, who }) {
  const u = change.undo ?? {};
  const { markUndone } = await import('./changes.js');
  return withTransaction(async (client) => {
    await client.query(
      `update market_wording set looked_at = $3, looked_at_by = $4, suggestion = $5,
              en_us = $6::text, en_gb_version_when_us_written = $7, updated_at = now()
        where namespace = $1 and key = $2`,
      [u.namespace, u.key, u.lookedAt ?? null, u.lookedAtBy ?? null, u.suggestion ?? null, u.enUs ?? null, u.writtenAgainst ?? null]);
    await markUndone({ id: change.id, who, client });
  });
}

/**
 * "Not applicable here" — a subcategory Epic does not offer in the US at all
 * (not relabelled). Marks it in `market_subcategories`; the customer app then
 * omits it, and its US count reads "not applicable here", never 0. Undoable.
 */
export async function markNotApplicable(subcategory, who, applicable = false) {
  if (!who) throw bad('a change says who made it');
  if (!subcategory) throw bad('a subcategory is needed');
  return withTransaction(async (client) => {
    const { rows: [prev] } = await client.query(
      'select applicable, set_by, at from market_subcategories where market_code = $1 and subcategory = $2', ['US', subcategory]);
    const was = prev ? prev.applicable : true;
    if (was === applicable) return { ok: true, unchanged: true };
    await client.query(
      `insert into market_subcategories (market_code, subcategory, applicable, set_by, at)
       values ('US', $1, $2, $3, now())
       on conflict (market_code, subcategory) do update set applicable = excluded.applicable, set_by = excluded.set_by, at = now()`,
      [subcategory, applicable, who]);
    const change = await logChange({ client, who, area: 'Markets',
      what: applicable ? `${subcategory} applies in the US again` : `${subcategory} not applicable in the US`,
      before: was ? 'applicable' : 'not applicable', after: applicable ? 'applicable' : 'not applicable',
      subjectType: 'market_subcategory', subjectId: `US/${subcategory}`,
      // The whole prior row, so undo is exact — including whether it existed at
      // all (a subcategory is applicable by default, with no row).
      undo: { kind: 'market_subcategory', subcategory, existed: !!prev, applicable: was, setBy: prev?.set_by ?? null, at: prev?.at ?? null } });
    return { ok: true, change: change.id };
  });
}

/** Undo a not-applicable decision — restore the prior row exactly, or remove it
 *  if there was none (the subcategory was applicable by default). */
export async function undoNotApplicable({ change, who }) {
  const u = change.undo ?? {};
  const { markUndone } = await import('./changes.js');
  return withTransaction(async (client) => {
    if (u.existed) {
      await client.query(
        `insert into market_subcategories (market_code, subcategory, applicable, set_by, at)
         values ('US', $1, $2, $3, $4)
         on conflict (market_code, subcategory) do update set applicable = excluded.applicable, set_by = excluded.set_by, at = excluded.at`,
        [u.subcategory, u.applicable ?? true, u.setBy ?? null, u.at ?? null]);
    } else {
      await client.query('delete from market_subcategories where market_code = $1 and subcategory = $2', ['US', u.subcategory]);
    }
    await markUndone({ id: change.id, who, client });
  });
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
      `select en_us, suggestion, en_gb_version, en_gb_version_when_us_written, set_by, at, looked_at, looked_at_by
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
              -- Editing the en-US — writing one or deliberately clearing it — is
              -- looking at the key: it stops reading "not looked at".
              looked_at = now(), looked_at_by = $4,
              suggestion = null, set_by = $4, at = now(), updated_at = now()
        where namespace = $1 and key = $2`, [namespace, key, value, who]);
    const change = await logChange({ client, who, area: 'Markets', what: `wording en-US: ${key}`,
      before: prev.en_us, after: value ?? '(cleared)', subjectType: 'wording', subjectId: `${namespace}/${key}`,
      // The whole prior en-US state, so undo restores it exactly — value, the
      // English version it was written against, and any suggestion (Codex).
      undo: { kind: 'wording', namespace, key, field: 'en_us',
        value: prev.en_us, writtenAgainst: prev.en_gb_version_when_us_written, suggestion: prev.suggestion,
        setBy: prev.set_by, at: prev.at, lookedAt: prev.looked_at, lookedAtBy: prev.looked_at_by } });
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
      'select en_gb, en_gb_version, looked_at, looked_at_by from market_wording where namespace = $1 and key = $2 for update', [namespace, key]);
    // Re-saving the same English changes nothing — and must not make a matching
    // en-US look drifted (Codex).
    if (prev && prev.en_gb === text) return { ok: true, unchanged: true };
    await client.query(
      `insert into market_wording (namespace, key, en_gb, machine_allowed) values ($1, $2, $3, $4)
       on conflict (namespace, key) do update
          set en_gb = excluded.en_gb, en_gb_version = market_wording.en_gb_version + 1,
              -- A key judged "same in both" was judged against the OLD English;
              -- once the English changes it must be looked at again. A key with
              -- an en-US is handled by drift (the version snapshot) instead.
              looked_at = case when market_wording.en_us is null then null else market_wording.looked_at end,
              looked_at_by = case when market_wording.en_us is null then null else market_wording.looked_at_by end,
              updated_at = now()`,
      // Collection copy is handwritten only, so a collection row is never
      // machine-allowed (the DB constraint enforces it too).
      [namespace, key, text, namespace !== 'collection']);
    const change = await logChange({ client, who, area: 'Markets', what: `wording en-GB: ${key}`,
      before: prev?.en_gb ?? null, after: text, subjectType: 'wording', subjectId: `${namespace}/${key}`,
      // Undo of an edit restores the old English AND its version, so a matching
      // en-US un-drifts (Codex); undo of a create removes the row.
      undo: prev
        ? { kind: 'wording', namespace, key, field: 'en_gb', value: prev.en_gb, version: prev.en_gb_version, lookedAt: prev.looked_at, lookedAtBy: prev.looked_at_by }
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
                set_by = $6, at = $7, looked_at = $8, looked_at_by = $9, updated_at = now()
          where namespace = $1 and key = $2`,
        [u.namespace, u.key, u.value ?? null, u.writtenAgainst ?? null, u.suggestion ?? null,
          u.setBy ?? null, u.at ?? null, u.lookedAt ?? null, u.lookedAtBy ?? null]);
    } else {
      // Restore the English and its version, so an en-US written against it is
      // no longer read as drifted.
      await client.query(
        `update market_wording set en_gb = $3, en_gb_version = $4, looked_at = $5, looked_at_by = $6, updated_at = now()
          where namespace = $1 and key = $2`, [u.namespace, u.key, u.value, u.version ?? 1, u.lookedAt ?? null, u.lookedAtBy ?? null]);
    }
    await markUndone({ id: change.id, who, client });
  });
}
