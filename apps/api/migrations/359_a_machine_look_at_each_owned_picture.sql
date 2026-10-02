-- A machine look at each owned picture (owner, 2 Oct 2026, Photo review):
-- "Machine quality check per owned image (Claude vision, cheapest model that
-- does the job, stored with the image, purpose claude.photo_fitness)."
--
-- One row per picture we hold: a picture in the library (image_id), or one on
-- a venue's own site kept by address (venue_ref + image_url). Six checks, each
-- yes / no / don't know with a one-line reason, and a verdict over them —
-- fit, borderline, not fit. Until the agreement with the owner's own verdicts
-- is proven it only sorts the review queue; the owner's verdict publishes.

create table if not exists photo_fitness (
  id           bigserial primary key,
  venue_ref    text not null,
  image_id     uuid references image_assets(id) on delete cascade,
  image_url    text,
  verdict      text not null check (verdict in ('fit', 'borderline', 'not_fit')),
  checks       jsonb not null,           -- [{ key, answer: yes|no|unknown, reason }]
  model        text not null,
  cost_usd     numeric(10,5),
  checked_at   timestamptz not null default now(),
  check (image_id is not null or image_url is not null)
);
-- Per place and picture: "is it the actual place?" is asked of one venue, and a
-- library picture can be linked to more than one.
create unique index if not exists photo_fitness_image_idx on photo_fitness (venue_ref, image_id) where image_id is not null;
create unique index if not exists photo_fitness_url_idx on photo_fitness (venue_ref, image_url) where image_id is null;
create index if not exists photo_fitness_place_idx on photo_fitness (venue_ref);
