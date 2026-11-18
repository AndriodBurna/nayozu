-- ============================================================================
-- Nayozu Stage 3.1 (Phase 1 Final Verification):
-- 1. Harden SECURITY DEFINER function EXECUTE grants (revoke anon & PUBLIC)
--    and lock search_path to public, pg_temp.
-- 2. Enforce strict notification idempotency in create_verified_friend_notification
--    so repeated calls for the same friendship event never reset an already-read
--    notification (is_read = true) back to unread (is_read = false).
-- ============================================================================

-- 1. Update create_verified_friend_notification for strict idempotency & read-state preservation
create or replace function public.create_verified_friend_notification(
  target_user_id uuid,
  notif_type text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  actor_label text;
  relationship_event_at timestamptz;
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
    select f.created_at
      into relationship_event_at
      from public.friendships f
     where f.requester_id = caller_id
       and f.addressee_id = target_user_id
       and f.status = 'pending'
     limit 1;

    if relationship_event_at is null then
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
    select coalesce(f.responded_at, f.updated_at, f.created_at)
      into relationship_event_at
      from public.friendships f
     where f.requester_id = target_user_id
       and f.addressee_id = caller_id
       and f.status = 'accepted'
     limit 1;

    if relationship_event_at is null then
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
    created_at,
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
    greatest(timezone('utc', now()), relationship_event_at),
    timezone('utc', now())
  )
  on conflict (user_id, dedupe_key) do update
    set title = excluded.title,
        body = excluded.body,
        link_url = excluded.link_url,
        -- Only reset is_read to false if the existing notification row predates the current friendship event.
        -- Repeated calls for the same friendship event preserve an already-read notification (is_read = true).
        is_read = case
          when public.user_notifications.created_at < relationship_event_at then false
          else public.user_notifications.is_read
        end,
        created_at = case
          when public.user_notifications.created_at < relationship_event_at then greatest(timezone('utc', now()), relationship_event_at)
          else public.user_notifications.created_at
        end,
        updated_at = case
          when public.user_notifications.created_at < relationship_event_at then timezone('utc', now())
          else public.user_notifications.updated_at
        end;

  return true;
end;
$$;

-- 2. Harden can_access_friend_pair_realtime_topic search_path and privileges
create or replace function public.can_access_friend_pair_realtime_topic(topic_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
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

-- 3. Explicitly revoke EXECUTE from PUBLIC and anon on SECURITY DEFINER RPCs,
--    and grant only to authenticated and service_role.
revoke all on function public.can_access_friend_pair_realtime_topic(text) from public, anon;
grant execute on function public.can_access_friend_pair_realtime_topic(text) to authenticated, service_role;

revoke all on function public.create_verified_friend_notification(uuid, text) from public, anon;
grant execute on function public.create_verified_friend_notification(uuid, text) to authenticated, service_role;

revoke all on function public.are_users_friends(uuid, uuid) from public, anon;
grant execute on function public.are_users_friends(uuid, uuid) to authenticated, service_role;

revoke all on function public.get_bidirectional_blocked_user_ids() from public, anon;
grant execute on function public.get_bidirectional_blocked_user_ids() to authenticated, service_role;

-- Revoke direct RPC execution of internal trigger functions from public, anon, and authenticated
revoke all on function public.enforce_friendship_update_immutability() from public, anon, authenticated;
grant execute on function public.enforce_friendship_update_immutability() to service_role;

revoke all on function public.enforce_user_notification_update_immutability() from public, anon, authenticated;
grant execute on function public.enforce_user_notification_update_immutability() to service_role;

revoke all on function public.sync_friend_notifications_on_friendship_change() from public, anon, authenticated;
grant execute on function public.sync_friend_notifications_on_friendship_change() to service_role;

revoke all on function public.cleanup_friendship_on_block() from public, anon, authenticated;
grant execute on function public.cleanup_friendship_on_block() to service_role;
