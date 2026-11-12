-- =============================================================================
-- Stage 1 Community & Activity Drawer Fixes:
-- Narrowly-scoped SECURITY DEFINER helper to retrieve bidirectional blocked
-- user IDs for the currently authenticated user (auth.uid()).
--
-- Why this exists:
-- `user_blocks` RLS intentionally restricts direct SELECT to rows where
-- `auth.uid() = blocker_id` so users cannot enumerate arbitrary block graphs.
-- However, server-side drawer & community feeds must exclude activity in BOTH
-- directions (users the caller blocked AND users who blocked the caller),
-- matching `public.is_blocked_between(user_a, user_b)`.
--
-- Security properties:
-- - Takes NO parameters; strictly scoped to `auth.uid()`.
-- - Returns only the peer UUIDs that must be excluded for the caller, without
--   exposing whether the peer is the blocker or the blocked party.
-- - Returns empty set for anonymous/unauthenticated callers (`auth.uid() is null`).
-- =============================================================================

create or replace function public.get_bidirectional_blocked_user_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select distinct
    case
      when b.blocker_id = auth.uid() then b.blocked_id
      else b.blocker_id
    end as excluded_user_id
  from public.user_blocks b
  where auth.uid() is not null
    and (b.blocker_id = auth.uid() or b.blocked_id = auth.uid());
$$;

revoke all on function public.get_bidirectional_blocked_user_ids() from public;
grant execute on function public.get_bidirectional_blocked_user_ids() to authenticated;
grant execute on function public.get_bidirectional_blocked_user_ids() to service_role;
