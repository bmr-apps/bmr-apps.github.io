// hub-dbcred — 앱 담당 선생님께 DB 접속 정보를 허브 안에서 안전하게 전달한다.
//  · 처음 비밀번호: provision 때 서버에서 만들어 Vault(암호화)에 넣어 두고, 담당자가 '한 번' 받으면 즉시 지운다.
//  · 새 비밀번호: 서버에서 만들어 SCRAM 검증값으로만 DB 에 넣고, 화면에 한 번 보여 준 뒤 어디에도 남기지 않는다.
//  · 모든 받기·새로 발급은 public.token_logs 에 남긴다(누가·어느 앱·무엇·언제, 비밀값 없음).
//  · 서버 함수(<slug>-fn)는 따로 <schema>_fn 역할을 써서, 선생님이 비밀번호를 바꿔도 끊기지 않는다.
// 호출: POST { action, app_id? , owner_id? }  Authorization: Bearer <허브 로그인 토큰>
//   list            내가 담당(관리자는 전체)인 v2 앱 목록과 상태
//   reveal          처음 비밀번호 받기 (1회)
//   rotate          새 비밀번호 발급 (이전 비밀번호는 바로 못 씀)
//   invite          (관리자) 허브 계정이 없는 담당자에게 가입 초대 메일
//   stage           (관리 스크립트, service_role 키) 처음 비밀번호를 새로 만들어 Vault 에 넣기
import postgres from 'npm:postgres@3.4.5';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REF = new URL(SB_URL).hostname.split('.')[0];
const POOL_HOST = 'aws-1-ap-south-1.pooler.supabase.com';
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const LIMIT = { perUserHour: 20, perIpHour: 40, rotatePerAppDay: 10 };
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : HUB, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
function safeEqual(a: string, b: string) { if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// ---------- 비밀번호·SCRAM ----------
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
function newPassword() { return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function hmac(key: Uint8Array, msg: string) { const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))); }
async function scram(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), it = 4096;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salted = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, k, 256));
  const stored = new Uint8Array(await crypto.subtle.digest('SHA-256', await hmac(salted, 'Client Key')));
  const server = await hmac(salted, 'Server Key');
  return `SCRAM-SHA-256$${it}:${b64(salt)}$${b64(stored)}:${b64(server)}`;
}

type App = { id: number; slug: string; name: string; schema: string; role: string };
const vaultName = (slug: string) => `bmr_dbcred:${slug}`;
function connInfo(app: App, pw: string) {
  const user = `${app.role}.${REF}`;
  return {
    host: POOL_HOST, port: 5432, port_transaction: 6543, database: 'postgres', user, user_direct: app.role, schema: app.schema, password: pw,
    direct_host: `db.${REF}.supabase.co`,
    database_url: `postgresql://${user}:${pw}@${POOL_HOST}:5432/postgres`,
  };
}

// ---------- 누가 부르나 ----------
type Me = { id: string; email: string; name: string; admin: boolean; staff: boolean };
async function me(req: Request): Promise<Me> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '');
  const tok = m?.[1] ?? '';
  if (!tok || tok.split('.').length !== 3) throw new HttpError(401, '로그인이 필요합니다.');
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new HttpError(401, '로그인이 필요합니다.');
  const u = await r.json();
  const [p] = await db`select role, name from public.profiles where id = ${u.id}`;
  const role = p?.role ?? '';
  if (role === 'disabled') throw new HttpError(403, '사용이 중지된 계정입니다. 관리자에게 문의하세요.');
  return { id: u.id, email: String(u.email ?? '').toLowerCase(), name: p?.name || u.email, admin: role === 'admin', staff: role === 'staff' || role === 'admin' };
}
/** v2 앱 중 내가 담당(허브 메일이 담당자 메일과 같음)이거나 관리자. 호출 전에 staff/admin 이어야 한다. */
async function myApps(u: Me, appId?: number): Promise<App[]> {
  const rows = await db`
    select a.id, a.slug, a.name, replace(a.slug, '-', '_') as schema, replace(a.slug, '-', '_') || '_dev' as role
    from public.apps a
    join pg_namespace n on n.nspname = replace(a.slug, '-', '_') and obj_description(n.oid, 'pg_namespace') = 'bmr-app:' || a.slug || ':v2'
    where (${appId ?? null}::bigint is null or a.id = ${appId ?? null}::bigint)
      and (${u.admin} or exists (select 1 from public.app_owners o where o.app_id = a.id and lower(o.email) = ${u.email}))
    order by a.name`;
  return rows as unknown as App[];
}
async function rateLimit(req: Request, u: Me | null, action: string) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const [c] = await db`select
      count(*) filter (where user_id = ${u?.id ?? null}::uuid) as by_user,
      count(*) filter (where ip = ${ip}) as by_ip
    from bmr_admin.dbcred_attempts where at > now() - interval '1 hour'`;
  if (Number(c.by_user) >= LIMIT.perUserHour || Number(c.by_ip) >= LIMIT.perIpHour) throw new HttpError(429, '요청이 너무 많습니다. 한 시간 뒤 다시 시도하세요.');
  await db`insert into bmr_admin.dbcred_attempts (user_id, ip, action) values (${u?.id ?? null}, ${ip}, ${action})`;
  await db`delete from bmr_admin.dbcred_attempts where at < now() - interval '1 day'`;
}
async function log(u: Me, app: App, label: string, memo: string) {
  await db`insert into public.token_logs (app_id, kind, label, issued_to, memo, created_by)
    values (${app.id}, 'supabase_db_password', ${label}, ${(u.name || u.email).slice(0, 100)}, ${memo}, ${u.id})`;
}
async function stageInitial(app: App) {
  const pw = newPassword();
  const v = await scram(pw);
  await db.begin(async (t) => {
    await t.unsafe(`alter role ${app.role} password '${v}'`); // SCRAM 검증값만 (평문 아님)
    await t`delete from vault.secrets where name = ${vaultName(app.slug)}`;
    await t`select vault.create_secret(${pw}, ${vaultName(app.slug)}, ${'BMR APPS 처음 DB 비밀번호 (담당자가 한 번 받으면 지워짐)'})`;
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 만 됩니다.' });
  try {
    const b = await req.json().catch(() => ({})) as { action?: string; app_id?: number; owner_id?: number; slug?: string };
    const action = String(b.action ?? '');

    // 관리 스크립트(provision.mjs): service_role 키로만
    if (action === 'stage') {
      const tok = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
      // 서버용 키(service_role 또는 secret 키)인지: 같은 값이거나, Auth 관리자 API 가 받아 주는 키면
      let svc = safeEqual(tok, SERVICE);
      if (!svc && tok) { const t = await fetch(`${SB_URL}/auth/v1/admin/users?per_page=1`, { headers: { apikey: tok, Authorization: `Bearer ${tok}` } }); svc = t.ok; await t.body?.cancel(); }
      if (!svc) return json(req, 403, { error: '권한이 없습니다.' });
      const slug = String(b.slug ?? '');
      if (!/^[a-z][a-z0-9-]{1,38}$/.test(slug)) return json(req, 400, { error: 'slug 형식' });
      const [a] = await db`select a.id, a.slug, a.name, replace(a.slug,'-','_') as schema, replace(a.slug,'-','_') || '_dev' as role from public.apps a
        join pg_namespace n on n.nspname = replace(a.slug,'-','_') and obj_description(n.oid,'pg_namespace') = 'bmr-app:' || a.slug || ':v2' where a.slug = ${slug}`;
      if (!a) return json(req, 404, { error: 'v2 앱이 아닙니다.' });
      await stageInitial(a as unknown as App);
      return json(req, 200, { ok: true, staged: true });
    }

    const u = await me(req).catch(async (e) => { await rateLimit(req, null, action || '?'); throw e; });
    await rateLimit(req, u, action);

    if (action === 'list' || action === 'reveal' || action === 'rotate') {
      if (!u.staff) return json(req, 403, { error: '교사 승인 후 이용할 수 있어요. 관리자에게 요청하세요.' });
    }

    if (action === 'list') {
      const apps = await myApps(u);
      const out = [];
      for (const a of apps) {
        const [p] = await db`select exists (select 1 from vault.secrets where name = ${vaultName(a.slug)}) as pending`;
        const last = await db`select label, issued_to, created_at from public.token_logs where app_id = ${a.id} and kind = 'supabase_db_password' order by created_at desc limit 3`;
        const owners = u.admin ? await db`select o.id, o.name, o.email, exists (select 1 from auth.users x where lower(x.email) = lower(o.email)) as has_account,
            exists (select 1 from public.profiles p where lower(p.email) = lower(o.email) and p.role in ('staff','admin')) as staff
          from public.app_owners o where o.app_id = ${a.id} order by o.id` : [];
        out.push({ app_id: a.id, slug: a.slug, name: a.name, schema: a.schema, role: a.role, pending_initial: p.pending, recent: last, owners,
          conn: { ...connInfo(a, '<비밀번호>'), password: undefined } });
      }
      return json(req, 200, { apps: out, me: { email: u.email, admin: u.admin, staff: u.staff } });
    }

    if (action === 'reveal' || action === 'rotate') {
      const id = Number(b.app_id);
      if (!Number.isInteger(id)) return json(req, 400, { error: '앱을 골라 주세요.' });
      const [a] = await myApps(u, id);
      if (!a) return json(req, 403, { error: '이 앱의 담당자만 볼 수 있습니다. (허브 계정 메일이 담당자 메일과 같아야 합니다)' });
      if (action === 'reveal') {
        // 한 번만: 읽고 바로 지운다. 동시에 두 번 눌러도 지우기에 성공한 쪽만 받는다.
        const pw = await db.begin(async (t) => {
          const [s] = await t`select id, decrypted_secret from vault.decrypted_secrets where name = ${vaultName(a.slug)}`;
          if (!s) return null;
          const d = await t`delete from vault.secrets where id = ${s.id} returning id`;
          return d.length ? String(s.decrypted_secret) : null;
        });
        if (!pw) return json(req, 410, { error: '처음 비밀번호는 이미 받았습니다. 잊었으면 "새 비밀번호 발급"을 누르세요.' });
        await log(u, a, 'DB 비밀번호 처음 받기', `${a.role} · 허브에서 1회 표시 (서버 사본 삭제)`);
        return json(req, 200, { conn: connInfo(a, pw), once: true });
      }
      const [c] = await db`select count(*) as n from public.token_logs where app_id = ${a.id} and kind = 'supabase_db_password' and created_at > now() - interval '1 day'`;
      if (Number(c.n) >= LIMIT.rotatePerAppDay) return json(req, 429, { error: '오늘은 더 발급할 수 없습니다. 내일 다시 시도하세요.' });
      const pw = newPassword();
      const v = await scram(pw);
      await db.begin(async (t) => {
        await t.unsafe(`alter role ${a.role} password '${v}'`);
        await t`delete from vault.secrets where name = ${vaultName(a.slug)}`; // 받지 않은 처음 비밀번호도 무효
      });
      await log(u, a, 'DB 비밀번호 새로 발급', `${a.role} · 이전 비밀번호 무효, 허브에서 1회 표시 (저장 안 함)`);
      return json(req, 200, { conn: connInfo(a, pw), once: true });
    }

    if (action === 'invite') {
      if (!u.admin) return json(req, 403, { error: '관리자만 초대할 수 있습니다.' });
      const [o] = await db`select o.name, o.email from public.app_owners o where o.id = ${Number(b.owner_id) || 0}`;
      if (!o?.email) return json(req, 404, { error: '담당자 메일이 없습니다.' });
      const [x] = await db`select 1 from auth.users where lower(email) = lower(${o.email})`;
      if (x) return json(req, 409, { error: '이미 허브 계정이 있습니다.' });
      const r = await fetch(`${SB_URL}/auth/v1/invite`, {
        method: 'POST', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: o.email, data: { name: o.name, full_name: o.name }, redirect_to: `${HUB}/hub/db` }),
      });
      if (!r.ok) return json(req, 502, { error: `초대 메일을 보내지 못했습니다 (${r.status}). 잠시 뒤 다시 시도하거나 직접 가입을 안내하세요.` });
      return json(req, 200, { ok: true, invited: o.email });
    }
    return json(req, 400, { error: '알 수 없는 요청입니다.' });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error('hub-dbcred', (e as { code?: string })?.code ?? '', (e as Error)?.message);
    return json(req, 500, { error: '서버 오류가 났습니다.' });
  }
});
