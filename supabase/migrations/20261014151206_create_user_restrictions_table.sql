-- Create user_restrictions table
create table public.user_restrictions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  reason text not null,
  restricted_until timestamptz, -- null means indefinite restriction, or a future timestamp
  created_at timestamp with time zone default timezone('utc', now()) not null,
  created_by uuid references auth.users not null -- moderator who imposed the restriction
);

-- Enable Row Level Security
alter table public.user_restrictions enable row level security;

-- Create policies for user_restrictions
create policy "Users can view their own restrictions"
  on public.user_restrictions for select
  using ( auth.uid() = user_id );

create policy "Moderators and admins can view all restrictions"
  on public.user_restrictions for select
  using ( exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin')) );

create policy "Only moderators and admins can insert restrictions"
  on public.user_restrictions for insert
  with check (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin'))
  );

create policy "Only moderators and admins can update restrictions"
  on public.user_restrictions for update
  using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin'))
  )
  with check (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin'))
  );

create policy "Only moderators and admins can delete restrictions"
  on public.user_restrictions for delete
  using (
    exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin'))
  );

-- Create indexes for common queries
create index idx_user_restrictions_user_id on public.user_restrictions(user_id);
create index idx_user_restrictions_restricted_until on public.user_restrictions(restricted_until) where restricted_until is not null;
