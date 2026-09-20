-- The eight: how a day at a place feels, on a nought-to-four scale.
--
-- The Places redesign (Claude Design, 20 Sep 2026) puts eight of these on every
-- subcategory and on every place, drawn as five boxes with the chosen one
-- filled: "THE EIGHT · OUTLINE IS PROPOSED, FILLED IS SET". They are how the
-- browse rows are composed — "Wear them out" is how much walking >= 3, "Two
-- hours, tops" is how long a day <= 1 — so they are a fact about a place in
-- exactly the way indoors and step free already are, and they belong in
-- `place_attributes` with the rest rather than in eight new columns.
--
-- They are a *scale* and not a `range`. A range is a from and a to and is how
-- ages are said — "suits 8 to 14" is two numbers because it is two facts. How
-- thrilling is one number. Storing one number in a range by setting both ends
-- to it would make every reader decide whether from <> to meant something, and
-- migration 132's trigger would have no way to tell a real range apart from a
-- scale wearing one. So: a fourth kind, and a column of its own.
--
-- `settled` is the other half of the drawing. A default arrives proposed —
-- worked out from the places in the drawer that already have values — and a
-- human accepts it, corrects it or leaves it. Outline is proposed, filled is
-- set, and the screen cannot draw that distinction without somewhere to keep
-- it. It is deliberately on the subcategory default and not on the place: a
-- place's value is already known to be human when `set_by` is filled in.

alter table place_attributes drop constraint if exists place_attributes_kind_check;
alter table place_attributes
  add constraint place_attributes_kind_check
  check (kind in ('yesno', 'range', 'oneof', 'scale'));

alter table place_attribute_values      add column if not exists level integer;
alter table shelf_subcategory_attributes add column if not exists level integer;
alter table taxonomy_label_carries       add column if not exists level integer;

-- Proposed until a person says otherwise. Everything already in the table was
-- written by a person through the Categories screen, so it starts settled and
-- nothing that was decided quietly becomes undecided.
--
-- Done with two defaults rather than an UPDATE on purpose: the column arrives
-- true for every row that already exists and false for every row written from
-- now on, and no row is rewritten. An UPDATE here would fire migration 132's
-- before-update trigger against rows written before that trigger existed, and
-- the ones that do not satisfy it — `indoor` rows seeded with a null yesno in
-- migration 105 — would fail the whole migration. Those rows are a real hole
-- and worth closing, but closing it is a decision about data and not a thing
-- to do silently inside a migration about the eight.
alter table shelf_subcategory_attributes add column if not exists settled boolean not null default true;
alter table shelf_subcategory_attributes alter column settled set default false;

-- Migration 132's rule, extended rather than replaced: every value is the shape
-- its label is, and now one of four shapes rather than one of three.
create or replace function attribute_value_kind() returns trigger language plpgsql as $$
declare k text; nm text; opts text[]; lo integer; hi integer;
begin
  select kind, label, options, range_min, range_max
    into k, nm, opts, lo, hi
    from place_attributes where key = new.attribute_key;
  if k is null then
    raise exception '% is not one of our secondary labels.', new.attribute_key using errcode = '22023';
  end if;
  if k = 'yesno' and new.yesno is null then
    raise exception '% is a yes or no.', nm using errcode = '22023';
  end if;
  if k = 'range' and new.from_value is null and new.to_value is null then
    raise exception '% is a range — it needs a number at one end at least.', nm using errcode = '22023';
  end if;
  if k = 'oneof' and new.choice is null then
    raise exception '% is one of a list.', nm using errcode = '22023';
  end if;
  if k = 'oneof' and not (new.choice = any(coalesce(opts, '{}'::text[]))) then
    raise exception '% is not one of %''s choices.', new.choice, nm using errcode = '22023';
  end if;
  if k = 'scale' and new.level is null then
    raise exception '% is a scale — it needs a number on it.', nm using errcode = '22023';
  end if;
  -- And nothing of the shapes it is not.
  if k <> 'yesno' and new.yesno is not null then
    raise exception '% is not a yes or no.', nm using errcode = '22023';
  end if;
  if k <> 'range' and (new.from_value is not null or new.to_value is not null) then
    raise exception '% is not a range.', nm using errcode = '22023';
  end if;
  if k <> 'oneof' and new.choice is not null then
    raise exception '% is not one of a list.', nm using errcode = '22023';
  end if;
  if k <> 'scale' and new.level is not null then
    raise exception '% is not a scale.', nm using errcode = '22023';
  end if;
  if k = 'range' and new.from_value is not null and new.to_value is not null and new.from_value > new.to_value then
    raise exception '% runs from the smaller number to the larger one.', nm using errcode = '22023';
  end if;
  -- A scale's ends are the label's own ends, so a nine on an eight-step scale
  -- is caught here and not by whichever screen reads it next.
  if k = 'scale' and lo is not null and new.level < lo then
    raise exception '% runs from % upwards.', nm, lo using errcode = '22023';
  end if;
  if k = 'scale' and hi is not null and new.level > hi then
    raise exception '% runs up to %.', nm, hi using errcode = '22023';
  end if;
  return new;
end $$;

-- The eight themselves, with the anchors the screen prints under each name.
-- `unit` carries the anchor because it is the word the numbers are said in,
-- which is what unit has always meant here.
insert into place_attributes (key, label, kind, blurb, range_min, range_max, unit, position, seeded) values
  ('how-thrilling',      'How thrilling',       'scale', 'Nought is calm, four is a parachute jump.',                        0, 4, '0 calm · 4 a parachute jump',                          200, true),
  ('how-much-walking',   'How much walking',    'scale', 'Nought is seated, four is all day on your feet.',                  0, 4, '0 seated · 4 all day on your feet',                    201, true),
  ('how-much-planning',  'How much planning',   'scale', 'Nought is turn up, four is booked and timed.',                     0, 4, '0 turn up · 4 booked and timed',                       202, true),
  ('how-new',            'How new',             'scale', 'Nought is the usual, four is never done anything like it.',        0, 4, '0 the usual · 4 never done anything like it',          203, true),
  ('how-busy-and-loud',  'How busy and loud',   'scale', 'Nought is quiet, four is loud and crowded.',                       0, 4, '0 quiet · 4 loud and crowded',                         204, true),
  ('how-much-you-learn', 'How much you learn',  'scale', 'Nought is pure fun, four is you come away knowing something.',     0, 4, '0 pure fun · 4 you come away knowing something',        205, true),
  ('how-smart',          'How smart',           'scale', 'Nought is muddy boots, four is a collared shirt.',                 0, 4, '0 muddy boots · 4 collared shirt',                     206, true),
  ('how-long-a-day',     'How long a day',      'scale', 'Nought is half an hour, four is all day.',                         0, 4, '0 half an hour · 4 all day',                           207, true)
on conflict (key) do nothing;

-- The one facet the drawing asks for that we had no label for. Dogs are a fact
-- about a place in the same way parking is.
insert into place_attributes (key, label, kind, blurb, position, seeded) values
  ('dog-friendly', 'Dog friendly', 'yesno', 'Whether a dog can come too.', 120, true)
on conflict (key) do nothing;

-- So the harvest cannot raise any of these as a new word (migration 211's rule:
-- a key is the words it is made of, and the alias table is what stops the same
-- fact being asked twice).
insert into attribute_aliases (norm, target_key, raw) values
  ('how thrilling',      'how-thrilling',      'How thrilling'),
  ('thrilling',          'how-thrilling',      'How thrilling'),
  ('how much walking',   'how-much-walking',   'How much walking'),
  ('how much planning',  'how-much-planning',  'How much planning'),
  ('how new',            'how-new',            'How new'),
  ('how busy and loud',  'how-busy-and-loud',  'How busy and loud'),
  ('how much you learn', 'how-much-you-learn', 'How much you learn'),
  ('how smart',          'how-smart',          'How smart'),
  ('how long a day',     'how-long-a-day',     'How long a day'),
  ('dog friendly',       'dog-friendly',       'Dog friendly'),
  ('dogs allowed',       'dog-friendly',       'Dog friendly'),
  ('dogs welcome',       'dog-friendly',       'Dog friendly')
on conflict (norm) do nothing;
