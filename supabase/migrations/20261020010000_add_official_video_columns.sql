-- Migration: Add official in-site player columns
alter table public.anime
  add column if not exists official_video_kind text check (official_video_kind in ('video','playlist')),
  add column if not exists official_video_id text,
  add column if not exists official_video_credit text;
