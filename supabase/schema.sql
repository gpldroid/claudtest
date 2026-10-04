create extension if not exists pgcrypto;

-- Private helper schema is not exposed through the Supabase Data API.
create schema if not exists app_private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free')),
  max_projects integer not null default 10 check (max_projects > 0),
  max_builds_per_day integer not null default 10 check (max_builds_per_day > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null,
  url text not null,
  package text not null,
  version_name text not null default '1.0.0',
  version_code integer not null default 1 check (version_code > 0),
  icon_path text,
  splash_path text,
  settings jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  repo text,
  repo_full_name text,
  status text not null default 'draft' check (status in ('draft', 'building', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.builds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  run_id bigint,
  status text not null default 'queued' check (status in ('queued', 'in_progress', 'completed', 'failed', 'cancelled', 'expired')),
  conclusion text,
  run_url text,
  artifact_ids jsonb not null default '[]'::jsonb,
  version text,
  started_at timestamptz,
  finished_at timestamptz,
  log_excerpt text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Safe migration of the original schema.
alter table public.projects add column if not exists version_name text;
alter table public.projects add column if not exists version_code integer;
alter table public.projects add column if not exists icon_path text;
alter table public.projects add column if not exists splash_path text;
alter table public.projects add column if not exists settings jsonb;
alter table public.projects add column if not exists repo_full_name text;

update public.projects
set version_name = coalesce(nullif(version_name, ''), '1.0.0'),
    version_code = coalesce(version_code, 1),
    settings = coalesce(settings, config, '{}'::jsonb)
where version_name is null or version_code is null or settings is null;

alter table public.projects alter column version_name set default '1.0.0';
alter table public.projects alter column version_name set not null;
alter table public.projects alter column version_code set default 1;
alter table public.projects alter column version_code set not null;
alter table public.projects alter column settings set default '{}'::jsonb;
alter table public.projects alter column settings set not null;

alter table public.builds add column if not exists run_id bigint;
alter table public.builds add column if not exists conclusion text;
alter table public.builds add column if not exists artifact_ids jsonb;
alter table public.builds add column if not exists version text;
alter table public.builds add column if not exists started_at timestamptz;
alter table public.builds add column if not exists finished_at timestamptz;
alter table public.builds add column if not exists log_excerpt text;
update public.builds
set artifact_ids = coalesce(artifact_ids, '[]'::jsonb)
where artifact_ids is null;
alter table public.builds alter column artifact_ids set default '[]'::jsonb;
alter table public.builds alter column artifact_ids set not null;

-- Common indexes for ownership and quota checks.
create index if not exists projects_user_id_idx on public.projects(user_id);
create index if not exists builds_project_id_idx on public.builds(project_id);
create index if not exists builds_created_at_idx on public.builds(created_at);
create index if not exists audit_log_user_created_idx on public.audit_log(user_id, created_at desc);

-- Keep updated_at consistent without trusting the browser.
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function app_private.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function app_private.set_updated_at();

-- Create a least-privilege profile whenever a new auth user is created.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_user();

-- Quotas are enforced server-side and cannot be bypassed by changing client fields.
create or replace function app_private.enforce_project_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed integer;
  used_count integer;
begin
  select max_projects into allowed
  from public.profiles
  where id = new.user_id;

  if allowed is null then
    raise exception 'PROFILE_REQUIRED';
  end if;

  select count(*) into used_count
  from public.projects
  where user_id = new.user_id;

  if used_count >= allowed then
    raise exception 'PROJECT_QUOTA_EXCEEDED';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_enforce_quota on public.projects;
create trigger projects_enforce_quota
before insert on public.projects
for each row execute function app_private.enforce_project_quota();

create or replace function app_private.enforce_build_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  allowed integer;
  used_count integer;
begin
  select user_id into owner_id
  from public.projects
  where id = new.project_id;

  if owner_id is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  select max_builds_per_day into allowed
  from public.profiles
  where id = owner_id;

  if allowed is null then
    raise exception 'PROFILE_REQUIRED';
  end if;

  select count(*) into used_count
  from public.builds
  where project_id in (select id from public.projects where user_id = owner_id)
    and created_at >= date_trunc('day', now());

  if used_count >= allowed then
    raise exception 'BUILD_DAILY_QUOTA_EXCEEDED';
  end if;

  return new;
end;
$$;

drop trigger if exists builds_enforce_quota on public.builds;
create trigger builds_enforce_quota
before insert on public.builds
for each row execute function app_private.enforce_build_quota();

-- Audit records are created by trusted database triggers, not by the browser.
create or replace function app_private.audit_project_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text;
  row_id uuid;
  owner_id uuid;
begin
  if tg_op = 'INSERT' then
    action_name := 'project.created';
    row_id := new.id;
    owner_id := new.user_id;
  elsif tg_op = 'UPDATE' then
    action_name := 'project.updated';
    row_id := new.id;
    owner_id := new.user_id;
  else
    action_name := 'project.deleted';
    row_id := old.id;
    owner_id := old.user_id;
  end if;

  insert into public.audit_log (user_id, action, entity_type, entity_id, metadata)
  values (owner_id, action_name, 'project', row_id, jsonb_build_object('status', case when tg_op = 'DELETE' then old.status else new.status end));

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists projects_audit on public.projects;
create trigger projects_audit
after insert or update or delete on public.projects
for each row execute function app_private.audit_project_change();

create or replace function app_private.audit_build_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id from public.projects where id = new.project_id;

  insert into public.audit_log (user_id, action, entity_type, entity_id, metadata)
  values (
    owner_id,
    case when tg_op = 'INSERT' then 'build.created' else 'build.updated' end,
    'build',
    new.id,
    jsonb_build_object('status', new.status, 'conclusion', new.conclusion, 'run_id', new.run_id)
  );

  return new;
end;
$$;

drop trigger if exists builds_audit on public.builds;
create trigger builds_audit
after insert or update on public.builds
for each row execute function app_private.audit_build_change();

-- Profiles: users can read/update their own profile, but cannot change plan/quota fields.
alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id);
create or replace function app_private.protect_profile_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
begin
  if new.plan <> old.plan
     or new.max_projects <> old.max_projects
     or new.max_builds_per_day <> old.max_builds_per_day then
    raise exception 'PROFILE_LIMITS_READ_ONLY';
  end if;
  return new;
end;
$;

drop trigger if exists profiles_protect_limits on public.profiles;
create trigger profiles_protect_limits
before update on public.profiles
for each row execute function app_private.protect_profile_limits();

create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Projects: complete ownership isolation.
alter table public.projects enable row level security;
drop policy if exists projects_select_own on public.projects;
drop policy if exists projects_insert_own on public.projects;
drop policy if exists projects_update_own on public.projects;
drop policy if exists projects_delete_own on public.projects;
create policy projects_select_own on public.projects
for select to authenticated using ((select auth.uid()) = user_id);
create policy projects_insert_own on public.projects
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy projects_update_own on public.projects
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy projects_delete_own on public.projects
for delete to authenticated using ((select auth.uid()) = user_id);

-- Builds: users can see and create builds for their own projects.
-- Status changes are reserved for the trusted build synchronizer in later phases.
alter table public.builds enable row level security;
drop policy if exists builds_select_own on public.builds;
drop policy if exists builds_insert_own on public.builds;
drop policy if exists builds_update_own on public.builds;
drop policy if exists builds_delete_own on public.builds;
create policy builds_select_own on public.builds
for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = project_id and p.user_id = (select auth.uid())
));
create policy builds_insert_own on public.builds
for insert to authenticated
with check (exists (
  select 1 from public.projects p
  where p.id = project_id and p.user_id = (select auth.uid())
));

-- Audit log is read-only to users; trusted triggers/functions create rows.
alter table public.audit_log enable row level security;
drop policy if exists audit_log_select_own on public.audit_log;
drop policy if exists audit_log_insert_own on public.audit_log;
create policy audit_log_select_own on public.audit_log
for select to authenticated
using ((select auth.uid()) = user_id);

-- Storage buckets are private. Objects are stored as <user-id>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('icons', 'icons', false, 5242880, array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('splash', 'splash', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists icons_select_own on storage.objects;
drop policy if exists icons_insert_own on storage.objects;
drop policy if exists icons_update_own on storage.objects;
drop policy if exists icons_delete_own on storage.objects;
create policy icons_select_own on storage.objects
for select to authenticated
using (bucket_id = 'icons' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy icons_insert_own on storage.objects
for insert to authenticated
with check (bucket_id = 'icons' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy icons_update_own on storage.objects
for update to authenticated
using (bucket_id = 'icons' and (storage.foldername(name))[1] = (select auth.uid()::text))
with check (bucket_id = 'icons' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy icons_delete_own on storage.objects
for delete to authenticated
using (bucket_id = 'icons' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists splash_select_own on storage.objects;
drop policy if exists splash_insert_own on storage.objects;
drop policy if exists splash_update_own on storage.objects;
drop policy if exists splash_delete_own on storage.objects;
create policy splash_select_own on storage.objects
for select to authenticated
using (bucket_id = 'splash' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy splash_insert_own on storage.objects
for insert to authenticated
with check (bucket_id = 'splash' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy splash_update_own on storage.objects
for update to authenticated
using (bucket_id = 'splash' and (storage.foldername(name))[1] = (select auth.uid()::text))
with check (bucket_id = 'splash' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy splash_delete_own on storage.objects
for delete to authenticated
using (bucket_id = 'splash' and (storage.foldername(name))[1] = (select auth.uid()::text));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert on public.builds to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.audit_log to authenticated;

revoke all on schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
