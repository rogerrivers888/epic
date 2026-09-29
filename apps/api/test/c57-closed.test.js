/**
 * Every place has an open status (decision C57, owner, 29 Sep 2026).
 *
 * "A closed place is being listed: Windsor Safari Park (closed 1992, now
 * Legoland Windsor; its own 'What it is' text says so)."
 *
 * The readers are pinned both ways — each trap from the brief must *not*
 * close — then the check is run end to end over a Windsor fixture with a
 * stubbed Wikidata, and the family reads are shown to hide nothing until the
 * owner applies it, and to hide it after.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const S = await import('../src/domain/openStatus.js');
const repo = await import('../src/repositories/placeStatus.js');
const { runClosedCheck, onGoogleStatus } = await import('../src/sources/closedCheck.js');
const library = await import('../src/repositories/library.js');
test.after(() => pool.end());

const TODAY = '2026-09-29';
const snak = (id) => ({ snaktype: 'value', datavalue: { value: { id } } });
const time = (y) => ({ snaktype: 'value', datavalue: { value: { time: `+${y}-00-00T00:00:00Z` } } });
const claim = (mainsnak, extra = {}) => ({ rank: 'normal', mainsnak, ...extra });
const entity = (id, claims) => ({ id, claims });

// ---------------------------------------------------------------------------
// Wikidata
// ---------------------------------------------------------------------------

test('Wikidata: a dissolved date on a site closes it — Windsor Safari Park, P576 = 1992', () => {
  const v = S.wikidataVerdict(entity('Q8024695', { P31: [claim(snak('Q1711697'))], P576: [claim(time(1992))], P571: [claim(time(1969))] }), { today: TODAY });
  assert.equal(v.status, 'permanently_closed');
  assert.equal(v.review, false);
  assert.match(v.evidence, /Q8024695 P576 = 1992/);
});

test('Wikidata: a date of official closure still to come closes nothing yet', () => {
  assert.equal(S.wikidataVerdict(entity('Q1', { P31: [claim(snak('Q33506'))], P3999: [claim(time(2031))] }), { today: TODAY }), null);
  const past = S.wikidataVerdict(entity('Q1', { P31: [claim(snak('Q33506'))], P3999: [claim(time(2019))] }), { today: TODAY });
  assert.equal(past.status, 'permanently_closed');
});

test('Wikidata trap: P576 on an organisation is the body ending, not the site — review, never closed', () => {
  const v = S.wikidataVerdict(entity('Q2', { P31: [claim(snak('Q4830453'))], P576: [claim(time(2008))] }), { today: TODAY });
  assert.equal(v.status, 'unknown');
  assert.equal(v.review, true);
});

test('Wikidata trap: P1366 alone (a renamed place that is still open carries it too) names a successor and asks a person', () => {
  const v = S.wikidataVerdict(entity('Q3', { P31: [claim(snak('Q33506'))], P1366: [claim(snak('Q99'))] }), { today: TODAY });
  assert.equal(v.status, 'unknown');
  assert.equal(v.review, true);
  assert.equal(v.successorQid, 'Q99');
  const closed = S.wikidataVerdict(entity('Q3', { P31: [claim(snak('Q33506'))], P576: [claim(time(2001))], P1366: [claim(snak('Q99'))] }), { today: TODAY });
  assert.equal(closed.status, 'permanently_closed');
  assert.equal(closed.successorQid, 'Q99');
});

test('Wikidata: every kind ended closes; one kind still current is a conversion and says nothing', () => {
  const ended = { qualifiers: { P582: [time(2010)] } };
  assert.equal(S.wikidataVerdict(entity('Q4', { P31: [claim(snak('Q33506'), ended)] }), { today: TODAY }).status, 'permanently_closed');
  assert.equal(S.wikidataVerdict(entity('Q4', { P31: [claim(snak('Q185113'), ended), claim(snak('Q33506'))] }), { today: TODAY }), null);
});

test('Wikidata: state of use — closed closes, in use is open, closed and reopened goes to review', () => {
  assert.equal(S.wikidataVerdict(entity('Q5', { P5817: [claim(snak('Q104664889'))] })).status, 'permanently_closed');
  assert.equal(S.wikidataVerdict(entity('Q5', { P5817: [claim(snak('Q56651571'))] })).status, 'temporarily_closed');
  assert.equal(S.wikidataVerdict(entity('Q5', { P5817: [claim(snak('Q55654238'))] })).status, 'open');
  const both = S.wikidataVerdict(entity('Q5', { P576: [claim(time(1990))], P5817: [claim(snak('Q55654238'))] }), { today: TODAY });
  assert.equal(both.status, 'unknown');
  assert.equal(both.review, true);
  // A state that has itself ended is history, not the present.
  assert.equal(S.wikidataVerdict(entity('Q5', { P5817: [claim(snak('Q104664889'), { qualifiers: { P582: [time(2015)] } })] })), null);
  // Nothing at all: cannot speak.
  assert.equal(S.wikidataVerdict(entity('Q5', { P31: [claim(snak('Q33506'))] })), null);
  assert.equal(S.wikidataVerdict(null), null);
});

test('Wikidata description: "defunct" closes, "former" only asks — Bodmin Jail is a "former prison" you can visit', () => {
  const d = (en) => ({ id: 'Q7', claims: { P31: [claim(snak('Q194195'))] }, descriptions: { en: { language: 'en', value: en } } });
  assert.equal(S.wikidataVerdict(d('defunct amusement park in Staffordshire')).status, 'permanently_closed');
  const former = S.wikidataVerdict(d('former British amusement park'));
  assert.equal(former.status, 'unknown');
  assert.equal(former.review, true);
  assert.equal(S.wikidataVerdict(d('former prison, now a museum')), null);
  assert.equal(S.wikidataVerdict(d('theme park in Windsor, Berkshire')), null);
});

test('Wikidata: an end time still to come is current (Codex) — both ways, on P31 and on P5817', () => {
  const until = (y) => ({ qualifiers: { P582: [time(y)] } });
  // Every kind ends in 2031: still what it is today.
  assert.equal(S.wikidataVerdict(entity('Q8', { P31: [claim(snak('Q33506'), until(2031))] }), { today: TODAY }), null);
  // …and in 2019: over.
  assert.equal(S.wikidataVerdict(entity('Q8', { P31: [claim(snak('Q33506'), until(2019))] }), { today: TODAY }).status, 'permanently_closed');
  // "Permanently closed" as a state that itself ends in 2031 has not ended: it is today's state.
  assert.equal(S.wikidataVerdict(entity('Q8', { P5817: [claim(snak('Q104664889'), until(2031))] }), { today: TODAY }).status, 'permanently_closed');
  // "In use" until 2019 is history, not today: it says nothing.
  assert.equal(S.wikidataVerdict(entity('Q8', { P5817: [claim(snak('Q55654238'), until(2019))] }), { today: TODAY }), null);
  // "In use" until 2031 is current.
  assert.equal(S.wikidataVerdict(entity('Q8', { P5817: [claim(snak('Q55654238'), until(2031))] }), { today: TODAY }).status, 'open');
});

// ---------------------------------------------------------------------------
// OpenStreetMap
// ---------------------------------------------------------------------------

test('OSM: a lifecycle prefix with nothing current closes', () => {
  assert.equal(S.osmVerdict({ 'disused:amenity': 'pub', name: 'The Bell' }).status, 'permanently_closed');
  assert.equal(S.osmVerdict({ 'was:tourism': 'theme_park' }).status, 'permanently_closed');
  assert.equal(S.osmVerdict({ 'demolished:building': 'yes', 'demolished:amenity': 'cinema' }).status, 'permanently_closed');
  assert.equal(S.osmVerdict({ amenity: 'pub', disused: 'yes' }).status, 'permanently_closed');
  assert.equal(S.osmVerdict({ shop: 'vacant' }).status, 'permanently_closed');
  assert.equal(S.osmVerdict({ tourism: 'attraction', end_date: '2019' }, { today: TODAY }).status, 'permanently_closed');
  assert.equal(S.osmVerdict({ tourism: 'museum', opening_hours: 'closed' }).status, 'temporarily_closed');
  assert.equal(S.osmVerdict({ 'was:amenity': 'cinema', replaced_by: 'Odeon Luxe' }).successorName, 'Odeon Luxe');
});

test('OSM trap: disused:shop on a building whose current use is tagged is open', () => {
  const v = S.osmVerdict({ 'disused:shop': 'butcher', amenity: 'cafe', building: 'retail' });
  assert.equal(v.status, 'open');
  assert.equal(S.osmVerdict({ historic: 'castle', ruins: 'yes' }).status, 'open', 'a ruin you can walk round is open');
  assert.equal(S.osmVerdict({ building: 'yes' }), null, 'a building alone says nothing about use');
  assert.equal(S.osmVerdict(null), null);
});

// ---------------------------------------------------------------------------
// Wikipedia and other owned prose
// ---------------------------------------------------------------------------

const WINDSOR = 'Windsor Safari Park was a family theme park and safari park on the outskirts of Windsor, Berkshire. It opened in 1969 and closed in 1992. The site is now Legoland Windsor.';

test('Wikipedia: the Windsor fixture — closed in 1992, now Legoland Windsor', () => {
  const v = S.wikipediaVerdict({ text: WINDSOR, name: 'Windsor Safari Park' });
  assert.equal(v.status, 'permanently_closed');
  assert.equal(v.review, false);
  assert.equal(v.successorName, 'Legoland Windsor');
});

test('Wikipedia: the text production actually holds — "was a … converted into the site of Legoland Windsor" closes', () => {
  const held = "Windsor Safari Park was a safari park built on St Leonard's Hill on the outskirts of the town of Windsor in Berkshire, England; it has since been converted into the site of Legoland Windsor. Billed as \"The African Adventure\", the park included drive-through animal enclosures.";
  const v = S.wikipediaVerdict({ text: held, name: 'Windsor Safari Park' });
  assert.equal(v.status, 'permanently_closed');
  assert.equal(v.successorName, 'Legoland Windsor');
});

test('Wikipedia traps: "it was a great day", "Windsor Castle was built", "converted into a museum" do not close', () => {
  assert.equal(S.wikipediaVerdict({ text: 'Windsor Castle is a royal residence. It was a great day for the town when it opened.', name: 'Windsor Castle' }), null);
  assert.equal(S.wikipediaVerdict({ text: 'Windsor Castle was built in the 11th century after the Norman invasion. It is a royal residence.', name: 'Windsor Castle' }), null);
  assert.equal(S.wikipediaVerdict({ text: 'Quarry Bank is an 18th-century cotton mill. In 1978 the mill was converted into a museum, which is open daily.', name: 'Quarry Bank Mill' }), null);
  assert.equal(S.successorFromText('the mill was converted into a museum'), null, 'a new use in lower case is not a successor');
});

test('Listed-building trap: "formerly a church, now a house" is a place that stands', () => {
  assert.equal(S.wikipediaVerdict({ text: 'The Old Chapel is a Grade II listed building, formerly a church, now a house.', name: 'The Old Chapel', source: 'listing' }), null);
  assert.equal(S.wikipediaVerdict({ text: 'St Mary\'s is a former church, now an arts centre.', name: "St Mary's" }), null);
});

test('Wikipedia: a bare past tense is a hunch — flagged for review, never closed', () => {
  const v = S.wikipediaVerdict({ text: 'Blue Lagoon Park was a leisure park near Swindon. It had a boating lake.', name: 'Blue Lagoon Park' });
  assert.equal(v.status, 'unknown');
  assert.equal(v.review, true);
  // …with a present-tense continuation it is not even a hunch.
  assert.equal(S.wikipediaVerdict({ text: 'Kew Gardens was a royal estate and is now a botanic garden.', name: 'Kew Gardens' }), null);
  // …and "until 1992" is explicit.
  assert.equal(S.wikipediaVerdict({ text: 'Blue Lagoon Park was a leisure park near Swindon until 1992.', name: 'Blue Lagoon Park' }).status, 'permanently_closed');
});

test('Wikipedia: closed and reopened goes to review; closed on Mondays is not closed', () => {
  const v = S.wikipediaVerdict({ text: 'The Lido closed in 1989. It reopened in 2006 after restoration.', name: 'Brockwell Lido' });
  assert.equal(v.status, 'unknown');
  assert.equal(v.review, true);
  assert.equal(S.wikipediaVerdict({ text: 'The museum is closed on Mondays.', name: 'Town Museum' }), null);
  assert.equal(S.wikipediaVerdict({ text: 'The railway station nearby closed in 1965.', name: 'Hever Castle' }), null, 'something else closing is not this place closing');
});

test('Wikipedia categories: Defunct closes, a disestablishment alone only flags, beside a past tense it closes', () => {
  assert.equal(S.wikipediaVerdict({ text: '', name: 'X', categories: ['Defunct amusement parks in England'] }).status, 'permanently_closed');
  const alone = S.wikipediaVerdict({ text: 'X Park is a park.', name: 'X Park', categories: ['1992 disestablishments in England'] });
  assert.equal(alone.review, true);
  const both = S.wikipediaVerdict({ text: 'X Park was a safari park in Berkshire.', name: 'X Park', categories: ['1992 disestablishments in England'] });
  assert.equal(both.status, 'permanently_closed');
});

// ---------------------------------------------------------------------------
// Google, combining, confirming, hiding
// ---------------------------------------------------------------------------

test('Google: status mapped to our flag only; unspecified cannot speak', () => {
  assert.equal(S.googleVerdict('CLOSED_PERMANENTLY').status, 'permanently_closed');
  assert.equal(S.googleVerdict('CLOSED_TEMPORARILY').status, 'temporarily_closed');
  assert.equal(S.googleVerdict('OPERATIONAL').status, 'open');
  assert.equal(S.googleVerdict('BUSINESS_STATUS_UNSPECIFIED'), null);
  assert.equal(S.googleVerdict(undefined), null);
  assert.doesNotMatch(S.googleVerdict('CLOSED_PERMANENTLY').evidence, /CLOSED_PERMANENTLY/, 'Google\'s own value is never the stored evidence');
});

test('combine: a person is final, Google outranks the encyclopedias, a real disagreement goes to review', () => {
  const wd = { source: 'wikidata', status: 'permanently_closed', reason: 'x', evidence: 'P576', review: false };
  const osmOpen = { source: 'osm', status: 'open', reason: 'in use', evidence: 'amenity=cafe', review: false };
  assert.equal(S.combine([wd]).status, 'permanently_closed');
  const split = S.combine([wd, osmOpen]);
  assert.equal(split.status, 'unknown');
  assert.equal(split.review, true);
  assert.equal(S.combine([wd, { source: 'google', status: 'open', reason: 'g', evidence: 'Google business status' }]).status, 'open');
  assert.equal(S.combine([{ source: 'google', status: 'open' }, { source: 'person', status: 'permanently_closed' }]).status, 'permanently_closed');
  assert.equal(S.combine([]).status, 'unknown', 'nothing found is unknown, never open');
});

test('confirmation: a Google id, a map match, a website or a census sighting — else unconfirmed', () => {
  assert.deepEqual(S.confirmation({ ref: 'google:ChIJx' }), { confirmed: true, by: 'google' });
  assert.equal(S.confirmation({ osmRef: '123' }).by, 'osm');
  assert.equal(S.confirmation({ website: 'https://legoland.co.uk' }).by, 'website');
  assert.equal(S.confirmation({ website: 'not a url' }).confirmed, false);
  assert.equal(S.confirmation({ censused: true }).by, 'census');
  assert.deepEqual(S.confirmation({ ref: 'atlas:1' }), { confirmed: false, by: null });
});

test('hides: nothing hides until applied', () => {
  assert.equal(S.hides({ status: 'permanently_closed', confirmed: true, applied: false }), false);
  assert.equal(S.hides({ status: 'permanently_closed', confirmed: true, applied: true }), true);
  assert.equal(S.hides({ status: 'unknown', confirmed: false, applied: true }), true);
  assert.equal(S.hides({ status: 'open', confirmed: true, applied: true }), false);
});

// ---------------------------------------------------------------------------
// end to end: the Windsor fixture
// ---------------------------------------------------------------------------

const REGION = 'c57-berkshire';
async function fixture() {
  await query(`delete from place_status where venue_ref like 'atlas:%' or venue_ref like 'google:c57%'`);
  await query(`delete from closed_checks`);
  await query(`delete from attractions where region_slug = $1`, [REGION]);
  await query(`insert into regions (slug, name, nation, kind) values ($1, 'Berkshire (C57)', 'England', 'county') on conflict (slug) do nothing`, [REGION]);
  const add = async (a) => (await query(
    `insert into attractions (region_slug, wikidata_id, name, slug, summary, summary_source, lat, lng, website, osm_ref, state, visiting)
     values ($1,$2,$3,$4,$5,'Wikipedia',$6,$7,$8,$9,'published','yes') returning id`,
    [REGION, a.qid, a.name, a.slug, a.summary, a.lat, a.lng, a.website ?? null, a.osm ?? null])).rows[0].id;
  const safari = await add({ qid: 'Q8024695', name: 'Windsor Safari Park', slug: 'windsor-safari-park', summary: WINDSOR, lat: 51.4644, lng: -0.64967 });
  const lego = await add({ qid: 'Q3047891', name: 'Legoland Windsor', slug: 'legoland-windsor', summary: 'Legoland Windsor Resort is a theme park in Windsor, Berkshire.', lat: 51.4635, lng: -0.65114, website: 'https://www.legoland.co.uk/' });
  // Known to Wikidata alone, open by every reading, and confirmed by nothing current.
  const lonely = await add({ qid: 'Q900001', name: 'Hidden Folly', slug: 'hidden-folly', summary: 'Hidden Folly is a folly in Berkshire.', lat: 51.45, lng: -0.6 });
  return { safari, lego, lonely };
}
const claims = new Map([
  ['Q8024695', entity('Q8024695', { P31: [claim(snak('Q1711697'))], P576: [claim(time(1992))] })],
  ['Q3047891', entity('Q3047891', { P31: [claim(snak('Q2416723'))] })],
  ['Q900001', entity('Q900001', { P31: [claim(snak('Q622852'))] })],
]);

test('the check over the Windsor fixture: closed with a successor, unconfirmed flagged, nothing hidden until applied', async () => {
  const { safari, lego, lonely } = await fixture();
  const asked = [];
  const out = await runClosedCheck({ by: 'test', today: TODAY, fetchClaims: async (ids) => { asked.push(...ids); return new Map(ids.filter((q) => claims.has(q)).map((q) => [q, claims.get(q)])); } });
  assert.ok(asked.includes('Q8024695'));
  assert.equal(out.wikidataUnread, 0);

  const windsor = await repo.statusFor(`atlas:${safari}`);
  assert.equal(windsor.status, 'permanently_closed');
  assert.equal(windsor.source, 'wikidata', 'Wikidata outranks the prose when both say closed');
  assert.equal(windsor.successor.ref, 'wikidata:Q3047891', 'the ref a family screen opens Legoland by');
  const { rows: [stored] } = await query(`select successor_ref from place_status where venue_ref = $1`, [`atlas:${safari}`]);
  assert.equal(stored.successor_ref, `atlas:${lego}`);
  assert.equal(windsor.successor.name, 'Legoland Windsor');
  assert.equal(windsor.confirmed, false, 'no Google id, no map match, no website, no census');
  assert.equal(windsor.applied, false);
  assert.equal(windsor.hidden, false);

  assert.equal(await repo.statusFor(`atlas:${lego}`), null, 'open with a website and nothing to say: no row');
  const folly = await repo.statusFor(`atlas:${lonely}`);
  assert.equal(folly.confirmed, false);
  assert.equal(folly.status, 'unknown');

  // Before the owner's OK, a family sees everything.
  const before = (await library.publishedFor(REGION)).map((r) => r.name).sort();
  assert.deepEqual(before, ['Hidden Folly', 'Legoland Windsor', 'Windsor Safari Park']);

  const rep = await repo.report();
  assert.equal(rep.totals.would_hide, 2);
  assert.equal(rep.totals.hidden_now, 0);
  assert.equal(rep.examples[0].name, 'Windsor Safari Park', 'the case that started it leads the examples');
  assert.equal(rep.examples[0].successor.name, 'Legoland Windsor');

  const applied = await repo.applyProposed({ by: 'test' });
  assert.equal(applied.applied, 2);
  const after = (await library.publishedFor(REGION)).map((r) => r.name);
  assert.deepEqual(after, ['Legoland Windsor']);
  const near = (await library.publishedNear({ lat: 51.46, lng: -0.65, km: 10 })).map((r) => r.name);
  assert.ok(near.includes('Legoland Windsor'));
  assert.ok(!near.includes('Windsor Safari Park'));
  assert.ok(!near.includes('Hidden Folly'));
  await library.refreshRegionCounts(REGION);
  const { rows: [reg] } = await query(`select published_count from regions where slug = $1`, [REGION]);
  assert.equal(Number(reg.published_count), 1);

  // A re-harvest that brings Windsor Safari Park back as a new row is still closed.
  await query(`insert into regions (slug, name, nation, kind) values ('c57-surrey', 'Surrey (C57)', 'England', 'county') on conflict (slug) do nothing`);
  await query(`insert into attractions (region_slug, wikidata_id, name, slug, lat, lng, state, visiting)
               values ('c57-surrey', 'Q8024695', 'Windsor Safari Park', 'windsor-safari-park', 51.4644, -0.64967, 'published', 'yes')`);
  assert.deepEqual((await library.publishedFor('c57-surrey')).map((r) => r.name), [], 'kept, so it is never re-added');
  await query(`delete from attractions where region_slug = 'c57-surrey'`);
});

test('a place that comes to hide more waits for the OK again; one that comes back needs nobody', async () => {
  const ref = 'google:c57-cafe';
  await repo.propose({ ref, status: 'temporarily_closed', source: 'osm', reason: 'hours', evidence: 'opening_hours=closed' });
  await repo.applyProposed({ by: 'test' });
  assert.equal((await repo.hiddenAmong([ref])).has(ref), true);
  await repo.propose({ ref, status: 'permanently_closed', source: 'wikidata', reason: 'dissolved 2020', evidence: 'P576' });
  assert.equal((await repo.statusFor(ref)).applied, true, 'still hidden, now for a firmer reason: no new OK needed');
  await repo.propose({ ref, status: 'open', source: 'osm', reason: 'in use', evidence: 'amenity=cafe' });
  assert.equal((await repo.hiddenAmong([ref])).has(ref), false, 'reopened: shows at once');
  await repo.propose({ ref, status: 'permanently_closed', source: 'osm', reason: 'disused', evidence: 'disused=yes' });
  assert.equal((await repo.statusFor(ref)).applied, false, 'newly closed again: waits for the owner');
  assert.equal((await repo.hiddenAmong([ref])).has(ref), false);
});

test('Google status: the drawer hook writes only our flag, and a person is never overwritten', async () => {
  const ref = 'google:c57-shut';
  await onGoogleStatus(ref, 'CLOSED_PERMANENTLY');
  const row = (await query(`select * from place_status where venue_ref = $1`, [ref])).rows[0];
  assert.equal(row.status, 'permanently_closed');
  assert.equal(row.source, 'google');
  assert.ok(!JSON.stringify(row).includes('CLOSED_PERMANENTLY'), 'Google\'s value is not stored');
  await onGoogleStatus(ref, 'BUSINESS_STATUS_UNSPECIFIED');
  assert.equal((await repo.statusFor(ref)).status, 'permanently_closed', 'cannot speak: nothing changes');

  await repo.setByPerson(ref, { status: 'open', by: 'owner' });
  await onGoogleStatus(ref, 'CLOSED_PERMANENTLY');
  const kept = await repo.statusFor(ref);
  assert.equal(kept.status, 'open');
  assert.equal(kept.source, 'person');
});

test('a Wikidata batch that fails is unread, never "no closure"', async () => {
  await fixture();
  const out = await runClosedCheck({ by: 'test', today: TODAY, fetchClaims: async () => { throw new Error('429'); } });
  assert.equal(out.wikidataRead, 0);
  assert.ok(out.wikidataUnread >= 3);
  // The prose still speaks for Windsor on its own.
  const { rows } = await query(`select s.status, s.source from place_status s join attractions a on 'atlas:' || a.id::text = s.venue_ref where a.name = 'Windsor Safari Park' and a.region_slug = $1`, [REGION]);
  assert.equal(rows[0].status, 'permanently_closed');
  assert.equal(rows[0].source, 'wikipedia');
});

test('the shared predicate: SHOWN_REF and SHOWN_ATTRACTION read the same rows', async () => {
  const ref = 'google:c57-pred';
  await repo.applyProposed({ by: 'test' });
  await repo.propose({ ref, status: 'permanently_closed', source: 'person', applied: true, appliedBy: 'test' });
  const { rows } = await query(`select $1::text as r where ${repo.SHOWN_REF('$1::text')}`, [ref]);
  assert.equal(rows.length, 0);
  const { rows: open } = await query(`select $1::text as r where ${repo.SHOWN_REF('$1::text')}`, ['google:c57-other']);
  assert.equal(open.length, 1);
  const { rows: w } = await query(`select 1 from place_status s where s.wikidata_id = 'Q8024695' and ${repo.HIDING}`);
  assert.ok(w.length >= 1, 'the Wikidata id travels with the row');
  assert.equal((await repo.hiddenAmong(['wikidata:Q8024695'])).has('wikidata:Q8024695'), true, 'the Inspire fallback\'s wikidata: refs are matched too');
});

test('a Google result matched to a closed atlas row is hidden under its Google id (Codex)', async () => {
  const { safari } = await fixture();
  await query(`delete from provider_matches where venue_ref in ('wikidata:Q8024695', 'wikidata:Q900001')`);
  await query(`insert into provider_matches (venue_ref, source, source_ref, confidence) values ('wikidata:Q8024695', 'google', 'ChIJ_c57_safari', 0.9)`);
  await repo.propose({ ref: `atlas:${safari}`, wikidataId: 'Q8024695', status: 'permanently_closed', confirmed: false, source: 'wikidata', reason: 'dissolved 1992', evidence: 'P576' });
  assert.equal((await repo.hiddenAmong(['google:ChIJ_c57_safari'])).size, 0, 'nothing hides before the OK');
  await repo.applyProposed({ by: 'test' });
  const hidden = await repo.hiddenAmong(['google:ChIJ_c57_safari', 'google:ChIJ_c57_open', 'wikidata:Q8024695']);
  assert.ok(hidden.has('google:ChIJ_c57_safari'), 'the JS form resolves the alias');
  assert.ok(hidden.has('wikidata:Q8024695'));
  assert.ok(!hidden.has('google:ChIJ_c57_open'));
  const { rows } = await query(`select r from unnest($1::text[]) r where ${repo.SHOWN_REF('r')}`, [['google:ChIJ_c57_safari', 'google:ChIJ_c57_open']]);
  assert.deepEqual(rows.map((x) => x.r), ['google:ChIJ_c57_open'], 'the SQL form resolves it too');

  // The other way: a Google status closes the Google id, and the atlas row it
  // is matched to (drawn on Inspire by its Wikidata id) goes with it.
  await query(`insert into provider_matches (venue_ref, source, source_ref, confidence) values ('wikidata:Q900001', 'google', 'ChIJ_c57_folly', 0.9)`);
  await repo.propose({ ref: 'google:ChIJ_c57_folly', status: 'permanently_closed', source: 'google', reason: 'g', evidence: 'Google business status' });
  await repo.applyProposed({ by: 'test' });
  assert.ok((await repo.hiddenAmong(['wikidata:Q900001'])).has('wikidata:Q900001'));
  await query(`update place_status set confirmed = true, status = 'unknown' where venue_ref like 'atlas:%'`);
  assert.ok(!(await library.publishedFor(REGION)).some((r) => r.name === 'Hidden Folly'), 'the atlas row is hidden through the Google match');
  await query(`delete from provider_matches where source_ref like 'ChIJ_c57_%'`);
});

test('Places suggest: a hidden Google prediction is not offered by name; the household\'s own saved place still is (Codex)', async () => {
  const express = (await import('express')).default;
  const { places } = await import('../src/routes/places.js');
  const { googleSource } = await import('../src/sources/google.js');
  const { runAsAccount } = await import('../src/context.js');
  const { household } = await aHousehold(query, 'c57 suggest');
  const { rows: [account] } = await query(
    `insert into accounts (household_id, email, name, role, plan, status) values ($1, $2, 'c57', 'customer', 'trial', 'active') returning *`,
    [household.id, `c57-${Date.now()}@example.com`]);
  await query(`insert into household_places (household_id, venue_ref, label, category) values ($1, 'google:ChIJ_c57_mine', 'Safari Lodge Cafe', 'cafe')`, [household.id]);
  await repo.propose({ ref: 'google:ChIJ_c57_gone', status: 'permanently_closed', source: 'google', reason: 'g', evidence: 'Google business status' });
  await repo.propose({ ref: 'google:ChIJ_c57_mine', status: 'permanently_closed', source: 'google', reason: 'g', evidence: 'Google business status' });
  await repo.applyProposed({ by: 'test' });

  const real = googleSource.suggest;
  googleSource.suggest = async () => [
    { placeId: 'ChIJ_c57_gone', name: 'Safari Park Windsor', types: ['amusement_park'] },
    { placeId: 'ChIJ_c57_here', name: 'Safari Zoo', types: ['zoo'] },
  ];
  const app = express();
  app.use((req, _res, next) => runAsAccount(account, next));
  app.use('/api/places', places);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/places/suggest?q=safari&kind=all`);
    const body = await res.json();
    const refs = body.suggestions.map((x) => x.venueRef);
    assert.ok(refs.includes('google:ChIJ_c57_here'));
    assert.ok(!refs.includes('google:ChIJ_c57_gone'), 'a closed place cannot be found by name');
    assert.ok(refs.includes('google:ChIJ_c57_mine'), 'somewhere the household saved stays theirs');
  } finally {
    googleSource.suggest = real;
    server.close();
  }
});
