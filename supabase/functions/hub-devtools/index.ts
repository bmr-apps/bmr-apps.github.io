// hub-devtools — 개발자 셀프서비스 1단계: 그 앱의 함수 비밀값 · 서버 함수 목록/지우기 · 로그 보기.
// 호출: POST { action, app_id, ... }  Authorization: Bearer <허브 로그인 토큰>
//   info            이 앱의 비밀값 이름·함수 목록·한도 (값은 절대 돌려주지 않음)
//   secret_set      { name, value }  <SCHEMA>_ 로 시작하는 이름만. 값은 관리 API 로 바로 넣고 어디에도 남기지 않음
//   secret_delete   { name }
//   fn_delete       { fn }  추가 함수(<slug>-이름)만. <slug>-fn 은 지울 수 없음
//   logs            { kind: 'fn'|'db', fn?, hours: 1|6|24, errors_only? }  그 앱 함수·그 앱 DB 역할(<schema>_dev, <schema>_fn) 로그만
//   mail_status     이 앱의 메일 상태(토큰·비밀값)·한도 사용량·최근 발송 10건 (본문·토큰 값은 돌려주지 않음)
//   mail_token_issue 메일 토큰을 새로 만들어 <PREFIX>MAIL_TOKEN 에 넣고 해시만 남긴다 (토큰·해시는 브라우저로 보내지 않음)
//   ai_status       이 앱의 AI 상태(토큰·비밀값·업체 키 등록 여부)·허용 모델·한도 사용량·최근 호출 10건 (키·토큰 값은 돌려주지 않음)
//   ai_token_issue  AI 토큰을 새로 만들어 <PREFIX>AI_TOKEN 에 넣고 해시만 남긴다
//   ai_settings_update (관리자) 이 앱의 AI 켜기·허용 모델·한도, 학교 전체 AI 기본값
// 누가: 그 앱 담당 개발자(개발자 승인 + 허브 메일 = 담당자 메일) 또는 관리자. 서버에서 확인한다.
// 기록: 비밀값 넣기·지우기, 함수 지우기는 public.audit_log 에 이름만 남긴다 (값은 남기지 않음).
// 관리 토큰(BMR_MGMT_TOKEN)은 hub-provision 과 같은 암호문 비밀값이고, 푸는 열쇠는 배포본(_key.ts)에만 있다.
import postgres from 'npm:postgres@3.4.5';
import { PROVISION_KEY } from './_key.ts';
import {
  SLUG_RE, EXTRA_FN_MAX, SECRET_MAX_PER_APP, LOG_HOURS, UUID_RE,
  prefixOf, schemaOf, managedSecrets, secretNameProblem, secretValueProblem, fnKind, logSql, maskSecrets,
  mailSecretOf, mailAddressOf, MAIL_LIMITS, mailState,
  aiSecretOf, AI_DEFAULTS, AI_STARTER_MODELS, AI_PROVIDERS, AI_PROVIDER_LABEL, aiState, aiLimitOf,
  parseAiModelSpec, normalizeAiModelList, effectiveAiModels, type AiProvider,
} from './rules.ts';

const REF = 'psupfmarnyxontorftio';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-devtools: 다른 프로젝트에서는 실행하지 않습니다');
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const LIMIT = { perUserHour: 150, perIpHour: 300, logsPerUserHour: 30, secretWritesPerAppHour: 30, mailIssuePerAppHour: 6, aiIssuePerAppHour: 6 };
const MAIL_LOG_ROWS = 10;
const AI_LOG_ROWS = 10;
/** 업체 키 이름 — 값은 암호문이고 이 함수는 '등록되었는지'만 본다 (값은 절대 돌려주지 않음) */
const AI_KEY_ENV: Record<AiProvider, string> = { gemini: 'BMR_GEMINI_API_KEY', openai: 'BMR_OPENAI_API_KEY', anthropic: 'BMR_ANTHROPIC_API_KEY', xai: 'BMR_XAI_API_KEY' };
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : HUB, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 메일 토큰은 SHA-256 해시만 남긴다 (hub-mail 이 같은 방식으로 확인) */
async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

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

    if (action === 'mail_status') {
      const secretName = mailSecretOf(a.slug);
      const secrets = await appSecrets(sb, a.slug);
      const has_secret = secrets.some((s) => s.name === secretName);
      // 발급 기록·발송 기록 표(마이그레이션 20261114100000_hub_mail)를 읽는다
      const read = async () => {
        const [t] = await db`select set_at from bmr_admin.mail_tokens where app_id = ${a.id}`;
        // hub-mail 과 같은 기준: 한도는 '최근 24시간'·'최근 1시간'으로 센다 (달력 날짜 아님)
        const [c] = await db`select
            count(*) filter (where status = 'sent' and app_id = ${a.id}) as app_24h,
            count(*) filter (where status = 'sent' and app_id = ${a.id} and at > now() - interval '1 hour') as app_hour,
            count(*) filter (where status = 'sent') as global_24h,
            coalesce(sum(recipient_count) filter (where status = 'sent'), 0) as global_recipients_24h
          from bmr_admin.mail_log where at > now() - interval '24 hours'`;
        const [td] = await db`select count(*) as n from bmr_admin.mail_log
          where status = 'sent' and app_id = ${a.id}
            and at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;
        // 본문은 애초에 남기지 않는다. 제목·건수·결과·오류만
        const rows = await db`select at, recipient_count, subject, status, error, actor from bmr_admin.mail_log
          where app_id = ${a.id} order by at desc limit ${MAIL_LOG_ROWS}`;
        return { t, c, td, rows };
      };
      let d: Awaited<ReturnType<typeof read>>;
      try { d = await read(); }
      catch (e) {
        console.error('hub-devtools mail_status', String((e as Error)?.message ?? e).slice(0, 200));
        return json(req, 503, { error: '메일 발급·발송 기록 표를 읽지 못했습니다. 메일 DB 준비(마이그레이션)가 안 됐을 수 있습니다. 관리자에게 알려 주세요.' });
      }
      const has_token_hash = !!d.t;
      const txt = (v: unknown, n: number) => String(v ?? '').slice(0, n);
      return json(req, 200, {
        app: { id: a.id, slug: a.slug, name: a.name },
        address: mailAddressOf(a.slug), secret_name: secretName,
        has_secret, has_token_hash, set_at: d.t?.set_at ?? null, state: mailState(has_token_hash, has_secret),
        can_issue: u.admin || a.is_owner,
        limits: MAIL_LIMITS,
        counts: {
          app_24h: Number(d.c?.app_24h ?? 0), app_hour: Number(d.c?.app_hour ?? 0),
          global_24h: Number(d.c?.global_24h ?? 0), app_today: Number(d.td?.n ?? 0),
          global_recipients_24h: Number(d.c?.global_recipients_24h ?? 0),
        },
        recent_logs: d.rows.map((x) => ({
          at: x.at, recipient_count: Number(x.recipient_count ?? 0), subject: txt(x.subject, 200),
          status: String(x.status ?? ''), error: txt(x.error, 500), actor: txt(x.actor, 200),
        })),
      });
    }

    if (action === 'mail_token_issue') {
      if (!u.admin && !a.is_owner) return json(req, 403, { error: '이 앱의 담당 개발자만 메일 토큰을 발급할 수 있습니다.' });
      const secretName = mailSecretOf(a.slug);
      const why = secretNameProblem(a.slug, secretName, allSlugs);
      if (why) return json(req, 400, { error: why });
      const [{ n }] = await db`select count(*) as n from public.audit_log
        where target = ${a.slug} and action = 'mail:token_issue' and result = 'ok' and at > now() - interval '1 hour'`;
      if (Number(n) >= LIMIT.mailIssuePerAppHour) {
        await audit(u, a.slug, 'mail:token_issue', 'denied', `한 시간 ${LIMIT.mailIssuePerAppHour}번 초과`);
        return json(req, 429, { error: `메일 토큰은 한 시간에 ${LIMIT.mailIssuePerAppHour}번까지만 발급합니다. 잠시 뒤 다시 시도하세요.` });
      }
      // 32바이트 무작위 → 64자 16진수. hub-mail 은 해시만 보고, 평문은 함수 비밀값에만 둔다
      let plain = 'bmrmt_' + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
      // 1) 함수 비밀값 먼저 — 여기서 실패하면 예전 토큰이 그대로 살아 있다
      const r = await sb('POST', '/secrets', [{ name: secretName, value: plain }]);
      await r.body?.cancel();   // 응답 본문(값)은 읽지 않는다
      if (!r.ok) {
        plain = '';
        await audit(u, a.slug, 'mail:token_issue', 'error', `${secretName} · 비밀값 저장 실패 (${r.status})`);
        return json(req, 502, { error: `메일 토큰 비밀값을 저장하지 못했습니다 (${r.status}). 잠시 뒤 다시 시도하세요.` });
      }
      // 2) 해시만 남긴다 (실패하면 비밀값과 해시가 어긋나므로 몇 번 다시 시도)
      const hash = await sha256hex(plain);
      plain = '';
      let dbErr = '';
      for (let i = 0; i < 3; i++) {
        try {
          await db`insert into bmr_admin.mail_tokens (app_id, token_hash, set_at) values (${a.id}, ${hash}, now())
            on conflict (app_id) do update set token_hash = excluded.token_hash, set_at = excluded.set_at`;
          dbErr = ''; break;
        } catch (e) { dbErr = String((e as Error)?.message ?? e).slice(0, 160); await sleep(400); }
      }
      if (dbErr) {
        console.error('hub-devtools mail_tokens', dbErr);
        await audit(u, a.slug, 'mail:token_issue', 'error', `${secretName} · 해시 저장 실패 (다시 발급 필요)`);
        const missing = /does not exist|mail_tokens/i.test(dbErr);
        return json(req, 502, {
          error: missing
            ? '메일 기록 표(마이그레이션)가 없어 토큰을 등록하지 못했습니다. 관리자에게 알려 주세요. 지금은 메일이 나가지 않습니다.'
            : '토큰은 넣었지만 해시를 남기지 못했습니다. 화면에서 한 번 더 발급해 주세요.',
        });
      }
      const [t] = await db`select set_at from bmr_admin.mail_tokens where app_id = ${a.id}`;
      await audit(u, a.slug, 'mail:token_issue', 'ok', `${secretName} · 새로 발급 (토큰 값은 기록하지 않음)`);
      return json(req, 200, {
        ok: true, secret_name: secretName, address: mailAddressOf(a.slug), set_at: t?.set_at ?? null,
        note: '토큰 값은 다시 볼 수 없습니다. 이 앱의 서버 함수는 다음 요청부터 새 값을 읽습니다. 예전 토큰은 바로 무효가 되었습니다.',
      });
    }

    if (action === 'ai_status') {
      const secretName = aiSecretOf(a.slug);
      const secrets = await appSecrets(sb, a.slug);
      const has_secret = secrets.some((s) => s.name === secretName);
      // 발급 기록·호출 기록 표(마이그레이션 20261115100000_hub_ai)를 읽는다
      const read = async () => {
        const [cfg] = await db`select default_model, allowed_models, default_app_hourly, default_app_daily, default_app_daily_tokens,
            global_daily_requests, global_daily_tokens, updated_at from bmr_admin.ai_config where id = 1`;
        const [tk] = await db`select enabled, allowed_models, hourly_limit, daily_limit, daily_token_limit, set_at
          from bmr_admin.ai_tokens where app_id = ${a.id}`;
        // hub-ai 와 같은 기준: 요청은 '거부'를 빼고 세고, 한도는 최근 24시간·최근 1시간
        const [c] = await db`select
            count(*) filter (where app_id = ${a.id} and status <> 'denied') as app_24h,
            count(*) filter (where app_id = ${a.id} and status <> 'denied' and at > now() - interval '1 hour') as app_hour,
            coalesce(sum(total_tokens) filter (where app_id = ${a.id} and status = 'ok'), 0) as app_tokens,
            count(*) filter (where status <> 'denied') as global_24h,
            coalesce(sum(total_tokens) filter (where status = 'ok'), 0) as global_tokens
          from bmr_admin.ai_log where at > now() - interval '24 hours'`;
        const [td] = await db`select count(*) as n from bmr_admin.ai_log
          where status <> 'denied' and app_id = ${a.id}
            and at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;
        const rows = await db`select at, provider, model, input_tokens, output_tokens, total_tokens, status, error, actor
          from bmr_admin.ai_log where app_id = ${a.id} order by at desc limit ${AI_LOG_ROWS}`;
        return { cfg, tk, c, td, rows };
      };
      let d: Awaited<ReturnType<typeof read>>;
      try { d = await read(); }
      catch (e) {
        console.error('hub-devtools ai_status', String((e as Error)?.message ?? e).slice(0, 200));
        return json(req, 503, { error: 'AI 발급·호출 기록 표를 읽지 못했습니다. AI DB 준비(마이그레이션)가 안 됐을 수 있습니다. 관리자에게 알려 주세요.' });
      }
      const txt = (v: unknown, n2: number) => String(v ?? '').slice(0, n2);
      const appAllowed = Array.isArray(d.tk?.allowed_models) ? (d.tk.allowed_models as string[]).map(String) : null;
      const globalAllowed = effectiveAiModels(null, d.cfg?.allowed_models);
      const cfg = {
        default_model: parseAiModelSpec(d.cfg?.default_model)?.spec ?? AI_DEFAULTS.defaultModel,
        allowed_models: globalAllowed,
        default_app_hourly: aiLimitOf(Number(d.cfg?.default_app_hourly), AI_DEFAULTS.defaultAppHourly),
        default_app_daily: aiLimitOf(Number(d.cfg?.default_app_daily), AI_DEFAULTS.defaultAppDaily),
        default_app_daily_tokens: aiLimitOf(Number(d.cfg?.default_app_daily_tokens), AI_DEFAULTS.defaultAppDailyTokens),
        global_daily_requests: aiLimitOf(Number(d.cfg?.global_daily_requests), AI_DEFAULTS.globalDailyRequests),
        global_daily_tokens: aiLimitOf(Number(d.cfg?.global_daily_tokens), AI_DEFAULTS.globalDailyTokens),
        updated_at: d.cfg?.updated_at ?? null,
      };
      const eff = {
        allowed_models: effectiveAiModels(appAllowed, globalAllowed),
        hourly: aiLimitOf(d.tk?.hourly_limit == null ? null : Number(d.tk.hourly_limit), cfg.default_app_hourly),
        daily: aiLimitOf(d.tk?.daily_limit == null ? null : Number(d.tk.daily_limit), cfg.default_app_daily),
        daily_tokens: aiLimitOf(d.tk?.daily_token_limit == null ? null : Number(d.tk.daily_token_limit), cfg.default_app_daily_tokens),
      };
      const providers = {} as Record<AiProvider, boolean>;
      for (const p of AI_PROVIDERS) providers[p] = (Deno.env.get(AI_KEY_ENV[p]) ?? '').length > 0;
      return json(req, 200, {
        app: { id: a.id, slug: a.slug, name: a.name },
        secret_name: secretName,
        has_secret, has_token_hash: !!d.tk, set_at: d.tk?.set_at ?? null,
        state: aiState(!!d.tk, has_secret),
        enabled: d.tk ? d.tk.enabled !== false : true,
        can_issue: u.admin || a.is_owner, can_edit: u.admin,
        config_ready: !!d.cfg,
        providers, provider_labels: AI_PROVIDER_LABEL, starter_models: AI_STARTER_MODELS,
        config: cfg,
        app_settings: {
          allowed_models: appAllowed,
          hourly_limit: d.tk?.hourly_limit == null ? null : Number(d.tk.hourly_limit),
          daily_limit: d.tk?.daily_limit == null ? null : Number(d.tk.daily_limit),
          daily_token_limit: d.tk?.daily_token_limit == null ? null : Number(d.tk.daily_token_limit),
        },
        effective: eff,
        limits: { allowed_models_max: AI_DEFAULTS.allowedModelsMax },
        counts: {
          app_hour: Number(d.c?.app_hour ?? 0), app_24h: Number(d.c?.app_24h ?? 0), app_tokens_24h: Number(d.c?.app_tokens ?? 0),
          global_24h: Number(d.c?.global_24h ?? 0), global_tokens_24h: Number(d.c?.global_tokens ?? 0), app_today: Number(d.td?.n ?? 0),
        },
        recent_logs: d.rows.map((x) => ({
          at: x.at, provider: txt(x.provider, 20), model: txt(x.model, 120),
          input_tokens: Number(x.input_tokens ?? 0), output_tokens: Number(x.output_tokens ?? 0), total_tokens: Number(x.total_tokens ?? 0),
          status: String(x.status ?? ''), error: txt(x.error, 500), actor: txt(x.actor, 200),
        })),
      });
    }

    if (action === 'ai_token_issue') {
      if (!u.admin && !a.is_owner) return json(req, 403, { error: '이 앱의 담당 개발자만 AI 토큰을 발급할 수 있습니다.' });
      const secretName = aiSecretOf(a.slug);
      const why = secretNameProblem(a.slug, secretName, allSlugs);
      if (why) return json(req, 400, { error: why });
      const [{ n: iss }] = await db`select count(*) as n from public.audit_log
        where target = ${a.slug} and action = 'ai:token_issue' and result = 'ok' and at > now() - interval '1 hour'`;
      if (Number(iss) >= LIMIT.aiIssuePerAppHour) {
        await audit(u, a.slug, 'ai:token_issue', 'denied', `한 시간 ${LIMIT.aiIssuePerAppHour}번 초과`);
        return json(req, 429, { error: `AI 토큰은 한 시간에 ${LIMIT.aiIssuePerAppHour}번까지만 발급합니다. 잠시 뒤 다시 시도하세요.` });
      }
      // 32바이트 무작위 → 64자 16진수. hub-ai 는 해시만 보고, 평문은 함수 비밀값에만 둔다
      let plain = 'bmrai_' + [...crypto.getRandomValues(new Uint8Array(32))].map((bb) => bb.toString(16).padStart(2, '0')).join('');
      // 1) 함수 비밀값 먼저 — 여기서 실패하면 예전 토큰이 그대로 살아 있다
      const r = await sb('POST', '/secrets', [{ name: secretName, value: plain }]);
      await r.body?.cancel();   // 응답 본문(값)은 읽지 않는다
      if (!r.ok) {
        plain = '';
        await audit(u, a.slug, 'ai:token_issue', 'error', `${secretName} · 비밀값 저장 실패 (${r.status})`);
        return json(req, 502, { error: `AI 토큰 비밀값을 저장하지 못했습니다 (${r.status}). 잠시 뒤 다시 시도하세요.` });
      }
      // 2) 해시만 남긴다 (실패하면 비밀값과 해시가 어긋나므로 몇 번 다시 시도)
      const hash = await sha256hex(plain);
      plain = '';
      let dbErr = '';
      for (let i = 0; i < 3; i++) {
        try {
          await db`insert into bmr_admin.ai_tokens (app_id, token_hash, set_at) values (${a.id}, ${hash}, now())
            on conflict (app_id) do update set token_hash = excluded.token_hash, set_at = excluded.set_at`;
          dbErr = ''; break;
        } catch (e) { dbErr = String((e as Error)?.message ?? e).slice(0, 160); await sleep(400); }
      }
      if (dbErr) {
        console.error('hub-devtools ai_tokens', dbErr);
        await audit(u, a.slug, 'ai:token_issue', 'error', `${secretName} · 해시 저장 실패 (다시 발급 필요)`);
        const missing = /does not exist|ai_tokens/i.test(dbErr);
        return json(req, 502, {
          error: missing
            ? 'AI 기록 표(마이그레이션)가 없어 토큰을 등록하지 못했습니다. 관리자에게 알려 주세요. 지금은 AI를 부를 수 없습니다.'
            : '토큰은 넣었지만 해시를 남기지 못했습니다. 화면에서 한 번 더 발급해 주세요.',
        });
      }
      const [t] = await db`select set_at from bmr_admin.ai_tokens where app_id = ${a.id}`;
      await audit(u, a.slug, 'ai:token_issue', 'ok', `${secretName} · 새로 발급 (토큰 값은 기록하지 않음)`);
      return json(req, 200, {
        ok: true, secret_name: secretName, set_at: t?.set_at ?? null,
        note: '토큰 값은 다시 볼 수 없습니다. 이 앱의 서버 함수는 다음 요청부터 새 값을 읽습니다. 예전 토큰은 바로 무효가 되었습니다.',
      });
    }

    if (action === 'ai_settings_update') {
      if (!u.admin) return json(req, 403, { error: '관리자만 AI 설정을 바꿀 수 있습니다.' });
      const [cur] = await db`select enabled, allowed_models, hourly_limit, daily_limit, daily_token_limit
        from bmr_admin.ai_tokens where app_id = ${a.id}`;
      if (!cur) return json(req, 409, { error: '먼저 이 앱의 AI 토큰을 발급하세요. (토큰을 발급해야 앱별 설정을 저장할 수 있습니다)' });
      const changes: string[] = [];
      // ---- 이 앱 설정 ----
      let enabled = cur.enabled !== false;
      let appAllowed: string[] | null = Array.isArray(cur.allowed_models) ? (cur.allowed_models as string[]).map(String) : null;
      let hourly: number | null = cur.hourly_limit == null ? null : Number(cur.hourly_limit);
      let daily: number | null = cur.daily_limit == null ? null : Number(cur.daily_limit);
      let dailyTokens: number | null = cur.daily_token_limit == null ? null : Number(cur.daily_token_limit);
      if (b.enabled !== undefined) {
        enabled = b.enabled === true;
        changes.push(`사용 ${enabled ? '켜기' : '멈춤'}`);
      }
      if (b.allowed_models !== undefined) {
        if (b.allowed_models === null || b.allowed_models === '') { appAllowed = null; changes.push('허용 모델 → 학교 전체 따름'); }
        else {
          const { list, bad } = normalizeAiModelList(b.allowed_models);
          if (bad.length) return json(req, 400, { error: `모델 이름을 알아보지 못했습니다: ${bad.join(', ')} (예: gemini:gemini-2.5-flash)` });
          if (!list.length) return json(req, 400, { error: '허용 모델을 하나 이상 적어 주세요. 학교 전체 목록을 쓰려면 비우지 말고 \'학교 전체 따름\'을 고르세요.' });
          if (list.length > AI_DEFAULTS.allowedModelsMax) return json(req, 400, { error: `허용 모델은 ${AI_DEFAULTS.allowedModelsMax}개까지입니다.` });
          appAllowed = list;
          changes.push(`허용 모델 ${list.length}개`);
        }
      }
      for (const [k, max, label] of [['hourly_limit', 100000, '1시간 요청'], ['daily_limit', 100000, '24시간 요청'], ['daily_token_limit', 100000000, '24시간 토큰']] as const) {
        const v = b[k];
        if (v === undefined) continue;
        let next: number | null = null;
        if (v !== null && v !== '') {
          const num = Number(v);
          if (!Number.isInteger(num) || num < 0 || num > max) return json(req, 400, { error: `${label} 한도는 0 ~ ${max.toLocaleString('en-US')} 사이 정수입니다.` });
          next = num;
        }
        if (k === 'hourly_limit') hourly = next;
        else if (k === 'daily_limit') daily = next;
        else dailyTokens = next;
        changes.push(`${label} → ${next === null ? '기본값 따름' : next.toLocaleString('en-US')}`);
      }
      await db`update bmr_admin.ai_tokens set enabled = ${enabled}, allowed_models = ${appAllowed}::text[],
          hourly_limit = ${hourly}, daily_limit = ${daily}, daily_token_limit = ${dailyTokens}
        where app_id = ${a.id}`;
      // ---- 학교 전체 설정 (config 가 오면) ----
      const gc = b.config && typeof b.config === 'object' ? b.config as Record<string, unknown> : null;
      if (gc) {
        const [c0] = await db`select default_model, allowed_models, default_app_hourly, default_app_daily, default_app_daily_tokens,
            global_daily_requests, global_daily_tokens from bmr_admin.ai_config where id = 1`;
        if (!c0) return json(req, 503, { error: 'AI 설정 표(마이그레이션)가 없습니다. 관리자에게 알려 주세요.' });
        let dModel = parseAiModelSpec(c0.default_model)?.spec ?? AI_DEFAULTS.defaultModel;
        let gAllowed = effectiveAiModels(null, c0.allowed_models);
        let gHourly = aiLimitOf(Number(c0.default_app_hourly), AI_DEFAULTS.defaultAppHourly);
        let gDaily = aiLimitOf(Number(c0.default_app_daily), AI_DEFAULTS.defaultAppDaily);
        let gTokens = aiLimitOf(Number(c0.default_app_daily_tokens), AI_DEFAULTS.defaultAppDailyTokens);
        let gReq = aiLimitOf(Number(c0.global_daily_requests), AI_DEFAULTS.globalDailyRequests);
        let gTok = aiLimitOf(Number(c0.global_daily_tokens), AI_DEFAULTS.globalDailyTokens);
        if (gc.default_model !== undefined) {
          const m = parseAiModelSpec(gc.default_model);
          if (!m) return json(req, 400, { error: `기본 모델을 알아보지 못했습니다: ${String(gc.default_model).slice(0, 60)}` });
          dModel = m.spec;
          changes.push(`기본 모델 → ${m.spec}`);
        }
        if (gc.allowed_models !== undefined) {
          const { list, bad } = normalizeAiModelList(gc.allowed_models);
          if (bad.length) return json(req, 400, { error: `모델 이름을 알아보지 못했습니다: ${bad.join(', ')}` });
          if (!list.length) return json(req, 400, { error: '학교 전체 허용 모델을 하나 이상 적어 주세요.' });
          if (list.length > AI_DEFAULTS.allowedModelsMax) return json(req, 400, { error: `허용 모델은 ${AI_DEFAULTS.allowedModelsMax}개까지입니다.` });
          gAllowed = list;
          changes.push(`학교 전체 허용 모델 ${list.length}개`);
        }
        for (const [k, max, label] of [
          ['default_app_hourly', 100000, '앱 기본 1시간 요청'], ['default_app_daily', 100000, '앱 기본 24시간 요청'], ['default_app_daily_tokens', 100000000, '앱 기본 24시간 토큰'],
          ['global_daily_requests', 1000000, '학교 전체 24시간 요청'], ['global_daily_tokens', 1000000000, '학교 전체 24시간 토큰'],
        ] as const) {
          const v = gc[k];
          if (v === undefined) continue;
          const num = Number(v);
          if (!Number.isInteger(num) || num < 0 || num > max) return json(req, 400, { error: `${label} 한도는 0 ~ ${max.toLocaleString('en-US')} 사이 정수입니다.` });
          if (k === 'default_app_hourly') gHourly = num;
          else if (k === 'default_app_daily') gDaily = num;
          else if (k === 'default_app_daily_tokens') gTokens = num;
          else if (k === 'global_daily_requests') gReq = num;
          else gTok = num;
          changes.push(`${label} → ${num.toLocaleString('en-US')}`);
        }
        if (!gAllowed.some((x) => (parseAiModelSpec(x)?.spec ?? '').toLowerCase() === dModel.toLowerCase())) {
          return json(req, 400, { error: `기본 모델(${dModel})이 학교 전체 허용 모델 목록에 없습니다. 둘 중 하나를 고쳐 주세요.` });
        }
        await db`update bmr_admin.ai_config set default_model = ${dModel}, allowed_models = ${JSON.stringify(gAllowed)}::jsonb,
            default_app_hourly = ${gHourly}, default_app_daily = ${gDaily}, default_app_daily_tokens = ${gTokens},
            global_daily_requests = ${gReq}, global_daily_tokens = ${gTok}, updated_at = now()
          where id = 1`;
      }
      await audit(u, a.slug, 'ai:settings', 'ok', changes.length ? changes.join(' · ') : '바뀐 값 없음');
      return json(req, 200, { ok: true, changed: changes.length });
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
