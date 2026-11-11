-- 별무리 앱 관리 허브 (허브 전용 Supabase 프로젝트, public 스키마)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- 사용자·역할: 가입하면 pending, 관리자가 staff/admin으로 올린다 ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '' check (char_length(name) <= 100),
  role text not null default 'pending' check (role in ('pending', 'staff', 'admin', 'disabled')),
  created_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role);

-- ---------- 1. 서비스 목록 ----------
create table public.apps (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$' and slug not in ('hub', 'login', 'assets', 'admin', 'api', 'www', 'static')),
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  url text not null check (url ~ '^https?://'),
  repo_url text check (repo_url is null or repo_url ~ '^https://'),
  supabase_ref text check (supabase_ref is null or supabase_ref ~ '^[a-z0-9]{20}$'),
  status text not null default 'active' check (status in ('preparing', 'active', 'paused', 'retired')),
  note text not null default '' check (char_length(note) <= 1000),
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index apps_status_sort_idx on public.apps (status, sort);

-- ---------- 2. 담당 교사 ----------
create table public.app_owners (
  id bigint generated always as identity primary key,
  app_id bigint not null references public.apps (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+$'),
  github_username text check (github_username is null or github_username ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  role text not null default '담당' check (char_length(role) between 1 and 30),
  created_at timestamptz not null default now()
);
create index app_owners_app_id_idx on public.app_owners (app_id);

-- ---------- 3. 새 앱 신청·승인 ----------
create table public.app_requests (
  id bigint generated always as identity primary key,
  requested_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  requester_name text not null check (char_length(requester_name) between 1 and 100),
  requester_email text check (requester_email is null or requester_email ~ '^[^@\s]+@[^@\s]+$'),
  app_name text not null check (char_length(app_name) between 1 and 100),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$' and slug not in ('hub', 'login', 'assets', 'admin', 'api', 'www', 'static')),
  purpose text not null check (char_length(purpose) between 1 and 2000),
  data_handled text not null default '' check (char_length(data_handled) <= 2000),
  has_student_pii boolean not null,
  github_username text not null check (github_username ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '' check (char_length(review_note) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  app_id bigint references public.apps (id) on delete set null,
  created_at timestamptz not null default now()
);
create index app_requests_requested_by_idx on public.app_requests (requested_by);
create index app_requests_status_idx on public.app_requests (status, created_at desc);
create index app_requests_reviewed_by_idx on public.app_requests (reviewed_by);
create index app_requests_app_id_idx on public.app_requests (app_id);

-- ---------- 4. 토큰 발급 기록 (값은 절대 저장하지 않음) ----------
create table public.token_logs (
  id bigint generated always as identity primary key,
  app_id bigint references public.apps (id) on delete set null,
  kind text not null check (kind in ('github_pat', 'github_deploy_key', 'supabase_anon', 'supabase_service_role', 'supabase_access_token', 'gemini_api_key', 'other')),
  label text not null default '' check (char_length(label) <= 100),
  issued_to text not null check (char_length(issued_to) between 1 and 100),
  issued_at date not null default current_date,
  expires_at date,
  revoked_at date,
  memo text not null default '' check (char_length(memo) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint token_logs_no_secret check (
    (label || ' ' || memo) !~* '(ghp_|gho_|ghs_|ghu_|github_pat_|sbp_|sb_secret_|sb_publishable_|AIza[0-9A-Za-z_-]{20}|eyJ[A-Za-z0-9_-]{10,}\.)'
  )
);
create index token_logs_app_id_idx on public.token_logs (app_id);
create index token_logs_created_by_idx on public.token_logs (created_by);
create index token_logs_active_expiry_idx on public.token_logs (expires_at) where revoked_at is null;

-- ---------- 5. 운영 상태 점검 ----------
create table public.health_checks (
  id bigint generated always as identity primary key,
  app_id bigint not null references public.apps (id) on delete cascade,
  checked_at timestamptz not null default now(),
  url text not null,
  http_status int,
  ok boolean not null,
  response_ms int,
  error text
);
create index health_checks_app_checked_idx on public.health_checks (app_id, checked_at desc);
create index health_checks_checked_idx on public.health_checks (checked_at);

create view public.app_health_latest with (security_invoker = true) as
  select distinct on (h.app_id) h.app_id, h.checked_at, h.url, h.http_status, h.ok, h.response_ms, h.error
  from public.health_checks h
  order by h.app_id, h.checked_at desc;

create or replace function private.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger apps_touch before update on public.apps for each row execute function private.touch();

-- 새 가입자 → profiles (role = pending)
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, lower(coalesce(new.email, '')), left(coalesce(new.raw_user_meta_data->>'name', ''), 100))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
