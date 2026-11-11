// Supabase 클라이언트. 브라우저에는 공개(anon/publishable) 키만 둔다.
import { createClient, type Session } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const configured = !!(SUPABASE_URL && ANON);
export const sb = createClient(SUPABASE_URL || 'http://invalid.local', ANON || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'bmr-apps-hub-auth' },
});

export type App = { id: number; slug: string; name: string; description: string; url: string; repo_url: string | null; supabase_ref: string | null; status: Status; note: string; sort: number; created_at: string; updated_at: string };
export type Status = 'preparing' | 'active' | 'paused' | 'retired';
export type Owner = { id: number; app_id: number; name: string; email: string | null; github_username: string | null; role: string };
export type Request = { id: number; requested_by: string; requester_name: string; requester_email: string | null; app_name: string; slug: string; purpose: string; data_handled: string; has_student_pii: boolean; github_username: string; status: 'pending' | 'approved' | 'rejected'; review_note: string; reviewed_at: string | null; app_id: number | null; created_at: string };
export type TokenLog = { id: number; app_id: number | null; kind: string; label: string; issued_to: string; issued_at: string; expires_at: string | null; revoked_at: string | null; memo: string; created_at: string };
export type Health = { app_id: number; checked_at: string; url: string; http_status: number | null; ok: boolean; response_ms: number | null; error: string | null };
export type Role = 'pending' | 'staff' | 'admin' | 'disabled';
export type Profile = { id: string; email: string; name: string; role: Role; created_at: string };
export const ROLE_LABEL: Record<Role, string> = { pending: '승인 대기', staff: '직원', admin: '관리자', disabled: '사용 중지' };

export const STATUS_LABEL: Record<Status, string> = { preparing: '준비 중', active: '운영 중', paused: '일시 중지', retired: '종료' };
export const KIND_LABEL: Record<string, string> = {
  github_pat: 'GitHub 토큰(fine-grained)', github_deploy_key: 'GitHub 배포 키', supabase_anon: 'Supabase 공개(anon) 키',
  supabase_service_role: 'Supabase service_role 키', supabase_access_token: 'Supabase 개인 액세스 토큰', gemini_api_key: 'Gemini API 키', other: '기타',
};

export async function login(email: string, password: string) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/confirm/i.test(error.message) ? '이메일 확인이 아직 안 됐습니다. 받은편지함의 확인 메일을 눌러 주세요.' : '이메일 또는 비밀번호가 올바르지 않습니다.');
}
export async function signUp(email: string, password: string, name: string) {
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { data: { name }, emailRedirectTo: location.origin + '/hub/login' } });
  if (error) throw new Error(/already/i.test(error.message) ? '이미 가입된 이메일입니다.' : /password/i.test(error.message) ? '비밀번호는 8자 이상으로 해 주세요.' : '가입하지 못했습니다. 잠시 뒤 다시 시도하세요.');
  return { needsConfirm: !data.session };
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
