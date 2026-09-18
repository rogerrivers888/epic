/**
 * The chat module's tables (migration 086): topics, the flat replies inside
 * them, who has read what, reactions, follows, the host's request to publish
 * a private answer, the FAQ that answer lands in, and what each person has
 * asked to be told about.
 *
 * Nothing here is rented. Every row is somebody's own words or somebody's own
 * choice. `tag_label` is the household's name for the anchor, as
 * `trip_messages.venue_label` was before it.
 */

import { query } from '../db.js';

const on = (client) => (client ? (text, params) => client.query(text, params) : query);

/** `{ memberId, guestId }` → the two params every per-person table takes. */
const who = (me = {}) => [me.memberId ?? null, me.guestId ?? null];

// ---------------------------------------------------------------------------
// topics
// ---------------------------------------------------------------------------

const TOPIC_SELECT = `
  select t.*,
         mem.name as member_name, mem.avatar_url as member_avatar,
         g.name as guest_name,
         (select count(*)::int from chat_reads r where r.target_type = 'topic' and r.target_id = t.id) as seen_by,
         (select count(*)::int from chat_replies x where x.topic_id = t.id and not x.hidden) as reply_count,
         (select max(x.created_at) from chat_replies x where x.topic_id = t.id and not x.hidden) as last_reply_at,
         greatest(t.created_at, coalesce((select max(x.created_at) from chat_replies x where x.topic_id = t.id and not x.hidden), t.created_at)) as last_at
    from chat_topics t
    left join members mem on mem.id = t.author_member_id
    left join trip_guests g on g.id = t.author_guest_id`;

/** Every topic in a context, newest activity first. */
export async function topicsOf(contextType, contextId, { limit = 500 } = {}) {
  const { rows } = await query(
    // `hidden` is what a moderator's rejection leaves behind (contentQueue.js,
    // migration 147). It is not deleted, so the decision can be looked at again
    // — but nobody is shown it.
    `${TOPIC_SELECT} where t.context_type = $1 and t.context_id = $2 and not t.hidden order by last_at desc limit $3`,
    [contextType, contextId, limit],
  );
  return rows;
}

/** Every topic across several contexts of one kind — the host's inbox. */
export async function topicsAcross(contextType, contextIds, { limit = 1000 } = {}) {
  if (!contextIds.length) return [];
  const { rows } = await query(
    `${TOPIC_SELECT} where t.context_type = $1 and t.context_id = any($2::uuid[]) and not t.hidden order by last_at desc limit $3`,
    [contextType, contextIds, limit],
  );
  return rows;
}

/**
 * One topic, by its address.
 *
 * `hidden` here as well as in the lists: the filters were only on the listing
 * queries, so an existing link to a moderated conversation still opened it
 * (Codex, 17 Sep 2026). The back office reads `chat_topics` directly, so a
 * reviewer can still see what they decided about.
 *
 * `withHidden` is for the author's own edit. Hiding it from them as well meant
 * the correction path could never be reached: they could not fetch the thing
 * they were being asked to rewrite (Codex, 18 Sep 2026).
 */
export async function topicById(id, { withHidden = false } = {}) {
  const { rows } = await query(
    `${TOPIC_SELECT} where t.id = $1 and ($2 or not t.hidden)`, [id, withHidden]);
  return rows[0] ?? null;
}

export async function insertTopic(t, client) {
  const { rows } = await on(client)(
    `insert into chat_topics (context_type, context_id, tag_kind, tag_ref, tag_label, audience, occurrence, author_member_id, author_guest_id, title, body, state)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [t.contextType, t.contextId, t.tagKind, t.tagRef ?? null, t.tagLabel ?? null, t.audience ?? 'everyone', t.occurrence ?? null,
      t.memberId ?? null, t.guestId ?? null, t.title, t.body ?? null, t.state ?? 'open'],
  );
  return rows[0];
}

/** The asker's own edits: the question, its detail, its tag, its audience. */
export async function updateTopic(id, patch, client) {
  const sets = [];
  const params = [id];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  // Different words send it back to be looked at; pinning it does not, and nor
  // does changing its tag (migration 166). Where somebody had already decided
  // about the old words, the new ones wait out of sight — otherwise the way to
  // publish something abusive is to publish something else and edit it.
  //
  // The edit form sends the title and the body every time, so testing for their
  // presence marked a change of tag or audience as a rewrite, and an approved
  // question vanished without a word of it having changed (Codex, 18 Sep 2026,
  // two rounds). The comparison reads the row as it was: every SET in one
  // statement sees the old values.
  //
  if (patch.title !== undefined || patch.body !== undefined) {
    const changed = [];
    if (patch.title !== undefined) { params.push(patch.title); changed.push(`title is distinct from $${params.length}`); }
    if (patch.body !== undefined) { params.push(patch.body); changed.push(`body is distinct from $${params.length}`); }
    const different = `(${changed.join(' or ')})`;
    sets.push(`rewritten_at = case when ${different} then now() else rewritten_at end`);
    sets.push(`hidden = case
      when ${different}
       and exists (
         select 1 from content_queue q
          where q.subject_type = 'chat_topic' and q.subject_id = chat_topics.id::text and q.state <> 'waiting')
      then true else chat_topics.hidden end`);
  }
  if (patch.title !== undefined) set('title', patch.title);
  if (patch.body !== undefined) set('body', patch.body);
  if (patch.tagKind !== undefined) set('tag_kind', patch.tagKind);
  if (patch.tagRef !== undefined) set('tag_ref', patch.tagRef);
  if (patch.tagLabel !== undefined) set('tag_label', patch.tagLabel);
  if (patch.audience !== undefined) set('audience', patch.audience);
  if (patch.pinned !== undefined) set('pinned', patch.pinned);
  if (patch.state !== undefined) set('state', patch.state);
  if (patch.answerReplyId !== undefined) set('answer_reply_id', patch.answerReplyId);
  if (!sets.length) return topicById(id);
  sets.push('updated_at = now()');
  const { rows } = await on(client)(`update chat_topics set ${sets.join(', ')} where id = $1 returning *`, params);
  return rows[0] ?? null;
}

export async function deleteTopic(id) {
  const { rowCount } = await query('delete from chat_topics where id = $1', [id]);
  return rowCount;
}

/** How many topics sit on each stop of a trip, for the Ask tab's own count. */
export async function askCounts(tripId) {
  const { rows } = await query(
    `select tag_ref, count(*)::int as n from chat_topics
      where context_type = 'trip' and context_id = $1 and tag_kind = 'stop' and not hidden group by tag_ref`,
    [tripId],
  );
  return new Map(rows.map((r) => [r.tag_ref, r.n]));
}

// ---------------------------------------------------------------------------
// replies
// ---------------------------------------------------------------------------

const REPLY_SELECT = `
  select r.*,
         mem.name as member_name, mem.avatar_url as member_avatar,
         g.name as guest_name,
         (select count(*)::int from chat_reads x where x.target_type = 'reply' and x.target_id = r.id) as seen_by
    from chat_replies r
    left join members mem on mem.id = r.author_member_id
    left join trip_guests g on g.id = r.author_guest_id`;

export async function repliesOf(topicId) {
  // `hidden` is a moderator's rejection (contentQueue.js, migration 148).
  const { rows } = await query(`${REPLY_SELECT} where r.topic_id = $1 and not r.hidden order by r.created_at`, [topicId]);
  return rows;
}

/** The replies of every topic in a context, in one read, for the filters that look inside them. */
export async function repliesAcross(topicIds) {
  if (!topicIds.length) return [];
  const { rows } = await query(`${REPLY_SELECT} where r.topic_id = any($1::uuid[]) and not r.hidden order by r.created_at`, [topicIds]);
  return rows;
}

/**
 * One reply, by its id.
 *
 * The same rule, and it matters more here: a known rejected reply id could be
 * quoted, marked as the answer, or lifted into the public FAQ (Codex, 17 Sep
 * 2026).
 */
export async function replyById(id) {
  const { rows } = await query(`${REPLY_SELECT} where r.id = $1 and not r.hidden`, [id]);
  return rows[0] ?? null;
}

export async function insertReply(r, client) {
  const { rows } = await on(client)(
    `insert into chat_replies (topic_id, author_member_id, author_guest_id, body, quotes_reply_id)
     values ($1,$2,$3,$4,$5) returning *`,
    [r.topicId, r.memberId ?? null, r.guestId ?? null, r.body, r.quotesReplyId ?? null],
  );
  return rows[0];
}

/** Only one reply holds the answer. */
export async function setAnswer(topicId, replyId, client) {
  const q = on(client);
  await q('update chat_replies set is_answer = false where topic_id = $1', [topicId]);
  if (replyId) await q('update chat_replies set is_answer = true where id = $1 and topic_id = $2', [replyId, topicId]);
  const { rows } = await q(
    `update chat_topics set answer_reply_id = $2, state = case when $2::uuid is null then 'open' else 'answered' end, updated_at = now()
      where id = $1 and state <> 'notice' returning *`,
    [topicId, replyId ?? null],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// seen by
// ---------------------------------------------------------------------------

/** Opening a topic marks it, and every reply in it, seen by this person. */
export async function markTopicRead(topicId, me) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return 0;
  const a = await query(
    `insert into chat_reads (target_type, target_id, member_id, guest_id) values ('topic', $1, $2, $3) on conflict do nothing`,
    [topicId, memberId, guestId],
  );
  const b = await query(
    `insert into chat_reads (target_type, target_id, member_id, guest_id)
     select 'reply', r.id, $2, $3 from chat_replies r where r.topic_id = $1
     on conflict do nothing`,
    [topicId, memberId, guestId],
  );
  return a.rowCount + b.rowCount;
}

/** Everything in a context, seen — the old "chat/read" endpoint's meaning. */
export async function markContextRead(contextType, contextId, me) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return 0;
  const a = await query(
    `insert into chat_reads (target_type, target_id, member_id, guest_id)
     select 'topic', t.id, $3, $4 from chat_topics t where t.context_type = $1 and t.context_id = $2
     on conflict do nothing`,
    [contextType, contextId, memberId, guestId],
  );
  const b = await query(
    `insert into chat_reads (target_type, target_id, member_id, guest_id)
     select 'reply', r.id, $3, $4 from chat_replies r join chat_topics t on t.id = r.topic_id
      where t.context_type = $1 and t.context_id = $2
     on conflict do nothing`,
    [contextType, contextId, memberId, guestId],
  );
  return a.rowCount + b.rowCount;
}

/** Which topics this person has opened, and how many replies they have not seen in each. */
export async function unreadOf(contextType, contextId, me) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return { topics: new Set(), replies: new Map(), total: 0 };
  const { rows } = await query(
    `select t.id,
            exists (select 1 from chat_reads r where r.target_type = 'topic' and r.target_id = t.id
                      and (($3::uuid is not null and r.member_id = $3) or ($4::uuid is not null and r.guest_id = $4))) as opened,
            (select count(*)::int from chat_replies x where x.topic_id = t.id and not x.hidden and not exists (
               select 1 from chat_reads r where r.target_type = 'reply' and r.target_id = x.id
                  and (($3::uuid is not null and r.member_id = $3) or ($4::uuid is not null and r.guest_id = $4)))) as unread_replies
       from chat_topics t where t.context_type = $1 and t.context_id = $2 and not t.hidden`,
    [contextType, contextId, memberId, guestId],
  );
  const opened = new Set(rows.filter((r) => r.opened).map((r) => r.id));
  const replies = new Map(rows.map((r) => [r.id, r.unread_replies]));
  const total = rows.reduce((n, r) => n + (r.opened ? 0 : 1) + r.unread_replies, 0);
  return { opened, replies, total };
}

// ---------------------------------------------------------------------------
// reactions
// ---------------------------------------------------------------------------

/** Every reaction on these targets, so the caller can group them per target. */
export async function reactionsOn(targetIds) {
  if (!targetIds.length) return [];
  const { rows } = await query(
    'select target_type, target_id, member_id, guest_id, emoji from chat_reactions where target_id = any($1::uuid[])',
    [targetIds],
  );
  return rows;
}

/** Toggle: one row per person per emoji. Returns true when it is now on. */
export async function toggleReaction({ targetType, targetId, emoji }, me) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return false;
  const { rowCount } = await query(
    `delete from chat_reactions where target_type = $1 and target_id = $2 and emoji = $3
        and (($4::uuid is not null and member_id = $4) or ($5::uuid is not null and guest_id = $5))`,
    [targetType, targetId, emoji, memberId, guestId],
  );
  if (rowCount) return false;
  await query(
    'insert into chat_reactions (target_type, target_id, member_id, guest_id, emoji) values ($1,$2,$3,$4,$5) on conflict do nothing',
    [targetType, targetId, memberId, guestId, emoji],
  );
  return true;
}

/** This person's own most-used emoji, for the picker's second row. */
export async function mostUsedBy(me, limit = 24) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return [];
  const { rows } = await query(
    `select emoji, count(*)::int as n from chat_reactions
      where (($1::uuid is not null and member_id = $1) or ($2::uuid is not null and guest_id = $2))
      group by emoji order by n desc, max(created_at) desc limit $3`,
    [memberId, guestId, limit],
  );
  return rows.map((r) => r.emoji);
}

// ---------------------------------------------------------------------------
// follows
// ---------------------------------------------------------------------------

export async function followersOf(topicId) {
  const { rows } = await query('select member_id, guest_id, source from chat_follows where topic_id = $1', [topicId]);
  return rows.map((r) => ({ memberId: r.member_id, guestId: r.guest_id, source: r.source }));
}

export async function followsIn(topicIds, me) {
  const [memberId, guestId] = who(me);
  if (!topicIds.length || (!memberId && !guestId)) return new Set();
  const { rows } = await query(
    `select topic_id from chat_follows where topic_id = any($1::uuid[])
        and (($2::uuid is not null and member_id = $2) or ($3::uuid is not null and guest_id = $3))`,
    [topicIds, memberId, guestId],
  );
  return new Set(rows.map((r) => r.topic_id));
}

/** Following is per topic; an existing follow keeps its first reason. */
export async function follow(topicId, me, source, client) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return;
  await on(client)(
    'insert into chat_follows (topic_id, member_id, guest_id, source) values ($1,$2,$3,$4) on conflict do nothing',
    [topicId, memberId, guestId, source],
  );
}

export async function unfollow(topicId, me) {
  const [memberId, guestId] = who(me);
  await query(
    `delete from chat_follows where topic_id = $1 and (($2::uuid is not null and member_id = $2) or ($3::uuid is not null and guest_id = $3))`,
    [topicId, memberId, guestId],
  );
}

// ---------------------------------------------------------------------------
// publishing a private answer
// ---------------------------------------------------------------------------

export async function insertPublishRequest({ topicId, replyId, requestedBy, destination }, client) {
  const { rows } = await on(client)(
    `insert into chat_publish_requests (topic_id, reply_id, requested_by_member_id, destination) values ($1,$2,$3,$4)
     on conflict (reply_id) do update set destination = excluded.destination returning *`,
    [topicId, replyId, requestedBy ?? null, destination],
  );
  return rows[0];
}

export async function publishRequestsOf(topicId) {
  const { rows } = await query('select * from chat_publish_requests where topic_id = $1 order by created_at', [topicId]);
  return rows;
}

export async function publishRequestById(id) {
  const { rows } = await query('select * from chat_publish_requests where id = $1', [id]);
  return rows[0] ?? null;
}

export async function decidePublishRequest(id, decision, client) {
  const { rows } = await on(client)(
    'update chat_publish_requests set decision = $2, decided_at = now() where id = $1 returning *',
    [id, decision],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// the FAQ
// ---------------------------------------------------------------------------

export async function faqOf(offerId, { includeWithdrawn = false } = {}) {
  const { rows } = await query(
    `select * from chat_faq_entries where offer_id = $1 ${includeWithdrawn ? '' : 'and withdrawn_at is null'} order by ask_count desc, published_at desc`,
    [offerId],
  );
  return rows;
}

export async function faqById(id) {
  const { rows } = await query('select * from chat_faq_entries where id = $1', [id]);
  return rows[0] ?? null;
}

export async function insertFaq(e, client) {
  const { rows } = await on(client)(
    `insert into chat_faq_entries (offer_id, question, answer, ask_count, source_topic_id, source_reply_id, consent_member_id, consent_guest_id, consent_at, attribution, asked_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [e.offerId, e.question, e.answer, e.askCount ?? 1, e.sourceTopicId ?? null, e.sourceReplyId ?? null,
      e.consentMemberId ?? null, e.consentGuestId ?? null, e.consentAt ?? null, e.attribution ?? 'anonymous', e.askedBy ?? null],
  );
  return rows[0];
}

export async function bumpFaqAskCount(id, client) {
  await on(client)('update chat_faq_entries set ask_count = ask_count + 1 where id = $1', [id]);
}

export async function withdrawFaq(id) {
  // The host's own doing, said so — a rejection reversed puts back what
  // moderation withdrew and never what the host did (migration 175).
  const { rows } = await query(
    `update chat_faq_entries set withdrawn_at = now(), withdrawn_by = 'host'
      where id = $1 and withdrawn_at is null returning *`, [id]);
  return rows[0] ?? null;
}

/** How many FAQ entries were already published when a booking was made — "three answers came with this booking". */
export async function faqPublishedBefore(offerId, at) {
  const { rows } = await query(
    'select count(*)::int as n from chat_faq_entries where offer_id = $1 and withdrawn_at is null and published_at <= $2',
    [offerId, at],
  );
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// what you get told about
// ---------------------------------------------------------------------------

export async function prefsOf(contextType, contextId, me) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return null;
  const { rows } = await query(
    `select * from chat_prefs where context_type = $1 and context_id = $2
        and (($3::uuid is not null and member_id = $3) or ($4::uuid is not null and guest_id = $4))`,
    [contextType, contextId, memberId, guestId],
  );
  return rows[0] ?? null;
}

/** Everyone's prefs in a context, keyed by person, for the scoping rule. */
export async function prefsAcross(contextType, contextId) {
  const { rows } = await query('select * from chat_prefs where context_type = $1 and context_id = $2', [contextType, contextId]);
  return rows;
}

export async function upsertPrefs(contextType, contextId, me, p) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return null;
  const { rows } = await query(
    `insert into chat_prefs (member_id, guest_id, context_type, context_id, started, anchors, from_host, every_topic, mentions, digest)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (member_id, context_type, context_id) where member_id is not null do update
       set started = excluded.started, anchors = excluded.anchors, from_host = excluded.from_host,
           every_topic = excluded.every_topic, mentions = excluded.mentions, digest = excluded.digest, updated_at = now()
     returning *`,
    [memberId, guestId, contextType, contextId, p.started, p.anchors, p.from_host, p.every_topic, p.mentions, p.digest],
  );
  if (rows[0]) return rows[0];
  // A guest's row conflicts on the other partial index, which `on conflict` above cannot name at the same time.
  const g = await query(
    `update chat_prefs set started = $4, anchors = $5, from_host = $6, every_topic = $7, mentions = $8, digest = $9, updated_at = now()
      where guest_id = $1 and context_type = $2 and context_id = $3 returning *`,
    [guestId, contextType, contextId, p.started, p.anchors, p.from_host, p.every_topic, p.mentions, p.digest],
  );
  return g.rows[0] ?? null;
}

/** Every context this person has ever set the bell on. */
export async function prefsForPerson(me) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return [];
  const { rows } = await query(
    'select * from chat_prefs where (($1::uuid is not null and member_id = $1) or ($2::uuid is not null and guest_id = $2))',
    [memberId, guestId],
  );
  return rows;
}

export async function settingsOf(memberId) {
  if (!memberId) return null;
  const { rows } = await query('select * from chat_settings where member_id = $1', [memberId]);
  return rows[0] ?? null;
}

export async function upsertSettings(memberId, s) {
  const { rows } = await query(
    `insert into chat_settings (member_id, digest_at, quiet_from, quiet_to) values ($1,$2,$3,$4)
     on conflict (member_id) do update set digest_at = excluded.digest_at, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, updated_at = now()
     returning *`,
    [memberId, s.digestAt ?? '18:00', s.quietFrom ?? null, s.quietTo ?? null],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// notifications
// ---------------------------------------------------------------------------

export async function insertNotification(n, client) {
  const { rows } = await on(client)(
    `insert into chat_notifications (member_id, guest_id, topic_id, reply_id, kind, text, hold_until, sent_at, channel)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [n.memberId ?? null, n.guestId ?? null, n.topicId ?? null, n.replyId ?? null, n.kind, n.text, n.holdUntil ?? null, n.sentAt ?? null, n.channel ?? null],
  );
  return rows[0];
}

/** Held notifications whose time has come, oldest first, with the person's contact. */
export async function dueNotifications(limit = 200) {
  const { rows } = await query(
    `select n.*, a.email as member_email, a.mobile as member_mobile, g.contact as guest_contact, g.contact_kind as guest_contact_kind
       from chat_notifications n
       left join lateral (select email, mobile from accounts where member_id = n.member_id order by created_at limit 1) a on true
       left join trip_guests g on g.id = n.guest_id
      where n.sent_at is null and n.hold_until is not null and n.hold_until <= now()
      order by n.hold_until limit $1`,
    [limit],
  );
  return rows;
}

export async function markNotified(ids, channel) {
  if (!ids.length) return;
  await query('update chat_notifications set sent_at = now(), channel = $2 where id = any($1::uuid[])', [ids, channel]);
}

/** How much this person has said lately, for the rate limit. */
export async function recentCounts(me) {
  const [memberId, guestId] = who(me);
  if (!memberId && !guestId) return { lastHour: 0, lastDay: 0 };
  const { rows } = await query(
    `select
       (select count(*)::int from chat_topics where created_at > now() - interval '1 hour' and (($1::uuid is not null and author_member_id = $1) or ($2::uuid is not null and author_guest_id = $2)))
       + (select count(*)::int from chat_replies where created_at > now() - interval '1 hour' and (($1::uuid is not null and author_member_id = $1) or ($2::uuid is not null and author_guest_id = $2))) as last_hour,
       (select count(*)::int from chat_topics where created_at > now() - interval '1 day' and (($1::uuid is not null and author_member_id = $1) or ($2::uuid is not null and author_guest_id = $2)))
       + (select count(*)::int from chat_replies where created_at > now() - interval '1 day' and (($1::uuid is not null and author_member_id = $1) or ($2::uuid is not null and author_guest_id = $2))) as last_day`,
    [memberId, guestId],
  );
  return { lastHour: rows[0]?.last_hour ?? 0, lastDay: rows[0]?.last_day ?? 0 };
}

// ---------------------------------------------------------------------------
// reports
// ---------------------------------------------------------------------------

export async function insertReport({ topicId, replyId, reason }, me) {
  const [memberId, guestId] = who(me);
  const { rows } = await query(
    'insert into chat_reports (topic_id, reply_id, member_id, guest_id, reason) values ($1,$2,$3,$4,$5) returning *',
    [topicId, replyId ?? null, memberId, guestId, reason ?? null],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// who is in an offer's conversation
// ---------------------------------------------------------------------------

/**
 * Everyone booked on an offer — one row per household member, with the
 * occurrences that household is booked on — plus the host's household. The
 * audience for "everyone booked on that date".
 */
export async function offerPeople(offerId) {
  const { rows } = await query(
    `select m.id as member_id, m.name, m.is_minor, m.avatar_url, m.household_id,
            array_remove(array_agg(distinct b.occurrence), null) as occurrences,
            bool_or(h.household_id = m.household_id) as is_host,
            min(b.created_at) as booked_at
       from host_offers o
       join hosts h on h.id = o.host_id
       left join experience_bookings b on b.offer_id = o.id and b.state in ('pending', 'confirmed', 'attended')
       join members m on m.household_id = b.household_id or m.household_id = h.household_id
      where o.id = $1
      group by m.id, m.name, m.is_minor, m.avatar_url, m.household_id`,
    [offerId],
  );
  return rows;
}

/** The offers of a host, in one read, for the inbox. */
export async function offersForInbox(hostId) {
  const { rows } = await query(
    `select id, title, shape, state, starts_on from host_offers where host_id = $1 and state <> 'draft' order by created_at desc`,
    [hostId],
  );
  return rows;
}
