-- Create user_roles table
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  role text not null check (role in ('moderator', 'admin')),
  granted_by uuid references auth.users,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

-- Enable Row Level Security
alter table public.user_roles enable row level security;

-- Helper functions (Security Definer) to avoid infinite recursion in RLS
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

-- Create policies for user_roles
create policy "Users can view their own roles"
  on public.user_roles for select
  using ( auth.uid() = user_id );

create policy "Moderators and admins can view all role assignments"
  on public.user_roles for select
  using ( public.is_moderator_or_admin(auth.uid()) );

create policy "Only admins can insert role assignments"
  on public.user_roles for insert
  with check ( public.is_admin(auth.uid()) );

create policy "Only admins can update role assignments"
  on public.user_roles for update
  using ( public.is_admin(auth.uid()) )
  with check ( public.is_admin(auth.uid()) );

create policy "Only admins can delete role assignments"
  on public.user_roles for delete
  using ( public.is_admin(auth.uid()) );

-- Create unique constraint to prevent duplicate role assignments for the same user and role
create unique index idx_user_roles_user_id_role
  on public.user_roles (user_id, role);

-- Create indexes for common queries
create index idx_user_roles_user_id on public.user_roles(user_id);
create index idx_user_roles_role on public.user_roles(role);

-- Policies for content_reports (deferred until user_roles exists)
create policy "Moderators and admins can view all reports"
  on public.content_reports for select
  using ( public.is_moderator_or_admin(auth.uid()) );

create policy "Moderators and admins can update reports"
  on public.content_reports for update
  using ( public.is_moderator_or_admin(auth.uid()) )
  with check ( public.is_moderator_or_admin(auth.uid()) );

create policy "Moderators and admins can delete reports"
  on public.content_reports for delete
  using ( public.is_moderator_or_admin(auth.uid()) );
