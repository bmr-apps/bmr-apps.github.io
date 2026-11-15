// 알림 규칙 — 순수 함수만 둔다 (Deno 전역·npm 없음).
// 서버(hub-notify)와 화면(src/notify.ts)이 같은 규칙을 쓰도록 한 곳에만 적는다:
//   · 어떤 알림을 보낼지(설정 스위치)   · 미리보기 길이   · 배지 숫자·제목
//   · 메일 쿨다운   · 기기 이름
// 시험: node scripts/test-selfservice-rules.mjs

export type NotifySwitch = 'chat' | 'admin';
export type NotifyKind = 'chat' | 'app_request' | 'dev_request' | 'member' | 'health';
export type NotifyPrefs = {
  push_enabled: boolean;
  email_enabled: boolean;
  notify_chat: boolean;
  notify_admin: boolean;
};

/** 설정 줄이 없을 때의 기본값 — 푸시 켬 · 메일 끔(원할 때만) · 쪽지 켬 · 관리 알림 켬 */
export const DEFAULT_PREFS: NotifyPrefs = { push_enabled: true, email_enabled: false, notify_chat: true, notify_admin: true };
export const PREF_KEYS = ['push_enabled', 'email_enabled', 'notify_chat', 'notify_admin'] as const;
export type PrefKey = (typeof PREF_KEYS)[number];

/** 서버·화면이 함께 쓰는 한도 (서버가 실제로 막고, 화면은 안내 문구에만 쓴다) */
export const LIMITS = {
  /** 한 사람이 한 시간에 부탁할 수 있는 쪽지 알림 수 */
  pushPerUserHour: 120,
  /** '시험 발송' 한 시간 횟수 */
  testPerHour: 5,
  /** 관리자 이벤트 알림 한 시간 횟수 */
  eventPerHour: 30,
  /** 같은 대화의 메일은 이 간격 안에서 한 통만 */
  emailCooldownMin: 10,
  /** 한 사람에게 가는 알림 메일 한 시간 한도 */
  emailPerRecipientHour: 6,
  /** 학교 전체 알림 메일 하루 한도 */
  emailPerDay: 200,
  /** 한 사람당 기기(구독) 수 — DB 트리거가 오래된 것부터 지운다 */
  maxDevices: 10,
  /** 알림에 실리는 쪽지 미리보기 길이 */
  previewLen: 80,
  /** 메일 본문 최대 길이 */
  maxMailBody: 4000,
} as const;

/** 설정 값 정리: 모르는 칸은 버리고, 참·거짓이 아닌 값은 기본값을 쓴다 */
export function normalizePrefs(raw: unknown): NotifyPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: NotifyPrefs = { ...DEFAULT_PREFS };
  for (const k of PREF_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
}

/** 화면이 보낸 설정에 잘못된 것이 있으면 이유 (없으면 null) — 서버가 저장 전에 확인한다 */
export function prefsProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '바꿀 설정을 보내 주세요.';
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (!keys.length) return '바꿀 설정이 없습니다.';
  const unknown = keys.filter((k) => !(PREF_KEYS as readonly string[]).includes(k));
  if (unknown.length) return `알 수 없는 설정입니다: ${unknown.slice(0, 5).join(', ')}`;
  for (const k of PREF_KEYS) if (k in o && typeof o[k] !== 'boolean') return `${k} 는 켬/끔(true/false)으로 보내 주세요.`;
  return null;
}

/** 이 사람에게 푸시를 보내도 되나 */
export function canPush(p: NotifyPrefs, kind: NotifySwitch): boolean {
  const on = kind === 'chat' ? p.notify_chat : p.notify_admin;
  return on && p.push_enabled;
}

/** 이 사람에게 메일을 보내도 되나 (메일은 푸시가 닿지 않았을 때만 쓰는 보조 수단) */
export function canEmail(p: NotifyPrefs, kind: NotifySwitch): boolean {
  const on = kind === 'chat' ? p.notify_chat : p.notify_admin;
  return on && p.email_enabled;
}

/** 미리보기: 줄바꿈·여러 칸 띄우기를 한 칸으로 줄이고 길면 자른다 (알림에 긴 본문을 싣지 않는다) */
export function previewText(body: string, max: number = LIMITS.previewLen): string {
  const s = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : s;
}

/** 쪽지 푸시 알림 내용 (제목은 보낸 사람 이름, 본문은 짧은 미리보기) */
export function chatPayload(o: { sender: string; body: string; thread: number }): { title: string; body: string; url: string; tag: string } {
  const sender = previewText(o.sender, 40) || '회원';
  const thread = Math.abs(Math.trunc(Number(o.thread) || 0));
  return {
    title: `💬 ${sender}`,
    body: previewText(o.body) || '새 쪽지가 도착했어요.',
    url: '/hub/chat',
    tag: `chat-${thread}`,
  };
}

/** 신청 결과 푸시 알림 내용 */
export function eventPayload(o: { kind: 'app_request' | 'dev_request'; title: string; body: string }): { title: string; body: string; url: string; tag: string } {
  return {
    title: previewText(o.title, 60) || 'BMR APPS 알림',
    body: previewText(o.body, 120),
    url: '/hub/requests',
    tag: `ev-${o.kind}`,
  };
}

/** 운영 점검 알림 내용 (앱이 응답하지 않을 때 · 다시 정상이 되었을 때) */
export function healthPayload(o: { name: string; slug: string; ok: boolean }): { title: string; body: string; url: string; tag: string } {
  const name = previewText(o.name, 40) || '앱';
  const slug = String(o.slug ?? '').replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return {
    title: o.ok ? `📡 ${name} 회복` : `📡 ${name} 점검 실패`,
    body: o.ok ? `${name} 이(가) 다시 정상으로 응답합니다.` : `${name} 이(가) 응답하지 않습니다. 운영 상태를 확인해 주세요.`,
    url: '/hub/status',
    tag: `health-${slug || 'app'}`,
  };
}

/** 알림 메일 제목 */
export function mailSubject(o: { sender: string; count?: number }): string {
  const sender = previewText(o.sender, 40) || '회원';
  const n = Math.trunc(Number(o.count) || 0);
  return n > 1 ? `[BMR APPS] ${sender} 님의 새 쪽지 ${n}개` : `[BMR APPS] ${sender} 님의 새 쪽지`;
}

/** 알림 메일 본문 — 링크와 끄는 방법을 늘 함께 적는다 (본문에 개인정보를 넣지 않는다) */
export function mailBody(o: { sender: string; preview: string; thread?: number; hubUrl?: string }): string {
  const hub = (o.hubUrl || 'https://apps.bmrschool.net').replace(/\/+$/, '');
  const sender = previewText(o.sender, 40) || '회원';
  const preview = previewText(o.preview, 300);
  return [
    `${sender} 님이 BMR APPS 에서 쪽지를 보냈습니다.`,
    '',
    preview ? `“${preview}”` : '(내용 미리보기 없음)',
    '',
    `쪽지 보기: ${hub}/hub/chat`,
    '',
    '이 메일은 쪽지 알림을 켜 두어서 보냈습니다.',
    `알림 끄기: ${hub}/hub/account (🔔 알림 설정)`,
  ].join('\n');
}

/** 메일 쿨다운: 마지막으로 보낸 때가 간격 안이면 보내지 않는다 */
export function emailAllowed(lastAt: string | Date | null | undefined, now: Date, cooldownMin: number = LIMITS.emailCooldownMin): boolean {
  if (!lastAt) return true;
  const t = lastAt instanceof Date ? lastAt.getTime() : Date.parse(String(lastAt));
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t >= cooldownMin * 60_000;
}

/** 배지 숫자 = 안 읽은 쪽지 + 안 읽은 알림 (0~999, 음수·소수는 버린다) */
export function badgeTotal(n: { chats?: number; notifications?: number }): number {
  const count = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));
  const sum = count(n?.chats) + count(n?.notifications);
  return Math.min(sum, 999);
}

/** 탭 제목 — 안 읽은 것이 있으면 앞에 (N) 을 붙인다 */
export function badgeText(total: number, base: string = 'BMR APPS'): string {
  const n = Math.max(0, Math.trunc(Number(total) || 0));
  if (!n) return base;
  return `(${n > 99 ? '99+' : n}) ${base}`;
}

/** 구독 주소의 호스트만 (화면에 주소 전체를 보여 주지 않는다 — 주소 자체가 열쇠다) */
export function endpointHost(endpoint: string): string {
  try {
    const h = new URL(String(endpoint)).hostname;
    if (/apple/i.test(h)) return 'Apple 푸시';
    if (/google|fcm|android/i.test(h)) return 'Google 푸시';
    if (/mozilla|microsoft|windows/i.test(h)) return /microsoft|windows/i.test(h) ? 'Microsoft 푸시' : 'Mozilla 푸시';
    return h;
  } catch {
    return '브라우저';
  }
}

/** 기기 이름 — 구독할 때 브라우저가 알려 준 user_agent 로 짐작한다 */
export function deviceLabel(ua: string): string {
  const s = String(ua ?? '');
  if (/iPhone|iPod/.test(s)) return /CriOS|FxiOS|EdgiOS/.test(s) ? '아이폰 (다른 브라우저)' : '아이폰 사파리';
  if (/iPad/.test(s)) return '아이패드';
  if (/Android/.test(s)) return '안드로이드';
  if (/Macintosh|Mac OS X/.test(s)) return '맥';
  if (/Windows/.test(s)) return '윈도우 PC';
  if (/Linux/.test(s)) return '리눅스 PC';
  return '브라우저';
}

/** 구독 값이 쓸 만한지 (화면이 넣기 전에 확인 — 서버·DB 도 같은 범위로 막는다) */
export function subProblem(endpoint: unknown, p256dh: unknown, auth: unknown): string | null {
  if (typeof endpoint !== 'string' || !/^https:\/\/.{10,1000}$/.test(endpoint)) return '푸시 주소가 올바르지 않습니다. 알림을 다시 켜 주세요.';
  if (typeof p256dh !== 'string' || p256dh.length < 16 || p256dh.length > 200) return '푸시 열쇠(p256dh)가 올바르지 않습니다.';
  if (typeof auth !== 'string' || auth.length < 8 || auth.length > 100) return '푸시 열쇠(auth)가 올바르지 않습니다.';
  return null;
}
