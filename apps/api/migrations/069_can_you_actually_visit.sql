-- Whether the public can actually go there.
--
-- The owner's Culture row read: Windsor Castle, then Bagshot Park Mansion,
-- then Cumberland Lodge, then Fort Belvedere (7 Sep 2026: "that definitely
-- needs to be fixed"). Bagshot Park is the Duke of Edinburgh's house and Fort
-- Belvedere is a private residence inside Windsor Great Park. Both outrank
-- Virginia Water Lake in the atlas, because the atlas is harvested from
-- Wikidata, Wikidata measures how notable a building is, and how notable a
-- building is has nothing to do with whether you may walk into it.
--
-- Three columns rather than one, because the answer is worth nothing without
-- its reason: a hidden place with no explanation is indistinguishable from a
-- bug, and somebody has to be able to disagree with it.
--
--   visiting          'yes', 'no', or null for "nobody has established it".
--   visiting_because  the sentence the back office shows next to the verdict.
--   visiting_by       'rule' when domain/visiting.js decided, or who overrode it.
--
-- Null is the common answer and it is *shown*. Hiding everything unvouched-for
-- was tried against this table first and would have hidden Chatsworth,
-- Blenheim, Highclere, Leeds Castle and Hever Castle, because a summary that
-- happens not to mention visiting is the ordinary case rather than a signal.
-- Of 193 published country houses the rule settles six.
--
-- A hand-set answer is never overwritten by a later pass. That is the same
-- promise `pinned` makes on the state column, and for the same reason: a back
-- office whose decisions do not survive the night is a viewer, not a tool.

alter table attractions add column if not exists visiting text;
alter table attractions add column if not exists visiting_because text;
alter table attractions add column if not exists visiting_by text;
alter table attractions add column if not exists visiting_at timestamptz;

alter table attractions drop constraint if exists attractions_visiting_check;
alter table attractions add constraint attractions_visiting_check
  check (visiting is null or visiting in ('yes', 'no'));

comment on column attractions.visiting is
  'Whether the public may visit: yes, no, or null for nobody has established it. Null is shown.';
comment on column attractions.visiting_by is
  'rule = decided by domain/visiting.js; anything else is the person who overrode it, and a pass must not undo it.';

-- The home screen asks "what is near me and open to me" on every load, and the
-- only rows it must skip are the refusals.
create index if not exists attractions_visiting_idx on attractions (visiting)
  where visiting = 'no';
