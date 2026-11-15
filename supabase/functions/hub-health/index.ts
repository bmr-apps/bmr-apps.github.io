// 운영 상태 점검: 운영 중(active) 앱 주소를 열어 HTTP 상태와 응답 시간을 hub.health_checks 에 기록한다.
// 호출: 허브 관리자(로그인 JWT) 또는 pg_cron(x-hub-cron 헤더 = HUB_CRON_SECRET)
// 알림: 판정이 **바뀐 앱만** 그 앱 담당자에게 알린다 (2번 연속 실패 = 장애 / 장애 → 정상 = 회복).
//       알림함(public.notification_log)에 넣고, 푸시는 hub-notify 에 점검 비밀값으로 부탁한다.
//       같은 앱 알림이 12시간 안에 있으면 넣지 않는다. 알림 실패가 점검 결과를 막지 않는다.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('HUB_CRON_SECRET') ?? '';
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const ORIGINS = ['https://apps.bmrschool.net', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const TIMEOUT_MS = 10000;

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin',
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });

function safeEqual(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function isAdmin(req: Request): Promise<boolean> {
  const h = req.headers.get('Authorization') ?? '';
  const jwt = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!jwt) return false;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return false;
  const { data: m } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  return m?.role === 'admin';
}

type HealthApp = { id: number; slug: string; name: string; url: string };
type HealthRow = { app_id: number; url: string; http_status: number | null; ok: boolean; response_ms: number; error: string | null };

/**
 * 판정이 바뀐 앱만 담당자에게 알린다 (알림함 + 푸시).
 *  · '확인 중'/'정상' → '장애'(2번 연속 실패) : 점검 실패
 *  · '장애' → '정상'                        : 회복
 * 담당자가 없거나 알림을 꺼 두었으면 조용히 넘어간다. 무슨 일이 있어도 점검 자체는 끝까지 간다.
 */
async function notifyTransitions(apps: Map<number, HealthApp>, prev: Map<number, string>, rows: HealthRow[]) {
  const done: { slug: string; state: string }[] = [];
  for (const r of rows) {
    const app = apps.get(r.app_id);
    if (!app) continue;
    const was = prev.get(r.app_id) ?? 'none';
    const now = r.ok ? 'ok' : (was === 'checking' || was === 'down' ? 'down' : 'checking');
    const down = now === 'down' && was !== 'down';
    const back = now === 'ok' && was === 'down';
    if (!down && !back) continue;
    const title = down ? `${app.name} 점검 실패` : `${app.name} 회복`;
    const detail = r.http_status ? `HTTP ${r.http_status}` : (r.error ?? '응답 없음');
    const body = (down ? `${app.name} 이(가) 응답하지 않습니다 (${detail}). 운영 상태를 확인해 주세요.` : `${app.name} 이(가) 다시 정상으로 응답합니다.`).slice(0, 300);
    try {
      const { data: owners } = await admin.from('app_owners').select('email').eq('app_id', app.id);
      const emails = [...new Set((owners ?? []).map((o) => String(o.email ?? '').toLowerCase()).filter(Boolean))];
      if (emails.length) {
        const { data: people } = await admin.from('profiles').select('id, role').in('email', emails);
        const ids = (people ?? []).filter((p) => p.role !== 'disabled').map((p) => String(p.id));
        if (ids.length && !(await recentHealthNotice(app.slug))) {
          const { error } = await admin.from('notification_log').insert(ids.map((user_id) => ({
            user_id, kind: 'health', ref: app.slug, title, body, url: '/hub/status',
          })));
          if (error) console.error('hub-health notify', error.message.slice(0, 160));
        }
      }
    } catch (e) { console.error('hub-health notify', String((e as Error)?.message ?? e).slice(0, 160)); }
    try {
      const r2 = await fetch(`${SB_URL}/functions/v1/hub-notify`, {
        method: 'POST',
        headers: { apikey: SERVICE, 'Content-Type': 'application/json', 'x-hub-cron': CRON },
        body: JSON.stringify({ action: 'health', app_id: app.id, ok: now === 'ok' }),
        signal: AbortSignal.timeout(8000),
      });
      await r2.body?.cancel();
    } catch { /* 푸시를 못 보내도 알림함에는 남았다 */ }
    done.push({ slug: app.slug, state: now });
  }
  return done;
}

/** 같은 앱 알림이 12시간 안에 이미 있었나 (점검은 매시 도니 같은 소식이 쌓이지 않게) */
async function recentHealthNotice(slug: string): Promise<boolean> {
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data } = await admin.from('notification_log').select('id').eq('kind', 'health').eq('ref', slug).gt('created_at', since).limit(1);
  return Boolean(data?.length);
}

async function probe(url: string) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'bmr-apps-hub-health/1.0' } });
    await r.body?.cancel();
    return { http_status: r.status, ok: r.status >= 200 && r.status < 400, response_ms: Math.round(performance.now() - t0), error: null };
  } catch (e) {
    const msg = (e as Error)?.name === 'TimeoutError' ? `시간 초과(${TIMEOUT_MS / 1000}초)` : String((e as Error)?.message ?? e).slice(0, 300);
    return { http_status: null, ok: false, response_ms: Math.round(performance.now() - t0), error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'POST만 받습니다.' });
  const fromCron = safeEqual(req.headers.get('x-hub-cron') ?? '', CRON);
  if (!fromCron && !(await isAdmin(req))) return json(req, 403, { error: '관리자만 점검을 실행할 수 있습니다.' });

  const { data: apps, error } = await admin.from('apps').select('id, slug, name, url').eq('status', 'active').order('sort');
  if (error) return json(req, 500, { error: '앱 목록을 읽지 못했습니다.' });
  const appById = new Map<number, HealthApp>((apps ?? []).map((a) => [Number(a.id), a as HealthApp]));

  // 점검 전 판정을 먼저 읽어 둔다 — 알림은 '바뀐' 앱에만 (점검 기록을 넣은 뒤에는 이전 상태를 알 수 없다)
  const prev = new Map<number, string>();
  try {
    const { data: before } = await admin.from('app_health_latest').select('app_id, state');
    for (const b of before ?? []) prev.set(Number(b.app_id), String(b.state ?? 'ok'));
  } catch { /* 상태 보기를 못 읽어도 점검은 한다 (알림만 건너뜀) */ }

  const rows = await Promise.all((apps ?? []).filter((a) => /^https?:\/\//.test(a.url)).map(async (a) => ({ app_id: Number(a.id), url: a.url, ...(await probe(a.url)) }))) as HealthRow[];
  if (rows.length) {
    const { error: e2 } = await admin.from('health_checks').insert(rows);
    if (e2) return json(req, 500, { error: '점검 결과를 저장하지 못했습니다.' });
  }
  const alerts = await notifyTransitions(appById, prev, rows);
  return json(req, 200, {
    checked_at: new Date().toISOString(), source: fromCron ? 'cron' : 'admin',
    results: rows.map((r) => ({ slug: appById.get(r.app_id)?.slug, name: appById.get(r.app_id)?.name, url: r.url, http_status: r.http_status, ok: r.ok, response_ms: r.response_ms, error: r.error })),
    alerts,
  });
});
