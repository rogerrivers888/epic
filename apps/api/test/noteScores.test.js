/**
 * What a search paid for becomes a score that is ours to keep.
 *
 * The owner, 20 Sep 2026: "If I pay to look at the next 30 pubs and bars, we
 * should be converting it into our score, and from that moment on, that
 * location should always have a score."
 *
 * Two rules, and both are silent when they are wrong: a search that scores
 * nothing looks exactly like one that scores everything, and a rating written
 * to a column looks exactly like a band until somebody reads the table.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');

test.after(() => pool.end());

const REF = 'google:SCORE-ON-A-SEARCH';

test('a place a search returned comes out of it with a score of ours', async () => {
  await query('delete from place_records where venue_ref = $1', [REF]);
  const { scored } = await index.noteScores([
    { venueRef: REF, rating: 4.6, ratingCount: 2400, website: 'https://example.com' },
    // No rating: nothing to derive, so nothing is written rather than a nought.
    { venueRef: 'google:NO-RATING', rating: null, ratingCount: null },
  ]);
  assert.equal(scored, 1);

  const { rows } = await query(
    'select crowd_band, count_band, epic_score, scored_at, banded_at from place_records where venue_ref = $1', [REF]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].crowd_band, 'top');
  assert.equal(rows[0].count_band, 'thousands');
  assert.ok(Number(rows[0].epic_score) > 0, 'the score is ours and it is a number');
  assert.ok(rows[0].scored_at, 'and it says when it was worked out');

  // Nothing was written for the place that carried no rating.
  assert.equal((await query('select count(*)::int as n from place_records where venue_ref = $1', ['google:NO-RATING'])).rows[0].n, 0);
});

test('the rating itself is never written down', async () => {
  await query('delete from place_records where venue_ref = $1', [REF]);
  await index.noteScores([{ venueRef: REF, rating: 4.6, ratingCount: 2400 }]);
  const { rows: [row] } = await query('select * from place_records where venue_ref = $1', [REF]);
  // A timestamp is not a rating: 07:52:24.600Z contains "4.6" (26 Sep 2026).
  const said = Object.entries(row)
    .filter(([, v]) => v != null && !(v instanceof Date))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  assert.ok(!said.includes('4.6'), `a provider's rating is rented and must not be stored: ${said}`);
  assert.ok(!said.includes('2400'), `a provider's review count is rented and must not be stored: ${said}`);
});

test('scoring a place does not make it owned', async () => {
  await query('delete from place_records where venue_ref = $1', [REF]);
  await index.noteScores([{ venueRef: REF, rating: 4.6, ratingCount: 2400 }]);
  // `ownedRecordSql` is what decides Owned on every board; a judgement of ours
  // about somebody else's figures is not a fact we hold about the place.
  const { rows: [r] } = await query(
    `select (coalesce(summary, website, opening_hours, price_range, address, postcode, phone) is not null
             or accessibility <> '{}'::jsonb or curated_at is not null) as owned
       from place_records where venue_ref = $1`, [REF]);
  assert.equal(r.owned, false);
});

test('a second search moves the score on rather than leaving the first one', async () => {
  await query('delete from place_records where venue_ref = $1', [REF]);
  await index.noteScores([{ venueRef: REF, rating: 4.6, ratingCount: 2400 }]);
  const first = (await query('select epic_score from place_records where venue_ref = $1', [REF])).rows[0].epic_score;
  await index.noteScores([{ venueRef: REF, rating: 3.1, ratingCount: 40 }]);
  const second = (await query('select epic_score, crowd_band, count_band from place_records where venue_ref = $1', [REF])).rows[0];
  assert.ok(Number(second.epic_score) < Number(first), 'a worse crowd is a lower score');
  assert.equal(second.crowd_band, 'mixed');
  assert.equal(second.count_band, 'few');
});
