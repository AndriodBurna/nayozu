-- Create anime_ratings table
create table public.anime_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  anime_id text not null, -- stable external anime ID
  rating integer not null check (rating >= 1 and rating <= 10),
  created_at timestamp with time zone default timezone('utc', now()) not null,
  updated_at timestamp with time zone default timezone('utc', now()) not null
);

-- Enable Row Level Security
alter table public.anime_ratings enable row level security;

-- Create policies for anime_ratings
create policy "Users can view their own ratings"
  on public.anime_ratings for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own ratings"
  on public.anime_ratings for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own ratings"
  on public.anime_ratings for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own ratings"
  on public.anime_ratings for delete
  using ( auth.uid() = user_id );

-- Create unique constraint to prevent duplicate ratings for the same user and anime
create unique index idx_anime_ratings_user_id_anime_id
  on public.anime_ratings (user_id, anime_id);

-- Create trigger to set updated_at
create trigger set_anime_ratings_updated_at
  before update on public.anime_ratings
  for each row
  execute function extensions.moddatetime(updated_at);
