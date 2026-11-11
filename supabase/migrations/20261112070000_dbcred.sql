-- 앱 DB 접속 정보 전달 (Edge Function hub-dbcred)
-- 1) 토큰 기록에 'DB 비밀번호' 종류 추가 (값은 절대 저장하지 않음 — 누가·어느 앱·무엇·언제만)
alter table public.token_logs drop constraint if exists token_logs_kind_check;
alter table public.token_logs add constraint token_logs_kind_check check (kind in
  ('github_pat', 'github_deploy_key', 'supabase_anon', 'supabase_service_role', 'supabase_access_token', 'gemini_api_key', 'supabase_db_password', 'other'));

-- 2) 요청 횟수 기록 (함수만 씀: API 역할에는 권한 없음)
create schema if not exists bmr_admin;
revoke all on schema bmr_admin from anon, authenticated;
create table if not exists bmr_admin.dbcred_attempts (
  id bigint generated always as identity primary key,
  user_id uuid,
  ip text not null,
  action text not null,
  at timestamptz not null default now()
);
create index if not exists dbcred_attempts_at_idx on bmr_admin.dbcred_attempts (at);
revoke all on bmr_admin.dbcred_attempts from public, anon, authenticated;
-- 처음 비밀번호는 vault.secrets (이름 'bmr_dbcred:<slug>', 암호화) 에만 두고, 담당자가 받으면 함수가 지운다.
