-- Every live postcode in Great Britain, so a box is placed by the nearest one.
--
-- A district drawn as its sector centroids is still a handful of points, and
-- in the City a sector centroid is the worst approximation in Britain: EC2V
-- has four correct sectors and read nought, because 177 places within three
-- hundred metres of them were nearer an EC4V, EC2Y, EC4N or EC4M centroid.
-- Owner, 26 Sep 2026: "the same failure fixed twice already — a district
-- drawn as one point losing to one drawn as eight … 1.7 million ONS points is
-- a small, free, OGL table and it retires the class rather than the instance."
--
-- Filled by `npm run postcodes` (src/loadPostcodes.js) from the ONS Postcode
-- Directory — Office for National Statistics, Open Government Licence v3.0;
-- contains OS data © Crown copyright and database right, Royal Mail data ©
-- Royal Mail copyright and database right. Live postcodes only, as points.
-- Empty until it is run: the census falls back to the sector table, which
-- says so on the roll-up.

create table if not exists postcodes (
  pcds     text primary key,          -- 'WC1H 9JP'
  sector   text not null,             -- 'WC1H 9'
  outcode  text not null,             -- 'WC1H'
  lat      double precision not null,
  lng      double precision not null,
  source   text not null,             -- 'onspd-2026-08'
  loaded_at timestamptz not null default now()
);
create index if not exists postcodes_at_idx      on postcodes (lat, lng);
create index if not exists postcodes_outcode_idx on postcodes (outcode);
