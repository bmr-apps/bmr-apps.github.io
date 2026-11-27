-- 주소(slug)의 DB 예약어·시스템 이름 차단 (2026-11-28)
-- '별무리 출석 프로그램'을 slug 'check' 로 승인했더니 hub-provision 의 db 단계가
--   create schema if not exists check ...
-- 구문 오류로 멈췄다(provision_status = 'failed'). 서버(supabase/functions/hub-provision/reserved.ts)와
-- 허브 화면이 같은 목록으로 먼저 막지만, API 로 직접 넣는 신청도 신청 단계에서 막도록 여기서 한 번 더 본다.
-- 목록을 바꾸면 reserved.ts 도 같이 고친다 (같은 규칙, 같은 문구).

create or replace function private.request_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if tg_op = 'INSERT' then
    v := private.slug_problem(new.slug);
    if v is not null then raise exception '%', v using errcode = '22023'; end if;
    -- 스키마 이름은 slug 의 하이픈이 밑줄이 된다 (bmr-admin -> bmr_admin)
    if replace(new.slug, '-', '_') = any (array[
      'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as',
      'asc', 'auth', 'authorize', 'begin', 'between', 'bmr', 'bmr_admin',
      'both', 'by', 'case', 'cast', 'check', 'collate', 'column',
      'commit', 'constraint', 'create', 'cron', 'cross', 'current_date', 'current_time',
      'current_timestamp', 'current_user', 'delete', 'desc', 'distinct', 'do', 'drop',
      'else', 'end', 'except', 'exists', 'extensions', 'false', 'fetch',
      'first', 'for', 'foreign', 'freeze', 'from', 'full', 'grant',
      'graphql', 'graphql_public', 'group', 'having', 'ilike', 'in', 'index',
      'information_schema', 'inner', 'insert', 'intersect', 'into', 'is', 'join',
      'lateral', 'left', 'like', 'limit', 'natural', 'net', 'next',
      'not', 'null', 'nullif', 'offset', 'on', 'only', 'or',
      'order', 'outer', 'over', 'partition', 'pg_catalog', 'pgbouncer', 'pgmq',
      'pgsodium', 'pgsodium_masks', 'pgtle', 'primary', 'private', 'public', 'realtime',
      'references', 'returning', 'revoke', 'right', 'role', 'rollback', 'row',
      'rows', 'schema', 'select', 'session_user', 'set', 'some', 'storage',
      'supabase_functions', 'supabase_migrations', 'table', 'then', 'to', 'topology', 'true',
      'union', 'unique', 'update', 'user', 'using', 'values', 'vault',
      'verbose', 'when', 'where', 'window', 'with'
    ]) then
      raise exception 'DB 예약어 또는 시스템 이름이라 사용할 수 없는 주소입니다. 다른 이름(예: bmr-check, attendance)을 써 주세요.'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.apps a where a.slug = new.slug)
       or exists (select 1 from public.app_requests r where r.slug = new.slug and r.status in ('pending', 'approved') and r.app_deleted_at is null)
       or exists (select 1 from public.app_deletions d where d.slug = new.slug and d.status <> 'done')
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
