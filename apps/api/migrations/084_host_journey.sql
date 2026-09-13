-- The host journey, rebuilt (owner, 13 Sep 2026 — "Supporting docs/Groups &
-- events NEW/Events tab 130926 new": the prototype is the behaviour spec).
--
-- Every offer is now three independent axes, and the biggest defect of the
-- first build was deriving one from another:
--
--   shape       oneoff · series · anytime     what "when" looks like
--   visibility  invite · link · public        whether identity, a video, evidence
--                                              and an age gate are needed at all
--   money       free · direct · epic          whether there is a price, a minimum,
--                                              a refund rule and a payout
--
-- A wedding is a one-off that happens to be invite-only — not a separate
-- object. A free public family meetup, a paid private stag weekend, a paid
-- public course all have to work.
--
-- The host's kind is the settled set (T-REC): "I have a skill", "Meetups and
-- mini tours", "Expert guide" — the third defined by depth of knowledge, not
-- employment. The earlier words are renamed in place.

-- --- hosts: the settled kinds, and where they host ---------------------------
update hosts set type = case type when 'practitioner' then 'skill' when 'local' then 'meetups' when 'guide' then 'expert' else type end;
update hosts set local_kind = 'already_do' where local_kind = 'something_you_do';
alter table hosts add column if not exists address text;
alter table hosts alter column type set default 'skill';
alter table hosts alter column type drop not null;   -- asked in the set-up, only when an offer is public   -- "It happens at a particular address" — shown only once booked

-- --- offers: the three axes, the document, the listing we wrote --------------
alter table host_offers
  add column if not exists money           text not null default 'free',   -- 'free' | 'direct' | 'epic'
  add column if not exists summary         text,                            -- "the short version"
  add column if not exists transcript      text,                            -- what the video said; the listing is written from it
  add column if not exists doc_id          uuid references host_media(id) on delete set null,   -- a PDF guests can download
  add column if not exists facts           jsonb not null default '[]'::jsonb,   -- [{key, value}] from the video, editable
  add column if not exists seeded          jsonb not null default '[]'::jsonb,   -- which fields came from the document or the video
  add column if not exists ends_at         time,
  add column if not exists repeat_every    text not null default 'weekly',  -- 'weekly' | 'fortnightly' | 'monthly'
  add column if not exists end_date        date,                            -- a series given an end date rather than a count
  add column if not exists themes_differ   boolean not null default true,
  add column if not exists notice_days     integer,                         -- anytime: nobody books closer than this
  add column if not exists sub_detail      jsonb not null default '{}'::jsonb,  -- the sub-kind questionnaire: family / night / already / neighbourhood
  add column if not exists rules_accepted  boolean not null default false,
  add column if not exists checks          jsonb not null default '[]'::jsonb;   -- what backs it up: 'pub' | 'qual' | 'years' | 'lic'

-- What was priced was Epic-collects; what was not was free.
update host_offers set money = case when price_mode = 'free' then 'free' else 'epic' end;

-- --- evidence: what backs a claim up, never shown to guests -------------------
create table if not exists host_evidence (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references hosts(id) on delete cascade,
  offer_id    uuid references host_offers(id) on delete set null,
  kind        text not null,                           -- 'pub' | 'qual' | 'years' | 'lic'
  fields      jsonb not null default '{}'::jsonb,      -- proper fields per kind: a reference is name, phone, email
  media_id    uuid references host_media(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists host_evidence_host_idx on host_evidence (host_id, created_at);

-- --- invitations: a private offer's guests, and their RSVPs -------------------
-- No account, no password: a text with a link, and they tap yes or no and say
-- how many they are bringing. The token is the credential, as on a group trip.
create table if not exists offer_invites (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references host_offers(id) on delete cascade,
  name          text not null,
  contact       text,
  contact_kind  text,                                  -- 'mobile' | 'email'
  heads         integer not null default 1,
  token         text not null unique,
  rsvp          text,                                  -- null | 'yes' | 'no'
  rsvp_heads    integer,
  sent_at       timestamptz,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists offer_invites_offer_idx on offer_invites (offer_id, created_at);
