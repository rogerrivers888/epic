-- A place can be part of another place.
--
-- The owner, 14 Sep 2026: "I've seen multiple times activities that actually
-- exist in Thorpe Park being listed as separate activities on the Inspire tab,
-- and we absolutely have to stop that happening. If you know something is part
-- of Thorpe Park, it all lives in Thorpe Park, and we should only ever display
-- Thorpe Park, not Amity Beach."
--
-- No label can do this. Amity Beach carries water park, amusement park and
-- tourist attraction; Aquapark Reading, a real standalone water park, carries
-- two of those three and nothing else. Google gives nothing that separates
-- them, so no rule can. What separates them is that one of them is inside the
-- other, and that is a fact about two places rather than a word about one.
--
-- The child keeps its own row and its own labels. It simply stops being
-- offered on its own, and what it knows is read as part of its parent: a theme
-- park with a water park in it is a theme park that has a water park.

create table if not exists place_parts (
  -- The one that is inside, and the one it is inside. Both are venue refs, the
  -- same identifiers everything else in Epic is keyed on.
  child_ref   text primary key,
  parent_ref  text not null,
  -- How this was decided, so a guess is never mistaken for a decision.
  how         text not null default 'told' check (how in ('told', 'proposed')),
  note        text,
  set_by      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (child_ref <> parent_ref)
);

create index if not exists place_parts_parent on place_parts (parent_ref);
create index if not exists place_parts_how on place_parts (how);
