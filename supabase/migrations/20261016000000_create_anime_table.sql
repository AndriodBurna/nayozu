-- Create anime table if not exists
create table if not exists public.anime (
  id uuid primary key default gen_random_uuid(),
  external_id text not null, -- External ID from AniList/Jikan as text
  title_romaji text not null,
  title_english text,
  slug text not null,
  synopsis text,
  cover_image_url text, -- large cover image
  banner_image_url text, -- banner image
  episodes integer,
  status text, -- e.g., RELEASING, COMPLETED
  season text, -- e.g., WINTER 2023
  season_year integer, -- just the year part
  format text, -- e.g., TV, MOVIE, OVA
  average_score smallint check (average_score >= 0 and average_score <= 100), -- 0-100 integer
  popularity integer,
  media_type text not null default 'anime' check (media_type in ('anime', 'manga')),
  created_at timestamp with time zone default timezone('utc', now()) not null,
  updated_at timestamp with time zone default timezone('utc', now()) not null
);

-- Ensure all columns exist on public.anime
alter table public.anime add column if not exists external_id text;
alter table public.anime add column if not exists title_romaji text;
alter table public.anime add column if not exists title_english text;
alter table public.anime add column if not exists slug text;
alter table public.anime add column if not exists synopsis text;
alter table public.anime add column if not exists cover_image_url text;
alter table public.anime add column if not exists banner_image_url text;
alter table public.anime add column if not exists episodes integer;
alter table public.anime add column if not exists status text;
alter table public.anime add column if not exists season text;
alter table public.anime add column if not exists season_year integer;
alter table public.anime add column if not exists format text;
alter table public.anime add column if not exists average_score smallint;
alter table public.anime add column if not exists popularity integer;
alter table public.anime add column if not exists media_type text default 'anime';
alter table public.anime add column if not exists created_at timestamp with time zone default timezone('utc', now());
alter table public.anime add column if not exists updated_at timestamp with time zone default timezone('utc', now());

-- Ensure unique indexes exist on public.anime
create unique index if not exists idx_anime_slug on public.anime (slug);
create unique index if not exists idx_anime_media_type_external_id on public.anime (media_type, external_id);

-- Create genres table if not exists
create table if not exists public.genres (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamp with time zone default timezone('utc', now()) not null,
  updated_at timestamp with time zone default timezone('utc', now()) not null
);

-- Ensure columns and unique index exist on public.genres
alter table public.genres add column if not exists name text;
alter table public.genres add column if not exists created_at timestamp with time zone default timezone('utc', now());
alter table public.genres add column if not exists updated_at timestamp with time zone default timezone('utc', now());
create unique index if not exists idx_genres_name on public.genres (name);

-- Create anime_genres junction table if not exists
create table if not exists public.anime_genres (
  id uuid primary key default gen_random_uuid(),
  anime_id uuid not null references public.anime(id) on delete cascade,
  genre_id uuid not null references public.genres(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

-- Ensure columns and unique index exist on public.anime_genres
alter table public.anime_genres add column if not exists anime_id uuid references public.anime(id) on delete cascade;
alter table public.anime_genres add column if not exists genre_id uuid references public.genres(id) on delete cascade;
alter table public.anime_genres add column if not exists created_at timestamp with time zone default timezone('utc', now());
create unique index if not exists idx_anime_genres_anime_id_genre_id on public.anime_genres (anime_id, genre_id);

-- Enable Row Level Security
alter table public.anime enable row level security;
alter table public.genres enable row level security;
alter table public.anime_genres enable row level security;

-- Policies for anime
drop policy if exists "Anime are viewable by everyone" on public.anime;
create policy "Anime are viewable by everyone"
  on public.anime for select
  using ( true );

-- Policies for genres
drop policy if exists "Genres are viewable by everyone" on public.genres;
create policy "Genres are viewable by everyone"
  on public.genres for select
  using ( true );

-- Policies for anime_genres
drop policy if exists "Anime genres are viewable by everyone" on public.anime_genres;
create policy "Anime genres are viewable by everyone"
  on public.anime_genres for select
  using ( true );

-- Updated_at triggers
drop trigger if exists set_anime_updated_at on public.anime;
create trigger set_anime_updated_at
  before update on public.anime
  for each row
  execute function extensions.moddatetime(updated_at);

drop trigger if exists set_genres_updated_at on public.genres;
create trigger set_genres_updated_at
  before update on public.genres
  for each row
  execute function extensions.moddatetime(updated_at);