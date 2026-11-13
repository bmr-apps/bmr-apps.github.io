-- Supabase 보안·성능 점검기 경고 정리 (2026-11-14)
-- 1) public.rls_auto_enable() 은 이벤트 트리거(ensure_rls)용 함수라 직접 부를 일이 없다.
--    /rest/v1/rpc 로 anon·authenticated 가 부를 수 있던 실행 권한만 거둔다. 트리거는 실행 권한과 상관없이 계속 동작한다
--    (authenticated 로 임시 표를 만들어 확인함). 다른 경고 함수(app_public_info·app_dev_info·reject_request)는 화면·앱이 rpc 로 부르므로 그대로 둔다.
-- 2) app_deletions.created_by 외래키 색인
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
create index if not exists app_deletions_created_by_idx on public.app_deletions (created_by);
