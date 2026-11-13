-- 개발자 셀프서비스 1단계: 자동 배포 요청(관리자 1클릭 승인) · 함수 배포 상태 · hub-devtools 횟수 제한.
-- 비밀값 값은 DB 어디에도 넣지 않는다 (함수 비밀값은 hub-devtools 가 관리 API 로 바로 넣고, 감사 기록엔 이름만).

-- ---------- 1. 개발자 요청 (지금은 '서버 함수 자동 배포 켜기' 하나) ----------
create table if not exists public.dev_requests (
  id bigint generated always as identity primary key,
  app_id bigint not null references public.apps (id) on delete cascade,
  kind text not null check (kind in ('fn_auto_deploy')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'canceled')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_email text not null default '' check (char_length(requested_email) <= 200),
  requested_name text not null default '' check (char_length(requested_name) <= 100),
  decided_by uuid references auth.users (id) on delete set null,
  decided_email text not null default '' check (char_length(decided_email) <= 200),
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.dev_requests is '개발자 → 관리자 요청 (1클릭 승인). 쓰기는 아래 함수로만.';
create unique index if not exists dev_requests_one_pending on public.dev_requests (app_id, kind) where status = 'pending';
create index if not exists dev_requests_app_idx on public.dev_requests (app_id, created_at desc);
create index if not exists dev_requests_requested_by_idx on public.dev_requests (requested_by);
create index if not exists dev_requests_decided_by_idx on public.dev_requests (decided_by);
alter table public.dev_requests enable row level security;
revoke all on public.dev_requests from anon, authenticated;
grant select on public.dev_requests to authenticated;
drop policy if exists dev_requests_select on public.dev_requests;
create policy dev_requests_select on public.dev_requests for select to authenticated
  using ((select private.is_admin()) or (select private.owns_app(app_id)));

create or replace function private.who_am_i() returns table (email text, name text)
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(p.email, ''), u.email, ''), coalesce(nullif(p.name, ''), u.email, '')
  from auth.users u left join public.profiles p on p.id = u.id where u.id = (select auth.uid())
$$;
revoke all on function private.who_am_i() from public, anon, authenticated;

-- 담당 개발자: 자동 배포를 켜 달라고 요청 (이미 대기 중이면 그 요청 번호를 돌려줌)
create or replace function public.request_fn_auto_deploy(p_app_id bigint, p_note text default '') returns bigint
language plpgsql security definer set search_path = '' as $$
declare a public.apps%rowtype; rid bigint; e text; n text; recent int;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  select * into a from public.apps where id = p_app_id;
  if not found then raise exception '앱이 없습니다' using errcode = 'P0002'; end if;
  if not (select private.owns_app(a.id)) then raise exception '이 앱의 담당 개발자만 요청할 수 있습니다' using errcode = '42501'; end if;
  if a.fn_auto_deploy then raise exception '이미 자동 배포가 켜져 있습니다' using errcode = 'P0001'; end if;
  select id into rid from public.dev_requests where app_id = a.id and kind = 'fn_auto_deploy' and status = 'pending';
  if rid is not null then return rid; end if;
  select count(*) into recent from public.dev_requests where app_id = a.id and created_at > now() - interval '1 day';
  if recent >= 5 then raise exception '오늘은 더 요청할 수 없습니다. 내일 다시 해 주세요' using errcode = 'P0001'; end if;
  select w.email, w.name into e, n from private.who_am_i() w;
  insert into public.dev_requests (app_id, kind, note, requested_by, requested_email, requested_name)
  values (a.id, 'fn_auto_deploy', left(coalesce(p_note, ''), 500), auth.uid(), left(coalesce(e, ''), 200), left(coalesce(n, ''), 100))
  returning id into rid;
  insert into public.audit_log (actor, actor_email, action, target, result, detail)
  values (auth.uid(), coalesce(e, ''), 'request:fn_auto_deploy', a.slug, 'ok', left('요청 #' || rid || coalesce(' · ' || nullif(p_note, ''), ''), 2000));
  return rid;
end $$;

-- 관리자: 승인(자동 배포 켜기) 또는 반려. 서버에서 관리자인지 확인한다.
create or replace function public.decide_dev_request(p_request_id bigint, p_approve boolean, p_note text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare r public.dev_requests%rowtype; slug text; e text;
begin
  if auth.uid() is null or not (select private.is_admin()) then raise exception '관리자만 처리할 수 있습니다' using errcode = '42501'; end if;
  select * into r from public.dev_requests where id = p_request_id for update;
  if not found then raise exception '요청이 없습니다' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다' using errcode = 'P0001'; end if;
  select a.slug into slug from public.apps a where a.id = r.app_id;
  select w.email into e from private.who_am_i() w;
  if p_approve and r.kind = 'fn_auto_deploy' then
    update public.apps set fn_auto_deploy = true where id = r.app_id and not fn_auto_deploy;   -- 트리거가 fn:auto_deploy 감사 기록을 남김
  end if;
  update public.dev_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_email = left(coalesce(e, ''), 200), decision_note = left(coalesce(p_note, ''), 500), decided_at = now()
  where id = r.id;
  insert into public.audit_log (actor, actor_email, action, target, result, detail)
  values (auth.uid(), coalesce(e, ''), 'request:decide', coalesce(slug, ''), 'ok',
          left('요청 #' || r.id || ' 서버 함수 자동 배포 ' || case when p_approve then '승인(켬)' else '반려' end || coalesce(' · ' || nullif(p_note, ''), ''), 2000));
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

-- 요청한 사람(또는 담당 개발자)이 대기 중 요청 취소
create or replace function public.cancel_dev_request(p_request_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.dev_requests%rowtype; slug text; e text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  select * into r from public.dev_requests where id = p_request_id for update;
  if not found or not ((select private.is_admin()) or (select private.owns_app(r.app_id))) then raise exception '요청이 없습니다' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다' using errcode = 'P0001'; end if;
  update public.dev_requests set status = 'canceled', decided_at = now() where id = r.id;
  select a.slug into slug from public.apps a where a.id = r.app_id;
  select w.email into e from private.who_am_i() w;
  insert into public.audit_log (actor, actor_email, action, target, result, detail)
  values (auth.uid(), coalesce(e, ''), 'request:cancel', coalesce(slug, ''), 'ok', '요청 #' || r.id || ' 취소');
end $$;

revoke all on function public.request_fn_auto_deploy(bigint, text) from public, anon;
revoke all on function public.decide_dev_request(bigint, boolean, text) from public, anon;
revoke all on function public.cancel_dev_request(bigint) from public, anon;
grant execute on function public.request_fn_auto_deploy(bigint, text) to authenticated;
grant execute on function public.decide_dev_request(bigint, boolean, text) to authenticated;
grant execute on function public.cancel_dev_request(bigint) to authenticated;

-- ---------- 2. 서버 함수 마지막 배포 상태 (hub-fn-deploy 만 씀: 바뀐 함수만 배포) ----------
create table if not exists bmr_admin.fn_deploy_state (
  fn text primary key check (fn ~ '^[a-z][a-z0-9-]{1,62}$'),
  app_slug text not null,
  dir_sha text not null,
  commit_sha text not null,
  version int not null default 0,
  at timestamptz not null default now()
);
revoke all on bmr_admin.fn_deploy_state from public, anon, authenticated;

-- ---------- 3. hub-devtools 요청 횟수 (함수만) ----------
create table if not exists bmr_admin.devtools_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  ip text not null default '',
  action text not null default ''
);
create index if not exists devtools_attempts_at_idx on bmr_admin.devtools_attempts (at);
revoke all on bmr_admin.devtools_attempts from public, anon, authenticated;
