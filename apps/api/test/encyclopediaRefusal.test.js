/**
 * An article about the town is not an article about the place —
 * src/sources/encyclopedia.js `refused`, and src/sources/site.js `paragraphsOf`.
 *
 * The matcher paired the town of Woking with an escape room, the hill with
 * Horsenden Hill Activity Centre and Kentish Town with its sports centre, and
 * attached each article's facts to the place (owner, 26 Sep 2026). Wikidata
 * says what an article is about; a settlement or an area is refused for any
 * place, and a landform unless the place is the kind of thing a landform is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { refused, beyondTheLead, encyclopediaFor } from '../src/sources/encyclopedia.js';
import { paragraphsOf } from '../src/sources/site.js';

test('a town, a borough or a parish is refused for any place', () => {
  assert.equal(refused(['Q3957'], 'sports centre'), 'a settlement or an area');
  assert.equal(refused(['Q211690'], 'restaurant'), 'a settlement or an area');
  assert.equal(refused(['Q486972'], 'park'), 'a settlement or an area', 'even for a park');
});

test('a hill is refused for a sports centre and allowed for a hill', () => {
  assert.equal(refused(['Q54050'], 'sports centre'), 'a landform');
  assert.equal(refused(['Q54050'], 'hill'), null);
  assert.equal(refused(['Q8502'], 'nature reserve'), null);
  // A record called "attraction" that the index files under hills is a hill (Codex, 26 Sep 2026).
  assert.equal(refused(['Q54050'], 'attraction hills'), null);
  assert.equal(refused(['Q54050'], 'attraction athletics'), 'a landform');
});

test('a museum, a theme park or a church is never refused', () => {
  assert.equal(refused(['Q33506'], 'museum'), null);
  assert.equal(refused(['Q2416723'], 'theme park'), null);
  assert.equal(refused([], 'restaurant'), null);
});

test('a page\u2019s paragraphs are kept as its body, and its furniture is not', () => {
  const html = `<html><head><title>x</title><script>var a=1;</script></head><body>
    <nav><p>Home. About us. Book now. Contact.</p></nav>
    <p>Welcome to Nowhere Park, forty acres of woodland beside the river with a wave machine in the lido and a high ropes course.</p>
    <p>Book</p>
    <p>Our cafe by the lake serves lunch every day, and the play barn is open whatever the weather.</p>
    <footer><p>Copyright 2026 Nowhere Park Ltd. All rights reserved and cookies.</p></footer>
  </body></html>`;
  const body = paragraphsOf(html);
  assert.match(body, /wave machine/);
  assert.match(body, /play barn/);
  assert.doesNotMatch(body, /Book now|Copyright|var a/);
  assert.equal(paragraphsOf(''), null);
});

test('the body starts at the first heading, so the lead is never held twice (Codex, 26 Sep 2026)', () => {
  const extract = 'Birdworld is a bird park near Farnham.\n\n\n== History ==\nIt opened in 1968 with a penguin beach.\n\n\n== See also ==\nList of zoos';
  assert.equal(beyondTheLead(extract), '== History ==\nIt opened in 1968 with a penguin beach.');
  assert.equal(beyondTheLead('Only a lead, nothing beyond it.'), null);
  assert.equal(beyondTheLead(null), null);
});

test('a Wikidata outage is thrown, not read as no match, so a replacing run keeps what it holds (Codex, 26 Sep 2026)', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('wikidata.org')) return { ok: false, status: 503, json: async () => ({}) };
    if (u.includes('list=geosearch')) return json({ query: { geosearch: [{ title: 'Birdworld', pageid: 1, dist: 40 }] } });
    return json({ query: { pages: { 1: { title: 'Birdworld', extract: 'Birdworld is a bird park.', pageprops: { wikibase_item: 'Q4916681' } } } } });
  };
  const asked = {};
  await assert.rejects(encyclopediaFor({ name: 'Birdworld', lat: 51.17, lng: -0.84, category: 'zoo', asked }), /503/);
  assert.equal(asked.wikidata, true, 'and the call that failed is still on the ledger');
});

test('a failed body request is thrown too, so a replacing run keeps the body it holds (Codex, 26 Sep 2026)', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('wikidata.org')) return json({ entities: { Q4916681: { claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q43501' } } } }] } } } });
    if (u.includes('list=geosearch')) return json({ query: { geosearch: [{ title: 'Birdworld', pageid: 1, dist: 40 }] } });
    if (u.includes('prop=extracts&')) return { ok: false, status: 504, json: async () => ({}) };
    return json({ query: { pages: { 1: { title: 'Birdworld', extract: 'Birdworld is a bird park.', pageprops: { wikibase_item: 'Q4916681' } } } } });
  };
  await assert.rejects(encyclopediaFor({ name: 'Birdworld', lat: 51.17, lng: -0.84, category: 'zoo' }), /504/);
});

test('a nature reserve is not a district: its own article is kept for a nature drawer and refused for a restaurant (26 Sep 2026)', () => {
  // Q179049 is Wikidata's "nature reserve"; the first list called it a UK
  // district, and the audit refused Rowhill Nature Reserve its own article.
  assert.equal(refused(['Q179049'], 'trails'), null);
  assert.equal(refused(['Q179049'], 'attraction parks'), null);
  assert.equal(refused(['Q179049'], 'restaurants'), 'a landform');
  // The real UK district and borough classes are areas.
  for (const q of ['Q349084', 'Q1187580', 'Q1002812', 'Q1136601', 'Q180673']) assert.equal(refused([q], 'museums'), 'a settlement or an area', q);
});

test('a venue page that redirects to a host whose robots.txt refuses us is never read (C11, 26 Sep 2026)', async (t) => {
  const { siteFacts } = await import('../src/sources/site.js');
  const polite = await import('../src/sources/politeness.js');
  polite.forget();
  const real = globalThis.fetch;
  const asked = [];
  t.after(() => { globalThis.fetch = real; polite.forget(); });
  globalThis.fetch = async function stub(url, opts = {}) {
    const u = String(url);
    asked.push(u);
    // A real fetch follows a redirect by itself unless told not to.
    if (u === 'https://venue-a.example/' && (opts.redirect ?? 'follow') === 'follow') return stub('https://elsewhere.example/venue', opts);
    const page = (status, body = '', headers = {}) => ({
      ok: status >= 200 && status < 300, status, url: u,
      headers: { get: (k) => ({ 'content-type': 'text/html', ...headers })[k.toLowerCase()] ?? null },
      text: async () => body, json: async () => ({}),
    });
    if (u === 'https://venue-a.example/robots.txt') return page(200, 'User-agent: *\nAllow: /');
    if (u === 'https://elsewhere.example/robots.txt') return page(200, 'User-agent: *\nDisallow: /');
    if (u === 'https://venue-a.example/') return page(301, '', { location: 'https://elsewhere.example/venue' });
    return page(404);
  };
  const got = await siteFacts({ website: 'https://venue-a.example/', name: 'Venue A' });
  assert.ok(!asked.includes('https://elsewhere.example/venue'), 'the refused host’s page is never fetched');
  assert.equal(got?.body ?? null, null);
});
