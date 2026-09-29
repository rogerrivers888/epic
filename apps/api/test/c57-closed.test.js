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
  // end_date is not read any more (owner, 29 Sep 2026): the V&A carries end_date=1862.
  assert.equal(S.osmVerdict({ tourism: 'museum', end_date: '1862', name: 'Victoria and Albert Museum' }).status, 'open');
  // opening_hours=closed is a question for a person, not a closure — a Sun in the Wood.
  const shut = S.osmVerdict({ amenity: 'pub', name: 'Sun in the Wood', opening_hours: 'closed' });
  assert.equal(shut.status, 'unknown');
  assert.equal(shut.review, true);
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
  // Unconfirmed never hides (owner, 29 Sep 2026): only a closure does.
  assert.equal(S.hides({ status: 'unknown', confirmed: false, applied: true }), false);
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
  const out = await runClosedCheck({ by: 'test', superclasses: async () => new Map(), today: TODAY, fetchClaims: async (ids) => { asked.push(...ids); return new Map(ids.filter((q) => claims.has(q)).map((q) => [q, claims.get(q)])); } });
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
  assert.equal(rep.totals.would_hide, 1, 'the closure only: an unconfirmed place is not hidden');
  assert.equal(rep.closedTotal, 1);
  assert.equal(rep.byReasonAgrees, true);
  assert.ok(rep.unconfirmedTotal >= 1, 'counted in its own section');
  assert.equal(rep.totals.hidden_now, 0);
  assert.equal(rep.examples[0].name, 'Windsor Safari Park', 'the case that started it leads the examples');
  assert.equal(rep.examples[0].successor.name, 'Legoland Windsor');

  const applied = await repo.applyProposed({ by: 'test' });
  assert.equal(applied.applied, 1);
  const after = (await library.publishedFor(REGION)).map((r) => r.name).sort();
  assert.deepEqual(after, ['Hidden Folly', 'Legoland Windsor'], 'unconfirmed stays visible; only the closure hides');
  const near = (await library.publishedNear({ lat: 51.46, lng: -0.65, km: 10 })).map((r) => r.name);
  assert.ok(near.includes('Legoland Windsor'));
  assert.ok(!near.includes('Windsor Safari Park'));
  assert.ok(near.includes('Hidden Folly'));
  await library.refreshRegionCounts(REGION);
  const { rows: [reg] } = await query(`select published_count from regions where slug = $1`, [REGION]);
  assert.equal(Number(reg.published_count), 2);

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
  const out = await runClosedCheck({ by: 'test', superclasses: async () => new Map(), today: TODAY, fetchClaims: async () => { throw new Error('429'); } });
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

test('Places suggest: a hidden place is not offered by name, whether Google\'s or the household\'s own (Codex; owner, 29 Sep 2026)', async () => {
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
    assert.ok(!refs.includes('google:ChIJ_c57_mine'), 'a closed saved place is not suggested either (owner, 29 Sep 2026)');

    // The closed lookup failing is "can't speak": no provider suggestion is
    // offered, and the household's own places still are (Codex).
    await query('alter table place_status rename to place_status_c57_away');
    try {
      const again = await (await fetch(`http://127.0.0.1:${server.address().port}/api/places/suggest?q=safari&kind=all`)).json();
      assert.deepEqual(again.suggestions, [], 'a lookup that cannot answer offers nothing');
    } finally {
      await query('alter table place_status_c57_away rename to place_status');
    }
  } finally {
    googleSource.suggest = real;
    server.close();
  }
});

test('a Google closure matched only to wikidata:Q… hides every name the atlas row goes by (Codex)', async () => {
  const { lonely } = await fixture();
  await query(`update attractions set osm_ref = '555001' where id = $1`, [lonely]);
  await query(`delete from provider_matches where source_ref like 'ChIJ_c57_%'`);
  await query(`insert into provider_matches (venue_ref, source, source_ref, confidence) values ('wikidata:Q900001', 'google', 'ChIJ_c57_only', 0.9)`);
  await repo.propose({ ref: 'google:ChIJ_c57_only', status: 'permanently_closed', source: 'google', reason: 'g', evidence: 'Google business status' });
  await repo.applyProposed({ by: 'test' });
  const names = ['google:ChIJ_c57_only', 'wikidata:Q900001', `atlas:${lonely}`, 'osm:relation/555001', 'osm:555001'];
  const hidden = await repo.hiddenAmong(names);
  for (const n of names) assert.ok(hidden.has(n), `${n} is hidden`);
  const { rows } = await query(`select r from unnest($1::text[]) r where ${repo.SHOWN_REF('r')}`, [[...names, 'osm:relation/1']]);
  assert.deepEqual(rows.map((x) => x.r), ['osm:relation/1'], 'the SQL form agrees');
  // A direct link under any of those names opens on the closure (Codex, third pass).
  for (const n of names) {
    const st = await repo.statusFor(n);
    assert.equal(st?.hidden, true, `${n} opens as hidden`);
    assert.equal(st?.status, 'permanently_closed');
  }
  assert.equal((await repo.statusFor('osm:relation/1'))?.hidden ?? false, false, 'an unrelated ref is not');
  await query(`delete from provider_matches where source_ref like 'ChIJ_c57_%'`);
});

// ---------------------------------------------------------------------------
// the owner's corrections after the first dry run (29 Sep 2026)
// ---------------------------------------------------------------------------

const ABBEY = 'Q160742'; const PRIORY = 'Q2750108'; const CHURCH = 'Q16970'; const RUINS = 'Q109607';

test('heritage: read from the kinds, the subclass roots, the atlas category, our drawer or a listing', () => {
  assert.equal(S.heritageOf({ kinds: [ABBEY] }).heritage, true);
  assert.equal(S.heritageOf({ kinds: ['Q999'], roots: ['Q23413'] }).heritage, true, 'a kind whose P279 root is castle');
  assert.equal(S.heritageOf({ category: 'heritage' }).heritage, true);
  assert.equal(S.heritageOf({ subcategory: 'castles' }).heritage, true);
  assert.equal(S.heritageOf({ listed: true }).heritage, true);
  assert.equal(S.heritageOf({ kinds: ['Q1711697'], category: 'animals' }).heritage, false, 'a safari park is not heritage');
  assert.deepEqual(S.heritageOf({ kinds: [CHURCH] }), { heritage: true, church: true });
  assert.equal(S.heritageOf({ kinds: [ABBEY, CHURCH] }).church, false, 'an abbey church: its dissolution is monastic history');
});

test('Selby Abbey: P576 1539 on an abbey that is an open church is open, the dissolution kept as history', () => {
  const kinds = [ABBEY, CHURCH];
  const site = S.heritageOf({ kinds });
  const wd = S.wikidataVerdict(entity('Q1394924', { P31: kinds.map((k) => claim(snak(k))), P576: [claim(time(1539))] }), { today: TODAY, site });
  assert.equal(wd.status, 'unknown');
  assert.equal(wd.history, true);
  assert.match(wd.reason, /^history: .*1539/);
  const v = S.combine([wd, S.osmVerdict({ amenity: 'place_of_worship', building: 'church', name: 'Selby Abbey' })]);
  assert.equal(v.status, 'open');
  // Without the map's word it is still not closed: the date stays history.
  const alone = S.combine([wd]);
  assert.equal(alone.status, 'unknown');
  assert.equal(alone.history, true);
});

test('Chacombe Priory: dissolution in the item and in the prose is history only', () => {
  const site = S.heritageOf({ kinds: [PRIORY, RUINS] });
  const wd = S.wikidataVerdict(entity('Q5066850', { P31: [claim(snak(PRIORY))], P576: [claim(time(1536))] }), { today: TODAY, site });
  const wp = S.wikipediaVerdict({ text: 'Chacombe Priory was an Augustinian priory in Northamptonshire. It was dissolved in 1536 and closed in 1536.', name: 'Chacombe Priory', site });
  assert.equal(wp.history, true);
  const v = S.combine([wd, wp]);
  assert.equal(v.status, 'unknown');
  assert.equal(v.review, false);
  assert.equal(v.history, true);
});

test('a redundant church converted to flats goes to a person; a church closed as a church does too', () => {
  const site = S.heritageOf({ kinds: [CHURCH] });
  const wd = S.wikidataVerdict(entity('Q7', { P31: [claim(snak(CHURCH))], P3999: [claim(time(1980))] }), { today: TODAY, site });
  assert.equal(wd.status, 'unknown');
  assert.equal(wd.review, true);
  const wp = S.wikipediaVerdict({ text: "St Mark's Church is a former church in Leeds. It closed in 1980 and was converted into flats.", name: "St Mark's Church", site });
  assert.equal(wp.review, true);
  assert.match(wp.reason, /private/);
  assert.equal(S.combine([wd, wp]).status, 'unknown');
  assert.equal(S.combine([wd, wp]).review, true);
});

test('a heritage site closes only on a current signal: nothing remains, or the map says so of the object itself', () => {
  const site = S.heritageOf({ kinds: ['Q23413'] });
  const gone = S.wikipediaVerdict({ text: 'Bolton Castle was a castle in Yorkshire. It was demolished in 1650 and nothing remains of it.', name: 'Bolton Castle', site });
  assert.equal(gone.status, 'permanently_closed');
  const stands = S.wikipediaVerdict({ text: 'Corfe Castle is a fortification. It was partly demolished in 1646; its ruins are open.', name: 'Corfe Castle', site });
  assert.notEqual(stands?.status, 'permanently_closed');
  const history = S.wikidataVerdict(entity('Q8', { P31: [claim(snak('Q23413'))], P576: [claim(time(1646))] }), { today: TODAY, site });
  const osm = S.osmVerdict({ 'demolished:historic': 'castle', 'demolished:building': 'yes', name: 'Gone Castle' });
  assert.equal(S.combine([history, osm]).status, 'permanently_closed');
});

test('OSM: a lifecycle tag counts only on the object itself, never on a route or an area', () => {
  assert.equal(S.isObjectItself({ building: 'yes', 'disused:amenity': 'pub' }), true);
  assert.equal(S.isObjectItself({ 'was:tourism': 'theme_park' }), true);
  assert.equal(S.isObjectItself({ type: 'route', route: 'hiking', 'disused:tourism': 'attraction' }), false);
  assert.equal(S.osmVerdict({ type: 'route', route: 'hiking', 'disused:tourism': 'attraction' }), null);
  assert.notEqual(S.osmVerdict({ landuse: 'recreation_ground', 'was:leisure': 'park' })?.status, 'permanently_closed');
  assert.notEqual(S.osmVerdict({ landuse: 'retail', disused: 'yes' })?.status, 'permanently_closed');
});

test('successors: "became X", "converted to X", "now X" — a use in lower case is not one', () => {
  assert.equal(S.successorFromText('In 1996 the park became Legoland Windsor.'), 'Legoland Windsor');
  assert.equal(S.successorFromText('The chapel was converted to Holloway Arts Centre in 1990.'), 'Holloway Arts Centre');
  assert.equal(S.successorFromText('The mill is now Riverside Studios.'), 'Riverside Studios');
  assert.equal(S.successorFromText('It became a museum in 1990.'), null);
});

test('the matching pass: one agreeing name inside the fence, or nothing', async () => {
  const { pickMatch, namesMatch, matchFenceM } = await import('../src/sources/closedCheck.js');
  const here = { name: 'Hidden Folly', lat: 51.45, lng: -0.6 };
  const at = (m) => ({ lat: 51.45 + m / 111_320, lng: -0.6 });
  assert.equal(pickMatch(here, [{ ref: 'node/1', name: 'Hidden Folly', tags: { name: 'Hidden Folly' }, ...at(80) }])?.ref, 'node/1');
  assert.equal(pickMatch(here, [{ ref: 'node/1', tags: { name: 'Hidden Folly' }, ...at(300) }]), null, 'a node is a point: 150 m');
  assert.equal(pickMatch(here, [{ ref: 'way/1', tags: { name: 'Hidden Folly' }, ...at(300) }])?.ref, 'way/1', 'a way is drawn at its centre: 400 m');
  assert.equal(pickMatch(here, [{ ref: 'node/1', tags: { name: 'Hidden Folly' }, ...at(20) }, { ref: 'node/2', tags: { name: 'Hidden Folly' }, ...at(40) }]), null, 'two that both match: fail closed');
  assert.equal(namesMatch('Windsor', 'Windsor Castle'), null);
  assert.equal(namesMatch('Selby Abbey', 'Selby Abbey Church'), 'name_agrees');
  assert.equal(matchFenceM('relation/5'), 400);
});

test('the check matches an unlinked atlas place to the open map, confirms it, and a missing Google match confirms nothing', async () => {
  const { lonely, safari } = await fixture();
  await query(`delete from atlas_osm_matches`);
  await query(`delete from provider_matches where venue_ref = 'wikidata:Q8024695'`);
  // Asked and nothing found: not a Google id (the first dry run read it as one).
  await query(`insert into provider_matches (venue_ref, source, source_ref, confidence, missing) values ('wikidata:Q8024695', 'google', '', 0, true)`);
  const near = async (lat, lng, _r, stems) => (stems.some((x) => /folly/i.test(x))
    ? [{ ref: 'way/777', name: 'Hidden Folly', lat: lat + 0.0005, lng, tags: { name: 'Hidden Folly', historic: 'folly', building: 'yes' } }] : []);
  const out = await runClosedCheck({ by: 'test', superclasses: async () => new Map(), today: TODAY, near, fetchClaims: async (ids) => new Map(ids.filter((q) => claims.has(q)).map((q) => [q, claims.get(q)])) });
  assert.ok(out.osmMatched >= 1);
  const { rows: [m] } = await query(`select osm_ref, how from atlas_osm_matches where attraction_id = $1`, [lonely]);
  assert.equal(m.osm_ref, 'way/777');
  assert.equal(m.how, 'same_name');
  const folly = await repo.statusFor(`atlas:${lonely}`);
  assert.ok(!folly || folly.confirmed, 'matched to the open map: confirmed');
  const windsor = await repo.statusFor(`atlas:${safari}`);
  assert.equal(windsor.confirmed, false, 'a Google match that found nothing is not a Google id');
  assert.equal(windsor.successor.name, 'Legoland Windsor');
  const rep = await repo.report();
  assert.ok(Array.isArray(rep.unconfirmedByCategory));
  assert.ok(rep.unconfirmedExamples.some((x) => x.name === 'Windsor Safari Park') || rep.examples.some((x) => x.name === 'Windsor Safari Park'));
  assert.equal(rep.examples[0].name, 'Windsor Safari Park');
  await query(`delete from provider_matches where venue_ref = 'wikidata:Q8024695'`);
});

// ---------------------------------------------------------------------------
// saved or visited places that close (owner, 29 Sep 2026)
// ---------------------------------------------------------------------------

test('a closed place stays in the saved list and history, marked, and is never added to a trip', async () => {
  const trips = await import('../src/routes/trips.js');
  const tripsRepo = await import('../src/repositories/trips.js');
  const atlasRepo = await import('../src/repositories/atlas.js');
  const { household } = await aHousehold(query, 'c57 saved');
  const shut = 'google:ChIJ_c57_saved_shut';
  const open = 'google:ChIJ_c57_saved_open';
  for (const [ref, label] of [[shut, 'The Old Mill'], [open, 'The New Mill']]) {
    await query(`insert into household_places (household_id, venue_ref, label, category, country_code, locality, lat, lng) values ($1, $2, $3, 'attraction', 'GB', 'Windsor', 51.46, -0.6)`, [household.id, ref, label]);
  }
  await repo.setByPerson(shut, { status: 'permanently_closed', by: 'test' });

  // Kept, and marked.
  const marks = await repo.hiddenStatusesOf([shut, open]);
  assert.equal(repo.closedBrief(marks.get(shut)).status, 'permanently_closed');
  assert.equal(marks.get(open), undefined);

  // Not suggested: the planner's reads leave it out.
  assert.deepEqual((await atlasRepo.placedPlaces(household.id)).map((r) => r.venue_ref), [open]);
  assert.ok(!(await atlasRepo.atlasForPrompt(household.id)).some((r) => r.label === 'The Old Mill'));

  // Not seeded into a new trip.
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date) values ($1, 'Windsor', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning *`, [household.id])).rows[0];
  await tripsRepo.seedShortlistFromAtlas(trip.id, household.id, 'GB', 'Windsor');
  assert.deepEqual((await tripsRepo.shortlistRefs(trip.id)).map(String).sort(), [open]);

  // Refused when a person tries: 409 closed.
  await assert.rejects(() => trips.addShortlistItem(trip, household, { venueRef: shut, venueLabel: 'The Old Mill' }), (e) => e.status === 409 && e.code === 'closed');
  // Epic's own suggestion of it is dropped quietly.
  await trips.addShortlistItem(trip, household, { venueRef: shut, venueLabel: 'The Old Mill', suggested: true });
  assert.ok(!(await tripsRepo.shortlistRefs(trip.id)).includes(shut));
  await tripsRepo.addAskedForPlace(trip.id, shut, 'The Old Mill', 51.46, -0.6, 'asked');
  assert.ok(!(await tripsRepo.shortlistRefs(trip.id)).includes(shut));
});

test('a kind our walk never filed is read up its P279 chain: a kind that descends from church building is a church', async () => {
  const { safari } = await fixture();
  // Selby Abbey's shape, with a kind nobody filed (its real one, Q5116872, is now named outright).
  await query(`update attractions set name = 'Selby Abbey', wikidata_id = 'Q1703400', kinds = '{Q999001}', summary = 'Selby Abbey is an Anglican parish church in Selby, North Yorkshire.' where id = $1`, [safari]);
  const selby = entity('Q1703400', { P31: [claim(snak('Q999001'))], P576: [claim(time(1539))] });
  const walked = [];
  await runClosedCheck({
    by: 'test', today: TODAY, near: async () => [],
    superclasses: async (kinds) => { walked.push(...kinds); return new Map([['Q999001', ['Q16970', 'Q317557']]]); },
    fetchClaims: async (ids) => new Map(ids.filter((q) => q === 'Q1703400' || claims.has(q)).map((q) => [q, q === 'Q1703400' ? selby : claims.get(q)])),
  });
  assert.ok(walked.includes('Q999001'));
  const s = await repo.statusFor(`atlas:${safari}`);
  assert.notEqual(s?.status, 'permanently_closed', 'the 1539 dissolution is history');
  assert.match(String(s?.reason), /^history:/);
});

test('a row an earlier check wrote on a rule that is gone is read again, not left standing', async () => {
  await fixture();
  await repo.propose({ ref: 'osm:way/c57-va', status: 'permanently_closed', source: 'osm', reason: 'ended 1862', evidence: 'end_date=1862' });
  await runClosedCheck({ by: 'test', today: TODAY, near: async () => [], superclasses: async () => new Map(), fetchClaims: async () => new Map() });
  const s = await repo.statusFor('osm:way/c57-va');
  assert.equal(s.status, 'unknown');
  assert.equal(s.reason, null);
});

test('an atlas row known to the open map only through the matching pass is hidden under that osm: ref too (Codex)', async () => {
  const { lonely } = await fixture();
  await query(`delete from atlas_osm_matches`);
  await query(`insert into atlas_osm_matches (attraction_id, osm_ref, osm_name, metres, how) values ($1, 'way/888', 'Hidden Folly', 20, 'same_name')`, [lonely]);
  await repo.setByPerson(`atlas:${lonely}`, { status: 'permanently_closed', by: 'test' });

  // Listed hidden under the matched name, in both the JS and the SQL forms.
  assert.ok((await repo.hiddenAmong(['osm:way/888'])).has('osm:way/888'));
  const { rows } = await query(`select r from unnest($1::text[]) r where ${repo.SHOWN_REF('r')}`, [['osm:way/888', 'osm:way/889']]);
  assert.deepEqual(rows.map((x) => x.r), ['osm:way/889']);

  // Refused on a trip under that name.
  const trips = await import('../src/routes/trips.js');
  await assert.rejects(() => trips.refuseClosed('osm:way/888'), (e) => e.status === 409 && e.code === 'closed');

  // A direct link opens on its closure: the drawer's own read.
  const s = await repo.statusFor('osm:way/888');
  assert.equal(s.hidden, true);
  assert.equal(s.status, 'permanently_closed');
  const express = (await import('express')).default;
  const { places } = await import('../src/routes/places.js');
  const { runAsAccount } = await import('../src/context.js');
  const { household } = await aHousehold(query, 'c57 osm drawer');
  const { rows: [account] } = await query(
    `insert into accounts (household_id, email, name, role, plan, status) values ($1, $2, 'c57', 'customer', 'trial', 'active') returning *`,
    [household.id, `c57-drawer-${Date.now()}@example.com`]);
  const app = express();
  app.use((req, _res, next) => runAsAccount(account, next));
  app.use('/api/places', places);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/places/detail?ref=${encodeURIComponent('osm:way/888')}`)).json();
    assert.equal(body.openStatus?.hidden, true);
    assert.equal(body.openStatus?.status, 'permanently_closed');
    assert.equal(body.venue, null);
  } finally { server.close(); }

  // The household's list says which kind of hidden it is.
  const marks = await repo.hiddenStatusesOf(['osm:way/888']);
  assert.equal(repo.closedBrief(marks.get('osm:way/888')).status, 'permanently_closed');
  await query(`delete from place_status where venue_ref = $1`, [`atlas:${lonely}`]);
  await query(`delete from atlas_osm_matches`);
});

test('the closed mark carries the status, so an unconfirmed place reads as that and not as closed', async () => {
  const brief = repo.closedBrief({ hidden: true, status: 'unknown', confirmed: false, successor: null });
  assert.deepEqual(brief, { status: 'unknown', confirmed: false, successor: null });
});

// ---------------------------------------------------------------------------
// round three: the owner's decisions after the second dry run (29 Sep 2026)
// ---------------------------------------------------------------------------

test('Deepdale and Vicarage Road: a category naming a former use asks a person, never closes', () => {
  const deepdale = S.wikipediaVerdict({
    text: 'Deepdale is a football stadium in the Deepdale area of Preston, England that is the home ground of Preston North End.',
    name: 'Deepdale', categories: ['Defunct rugby league venues in England', 'Football venues in England'],
  });
  assert.equal(deepdale.status, 'unknown');
  assert.equal(deepdale.review, true);
  const vicarage = S.wikipediaVerdict({
    text: 'Vicarage Road is a stadium in Watford, England, and is the home stadium of Championship club Watford.',
    name: 'Vicarage Road', categories: ['Defunct greyhound racing venues in London', 'Defunct rugby league venues in England'],
  });
  assert.equal(vicarage.status, 'unknown');
  assert.equal(vicarage.review, true);
  assert.equal(S.categoryIsFormerUse('Former churches in Leeds'), true);
  assert.equal(S.categoryIsFormerUse('Defunct tourist attractions in England'), false);
});

test('Bristol Zoo stays closed: the place itself ceased; a current source saying open sends it to a person', () => {
  const zoo = S.wikipediaVerdict({
    text: 'Bristol Zoo was a zoo in the city of Bristol in South West England.',
    name: 'Bristol Zoo', categories: ['2022 disestablishments in England', 'Defunct tourist attractions in England', 'Zoos disestablished in the 2020s'],
  });
  assert.equal(zoo.status, 'permanently_closed');
  assert.equal(S.combine([zoo]).status, 'permanently_closed');
  // …but an open-map element still tagged as a zoo, or Google operational, is a current word against it.
  const mapSaysOpen = S.combine([zoo, S.osmVerdict({ tourism: 'zoo', name: 'Bristol Zoo' })]);
  assert.equal(mapSaysOpen.status, 'unknown');
  assert.equal(mapSaysOpen.review, true);
  assert.equal(S.combine([zoo, S.googleVerdict('OPERATIONAL')]).status, 'open');
});

test('Geevor, Bitton and Hengoed: a mine, a station and a viaduct are heritage, and their closures are history', () => {
  // Geevor Tin Mine: P3999 1991, now a museum.
  const geevorSite = S.heritageOf({ kinds: ['Q115154402', 'Q819426', 'Q820477'] });
  assert.equal(geevorSite.heritage, true);
  const geevor = S.wikidataVerdict(entity('Q3314843', { P31: ['Q115154402', 'Q819426', 'Q820477'].map((k) => claim(snak(k))), P3999: [claim(time(1991))] }), { today: TODAY, site: geevorSite });
  assert.equal(geevor.status, 'unknown');
  assert.equal(geevor.history, true);
  // Bitton railway station: P5817 decommissioned — a heritage railway's station.
  const bittonSite = S.heritageOf({ kinds: ['Q55488'], subcategory: 'heritage-railways' });
  const bitton = S.wikidataVerdict(entity('Q4919146', { P31: [claim(snak('Q55488'))], P5817: [claim(snak('Q11639308'))] }), { today: TODAY, site: bittonSite });
  assert.equal(bitton.status, 'unknown');
  assert.equal(bitton.history, true);
  // Hengoed Viaduct: P5817 decommissioned, filed as a footbridge now.
  const hengoedSite = S.heritageOf({ kinds: ['Q1068842'] });
  const hengoed = S.wikidataVerdict(entity('Q17740151', { P31: [claim(snak('Q1068842'))], P5817: [claim(snak('Q11639308'))] }), { today: TODAY, site: hengoedSite });
  assert.equal(hengoed.status, 'unknown');
  assert.equal(hengoed.history, true);
  // Our drawers count too.
  assert.equal(S.heritageOf({ subcategory: 'heritage-railways' }).heritage, true);
  assert.equal(S.heritageOf({ kinds: ['Q999'], roots: ['Q181348'] }).heritage, true, 'a kind descending from viaduct');
});

test('Wikidata links a place to something current: its OSM relation, way or node id, and its official website', () => {
  const val = (v) => ({ snaktype: 'value', datavalue: { value: v } });
  assert.deepEqual(S.wikidataOsmRef({ claims: { P402: [claim(val('9976570'))] } }), { ref: 'relation/9976570', how: 'wikidata_p402' });
  assert.deepEqual(S.wikidataOsmRef({ claims: { P10689: [claim(val('33790963'))] } }), { ref: 'way/33790963', how: 'wikidata_p10689' });
  assert.deepEqual(S.wikidataOsmRef({ claims: { P11693: [claim(val('1924136691'))] } }), { ref: 'node/1924136691', how: 'wikidata_p11693' });
  assert.equal(S.wikidataOsmRef({ claims: {} }), null);
  assert.equal(S.wikidataWebsite({ claims: { P856: [claim(val('https://geevor.com/'))] } }), 'https://geevor.com/');
  assert.equal(S.wikidataWebsite({ claims: { P856: [claim(val('not a url'))] } }), null);
});

test('the check confirms through Wikidata\'s OSM id and website, and records which; unconfirmed is counted, not hidden', async () => {
  const { safari, lonely } = await fixture();
  await query(`delete from atlas_osm_matches`);
  const val = (v) => ({ snaktype: 'value', datavalue: { value: v } });
  const more = new Map(claims);
  more.set('Q900001', entity('Q900001', { P31: [claim(snak('Q622852'))], P402: [claim(val('555777'))] }));
  more.set('Q8024695', entity('Q8024695', { P31: [claim(snak('Q1711697'))], P576: [claim(time(1992))], P856: [claim(val('https://old.example/'))] }));
  const out = await runClosedCheck({
    by: 'test', today: TODAY, near: async () => [], superclasses: async () => new Map(),
    fetchClaims: async (ids) => new Map(ids.filter((q) => more.has(q)).map((q) => [q, more.get(q)])),
  });
  const { rows: [m] } = await query(`select osm_ref, how from atlas_osm_matches where attraction_id = $1`, [lonely]);
  assert.deepEqual([m.osm_ref, m.how], ['relation/555777', 'wikidata_p402']);
  assert.ok(out.confirmedBy.osm >= 1);
  const windsor = await repo.statusFor(`atlas:${safari}`);
  assert.equal(windsor.confirmed, true);
  assert.equal(windsor.confirmedBy, 'website', 'P856 is the venue website the rule accepts');
  assert.equal(windsor.status, 'permanently_closed');

  const rep = await repo.report();
  assert.equal(rep.byReasonSum, rep.closedTotal, 'every closed place is in exactly one reason');
  assert.equal(rep.byReasonAgrees, true);
  assert.ok(rep.byReason.every((r) => ['permanently_closed', 'temporarily_closed'].includes(r.hidden_as)), 'unconfirmed is not a reason to hide');
  await query(`delete from atlas_osm_matches`);
});

test('an applied unconfirmed place is shown and unmarked: only a closure hides', async () => {
  const ref = 'google:c57-unconfirmed-applied';
  await repo.propose({ ref, status: 'unknown', confirmed: false, source: null, reason: null, evidence: null, applied: true, appliedBy: 'test' });
  assert.equal((await repo.hiddenAmong([ref])).size, 0);
  const { rows } = await query(`select 1 from unnest($1::text[]) r where ${repo.SHOWN_REF('r')}`, [[ref]]);
  assert.equal(rows.length, 1);
  assert.equal(repo.closedBrief(await repo.statusFor(ref)), null, 'no "Closed" or "Not confirmed open" on a family screen');
  const trips = await import('../src/routes/trips.js');
  await trips.refuseClosed(ref);
});

// ---------------------------------------------------------------------------
// round four (owner, 29 Sep 2026): lines and piers, successor names, review
// that settles itself, and a count that shows only while it grows
// ---------------------------------------------------------------------------

test('Lynton and Barnstaple, a Ffestiniog-type line, a pier and a canal: their closures are history', () => {
  const decommissioned = claim(snak('Q11639308'));
  const lb = ['Q249556', 'Q420962', 'Q1112477'];
  const lbSite = S.heritageOf({ kinds: lb });
  assert.equal(lbSite.heritage, true);
  const lbV = S.wikidataVerdict(entity('Q1219708', { P31: lb.map((k) => claim(snak(k))), P5817: [decommissioned] }), { today: TODAY, site: lbSite });
  assert.equal(lbV.status, 'unknown');
  assert.equal(lbV.history, true);
  const ff = ['Q1112477', 'Q420962'];
  const ffV = S.wikidataVerdict(entity('Q1410337', { P31: ff.map((k) => claim(snak(k))), P3999: [claim(time(1946))], P5817: [decommissioned] }), { today: TODAY, site: S.heritageOf({ kinds: ff }) });
  assert.equal(ffV.history, true);
  const pierV = S.wikidataVerdict(entity('Q6273174', { P31: [claim(snak('Q863454'))], P3999: [claim(time(1986))] }), { today: TODAY, site: S.heritageOf({ kinds: ['Q863454'] }) });
  assert.equal(pierV.status, 'unknown');
  assert.equal(pierV.history, true);
  const canalV = S.wikidataVerdict(entity('Q1412795', { P31: [claim(snak('Q12284'))], P576: [claim(time(1951))] }), { today: TODAY, site: S.heritageOf({ kinds: ['Q12284'] }) });
  assert.equal(canalV.history, true);
  assert.equal(S.heritageOf({ kinds: ['Q110009982'] }).heritage, true, 'a tramway');
  assert.equal(S.heritageOf({ subcategory: 'piers' }).heritage, true);
});

test('a successor we do not hold is stored by its Wikidata label, and shown without a link', async () => {
  const { safari } = await fixture();
  const more = new Map(claims);
  more.set('Q8024695', entity('Q8024695', { P31: [claim(snak('Q1711697'))], P576: [claim(time(1992))], P1366: [claim(snak('Q999777'))] }));
  await query(`update attractions set summary = 'Windsor Safari Park was a safari park.' where id = $1`, [safari]);
  const asked = [];
  await runClosedCheck({
    by: 'test', today: TODAY, near: async () => [], superclasses: async () => new Map(),
    fetchClaims: async (ids) => new Map(ids.filter((q) => more.has(q)).map((q) => [q, more.get(q)])),
    fetchLabels: async (ids) => { asked.push(...ids); return new Map([['Q999777', 'Dalí Universe Two']]); },
  });
  assert.deepEqual(asked, ['Q999777'], 'only the successor we do not hold is asked');
  const s = await repo.statusFor(`atlas:${safari}`);
  assert.equal(s.successor.name, 'Dalí Universe Two');
  assert.equal(s.successor.ref, null, 'not held: a name, no link');
});

test('review never hides, applied or not', async () => {
  const ref = 'google:c57-review-visible';
  await repo.propose({ ref, status: 'unknown', review: true, source: 'wikipedia', reason: 'written in the past tense', evidence: 'x', applied: true, appliedBy: 'test' });
  assert.equal((await repo.hiddenAmong([ref])).size, 0);
  assert.equal(S.hides({ status: 'unknown', review: true, applied: true, confirmed: true }), false);
});

test('a family visit counts only after the evidence that made it a question', () => {
  // A year in the evidence: the visit must be after that year.
  assert.equal(S.familyVerdict({ visitedOn: '2026-09-20', evidence: 'Q7 P3999 = 1980', today: TODAY }).status, 'open');
  assert.equal(S.familyVerdict({ visitedOn: '1979-06-01', evidence: 'Q7 P3999 = 1980', today: TODAY }), null, 'a visit before the closure says nothing');
  // No year: after the day the check flagged it.
  assert.equal(S.familyVerdict({ visitedOn: '2026-09-20', evidence: 'written in the past tense', flaggedAt: '2026-09-10T08:00:00Z', today: TODAY }).status, 'open');
  assert.equal(S.familyVerdict({ visitedOn: '2026-09-05', evidence: 'written in the past tense', flaggedAt: '2026-09-10T08:00:00Z', today: TODAY }), null);
  // Nothing to measure against: cannot speak.
  assert.equal(S.familyVerdict({ visitedOn: '2026-09-20', evidence: 'written in the past tense', today: TODAY }), null);
  // A date in the future is not a visit.
  assert.equal(S.familyVerdict({ visitedOn: '2027-01-01', evidence: '1980', today: TODAY }), null);
});

test('review settles itself for one place: a family\'s later visit, then Google\'s status for the matched id', async () => {
  const { lonely } = await fixture();
  await query(`delete from atlas_osm_matches`);
  const more = new Map(claims);
  more.set('Q900001', { ...entity('Q900001', { P31: [claim(snak('Q622852'))] }), descriptions: { en: { value: 'former folly in Berkshire' } } });
  const stubs = {
    today: TODAY, near: async () => [], superclasses: async () => new Map(), fetchLabels: async () => new Map(),
    fetchClaims: async (ids) => new Map(ids.filter((q) => more.has(q)).map((q) => [q, more.get(q)])),
  };
  await runClosedCheck({ by: 'test', ...stubs });
  let s = await repo.statusFor(`atlas:${lonely}`);
  assert.equal(s.review, true, 'a "former" description is a question');
  // Nothing to re-judge for a place not in review.
  const { checkPlace } = await import('../src/sources/closedCheck.js');
  assert.equal(await checkPlace('google:c57-nothing', stubs), null);

  // The question was raised ten days ago; a family went after that.
  await query(`update place_status set review_since = now() - interval '10 days' where venue_ref = $1`, [`atlas:${lonely}`]);
  const { household } = await aHousehold(query, 'c57 visit');
  await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, 'wikidata:Q900001', 'Hidden Folly', current_date - 2)`, [household.id]);
  const out = await checkPlace('wikidata:Q900001', stubs);
  assert.ok(out, 'it was in review, so it was re-judged');
  assert.equal(out.checkId, null, 'no run is recorded for one place');
  s = await repo.statusFor(`atlas:${lonely}`);
  assert.equal(s.status, 'open');
  assert.equal(s.review, false);
  assert.equal(s.reason, 'a family went');
  await query(`delete from visits where household_id = $1`, [household.id]);

  // Put it back in question, then Google's details are fetched for its matched id.
  await runClosedCheck({ by: 'test', ...stubs });
  await query(`update place_status set review_since = now() where venue_ref = $1`, [`atlas:${lonely}`]);
  assert.equal((await repo.statusFor(`atlas:${lonely}`)).review, true);
  await query(`delete from provider_matches where venue_ref = 'wikidata:Q900001'`);
  await query(`insert into provider_matches (venue_ref, source, source_ref, confidence) values ('wikidata:Q900001', 'google', 'ChIJ_c57_folly_g', 0.9)`);
  await repo.noteGoogleStatus('google:ChIJ_c57_folly_g', S.googleVerdict('OPERATIONAL'));
  await checkPlace('wikidata:Q900001', stubs);
  s = await repo.statusFor(`atlas:${lonely}`);
  assert.equal(s.status, 'open');
  assert.equal(s.source, 'google');
  assert.equal(s.review, false);
  await query(`delete from provider_matches where venue_ref = 'wikidata:Q900001'`);
});

test('Google\'s status clears a question on its own id: operational opens it, closed closes it', async () => {
  const ref = 'google:c57-review-google';
  await repo.propose({ ref, status: 'unknown', review: true, source: 'wikipedia', reason: 'written in the past tense', evidence: 'x' });
  await onGoogleStatus(ref, 'OPERATIONAL');
  let s = await repo.statusFor(ref);
  assert.deepEqual([s.status, s.review, s.source], ['open', false, 'google']);
  await onGoogleStatus(ref, 'CLOSED_PERMANENTLY');
  s = await repo.statusFor(ref);
  assert.deepEqual([s.status, s.review], ['permanently_closed', false]);
  assert.equal(s.hidden, false, 'still waits for the owner to apply');
});

test('the Overview shows the review count only while it grows, and says nothing without a week of counts', async () => {
  const d = (day, review) => ({ day, review });
  assert.equal(repo.reviewGrowthLine([d('2026-09-29', 412)], '2026-09-29'), null, 'one day is not a week');
  assert.equal(repo.reviewGrowthLine([d('2026-09-29', 412), d('2026-09-25', 300)], '2026-09-29'), null, 'four days is not a week');
  const up = repo.reviewGrowthLine([d('2026-09-29', 412), d('2026-09-22', 384), d('2026-09-15', 500)], '2026-09-29');
  assert.equal(up.line, 'Closed-check review: 412, up 28 this week');
  assert.equal(repo.reviewGrowthLine([d('2026-09-29', 380), d('2026-09-22', 384)], '2026-09-29'), null, 'falling: nothing');
  assert.equal(repo.reviewGrowthLine([d('2026-09-29', 384), d('2026-09-22', 384)], '2026-09-29'), null, 'flat: nothing');
  assert.equal(repo.reviewGrowthLine([d('2026-09-29', 400), d('2026-09-20', 390)], '2026-09-29').since, '2026-09-20', 'the latest count at least a week old');
  const today = await repo.snapshotReview();
  assert.ok(today.day && Number.isInteger(today.review));
  const { overview } = await import('../src/desk/overview.js');
  const o = await overview().catch(() => null);
  assert.ok(o, 'the Overview answers');
  assert.equal(o.closedReview, null, 'no week of counts in a fresh database: nothing shown');
});

test('a question raised later than the row was decided is measured from when it was raised (Codex)', async () => {
  const ref = 'google:c57-late-question';
  // Decided unknown and not a question, twenty days ago…
  await repo.propose({ ref, status: 'unknown', review: false, source: 'wikipedia', reason: 'history: x', evidence: 'x' });
  await query(`update place_status set decided_at = now() - interval '20 days' where venue_ref = $1`, [ref]);
  let { rows: [row] } = await query(`select review_since, decided_at from place_status where venue_ref = $1`, [ref]);
  assert.equal(row.review_since, null, 'not a question: no date');
  // …then raised as a question today, with the same status: decided_at stays old.
  await repo.propose({ ref, status: 'unknown', review: true, source: 'wikipedia', reason: 'written in the past tense', evidence: 'x' });
  ({ rows: [row] } = await query(`select review_since, decided_at from place_status where venue_ref = $1`, [ref]));
  assert.ok(new Date(row.decided_at) < new Date(Date.now() - 19 * 86_400_000), 'decided_at did not move');
  assert.ok(new Date(row.review_since) > new Date(Date.now() - 60_000), 'review_since is when it was raised');
  // A visit ten days ago — after decided_at, before the question — does not settle it.
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(S.familyVerdict({ visitedOn: tenDaysAgo, evidence: 'written in the past tense', flaggedAt: row.review_since, today }), null);
  assert.ok(S.familyVerdict({ visitedOn: tenDaysAgo, evidence: 'written in the past tense', flaggedAt: row.decided_at, today }), 'measured from decided_at it would have — the bug');
  // Kept while it stays a question; cleared when it settles.
  const first = row.review_since;
  await repo.propose({ ref, status: 'unknown', review: true, source: 'wikipedia', reason: 'written in the past tense', evidence: 'x' });
  ({ rows: [row] } = await query(`select review_since from place_status where venue_ref = $1`, [ref]));
  assert.equal(new Date(row.review_since).getTime(), new Date(first).getTime());
  await repo.propose({ ref, status: 'open', review: false, source: 'osm', reason: 'in use', evidence: 'amenity=cafe' });
  ({ rows: [row] } = await query(`select review_since from place_status where venue_ref = $1`, [ref]));
  assert.equal(row.review_since, null);
});

test('checkPlace finds an atlas place by its open-map ref in either spelling (Codex)', async () => {
  const { osmSpellings, checkPlace } = await import('../src/sources/closedCheck.js');
  assert.deepEqual(osmSpellings('osm:relation/123'), ['relation/123', '123']);
  assert.deepEqual(osmSpellings('osm:123'), ['123', 'relation/123']);
  assert.deepEqual(osmSpellings('osm:way/5'), ['way/5']);
  const { safari, lonely } = await fixture();
  await query(`delete from atlas_osm_matches`);
  await query(`update attractions set osm_ref = '424242' where id = $1`, [safari]);
  await query(`insert into atlas_osm_matches (attraction_id, osm_ref, metres, how) values ($1, 'relation/515151', 0, 'wikidata_p402')`, [lonely]);
  // Both in review, so checkPlace has something to do.
  await repo.propose({ ref: `atlas:${safari}`, status: 'unknown', review: true, source: 'wikipedia', reason: 'q', evidence: 'q' });
  await repo.propose({ ref: `atlas:${lonely}`, status: 'unknown', review: true, source: 'wikipedia', reason: 'q', evidence: 'q' });
  const stubs = { today: TODAY, near: async () => [], superclasses: async () => new Map(), fetchLabels: async () => new Map(), fetchClaims: async () => new Map() };
  // The atlas's bare '424242', asked for as 'osm:relation/424242'.
  assert.ok(await checkPlace('osm:relation/424242', stubs), 'relation/N finds a bare N');
  // A match stored as 'relation/515151', asked for by the bare number.
  assert.ok(await checkPlace('osm:515151', stubs), 'a bare N finds relation/N on the match');
  assert.equal(await checkPlace('osm:relation/999999', stubs), null);
  await query(`delete from atlas_osm_matches`);
});

test('a family visit recorded under the other spelling of the open-map ref settles the review (Codex)', async () => {
  const { lonely } = await fixture();
  await query(`delete from atlas_osm_matches`);
  await query(`update attractions set osm_ref = '737373' where id = $1`, [lonely]);
  const more = new Map(claims);
  more.set('Q900001', { ...entity('Q900001', { P31: [claim(snak('Q622852'))] }), descriptions: { en: { value: 'former folly in Berkshire' } } });
  const stubs = {
    today: TODAY, near: async () => [], superclasses: async () => new Map(), fetchLabels: async () => new Map(),
    fetchClaims: async (ids) => new Map(ids.filter((q) => more.has(q)).map((q) => [q, more.get(q)])),
  };
  await runClosedCheck({ by: 'test', ...stubs });
  assert.equal((await repo.statusFor(`atlas:${lonely}`)).review, true);
  await query(`update place_status set review_since = now() - interval '10 days' where venue_ref = $1`, [`atlas:${lonely}`]);
  const { household } = await aHousehold(query, 'c57 osm spelling');
  // The atlas holds the bare '737373'; the family's visit was recorded as the relation.
  await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, 'osm:relation/737373', 'Hidden Folly', current_date - 2)`, [household.id]);
  const { checkPlace } = await import('../src/sources/closedCheck.js');
  await checkPlace('osm:relation/737373', stubs);
  const s = await repo.statusFor(`atlas:${lonely}`);
  assert.equal(s.status, 'open');
  assert.equal(s.review, false);
  await query(`delete from visits where household_id = $1`, [household.id]);
});
