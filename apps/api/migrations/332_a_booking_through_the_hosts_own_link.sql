-- A booking knows whether it came through the host's own direct link (owner
-- 1 Oct 2026). Epic's fee is 5% on bookings a host brought in through their own
-- link, against the level rate (15/20/10%) on bookings Epic brought them. The
-- fee line on every statement names the reason, so the booking has to carry
-- the fact. Defaults false — a booking made from an Epic surface is not a
-- host-link booking. Additive.

alter table experience_bookings add column if not exists via_host_link boolean not null default false;
