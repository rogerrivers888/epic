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
  // Been once, dismissed since: out, whatever the visit says.
  await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, $2, 'x', current_date)`, [hh, dismissed]);
  // Dismissed once, saved again since: in Places, so a candidate.
  const resaved = `google:bf-${randomUUID()}`;
  await query(`insert into household_places (household_id, venue_ref, label) values ($1, $2, 'x')`, [hh, resaved]);
  await query(`insert into place_ledger (household_id, source, source_place_id, status, created_at) values ($1, 'google', $2, 'dismissed', now() - interval '1 day')`, [hh, resaved.slice(7)]);
  await ledger(resaved, 'saved');
  await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, $2, 'x', current_date)`, [hh, been]);
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'done')`, [done, hh]);
  const refs = await enrich.backfillCandidates(hh);
  assert.deepEqual(refs.sort(), [been, saved, resaved].sort());
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network closed in tests'); };
  try {
    const owner = { id: null, email: 'roger@epic.day' };
    assert.equal((await enrich.backfill({ account: { email: 'x@y.z' }, householdId: hh, expectPlaces: 3 })).why, 'not_enrolled');
    const moved = await enrich.backfill({ account: owner, householdId: hh, expectPlaces: 5 });
    assert.equal(moved.why, 'quote_changed', 'a list that changed is priced again, not spent');
    assert.equal(moved.started, 0);
    const ok = await enrich.backfill({ account: owner, householdId: hh, expectPlaces: 3 });
    assert.equal(ok.started, 3);
    assert.deepEqual(await enrich.backfillCandidates(hh), [], 'once started, they are no longer candidates');
  } finally { globalThis.fetch = realFetch; }
});

test('a re-run is refused while a pass is under way; a pass that fails after Claude answered still records what it cost', async () => {
  const hh = await household();
  const ref = `google:rr-${randomUUID()}`;
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'claude')`, [ref, hh]);
  const busy = await enrich.requestEnrichment({ venueRef: ref, account: null, householdId: hh, rerun: true });
  assert.equal(busy.started, false, 'never a second pipeline beside a running one');
  await query(`update saved_place_enrichment set state = 'done' where venue_ref = $1`, [ref]);
  assert.equal((await enrich.requestEnrichment({ venueRef: ref, account: null, householdId: hh, rerun: true })).started, true);

  const ref2 = `google:cost-${randomUUID()}`;
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'free')`, [ref2, hh]);
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Costly', '{}')`, [ref2]);
  const out = await enrich.afterFree(ref2, { householdId: hh, sessionId: null }, {
    asks: [], openverse: async () => ({ ok: true, stored: [], refused: 0 }),
    searchWeb: async ({ meta }) => { meta.costUsd = 0.07; return { text: 'not json', fetched: [], searches: 2 }; },
  });
  assert.equal(out.state, 'failed');
  const row = await enrich.enrichmentOf(ref2);
  assert.equal(Number(row.last_cost_usd), 0.07, 'the ledger and the row agree');
  assert.equal(Number(row.cost_usd), 0.07);
});

test('an Openverse picture already held for another place is not attached to a second one by name', async () => {
  const id = `shared-${randomUUID()}`;
  const body = { results: [{ id, title: 'The Crown', thumbnail: 'https://x/c', license: 'by', license_version: '2.0', creator: 'C' }] };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const deps = {
    fetchImpl: async () => ({ ok: true, json: async () => body }),
    fetchPictureImpl: async () => ({ body: jpeg, mime: 'image/jpeg', bytes: jpeg.length, width: 600, height: 400 }),
  };
  const first = `google:crown-a-${randomUUID()}`; const second = `google:crown-b-${randomUUID()}`;
  assert.equal((await picturesFor({ venueRef: first, name: 'The Crown' }, deps)).stored.length, 1);
  await query(`update image_assets set moderation = 'approved' where source_ref = $1`, [`openverse:${id}`]);
  const out = await picturesFor({ venueRef: second, name: 'The Crown' }, deps);
  assert.equal(out.stored.length, 0, 'an approval for one Crown is not an approval for another');
  const { rows } = await query(`select count(*)::int as n from image_links where subject_type = 'place' and subject_id = $1`, [second]);
  assert.equal(rows[0].n, 0);
});

test('a website Claude found and opened has its pictures looked for at once', async () => {
  const hh = await household();
  const ref = `google:found-site-${randomUUID()}`;
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'free')`, [ref, hh]);
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Found Later', '{}')`, [ref]);
  const looked = [];
  await enrich.afterFree(ref, { householdId: hh, sessionId: null }, {
    asks: [],
    openverse: async () => ({ ok: true, stored: [], refused: 0 }),
    venuePictures: async (r, site) => {
      looked.push(site);
      for (const n of [1, 2, 3]) await query(`insert into venue_site_images (venue_ref, image_url, page_url) values ($1, $2, $3)`, [r, `${site}${n}.jpg`, site]);
      return { ok: true, kept: 3 };
    },
    searchWeb: async ({ meta }) => {
      meta.costUsd = 0.02;
      return { text: '{"fields":{"website":{"value":"https://found.example/","source_url":"https://found.example/"}}}', fetched: ['https://found.example/'], searches: 1 };
    },
  });
  assert.deepEqual(looked, ['https://found.example/'], 'not left for a re-run');
  assert.equal((await enrich.enrichmentOf(ref)).found.pictures.venueSite.kept, 3);
});

test('a cited page must match the page read in its path case; a rejected Openverse picture is not counted again', async () => {
  const j = enrich.judge({
    reply: { fields: { website: { value: 'https://Case.example/', source_url: 'https://Case.example/' }, menu_url: { value: 'https://case.example/menu.pdf', source_url: 'https://case.example/menu' } } },
    fetched: ['https://CASE.example/', 'https://case.example/Menu'],
    asks: [],
  });
  assert.ok(j.website, 'host case does not matter');
  assert.equal(j.siteFacts.menu_url, undefined, '"/Menu" read does not vouch for "/menu"');

  const id = `rej-${randomUUID()}`;
  const ref = `google:rej-${randomUUID()}`;
  const body = { results: [{ id, title: 'Turned down', thumbnail: 'https://x/r', license: 'by', license_version: '2.0' }] };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const deps = { fetchImpl: async () => ({ ok: true, json: async () => body }), fetchPictureImpl: async () => ({ body: jpeg, mime: 'image/jpeg', bytes: jpeg.length, width: 600, height: 400 }) };
  assert.equal((await picturesFor({ venueRef: ref, name: 'Turned down' }, deps)).stored.length, 1);
  await query(`update image_assets set moderation = 'rejected' where source_ref = $1`, [`openverse:${id}`]);
  assert.equal((await picturesFor({ venueRef: ref, name: 'Turned down' }, deps)).stored.length, 0);
});

test('a re-run is only of a place already researched; social links keep the page they were read on', async () => {
  const hh = await household();
  const out = await enrich.requestEnrichment({ venueRef: `google:never-${randomUUID()}`, account: null, householdId: hh, rerun: true });
  assert.equal(out.started, false);
  assert.equal(out.why, 'not_found', 'never a way to start the paid pass on an arbitrary place');
  const j = enrich.judge({
    reply: { fields: { website: { value: 'https://soc.example/', source_url: 'https://soc.example/' }, socials: [{ network: 'Instagram', url: 'https://instagram.com/soc', source_url: 'https://soc.example/contact' }] } },
    fetched: ['https://soc.example/', 'https://soc.example/contact'],
    asks: [],
  });
  assert.equal(j.fields.socials.sourceUrl, 'https://soc.example/contact', 'the page read, not the root assumed');
});

test('the website keeps a page that was fetched as its source; a venue picture seen again keeps when it was first found', async () => {
  const j = enrich.judge({
    reply: { fields: { website: { value: 'https://root.example/', source_url: 'https://root.example/' } } },
    fetched: ['https://root.example/menu'],
    asks: [],
  });
  assert.equal(j.fields.website.sourceUrl, 'https://root.example/menu', 'never the unread root');

  const { venuePicturesFor } = await import('../src/sources/venueImages.js');
  const ref = `google:seen-${randomUUID()}`;
  const page = { url: 'https://seen.example/', html: '<meta property="og:image" content="/a.jpg">' };
  const deps = { fetchHtmlImpl: async () => page, politeness: async () => ({ ok: true }) };
  await venuePicturesFor(ref, 'https://seen.example/', deps);
  await query(`update venue_site_images set found_at = now() - interval '2 days' where venue_ref = $1`, [ref]);
  await venuePicturesFor(ref, 'https://seen.example/', deps);
  const { rows: [r] } = await query(`select found_at < now() - interval '1 day' as old from venue_site_images where venue_ref = $1`, [ref]);
  assert.equal(r.old, true, 'seen again is not found again');
});

test('a re-run leaves an Openverse card picture it already holds exactly as it is', async () => {
  const id = `hero-${randomUUID()}`;
  const ref = `google:hero-${randomUUID()}`;
  const body = { results: [{ id, title: 'Kept', thumbnail: 'https://x/k', license: 'by', license_version: '2.0' }] };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const deps = { fetchImpl: async () => ({ ok: true, json: async () => body }), fetchPictureImpl: async () => ({ body: jpeg, mime: 'image/jpeg', bytes: jpeg.length, width: 600, height: 400 }) };
  await picturesFor({ venueRef: ref, name: 'Kept' }, deps);
  await query(`update image_assets set moderation = 'approved' where source_ref = $1`, [`openverse:${id}`]);
  await query(`update image_links set role = 'hero' where subject_id = $1`, [ref]);
  const again = await picturesFor({ venueRef: ref, name: 'Kept' }, deps);
  assert.equal(again.stored.length, 0, 'not counted as found again');
  const { rows: [l] } = await query(`select role from image_links where subject_id = $1`, [ref]);
  assert.equal(l.role, 'hero', 'still the card picture');
});

test('a review site, social page or booking platform is never taken as the venue\'s own website', () => {
  const j = enrich.judge({
    reply: {
      fields: {
        website: { value: 'https://www.tripadvisor.co.uk/Restaurant_Review-x', source_url: 'https://www.tripadvisor.co.uk/Restaurant_Review-x' },
        phone: { value: '0100', source_url: 'https://www.tripadvisor.co.uk/Restaurant_Review-x' },
      },
      facts: [{ key: 'dogs', answer: 'yes', source_url: 'https://www.tripadvisor.co.uk/Restaurant_Review-x' }],
    },
    fetched: ['https://www.tripadvisor.co.uk/Restaurant_Review-x'],
    asks: [{ id: 9, key: 'dogs', label: 'Dogs' }],
  });
  assert.equal(j.website, null);
  assert.deepEqual(j.siteFacts, {}, 'nothing read there is filed as the venue\'s own');
  assert.match(j.fields.website.why, /not the venue's own site/);
  assert.equal(j.facts.dogs.answer, 'unknown');
  assert.equal(enrich.notTheVenue('https://m.facebook.com/x'), true);
  assert.equal(enrich.notTheVenue('https://www.sebastians.co.uk/'), false);
});

test('a listing or social page on record is not trusted as the venue\'s site, for facts or pictures', async () => {
  const j = enrich.judge({
    reply: { fields: { phone: { value: '0100', source_url: 'https://www.facebook.com/venue/about' } } },
    fetched: ['https://www.facebook.com/venue/about'],
    knownWebsite: 'https://www.facebook.com/venue',
    asks: [],
  });
  assert.equal(j.website, null);
  assert.deepEqual(j.siteFacts, {});
  const hh = await household();
  const ref = `google:fbsite-${randomUUID()}`;
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'free')`, [ref, hh]);
  await query(`insert into place_records (venue_ref, name, website, provenance) values ($1, 'Facebook Only', 'https://www.facebook.com/venue', '{}')`, [ref]);
  const looked = []; let prompt = null;
  await enrich.afterFree(ref, { householdId: hh, sessionId: null }, {
    asks: [], openverse: async () => ({ ok: true, stored: [], refused: 0 }),
    venuePictures: async (_r, site) => { looked.push(site); return { ok: true, kept: 0 }; },
    searchWeb: async (args) => { prompt = args.prompt; return { text: '{"fields":{}}', fetched: [], searches: 1 }; },
  });
  assert.deepEqual(looked, [], 'no pictures taken from a Facebook page');
  assert.match(prompt, /not known yet/, 'Claude is asked to find the real one');
  assert.match((await enrich.enrichmentOf(ref)).found.fields.website.why, /not the venue's own site/);
});

test('a pass cut short while Claude was asked is not paid for twice; a re-run keeps the page each fact was read on', async () => {
  const hh = await household();
  const ref = `google:cut-${randomUUID()}`;
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state, last_run_at) values ($1, $2, 'claude', now() - interval '1 hour')`, [ref, hh]);
  await enrich.resumeStale({ olderThanMinutes: 15 });
  const row = await enrich.enrichmentOf(ref);
  assert.equal(row.state, 'failed', 'never asked again by itself');
  assert.match(row.error, /Re-run/);

  const ref2 = `google:keep-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, phone, provenance) values ($1, 'Kept Page', '0100', '{"phone":"site"}')`, [ref2]);
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state, found) values ($1, $2, 'free', $3)`,
    [ref2, hh, JSON.stringify({ fields: { phone: { value: '0100', source: 'site', sourceUrl: 'https://kp.example/contact', checkedAt: '2026-10-02T10:00:00Z' } } })]);
  await enrich.afterFree(ref2, { householdId: hh, sessionId: null }, {
    asks: [], openverse: async () => ({ ok: true, stored: [], refused: 0 }),
    searchWeb: async () => ({ text: '{"fields":{}}', fetched: [], searches: 0 }),
  });
  assert.equal((await enrich.enrichmentOf(ref2)).found.fields.phone.sourceUrl, 'https://kp.example/contact');
});

test('a re-run shows the facts already answered beside its own', async () => {
  const hh = await household();
  const ref = `google:facts-${randomUUID()}`;
  const key = `test-dogs-${randomUUID().slice(0, 8)}`;
  await query(`insert into place_attributes (key, label, kind) values ($1, 'Dogs welcome', 'yesno')`, [key]);
  const { rows: [q] } = await query(`insert into questions (attribute_key, scope, active) values ($1, 'global', true) returning id, attribute_key`, [key]);
  await query(`insert into place_answers (venue_ref, question_id, source, state, yesno, source_url) values ($1, $2, 'osm', 'answered', true, 'https://www.openstreetmap.org/node/1')`, [ref, q.id]);
  await query(`insert into place_records (venue_ref, name, provenance) values ($1, 'Answered Before', '{}')`, [ref]);
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'free')`, [ref, hh]);
  await enrich.afterFree(ref, { householdId: hh, sessionId: null }, {
    asks: [], openverse: async () => ({ ok: true, stored: [], refused: 0 }),
    searchWeb: async () => ({ text: '{"fields":{}}', fetched: [], searches: 0 }),
  });
  const f = (await enrich.enrichmentOf(ref)).found.facts[q.attribute_key];
  assert.equal(f.answer, 'yes');
  assert.equal(f.source, 'osm');
});

test('a venue page that redirects off its own site gives up no pictures', async () => {
  const { venuePicturesFor } = await import('../src/sources/venueImages.js');
  const ref = `google:redir-${randomUUID()}`;
  const out = await venuePicturesFor(ref, 'https://venue.example/', {
    fetchHtmlImpl: async () => ({ url: 'https://www.facebook.com/venue', html: '<meta property="og:image" content="https://fb.example/x.jpg">' }),
    politeness: async () => ({ ok: true }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.why, 'redirected_off_site');
  const { rows } = await query('select count(*)::int as n from venue_site_images where venue_ref = $1', [ref]);
  assert.equal(rows[0].n, 0);
  const sub = await venuePicturesFor(`google:redir2-${randomUUID()}`, 'https://venue.example/', {
    fetchHtmlImpl: async () => ({ url: 'https://www.venue.example/home', html: '<meta property="og:image" content="/a.jpg">' }),
    politeness: async () => ({ ok: true }),
  });
  assert.equal(sub.ok, true, 'its own www is still its own site');
});

test('a redirect off the venue\'s site is refused before the other site is contacted; on-site hops are each asked politely', async () => {
  const { fetchVenuePage } = await import('../src/sources/venueImages.js');
  const contacted = []; const asked = [];
  const resolve = async (u) => ({ url: new URL(u), address: '93.184.216.34', family: 4 });
  const request = async (at) => {
    const u = at.url.href;
    contacted.push(u);
    if (u === 'https://v.example/') return { status: 301, location: 'https://www.v.example/home', type: '', body: '' };
    if (u === 'https://www.v.example/home') return { status: 302, location: 'https://www.facebook.com/v', type: '', body: '' };
    return { status: 200, location: null, type: 'text/html', body: '<html></html>' };
  };
  const out = await fetchVenuePage('https://v.example/', { resolve, request, politeness: async (u) => { asked.push(u); return { ok: true }; } });
  assert.deepEqual(out, { refused: 'redirected_off_site' });
  assert.ok(!contacted.some((u) => u.includes('facebook')), 'Facebook never contacted');
  assert.deepEqual(asked, ['https://v.example/', 'https://www.v.example/home'], 'each on-site hop asked first');
});

test('a venue website at a private address is never fetched', async () => {
  const { fetchVenuePage } = await import('../src/sources/venueImages.js');
  let contacted = 0;
  const out = await fetchVenuePage('http://127.0.0.1:4000/', { request: async () => { contacted += 1; return { status: 200, type: 'text/html', body: '' }; }, politeness: async () => ({ ok: true }) });
  assert.deepEqual(out, { refused: 'not_a_public_address' });
  assert.equal(contacted, 0);
  const { isPrivate } = await import('../src/sources/safeFetch.js');
  assert.equal(isPrivate('10.1.2.3'), true);
  assert.equal(isPrivate('93.184.216.34'), false);
});

test('Claude fills only what was missing: a field the free research holds is not overwritten', async () => {
  const hh = await household();
  const ref = `google:onlymissing-${randomUUID()}`;
  await query(`insert into place_records (venue_ref, name, website, phone, provenance) values ($1, 'Only Missing', 'https://om.example/', '0100 FREE', '{"phone":"osm","website":"osm"}')`, [ref]);
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state) values ($1, $2, 'free')`, [ref, hh]);
  await enrich.afterFree(ref, { householdId: hh, sessionId: null }, {
    asks: [], openverse: async () => ({ ok: true, stored: [], refused: 0 }), venuePictures: async () => ({ ok: true, kept: 0 }),
    searchWeb: async () => ({
      text: JSON.stringify({ fields: {
        phone: { value: '0200 CLAUDE', source_url: 'https://om.example/contact' },
        booking_url: { value: 'https://om.example/book', source_url: 'https://om.example/contact' },
      } }),
      fetched: ['https://om.example/contact'], searches: 0,
    }),
  });
  const { rows } = await query(`select field, value from place_facts where venue_ref = $1 and source = 'site'`, [ref]);
  const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
  assert.equal(byField.phone, undefined, 'the phone the open map gave stays the one on record');
  assert.equal(byField.booking_url, 'https://om.example/book', 'the missing booking link is filled');
  const found = (await enrich.enrichmentOf(ref)).found.fields;
  assert.equal(found.phone.value, '0100 FREE');
});

test('a re-run clears the last run\'s phase times', async () => {
  const hh = await household();
  const ref = `google:times-${randomUUID()}`;
  await query(`insert into saved_place_enrichment (venue_ref, household_id, state, free_done_at, claude_done_at) values ($1, $2, 'done', now(), now())`, [ref, hh]);
  assert.equal((await enrich.requestEnrichment({ venueRef: ref, account: null, householdId: hh, rerun: true })).started, true);
  const row = await enrich.enrichmentOf(ref);
  assert.equal(row.free_done_at, null);
  assert.equal(row.claude_done_at, null);
});

test('a re-read of the venue page drops pictures it no longer shows; a failed read drops nothing', async () => {
  const { venuePicturesFor } = await import('../src/sources/venueImages.js');
  const ref = `google:drop-${randomUUID()}`;
  const page = (img) => ({ fetchHtmlImpl: async () => ({ url: 'https://d.example/', html: `<meta property="og:image" content="${img}">` }), politeness: async () => ({ ok: true }) });
  await venuePicturesFor(ref, 'https://d.example/', page('/old.jpg'));
  await venuePicturesFor(ref, 'https://d.example/', page('/new.jpg'));
  const urls = async () => (await query('select image_url from venue_site_images where venue_ref = $1 order by image_url', [ref])).rows.map((r) => r.image_url);
  assert.deepEqual(await urls(), ['https://d.example/new.jpg']);
  await venuePicturesFor(ref, 'https://d.example/', { fetchHtmlImpl: async () => null, politeness: async () => ({ ok: true }) });
  assert.deepEqual(await urls(), ['https://d.example/new.jpg'], 'an unreadable page is not an empty one');
});
