-- 수업 디자이너를 허브에서 지웠으므로(2026-11-13) 'designer' 주소 예약을 푼다. 다른 예약어·앞뒤 규칙은 그대로
create or replace function private.slug_problem(p_slug text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_slug is null or p_slug !~ '^[a-z][a-z0-9-]{1,38}$' or p_slug like '%-' or p_slug like '%--%'
      then '주소는 영문 소문자로 시작하고 영문 소문자·숫자·하이픈 2~39자여야 합니다 (끝 하이픈·연속 하이픈 불가).'
    when p_slug ~ '^(pg|supabase|hub|bmr)(-|$)' or p_slug ~ '^supabase' or p_slug ~ '-(fn|dev|priv|svc)$'
      or p_slug = any (array['hub','login','assets','admin','api','www','static','public','auth','storage','private',
        'extensions','graphql','graphql-public','realtime','vault','cron','net','pgbouncer','supabase','information-schema',
        'bmr-apps','bmr-apps-github-io','apps','functions','rest','docs','help','test','anon','authenticated','authenticator',
        'service-role','postgres','dashboard-user','pgsodium','topology','tiger','bmr','bmr-admin','realtime-messages','net',
        'supabase-functions','supabase-migrations','storage-api','pgmq','pgtle','tle','repack','guide','guides','start','getting-started'])
      then '예약된 주소입니다. 다른 이름을 골라 주세요.'
    else null end
$$;
