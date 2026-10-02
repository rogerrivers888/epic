-- A booking knows whether it came through the host's own direct link (owner
-- 1 Oct 2026). Epic's fee is 5% on bookings a host brought in through their own
-- link, against the level rate (15/20/10%) on bookings Epic brought them. The
-- fee line on every statement names the reason, so the booking has to carry
-- the fact. Defaults false — a booking made from an Epic surface is not a
-- host-link booking. Additive.

alter table experience_bookings add column if not exists via_host_link boolean not null default false;

-- A booking's place in the host's first ten is fixed the first time it holds a
-- place, and never moves (Codex, 2 Oct 2026). The 0% intro covers a host's
-- first ten bookings; counted from whatever is confirmed today, an early
-- booking being cancelled slid the eleventh into the ten and re-priced it at 0%
-- after the fact. `intro_ordinal` is stamped once — 1 for the host's first
-- booking to hold a place, 2 for the next — and a later cancellation keeps it,
-- because that booking did use up a place in the ten. A trigger, not the
-- routes, because several paths confirm a booking (made, minimum met, decided)
-- and one missed path would put the drift back. The host's advisory lock keeps
-- two confirmations at once from taking the same number. Additive: a new
-- column, filled for existing bookings in the order they were made.

alter table experience_bookings add column if not exists intro_ordinal integer;
-- The host's level when the booking first held a place, for the same reason:
-- a host rising from Verified to Trusted must not re-price what they already
-- earned at 20% down to 10% (Codex, 2 Oct 2026).
alter table experience_bookings add column if not exists fee_level text;

create or replace function epic_booking_intro_ordinal() returns trigger language plpgsql as $$
begin
  if new.intro_ordinal is null and new.state in ('confirmed', 'attended') then
    perform pg_advisory_xact_lock(hashtext('epic_booking_intro:' || new.host_id::text));
    select coalesce(max(intro_ordinal), 0) + 1 into new.intro_ordinal
      from experience_bookings where host_id = new.host_id;
    select trust into new.fee_level from hosts where id = new.host_id;
  end if;
  return new;
end $$;

drop trigger if exists experience_bookings_intro_ordinal on experience_bookings;
create trigger experience_bookings_intro_ordinal
  before insert or update of state on experience_bookings
  for each row execute function epic_booking_intro_ordinal();

-- Existing bookings, in the order they were made. A cancelled booking counts
-- when there is evidence it held a place — money taken or given back — so the
-- bookings after it are not renumbered down into the 0% (Codex, 2 Oct 2026).
-- A cancelled booking with only a `recorded` payment cannot say whether it was
-- ever confirmed, and is left out rather than guessed at. The level written
-- is the host's level today: the past has no record of an earlier one.
update experience_bookings b set intro_ordinal = n.ordinal, fee_level = h.trust
  from (select id, host_id, row_number() over (partition by host_id order by created_at, id) as ordinal
          from experience_bookings
         where state in ('confirmed', 'attended')
            or (state = 'cancelled' and (paid_at is not null or refunded_at is not null or payment_status in ('paid', 'refunded')))) n,
       hosts h
 where b.id = n.id and h.id = n.host_id and b.intro_ordinal is null;
