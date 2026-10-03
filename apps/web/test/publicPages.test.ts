/**
 * Epic Events on the web (brief, 3 Oct 2026), served: public event and host
 * pages with their own head and schema.org, the 301s (old slug, short link),
 * 404 and 410, photos from epic.day itself, and the per-locale sitemaps.
 * The real web server, against a stand-in for the API's public door.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventHead, hostHead, leftTheWeb, publicAddress, withHead } from '../events.mjs';
import { parseRoute, hrefOf } from '../src/routes.ts';

const PHOTO = '0b6a3e2c-1111-4222-8333-944455556666';
const EVENT = {
  code: 'k7f2ab', path: '/en-gb/event/fossil-hunting-with-a-geologist-k7f2ab', status: 'live', on: null, mood: 'outdoors', subcategory: 'Fossil hunting',
  offerId: 'x', title: 'Fossil hunting with a geologist', summary: 'Ammonites on the shore', description: 'Two hours on the beach.', lane: 'oneoff', kind: 'One-off', category: 'Outdoors',
  photos: [`/api/public/media/${PHOTO}`], where: { area: 'Charmouth', online: false },
  when: { sessions: [{ date: '2026-10-10', endsOn: null, time: '10:00', endsAt: '12:00' }], first: '2026-10-10', last: '2026-10-10', startsAt: '10:00', endsAt: '12:00', timeZone: 'Europe/London' },
  price: { mode: 'same_each', pence: 1500, childPence: null, nowEach: null }, who: { ageMin: 6, ageMax: null, dropOff: false, checked: true }, refundWords: null,
  host: { code: '3mq9cd', path: '/en-gb/hosts/hannah-r-3mq9cd', name: 'Hannah R.', photo: null, checked: true, since: '2026-09-01' },
  reviews: { total: 0, rating: null, items: [] }, moreFromHost: [], similar: [],
};

async function stubApi(fn: (base: string) => Promise<void>) {
  const api = http.createServer((req, res) => {
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const u = req.url ?? '';
    if (u === '/api/public/events/k7f2ab') return json(200, EVENT);
    if (u === '/api/public/events/old123') return json(200, { ...EVENT, code: 'old123', path: '/en-gb/event/a-past-walk-old123', title: 'A past walk', status: 'expired', ended: 'finished', mood: 'outdoors', subcategory: 'Walking' });
    if (u === '/api/public/hosts/3mq9cd') return json(200, { code: '3mq9cd', path: '/en-gb/hosts/hannah-r-3mq9cd', status: 'live', indexable: true, name: 'Hannah R.', subcategory: 'Fossil hunting', town: 'Charmouth', intro: null, events: [], finished: [], reviews: { total: 0, rating: null, items: [] } });
    if (u === '/api/public/hosts/gone99') return json(200, { code: 'gone99', path: '/en-gb/hosts/sam-t-gone99', status: 'gone' });
    if (u === '/api/public/sitemap') return json(200, { events: [{ path: EVENT.path, lastmod: '2026-10-03' }], hosts: [{ path: EVENT.host.path, lastmod: '2026-10-03' }] });
    if (u === `/api/public/media/${PHOTO}`) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from([1, 2, 3])); return; }
    json(404, { error: 'not_found' });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()));
  try { await fn(`http://127.0.0.1:${(api.address() as { port: number }).port}`); } finally { api.close(); }
}

async function serve(env: Record<string, string>, fn: (base: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'epic-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html lang="en"><head><title>Epic</title><meta name="description" content="x" /><link rel="canonical" href="https://epic.day/" /><meta property="og:url" content="https://epic.day/" /><meta property="og:title" content="Epic" /><meta property="og:description" content="x" /><meta property="og:image" content="https://epic.day/favicon-512.png" /><meta property="og:type" content="website" /></head><body></body></html>');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const childEnv = { ...process.env, PORT: String(port), EPIC_WEB_ROOT: root } as NodeJS.ProcessEnv;
  delete childEnv.SITE_GATE; delete childEnv.EPIC_EVENT_CATEGORY_PAGES;
  Object.assign(childEnv, env);
  const server = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], { env: childEnv, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i += 1) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    await fn(base);
  } finally { server.kill(); rmSync(root, { recursive: true, force: true }); }
}
const page = (base: string, path: string) => fetch(`${base}${path}`, { redirect: 'manual', headers: { accept: 'text/html' } });

test('a live event page: indexed, its own title and canonical, schema.org Event and BreadcrumbList, its photo from epic.day', async () => {
  await stubApi(async (api) => serve({ SITE_GATE: 'on', EPIC_API_URL: api }, async (base) => {
    const r = await page(base, EVENT.path);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-robots-tag'), null, 'indexed straight away, launch gate or not');
    const html = await r.text();
    assert.match(html, /<title>Fossil hunting with a geologist · Charmouth · Epic Events<\/title>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/epic.day\/en-gb\/event\/fossil-hunting-with-a-geologist-k7f2ab" \/>/);
    assert.match(html, new RegExp(`<meta property="og:image" content="https://epic.day/photos/${PHOTO}" />`));
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.equal(ld[0]['@type'], 'Event');
    assert.equal(ld[0].location.address.addressLocality, 'Charmouth', 'the town, never the address');
    assert.equal(ld[0].organizer.name, 'Hannah R.');
    assert.equal(ld[1]['@type'], 'BreadcrumbList');

    const img = await fetch(`${base}/photos/${PHOTO}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
  }));
});

test('one address each: an old slug and the short link 301; unknown is 404; gone is 410 until category pages exist', async () => {
  await stubApi(async (api) => serve({ EPIC_API_URL: api }, async (base) => {
    const old = await page(base, '/en-gb/event/fossil-hunting-k7f2ab');
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), EVENT.path);
    const short = await page(base, '/e/k7f2ab');
    assert.equal(short.status, 301);
    assert.equal(short.headers.get('location'), EVENT.path);
    const missing = await page(base, '/en-gb/event/nothing-zzzz99');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-robots-tag'), 'noindex');
    // Past its time with the category pages off: still up, saying so, out of the index — never a 410.
    const past = await page(base, '/en-gb/event/a-past-walk-old123');
    assert.equal(past.status, 200);
    assert.equal(past.headers.get('x-robots-tag'), 'noindex');
    assert.match(await past.text(), /<meta name="robots" content="noindex" \/>/);
    assert.equal((await page(base, '/en-gb/hosts/sam-t-gone99')).status, 410, 'a host paused or removed is 410');
    const host = await page(base, '/en-gb/hosts/hannah-r-3mq9cd');
    assert.equal(host.status, 200);
    assert.match(await host.text(), /<title>Hannah R. · Fossil hunting in Charmouth · Epic Hosts<\/title>/);
  }));
  // With the category pages on, an event that has left the web goes to its subcategory page.
  await stubApi(async (api) => serve({ EPIC_API_URL: api, EPIC_EVENT_CATEGORY_PAGES: 'on' }, async (base) => {
    const r = await page(base, '/en-gb/event/a-past-walk-old123');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/en-gb/events/walking');
  }));
});

test('a sitemap of events and one of hosts, per locale', async () => {
  await stubApi(async (api) => serve({ EPIC_API_URL: api }, async (base) => {
    const ev = await fetch(`${base}/en-gb/sitemap-events.xml`);
    assert.equal(ev.status, 200);
    assert.match(await ev.text(), /<loc>https:\/\/epic.day\/en-gb\/event\/fossil-hunting-with-a-geologist-k7f2ab<\/loc>\s*<lastmod>2026-10-03<\/lastmod>/);
    assert.match(await (await fetch(`${base}/en-gb/sitemap-hosts.xml`)).text(), /hosts\/hannah-r-3mq9cd/);
  }));
});

test('the addresses, the heads and the app’s routes agree', () => {
  assert.deepEqual(publicAddress('/en-gb/event/fossil-hunting-k7f2ab'), { kind: 'event', locale: 'en-gb', code: 'k7f2ab', asked: '/en-gb/event/fossil-hunting-k7f2ab' });
  assert.equal(publicAddress('/en-gb/event/no-code'), null);
  assert.equal(publicAddress('/en-gb/host'), null, '/en-gb/host stays the become-a-host page');
  assert.deepEqual(leftTheWeb({ subcategory: null, mood: 'outdoors' }, 'en-gb', true), { status: 301, location: '/en-gb/events/outdoors' });
  assert.deepEqual(leftTheWeb({ subcategory: 'Walking', mood: 'outdoors' }, 'en-gb', false), { status: 200, robots: 'noindex' });
  const head = eventHead({ ...EVENT, lane: 'onrequest' } as never, { appUrl: 'https://epic.day' });
  assert.equal(head.jsonld[0]['@type'], 'Service', 'On request is a Service');
  const sneaky = withHead('<html lang="en"><head><title>x</title></head></html>', { ...eventHead({ ...EVENT, title: '</script><script>alert(1)</script>' } as never, { appUrl: 'https://epic.day' }) });
  assert.ok(!/<\/script><script>alert/.test(sneaky.split('application/ld+json')[1] ?? ''), 'a title can never close the script');
  assert.equal(hostHead({ path: '/en-gb/hosts/x-abcd12', name: 'Sam T.', indexable: false } as never, { appUrl: 'https://epic.day' }).robots, 'noindex');
  for (const path of ['/en-gb/event/fossil-hunting-k7f2ab', '/en-gb/hosts/hannah-r-3mq9cd', '/e/k7f2ab']) assert.equal(hrefOf(parseRoute(path)), path);
  assert.equal(parseRoute('/en-gb/event/no-code').name, 'unknown');
});
