-- 승인 즉시 자동 생성 (Edge Function hub-provision) · 담당자 GitHub 권한 자동 반영 · 감사 기록 · slug 잠금 · 앱 공개 정보
-- 원칙: 개발자(staff)는 신청만, 관리자만 승인·생성·담당자 변경. 실제 생성·초대는 서버 함수만 한다.

-- ---------- 1. 주소(slug) 규칙: 예약어·시스템 이름 막기 (함수와 DB 가 같은 규칙) ----------
create or replace function private.slug_problem(p_slug text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_slug is null or p_slug !~ '^[a-z][a-z0-9-]{1,38}$' or p_slug like '%-' or p_slug like '%--%'
      then '주소는 영문 소문자로 시작하고 영문 소문자·숫자·하이픈 2~39자여야 합니다 (끝 하이픈·연속 하이픈 불가).'
    when p_slug ~ '^(pg|supabase|hub|bmr)(-|$)' or p_slug ~ '^supabase' or p_slug ~ '-(fn|dev|priv|svc)$'
      or p_slug = any (array['hub','login','assets','admin','api','www','static','designer','public','auth','storage','private',
        'extensions','graphql','graphql-public','realtime','vault','cron','net','pgbouncer','supabase','information-schema',
        'bmr-apps','bmr-apps-github-io','apps','functions','rest','docs','help','test','anon','authenticated','authenticator',
        'service-role','postgres','dashboard-user','pgsodium','topology','tiger','bmr','bmr-admin','realtime-messages','net',
        'supabase-functions','supabase-migrations','storage-api','pgmq','pgtle','tle','repack'])
      then '예약된 주소입니다. 다른 이름을 골라 주세요.'
    else null end
$$;
revoke execute on function private.slug_problem(text) from public, anon;
grant execute on function private.slug_problem(text) to authenticated;

-- ---------- 2. 신청: 생성 진행 기록 칸 ----------
alter table public.app_requests
  add column if not exists provision_status text check (provision_status in ('running', 'done', 'failed')),
  add column if not exists provision_steps jsonb not null default '{}'::jsonb,
  add column if not exists provision_error text check (char_length(provision_error) <= 2000),
  add column if not exists provision_started_at timestamptz,
  add column if not exists provision_finished_at timestamptz,
  add column if not exists provision_attempts int not null default 0,
  add column if not exists provision_lease_until timestamptz;

-- 개발자는 신청서 칸만 넣을 수 있다 (상태·진행 기록·검토 칸은 못 넣음)
revoke insert, update on public.app_requests from authenticated;
grant insert (requester_name, requester_email, app_name, slug, purpose, data_handled, has_student_pii, github_username) on public.app_requests to authenticated;
-- 관리자 화면에서 직접 고칠 수 있는 칸은 검토 메모뿐 (승인·생성은 hub-provision, 반려는 reject_request)
grant update (review_note) on public.app_requests to authenticated;

-- 신청 넣을 때: 주소 규칙·이미 쓰는 주소 확인
create or replace function private.request_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if tg_op = 'INSERT' then
    v := private.slug_problem(new.slug);
    if v is not null then raise exception '%', v using errcode = '22023'; end if;
    if exists (select 1 from public.apps a where a.slug = new.slug)
       or exists (select 1 from public.app_requests r where r.slug = new.slug and r.status in ('pending', 'approved'))
       or exists (select 1 from pg_namespace n where n.nspname = replace(new.slug, '-', '_'))
       or exists (select 1 from pg_roles r where r.rolname in (replace(new.slug, '-', '_'), replace(new.slug, '-', '_') || '_dev', replace(new.slug, '-', '_') || '_fn'))
    then raise exception '이미 쓰는 주소(%)입니다. 다른 이름을 골라 주세요.', new.slug using errcode = '23505'; end if;
  elsif tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug and session_user = 'authenticator' then
      raise exception '주소(slug)는 신청 뒤에 바꿀 수 없습니다.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists app_requests_guard on public.app_requests;
create trigger app_requests_guard before insert or update on public.app_requests for each row execute function private.request_guard();

-- 승인은 서버 함수(hub-provision)만: 옛 승인 RPC 는 막는다. 반려는 관리자 RPC 그대로 (권한 확인 후 definer 로 실행)
revoke execute on function public.approve_request(bigint, text) from authenticated;
create or replace function public.reject_request(p_request_id bigint, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_admin()) then raise exception '관리자만 반려할 수 있습니다.' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception '반려 사유를 적어 주세요.'; end if;
  update public.app_requests set status = 'rejected', review_note = p_note, reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_request_id and status = 'pending';
  if not found then raise exception '대기 중인 신청이 아닙니다.'; end if;
end $$;
revoke execute on function public.reject_request(bigint, text) from public, anon;
grant execute on function public.reject_request(bigint, text) to authenticated;

-- ---------- 3. 앱 주소(slug) 잠금: 만든 뒤에는 화면(API)에서 못 바꿈 ----------
create or replace function private.apps_slug_lock() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.slug is distinct from old.slug and (session_user = 'authenticator' or current_user in ('authenticated', 'anon')) then
    raise exception '주소(slug)는 만든 뒤에 바꿀 수 없습니다. 꼭 바꿔야 하면 관리자 봇에게 요청하세요.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists apps_slug_lock on public.apps;
create trigger apps_slug_lock before update on public.apps for each row execute function private.apps_slug_lock();

-- ---------- 4. 담당자: GitHub 권한 상태. 추가·수정·빼기는 서버 함수만 (GitHub 와 함께 바뀌도록) ----------
alter table public.app_owners
  add column if not exists gh_status text check (gh_status in ('invited', 'active', 'failed', 'no_repo')),
  add column if not exists gh_status_at timestamptz,
  add column if not exists gh_error text check (char_length(gh_error) <= 500);
revoke insert, update, delete on public.app_owners from authenticated;

-- ---------- 5. 감사 기록 (관리자만 봄, 서버 함수만 씀) ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_email text not null default '',
  action text not null check (char_length(action) <= 60),
  target text not null default '' check (char_length(target) <= 200),
  result text not null check (result in ('ok', 'error', 'denied')),
  detail text not null default '' check (char_length(detail) <= 2000)
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
drop policy if exists audit_admin_select on public.audit_log;
create policy audit_admin_select on public.audit_log for select to authenticated using ((select private.is_admin()));

-- 요청 횟수·동시 실행 (함수만)
create table if not exists bmr_admin.provision_attempts (
  id bigint generated always as identity primary key,
  user_id uuid, ip text not null, action text not null, at timestamptz not null default now()
);
create index if not exists provision_attempts_at_idx on bmr_admin.provision_attempts (at);
revoke all on bmr_admin.provision_attempts from public, anon, authenticated;
create table if not exists bmr_admin.provision_lease (
  id int primary key check (id = 1), request_id bigint, until timestamptz not null default '-infinity'
);
insert into bmr_admin.provision_lease (id) values (1) on conflict do nothing;
revoke all on bmr_admin.provision_lease from public, anon, authenticated;

-- ---------- 6. 앱 공개 정보 (앱 화면이 이름·설명을 허브에서 읽어 감, 공개 키로) ----------
create or replace function public.app_public_info(p_slug text) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object('slug', a.slug, 'name', a.name, 'description', a.description, 'status', a.status, 'url', a.url)
  from public.apps a where a.slug = p_slug and a.status <> 'retired'
$$;
revoke execute on function public.app_public_info(text) from public;
grant execute on function public.app_public_info(text) to anon, authenticated;
