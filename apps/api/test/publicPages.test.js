/**
 * Epic Events on the web (brief, 3 Oct 2026): what the public event and host
 * pages say, to whom, and for how long (routes/publicPages.js, migration 369).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const pages = await import('../src/routes/publicPages.js');
const { plusDays, localDay } = await import('../src/domain/lanes.js');

test.after(() => pool.end());

const today = () => localDay(new Date(), 'Europe/London');

async function server() {
  const app = express();
  app.use('/api/public', pages.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err.message) }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  return {
    close: () => new Promise((r) => s.close(r)),
    get: (p) => fetch(base + p).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer() })),
  };
}

async function aHost(extra = {}) {
  const { household } = await aHousehold(query);
  const { rows: [h] } = await query(
    `insert into hosts (household_id, name, lat, lng, address, checked_state, paused, stopped_at) values ($1, 'Hannah Robinson', 51.41, -0.67, '7 Secret Lane', $2, $3, $4) returning *`,
    [household.id, extra.checked ?? 'passed', extra.paused ?? false, extra.stopped ?? null],
  );
  return { household, h };
}

async function aPhoto(householdId, isPrivate = false) {
  const { rows: [m] } = await query(
    `insert into host_media (household_id, kind, mime, size, bytes, is_private) values ($1, 'photo', 'image/png', 3, '\\x010203', $2) returning id`,
    [householdId, isPrivate],
  );
  return m.id;
}

async function anEvent(h, { visibility = 'public', state = 'live', inDays = [7], calledOffDaysAgo = null, photo = null, title = 'Fossil hunting with a geologist' } = {}) {
  const { rows: [o] } = await query(
    `insert into host_offers (host_id, shape, lane, state, title, summary, description, visibility, venue, venue_label, venue_area, venue_lat, venue_lng, what_category, what_label, photo_ids, called_off_at, starts_at)
     values ($1, 'oneoff', 'oneoff', $2, $3, 'Ammonites on the shore', 'Two hours on the beach.', $4, 'their_place', '1 Cliff Road, Charmouth DT6 6QX', 'Charmouth', 50.73, -2.9, 'Outdoors', 'Fossil hunting', $5::jsonb, $6, '10:00') returning *`,
    [h.id, state, title, visibility, JSON.stringify(photo ? [photo] : []), calledOffDaysAgo == null ? null : new Date(Date.now() - calledOffDaysAgo * 86_400_000)],
  );
  for (const d of inDays) await query(`insert into offer_sessions (offer_id, on_date, starts_at) values ($1, $2, '10:00')`, [o.id, plusDays(today(), d)]);
  return o;
}

test('every event and host has a permanent public code, made on the way in', async () => {
  const { h } = await aHost();
  const o = await anEvent(h);
  assert.match(o.public_code, /^[a-z2-9]{6}$/);
  assert.match(h.public_code, /^[a-z2-9]{6}$/);
  assert.equal(pages.eventPath(o), `/en-gb/event/fossil-hunting-with-a-geologist-${o.public_code}`);
  assert.equal(pages.hostPath(h), `/en-gb/hosts/hannah-r-${h.public_code}`);
  assert.equal(pages.slugOf('Café & Crêpes — for 5–7s!'), 'cafe-and-crepes-for-5-7s');
});

test('a live public event: the safe facts, the host as "Hannah R.", the town and never the address', async () => {
  const { household, h } = await aHost();
  const photo = await aPhoto(household.id);
  const o = await anEvent(h, { photo });
  const srv = await server();
  try {
    const r = await srv.get(`/api/public/events/${o.public_code}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'live');
    assert.equal(r.body.host.name, 'Hannah R.');
    assert.deepEqual(r.body.where, { area: 'Charmouth', online: false });
    const text = JSON.stringify(r.body);
    for (const secret of ['Cliff Road', 'DT6 6QX', 'Secret Lane', '50.73', '51.41', 'Robinson']) assert.ok(!text.includes(secret), `never ${secret}`);
    assert.equal(r.body.photos[0], `/api/public/media/${photo}`);
    // Its photo is served while its page is.
    const img = await srv.get(`/api/public/media/${photo}`);
    assert.equal(img.status, 200);
    assert.equal(img.type, 'image/png');
  } finally { await srv.close(); }
});

test('not on the web at all: private, link-only, drafts and events in review; and their photos', async () => {
  const { household, h } = await aHost();
  const photo = await aPhoto(household.id);
  const srv = await server();
  try {
    for (const [visibility, state] of [['invite', 'live'], ['link', 'live'], ['public', 'draft'], ['public', 'in_review'], ['public', 'approved']]) {
      const o = await anEvent(h, { visibility, state, photo });
      assert.equal((await srv.get(`/api/public/events/${o.public_code}`)).status, 404, `${visibility} ${state}`);
    }
    assert.equal((await srv.get(`/api/public/media/${photo}`)).status, 404, 'a photo only on unlisted events is not served');
    assert.equal((await srv.get('/api/public/events/NOT A CODE')).status, 404);
  } finally { await srv.close(); }
});

test('finished for 90 days, called off for 30, then expired; a paused host’s events are gone', async () => {
  const { h } = await aHost();
  const srv = await server();
  try {
    const st = async (o) => (await srv.get(`/api/public/events/${o.public_code}`)).body.status;
    assert.equal(await st(await anEvent(h, { inDays: [-10] })), 'finished');
    assert.equal(await st(await anEvent(h, { inDays: [-100] })), 'expired');
    assert.equal(await st(await anEvent(h, { calledOffDaysAgo: 5 })), 'called_off');
    assert.equal(await st(await anEvent(h, { calledOffDaysAgo: 40 })), 'expired');
    const { h: paused } = await aHost({ paused: true });
    assert.equal(await st(await anEvent(paused)), 'gone');
    const gone = (await srv.get(`/api/public/hosts/${paused.public_code}`)).body;
    assert.equal(gone.status, 'gone');
  } finally { await srv.close(); }
});

test('a host page: their live events, indexable, and the sitemap lists what is shown', async () => {
  const { h } = await aHost();
  const o = await anEvent(h, { title: 'Rock pooling' });
  const priv = await anEvent(h, { visibility: 'invite', title: 'Private party' });
  const srv = await server();
  try {
    const p = (await srv.get(`/api/public/hosts/${h.public_code}`)).body;
    assert.equal(p.name, 'Hannah R.');
    assert.equal(p.indexable, true);
    assert.equal(p.town, 'Charmouth');
    assert.deepEqual(p.events.map((e) => e.title), ['Rock pooling']);
    const map = (await srv.get('/api/public/sitemap')).body;
    assert.ok(map.events.some((e) => e.path === pages.eventPath(o)));
    assert.ok(!map.events.some((e) => e.path === pages.eventPath(priv)), 'never a private event');
    assert.ok(map.hosts.some((x) => x.path === pages.hostPath(h)));
  } finally { await srv.close(); }
});
