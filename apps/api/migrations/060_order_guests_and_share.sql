-- Other people at the table, a word for the waiter from each of them, and the
-- code the waiter scans instead of being handed a phone (owner, 7 Sep 2026):
--
--   > "When I'm out for a meal, there could be other guests with me… I'd like
--   > to be able to say, when I go into the menu, 'Add other guests.' In that
--   > case, I'll be asked for their names, or just their first names."
--
--   > "If 2 people are having the same menu item, they each might have
--   > different special instructions that they want to provide to the waiter."
--
--   > "Maybe there could be a QR code that the waiter could scan to then see
--   > what I've ordered, because standing there holding the phone while they
--   > take a note of what I want to order was quite awkward."
--
-- A guest belongs to the sitting, not to the household. Somebody who came for
-- one dinner is not a member: they have no allergens Roam learns from, they are
-- not on the trip, and the stars they give go nowhere near the family's tastes
-- (Requirements §5). So they are rows on the order and they die with it.
--
-- `ref` is the phone's own id for a guest. The order is rewritten whole on
-- every save (routes/menus.js), so without a stable id from the device every
-- save would mint new guests and orphan the dishes hanging off them.

create table if not exists order_guests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  ref           text not null,
  name          text not null,               -- a first name is enough, and is what will be typed
  position      integer not null default 0,
  unique (order_id, ref)
);
create index if not exists order_guests_order_idx on order_guests (order_id, position);

-- Who this plate is for: a member of the household, a guest at this table, or
-- neither, which is the plate everyone shares. Never both.
alter table order_items add column if not exists guest_id uuid references order_guests(id) on delete cascade;
create index if not exists order_items_guest_idx on order_items (guest_id);
alter table order_items drop constraint if exists order_items_one_diner;
alter table order_items add constraint order_items_one_diner
  check (member_id is null or guest_id is null);

-- The note is what one person says to the waiter about their own plate, so two
-- people having the same dish now hold two rows and two notes. Nothing changes
-- in the column; what changed is that the phone no longer shares one note
-- between everybody who ticked a dish.
comment on column order_items.note is
  'This diner''s word for the waiter about this plate — "no chilli". One per person, never shared across a dish.';

-- The code on the table. Unguessable, and it is the whole credential: whoever
-- holds it sees the dishes, the notes and the first names, and nothing else of
-- the household (routes/menus.js, auth.js PUBLIC).
alter table orders add column if not exists share_token text;
update orders set share_token = replace(gen_random_uuid()::text, '-', '') where share_token is null;
create unique index if not exists orders_share_token_idx on orders (share_token);
