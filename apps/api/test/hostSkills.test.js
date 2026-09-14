/**
 * Host skills: the rules that decide whether the vocabulary stays usable.
 *
 * Brief: "Epic Host Skills — Claude Code", 13 September 2026. Four things are
 * pinned here because getting any of them wrong is invisible until the
 * vocabulary is already full of duplicates:
 *
 *   - normalisation collapses the four spellings of one thing *before* an
 *     administrator ever sees them, and does not collapse two words that are
 *     genuinely different;
 *   - the browse category is derived from the tags rather than chosen;
 *   - a count is shown only where it flatters;
 *   - a credential that needs evidence does not display until somebody has
 *     seen it, and one that does not is labelled as stated rather than
 *     confirmed.
 *
 * Everything here is pure: no database, no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  AGE_BANDS, FACET_CAP, PROMPTS, TAG_CAP, breadcrumb, categoryForPassion, categoryFrom,
  credentialDisplay, expiryFor, flatters, gatingTypes, keyFor, normalise, promptFor, skillBlockers,
} = await import('../src/domain/hostSkills.js');

test('the four spellings of one thing collapse to one proposal', () => {
  // "This is the whole ballgame" (§3): identical wording from another host has
  // to increment an existing row, and it can only do that if these agree.
  const one = ['fossils', 'Fossils', 'FOSSILS', ' fossils '].map(normalise);
  assert.deepEqual(new Set(one), new Set(['fossil']));
  const two = ['fossil hunting', 'Fossil Hunting', 'fossil-hunting', 'Fossil  hunting'].map(normalise);
  assert.deepEqual(new Set(two), new Set(['fossil hunting']));
});

test('normalisation folds a plural without folding two different words together', () => {
  assert.equal(normalise('churches'), 'church');
  assert.equal(normalise('potteries'), 'pottery');
  assert.equal(normalise('ammonites'), 'ammonite');
  // The ones an eager stemmer ruins. A false merge is far more expensive here
  // than a duplicate proposal, so the fold is deliberately shallow.
  assert.equal(normalise('glass'), 'glass');
  assert.equal(normalise('bass'), 'bass');
  assert.equal(normalise('fungus'), 'fungus');
  assert.equal(normalise('lens'), 'lens');
});

test('diacritics and apostrophes do not make a second word', () => {
  assert.equal(normalise('Cafés'), normalise('cafes'));
  assert.equal(normalise("Hadrian's Wall"), 'hadrian wall');
});

test('an empty or punctuation-only wording resolves to nothing at all', () => {
  // It must not become a key, a proposal or a row: `keyFor('!!')` returning ''
  // is what stops a blank chip reaching an offer.
  for (const junk of ['', '   ', '!!!', '···']) {
    assert.equal(normalise(junk), '');
    assert.equal(keyFor(junk), '');
  }
});

test('a key is the normalised wording, hyphenated', () => {
  assert.equal(keyFor('Bell ringing'), 'bell-ringing');
  assert.equal(keyFor('Fossil Hunting'), 'fossil-hunting');
});

test('the browse category is derived from the tags, and the first tag breaks a tie', () => {
  // Tag *Fossil hunting* and *Ammonites* and the answer is Geology and fossils
  // — the host is never asked a third question.
  assert.equal(categoryFrom([
    { categoryKey: 'geology-fossils' }, { categoryKey: 'geology-fossils' }, { categoryKey: 'nature' },
  ]), 'geology-fossils');
  // A tie goes to the tag the host dragged to the front, because that is the
  // one that shows on the card.
  assert.equal(categoryFrom([{ categoryKey: 'nature' }, { categoryKey: 'crafts' }]), 'nature');
  // Nothing resolved yet is not a guess: a host who skipped is asked directly.
  assert.equal(categoryFrom([]), null);
  assert.equal(categoryFrom([{ categoryKey: null }, { key: 'clog-dancing' }]), null);
});

test('the old single word is a suggestion and never an answer', () => {
  assert.equal(categoryForPassion('pottery'), 'crafts');
  assert.equal(categoryForPassion('sea-swimming'), 'on-the-water');
  // Words with no honest bucket suggest nothing rather than the nearest thing.
  assert.equal(categoryForPassion('business'), null);
  assert.equal(categoryForPassion(null), null);
  assert.equal(categoryForPassion('something nobody wrote'), null);
});

test('a count is drawn only where it flatters', () => {
  // "34 hosts" reads as company. "0 hosts" reads as an empty shelf and tells a
  // host they are alone on a platform they have not joined yet.
  assert.equal(flatters(34), true);
  assert.equal(flatters(3), true);
  assert.equal(flatters(0), false);
  assert.equal(flatters(1), false);
  assert.equal(flatters(null), false);
});

test('the three prompts differ in copy and in nothing else', () => {
  const kinds = ['skill', 'expert', 'meetups'];
  for (const k of kinds) {
    assert.ok(PROMPTS[k].title && PROMPTS[k].sub && PROMPTS[k].placeholder, `${k} has its copy`);
  }
  // The Local host is never asked what he is an expert in — ask him that and he
  // types nothing and abandons the wizard.
  assert.ok(!/expert/i.test(PROMPTS.meetups.title));
  assert.match(PROMPTS.meetups.title, /into/);
  // The Guide is told out loud that a badge is evidence, not expertise, so it
  // never lands in the tag list.
  assert.match(PROMPTS.expert.aside, /evidence, not expertise/);
  // An unknown kind still gets a question rather than an empty screen.
  assert.equal(promptFor('nonsense'), PROMPTS.skill);
  assert.equal(promptFor(undefined), PROMPTS.skill);
});

test('the caps are the ones the design states, and the Local host has his age bands', () => {
  assert.equal(TAG_CAP, 6);
  assert.equal(FACET_CAP, 2);
  assert.deepEqual(AGE_BANDS.map((b) => b.label), ['Under 5s', '5–8', '9–12', 'Teenagers', 'Grown-ups', 'Buggy-friendly']);
});

test('a breadcrumb is the category then the parents, and stops before it stops fitting', () => {
  const byKey = {
    palaeontology: { label: 'Palaeontology', parent_key: 'earth-sciences' },
    'earth-sciences': { label: 'Earth sciences', parent_key: null },
  };
  const cats = { 'geology-fossils': 'Geology and fossils' };
  assert.equal(
    breadcrumb({ category_key: 'geology-fossils', parent_key: 'palaeontology' }, byKey, cats),
    'Geology and fossils › Earth sciences › Palaeontology',
  );
  // A tag at the top of its category still reads as something.
  assert.equal(breadcrumb({ category_key: 'geology-fossils', parent_key: null }, byKey, cats), 'Geology and fossils');
  // A cycle in the data must not hang the screen that draws it.
  const loop = { a: { label: 'A', parent_key: 'b' }, b: { label: 'B', parent_key: 'a' } };
  assert.ok(breadcrumb({ category_key: null, parent_key: 'a' }, loop, {}).length > 0);
});

test('both fields are asked for before an offer goes live, and neither before that', () => {
  assert.deepEqual(skillBlockers({ category_key: 'crafts', format_key: 'workshop' }), []);
  assert.equal(skillBlockers({ category_key: null, format_key: 'workshop' }).length, 1);
  assert.equal(skillBlockers({}).length, 2);
  // A pending tag never blocks anything: the offer goes up with the host's own
  // wording on it and the word goes to the queue. That is the whole point.
  assert.deepEqual(skillBlockers({ category_key: 'crafts', format_key: 'walk', tags: [{ pending: true }] }), []);
});

test('a credential that needs evidence does not show until somebody has seen it', () => {
  const type = { key: 'blue-badge', label: 'Blue Badge guide', evidence_required: true, expires_months: 36 };
  assert.equal(credentialDisplay({ state: 'pending' }, type), null);
  assert.equal(credentialDisplay({ state: 'rejected' }, type), null);
  const shown = credentialDisplay({ state: 'confirmed', confirmed_at: '2026-09-13T00:00:00Z' }, type);
  assert.equal(shown.how, 'confirmed');
  assert.equal(shown.at, '2026-09-13T00:00:00Z');
  // One that needs no evidence is the host's own claim, and says so. "We have
  // seen this" and "she told us this" are different facts.
  const stated = credentialDisplay({ state: 'stated' }, { key: 'years-at-it', label: 'Years at it', evidence_required: false });
  assert.equal(stated.how, 'stated');
  assert.equal(stated.at, null);
});

test('a confirmation can go stale, and one that never expires says so', () => {
  const at = new Date('2026-09-13T12:00:00Z');
  assert.equal(expiryFor({ expires_months: 12 }, at), '2027-09-13');
  assert.equal(expiryFor({ expires_months: null }, at), null);
  assert.equal(expiryFor(null, at), null);
  // The month that does not have that day: 31 January plus one is 28 February,
  // not 3 March, which is what a plain setMonth gives (Codex, 13 Sep 2026).
  assert.equal(expiryFor({ expires_months: 1 }, new Date('2027-01-31T12:00:00Z')), '2027-02-28');
  assert.equal(expiryFor({ expires_months: 1 }, new Date('2028-01-31T12:00:00Z')), '2028-02-29');
  assert.equal(expiryFor({ expires_months: 36 }, new Date('2026-08-31T12:00:00Z')), '2029-08-31');
});

test('a credential is a condition of hosting only where it is written down as one', () => {
  const types = [
    { key: 'food-registration', gates_categories: ['food-drink'] },
    { key: 'years-at-it', gates_categories: [] },
  ];
  assert.deepEqual(gatingTypes(types, 'food-drink').map((t) => t.key), ['food-registration']);
  assert.deepEqual(gatingTypes(types, 'crafts'), []);
  assert.deepEqual(gatingTypes(types, null), []);
});

// ---------------------------------------------------------------------------
// what the review found (Codex, 13 September 2026)
// ---------------------------------------------------------------------------

const { missingCredentials, publishBlockers } = await import('../src/domain/hosting.js');

test('a credential that is a condition of hosting stops the offer going live', () => {
  const types = [
    { key: 'food-registration', label: 'Food business registration', active: true, evidence_required: true, gates_categories: ['food-drink'], host_types: ['skill', 'meetups', 'expert'] },
    { key: 'years-at-it', label: 'Years at it', active: true, evidence_required: false, gates_categories: [], host_types: ['skill'] },
  ];
  const host = { type: 'skill' };
  const offer = { category_key: 'food-drink' };
  // Nothing claimed: the law, not a boast.
  assert.match(missingCredentials(offer, host, { types, credentials: [] }).join(' '), /needed to host/);
  // Claimed and waiting is not evidence yet.
  assert.match(missingCredentials(offer, host, { types, credentials: [{ type_key: 'food-registration', state: 'pending' }] }).join(' '), /with us to check/);
  // Refused is not evidence either.
  assert.equal(missingCredentials(offer, host, { types, credentials: [{ type_key: 'food-registration', state: 'rejected' }] }).length, 1);
  // Confirmed and in date opens it.
  assert.deepEqual(missingCredentials(offer, host, { types, credentials: [{ type_key: 'food-registration', state: 'confirmed', expires_on: null }] }), []);
  // Confirmed but stale is a document nobody has looked at for three years.
  assert.match(missingCredentials(offer, host, { types, credentials: [{ type_key: 'food-registration', state: 'confirmed', expires_on: '2020-01-01' }] }).join(' '), /renewing/);
  // A category nobody gates is not gated by accident.
  assert.deepEqual(missingCredentials({ category_key: 'crafts' }, host, { types, credentials: [] }), []);
  // Where a category is gated by two, they are alternatives and not a set:
  // a sailing morning must not need a swim-coaching award as well (Codex).
  const water = [
    { key: 'paddlesport-coach', label: 'Paddlesport coach', active: true, evidence_required: true, gates_categories: ['on-the-water'], host_types: ['skill'] },
    { key: 'open-water-coach', label: 'Open water swim coach', active: true, evidence_required: true, gates_categories: ['on-the-water'], host_types: ['skill'] },
  ];
  const sailing = { category_key: 'on-the-water' };
  assert.deepEqual(missingCredentials(sailing, host, { types: water, credentials: [{ type_key: 'paddlesport-coach', state: 'confirmed' }] }), []);
  // Holding neither is one sentence naming both, not two demands.
  const none = missingCredentials(sailing, host, { types: water, credentials: [] });
  assert.equal(none.length, 1);
  assert.match(none[0], /Paddlesport coach or Open water swim coach/);
  // And a caller with nothing loaded still gets an honest answer about the rest.
  assert.deepEqual(missingCredentials(offer, host, null), []);
});

test('publishing is blocked by a missing gating credential, and only when it is public', () => {
  const host = { type: 'skill', trust: 'verified', payout_status: 'connected', date_of_birth: '1980-01-01' };
  const types = [{ key: 'food-registration', label: 'Food business registration', active: true, evidence_required: true, gates_categories: ['food-drink'], host_types: ['skill'] }];
  const live = {
    shape: 'oneoff', visibility: 'public', money: 'free', title: 'Supper', description: 'Three courses from the garden.',
    starts_on: '2026-10-01', price_mode: 'free', venue: 'out_about', venue_area: 'central Windsor', video_id: 'v', category_key: 'food-drink', format_key: 'workshop',
  };
  assert.match(publishBlockers(live, host, { types, credentials: [] }).join(' '), /Food business registration/);
  assert.deepEqual(publishBlockers(live, host, { types, credentials: [{ type_key: 'food-registration', state: 'confirmed' }] }), []);
  // A private offer is not advertised, so this gate is not the thing that stops it.
  assert.deepEqual(publishBlockers({ ...live, visibility: 'invite', video_id: null }, { type: null, trust: 'verified', payout_status: 'not_connected' }, { types, credentials: [] }), []);
});

test('the browse row still finds an offer that carries the old word', async () => {
  const { passionsForCategory } = await import('../src/domain/hostSkills.js');
  // Selecting "Food and drink" has to include the offers filed as `cooking`,
  // `baking`, `wine`, `coffee` and `food` before the skills work existed —
  // otherwise every one of them vanishes from every filter until it is edited.
  const food = passionsForCategory('food-drink');
  for (const old of ['cooking', 'baking', 'wine', 'coffee', 'food']) assert.ok(food.includes(old), old);
  assert.deepEqual(passionsForCategory('crafts'), ['pottery']);
  assert.deepEqual(passionsForCategory(null), []);
  // A bucket nothing used to be called has no old words, and says so rather
  // than returning everything.
  assert.deepEqual(passionsForCategory('geology-fossils'), []);
});

test('nothing is gated until somebody sets a gate', async () => {
  // §9 leaves "which credential types gate which categories" to the owner, and
  // a browse category is a bucket of sixteen — a food business registration is
  // the law for cooking for paying guests, not for a wine-tasting walk. So the
  // mechanism ships switched off, and turning it on is one edit per type.
  const fs = await import('node:fs/promises');
  const sql = await fs.readFile(new URL('../migrations/102_host_skills.sql', import.meta.url), 'utf8');
  const seeded = sql.slice(sql.indexOf('insert into host_credential_types'));
  const rows = seeded.slice(0, seeded.indexOf('on conflict'));
  assert.ok(!/'\{(walking|on-the-water|food-drink|families|crafts|nature|heritage)[^']*\}'/.test(rows), 'no seeded gate');
});

test('a gate on a credential nobody checks is cleared by claiming it', async () => {
  // A type that asks for no evidence can only ever reach `stated`, so a gate on
  // one that demanded `confirmed` would lock its category shut for ever. Weak
  // is a decision somebody can make; impossible is a bug (Codex, 13 Sep 2026).
  const types = [{ key: 'years-at-it', label: 'Years at it', active: true, evidence_required: false, gates_categories: ['crafts'], host_types: ['skill'] }];
  const offer = { category_key: 'crafts' };
  const host = { type: 'skill' };
  assert.equal(missingCredentials(offer, host, { types, credentials: [] }).length, 1);
  assert.deepEqual(missingCredentials(offer, host, { types, credentials: [{ type_key: 'years-at-it', state: 'stated' }] }), []);
});

test('a facet decision moves no categories, and says so without falling over', async () => {
  // The browse category is derived from tags alone, so repointing a facet has
  // nothing to re-file. It still has to answer with a list rather than a
  // reference to a variable that is not there (Codex, 14 Sep 2026) — the
  // approve and merge paths both read what it returns.
  const repo = await import('../src/repositories/hostSkills.js');
  assert.equal(typeof repo.repoint, 'function');
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/repositories/hostSkills.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function repoint('), src.indexOf('export async function recomputeCategories('));
  assert.ok(!/return moved;/.test(body), 'repoint returns no undefined name');
  assert.match(body, /if \(vocab !== 'tag'\) return \[\];/);
});

test('one word finds both vocabularies, in both directions', async () => {
  const { categoryForPassion: bucketOf, passionsForCategory: oldWordsFor } = await import('../src/domain/hostSkills.js');
  /**
   * The browse row passes a bucket and the older passion chips still pass a
   * passion, and both are on the same screen. So Painting has to find the
   * offers filed `painting` last year *and* the ones filed `art-photography`
   * since, and picking Art and photography has to find the same two — otherwise
   * one control quietly shows half the answer (Codex, 14 Sep 2026).
   */
  assert.equal(bucketOf('painting'), 'art-photography');
  assert.ok(oldWordsFor('art-photography').includes('painting'));
  // Round trip: every old word lands in a bucket that collects it back.
  for (const old of ['pottery', 'cooking', 'yoga', 'history', 'records']) {
    const bucket = bucketOf(old);
    assert.ok(bucket, old);
    assert.ok(oldWordsFor(bucket).includes(old), `${old} → ${bucket} → back`);
  }
});

test('a plural meets its singular, including the awkward ones', () => {
  // The fold decides whether two hosts typing the same thing meet before an
  // administrator sees them, so the words it gets wrong are duplicates in the
  // queue for ever (Codex, 14 Sep 2026).
  for (const [one, many] of [
    ['house', 'houses'], ['course', 'courses'], ['horse', 'horses'],
    ['glass', 'glasses'], ['church', 'churches'], ['dish', 'dishes'], ['box', 'boxes'],
    ['lens', 'lenses'], ['gas', 'gases'], ['fossil', 'fossils'], ['ammonite', 'ammonites'],
  ]) {
    assert.equal(normalise(one), normalise(many), `${one} / ${many}`);
  }
});
