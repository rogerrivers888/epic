import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { articleTitle, distinguish } from '../src/domain/naming.js';

/**
 * Two places called the same thing.
 *
 * Not every repeated name is a duplicate. A place filed under two counties is
 * collapsed in the query; two churches seven kilometres apart both called the
 * Church of St Michael and All Angels are two churches, and collapsing them
 * would delete a real one. On a screen they still read as one place shown
 * twice, which is the bug the owner reported, so they are told apart instead.
 */

test('a name is left alone unless something else shares it', () => {
  const items = [
    { name: 'Windsor Castle', wikipediaUrl: 'https://en.wikipedia.org/wiki/Windsor_Castle' },
    { name: 'Thorpe Park', wikipediaUrl: 'https://en.wikipedia.org/wiki/Thorpe_Park' },
  ];
  distinguish(items);
  assert.deepEqual(items.map((i) => i.name), ['Windsor Castle', 'Thorpe Park']);
});

test('a collision is settled by the Wikipedia title, which is already disambiguated', () => {
  const items = [
    { name: 'Church of St Michael and All Angels', outcode: 'SL5', wikipediaUrl: 'https://en.wikipedia.org/wiki/St_Michael_and_All_Angels_Church,_Sunninghill' },
    { name: 'Church of St Michael and All Angels', outcode: 'RG42', wikipediaUrl: 'https://en.wikipedia.org/wiki/Warfield_Church' },
  ];
  distinguish(items);
  assert.deepEqual(items.map((i) => i.name), ['St Michael and All Angels Church, Sunninghill', 'Warfield Church']);
});

test('with no article to fall back on, the postcode district beats two identical rows', () => {
  const items = [
    { name: 'St Mary the Virgin', outcode: 'OX1', wikipediaUrl: null },
    { name: 'St Mary the Virgin', outcode: 'GU9', wikipediaUrl: null },
  ];
  distinguish(items);
  assert.deepEqual(items.map((i) => i.name), ['St Mary the Virgin (OX1)', 'St Mary the Virgin (GU9)']);
});

test('an article whose title is the name it already has changes nothing', () => {
  const items = [
    { name: 'Bourne Wood', outcode: 'GU10', wikipediaUrl: 'https://en.wikipedia.org/wiki/Bourne_Wood' },
    { name: 'Bourne Wood', outcode: 'S60', wikipediaUrl: 'https://en.wikipedia.org/wiki/Bourne_Wood' },
  ];
  distinguish(items);
  // Same article, so the title cannot separate them; the district can.
  assert.deepEqual(items.map((i) => i.name), ['Bourne Wood (GU10)', 'Bourne Wood (S60)']);
});

test('titles are read back into the words a person would say', () => {
  assert.equal(articleTitle('https://en.wikipedia.org/wiki/St_Michael_and_All_Angels_Church,_Sunninghill'),
    'St Michael and All Angels Church, Sunninghill');
  assert.equal(articleTitle(null), null);
  assert.equal(articleTitle('not a url'), null);
});

test('the home screen names its places before it answers', () => {
  const src = readFileSync(new URL('../src/routes/inspire.js', import.meta.url), 'utf8');
  assert.match(src, /distinguish\(items/, 'two identical rows is what the household actually sees');
});
