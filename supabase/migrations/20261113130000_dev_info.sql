-- 내 서비스 '개발 정보': 그 앱 담당자(허브 메일 = 담당자 메일, 개발자 이상)와 관리자만 받는다.
-- 비밀값은 돌려주지 않는다(이름·주소·상태만). DB 비밀번호는 기존 hub-dbcred 로 한 번만 받는다.
create or replace function public.app_dev_info(p_app_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
    'pending_initial', case when v2 then exists (select 1 from vault.secrets s where s.name = 'bmr_dbcred:' || a.slug) end
  );
end $$;
revoke all on function public.app_dev_info(bigint) from public, anon;
grant execute on function public.app_dev_info(bigint) to authenticated;
comment on function public.app_dev_info(bigint) is '내 서비스 개발 정보 (담당자·관리자만, 비밀값 없음)';
