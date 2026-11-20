-- 허브 사용자 관리: 앱별 사용자 구분 (2026-11-20)
--
-- 왜 필요한가: 로그인 계정(auth.users)은 BMR APPS 전체가 하나를 같이 쓴다. 앱마다 '이 앱 사람'은
-- 자기 스키마의 members 표(carbonic_table.members, workspace.members …)로 따로 둔다.
-- 그런데 사용자 관리 화면은 public.profiles 만 보여 줘서, 앱을 쓰는 학생·교사와 허브 개발·운영 회원이
-- 한 덩어리로 섞여 보였다. 그래서 앱 스키마들의 members 표를 한곳에 모아 두고, 화면이 앱별로 나눠 볼 수 있게 한다.
--
-- 어떻게: private.hub_sync_app_memberships() 가 public.apps 에 등록된 앱의 스키마
-- (slug 의 '-' → '_')에서 user_id 칸이 있는 members 표를 찾아 public.app_memberships 를 다시 채운다.
--  · 앱 표가 진짜 출처고 이 표는 사본이다. 앱에서 빠지면 사본에서도 빠진다.
--  · members 표가 없는 앱, retired 앱, 이미 지워진 계정은 자연히 빠진다.
--  · 브라우저 역할(anon·authenticated)에는 아무 권한도 주지 않는다. 허브 서버 함수(hub-users)만 읽는다.

create table if not exists public.app_memberships (
  user_id uuid not null,
  app_slug text not null check (char_length(app_slug) between 2 and 40),
  app_name text not null default '' check (char_length(app_name) <= 100),
  app_role text not null default 'member' check (app_role in ('member', 'admin')),
  joined_at timestamptz,
  disabled boolean not null default false,
  synced_at timestamptz not null default now(),
  primary key (user_id, app_slug)
);
comment on table public.app_memberships is '앱별 사용자 사본 — private.hub_sync_app_memberships() 가 각 앱 스키마의 members 표에서 다시 채운다. 허브 사용자 관리(hub-users)만 읽는다';
comment on column public.app_memberships.app_role is '그 앱 안에서의 역할: member(사용자) · admin(앱 관리자)';
comment on column public.app_memberships.joined_at is '그 앱에 처음 들어온 시각 (앱 members 표의 created_at/joined_at)';
comment on column public.app_memberships.disabled is '그 앱이 이 사람을 막아 둔 상태 (members.disabled_at 등)';

create index if not exists app_memberships_app_idx on public.app_memberships (app_slug);
create index if not exists app_memberships_synced_idx on public.app_memberships (synced_at);

alter table public.app_memberships enable row level security;
revoke all on public.app_memberships from anon, authenticated;

-- ---------- 앱 스키마를 훑어 다시 채우는 함수 ----------
-- private 스키마에 둔다: security definer 라 PostgREST(RPC)로 노출되지 않고, 허브 서버 함수만 부른다.
create or replace function private.hub_sync_app_memberships()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  a record;
  sch text;
  cols text[];
  types text[];
  i integer;
  role_expr text;
  join_expr text;
  off_expr text;
  q text;
  n integer := 0;
begin
  drop table if exists pg_temp.hub_members_scan;
  create temp table hub_members_scan (
    user_id uuid not null,
    app_slug text not null,
    app_role text not null,
    joined_at timestamptz,
    disabled boolean not null default false
  ) on commit drop;

  for a in
    select ap.slug, ap.name from public.apps ap where ap.status <> 'retired' order by ap.slug
  loop
    sch := replace(a.slug, '-', '_');
    -- 이 앱 스키마에 user_id 칸이 있는 members 표가 있는가 (없으면 회원 표를 두지 않는 앱)
    select array_agg(c.column_name::text order by c.ordinal_position),
           array_agg(c.data_type::text order by c.ordinal_position)
      into cols, types
      from information_schema.columns c
     where c.table_schema = sch and c.table_name = 'members';
    continue when cols is null;
    i := array_position(cols, 'user_id');
    continue when i is null;
    -- user_id 가 uuid 칸이어야 한다 (모양이 다른 표는 건너뜀)
    continue when coalesce(types[i], '') <> 'uuid';

    -- 그 앱 안에서의 역할: is_admin(참/거짓) → role(admin·owner) → 없으면 member
    i := array_position(cols, 'is_admin');
    if i is not null and coalesce(types[i], '') = 'boolean' then
      role_expr := 'case when coalesce(m.is_admin, false) then ''admin'' else ''member'' end';
    else
      i := array_position(cols, 'role');
      if i is not null and coalesce(types[i], '') in ('text', 'character varying', 'character') then
        role_expr := 'case when m.role in (''admin'', ''owner'') then ''admin'' else ''member'' end';
      else
        role_expr := '''member''';
      end if;
    end if;

    -- 들어온 시각 (앱마다 created_at 또는 joined_at)
    i := coalesce(array_position(cols, 'created_at'), array_position(cols, 'joined_at'));
    join_expr := case when i is null then 'null::timestamptz' else format('m.%I::timestamptz', cols[i]) end;

    -- 그 앱이 막아 둔 사람 (disabled_at 시각 칸 또는 disabled 참/거짓 칸)
    i := array_position(cols, 'disabled_at');
    if i is not null then
      off_expr := format('(m.%I is not null)', cols[i]);
    else
      i := coalesce(array_position(cols, 'disabled'), array_position(cols, 'is_disabled'));
      off_expr := case when i is null then 'false' else format('coalesce(m.%I, false)', cols[i]) end;
    end if;

    q := format(
      'insert into pg_temp.hub_members_scan (user_id, app_slug, app_role, joined_at, disabled)
         select distinct on (m.user_id) m.user_id, %L, %s, %s, %s
           from %I.members m
           join auth.users u on u.id = m.user_id
          order by m.user_id',
      a.slug, role_expr, join_expr, off_expr, sch);
    begin
      execute q;
    exception when others then
      -- 앱 표 모양이 예상과 달라도 그 앱만 건너뛴다 (사용자 목록 전체는 계속 나와야 한다)
      raise warning 'hub_sync_app_memberships: 앱 % 건너뜀 — %', a.slug, sqlerrm;
    end;
  end loop;

  -- 더 이상 그 앱 회원이 아니거나 표가 없어진 앱의 사본은 지운다
  delete from public.app_memberships t
   where not exists (select 1 from pg_temp.hub_members_scan s
                      where s.user_id = t.user_id and s.app_slug = t.app_slug);

  insert into public.app_memberships as t (user_id, app_slug, app_name, app_role, joined_at, disabled, synced_at)
  select s.user_id, s.app_slug, coalesce(ap.name, s.app_slug), s.app_role, s.joined_at, s.disabled, now()
    from pg_temp.hub_members_scan s
    left join public.apps ap on ap.slug = s.app_slug
  on conflict (user_id, app_slug) do update
     set app_name = excluded.app_name,
         app_role = excluded.app_role,
         joined_at = coalesce(t.joined_at, excluded.joined_at),
         disabled = excluded.disabled,
         synced_at = excluded.synced_at;
  get diagnostics n = row_count;
  return n;
end
$fn$;

comment on function private.hub_sync_app_memberships() is 'public.apps 에 등록된 앱 스키마의 members 표를 훑어 public.app_memberships 를 다시 채운다. hub-users 가 목록을 만들 때 부른다';
revoke execute on function private.hub_sync_app_memberships() from public, anon, authenticated;
grant execute on function private.hub_sync_app_memberships() to service_role;

-- 마이그레이션 시점에 한 번 채워 둔다 (서버 함수를 새로 올리기 전에도 표에는 값이 있게)
select private.hub_sync_app_memberships();
