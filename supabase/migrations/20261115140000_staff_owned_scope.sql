-- 권한 경계 보완: 개발자(staff)는 담당 앱(app_owners)의 운영 자료만 읽는다.
-- 왜: 화면에서 담당 앱만 보여 주더라도, apps / app_owners / health_checks 의 기존 정책은
--     '직원이면 전부'라서 API 로 다른 앱의 준비·종료 상태, 담당자 메일, 점검 오류가 그대로 보였다.
--     운영 현황(hub-devtools ops_overview)은 이미 서버에서 거르므로, 같은 경계를 RLS 에도 맞춘다.
-- 관리자는 그대로 전부. 운영 중인 앱(status = 'active') 목록은 메인 화면용으로 누구나 볼 수 있다 (기존과 같음).
-- 담당 여부는 이미 있는 private.owns_app(app_id) 를 쓴다 (허브 로그인 uid → 메일 = app_owners.email, 직원만).

-- 1) 앱 목록: 운영 중은 공개, 그 밖(준비·중지·종료)은 관리자 또는 그 앱 담당자만
drop policy if exists apps_select on public.apps;
create policy apps_select on public.apps for select to authenticated
  using (
    status = 'active'
    or (select private.is_admin())
    or (select private.owns_app(id))
  );

-- 2) 담당자 명부: 관리자, 또는 그 앱의 담당자(공동 담당자 이름·메일도 포함). 다른 앱 담당자 메일은 숨긴다
drop policy if exists owners_select on public.app_owners;
create policy owners_select on public.app_owners for select to authenticated
  using ((select private.is_admin()) or (select private.owns_app(app_id)));

-- 3) 점검 기록: 관리자 또는 담당 앱만 (app_health_latest 보기는 security_invoker 라서 이 정책을 따른다)
drop policy if exists health_select on public.health_checks;
create policy health_select on public.health_checks for select to authenticated
  using ((select private.is_admin()) or (select private.owns_app(app_id)));
