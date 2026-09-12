/**
 * Labels: the combination rule, and the order it sits in.
 *
 * The owner, 12 Sep 2026: "for each category or subcategory, add the
 * combination of labels that determine whether that particular activity lives
 * in that particular subcategory." The things that has to mean, pinned:
 *
 *   - a rule naming two labels fires only when a place carries both;
 *   - among the label rules that fire, the one naming the most wins;
 *   - a label rule sits above the type rules and below the one-place rule;
 *   - with no label rules at all, nothing already filed moves.
 *
 * Everything here is pure: no database, the rules handed in by hand exactly
 * as `repositories/shelfRules.js` shapes them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { canonical, labelHits, labelsOf, labelsOfAtlas, parseLabel, scopeFor, labelsOfRule } = await import('../src/domain/labels.js');
const { NO_RULES, shelvesForAtlas, shelvesForVenue, vocabularyOf } = await import('../src/domain/moods.js');

const VOCAB = vocabularyOf(
  [{ key: 'fun' }, { key: 'food' }, { key: 'culture' }, { key: 'sport' },
   { key: 'activity' }, { key: 'adrenaline' }, { key: 'relaxing' }, { key: 'outdoors' }],
  [{ key: 'castles', category_key: 'culture' },
   { key: 'museums', category_key: 'culture' },
   { key: 'historic-houses', category_key: 'culture' },
   { key: 'cafes', category_key: 'food' },
   { key: 'desserts', category_key: 'food' },
   { key: 'arenas', category_key: 'sport' },
   { key: 'skating', category_key: 'activity' }],
);

const rulesOf = (...rows) => {
  const out = { place: new Map(), labels: new Map(), kind: new Map(), category: new Map(), experience: new Map() };
  for (let r of rows) {
    if (r.scope === 'labels') { const c = canonical(r.labels); r = { ...r, labels: c.labels, subject: c.subject }; }
    out[r.scope].set(r.subject, r);
  }
  return out;
};

test('a label is a namespaced word, and a combination has one spelling', () => {
  assert.deepEqual(parseLabel('google:museum'), { namespace: 'google', key: 'museum' });
  assert.deepEqual(parseLabel('osm:tourism=museum'), { namespace: 'osm', key: 'tourism=museum' });
  assert.equal(parseLabel('museum'), null);
  assert.equal(parseLabel('nobody:museum'), null);
  assert.equal(canonical(['b:2', 'a:1', 'b:2']).subject, 'a:1 + b:2');
  assert.equal(canonical(['a:1', 'b:2']).subject, canonical(['b:2', 'a:1']).subject);
});

test('a venue carries its provider words and Epic\'s derived words alike', () => {
  const labels = labelsOf({
    category: 'takeaway', experiences: ['playground'], styles: ['fast-food'], labels: ['google:fast_food_restaurant'],
    ticketed: false, goodForChildren: true,
  });
  assert.deepEqual(labels.sort(), ['experience:playground', 'flag:good-for-children', 'google:fast_food_restaurant', 'style:fast-food', 'venue:takeaway'].sort());
  assert.deepEqual(labelsOfAtlas({ category: 'heritage', kinds: ['Q23413'] }).sort(), ['atlas:heritage', 'wikidata:Q23413']);
});

test('a two-label rule fires only when both are there, and beats a one-label rule', () => {
  const both = { scope: 'labels', labels: ['wikidata:Q23413', 'wikidata:Q33506'], subcategory: 'historic-houses', weights: {} };
  const castle = { scope: 'labels', labels: ['wikidata:Q23413'], subcategory: 'castles', weights: {} };
  const rules = rulesOf(both, castle);
  assert.deepEqual(labelHits(rules.labels, ['wikidata:Q23413']), [castle.subject ?? 'wikidata:Q23413']);
  assert.deepEqual(labelHits(rules.labels, ['wikidata:Q23413', 'wikidata:Q33506']), ['wikidata:Q23413 + wikidata:Q33506']);
  assert.deepEqual(labelHits(rules.labels, ['wikidata:Q33506']), []);
});

test('a castle that is also a museum is filed by the combination, not by either type', () => {
  const rules = rulesOf(
    { scope: 'kind', subject: 'Q23413', subcategory: 'castles', weights: {} },
    { scope: 'kind', subject: 'Q33506', subcategory: 'museums', weights: {} },
    { scope: 'labels', labels: ['wikidata:Q23413', 'wikidata:Q33506'], subcategory: 'historic-houses', weights: {} },
  );
  const alone = shelvesForAtlas({ ref: 'wikidata:Q1', category: 'heritage', kinds: ['Q23413'] }, rules, VOCAB);
  assert.equal(alone.subcategory, 'castles');
  const both = shelvesForAtlas({ ref: 'wikidata:Q2', category: 'heritage', kinds: ['Q23413', 'Q33506'] }, rules, VOCAB);
  assert.equal(both.subcategory, 'historic-houses');
  assert.equal(both.category, 'culture');
  assert.equal(both.because[0].scope, 'labels');
});

test('the one-place rule still beats a label rule', () => {
  const rules = rulesOf(
    { scope: 'labels', labels: ['wikidata:Q23413'], subcategory: 'castles', weights: {} },
    { scope: 'place', subject: 'wikidata:Q1', subcategory: 'museums', weights: {} },
  );
  const filed = shelvesForAtlas({ ref: 'wikidata:Q1', category: 'heritage', kinds: ['Q23413'] }, rules, VOCAB);
  assert.equal(filed.subcategory, 'museums');
  assert.equal(filed.because[0].scope, 'place');
});

test('a provider\'s own word can move a food place out of the Food short-cut', () => {
  // An ice-cream parlour arrives from Google typed `ice_cream_shop`, which
  // google.js reads as a cafe. Without a rule it is Cafés; a rule against
  // Google's own word files it in Desserts, and every other cafe stays put.
  const parlour = { source: 'google', sourcePlaceId: 'a', category: 'cafe', experiences: [], labels: ['google:ice_cream_shop', 'google:cafe'] };
  const cafe = { source: 'google', sourcePlaceId: 'b', category: 'cafe', experiences: [], labels: ['google:cafe'] };
  assert.equal(shelvesForVenue(parlour, NO_RULES, VOCAB).subcategory, 'cafes');
  const rules = rulesOf({ scope: 'labels', labels: ['google:ice_cream_shop'], subcategory: 'desserts', weights: {} });
  assert.equal(shelvesForVenue(parlour, rules, VOCAB).subcategory, 'desserts');
  assert.equal(shelvesForVenue(parlour, rules, VOCAB).category, 'food');
  assert.equal(shelvesForVenue(cafe, rules, VOCAB).subcategory, 'cafes');
});

test('a label rule sits above an experience rule', () => {
  const rules = rulesOf(
    { scope: 'experience', subject: 'ice-skating', subcategory: 'skating', weights: {} },
    { scope: 'labels', labels: ['osm:leisure=ice_rink', 'flag:ticketed'], subcategory: 'arenas', weights: {} },
  );
  const rink = { source: 'osm', sourcePlaceId: 'node/1', category: 'attraction', experiences: ['ice-skating'], labels: ['osm:leisure=ice_rink'] };
  assert.equal(shelvesForVenue(rink, rules, VOCAB).subcategory, 'skating');
  const arena = { ...rink, ticketed: true };
  assert.equal(shelvesForVenue(arena, rules, VOCAB).subcategory, 'arenas');
  assert.equal(shelvesForVenue(arena, rules, VOCAB).category, 'sport');
});

test('with no label rules nothing moves: the old chain answers exactly as before', () => {
  const rules = rulesOf({ scope: 'kind', subject: 'Q1154710', subject_label: 'association football venue', weights: { sport: 1, fun: 0.4 } });
  const { shelves, because } = shelvesForAtlas({ ref: 'wikidata:Q642313', category: 'active', kinds: ['Q1049757', 'Q1154710'] }, rules, VOCAB);
  assert.deepEqual(shelves, ['sport']);
  assert.equal(because[0].scope, 'kind');
});

test('one label about a type, an atlas word or an experience is the old scope; anything else is a labels rule', () => {
  assert.deepEqual(scopeFor(['wikidata:Q23413']), { scope: 'kind', subject: 'Q23413', labels: ['wikidata:Q23413'] });
  assert.deepEqual(scopeFor(['atlas:heritage']), { scope: 'category', subject: 'heritage', labels: ['atlas:heritage'] });
  assert.deepEqual(scopeFor(['experience:museum']), { scope: 'experience', subject: 'museum', labels: ['experience:museum'] });
  assert.equal(scopeFor(['google:stadium']).scope, 'labels');
  assert.equal(scopeFor(['wikidata:Q23413', 'wikidata:Q33506']).scope, 'labels');
  // And the way back, so every rule can be drawn as labels.
  assert.deepEqual(labelsOfRule({ scope: 'kind', subject: 'Q1' }), ['wikidata:Q1']);
  assert.deepEqual(labelsOfRule({ scope: 'labels', labels: ['a:1', 'b:2'] }), ['a:1', 'b:2']);
});
