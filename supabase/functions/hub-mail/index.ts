// hub-mail — 앱 서버 함수가 학교 메일(Google Workspace Gmail SMTP, bmrapps@bmrschool.org)로 메일을 보낸다.
// 호출: POST { to, subject, html?, text?, reply_to?, from_name?, slug? }
//   Authorization: Bearer <앱 MAIL_TOKEN>
//     또는 허브 로그인 토큰(관리자, 또는 그 앱 담당 개발자 — 이때 slug 필요)
//     또는 헤더 x-bmr-notify-grant: <값>  → 허브 알림 메일 (hub-notify 가 bmr_admin.notify_grants 에 넣은 한 줄만)
//        · 값은 64자 hex, 2분 안에 한 번만. 받는 사람·제목·본문은 함수가 아니라 그 표에서 온다.
//        · 알림 메일은 'BMR APPS 알림' 이름으로만 나가고, 한 사람 한 시간 6통·학교 전체 하루 200통까지다.
// 보내는 주소는 허브가 정한다: "<표시 이름>" <bmrapps@bmrschool.org>  (호출자가 from 을 고를 수 없음)
// Gmail 비밀번호(BMR_GMAIL_APP_PASSWORD 등)는 암호문이며 푸는 열쇠는 이 함수 배포본(_key.ts)에만 있다.
import postgres from 'npm:postgres@3.4.5';
import { PROVISION_KEY } from './_key.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const REF = 'psupfmarnyxontorftio';
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const FROM_EMAIL = 'bmrapps@bmrschool.org';
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;
const LIMIT = { perAppHour: 100, perAppDay: 500, globalDay: 1500, globalRecipientsDay: 8000, maxTo: 50, maxSubject: 200, maxBody: 100_000, maxName: 80 };
/** 알림 메일(쪽지 알림) 한도 — 사람에게 가는 알림이 학교 메일 한도를 다 먹지 않게 따로 센다 */
const NOTIFY = { perRecipientHour: 6, perDay: 200, grantTtlSec: 120, fromName: 'BMR APPS 알림' } as const;
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
async function decryptSecret(name: string): Promise<string> {
  const v = Deno.env.get(name) ?? '';
  if (!v.startsWith('enc:v1:')) throw new HttpError(500, '서버 설정(메일 키)이 없습니다. 관리자 봇에게 알려 주세요.');
  if (!PROVISION_KEY) throw new HttpError(500, '서버 설정(열쇠)이 없습니다. 관리자 봇에게 알려 주세요.');
  try {
    const key = await crypto.subtle.importKey('raw', b64d(PROVISION_KEY), 'AES-GCM', false, ['decrypt']);
    const raw = b64d(v.slice(7));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(name) }, key, raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    throw new HttpError(500, '서버 설정(메일 키)을 읽지 못했습니다. 관리자 봇에게 알려 주세요.');
  }
}

type SmtpCreds = { user: string; pass: string };
let smtpCreds: SmtpCreds | null = null;
async function getSmtpCreds(): Promise<SmtpCreds> {
  if (smtpCreds) return smtpCreds;
  const user = (await decryptSecret('BMR_GMAIL_SMTP_USER')).trim();
  const pass = (await decryptSecret('BMR_GMAIL_APP_PASSWORD')).replace(/\s+/g, '');
  if (!user || !pass) throw new HttpError(500, '서버 설정(메일 키)이 없습니다. 관리자 봇에게 알려 주세요.');
  smtpCreds = { user, pass };
  return smtpCreds;
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

async function rateCheck(appId: number, addRecipients: number): Promise<string | null> {
  const [c] = await db`select
      count(*) filter (where status = 'sent') as global_day,
      count(*) filter (where status = 'sent' and app_id = ${appId}) as app_day,
      count(*) filter (where status = 'sent' and app_id = ${appId} and at > now() - interval '1 hour') as app_hour,
      coalesce(sum(recipient_count) filter (where status = 'sent'), 0) as global_recipients_day
    from bmr_admin.mail_log where at > now() - interval '1 day'`;
  if (Number(c.global_day) >= LIMIT.globalDay) return `학교 전체 하루 발송 한도(${LIMIT.globalDay}통)에 닿았습니다. 내일 다시 시도하세요.`;
  if (Number(c.app_day) >= LIMIT.perAppDay) return `이 앱은 하루에 ${LIMIT.perAppDay}통까지만 보낼 수 있습니다. 내일 다시 시도하세요.`;
  if (Number(c.app_hour) >= LIMIT.perAppHour) return `이 앱은 한 시간에 ${LIMIT.perAppHour}통까지만 보낼 수 있습니다. 잠시 뒤 다시 시도하세요.`;
  const used = Number(c.global_recipients_day);
  if (used + addRecipients > LIMIT.globalRecipientsDay) {
    return `학교 전체 하루 받는 사람 한도(${LIMIT.globalRecipientsDay}명)를 넘습니다. 최근 24시간에 이미 ${used}명에게 보냈고, 이번 메일은 ${addRecipients}명이라 합치면 한도를 넘습니다. 내일 다시 시도하세요.`;
  }
  return null;
}

// ---------- Gmail SMTP (465 implicit TLS). 비밀번호·AUTH 내용은 로그에 남기지 않는다. ----------
class SmtpError extends Error {
  constructor(message: string, public kind: 'auth' | 'blocked' | 'other', public smtpCode?: number) {
    super(message);
    this.name = 'SmtpError';
  }
}

function sanitizeSmtp(s: string): string {
  return s
    .replace(/AUTH\s+PLAIN\s+\S+/gi, 'AUTH PLAIN ***')
    .replace(/AUTH\s+LOGIN[^\n]*/gi, 'AUTH LOGIN ***')
    .slice(0, 300);
}

function classifyConnectError(e: unknown): SmtpError {
  const raw = sanitizeSmtp(String((e as Error)?.message ?? e));
  const low = raw.toLowerCase();
  if (
    low.includes('timed out') || low.includes('timeout') || low.includes('connection refused') ||
    low.includes('network is unreachable') || low.includes('permission denied') ||
    low.includes('not supported') || low.includes('os error 111') || low.includes('os error 101') ||
    low.includes('os error 13') || low.includes('os error 110') || low.includes('connection reset') ||
    low.includes('failed to connect') || (low.includes('tcp') && low.includes('blocked'))
  ) {
    return new SmtpError(`SMTP 연결 실패(포트 ${SMTP_PORT}): ${raw}`, 'blocked');
  }
  return new SmtpError(`SMTP 오류: ${raw}`, 'other');
}

function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
}

function encodeHeader(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 45) {
    const slice = bytes.subarray(i, i + 45);
    let bin = '';
    for (const x of slice) bin += String.fromCharCode(x);
    parts.push(`=?UTF-8?B?${btoa(bin)}?=`);
  }
  return parts.join(' ');
}

function rfc822Date(d = new Date()): string {
  return d.toUTCString().replace(/GMT$/, '+0000');
}

function wrap76(s: string): string {
  return s.replace(/(.{76})/g, '$1\r\n');
}

function mimeBody(subject: string, fromHeader: string, to: string[], replyTo: string[], text: string, html: string, messageId: string): string {
  const headers = [
    `From: ${fromHeader}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${rfc822Date()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ];
  if (replyTo.length) headers.push(`Reply-To: ${replyTo.join(', ')}`);
  if (text && !html) {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${wrap76(b64utf8(text))}`;
  }
  if (html && !text) {
    headers.push('Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${wrap76(b64utf8(html))}`;
  }
  const boundary = `bmr=${crypto.randomUUID()}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64utf8(text))}`,
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64utf8(html))}`,
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--`;
}

function stuffDots(body: string): string {
  return body.replace(/\r\n\./g, '\r\n..').replace(/^\./, '..');
}

const te = new TextEncoder();
const td = new TextDecoder();

async function smtpRead(conn: Deno.Conn, acc: { s: string }): Promise<{ code: number; text: string }> {
  const buf = new Uint8Array(4096);
  for (let nReads = 0; nReads < 40; nReads++) {
    const chunks = acc.s.split('\r\n');
    for (let i = 0; i < chunks.length - 1; i++) {
      const line = chunks[i];
      if (/^\d{3} /.test(line)) {
        const lines = chunks.slice(0, i + 1);
        acc.s = chunks.slice(i + 1).join('\r\n');
        return { code: Number(line.slice(0, 3)), text: lines.join('\n') };
      }
    }
    const n = await conn.read(buf);
    if (n === null) throw new SmtpError('SMTP 연결이 끊겼습니다', 'other');
    acc.s += td.decode(buf.subarray(0, n));
  }
  throw new SmtpError('SMTP 응답이 너무 깁니다', 'other');
}

async function smtpWrite(conn: Deno.Conn, line: string) {
  const data = te.encode(line + '\r\n');
  let off = 0;
  while (off < data.length) {
    const n = await conn.write(data.subarray(off));
    if (n == null || n <= 0) throw new SmtpError('SMTP 전송이 중단됐습니다', 'other');
    off += n;
  }
}

async function smtpSend(opts: {
  user: string; pass: string; fromEmail: string; fromHeader: string;
  to: string[]; subject: string; text: string; html: string; replyTo: string[];
}): Promise<string> {
  const messageId = `<${crypto.randomUUID()}@bmrschool.org>`;
  let conn: Deno.Conn | null = null;
  const timer = setTimeout(() => { try { conn?.close(); } catch { /* 이미 닫힘 */ } }, 20_000);
  try {
    try {
      conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
    } catch (e) {
      throw classifyConnectError(e);
    }
    const acc = { s: '' };
    const expect = async (ok: (c: number) => boolean, step: string) => {
      const r = await smtpRead(conn!, acc);
      if (!ok(r.code)) {
        const text = sanitizeSmtp(r.text);
        if (r.code === 535 || r.code === 534 || /not accepted|badcredentials|invalid login|username and password/i.test(r.text)) {
          throw new SmtpError(`Gmail 로그인 거부(${r.code}): ${text}`, 'auth', r.code);
        }
        throw new SmtpError(`SMTP ${step} 실패(${r.code}): ${text}`, 'other', r.code);
      }
      return r;
    };
    await expect((c) => c === 220, '접속');
    await smtpWrite(conn, 'EHLO apps.bmrschool.net');
    await expect((c) => c === 250, 'EHLO');
    const plain = btoa(`\0${opts.user}\0${opts.pass}`);
    await smtpWrite(conn, `AUTH PLAIN ${plain}`);
    await expect((c) => c === 235, 'AUTH');
    await smtpWrite(conn, `MAIL FROM:<${opts.fromEmail}>`);
    await expect((c) => c === 250, 'MAIL FROM');
    for (const rcpt of opts.to) {
      await smtpWrite(conn, `RCPT TO:<${rcpt}>`);
      await expect((c) => c === 250 || c === 251, 'RCPT TO');
    }
    await smtpWrite(conn, 'DATA');
    await expect((c) => c === 354, 'DATA');
    const raw = mimeBody(opts.subject, opts.fromHeader, opts.to, opts.replyTo, opts.text, opts.html, messageId);
    const payload = te.encode(stuffDots(raw) + '\r\n.\r\n');
    let off = 0;
    while (off < payload.length) {
      const n = await conn.write(payload.subarray(off));
      if (n == null || n <= 0) throw new SmtpError('SMTP 본문 전송이 중단됐습니다', 'other');
      off += n;
    }
    const done = await expect((c) => c === 250, '저장');
    try { await smtpWrite(conn, 'QUIT'); } catch { /* 무시 */ }
    const queued = /\b([A-Za-z0-9-]{8,})\s*$/m.exec(done.text)?.[1] ?? '';
    return queued || messageId;
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch { /* 이미 닫힘 */ }
  }
}

const route = (req: Request) => {
  const p = new URL(req.url).pathname;
  const i = p.indexOf('/hub-mail');
  return (i < 0 ? '/' : p.slice(i + '/hub-mail'.length)).replace(/\/+$/, '') || '/';
};

// ---------- 허브 알림 메일 (hub-notify → 일회용 표 한 줄) ----------
// 받는 사람·제목·본문은 bmr_admin.notify_grants 에서만 온다 (요청 본문을 읽지 않는다 — 위조할 것이 없다).
async function sendNotify(req: Request, nonce: string): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(nonce)) throw new HttpError(401, '알림 메일 요청 값이 올바르지 않습니다.');
  const rows = await db`update bmr_admin.notify_grants set used_at = now()
    where nonce = ${nonce} and used_at is null and created_at > now() - make_interval(secs => ${NOTIFY.grantTtlSec})
    returning to_email, subject, body`;
  const g = rows[0];
  if (!g) throw new HttpError(401, '알림 메일 요청이 만료되었거나 이미 쓰였습니다.');
  const to = emails(g.to_email, 'to');
  if (!to.length) throw new HttpError(400, '받는 사람이 없습니다.');
  const subject = String(g.subject ?? '').slice(0, LIMIT.maxSubject) || 'BMR APPS 알림';
  const text = String(g.body ?? '').slice(0, LIMIT.maxBody);
  if (!text.trim()) throw new HttpError(400, '알림 내용이 비어 있습니다.');

  const [c] = await db`select
      (select count(*)::int from bmr_admin.notify_grants
        where to_email = ${to[0]} and used_at is not null and used_at > now() - interval '1 hour') as to_hour,
      (select count(*)::int from bmr_admin.mail_log
        where slug = 'hub-notify' and status = 'sent' and at > now() - interval '24 hours') as day_all`;
  if (Number(c?.to_hour ?? 0) > NOTIFY.perRecipientHour) return notifyStop(req, to[0], subject, `이 사람에게 한 시간에 ${NOTIFY.perRecipientHour}통까지만 알림 메일을 보냅니다.`);
  if (Number(c?.day_all ?? 0) >= NOTIFY.perDay) return notifyStop(req, to[0], subject, `하루 알림 메일 한도(${NOTIFY.perDay}통)에 닿았습니다.`);

  const creds = await getSmtpCreds();
  let id = '';
  try {
    id = await smtpSend({
      user: creds.user, pass: creds.pass, fromEmail: FROM_EMAIL,
      fromHeader: `${encodeHeader(NOTIFY.fromName)} <${FROM_EMAIL}>`,
      to, subject, text, html: '', replyTo: [],
    });
  } catch (e) {
    const err = e instanceof SmtpError ? e : classifyConnectError(e);
    const msg = sanitizeSmtp(err.message);
    console.error('hub-mail notify smtp', err.kind, err.smtpCode ?? '', msg);
    await mailLog(null, 1, subject, 'error', msg, '', 'hub-notify');
    throw new HttpError(502, '알림 메일을 보내지 못했습니다. 잠시 뒤 다시 시도하세요.');
  }
  await mailLog(null, 1, subject, 'sent', '', id, 'hub-notify');
  await audit(null, 'mail:notify', 'hub-notify', 'ok', `받는 사람 1 · ${subject}${id ? ' · ' + id : ''}`);
  return json(req, 200, { ok: true, id });
}

/** 알림 메일 한도에 닿았을 때 — 기록만 남기고 200 으로 알린다 (hub-notify 는 알림을 기다리지 않는다) */
async function notifyStop(req: Request, to: string, subject: string, why: string): Promise<Response> {
  await mailLog(null, 1, subject, 'denied', why, '', 'hub-notify');
  await audit(null, 'mail:notify', 'hub-notify', 'denied', `한도 · ${why}`);
  void to;
  return json(req, 200, { ok: false, skipped: why });
}

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
    // 허브 알림 메일은 일회용 표 값만 보고 보낸다 (앱 토큰·로그인 토큰 없이)
    const notifyGrant = req.headers.get('x-bmr-notify-grant') ?? '';
    if (notifyGrant) return await sendNotify(req, notifyGrant);

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
    const fromName = displayName(b.from_name, app.name);
    const fromHeader = `${encodeHeader(fromName)} <${FROM_EMAIL}>`;
    const from = `${fromName} <${FROM_EMAIL}>`;

    const limited = await rateCheck(app.id, toCount);
    if (limited) {
      await mailLog(app, toCount, subject, 'denied', limited, '', actor.email);
      await audit(actor, 'mail:send', app.slug, 'denied', `한도 · 받는 사람 ${toCount} · ${subject}`);
      throw new HttpError(429, limited);
    }

    const creds = await getSmtpCreds();
    let id = '';
    try {
      id = await smtpSend({
        user: creds.user, pass: creds.pass, fromEmail: FROM_EMAIL, fromHeader,
        to, subject, text, html, replyTo,
      });
    } catch (e) {
      const err = e instanceof SmtpError ? e : classifyConnectError(e);
      const msg = sanitizeSmtp(err.message);
      console.error('hub-mail smtp', err.kind, err.smtpCode ?? '', msg);
      await mailLog(app, toCount, subject, 'error', msg, '', actor.email);
      await audit(actor, 'mail:send', app.slug, 'error', `받는 사람 ${toCount} · ${subject} · ${msg}`);
      throw new HttpError(502, '메일을 보내지 못했습니다. 잠시 뒤 다시 시도하세요.');
    }
    await mailLog(app, toCount, subject, 'sent', '', id, actor.email);
    await audit(actor, 'mail:send', app.slug, 'ok', `받는 사람 ${toCount} · ${subject}${id ? ' · ' + id : ''}`);
    return json(req, 200, { ok: true, id, from, to_count: toCount });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error('hub-mail', sanitizeSmtp(String((e as Error)?.message ?? e)));
    if (app) await audit(actor, 'mail:send', app.slug, 'error', '서버 오류');
    return json(req, 500, { error: '서버 오류가 났습니다.' });
  }
});
