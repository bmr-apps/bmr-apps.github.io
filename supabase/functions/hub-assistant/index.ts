// hub-assistant — BMR APPS 도우미(챗봇). apps.bmrschool.net 어디서나 "이거 어떻게 써요?"에 답한다.
//
// 호출: POST { messages: [{ role: 'user' | 'assistant', content }] }
//   Authorization 없음            → 손님 (공개 안내만: 운영 중인 앱·가입·사용법)
//   Authorization: Bearer <JWT>   → 허브 로그인 사람. profiles.role 로 일반 사용자·개발자·관리자를 가른다
//   GET /health → 살아 있는지 (프롬프트·모델과 무관하게 함수가 떴는지만)
//
// 이 함수가 지키는 경계 — 프롬프트에 무엇을 넣는지가 곧 권한 경계다:
//   손님·일반 사용자: apps 중 status='active' 만, 회원별 정보 없음
//   개발자: + 준비 중 앱 + 자기 담당 앱(app_owners 에 내 메일) + 개발 가이드
//   관리자: + 운영 집계(개수만). 사람별 메일·토큰·로그는 넣지 않는다
// 실제 AI 호출은 hub-ai 가 한다 (업체 키는 허브만 갖는다). 이 함수는 열쇠·업체 키를 다루지 않는다.
// 대신 bmr_admin.assistant_grants 에 일회용 표를 한 줄 넣고 그 값을 헤더로 보내, hub-ai 가 '허브 내부 도우미'임을 알아본다.
// 남기는 것: bmr_admin.assistant_attempts(횟수 제한용 — 누가·언제·역할만). 질문·답 본문은 남기지 않는다.
// 남기지 않는 것: 프롬프트·응답 본문 (hub-ai 도 본문을 남기지 않는다).
import postgres from 'npm:postgres@3.4.5';
import {
  ASK, GRANT_HEADER, RATE, ROLE_LABEL, buildSystemPrompt, canSeeInternalApps, checkAsk, hourLimitOf, newNonce, roleOf,
  type AppBrief, type AssistantContext, type Role, type Stats,
} from './rules.ts';

const REF = 'psupfmarnyxontorftio';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const LIMIT = { maxBody: 40_000, aiTimeoutMs: 90_000, appLines: 60 } as const;
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-assistant: 다른 프로젝트에서는 실행하지 않습니다');

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
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

type Me = { id: string; email: string; role: string };

/** 허브 로그인 토큰 → 이 사람의 프로필(역할). 토큰이 틀리면 null */
async function userByJwt(tok: string): Promise<Me | null> {
  if (!tok || tok.split('.').length !== 3) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const u = await r.json();
  if (!u?.id) return null;
  const [p] = await db`select role, email from public.profiles where id = ${u.id}`;
  return { id: String(u.id), email: String(p?.email || u.email || '').toLowerCase(), role: String(p?.role ?? '') };
}

/** 한 시간·하루 횟수 (사람·IP·전체). 넘으면 거절하고, 아니면 이번 요청을 한 줄 남긴다 */
async function rateLimit(ip: string, me: Me | null, role: Role) {
  const who = me?.id ?? ip;
  const [c] = await db`select
      count(*) filter (where at > now() - interval '1 hour' and kind = 'user' and who = ${who}) as user_hour,
      count(*) filter (where at > now() - interval '1 hour' and ip = ${ip}) as ip_hour,
      count(*) filter (where at > now() - interval '24 hours') as day_all
    from bmr_admin.assistant_attempts where at > now() - interval '24 hours'`;
  const hour = hourLimitOf(role);
  if (Number(c?.day_all ?? 0) >= RATE.dayAll) throw new HttpError(429, '오늘 도우미 사용(학교 전체)이 한도에 닿았습니다. 내일 다시 시도해 주세요. 필요한 내용은 /guide 에 정리되어 있습니다.');
  if (Number(c?.ip_hour ?? 0) >= RATE.ipHour) throw new HttpError(429, '이 네트워크에서 잠시 사이에 너무 많이 물어봤습니다. 10분쯤 뒤 다시 시도해 주세요.');
  if (me && Number(c?.user_hour ?? 0) >= hour) throw new HttpError(429, `한 시간에 ${hour}번까지 물어볼 수 있습니다. 잠시 뒤 다시 시도해 주세요.`);
  if (!me && Number(c?.ip_hour ?? 0) >= RATE.guestHour) throw new HttpError(429, `로그인하지 않고는 한 시간에 ${RATE.guestHour}번까지 물어볼 수 있습니다. 로그인하면 더 쓸 수 있어요.`);
  await db`insert into bmr_admin.assistant_attempts (kind, who, ip, role)
    values (${me ? 'user' : 'ip'}, ${String(who).slice(0, 200)}, ${ip.slice(0, 60)}, ${role})`;
  if (Math.random() < 0.05) await db`delete from bmr_admin.assistant_attempts where at < now() - interval '30 days'`;
  if (Math.random() < 0.05) await db`delete from bmr_admin.assistant_grants where created_at < now() - interval '1 day'`;
}

const brief = (r: Record<string, unknown>): AppBrief => ({
  slug: String(r.slug ?? ''), name: String(r.name ?? ''), status: String(r.status ?? ''),
  url: String(r.url ?? ''), description: String(r.description ?? ''),
});

/** 이 역할이 프롬프트에 넣어도 되는 자료만 모은다 (넣지 않는 것이 곧 권한 경계) */
async function contextOf(role: Role, me: Me | null): Promise<AssistantContext> {
  const internal = canSeeInternalApps(role);
  const apps = (role === 'guest' || role === 'user')
    ? (await db`select slug, name, description, url, status from public.apps
        where status = 'active' order by sort, name limit ${LIMIT.appLines}`)
    : (await db`select slug, name, description, url, status from public.apps
        where status in ('active', 'preparing', 'paused') order by sort, name limit ${LIMIT.appLines}`);

  const myApps: Record<string, unknown>[] = internal && me?.email ? await (async () => {
    try {
      return await db`select a.slug, a.name, a.description, a.url, a.status
        from public.app_owners o join public.apps a on a.id = o.app_id
        where lower(o.email) = ${me.email} and a.status <> 'retired'
        order by a.name limit 30`;
    } catch { return []; }   // 담당자 명부를 못 읽어도(마이그레이션 전) 공개 안내는 계속한다
  })() : [];

  let groups: string[] = [];
  if (me?.email && role !== 'guest') {
    try {
      const rows = await db`select g.name from bmr_admin.group_members m join bmr_admin.groups g on g.id = m.group_id
        where m.user_email = ${me.email} order by g.kind, g.name limit 20`;
      groups = rows.map((r) => String(r.name));
    } catch { groups = []; }   // 그룹 표가 아직 없어도(마이그레이션 전) 도우미는 답한다
  }

  const stats: Stats = role === 'admin' ? await adminStats() : {};
  return { role, apps: apps.map(brief), myApps: myApps.map(brief), groups, stats };
}

/** 관리자에게만 보여 줄 집계 — 개수만 (사람별 정보·토큰·로그 없음) */
async function count(p: () => PromiseLike<Record<string, unknown>[]>): Promise<number> {
  try { const r = await p(); return Number(r[0]?.n ?? 0) || 0; } catch { return 0; }
}

async function adminStats(): Promise<Stats> {
  const [appsActive, appsPreparing, appsPaused, healthDown, requestsPending, devPending, mAdmin, mStaff, mUser, mDisabled, aiCalls, aiTokens, mailSent, chats] = await Promise.all([
    count(() => db`select count(*)::int as n from public.apps where status = 'active'`),
    count(() => db`select count(*)::int as n from public.apps where status = 'preparing'`),
    count(() => db`select count(*)::int as n from public.apps where status = 'paused'`),
    count(() => db`select count(*)::int as n from public.app_health_latest where state = 'down'`),
    count(() => db`select count(*)::int as n from public.app_requests where status = 'pending'`),
    count(() => db`select count(*)::int as n from public.dev_requests where status = 'pending'`),
    count(() => db`select count(*)::int as n from public.profiles where role = 'admin'`),
    count(() => db`select count(*)::int as n from public.profiles where role = 'staff'`),
    count(() => db`select count(*)::int as n from public.profiles where role = 'pending'`),
    count(() => db`select count(*)::int as n from public.profiles where role = 'disabled'`),
    count(() => db`select count(*)::int as n from bmr_admin.ai_log where status = 'ok' and at > now() - interval '24 hours'`),
    count(() => db`select coalesce(sum(total_tokens), 0)::int as n from bmr_admin.ai_log where status = 'ok' and at > now() - interval '24 hours'`),
    count(() => db`select count(*)::int as n from bmr_admin.mail_log where status = 'sent' and at > now() - interval '24 hours'`),
    count(() => db`select count(*)::int as n from public.chat_messages where created_at > now() - interval '24 hours'`),
  ]);
  return {
    apps_active: appsActive, apps_preparing: appsPreparing, apps_paused: appsPaused, health_down: healthDown,
    requests_pending: requestsPending, dev_requests_pending: devPending,
    members_admin: mAdmin, members_staff: mStaff, members_user: mUser, members_disabled: mDisabled,
    ai_calls_24h: aiCalls, ai_tokens_24h: aiTokens, mail_sent_24h: mailSent, chat_messages_24h: chats,
  };
}

/** 실제 AI 호출은 hub-ai 가 한다 — 이 함수는 일회용 표(grant)만 붙인다 */
async function askHubAi(system: string, messages: { role: 'user' | 'assistant'; content: string }[]) {
  const grant = newNonce();
  try {
    await db`insert into bmr_admin.assistant_grants (nonce) values (${grant})`;
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01' || /assistant_grants/i.test(String((e as Error)?.message ?? ''))) {
      throw new HttpError(503, '도우미 표가 아직 준비되지 않았습니다(마이그레이션). 관리자에게 알려 주세요.');
    }
    throw e;
  }
  let r: Response;
  try {
    r = await fetch(`${SB_URL}/functions/v1/hub-ai`, {
      method: 'POST',
      headers: { apikey: ANON, [GRANT_HEADER]: grant, 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, messages, max_tokens: ASK.maxTokens, temperature: ASK.temperature }),
      signal: AbortSignal.timeout(LIMIT.aiTimeoutMs),
    });
  } catch {
    throw new HttpError(502, 'AI 응답이 너무 늦습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  const j = await r.json().catch(() => null) as Record<string, unknown> | null;
  if (!r.ok) {
    const msg = String(j?.error ?? '');
    if (r.status === 429) throw new HttpError(429, msg || 'AI 사용 한도에 닿았습니다. 잠시 뒤 다시 시도해 주세요.');
    if (r.status === 503) throw new HttpError(503, msg || 'AI 가 아직 준비되지 않았습니다. 관리자에게 알려 주세요.');
    throw new HttpError(502, msg || `AI 응답을 받지 못했습니다 (HTTP ${r.status}).`);
  }
  return j ?? {};
}

const route = (req: Request) => {
  const p = new URL(req.url).pathname;
  const i = p.indexOf('/hub-assistant');
  return (i < 0 ? '/' : p.slice(i + '/hub-assistant'.length)).replace(/\/+$/, '') || '/';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  const path = route(req);
  if (req.method === 'GET' && path === '/health') return json(req, 200, { ok: true, role_scoped: true, ai_hub: true, max_tokens: ASK.maxTokens });
  if (req.method !== 'POST' || (path !== '/' && path !== '/ask')) return json(req, 405, { error: 'POST 만 받습니다.' });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  let role: Role = 'guest';
  try {
    const t = await req.text();
    if (t.length > LIMIT.maxBody) throw new HttpError(413, '요청이 너무 큽니다.');
    let b: Record<string, unknown>;
    try { b = t ? JSON.parse(t) as Record<string, unknown> : {}; } catch { throw new HttpError(400, 'JSON 형식이 아닙니다.'); }

    const rawTok = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
    const me = rawTok ? await userByJwt(rawTok) : null;
    if (rawTok && !me) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (me?.role === 'disabled') throw new HttpError(403, '사용이 중지된 계정입니다. 관리자에게 문의하세요.');
    role = roleOf(me?.role);

    const read = checkAsk(b);
    if (!read.ok) throw new HttpError(read.status, read.message);

    try {
      await rateLimit(ip, me, role);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if ((e as { code?: string })?.code === '42P01' || /assistant_attempts/i.test(String((e as Error)?.message ?? ''))) {
        throw new HttpError(503, '도우미 표가 아직 준비되지 않았습니다(마이그레이션). 관리자에게 알려 주세요.');
      }
      throw e;
    }

    const ctx = await contextOf(role, me);
    const ans = await askHubAi(buildSystemPrompt(ctx), read.messages);
    return json(req, 200, {
      ok: true,
      role,
      role_label: ROLE_LABEL[role],
      text: String(ans.text ?? ''),
      provider: String(ans.provider ?? ''),
      model: String(ans.model ?? ''),
      usage: ans.usage ?? null,
    });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message, role });
    console.error('hub-assistant', role, String((e as Error)?.message ?? e).slice(0, 200));
    return json(req, 500, { error: '서버 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.', role });
  }
});
