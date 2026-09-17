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


test('a reply is moderated like anything else somebody wrote in public', async () => {
  const { household, member } = await aHousehold(query);
  const { rows: [trip] } = await query(
    `insert into trips (household_id, origin_label, origin_lat, origin_lng, depart_at, return_at)
     values ($1, 'Windsor', 51.48, -0.61, now(), now() + interval '2 days') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, tag_kind, author_member_id, title, body, state)
     values ('trip', $1, 'general', $2, 'A title', 'A body', 'open') returning *`, [trip.id, member.id]);
  const { rows: [reply] } = await query(
    `insert into chat_replies (topic_id, author_member_id, body) values ($1,$2,'Something abusive') returning *`,
    [topic.id, member.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'chat_reply' and subject_id = $1`, [reply.id]);
  // Abuse is more often in a reply than in the question it hangs off, so a
  // reply that never reaches the queue can never be acted on at all.
  assert.ok(q, 'the reply reached the queue');
  assert.equal((await chat.repliesOf(topic.id)).length, 1);
  assert.ok((await queue.one(q.id)).detail?.text, 'the reviewer can read what they are deciding about');

  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  assert.equal((await chat.repliesOf(topic.id)).length, 0);
  await queue.approve([q.id], null);
  assert.equal((await chat.repliesOf(topic.id)).length, 1);
});

test('a household whose open entry is rejected can write another one', async () => {
  const { household } = await aHousehold(query);
  const make = () => query(
    `insert into open_entries (household_id, scope, kind, state) values ($1, 'standing', 'adult', 'active') returning *`,
    [household.id]);
  const { rows: [entry] } = await make();
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'open_entry' and subject_id = $1`, [entry.id]);
  assert.ok((await queue.one(q.id)).detail, 'the reviewer sees the offer, not just that one exists');

  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  // There is a unique index over *active* standing entries. A hidden row left
  // active would lock the household out of ever replacing it.
  const { rows: [again] } = await make();
  assert.ok(again.id, 'the replacement goes in');
  assert.equal((await queue.one(q.id)).state, 'rejected');
});

test('a moderated conversation is not reachable by its own address either', async () => {
  const { household, member } = await aHousehold(query);
  const { rows: [trip] } = await query(
    `insert into trips (household_id, origin_label, origin_lat, origin_lng, depart_at, return_at)
     values ($1, 'Windsor', 51.48, -0.61, now(), now() + interval '2 days') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, tag_kind, author_member_id, title, body, state)
     values ('trip', $1, 'general', $2, 'A title', 'A body', 'open') returning *`, [trip.id, member.id]);
  const { rows: [reply] } = await query(
    `insert into chat_replies (topic_id, author_member_id, body) values ($1,$2,'Something abusive') returning *`,
    [topic.id, member.id]);
  await queue.sync();
  const qt = (await query(`select id from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id])).rows[0];
  const qr = (await query(`select id from content_queue where subject_type = 'chat_reply' and subject_id = $1`, [reply.id])).rows[0];

  assert.ok(await chat.topicById(topic.id));
  assert.ok(await chat.replyById(reply.id));

  // The filters were only on the listing queries, so an existing link still
  // opened it and a known reply id could still be quoted or lifted into the
  // FAQ (Codex, 17 Sep 2026).
  await queue.reject({ id: qt.id, reason: 'abusive', who: null });
  await queue.reject({ id: qr.id, reason: 'abusive', who: null });
  assert.equal(await chat.topicById(topic.id), null);
  assert.equal(await chat.replyById(reply.id), null);

  // And the reviewer can still see what they decided about.
  assert.ok((await queue.one(qt.id)).detail?.text);
});
