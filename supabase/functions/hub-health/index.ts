// 운영 상태 점검: 운영 중(active) 앱 주소를 열어 HTTP 상태와 응답 시간을 hub.health_checks 에 기록한다.
// 호출: 허브 관리자(로그인 JWT) 또는 pg_cron(x-hub-cron 헤더 = HUB_CRON_SECRET)
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
  const rows = await Promise.all((apps ?? []).filter((a) => /^https?:\/\//.test(a.url)).map(async (a) => ({ app_id: a.id, url: a.url, ...(await probe(a.url)) })));
  if (rows.length) {
    const { error: e2 } = await admin.from('health_checks').insert(rows);
    if (e2) return json(req, 500, { error: '점검 결과를 저장하지 못했습니다.' });
  }
  const bySlug = new Map((apps ?? []).map((a) => [a.id, a]));
  return json(req, 200, {
    checked_at: new Date().toISOString(), source: fromCron ? 'cron' : 'admin',
    results: rows.map((r) => ({ slug: bySlug.get(r.app_id)?.slug, name: bySlug.get(r.app_id)?.name, url: r.url, http_status: r.http_status, ok: r.ok, response_ms: r.response_ms, error: r.error })),
  });
});
