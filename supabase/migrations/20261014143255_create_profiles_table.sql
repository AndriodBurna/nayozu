-- Create profiles table
create table public.profiles (
  id uuid references auth.users not null primary key,
  username text unique,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamp with time zone default timezone('utc', now()) not null,
  updated_at timestamp with time zone default timezone('utc', now()) not null
);

-- Enable Row Level Security
alter table public.profiles enable row level security;

-- Create policies for profiles
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using ( true );

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check ( auth.uid() = id );

create policy "Users can update their own profile"
  on public.profiles for update
  using ( auth.uid() = id );

-- Create trigger to set updated_at
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function moddatetime ();

-- Create extension for moddatetime if not exists
create extension if not exists "moddatetime" schema public;
