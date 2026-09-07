-- What the open sources said, kept so the question is asked once.
--
-- The verdict in migration 069 had one source: the Wikidata types and the
-- summary the harvest already held. That settles the clear cases and leaves
-- 1,325 of 2,394 published places unestablished — and the owner has asked that
-- an unestablished place not be shown (7 Sep 2026: "if you're not sure, I'd err
-- on the side of caution and not show it"). Deny-by-default is only tolerable
-- if the positive evidence is good, so there is more of it now.
--
-- Two more sources, both free and keyless and both licensed for us to keep:
-- the OpenStreetMap tags on the same feature (ODbL) and the categories on its
-- Wikipedia article (CC BY-SA). They join on the Wikidata id, which every
-- attraction has and OSM features carry as a `wikidata=Q…` tag — 79% of the
-- unsettled places turn out to have an OSM feature that way.
--
-- **Google is deliberately not in here.** A place we were already asking Google
-- about for its rating can also answer this, because `types` rides along free
-- on a request that already asks for `rating`. But their types are their
-- content and are not ours to keep: only our conclusion is written, to
-- `visiting`/`visiting_by = 'google'`, and it can be found and dropped by that
-- one value if the position ever changes.

alter table attractions add column if not exists visiting_evidence jsonb;
alter table attractions add column if not exists visiting_looked_at timestamptz;

comment on column attractions.visiting_evidence is
  'Open-licence evidence only: OpenStreetMap tags (ODbL) and Wikipedia categories (CC BY-SA). Never a provider''s content.';
comment on column attractions.visiting_looked_at is
  'When the open sources were last asked. Null means never, which is what the gathering pass looks for.';

-- The pass takes the places that matter first and skips what it has done.
create index if not exists attractions_visiting_todo_idx
  on attractions (state, visiting_looked_at nulls first, score desc);
