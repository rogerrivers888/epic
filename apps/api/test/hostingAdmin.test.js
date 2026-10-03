/**
 * The back office's Hosting tab (routes/hostingAdmin.js, BO8a–BO8r): review
 * with "Approved · waiting on Checked", changes with reasons the list keeps,
 * hosts, events, money, safety, and the owner-only doors (override a fee,
 * remove a host, DAC7).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const admin = await import('../src/routes/hostingAdmin.js');
const settings = await import('../src/repositories/hostingSettings.js');
const { runAsAccount } = await import('../src/context.js');
const { plusDays, localDay } = await import('../src/domain/lanes.js');

test.after(async () => { settings.forget(); await pool?.end?.(); });

const STAFF = { doors: ['admin'], capabilities: new Set(['view_hosting', 'manage_hosting']), isOwner: false, role: null, elevated: false };
const OWNER = { ...STAFF, isOwner: true, elevated: true };

async function server(access) {
  const { household, member } = await aHousehold(query);
  const { rows: [account] } = await query("insert into accounts (household_id, member_id, email, role, status, name) values ($1,$2,$3,'customer','active','Staff') returning *", [household.id, member.id, `s-${crypto.randomUUID().slice(0, 8)}@example.com`]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.access = access; runAsAccount(account, next); });
  app.use('/api/admin/hosting', admin.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const out = (r) => (r.headers.get('content-type')?.includes('json') ? r.json() : r.text()).then((body) => ({ status: r.status, body }));
  return { close: () => new Promise((r) => s.close(r)), get: (p) => fetch(base + p).then(out), send: (m, p, b) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then(out) };
}

/** A host whose public event for children waits in review; Checked not done unless asked. */
async function inReview({ checked = false, adults = false } = {}) {
  const { household } = await aHousehold(query);
  const { rows: [h] } = await query(
    `insert into hosts (household_id, name, identity_state, payouts_state, date_of_birth, photo_id, intro_text, checked_state, dbs_number, referees, tax_reference)
     values ($1, 'Kate', 'verified', 'ready', '1985-01-01', null, 'Potter', $2, $3, $4::jsonb, 'QQ123456C') returning *`,
    [household.id, checked ? 'passed' : 'none', checked ? '001' : null, JSON.stringify(checked ? [{ name: 'a', email: 'a@x' }, { name: 'b', email: 'b@x' }] : [])],
  );
  // A complete host and event, so only Checked can stand in the way.
  const { rows: [pic] } = await query(`insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'photo', 'image/jpeg', '\\x00', 1) returning id`, [household.id]);
  const { rows: [vid] } = await query(`insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'video', 'video/webm', '\\x00', 1) returning id`, [household.id]);
  await query('update hosts set photo_id = $2 where id = $1', [h.id, pic.id]);
  if (checked) {
    const { rows: [m] } = await query(`insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'doc', 'application/pdf', '\\x00', 1) returning id`, [household.id]);
    await query('update hosts set insurance_media_id = $2 where id = $1', [h.id, m.id]);
  }
  const { rows: [o] } = await query(
    `insert into host_offers (host_id, shape, lane, state, title, visibility, starts_on, starts_at, age_min, age_max, parents, submitted_at, price_mode, review_ai)
     values ($1, 'oneoff', 'oneoff', 'in_review', 'Clay for kids', 'public', $2, '10:00', $3, $4, $5, now() - interval '40 hours', 'free', '{"state":"done","needsPerson":true,"reasons":["Shows a phone number"]}') returning *`,
    [h.id, plusDays(localDay(new Date()), 20), adults ? 18 : 5, adults ? null : 9, adults ? null : 'drop_off'],
  );
  await query(`update host_offers set video_id = $2, what_label = 'Clay', ends_at = '12:00', venue = 'my_place', venue_area = 'Marlow', max_count = 8, who_chosen = true where id = $1`, [o.id, vid.id]);
  return { h, o, household };
}

test('the review queue: kind, hours left from the setting, the AI verdict on one line', async () => {
  settings.forget();
  const { o } = await inReview();
  const srv = await server(STAFF);
  try {
    const r = await srv.get('/api/admin/hosting/review');
    const row = r.body.rows.find((x) => x.offerId === o.id);
    assert.equal(row.kind, 'oneoff');
    assert.ok(row.hoursLeft > 7 && row.hoursLeft < 9, '48h window, 40h gone');
    assert.deepEqual(row.ai, { verdict: 'review', reasons: ['Shows a phone number'] });
    const one = await srv.get(`/api/admin/hosting/review/${o.id}`);
    assert.equal(one.body.checklist.find((c) => c.key === 'checked').state, 'missing');
    assert.ok(one.body.reasons.includes('Video does not show the host'));
  } finally { await srv.close(); }
});

test('approve with Checked missing: Approved · waiting on Checked, and live once Checked is done', async () => {
  const { o, h } = await inReview();
  const srv = await server(STAFF);
  try {
    const r = await srv.send('POST', `/api/admin/hosting/review/${o.id}/approve`);
    assert.equal(r.body.outcome, 'approved', JSON.stringify(r.body));
    assert.equal((await query('select state from host_offers where id = $1', [o.id])).rows[0].state, 'approved');
    assert.equal(await admin.releaseApproved(), 0, 'still waiting');
    const { rows: [m] } = await query(`insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'doc', 'application/pdf', '\\x00', 1) returning id`, [h.household_id]);
    await query(`update hosts set checked_state = 'passed', dbs_number = '1', insurance_media_id = $2, referees = '[{"name":"a","email":"a@x"},{"name":"b","email":"b@x"}]' where id = $1`, [h.id, m.id]);
    assert.ok(await admin.releaseApproved() >= 1);
    assert.equal((await query('select state from host_offers where id = $1', [o.id])).rows[0].state, 'live');
  } finally { await srv.close(); }
});

test('an adults-only event that passes every check goes straight to live on approval', async () => {
  const { o } = await inReview({ adults: true });
  const srv = await server(STAFF);
  try {
    assert.equal((await srv.send('POST', `/api/admin/hosting/review/${o.id}/approve`)).body.outcome, 'live');
    assert.equal((await srv.get('/api/admin/hosting/review')).body.wentLiveToday >= 1, true);
  } finally { await srv.close(); }
});

test('ask for changes: ticked reasons and a new one the list keeps; the host is told; decline needs a reason', async () => {
  const { o, household } = await inReview();
  const second = await inReview();
  const srv = await server(STAFF);
  try {
    assert.equal((await srv.send('POST', `/api/admin/hosting/review/${o.id}/changes`, {})).status, 400);
    const r = await srv.send('POST', `/api/admin/hosting/review/${o.id}/changes`, { reasons: ['Address too exact'], addReason: 'Music too loud in the video', note: 'Nearly there.' });
    assert.equal(r.status, 200);
    assert.ok((await query(`select 1 from review_change_reasons where label = 'Music too loud in the video'`)).rows.length);
    assert.equal((await query(`select count(*)::int as n from notifications where household_id = $1 and kind = 'review_changes_requested'`, [household.id])).rows[0].n, 1);
    assert.equal((await srv.send('POST', `/api/admin/hosting/review/${second.o.id}/decline`, {})).status, 400);
    assert.equal((await srv.send('POST', `/api/admin/hosting/review/${second.o.id}/decline`, { reason: 'Not something we host' })).status, 200);
  } finally { await srv.close(); }
});

test('the owner-only doors: a fee override and removing a host refuse staff; removal refuses while bookings are outstanding', async () => {
  const { h, o } = await inReview({ adults: true });
  const g = await aHousehold(query);
  const { rows: [b] } = await query(`insert into experience_bookings (offer_id, host_id, household_id, state) values ($1, $2, $3, 'confirmed') returning id`, [o.id, h.id, g.household.id]);
  const { rows: [sx] } = await query(`insert into offer_sessions (offer_id, on_date, starts_at, ends_at) values ($1, current_date + 10, '10:00', '12:00') returning id`, [o.id]);
  await query('insert into booking_sessions (booking_id, session_id) values ($1, $2)', [b.id, sx.id]);
  const staff = await server(STAFF);
  const owner = await server(OWNER);
  try {
    assert.equal((await staff.send('POST', `/api/admin/hosting/hosts/${h.id}/fee-override`, { pct: 12, why: 'x' })).body.error, 'needs_personal_sign_in');
    assert.equal((await owner.send('POST', `/api/admin/hosting/hosts/${h.id}/fee-override`, { pct: 12, why: 'Founding host' })).body.pct, 12);
    const rm = await owner.send('POST', `/api/admin/hosting/hosts/${h.id}/remove`, { why: 'Test' });
    assert.equal(rm.status, 409);
    const ov = await staff.get(`/api/admin/hosting/hosts/${h.id}`);
    assert.equal(ov.body.fee.override, 12);
    assert.equal(ov.body.canRemove, false);
    assert.equal(ov.body.money.tax, '•••• 56C', 'tax details masked');
  } finally { await staff.close(); await owner.close(); }
});

test('hosts, events, money, safety and reports answer, and a judgement with nothing behind it says so', async () => {
  settings.forget();
  const srv = await server(STAFF);
  const owner = await server(OWNER);
  try {
    assert.ok(Array.isArray((await srv.get('/api/admin/hosting/hosts?flag=checked')).body.rows));
    const ev = await srv.get('/api/admin/hosting/events');
    assert.ok(ev.body.draftsByStep.course.length === 9, 'drafts counted by step, never by who');
    const money = await srv.get('/api/admin/hosting/money/streams');
    assert.deepEqual(money.body.streams.map((x) => x.key), ['public', 'host_link', 'intro', 'private_payment', 'private_fee', 'pro', 'tips']);
    assert.equal(money.body.guaranteePool, null, 'still to set: a dash');
    assert.ok(Array.isArray((await srv.get('/api/admin/hosting/money/ledger')).body.rows));
    assert.ok(Array.isArray((await srv.get('/api/admin/hosting/money/payouts')).body.waitingForConfirmation));
    const safety = await srv.get('/api/admin/hosting/safety');
    assert.equal(safety.body.ratings, null);
    assert.match(safety.body.ratingsReason, /not set/);
    const health = await srv.get('/api/admin/hosting/health');
    assert.equal(health.body.payoutsOnTimePct, null);
    assert.ok((await srv.get('/api/admin/hosting/reports/funnel')).body.byKind);
    assert.equal((await srv.send('POST', '/api/admin/hosting/reports/dac7', { year: 2026 })).status, 403);
    const csv = await owner.send('POST', '/api/admin/hosting/reports/dac7', { year: 2026 });
    assert.equal(csv.status, 200);
    assert.match(csv.body, /^Host,Tax reference/);
  } finally { await srv.close(); await owner.close(); }
});
