// hub-devtools — 개발자 셀프서비스 1단계: 그 앱의 함수 비밀값 · 서버 함수 목록/지우기 · 로그 보기.
// 호출: POST { action, app_id, ... }  Authorization: Bearer <허브 로그인 토큰>
//   info            이 앱의 비밀값 이름·함수 목록·한도 (값은 절대 돌려주지 않음)
//   secret_set      { name, value }  <SCHEMA>_ 로 시작하는 이름만. 값은 관리 API 로 바로 넣고 어디에도 남기지 않음
//   secret_delete   { name }
//   fn_delete       { fn }  추가 함수(<slug>-이름)만. <slug>-fn 은 지울 수 없음
//   logs            { kind: 'fn'|'db', fn?, hours: 1|6|24, errors_only? }  그 앱 함수·그 앱 DB 역할(<schema>_dev, <schema>_fn) 로그만
// 누가: 그 앱 담당 개발자(개발자 승인 + 허브 메일 = 담당자 메일) 또는 관리자. 서버에서 확인한다.
// 기록: 비밀값 넣기·지우기, 함수 지우기는 public.audit_log 에 이름만 남긴다 (값은 남기지 않음).
// 관리 토큰(BMR_MGMT_TOKEN)은 hub-provision 과 같은 암호문 비밀값이고, 푸는 열쇠는 배포본(_key.ts)에만 있다.
import postgres from 'npm:postgres@3.4.5';
import { PROVISION_KEY } from './_key.ts';
import {
  SLUG_RE, EXTRA_FN_MAX, SECRET_MAX_PER_APP, LOG_HOURS, UUID_RE,
  prefixOf, schemaOf, managedSecrets, secretNameProblem, secretValueProblem, fnKind, logSql, maskSecrets,
} from './rules.ts';

const REF = 'psupfmarnyxontorftio';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-devtools: 다른 프로젝트에서는 실행하지 않습니다');
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const LIMIT = { perUserHour: 150, perIpHour: 300, logsPerUserHour: 30, secretWritesPerAppHour: 30 };
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : HUB, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache' } });

// ---------- 관리 토큰 (암호문 → 메모리에서만 풂) ----------
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let mgmtToken = '';
async function token() {
  if (mgmtToken) return mgmtToken;
  const v = Deno.env.get('BMR_MGMT_TOKEN') ?? '';
  if (!v.startsWith('enc:v1:')) throw new HttpError(500, '서버 설정이 없습니다. 관리자에게 알려 주세요.');
  const key = await crypto.subtle.importKey('raw', b64d(PROVISION_KEY), 'AES-GCM', false, ['decrypt']);
  const raw = b64d(v.slice(7));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode('BMR_MGMT_TOKEN') }, key, raw.slice(12));
  mgmtToken = new TextDecoder().decode(pt);
  return mgmtToken;
}

// ---------- 허용 목록: 이 앱 몫의 비밀값·함수·로그만 ----------
function mgmtFor(slug: string, allSlugs: string[]) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return async (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => {
    let ok = false;
    if (method === 'GET' && (path === '/secrets' || path === '/functions' || path.startsWith('/analytics/endpoints/logs?'))) ok = true;
    if ((method === 'POST' || method === 'DELETE') && path === '/secrets') {
      const names = method === 'POST' ? (body as { name: string }[]).map((x) => x.name) : (body as string[]);
      ok = Array.isArray(names) && names.length === 1 && secretNameProblem(slug, names[0], allSlugs) === null;
    }
    const m = new RegExp(`^/functions/(${esc(slug)}-[a-z0-9-]+)$`).exec(path);
    if (method === 'DELETE' && m && fnKind(slug, m[1], allSlugs) === 'extra') ok = true;
    if (!ok) { console.error('hub-devtools blocked', method, path.slice(0, 80)); throw new HttpError(500, '허용되지 않은 관리 요청을 막았습니다.'); }
    const t = await token();
    return await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
      method, headers: { Authorization: `Bearer ${t}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
    });
  };
}

// ---------- 누가 부르나 ----------
type Me = { id: string; email: string; name: string; admin: boolean; staff: boolean };
async function me(req: Request): Promise<Me> {
  const tok = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!tok || tok.split('.').length !== 3) throw new HttpError(401, '로그인이 필요합니다.');
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) { await r.body?.cancel(); throw new HttpError(401, '로그인이 필요합니다.'); }
  const u = await r.json();
  const [p] = await db`select role, name from public.profiles where id = ${u.id}`;
  const role = p?.role ?? '';
  if (role === 'disabled') throw new HttpError(403, '사용이 중지된 계정입니다. 관리자에게 문의하세요.');
  return { id: u.id, email: String(u.email ?? '').toLowerCase(), name: p?.name || u.email, admin: role === 'admin', staff: role === 'staff' || role === 'admin' };
}
type App = { id: number; slug: string; name: string; fn_auto_deploy: boolean; is_owner: boolean };
/** 이 앱(v2)의 담당 개발자이거나 관리자일 때만 앱을 돌려준다 */
async function appFor(u: Me, appId: number): Promise<App> {
  if (!Number.isInteger(appId) || appId <= 0) throw new HttpError(400, '앱을 골라 주세요.');
  const [a] = await db`
    select a.id, a.slug, a.name, a.fn_auto_deploy,
      exists (select 1 from public.app_owners o where o.app_id = a.id and lower(o.email) = ${u.email}) as is_owner
    from public.apps a
    join pg_namespace n on n.nspname = replace(a.slug, '-', '_') and obj_description(n.oid, 'pg_namespace') = 'bmr-app:' || a.slug || ':v2'
    where a.id = ${appId}`;
  if (!a || !SLUG_RE.test(String(a.slug))) throw new HttpError(404, 'BMR APPS 개발 환경(v2) 앱이 아닙니다.');
  if (!u.admin && !(u.staff && a.is_owner)) throw new HttpError(403, '이 앱의 담당 개발자만 쓸 수 있습니다. (허브 계정 메일이 담당자 메일과 같아야 합니다)');
  return a as unknown as App;
}
async function rateLimit(req: Request, u: Me | null, action: string) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const [c] = await db`select
      count(*) filter (where user_id = ${u?.id ?? null}::uuid) as by_user,
      count(*) filter (where ip = ${ip}) as by_ip,
      count(*) filter (where user_id = ${u?.id ?? null}::uuid and action = 'logs') as logs
    from bmr_admin.devtools_attempts where at > now() - interval '1 hour'`;
  if (Number(c.by_user) >= LIMIT.perUserHour || Number(c.by_ip) >= LIMIT.perIpHour) throw new HttpError(429, '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.');
  if (action === 'logs' && Number(c.logs) >= LIMIT.logsPerUserHour) throw new HttpError(429, `로그는 한 시간에 ${LIMIT.logsPerUserHour}번까지 불러옵니다. 잠시 뒤 다시 시도하세요.`);
  await db`insert into bmr_admin.devtools_attempts (user_id, ip, action) values (${u?.id ?? null}, ${ip}, ${action.slice(0, 30)})`;
  if (Math.random() < 0.05) await db`delete from bmr_admin.devtools_attempts where at < now() - interval '1 day'`;
}
async function audit(u: Me, slug: string, action: string, result: 'ok' | 'error' | 'denied', detail: string) {
  try {
    await db`insert into public.audit_log (actor, actor_email, action, target, result, detail)
      values (${u.id}, ${u.email.slice(0, 200)}, ${action}, ${slug}, ${result}, ${`${(u.name || u.email).slice(0, 100)} · ${detail}`.slice(0, 2000)})`;
  } catch (e) { console.error('audit', String((e as Error)?.message ?? e).slice(0, 200)); }
}

type Fn = { id: string; slug: string; version: number; status: string; updated_at: number | string; kind: 'main' | 'extra' };
async function appFns(sb: ReturnType<typeof mgmtFor>, slug: string, allSlugs: string[]): Promise<Fn[]> {
  const r = await sb('GET', '/functions');
  if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `함수 목록을 읽지 못했습니다 (${r.status}).`); }
  const all = await r.json() as { id: string; slug: string; version: number; status: string; updated_at: number }[];
  const out: Fn[] = [];
  for (const f of all) { const kind = fnKind(slug, f.slug, allSlugs); if (kind) out.push({ id: f.id, slug: f.slug, version: f.version, status: f.status, updated_at: f.updated_at, kind }); }
  return out;
}
async function appSecrets(sb: ReturnType<typeof mgmtFor>, slug: string) {
  const r = await sb('GET', '/secrets');
  if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `비밀값 목록을 읽지 못했습니다 (${r.status}).`); }
  const p = prefixOf(slug), managed = managedSecrets(slug);
  // 값(또는 그 요약)은 버리고 이름·바뀐 때만
  return (await r.json() as { name: string; updated_at?: string }[])
    .filter((s) => s.name.startsWith(p))
    .map((s) => ({ name: s.name, updated_at: s.updated_at ?? null, managed: managed.includes(s.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 만 됩니다.' });
  let u: Me | null = null;
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(b.action ?? '');
    u = await me(req).catch(async (e) => { await rateLimit(req, null, action || '?'); throw e; });
    await rateLimit(req, u, action);
    if (!u.staff) return json(req, 403, { error: '개발자 승인 후 이용할 수 있어요. 관리자에게 요청하세요.' });
    const a = await appFor(u, Number(b.app_id));
    const allSlugs = (await db`select slug from public.apps`).map((x) => String(x.slug));
    const sb = mgmtFor(a.slug, allSlugs);

    if (action === 'info') {
      const [secrets, fns] = await Promise.all([appSecrets(sb, a.slug), appFns(sb, a.slug, allSlugs)]);
      const [req1] = await db`select id, status, note, decision_note, requested_name, created_at from public.dev_requests where app_id = ${a.id} and kind = 'fn_auto_deploy' order by created_at desc limit 1`;
      return json(req, 200, {
        app: { id: a.id, slug: a.slug, name: a.name, fn_auto_deploy: a.fn_auto_deploy, is_owner: a.is_owner },
        me: { admin: u.admin },
        secret_prefix: prefixOf(a.slug), schema: schemaOf(a.slug),
        secrets, functions: fns.sort((x, y) => (x.kind === y.kind ? x.slug.localeCompare(y.slug) : x.kind === 'main' ? -1 : 1)),
        limits: { extra_fn_max: EXTRA_FN_MAX, secret_max: SECRET_MAX_PER_APP, log_hours: LOG_HOURS },
        db_roles: [`${schemaOf(a.slug)}_dev`, `${schemaOf(a.slug)}_fn`],
        last_request: req1 ?? null,
      });
    }

    if (action === 'secret_set' || action === 'secret_delete') {
      const name = String(b.name ?? '');
      const why = secretNameProblem(a.slug, name, allSlugs);
      if (why) { await audit(u, a.slug, action === 'secret_set' ? 'secret:set' : 'secret:delete', 'denied', `${name.slice(0, 100).replace(/[^A-Za-z0-9_]/g, '?')} · ${why}`); return json(req, 400, { error: why }); }
      const [{ n }] = await db`select count(*)::int as n from public.audit_log where target = ${a.slug} and action in ('secret:set', 'secret:delete') and result = 'ok' and at > now() - interval '1 hour'`;
      if (n >= LIMIT.secretWritesPerAppHour) return json(req, 429, { error: `한 시간에 ${LIMIT.secretWritesPerAppHour}번까지 바꿀 수 있습니다.` });
      const cur = await appSecrets(sb, a.slug);
      const exists = cur.some((s) => s.name === name);
      if (action === 'secret_set') {
        const vwhy = secretValueProblem(b.value);
        if (vwhy) return json(req, 400, { error: vwhy });
        if (!exists && cur.filter((s) => !s.managed).length >= SECRET_MAX_PER_APP) return json(req, 409, { error: `이 앱은 비밀값을 ${SECRET_MAX_PER_APP}개까지 넣을 수 있습니다. 안 쓰는 것을 먼저 지우세요.` });
        const r = await sb('POST', '/secrets', [{ name, value: String(b.value) }]);
        await r.body?.cancel();   // 응답 본문은 읽지 않는다
        if (!r.ok) { await audit(u, a.slug, 'secret:set', 'error', `${name} · 저장 실패 (${r.status})`); return json(req, 502, { error: `저장하지 못했습니다 (${r.status}). 잠시 뒤 다시 시도하세요.` }); }
        await audit(u, a.slug, 'secret:set', 'ok', `${name} · ${exists ? '값 바꿈' : '새로 넣음'} (값은 기록하지 않음)`);
        return json(req, 200, { ok: true, name, created: !exists, note: '값은 다시 볼 수 없습니다. 서버 함수에서 Deno.env.get() 으로 읽습니다. 이미 떠 있는 함수는 다음 요청부터 새 값을 씁니다.' });
      }
      if (!exists) return json(req, 404, { error: '그런 이름의 비밀값이 없습니다.' });
      const r = await sb('DELETE', '/secrets', [name]);
      await r.body?.cancel();
      if (!r.ok) { await audit(u, a.slug, 'secret:delete', 'error', `${name} · 지우기 실패 (${r.status})`); return json(req, 502, { error: `지우지 못했습니다 (${r.status}).` }); }
      await audit(u, a.slug, 'secret:delete', 'ok', name);
      return json(req, 200, { ok: true, name, deleted: true });
    }

    if (action === 'fn_delete') {
      const fn = String(b.fn ?? '');
      if (fnKind(a.slug, fn, allSlugs) !== 'extra') return json(req, 400, { error: fn === `${a.slug}-fn` ? `${fn} 은 기본 함수라 지울 수 없습니다 (앱 삭제는 관리자).` : '이 앱의 추가 함수가 아닙니다.' });
      const fns = await appFns(sb, a.slug, allSlugs);
      if (!fns.some((f) => f.slug === fn)) return json(req, 404, { error: '그런 함수가 없습니다.' });
      const r = await sb('DELETE', `/functions/${fn}`);
      await r.body?.cancel();
      if (!r.ok) { await audit(u, a.slug, 'fn:delete', 'error', `${fn} · 지우기 실패 (${r.status})`); return json(req, 502, { error: `지우지 못했습니다 (${r.status}).` }); }
      await db`delete from bmr_admin.fn_deploy_state where fn = ${fn}`;
      await audit(u, a.slug, 'fn:delete', 'ok', `${fn} (저장소 폴더도 지우지 않으면 다음 push 때 다시 만들어집니다)`);
      return json(req, 200, { ok: true, fn, deleted: true });
    }

    if (action === 'logs') {
      const kind = b.kind === 'db' ? 'db' : 'fn';
      const hours = Number(b.hours ?? 1);
      if (!(LOG_HOURS as readonly number[]).includes(hours)) return json(req, 400, { error: '기간은 1·6·24시간 중에서 고릅니다.' });
      const fns = kind === 'fn' ? await appFns(sb, a.slug, allSlugs) : [];
      let ids: string[];
      if (kind === 'fn') {
        const want = String(b.fn ?? '');
        ids = (want ? fns.filter((f) => f.slug === want) : fns).map((f) => f.id).filter((x) => UUID_RE.test(x));
        if (!ids.length) return json(req, 200, { rows: [], note: want ? '그 함수가 없습니다.' : '아직 서버 함수가 없습니다.' });
      } else ids = [`${schemaOf(a.slug)}_dev`, `${schemaOf(a.slug)}_fn`];
      const end = new Date(), start = new Date(end.getTime() - hours * 3600_000);
      const qs = new URLSearchParams({ sql: logSql(kind, ids, { errorsOnly: b.errors_only === true }), iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
      const r = await sb('GET', `/analytics/endpoints/logs?${qs}`);
      if (r.status === 429) { await r.body?.cancel(); return json(req, 429, { error: 'Supabase 로그 조회가 잠시 몰렸습니다. 1분 뒤 다시 눌러 주세요.' }); }
      if (!r.ok) { await r.body?.cancel(); return json(req, 502, { error: `로그를 읽지 못했습니다 (${r.status}).` }); }
      const j = await r.json() as { result?: Record<string, unknown>[]; error?: unknown };
      if (j.error) { console.error('hub-devtools logs', String(JSON.stringify(j.error)).slice(0, 200)); return json(req, 502, { error: '로그 조회 형식 오류입니다. 관리자에게 알려 주세요.' }); }
      const name = new Map(fns.map((f) => [f.id, f.slug]));
      const s = (v: unknown, n = 200) => maskSecrets(String(v ?? '')).slice(0, n);
      const rows = (j.result ?? []).map((x) => ({
        at: String(x.timestamp ?? ''), source: String(x.source ?? ''),
        fn: kind === 'fn' ? name.get(String(x.function_id ?? '')) ?? '' : undefined,
        role: kind === 'db' ? s(x.role, 80) : undefined,
        level: s(x.level, 20), method: s(x.method, 10), path: s(x.path, 300), status: s(x.status, 5), ms: s(x.ms, 10), code: s(x.code, 10),
        message: s(x.message, 2000),
      }));
      return json(req, 200, { rows, kind, hours, scope: kind === 'fn' ? [...name.values()] : ids });
    }
    return json(req, 400, { error: '알 수 없는 요청입니다.' });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error('hub-devtools', (e as { code?: string })?.code ?? '', String((e as Error)?.message ?? '').slice(0, 200));
    return json(req, 500, { error: '서버 오류가 났습니다.' });
  }
});
