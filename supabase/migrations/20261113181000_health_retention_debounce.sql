-- 운영 상태 점검 기록 정리·장애 판정 완화
-- 1) health_checks 는 30일 지난 행을 매일 지운다 (pg_cron, 매시 점검 작업 hub-health-hourly 와 같은 방식)
-- 2) 원본 행은 그대로 두고, 최신 상태 보기(app_health_latest)에 연속 실패 횟수·판정을 더한다
--    state: 'ok' 정상 · 'checking' 한 번 실패(확인 중) · 'down' 2번 이상 연속 실패(장애)

create or replace function private.prune_health_checks() returns integer
language sql security definer set search_path = '' as $$
  with d as (delete from public.health_checks where checked_at < now() - interval '30 days' returning 1)
  select count(*)::int from d
$$;
revoke all on function private.prune_health_checks() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'hub-health-prune';
  perform cron.schedule('hub-health-prune', '40 18 * * *', 'select private.prune_health_checks()');  -- 매일 03:40 (한국 시간)
end $$;

create or replace view public.app_health_latest with (security_invoker = true) as
select l.app_id, l.checked_at, l.url, l.http_status, l.ok, l.response_ms, l.error,
  s.fail_streak,
  case when l.ok then 'ok' when s.fail_streak >= 2 then 'down' else 'checking' end as state
from (select distinct on (app_id) app_id, checked_at, url, http_status, ok, response_ms, error
      from public.health_checks order by app_id, checked_at desc) l
cross join lateral (
  select count(*)::int as fail_streak from public.health_checks x
  where x.app_id = l.app_id and not x.ok
    and x.checked_at > coalesce((select max(y.checked_at) from public.health_checks y where y.app_id = l.app_id and y.ok), '-infinity'::timestamptz)
) s;
grant select on public.app_health_latest to authenticated;
