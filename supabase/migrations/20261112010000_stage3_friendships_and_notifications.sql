-- ============================================================================
-- Nayozu Stage 3 & 3.1: Mutual Friendships, Immutability, Verified Notifications
-- & Private Realtime Authorization
-- ============================================================================

-- 1. Mutual Friendships Table
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  pair_user_low uuid generated always as (least(requester_id, addressee_id)) stored,
  pair_user_high uuid generated always as (greatest(requester_id, addressee_id)) stored,
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz,
  constraint friendships_no_self_check check (requester_id <> addressee_id),
  constraint friendships_unique_pair unique (pair_user_low, pair_user_high)
);

create index if not exists idx_friendships_requester_status
  on public.friendships(requester_id, status, updated_at desc);

create index if not exists idx_friendships_addressee_status
  on public.friendships(addressee_id, status, updated_at desc);

create index if not exists idx_friendships_status_updated
  on public.friendships(status, updated_at desc);

-- Enforce strict row identity immutability and valid state transitions on UPDATE
create or replace function public.enforce_friendship_update_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id <> old.id then
    raise exception 'Friendship id is immutable.';
  end if;

  if new.requester_id <> old.requester_id then
    raise exception 'Friendship requester_id is immutable.';
  end if;

  if new.addressee_id <> old.addressee_id then
    raise exception 'Friendship addressee_id is immutable.';
  end if;

  if new.created_at <> old.created_at then
    raise exception 'Friendship created_at is immutable.';
  end if;

  if old.status = 'accepted' and new.status <> 'accepted' then
    raise exception 'Accepted friendship status cannot be reverted.';
  end if;

  if old.status = 'pending' and new.status <> 'accepted' then
    raise exception 'Pending friendship can only transition to accepted.';
  end if;

  if auth.uid() is not null and auth.uid() <> old.addressee_id then
    raise exception 'Only the intended addressee can accept a pending friend request.';
  end if;

  new.updated_at := timezone('utc', now());
  if old.status = 'pending' and new.status = 'accepted' then
    new.responded_at := coalesce(new.responded_at, timezone('utc', now()));
  end if;

  return new;
end;
$$;

drop trigger if exists set_friendships_updated_at on public.friendships;
drop trigger if exists enforce_friendships_immutability_on_update on public.friendships;
create trigger enforce_friendships_immutability_on_update
  before update on public.friendships
  for each row execute function public.enforce_friendship_update_immutability();

alter table public.friendships enable row level security;

-- Participants can view their own pending requests and accepted friendships
drop policy if exists "friendships_select_participants" on public.friendships;
create policy "friendships_select_participants"
  on public.friendships
  for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Only the authenticated requester (non-restricted, non-blocked, non-self) can create a pending friend request
drop policy if exists "friendships_insert_requester" on public.friendships;
create policy "friendships_insert_requester"
  on public.friendships
  for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and requester_id <> addressee_id
    and status = 'pending'
    and not public.is_user_actively_restricted(auth.uid())
    and not public.is_blocked_between(requester_id, addressee_id)
  );

-- Only the addressee (non-restricted, non-blocked) can accept an incoming pending request
drop policy if exists "friendships_update_addressee_accept" on public.friendships;
create policy "friendships_update_addressee_accept"
  on public.friendships
  for update
  to authenticated
  using (
    auth.uid() = addressee_id
    and status = 'pending'
  )
  with check (
    auth.uid() = addressee_id
    and status = 'accepted'
    and not public.is_user_actively_restricted(auth.uid())
    and not public.is_blocked_between(requester_id, addressee_id)
  );

-- Either participant can delete the row (requester cancels pending, addressee declines pending, or either removes accepted friend)
drop policy if exists "friendships_delete_participants" on public.friendships;
create policy "friendships_delete_participants"
  on public.friendships
  for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- 2. Helper Function: Check if two users are accepted friends
create or replace function public.are_users_friends(user_a uuid, user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when user_a is null or user_b is null or user_a = user_b then false
    when auth.uid() <> user_a and auth.uid() <> user_b then false
    when public.is_blocked_between(user_a, user_b) then false
    else exists (
      select 1
      from public.friendships f
      where f.pair_user_low = least(user_a, user_b)
        and f.pair_user_high = greatest(user_a, user_b)
        and f.status = 'accepted'
    )
  end;
$$;

revoke all on function public.are_users_friends(uuid, uuid) from public;
grant execute on function public.are_users_friends(uuid, uuid) to authenticated;

-- 3. User Notifications Table (Restricted Insertion & Immutability)
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  notification_type text not null
    check (notification_type in ('friend_request_received', 'friend_request_accepted', 'system')),
  dedupe_key text not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  body text check (body is null or char_length(body) <= 500),
  link_url text not null default '/profile?tab=friends',
  is_read boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_notifications_no_self_actor check (actor_id is null or user_id <> actor_id),
  constraint user_notifications_user_dedupe_unique unique (user_id, dedupe_key)
);

create index if not exists idx_user_notifications_user_created
  on public.user_notifications(user_id, is_read, created_at desc);

create index if not exists idx_user_notifications_actor
  on public.user_notifications(actor_id);

-- Prevent authenticated recipients from mutating notification content/metadata during mark-as-read updates
create or replace function public.enforce_user_notification_update_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('nayozu.internal_notification_sync', true) = 'true' then
    new.updated_at := timezone('utc', now());
    return new;
  end if;

  if new.id <> old.id
     or new.user_id <> old.user_id
     or new.actor_id is distinct from old.actor_id
     or new.notification_type <> old.notification_type
     or new.dedupe_key <> old.dedupe_key
     or new.title <> old.title
     or new.body is distinct from old.body
     or new.link_url <> old.link_url
     or new.created_at <> old.created_at then
    raise exception 'Notification content and metadata are immutable; only is_read may be updated.';
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_user_notifications_updated_at on public.user_notifications;
drop trigger if exists enforce_user_notifications_update on public.user_notifications;
create trigger enforce_user_notifications_update
  before update on public.user_notifications
  for each row execute function public.enforce_user_notification_update_immutability();

alter table public.user_notifications enable row level security;

-- Recipients can read their own notifications
drop policy if exists "user_notifications_select_own" on public.user_notifications;
create policy "user_notifications_select_own"
  on public.user_notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Direct client INSERT is intentionally NOT granted on public.user_notifications.
-- Notifications are created only by database triggers on public.friendships or via
-- the verified SECURITY DEFINER function public.create_verified_friend_notification.
drop policy if exists "user_notifications_insert_actor" on public.user_notifications;

-- Recipients can mark their own notifications as read (immutability trigger locks all other columns)
drop policy if exists "user_notifications_update_own" on public.user_notifications;
create policy "user_notifications_update_own"
  on public.user_notifications
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Recipients can delete their own notifications
drop policy if exists "user_notifications_delete_own_or_actor" on public.user_notifications;
drop policy if exists "user_notifications_delete_own" on public.user_notifications;
create policy "user_notifications_delete_own"
  on public.user_notifications
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4. Automatic Notification Synchronization Trigger on public.friendships
create or replace function public.sync_friend_notifications_on_friendship_change()
returns trigger
language plpgsql
security definer
set search_path = public
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
      timezone('utc', now())
    )
    on conflict (user_id, dedupe_key) do update
      set title = excluded.title,
          body = excluded.body,
          link_url = excluded.link_url,
          is_read = false,
          updated_at = timezone('utc', now());

    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    -- Mark the original incoming request notification as read for the addressee
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
      timezone('utc', now())
    )
    on conflict (user_id, dedupe_key) do update
      set title = excluded.title,
          body = excluded.body,
          link_url = excluded.link_url,
          is_read = false,
          updated_at = timezone('utc', now());

    return new;
  end if;

  if tg_op = 'DELETE' then
    delete from public.user_notifications
     where (user_id = old.requester_id and actor_id = old.addressee_id)
        or (user_id = old.addressee_id and actor_id = old.requester_id);
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists on_friendship_sync_notifications on public.friendships;
create trigger on_friendship_sync_notifications
  after insert or update or delete on public.friendships
  for each row execute function public.sync_friend_notifications_on_friendship_change();

-- Verified SECURITY DEFINER RPC for friend notifications (rejects fabricated/unverified calls)
create or replace function public.create_verified_friend_notification(
  target_user_id uuid,
  notif_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  actor_label text;
  has_valid_relationship boolean := false;
  computed_dedupe text;
  computed_title text;
  computed_body text;
  computed_link text;
begin
  if caller_id is null or target_user_id is null or caller_id = target_user_id then
    raise exception 'Invalid notification actor or recipient.';
  end if;

  if public.is_user_actively_restricted(caller_id) then
    raise exception 'Restricted users cannot create notifications.';
  end if;

  if public.is_blocked_between(caller_id, target_user_id) then
    raise exception 'Blocked users cannot create notifications.';
  end if;

  if notif_type = 'friend_request_received' then
    select exists (
      select 1
      from public.friendships f
      where f.requester_id = caller_id
        and f.addressee_id = target_user_id
        and f.status = 'pending'
    ) into has_valid_relationship;

    if not has_valid_relationship then
      raise exception 'Cannot create friend_request_received notification without an active pending friend request.';
    end if;

    select coalesce(nullif(trim(p.display_name), ''), p.username, 'A member')
      into actor_label
      from public.profiles p
     where p.id = caller_id;
    actor_label := coalesce(actor_label, 'A member');

    computed_dedupe := 'friend_request_received:' || caller_id::text || ':' || target_user_id::text;
    computed_title := left(actor_label || ' sent you a friend request', 200);
    computed_body := 'Review and accept or decline this request in your Friends tab.';
    computed_link := '/profile?tab=friends&subtab=incoming';

  elsif notif_type = 'friend_request_accepted' then
    select exists (
      select 1
      from public.friendships f
      where f.requester_id = target_user_id
        and f.addressee_id = caller_id
        and f.status = 'accepted'
    ) into has_valid_relationship;

    if not has_valid_relationship then
      raise exception 'Cannot create friend_request_accepted notification without an accepted friendship.';
    end if;

    select coalesce(nullif(trim(p.display_name), ''), p.username, 'A member')
      into actor_label
      from public.profiles p
     where p.id = caller_id;
    actor_label := coalesce(actor_label, 'A member');

    computed_dedupe := 'friend_request_accepted:' || caller_id::text || ':' || target_user_id::text;
    computed_title := left(actor_label || ' accepted your friend request', 200);
    computed_body := 'You are now connected as friends on Nayozu.';
    computed_link := '/profile?tab=friends&subtab=friends';
  else
    raise exception 'Unsupported notification type.';
  end if;

  perform set_config('nayozu.internal_notification_sync', 'true', true);

  insert into public.user_notifications (
    user_id,
    actor_id,
    notification_type,
    dedupe_key,
    title,
    body,
    link_url,
    is_read,
    updated_at
  ) values (
    target_user_id,
    caller_id,
    notif_type,
    computed_dedupe,
    computed_title,
    computed_body,
    computed_link,
    false,
    timezone('utc', now())
  )
  on conflict (user_id, dedupe_key) do update
    set title = excluded.title,
        body = excluded.body,
        link_url = excluded.link_url,
        is_read = false,
        updated_at = timezone('utc', now());

  return true;
end;
$$;

revoke all on function public.create_verified_friend_notification(uuid, text) from public;
grant execute on function public.create_verified_friend_notification(uuid, text) to authenticated;

-- 5. Automatic Friendship & Notification Cleanup Trigger on Block
create or replace function public.cleanup_friendship_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Remove any pending request or accepted friendship between blocker and blocked user
  delete from public.friendships
  where pair_user_low = least(new.blocker_id, new.blocked_id)
    and pair_user_high = greatest(new.blocker_id, new.blocked_id);

  -- Remove any friend notifications between the two users in either direction
  delete from public.user_notifications
  where (user_id = new.blocker_id and actor_id = new.blocked_id)
     or (user_id = new.blocked_id and actor_id = new.blocker_id);

  return new;
end;
$$;

drop trigger if exists on_user_block_cleanup_friendship on public.user_blocks;
create trigger on_user_block_cleanup_friendship
  after insert on public.user_blocks
  for each row execute function public.cleanup_friendship_on_block();

-- 6. Private Friend-Pair Realtime Channel Authorization (`realtime.messages`)
create or replace function public.can_access_friend_pair_realtime_topic(topic_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  low_part text;
  high_part text;
  low_uid uuid;
  high_uid uuid;
begin
  if caller_id is null or topic_text is null then
    return false;
  end if;

  if topic_text !~ '^nayozu:friend-pair:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;

  low_part := split_part(topic_text, ':', 3);
  high_part := split_part(topic_text, ':', 4);
  low_uid := low_part::uuid;
  high_uid := high_part::uuid;

  if low_uid >= high_uid then
    return false;
  end if;

  if caller_id <> low_uid and caller_id <> high_uid then
    return false;
  end if;

  if public.is_user_actively_restricted(caller_id) then
    return false;
  end if;

  if public.is_blocked_between(low_uid, high_uid) then
    return false;
  end if;

  return exists (
    select 1
    from public.friendships f
    where f.pair_user_low = low_uid
      and f.pair_user_high = high_uid
      and f.status = 'accepted'
  );
end;
$$;

revoke all on function public.can_access_friend_pair_realtime_topic(text) from public;
grant execute on function public.can_access_friend_pair_realtime_topic(text) to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'realtime'
      and c.relname = 'messages'
  ) then
    execute 'drop policy if exists "realtime_messages_select_friend_pair" on realtime.messages';
    execute $pol$
      create policy "realtime_messages_select_friend_pair"
        on realtime.messages
        for select
        to authenticated
        using (
          realtime.topic() like 'nayozu:friend-pair:%'
          and public.can_access_friend_pair_realtime_topic(realtime.topic())
        )
    $pol$;

    execute 'drop policy if exists "realtime_messages_insert_friend_pair" on realtime.messages';
    execute $pol$
      create policy "realtime_messages_insert_friend_pair"
        on realtime.messages
        for insert
        to authenticated
        with check (
          realtime.topic() like 'nayozu:friend-pair:%'
          and public.can_access_friend_pair_realtime_topic(realtime.topic())
        )
    $pol$;
  end if;
end
$$;
