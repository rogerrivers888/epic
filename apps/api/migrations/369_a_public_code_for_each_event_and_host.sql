-- Epic Events on the web (brief, 3 Oct 2026): every public event and host has a
-- permanent address — /en-gb/event/{slug}-{code}, /en-gb/hosts/{slug}-{code},
-- and the short link epic.day/e/{code}. The slug follows the title and may
-- change (the old one 301s); the code never does.
--
-- Six characters from an alphabet without look-alikes (no 0/o, 1/l/i): about
-- 887 million codes. It is an address, not a credential — a private event's
-- way in stays its link_token (/in/{token}), and a private event is never
-- served at its public address.

create or replace function epic_public_code() returns text
language sql volatile as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
    from generate_series(1, 6)
$$;

alter table host_offers add column if not exists public_code text;
alter table hosts add column if not exists public_code text;

-- Existing rows, one at a time so a clash is simply drawn again.
do $$
declare r record; c text;
begin
  for r in select id from host_offers where public_code is null loop
    loop
      c := epic_public_code();
      exit when not exists (select 1 from host_offers where public_code = c);
    end loop;
    update host_offers set public_code = c where id = r.id;
  end loop;
  for r in select id from hosts where public_code is null loop
    loop
      c := epic_public_code();
      exit when not exists (select 1 from hosts where public_code = c);
    end loop;
    update hosts set public_code = c where id = r.id;
  end loop;
end $$;

create unique index if not exists host_offers_public_code_key on host_offers (public_code);
create unique index if not exists hosts_public_code_key on hosts (public_code);

-- New rows get theirs on the way in, drawn again on the rare clash.
create or replace function epic_offer_public_code() returns trigger
language plpgsql as $$
begin
  if new.public_code is null then
    loop
      new.public_code := epic_public_code();
      exit when not exists (select 1 from host_offers where public_code = new.public_code);
    end loop;
  end if;
  return new;
end $$;

create or replace function epic_host_public_code() returns trigger
language plpgsql as $$
begin
  if new.public_code is null then
    loop
      new.public_code := epic_public_code();
      exit when not exists (select 1 from hosts where public_code = new.public_code);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists host_offers_public_code on host_offers;
create trigger host_offers_public_code before insert on host_offers
  for each row execute function epic_offer_public_code();

drop trigger if exists hosts_public_code on hosts;
create trigger hosts_public_code before insert on hosts
  for each row execute function epic_host_public_code();

alter table host_offers alter column public_code set not null;
alter table hosts alter column public_code set not null;
