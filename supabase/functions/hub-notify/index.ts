// hub-notify — 알림(웹 푸시 · 메일)과 안 읽은 배지의 서버 쪽.
//
// 호출: POST { action, ... }  Authorization: Bearer <허브 로그인 토큰>
//   state        내 알림 설정 · 기기 목록 · 안 읽은 알림 수 (화면이 처음 열 때 한 번)
//   vapid_key    푸시 공개키 (처음이면 Web Crypto 로 열쇠쌍을 만들어 bmr_admin.push_config 에 저장)
//   save_prefs   { push_enabled?, email_enabled?, notify_chat?, notify_admin? }
//   test         내 기기로 시험 알림 한 통 (경로 전체가 살아 있는지 확인)
//   chat         { thread_id }  방금 내가 보낸 쪽지를 상대에게 알린다 (푸시 → 안 닿으면 메일)
//   event        { kind: 'app_request' | 'dev_request', id }  (관리자) 결정된 신청을 신청자에게 알린다
//   GET /health  살아 있는지 (웹 푸시 라이브러리·열쇠 준비 여부)
//
// 지키는 경계
//   · 쪽지 내용은 보낸 사람이 보낸 글이 아니라 **DB 에 있는 마지막 쪽지**로 만든다 (남의 쪽지로 알림을 만들 수 없다).
//   · 알림은 대화의 상대에게만 간다. 내가 대화 참여자가 아니면 403.
//   · 이미 상대가 읽은 쪽지(last_read_id >= 메시지 번호)면 알리지 않는다.
//   · 상대가 꺼 두었으면(notify_chat · push_enabled · email_enabled) 보내지 않는다.
//   · 메일은 푸시가 한 대도 닿지 않았을 때만, 같은 대화 10분에 한 통, 한 사람 한 시간 6통, 학교 전체 하루 200통까지.
//   · VAPID 비밀키는 bmr_admin.push_config 에만 있고 브라우저에는 공개키만 나간다. 구독 주소(열쇠)는 화면에 보여 주지 않는다.
//   · 남기는 것: 호출·발송 횟수(bmr_admin.notify_attempts)만. 쪽지 본문·메일 주소는 남기지 않는다.
// 이 함수는 _key.ts(암호문을 푸는 열쇠)를 쓰지 않는다 — 메일은 hub-mail 에 일회용 표(notify_grants)로 부탁한다.
import postgres from 'npm:postgres@3.4.5';
import {
  LIMITS, canEmail, canPush, chatPayload, deviceLabel, emailAllowed, endpointHost, eventPayload,
  mailBody, mailSubject, normalizePrefs, prefsProblem,
} from './rules.ts';

const REF = 'psupfmarnyxontorftio';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const ICON = `${HUB}/favicon-192x192.png`;
const VAPID_SUBJECT = 'mailto:bmrapps@bmrschool.org';
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-notify: 다른 프로젝트에서는 실행하지 않습니다');

const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });

// ---------- 웹 푸시 라이브러리 (없어도 함수는 뜬다: 그때는 화면에 '푸시 준비 안 됨'으로 안내) ----------
type PushLib = {
  sendNotification: (
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    opts: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; urgency: string },
  ) => Promise<unknown>;
};
let webpush: PushLib | null = null;
try {
  const mod = await import('npm:web-push@3.6.7') as unknown as { default?: PushLib };
  webpush = mod.default ?? null;
} catch (e) {
  console.error('hub-notify', 'web-push 를 불러오지 못했습니다', String((e as Error)?.message ?? e).slice(0, 200));
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
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
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache' } });

// ---------- VAPID 열쇠 ----------
const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (v: string) => {
  const s = atob(v.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((v.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
type Vapid = { publicKey: string; privateKey: string; subject: string };
let vapidCache: Vapid | null = null;

/** 열쇠가 있으면 읽고, 없으면 Web Crypto 로 만들어 한 번만 저장한다 (동시 요청에도 하나만 남게) */
async function vipid(): Promise<Vapid> {
  if (vapidCache) return vapidCache;
  const read = async (): Promise<Vapid | null> => {
    const [row] = await db`select public_key, private_jwk, subject from bmr_admin.push_config where id = 1`;
    const jwk = row?.private_jwk as { d?: string } | null;
    if (!row || !jwk?.d) return null;
    return { publicKey: String(row.public_key), privateKey: String(jwk.d), subject: String(row.subject) };
  };
  const found = await read();
  if (found) { vapidCache = found; return found; }

  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey) as JsonWebKey;
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey) as JsonWebKey;
  const raw = new Uint8Array(65);
  raw[0] = 4;
  raw.set(fromB64url(String(pub.x)), 1);
  raw.set(fromB64url(String(pub.y)), 33);
  const jwk = { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, d: priv.d };
  await db`insert into bmr_admin.push_config (id, public_key, private_jwk, subject)
    values (1, ${b64url(raw)}, ${db.json(jwk)}, ${VAPID_SUBJECT})
    on conflict (id) do nothing`;
  const after = await read();
  if (!after) throw new HttpError(500, '푸시 열쇠를 저장하지 못했습니다. 관리자에게 알려 주세요.');
  vapidCache = after;
  return after;
}

// ---------- 로그인 확인 ----------
type Me = { id: string; email: string; name: string; role: string };
async function userByJwt(tok: string): Promise<Me | null> {
  if (!tok || tok.split('.').length !== 3) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const u = await r.json();
  if (!u?.id) return null;
  const [p] = await db`select role, email, name from public.profiles where id = ${u.id}`;
  return {
    id: String(u.id),
    email: String(p?.email || u.email || '').toLowerCase(),
    name: String(p?.name || '').trim(),
    role: String(p?.role ?? ''),
  };
}

// ---------- 횟수 (사람·IP 한도, 메일 쿨다운) ----------
async function tally(ip: string, userId: string | null, action: string, ref = '', ok = true) {
  await db`insert into bmr_admin.notify_attempts (user_id, ip, action, ref, ok)
    values (${userId}, ${ip.slice(0, 60)}, ${action.slice(0, 30)}, ${ref.slice(0, 60)}, ${ok})`;
  if (Math.random() < 0.05) {
    await db`delete from bmr_admin.notify_attempts where at < now() - interval '30 days'`;
    await db`delete from bmr_admin.notify_grants where created_at < now() - interval '2 days'`;
  }
}
async function usedIn(userId: string | null, action: string, seconds: number, ref?: string): Promise<number> {
  const [c] = ref === undefined
    ? await db`select count(*)::int as n from bmr_admin.notify_attempts
        where action = ${action} and at > now() - make_interval(secs => ${seconds})
          and (${userId}::uuid is null or user_id = ${userId}::uuid)`
    : await db`select count(*)::int as n from bmr_admin.notify_attempts
        where action = ${action} and ref = ${ref} and at > now() - make_interval(secs => ${seconds})
          and (${userId}::uuid is null or user_id = ${userId}::uuid)`;
  return Number(c?.n ?? 0);
}
/** 마지막으로 그 대상(대화·신청)에 메일을 보낸 때 (없으면 null) */
async function lastMailAt(userId: string, ref: string, action = 'chat:email'): Promise<string | null> {
  const [r] = await db`select at from bmr_admin.notify_attempts
    where user_id = ${userId} and action = ${action} and ref = ${ref} and ok = true
    order by at desc limit 1`;
  return r?.at ? String(r.at) : null;
}

// ---------- 푸시 보내기 ----------
type Sub = { endpoint: string; p256dh: string; auth: string };
type PushOut = { ready: boolean; devices: number; sent: number; failed: number; removed: number };
async function sendPush(subs: Sub[], payload: { title: string; body: string; url?: string; tag?: string }): Promise<PushOut> {
  const out: PushOut = { ready: Boolean(webpush), devices: subs.length, sent: 0, failed: 0, removed: 0 };
  if (!webpush || !subs.length) return out;
  const vapid = await vipid();
  const body = JSON.stringify({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 180),
    url: payload.url || '/hub/',
    tag: payload.tag || 'bmr-apps',
    icon: ICON,
    badge: ICON,
  });
  const opts = { vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 3600, urgency: 'high' };
  const expired: string[] = [];
  const deadline = Date.now() + 12_000;
  await Promise.all(subs.map(async (s) => {
    if (Date.now() > deadline) { out.failed++; return; }
    try {
      await webpush!.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, opts);
      out.sent++;
    } catch (e) {
      const code = Number((e as { statusCode?: number })?.statusCode ?? 0);
      if (code === 404 || code === 410) expired.push(s.endpoint);
      else { out.failed++; console.error('hub-notify push', code, String((e as Error)?.message ?? e).slice(0, 200)); }
    }
  }));
  if (expired.length) {
    try {
      await db`delete from public.push_subscriptions where endpoint in ${db(expired)}`;
      out.removed = expired.length;
    } catch (e) { console.error('hub-notify cleanup', String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  return out;
}
/** 같은 주소가 여러 줄(같은 기기에서 두 사람)이어도 한 번만 보낸다 */
function dedupe(rows: Record<string, unknown>[]): Sub[] {
  const seen = new Set<string>();
  const out: Sub[] = [];
  for (const r of rows) {
    const endpoint = String(r.endpoint ?? '');
    if (!endpoint || seen.has(endpoint)) continue;
    seen.add(endpoint);
    out.push({ endpoint, p256dh: String(r.p256dh ?? ''), auth: String(r.auth ?? '') });
  }
  return out.slice(0, LIMITS.maxDevices);
}
async function subsOf(userId: string): Promise<Sub[]> {
  const rows = await db`select endpoint, p256dh, auth from public.push_subscriptions
    where user_id = ${userId} order by id desc limit ${LIMITS.maxDevices}`;
  return dedupe(rows as unknown as Record<string, unknown>[]);
}

// ---------- 알림 메일 (hub-mail 에 일회용 표로 부탁) ----------
function hex64(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function sendMail(to: string, subject: string, body: string): Promise<'sent' | 'error'> {
  const nonce = hex64();
  const [grant] = await db`insert into bmr_admin.notify_grants (nonce, to_email, subject, body)
    values (${nonce}, ${to.slice(0, 254)}, ${subject.slice(0, 200)}, ${body.slice(0, LIMITS.maxMailBody)})
    returning id`;
  if (!grant) throw new HttpError(500, '메일 요청을 만들지 못했습니다.');
  const r = await fetch(`${SB_URL}/functions/v1/hub-mail`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json', 'x-bmr-notify-grant': nonce },
    body: '{}',
    signal: AbortSignal.timeout(25_000),
  });
  await r.body?.cancel();
  return r.ok ? 'sent' : 'error';
}

// ---------- 화면이 부르는 것들 ----------
const route = (req: Request) => {
  const p = new URL(req.url).pathname;
  const i = p.indexOf('/hub-notify');
  return (i < 0 ? '/' : p.slice(i + '/hub-notify'.length)).replace(/\/+$/, '') || '/';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  const path = route(req);
  if (req.method === 'GET' && path === '/health') return json(req, 200, { ok: true, push_ready: Boolean(webpush), vapid_subject: VAPID_SUBJECT });
  if (req.method !== 'POST' || path !== '/') return json(req, 405, { error: 'POST 만 받습니다.' });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  let u: Me | null = null;
  try {
    const rawTok = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
    if (!rawTok) throw new HttpError(401, '로그인이 필요합니다.');
    u = await userByJwt(rawTok);
    if (!u) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (u.role === 'disabled') throw new HttpError(403, '사용이 중지된 계정입니다. 관리자에게 문의하세요.');

    const t = await req.text();
    if (t.length > 8000) throw new HttpError(413, '요청이 너무 큽니다.');
    let b: Record<string, unknown>;
    try { b = t ? JSON.parse(t) as Record<string, unknown> : {}; } catch { throw new HttpError(400, 'JSON 형식이 아닙니다.'); }
    const action = String(b.action ?? '');

    // ---------- 내 설정·기기·안 읽은 수 ----------
    if (action === 'state') {
      const [prefsRow] = await db`select push_enabled, email_enabled, notify_chat, notify_admin from public.notification_prefs where user_id = ${u.id}`;
      const devices = await db`select id, user_agent, endpoint, created_at, last_seen_at from public.push_subscriptions
        where user_id = ${u.id} order by id desc limit ${LIMITS.maxDevices}`;
      const [unread] = await db`select count(*)::int as n from public.notification_log where user_id = ${u.id} and read_at is null`;
      return json(req, 200, {
        ok: true,
        prefs: normalizePrefs(prefsRow),
        saved: Boolean(prefsRow),
        push_ready: Boolean(webpush),
        devices: (devices as unknown as Record<string, unknown>[]).map((d) => ({
          id: Number(d.id),
          label: deviceLabel(String(d.user_agent ?? '')),
          service: endpointHost(String(d.endpoint ?? '')),
          created_at: d.created_at,
          last_seen_at: d.last_seen_at,
        })),
        unread: Number(unread?.n ?? 0),
        limits: { max_devices: LIMITS.maxDevices, email_cooldown_min: LIMITS.emailCooldownMin },
      });
    }

    if (action === 'vapid_key') {
      const v = await vipid();
      return json(req, 200, { ok: true, public_key: v.publicKey, push_ready: Boolean(webpush) });
    }

    if (action === 'save_prefs') {
      const raw = b.prefs && typeof b.prefs === 'object' ? b.prefs as Record<string, unknown> : {};
      const why = prefsProblem(raw);
      if (why) throw new HttpError(400, why);
      const cur = normalizePrefs((await db`select push_enabled, email_enabled, notify_chat, notify_admin from public.notification_prefs where user_id = ${u.id}`)[0]);
      const next = normalizePrefs({ ...cur, ...raw });
      await db`insert into public.notification_prefs (user_id, push_enabled, email_enabled, notify_chat, notify_admin, updated_at)
        values (${u.id}, ${next.push_enabled}, ${next.email_enabled}, ${next.notify_chat}, ${next.notify_admin}, now())
        on conflict (user_id) do update set push_enabled = excluded.push_enabled, email_enabled = excluded.email_enabled,
          notify_chat = excluded.notify_chat, notify_admin = excluded.notify_admin, updated_at = now()`;
      await tally(ip, u.id, 'prefs');
      return json(req, 200, { ok: true, prefs: next });
    }

    // ---------- 시험 발송 ----------
    if (action === 'test') {
      if (!webpush) throw new HttpError(503, '푸시 발송 라이브러리가 준비되지 않았습니다. 관리자에게 알려 주세요.');
      if (await usedIn(u.id, 'test', 3600) >= LIMITS.testPerHour) throw new HttpError(429, `시험 알림은 한 시간에 ${LIMITS.testPerHour}번까지 보낼 수 있습니다.`);
      const subs = await subsOf(u.id);
      if (!subs.length) {
        await tally(ip, u.id, 'test', '', false);
        return json(req, 200, { ok: false, devices: 0, hint: '이 브라우저가 아직 구독되어 있지 않습니다. 알림을 먼저 켜 주세요.' });
      }
      const out = await sendPush(subs, { title: '🔔 BMR APPS 알림 시험', body: '이 알림이 보이면 알림이 제대로 켜진 것입니다.', url: '/hub/account', tag: 'test' });
      await tally(ip, u.id, 'test', '', out.sent > 0);
      return json(req, 200, { ok: out.sent > 0, ...out, hint: out.sent > 0 ? '알림을 보냈습니다.' : '보내지 못했습니다. 브라우저 알림 권한과 홈 화면 추가 상태를 확인해 주세요.' });
    }

    // ---------- 쪽지 알림 (방금 내가 보낸 쪽지 → 상대) ----------
    if (action === 'chat') {
      const threadId = Number(b.thread_id);
      if (!Number.isInteger(threadId) || threadId <= 0) throw new HttpError(400, '대화 번호가 올바르지 않습니다.');
      if (await usedIn(u.id, 'chat', 3600) >= LIMITS.pushPerUserHour) throw new HttpError(429, '알림 요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.');
      await tally(ip, u.id, 'chat', String(threadId));   // 건너뛴 요청도 센다 (한도를 피해 반복하지 못하게)

      const [t] = await db`select id, user_lo, user_hi from public.chat_threads where id = ${threadId}`;
      if (!t) throw new HttpError(404, '대화를 찾지 못했습니다.');
      const lo = String(t.user_lo), hi = String(t.user_hi);
      if (u.id !== lo && u.id !== hi) throw new HttpError(403, '이 대화의 참여자가 아닙니다.');
      const peerId = u.id === lo ? hi : lo;

      // 알림 내용은 DB 의 마지막 쪽지로 만든다 — 그리고 그 쪽지가 내가 보낸 것이어야 한다
      const [m] = await db`select id, sender, body from public.chat_messages where thread_id = ${threadId} order by id desc limit 1`;
      if (!m || String(m.sender) !== u.id) return json(req, 200, { ok: true, skipped: 'not_my_message' });

      const [peer] = await db`select p.id, p.email, p.role, coalesce(nullif(btrim(p.name), ''), split_part(p.email, '@', 1)) as label
        from public.profiles p where p.id = ${peerId}`;
      if (!peer || String(peer.role) === 'disabled') return json(req, 200, { ok: true, skipped: 'peer_unavailable' });

      const [prefsRow] = await db`select push_enabled, email_enabled, notify_chat, notify_admin from public.notification_prefs where user_id = ${peerId}`;
      const prefs = normalizePrefs(prefsRow);
      if (!prefs.notify_chat) return json(req, 200, { ok: true, skipped: 'peer_off' });

      // 이미 상대가 읽은 쪽지면 알리지 않는다 (화면에 떠 있는데 울리지 않게)
      const [rd] = await db`select last_read_id from public.chat_reads where thread_id = ${threadId} and user_id = ${peerId}`;
      if (rd && Number(rd.last_read_id) >= Number(m.id)) return json(req, 200, { ok: true, skipped: 'already_read' });

      const sender = u.name || u.email.split('@')[0] || '회원';
      const payload = chatPayload({ sender, body: String(m.body ?? ''), thread: threadId });

      let push: PushOut = { ready: Boolean(webpush), devices: 0, sent: 0, failed: 0, removed: 0 };
      if (canPush(prefs, 'chat')) push = await sendPush(await subsOf(peerId), payload);

      // 메일은 푸시가 한 대도 닿지 않았을 때만 (같은 대화 10분에 한 통)
      let email = 'off';
      const emailTo = String(peer.email ?? '');
      if (!canEmail(prefs, 'chat')) email = 'off';
      else if (push.sent > 0) email = 'skipped:push_sent';
      else if (!emailTo) email = 'skipped:no_email';
      else if (await usedIn(peerId, 'chat:email', 3600) >= LIMITS.emailPerRecipientHour) email = 'skipped:hour_limit';
      else if (await usedIn(null, 'chat:email', 86_400) >= LIMITS.emailPerDay) email = 'skipped:day_limit';
      else if (!emailAllowed(await lastMailAt(peerId, String(threadId)), new Date())) email = 'skipped:cooldown';
      else {
        try {
          email = await sendMail(emailTo, mailSubject({ sender }), mailBody({ sender, preview: String(m.body ?? '') }));
        } catch (e) {
          email = 'error';
          console.error('hub-notify mail', String((e as Error)?.message ?? e).slice(0, 200));
        }
        await tally(ip, peerId, 'chat:email', String(threadId), email === 'sent');
      }

      return json(req, 200, { ok: true, push, email, thread: threadId });
    }

    // ---------- 결정된 신청 알림 (관리자 → 신청자) ----------
    if (action === 'event') {
      if (u.role !== 'admin') throw new HttpError(403, '관리자만 신청 결과를 알릴 수 있습니다.');
      const kind = String(b.kind ?? '');
      const id = Number(b.id);
      if (!['app_request', 'dev_request'].includes(kind) || !Number.isInteger(id) || id <= 0) throw new HttpError(400, '알릴 신청을 골라 주세요.');
      if (await usedIn(u.id, 'event', 3600) >= LIMITS.eventPerHour) throw new HttpError(429, '알림 요청이 너무 많습니다.');

      // 제목·받는 사람은 화면이 보낸 글이 아니라 DB 에서 만든다
      let who = '', whoEmail = '', title = '', body = '';
      if (kind === 'app_request') {
        const [r] = await db`select q.requested_by, q.app_name, q.status, q.review_note, p.email
          from public.app_requests q left join public.profiles p on p.id = q.requested_by where q.id = ${id}`;
        if (!r) throw new HttpError(404, '신청을 찾지 못했습니다.');
        if (String(r.status) === 'pending') return json(req, 200, { ok: true, skipped: 'not_decided' });
        who = String(r.requested_by ?? '');
        whoEmail = String(r.email ?? '');
        title = String(r.status) === 'approved' ? '앱 신청이 승인되었습니다' : '앱 신청이 반려되었습니다';
        body = `${String(r.app_name ?? '')}${String(r.review_note ?? '').trim() ? ` · ${String(r.review_note).trim()}` : ''}`;
      } else {
        const [r] = await db`select d.requested_by, d.status, d.decision_note, a.name, p.email from public.dev_requests d
          join public.apps a on a.id = d.app_id left join public.profiles p on p.id = d.requested_by where d.id = ${id}`;
        if (!r) throw new HttpError(404, '요청을 찾지 못했습니다.');
        if (String(r.status) === 'pending') return json(req, 200, { ok: true, skipped: 'not_decided' });
        who = String(r.requested_by ?? '');
        whoEmail = String(r.email ?? '');
        title = String(r.status) === 'approved' ? '개발자 요청이 승인되었습니다' : '개발자 요청이 반려되었습니다';
        body = `${String(r.name ?? '앱')}${String(r.decision_note ?? '').trim() ? ` · ${String(r.decision_note).trim()}` : ''}`;
      }
      if (!who) return json(req, 200, { ok: true, skipped: 'no_requester' });
      if (who === u.id) return json(req, 200, { ok: true, skipped: 'self' });

      const [prefsRow] = await db`select push_enabled, email_enabled, notify_chat, notify_admin from public.notification_prefs where user_id = ${who}`;
      const prefs = normalizePrefs(prefsRow);
      if (!canPush(prefs, 'admin') && !canEmail(prefs, 'admin')) return json(req, 200, { ok: true, skipped: 'off' });

      const push = canPush(prefs, 'admin')
        ? await sendPush(await subsOf(who), eventPayload({ kind: kind as 'app_request' | 'dev_request', title, body }))
        : { ready: Boolean(webpush), devices: 0, sent: 0, failed: 0, removed: 0 };

      // 신청 결과도 푸시가 닿지 않았을 때만 메일로 (같은 신청 10분에 한 통)
      let email = 'off';
      const ref = `${kind}:${id}`;
      if (!canEmail(prefs, 'admin')) email = 'off';
      else if (push.sent > 0) email = 'skipped:push_sent';
      else if (!whoEmail) email = 'skipped:no_email';
      else if (await usedIn(who, 'event:email', 3600) >= LIMITS.emailPerRecipientHour) email = 'skipped:hour_limit';
      else if (!emailAllowed(await lastMailAt(who, ref, 'event:email'), new Date())) email = 'skipped:cooldown';
      else {
        try { email = await sendMail(whoEmail, `[BMR APPS] ${title}`, `${title}\n\n${body}\n\n자세히 보기: ${HUB}/hub/requests\n\n알림 끄기: ${HUB}/hub/account`); }
        catch (e) { email = 'error'; console.error('hub-notify event mail', String((e as Error)?.message ?? e).slice(0, 200)); }
        await tally(ip, who, 'event:email', ref, email === 'sent');
      }

      await tally(ip, u.id, 'event', ref, push.sent > 0 || email === 'sent');
      return json(req, 200, { ok: true, push, email });
    }

    throw new HttpError(400, '알 수 없는 요청입니다.');
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    const code = (e as { code?: string })?.code;
    if (code === '42P01' || /does not exist/i.test(String((e as Error)?.message ?? ''))) {
      console.error('hub-notify', code, String((e as Error)?.message ?? '').slice(0, 200));
      return json(req, 503, { error: '알림 표가 아직 준비되지 않았습니다(마이그레이션). 관리자에게 알려 주세요.' });
    }
    console.error('hub-notify', code ?? '', String((e as Error)?.message ?? '').slice(0, 200));
    return json(req, 500, { error: '서버 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
});
