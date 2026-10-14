-- Create user_roles table
create table public.user_roles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  role text not null check (role in ('moderator', 'admin')),
  granted_by uuid references auth.users,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

-- Enable Row Level Security
alter table public.user_roles enable row level security;

-- Create policies for user_roles
create policy "Users can view their own roles"
  on public.user_roles for select
  using ( auth.uid() = user_id );

create policy "Moderators and admins can view all role assignments"
  on public.user_roles for select
  using ( exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin')) );

create policy "Only admins can insert role assignments"
  on public.user_roles for insert
  with check (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );

create policy "Only admins can update role assignments"
  on public.user_roles for update
  using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );

create policy "Only admins can delete role assignments"
  on public.user_roles for delete
  using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin')
  );

-- Create unique constraint to prevent duplicate role assignments for the same user and role
create unique index idx_user_roles_user_id_role
  on public.user_roles (user_id, role);

-- Create indexes for common queries
create index idx_user_roles_user_id on public.user_roles(user_id);
create index idx_user_roles_role on public.user_roles(role);
