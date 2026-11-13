-- 토큰 기록(public.token_logs) 기능을 없앤다. 같은 목적의 기록은 이제 감사 기록(public.audit_log)에 남긴다.
--   · DB 비밀번호 받기·새로 발급 → action 'dbcred:reveal' / 'dbcred:rotate', target = 앱 주소
--   · 사용자 관리(역할·사용 중지·비밀번호 초기화·삭제) → action 'user:*', target = 대상 이메일
-- 지우기 전 전체 행은 박스 /home/box/hub-backups/token-logs-20261113.json 에 백업함.
do $$
begin
  if to_regclass('public.token_logs') is not null then
    -- 시험 계정 기록을 뺀 실제 기록은 감사 기록으로 옮겨 둔다 (비밀값은 원래 없음)
    insert into public.audit_log (at, actor, actor_email, action, target, result, detail)
    select t.created_at, t.created_by, coalesce(p.email, ''),
      case
        when t.kind = 'supabase_db_password' then case when t.label like '%처음%' then 'dbcred:reveal' else 'dbcred:rotate' end
        when t.kind = 'hub_user' then case t.label when '역할 변경' then 'user:role' when '사용 중지' then 'user:disable' when '다시 사용' then 'user:enable'
          when '비밀번호 초기화' then 'user:reset_password' when '계정 삭제' then 'user:delete' else 'user:other' end
        else 'token:' || t.kind end,
      left(case when t.kind = 'hub_user' then t.issued_to else coalesce(a.slug, t.issued_to) end, 200), 'ok',
      left(concat_ws(' · ', nullif(t.label, ''), nullif(t.memo, ''), '(토큰 기록에서 옮김)'), 2000)
    from public.token_logs t
    left join public.profiles p on p.id = t.created_by
    left join public.apps a on a.id = t.app_id
    where t.issued_to not like 'hub-users-test-%' and t.issued_to not like 'hub-%test%';
  end if;
end $$;

drop table if exists public.token_logs cascade;  -- 정책 4개·제약·권한·시퀀스도 함께 사라짐
