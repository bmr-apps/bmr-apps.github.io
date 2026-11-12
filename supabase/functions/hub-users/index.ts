// hub-users — 관리자가 허브 사용자를 보고, 역할을 바꾸고, 비밀번호를 초기화하고, 삭제한다.
// 호출: POST { action, user_id?, role?, password?, confirm_email? }  Authorization: Bearer <관리자 로그인 토큰>
//   list             사용자 목록 (메일·이름·역할·가입·최근 로그인·담당 앱)
//   set_role         역할 변경. disabled 는 Auth 로그인 차단, 그 외는 차단 해제
//   reset_password   임시 비밀번호를 만들어(또는 관리자가 지정) 한 번만 돌려 주고 저장하지 않음
//   delete           계정 삭제. 본인·마지막 관리자 불가. 확인용으로 대상 이메일 필요
// 비밀값(비밀번호)은 기록·로그에 남기지 않는다.
import postgres from 'npm:postgres@3.4.5';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const ROLES = new Set(['pending', 'staff', 'admin', 'disabled']);
const ROLE_LABEL: Record<string, string> = { pending: '일반 사용자', staff: '개발자', admin: '관리자', disabled: '사용 중지' };
const LIMIT = { perUserHour: 40, perIpHour: 80, resetPerHour: 15, deletePerHour: 8 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : HUB, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache' } });

type Me = { id: string; email: string; name: string };
type Target = { id: string; email: string; name: string; role: string };

async function me(req: Request): Promise<Me> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '');
  const tok = m?.[1] ?? '';
  if (!tok || tok.split('.').length !== 3) throw new HttpError(401, '로그인이 필요합니다.');
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new HttpError(401, '로그인이 필요합니다.');
  const u = await r.json();
  const [p] = await db`select role, name, email from public.profiles where id = ${u.id}`;
  if (p?.role === 'disabled') throw new HttpError(403, '사용이 중지된 계정입니다. 관리자에게 문의하세요.');
  if (p?.role !== 'admin') throw new HttpError(403, '관리자만 사용자 관리를 할 수 있습니다.');
  return { id: u.id, email: String(p.email || u.email || '').toLowerCase(), name: p?.name || u.email };
}

async function rateLimit(req: Request, u: Me | null, action: string) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const [c] = await db`select
      count(*) filter (where user_id = ${u?.id ?? null}::uuid) as by_user,
      count(*) filter (where ip = ${ip}) as by_ip,
      count(*) filter (where user_id = ${u?.id ?? null}::uuid and action = 'reset_password') as resets,
      count(*) filter (where user_id = ${u?.id ?? null}::uuid and action = 'delete') as deletes
    from bmr_admin.users_attempts where at > now() - interval '1 hour'`;
  if (Number(c.by_user) >= LIMIT.perUserHour || Number(c.by_ip) >= LIMIT.perIpHour) throw new HttpError(429, '요청이 너무 많습니다. 한 시간 뒤 다시 시도하세요.');
  if (action === 'reset_password' && Number(c.resets) >= LIMIT.resetPerHour) throw new HttpError(429, '오늘은 비밀번호 초기화를 너무 많이 했습니다. 잠시 뒤 다시 시도하세요.');
  if (action === 'delete' && Number(c.deletes) >= LIMIT.deletePerHour) throw new HttpError(429, '삭제를 너무 많이 했습니다. 잠시 뒤 다시 시도하세요.');
  await db`insert into bmr_admin.users_attempts (user_id, ip, action) values (${u?.id ?? null}, ${ip}, ${action})`;
  await db`delete from bmr_admin.users_attempts where at < now() - interval '1 day'`;
}

async function target(id: string): Promise<Target> {
  if (!UUID.test(id)) throw new HttpError(400, '사용자를 확인해 주세요.');
  const [p] = await db`select id, email, name, role from public.profiles where id = ${id}`;
  if (!p) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  return p as Target;
}

async function ownedApps(email: string) {
  return await db`select a.id, a.slug, a.name from public.app_owners o join public.apps a on a.id = o.app_id
    where o.email is not null and lower(o.email) = lower(${email}) order by a.name`;
}

async function adminCount() {
  const [c] = await db`select count(*)::int as n from public.profiles where role = 'admin'`;
  return Number(c.n);
}

async function log(u: Me, t: Target, label: string, memo: string) {
  await db`insert into public.token_logs (app_id, kind, label, issued_to, memo, created_by)
    values (null, 'hub_user', ${label.slice(0, 100)}, ${t.email.slice(0, 100)}, ${memo.slice(0, 1000)}, ${u.id})`;
}

const AUTH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function authAdmin(path: string, init: RequestInit = {}) {
  return fetch(`${SB_URL}/auth/v1/admin/${path}`, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
}
async function signOut(id: string) {
  const r = await authAdmin(`users/${id}/logout?scope=global`, { method: 'POST' });
  await r.body?.cancel();
}
async function ban(id: string, on: boolean) {
  const r = await authAdmin(`users/${id}`, { method: 'PUT', body: JSON.stringify({ ban_duration: on ? '876000h' : 'none' }) });
  if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, '로그인 차단 설정을 바꾸지 못했습니다.'); }
  await r.body?.cancel();
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
function newPassword() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  return [...b].map((x) => ALPHA[x % ALPHA.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 만 됩니다.' });
  try {
    const b = await req.json().catch(() => ({})) as { action?: string; user_id?: string; role?: string; password?: string; confirm_email?: string };
    const action = String(b.action ?? '');
    const u = await me(req).catch(async (e) => { await rateLimit(req, null, action || '?'); throw e; });
    await rateLimit(req, u, action || '?');

    if (action === 'list') {
      const rows = await db`
        select p.id, p.email, p.name, p.role, p.created_at, u.last_sign_in_at,
               (u.banned_until is not null and u.banned_until > now()) as banned
        from public.profiles p join auth.users u on u.id = p.id
        order by p.created_at desc`;
      const owners = await db`select lower(o.email) as email, a.id, a.slug, a.name
        from public.app_owners o join public.apps a on a.id = o.app_id where o.email is not null`;
      const byEmail = new Map<string, { id: number; slug: string; name: string }[]>();
      for (const x of owners) {
        const k = String(x.email);
        if (!byEmail.has(k)) byEmail.set(k, []);
        byEmail.get(k)!.push({ id: x.id, slug: x.slug, name: x.name });
      }
      const users = rows.map((r) => ({
        id: r.id, email: r.email, name: r.name, role: r.role, created_at: r.created_at,
        last_sign_in_at: r.last_sign_in_at, banned: !!r.banned,
        owned_apps: byEmail.get(String(r.email).toLowerCase()) ?? [],
      }));
      return json(req, 200, { users, me: { id: u.id, email: u.email } });
    }

    if (action === 'set_role') {
      const role = String(b.role ?? '');
      if (!ROLES.has(role)) throw new HttpError(400, '역할을 확인해 주세요.');
      const t = await target(String(b.user_id ?? ''));
      if (t.id === u.id) throw new HttpError(400, '자기 자신의 역할은 바꿀 수 없습니다.');
      if (t.role === 'admin' && role !== 'admin' && await adminCount() <= 1) throw new HttpError(409, '마지막 관리자의 역할은 바꿀 수 없습니다.');
      if (t.role === role) return json(req, 200, { ok: true, role, unchanged: true });
      await db`update public.profiles set role = ${role} where id = ${t.id}`;
      try {
        if (role === 'disabled') { await ban(t.id, true); await signOut(t.id); }
        else if (t.role === 'disabled') { await ban(t.id, false); }
      } catch (e) {
        await db`update public.profiles set role = ${t.role} where id = ${t.id}`; // 로그인 차단 실패 시 역할도 되돌림
        throw e;
      }
      const label = role === 'disabled' ? '사용 중지' : t.role === 'disabled' ? '다시 사용' : '역할 변경';
      const memo = role === 'disabled' ? '사용 중지 · 로그인 차단' : t.role === 'disabled' ? `다시 사용 · ${ROLE_LABEL[role]} · 로그인 차단 해제` : `역할을 ${ROLE_LABEL[role]}(으)로 변경`;
      await log(u, t, label, memo);
      return json(req, 200, { ok: true, role });
    }

    if (action === 'reset_password') {
      const t = await target(String(b.user_id ?? ''));
      if (t.id === u.id) throw new HttpError(400, '내 비밀번호는 내 계정 화면에서 바꾸세요.');
      const given = typeof b.password === 'string' ? b.password : '';
      let pw: string;
      let custom = false;
      if (given) {
        if (given.length < 8 || given.length > 72) throw new HttpError(400, '비밀번호는 8자 이상 72자 이하로 해 주세요.');
        pw = given; custom = true;
      } else pw = newPassword();
      const r = await authAdmin(`users/${t.id}`, { method: 'PUT', body: JSON.stringify({ password: pw }) });
      if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, '비밀번호를 바꾸지 못했습니다.'); }
      await r.body?.cancel();
      await signOut(t.id);
      await log(u, t, '비밀번호 초기화', custom ? '관리자가 지정한 비밀번호로 변경 (1회 표시, 저장 안 함)' : '임시 비밀번호 발급 (1회 표시, 저장 안 함)');
      return json(req, 200, { password: pw, once: true, email: t.email });
    }

    if (action === 'delete') {
      const t = await target(String(b.user_id ?? ''));
      if (t.id === u.id) throw new HttpError(400, '자기 자신은 삭제할 수 없습니다.');
      const confirm = String(b.confirm_email ?? '').trim().toLowerCase();
      if (!confirm || confirm !== t.email.toLowerCase()) throw new HttpError(400, '확인을 위해 대상의 이메일을 그대로 입력해 주세요.');
      if (t.role === 'admin' && await adminCount() <= 1) throw new HttpError(409, '마지막 관리자는 삭제할 수 없습니다.');
      const apps = await ownedApps(t.email);
      const r = await authAdmin(`users/${t.id}`, { method: 'DELETE' });
      if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, '계정을 삭제하지 못했습니다.'); }
      await r.body?.cancel();
      await log(u, t, '계정 삭제', apps.length ? `계정 삭제 · 담당 앱(${apps.map((a) => a.name).join(', ')})과 신청 기록은 남김` : '계정 삭제 · 신청 기록은 남김');
      return json(req, 200, { ok: true, deleted: t.email, owned_apps: apps });
    }

    return json(req, 400, { error: '알 수 없는 요청입니다.' });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error('hub-users', (e as { code?: string })?.code ?? '', String((e as Error)?.message ?? e).slice(0, 200));
    return json(req, 500, { error: '서버 오류가 났습니다.' });
  }
});
