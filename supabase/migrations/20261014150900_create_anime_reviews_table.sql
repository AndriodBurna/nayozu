-- Create anime_reviews table
create table public.anime_reviews (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  anime_id text not null, -- stable external anime ID
  title text, -- optional review title
  body text not null,
  created_at timestamp with time zone default timezone('utc', now()) not null,
  updated_at timestamp with time zone default timezone('utc', now()) not null
);

-- Enable Row Level Security
alter table public.anime_reviews enable row level security;

-- Create policies for anime_reviews
create policy "Users can view their own reviews"
  on public.anime_reviews for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own reviews"
  on public.anime_reviews for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own reviews"
  on public.anime_reviews for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own reviews"
  on public.anime_reviews for delete
  using ( auth.uid() = user_id );

-- Create trigger to set updated_at
create trigger set_anime_reviews_updated_at
  before update on public.anime_reviews
  for each row
  execute function moddatetime ();

-- Create extension for moddatetime if not exists
create extension if not exists "moddatetime" schema public;
