/**
 * The chat module's rules (domain/chat.js) and its tables (migration 086).
 *
 * The rules worth pinning are the ones a screen would quietly get wrong:
 *
 *   * a private question is the asker's and the host's, and a guest on the
 *     link never sees one;
 *   * the two filters produce what the board says — `waiting` and `answered`
 *     narrow `questions`, and About lists only anchors that have a topic;
 *   * a reaction tells the author only; a reply tells followers; a new
 *     question does not ping everybody; a notice on the day of reaches all;
 *   * the same question asked three times is the same question, and the
 *     published version is never the guest's own wording;
 *   * the migration copies every old message in as a topic, once, with its
 *     read receipts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query } = await testDatabase();
const repo = await import('../src/repositories/chat.js');
const {
  aboutOptions, askCount, canSee, filterTopics, headerLine, inQuietHours, isDayOf, isNearDuplicate, matchesShowing, menuFor, mentionsIn,
  normaliseQuestion, rateLimited, showingCounts, whoIsTold, legacyMessages, legacyPeople, rosterFor, isOnAnchor,
} = await import('../src/domain/chat.js');

const sam = { memberId: 'sam', guestId: null, name: 'Sam Rivers', isHost: true, contextType: 'trip' };
const kate = { memberId: 'kate', guestId: null, name: 'Kate Bell', isHost: false };
const jon = { memberId: 'jon', guestId: null, name: 'Jon Lee', isHost: false };
const priya = { memberId: null, guestId: 'priya', name: 'Priya Guest', isHost: false };
const people = [sam, kate, jon, priya];

const topic = (over = {}) => ({
  id: over.id ?? 't1', context_type: 'trip', context_id: 'trip1', tag_kind: 'day', tag_ref: 'd1', audience: 'everyone',
  author_member_id: 'kate', author_guest_id: null, title: 'Anything for someone who does not eat dairy?', state: 'open', pinned: false,
  created_at: '2026-10-01T10:00:00Z', replies: [], ...over,
});

// ---------------------------------------------------------------------------
// who may see what
// ---------------------------------------------------------------------------

test('a private question is the asker’s and the host’s; a guest never sees one', () => {
  const t = topic({ audience: 'host_only' });
  assert.equal(canSee(t, kate), true, 'the asker');
  assert.equal(canSee(t, sam), true, 'the organiser');
  assert.equal(canSee(t, jon), false, 'somebody else on the trip');
  assert.equal(canSee(t, priya), false, 'a guest on the link');
  assert.equal(canSee(topic(), priya), true, 'a guest sees everyone topics');
});

test('the ellipsis is grouped by who can do it, and a guest sees only the first group', () => {
  const t = topic({ seenBy: 10, audienceCount: 12 });
  assert.deepEqual(menuFor(t, priya).map((g) => g.title), ['Everyone']);
  assert.deepEqual(menuFor(t, kate).map((g) => g.title), ['Everyone', 'Because you asked it']);
  assert.deepEqual(menuFor(t, sam).map((g) => g.title), ['Everyone', 'Because you are the organiser']);
  assert.equal(menuFor(t, sam)[1].items.some((i) => i.key === 'answer'), true);
  assert.equal(menuFor(topic({ state: 'notice' }), sam)[1].items.some((i) => i.key === 'answer'), false, 'a notice has no answer');
  assert.match(menuFor(t, kate)[0].items[2].hint, /10 of 12/);
  assert.equal(menuFor(t, kate, { following: true })[0].items[0].key, 'unfollow');
});

// ---------------------------------------------------------------------------
// the two filters
// ---------------------------------------------------------------------------

const list = [
  topic({ id: 'a', state: 'notice', author_member_id: 'sam', tag_kind: 'trip', tag_ref: 'trip', title: 'Ferry is 07:10' }),
  topic({ id: 'b', state: 'open', tag_ref: 'd9', replies: [{ id: 'r1', author_member_id: 'jon', author_guest_id: null }] }),
  topic({ id: 'c', state: 'answered', author_member_id: 'jon', tag_ref: 'd6' }),
  topic({ id: 'd', state: 'open', audience: 'host_only', author_member_id: 'kate', tag_kind: 'trip', tag_ref: 'stay' }),
  topic({ id: 'e', state: 'open', author_member_id: 'jon', tag_ref: 'd6', replies: [{ id: 'r2', author_member_id: 'kate', author_guest_id: null }, { id: 'r3', author_member_id: 'sam', author_guest_id: null, quotes_reply_id: 'r2' }] }),
];

test('Showing: waiting and answered narrow questions; notices, mine, replies to me and private are their own rows', () => {
  const counts = showingCounts(list, kate);
  assert.deepEqual(counts, { all: 5, questions: 4, waiting: 3, answered: 1, notices: 1, mine: 3, replies_to_me: 2, private: 1 });
  // Jon cannot see Kate's private question, so his counts are one down.
  assert.equal(showingCounts(list, jon).all, 4);
  assert.equal(showingCounts(list, jon).private, 0);
  // Replies to me: a reply on my question, or one quoting my reply.
  assert.equal(matchesShowing(list[1], 'replies_to_me', kate), true, 'Jon replied on Kate’s question');
  assert.equal(matchesShowing(list[4], 'replies_to_me', kate), true, 'Sam quoted Kate’s reply');
  assert.equal(matchesShowing(list[4], 'replies_to_me', jon), true, 'Kate replied on Jon’s question');
  assert.equal(matchesShowing(list[1], 'replies_to_me', jon), false, 'Jon’s own reply is not a reply to Jon');
});

test('the list is pinned first, then waiting before answered', () => {
  const ordered = filterTopics([...list, topic({ id: 'p', state: 'answered', pinned: true })], { showing: 'questions' }, kate);
  assert.deepEqual(ordered.map((t) => t.id).slice(0, 1), ['p']);
  assert.equal(ordered.at(-1).id, 'c', 'the answered one is last');
  assert.deepEqual(filterTopics(list, { showing: 'questions', about: 'day:d6' }, kate).map((t) => t.id).sort(), ['c', 'e']);
});

test('About lists the trip-level anchors always, and only the days that have questions', () => {
  const level = [{ kind: 'trip', ref: 'trip', label: 'The whole trip' }, { kind: 'trip', ref: 'travel', label: 'Getting there' }, { kind: 'trip', ref: 'stay', label: 'Where we are staying' }];
  const days = ['d1', 'd6', 'd9', 'd12', 'd13', 'd14'].map((ref) => ({ kind: 'day', ref, label: ref }));
  const about = aboutOptions(list, { levelAnchors: level, allAnchors: days }, kate, 'questions');
  assert.equal(about.anything, 4);
  assert.deepEqual(about.level.map((a) => [a.ref, a.count]), [['trip', 0], ['travel', 0], ['stay', 1]]);
  assert.deepEqual(about.withTopics.map((a) => a.ref), ['d6', 'd9'], 'two of six days');
  assert.equal(about.withTopicsOf, 6);
  assert.equal(about.all.length, 6, 'search still covers all of them');
});

test('the header line says what the combination produced', () => {
  assert.equal(headerLine({ waiting: 6 }, 'questions', 24), '24 questions · 6 waiting on an answer');
  assert.equal(headerLine({ waiting: 0 }, 'questions', 1), '1 question');
  assert.equal(headerLine({}, 'replies_to_me', 3), '3 replies to you');
});

// ---------------------------------------------------------------------------
// who gets told
// ---------------------------------------------------------------------------

const scope = (over = {}) => ({ people, prefsOf: () => null, followersOf: () => [], today: '2026-10-11', ...over });

test('a reaction tells the author of the reacted-to message and nobody else', () => {
  const t = topic();
  const told = whoIsTold({ kind: 'reaction', topic: t, actor: jon }, scope({ followersOf: () => [kate, sam, jon] }));
  assert.deepEqual(told.map((x) => x.person.memberId), ['kate']);
  const onReply = whoIsTold({ kind: 'reaction', topic: t, reply: { author_member_id: 'sam' }, actor: jon }, scope());
  assert.deepEqual(onReply.map((x) => x.person.memberId), ['sam']);
});

test('a reply tells the followers, never the replier, and anyone mentioned', () => {
  const t = topic();
  const told = whoIsTold({ kind: 'reply', topic: t, reply: { body: 'hi' }, actor: jon, mentions: [priya] }, scope({ followersOf: () => [kate, jon] }));
  assert.deepEqual(told.map((x) => [x.person.name, x.reason]), [['Kate Bell', 'following'], ['Priya Guest', 'mention']]);
  // Somebody who switched "things I started" off is not told.
  const quiet = whoIsTold({ kind: 'reply', topic: t, actor: jon }, scope({ followersOf: () => [kate], prefsOf: (p) => (p.memberId === 'kate' ? { started: false } : null) }));
  assert.equal(quiet.length, 0);
});

test('a new question does not ping the whole trip: only those who asked for every one, or are on its day', () => {
  const t = topic({ tag_kind: 'day' });
  const told = whoIsTold({ kind: 'topic', topic: t, actor: kate }, scope({ prefsOf: (p) => (p.memberId === 'jon' ? { anchors: false } : null) }));
  // Sam and Priya are on the trip (and so on every day of it); Jon turned anchors off.
  assert.deepEqual(told.map((x) => x.person.name).sort(), ['Priya Guest', 'Sam Rivers']);
  const whole = whoIsTold({ kind: 'topic', topic: topic({ tag_kind: 'trip', tag_ref: 'trip' }), actor: kate }, scope());
  assert.equal(whole.length, 0, 'a whole-trip question pings nobody by default');
  const eager = whoIsTold({ kind: 'topic', topic: topic({ tag_kind: 'trip', tag_ref: 'trip' }), actor: kate }, scope({ prefsOf: (p) => (p.memberId === 'jon' ? { every_topic: true } : null) }));
  assert.deepEqual(eager.map((x) => x.person.name), ['Jon Lee']);
  const priv = whoIsTold({ kind: 'topic', topic: topic({ audience: 'host_only' }), actor: kate }, scope({ prefsOf: () => ({ every_topic: true }) }));
  assert.deepEqual(priv.map((x) => x.person.name), ['Sam Rivers'], 'a private question goes to the host only');
});

test('a notice from the organiser goes to everyone, and on the day of it cannot be turned off', () => {
  const notice = topic({ state: 'notice', author_member_id: 'sam', tag_kind: 'trip', tag_ref: 'trip', context_dates: { start: '2026-10-04', end: '2026-10-18' } });
  const off = (p) => (p.memberId === 'jon' ? { from_host: false } : null);
  const anyDay = whoIsTold({ kind: 'notice', topic: notice, actor: sam }, scope({ prefsOf: off, today: '2026-09-01' }));
  assert.deepEqual(anyDay.map((x) => x.person.name).sort(), ['Kate Bell', 'Priya Guest']);
  const dayOf = whoIsTold({ kind: 'notice', topic: notice, actor: sam }, scope({ prefsOf: off, today: '2026-10-11' }));
  assert.deepEqual(dayOf.map((x) => x.person.name).sort(), ['Jon Lee', 'Kate Bell', 'Priya Guest']);
  assert.equal(dayOf.find((x) => x.person.name === 'Jon Lee').reason, 'day_of');
  assert.equal(isDayOf({ tag_date: '2026-10-11' }, '2026-10-11'), true);
  assert.equal(isDayOf({ occurrence: '2026-10-11T10:00' }, '2026-10-11'), true);
  assert.equal(isDayOf({}, '2026-10-11'), false);
});

test('@Kate finds Kate by first name, once', () => {
  assert.deepEqual(mentionsIn('@kate and @Kate, are you coming? @nobody', people).map((p) => p.name), ['Kate Bell']);
});

test('quiet hours may cross midnight', () => {
  assert.equal(inQuietHours('23:30', '22:00', '07:00'), true);
  assert.equal(inQuietHours('03:00', '22:00', '07:00'), true);
  assert.equal(inQuietHours('12:00', '22:00', '07:00'), false);
  assert.equal(inQuietHours('12:00', null, null), false);
});

test('the rate limit is Airbnb’s: 10 an hour, 25 a day', () => {
  assert.equal(rateLimited({ lastHour: 3, lastDay: 10 }), null);
  assert.match(rateLimited({ lastHour: 10, lastDay: 10 }), /10 messages in the last hour/);
  assert.match(rateLimited({ lastHour: 2, lastDay: 25 }), /25 messages today/);
});

// ---------------------------------------------------------------------------
// the same question, asked again
// ---------------------------------------------------------------------------

test('the same question in different words is the same question', () => {
  assert.equal(isNearDuplicate('Is your kitchen up any stairs?', 'Are there stairs up to the kitchen?'), true);
  assert.equal(isNearDuplicate('Can I take some starter home with me?', 'Could we take starter home?'), true);
  assert.equal(isNearDuplicate('Is your kitchen up any stairs?', 'Do I need a Dutch oven, or will a tray do?'), false);
  const asked = ['Is the kitchen up stairs?', 'Any stairs to the kitchen?', 'Do I need a Dutch oven?', 'Is your kitchen up any stairs?'];
  assert.equal(askCount('Is your kitchen up any stairs?', asked), 3);
  assert.equal(askCount('Something nobody asked', []), 1, 'a first ask is one');
});

test('the published question is normalised — never the guest’s own wording', () => {
  assert.equal(normaliseQuestion('Hi, my son has a nut allergy — is the kitchen a problem?'), 'Is the kitchen a problem?');
  assert.equal(normaliseQuestion('I use a stick and stairs are slow going. Is your kitchen up any stairs? Did not want to make a thing of it.'), 'Is your kitchen up any stairs?');
  assert.equal(normaliseQuestion('can i take some starter home'), 'Can i take some starter home?');
  assert.equal(normaliseQuestion(''), '');
});

// ---------------------------------------------------------------------------
// the tables
// ---------------------------------------------------------------------------

test('every old message becomes a topic once, with its read receipts', async () => {
  const { household, member } = await aHousehold(query, 'The Rivers');
  const trip = (await query(
    `insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date, place_label) values ($1, 'Sicily', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-18', 'Sicily') returning *`,
    [household.id],
  )).rows[0];
  const m = (await query(
    `insert into trip_messages (trip_id, venue_ref, venue_label, body, author_member_id) values ($1, 'osm:node/1', 'Etna', 'Is the crater walk alright for a nine-year-old?', $2) returning *`,
    [trip.id, member.id],
  )).rows[0];
  await query('insert into trip_message_reads (message_id, member_id) values ($1, $2)', [m.id, member.id]);
  // The migration's copy, run again by hand: it must be a no-op the second time.
  const copy = async () => query(`
    insert into chat_topics (context_type, context_id, tag_kind, tag_ref, tag_label, audience, author_member_id, author_guest_id, title, state, legacy_message_id, created_at, updated_at)
    select 'trip', m.trip_id, case when m.venue_ref is null then 'trip' else 'stop' end, case when m.venue_ref is null then 'trip' else m.venue_ref end,
           case when m.venue_ref is null then 'The whole trip' else m.venue_label end, 'everyone', m.author_member_id, m.author_guest_id, m.body, 'open', m.id, m.created_at, m.created_at
      from trip_messages m where not exists (select 1 from chat_topics t where t.legacy_message_id = m.id)`);
  await copy();
  await copy();
  await query(`insert into chat_reads (target_type, target_id, member_id, guest_id, read_at)
               select 'topic', t.id, r.member_id, r.guest_id, r.read_at from trip_message_reads r join chat_topics t on t.legacy_message_id = r.message_id on conflict do nothing`);
  const topics = await repo.topicsOf('trip', trip.id);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].tag_kind, 'stop');
  assert.equal(topics[0].tag_ref, 'osm:node/1');
  assert.equal(topics[0].seen_by, 1);
  assert.equal((await repo.askCounts(trip.id)).get('osm:node/1'), 1);
});

test('only one reply holds the answer, and marking it answers the topic', async () => {
  const { household, member } = await aHousehold(query, 'The Bells');
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date) values ($1, 'Bath', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning *`, [household.id])).rows[0];
  const t = await repo.insertTopic({ contextType: 'trip', contextId: trip.id, tagKind: 'trip', tagRef: 'trip', tagLabel: 'The whole trip', memberId: member.id, title: 'Paper tickets or the app?' });
  const r1 = await repo.insertReply({ topicId: t.id, memberId: member.id, body: 'The app is fine.' });
  const r2 = await repo.insertReply({ topicId: t.id, memberId: member.id, body: 'Bring both to be safe.', quotesReplyId: r1.id });
  await repo.setAnswer(t.id, r1.id);
  let replies = await repo.repliesOf(t.id);
  assert.deepEqual(replies.map((r) => r.is_answer), [true, false]);
  assert.equal((await repo.topicById(t.id)).state, 'answered');
  await repo.setAnswer(t.id, r2.id);
  replies = await repo.repliesOf(t.id);
  assert.deepEqual(replies.map((r) => r.is_answer), [false, true]);
  assert.equal(replies[1].quotes_reply_id, r1.id, 'the quote is a pointer, not a parent');
  await repo.setAnswer(t.id, null);
  assert.equal((await repo.topicById(t.id)).state, 'open');
});

test('opening a topic marks every reply in it seen; a reaction toggles; following is per topic', async () => {
  const { household, member } = await aHousehold(query, 'The Lees');
  const other = (await query(`insert into members (household_id, name) values ($1, 'Jon Lee') returning *`, [household.id])).rows[0];
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date) values ($1, 'York', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-05') returning *`, [household.id])).rows[0];
  const t = await repo.insertTopic({ contextType: 'trip', contextId: trip.id, tagKind: 'trip', tagRef: 'trip', memberId: member.id, title: 'Lift or four flights?' });
  await repo.insertReply({ topicId: t.id, memberId: member.id, body: 'A lift.' });
  await repo.insertReply({ topicId: t.id, memberId: other.id, body: 'And it works.' });
  const me = { memberId: other.id, guestId: null };
  const before = await repo.unreadOf('trip', trip.id, me);
  assert.equal(before.total, 3, 'the topic and two replies');
  await repo.markTopicRead(t.id, me);
  const after = await repo.unreadOf('trip', trip.id, me);
  assert.equal(after.total, 0);
  assert.equal((await repo.topicById(t.id)).seen_by, 1);
  assert.equal((await repo.repliesOf(t.id))[0].seen_by, 1);

  assert.equal(await repo.toggleReaction({ targetType: 'topic', targetId: t.id, emoji: '👍' }, me), true);
  assert.equal(await repo.toggleReaction({ targetType: 'topic', targetId: t.id, emoji: '👍' }, me), false);
  assert.equal(await repo.toggleReaction({ targetType: 'topic', targetId: t.id, emoji: '❤️' }, me), true);
  assert.deepEqual(await repo.mostUsedBy(me), ['❤️']);

  await repo.follow(t.id, me, 'manual');
  await repo.follow(t.id, me, 'replied');
  assert.deepEqual((await repo.followersOf(t.id)).map((f) => f.source), ['manual'], 'the first reason is kept');
  await repo.unfollow(t.id, me);
  assert.equal((await repo.followersOf(t.id)).length, 0);
});

test('the FAQ: consent is recorded, ask counts climb, withdrawing unpublishes', async () => {
  const { household, member } = await aHousehold(query, 'The Hosts');
  const host = (await query(`insert into hosts (household_id, name) values ($1, 'Tom') returning *`, [household.id])).rows[0];
  const offer = (await query(`insert into host_offers (host_id, shape, state, title) values ($1, 'anytime', 'live', 'A sourdough morning') returning *`, [host.id])).rows[0];
  const e = await repo.insertFaq({ offerId: offer.id, question: 'Is the kitchen up any stairs?', answer: 'Two steps, then one level.', askCount: 3, consentMemberId: member.id, consentAt: new Date(), attribution: 'anonymous' });
  await repo.bumpFaqAskCount(e.id);
  let faq = await repo.faqOf(offer.id);
  assert.equal(faq.length, 1);
  assert.equal(faq[0].ask_count, 4);
  assert.equal(faq[0].asked_by, null);
  assert.equal(await repo.faqPublishedBefore(offer.id, new Date()), 1);
  await repo.withdrawFaq(e.id);
  faq = await repo.faqOf(offer.id);
  assert.equal(faq.length, 0, 'withdrawn is unpublished');
  assert.equal((await repo.faqOf(offer.id, { includeWithdrawn: true })).length, 1);
});

test('preferences default to the design and a digest can be asked for', async () => {
  const { member } = await aHousehold(query, 'The Quiet');
  const me = { memberId: member.id, guestId: null };
  assert.equal(await repo.prefsOf('trip', '00000000-0000-0000-0000-000000000001', me), null, 'nothing written until the bell is touched');
  const p = await repo.upsertPrefs('trip', '00000000-0000-0000-0000-000000000001', me, { started: true, anchors: false, from_host: true, every_topic: true, mentions: true, digest: true });
  assert.equal(p.every_topic, true);
  assert.equal(p.anchors, false);
  const again = await repo.upsertPrefs('trip', '00000000-0000-0000-0000-000000000001', me, { started: true, anchors: true, from_host: true, every_topic: false, mentions: true, digest: false });
  assert.equal(again.every_topic, false);
  const s = await repo.upsertSettings(member.id, { digestAt: '08:30', quietFrom: '22:00', quietTo: '07:00' });
  assert.equal(String(s.digest_at).slice(0, 5), '08:30');
  const held = await repo.insertNotification({ memberId: member.id, kind: 'reply', text: 'x', holdUntil: new Date(Date.now() - 1000) });
  const due = await repo.dueNotifications();
  assert.equal(due.some((n) => n.id === held.id), true);
  await repo.markNotified([held.id], 'none');
  assert.equal((await repo.dueNotifications()).some((n) => n.id === held.id), false);
});

test('the old addresses still answer with the flat river a phone may be holding', () => {
  const topics = [
    { id: 'b', title: 'Later', body: null, at: '2026-10-02T10:00:00Z', mine: false, author: { name: 'Jon Lee', guest: false, initial: 'J', memberId: 'jon', guestId: null }, tag: { kind: 'trip', ref: 'trip', label: 'The whole trip' }, seenBy: 2 },
    { id: 'a', title: 'Is the crater walk alright?', body: 'For a nine-year-old.', at: '2026-10-01T10:00:00Z', mine: true, author: { name: 'Priya', guest: true, initial: 'P', memberId: null, guestId: 'priya' }, tag: { kind: 'stop', ref: 'osm:node/1', label: 'Etna' }, seenBy: 4 },
  ];
  const replies = [{ id: 'r1', topicId: 'a', body: 'Fine for a nine-year-old.', at: '2026-10-01T12:00:00Z', mine: false, author: { name: 'Sam Rivers', guest: false, initial: 'S', memberId: 'sam', guestId: null }, seenBy: 3 }];
  const m = legacyMessages(topics, replies);
  assert.deepEqual(m.map((x) => x.id), ['a', 'r1', 'b'], 'oldest first, replies in the river where they were said');
  assert.deepEqual(m[1].onStop, { venueRef: 'osm:node/1', label: 'Etna' }, 'a reply points where its question does');
  assert.equal(m[0].body, 'Is the crater walk alright?\n\nFor a nine-year-old.');
  assert.deepEqual(m[0].onStop, { venueRef: 'osm:node/1', label: 'Etna' });
  assert.equal(m[2].onStop, null, 'the whole-trip question carries no pointer');
  assert.equal(m[0].author.guest, true);
  const p = legacyPeople({ people: { members: [{ id: 'jon', name: 'Jon Lee', avatarUrl: null, isHost: true }], guests: [{ id: 'priya', name: 'Priya' }] } });
  assert.equal(p.count, 2);
  assert.equal(p.guests[0].contact, null, 'a contact is never in the river');
});

test('the river is ordered by instant, not by how a Date prints', () => {
  // node-postgres hands back Date objects, and String(new Date()) starts with the weekday:
  // "Mon Oct 12 2026" sorts before "Wed Oct 07 2026" as text, and after it as an instant.
  const topics = [
    { id: 'q', title: 'Q', body: null, at: new Date('2026-10-07T09:00:00Z'), mine: false, author: { name: 'A', guest: false, initial: 'A', memberId: 'a', guestId: null }, tag: { kind: 'trip', ref: 'trip', label: 'x' }, seenBy: 0 },
  ];
  const replies = [{ id: 'r', topicId: 'q', body: 'R', at: new Date('2026-10-12T09:00:00Z'), mine: false, author: { name: 'B', guest: false, initial: 'B', memberId: 'b', guestId: null }, seenBy: 0 }];
  assert.ok(String(replies[0].at) < String(topics[0].at), 'the string order would have put the reply first');
  assert.deepEqual(legacyMessages(topics, replies).map((m) => m.id), ['q', 'r']);
});

test('the group roster: a required item is everyone, an optional one is whoever said in, and a stop nobody was asked about is everyone', () => {
  const stops = [{ id: 's1', venue_ref: 'osm:cooking', day_id: 'd1' }, { id: 's2', venue_ref: 'osm:etna', day_id: 'd2' }, { id: 's3', venue_ref: 'osm:market', day_id: 'd2' }];
  const items = [{ id: 'i1', stop_id: 's1', required: false }, { id: 'i2', stop_id: 's2', required: true }];
  const participants = [{ id: 'kate' }, { id: 'jon' }];
  const states = [{ item_id: 'i1', participant_id: 'kate', status: 'paid' }, { item_id: 'i1', participant_id: 'jon', status: 'out' }];
  const roster = rosterFor({ items, states, participants, stops });
  assert.deepEqual([...roster.byParticipant.get('kate').stops], ['osm:cooking', 'osm:etna']);
  assert.deepEqual([...roster.byParticipant.get('jon').stops], ['osm:etna'], 'Jon said out of the cooking');
  assert.deepEqual([...roster.byParticipant.get('jon').days], ['d2']);
  const dayListed = new Set(['d1', 'd2']);
  const jon = { memberId: null, guestId: 'g-jon', on: { ...roster.byParticipant.get('jon'), listed: roster.listedStops, dayListed } };
  assert.equal(isOnAnchor(jon, { context_type: 'trip', tag_kind: 'stop', tag_ref: 'osm:cooking' }), false);
  assert.equal(isOnAnchor(jon, { context_type: 'trip', tag_kind: 'stop', tag_ref: 'osm:etna' }), true);
  assert.equal(isOnAnchor(jon, { context_type: 'trip', tag_kind: 'stop', tag_ref: 'osm:market' }), true, 'nobody was asked about the market, so nobody is off it');
  assert.equal(isOnAnchor(jon, { context_type: 'trip', tag_kind: 'day', tag_ref: 'd1' }), false, 'the only thing on day 1 is the cooking');
  assert.equal(isOnAnchor(jon, { context_type: 'trip', tag_kind: 'day', tag_ref: 'd2' }), true);
  assert.equal(isOnAnchor({ memberId: 'sam' }, { context_type: 'trip', tag_kind: 'stop', tag_ref: 'osm:cooking' }), true, 'no roster is on everything');
});

test('a question about an activity pings the people on it and not the ones who said out', () => {
  const listed = new Set(['osm:cooking']); const dayListed = new Set(['d1']);
  const on = (stops, days) => ({ stops: new Set(stops), days: new Set(days), listed, dayListed });
  const roster = [
    { memberId: 'sam', guestId: null, name: 'Sam', isHost: true },
    { memberId: null, guestId: 'g-kate', name: 'Kate', on: on(['osm:cooking'], ['d1']) },
    { memberId: null, guestId: 'g-jon', name: 'Jon', on: on([], []) },
  ];
  const t = { context_type: 'trip', tag_kind: 'stop', tag_ref: 'osm:cooking', audience: 'everyone', author_member_id: 'sam', author_guest_id: null, state: 'open' };
  const told = whoIsTold({ kind: 'topic', topic: t, actor: roster[0] }, { people: roster, prefsOf: () => null, followersOf: () => [], today: '2026-10-11' });
  assert.deepEqual(told.map((x) => x.person.name), ['Kate']);
});

test('a participant outside the household gets a guest row of their own, once', async () => {
  const { household, member } = await aHousehold(query, 'The Organisers');
  const trip = (await query(`insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at, start_date, end_date) values ($1, 'Sicily', 'Home', 51.4, -0.6, now(), now(), '2026-10-04', '2026-10-18') returning *`, [household.id])).rows[0];
  const group = (await query(`insert into trip_groups (trip_id, household_id, invite_token) values ($1, $2, 'inv-test') returning *`, [trip.id, household.id])).rows[0];
  const gp = (await query(`insert into group_participants (group_id, name, contact, contact_kind, token, joined_at) values ($1, 'Priya Guest', 'priya@example.com', 'email', 'pt-1', now()) returning *`, [group.id])).rows[0];
  const guestRepo = await import('../src/repositories/tripChat.js');
  const g1 = await guestRepo.guestForParticipant(trip.id, gp, 'tok-1');
  const g2 = await guestRepo.guestForParticipant(trip.id, gp, 'tok-2');
  assert.equal(g1.id, g2.id, 'the same row the second time');
  assert.equal(g1.status, 'joined');
  assert.equal(g1.participant_id, gp.id);
  // A member of the household who is also a participant is that member, not a guest — nothing to make.
  assert.ok(member.id);
});
