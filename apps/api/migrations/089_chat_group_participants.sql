-- Group participants in the trip's conversation (owner, 13 Sep 2026: "all the
-- people that are invited to the trip and accept are all coming on the trip,
-- but some are doing some activities and not others").
--
-- A group trip already records who is on what: `group_items` is the list of
-- things to book (required or optional, each tied to a stop) and
-- `group_item_states` is each participant's answer — in, out, booked, paid.
-- That is the roster the chat needs for "only the people booked on it".
--
-- The chat identifies a person as a household member or a share-link guest
-- (`trip_guests`). A participant who joined through the invite and is not in
-- the household is neither, so they get a guest row of their own, linked to
-- their participant row: the same treatment as somebody on the share link,
-- with the same door — their own token — and the same limits.
alter table trip_guests add column if not exists participant_id uuid references group_participants(id) on delete cascade;
create unique index if not exists trip_guests_participant_idx on trip_guests (participant_id) where participant_id is not null;
