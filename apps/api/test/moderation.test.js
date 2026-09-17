/**
 * A rejection has to reach the thing itself.
 *
 * The back office could reject a host review, a conversation or an open entry
 * and the only row that changed was the one in `content_queue` — which nothing
 * that publishes those things has ever heard of. So a review rejected for abuse
 * went public anyway the day its fourteen-day hold expired (Codex, 17 Sep
 * 2026). What is held here is the property, not the mechanism: after a
 * rejection the content is not returned by the thing that publishes it, and
 * after an approval it is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const queue = await import('../src/repositories/contentQueue.js');
const hosting = await import('../src/repositories/hosting.js');
const chat = await import('../src/repositories/chat.js');

test.after(() => pool.end());

/** One published-tomorrow host review, and the queue row that moderates it. */
async function aReview() {
  const { household } = await aHousehold(query);
  const { rows: [host] } = await query(
    `insert into hosts (household_id, name) values ($1, 'A host') returning *`, [household.id]);
  const { rows: [offer] } = await query(
    `insert into host_offers (host_id, title, shape) values ($1, 'A walk', 'one_off') returning *`, [host.id]);
  const { rows: [booking] } = await query(
    `insert into experience_bookings (offer_id, host_id, household_id) values ($1,$2,$3) returning *`,
    [offer.id, host.id, household.id]);
  // Its hold has already passed, which is the moment the old bug fired.
  const { rows: [review] } = await query(
    `insert into host_reviews (booking_id, offer_id, host_id, household_id, side, stars, text, publish_on)
     values ($1,$2,$3,$4,'guest',1,'Something abusive', current_date - 1) returning *`,
    [booking.id, offer.id, host.id, household.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'host_review' and subject_id = $1`, [review.id]);
  return { host, review, q };
}

test('a rejected host review does not publish when its hold expires', async () => {
  const { host, q } = await aReview();
  assert.ok(q, 'the review reached the queue');
  assert.equal((await hosting.publishedReviews(host.id)).length, 1, 'it publishes before anybody decides');

  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  assert.equal((await hosting.publishedReviews(host.id)).length, 0,
    'a rejection that only marks the queue row is not a rejection');
});

test('approving is the undo: a review hidden by mistake comes back', async () => {
  const { host, q } = await aReview();
  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  assert.equal((await hosting.publishedReviews(host.id)).length, 0);
  await queue.approve([q.id], null);
  assert.equal((await hosting.publishedReviews(host.id)).length, 1,
    'a moderator who changes their mind must be able to');
});

test('a rejected conversation is not listed, and the words are still there', async () => {
  const { household, member } = await aHousehold(query);
  const { rows: [trip] } = await query(
    `insert into trips (household_id, origin_label, origin_lat, origin_lng, depart_at, return_at)
     values ($1, 'Windsor', 51.48, -0.61, now(), now() + interval '2 days') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, tag_kind, author_member_id, title, body, state)
     values ('trip', $1, 'general', $2, 'A title', 'A body', 'open') returning *`, [trip.id, member.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id]);
  assert.equal((await chat.topicsOf('trip', trip.id)).length, 1);

  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  assert.equal((await chat.topicsOf('trip', trip.id)).length, 0, 'nobody is shown a rejected topic');
  const { rows: [still] } = await query('select body, hidden from chat_topics where id = $1', [topic.id]);
  // A moderation decision is not an erasure — the decision has to be reviewable.
  assert.equal(still.body, 'A body');
  assert.equal(still.hidden, true);
});

test('the reject reason is still from a closed list, and an unknown one changes nothing', async () => {
  const { host, q } = await aReview();
  assert.equal(await queue.reject({ id: q.id, reason: 'made-it-up', who: null }), null);
  assert.equal((await hosting.publishedReviews(host.id)).length, 1,
    'a reason nobody offered must not hide anything');
});
