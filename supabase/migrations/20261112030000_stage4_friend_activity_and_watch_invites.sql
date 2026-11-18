-- ============================================================================
-- Nayozu Stage 4: Friend Activity Feed Privacy & Watch Together Invitations
-- ============================================================================

-- 1. Profile Privacy Columns for Friend Activity & Watch Together Invite Notifications
alter table public.profiles
  add column if not exists share_activity_with_friends boolean not null default true,
  add column if not exists share_library_activity_with_friends boolean not null default true,
  add column if not exists notify_watch_together_invites boolean not null default true;

-- 2. Database-Enforced Friend Library Activity Helper
-- Why this exists:
-- `public.user_anime_library` RLS intentionally restricts direct SELECT to `auth.uid() = user_id`
-- so personal library contents and progress never become publicly accessible (even for public profiles).
-- This SECURITY DEFINER function returns ONLY active watching/reading and completed library milestones
-- from accepted, non-blocked, non-restricted friends who have explicitly enabled both
-- `share_activity_with_friends = true` and `share_library_activity_with_friends = true`.
create or replace function public.get_permitted_friend_library_activities(
  p_limit integer default 60
)
returns table (
  id uuid,
  user_id uuid,
  anime_id text,
  status text,
  progress integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.id,
    l.user_id,
    l.anime_id,
    l.status,
    coalesce(l.progress, 0) as progress,
    l.created_at,
    l.updated_at
  from public.user_anime_library l
  join public.friendships f
    on f.pair_user_low = least(auth.uid(), l.user_id)
   and f.pair_user_high = greatest(auth.uid(), l.user_id)
   and f.status = 'accepted'
  join public.profiles p
    on p.id = l.user_id
  where auth.uid() is not null
    and l.user_id <> auth.uid()
    and not public.is_user_actively_restricted(auth.uid())
    and not public.is_user_actively_restricted(l.user_id)
    and not public.is_blocked_between(auth.uid(), l.user_id)
    and p.share_activity_with_friends = true
    and p.share_library_activity_with_friends = true
    and l.anime_id !~ '^fav:'
    and l.status in ('watching', 'completed')
  order by l.updated_at desc
  limit least(greatest(coalesce(p_limit, 60), 1), 120);
$$;

revoke all on function public.get_permitted_friend_library_activities(integer) from public, anon;
grant execute on function public.get_permitted_friend_library_activities(integer) to authenticated, service_role;

-- 3. Expand user_notifications notification_type constraint to support watch_room_invite_received
alter table public.user_notifications
  drop constraint if exists user_notifications_notification_type_check;

alter table public.user_notifications
  add constraint user_notifications_notification_type_check
  check (
    notification_type in (
      'friend_request_received',
      'friend_request_accepted',
      'watch_room_invite_received',
      'system'
    )
  );

-- 4. Helper: Verify a Watch Together room row is owned by the given host and is active/unhidden
create or replace function public.is_valid_host_watch_room_for_invite(
  p_room_id uuid,
  p_host_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text;
  v_status text;
begin
  if p_room_id is null or p_host_id is null then
    return false;
  end if;

  select c.body
    into v_body
    from public.anime_comments c
   where c.id = p_room_id
     and c.user_id = p_host_id
     and c.anime_id = 'watch_room'
     and c.parent_comment_id is null
     and c.is_hidden = false
   limit 1;

  if v_body is null then
    return false;
  end if;

  begin
    v_status := (v_body::jsonb ->> 'status');
  exception when others then
    return false;
  end;

  if v_status = 'ended' then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.is_valid_host_watch_room_for_invite(uuid, uuid) from public, anon;
grant execute on function public.is_valid_host_watch_room_for_invite(uuid, uuid) to authenticated, service_role;

-- 5. Watch Together Friend Invitations Table
create table if not exists public.watch_room_invitations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.anime_comments(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  room_title_snapshot text not null
    check (char_length(trim(room_title_snapshot)) between 1 and 120),
  anime_external_id text not null
    check (char_length(trim(anime_external_id)) between 1 and 40),
  anime_slug text,
  anime_title text not null
    check (char_length(trim(anime_title)) between 1 and 200),
  anime_cover text,
  episode_number integer not null default 1
    check (episode_number >= 1),
  room_privacy text not null default 'public'
    check (room_privacy in ('public', 'private')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '2 hours'),
  constraint watch_room_invitations_no_self check (host_id <> invitee_id)
);

-- Prevent duplicate active (pending or accepted) invitations for the same room and invitee
create unique index if not exists idx_watch_room_invitations_active_unique
  on public.watch_room_invitations(room_id, invitee_id)
  where status in ('pending', 'accepted');

create index if not exists idx_watch_room_invitations_invitee_status
  on public.watch_room_invitations(invitee_id, status, created_at desc);

create index if not exists idx_watch_room_invitations_host_room
  on public.watch_room_invitations(host_id, room_id, status, created_at desc);

-- 6. Immutability & Lifecycle Transition Trigger on public.watch_room_invitations
create or replace function public.enforce_watch_room_invitation_immutability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.id <> old.id
     or new.room_id <> old.room_id
     or new.host_id <> old.host_id
     or new.invitee_id <> old.invitee_id
     or new.room_title_snapshot <> old.room_title_snapshot
     or new.anime_external_id <> old.anime_external_id
     or new.anime_slug is distinct from old.anime_slug
     or new.anime_title <> old.anime_title
     or new.anime_cover is distinct from old.anime_cover
     or new.episode_number <> old.episode_number
     or new.room_privacy <> old.room_privacy
     or new.created_at <> old.created_at
     or new.expires_at <> old.expires_at then
    raise exception 'Watch Together invitation metadata and participant IDs are immutable.';
  end if;

  -- Terminal states (accepted, declined, expired, cancelled) cannot be transitioned or reused
  if old.status <> 'pending' and new.status <> old.status then
    raise exception 'Invitation is already % and cannot be modified or reused.', old.status;
  end if;

  if old.status = 'pending' and new.status <> 'pending' then
    if auth.uid() is not null then
      if new.status = 'cancelled' and auth.uid() <> old.host_id then
        raise exception 'Only the room host can cancel a pending invitation.';
      end if;

      if new.status in ('accepted', 'declined') and auth.uid() <> old.invitee_id then
        raise exception 'Only the invited recipient can accept or decline an invitation.';
      end if;

      if new.status = 'expired' and auth.uid() <> old.host_id and auth.uid() <> old.invitee_id then
        raise exception 'Unauthorized invitation expiration update.';
      end if;
    end if;

    if new.status = 'accepted' then
      if old.expires_at <= timezone('utc', now()) then
        raise exception 'This Watch Together invitation has expired.';
      end if;

      if public.is_blocked_between(old.host_id, old.invitee_id) then
        raise exception 'Cannot accept an invitation when a block exists between users.';
      end if;

      if not exists (
        select 1
        from public.friendships f
        where f.pair_user_low = least(old.host_id, old.invitee_id)
          and f.pair_user_high = greatest(old.host_id, old.invitee_id)
          and f.status = 'accepted'
      ) then
        raise exception 'Only accepted friends can accept a Watch Together invitation.';
      end if;

      if not public.is_valid_host_watch_room_for_invite(old.room_id, old.host_id) then
        raise exception 'This Watch Together room has ended or is no longer available.';
      end if;
    end if;

    new.responded_at := coalesce(new.responded_at, timezone('utc', now()));
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.enforce_watch_room_invitation_immutability() from public, anon, authenticated;
grant execute on function public.enforce_watch_room_invitation_immutability() to service_role;

drop trigger if exists enforce_watch_room_invitations_update on public.watch_room_invitations;
create trigger enforce_watch_room_invitations_update
  before update on public.watch_room_invitations
  for each row execute function public.enforce_watch_room_invitation_immutability();

-- 7. Row Level Security on public.watch_room_invitations
alter table public.watch_room_invitations enable row level security;

drop policy if exists "watch_room_invitations_select_participants" on public.watch_room_invitations;
create policy "watch_room_invitations_select_participants"
  on public.watch_room_invitations
  for select
  to authenticated
  using (
    (auth.uid() = host_id or auth.uid() = invitee_id)
    and not public.is_blocked_between(host_id, invitee_id)
  );

drop policy if exists "watch_room_invitations_insert_host" on public.watch_room_invitations;
create policy "watch_room_invitations_insert_host"
  on public.watch_room_invitations
  for insert
  to authenticated
  with check (
    auth.uid() = host_id
    and host_id <> invitee_id
    and status = 'pending'
    and not public.is_user_actively_restricted(auth.uid())
    and not public.is_user_actively_restricted(invitee_id)
    and not public.is_blocked_between(host_id, invitee_id)
    and public.are_users_friends(host_id, invitee_id)
    and public.is_valid_host_watch_room_for_invite(room_id, host_id)
  );

drop policy if exists "watch_room_invitations_update_participants" on public.watch_room_invitations;
create policy "watch_room_invitations_update_participants"
  on public.watch_room_invitations
  for update
  to authenticated
  using (
    (auth.uid() = host_id or auth.uid() = invitee_id)
    and not public.is_user_actively_restricted(auth.uid())
  )
  with check (
    (auth.uid() = host_id or auth.uid() = invitee_id)
    and not public.is_user_actively_restricted(auth.uid())
  );

drop policy if exists "watch_room_invitations_delete_participants" on public.watch_room_invitations;
create policy "watch_room_invitations_delete_participants"
  on public.watch_room_invitations
  for delete
  to authenticated
  using (auth.uid() = host_id or auth.uid() = invitee_id);

-- 8. Trusted Notification Synchronization Trigger for Watch Together Invitations
create or replace function public.sync_watch_room_invite_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  host_label text;
  invitee_wants_notif boolean := true;
  computed_dedupe text;
  computed_title text;
  computed_body text;
  computed_link text;
begin
  perform set_config('nayozu.internal_notification_sync', 'true', true);

  if tg_op = 'INSERT' and new.status = 'pending' then
    select coalesce(p.notify_watch_together_invites, true)
      into invitee_wants_notif
      from public.profiles p
     where p.id = new.invitee_id;

    if coalesce(invitee_wants_notif, true) = false then
      return new;
    end if;

    select coalesce(nullif(trim(p.display_name), ''), p.username, 'A friend')
      into host_label
      from public.profiles p
     where p.id = new.host_id;
    host_label := coalesce(host_label, 'A friend');

    computed_dedupe := 'watch_room_invite_received:' || new.room_id::text || ':' || new.invitee_id::text;
    computed_title := left(host_label || ' invited you to Watch Together', 200);

    -- Never leak private room custom title/details in notification text
    if new.room_privacy = 'private' then
      computed_body := left('Invited you to join a private Watch Together room for ' || new.anime_title || ' · Ep ' || new.episode_number::text, 500);
    else
      computed_body := left(new.room_title_snapshot || ' · ' || new.anime_title || ' (Ep ' || new.episode_number::text || ')', 500);
    end if;

    computed_link := '/watch-together?room=' || new.room_id::text || '&invite=' || new.id::text;

    insert into public.user_notifications (
      user_id,
      actor_id,
      notification_type,
      dedupe_key,
      title,
      body,
      link_url,
      is_read,
      created_at,
      updated_at
    ) values (
      new.invitee_id,
      new.host_id,
      'watch_room_invite_received',
      computed_dedupe,
      computed_title,
      computed_body,
      computed_link,
      false,
      new.created_at,
      timezone('utc', now())
    )
    on conflict (user_id, dedupe_key) do update
      set title = excluded.title,
          body = excluded.body,
          link_url = excluded.link_url,
          is_read = case
            when public.user_notifications.created_at < new.created_at then false
            else public.user_notifications.is_read
          end,
          created_at = greatest(public.user_notifications.created_at, new.created_at),
          updated_at = timezone('utc', now());

    return new;
  end if;

  if tg_op = 'UPDATE' then
    computed_dedupe := 'watch_room_invite_received:' || new.room_id::text || ':' || new.invitee_id::text;

    if new.status in ('accepted', 'declined') then
      update public.user_notifications
         set is_read = true,
             updated_at = timezone('utc', now())
       where user_id = new.invitee_id
         and dedupe_key = computed_dedupe;
    elsif new.status in ('cancelled', 'expired') then
      delete from public.user_notifications
       where user_id = new.invitee_id
         and dedupe_key = computed_dedupe;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    computed_dedupe := 'watch_room_invite_received:' || old.room_id::text || ':' || old.invitee_id::text;
    delete from public.user_notifications
     where user_id = old.invitee_id
       and dedupe_key = computed_dedupe;
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_watch_room_invite_notifications() from public, anon, authenticated;
grant execute on function public.sync_watch_room_invite_notifications() to service_role;

drop trigger if exists on_watch_room_invitation_sync_notifications on public.watch_room_invitations;
create trigger on_watch_room_invitation_sync_notifications
  after insert or update or delete on public.watch_room_invitations
  for each row execute function public.sync_watch_room_invite_notifications();

-- 9. Update block and friendship-removal triggers to also clean up pending Watch Together invitations
create or replace function public.cleanup_friendship_on_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Remove any pending request or accepted friendship between blocker and blocked user
  delete from public.friendships
  where pair_user_low = least(new.blocker_id, new.blocked_id)
    and pair_user_high = greatest(new.blocker_id, new.blocked_id);

  -- Cancel/delete any pending Watch Together invitations between the two users in either direction
  delete from public.watch_room_invitations
  where (host_id = new.blocker_id and invitee_id = new.blocked_id)
     or (host_id = new.blocked_id and invitee_id = new.blocker_id);

  -- Remove any friend or watch room invite notifications between the two users in either direction
  delete from public.user_notifications
  where (user_id = new.blocker_id and actor_id = new.blocked_id)
     or (user_id = new.blocked_id and actor_id = new.blocker_id);

  return new;
end;
$$;

revoke all on function public.cleanup_friendship_on_block() from public, anon, authenticated;
grant execute on function public.cleanup_friendship_on_block() to service_role;

create or replace function public.sync_friend_notifications_on_friendship_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_label text;
begin
  perform set_config('nayozu.internal_notification_sync', 'true', true);

  if tg_op = 'INSERT' and new.status = 'pending' then
    select coalesce(nullif(trim(p.display_name), ''), p.username, 'A member')
      into actor_label
      from public.profiles p
     where p.id = new.requester_id;

    actor_label := coalesce(actor_label, 'A member');

    insert into public.user_notifications (
      user_id,
      actor_id,
      notification_type,
      dedupe_key,
      title,
      body,
      link_url,
      is_read,
      created_at,
      updated_at
    ) values (
      new.addressee_id,
      new.requester_id,
      'friend_request_received',
      'friend_request_received:' || new.requester_id::text || ':' || new.addressee_id::text,
      left(actor_label || ' sent you a friend request', 200),
      'Review and accept or decline this request in your Friends tab.',
      '/profile?tab=friends&subtab=incoming',
      false,
      new.created_at,
      timezone('utc', now())
    )
    on conflict (user_id, dedupe_key) do update
      set title = excluded.title,
          body = excluded.body,
          link_url = excluded.link_url,
          is_read = false,
          created_at = greatest(public.user_notifications.created_at, new.created_at),
          updated_at = timezone('utc', now());

    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    update public.user_notifications
       set is_read = true,
           updated_at = timezone('utc', now())
     where user_id = new.addressee_id
       and actor_id = new.requester_id
       and notification_type = 'friend_request_received';

    select coalesce(nullif(trim(p.display_name), ''), p.username, 'A member')
      into actor_label
      from public.profiles p
     where p.id = new.addressee_id;

    actor_label := coalesce(actor_label, 'A member');

    insert into public.user_notifications (
      user_id,
      actor_id,
      notification_type,
      dedupe_key,
      title,
      body,
      link_url,
      is_read,
      created_at,
      updated_at
    ) values (
      new.requester_id,
      new.addressee_id,
      'friend_request_accepted',
      'friend_request_accepted:' || new.addressee_id::text || ':' || new.requester_id::text,
      left(actor_label || ' accepted your friend request', 200),
      'You are now connected as friends on Nayozu.',
      '/profile?tab=friends&subtab=friends',
      false,
      coalesce(new.responded_at, new.updated_at, timezone('utc', now())),
      timezone('utc', now())
    )
    on conflict (user_id, dedupe_key) do update
      set title = excluded.title,
          body = excluded.body,
          link_url = excluded.link_url,
          is_read = false,
          created_at = greatest(public.user_notifications.created_at, coalesce(new.responded_at, new.updated_at, timezone('utc', now()))),
          updated_at = timezone('utc', now());

    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Delete pending Watch Together invitations between users who are no longer friends
    delete from public.watch_room_invitations
     where status = 'pending'
       and (
         (host_id = old.requester_id and invitee_id = old.addressee_id)
         or (host_id = old.addressee_id and invitee_id = old.requester_id)
       );

    delete from public.user_notifications
     where (user_id = old.requester_id and actor_id = old.addressee_id)
        or (user_id = old.addressee_id and actor_id = old.requester_id);
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_friend_notifications_on_friendship_change() from public, anon, authenticated;
grant execute on function public.sync_friend_notifications_on_friendship_change() to service_role;
