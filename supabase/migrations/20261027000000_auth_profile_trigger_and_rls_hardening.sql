-- Migration: 20261027000000_auth_profile_trigger_and_rls_hardening.sql
-- Description:
-- 1. Automatic profile creation trigger (`public.handle_new_user`) when a user registers in `auth.users`.
-- 2. Backfill any existing `auth.users` rows missing a `public.profiles` row.
-- 3. Add `ON DELETE CASCADE` on `public.profiles(id)` and `public.user_anime_library(user_id)` so account deletions do not leave orphaned or inconsistent rows.
-- 4. Harden `WITH CHECK` clauses on `public.profiles` and `public.user_anime_library` UPDATE policies, plus non-empty username length constraint and performance indexes.

-- 1. Create or replace security-definer trigger function for automatic profile creation
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_username text;
  clean_username text;
  final_username text;
  raw_display_name text;
  raw_avatar_url text;
begin
  raw_username := coalesce(
    new.raw_user_meta_data->>'username',
    split_part(coalesce(new.email, ''), '@', 1),
    'user_' || substr(new.id::text, 1, 8)
  );

  -- Sanitize username to permitted characters [a-zA-Z0-9_-]
  clean_username := regexp_replace(raw_username, '[^a-zA-Z0-9_-]', '_', 'g');
  if length(clean_username) < 3 then
    clean_username := 'user_' || substr(new.id::text, 1, 8);
  end if;
  clean_username := substr(clean_username, 1, 30);

  -- Check if username is already taken by another profile
  if exists (select 1 from public.profiles where lower(username) = lower(clean_username) and id <> new.id) then
    final_username := substr(clean_username, 1, 21) || '_' || substr(new.id::text, 1, 8);
  else
    final_username := clean_username;
  end if;

  raw_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    final_username
  );

  raw_avatar_url := nullif(trim(coalesce(new.raw_user_meta_data->>'avatar_url', '')), '');

  insert into public.profiles (id, username, display_name, avatar_url, created_at, updated_at)
  values (
    new.id,
    final_username,
    substr(raw_display_name, 1, 60),
    raw_avatar_url,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do update
  set
    username = coalesce(public.profiles.username, excluded.username),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = timezone('utc', now());

  return new;
exception
  when others then
    -- Fallback with guaranteed unique UUID-derived username so auth.users insert never fails
    insert into public.profiles (id, username, display_name, created_at, updated_at)
    values (
      new.id,
      'user_' || substr(new.id::text, 1, 12),
      'User',
      timezone('utc', now()),
      timezone('utc', now())
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

-- Attach trigger to auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- 2. Backfill any existing auth.users rows that do not yet have a profile row
insert into public.profiles (id, username, display_name, created_at, updated_at)
select
  u.id,
  'user_' || substr(u.id::text, 1, 8),
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'username'), ''),
    split_part(coalesce(u.email, ''), '@', 1),
    'User'
  ),
  timezone('utc', now()),
  timezone('utc', now())
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- 3. Ensure ON DELETE CASCADE foreign keys to auth.users on profiles and user_anime_library
alter table public.profiles
  drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

alter table public.user_anime_library
  drop constraint if exists user_anime_library_user_id_fkey;
alter table public.user_anime_library
  add constraint user_anime_library_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- 4. Harden RLS policies with explicit WITH CHECK clauses
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using ( auth.uid() = id )
  with check ( auth.uid() = id );

drop policy if exists "Users can update their own library entries" on public.user_anime_library;
create policy "Users can update their own library entries"
  on public.user_anime_library for update
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

-- 5. Add indexes for fast library and profile lookups
create index if not exists idx_user_anime_library_user_id_updated_at
  on public.user_anime_library (user_id, updated_at desc);

create index if not exists idx_profiles_username_lower
  on public.profiles (lower(username));
