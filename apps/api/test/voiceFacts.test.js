/**
 * The fact set and what is done with it (domain/voiceFacts.js): the profile
 * fills what was not said, gaps become at most two questions and only for a
 * first-time door, chips say where they came from, and the results address and
 * trip draft follow from the resolved facts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIP_FACTS_SCHEMA, applyOverrides, harvestOffer, holdWeekday, mergeTripFacts, normaliseTripFacts, resolveIntake, resultsHref, tripDraft,
} from '../src/domain/voiceFacts.js';
import { schemaIsStrict } from '../src/domain/voiceIntent.js';
import { FOOD_SCHEMA, LIKES_SCHEMA, WHO_SCHEMA, normaliseLikes, normaliseWho } from '../src/domain/voiceHousehold.js';

const household = { home_label: 'Fairways, Titlarks Hill, Ascot, SL5 0JD', home_lat: 51.4, home_lng: -0.66 };
const members = [
  { id: 'a', name: 'Sam', age: 41, isMinor: false }, { id: 'b', name: 'Jo', age: 39, isMinor: false },
  { id: 'c', name: 'Priya', age: 9, isMinor: true }, { id: 'd', name: 'Alfie', age: 6, isMinor: true },
];
const today = '2026-09-09';

test('every schema keeps to strict mode', () => {
  for (const [name, schema] of [['trip', TRIP_FACTS_SCHEMA], ['who', WHO_SCHEMA], ['food', FOOD_SCHEMA], ['likes', LIKES_SCHEMA]]) {
    const { ok, problems } = schemaIsStrict(schema);
    assert.deepEqual(problems, [], name);
    assert.equal(ok, true, name);
  }
});

const heard = normaliseTripFacts({
  language: 'en', trip_type: null, when: { start: '2026-09-12', end: null, as_said: 'on Saturday' }, time_of_day: null,
  destination: null, origin: { kind: null, name: null }, travel_mode: 'car', max_minutes: 60,
  who: { kind: 'whole_household', names: [], adults: null, children: null, kids_mentioned: true }, kids_ages: [],
  vibe: 'active', vibe_no_preference: false, several_things: null, indoors: null,
  food: { diets: ['vegetarian'], cuisines: [], must_haves: ['a pub lunch'], avoids: [], place: null, no_preference: false },
  ambiguities: [], corrections: [],
});

test('a first-time request: said chips are lime, the profile fills the origin, and the one gap is the kids’ ages', () => {
  const out = resolveIntake({ facts: heard, flow: 'first', household, members: members.map((m) => ({ ...m, age: m.isMinor ? null : m.age })), today });
  const by = Object.fromEntries(out.slots.map((x) => [x.key, x]));
  assert.equal(by.when.source, 'said');
  assert.equal(by.when.label, 'Sat 12 Sept');
  assert.equal(by.origin.source, 'profile');
  assert.equal(by.origin.label, 'From home · Ascot');
  assert.equal(by.travel_mode.label, 'Car');
  assert.equal(by.max_minutes.label, 'Up to 1 hr each way');
  assert.equal(by.who.label, 'Whole family · 4');
  assert.equal(by.kids_ages.source, 'gap', 'kids were said without ages and the profile has none');
  assert.equal(by.vibe.label, 'Active');
  assert.equal(by.several_things, undefined, 'nothing under What that was not said');
  assert.deepEqual(out.slots.filter((x) => x.key === 'food_diet').map((x) => x.label), ['Vegetarian']);
  assert.deepEqual(out.questions.map((q) => q.slot), ['kids_ages']);
  assert.equal(out.questions[0].children.length, 2, 'one row per child the household has');
});

test('a returning request asks nothing: the profile answers, in grey', () => {
  const out = resolveIntake({ facts: { ...heard, kids_ages: [] }, flow: 'returning', household, members, profile: { travelMode: 'car', maxMinutes: 60, diets: ['vegetarian'], destinationPoint: { lat: 51.48, lng: -0.61 } }, today });
  const by = Object.fromEntries(out.slots.map((x) => [x.key, x]));
  assert.deepEqual(out.questions, []);
  assert.equal(by.kids_ages, undefined, 'the household knows its own children; the whole-family chip says it all');
  assert.equal(by.who.label, 'Whole family · 4');
  assert.ok(by.journey, 'the journey is worked out from home to the destination');
  assert.match(by.journey.label, /^Car · \d+ min/);
  assert.equal(out.slots.filter((x) => x.key === 'food_diet').length, 1, 'a diet said and on the profile is one chip, lime');
  assert.equal(out.slots.find((x) => x.key === 'food_diet').source, 'said');
});

test('nothing about when or how far: the kind of day is the first question, how far the second, never a third', () => {
  const bare = normaliseTripFacts({ ...heard, when: { start: null, end: null, as_said: null }, travel_mode: null, max_minutes: null, vibe: null, who: { kind: null, names: [], adults: null, children: null, kids_mentioned: false } });
  const out = resolveIntake({ facts: bare, flow: 'first', household, members, today });
  assert.deepEqual(out.questions.map((q) => q.slot), ['trip_type', 'max_minutes']);
  const by = Object.fromEntries(out.slots.map((x) => [x.key, x]));
  assert.equal(by.when.label, 'Today');
  assert.equal(by.who.source, 'profile');
});

test('an answer to a gap and a tap on a chip are laid over the facts, and a skip is not asked again', () => {
  const f = applyOverrides(heard, { kids_ages: [{ age: 9 }, { band: '5-8' }], travel_mode: 'public_transport' });
  assert.equal(f.travel_mode, 'public_transport');
  assert.deepEqual(f.kids_ages.map((k) => k.band), ['9-12', '5-8']);
  const out = resolveIntake({ facts: heard, answers: { kids_ages: null }, flow: 'first', household, members, today });
  assert.deepEqual(out.questions, [], 'skipped: the gap stays a gap but is not asked');
});

test('the wizard’s pages merge: later words win, silence keeps what was there, lists join', () => {
  const page2 = normaliseTripFacts({ ...heard, when: { start: null, end: null, as_said: null }, travel_mode: null, max_minutes: null, food: { diets: ['vegan'], cuisines: ['Italian'], must_haves: [], avoids: [], place: null, no_preference: false } });
  const merged = mergeTripFacts(heard, page2);
  assert.equal(merged.when.start, '2026-09-12');
  assert.equal(merged.travel_mode, 'car');
  assert.deepEqual(merged.food.diets, ['vegetarian', 'vegan']);
  assert.deepEqual(merged.food.cuisines, ['Italian']);
});

test('the results address is Inspire, set by what was said, and the trip draft is the create route’s own shape', () => {
  const out = resolveIntake({ facts: { ...heard, destination: 'Windsor' }, flow: 'returning', household, members, profile: { travelMode: 'car', maxMinutes: 60 }, today });
  const href = resultsHref({ resolved: out.resolved, intakeId: 'abc', destinationPoint: { lat: 51.4839, lng: -0.6044, label: 'Windsor' } });
  assert.ok(href.startsWith('/inspire?'), `active is every shelf, not the thin Active one: ${href}`);
  const fun = resultsHref({ resolved: { ...out.resolved, vibe: 'fun' }, intakeId: 'abc' });
  assert.ok(fun.startsWith('/inspire/fun?'), fun);
  const q = new URL(`http://x${href}`).searchParams;
  assert.equal(q.get('at'), '51.48390,-0.60440');
  assert.equal(q.get('intake'), 'abc');
  assert.equal(q.get('travel'), null, 'an hour is Inspire’s own default and is not written');
  const draft = tripDraft({ resolved: out.resolved, destinationPoint: { lat: 51.4839, lng: -0.6044, label: 'Windsor' }, members });
  assert.equal(draft.kind, 'day');
  assert.equal(draft.date, '2026-09-12');
  assert.equal(draft.travelMode, 'driving');
  assert.equal(draft.destination.label, 'Windsor');
});

test('a weekend with a range is a holiday-shaped trip', () => {
  const f = normaliseTripFacts({ ...heard, trip_type: null, when: { start: '2026-10-02', end: '2026-10-04', as_said: 'the first weekend of October' }, destination: 'Bath' });
  const out = resolveIntake({ facts: f, flow: 'first', household, members, today });
  assert.equal(out.tripType, 'weekend');
  const draft = tripDraft({ resolved: out.resolved, members });
  assert.equal(draft.kind, 'holiday');
  assert.equal(draft.startDate, '2026-10-02');
  assert.equal(draft.endDate, '2026-10-04');
});

test('the harvest card offers only what the profile lacks', () => {
  const f = normaliseTripFacts({ ...heard, kids_ages: [{ name: null, age: 6, band: null }, { name: null, age: 9, band: null }] });
  assert.equal(harvestOffer({ facts: f, members, profile: { diets: ['vegetarian'] } }), null, 'all already known');
  const offer = harvestOffer({ facts: f, members: [members[0]], profile: {} });
  assert.equal(offer.text, "Remember that you're vegetarian and the kids are 6 & 9?");
  assert.deepEqual(offer.items.map((i) => i.kind), ['diet', 'kids']);
});

test('the household breath: the speaker, the children, an age only when said', () => {
  const people = normaliseWho({ people: [
    { name: 'Sam', role: 'adult', age: null, relationship: null, is_speaker: true },
    { name: 'Jo', role: null, age: null, relationship: 'partner', is_speaker: false },
    { name: 'Priya', role: 'child', age: 9, relationship: 'daughter', is_speaker: false },
    { name: 'Alfie', role: 'child', age: null, relationship: 'son', is_speaker: true },
  ] });
  assert.equal(people.filter((p) => p.isSpeaker).length, 1, 'one speaker');
  assert.equal(people[1].role, null, 'a partner with nothing else said is not guessed');
  assert.equal(people[3].age, null);
});

test('likes map onto our shelves per person, and "the kids" is every child', () => {
  const vocab = { categories: [{ key: 'activity', label: 'Active' }, { key: 'fun', label: 'Fun' }, { key: 'culture', label: 'Culture' }], subcategories: [{ key: 'climbing', category_key: 'activity', label: 'Climbing' }, { key: 'zoos-wildlife', category_key: 'fun', label: 'Zoos & wildlife' }, { key: 'castles', category_key: 'culture', label: 'Castles' }] };
  const out = normaliseLikes({ items: [
    { kind: 'love', phrase: 'climbing', category: 'activity', subcategory: 'climbing', who: 'the kids' },
    { kind: 'love', phrase: 'a castle', category: 'culture', subcategory: 'castles', who: 'Jo' },
    { kind: 'avoid', phrase: 'queuing', category: null, subcategory: null, who: null },
  ], mobility: null }, members, vocab);
  assert.deepEqual(out.items.filter((i) => i.phrase === 'climbing').map((i) => i.memberName), ['Priya', 'Alfie']);
  assert.equal(out.items.find((i) => i.phrase === 'a castle').memberId, 'b');
  const queue = out.items.find((i) => i.kind === 'avoid');
  assert.equal(queue.memberId, null, 'everyone');
  assert.equal(queue.label, 'Queuing');
});

test('a later breath can turn "a few things" into "one thing", and a flag is never turned off by silence', () => {
  const later = normaliseTripFacts({ ...heard, several_things: false, indoors: false, food: { ...heard.food, diets: [], no_preference: false } });
  const merged = mergeTripFacts({ ...heard, several_things: true, indoors: true, food: { ...heard.food, no_preference: true } }, later);
  assert.equal(merged.several_things, false);
  assert.equal(merged.indoors, false);
  assert.equal(merged.food.no_preference, true, 'the flag stays');
});

test('kids answered by band are offered to remember, as the middle of the band', () => {
  const f = normaliseTripFacts({ ...heard, kids_ages: [{ name: null, age: null, band: '9-12' }, { name: null, age: null, band: '5-8' }] });
  const offer = harvestOffer({ facts: f, members: [members[0]], profile: { diets: ['vegetarian'] } });
  assert.equal(offer.text, 'Remember that the kids are 9-12 & 5-8?');
  assert.deepEqual(offer.items[0].ages.map((k) => k.age), [10, 6]);
});

test('one child on file accounts for one said child, not two', () => {
  const f = normaliseTripFacts({ ...heard, kids_ages: [{ name: null, age: null, band: '9-12' }, { name: null, age: null, band: '9-12' }] });
  const offer = harvestOffer({ facts: f, members: [members[0], members[2]], profile: { diets: ['vegetarian'] } });
  assert.equal(offer.items.length, 1);
  assert.equal(offer.items[0].ages.length, 1, 'Priya (9) covers one of the two; the other is new');
});

test('everyone named is the whole family, and who is never written into the results address', () => {
  const f = normaliseTripFacts({ ...heard, who: { kind: 'named', names: ['Sam', 'Jo', 'Priya', 'Alfie'], adults: 2, children: 2, kids_mentioned: true } });
  const out = resolveIntake({ facts: f, flow: 'returning', household, members, today });
  assert.equal(out.slots.find((x) => x.key === 'who').label, 'Whole family · 4');
  const some = resolveIntake({ facts: normaliseTripFacts({ ...heard, who: { kind: 'named', names: ['Sam', 'Priya'], adults: null, children: null, kids_mentioned: true } }), flow: 'returning', household, members, today });
  assert.equal(some.slots.find((x) => x.key === 'who').label, 'Sam & Priya');
  const q = new URL(`http://x${resultsHref({ resolved: some.resolved, intakeId: 'z', memberCount: 4 })}`).searchParams;
  assert.equal(q.get('who'), 'a,c', 'some of the household: Inspire ranks for them');
  const all = new URL(`http://x${resultsHref({ resolved: out.resolved, intakeId: 'z', memberCount: 4 })}`).searchParams;
  assert.equal(all.get('who'), null, 'everybody is not written');
});

test('an exact age claims its child before a band does, whatever the order', () => {
  const f = normaliseTripFacts({ ...heard, kids_ages: [{ name: null, age: null, band: '9-12' }, { name: null, age: 9, band: null }] });
  const kids = [{ id: 'x', name: 'Nine', age: 9, isMinor: true }, { id: 'y', name: 'Ten', age: 10, isMinor: true }];
  assert.equal(harvestOffer({ facts: f, members: [members[0], ...kids], profile: { diets: ['vegetarian'] } }), null, 'the nine is the nine and the band is the ten');
});

test('what was named leads What; food from the profile waits until food is mentioned', () => {
  const f = normaliseTripFacts({
    ...heard, vibe: null,
    wants: [{ name: 'Windsor Castle', kind: 'place', type: 'castle' }, { name: 'a playground', kind: 'type', type: 'playground' }],
    food: { diets: [], cuisines: [], must_haves: [], kinds: [], avoids: [], place: null, no_preference: false },
  });
  const out = resolveIntake({ facts: f, flow: 'returning', household, members, profile: { diets: ['vegetarian'], allergens: ['carrots'] }, today });
  assert.deepEqual(out.slots.filter((x) => x.key === 'want').map((x) => x.label), ['Windsor Castle', 'A playground']);
  assert.equal(out.slots.some((x) => x.key.startsWith('food')), false, 'no food chips before food is mentioned');
  assert.deepEqual(out.resolved.leadKinds, ['castle', 'playground']);
  const withPub = resolveIntake({ facts: { ...f, food: { ...f.food, kinds: ['pub'], must_haves: ['a pub lunch'] } }, flow: 'returning', household, members, profile: { diets: ['vegetarian'] }, today });
  assert.deepEqual(withPub.slots.filter((x) => x.key.startsWith('food')).map((x) => `${x.key}:${x.label}:${x.source}`).sort(), ['food_diet:Vegetarian:profile', 'food_kind:Pub:said']);
  assert.deepEqual(withPub.resolved.leadFoodKinds, ['pub']);
});

test('more children than the household has is "N other kids", tappable, never a question for a returning household', () => {
  const f = normaliseTripFacts({ ...heard, who: { kind: 'whole_household', names: [], adults: 2, children: 3, kids_mentioned: true } });
  const out = resolveIntake({ facts: f, flow: 'returning', household, members, today });
  const kids = out.slots.find((x) => x.key === 'kids_ages');
  assert.equal(kids.label, '1 other kid');
  assert.equal(kids.source, 'said');
  assert.deepEqual(out.questions, []);
});

test('"on Saturday" is the next Saturday whatever date the model wrote, and a range keeps its length', () => {
  assert.equal(holdWeekday({ start: '2026-09-11', end: null, as_said: 'on Saturday' }, '2026-09-09').start, '2026-09-12');
  assert.equal(holdWeekday({ start: '2026-09-12', end: null, as_said: 'on Saturday' }, '2026-09-09').start, '2026-09-12', 'right already');
  assert.deepEqual(holdWeekday({ start: '2026-09-10', end: '2026-09-11', as_said: 'Friday to Saturday' }, '2026-09-09'), { start: '2026-09-11', end: '2026-09-12', as_said: 'Friday to Saturday' });
  assert.equal(holdWeekday({ start: '2026-09-11', end: null, as_said: 'tomorrow' }, '2026-09-09').start, '2026-09-11', 'no weekday, no change');
});

test('the household’s own children are not "said" ages, and food or a mood is not a want', () => {
  const f = normaliseTripFacts({
    ...heard,
    kids_ages: [{ name: 'Priya', age: 9, band: null }, { name: null, age: 6, band: null }],
    wants: [{ name: 'Windsor Castle', kind: 'place', type: 'castle' }, { name: 'pub lunch', kind: 'type', type: null }, { name: 'somewhere fun', kind: 'type', type: null }],
  });
  assert.deepEqual(f.wants.map((w) => w.name), ['Windsor Castle']);
  const out = resolveIntake({ facts: f, flow: 'returning', household, members, today });
  assert.equal(out.slots.find((x) => x.key === 'kids_ages'), undefined, 'Priya 9 and the 6 are the household; nothing to say');
  assert.equal(out.slots.find((x) => x.key === 'several_things'), undefined);
});
