-- Create anime_comments table
create table public.anime_comments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  anime_id text not null, -- stable external anime ID
  parent_comment_id uuid references public.anime_comments(id), -- for replies, null for top-level comment
  body text not null,
  is_spoiler boolean default false,
  is_hidden boolean default false, -- moderation: hide inappropriate content
  created_at timestamp with time zone default timezone('utc', now()) not null,
  updated_at timestamp with time zone default timezone('utc', now()) not null
);

-- Enable Row Level Security
alter table public.anime_comments enable row level security;

-- Create policies for anime_comments
create policy "Users can view visible comments"
  on public.anime_comments for select
  using ( not is_hidden );

create policy "Users can view their own comments (even if hidden)"
  on public.anime_comments for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own comments"
  on public.anime_comments for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own comments"
  on public.anime_comments for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own comments"
  on public.anime_comments for delete
  using ( auth.uid() = user_id );

-- Create trigger to set updated_at
create trigger set_anime_comments_updated_at
  before update on public.anime_comments
  for each row
  execute function moddatetime ();

-- Create extension for moddatetime if not exists
create extension if not exists "moddatetime" schema public;

-- Create indexes for common queries
create index idx_anime_comments_anime_id on public.anime_comments(anime_id);
create index idx_anime_comments_parent_comment_id on public.anime_comments(parent_comment_id) where parent_comment_id is not null;
