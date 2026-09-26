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
import { refused } from '../src/sources/encyclopedia.js';
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
