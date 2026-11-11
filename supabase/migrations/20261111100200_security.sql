-- 권한: 모든 테이블 RLS. 역할 판정 함수(security definer)는 노출되지 않는 private 스키마에 둔다.
create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce((select private.my_role()) = 'admin', false) $$;
create or replace function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce((select private.my_role()) in ('staff', 'admin'), false) $$;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.my_role(), private.is_admin(), private.is_staff() to authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.profiles enable row level security;
alter table public.apps enable row level security;
alter table public.app_owners enable row level security;
alter table public.app_requests enable row level security;
alter table public.token_logs enable row level security;
alter table public.health_checks enable row level security;

-- profiles: 본인 또는 관리자 보기. 본인은 이름만, 관리자는 이름·역할을 바꾼다 (자기 역할은 못 바꿈)
grant select on public.profiles to authenticated;
grant update (name, role) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()) and role = (select private.my_role()));
create policy profiles_admin_update on public.profiles for update to authenticated
  using ((select private.is_admin()) and id <> (select auth.uid())) with check ((select private.is_admin()));

-- apps: 누구나 운영 중 앱의 공개 칸, 직원은 전체, 관리자만 쓰기
grant select (id, slug, name, description, url, status, sort) on public.apps to anon;
grant select, insert, update, delete on public.apps to authenticated;
create policy apps_public_select on public.apps for select to anon using (status = 'active');
create policy apps_select on public.apps for select to authenticated using (status = 'active' or (select private.is_staff()));
create policy apps_admin_insert on public.apps for insert to authenticated with check ((select private.is_admin()));
create policy apps_admin_update on public.apps for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy apps_admin_delete on public.apps for delete to authenticated using ((select private.is_admin()));

-- app_owners: 직원 보기(이메일 포함이라 anon 불가), 관리자 쓰기
grant select, insert, update, delete on public.app_owners to authenticated;
create policy owners_select on public.app_owners for select to authenticated using ((select private.is_staff()));
create policy owners_admin_insert on public.app_owners for insert to authenticated with check ((select private.is_admin()));
create policy owners_admin_update on public.app_owners for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy owners_admin_delete on public.app_owners for delete to authenticated using ((select private.is_admin()));

-- app_requests: 직원은 본인 신청만 넣고(대기 상태로만) 보기, 관리자는 전체 검토
grant select, insert, update, delete on public.app_requests to authenticated;
create policy requests_select on public.app_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select private.is_admin()));
create policy requests_staff_insert on public.app_requests for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending' and reviewed_by is null and reviewed_at is null
              and app_id is null and review_note = '' and (select private.is_staff()));
create policy requests_admin_update on public.app_requests for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy requests_delete on public.app_requests for delete to authenticated
  using ((requested_by = (select auth.uid()) and status = 'pending') or (select private.is_admin()));

-- token_logs: 관리자 전용
grant select, insert, update, delete on public.token_logs to authenticated;
create policy tokens_admin_select on public.token_logs for select to authenticated using ((select private.is_admin()));
create policy tokens_admin_insert on public.token_logs for insert to authenticated with check ((select private.is_admin()));
create policy tokens_admin_update on public.token_logs for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy tokens_admin_delete on public.token_logs for delete to authenticated using ((select private.is_admin()));

-- health_checks: 직원 보기, 기록은 Edge Function(service role)만
grant select on public.health_checks to authenticated;
grant select on public.app_health_latest to authenticated;
create policy health_select on public.health_checks for select to authenticated using ((select private.is_staff()));

-- 승인·반려: 호출자 권한(security invoker)이라 RLS가 그대로 적용된다
create or replace function public.approve_request(p_request_id bigint, p_note text default '')
returns bigint language plpgsql security invoker set search_path = '' as $$
declare r public.app_requests; v_app bigint;
begin
  if not (select private.is_admin()) then raise exception '관리자만 승인할 수 있습니다.' using errcode = '42501'; end if;
  select * into r from public.app_requests where id = p_request_id for update;
  if not found then raise exception '신청을 찾을 수 없습니다.'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 신청입니다.'; end if;
  if exists (select 1 from public.apps a where a.slug = r.slug) then raise exception '이미 쓰는 주소(%)입니다.', r.slug; end if;
  insert into public.apps (slug, name, description, url, repo_url, status, note)
  values (r.slug, r.app_name, r.purpose, 'https://apps.bmrschool.net/' || r.slug, 'https://github.com/bmr-apps/' || r.slug, 'preparing',
          case when r.has_student_pii then '학생 개인정보 처리: ' || r.data_handled else r.data_handled end)
  returning id into v_app;
  insert into public.app_owners (app_id, name, email, github_username, role)
  values (v_app, r.requester_name, r.requester_email, r.github_username, '책임');
  update public.app_requests set status = 'approved', review_note = coalesce(p_note, ''), reviewed_by = (select auth.uid()),
    reviewed_at = now(), app_id = v_app where id = r.id;
  return v_app;
end $$;
create or replace function public.reject_request(p_request_id bigint, p_note text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not (select private.is_admin()) then raise exception '관리자만 반려할 수 있습니다.' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception '반려 사유를 적어 주세요.'; end if;
  update public.app_requests set status = 'rejected', review_note = p_note, reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_request_id and status = 'pending';
  if not found then raise exception '대기 중인 신청이 아닙니다.'; end if;
end $$;
revoke execute on function public.approve_request(bigint, text), public.reject_request(bigint, text) from public, anon;
grant execute on function public.approve_request(bigint, text), public.reject_request(bigint, text) to authenticated;
