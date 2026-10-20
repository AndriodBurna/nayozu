-- Enable pg_trgm extension for fast text search
create extension if not exists pg_trgm;

-- GIN trigram indexes on lower(title_romaji) and lower(title_english)
create index if not exists anime_title_romaji_trgm on public.anime using gin (lower(title_romaji) gin_trgm_ops);
create index if not exists anime_title_english_trgm on public.anime using gin (lower(title_english) gin_trgm_ops);
