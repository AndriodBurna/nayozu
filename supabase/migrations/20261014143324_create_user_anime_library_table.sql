-- Create user_anime_library table
create table public.user_anime_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  anime_id text not null, -- storing the external anime ID as text (e.g., from AniList or Kitsu)
  status text not null check (status in ('planned', 'watching', 'completed', 'on_hold', 'dropped')),
  progress integer default 0 check (progress >= 0),
  updated_at timestamp with time zone default timezone('utc', now()) not null,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

-- Enable Row Level Security
alter table public.user_anime_library enable row level security;

-- Create policies for user_anime_library
create policy "Users can view their own library entries"
  on public.user_anime_library for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own library entries"
  on public.user_anime_library for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own library entries"
  on public.user_anime_library for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own library entries"
  on public.user_anime_library for delete
  using ( auth.uid() = user_id );

-- Create unique constraint to prevent duplicate entries for the same user and anime
create unique index idx_user_anime_library_user_id_anime_id
  on public.user_anime_library (user_id, anime_id);

-- Create trigger to set updated_at
create trigger set_user_anime_library_updated_at
  before update on public.user_anime_library
  for each row
  execute function extensions.moddatetime(updated_at);
