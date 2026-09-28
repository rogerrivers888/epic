import { test } from 'node:test';
import assert from 'node:assert/strict';

// The visit question ("Epic Visit Question" board V1–V4, owner 28 Sep 2026):
// one yes/no question in the rating after a visit, asked only of the facts
// that are open at the place and matter to the household, once per visit and
// never twice; Didn't notice stored as unsure and never counted; a Change
// overwrites; the back office sees counts, never who.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const pipeline = await import('../src/desk/pipeline.js');
const verification = await import('../src/desk/verification.js');
const accuracy = await import('../src/desk/accuracy.js');
const facts = await import('../src/desk/facts.js');
const { bookingVisit } = await import('../src/routes/families.js');

test.after(() => pool.end());

const YEAR = new Date().getFullYear();
const PLACE = 'vq:magnet';

async function household(name, { toddler = false, access = false } = {}) {
  const { rows: [h] } = await query('insert into households (name, access_needs) values ($1, $2) returning id', [name, access]);
  await query(`insert into members (household_id, name, birth_year, is_minor) values ($1, 'Parent', $2, false)`, [h.id, YEAR - 38]);
  if (toddler) await query(`insert into members (household_id, name, birth_year, is_minor) values ($1, 'Toddler', $2, true)`, [h.id, YEAR - 2]);
  return h.id;
}

async function visit(householdId, ref = PLACE) {
  const { rows: [v] } = await query(
    `insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, $2, 'Magnet Leisure Centre', current_date) returning id`, [householdId, ref]);
  return v.id;
}

/** A place filed in a drawer where "Toddler pool" is Active, every standard fact answered by our sources and not due. */
async function seedPlace(ref = PLACE) {
  await query(`insert into shelf_categories (key, label, position) values ('vq-fun', 'VQ Fun', 90) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values ('vq-fun', 'vq-swim', 'VQ Swimming', 90) on conflict (key) do update set active = true`);
  await query(`insert into place_attributes (key, label, kind) values ('vq-toddler-pool', 'Toddler pool', 'yesno'), ('vq-flume', 'Flume', 'yesno') on conflict (key) do nothing`);
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status) values ('vq-swim', 'vq-toddler-pool', 'active'), ('vq-swim', 'vq-flume', 'gathering')
               on conflict (subcategory_key, attribute_key) do update set status = excluded.status`);
  await query(`insert into place_index (venue_ref, subcategory) values ($1, 'vq-swim') on conflict (venue_ref) do update set subcategory = 'vq-swim', not_in_epic_at = null`, [ref]);
  await query(`insert into place_records (venue_ref, name) values ($1, 'Magnet Leisure Centre') on conflict (venue_ref) do update set name = excluded.name`, [ref]).catch(() => null);
  await query(`delete from place_fact_answers where venue_ref = $1`, [ref]);
  await query(`delete from fact_suggestions where venue_ref = $1`, [ref]);
  await query(`delete from fact_unknowns where venue_ref = $1`, [ref]);
  await query(`delete from family_answers where venue_ref = $1`, [ref]);
  await query(`delete from family_asks where venue_ref = $1`, [ref]);
  await query(
    `insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source, recheck_due)
     select $1, key, 'yes', true, 'site', now() + interval '1 year' from place_attributes where standard and active and kind = 'yesno'`, [ref]);
}

const ask = async (householdId, visitId, ref = PLACE) => pipeline.questionFor({ householdId, ref, visitId });

test('the wording: a fact’s own question, else "Was there a … at …", with the place’s short name', async () => {
  assert.equal(pipeline.shortName('Magnet Leisure Centre'), 'Magnet Leisure');
  assert.equal(pipeline.shortName('The Deep - Hull'), 'The Deep');
  assert.equal(pipeline.questionText({ label: 'Toddler pool' }, 'Magnet Leisure'), 'Was there a toddler pool at Magnet Leisure?');
  const { rows } = await query(`select key, question from place_attributes where key in ('dog-friendly', 'step-free', 'indoor', 'parking', 'toilets', 'food-on-site', 'booking-required')`);
  const q = Object.fromEntries(rows.map((r) => [r.key, r.question]));
  assert.equal(q['dog-friendly'], 'Were dogs welcome at {place}?');
  assert.equal(q['step-free'], 'Could you get in without steps at {place}?');
  for (const k of ['indoor', 'parking', 'toilets', 'food-on-site', 'booking-required']) assert.match(q[k] ?? '', /\{place\}.*\?$/, `${k} has its own question`);
  assert.equal(pipeline.questionText({ label: 'Dog friendly', question: q['dog-friendly'] }, 'Magnet Leisure'), 'Were dogs welcome at Magnet Leisure?');
  const { rows: ranged } = await query(`select key from place_attributes where kind <> 'yesno' and question is not null`);
  assert.deepEqual(ranged, [], 'range facts are never asked');
});

test('eligible: Active in the drawer, open at the place, and it matters to the household', async () => {
  await seedPlace();
  const withToddler = await household('VQ toddler', { toddler: true });
  const v1 = await visit(withToddler);
  const [q] = await ask(withToddler, v1);
  assert.equal(q.fact, 'vq-toddler-pool', 'Don’t know, Active in the drawer');
  assert.equal(q.question, 'Was there a toddler pool at Magnet Leisure?');

  // A household with no toddler is never asked about the toddler pool: V4.
  const adults = await household('VQ adults');
  assert.deepEqual(await ask(adults, await visit(adults)), [], 'nothing fits: the block is absent');

  // Gathering evidence is not Active; a fact families settled is not open.
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values ($1, 'vq-flume', 'dont_know', null, null)`, [PLACE]);
  const other = await household('VQ other', { toddler: true });
  await query(`update place_fact_answers set source = 'families', state = 'yes', yesno = true where venue_ref = $1 and attribute_key = 'parking'`, [PLACE]);
  await query(`update place_fact_answers set recheck_due = now() - interval '1 day' where venue_ref = $1 and attribute_key = 'parking'`, [PLACE]);
  const [q2] = await ask(other, await visit(other));
  assert.equal(q2.fact, 'vq-toddler-pool', 'not the flume (gathering) and not parking (settled by families, however due)');
});

test('what is open: Don’t know, Suggestion, Conflict, a re-check due, a person’s Don’t know — conflicts first; never hidden', async () => {
  await seedPlace();
  const h = await household('VQ open');
  const v = await visit(h);
  assert.deepEqual(await ask(h, v), [], 'every fact answered and not due, and the toddler pool does not matter here');
  await query(`update place_fact_answers set recheck_due = now() - interval '1 day' where venue_ref = $1 and attribute_key = 'toilets'`, [PLACE]);
  await query(`insert into fact_suggestions (venue_ref, feature) values ($1, 'parking')`, [PLACE]);
  await query(`update place_fact_answers set state = 'conflict', yesno = null, source = null where venue_ref = $1 and attribute_key = 'indoor'`, [PLACE]);
  await query(`update place_fact_answers set hidden_at = now(), recheck_due = now() where venue_ref = $1 and attribute_key = 'food-on-site'`, [PLACE]);
  const [first] = await ask(h, v);
  assert.equal(first.fact, 'indoor', 'a conflict between our sources is settled by families first');
  assert.equal(first.question, 'Was Magnet Leisure indoors?', 'and the question does not say our sources disagree');

  const eligible = (r) => pipeline.askable(r);
  assert.equal(eligible({ state: 'yes', source: 'site', recheck_due: new Date(Date.now() + 1e9) }), false);
  assert.equal(eligible({ state: 'yes', source: 'site', recheck_due: new Date(Date.now() - 1e9) }), true, 'due a re-check');
  assert.equal(eligible({ state: 'yes', source: 'site', suggested: true }), true, 'a suggestion');
  assert.equal(eligible({ state: 'yes', source: 'site', unknown: true }), true, 'a person’s Don’t know');
  assert.equal(eligible({ state: 'yes', source: 'site', hidden_at: new Date(), recheck_due: new Date(0) }), false, 'hidden until re-checked');
  assert.equal(eligible({ state: 'no', source: 'families', unknown: true }), false, 'families settled it');
  assert.equal(eligible({ state: null }), true);
});

test('access facts go only to a household that said access matters; age facts only to one with a child that age', async () => {
  await seedPlace();
  await query(`update place_fact_answers set state = 'dont_know', yesno = null, source = null where venue_ref = $1 and attribute_key = 'step-free'`, [PLACE]);
  const { rows: [sf] } = await query(`select access_need from place_attributes where key = 'step-free'`);
  assert.equal(sf.access_need, true);
  const { rows: [park] } = await query(`select access_need from place_attributes where key = 'parking'`);
  assert.equal(park.access_need, false, 'parking is for everyone');
  const without = await household('VQ no access');
  assert.deepEqual(await ask(without, await visit(without)), [], 'not asked without access needs');
  const withAccess = await household('VQ access', { access: true });
  const [q] = await ask(withAccess, await visit(withAccess));
  assert.equal(q.fact, 'step-free');
  assert.equal(q.question, 'Could you get in without steps at Magnet Leisure?');

  const who = (ages, access = false) => ({ ages, access });
  assert.equal(pipeline.mattersTo({ label: 'Baby changing' }, who([38, 6])), false);
  assert.equal(pipeline.mattersTo({ label: 'Baby changing' }, who([38, 1])), true);
  assert.equal(pipeline.mattersTo({ label: 'Children’s play area' }, who([38])), false);
  assert.equal(pipeline.mattersTo({ label: 'Children’s play area' }, who([38, 10])), true);
  assert.equal(pipeline.mattersTo({ label: 'Teen zone', age: true }, who([38, 15])), true);
  assert.equal(pipeline.mattersTo({ label: 'Teen zone', age: true }, who([38])), false);
});

test('one question per visit, the same one on every look; never the same fact twice, and a skip counts as asked', async () => {
  await seedPlace();
  const h = await household('VQ once', { toddler: true });
  const v1 = await visit(h);
  const [q] = await ask(h, v1);
  const [again] = await ask(h, v1);
  assert.equal(again.fact, q.fact, 'the same question on every look at this visit');
  const { rows: [{ n }] } = await query('select count(*)::int n from family_asks where household_id = $1 and visit_id = $2', [h, v1]);
  assert.equal(n, 1, 'one per visit (askPerVisit 1)');
  // Skipped: never answered. The next visit is not asked the toddler pool again.
  const v2 = await visit(h);
  const next = await ask(h, v2);
  assert.ok(next.every((x) => x.fact !== q.fact), 'a skip counts as asked');
  // A visit id of somebody else's buys nothing.
  const stranger = await household('VQ stranger', { toddler: true });
  assert.deepEqual(await ask(stranger, v1), []);
  assert.equal(await pipeline.visitQuestion({ householdId: stranger, visitId: v1 }), null);
});

test('Didn’t notice is stored as unsure and never counted; a Change overwrites and keeps what the machine said first', async () => {
  await seedPlace();
  const h = await household('VQ change', { toddler: true });
  const v = await visit(h);
  const view = await pipeline.visitQuestion({ householdId: h, visitId: v });
  assert.equal(view.answer, null, 'V1');
  assert.equal(view.factId, 'vq-toddler-pool');
  const r = await pipeline.familyAnswer({ householdId: h, ref: PLACE, fact: 'vq-toddler-pool', answer: 'unsure' });
  assert.equal(r.answer, 'unsure');
  assert.equal((await pipeline.visitQuestion({ householdId: h, visitId: v })).answer, 'unsure', 'V3 after a reload');
  await assert.rejects(pipeline.familyAnswer({ householdId: h, ref: PLACE, fact: 'vq-toddler-pool', answer: 'maybe' }), (e) => e.status === 400);

  const srcs = await verification.sources({ sourceSlow: 5, sourceFailing: 15 });
  const fam = srcs.find((s) => s.source === 'families');
  const { rows: [{ n: yesNo }] } = await query(`select count(*)::int n from family_answers where answered_at >= now() - interval '7 days' and answer in ('yes','no')`);
  assert.equal(fam.checked, yesNo, 'unsure is not even a check');
  const drill = await verification.items({ kind: 'checked', source: 'families' });
  assert.ok(drill.rows.every((x) => x.ref !== PLACE), 'nor a row in the drill-down');

  // The machine answers in between; a Change keeps the first machine state.
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values ($1, 'vq-toddler-pool', 'yes', true, 'osm')`, [PLACE]);
  await pipeline.familyAnswer({ householdId: h, ref: PLACE, fact: 'vq-toddler-pool', answer: 'no' });
  const { rows } = await query(`select answer, machine_state, machine_source from family_answers where household_id = $1 and venue_ref = $2`, [h, PLACE]);
  assert.deepEqual(rows, [{ answer: 'no', machine_state: null, machine_source: null }], 'one record, overwritten; the machine as it was at the first answer');
  assert.equal((await pipeline.visitQuestion({ householdId: h, visitId: v })).answer, 'no', 'V2 after a reload');
});

test('settling: familiesSettle agreeing settles as Families; a Change that breaks it unsettles; familiesWrong hides a shown fact', async () => {
  await seedPlace();
  const a = await household('VQ settle a', { toddler: true });
  const b = await household('VQ settle b', { toddler: true });
  const c = await household('VQ settle c', { toddler: true });
  for (const h of [a, b, c]) await ask(h, await visit(h));
  await pipeline.familyAnswer({ householdId: c, ref: PLACE, fact: 'vq-toddler-pool', answer: 'unsure' });
  await pipeline.familyAnswer({ householdId: a, ref: PLACE, fact: 'vq-toddler-pool', answer: 'yes' });
  let row = (await query(`select state, source from place_fact_answers where venue_ref = $1 and attribute_key = 'vq-toddler-pool'`, [PLACE])).rows[0];
  assert.equal(row, undefined, 'one yes (and an unsure, not counted) settles nothing');
  await pipeline.familyAnswer({ householdId: b, ref: PLACE, fact: 'vq-toddler-pool', answer: 'yes' });
  row = (await query(`select state, source from place_fact_answers where venue_ref = $1 and attribute_key = 'vq-toddler-pool'`, [PLACE])).rows[0];
  assert.deepEqual(row, { state: 'yes', source: 'families' }, 'Verified, source Families');
  await pipeline.familyAnswer({ householdId: b, ref: PLACE, fact: 'vq-toddler-pool', answer: 'no' });
  row = (await query(`select state, source from place_fact_answers where venue_ref = $1 and attribute_key = 'vq-toddler-pool'`, [PLACE])).rows[0];
  assert.deepEqual(row, { state: 'dont_know', source: null }, 'the agreement went with the Change');

  // Two families saying a shown fact is wrong hide it and queue its re-check.
  await query(`update place_fact_answers set state = 'dont_know', yesno = null, source = null, recheck_due = now() + interval '1 year' where venue_ref = $1 and attribute_key = 'parking'`, [PLACE]);
  const d = await household('VQ hide d');
  const e = await household('VQ hide e');
  for (const h of [d, e]) await ask(h, await visit(h));
  await query(`update place_fact_answers set state = 'yes', yesno = true, source = 'osm' where venue_ref = $1 and attribute_key = 'parking'`, [PLACE]);
  await pipeline.familyAnswer({ householdId: d, ref: PLACE, fact: 'parking', answer: 'no' });
  const out = await pipeline.familyAnswer({ householdId: e, ref: PLACE, fact: 'parking', answer: 'no' });
  assert.equal(out.settled, 'hidden');
  row = (await query(`select hidden_at, recheck_due <= now() as due from place_fact_answers where venue_ref = $1 and attribute_key = 'parking'`, [PLACE])).rows[0];
  assert.ok(row.hidden_at && row.due);
});

test('accuracy keeps the machine’s answer and source at the time of the first answer', async () => {
  await seedPlace('vq:acc');
  const h = await household('VQ acc');
  await query(`update place_fact_answers set recheck_due = now() - interval '1 day', source = 'osm' where venue_ref = 'vq:acc' and attribute_key = 'toilets'`);
  const [q] = await ask(h, await visit(h, 'vq:acc'), 'vq:acc');
  assert.equal(q.fact, 'toilets');
  await pipeline.familyAnswer({ householdId: h, ref: 'vq:acc', fact: 'toilets', answer: 'no' });
  await query(`update place_fact_answers set source = 'site' where venue_ref = 'vq:acc' and attribute_key = 'toilets'`);
  await pipeline.familyAnswer({ householdId: h, ref: 'vq:acc', fact: 'toilets', answer: 'yes' });
  const { rows: [r] } = await query(`select answer, machine_state, machine_source from family_answers where household_id = $1`, [h]);
  assert.deepEqual(r, { answer: 'yes', machine_state: 'yes', machine_source: 'osm' });
  const page = await accuracy.accuracy({ view: 'fact' });
  assert.ok(page, 'Accuracy reads it');

  // A person's Don't know stands: the machine had nothing to show, and the
  // fact is open to families although our sources say yes.
  await seedPlace('vq:ovl');
  await query(`insert into fact_unknowns (venue_ref, attribute_key, who) values ('vq:ovl', 'toilets', 'test@epic') on conflict do nothing`);
  const h2 = await household('VQ overlay');
  const [q2] = await ask(h2, await visit(h2, 'vq:ovl'), 'vq:ovl');
  assert.equal(q2.fact, 'toilets');
  await pipeline.familyAnswer({ householdId: h2, ref: 'vq:ovl', fact: 'toilets', answer: 'yes' });
  const { rows: [o] } = await query(`select machine_state, machine_source from family_answers where household_id = $1`, [h2]);
  assert.deepEqual(o, { machine_state: 'dont_know', machine_source: null }, 'not a comparison Accuracy counts');
});

test('the back office sees counts per fact per place, never which household said what', async () => {
  await seedPlace('vq:bo');
  const hs = [];
  for (const n of ['VQ bo 1', 'VQ bo 2', 'VQ bo 3']) {
    const h = await household(n);
    hs.push(h);
    await query(`insert into family_asks (household_id, venue_ref, attribute_key) values ($1, 'vq:bo', 'toilets')`, [h]);
    await pipeline.familyAnswer({ householdId: h, ref: 'vq:bo', fact: 'toilets', answer: 'yes' });
  }
  const page = await facts.factPlaces('toilets');
  const place = page.rows.find((p) => p.ref === 'vq:bo');
  assert.ok(place, 'the place is listed');
  assert.match(place.how, /Families · 3 said yes/);
  assert.equal(facts.familiesWord({ yes: 2, no: 1 }), '2 said yes, 1 no');
  const outputs = [
    page,
    await accuracy.accuracy({ view: 'fact' }),
    await accuracy.accuracy({ view: 'category' }),
    await verification.items({ kind: 'answered', source: 'families' }),
    await verification.items({ kind: 'checked', source: 'families' }),
    await verification.sources({ sourceSlow: 5, sourceFailing: 15 }),
  ];
  const text = JSON.stringify(outputs);
  for (const h of hs) assert.ok(!text.includes(h), 'no household id in any desk answer');
  assert.ok(!/"household(_id|Id)"/.test(text), 'nor a household field');
});

test('a hosted booking at a place stands for the visit; at no place, nothing is asked', async () => {
  await seedPlace('vq:hosted');
  const h = await household('VQ booking', { toddler: true });
  const { rows: [host] } = await query(`insert into hosts (household_id, name) values ($1, 'Tom') returning id`, [h]);
  const { rows: [atPlace] } = await query(
    `insert into host_offers (host_id, shape, state, title, starts_on, venue_ref) values ($1, 'oneoff', 'live', 'Swim school', current_date - 3, 'vq:hosted') returning id`, [host.id]);
  const { rows: [nowhere] } = await query(
    `insert into host_offers (host_id, shape, state, title, starts_on) values ($1, 'oneoff', 'live', 'Online class', current_date - 3) returning id`, [host.id]);
  const { rows: [b1] } = await query(`insert into experience_bookings (offer_id, host_id, household_id, state) values ($1, $2, $3, 'confirmed') returning id`, [atPlace.id, host.id, h]);
  const { rows: [b2] } = await query(`insert into experience_bookings (offer_id, host_id, household_id, state) values ($1, $2, $3, 'confirmed') returning id`, [nowhere.id, host.id, h]);
  const { rows: [b3] } = await query(`insert into experience_bookings (offer_id, host_id, household_id, state) values ($1, $2, $3, 'pending') returning id`, [atPlace.id, host.id, h]);
  const v = await bookingVisit(h, b1.id);
  assert.equal(v.placeId, 'vq:hosted');
  assert.deepEqual(await bookingVisit(h, b1.id), v, 'one visit for the booking, however often it is looked at');
  const q = await pipeline.visitQuestion({ householdId: h, visitId: v.visitId });
  assert.equal(q.factId, 'vq-toddler-pool');
  assert.equal(await bookingVisit(h, b2.id), null, 'no place: V4');
  assert.equal(await bookingVisit(h, b3.id), null, 'never in: nothing to ask');
  const other = await household('VQ not mine');
  await assert.rejects(bookingVisit(other, b1.id), (e) => e.status === 404);
});

test('an offer keeps the place a host picked, and a clone keeps it too', async () => {
  const hosting = await import('../src/repositories/hosting.js');
  const { rows: [h] } = await query(`select id from host_profiles limit 1`).catch(() => ({ rows: [] }));
  if (!h) return; // no host fixture in this database
  const { rows: [o] } = await query(`insert into host_offers (host_id, shape, title, venue_ref) values ($1, 'one_off', 'VQ offer', 'osm:node/424242') returning *`, [h.id]).catch(() => ({ rows: [] }));
  if (!o) return;
  const copy = await hosting.cloneOfferOnDate(o, '2026-12-01', null);
  assert.equal(copy.venue_ref, 'osm:node/424242');
  await query(`delete from host_offers where id = any($1)`, [[o.id, copy.id]]);
});
