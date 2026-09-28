-- Billed days are kept by the invoice month they were exported under, and a
-- re-read replaces that month's import whole (Codex, 29 Sep 2026). Google can
-- put late usage or an adjustment on an invoice whose usage day is in an
-- earlier month; kept by usage day and added to on conflict, a re-read
-- counted it twice. A follow-on: 276 has run.
alter table billing_days add column if not exists invoice_month text;
update billing_days set invoice_month = to_char(day, 'YYYY-MM') where invoice_month is null;
alter table billing_days alter column invoice_month set not null;
alter table billing_days drop constraint if exists billing_days_pkey;
alter table billing_days add primary key (invoice_month, day, sku_id);
