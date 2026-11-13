-- 앱 삭제 (Edge Function hub-deprovision): 먼저 백업(비공개 버킷 hub-backups), 그다음 그 앱 자원만 지운다. 관리자 전용.

-- 1) 삭제 진행 기록 (앱 행이 지워진 뒤에도 이어서 하고, 백업 위치를 남김)
create table if not exists public.app_deletions (
  id bigint generated always as identity primary key,
  app_id bigint not null,
  slug text not null check (slug ~ '^[a-z][a-z0-9-]{1,38}$'),
  app_name text not null default '',
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  steps jsonb not null default '{}'::jsonb,
  error text check (char_length(error) <= 2000),
  backup_prefix text,
  backup_files jsonb not null default '[]'::jsonb,
  note text not null default '' check (char_length(note) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_until timestamptz
);
create index if not exists app_deletions_created_idx on public.app_deletions (created_at desc);
create unique index if not exists app_deletions_one_active on public.app_deletions (slug) where status <> 'done';
alter table public.app_deletions enable row level security;
revoke all on public.app_deletions from anon, authenticated;
grant select on public.app_deletions to authenticated;
drop policy if exists deletions_admin_select on public.app_deletions;
create policy deletions_admin_select on public.app_deletions for select to authenticated using ((select private.is_admin()));

-- 2) 신청 행은 남기고 '앱 삭제됨' 표시. 삭제된 앱의 주소는 다시 신청할 수 있게
alter table public.app_requests add column if not exists app_deleted_at timestamptz;
create or replace function private.request_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if tg_op = 'INSERT' then
    v := private.slug_problem(new.slug);
    if v is not null then raise exception '%', v using errcode = '22023'; end if;
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

-- 3) 백업 버킷 (비공개, 관리자만 읽기 — 쓰기는 서버 함수만)
insert into storage.buckets (id, name, public) values ('hub-backups', 'hub-backups', false) on conflict (id) do update set public = false;
drop policy if exists "hub-backups: 관리자 읽기" on storage.objects;
create policy "hub-backups: 관리자 읽기" on storage.objects for select to authenticated
  using (bucket_id = 'hub-backups' and (select private.is_admin()));
