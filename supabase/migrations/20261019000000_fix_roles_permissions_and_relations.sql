-- Migration: 20261019000000_fix_roles_permissions_and_relations.sql
-- Description:
-- 1. Security definer functions for role checks to prevent RLS recursion
-- 2. Make anime reviews and anime ratings viewable by everyone
-- 3. Add foreign key relationships from user tables to public.profiles so PostgREST embeds work cleanly

-- 1. SECURITY DEFINER HELPER FUNCTIONS
create or replace function public.is_moderator_or_admin(user_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = user_uuid and role in ('moderator', 'admin')
  );
$$;

create or replace function public.is_admin(user_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = user_uuid and role = 'admin'
  );
$$;

-- Fix user_roles recursive policies
drop policy if exists "Moderators and admins can view all role assignments" on public.user_roles;
create policy "Moderators and admins can view all role assignments"
  on public.user_roles for select
  using ( public.is_moderator_or_admin(auth.uid()) );

drop policy if exists "Only admins can insert role assignments" on public.user_roles;
create policy "Only admins can insert role assignments"
  on public.user_roles for insert
  with check ( public.is_admin(auth.uid()) );

drop policy if exists "Only admins can update role assignments" on public.user_roles;
create policy "Only admins can update role assignments"
  on public.user_roles for update
  using ( public.is_admin(auth.uid()) )
  with check ( public.is_admin(auth.uid()) );

drop policy if exists "Only admins can delete role assignments" on public.user_roles;
create policy "Only admins can delete role assignments"
  on public.user_roles for delete
  using ( public.is_admin(auth.uid()) );

-- Fix user_restrictions policies using helper
drop policy if exists "Moderators and admins can view all restrictions" on public.user_restrictions;
create policy "Moderators and admins can view all restrictions"
  on public.user_restrictions for select
  using ( public.is_moderator_or_admin(auth.uid()) );

drop policy if exists "Only moderators and admins can insert restrictions" on public.user_restrictions;
create policy "Only moderators and admins can insert restrictions"
  on public.user_restrictions for insert
  with check ( public.is_moderator_or_admin(auth.uid()) );

drop policy if exists "Only moderators and admins can update restrictions" on public.user_restrictions;
create policy "Only moderators and admins can update restrictions"
  on public.user_restrictions for update
  using ( public.is_moderator_or_admin(auth.uid()) )
  with check ( public.is_moderator_or_admin(auth.uid()) );

drop policy if exists "Only moderators and admins can delete restrictions" on public.user_restrictions;
create policy "Only moderators and admins can delete restrictions"
  on public.user_restrictions for delete
  using ( public.is_moderator_or_admin(auth.uid()) );

-- Fix content_reports policies using helper
drop policy if exists "Moderators and admins can view all reports" on public.content_reports;
create policy "Moderators and admins can view all reports"
  on public.content_reports for select
  using ( public.is_moderator_or_admin(auth.uid()) );

drop policy if exists "Moderators and admins can update reports" on public.content_reports;
drop policy if exists "Moderators and admins can update reports (e.g., change status, add resolution notes)" on public.content_reports;
create policy "Moderators and admins can update reports"
  on public.content_reports for update
  using ( public.is_moderator_or_admin(auth.uid()) )
  with check ( public.is_moderator_or_admin(auth.uid()) );

drop policy if exists "Moderators and admins can delete reports" on public.content_reports;
create policy "Moderators and admins can delete reports"
  on public.content_reports for delete
  using ( public.is_moderator_or_admin(auth.uid()) );

-- 2. MAKE REVIEWS AND RATINGS PUBLICLY READABLE
drop policy if exists "Reviews are viewable by everyone" on public.anime_reviews;
drop policy if exists "Users can view their own reviews" on public.anime_reviews;
create policy "Reviews are viewable by everyone"
  on public.anime_reviews for select
  using ( true );

drop policy if exists "Ratings are viewable by everyone" on public.anime_ratings;
drop policy if exists "Users can view their own ratings" on public.anime_ratings;
create policy "Ratings are viewable by everyone"
  on public.anime_ratings for select
  using ( true );

-- 3. ADD FOREIGN KEYS TO PUBLIC.PROFILES FOR POSTGREST EMBEDS
-- Ensure all referenced user_ids exist in profiles before creating foreign keys
insert into public.profiles (id, username, display_name)
select distinct u.id, 'user_' || substr(u.id::text, 1, 8), 'User'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Drop and recreate foreign keys safely
alter table public.anime_comments drop constraint if exists fk_anime_comments_profiles;
alter table public.anime_comments
  add constraint fk_anime_comments_profiles
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.anime_reviews drop constraint if exists fk_anime_reviews_profiles;
alter table public.anime_reviews
  add constraint fk_anime_reviews_profiles
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.anime_ratings drop constraint if exists fk_anime_ratings_profiles;
alter table public.anime_ratings
  add constraint fk_anime_ratings_profiles
  foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.content_reports drop constraint if exists fk_content_reports_profiles;
alter table public.content_reports
  add constraint fk_content_reports_profiles
  foreign key (reporter_id) references public.profiles(id) on delete cascade;

alter table public.user_restrictions drop constraint if exists fk_user_restrictions_profiles;
alter table public.user_restrictions
  add constraint fk_user_restrictions_profiles
  foreign key (user_id) references public.profiles(id) on delete cascade;
