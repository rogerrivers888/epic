-- A country is a place you can point at.
--
-- `localities` was already a parent-linked tree with a `country_code` and a
-- `kind`, so the layer above a county is a new row kind rather than a rewrite
-- (build brief §8). It exists because the Places screen has a level above the
-- country level — "select a country" — and because a country whose travel times
-- have not been worked out cannot answer "within 30 minutes" yet, which is a
-- fact about the country and needs somewhere to hang.
--
-- Counties are not re-parented onto it. A county already knows its country
-- through `country_code`, and the harvest's own tree reads `parent_slug` for
-- towns; moving counties under a country row would change what that tree means
-- for the sake of a join we do not need.
insert into localities (slug, name, kind, country_code, nation)
values ('gb', 'Great Britain', 'country', 'GB', null)
on conflict (slug) do nothing;
