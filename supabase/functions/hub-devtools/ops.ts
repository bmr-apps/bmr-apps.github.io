// 운영 현황(ops_overview) 계산 도우미 — 순수 함수. hub-devtools 가 쓰고 scripts/test-selfservice-rules.mjs 가 시험한다.
// 여기서는 DB·네트워크를 만지지 않는다: 집계 모양과 /health 읽기만 정한다.

/** 24시간 집계 창 (화면 문구와 같아야 한다) */
export const OPS_WINDOW_HOURS = 24;
/** 앱 /health 를 기다리는 시간 — 넘으면 '응답 없음(DOWN)' */
export const OPS_PROBE_TIMEOUT_MS = 2500;
/** 한 번에 확인할 앱 수 (함수 실행 시간 안에서 끝나게) */
export const OPS_PROBE_MAX_APPS = 40;
/** 최근 오류 피드 줄 수 */
export const OPS_ERROR_ROWS = 20;
/** 같은 결과를 다시 쓰는 시간 (연속 새로고침으로 앱 /health 를 두들기지 않게) */
export const OPS_CACHE_MS = 10_000;

export type MailAgg = { sent: number; error: number; denied: number };
export type AiAgg = { ok: number; error: number; denied: number; tokens: number };
/** /health 응답에서 읽어 보여 주는 값 */
export type AppHealth = { state: 'ok' | 'warn' | 'down'; http: number | null; ms: number; db: boolean; mail_ready: boolean; ai_hub: boolean };

export const emptyMail = (): MailAgg => ({ sent: 0, error: 0, denied: 0 });
export const emptyAi = (): AiAgg => ({ ok: 0, error: 0, denied: 0, tokens: 0 });

/** 메일 기록 한 줄(상태, 건수)을 집계에 더한다. 모르는 상태(sent/error/denied 밖)는 버린다 */
export function addMailRow(a: MailAgg, status: unknown, n: unknown): void {
  const c = Math.max(0, Math.trunc(Number(n) || 0));
  if (status === 'sent') a.sent += c;
  else if (status === 'error') a.error += c;
  else if (status === 'denied') a.denied += c;
}

/** AI 기록 한 줄(상태, 건수, 토큰 수)을 집계에 더한다. 'ok' 만 토큰을 센다 */
export function addAiRow(a: AiAgg, status: unknown, n: unknown, tokens: unknown): void {
  const c = Math.max(0, Math.trunc(Number(n) || 0));
  const t = Math.max(0, Math.trunc(Number(tokens) || 0));
  if (status === 'ok') { a.ok += c; a.tokens += t; }
  else if (status === 'error') a.error += c;
  else if (status === 'denied') a.denied += c;
}

/** 앱의 기본 서버 함수 /health 주소 */
export const healthUrl = (sbUrl: string, slug: string) =>
  `${String(sbUrl ?? '').replace(/\/+$/, '')}/functions/v1/${slug}-fn/health`;

/** /health 응답(JSON)에서 db · mail_ready · ai_hub 만 꺼낸다. 없으면 false */
export function readHealth(j: unknown): { db: boolean; mail_ready: boolean; ai_hub: boolean } {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  return { db: o.db === true, mail_ready: o.mail_ready === true, ai_hub: o.ai_hub === true };
}

/**
 * /health 결과 판정
 *  ok   = 응답 2xx/3xx 이고 db 가 false 가 아님 (db 값을 안 알려 주는 함수는 정상으로 본다)
 *  warn = 응답은 왔는데 db: false (함수는 떠 있지만 DB 연결이 안 됨)
 *  down = 응답 없음·시간 초과·4xx/5xx
 */
export function probeState(http: number | null, j?: unknown): 'ok' | 'warn' | 'down' {
  if (http == null || http < 200 || http >= 400) return 'down';
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  if ('db' in o && o.db === false) return 'warn';
  return 'ok';
}

/** 앱 한 줄의 /health 결과를 화면 모양으로 */
export function appHealth(http: number | null, j: unknown, ms: number): AppHealth {
  const h = readHealth(j);
  return { state: probeState(http, j), http, ms: Math.max(0, Math.trunc(ms)), ...h };
}

/** 요약 카드 숫자 — 앱 목록과 집계에서 센다 */
export function opsTotals(apps: { status: string; mail: MailAgg; ai: AiAgg }[], auditErrors24h: number) {
  const t = { apps_total: apps.length, apps_active: 0, apps_problem: 0, mail_sent: 0, mail_failed: 0, ai_calls: 0, ai_tokens: 0, ai_failed: 0, errors: 0 };
  for (const a of apps) {
    if (a.status === 'active') t.apps_active += 1;
    if (a.status !== 'active' && a.status !== 'retired') t.apps_problem += 1;
    t.mail_sent += a.mail.sent;
    t.mail_failed += a.mail.error + a.mail.denied;
    t.ai_calls += a.ai.ok + a.ai.error;
    t.ai_tokens += a.ai.tokens;
    t.ai_failed += a.ai.error + a.ai.denied;
  }
  t.errors = t.mail_failed + t.ai_failed + Math.max(0, Math.trunc(Number(auditErrors24h) || 0));
  return t;
}

/** 최근 오류 한 줄을 화면용으로 다듬는다 (출처·때·대상·결과·내용) */
export type ErrorRow = { src: 'mail' | 'ai' | 'audit' | string; at: string | Date; slug: string; status: string; detail: string; extra: string };
export function tidyError(r: Record<string, unknown>): ErrorRow {
  const at = r.at instanceof Date ? r.at.toISOString() : String(r.at ?? '');
  const cut = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
  return {
    src: cut(r.src, 10) || 'audit', at,
    slug: cut(r.slug, 40), status: cut(r.status, 12),
    detail: cut(r.detail, 500), extra: cut(r.extra, 200),
  };
}
