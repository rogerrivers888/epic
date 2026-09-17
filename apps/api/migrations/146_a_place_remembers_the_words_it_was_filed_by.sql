-- The words a place was filed by.
--
-- The category lens is driven by the taxonomy rather than by the data, so that
-- *soft play, Berkshire, nothing* is a finding rather than an absent row. The
-- same has to be true of labels — `namespace:key`, every provider's own word —
-- and it could not be, because nothing wrote down which of them a place
-- actually carries. Working it out at read time means re-deriving every place's
-- labels on every page load, which is a minute's work over an estate this size
-- and a second's work over a county: the wrong shape for a screen.
--
-- So the shelving pass writes what it saw. It is our own derivation about a
-- place, not a provider's content: `google:amusement_park` is the *word* Google
-- used, which is a fact about the classification rather than a description of
-- the place, and it is what every rule in `shelf_rules` is written against.
create table if not exists place_index_labels (
  venue_ref text not null references place_index(venue_ref) on delete cascade,
  label     text not null,              -- 'google:amusement_park', 'osm:leisure=park'
  primary key (venue_ref, label)
);
create index if not exists place_index_labels_label_idx on place_index_labels (label);
