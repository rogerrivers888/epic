/**
 * The name a place is shown under, resolved at read time (owner, 1 Oct 2026):
 * our own name first, then Google's live and in memory only, then a neutral
 * word — and every place without an owned name queued for research. Google's
 * name is never written down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { ownedNamesFor, resolveNames } = await import('../src/sources/displayNames.js');
const { googleSource } = await import('../src/sources/google.js');
const { runAsSpender } = await import('../src/context.js');

test.after(() => pool.end());

async function household() {
  const { rows: [h] } = await query('insert into households (name) values ($1) returning id', ['names test']);
  return h.id;
}

await query(`insert into regions (slug, name, nation, kind) values ('names-test-shire', 'Names Testshire', 'England', 'county') on conflict (slug) do nothing`);

test('a household nickname is the name, over our research and the open map', async () => {
  const hh = await household();
  const ref = `google:${randomUUID()}`;
  await query(
    `insert into household_places (household_id, venue_ref, label, nickname, locality) values ($1, $2, $3, $4, 'Windsor')`,
    [hh, ref, 'Google Name We Do Not Keep', 'Our Spot']);
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Research Name', '{"name":"own"}')`, [ref]);
  const owned = await ownedNamesFor([ref], hh);
  assert.equal(owned.get(ref).name, 'Our Spot');
  assert.equal(owned.get(ref).source, 'household');
});

test('renaming a photo place: the nickname wins over its original label', async () => {
  const hh = await household();
  const ref = `photo:${randomUUID()}`;
  await query(`insert into household_places (household_id, venue_ref, label, nickname) values ($1, $2, 'Original Photo Label', 'My New Name')`, [hh, ref]);
  const owned = await ownedNamesFor([ref], hh);
  assert.equal(owned.get(ref).name, 'My New Name');
});

test('one household never sees another household\'s nickname for the same place', async () => {
  const mine = await household();
  const theirs = await household();
  const ref = `google:${randomUUID()}`;
  await query(`insert into household_places (household_id, venue_ref, label, nickname) values ($1, $2, $2, 'Their Secret Name')`, [theirs, ref]);
  // I hold the same place but have not named it.
  await query(`insert into household_places (household_id, venue_ref, label) values ($1, $2, $2)`, [mine, ref]);
  const forMe = await ownedNamesFor([ref], mine);
  assert.equal(forMe.has(ref), false, 'their nickname is theirs, not an owned name for me');
  const forThem = await ownedNamesFor([ref], theirs);
  assert.equal(forThem.get(ref).name, 'Their Secret Name');
});

test('our research names a place under its provenance source', async () => {
  const ref = `google:${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'The Lido', '{"name":"wikipedia"}')`, [ref]);
  const owned = await ownedNamesFor([ref]);
  assert.equal(owned.get(ref).name, 'The Lido');
  assert.equal(owned.get(ref).source, 'wikipedia');
});

test('an owned attraction answers to any of its three references', async () => {
  const ext = `google:${randomUUID()}`;
  const { rows: [a] } = await query(
    `insert into attractions (name, slug, region_slug, external_ref, osm_ref, source)
     values ('The Castle', $1, 'names-test-shire', $2, 'osm:node/1', 'wikidata') returning id`,
    [`castle-${randomUUID()}`, ext]);
  const owned = await ownedNamesFor([ext, `atlas:${a.id}`]);
  assert.equal(owned.get(ext).name, 'The Castle');
  assert.equal(owned.get(`atlas:${a.id}`).name, 'The Castle');
  assert.equal(owned.get(ext).source, 'osm');
});

test('an unmatched sweep placeholder is not an owned name', async () => {
  const ref = `google:${randomUUID()}`;
  await query(
    `insert into attractions (name, slug, region_slug, venue_ref, source, osm_ref)
     values ('Sweep Placeholder', $1, 'names-test-shire', $2, 'google', null)`,
    [`sweep-${randomUUID()}`, ref]);
  const owned = await ownedNamesFor([ref]);
  assert.equal(owned.has(ref), false);
});

test('with no owned name and no live fetch, a place shows a neutral word, never nameless', async () => {
  const rows = [{ venueRef: `google:${randomUUID()}`, locality: 'Bristol', name: 'STORED GOOGLE' }];
  await resolveNames(rows, { refKey: 'venueRef', live: false });
  assert.equal(rows[0].name, 'A place in Bristol');
  assert.equal(rows[0].nameSource, 'none');
});

test('a live Google name is shown and ledgered, but marked so it is never stored', async () => {
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:names-live', 'test device') returning id`);
  const hh = await household();
  const ref = `google:live-${randomUUID()}`;
  const original = googleSource.displayName;
  googleSource.displayName = async () => 'Live From Google';
  try {
    const rows = [{ venueRef: ref, locality: 'Bath', name: null }];
    await runAsSpender({ householdId: hh, sessionId: s.id }, () => resolveNames(rows, { refKey: 'venueRef', purpose: 'test.names.live' }));
    assert.equal(rows[0].name, 'Live From Google');
    assert.equal(rows[0].nameSource, 'google-live', 'the offline layer strips exactly this');
  } finally {
    googleSource.displayName = original;
  }
  const { rows: ledger } = await query(
    `select household_id from provider_calls where purpose = 'test.names.live' and venue_ref = $1`, [ref]);
  assert.equal(ledger.length, 1, 'the live fetch is counted on the ledger');
  assert.equal(ledger[0].household_id, hh);
  const { rows: stored } = await query(`select name from place_records where venue_ref = $1`, [ref]);
  assert.ok(stored.every((r) => r.name == null), 'Google\'s name is never written to place_records');
});

test('an unowned place is queued for research; a household photo is not', async () => {
  const hh = await household();
  const researchable = `google:${randomUUID()}`;
  const photo = `photo:${randomUUID()}`;
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:names-queue', 'test device') returning id`);
  const original = googleSource.displayName;
  googleSource.displayName = async () => null;
  try {
    const rows = [{ venueRef: researchable, name: null }, { venueRef: photo, name: null }];
    await runAsSpender({ householdId: hh, sessionId: s.id }, () => resolveNames(rows, { refKey: 'venueRef', purpose: 'test.names.queue' }));
  } finally {
    googleSource.displayName = original;
  }
  // The queue is fire-and-forget, so let the insert settle.
  await new Promise((r) => setTimeout(r, 50));
  const { rows: queued } = await query(`select venue_ref from place_records where venue_ref = any($1)`, [[researchable, photo]]);
  const refs = queued.map((r) => r.venue_ref);
  assert.ok(refs.includes(researchable), 'a place with no owned name joins the research queue');
  assert.ok(!refs.includes(photo), 'a household photo has no provider to research');
});

test('a non-Google rented reference is never asked of Google', async () => {
  const hh = await household();
  const ref = `tripadvisor:${randomUUID()}`;
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:names-ta', 'test device') returning id`);
  const original = googleSource.displayName;
  let asked = 0;
  googleSource.displayName = async () => { asked += 1; return 'Should Not Happen'; };
  try {
    const rows = [{ venueRef: ref, locality: 'York', name: null }];
    await runAsSpender({ householdId: hh, sessionId: s.id }, () => resolveNames(rows, { refKey: 'venueRef', purpose: 'test.names.ta' }));
    assert.equal(asked, 0, 'its id is not a Google place id');
    assert.equal(rows[0].name, 'A place in York');
  } finally {
    googleSource.displayName = original;
  }
});

test('with live off, an unnamed place is neutral and Google is never asked', async () => {
  // How a trip's embedded visits resolve: the trip already names the stops in
  // one capped batch, so each visit under them must not fetch its own live name.
  const hh = await household();
  const ref = `google:${randomUUID()}`;
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:names-nolive', 'test device') returning id`);
  const original = googleSource.displayName;
  let asked = 0;
  googleSource.displayName = async () => { asked += 1; return 'Nope'; };
  try {
    const rows = [{ venueRef: ref, locality: 'Leeds', name: null }];
    await runAsSpender({ householdId: hh, sessionId: s.id }, () => resolveNames(rows, { refKey: 'venueRef', live: false, purpose: 'test.names.nolive' }));
    assert.equal(asked, 0);
    assert.equal(rows[0].name, 'A place in Leeds');
  } finally {
    googleSource.displayName = original;
  }
});

test('two screens asking the same unnamed place at once make one Google call', async () => {
  const hh = await household();
  const ref = `google:${randomUUID()}`;
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:names-dedup', 'test device') returning id`);
  const original = googleSource.displayName;
  let calls = 0;
  googleSource.displayName = async () => { calls += 1; await new Promise((r) => setTimeout(r, 30)); return 'Shared'; };
  try {
    await runAsSpender({ householdId: hh, sessionId: s.id }, () => Promise.all([
      resolveNames([{ venueRef: ref, name: null }], { refKey: 'venueRef', purpose: 'test.names.dedup' }),
      resolveNames([{ venueRef: ref, name: null }], { refKey: 'venueRef', purpose: 'test.names.dedup' }),
    ]));
  } finally {
    googleSource.displayName = original;
  }
  assert.equal(calls, 1, 'the in-flight fetch is shared');
  const { rows: ledger } = await query(`select 1 from provider_calls where purpose = 'test.names.dedup' and venue_ref = $1`, [ref]);
  assert.equal(ledger.length, 1, 'and ledgered once');
});
