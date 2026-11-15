// 알림(웹 푸시 · 메일) 화면 쪽 도우미.
// 규칙(설정 뜻·배지 숫자·기기 이름)은 서버와 같은 파일을 쓴다: supabase/functions/hub-notify/rules.ts
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ANON, SUPABASE_URL, sb } from './sb';
import {
  DEFAULT_PREFS, LIMITS, badgeText, badgeTotal, normalizePrefs, subProblem,
  type NotifyPrefs,
} from '../supabase/functions/hub-notify/rules';

export { DEFAULT_PREFS, LIMITS, badgeText, badgeTotal, normalizePrefs };
export type { NotifyPrefs };

export type NotifyDevice = { id: number; label: string; service: string; created_at: string; last_seen_at: string };
export type NotifyState = {
  prefs: NotifyPrefs;
  saved: boolean;
  push_ready: boolean;
  devices: NotifyDevice[];
  unread: number;
  limits: { max_devices: number; email_cooldown_min: number };
};

/** hub-notify 함수 부르기 — 로그인이 만료되면 알아보기 쉬운 말로 바꾼다 */
export async function notifyApi<T>(session: Session, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/hub-notify`, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => null) as (T & { error?: string }) | null;
  if (!r.ok) {
    const m = String(j?.error ?? '');
    if (r.status === 404) throw new Error('알림 서버가 아직 배포되지 않았습니다. 관리자에게 알려 주세요.');
    throw new Error(m || `알림 요청에 실패했습니다 (HTTP ${r.status}).`);
  }
  return j as T;
}

export const notifyState = (s: Session) => notifyApi<NotifyState>(s, 'state');
export const savePrefs = async (s: Session, prefs: Partial<NotifyPrefs>): Promise<NotifyPrefs> =>
  (await notifyApi<{ prefs: NotifyPrefs }>(s, 'save_prefs', { prefs })).prefs;
export const sendTestPush = (s: Session) =>
  notifyApi<{ ok: boolean; devices: number; sent: number; failed: number; removed: number; hint: string }>(s, 'test');

/** 방금 보낸 쪽지를 상대에게 알린다 — 실패해도 화면을 막지 않는다 (쪽지는 이미 저장됐다) */
export function notifyChat(session: Session | null, threadId: number) {
  if (!session) return;
  notifyApi(session, 'chat', { thread_id: threadId }).catch(() => { /* 알림 실패는 조용히 넘어간다 */ });
}

/** 관리자가 결정한 신청을 신청자에게 알린다 (관리자만 — 서버가 확인한다) */
export function notifyEvent(session: Session | null, kind: 'app_request' | 'dev_request', id: number) {
  if (!session) return;
  notifyApi(session, 'event', { kind, id }).catch(() => { /* 위 알림이 안 가도 화면은 그대로 */ });
}

// ---------- 브라우저 푸시 ----------
export const pushSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
/** 홈 화면에 추가한 앱처럼 떠 있는가 (아이폰 푸시는 이 상태에서만 된다) */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}
export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  pushSupported() ? Notification.permission : 'unsupported';

/** 서비스 워커 범위 — 허브 화면(/hub/)에만 쓴다. 다른 앱(/class-designer/ 등)의 서비스 워커를 가리지 않는다 */
export const SW_SCOPE = '/hub/';

/** 서비스 워커 — 푸시 알림과 배지를 다룬다 (파일은 /sw.js, 범위는 SW_SCOPE) */
export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try { return await navigator.serviceWorker.register('/sw.js', { scope: SW_SCOPE }); } catch { return null; }
}

async function activeReg(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  return existing ?? registerSW();
}

/** 지금 이 브라우저의 구독 (없으면 null) */
export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch { return null; }
}

const keyBytes = (base64url: string): Uint8Array => {
  const s = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** 구독 정보를 DB 에 넣는다 (RLS: 내 줄만). 이미 있으면 새로 고친다 */
async function saveSubscription(session: Session, sub: PushSubscription): Promise<void> {
  const j = sub.toJSON();
  const endpoint = String(j.endpoint ?? '');
  const p256dh = String(j.keys?.p256dh ?? '');
  const auth = String(j.keys?.auth ?? '');
  const bad = subProblem(endpoint, p256dh, auth);
  if (bad) throw new Error(bad);
  const { error } = await sb.from('push_subscriptions').upsert({
    user_id: session.user.id, endpoint, p256dh, auth,
    user_agent: String(navigator.userAgent ?? '').slice(0, 200),
  }, { onConflict: 'user_id,endpoint' });
  if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? '알림 표가 아직 준비되지 않았습니다(마이그레이션). 관리자에게 알려 주세요.' : '푸시 구독을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
}

/** 알림 켜기: 권한 → 구독 → DB 저장. 사용자가 버튼을 눌렀을 때만 부른다 (브라우저가 요구) */
export async function enablePush(session: Session): Promise<void> {
  if (!pushSupported()) throw new Error('이 브라우저는 웹 푸시를 지원하지 않습니다. 크롬·엣지·사파리(16.4 이상)에서 켜 주세요.');
  if (isIOS() && !isStandalone()) throw new Error('아이폰은 홈 화면에 추가한 뒤에 알림을 켤 수 있습니다. 사파리 공유 → “홈 화면에 추가” 후 그 아이콘으로 열어 주세요.');
  const { public_key } = await notifyApi<{ public_key: string }>(session, 'vapid_key');
  const reg = await activeReg();
  if (!reg) throw new Error('서비스 워커를 준비하지 못했습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('브라우저가 알림을 막았습니다. 주소창 옆 자물쇠(또는 설정)에서 이 사이트의 알림을 허용해 주세요.');
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) as BufferSource });
  await saveSubscription(session, sub);
  await savePrefs(session, { push_enabled: true });
}

/** 알림 끄기: DB 줄 지우기 → 브라우저 구독 해지. 구독 주소는 지우기 전에만 읽는다 */
export async function disablePush(session: Session): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    try { await sub.unsubscribe(); } catch { /* 이미 없어졌을 수 있다 */ }
  }
  await savePrefs(session, { push_enabled: false });
}

/** 로그인·알림 켜짐 상태에서 구독이 살아 있으면 DB 와 다시 맞춘다 (서버 표가 비었을 때 회복) */
export async function syncSubscription(session: Session): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const sub = await currentSubscription();
    if (sub) await saveSubscription(session, sub);
  } catch { /* 조용히: 알림은 부가 기능이다 */ }
}

// ---------- 배지 (탭 제목 · 홈 화면 아이콘) ----------
type BadgeNav = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
export function applyBadge(total: number) {
  const n = Math.max(0, Math.trunc(Number(total) || 0));
  try { document.title = badgeText(n); } catch { /* 서버 렌더 없음 */ }
  const nav = navigator as BadgeNav;
  try {
    if (n > 0) void nav.setAppBadge?.(n);
    else void nav.clearAppBadge?.();
  } catch { /* 배지를 지원하지 않는 브라우저 */ }
}

/** 안 읽은 알림 수 + 쪽지 수 → 탭 제목 · 홈 화면 아이콘 배지 (60초마다, 그리고 새 알림이 오면 바로) */
export function useBadge(session: Session | null, chatMessages: number) {
  const [notifications, setNotifications] = useState(0);
  useEffect(() => {
    if (!session) { setNotifications(0); return; }
    let live = true;
    const load = async () => {
      const { count } = await sb.from('notification_log').select('id', { count: 'exact', head: true }).is('read_at', null);
      if (live) setNotifications(Number(count ?? 0));
    };
    void load();
    const i = setInterval(() => { void load(); }, 60000);
    const f = () => { void load(); };
    addEventListener('bmr-notify-updated', f);
    const ch = sb.channel('bmr-notify-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_log' }, f)
      .subscribe();
    return () => { live = false; clearInterval(i); removeEventListener('bmr-notify-updated', f); sb.removeChannel(ch); };
  }, [session]);
  const total = badgeTotal({ chats: chatMessages, notifications });
  useEffect(() => { applyBadge(total); }, [total]);
  return { notifications, total };
}
