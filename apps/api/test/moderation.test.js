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

const { query, withTransaction, pool } = await testDatabase();
const queue = await import('../src/repositories/contentQueue.js');
const hosting = await import('../src/repositories/hosting.js');
const chat = await import('../src/repositories/chat.js');
const openTo = await import('../src/repositories/openTo.js');

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

test('a photograph decided in the queue pays the contributor, and reverses when reversed', async () => {
  const { household } = await aHousehold(query);
  const { rows: [account] } = await query(
    `insert into accounts (email, household_id) values ($1, $2) returning *`,
    [`shots-${Math.random().toString(36).slice(2, 8)}@example.com`, household.id]);
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, may_store, moderation, contributor_account_id, contributor_household_id, licence)
     values ('household', $1, true, 'pending', $2, $3, 'household') returning *`,
    [`ref-${Math.random().toString(36).slice(2, 8)}`, account.id, household.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'image' and subject_id = $1`, [img.id]);

  const points = async () => (await query(
    'select coalesce(sum(points), 0)::int as n from image_rewards where image_id = $1', [img.id])).rows[0].n;
  assert.equal(await points(), 0);

  // Moving ordinary moderation into the queue quietly stopped contributors
  // getting the points the Library path awards (Codex, 17 Sep 2026).
  await queue.approve([q.id], null);
  assert.equal(await points(), 10);

  await queue.reject({ id: q.id, reason: 'dark', who: null });
  assert.equal(await points(), 0, 'and a reversal takes them back');
});

test('a decision made on the Library screen reaches the queue row', async () => {
  const { household } = await aHousehold(query);
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, may_store, moderation, contributor_household_id, licence)
     values ('household', $1, true, 'pending', $2, 'household') returning *`,
    [`ref-${Math.random().toString(36).slice(2, 8)}`, household.id]);
  await queue.sync();
  const state = async () => (await query(
    `select state from content_queue where subject_type = 'image' and subject_id = $1`, [img.id])).rows[0].state;
  assert.equal(await state(), 'waiting');

  // The Library endpoint is still there, and a decision made on it used to
  // leave the queue showing an approved photograph as waiting — and let
  // somebody decide it a second time, the other way (Codex, 17 Sep 2026).
  await query(`update image_assets set moderation = 'approved' where id = $1`, [img.id]);
  await queue.sync();
  assert.equal(await state(), 'approved');
});

test('rejecting an offer ends the introductions it is already part of', async () => {
  const mine = await aHousehold(query);
  const theirs = await aHousehold(query);
  const entry = async (h) => (await query(
    `insert into open_entries (household_id, scope, kind, state) values ($1, 'standing', 'adult', 'active') returning *`,
    [h.household.id])).rows[0];
  const a = await entry(mine);
  const b = await entry(theirs);
  const { rows: [match] } = await query(
    `insert into open_matches (host_entry_id, guest_entry_id, kind, stage)
     values ($1,$2,'adult','videos') returning *`, [a.id, b.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'open_entry' and subject_id = $1`, [a.id]);

  // Hiding the entry took it out of the pool and left the match alone, so the
  // people already introduced to an abusive offer went on seeing it, swapping
  // videos and talking (Codex, 17 Sep 2026).
  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  const { rows: [after] } = await query('select stage from open_matches where id = $1', [match.id]);
  assert.equal(after.stage, 'ended');

  // The counterpart's own entry is untouched: it was not their offer.
  const { rows: [other] } = await query('select state, hidden from open_entries where id = $1', [b.id]);
  assert.equal(other.state, 'active');
  assert.equal(other.hidden, false);

  // And it stays ended. Every path that changes a match takes a lock on it, and
  // the lock used to hand back an ended one — so whoever still had the URL
  // could answer it and the stage moved back to a live one (Codex, 18 Sep
  // 2026). Reading it for the person who ended it still works.
  const held = await withTransaction(async (client) => ({
    open: await openTo.lockMatch(match.id, client),
    ended: await openTo.lockMatch(match.id, client, { withEnded: true }),
  }));
  assert.equal(held.open, null, 'an ended introduction cannot be taken for changing');
  assert.equal(held.ended?.stage, 'ended', 'and it can still be read by the paths that end it');
});

test('forty photographs of one beach are one decision', async () => {
  const { household } = await aHousehold(query);
  const ref = 'osm:node/coral-beach';
  const make = async (n) => {
    const { rows: [img] } = await query(
      `insert into image_assets (source, source_ref, may_store, moderation, contributor_household_id, licence)
       values ('household', $1, true, 'pending', $2, 'household') returning *`,
      [`beach-${n}-${Math.random().toString(36).slice(2, 8)}`, household.id]);
    await query(
      `insert into image_links (image_id, subject_type, subject_id, role, position) values ($1,'place',$2,'gallery',$3)`,
      [img.id, ref, n]);
    return img;
  };
  for (let n = 0; n < 4; n += 1) await make(n);
  await queue.sync();
  const rows = queue.group(await queue.list({ kind: 'photo' }));
  const batch = rows.find((r) => r.venue_ref === ref);
  // BO5a draws them as one row — "Coral Beach, 12 of them" — and it is the
  // whole point of batch approval (17 Sep 2026, the verification audit).
  assert.ok(batch, 'the four are one row');
  assert.equal(batch.of, 4);
  assert.equal(batch.batch.length, 4);

  // A person's review is never folded into a count of reviews.
  const reviews = queue.group(await queue.list({ kind: 'review' }));
  for (const r of reviews) assert.equal(r.of, 1, 'a review is read on its own');

  // Approving the row approves the lot.
  await queue.approve(batch.batch, null);
  const { rows: [left] } = await query(
    `select count(*)::int as n from content_queue where kind = 'photo' and venue_ref = $1 and state <> 'approved'`, [ref]);
  assert.equal(left.n, 0);
});

test('a household reporting a conversation makes it jump the queue', async () => {
  const { household, member } = await aHousehold(query);
  const { rows: [trip] } = await query(
    `insert into trips (household_id, origin_label, origin_lat, origin_lng, depart_at, return_at)
     values ($1, 'Windsor', 51.48, -0.61, now(), now() + interval '2 days') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, tag_kind, author_member_id, title, body, state)
     values ('trip', $1, 'general', $2, 'A title', 'A body', 'open') returning *`, [trip.id, member.id]);
  await queue.sync();
  const state = async () => (await query(
    `select reported, report_reason from content_queue where subject_type = 'chat_topic' and subject_id = $1`,
    [topic.id])).rows[0];
  assert.equal((await state()).reported, false);

  // Reporting writes `chat_reports` and nothing else, and the queue row was
  // made with reported = false — after which `on conflict do nothing` meant no
  // later pass ever promoted it (Codex, 17 Sep 2026).
  await query(
    `insert into chat_reports (topic_id, member_id, reason) values ($1, $2, 'abusive')`,
    [topic.id, member.id]);
  await queue.sync();
  const after = await state();
  assert.equal(after.reported, true, 'reported content jumps the queue');
  assert.equal(after.report_reason, 'abusive', 'and says why');
});

test('reporting one reply does not report the conversation it is in', async () => {
  const { household, member } = await aHousehold(query);
  const { rows: [trip] } = await query(
    `insert into trips (household_id, origin_label, origin_lat, origin_lng, depart_at, return_at)
     values ($1, 'Windsor', 51.48, -0.61, now(), now() + interval '2 days') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, tag_kind, author_member_id, title, body, state)
     values ('trip', $1, 'general', $2, 'A fine question', 'A body', 'open') returning *`, [trip.id, member.id]);
  const { rows: [reply] } = await query(
    `insert into chat_replies (topic_id, author_member_id, body) values ($1,$2,'Something abusive') returning *`,
    [topic.id, member.id]);
  await queue.sync();

  // `chat_reports.topic_id` is mandatory, so a reply's report carries its
  // topic's id too. Reading that as a report of the topic promoted an
  // otherwise blameless conversation (Codex, 17 Sep 2026).
  await query(
    `insert into chat_reports (topic_id, reply_id, member_id, reason) values ($1,$2,$3,'abusive')`,
    [topic.id, reply.id, member.id]);
  await queue.sync();

  const reported = async (kind, id) => (await query(
    `select reported from content_queue where subject_type = $1 and subject_id = $2`, [kind, id])).rows[0]?.reported;
  assert.equal(await reported('chat_reply', reply.id), true, 'the reply was reported');
  assert.equal(await reported('chat_topic', topic.id), false, 'and the question it hangs off was not');
});

test('a household is told only about a rejection that was written down', async () => {
  const { household } = await aHousehold(query);
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, may_store, moderation, contributor_household_id, licence)
     values ('household', $1, true, 'pending', $2, 'household') returning *`,
    [`order-${Math.random().toString(36).slice(2, 8)}`, household.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'image' and subject_id = $1`, [img.id]);

  // The message used to go out before the row was updated, so a failure in
  // between thanked somebody for a decision nothing had recorded — and the next
  // person to look would decide it again (Codex, 17 Sep 2026).
  const out = await queue.reject({ id: q.id, reason: 'dark', tell: true, who: null });
  assert.equal(out.state, 'rejected', 'the decision is recorded whatever the message did');
  const { rows: [row] } = await query('select state, told, reason from content_queue where id = $1', [q.id]);
  assert.equal(row.state, 'rejected');
  assert.equal(row.reason, 'dark');
  // No sender is configured here, so nothing went out — and the row says so
  // rather than claiming the household was told.
  assert.equal(row.told, false);
  assert.match(out.why ?? '', /nothing was sent/);
});

test('a rejected offer’s introduction is not readable by its own address', async () => {
  const openTo = await import('../src/repositories/openTo.js');
  const mine = await aHousehold(query);
  const theirs = await aHousehold(query);
  const entry = async (h) => (await query(
    `insert into open_entries (household_id, scope, kind, state) values ($1, 'standing', 'adult', 'active') returning *`,
    [h.household.id])).rows[0];
  const a = await entry(mine);
  const b = await entry(theirs);
  const { rows: [match] } = await query(
    `insert into open_matches (host_entry_id, guest_entry_id, kind, stage)
     values ($1,$2,'adult','videos') returning *`, [a.id, b.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'open_entry' and subject_id = $1`, [a.id]);

  assert.ok(await openTo.matchById(match.id), 'readable while it is live');

  // The list already dropped ended matches; the point reads did not, so
  // somebody holding an existing link could still fetch a moderated
  // introduction and the private hello videos inside it (Codex, 17 Sep 2026).
  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  assert.equal(await openTo.matchById(match.id), null, 'and not once it has been ended');
  // The paths that have to see one to act on it still can.
  assert.ok(await openTo.matchById(match.id, null, { withEnded: true }));
});

test('the queue’s limit counts decisions, so one place’s photographs cannot fill it', async () => {
  const { household } = await aHousehold(query);
  const ref = 'osm:node/many-photographs';
  for (let n = 0; n < 6; n += 1) {
    const { rows: [img] } = await query(
      `insert into image_assets (source, source_ref, may_store, moderation, contributor_household_id, licence)
       values ('household', $1, true, 'pending', $2, 'household') returning *`,
      [`many-${n}-${Math.random().toString(36).slice(2, 8)}`, household.id]);
    await query(
      `insert into image_links (image_id, subject_type, subject_id, role, position) values ($1,'place',$2,'gallery',$3)`,
      [img.id, ref, n]);
  }
  await queue.sync();

  // Cutting the rows before grouping meant a place with more waiting
  // photographs than the limit showed a partial batch — approving it left the
  // rest to come back — and pushed every review and message off the end
  // (Codex, 17 Sep 2026). A batch is one decision however many are in it.
  const rows = queue.group(await queue.list({}), { limit: 3 });
  assert.equal(rows.length, 3, 'three decisions');
  const batch = rows.find((r) => r.venue_ref === ref);
  if (batch) assert.equal(batch.of, 6, 'and the whole batch is in the one it belongs to');
  const whole = queue.group(await queue.list({ kind: 'photo' }), { limit: 1 });
  assert.equal(whole[0].of, 6, 'never a partial batch');
});

test('approving a photograph changes the place’s score, after the commit', async () => {
  const index = await import('../src/repositories/placeIndex.js');
  // This file's database has no ready bars of its own — the score is only
  // meaningful against one.
  await index.seedBars();
  const { household } = await aHousehold(query);
  const ref = 'osm:node/gets-a-picture';
  await index.noteMany([{ ref }], { countryCode: 'GB' });
  // A subcategory whose bar actually requires a picture, so the fact counts
  // rather than being recorded and not counted.
  await query(
    `update place_index set subcategory = b.subcategory_key,
            category = (select category_key from shelf_subcategories s where s.key = b.subcategory_key)
       from (select subcategory_key from ready_bars where fact = 'picture' and required limit 1) b
      where venue_ref = $1`, [ref]);
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, may_store, moderation, contributor_household_id, licence)
     values ('household', $1, true, 'pending', $2, 'household') returning *`,
    [`score-${Math.random().toString(36).slice(2, 8)}`, household.id]);
  await query(
    `insert into image_links (image_id, subject_type, subject_id, role, position) values ($1,'place',$2,'hero',0)`,
    [img.id, ref]);
  await queue.sync();
  await index.rescore({ refs: [ref] });

  const heldPicture = async () => (await query(
    `select (score_parts->'held') ? 'picture' as has from place_index where venue_ref = $1`, [ref])).rows[0].has;
  assert.equal(await heldPicture(), false, 'a waiting photograph is not a fact we hold');

  // The rescore used to run through the pool inside the transaction, so it saw
  // the photograph as still waiting and the score never changed (Codex, 17 Sep
  // 2026).
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'image' and subject_id = $1`, [img.id]);
  await queue.approve([q.id], null);
  assert.equal(await heldPicture(), true, 'and an approved one is');
});

test('rejecting the same thing twice decides it once', async () => {
  const { household } = await aHousehold(query);
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, may_store, moderation, contributor_household_id, licence)
     values ('household', $1, true, 'pending', $2, 'household') returning *`,
    [`twice-${Math.random().toString(36).slice(2, 8)}`, household.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'image' and subject_id = $1`, [img.id]);

  const used = async () => (await query(
    `select coalesce(sum(used), 0)::int as n from rejection_counts where kind = 'photo' and reason = 'dark'`)).rows[0].n;
  const before = await used();
  await queue.reject({ id: q.id, reason: 'dark', tell: true, who: null });
  assert.equal(await used(), before + 1);

  // A retried request — a double tap, a client that resends — used to reject it
  // again, count the reason again and e-mail the household a second time
  // (Codex, 18 Sep 2026).
  const again = await queue.reject({ id: q.id, reason: 'dark', tell: true, who: null });
  assert.equal(again.state, 'rejected', 'and still answers with the decision');
  assert.match(again.why ?? '', /already rejected/);
  assert.equal(await used(), before + 1, 'counted once');
});

test('a rejected review written again comes back to be looked at', async () => {
  const { host, review, q } = await aReview();
  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  assert.equal((await hosting.publishedReviews(host.id)).length, 0);

  // The household writes it again. The queue's decision was about words that
  // are no longer there, and the corrected ones could never be looked at or
  // published (Codex, 18 Sep 2026).
  const { rows: [booking] } = await query('select * from experience_bookings limit 1');
  await hosting.insertReview({
    bookingId: review.booking_id, offerId: review.offer_id, hostId: review.host_id,
    householdId: review.household_id, side: 'guest', stars: 4, chips: [],
    text: 'Written again, politely.', publishOn: new Date(Date.now() - 86_400_000),
  });
  await queue.sync();
  const { rows: [row] } = await query('select state from content_queue where id = $1', [q.id]);
  assert.equal(row.state, 'waiting', 'back in the queue');
  // And still not published. Changing the words is a reason to look again, not
  // a way round the decision — the first version of this cleared `hidden` on the
  // edit, which published it the moment it was rewritten (Codex, 18 Sep 2026).
  assert.equal((await hosting.publishedReviews(host.id)).length, 0, 'not published by being rewritten');

  // Approving is what publishes it.
  await queue.approve([q.id], 'the owner (passcode)');
  assert.equal((await hosting.publishedReviews(host.id)).length, 1, 'approved, and now it is up');
  assert.ok(booking);
});

/**
 * A rating and a note on a dish are the same row wearing two hats.
 *
 * A rating of the place comes in whether or not anybody wrote anything — both
 * its reasons are about the score, so a wordless one that could not be queued
 * could never be taken down either. A rating of one dish comes in only when
 * there are words, and comes in as BO5a's own kind (Codex, 18 Sep 2026).
 */
test('a wordless rating of a place is decidable, and a dish with words is a note', async () => {
  const { household } = await aHousehold(query);
  const { rows: [member] } = await query(
    `insert into members (household_id, name) values ($1, 'A rater') returning *`, [household.id]);
  const { rows: [visit] } = await query(
    `insert into visits (household_id, venue_ref, venue_label, visited_on)
     values ($1, 'test:rating-kinds', 'The Chip Shop', current_date) returning *`, [household.id]);
  const { rows: [plain] } = await query(
    `insert into ratings (visit_id, member_id, subject, take, score)
     values ($1,$2,'visit','loved',5) returning *`, [visit.id, member.id]);
  const { rows: [dish] } = await query(
    `insert into ratings (visit_id, member_id, subject, take, concept_key, comment)
     values ($1,$2,'visit','fine','bhel-puri','The batter was heavy') returning *`, [visit.id, member.id]);
  const { rows: [quiet] } = await query(
    `insert into ratings (visit_id, member_id, subject, take, concept_key)
     values ($1,$2,'visit','fine','onion-bhaji') returning *`, [visit.id, member.id]);

  await queue.sync();
  const kindOf = async (id) => (await query(
    'select kind from content_queue where subject_type = $1 and subject_id = $2', ['rating', id])).rows[0]?.kind ?? null;

  assert.equal(await kindOf(plain.id), 'rating', 'a wordless rating of the place is still a decision');
  assert.equal(await kindOf(dish.id), 'note', 'a dish with words is a note on a dish');
  assert.equal(await kindOf(quiet.id), null, 'a star on a plate with nothing written is not content');

  // And what the reviewer is shown is the verdict, not an empty quotation.
  const item = await queue.one((await query(
    'select id from content_queue where subject_id = $1', [plain.id])).rows[0].id);
  assert.equal(item.detail.take, 'loved');
  assert.equal(Number(item.detail.score), 5);
  assert.equal(item.detail.dish, null);
});

/**
 * A flag is a view of the facts, not a decision somebody made.
 *
 * Once three sources stop disagreeing there is nothing left to look at, and a
 * queue that only ever adds rows went on offering a discrepancy that no longer
 * existed (Codex, 18 Sep 2026).
 */
test('a disagreement that has gone away goes away, and a decided one stays', async () => {
  const ref = 'test:disagree';
  const fact = async (source, value) => query(
    `insert into place_facts (venue_ref, field, source, value, licence, retention, fetched_at)
     values ($1, 'phone', $2, to_jsonb($3::text), 'provider', 'session', now())`, [ref, source, value]);
  await fact('google', '01 111');
  await fact('osm', '02 222');
  await fact('atlas', '03 333');
  await queue.syncFlagged();
  const row = async () => (await query(
    `select state from content_queue where subject_type = 'place' and subject_id = $1`, [`${ref}#phone`])).rows[0] ?? null;
  assert.equal((await row())?.state, 'waiting', 'three values that disagree are a thing to look at');

  // Two of them corrected to the same number: the sources agree now.
  await query(`update place_facts set value = to_jsonb('01 111'::text) where venue_ref = $1`, [ref]);
  await queue.syncFlagged();
  assert.equal(await row(), null, 'and nothing is left to decide');

  // But a flag somebody has already decided is their record, and stays.
  await fact('tripadvisor', '04 444');
  await fact('wikidata', '05 555');
  await queue.syncFlagged();
  await query(
    `update content_queue set state = 'rejected', reason = 'theirs'
      where subject_type = 'place' and subject_id = $1`, [`${ref}#phone`]);
  await query(`update place_facts set value = to_jsonb('01 111'::text) where venue_ref = $1`, [ref]);
  await queue.syncFlagged();
  assert.equal((await row())?.state, 'rejected', 'a decision is not undone by the facts settling');
});

/**
 * A decision is about the words that were in front of whoever made it.
 *
 * Anything a household can rewrite after it has been decided goes back to
 * waiting. Three rounds on this: the first left corrected words unlookable for
 * ever, the second published a rejected review the moment it was edited, and
 * the third caught only the rejected ones — so an approved row went on saying
 * approved about text nobody had read (Codex, 18 Sep 2026).
 */
test('an approved thing that is rewritten goes back to be looked at', async () => {
  const { household } = await aHousehold(query);
  const { rows: [member] } = await query(
    `insert into members (household_id, name) values ($1, 'An asker') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, author_member_id, title, body, tag_kind)
     values ('trip', $1, $2, 'Where for lunch?', 'Somewhere near the park.', 'none') returning *`,
    [household.id, member.id]);
  await queue.sync();
  const row = async () => (await query(
    `select state from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id])).rows[0];
  const q = await query(
    `select id from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id]);
  await queue.approve([q.rows[0].id], 'the owner (passcode)');
  assert.equal((await row()).state, 'approved');

  // Pinning it is not rewriting it.
  await chat.updateTopic(topic.id, { pinned: true });
  await queue.sync();
  assert.equal((await row()).state, 'approved', 'a decision stands over a change that is not the words');

  // Nor is sending the same words again — the edit form always does (Codex,
  // 18 Sep 2026).
  await chat.updateTopic(topic.id, { title: 'Where for lunch?', body: 'Somewhere near the park.', audience: 'everyone' });
  await queue.sync();
  assert.equal((await row()).state, 'approved', 'the same words are not a rewrite');
  const { rows: [still] } = await query('select hidden from chat_topics where id = $1', [topic.id]);
  assert.equal(still.hidden, false, 'and it is still up');

  // Changing the words is — and the new ones wait out of sight, because the way
  // to publish something abusive would otherwise be to publish something else
  // and then edit it (Codex, 18 Sep 2026).
  await chat.updateTopic(topic.id, { body: 'Actually, something abusive.' });
  await queue.sync();
  assert.equal((await row()).state, 'waiting', 'and it goes back in front of somebody');
  const { rows: [after] } = await query('select hidden from chat_topics where id = $1', [topic.id]);
  assert.equal(after.hidden, true, 'and it is not public while it waits');

  // Approving it puts it back up.
  const q2 = await query(
    `select id from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id]);
  await queue.approve([q2.rows[0].id], 'the owner (passcode)');
  const { rows: [up] } = await query('select hidden from chat_topics where id = $1', [topic.id]);
  assert.equal(up.hidden, false);
});

/**
 * Hiding an entry keeps it out of the pool, not away from its owner.
 *
 * Filtering the owner's own lookup meant the screen said "you have not written
 * one" the moment moderation hid it — and writing another violated the unique
 * index on one active entry per scope (Codex, 18 Sep 2026).
 */
test('a household can still find its own entry while it waits to be read again', async () => {
  const { household } = await aHousehold(query);
  const { rows: [entry] } = await query(
    `insert into open_entries (household_id, scope, kind, state, transcript)
     values ($1, 'standing', 'adult', 'active', 'Up for a walk') returning *`, [household.id]);
  assert.equal((await openTo.entryFor(household.id, { scope: 'standing' }))?.id, entry.id);

  await query('update open_entries set hidden = true where id = $1', [entry.id]);
  const held = await openTo.entryFor(household.id, { scope: 'standing' });
  assert.equal(held?.id, entry.id, 'their own entry is still theirs to find');
  // And it is still out of the pool everybody else is matched from.
  const { rows: pool } = await query(
    `select id from open_entries where state = 'active' and not hidden and scope = 'standing' and household_id = $1`,
    [household.id]);
  assert.equal(pool.length, 0);
});

/**
 * A report against something already approved is a reason to look again.
 *
 * The reported lane is the reports nobody has dealt with, so leaving the row
 * saying "approved" filed the report where nobody was looking and the content
 * stayed up (Codex, 18 Sep 2026).
 */
test('reporting approved content puts it back in front of somebody', async () => {
  const { host, q } = await aReview();
  await queue.approve([q.id], 'the owner (passcode)');
  assert.equal((await hosting.publishedReviews(host.id)).length, 1);

  await queue.report({ id: q.id, reason: 'abusive', by: null });
  const { rows: [row] } = await query('select state, reported, reason from content_queue where id = $1', [q.id]);
  assert.equal(row.state, 'waiting', 'back in the queue');
  assert.equal(row.reported, true, 'and in the lane that is worked first');
  assert.equal(row.reason, null, 'the old decision is not still standing');
});

/**
 * A reported photograph stays where somebody will see it.
 *
 * `image_assets.moderation` is the truth about a photograph and the queue row is
 * a view of it — but a report sends the row back to waiting while the asset is
 * still approved, and copying the asset's state over the top took the
 * photograph straight out of the lane it had just been put in (Codex, 18 Sep
 * 2026).
 */
test('reporting an approved photograph keeps it in the queue through the next sync', async () => {
  const { household } = await aHousehold(query);
  const { rows: [img] } = await query(
    `insert into image_assets (source, licence, may_store, moderation, contributor_household_id, fetched_at)
     values ('household', 'Household photograph', true, 'approved', $1, now()) returning *`, [household.id]);
  await queue.sync();
  const row = async () => (await query(
    `select state, reported from content_queue where subject_type = 'image' and subject_id = $1`, [img.id])).rows[0];
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'image' and subject_id = $1`, [img.id]);

  await queue.report({ id: q.id, reason: 'abusive', by: null });
  assert.equal((await row()).state, 'waiting');

  // The next load syncs again, and must not undo it.
  await queue.sync();
  const after = await row();
  assert.equal(after.state, 'waiting', 'still in front of somebody');
  assert.equal(after.reported, true);
});

/**
 * A report is answered once.
 *
 * `reported` meant "somebody complained" and "this is urgent" at the same time,
 * so deciding a reported thing left the flag standing — and a later edit, which
 * rightly sends the words back to be read again, carried the old answered
 * report into the urgent lane with them (Codex, 18 Sep 2026).
 */
test('a report that has been dealt with does not come back with the next edit', async () => {
  const { household } = await aHousehold(query);
  const { rows: [member] } = await query(
    `insert into members (household_id, name) values ($1, 'An asker') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, author_member_id, title, body, tag_kind)
     values ('trip', $1, $2, 'Where for lunch?', 'Near the park.', 'none') returning *`,
    [household.id, member.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id]);

  // Counted as a difference, because other things in the queue are reported too.
  const urgent = async () => (await queue.counts({ state: 'reported' })).reported;
  const before = await urgent();
  await queue.report({ id: q.id, reason: 'abusive', by: null });
  assert.equal(await urgent(), before + 1, 'somebody complained, and it is urgent');

  // Looked at and approved: the complaint is answered.
  await queue.approve([q.id], 'the owner (passcode)');
  assert.equal(await urgent(), before, 'and it stops being urgent');

  // The author rewrites it. The words go back to be read; the answered
  // complaint does not come with them.
  await chat.updateTopic(topic.id, { body: 'Something else entirely.' });
  await queue.sync();
  const { rows: [after] } = await query('select state, reported from content_queue where id = $1', [q.id]);
  assert.equal(after.state, 'waiting', 'new words, so somebody reads them');
  assert.equal(await urgent(), before, 'but the old report was already dealt with');

  // A fresh complaint is urgent again.
  await queue.report({ id: q.id, reason: 'abusive', by: null });
  assert.equal(await urgent(), before + 1);
});

/**
 * An answered chat report stays answered.
 *
 * The household's complaint lives in `chat_reports` for good, and matching the
 * row alone reopened it on every queue load — so approved reported content went
 * back into the urgent lane for ever (Codex, 18 Sep 2026).
 */
test('an approved chat report does not reopen itself on the next sync', async () => {
  const { household } = await aHousehold(query);
  const { rows: [member] } = await query(
    `insert into members (household_id, name) values ($1, 'An asker') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, author_member_id, title, body, tag_kind)
     values ('trip', $1, $2, 'A question', 'Some words.', 'none') returning *`, [household.id, member.id]);
  await query(
    `insert into chat_reports (topic_id, member_id, reason) values ($1, $2, 'abusive')`,
    [topic.id, member.id]);
  await queue.sync();
  const row = async () => (await query(
    `select state, reported, report_cleared_at from content_queue
      where subject_type = 'chat_topic' and subject_id = $1`, [topic.id])).rows[0];
  assert.equal((await row()).reported, true, 'the household complained, so it is urgent');

  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id]);
  await queue.approve([q.id], 'the owner (passcode)');
  assert.ok((await row()).report_cleared_at, 'and somebody answered it');

  // Every load syncs. It must not undo the answer.
  await queue.sync();
  await queue.sync();
  const after = await row();
  assert.equal(after.state, 'approved', 'still decided');
  assert.ok(after.report_cleared_at, 'and the complaint is still answered');
});

test('rejecting a topic withdraws the FAQ it was published into', async () => {
  const { household, member } = await aHousehold(query);
  const { rows: [trip] } = await query(
    `insert into trips (household_id, origin_label, origin_lat, origin_lng, depart_at, return_at)
     values ($1, 'Windsor', 51.48, -0.61, now(), now() + interval '2 days') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, tag_kind, author_member_id, title, body, state)
     values ('trip', $1, 'general', $2, 'Is there parking?', 'Something that should not stand', 'open') returning *`,
    [trip.id, member.id]);

  // The same words, lifted into an offer's FAQ where everybody can read them.
  const { rows: [host] } = await query(
    `insert into hosts (household_id, name) values ($1, 'A host') returning *`, [household.id]);
  const { rows: [offer] } = await query(
    `insert into host_offers (host_id, shape) values ($1, 'skill') returning *`, [host.id]);
  await query(
    `insert into chat_faq_entries (offer_id, question, answer, source_topic_id)
     values ($1, 'Is there parking?', 'Something that should not stand', $2)`, [offer.id, topic.id]);
  assert.equal((await chat.faqOf(offer.id)).length, 1);

  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id]);
  await queue.reject({ id: q.id, reason: 'abusive', who: null });

  // The FAQ list is read on its own and joins nothing back to the source, so
  // hiding the topic left the same words in front of everybody who opened the
  // offer — which is exactly what a rejection is for (Codex, 18 Sep 2026).
  assert.equal((await chat.faqOf(offer.id)).length, 0, 'the copy goes with the original');
  assert.equal((await chat.faqOf(offer.id, { includeWithdrawn: true })).length, 1,
    'withdrawn, not erased: a decision has to stay reviewable');

  // Reversing the decision puts it back. Undoing half of it left the queue
  // saying approved while the offer's FAQ stayed blank (Codex, 18 Sep 2026).
  await queue.approve([q.id], null);
  assert.equal((await chat.faqOf(offer.id)).length, 1, 'approving from the rejected lane restores it');

  // But a question the host took down themselves is theirs. Moderation putting
  // that back would overrule them with no trace (migration 175).
  const [entry] = await chat.faqOf(offer.id);
  await chat.withdrawFaq(entry.id);
  await queue.reject({ id: q.id, reason: 'abusive', who: null });
  await queue.approve([q.id], null);
  assert.equal((await chat.faqOf(offer.id)).length, 0, 'the host’s own withdrawal stands');
});

test('a rejection whose message never went can be told again', async () => {
  const { household } = await aHousehold(query);
  const { rows: [img] } = await query(
    `insert into image_assets (source, source_ref, may_store, moderation, contributor_household_id, licence)
     values ('household', $1, true, 'pending', $2, 'household') returning *`,
    [`retell-${Math.random().toString(36).slice(2, 8)}`, household.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'image' and subject_id = $1`, [img.id]);

  // Mail is not configured here, so the decision stands and nothing goes out.
  const first = await queue.reject({ id: q.id, reason: 'dark', tell: true, who: null });
  assert.equal(first.told, false);
  assert.match(first.why ?? '', /no sender is configured/);

  // Asking again used to return early on the "already rejected" guard, so the
  // one thing that had failed was the one thing that could never be tried
  // again (Codex, 18 Sep 2026). It reaches the message now, says the decision
  // was already made, and says what happened to the message.
  const again = await queue.reject({ id: q.id, reason: 'dark', tell: true, who: null });
  assert.equal(again.state, 'rejected');
  assert.match(again.why ?? '', /already rejected/);
  assert.match(again.why ?? '', /no sender is configured/);

  // And the decision is still only made once.
  const used = (await query(
    `select coalesce(sum(used), 0)::int as n from rejection_counts where kind = 'photo' and reason = 'dark'`)).rows[0].n;
  const third = await queue.reject({ id: q.id, reason: 'dark', tell: true, who: null });
  assert.equal(third.state, 'rejected');
  assert.equal((await query(
    `select coalesce(sum(used), 0)::int as n from rejection_counts where kind = 'photo' and reason = 'dark'`)).rows[0].n,
  used, 'the reason is not counted again');
});

test('words written while somebody was reading them are not published', async () => {
  const { household } = await aHousehold(query);
  const { rows: [member] } = await query(
    `insert into members (household_id, name) values ($1, 'An asker') returning *`, [household.id]);
  const { rows: [topic] } = await query(
    `insert into chat_topics (context_type, context_id, author_member_id, title, body, tag_kind)
     values ('trip', $1, $2, 'Where for lunch?', 'Somewhere near the park.', 'none') returning *`,
    [household.id, member.id]);
  await queue.sync();
  const { rows: [q] } = await query(
    `select id from content_queue where subject_type = 'chat_topic' and subject_id = $1`, [topic.id]);

  // What the moderator is shown, which is what the decision has to be about.
  const seenNow = (await queue.one(q.id)).version;

  // The household edits it while it is sitting in the queue — after the
  // moderator opened it and before they pressed the button. Approving lifts
  // the decision onto whatever the text is *now*, so somebody who read one
  // thing would publish another (Codex, 18 Sep 2026).
  //
  // The row's own clock is no guard: `sync()` runs on every queue load and
  // would forgive an edit made a second ago. Only the version the screen was
  // shown can answer it.
  await chat.updateTopic(topic.id, { body: 'Actually, something abusive.' });
  await queue.sync();
  const out = await queue.approve([q.id], 'the owner (passcode)', { seen: { [q.id]: seenNow } });
  assert.deepEqual(out.stale, [q.id], 'the answer names what it would not publish');
  assert.equal((await query(
    `select state from content_queue where id = $1`, [q.id])).rows[0].state, 'waiting',
  'and it is still waiting for somebody to read the new words');
  // A waiting topic is not hidden — only a rejection hides one — so what this
  // protects is the *decision*: nobody's approval is recorded over words they
  // did not read, and the row stays in front of somebody.
  assert.equal((await query(
    `select decided_at from content_queue where id = $1`, [q.id])).rows[0].decided_at, null,
  'nothing was decided about the new words');

  // Reading the new words and deciding about *those* works — the guard is about
  // words nobody has read, not about rewriting.
  const seenAgain = (await queue.one(q.id)).version;
  assert.notEqual(seenAgain, seenNow, 'and it is a different version');
  const second = await queue.approve([q.id], 'the owner (passcode)', { seen: { [q.id]: seenAgain } });
  assert.equal(second.stale, undefined, 'the new words have been read now');
  assert.equal((await query(
    `select state from content_queue where id = $1`, [q.id])).rows[0].state, 'approved');
});
