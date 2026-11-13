// Supabase 클라이언트. 브라우저에는 공개(anon/publishable) 키만 둔다.
import { createClient, type Session } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
export const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const configured = !!(SUPABASE_URL && ANON);
export const sb = createClient(SUPABASE_URL || 'http://invalid.local', ANON || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'bmr-apps-hub-auth' },
});

export type App = { id: number; slug: string; name: string; description: string; url: string; repo_url: string | null; supabase_ref: string | null; status: Status; note: string; sort: number; created_at: string; updated_at: string };
export type Status = 'preparing' | 'active' | 'paused' | 'retired';
export type GhStatus = 'invited' | 'active' | 'failed' | 'no_repo';
export type Owner = { id: number; app_id: number; name: string; email: string | null; github_username: string | null; role: string; gh_status: GhStatus | null; gh_status_at: string | null; gh_error: string | null };
export type Request = { id: number; requested_by: string; requester_name: string; requester_email: string | null; app_name: string; slug: string; purpose: string; data_handled: string; has_student_pii: boolean; github_username: string; status: 'pending' | 'approved' | 'rejected'; review_note: string; reviewed_at: string | null; app_id: number | null; created_at: string;
  provision_status: 'running' | 'done' | 'failed' | null; provision_steps: Record<string, string | number>; provision_error: string | null;
  provision_started_at: string | null; provision_finished_at: string | null; provision_attempts: number; provision_lease_until: string | null };
export type AuditLog = { id: number; at: string; actor: string | null; actor_email: string; action: string; target: string; result: 'ok' | 'error' | 'denied'; detail: string };
export type TokenLog = { id: number; app_id: number | null; kind: string; label: string; issued_to: string; issued_at: string; expires_at: string | null; revoked_at: string | null; memo: string; created_at: string };
export type Health = { app_id: number; checked_at: string; url: string; http_status: number | null; ok: boolean; response_ms: number | null; error: string | null };
export type Role = 'pending' | 'staff' | 'admin' | 'disabled';
export type Profile = { id: string; email: string; name: string; role: Role; created_at: string };
export const ROLE_LABEL: Record<Role, string> = { pending: '일반 사용자', staff: '개발자', admin: '관리자', disabled: '사용 중지' };

export const STATUS_LABEL: Record<Status, string> = { preparing: '준비 중', active: '운영 중', paused: '일시 중지', retired: '종료' };
export const KIND_LABEL: Record<string, string> = {
  github_pat: 'GitHub 토큰(fine-grained)', github_deploy_key: 'GitHub 배포 키', supabase_anon: 'Supabase 공개(anon) 키',
  supabase_service_role: 'Supabase service_role 키', supabase_db_password: '앱 DB 비밀번호 (허브 1회 표시)', supabase_access_token: 'Supabase 개인 액세스 토큰', gemini_api_key: 'Gemini API 키', other: '기타',
};

export async function login(email: string, password: string) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/banned|disabled/i.test(error.message) ? '사용이 중지된 계정입니다. 관리자에게 문의하세요.' : '이메일 또는 비밀번호가 올바르지 않습니다.');
}
export async function signUp(email: string, password: string, name: string) {
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim(), full_name: name.trim() } } });
  if (error) throw new Error(/already/i.test(error.message) ? '이미 가입된 이메일입니다.' : /password/i.test(error.message) ? '비밀번호는 8자 이상으로 해 주세요.' : '가입하지 못했습니다. 잠시 뒤 다시 시도하세요.');
  if (!data.session) throw new Error('가입은 됐지만 바로 로그인되지 않았습니다. 로그인 화면에서 다시 시도하세요.');
}

export async function runHealth(session: Session) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/hub-health`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + session.access_token }, body: '{}',
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `점검에 실패했습니다 (HTTP ${r.status}).`);
  return j as { checked_at: string; results: { slug: string; name: string; ok: boolean; http_status: number | null; response_ms: number }[] };
}

export const errMsg = (e: unknown): string => {
  const m = (e as { message?: string })?.message || String(e);
  if (/duplicate key|unique/i.test(m)) return '이미 같은 값(주소 등)이 있습니다.';
  if (/token_logs_no_secret/.test(m)) return '토큰 값처럼 보이는 글자가 있습니다. 값은 절대 적지 말고 이름과 기간만 기록하세요.';
  if (/check constraint/i.test(m)) return '입력 형식을 확인해 주세요. (주소는 영문 소문자·숫자·하이픈 2~39자)';
  if (/row-level security|permission denied/i.test(m)) return '권한이 없습니다.';
  return m;
};
export const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '');
export const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }) : '');
/** 오늘(서울)부터 남은 날짜 수 */
export function daysLeft(d: string | null): number | null {
  if (!d) return null;
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));
  return Math.round((new Date(d).getTime() - today.getTime()) / 86400000);
}

// ---------- 앱 DB 접속 정보 (Edge Function hub-dbcred) ----------
export type DbConn = { host: string; port: number; port_transaction: number; database: string; user: string; user_direct: string; schema: string; password?: string; direct_host: string; database_url: string };
export type DbApp = { app_id: number; slug: string; name: string; schema: string; role: string; pending_initial: boolean; recent: { label: string; issued_to: string; created_at: string }[];
  owners: { id: number; name: string; email: string | null; has_account: boolean; staff?: boolean; verified?: boolean }[]; conn: DbConn };
export async function dbcred<T = unknown>(session: Session, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/hub-dbcred`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `요청에 실패했습니다 (HTTP ${r.status}).`);
  return j as T;
}

// ---------- 사용자 관리 (Edge Function hub-users, 관리자 전용) ----------
export type HubUser = {
  id: string; email: string; name: string; role: Role; created_at: string;
  last_sign_in_at: string | null; banned: boolean;
  owned_apps: { id: number; slug: string; name: string }[];
};
export async function usersApi<T = unknown>(session: Session, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/hub-users`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `요청에 실패했습니다 (HTTP ${r.status}).`);
  return j as T;
}

// ---------- 승인 즉시 만들기 · 담당자 GitHub 권한 (Edge Function hub-provision, 관리자 전용) ----------
export const STEP_LABEL: [string, string][] = [
  ['check', '겹치는 자원 확인'], ['db', 'DB 스키마·계정'], ['fn_secret', '함수 DB 연결 정보'], ['starter', '시작 표 documents'], ['expose', 'Data API 노출'],
  ['bucket', '파일 버킷'], ['function', '서버 함수 배포'], ['repo', 'GitHub 저장소'], ['pages', 'GitHub Pages'], ['vars', '배포 변수'],
  ['code', '안내 페이지 올리기'], ['hub', '허브 등록·담당자'], ['invite', 'GitHub 초대'], ['dbcred', 'DB 비밀번호 준비'], ['health', '서버 함수 연결 확인'],
];
export const GH_LABEL: Record<GhStatus, string> = { invited: '초대됨', active: '권한 있음', failed: '실패', no_repo: '저장소 없음' };
export async function provisionApi<T = Record<string, unknown>>(session: Session, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/hub-provision`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `요청에 실패했습니다 (HTTP ${r.status}).`);
  return j as T;
}

// ---------- 앱 삭제 (Edge Function hub-deprovision, 관리자 전용 — 먼저 백업) ----------
export type AppDeletion = {
  id: number; app_id: number; slug: string; app_name: string; status: 'running' | 'done' | 'failed'; steps: Record<string, unknown>; error: string | null;
  backup_prefix: string | null; backup_files: { path: string; size: number }[]; note: string; created_by_email: string; created_at: string; finished_at: string | null; lease_until: string | null;
};
export type DelInfo = {
  slug: string; schema: string; schemaExists: boolean; schemaOurs: boolean; devOurs: boolean; fnRoleOurs: boolean; rolesForeign: string[];
  repo: 'ours' | 'foreign' | 'none'; hubTag: boolean; appOurs: boolean; fn: boolean; secrets: string[]; bucket: boolean;
  bucketFiles: number; bucketBytes: number; policies: number; vault: boolean; exposed: boolean; tables: number; dbBytes: number;
};
export const DEL_STEP_LABEL: [string, string][] = [
  ['check', '확인'], ['backup_hub', '백업: 허브 기록'], ['backup_db', '백업: DB 구조·데이터'], ['backup_bucket', '백업: 버킷 파일'], ['backup_fn', '백업: 서버 함수'],
  ['backup_repo', '백업: 저장소 zip'], ['backup_manifest', '백업 확인'], ['del_repo', '저장소·Pages 삭제'], ['del_fn', '서버 함수 삭제'], ['del_secrets', '함수 비밀값 삭제'],
  ['del_bucket', '버킷 삭제'], ['del_db', '스키마·DB 계정·Vault 삭제'], ['del_expose', 'Data API 목록 정리'], ['del_hub', '허브 행 삭제'],
];
export async function deprovisionApi<T = Record<string, unknown>>(session: Session, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/hub-deprovision`, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `요청에 실패했습니다 (HTTP ${r.status}).`);
  return j as T;
}
export async function backupLink(path: string): Promise<string> {
  const { data, error } = await sb.storage.from('hub-backups').createSignedUrl(path, 600, { download: true });
  if (error || !data) throw new Error('내려받기 링크를 만들지 못했습니다.');
  return data.signedUrl;
}
export const fmtBytes = (n: number) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`);
