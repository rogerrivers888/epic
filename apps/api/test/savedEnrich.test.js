/**
 * The owner's saved places, researched once (owner, 2 Oct 2026, Part 2,
 * revised 16:45): only his saves; the free research first and Claude only for
 * what is still missing; every fact on the page Claude actually read, or
 * don't know; venue pictures by address only; Openverse pictures held back
 * until somebody has looked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const enrich = await import('../src/sources/savedEnrich.js');
const { licenceName, picturesFor } = await import('../src/sources/openverse.js');
const { picturesOnPage } = await import('../src/sources/venueImages.js');
const { PURPOSE_CLASSES } = await import('../src/domain/costClass.js');

test.after(() => pool.end());

async function household() {
  const { rows: [h] } = await query('insert into households (name) values ($1) returning id', ['saved enrich test']);
  return h.id;
}

test('only the enrolled account is researched; anybody else saving is left alone', async () => {
  const hh = await household();
  const ref = `google:se-${randomUUID()}`;
  const other = await enrich.requestEnrichment({ venueRef: ref, account: { id: null, email: 'someone@example.com' }, householdId: hh });
  assert.equal(other.started, false);
  assert.equal(other.why, 'not_enrolled');
  assert.equal(await enrich.enrichmentOf(ref), null, 'nothing is written for them');
  const his = await enrich.requestEnrichment({ venueRef: ref, account: { id: null, email: 'Roger@Epic.day' }, householdId: hh });
  assert.equal(his.started, true);
  assert.equal(typeof his.onDone, 'function', 'it follows the free research rather than queueing its own');
  assert.equal((await enrich.enrichmentOf(ref)).state, 'free');
  const again = await enrich.requestEnrichment({ venueRef: ref, account: { id: null, email: 'roger@epic.day' }, householdId: hh });
  assert.equal(again.started, false, 'once: a second save does not research it again');
  assert.equal(again.why, 'already');
});

test('a fact counts only from a page Claude actually fetched, and only the venue\'s own page enters the owned record', () => {
  const asks = [
    { id: 1, key: 'dog-friendly', label: 'Dog friendly' },
    { id: 2, key: 'kids-menu', label: "Children's menu" },
    { id: 3, key: 'step-free', label: 'Step free' },
    { id: 4, key: 'booking-required', label: 'Booking required' },
  ];
  const reply = {
    fields: {
      website: { value: 'https://www.sebastians.co.uk/', source_url: 'https://www.sebastians.co.uk/' },
      phone: { value: '01753 000000', source_url: 'https://www.sebastians.co.uk/contact' },
      booking_url: { value: 'https://book.example.com/sebastians', source_url: 'https://www.tripadvisor.co.uk/x' },
      menu_url: { value: 'https://www.sebastians.co.uk/menu.pdf', source_url: 'https://www.sebastians.co.uk/menus' },
      socials: [{ network: 'Instagram', url: 'https://instagram.com/sebastians', source_url: 'https://www.sebastians.co.uk/' }],
    },
    facts: [
      { key: 'dog-friendly', answer: 'yes', source_url: 'https://www.sebastians.co.uk/faq' },
      { key: 'kids-menu', answer: 'yes', source_url: 'https://www.sebastians.co.uk/not-read' },
      { key: 'step-free', answer: 'no', source_url: 'https://www.tripadvisor.co.uk/x' },
      { key: 'invented', answer: 'yes', source_url: 'https://www.sebastians.co.uk/faq' },
    ],
  };
  const fetched = [
    'https://www.sebastians.co.uk/', 'https://www.sebastians.co.uk/contact', 'https://www.sebastians.co.uk/menus',
    'https://www.sebastians.co.uk/faq#dogs', 'https://www.tripadvisor.co.uk/x',
  ];
  const j = enrich.judge({ reply, fetched, asks });
  assert.equal(j.website, 'https://www.sebastians.co.uk/', 'a website Claude opened is the venue\'s site');
  assert.deepEqual(Object.keys(j.siteFacts).sort(), ['menu_url', 'phone', 'socials', 'website']);
  assert.equal(j.fields.booking_url.source, 'other_page', 'read, but on a review site: shown, never owned');
  assert.equal(j.siteFacts.booking_url, undefined);
  assert.deepEqual(j.siteFacts.socials, { instagram: 'https://instagram.com/sebastians' });
  assert.equal(j.facts['dog-friendly'].answer, 'yes');
  assert.equal(j.facts['dog-friendly'].source, 'site');
  assert.equal(j.facts['kids-menu'].answer, 'unknown', 'a page nobody fetched is not a source');
  assert.equal(j.facts['step-free'].answer, 'unknown', 'a review site is not an owned source');
  assert.match(j.facts['step-free'].why, /not an owned source/);
  assert.equal(j.facts['booking-required'].answer, 'unknown', 'a question Claude skipped is said to be unknown');
  assert.equal(j.facts.invented, undefined, 'a key nobody asked is dropped');
  assert.deepEqual(j.answers.map((a) => [a.questionId, a.source, a.yesno]), [[1, 'site', true]]);
});

test('a website found only in search results, never opened, is not taken', () => {
  const j = enrich.judge({
    reply: { fields: { website: { value: 'https://guess.example/', source_url: 'https://guess.example/' } } },
    fetched: ['https://www.wikipedia.org/wiki/Somewhere'],
    asks: [],
  });
  assert.equal(j.website, null);
  assert.equal(j.siteFacts.website, undefined);
  assert.equal(j.fields.website.source, 'unknown');
});

test('an unparsable reply is a failed pass, never an empty one', () => {
  assert.equal(enrich.parseReply('I could not find it.'), null);
  assert.equal(enrich.parseReply('{"facts":[{"key":"x","answer":"maybe"}]}'), null, 'an answer outside yes/no/unknown');
  assert.deepEqual(enrich.parseReply('Here you go: {"facts":[]} thanks'), { facts: [] });
});

test('the pass: nothing missing means Claude is not asked; a reply it cannot read fails the row', async () => {
  const hh = await household();
  const ref = `google:pass-${randomUUID()}`;
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'free')`, [ref, hh]);
  await query(`insert into place_records (venue_ref, name, website, phone, booking_url, menu_url, socials, provenance)
               values ($1, 'Somewhere', 'https://s.example/', '0100', 'https://s.example/book', 'https://s.example/menu', '{"instagram":"https://instagram.com/s"}', '{}')`, [ref]);
  let asked = 0;
  const deps = {
    asks: [],
    openverse: async () => ({ ok: true, stored: [], refused: 0 }),
    venuePictures: async () => ({ ok: true, kept: 2 }),
    searchWeb: async () => { asked += 1; return { text: 'no idea', fetched: [], searches: 1 }; },
  };
  const out = await enrich.afterFree(ref, { householdId: hh, sessionId: null }, deps);
  assert.equal(out.state, 'done');
  assert.equal(asked, 0, 'the free research found everything, so nothing is paid for');
  assert.equal(Number((await enrich.enrichmentOf(ref)).last_cost_usd), 0);

  const ref2 = `google:pass2-${randomUUID()}`;
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'free')`, [ref2, hh]);
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Elsewhere', '{}')`, [ref2]);
  const failed = await enrich.afterFree(ref2, { householdId: hh, sessionId: null }, deps);
  assert.equal(asked, 1);
  assert.equal(failed.state, 'failed');
  assert.equal((await enrich.enrichmentOf(ref2)).error, 'unparsed_reply');
});

test('Openverse: the licence is the gate, and what is kept waits for a look', async () => {
  assert.equal(licenceName('by-sa', '2.0'), 'CC BY-SA 2.0');
  assert.equal(licenceName('cc0', '1.0'), 'CC0 1.0');
  assert.equal(licenceName('pdm', null), 'Public Domain Mark 1.0');
  assert.equal(licenceName('by-nc', '2.0'), 'CC BY-NC 2.0');
  const ref = `google:ov-${randomUUID()}`;
  const body = {
    results: [
      { id: 'nc1', title: 'A pub', thumbnail: 'https://x/nc', license: 'by-nc', license_version: '2.0', creator: 'A' },
      { id: `ok-${randomUUID()}`, title: 'The pub', thumbnail: 'https://x/ok', license: 'by', license_version: '2.0', creator: 'B', foreign_landing_url: 'https://flickr.com/p/1' },
    ],
  };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const out = await picturesFor({ venueRef: ref, name: 'The pub', locality: 'SL5' }, {
    fetchImpl: async () => ({ ok: true, json: async () => body }),
    fetchPictureImpl: async () => ({ body: jpeg, mime: 'image/jpeg', bytes: jpeg.length, width: 600, height: 400 }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.refused, 1, 'the non-commercial one is refused');
  assert.equal(out.stored.length, 1);
  const { rows: [img] } = await query(
    `select i.moderation, i.licence, l.role from image_assets i join image_links l on l.image_id = i.id
      where l.subject_type = 'place' and l.subject_id = $1`, [ref]);
  assert.equal(img.moderation, 'pending', 'a name search is a guess until somebody has looked');
  assert.equal(img.role, 'gallery', 'never the card picture by itself');
  assert.equal(img.licence, 'CC BY 2.0');

  const down = await picturesFor({ venueRef: ref, name: 'The pub' }, { fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(down.ok, false, 'a search that could not be made is not one that found nothing');
  assert.equal(down.why, 'openverse_http_503');
});

test('a venue page offers its share picture first, and its furniture is left out', () => {
  const html = `<html><head><meta property="og:image" content="/img/front.jpg"><meta name="twitter:image" content="https://cdn.v.example/terrace.jpg"></head>
    <body><img src="/logo.png" width="120"><img src="/icons/visa.png"><img src="/img/front.jpg"><img data-src="/img/dining.jpg" width="1200">
    <img srcset="/img/bar-400.jpg 400w, /img/bar-1600.jpg 1600w"><img src="/tiny.jpg" width="40"><img src="/plan.svg"></body></html>`;
  const pics = picturesOnPage(html, 'https://v.example/');
  assert.deepEqual(pics.map((p) => p.url), [
    'https://v.example/img/front.jpg', 'https://cdn.v.example/terrace.jpg', 'https://v.example/img/dining.jpg', 'https://v.example/img/bar-1600.jpg',
  ]);
  assert.equal(pics[0].why, 'og:image');
});

test('the new purposes are classified, so the ledger never reads them as unknown', () => {
  assert.equal(PURPOSE_CLASSES['claude.enrich.saved_place'], 'library');
  assert.equal(PURPOSE_CLASSES['admin.photo_compare'], 'office');
});

test('saving through claimPlace asks for the research only when the owner saves, and only for Places acts', async () => {
  const { claimPlace } = await import('../src/sources/own.js');
  const { runAsAccount } = await import('../src/context.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network closed in tests'); };
  try {
    const hh = await household();
    const mine = `google:claim-${randomUUID()}`;
    const theirs = `google:claim-${randomUUID()}`;
    const trip = `google:claim-${randomUUID()}`;
    await runAsAccount({ id: null, email: 'roger@epic.day', household_id: hh }, () => claimPlace(hh, mine, 'saved', { name: 'Mine' }));
    await runAsAccount({ id: null, email: 'guest@example.com', household_id: hh }, () => claimPlace(hh, theirs, 'saved', { name: 'Theirs' }));
    await runAsAccount({ id: null, email: 'roger@epic.day', household_id: hh }, () => claimPlace(hh, trip, 'shortlisted', { name: 'On a trip' }));
    assert.ok(await enrich.enrichmentOf(mine), 'the owner saving a place starts its research');
    assert.equal(await enrich.enrichmentOf(theirs), null, 'nobody else');
    assert.equal(await enrich.enrichmentOf(trip), null, 'a trip shortlist is not adding to Places');
  } finally { globalThis.fetch = realFetch; }
});

test('the backfill: saved, loved or been and not yet researched; refused when the count moved since the quote', async () => {
  const hh = await household();
  const saved = `google:bf-${randomUUID()}`; const been = `google:bf-${randomUUID()}`;
  const dismissed = `google:bf-${randomUUID()}`; const done = `google:bf-${randomUUID()}`;
  for (const r of [saved, been, dismissed, done]) {
    await query(`insert into household_places (household_id, venue_ref, label) values ($1, $2, 'x')`, [hh, r]);
  }
  const ledger = (ref, status) => query(`insert into place_ledger (household_id, source, source_place_id, status) values ($1, 'google', $2, $3)`, [hh, ref.slice(7), status]);
  await ledger(saved, 'saved'); await ledger(dismissed, 'dismissed'); await ledger(done, 'saved');
  await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, $2, 'x', current_date)`, [hh, been]);
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'done')`, [done, hh]);
  const refs = await enrich.backfillCandidates(hh);
  assert.deepEqual(refs.sort(), [been, saved].sort());
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network closed in tests'); };
  try {
    const owner = { id: null, email: 'roger@epic.day' };
    assert.equal((await enrich.backfill({ account: { email: 'x@y.z' }, householdId: hh, expectPlaces: 2 })).why, 'not_enrolled');
    const moved = await enrich.backfill({ account: owner, householdId: hh, expectPlaces: 5 });
    assert.equal(moved.why, 'quote_changed', 'a list that changed is priced again, not spent');
    assert.equal(moved.started, 0);
    const ok = await enrich.backfill({ account: owner, householdId: hh, expectPlaces: 2 });
    assert.equal(ok.started, 2);
    assert.deepEqual(await enrich.backfillCandidates(hh), [], 'once started, they are no longer candidates');
  } finally { globalThis.fetch = realFetch; }
});
