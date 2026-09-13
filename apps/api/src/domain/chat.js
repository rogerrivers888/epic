/**
 * The chat module's rules (owner, 13 Sep 2026 — "Supporting docs/Chat screens").
 *
 * Not a chat with threads: a list of questions that happens to be a chat. A
 * topic is a question or a notice, tagged to one thing and visible to one
 * audience; replies are flat inside it; the host or organiser marks one reply
 * as the answer. Everything in this file is pure — who may see a topic, what
 * the two filters produce, who gets told, whether two questions are the same
 * question — so that `test/chat.test.js` can pin each rule without a database.
 *
 * Three findings from the research decided the shape, and they are worth
 * keeping in view when changing anything here:
 *
 *   1. Big rooms stop being conversations. Forty people in one river is a
 *      dead chat, not a busy one. So the default view is *questions*, not
 *      everything, and the header line says what the filters produced.
 *   2. Deep threading fails; two levels survive. A reply can never be
 *      replied to. An inline reply is a rendered quote, not a child.
 *   3. The prize of threading is notification scoping. Only the people who
 *      started or joined something are told about it — `whoIsTold` is that
 *      mechanism, designed rather than left to defaults.
 */

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

export const CONTEXTS = ['trip', 'offer'];
export const TAG_KINDS = ['stop', 'day', 'trip', 'offer_aspect'];
export const AUDIENCES = ['everyone', 'host_only'];
export const STATES = ['open', 'answered', 'notice'];
export const FOLLOW_SOURCES = ['authored', 'replied', 'tag', 'mention', 'manual'];
export const ATTRIBUTIONS = ['anonymous', 'named'];

/** The Showing dropdown (D4): one enum. `waiting` and `answered` narrow `questions`. */
export const SHOWING = ['all', 'questions', 'waiting', 'answered', 'notices', 'mine', 'replies_to_me', 'private'];
export const DEFAULT_SHOWING = 'questions';

/** The trip-level anchors, in the order About (D5) lists them. */
export const TRIP_ANCHORS = [
  { ref: 'trip', label: 'The whole trip' },
  { ref: 'travel', label: 'Getting there' },
  { ref: 'stay', label: 'Where we are staying' },
];

/** An offer's aspects — what a question about a hosted thing tends to be about. */
export const OFFER_ASPECTS = [
  { ref: 'offer', label: 'The whole thing' },
  { ref: 'day', label: 'On the day' },
  { ref: 'kit', label: 'What to bring' },
  { ref: 'where', label: 'Getting there' },
  { ref: 'access', label: 'Access' },
  { ref: 'money', label: 'Money and booking' },
];

/** The fixed top row of the reaction picker (E3): six on one tap, no search. */
export const QUICK_REACTIONS = ['😂', '❤️', '👍', '🙏', '😮', '😢'];

/** The picker's "most used on Epic" set, shown until the person has a history of their own. */
export const COMMON_REACTIONS = ['💯', '🔥', '🎉', '👏', '🙌', '😍', '🤩', '😅', '🤣', '😭', '🥰', '😎', '🤔', '👀', '✅', '❌', '🙋', '🍝', '🍷', '☀️', '🌊', '🚗', '⛰️', '📸'];

/**
 * Airbnb's own caps, copied (README §14): 25 messages a day and 10 an hour.
 * Sits beside the redaction rule rather than in a second place.
 */
export const RATE_LIMIT = { perHour: 10, perDay: 25 };

// ---------------------------------------------------------------------------
// people
// ---------------------------------------------------------------------------

/** Two people are the same person: a member id or a guest id, never both. */
export const samePerson = (a, b) => Boolean(a && b && (
  (a.memberId && a.memberId === b.memberId) || (a.guestId && a.guestId === b.guestId)
));

/** Who wrote something, as `{ memberId, guestId }`, from a row. */
export const authorOf = (row) => ({ memberId: row.author_member_id ?? null, guestId: row.author_guest_id ?? null });

// ---------------------------------------------------------------------------
// who may see what
// ---------------------------------------------------------------------------

/**
 * Whether one person may see a topic.
 *
 * `everyone` is everyone in the context. `host_only` is the asker and whoever
 * holds the host role — the organiser on a trip, the host on an offer. A
 * guest on a share link sees `everyone` topics only, and never a notice that
 * was scoped to the organiser (README §12).
 */
export function canSee(topic, me) {
  if (!topic) return false;
  if (topic.audience === 'everyone') return true;
  if (!me) return false;
  if (me.guestId) return false;
  if (me.isHost) return true;
  return samePerson(authorOf(topic), me);
}

/** The ellipsis (E2), grouped by who can do it. A link-guest sees only the first group. */
export function menuFor(topic, me, { following = false } = {}) {
  const everyone = [
    following ? { key: 'unfollow', label: 'Stop following this question', hint: 'You will still see it here; you just will not be told about new replies.' }
      : { key: 'follow', label: 'Follow this question', hint: 'Get new replies. Replying follows it automatically.' },
    { key: 'link', label: 'Copy link to this question' },
    { key: 'seen', label: 'Who has seen it', hint: `${topic.seenBy ?? 0}${topic.audienceCount ? ` of ${topic.audienceCount}` : ''} have opened this.` },
  ];
  const groups = [{ title: 'Everyone', items: everyone }];
  if (!me || me.guestId) return groups;
  if (samePerson(authorOf(topic), me)) {
    groups.push({ title: `Because you asked it`, items: [
      { key: 'edit', label: 'Edit the question', hint: 'The tag and who can see it, too.' },
    ] });
  }
  if (me.isHost) {
    const items = [];
    if (topic.state !== 'notice') items.push({ key: 'answer', label: 'Mark a reply as the answer', hint: 'Pins it to the top for everyone.' });
    items.push(topic.pinned ? { key: 'unpin', label: 'Take it off the top of the list' } : { key: 'pin', label: 'Pin to the top of the list' });
    groups.push({ title: me.contextType === 'offer' ? 'Because you are the host' : 'Because you are the organiser', items });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// the two filters (D3–D5)
// ---------------------------------------------------------------------------

const isQuestion = (t) => t.state !== 'notice';
const isMine = (t, me) => samePerson(authorOf(t), me) || (t.replies ?? []).some((r) => samePerson(authorOf(r), me));
const repliesToMe = (t, me) => {
  if (!me) return false;
  const mine = samePerson(authorOf(t), me);
  return (t.replies ?? []).some((r) => !samePerson(authorOf(r), me) && (
    mine
    || (r.quotes_reply_id && (t.replies ?? []).some((q) => q.id === r.quotes_reply_id && samePerson(authorOf(q), me)))
  ));
};

/** Whether one topic passes one Showing value. */
export function matchesShowing(topic, showing, me) {
  switch (showing) {
    case 'all': return true;
    case 'questions': return isQuestion(topic);
    case 'waiting': return isQuestion(topic) && topic.state === 'open';
    case 'answered': return isQuestion(topic) && topic.state === 'answered';
    case 'notices': return topic.state === 'notice';
    case 'mine': return isMine(topic, me);
    case 'replies_to_me': return repliesToMe(topic, me);
    case 'private': return topic.audience === 'host_only';
    default: return true;
  }
}

/** Whether one topic is about one anchor. `about` is `kind:ref` or null for anything. */
export function matchesAbout(topic, about) {
  if (!about) return true;
  const [kind, ...rest] = about.split(':');
  const ref = rest.join(':');
  return topic.tag_kind === kind && String(topic.tag_ref ?? '') === ref;
}

/**
 * The list, filtered and ordered: pinned first, then waiting before answered
 * ("Waiting first" on D3), then newest activity first.
 */
export function filterTopics(topics, { showing = DEFAULT_SHOWING, about = null } = {}, me) {
  const out = topics.filter((t) => canSee(t, me) && matchesShowing(t, showing, me) && matchesAbout(t, about));
  const rank = (t) => (t.pinned ? 0 : t.state === 'open' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || String(b.last_at ?? b.created_at).localeCompare(String(a.last_at ?? a.created_at)));
}

/** The counts on the Showing rows (D4), computed over what this person may see. */
export function showingCounts(topics, me, about = null) {
  const visible = topics.filter((t) => canSee(t, me) && matchesAbout(t, about));
  return Object.fromEntries(SHOWING.map((s) => [s, visible.filter((t) => matchesShowing(t, s, me)).length]));
}

/**
 * The About dropdown (D5): the context-level anchors always, then only the
 * anchors that have at least one topic — never the full day list. Search
 * covers everything, which is the caller's job with `allAnchors`.
 */
export function aboutOptions(topics, { levelAnchors, allAnchors }, me, showing = DEFAULT_SHOWING) {
  const visible = topics.filter((t) => canSee(t, me) && matchesShowing(t, showing, me));
  const count = (kind, ref) => visible.filter((t) => t.tag_kind === kind && String(t.tag_ref ?? '') === String(ref)).length;
  const level = levelAnchors.map((a) => ({ key: `${a.kind}:${a.ref}`, kind: a.kind, ref: a.ref, label: a.label, count: count(a.kind, a.ref) }));
  const rest = allAnchors
    .filter((a) => !levelAnchors.some((l) => l.kind === a.kind && String(l.ref) === String(a.ref)))
    .map((a) => ({ key: `${a.kind}:${a.ref}`, kind: a.kind, ref: a.ref, label: a.label, sub: a.sub ?? null, date: a.date ?? null, count: count(a.kind, a.ref) }));
  return {
    anything: visible.length,
    level,
    withTopics: rest.filter((a) => a.count > 0),
    withTopicsOf: rest.length,
    all: rest,
  };
}

/** "24 questions · 6 waiting on an answer" — the header line under the dropdowns (D3). */
export function headerLine(counts, showing, filtered) {
  const n = filtered;
  const word = (one, many) => `${n} ${n === 1 ? one : many}`;
  switch (showing) {
    case 'all': return `${word('thing', 'things')}${counts.waiting ? ` · ${counts.waiting} waiting on an answer` : ''}`;
    case 'questions': return `${word('question', 'questions')}${counts.waiting ? ` · ${counts.waiting} waiting on an answer` : ''}`;
    case 'waiting': return `${word('question', 'questions')} waiting on an answer`;
    case 'answered': return `${word('question', 'questions')} answered`;
    case 'notices': return word('notice', 'notices');
    case 'mine': return `${word('thing', 'things')} you asked or replied to`;
    case 'replies_to_me': return `${word('reply', 'replies')} to you`;
    case 'private': return `${word('private question', 'private questions')}`;
    default: return String(n);
  }
}

// ---------------------------------------------------------------------------
// the same question, asked again (C5, C7, D1)
// ---------------------------------------------------------------------------

const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'am', 'i', 'we', 'my', 'our', 'me', 'us', 'you', 'your', 'it', 'its', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'if', 'any', 'there', 'be', 'this', 'that', 'please', 'hi', 'hello', 'thanks', 'just', 'some', 'up', 'have', 'has', 'need', 'get', 'go', 'take', 'bring']);

/** Light stemming: enough to make "stairs" and "stair", "tickets" and "ticket" agree. */
const stem = (w) => w.replace(/(ing|ers|er|ies|es|s)$/, (m) => (m === 'ies' ? 'y' : ''));

/** The words that carry a question, lowercased, stopped and stemmed. */
export function questionTerms(text) {
  return String(text ?? '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w)).map(stem).filter(Boolean);
}

/** How alike two questions are, 0..1 — Jaccard over their terms. */
export function questionSimilarity(a, b) {
  const A = new Set(questionTerms(a));
  const B = new Set(questionTerms(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both += 1;
  return both / (A.size + B.size - both);
}

/** Whether two questions are the same question, for "Asked 3 times". */
export const DUPLICATE_AT = 0.5;
export const isNearDuplicate = (a, b) => questionSimilarity(a, b) >= DUPLICATE_AT;

/** How many of these questions are this question — itself included, so a first ask is 1. */
export function askCount(question, others) {
  return others.reduce((n, q) => n + (isNearDuplicate(question, q) ? 1 : 0), 0) || 1;
}

/** The nudge to answer it once, for good (C5, D1): three or more. */
export const SUGGEST_PUBLISH_AT = 3;

/**
 * The question as it is published: the host's words answer a normalised
 * question, never the guest's own wording, which is where identifying detail
 * lives. Trims a greeting, keeps one sentence, ends it with a question mark.
 */
export function normaliseQuestion(text) {
  let q = String(text ?? '').trim().replace(/\s+/g, ' ');
  q = q.replace(/^(hi|hello|hey|thanks|thank you|please)[,!. ]+/i, '');
  // The first sentence that asks something; failing that, the first sentence.
  const sentences = q.split(/(?<=[.?!])\s+/).filter(Boolean);
  const asked = sentences.find((s) => s.endsWith('?')) ?? sentences[0] ?? q;
  q = asked.replace(/[.!]+$/, '').trim();
  // "my son has a nut allergy — is the kitchen a problem" → drop the personal lead-in before a dash.
  if (/[—–-]\s/.test(q)) { const tail = q.split(/\s[—–-]\s/).pop().trim(); if (tail.length > 12) q = tail; }
  if (!q) return '';
  q = q[0].toUpperCase() + q.slice(1);
  return q.endsWith('?') ? q : `${q}?`;
}

// ---------------------------------------------------------------------------
// who gets told (C9)
// ---------------------------------------------------------------------------

/** The defaults are the design. */
export const DEFAULT_PREFS = { started: true, anchors: true, from_host: true, every_topic: false, mentions: true, digest: false };

/** "@Kate" — the people named in a message, matched by first name. */
export function mentionsIn(text, people) {
  const found = [];
  const names = String(text ?? '').match(/@([A-Za-z][A-Za-z'-]*)/g) ?? [];
  for (const raw of names) {
    const first = raw.slice(1).toLowerCase();
    for (const p of people) {
      if (String(p.name ?? '').trim().split(/\s+/)[0].toLowerCase() === first && !found.some((f) => samePerson(f, p))) found.push(p);
    }
  }
  return found;
}

/** A person is "on" an anchor: on a stop or day if they are on the trip (Epic has no per-day roster yet); on an offer date if booked on it. */
export function isOnAnchor(person, topic) {
  if (!person) return false;
  if (topic.context_type === 'offer') {
    if (!topic.occurrence) return true;
    return !person.occurrences || person.occurrences.includes(topic.occurrence);
  }
  return true;
}

/** Whether a notice from the host or organiser bypasses every preference: on the day of the event only. */
export function isDayOf(topic, today) {
  if (!topic.tag_date && !topic.occurrence && !topic.context_dates) return false;
  const day = topic.tag_date ?? (topic.occurrence ? String(topic.occurrence).slice(0, 10) : null);
  if (day) return day === today;
  const { start, end } = topic.context_dates;
  return Boolean(start && end && start <= today && today <= end);
}

/**
 * Who is told about an event, and why. Pure: the people, their prefs and
 * their follows are handed in; the answer is a list of `{ person, reason }`.
 *
 * event: { kind: 'topic'|'reply'|'reaction'|'answer'|'notice', topic, reply?, actor, mentions? }
 *
 *   · A reaction never notifies the topic — only the author of the reacted-to
 *     message is told.
 *   · A reply goes to the topic's followers (started/replied), and to anybody
 *     mentioned in it.
 *   · A new topic goes to people who asked for every topic, and to people on
 *     its anchor who asked for anchors — except that a private question goes
 *     only to the host.
 *   · A notice from the host or organiser goes to everyone who has not turned
 *     that off, and to everyone regardless on the day of.
 *   · Nobody is told about their own act.
 */
export function whoIsTold(event, { people, prefsOf, followersOf, today }) {
  const out = [];
  const add = (person, reason) => {
    if (!person || samePerson(person, event.actor)) return;
    if (out.some((o) => samePerson(o.person, person))) return;
    out.push({ person, reason });
  };
  const prefs = (p) => ({ ...DEFAULT_PREFS, ...(prefsOf(p) ?? {}) });
  const topic = event.topic;

  if (event.kind === 'reaction') {
    const target = event.reply ?? topic;
    add(people.find((p) => samePerson(p, authorOf(target))), 'reaction');
    return out;
  }

  if (event.kind === 'notice') {
    const dayOf = isDayOf(topic, today);
    for (const p of people) {
      if (topic.audience === 'host_only' && !p.isHost) continue;
      if (dayOf || prefs(p).from_host) add(p, dayOf ? 'day_of' : 'from_host');
    }
    return out;
  }

  if (event.kind === 'topic') {
    for (const p of people) {
      if (topic.audience === 'host_only') { if (p.isHost) add(p, 'host'); continue; }
      const pr = prefs(p);
      if (pr.every_topic) add(p, 'every_topic');
      else if (pr.anchors && topic.tag_kind !== 'trip' && isOnAnchor(p, topic)) add(p, 'anchor');
    }
    for (const m of event.mentions ?? []) if (prefs(m).mentions) add(m, 'mention');
    return out;
  }

  // reply, answer
  const followers = followersOf(topic);
  for (const f of followers) {
    const p = people.find((x) => samePerson(x, f));
    if (!p) continue;
    if (!canSee(topic, p)) continue;
    if (prefs(p).started) add(p, event.kind === 'answer' ? 'answer' : 'following');
  }
  // Host and organiser replies count as "anything from the host" for people not following.
  if (event.actor?.isHost) {
    for (const p of people) {
      if (!canSee(topic, p)) continue;
      if (prefs(p).from_host && !followers.some((f) => samePerson(f, p))) {
        if (topic.audience === 'host_only' && !samePerson(authorOf(topic), p)) continue;
        if (event.kind === 'answer' || isDayOf(topic, today)) add(p, 'from_host');
      }
    }
  }
  for (const m of event.mentions ?? []) if (canSee(topic, m) && prefs(m).mentions) add(m, 'mention');
  return out;
}

/** One line for a ping, in words somebody would read on a lock screen. */
export function notificationText(event, { contextName }) {
  const who = event.actor?.name ?? 'Someone';
  const t = event.topic;
  const q = (s) => String(s ?? '').slice(0, 80);
  switch (event.kind) {
    case 'topic': return `${who} asked on ${contextName}: “${q(t.title)}”`;
    case 'notice': return `${who}, about ${contextName}: ${q(t.title)}`;
    case 'reply': return `${who} replied to “${q(t.title)}”: ${q(event.reply?.body)}`;
    case 'answer': return `${who} answered “${q(t.title)}”: ${q(event.reply?.body)}`;
    case 'reaction': return `${who} reacted ${event.emoji ?? ''} to what you said on ${contextName}`;
    case 'mention': return `${who} mentioned you on ${contextName}: ${q(event.reply?.body ?? t.title)}`;
    case 'publish_request': return `${who} has asked you something about “${q(t.title)}” on ${contextName}`;
    case 'published': return `Your answer to “${q(t.title)}” is now in the FAQ for ${contextName}`;
    default: return `${who} on ${contextName}`;
  }
}

/** Whether `hhmm` falls inside a quiet window that may cross midnight. */
export function inQuietHours(hhmm, from, to) {
  if (!from || !to) return false;
  const f = String(from).slice(0, 5); const t = String(to).slice(0, 5); const h = String(hhmm).slice(0, 5);
  return f <= t ? (h >= f && h < t) : (h >= f || h < t);
}

// ---------------------------------------------------------------------------
// the rate limit
// ---------------------------------------------------------------------------

/** Plain words when somebody has said enough for now, or null. */
export function rateLimited({ lastHour, lastDay }) {
  if (lastDay >= RATE_LIMIT.perDay) return `That is ${RATE_LIMIT.perDay} messages today — the most anybody can send in a day. It resets tomorrow.`;
  if (lastHour >= RATE_LIMIT.perHour) return `That is ${RATE_LIMIT.perHour} messages in the last hour — the most anybody can send. Give it a few minutes.`;
  return null;
}

// ---------------------------------------------------------------------------
// reach: what a choice of kind actually controls (D6)
// ---------------------------------------------------------------------------

/** "Six people are on this one. Nobody else is pinged." */
export function reachWords(kind, count, { hostName, contextType }) {
  const people = `${count} ${count === 1 ? 'person' : 'people'}`;
  if (contextType === 'offer') {
    if (kind === 'host_only') return `Just ${hostName ?? 'the host'}. Nobody else sees it.`;
    return `${people} booked on this. Nobody else is pinged.`;
  }
  if (kind === 'trip') return `Everyone gets it — ${people}.`;
  if (kind === 'day') return `${people} on that day. Nobody else is pinged.`;
  if (kind === 'stop') return `${people} on this one${hostName ? `, and ${hostName}` : ''}. Nobody else is pinged.`;
  if (kind === 'host_only') return `A private message to ${hostName ?? 'the organiser'}. Nobody else sees it.`;
  return people;
}
