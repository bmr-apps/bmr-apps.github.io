-- 학교 그룹·명부(hub-directory) + 그룹 공용 파일 버킷(bmr-files)
-- 왜: 메일(hub-mail)·AI(hub-ai)는 공용으로 묶었는데 '누가 교직원·고등부·10학년·정보동아리인가'는 앱마다 따로
--     명부를 만들고 있었다. 허브가 한 곳에서 관리하고, 앱은 hub-directory 로 읽기만 한다.
--
-- 1) 그룹: bmr_admin.groups · bmr_admin.group_members (관리자만 쓰기, 앱·화면은 읽기)
--    groups.slug 는 그룹 공용 파일 폴더 이름으로도 쓴다 (예: staff/2026-11-안내.pdf).
--    그래서 이름(name, 한글 가능)과 폴더 이름(slug, 영문 소문자)을 따로 둔다.
-- 2) 그룹 공용 파일: 비공개 버킷 bmr-files 의 '<그룹 slug>/<파일>' — storage 정책이 '그 그룹 구성원인가'를 확인한다.
--    (앱마다 파일 권한을 다시 짜지 않게. 로그인한 사람은 자기 그룹 폴더만 보고 올릴 수 있다)
-- 3) 읽기 도우미: private.group_member(slug) · private.group_leader(slug) — RLS·storage 정책에서 쓴다.
-- 4) 호출 횟수 기록: bmr_admin.directory_attempts (hub-directory 가 남기는 앱·사람·IP 별 횟수)

-- ---------- 1. 그룹 ----------
create table if not exists bmr_admin.groups (
  id bigint generated always as identity primary key,
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$' and slug not in ('hub', 'login', 'assets', 'admin', 'api', 'www', 'static', 'files')),
  name text not null unique
    check (char_length(name) between 1 and 60 and name !~ '[[:cntrl:]]'),
  kind text not null default 'custom' check (kind in ('grade', 'class', 'club', 'staff', 'custom')),
  description text not null default '' check (char_length(description) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on bmr_admin.groups from public, anon, authenticated;

comment on table bmr_admin.groups is '학교 그룹(교직원·고등부·10학년·동아리 등). 관리자만 만들고 고친다. 앱은 hub-directory 로 읽는다.';
comment on column bmr_admin.groups.slug is '그룹 공용 파일 폴더 이름(bmr-files/<slug>/…)으로도 쓴다.';
comment on column bmr_admin.groups.kind is 'grade 학년 · class 반 · club 동아리 · staff 교직원 · custom 기타';

-- ---------- 2. 그룹 구성원 (이메일 기준 — 허브·앱 계정이 같은 메일을 쓴다) ----------
create table if not exists bmr_admin.group_members (
  group_id bigint not null references bmr_admin.groups (id) on delete cascade,
  user_email text not null
    check (user_email = lower(user_email) and user_email ~ '^[^@[:space:]]{1,64}@[^@[:space:]]{1,190}$'),
  role text not null default 'member' check (role in ('leader', 'member')),
  added_at timestamptz not null default now(),
  primary key (group_id, user_email)
);
create index if not exists group_members_email_idx on bmr_admin.group_members (user_email);
revoke all on bmr_admin.group_members from public, anon, authenticated;

comment on table bmr_admin.group_members is '그룹 구성원. leader 는 그 그룹 공용 파일을 관리(다른 사람 파일도 지우기)할 수 있다.';

-- ---------- 3. 호출 횟수 기록 (남용 방지) ----------
create table if not exists bmr_admin.directory_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('app', 'user', 'ip', 'anon')),
  who text not null default '' check (char_length(who) <= 200),
  action text not null default '' check (char_length(action) <= 30)
);
create index if not exists directory_attempts_at_idx on bmr_admin.directory_attempts (at desc);
revoke all on bmr_admin.directory_attempts from public, anon, authenticated;

-- ---------- 4. 정책에서 쓰는 읽기 도우미 (security definer: bmr_admin 을 훑어 참/거짓만 돌려준다) ----------
create or replace function private.group_member(p_slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from bmr_admin.group_members m
    join bmr_admin.groups g on g.id = m.group_id
    where g.slug = p_slug
      and m.user_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
revoke all on function private.group_member(text) from public, anon;
grant execute on function private.group_member(text) to authenticated;

create or replace function private.group_leader(p_slug text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from bmr_admin.group_members m
    join bmr_admin.groups g on g.id = m.group_id
    where g.slug = p_slug
      and m.role = 'leader'
      and m.user_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
revoke all on function private.group_leader(text) from public, anon;
grant execute on function private.group_leader(text) to authenticated;

-- ---------- 5. 그룹 공용 파일: 비공개 버킷 bmr-files ----------
-- 이름 규칙: '<그룹 slug>/<파일>' (한 겹 더 넣어도 됨: 'staff/2026/11/안내.pdf'). 최대 10MB, 모든 종류.
insert into storage.buckets (id, name, public, file_size_limit)
values ('bmr-files', 'bmr-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "bmr-files: 그룹 구성원 읽기" on storage.objects;
create policy "bmr-files: 그룹 구성원 읽기" on storage.objects for select to authenticated
  using (bucket_id = 'bmr-files' and (select private.group_member((storage.foldername(name))[1])));

drop policy if exists "bmr-files: 그룹 구성원 올리기" on storage.objects;
create policy "bmr-files: 그룹 구성원 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'bmr-files' and (select private.group_member((storage.foldername(name))[1])));

drop policy if exists "bmr-files: 올린 사람·그룹장 바꾸기" on storage.objects;
create policy "bmr-files: 올린 사람·그룹장 바꾸기" on storage.objects for update to authenticated
  using (
    bucket_id = 'bmr-files'
    and (select private.group_member((storage.foldername(name))[1]))
    and (owner_id = (select auth.uid())::text or (select private.group_leader((storage.foldername(name))[1])))
  )
  with check (
    bucket_id = 'bmr-files'
    and (select private.group_member((storage.foldername(name))[1]))
    and (owner_id = (select auth.uid())::text or (select private.group_leader((storage.foldername(name))[1])))
  );

drop policy if exists "bmr-files: 올린 사람·그룹장 지우기" on storage.objects;
create policy "bmr-files: 올린 사람·그룹장 지우기" on storage.objects for delete to authenticated
  using (
    bucket_id = 'bmr-files'
    and (select private.group_member((storage.foldername(name))[1]))
    and (owner_id = (select auth.uid())::text or (select private.group_leader((storage.foldername(name))[1])))
  );

comment on table bmr_admin.directory_attempts is 'hub-directory 호출 횟수 (앱·사람·IP 별). 한 시간 한도를 넘으면 거절한다.';
