// hub-mail — 앱 서버 함수가 학교 메일(Resend, mail.bmrschool.net)로 메일을 보낸다.
// 호출: POST { to, subject, html?, text?, reply_to?, from_name?, slug? }
//   Authorization: Bearer <앱 MAIL_TOKEN>
//     또는 허브 로그인 토큰(관리자, 또는 그 앱 담당 개발자 — 이때 slug 필요)
// 보내는 주소는 허브가 정한다: "<표시 이름>" <slug@mail.bmrschool.net>  (호출자가 from 을 고를 수 없음)
// Resend 키(BMR_RESEND_API_KEY)는 암호문이며 푸는 열쇠는 이 함수 배포본(_key.ts)에만 있다.
import postgres from 'npm:postgres@3.4.5';
import { PROVISION_KEY } from './_key.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const REF = 'psupfmarnyxontorftio';
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const MAIL_DOMAIN = 'mail.bmrschool.net';
const LIMIT = { perAppHour: 20, perAppDay: 100, globalDay: 100, maxTo: 10, maxSubject: 200, maxBody: 100_000, maxName: 80 };
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-mail: 다른 프로젝트에서는 실행하지 않습니다');

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': !o ? HUB : (ORIGINS.includes(o) ? o : HUB),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let resendKey: string | null = null;
async function getResendKey(): Promise<string> {
  if (resendKey) return resendKey;
  const name = 'BMR_RESEND_API_KEY';
  const v = Deno.env.get(name) ?? '';
  if (!v.startsWith('enc:v1:')) throw new HttpError(500, '서버 설정(메일 키)이 없습니다. 관리자 봇에게 알려 주세요.');
  if (!PROVISION_KEY) throw new HttpError(500, '서버 설정(열쇠)이 없습니다. 관리자 봇에게 알려 주세요.');
  const key = await crypto.subtle.importKey('raw', b64d(PROVISION_KEY), 'AES-GCM', false, ['decrypt']);
  const raw = b64d(v.slice(7));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(name) }, key, raw.slice(12));
  resendKey = new TextDecoder().decode(pt);
  return resendKey;
}

async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;
function emails(v: unknown, field: string): string[] {
  const arr = v == null ? [] : (Array.isArray(v) ? v : [v]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    if (typeof x !== 'string') throw new HttpError(400, `${field} 형식이 올바르지 않습니다.`);
    const e = x.trim();
    if (!e) continue;
    if (e.length > 254 || !EMAIL_RE.test(e) || e.includes('\n') || e.includes('\r')) throw new HttpError(400, `${field} 메일 주소가 올바르지 않습니다.`);
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function displayName(raw: unknown, fallback: string): string {
  const s = (typeof raw === 'string' && raw.trim() ? raw.trim() : fallback).replace(/[\r\n<>"]/g, '').trim();
  return (s || fallback).slice(0, LIMIT.maxName);
}

type AppRow = { id: number; slug: string; name: string; status: string };
type Actor = { kind: 'token' | 'user'; email: string; id: string | null };

async function audit(actor: Actor | null, action: string, target: string, result: 'ok' | 'error' | 'denied', detail = '') {
  try {
    await db`insert into public.audit_log (actor, actor_email, action, target, result, detail)
      values (${actor?.id ?? null}, ${(actor?.email ?? '').slice(0, 200)}, ${action.slice(0, 60)}, ${target.slice(0, 200)}, ${result}, ${detail.slice(0, 2000)})`;
  } catch (e) { console.error('audit', String((e as Error)?.message ?? e).slice(0, 200)); }
}

async function mailLog(app: AppRow | null, recipientCount: number, subject: string, status: 'sent' | 'error' | 'denied', error: string, resendId: string, actor: string) {
  try {
    await db`insert into bmr_admin.mail_log (app_id, slug, recipient_count, subject, status, error, resend_id, actor)
      values (${app?.id ?? null}, ${(app?.slug ?? '').slice(0, 40)}, ${recipientCount}, ${subject.slice(0, 200)}, ${status}, ${error.slice(0, 500)}, ${resendId.slice(0, 80)}, ${actor.slice(0, 200)})`;
  } catch (e) { console.error('mail_log', String((e as Error)?.message ?? e).slice(0, 200)); }
}

async function appByToken(tok: string): Promise<AppRow | null> {
  if (!tok || tok.length < 20 || tok.length > 200 || tok.split('.').length === 3) return null;
  const hash = await sha256hex(tok);
  const [r] = await db`select a.id, a.slug, a.name, a.status
    from bmr_admin.mail_tokens t join public.apps a on a.id = t.app_id
    where t.token_hash = ${hash}`;
  return r ? { id: Number(r.id), slug: String(r.slug), name: String(r.name), status: String(r.status) } : null;
}

async function userByJwt(tok: string): Promise<{ id: string; email: string; role: string } | null> {
  if (!tok || tok.split('.').length !== 3) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const u = await r.json();
  if (!u?.id) return null;
  const [p] = await db`select role, email from public.profiles where id = ${u.id}`;
  return { id: u.id, email: String(p?.email || u.email || '').toLowerCase(), role: String(p?.role ?? '') };
}

async function appForUser(u: { id: string; email: string; role: string }, slug: unknown): Promise<AppRow> {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,38}$/.test(slug)) throw new HttpError(400, '앱 주소 이름(slug)을 적어 주세요.');
  const [a] = await db`select id, slug, name, status from public.apps where slug = ${slug}`;
  if (!a) throw new HttpError(404, '앱을 찾을 수 없습니다.');
  if (u.role === 'admin') return { id: Number(a.id), slug: String(a.slug), name: String(a.name), status: String(a.status) };
  if (u.role !== 'staff' && u.role !== 'admin') throw new HttpError(403, '권한이 없습니다.');
  const [own] = await db`select exists (
    select 1 from public.app_owners o where o.app_id = ${a.id} and lower(o.email) = ${u.email} and ${u.email} <> ''
  ) as ok`;
  if (!own?.ok) throw new HttpError(403, '이 앱의 담당 개발자만 보낼 수 있습니다.');
  return { id: Number(a.id), slug: String(a.slug), name: String(a.name), status: String(a.status) };
}

async function rateCheck(appId: number): Promise<string | null> {
  const [c] = await db`select
      count(*) filter (where status = 'sent') as global_day,
      count(*) filter (where status = 'sent' and app_id = ${appId}) as app_day,
      count(*) filter (where status = 'sent' and app_id = ${appId} and at > now() - interval '1 hour') as app_hour
    from bmr_admin.mail_log where at > now() - interval '1 day'`;
  if (Number(c.global_day) >= LIMIT.globalDay) return `학교 전체 하루 발송 한도(${LIMIT.globalDay}통)에 닿았습니다. 내일 다시 시도하세요.`;
  if (Number(c.app_day) >= LIMIT.perAppDay) return `이 앱은 하루에 ${LIMIT.perAppDay}통까지만 보낼 수 있습니다. 내일 다시 시도하세요.`;
  if (Number(c.app_hour) >= LIMIT.perAppHour) return `이 앱은 한 시간에 ${LIMIT.perAppHour}통까지만 보낼 수 있습니다. 잠시 뒤 다시 시도하세요.`;
  return null;
}

const route = (req: Request) => {
  const p = new URL(req.url).pathname;
  const i = p.indexOf('/hub-mail');
  return (i < 0 ? '/' : p.slice(i + '/hub-mail'.length)).replace(/\/+$/, '') || '/';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  const path = route(req);
  if (req.method === 'GET' && path === '/health') return json(req, 200, { ok: true });
  if (req.method !== 'POST' || (path !== '/' && path !== '/send')) return json(req, 405, { error: 'POST 만 받습니다.' });

  let actor: Actor | null = null;
  let app: AppRow | null = null;
  let subject = '';
  let toCount = 0;
  try {
    const rawTok = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
    if (!rawTok) throw new HttpError(401, '메일 토큰 또는 로그인이 필요합니다.');

    const t = await req.text();
    if (t.length > LIMIT.maxBody + 4096) throw new HttpError(413, '요청이 너무 큽니다.');
    let b: Record<string, unknown>;
    try { b = t ? JSON.parse(t) as Record<string, unknown> : {}; } catch { throw new HttpError(400, 'JSON 형식이 아닙니다.'); }

    const byTok = await appByToken(rawTok);
    if (byTok) {
      if (typeof b.slug === 'string' && b.slug && b.slug !== byTok.slug) throw new HttpError(403, '토큰과 앱 주소 이름이 맞지 않습니다.');
      app = byTok;
      actor = { kind: 'token', email: `${byTok.slug}-fn`, id: null };
    } else {
      const u = await userByJwt(rawTok);
      if (!u) throw new HttpError(401, '메일 토큰 또는 로그인이 필요합니다.');
      app = await appForUser(u, b.slug);
      actor = { kind: 'user', email: u.email, id: u.id };
    }

    if (app.status !== 'active') {
      await mailLog(app, 0, '', 'denied', '앱이 활성 상태가 아님', '', actor.email);
      await audit(actor, 'mail:send', app.slug, 'denied', '앱이 활성 상태가 아닙니다.');
      throw new HttpError(403, '이 앱은 지금 메일을 보낼 수 없습니다. (활성 상태인 앱만 가능)');
    }

    const to = emails(b.to, 'to');
    if (!to.length) throw new HttpError(400, '받는 사람(to)을 적어 주세요.');
    if (to.length > LIMIT.maxTo) throw new HttpError(400, `받는 사람은 한 통에 ${LIMIT.maxTo}명까지입니다.`);
    toCount = to.length;
    if (typeof b.subject !== 'string' || !b.subject.trim()) throw new HttpError(400, '제목(subject)을 적어 주세요.');
    if (b.subject.length > LIMIT.maxSubject) throw new HttpError(400, `제목은 ${LIMIT.maxSubject}자까지입니다.`);
    subject = b.subject.trim();
    const html = typeof b.html === 'string' ? b.html : '';
    const text = typeof b.text === 'string' ? b.text : '';
    if (!html && !text) throw new HttpError(400, '본문(html 또는 text)을 적어 주세요.');
    if (html.length + text.length > LIMIT.maxBody) throw new HttpError(413, '본문이 너무 깁니다.');
    const replyTo = emails(b.reply_to, 'reply_to');
    const from = `${displayName(b.from_name, app.name)} <${app.slug}@${MAIL_DOMAIN}>`;

    const limited = await rateCheck(app.id);
    if (limited) {
      await mailLog(app, toCount, subject, 'denied', limited, '', actor.email);
      await audit(actor, 'mail:send', app.slug, 'denied', `한도 · 받는 사람 ${toCount} · ${subject}`);
      throw new HttpError(429, limited);
    }

    const payload: Record<string, unknown> = { from, to, subject };
    if (html) payload.html = html;
    if (text) payload.text = text;
    if (replyTo.length === 1) payload.reply_to = replyTo[0];
    else if (replyTo.length > 1) payload.reply_to = replyTo;

    const key = await getResendKey();
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const bodyText = await r.text();
    let parsed: { id?: string; message?: string; error?: { message?: string } } = {};
    try { parsed = bodyText ? JSON.parse(bodyText) as typeof parsed : {}; } catch { /* 그대로 */ }
    if (!r.ok) {
      const msg = String(parsed.error?.message || parsed.message || `Resend ${r.status}`).slice(0, 300);
      await mailLog(app, toCount, subject, 'error', msg, '', actor.email);
      await audit(actor, 'mail:send', app.slug, 'error', `받는 사람 ${toCount} · ${subject} · ${msg}`);
      throw new HttpError(r.status === 429 ? 429 : 502, r.status === 429 ? '메일 업체가 잠시 막고 있습니다. 잠시 뒤 다시 시도하세요.' : '메일을 보내지 못했습니다. 잠시 뒤 다시 시도하세요.');
    }
    const id = String(parsed.id ?? '');
    await mailLog(app, toCount, subject, 'sent', '', id, actor.email);
    await audit(actor, 'mail:send', app.slug, 'ok', `받는 사람 ${toCount} · ${subject}${id ? ' · ' + id : ''}`);
    return json(req, 200, { ok: true, id, from, to_count: toCount });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error('hub-mail', (e as Error)?.message ?? e);
    if (app) await audit(actor, 'mail:send', app.slug, 'error', '서버 오류');
    return json(req, 500, { error: '서버 오류가 났습니다.' });
  }
});
