/**
 * "Register your interest" (routes/interest.js) — the public form on epic.day.
 *
 * Its failures are quiet ones: a repeat that sends a second email or says "you
 * are already on the list" (which tells a stranger who is), a honeypot that
 * stores the bot anyway, a homepage row carrying a host kind, an address stored
 * in whatever case it was typed so the same person sits on a list twice. So the
 * tests pin those, through the real router on a throwaway app, with the mail
 * sender replaced by a recorder.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();

const { interestRouter, readSignup, countryOf } = await import('../src/routes/interest.js');
const { isPublicPath } = await import('../src/auth.js');

const sent = [];
let configured = true;
const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', interestRouter({
  send: async (m) => { sent.push(m); return { sent: true }; },
  configured: () => configured,
}));
app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'error', message: err.message }));
const server = app.listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); return pool.end(); });

// Every caller gets its own address so the per-IP limiter only bites where a
// test means it to.
let ip = 0;
const post = async (body, headers = {}) => {
  ip += 1;
  const res = await fetch(`${base}/api/interest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${ip}`, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const HOME = { source: 'home', locale: 'en-gb', consentWording: "Remind me — You're on the list. We'll email you when the app's out." };
const HOST_WORDS = "Become a host — You're on the hosts list. We'll be in touch before launch.";
const rowsFor = async (email) => (await query('select * from interest_signups where lower(email) = lower($1) order by source', [email])).rows;

test('the form is a public path', () => {
  assert.equal(isPublicPath({ method: 'POST', path: '/api/interest' }), true);
  assert.equal(isPublicPath({ method: 'GET', path: '/api/interest' }), false);
});

test('a sign-up is stored lowercased, with its attribution and consent, and confirmed once', async () => {
  sent.length = 0;
  const r = await post({
    ...HOME, email: '  Ada.Lovelace@Example.COM ', landingPage: 'Half term', referrer: 'https://news.example/',
    utmSource: 'newsletter', utmMedium: 'email', utmCampaign: 'october', utmTerm: 't', utmContent: 'c',
    gclid: 'g1', fbclid: 'f1',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  const [row] = await rowsFor('ada.lovelace@example.com');
  assert.equal(row.email, 'ada.lovelace@example.com');
  assert.equal(row.source, 'home');
  assert.equal(row.locale, 'en-gb');
  assert.equal(row.consent_wording, HOME.consentWording);
  assert.equal(row.landing_page, 'Half term');
  assert.equal(row.referrer, 'https://news.example/');
  assert.equal(row.utm_campaign, 'october');
  assert.equal(row.gclid, 'g1');
  assert.equal(row.fbclid, 'f1');
  assert.equal(row.host_kind, null);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ada.lovelace@example.com');
  assert.equal(sent[0].purpose, 'interest');
  assert.match(sent[0].text, /You're on the list\. We'll email you when the app's out\./);
});

test('a repeat is the same 200, one row, and no second email — whatever the case', async () => {
  sent.length = 0;
  assert.equal((await post({ ...HOME, email: 'repeat@example.com' })).status, 200);
  const again = await post({ ...HOME, email: 'REPEAT@Example.com' });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { ok: true }, 'a repeat looks exactly like a first sign-up');
  assert.equal((await rowsFor('repeat@example.com')).length, 1);
  assert.equal(sent.length, 1, 'one confirmation, not two');
});

test('the homepage and the hosts page are two lists', async () => {
  sent.length = 0;
  await post({ ...HOME, email: 'both@example.com' });
  await post({ source: 'host', hostKind: 'class', locale: 'en-gb', consentWording: HOST_WORDS, email: 'both@example.com' });
  const rows = await rowsFor('both@example.com');
  assert.deepEqual(rows.map((r) => r.source), ['home', 'host']);
  assert.equal(rows[1].host_kind, 'class');
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /You're on the hosts list\. We'll be in touch before launch\./);
});

test('the honeypot gets a success and nothing is stored or sent', async () => {
  sent.length = 0;
  const r = await post({ ...HOME, email: 'bot@example.com', website: 'http://spam.example' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal((await rowsFor('bot@example.com')).length, 0);
  assert.equal(sent.length, 0);
});

test('a bad email is refused in the words the page shows', async () => {
  for (const email of ['', 'nope', 'a@b', 'two words@example.com', `${'x'.repeat(250)}@example.com`, 42]) {
    const r = await post({ ...HOME, email });
    assert.equal(r.status, 400, `${email} is refused`);
    assert.deepEqual(r.body, { error: 'bad_email', message: "That email doesn't look right." });
  }
});

test('an unknown source, locale or missing consent is refused and stores nothing', async () => {
  const s = await post({ ...HOME, email: 'src@example.com', source: 'footer' });
  assert.equal(s.status, 400);
  assert.equal(s.body.error, 'bad_source');
  const l = await post({ ...HOME, email: 'src@example.com', locale: 'fr-fr' });
  assert.equal(l.status, 400);
  assert.equal(l.body.error, 'bad_locale');
  const c = await post({ ...HOME, email: 'src@example.com', consentWording: '   ' });
  assert.equal(c.status, 400);
  assert.equal(c.body.error, 'bad_consent');
  assert.equal((await rowsFor('src@example.com')).length, 0);
  // The site's own casing of a locale is accepted.
  assert.equal((await post({ ...HOME, email: 'case@example.com', locale: 'en-US' })).status, 200);
  assert.equal((await rowsFor('case@example.com'))[0].locale, 'en-us');
});

test('a host kind is kept only for the hosts page, and only the four', async () => {
  await post({ ...HOME, email: 'homekind@example.com', hostKind: 'class' });
  assert.equal((await rowsFor('homekind@example.com'))[0].host_kind, null, 'the homepage has no picker');
  await post({ source: 'host', hostKind: 'juggling', locale: 'en-gb', consentWording: HOST_WORDS, email: 'oddkind@example.com' });
  assert.equal((await rowsFor('oddkind@example.com'))[0].host_kind, null, 'an unknown kind is not given');
});

test('the country comes from Cloudflare, two letters or nothing', async () => {
  await post({ ...HOME, email: 'gb@example.com' }, { 'cf-ipcountry': 'gb' });
  assert.equal((await rowsFor('gb@example.com'))[0].country, 'GB');
  await post({ ...HOME, email: 'xx@example.com' }, { 'cf-ipcountry': 'XX' });
  assert.equal((await rowsFor('xx@example.com'))[0].country, null, 'XX is "unknown"');
  await post({ ...HOME, email: 'none@example.com' });
  assert.equal((await rowsFor('none@example.com'))[0].country, null);
  assert.equal(countryOf({ headers: { 'cf-ipcountry': 'T1' } }), null, 'Tor is not a country');
});

test('free text is trimmed and capped', () => {
  const { signup } = readSignup({
    ...HOME, email: 'cap@example.com', landingPage: `  ${'p'.repeat(400)}  `, referrer: 'r'.repeat(1500), utmCampaign: '   ',
  }, { headers: {} });
  assert.equal(signup.landingPage.length, 300);
  assert.equal(signup.referrer.length, 1000);
  assert.equal(signup.utmCampaign, null, 'blank is not a campaign');
});

test('with mail not configured, the sign-up still lands and nothing is sent', async () => {
  sent.length = 0;
  configured = false;
  try {
    assert.equal((await post({ ...HOME, email: 'nomail@example.com' })).status, 200);
    assert.equal((await rowsFor('nomail@example.com')).length, 1);
    assert.equal(sent.length, 0);
  } finally { configured = true; }
});

test('a failed send does not fail the sign-up', async () => {
  const failing = express();
  failing.set('trust proxy', 1);
  failing.use(express.json());
  failing.use('/api', interestRouter({ send: async () => { throw new Error('postmark down'); }, configured: () => true }));
  const s = failing.listen(0);
  await new Promise((r) => s.on('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/interest`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
      body: JSON.stringify({ ...HOME, email: 'sendfail@example.com' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await rowsFor('sendfail@example.com')).length, 1);
  } finally { s.close(); }
});

test('one caller is held to ten sign-ups in ten minutes, whatever headers it forges', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i += 1) {
    // A fresh CF-Connecting-IP and a fresh left-hand X-Forwarded-For every time —
    // both typed by the caller — over the one address the edge appended.
    const headers = { 'content-type': 'application/json', 'cf-connecting-ip': `10.9.8.${i}`, 'x-forwarded-for': `10.7.6.${i}, 192.0.2.99` };
    const res = await fetch(`${base}/api/interest`, { method: 'POST', headers, body: JSON.stringify({ ...HOME, email: `flood${i}@example.com` }) });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
  assert.equal(statuses[10], 429);
  assert.equal((await query(`select count(*)::int as n from interest_signups where email like 'flood%'`)).rows[0].n, 10);
});

test('past the hourly cap a sign-up is kept and answered, and only the e-mail is held', async () => {
  const capped = express();
  capped.set('trust proxy', 1);
  const mails = [];
  capped.use(express.json());
  capped.use('/api', interestRouter({ send: async (m) => { mails.push(m); }, configured: () => true, mailAllowed: () => false }));
  const s = capped.listen(0);
  await new Promise((r) => s.on('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/interest`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.8' },
      body: JSON.stringify({ ...HOME, email: 'capped@example.com' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await rowsFor('capped@example.com')).length, 1);
    assert.equal(mails.length, 0);
  } finally { s.close(); }
});

test('a consent wording no form on the site shows is refused, and nothing is kept', async () => {
  const r = await post({ ...HOME, email: 'madeup@example.com', consentWording: 'I agree to everything' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'bad_consent');
  // A homepage wording on the host form is not the host form's wording either.
  const h = await post({ source: 'host', locale: 'en-gb', consentWording: HOME.consentWording, email: 'crossed@example.com' });
  assert.equal(h.status, 400);
  assert.equal((await rowsFor('madeup@example.com')).length + (await rowsFor('crossed@example.com')).length, 0);
});

test('with one proxy too many trusted, rotating forged addresses still meets the edge limit', async () => {
  // trust proxy 2 on a one-proxy route: req.ip is whatever the caller wrote second-from-right.
  const loose = express();
  loose.set('trust proxy', 2);
  loose.use(express.json());
  loose.use('/api', interestRouter({ send: async () => {}, configured: () => false }));
  const s = loose.listen(0);
  await new Promise((r) => s.on('listening', r));
  try {
    const statuses = [];
    for (let i = 0; i < 305; i += 1) {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/api/interest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.${i >> 8}.${i & 255}.1, 192.0.2.250` },
        // The honeypot: answered as a success and kept nowhere, so the limiters are all this measures.
        body: JSON.stringify({ ...HOME, email: `edge${i}@example.com`, website: 'bot' }),
      });
      statuses.push(res.status);
    }
    assert.equal(statuses.slice(0, 300).every((x) => x === 200), true, 'each forged address gets its own tight bucket');
    assert.equal(statuses[300], 429, 'but the edge address they all came through does not');
  } finally { s.close(); }
});

test('the edge address is read from the header only when a proxy of ours connected', async () => {
  const { connectedCallerOf, isPrivateAddress } = await import('../src/limits.js');
  const at = (peer, xff) => connectedCallerOf({ socket: { remoteAddress: peer }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  // Through a private-network proxy: the address it appended.
  assert.equal(at('10.0.3.7', '1.2.3.4, 203.0.113.9'), '203.0.113.9');
  assert.equal(at('::ffff:100.64.0.2', '203.0.113.9'), '203.0.113.9');
  // Straight from the internet: the socket, whatever the header says.
  assert.equal(at('198.51.100.20', '1.2.3.4, 203.0.113.9'), '198.51.100.20');
  assert.equal(at('198.51.100.20'), '198.51.100.20');
  assert.equal(isPrivateAddress('172.20.1.1'), true);
  assert.equal(isPrivateAddress('172.32.1.1'), false);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});
