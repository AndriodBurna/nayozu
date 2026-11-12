-- Migration: 20261102000000_milestone3_security_and_avatar_storage.sql
-- Description:
-- 1. Enforce case-insensitive username uniqueness via a UNIQUE index on lower(username) in public.profiles.
-- 2. Add database CHECK constraints on public.profiles (username format, display_name length, bio length, avatar_url scheme & length)
--    and public.user_anime_library (canonical anime_id key format) to prevent direct PostgREST validation bypass.
-- 3. Ensure ON DELETE CASCADE / ON DELETE SET NULL on all remaining user foreign keys referencing auth.users.
-- 4. Provision the Supabase Storage `avatars` bucket with 2MB limit, allowed image MIME types, and strict folder-scoped RLS policies.

-- ============================================================================
-- 1. CASE-INSENSITIVE USERNAME UNIQUENESS & PROFILE CONSTRAINTS
-- ============================================================================

-- Normalize any existing invalid profiles before adding constraints
update public.profiles
set username = 'user_' || substr(id::text, 1, 8)
where username is not null
  and username !~ '^[a-zA-Z0-9_-]{3,30}$';

update public.profiles
set display_name = substr(coalesce(nullif(trim(display_name), ''), username, 'User'), 1, 60)
where display_name is null
   or char_length(trim(display_name)) < 1
   or char_length(display_name) > 60;

update public.profiles
set bio = substr(bio, 1, 500)
where bio is not null and char_length(bio) > 500;

update public.profiles
set avatar_url = null
where avatar_url is not null
  and (char_length(avatar_url) > 500 or avatar_url !~ '^https?://');

-- Deduplicate any existing case-insensitive username collisions before creating unique index
with ranked_usernames as (
  select
    id,
    username,
    row_number() over (partition by lower(username) order by created_at asc, id asc) as rn
  from public.profiles
  where username is not null
)
update public.profiles p
set username = substr(p.username, 1, 21) || '_' || substr(p.id::text, 1, 8)
from ranked_usernames r
where p.id = r.id and r.rn > 1;

-- Replace non-unique lower(username) index with a UNIQUE index for atomic case-insensitive uniqueness
drop index if exists public.idx_profiles_username_lower;
create unique index if not exists idx_profiles_username_lower_unique
  on public.profiles (lower(username));

-- Add CHECK constraints on public.profiles matching application validation
alter table public.profiles
  drop constraint if exists profiles_username_format_check;
alter table public.profiles
  add constraint profiles_username_format_check
  check (username is null or username ~ '^[a-zA-Z0-9_-]{3,30}$');

alter table public.profiles
  drop constraint if exists profiles_display_name_length_check;
alter table public.profiles
  add constraint profiles_display_name_length_check
  check (display_name is null or (char_length(trim(display_name)) >= 1 and char_length(display_name) <= 60));

alter table public.profiles
  drop constraint if exists profiles_bio_length_check;
alter table public.profiles
  add constraint profiles_bio_length_check
  check (bio is null or char_length(bio) <= 500);

alter table public.profiles
  drop constraint if exists profiles_avatar_url_format_check;
alter table public.profiles
  add constraint profiles_avatar_url_format_check
  check (avatar_url is null or (char_length(avatar_url) <= 500 and avatar_url ~ '^https?://'));

-- ============================================================================
-- 2. LIBRARY KEY FORMAT CONSTRAINT
-- ============================================================================

-- Clean up any malformed anime_id rows before adding check constraint
delete from public.user_anime_library
where anime_id !~ '^(\d+|(anime|manga):\d+|fav:(anime|manga):\d+)$';

alter table public.user_anime_library
  drop constraint if exists user_anime_library_anime_id_format_check;
alter table public.user_anime_library
  add constraint user_anime_library_anime_id_format_check
  check (anime_id ~ '^(\d+|(anime|manga):\d+|fav:(anime|manga):\d+)$');

-- ============================================================================
-- 3. FOREIGN KEY CASCADING DELETION HARDENING
-- ============================================================================

-- user_roles
alter table public.user_roles
  drop constraint if exists user_roles_user_id_fkey;
alter table public.user_roles
  add constraint user_roles_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.user_roles
  drop constraint if exists user_roles_granted_by_fkey;
alter table public.user_roles
  add constraint user_roles_granted_by_fkey
  foreign key (granted_by) references auth.users(id) on delete set null;

-- anime_ratings
alter table public.anime_ratings
  drop constraint if exists anime_ratings_user_id_fkey;
alter table public.anime_ratings
  add constraint anime_ratings_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- anime_reviews
alter table public.anime_reviews
  drop constraint if exists anime_reviews_user_id_fkey;
alter table public.anime_reviews
  add constraint anime_reviews_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- anime_comments
alter table public.anime_comments
  drop constraint if exists anime_comments_user_id_fkey;
alter table public.anime_comments
  add constraint anime_comments_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.anime_comments
  drop constraint if exists anime_comments_parent_comment_id_fkey;
alter table public.anime_comments
  add constraint anime_comments_parent_comment_id_fkey
  foreign key (parent_comment_id) references public.anime_comments(id) on delete cascade;

-- content_reports
alter table public.content_reports
  drop constraint if exists content_reports_reporter_id_fkey;
alter table public.content_reports
  add constraint content_reports_reporter_id_fkey
  foreign key (reporter_id) references auth.users(id) on delete cascade;

alter table public.content_reports
  drop constraint if exists content_reports_resolver_id_fkey;
alter table public.content_reports
  add constraint content_reports_resolver_id_fkey
  foreign key (resolver_id) references auth.users(id) on delete set null;

-- user_restrictions
alter table public.user_restrictions
  alter column created_by drop not null;
alter table public.user_restrictions
  drop constraint if exists user_restrictions_user_id_fkey;
alter table public.user_restrictions
  add constraint user_restrictions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.user_restrictions
  drop constraint if exists user_restrictions_created_by_fkey;
alter table public.user_restrictions
  add constraint user_restrictions_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

-- Explicit WITH CHECK on ratings, reviews, and comments update policies
drop policy if exists "Users can update their own ratings" on public.anime_ratings;
create policy "Users can update their own ratings"
  on public.anime_ratings for update
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

drop policy if exists "Users can update their own reviews" on public.anime_reviews;
create policy "Users can update their own reviews"
  on public.anime_reviews for update
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

drop policy if exists "Users can update their own comments" on public.anime_comments;
create policy "Users can update their own comments"
  on public.anime_comments for update
  using ( auth.uid() = user_id )
  with check ( auth.uid() = user_id );

-- ============================================================================
-- 4. SUPABASE STORAGE: AVATARS BUCKET & RLS POLICIES
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using ( bucket_id = 'avatars' );

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
