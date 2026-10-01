/**
 * Back office › Waitlist (WL1) — routes/waitlist.js.
 *
 * What would go wrong without anybody noticing: totals that move with the
 * filter, a campaign that is "Direct" in the breakdown and something else in the
 * filter, an export that carries a formula into somebody's spreadsheet, a delete
 * whose audit row keeps the very address it was asked to erase, and a reader who
 * can take the whole list away as a file. Those are what is pinned.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();

const waitlistRoutes = (await import('../src/routes/waitlist.js')).default;
const { csvCell } = await import('../src/routes/waitlist.js');
const access = await import('../src/access.js');

const OWNER = { isOwner: true, doors: ['client', 'admin'], capabilities: new Set(access.CAPABILITIES.map((c) => c.key)) };
const READER = { isOwner: false, doors: ['client', 'admin'], capabilities: new Set(['view_waitlist']) };
const NOBODY = { isOwner: false, doors: ['client', 'admin'], capabilities: new Set(['view_accounts']) };

let who = OWNER;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.account = { id: null, email: 'owner@epic.day' }; req.access = who; next(); });
app.use('/api/admin', waitlistRoutes);
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); return pool.end(); });

const call = async (method, path, acc = OWNER) => {
  who = acc;
  const res = await fetch(base + path, { method });
  const raw = await res.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { body = raw; }
  return { status: res.status, body, headers: res.headers };
};

const add = async (email, { source = 'home', kind = null, locale = 'en-gb', campaign = null, utmSource = null, landing = null, daysAgo = 0 } = {}) => {
  const { rows } = await query(
    `insert into interest_signups (email, source, host_kind, locale, utm_campaign, utm_source, landing_page, consent_wording, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'Remind me', now() - make_interval(days => $8))
     returning id`,
    [email, source, kind, locale, campaign, utmSource, landing, daysAgo],
  );
  return rows[0].id;
};

const ids = {};
test.before(async () => {
  ids.a = await add('a@example.com', { campaign: 'october', daysAgo: 1 });
  ids.b = await add('b@example.com', { utmSource: 'newsletter', locale: 'en-us', daysAgo: 2 });
  ids.c = await add('c@example.com', { daysAgo: 20 });
  ids.d = await add('d@example.com', { source: 'host', kind: 'class', campaign: 'october', daysAgo: 3 });
  ids.e = await add('e@example.com', { source: 'host', kind: 'homeschool', landing: 'Half term', daysAgo: 30 });
  ids.f = await add('=cmd|evil@example.com', { source: 'host', daysAgo: 0 });
});

test('the list: totals and breakdowns over everybody, rows newest first', async () => {
  const { status, body } = await call('GET', '/api/admin/waitlist');
  assert.equal(status, 200);
  assert.deepEqual(body.totals, { all: 6, home: 3, host: 3, last7: 4 });
  assert.equal(body.count, 6);
  assert.deepEqual(body.rows.map((r) => r.email),
    ['=cmd|evil@example.com', 'a@example.com', 'b@example.com', 'd@example.com', 'c@example.com', 'e@example.com']);

  const kinds = Object.fromEntries(body.byKind.map((k) => [k.key, k]));
  assert.deepEqual(body.byKind.map((k) => k.key), ['one-off', 'activity', 'class', 'homeschool', 'none']);
  assert.equal(kinds['one-off'].signups, 0);
  assert.equal(kinds['one-off'].share, 0);
  assert.equal(kinds.class.signups, 1);
  assert.equal(kinds.none.signups, 4);
  assert.equal(kinds.none.label, 'Not given');
  assert.equal(kinds.none.share, 0.6667);

  // Campaign: utm_campaign, else utm_source, else Direct.
  const camps = Object.fromEntries(body.byCampaign.map((c) => [c.key, c.signups]));
  assert.deepEqual(camps, { Direct: 3, october: 2, newsletter: 1 });
  assert.equal(body.byCampaign[0].key, 'Direct', 'biggest first');

  const e = body.rows.find((r) => r.email === 'e@example.com');
  assert.equal(e.sourceLabel, 'Landing · Half term');
  assert.equal(e.hostKindLabel, 'Homeschool');
  assert.equal(body.rows.find((r) => r.email === 'd@example.com').sourceLabel, 'Host page');
  assert.equal(body.rows.find((r) => r.email === 'a@example.com').sourceLabel, 'Homepage');
  assert.equal(body.rows.find((r) => r.email === 'b@example.com').campaign, 'newsletter');
});

test('filters narrow the rows and the count, never the totals', async () => {
  const host = await call('GET', '/api/admin/waitlist?source=host');
  assert.equal(host.body.count, 3);
  assert.equal(host.body.totals.all, 6, 'totals are everybody');
  assert.ok(host.body.rows.every((r) => r.source === 'host'));

  assert.deepEqual((await call('GET', '/api/admin/waitlist?kind=none')).body.rows.map((r) => r.email).sort(),
    ['=cmd|evil@example.com', 'a@example.com', 'b@example.com', 'c@example.com']);
  assert.deepEqual((await call('GET', '/api/admin/waitlist?kind=class')).body.rows.map((r) => r.email), ['d@example.com']);
  assert.deepEqual((await call('GET', '/api/admin/waitlist?locale=en-us')).body.rows.map((r) => r.email), ['b@example.com']);
  assert.deepEqual((await call('GET', '/api/admin/waitlist?campaign=Direct')).body.rows.map((r) => r.email).sort(),
    ['=cmd|evil@example.com', 'c@example.com', 'e@example.com']);
  assert.deepEqual((await call('GET', '/api/admin/waitlist?campaign=newsletter')).body.rows.map((r) => r.email), ['b@example.com']);
  assert.deepEqual((await call('GET', '/api/admin/waitlist?search=A@EXAMPLE')).body.rows.map((r) => r.email), ['a@example.com']);
  assert.equal((await call('GET', '/api/admin/waitlist?search=%25')).body.count, 0, 'a % typed is a letter, not a wildcard');
  const both = await call('GET', '/api/admin/waitlist?source=host&campaign=october');
  assert.deepEqual(both.body.rows.map((r) => r.email), ['d@example.com']);
});

test('an unknown filter value is refused rather than widened to everything', async () => {
  for (const q of ['source=footer', 'kind=juggling', 'locale=fr-fr']) {
    const r = await call('GET', `/api/admin/waitlist?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.error, 'bad_filter');
  }
});

test('the CSV: the filtered rows, the columns, quoting, and formulas neutralised', async () => {
  const before = (await query(`select count(*)::int as n from admin_audit where action = 'waitlist.export'`)).rows[0].n;
  const r = await call('GET', '/api/admin/waitlist.csv?source=host&search=example');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/csv/);
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(r.headers.get('content-disposition'), `attachment; filename="epic-waitlist-${day}.csv"`);
  const lines = r.body.replace(/^﻿/, '').trimEnd().split('\r\n');
  assert.equal(lines[0], 'email,source,host_kind,locale,campaign,signed_up');
  assert.equal(lines.length, 4, 'the header and the three host rows');
  assert.ok(lines[1].startsWith("'=cmd|evil@example.com,Host page,,en-gb,Direct,"), 'a formula arrives as text');
  assert.ok(lines.some((l) => l.startsWith('d@example.com,Host page,class,en-gb,october,')));
  assert.ok(lines.some((l) => l.startsWith('e@example.com,Landing · Half term,homeschool,en-gb,Direct,')));
  assert.match(lines[1].split(',').pop(), /^\d{4}-\d{2}-\d{2}T/);

  // Written to the audit trail with the filter and the count, and no address.
  const { rows } = await query(`select actor_label, after from admin_audit where action = 'waitlist.export' order by id desc limit 1`);
  assert.equal((await query(`select count(*)::int as n from admin_audit where action = 'waitlist.export'`)).rows[0].n, before + 1);
  assert.equal(rows[0].after.rows, 3);
  assert.equal(rows[0].after.filters.source, 'host');
  assert.equal(rows[0].after.filters.search, '(applied)', 'the search text is not kept');
  assert.doesNotMatch(JSON.stringify(rows[0].after), /@example\.com/);
});

test('csvCell quotes what needs quoting and defuses every formula lead', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  for (const lead of ['=', '+', '-', '@', '\t']) assert.equal(csvCell(`${lead}SUM(A1)`)[0], "'", `${JSON.stringify(lead)} is defused`);
  assert.equal(csvCell('=1,2'), `"'=1,2"`, 'defused and quoted');
  assert.equal(csvCell(null), '');
});

test('a reader can list but cannot export or delete', async () => {
  assert.equal((await call('GET', '/api/admin/waitlist', READER)).status, 200);
  const csv = await call('GET', '/api/admin/waitlist.csv', READER);
  assert.equal(csv.status, 403);
  assert.equal(csv.body.capability, 'manage_waitlist');
  const del = await call('DELETE', `/api/admin/waitlist/${ids.c}`, READER);
  assert.equal(del.status, 403);
  assert.equal((await query('select count(*)::int as n from interest_signups where id = $1', [ids.c])).rows[0].n, 1, 'still there');
  // And without view_waitlist, not even the list.
  assert.equal((await call('GET', '/api/admin/waitlist', NOBODY)).status, 403);
});

test('delete is a hard delete, and its audit entry has no email', async () => {
  const r = await call('DELETE', `/api/admin/waitlist/${ids.c}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, id: ids.c });
  assert.equal((await query('select count(*)::int as n from interest_signups where id = $1', [ids.c])).rows[0].n, 0);
  const { rows } = await query(`select * from admin_audit where action = 'waitlist.delete' and subject_id = $1`, [ids.c]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subject_type, 'interest_signup');
  assert.equal(rows[0].subject_label, null);
  assert.equal(rows[0].before.source, 'home');
  assert.doesNotMatch(JSON.stringify(rows[0]), /c@example\.com/, 'the address is gone from the audit trail too');

  // Gone means gone: a second delete, a made-up id and a non-id are all 404.
  assert.equal((await call('DELETE', `/api/admin/waitlist/${ids.c}`)).status, 404);
  assert.equal((await call('DELETE', '/api/admin/waitlist/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await call('DELETE', '/api/admin/waitlist/not-an-id')).status, 404);
});

test('with nobody on the list, a share cannot speak', async () => {
  await query('delete from interest_signups');
  const { body } = await call('GET', '/api/admin/waitlist');
  assert.deepEqual(body.totals, { all: 0, home: 0, host: 0, last7: 0 });
  assert.ok(body.byKind.every((k) => k.signups === 0 && k.share === null));
  assert.deepEqual(body.byCampaign, []);
});
