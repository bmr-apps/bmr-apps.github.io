// hub-directory — 학교 그룹·명부를 한 곳에서: 앱은 소속을 물어보고, 사람은 내 소속을 보고, 관리자는 명부를 고친다.
// 왜: 메일(hub-mail)·AI(hub-ai)는 공용인데 '누가 교직원·고등부·10학년·정보동아리인가'는 앱마다 따로 만들고 있었다.
//
// 호출: POST { action, ... }   (GET /health 는 살아 있는지 확인용)
//   Authorization: Bearer <앱 토큰>      — 이 앱의 <PREFIX>MAIL_TOKEN 또는 <PREFIX>AI_TOKEN
//                                          (이미 모든 앱에 있는 토큰을 그대로 쓴다. 새 비밀값을 발급하지 않는다)
//   Authorization: Bearer <허브 로그인 토큰> — 사람이 부를 때 (내 소속 보기 · 관리자 명부 관리)
//
//   list_groups                     그룹 목록 + 구성원 수 (앱·사람). 앱은 이걸로 '고를 수 있는 그룹'을 그린다
//   check { user_email?, groups? }   그 사람이 어느 그룹인지. 앱=아무 메일, 사람=내 메일만
//                                    groups 는 slug 또는 이름(교직원·10학년…). 20개까지
//   members { group }               그룹 구성원 메일 목록 (앱 · 관리자). 이름은 두지 않는다 (최대 1,000명)
//   me                              내 소속 그룹 (사람)
//   group_save { id?, slug, name, kind, description }   (관리자) 그룹 만들기·고치기
//   group_delete { id }             (관리자) 그룹 지우기 (구성원 줄도 함께)
//   member_add { group_id, emails, role? }   (관리자) 메일 여러 개를 한 번에 추가 (role: 'leader'|'member')
//   member_remove { group_id, emails }       (관리자) 구성원 빼기
//
// 앱에서 쓰는 법 (앱 서버 함수 안에서):
//   const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/hub-directory`, {
//     method: 'POST',
//     headers: { Authorization: `Bearer ${Deno.env.get(PREFIX + 'MAIL_TOKEN')}`, 'Content-Type': 'application/json' },
//     body: JSON.stringify({ action: 'check', user_email: 'student@bmrschool.org', groups: ['교직원', '10학년'] }),
//   });
//   // → { ok: true, user_email, member_of: ['grade-10'], leader_of: [], asked: [{ group: '10학년', member: true, … }] }
// 시작 틀의 supabase/functions/<함수>/lib/hub.ts 에 checkHubGroups() 로 들어 있다.
//
// 남기는 것: 관리자 변경(그룹·구성원)과 앱의 명부 조회를 public.audit_log 에 남긴다 (메일 주소 값은 남기지 않고 '몇 명'만).
// 열쇠: 이 함수는 암호문 비밀값을 풀지 않는다 (관리 API 토큰·업체 키 없음). DB 는 함수 전용 계정으로 읽고 쓴다.
import postgres from 'npm:postgres@3.4.5';
import {
  GROUP_KIND_LABEL, GROUP_KINDS, GROUP_DESC_MAX, GROUP_NAME_MAX, MEMBER_LIST_MAX, MEMBERS_MAX_SET, FILES_BUCKET,
  checkAsked, groupDescProblem, groupFolderOf, groupKindProblem, groupNameProblem, groupSlugProblem,
  membershipsOf, normalizeEmail, normalizeEmails, normalizeGroupList, type GroupKind, type MembershipRow,
} from './rules.ts';

const REF = 'psupfmarnyxontorftio';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const LIMIT = { appHour: 600, userHour: 120, ipHour: 900 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-directory: 다른 프로젝트에서는 실행하지 않습니다');

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- 누가 부르나 ----------
type AppRow = { id: number; slug: string; name: string; status: string; token: 'mail' | 'ai' };
/** 앱 토큰(메일·AI)으로 이 앱 신분을 확인한다. 둘 다 해시만 남아 있다 */
async function appByToken(tok: string): Promise<AppRow | null> {
  if (!tok || tok.length < 20 || tok.length > 200 || tok.split('.').length === 3) return null;
  const hash = await sha256hex(tok);
  const [m] = await db`select a.id, a.slug, a.name, a.status from bmr_admin.mail_tokens t
    join public.apps a on a.id = t.app_id where t.token_hash = ${hash}`;
  if (m) return { id: Number(m.id), slug: String(m.slug), name: String(m.name), status: String(m.status), token: 'mail' };
  const [a] = await db`select a.id, a.slug, a.name, a.status from bmr_admin.ai_tokens t
    join public.apps a on a.id = t.app_id where t.token_hash = ${hash}`;
  if (a) return { id: Number(a.id), slug: String(a.slug), name: String(a.name), status: String(a.status), token: 'ai' };
  return null;
}
type Me = { id: string; email: string; role: string };
async function userByJwt(tok: string): Promise<Me | null> {
  if (!tok || tok.split('.').length !== 3) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const u = await r.json();
  if (!u?.id) return null;
  const [p] = await db`select role, email from public.profiles where id = ${u.id}`;
  return { id: u.id, email: normalizeEmail(p?.email || u.email) ?? '', role: String(p?.role ?? '') };
}

/** 한 시간 횟수 (앱·사람·IP). 넘으면 거절 */
async function rateLimit(ip: string, who: { kind: 'app' | 'user' | 'anon'; id: string | number | null }, action: string) {
  const key = String(who.id ?? '');
  const [c] = await db`select
      count(*) filter (where kind = 'app' and who = ${key}) as as_app,
      count(*) filter (where kind = 'user' and who = ${key}) as as_user,
      count(*) filter (where kind = 'ip' and who = ${ip}) as as_ip
    from bmr_admin.directory_attempts where at > now() - interval '1 hour'`;
  if (who.kind === 'app' && Number(c.as_app) >= LIMIT.appHour) throw new HttpError(429, `이 앱은 한 시간에 ${LIMIT.appHour}번까지 명부를 볼 수 있습니다. 잠시 뒤 다시 시도하세요.`);
  if (who.kind === 'user' && Number(c.as_user) >= LIMIT.userHour) throw new HttpError(429, `한 시간에 ${LIMIT.userHour}번까지 볼 수 있습니다. 잠시 뒤 다시 시도하세요.`);
  if (Number(c.as_ip) >= LIMIT.ipHour) throw new HttpError(429, '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.');
  await db`insert into bmr_admin.directory_attempts (kind, who, action)
    values (${who.kind}, ${key.slice(0, 200)}, ${action.slice(0, 30)})`;
  if (ip && ip !== 'unknown') await db`insert into bmr_admin.directory_attempts (kind, who, action) values ('ip', ${ip.slice(0, 200)}, ${action.slice(0, 30)})`;
  if (Math.random() < 0.05) await db`delete from bmr_admin.directory_attempts where at < now() - interval '2 days'`;
}

async function audit(actor: { id: string | null; email: string }, action: string, target: string, result: 'ok' | 'error' | 'denied', detail: string) {
  try {
    await db`insert into public.audit_log (actor, actor_email, action, target, result, detail)
      values (${actor.id}::uuid, ${actor.email.slice(0, 200)}, ${action.slice(0, 60)}, ${target.slice(0, 200)}, ${result}, ${detail.slice(0, 2000)})`;
  } catch (e) { console.error('audit', String((e as Error)?.message ?? e).slice(0, 200)); }
}

// ---------- 읽기 ----------
type GroupRow = { id: number; slug: string; name: string; kind: string; description: string; members: number };
async function listGroups(): Promise<GroupRow[]> {
  const rows = await db`select g.id, g.slug, g.name, g.kind, g.description,
      count(m.user_email)::int as members
    from bmr_admin.groups g
    left join bmr_admin.group_members m on m.group_id = g.id
    group by g.id
    order by g.kind, g.name`;
  return rows.map((r) => ({
    id: Number(r.id), slug: String(r.slug), name: String(r.name), kind: String(r.kind),
    description: String(r.description ?? ''), members: Number(r.members ?? 0),
  }));
}
async function membershipsOfEmail(email: string): Promise<MembershipRow[]> {
  const rows = await db`select g.slug, g.name, g.kind, m.role
    from bmr_admin.group_members m join bmr_admin.groups g on g.id = m.group_id
    where m.user_email = ${email}
    order by g.kind, g.name`;
  return rows.map((r) => ({ slug: String(r.slug), name: String(r.name), kind: String(r.kind), role: String(r.role) }));
}
/** group 은 slug 또는 이름 */
async function groupByIdOrRef(idOrRef: string): Promise<GroupRow | null> {
  const rows = await db`select g.id, g.slug, g.name, g.kind, g.description,
      (select count(*)::int from bmr_admin.group_members m where m.group_id = g.id) as members
    from bmr_admin.groups g
    where g.slug = ${idOrRef.toLowerCase()} or g.name = ${idOrRef}
    limit 1`;
  const r = rows[0];
  return r ? { id: Number(r.id), slug: String(r.slug), name: String(r.name), kind: String(r.kind), description: String(r.description ?? ''), members: Number(r.members ?? 0) } : null;
}
async function groupById(id: number): Promise<GroupRow | null> {
  const rows = await db`select g.id, g.slug, g.name, g.kind, g.description,
      (select count(*)::int from bmr_admin.group_members m where m.group_id = g.id) as members
    from bmr_admin.groups g where g.id = ${id}`;
  const r = rows[0];
  return r ? { id: Number(r.id), slug: String(r.slug), name: String(r.name), kind: String(r.kind), description: String(r.description ?? ''), members: Number(r.members ?? 0) } : null;
}
const groupJson = (g: GroupRow) => ({
  id: g.id, slug: g.slug, name: g.name, kind: g.kind, kind_label: GROUP_KIND_LABEL[g.kind as GroupKind] ?? '기타',
  description: g.description, members: g.members, file_folder: groupFolderOf(g.slug),
});

const route = (req: Request) => {
  const p = new URL(req.url).pathname;
  const i = p.indexOf('/hub-directory');
  return (i < 0 ? '/' : p.slice(i + '/hub-directory'.length)).replace(/\/+$/, '') || '/';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  const path = route(req);
  if (req.method === 'GET' && path === '/health') return json(req, 200, { ok: true, groups: true, files: FILES_BUCKET });

  if (req.method !== 'POST' || (path !== '/' && path !== '/lookup')) return json(req, 405, { error: 'POST 만 받습니다.' });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  let action = '';
  let actor = { id: null as string | null, email: '' };
  try {
    const t = await req.text();
    if (t.length > 16384) throw new HttpError(413, '요청이 너무 큽니다.');
    let b: Record<string, unknown>;
    try { b = t ? JSON.parse(t) as Record<string, unknown> : {}; } catch { throw new HttpError(400, 'JSON 형식이 아닙니다.'); }
    action = String(b.action ?? '').slice(0, 30);

    const rawTok = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
    if (!rawTok) throw new HttpError(401, '앱 토큰 또는 허브 로그인이 필요합니다.');

    // 앱 토큰이면 앱 신분, 아니면 사람
    const app = await appByToken(rawTok);
    const me = app ? null : await userByJwt(rawTok);
    if (!app && !me) throw new HttpError(401, '앱 토큰 또는 허브 로그인이 필요합니다.');
    if (me && me.role === 'disabled') throw new HttpError(403, '사용이 중지된 계정입니다. 관리자에게 문의하세요.');

    if (app) {
      if (app.status !== 'active') {
        await audit({ id: null, email: `${app.slug}-fn` }, 'directory:denied', app.slug, 'denied', '앱이 활성 상태가 아님');
        throw new HttpError(403, '지금은 명부를 볼 수 없는 앱입니다 (활성 상태인 앱만).');
      }
      await rateLimit(ip, { kind: 'app', id: app.id }, action);
      actor = { id: null, email: `${app.slug}-fn` };
    } else if (me) {
      if (!me.email) throw new HttpError(403, '계정 메일을 확인하지 못했습니다. 허브에 다시 로그인해 주세요.');
      await rateLimit(ip, { kind: 'user', id: me.id }, action);
      actor = { id: me.id, email: me.email };
    }

    // ---------- 앱·사람 공통 읽기 ----------
    if (action === 'list_groups') {
      const groups = await listGroups();
      return json(req, 200, {
        ok: true,
        groups: groups.map(groupJson),
        kinds: GROUP_KINDS.map((k) => ({ kind: k, label: GROUP_KIND_LABEL[k] })),
        file_bucket: FILES_BUCKET,
        note: 'file_folder 가 그룹 공용 파일 폴더입니다 (비공개 버킷 bmr-files). 로그인한 사람은 자기 그룹 폴더만 보고 올릴 수 있습니다.',
      });
    }

    if (action === 'me') {
      if (!me) throw new HttpError(403, '내 소속은 사람(허브 로그인)만 볼 수 있습니다.');
      const rows = await membershipsOfEmail(me.email);
      const m = membershipsOf(rows);
      return json(req, 200, { ok: true, user_email: me.email, ...m });
    }

    if (action === 'check') {
      const wanted = typeof b.user_email === 'string' ? b.user_email : '';
      // 사람은 자기 소속만 (남의 소속을 묻지 못한다). 앱은 아무 메일이나 묻는다
      const email = me ? me.email : normalizeEmail(wanted);
      if (!email) throw new HttpError(400, '확인할 사람의 메일(user_email)을 적어 주세요.');
      if (me && wanted && normalizeEmail(wanted) !== me.email && me.role !== 'admin') {
        throw new HttpError(403, '내 소속만 볼 수 있습니다.');
      }
      const rows = await membershipsOfEmail(email);
      const m = membershipsOf(rows);
      const asked = normalizeGroupList(b.groups);
      if (app) await audit(actor, 'directory:check', app.slug, 'ok', `소속 확인 · ${rows.length}개 그룹`);
      return json(req, 200, {
        ok: true, user_email: email,
        ...m,
        asked: asked.length ? checkAsked(asked, rows) : [],
      });
    }

    if (action === 'members') {
      const ref = String(b.group ?? b.slug ?? b.name ?? '').trim();
      if (!ref) throw new HttpError(400, '그룹(slug 또는 이름)을 적어 주세요.');
      if (me && me.role !== 'admin') throw new HttpError(403, '구성원 목록은 앱 또는 관리자만 볼 수 있습니다.');
      const g = await groupByIdOrRef(ref);
      if (!g) throw new HttpError(404, '그런 그룹이 없습니다.');
      const rows = await db`select user_email, role, added_at from bmr_admin.group_members
        where group_id = ${g.id} order by case when role = 'leader' then 0 else 1 end, user_email limit ${MEMBER_LIST_MAX}`;
      if (app) await audit(actor, 'directory:members', app.slug, 'ok', `${g.name} · ${rows.length}명`);
      return json(req, 200, {
        ok: true, group: groupJson(g), truncated: g.members > rows.length,
        members: rows.map((r) => ({ email: String(r.user_email), role: String(r.role), added_at: r.added_at })),
      });
    }

    // ---------- 관리자만: 그룹·구성원 고치기 ----------
    const adminActions = ['group_save', 'group_delete', 'member_add', 'member_remove'];
    if (adminActions.includes(action)) {
      if (!me || me.role !== 'admin') {
        await audit(actor, `directory:${action}`, '', 'denied', '관리자가 아님');
        throw new HttpError(403, '관리자만 그룹·명부를 고칠 수 있습니다.');
      }
    }

    if (action === 'group_save') {
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      const slug = typeof b.slug === 'string' ? b.slug.trim().toLowerCase() : '';
      const kind = typeof b.kind === 'string' && b.kind ? b.kind : 'custom';
      const desc = typeof b.description === 'string' ? b.description.trim() : '';
      const idNum = b.id === undefined || b.id === null || b.id === '' ? null : Number(b.id);
      if (idNum !== null && (!Number.isSafeInteger(idNum) || idNum <= 0)) throw new HttpError(400, '그룹 번호를 확인해 주세요.');
      const why = groupNameProblem(name) ?? groupSlugProblem(slug) ?? groupKindProblem(kind) ?? groupDescProblem(desc);
      if (why) throw new HttpError(400, why);
      const prev = idNum === null ? null : await groupById(idNum);
      if (idNum !== null && !prev) throw new HttpError(404, '그런 그룹이 없습니다.');
      try {
        if (prev) {
          await db`update bmr_admin.groups set slug = ${slug}, name = ${name}, kind = ${kind}, description = ${desc.slice(0, GROUP_DESC_MAX)}, updated_at = now()
            where id = ${prev.id}`;
        } else {
          await db`insert into bmr_admin.groups (slug, name, kind, description)
            values (${slug}, ${name.slice(0, GROUP_NAME_MAX)}, ${kind}, ${desc.slice(0, GROUP_DESC_MAX)})`;
        }
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new HttpError(409, '같은 주소 이름(slug)이나 이름의 그룹이 이미 있습니다.');
        throw e;
      }
      const g = await groupByIdOrRef(slug);
      await audit(actor, 'directory:group_save', g?.name ?? name, 'ok', prev ? `고침 · ${GROUP_KIND_LABEL[kind as GroupKind] ?? kind} · /${slug}` : `만듦 · ${GROUP_KIND_LABEL[kind as GroupKind] ?? kind} · /${slug}`);
      return json(req, 200, { ok: true, group: g ? groupJson(g) : null, created: !prev });
    }

    if (action === 'group_delete') {
      const idNum = Number(b.id);
      if (!Number.isSafeInteger(idNum) || idNum <= 0) throw new HttpError(400, '그룹 번호를 확인해 주세요.');
      const prev = await groupById(idNum);
      if (!prev) throw new HttpError(404, '그런 그룹이 없습니다.');
      await db`delete from bmr_admin.groups where id = ${prev.id}`;
      await audit(actor, 'directory:group_delete', prev.name, 'ok', `구성원 ${prev.members}명 줄도 함께 지움 · /${prev.slug}`);
      return json(req, 200, {
        ok: true, deleted: { id: prev.id, slug: prev.slug, name: prev.name },
        note: `공용 파일 버킷의 ${prev.slug}/ 폴더 파일은 지우지 않았습니다 (필요하면 직접 지우세요).`,
      });
    }

    if (action === 'member_add') {
      const idNum = Number(b.group_id);
      if (!Number.isSafeInteger(idNum) || idNum <= 0) throw new HttpError(400, '그룹을 골라 주세요.');
      const g = await groupById(idNum);
      if (!g) throw new HttpError(404, '그런 그룹이 없습니다.');
      const role = b.role === 'leader' ? 'leader' : 'member';
      const { list, bad } = normalizeEmails(b.emails ?? b.email, MEMBERS_MAX_SET);
      if (bad.length) throw new HttpError(400, `메일 주소 형식이 올바르지 않습니다: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' …' : ''}`);
      if (!list.length) throw new HttpError(400, '추가할 메일을 적어 주세요.');
      // 메일 목록은 JSON 으로 넘긴다 (배열 그대로 넘기지 않아 드라이버 차이에 흔들리지 않게)
      const emailsJson = JSON.stringify(list);
      await db`insert into bmr_admin.group_members (group_id, user_email, role)
        select ${g.id}, t.email, ${role} from jsonb_array_elements_text(${emailsJson}::jsonb) as t(email)
        on conflict (group_id, user_email) do update set role = excluded.role`;
      const after = await groupById(g.id);
      await audit(actor, 'directory:member_add', g.name, 'ok', `${list.length}명 ${role === 'leader' ? '운영자로 ' : ''}추가 (전체 ${after?.members ?? 0}명)`);
      return json(req, 200, { ok: true, group: after ? groupJson(after) : null, added: list.length, role });
    }

    if (action === 'member_remove') {
      const idNum = Number(b.group_id);
      if (!Number.isSafeInteger(idNum) || idNum <= 0) throw new HttpError(400, '그룹을 골라 주세요.');
      const g = await groupById(idNum);
      if (!g) throw new HttpError(404, '그런 그룹이 없습니다.');
      const { list } = normalizeEmails(b.emails ?? b.email, MEMBERS_MAX_SET);
      if (!list.length) throw new HttpError(400, '뺄 메일을 적어 주세요.');
      const removed = await db`delete from bmr_admin.group_members
        where group_id = ${g.id}
          and user_email in (select jsonb_array_elements_text(${JSON.stringify(list)}::jsonb))
        returning user_email`;
      const after = await groupById(g.id);
      await audit(actor, 'directory:member_remove', g.name, 'ok', `${removed.length}명 뺌 (전체 ${after?.members ?? 0}명)`);
      return json(req, 200, { ok: true, group: after ? groupJson(after) : null, removed: removed.length, not_found: list.length - removed.length });
    }

    throw new HttpError(400, '알 수 없는 요청입니다.');
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    const code = (e as { code?: string })?.code;
    if (code === '42P01' || /does not exist|group_members|bmr_admin\.groups/i.test(String((e as Error)?.message ?? ''))) {
      console.error('hub-directory missing table', String((e as Error)?.message ?? '').slice(0, 200));
      return json(req, 503, { error: '그룹·명부 표가 아직 준비되지 않았습니다(마이그레이션). 관리자에게 알려 주세요.' });
    }
    console.error('hub-directory', action, code ?? '', String((e as Error)?.message ?? e).slice(0, 200));
    if (action.startsWith('group') || action.startsWith('member')) await audit(actor, `directory:${action}`, '', 'error', '서버 오류');
    return json(req, 500, { error: '서버 오류가 났습니다.' });
  }
});
