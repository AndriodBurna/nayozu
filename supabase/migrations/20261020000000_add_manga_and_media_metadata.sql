-- Migration: Add nullable columns for manga and media metadata, and composite indexes
alter table public.anime
  add column if not exists chapters integer,
  add column if not exists volumes integer,
  add column if not exists country text,
  add column if not exists external_links jsonb,
  add column if not exists trailer_site text,
  add column if not exists trailer_id text;

-- Composite indexes for filtered queries
create index if not exists anime_media_type_popularity_idx on public.anime(media_type, popularity);
create index if not exists anime_media_type_average_score_idx on public.anime(media_type, average_score);
create index if not exists anime_media_type_season_year_idx on public.anime(media_type, season_year);
