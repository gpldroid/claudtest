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
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

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

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));

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
