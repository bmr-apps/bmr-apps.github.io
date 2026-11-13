-- 서버 함수 자동 배포(hub-fn-deploy)를 앱마다 켜고 끄는 스위치. 관리자만 바꾸고(RLS apps_admin_update + 아래 트리거), 바뀔 때마다 audit_log 에 남긴다.
-- 기본값은 꺼짐(새 앱은 관리자가 켜야 자동 배포). 이미 자동 배포를 켠 class-designer 만 켜 둔다.
alter table public.apps add column if not exists fn_auto_deploy boolean not null default false;
comment on column public.apps.fn_auto_deploy is '켜면 앱 저장소 main push 때 <slug>-fn 자동 배포 (push 권한 = 함수 코드로 프로젝트 공용 비밀값을 읽을 수 있음)';
update public.apps set fn_auto_deploy = true where slug = 'class-designer' and not fn_auto_deploy;
insert into public.audit_log (actor, actor_email, action, target, result, detail)
select null, 'system', 'fn:auto_deploy', slug, 'ok', '켬 (스위치 도입 때 이미 자동 배포 중이던 앱)' from public.apps where slug = 'class-designer' and fn_auto_deploy;

create or replace function private.apps_fn_auto_deploy_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  if new.fn_auto_deploy is not distinct from (case when tg_op = 'UPDATE' then old.fn_auto_deploy else false end) then return new; end if;
  -- 로그인한 사람이 바꾸면 관리자여야 한다 (서비스 키·DB 직접 작업은 auth.uid() 가 없음)
  if auth.uid() is not null and not (select private.is_admin()) then
    raise exception '서버 함수 자동 배포는 관리자만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  select coalesce(nullif(p.email, ''), u.email) into who from auth.users u left join public.profiles p on p.id = u.id where u.id = auth.uid();
  insert into public.audit_log (actor, actor_email, action, target, result, detail)
  values (auth.uid(), coalesce(who, 'system'), 'fn:auto_deploy', new.slug, 'ok', case when new.fn_auto_deploy then '켬' else '끔' end);
  return new;
end $$;
revoke all on function private.apps_fn_auto_deploy_guard() from public, anon, authenticated;
drop trigger if exists apps_fn_auto_deploy on public.apps;
create trigger apps_fn_auto_deploy before insert or update of fn_auto_deploy on public.apps
  for each row execute function private.apps_fn_auto_deploy_guard();

-- 개발 정보(담당자·관리자)에 자동 배포 상태를 더한다 (읽기 전용)
CREATE OR REPLACE FUNCTION public.app_dev_info(p_app_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.apps%rowtype;
  me_email text;
  is_owner boolean;
  sch text; v2 boolean;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다' using errcode = '42501'; end if;
  select * into a from public.apps where id = p_app_id;
  if not found then return null; end if;
  select lower(u.email) into me_email from auth.users u where u.id = auth.uid();
  is_owner := (select private.is_staff()) and exists (select 1 from public.app_owners o where o.app_id = a.id and lower(o.email) = me_email and me_email is not null);
  if not ((select private.is_admin()) or is_owner) then return null; end if;   -- 담당자·관리자가 아니면 아무것도 주지 않음

  sch := replace(a.slug, '-', '_');
  v2 := exists (select 1 from pg_namespace n where n.nspname = sch and obj_description(n.oid, 'pg_namespace') = 'bmr-app:' || a.slug || ':v2');
  return jsonb_build_object(
    'app_id', a.id, 'slug', a.slug, 'name', a.name, 'url', a.url, 'repo_url', a.repo_url, 'status', a.status,
    'is_owner', is_owner, 'v2', v2,
    'schema', case when v2 then sch end,
    'dev_role', case when v2 then sch || '_dev' end,
    'bucket', case when v2 and exists (select 1 from storage.buckets b where b.id = a.slug) then a.slug end,
    'fn', case when v2 then a.slug || '-fn' end,
    'secret_prefix', case when v2 then upper(sch) || '_' end,
    'ref', 'psupfmarnyxontorftio',
    'pool_host', 'aws-1-ap-northeast-2.pooler.supabase.com',
    'tables', case when v2 then (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                 where n.nspname = sch and c.relkind in ('r', 'p', 'v') and c.relname <> '_migrations') end,
    'fn_auto_deploy', a.fn_auto_deploy,
    'pending_initial', case when v2 then exists (select 1 from vault.secrets s where s.name = 'bmr_dbcred:' || a.slug) end
  );
end $function$;
