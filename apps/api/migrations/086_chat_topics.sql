-- The chat module (owner, 13 Sep 2026 — "Supporting docs/Chat screens": the
-- board `Epic Chat.dc.html` and its README are the spec).
--
-- "This is a migration, not a new feature." The trip chat shipped in 068 as a
-- flat river of messages, some tagged to a stop. The board replaces the river
-- with *a list of questions that happens to be a chat*:
--
--   * A **topic** is a question or a notice. It carries exactly one tag (what
--     it is about) and one audience (who can see it). Replies are flat inside
--     it. **Two levels only** — a reply can never be replied to; an inline
--     reply is a rendered quote (`quotes_reply_id`), not a nested node.
--   * The host or organiser may mark one reply as **the answer**.
--   * One component, two contexts: a trip (the organiser holds the host role)
--     and a hosted offer (the host does). `context_type` + `context_id` say
--     which; nothing else differs.
--   * The payoff nobody else has: a published answer outlives the booking as
--     an entry in the offer's **FAQ**, shown on the listing before anyone
--     books. A host may *request* that a private answer goes there; only the
--     asker can say yes, and only with a normalised question that is never
--     their own wording.
--
-- What it generalises from 068: `trip_messages.venue_ref` was a tag on a
-- stop; `tag_kind` + `tag_ref` is a tag on a stop, a day, the whole trip or
-- an aspect of an offer. Existing messages are copied in below as topics —
-- tagged to the stop when they carried one, to the trip otherwise — and their
-- read receipts come with them. The old tables are left in place: the
-- `/api/trips/:id/chat` endpoints keep answering, from these tables.
--
-- Licence: every byte here is somebody's own words — a household's, a guest's
-- on a share link, a host's. No provider content lands here. `tag_label` is
-- the household's own name for the anchor, as `trip_messages.venue_label` was.

-- ---------------------------------------------------------------------------
-- topics
-- ---------------------------------------------------------------------------
create table if not exists chat_topics (
  id                uuid primary key default gen_random_uuid(),
  context_type      text not null,                       -- 'trip' | 'offer'
  context_id        uuid not null,                       -- trips.id | host_offers.id
  -- What it is about. `stop` carries a venue_ref, `day` a trip_days.id,
  -- `trip` one of the trip-level anchors ('trip' | 'travel' | 'stay'), and
  -- `offer_aspect` an aspect key ('offer' | 'kit' | 'where' | 'day' |
  -- 'access' | 'money' | 'week:N' | 'date:YYYY-MM-DD').
  tag_kind          text not null,                       -- 'stop' | 'day' | 'trip' | 'offer_aspect'
  tag_ref           text,
  tag_label         text,
  audience          text not null default 'everyone',    -- 'everyone' | 'host_only'
  -- Offer context only: which date the asker is booked on, so "everyone
  -- booked on that date" can be worked out. Null is the whole offer.
  occurrence        text,
  -- Exactly one of these is set, as on trip_messages.
  author_member_id  uuid references members(id) on delete set null,
  author_guest_id   uuid references trip_guests(id) on delete cascade,
  title             text not null,                       -- the question, or the notice, in one line
  body              text,                                -- any detail, optional
  state             text not null default 'open',        -- 'open' | 'answered' | 'notice'
  answer_reply_id   uuid,                                -- the fk is added once chat_replies exists
  pinned            boolean not null default false,
  -- The row of trip_messages this was copied from, so the copy runs once.
  legacy_message_id uuid unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists chat_topics_context_idx on chat_topics (context_type, context_id, created_at desc);
create index if not exists chat_topics_tag_idx on chat_topics (context_type, context_id, tag_kind, tag_ref);

-- ---------------------------------------------------------------------------
-- replies: flat inside a topic
-- ---------------------------------------------------------------------------
create table if not exists chat_replies (
  id                uuid primary key default gen_random_uuid(),
  topic_id          uuid not null references chat_topics(id) on delete cascade,
  author_member_id  uuid references members(id) on delete set null,
  author_guest_id   uuid references trip_guests(id) on delete cascade,
  body              text not null,
  -- An inline reply: the quoted line above the composer. A pointer, never a parent.
  quotes_reply_id   uuid references chat_replies(id) on delete set null,
  is_answer         boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists chat_replies_topic_idx on chat_replies (topic_id, created_at);

alter table chat_topics
  drop constraint if exists chat_topics_answer_reply_fk,
  add constraint chat_topics_answer_reply_fk foreign key (answer_reply_id) references chat_replies(id) on delete set null;

-- ---------------------------------------------------------------------------
-- seen by: "opening a topic marks every reply in it seen"
-- ---------------------------------------------------------------------------
-- One row per person per thing. The count on a topic is how many have opened
-- it; the count on a reply is how many have read it. Never who has *not*.
create table if not exists chat_reads (
  target_type  text not null,                            -- 'topic' | 'reply'
  target_id    uuid not null,
  member_id    uuid references members(id) on delete cascade,
  guest_id     uuid references trip_guests(id) on delete cascade,
  read_at      timestamptz not null default now()
);
create unique index if not exists chat_reads_member_idx on chat_reads (target_type, target_id, member_id) where member_id is not null;
create unique index if not exists chat_reads_guest_idx on chat_reads (target_type, target_id, guest_id) where guest_id is not null;
create index if not exists chat_reads_target_idx on chat_reads (target_type, target_id);

-- ---------------------------------------------------------------------------
-- reactions: one row per person per emoji, toggled
-- ---------------------------------------------------------------------------
create table if not exists chat_reactions (
  target_type  text not null,                            -- 'topic' | 'reply'
  target_id    uuid not null,
  member_id    uuid references members(id) on delete cascade,
  guest_id     uuid references trip_guests(id) on delete cascade,
  emoji        text not null,
  created_at   timestamptz not null default now()
);
create unique index if not exists chat_reactions_member_idx on chat_reactions (target_type, target_id, member_id, emoji) where member_id is not null;
create unique index if not exists chat_reactions_guest_idx on chat_reactions (target_type, target_id, guest_id, emoji) where guest_id is not null;
create index if not exists chat_reactions_target_idx on chat_reactions (target_type, target_id);

-- ---------------------------------------------------------------------------
-- following: per topic, never per reply
-- ---------------------------------------------------------------------------
create table if not exists chat_follows (
  topic_id     uuid not null references chat_topics(id) on delete cascade,
  member_id    uuid references members(id) on delete cascade,
  guest_id     uuid references trip_guests(id) on delete cascade,
  source       text not null,                            -- 'authored' | 'replied' | 'tag' | 'mention' | 'manual'
  created_at   timestamptz not null default now()
);
create unique index if not exists chat_follows_member_idx on chat_follows (topic_id, member_id) where member_id is not null;
create unique index if not exists chat_follows_guest_idx on chat_follows (topic_id, guest_id) where guest_id is not null;

-- ---------------------------------------------------------------------------
-- publishing a private answer: the host asks, the asker decides (D1, D2)
-- ---------------------------------------------------------------------------
create table if not exists chat_publish_requests (
  id                     uuid primary key default gen_random_uuid(),
  topic_id               uuid not null references chat_topics(id) on delete cascade,
  reply_id               uuid not null references chat_replies(id) on delete cascade,
  requested_by_member_id uuid references members(id) on delete set null,
  destination            text not null,                  -- 'faq' (an offer) | 'group' (a trip)
  -- Three outcomes, not a boolean. Null until the asker has answered.
  decision               text,                           -- 'anonymous' | 'named' | 'declined'
  decided_at             timestamptz,
  created_at             timestamptz not null default now(),
  unique (reply_id)
);

-- ---------------------------------------------------------------------------
-- the FAQ: an answered question, kept for every future date and the listing
-- ---------------------------------------------------------------------------
create table if not exists chat_faq_entries (
  id                  uuid primary key default gen_random_uuid(),
  offer_id            uuid not null references host_offers(id) on delete cascade,
  -- The normalised question and the host's answer. Never the guest's own
  -- wording, which is where identifying detail lives.
  question            text not null,
  answer              text not null,
  ask_count           integer not null default 1,
  source_topic_id     uuid references chat_topics(id) on delete set null,
  source_reply_id     uuid references chat_replies(id) on delete set null,
  -- consent { by, at, attribution }. Null consent is a question that was
  -- public to begin with — nobody's privacy was in it.
  consent_member_id   uuid references members(id) on delete set null,
  consent_guest_id    uuid references trip_guests(id) on delete set null,
  consent_at          timestamptz,
  attribution         text not null default 'anonymous', -- 'anonymous' | 'named'
  asked_by            text,                              -- the name, only when attribution is 'named'
  published_at        timestamptz not null default now(),
  withdrawn_at        timestamptz                        -- withdrawing consent unpublishes
);
create index if not exists chat_faq_offer_idx on chat_faq_entries (offer_id, published_at desc) where withdrawn_at is null;

-- ---------------------------------------------------------------------------
-- notifications: what you get told about (C9), and what was actually written
-- ---------------------------------------------------------------------------
-- Per person per context. The defaults are the design: the row only exists
-- once somebody has touched the bell.
create table if not exists chat_prefs (
  member_id     uuid references members(id) on delete cascade,
  guest_id      uuid references trip_guests(id) on delete cascade,
  context_type  text not null,
  context_id    uuid not null,
  started       boolean not null default true,           -- topics I started or replied to
  anchors       boolean not null default true,           -- days and activities I am on
  from_host     boolean not null default true,           -- anything from the organiser or host
  every_topic   boolean not null default false,          -- every new question — off by default
  mentions      boolean not null default true,
  digest        boolean not null default false,          -- one digest a day instead of live pings
  updated_at    timestamptz not null default now()
);
create unique index if not exists chat_prefs_member_idx on chat_prefs (member_id, context_type, context_id) where member_id is not null;
create unique index if not exists chat_prefs_guest_idx on chat_prefs (guest_id, context_type, context_id) where guest_id is not null;

-- Per person, across every context: when the digest lands and the quiet hours.
create table if not exists chat_settings (
  member_id     uuid primary key references members(id) on delete cascade,
  digest_at     time not null default '18:00',
  quiet_from    time,
  quiet_to      time,
  updated_at    timestamptz not null default now()
);

-- Everything Epic decided to tell somebody, whether or not a sender existed
-- to carry it. `sent_at` null with `channel` 'none' is the honest record of a
-- message nobody could deliver (the senders are the owner's to switch on).
create table if not exists chat_notifications (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid references members(id) on delete cascade,
  guest_id      uuid references trip_guests(id) on delete cascade,
  topic_id      uuid references chat_topics(id) on delete cascade,
  reply_id      uuid references chat_replies(id) on delete cascade,
  kind          text not null,                           -- 'topic' | 'reply' | 'answer' | 'reaction' | 'mention' | 'notice' | 'publish_request' | 'published'
  text          text not null,
  -- Held for the digest, or for the end of quiet hours; null goes at once.
  hold_until    timestamptz,
  sent_at       timestamptz,
  channel       text,                                    -- 'email' | 'sms' | 'none'
  created_at    timestamptz not null default now()
);
create index if not exists chat_notifications_pending_idx on chat_notifications (hold_until) where sent_at is null;
create index if not exists chat_notifications_person_idx on chat_notifications (member_id, created_at desc);

-- A report on a topic or a reply. Moderation is "not designed yet" (README
-- §14); the row exists so a report is never lost while it is.
create table if not exists chat_reports (
  id            uuid primary key default gen_random_uuid(),
  topic_id      uuid not null references chat_topics(id) on delete cascade,
  reply_id      uuid references chat_replies(id) on delete cascade,
  member_id     uuid references members(id) on delete set null,
  guest_id      uuid references trip_guests(id) on delete set null,
  reason        text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- the migration: every message so far becomes a topic
-- ---------------------------------------------------------------------------
-- "A message with no parent becomes a topic; migrate existing messages tagged
-- to the trip unless they carry onStop." The flat chat had no parents, so
-- every row is a topic; one asked on a stop keeps that stop as its tag.
insert into chat_topics (context_type, context_id, tag_kind, tag_ref, tag_label, audience, author_member_id, author_guest_id, title, state, legacy_message_id, created_at, updated_at)
select 'trip', m.trip_id,
       case when m.venue_ref is null then 'trip' else 'stop' end,
       case when m.venue_ref is null then 'trip' else m.venue_ref end,
       case when m.venue_ref is null then 'The whole trip' else m.venue_label end,
       'everyone', m.author_member_id, m.author_guest_id, m.body, 'open', m.id, m.created_at, m.created_at
  from trip_messages m
 where not exists (select 1 from chat_topics t where t.legacy_message_id = m.id);

-- Their read receipts come with them: the sender's own read was written when
-- it was sent, so "seen by" stays honest across the move.
insert into chat_reads (target_type, target_id, member_id, guest_id, read_at)
select 'topic', t.id, r.member_id, r.guest_id, r.read_at
  from trip_message_reads r
  join chat_topics t on t.legacy_message_id = r.message_id
on conflict do nothing;

-- Whoever wrote one is following it, which is the rule from now on too.
insert into chat_follows (topic_id, member_id, guest_id, source, created_at)
select t.id, t.author_member_id, t.author_guest_id, 'authored', t.created_at
  from chat_topics t
 where t.legacy_message_id is not null and (t.author_member_id is not null or t.author_guest_id is not null)
on conflict do nothing;
