-- One current rate per counterparty, and one current price per plan and channel.
--
-- Both tables are insert-only: a change closes the row in force and opens a
-- new one. Both writes are now one transaction (Codex, 20 Sep 2026), which
-- makes two open rows unlikely — and this makes them impossible, which is the
-- difference that matters for a table every historical money figure is joined
-- against.
--
-- Partial unique indexes, on `effective_to is null`, because the closed rows
-- are exactly what the history is and there may be as many of those as there
-- have been decisions.
--
-- Guarded: if a row ever did double up before this ran, the index would fail to
-- build and the migration would stop, which is the right way round. It is
-- checked first so the failure says what is wrong rather than only that an
-- index could not be created.

do $$
declare dupes int;
begin
  select count(*) into dupes from (
    select counterparty_key, sku from counterparty_rates
     where effective_to is null
     group by 1, 2 having count(*) > 1
  ) d;
  if dupes > 0 then
    raise exception 'counterparty_rates has % counterparty/sku pairs with more than one open row; close the older ones before this index can exist', dupes;
  end if;

  select count(*) into dupes from (
    select plan_key, channel from plan_prices
     where effective_to is null
     group by 1, 2 having count(*) > 1
  ) d;
  if dupes > 0 then
    raise exception 'plan_prices has % plan/channel pairs with more than one open row; close the older ones before this index can exist', dupes;
  end if;
end $$;

create unique index if not exists counterparty_rates_one_current
  on counterparty_rates (counterparty_key, sku)
  where effective_to is null;

create unique index if not exists plan_prices_one_current
  on plan_prices (plan_key, channel)
  where effective_to is null;
