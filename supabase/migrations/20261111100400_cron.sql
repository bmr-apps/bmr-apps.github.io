-- 매시 정각 운영 상태 점검 (pg_cron + pg_net). 호출 주소·비밀값은 Vault(hub_health_url, hub_cron_secret)에 둔다 (scripts/setup_cron_secret.mjs).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.run_health() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_secret text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'hub_cron_secret' limit 1);
  v_url text := (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'hub_health_url' limit 1);
begin
  if v_secret is null or v_url is null then raise warning 'hub_cron_secret / hub_health_url 이 없습니다'; return; end if;
  perform net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-hub-cron', v_secret),
                        body := '{"source":"cron"}'::jsonb, timeout_milliseconds := 60000);
  delete from public.health_checks where checked_at < now() - interval '30 days';
end $$;
revoke execute on function private.run_health() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'hub-health-hourly';
select cron.schedule('hub-health-hourly', '0 * * * *', 'select private.run_health()');
