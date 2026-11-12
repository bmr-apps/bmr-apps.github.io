-- 허브 사용자 관리 (Edge Function hub-users)
-- 1) 감사 기록 종류 추가 (값은 절대 저장하지 않음)
alter table public.token_logs drop constraint if exists token_logs_kind_check;
alter table public.token_logs add constraint token_logs_kind_check check (kind in
  ('github_pat', 'github_deploy_key', 'supabase_anon', 'supabase_service_role', 'supabase_access_token', 'gemini_api_key', 'supabase_db_password', 'hub_user', 'other'));

-- 2) 계정 삭제 시 신청 기록은 남긴다 (담당자 표 app_owners 는 사용자 id 가 아니라 메일만 있어 그대로 둠)
alter table public.app_requests alter column requested_by drop not null;
alter table public.app_requests drop constraint if exists app_requests_requested_by_fkey;
alter table public.app_requests add constraint app_requests_requested_by_fkey
  foreign key (requested_by) references auth.users (id) on delete set null;

-- 3) 역할 변경은 서버 함수만 (사용 중지 때 로그인 차단·기록까지 함께). 본인 이름 수정은 그대로.
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;
drop policy if exists profiles_admin_update on public.profiles;

-- 4) 요청 횟수 기록 (함수만 씀)
create table if not exists bmr_admin.users_attempts (
  id bigint generated always as identity primary key,
  user_id uuid,
  ip text not null,
  action text not null,
  at timestamptz not null default now()
);
create index if not exists users_attempts_at_idx on bmr_admin.users_attempts (at);
revoke all on bmr_admin.users_attempts from public, anon, authenticated;
