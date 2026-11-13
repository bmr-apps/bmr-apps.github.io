-- 공용 주소 점검 결과 (앱마다 최신 1건). 앱 저장소의 GitHub Actions 가 OIDC 토큰으로 hub-checks 함수에 보내고,
-- 함수(서비스 역할)만 쓴다. 보기: 관리자 전체, 개발자는 자기가 담당인 앱만.
create table if not exists public.app_checks (
  app_id bigint primary key references public.apps(id) on delete cascade,
  received_at timestamptz not null default now(),
  commit_sha text not null,
  run_id bigint,
  run_url text,
  workflow_ref text,
  files int not null default 0,
  total int not null default 0,
  new_count int not null default 0,
  by_rule jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  new_keys jsonb not null default '[]'::jsonb,
  block_dangerous boolean not null default false,
  first_seen jsonb not null default '{}'::jsonb
);
comment on table public.app_checks is '공용 주소 점검(경고만) 최신 결과. 쓰기는 hub-checks 함수(GitHub OIDC 검증)만.';
alter table public.app_checks enable row level security;

create or replace function private.owns_app(p_app_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select private.is_staff()) and exists (
    select 1 from public.app_owners o join auth.users u on lower(u.email) = lower(o.email)
    where o.app_id = p_app_id and u.id = (select auth.uid()))
$$;
revoke execute on function private.owns_app(bigint) from public, anon;
grant execute on function private.owns_app(bigint) to authenticated;

drop policy if exists app_checks_select on public.app_checks;
create policy app_checks_select on public.app_checks for select to authenticated
  using ((select private.is_admin()) or (select private.owns_app(app_id)));
revoke all on public.app_checks from anon, authenticated;
grant select on public.app_checks to authenticated;
