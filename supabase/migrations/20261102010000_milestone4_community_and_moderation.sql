-- Migration: 20261102010000_milestone4_community_and_moderation.sql
-- Description:
-- 1. Profile privacy setting (`profile_visibility` in ('public', 'private'), default 'public').
-- 2. Enhanced `user_restrictions` (`restriction_type`, `status`, `revoked_at`, `revoked_by`) and `public.is_user_actively_restricted(uuid)`.
-- 3. User blocking (`public.user_blocks`) with self-block prevention and `public.is_blocked_between(uuid, uuid)`.
-- 4. Deduplicated one-review-per-user-per-media constraint and `is_hidden` moderation flag on `public.anime_reviews`.
-- 5. Episode and chapter comment columns (`media_type`, `episode_number`, `chapter_number`) on `public.anime_comments`.
-- 6. Dedicated `public.discussions` and `public.discussion_replies` tables with lock & moderation support.
-- 7. Reusable `public.content_reactions` table with atomic uniqueness and target accessibility checks.
-- 8. Enhanced `public.content_reports` with active-report uniqueness and structured categories.
-- 9. Privileged `public.moderation_logs` audit trail table with moderator/admin RLS.

-- ============================================================================
-- 1. PROFILE VISIBILITY
-- ============================================================================

alter table public.profiles
  add column if not exists profile_visibility text not null default 'public'
  check (profile_visibility in ('public', 'private'));

-- ============================================================================
-- 2. USER RESTRICTIONS & ACTIVE RESTRICTION HELPER
-- ============================================================================

alter table public.user_restrictions
  add column if not exists restriction_type text not null default 'temporary_suspension'
  check (restriction_type in ('warning', 'temporary_suspension', 'permanent_suspension'));

alter table public.user_restrictions
  add column if not exists status text not null default 'active'
  check (status in ('active', 'expired', 'revoked'));

alter table public.user_restrictions
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null;

create or replace function public.is_user_actively_restricted(user_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.user_restrictions r
    where r.user_id = user_uuid
      and r.status = 'active'
      and r.restriction_type in ('temporary_suspension', 'permanent_suspension')
      and (r.restricted_until is null or r.restricted_until > timezone('utc', now()))
  );
$$;

-- ============================================================================
-- 3. USER BLOCKING
-- ============================================================================

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_blocks_no_self_block check (blocker_id <> blocked_id),
  constraint user_blocks_unique_pair unique (blocker_id, blocked_id)
);

alter table public.user_blocks
  drop constraint if exists fk_user_blocks_blocker_profile;
alter table public.user_blocks
  add constraint fk_user_blocks_blocker_profile
  foreign key (blocker_id) references public.profiles(id) on delete cascade;

alter table public.user_blocks
  drop constraint if exists fk_user_blocks_blocked_profile;
alter table public.user_blocks
  add constraint fk_user_blocks_blocked_profile
  foreign key (blocked_id) references public.profiles(id) on delete cascade;

create index if not exists idx_user_blocks_blocker_id on public.user_blocks(blocker_id);
create index if not exists idx_user_blocks_blocked_id on public.user_blocks(blocked_id);

alter table public.user_blocks enable row level security;

drop policy if exists "Users can view their own blocks" on public.user_blocks;
create policy "Users can view their own blocks"
  on public.user_blocks for select
  using ( auth.uid() = blocker_id );

drop policy if exists "Users can insert their own blocks" on public.user_blocks;
create policy "Users can insert their own blocks"
  on public.user_blocks for insert
  with check ( auth.uid() = blocker_id and blocker_id <> blocked_id );

drop policy if exists "Users can delete their own blocks" on public.user_blocks;
create policy "Users can delete their own blocks"
  on public.user_blocks for delete
  using ( auth.uid() = blocker_id );

create or replace function public.is_blocked_between(user_a uuid, user_b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when user_a is null or user_b is null then false
    else exists (
      select 1
      from public.user_blocks b
      where (b.blocker_id = user_a and b.blocked_id = user_b)
         or (b.blocker_id = user_b and b.blocked_id = user_a)
    )
  end;
$$;

-- ============================================================================
-- 4. ANIME & MANGA REVIEWS HARDENING
-- ============================================================================

alter table public.anime_reviews
  add column if not exists is_hidden boolean not null default false;

alter table public.anime_reviews
  add column if not exists rating integer
  check (rating is null or (rating >= 1 and rating <= 10));

-- Deduplicate any existing multiple reviews by the same user for the same anime_id
with ranked_reviews as (
  select
    id,
    row_number() over (partition by user_id, anime_id order by updated_at desc, created_at desc, id desc) as rn
  from public.anime_reviews
)
delete from public.anime_reviews r
using ranked_reviews rr
where r.id = rr.id and rr.rn > 1;

create unique index if not exists idx_anime_reviews_user_id_anime_id
  on public.anime_reviews (user_id, anime_id);

create index if not exists idx_anime_reviews_anime_id_created
  on public.anime_reviews (anime_id, created_at desc);

drop policy if exists "Reviews are viewable by everyone" on public.anime_reviews;
drop policy if exists "Users can view their own reviews" on public.anime_reviews;
create policy "Reviews are viewable when visible or by author/moderator"
  on public.anime_reviews for select
  using (
    not is_hidden
    or auth.uid() = user_id
    or public.is_moderator_or_admin(auth.uid())
  );

drop policy if exists "Users can insert their own reviews" on public.anime_reviews;
create policy "Users can insert their own reviews"
  on public.anime_reviews for insert
  with check (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
  );

drop policy if exists "Users can update their own reviews" on public.anime_reviews;
create policy "Users and moderators can update reviews"
  on public.anime_reviews for update
  using (
    (auth.uid() = user_id and not public.is_user_actively_restricted(auth.uid()))
    or public.is_moderator_or_admin(auth.uid())
  )
  with check (
    (auth.uid() = user_id and not public.is_user_actively_restricted(auth.uid()))
    or public.is_moderator_or_admin(auth.uid())
  );

drop policy if exists "Users can delete their own reviews" on public.anime_reviews;
create policy "Users and moderators can delete reviews"
  on public.anime_reviews for delete
  using (
    auth.uid() = user_id
    or public.is_moderator_or_admin(auth.uid())
  );

-- Harden anime_ratings against restricted users
drop policy if exists "Users can insert their own ratings" on public.anime_ratings;
create policy "Users can insert their own ratings"
  on public.anime_ratings for insert
  with check (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
  );

drop policy if exists "Users can update their own ratings" on public.anime_ratings;
create policy "Users can update their own ratings"
  on public.anime_ratings for update
  using (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
  )
  with check (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
  );

-- ============================================================================
-- 5. EPISODE & CHAPTER COMMENTS ENHANCEMENT
-- ============================================================================

alter table public.anime_comments
  add column if not exists media_type text not null default 'anime'
  check (media_type in ('anime', 'manga', 'community', 'watch_room'));

alter table public.anime_comments
  add column if not exists episode_number integer
  check (episode_number is null or episode_number >= 1);

alter table public.anime_comments
  add column if not exists chapter_number integer
  check (chapter_number is null or chapter_number >= 1);

create index if not exists idx_anime_comments_media_scope
  on public.anime_comments (anime_id, media_type, episode_number, chapter_number, created_at desc);

drop policy if exists "Users can view visible comments" on public.anime_comments;
drop policy if exists "Users can view their own comments (even if hidden)" on public.anime_comments;
create policy "Comments are viewable when visible or by author/moderator"
  on public.anime_comments for select
  using (
    not is_hidden
    or auth.uid() = user_id
    or public.is_moderator_or_admin(auth.uid())
  );

drop policy if exists "Users can insert their own comments" on public.anime_comments;
create policy "Users can insert their own comments"
  on public.anime_comments for insert
  with check (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
  );

drop policy if exists "Users can update their own comments" on public.anime_comments;
create policy "Users and moderators can update comments"
  on public.anime_comments for update
  using (
    (auth.uid() = user_id and not public.is_user_actively_restricted(auth.uid()))
    or public.is_moderator_or_admin(auth.uid())
  )
  with check (
    (auth.uid() = user_id and not public.is_user_actively_restricted(auth.uid()))
    or public.is_moderator_or_admin(auth.uid())
  );

drop policy if exists "Users can delete their own comments" on public.anime_comments;
create policy "Users and moderators can delete comments"
  on public.anime_comments for delete
  using (
    auth.uid() = user_id
    or public.is_moderator_or_admin(auth.uid())
  );

-- ============================================================================
-- 6. DISCUSSIONS AND DISCUSSION REPLIES
-- ============================================================================

create table if not exists public.discussions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  anime_id text not null default 'community',
  media_type text not null default 'community' check (media_type in ('community', 'anime', 'manga')),
  category text not null default 'discussion' check (category in ('discussion', 'question')),
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text not null check (char_length(trim(body)) between 1 and 8000),
  is_spoiler boolean not null default false,
  is_locked boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.discussions
  drop constraint if exists fk_discussions_profiles;
alter table public.discussions
  add constraint fk_discussions_profiles
  foreign key (user_id) references public.profiles(id) on delete cascade;

create index if not exists idx_discussions_created_at on public.discussions(created_at desc);
create index if not exists idx_discussions_user_id on public.discussions(user_id, created_at desc);
create index if not exists idx_discussions_anime_id on public.discussions(anime_id, media_type);

drop trigger if exists set_discussions_updated_at on public.discussions;
create trigger set_discussions_updated_at
  before update on public.discussions
  for each row
  execute function extensions.moddatetime(updated_at);

alter table public.discussions enable row level security;

drop policy if exists "Discussions are viewable when visible or by author/moderator" on public.discussions;
create policy "Discussions are viewable when visible or by author/moderator"
  on public.discussions for select
  using (
    not is_hidden
    or auth.uid() = user_id
    or public.is_moderator_or_admin(auth.uid())
  );

drop policy if exists "Users can create discussions" on public.discussions;
create policy "Users can create discussions"
  on public.discussions for insert
  with check (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
  );

drop policy if exists "Users and moderators can update discussions" on public.discussions;
create policy "Users and moderators can update discussions"
  on public.discussions for update
  using (
    (auth.uid() = user_id and not public.is_user_actively_restricted(auth.uid()))
    or public.is_moderator_or_admin(auth.uid())
  )
  with check (
    (auth.uid() = user_id and not public.is_user_actively_restricted(auth.uid()))
    or public.is_moderator_or_admin(auth.uid())
  );

drop policy if exists "Users and moderators can delete discussions" on public.discussions;
create policy "Users and moderators can delete discussions"
  on public.discussions for delete
  using (
    auth.uid() = user_id
    or public.is_moderator_or_admin(auth.uid())
  );

create table if not exists public.discussion_replies (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.discussions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_reply_id uuid references public.discussion_replies(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  is_spoiler boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.discussion_replies
  drop constraint if exists fk_discussion_replies_profiles;
alter table public.discussion_replies
  add constraint fk_discussion_replies_profiles
  foreign key (user_id) references public.profiles(id) on delete cascade;

create index if not exists idx_discussion_replies_discussion_id
  on public.discussion_replies(discussion_id, created_at asc);
create index if not exists idx_discussion_replies_user_id
  on public.discussion_replies(user_id, created_at desc);

drop trigger if exists set_discussion_replies_updated_at on public.discussion_replies;
create trigger set_discussion_replies_updated_at
  before update on public.discussion_replies
  for each row
  execute function extensions.moddatetime(updated_at);

create or replace function public.can_reply_to_discussion(p_user_id uuid, p_discussion_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.discussions d
    where d.id = p_discussion_id
      and not d.is_hidden
      and (not d.is_locked or public.is_moderator_or_admin(p_user_id))
      and not public.is_blocked_between(p_user_id, d.user_id)
  );
$$;

alter table public.discussion_replies enable row level security;

drop policy if exists "Discussion replies are viewable when visible or by author/moderator" on public.discussion_replies;
create policy "Discussion replies are viewable when visible or by author/moderator"
  on public.discussion_replies for select
  using (
    not is_hidden
    or auth.uid() = user_id
    or public.is_moderator_or_admin(auth.uid())
  );

drop policy if exists "Users can insert discussion replies" on public.discussion_replies;
create policy "Users can insert discussion replies"
  on public.discussion_replies for insert
  with check (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
    and public.can_reply_to_discussion(auth.uid(), discussion_id)
  );

drop policy if exists "Users and moderators can update discussion replies" on public.discussion_replies;
create policy "Users and moderators can update discussion replies"
  on public.discussion_replies for update
  using (
    (auth.uid() = user_id and not public.is_user_actively_restricted(auth.uid()))
    or public.is_moderator_or_admin(auth.uid())
  )
  with check (
    (auth.uid() = user_id and not public.is_user_actively_restricted(auth.uid()))
    or public.is_moderator_or_admin(auth.uid())
  );

drop policy if exists "Users and moderators can delete discussion replies" on public.discussion_replies;
create policy "Users and moderators can delete discussion replies"
  on public.discussion_replies for delete
  using (
    auth.uid() = user_id
    or public.is_moderator_or_admin(auth.uid())
  );

-- ============================================================================
-- 7. REACTIONS SYSTEM
-- ============================================================================

create table if not exists public.content_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('review', 'discussion', 'discussion_reply', 'comment')),
  target_id uuid not null,
  reaction_type text not null default 'like' check (reaction_type in ('like', 'helpful', 'fire')),
  created_at timestamptz not null default timezone('utc', now()),
  constraint content_reactions_user_target_unique unique (user_id, target_type, target_id)
);

create index if not exists idx_content_reactions_target
  on public.content_reactions(target_type, target_id);
create index if not exists idx_content_reactions_user
  on public.content_reactions(user_id);

create or replace function public.can_react_to_target(
  p_user_id uuid,
  p_target_type text,
  p_target_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_owner_id uuid;
  v_hidden boolean;
begin
  if p_user_id is null then
    return false;
  end if;

  if p_target_type = 'review' then
    select user_id, is_hidden into v_owner_id, v_hidden
    from public.anime_reviews
    where id = p_target_id;
  elsif p_target_type = 'discussion' then
    select user_id, is_hidden into v_owner_id, v_hidden
    from public.discussions
    where id = p_target_id;
  elsif p_target_type = 'discussion_reply' then
    select user_id, is_hidden into v_owner_id, v_hidden
    from public.discussion_replies
    where id = p_target_id;
  elsif p_target_type = 'comment' then
    select user_id, is_hidden into v_owner_id, v_hidden
    from public.anime_comments
    where id = p_target_id;
  else
    return false;
  end if;

  if v_owner_id is null or coalesce(v_hidden, false) = true then
    return false;
  end if;

  if public.is_blocked_between(p_user_id, v_owner_id) then
    return false;
  end if;

  return true;
end;
$$;

alter table public.content_reactions enable row level security;

drop policy if exists "Reactions are viewable by everyone" on public.content_reactions;
create policy "Reactions are viewable by everyone"
  on public.content_reactions for select
  using ( true );

drop policy if exists "Users can insert reactions on accessible content" on public.content_reactions;
create policy "Users can insert reactions on accessible content"
  on public.content_reactions for insert
  with check (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
    and public.can_react_to_target(auth.uid(), target_type, target_id)
  );

drop policy if exists "Users can update their own reactions" on public.content_reactions;
create policy "Users can update their own reactions"
  on public.content_reactions for update
  using ( auth.uid() = user_id )
  with check (
    auth.uid() = user_id
    and not public.is_user_actively_restricted(auth.uid())
    and public.can_react_to_target(auth.uid(), target_type, target_id)
  );

drop policy if exists "Users can delete their own reactions" on public.content_reactions;
create policy "Users can delete their own reactions"
  on public.content_reactions for delete
  using ( auth.uid() = user_id );

-- ============================================================================
-- 8. REPORTING SYSTEM ENHANCEMENT
-- ============================================================================

alter table public.content_reports
  add column if not exists category text not null default 'other'
  check (category in ('spam', 'harassment', 'hate_speech', 'sexual_content', 'spoilers', 'misinformation', 'other'));

alter table public.content_reports
  add column if not exists target_user_id uuid references auth.users(id) on delete set null;

alter table public.content_reports
  drop constraint if exists content_reports_content_type_check;
alter table public.content_reports
  add constraint content_reports_content_type_check
  check (content_type in ('review', 'discussion', 'discussion_reply', 'comment', 'rating', 'profile'));

-- Replace unconditional unique index with active-report partial unique index
drop index if exists public.idx_content_reports_reporter_content;
create unique index if not exists idx_content_reports_active_unique
  on public.content_reports (reporter_id, content_type, content_id)
  where status in ('pending', 'reviewing');

-- ============================================================================
-- 9. MODERATION AUDIT LOGS
-- ============================================================================

create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  actor_role text not null check (actor_role in ('moderator', 'admin')),
  action_type text not null,
  target_type text not null,
  target_id text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.moderation_logs
  drop constraint if exists fk_moderation_logs_actor_profile;
alter table public.moderation_logs
  add constraint fk_moderation_logs_actor_profile
  foreign key (actor_id) references public.profiles(id) on delete cascade;

create index if not exists idx_moderation_logs_created_at
  on public.moderation_logs(created_at desc);
create index if not exists idx_moderation_logs_actor_id
  on public.moderation_logs(actor_id, created_at desc);

alter table public.moderation_logs enable row level security;

drop policy if exists "Moderators and admins can view moderation logs" on public.moderation_logs;
create policy "Moderators and admins can view moderation logs"
  on public.moderation_logs for select
  using ( public.is_moderator_or_admin(auth.uid()) );

drop policy if exists "Moderators and admins can insert moderation logs" on public.moderation_logs;
create policy "Moderators and admins can insert moderation logs"
  on public.moderation_logs for insert
  with check (
    auth.uid() = actor_id
    and public.is_moderator_or_admin(auth.uid())
  );
