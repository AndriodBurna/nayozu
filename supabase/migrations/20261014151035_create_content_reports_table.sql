-- Create content_reports table
create table public.content_reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid references auth.users not null,
  content_type text not null, -- e.g., 'rating', 'review', 'comment'
  content_id uuid not null, -- references the respective table's id
  reason text not null,
  explanation text,
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'resolved', 'dismissed')),
  resolved_at timestamp with time zone,
  resolver_id uuid references auth.users, -- moderator who resolved the report
  resolution_notes text,
  created_at timestamp with time zone default timezone('utc', now()) not null
);

-- Enable Row Level Security
alter table public.content_reports enable row level security;

-- Create policies for content_reports
create policy "Users can view their own reports"
  on public.content_reports for select
  using ( auth.uid() = reporter_id );

create policy "Moderators and admins can view all reports"
  on public.content_reports for select
  using ( exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin')) );

create policy "Users can insert their own reports"
  on public.content_reports for insert
  with check ( auth.uid() = reporter_id );

create policy "Moderators and admins can update reports (e.g., change status, add resolution notes)"
  on public.content_reports for update
  using ( exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin')) )
  with check ( exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin')) );

create policy "Moderators and admins can delete reports"
  on public.content_reports for delete
  using ( exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('moderator', 'admin')) );

-- Create unique constraint to prevent duplicate reports from the same user on the same content
create unique index idx_content_reports_reporter_content
  on public.content_reports (reporter_id, content_type, content_id);

-- Create indexes for common queries
create index idx_content_reports_status on public.content_reports(status);
create index idx_content_reports_content on public.content_reports(content_type, content_id);
