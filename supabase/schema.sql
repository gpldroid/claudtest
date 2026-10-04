create extension if not exists pgcrypto;
create table if not exists public.projects (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null, url text not null, package text not null,
 config jsonb not null default '{}'::jsonb, repo text,
 status text not null default 'draft' check (status in ('draft','building','ready','failed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.builds (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id) on delete cascade,
 run_url text, status text not null default 'queued', created_at timestamptz not null default now()
);
alter table public.projects enable row level security;
alter table public.builds enable row level security;
drop policy if exists projects_select_own on public.projects;
drop policy if exists projects_insert_own on public.projects;
drop policy if exists projects_update_own on public.projects;
drop policy if exists projects_delete_own on public.projects;
create policy projects_select_own on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy projects_insert_own on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy projects_update_own on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy projects_delete_own on public.projects for delete to authenticated using ((select auth.uid()) = user_id);
drop policy if exists builds_select_own on public.builds;
drop policy if exists builds_insert_own on public.builds;
create policy builds_select_own on public.builds for select to authenticated using (exists (select 1 from public.projects p where p.id=project_id and p.user_id=(select auth.uid())));
create policy builds_insert_own on public.builds for insert to authenticated with check (exists (select 1 from public.projects p where p.id=project_id and p.user_id=(select auth.uid())));
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.projects to authenticated;
grant select,insert on public.builds to authenticated;