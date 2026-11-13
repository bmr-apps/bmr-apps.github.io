// hub-provision — 관리자가 허브에서 '승인'을 누르면 새 앱 개발 환경을 바로 만들고, 담당자 GitHub 권한을 맞춘다.
// 호출: POST { action, ... }  Authorization: Bearer <허브 로그인 토큰>  — 모든 동작은 '관리자'만 (DB 의 역할로 확인)
//   approve       { request_id, note?, app_name? }  신청 승인 + 바로 만들기 시작
//   run           { request_id }                    이어서 만들기 / 실패한 단계부터 다시 시도
//   add_owner     { app_id, name, email?, github_username?, role? }   담당자 추가 + 저장소 push 권한 초대
//   update_owner  { owner_id, name, email?, github_username?, role? } 담당자 수정 (GitHub 아이디가 바뀌면 옛 권한 회수 → 새로 초대)
//   remove_owner  { owner_id }                      담당자 빼기 + 저장소 권한 회수
//   sync_owner    { owner_id }                      GitHub 권한 상태 다시 확인 / 초대 다시 시도
// 안전장치: 허용 목록(guard.ts) 밖의 외부 호출 불가, 지우기 경로 없음(담당자 권한 회수 제외), 이미 있는 저장소·스키마·함수·버킷은
//          이 신청이 만든 것이 아니면 손대지 않고 멈춤, 한 번에 하나만 실행, 시간당 횟수 제한, 모든 동작을 audit_log 에 기록.
// 관리 토큰(BMR_MGMT_TOKEN)·GitHub 토큰(BMR_GH_TOKEN)은 암호문으로만 함수 비밀값에 있고, 푸는 열쇠는 이 함수 배포본에만 있다
// (같은 프로젝트의 다른 앱 함수가 환경변수를 읽어도 토큰을 쓸 수 없게).
import postgres from 'npm:postgres@3.4.5';
import { DOMAIN, GH_RE, GitHub, HttpError, Mgmt, names, ORG, REF, Store, type Names } from './guard.ts';
import { FN_SOURCE, REPO_FILES, SQL_APP, SQL_STARTER } from './templates.ts';
import { PROVISION_KEY } from './_key.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const POOL_HOST = Deno.env.get('BMR_POOL_HOST') || 'aws-1-ap-northeast-2.pooler.supabase.com';
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const LIMIT = { approvePerHour: 6, runPerUserHour: 80, ownerPerUserHour: 40, perIpHour: 200 };
const BUDGET_MS = 95_000; // 함수 한 번 실행에 쓸 시간 (넘으면 기록하고 이어서)
const NAME_RE = /^[^'"\\<>&`{}\r\n$]{1,40}$/;
const EMAIL_RE = /^[^@\s'"<>]{1,64}@[^@\s'"<>]{1,190}$/;
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-provision: 다른 프로젝트에서는 실행하지 않습니다');

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : HUB, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// ---------- 토큰 (암호문 → 메모리에서만 풂) ----------
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let tokenCache: { mgmt: string; gh: string } | null = null;
async function tokens() {
  if (tokenCache) return tokenCache;
  const key = await crypto.subtle.importKey('raw', b64d(PROVISION_KEY), 'AES-GCM', false, ['decrypt']);
  const dec = async (name: string) => {
    const v = Deno.env.get(name) ?? '';
    if (!v.startsWith('enc:v1:')) throw new HttpError(500, `서버 설정(${name})이 없습니다. 관리자 봇에게 알려 주세요.`);
    const raw = b64d(v.slice(7));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(name) }, key, raw.slice(12));
    return new TextDecoder().decode(pt);
  };
  tokenCache = { mgmt: await dec('BMR_MGMT_TOKEN'), gh: await dec('BMR_GH_TOKEN') };
  return tokenCache;
}

// ---------- 누가 부르나 / 기록 / 횟수 ----------
type Me = { id: string; email: string; role: string };
async function me(req: Request): Promise<Me> {
  const tok = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
  if (!tok || tok.split('.').length !== 3) throw new HttpError(401, '로그인이 필요합니다.');
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) { await r.body?.cancel(); throw new HttpError(401, '로그인이 필요합니다.'); }
  const u = await r.json();
  const [p] = await db`select role, email from public.profiles where id = ${u.id}`;
  return { id: u.id, email: String(p?.email || u.email || '').toLowerCase(), role: String(p?.role ?? '') };
}
async function audit(u: Me | null, action: string, target: string, result: 'ok' | 'error' | 'denied', detail = '') {
  try {
    await db`insert into public.audit_log (actor, actor_email, action, target, result, detail)
      values (${u?.id ?? null}, ${(u?.email ?? '').slice(0, 200)}, ${action.slice(0, 60)}, ${target.slice(0, 200)}, ${result}, ${detail.slice(0, 2000)})`;
  } catch (e) { console.error('audit', String((e as Error)?.message ?? e).slice(0, 200)); }
}
async function rateLimit(req: Request, u: Me | null, action: string) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const [c] = await db`select
      count(*) filter (where ip = ${ip}) as by_ip,
      count(*) filter (where action = 'approve') as approves,
      count(*) filter (where user_id = ${u?.id ?? null}::uuid and action = 'run') as runs,
      count(*) filter (where user_id = ${u?.id ?? null}::uuid and action like '%_owner') as owners
    from bmr_admin.provision_attempts where at > now() - interval '1 hour'`;
  if (Number(c.by_ip) >= LIMIT.perIpHour) throw new HttpError(429, '요청이 너무 많습니다. 한 시간 뒤 다시 시도하세요.');
  if (action === 'approve' && Number(c.approves) >= LIMIT.approvePerHour) throw new HttpError(429, `새 앱은 한 시간에 ${LIMIT.approvePerHour}개까지만 만들 수 있습니다. 잠시 뒤 다시 시도하세요.`);
  if (action === 'run' && Number(c.runs) >= LIMIT.runPerUserHour) throw new HttpError(429, '다시 시도를 너무 많이 했습니다. 잠시 뒤 다시 시도하세요.');
  if (action.endsWith('_owner') && Number(c.owners) >= LIMIT.ownerPerUserHour) throw new HttpError(429, '담당자 변경을 너무 많이 했습니다. 잠시 뒤 다시 시도하세요.');
  await db`insert into bmr_admin.provision_attempts (user_id, ip, action) values (${u?.id ?? null}, ${ip}, ${action.slice(0, 40)})`;
  await db`delete from bmr_admin.provision_attempts where at < now() - interval '2 days'`;
}

// ---------- 공통 ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const render = (t: string, vars: Record<string, string>) => t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
function publishableKey(): string {
  try {
    const j = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
    const v = (j.default ?? Object.values(j)[0]) as string | undefined;
    if (v && v.startsWith('sb_publishable_')) return v;
  } catch { /* 아래로 */ }
  throw new HttpError(500, '공개 키를 찾지 못했습니다.');
}
async function slugProblem(slug: string): Promise<string | null> {
  const [r] = await db`select private.slug_problem(${slug}) as p`;
  return r?.p ?? null;
}
type Req = {
  id: number; slug: string; app_name: string; purpose: string; data_handled: string; has_student_pii: boolean; github_username: string;
  requester_name: string; requester_email: string | null; status: string; app_id: number | null;
  provision_status: string | null; provision_steps: Record<string, unknown>; provision_attempts: number;
};
async function getReq(id: unknown): Promise<Req> {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new HttpError(400, '신청 번호를 확인해 주세요.');
  const [r] = await db`select * from public.app_requests where id = ${Number(id)}`;
  if (!r) throw new HttpError(404, '신청을 찾을 수 없습니다.');
  return r as unknown as Req;
}

// 이미 있는 것과 겹치는지 (하나라도 있으면 만들지 않음)
async function collisions(n: Names, mgmt: Mgmt, gh: GitHub, store: Store, appId: number | null): Promise<string[]> {
  const out: string[] = [];
  const [d] = await db`select
      exists (select 1 from public.apps where slug = ${n.slug} and (${appId}::bigint is null or id <> ${appId}::bigint)) as app,
      exists (select 1 from pg_namespace where nspname = ${n.schema}) as schema,
      exists (select 1 from pg_roles where rolname in (${n.dev}, ${n.fnRole}, ${n.schema})) as role,
      exists (select 1 from vault.secrets where name = ${n.vault}) as vault,
      exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like ${n.slug + ': %'}) as pol`;
  if (d.app) out.push(`허브에 같은 주소(${n.slug})의 앱이 이미 있습니다`);
  if (d.schema) out.push(`DB 스키마 ${n.schema} 가 이미 있습니다`);
  if (d.role) out.push(`DB 역할 ${n.dev}/${n.fnRole} 가 이미 있습니다`);
  if (d.vault) out.push(`DB 비밀번호 보관 칸 ${n.vault} 가 이미 있습니다`);
  if (d.pol) out.push(`버킷 정책 '${n.slug}: …' 가 이미 있습니다`);
  const repo = await gh.call('GET', gh.path);
  if (repo.ok) out.push(`GitHub 저장소 ${ORG}/${n.slug} 가 이미 있습니다`);
  else if (repo.status !== 404) out.push(`GitHub 저장소 확인 실패 (${repo.status})`);
  if ((await mgmt.functionSlugs()).includes(n.fn)) out.push(`서버 함수 ${n.fn} 가 이미 있습니다`);
  if ((await mgmt.secretNames()).includes(n.dbSecret)) out.push(`함수 비밀값 ${n.dbSecret} 가 이미 있습니다`);
  if (await store.exists()) out.push(`버킷 ${n.slug} 가 이미 있습니다`);
  return out;
}

// ---------- 담당자 GitHub 권한 ----------
type GhState = { status: 'invited' | 'active' | 'failed' | 'no_repo'; error?: string; detail?: string };
async function repoManaged(gh: GitHub, slug: string): Promise<boolean> {
  const m = await gh.call('GET', `${gh.path}/contents/.bmr-app.json`);
  if (!m.ok || !m.data?.content) return false;
  try { return JSON.parse(new TextDecoder().decode(b64d(String(m.data.content).replace(/\s/g, '')))).slug === slug; } catch { return false; }
}
async function grantAccess(gh: GitHub, slug: string, user: string): Promise<GhState> {
  if (!GH_RE.test(user)) return { status: 'failed', error: 'GitHub 아이디 형식이 올바르지 않습니다.' };
  if (!(await repoManaged(gh, slug))) return { status: 'no_repo', detail: 'BMR APPS 가 만든 저장소가 아니라 권한을 바꾸지 않았습니다.' };
  const p = await gh.call('GET', `${gh.path}/collaborators/${user}/permission`);
  const roleName = String(p.data?.role_name ?? ''), perm = String(p.data?.permission ?? '');
  if (p.ok && (['admin', 'maintain', 'write'].includes(roleName) || ['admin', 'write'].includes(perm))) {
    return { status: 'active', detail: `권한 있음 (${roleName || perm}${perm === 'admin' ? ' · 조직 관리자' : ''})` };
  }
  const inv = await gh.call('GET', `${gh.path}/invitations?per_page=100`);
  if (inv.ok && Array.isArray(inv.data) && inv.data.some((i: any) => String(i.invitee?.login ?? '').toLowerCase() === user.toLowerCase())) {
    return { status: 'invited', detail: '초대 수락 대기' };
  }
  const r = await gh.call('PUT', `${gh.path}/collaborators/${user}`, { permission: 'push' });
  if (r.status === 201) return { status: 'invited', detail: '초대함 (push 권한)' };
  if (r.status === 204) return { status: 'active', detail: '권한 있음' };
  if (r.status === 404 || r.status === 403 || r.status === 422) {
    const who = await gh.call('GET', `/users/${user}`);
    if (who.status === 404) return { status: 'failed', error: 'GitHub 에 없는 아이디입니다. 아이디를 확인해 주세요.' };
  }
  return { status: 'failed', error: `초대 실패 (GitHub ${r.status}${r.data?.message ? ': ' + String(r.data.message).slice(0, 120) : ''})` };
}
async function revokeAccess(gh: GitHub, slug: string, user: string): Promise<string> {
  if (!GH_RE.test(user)) return '아이디 형식이 달라 건너뜀';
  if (!(await repoManaged(gh, slug))) return 'BMR APPS 저장소가 아니라 건너뜀';
  const p = await gh.call('GET', `${gh.path}/collaborators/${user}/permission`);
  if (p.ok && p.data?.permission === 'admin') return '조직 관리자라 권한을 그대로 둠';
  const notes: string[] = [];
  const inv = await gh.call('GET', `${gh.path}/invitations?per_page=100`);
  if (inv.ok && Array.isArray(inv.data)) {
    for (const i of inv.data) if (String(i.invitee?.login ?? '').toLowerCase() === user.toLowerCase() && Number.isSafeInteger(i.id)) {
      const d = await gh.call('DELETE', `${gh.path}/invitations/${i.id}`); notes.push(d.ok ? '초대 취소' : `초대 취소 실패 ${d.status}`);
    }
  }
  const d = await gh.call('DELETE', `${gh.path}/collaborators/${user}`);
  notes.push(d.status === 204 ? '협업자 권한 회수' : d.status === 404 ? '협업자 아님' : `회수 실패 ${d.status}`);
  return notes.join(', ');
}
async function syncOwnerRow(ownerId: number): Promise<GhState | null> {
  const [o] = await db`select o.id, o.github_username, a.slug from public.app_owners o join public.apps a on a.id = o.app_id where o.id = ${ownerId}`;
  if (!o) throw new HttpError(404, '담당자를 찾을 수 없습니다.');
  if (!o.github_username) { await db`update public.app_owners set gh_status = null, gh_error = null, gh_status_at = now() where id = ${ownerId}`; return null; }
  let st: GhState;
  try { names(o.slug); st = await grantAccess(new GitHub(o.slug, (await tokens()).gh), o.slug, o.github_username); }
  catch (e) { st = { status: 'failed', error: e instanceof HttpError ? e.message : 'GitHub 연결 오류' }; }
  await db`update public.app_owners set gh_status = ${st.status}, gh_error = ${st.error ?? st.detail ?? null}, gh_status_at = now() where id = ${ownerId}`;
  return st;
}

// ---------- 만들기 단계 ----------
export const STEPS = ['check', 'db', 'fn_secret', 'starter', 'expose', 'bucket', 'function', 'repo', 'pages', 'vars', 'code', 'hub', 'invite', 'dbcred', 'health'] as const;
type Ctx = { r: Req; n: Names; name: string; mgmt: Mgmt; gh: GitHub; store: Store; steps: Record<string, unknown>; u: Me; t0: number };
async function saveSteps(c: Ctx, extra: { status?: string; error?: string | null; finished?: boolean } = {}) {
  await db`update public.app_requests set provision_steps = ${db.json(c.steps as Record<string, never>)},
      provision_status = coalesce(${extra.status ?? null}, provision_status),
      provision_error = ${extra.error === undefined ? db`provision_error` : extra.error},
      provision_finished_at = ${extra.finished ? db`now()` : db`provision_finished_at`},
      provision_lease_until = now() + interval '3 minutes'
    where id = ${c.r.id}`;
}
const vars = (c: Ctx, extra: Record<string, string> = {}) => ({
  SLUG: c.n.slug, SCHEMA: c.n.schema, DEV: c.n.dev, FNROLE: c.n.fnRole, FN: c.n.fn, PREFIX: c.n.prefix, APP_NAME: c.name,
  DOMAIN, SB_URL, REF, ORG, ...extra,
});
async function scram(pw: string) {
  const hmac = async (key: BufferSource, msg: string) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(msg)));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  const salt = crypto.getRandomValues(new Uint8Array(16)), it = 4096;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salted = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, k, 256));
  const stored = new Uint8Array(await crypto.subtle.digest('SHA-256', await hmac(salted, 'Client Key')));
  return `SCRAM-SHA-256$${it}:${b64(salt)}$${b64(stored)}:${b64(await hmac(salted, 'Server Key'))}`;
}
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 한 단계 실행. true = 끝남, false = 아직(다음 호출에서 이어서) */
async function runStep(c: Ctx, step: string): Promise<boolean> {
  const { n, mgmt, gh, store } = c;
  const started = c.steps[step] === 'started';
  const mark = async () => { c.steps[step] = 'started'; await saveSteps(c); };
  switch (step) {
    case 'check': {
      const col = await collisions(n, mgmt, gh, store, c.r.app_id);
      if (col.length) throw new HttpError(409, `이미 있는 자원과 겹쳐서 만들지 않았습니다: ${col.join(' · ')}`);
      return true;
    }
    case 'db': {
      if (!started) {
        const [d] = await db`select exists (select 1 from pg_namespace where nspname = ${n.schema}) as s, exists (select 1 from pg_roles where rolname in (${n.dev}, ${n.fnRole})) as r`;
        if (d.s || d.r) throw new HttpError(409, `DB 스키마/역할이 이미 있어 멈췄습니다 (${n.schema})`);
        await mark();
      }
      await mgmt.query(`begin;\n${render(SQL_APP, vars(c))}\ncommit;`);
      return true;
    }
    case 'fn_secret': {
      if (!started && (await mgmt.secretNames()).includes(n.dbSecret)) throw new HttpError(409, `함수 비밀값 ${n.dbSecret} 가 이미 있어 멈췄습니다`);
      await mark();
      const pw = hex(24);
      await mgmt.query(`alter role ${n.fnRole} password '${await scram(pw)}'`);
      await mgmt.setFnDbSecret(`postgresql://${n.fnRole}.${REF}:${pw}@${POOL_HOST}:6543/postgres`);
      for (let i = 0; i < 4; i++) { if ((await mgmt.secretNames()).includes(n.dbSecret)) return true; await sleep(800); }
      throw new HttpError(502, '함수 비밀값이 저장되지 않았습니다.');
    }
    case 'starter': {
      await mark();
      await mgmt.query(`begin;\n${render(SQL_STARTER, vars(c))}\ncommit;`);
      return true;
    }
    case 'expose': {
      await mgmt.exposeSchema();
      for (let i = 0; i < 5; i++) { if ((await mgmt.exposedSchemas()).includes(n.schema)) return true; await sleep(1500); }
      throw new HttpError(502, 'Data API 노출이 반영되지 않았습니다.');
    }
    case 'bucket': {
      const ex = await store.exists();
      if (ex && !started) throw new HttpError(409, `버킷 ${n.slug} 가 이미 있어 멈췄습니다`);
      if (!ex) { await mark(); await store.create(); }
      return true;
    }
    case 'function': {
      if (!started && (await mgmt.functionSlugs()).includes(n.fn)) throw new HttpError(409, `서버 함수 ${n.fn} 가 이미 있어 멈췄습니다`);
      await mark();
      await mgmt.deployFn(render(FN_SOURCE, vars(c)));
      return true;
    }
    case 'repo': {
      const r = await gh.call('GET', gh.path);
      if (r.ok && !started) throw new HttpError(409, `GitHub 저장소 ${ORG}/${n.slug} 가 이미 있어 멈췄습니다`);
      if (!r.ok) {
        if (r.status !== 404) throw new HttpError(502, `저장소 확인 실패 (${r.status})`);
        await mark();
        const cr = await gh.call('POST', `/orgs/${ORG}/repos`, { name: n.slug, description: `${c.name} · BMR APPS`, homepage: n.url, private: false, auto_init: true, has_wiki: false, has_projects: false });
        if (!cr.ok) throw new HttpError(502, `저장소 만들기 실패 (GitHub ${cr.status}${cr.data?.message ? ': ' + String(cr.data.message).slice(0, 120) : ''})`);
      }
      for (let i = 0; i < 15; i++) { if ((await gh.call('GET', `${gh.path}/branches/main`)).ok) return true; await sleep(1500); }
      return false;
    }
    case 'pages': {
      const p = await gh.call('GET', `${gh.path}/pages`);
      if (p.status === 404) {
        const r = await gh.call('POST', `${gh.path}/pages`, { build_type: 'workflow' });
        if (!r.ok && r.status !== 409) throw new HttpError(502, `GitHub Pages 켜기 실패 (${r.status})`);
      } else if (!p.ok) throw new HttpError(502, `GitHub Pages 확인 실패 (${p.status})`);
      return true;
    }
    case 'vars': {
      for (const [k, v] of [['VITE_SUPABASE_URL', SB_URL], ['VITE_SUPABASE_PUBLISHABLE_KEY', publishableKey()]] as const) {
        const u = await gh.call('PATCH', `${gh.path}/actions/variables/${k}`, { name: k, value: v });
        if (u.status === 404) { const cr = await gh.call('POST', `${gh.path}/actions/variables`, { name: k, value: v }); if (!cr.ok) throw new HttpError(502, `Actions 변수 ${k} 실패 (${cr.status})`); }
        else if (!u.ok) throw new HttpError(502, `Actions 변수 ${k} 실패 (${u.status})`);
      }
      return true;
    }
    case 'code': {
      const ref = await gh.call('GET', `${gh.path}/git/ref/heads/main`);
      if (!ref.ok) throw new HttpError(502, `main 브랜치 읽기 실패 (${ref.status})`);
      const rv = vars(c, { PUB_KEY: publishableKey(), POOL_HOST, DIRECT_HOST: `db.${REF}.supabase.co` });
      const files: Record<string, string> = {};
      for (const [p, t] of Object.entries(REPO_FILES)) files[p] = render(t, rv);
      files[`supabase/functions/${n.fn}/index.ts`] = render(FN_SOURCE, rv);
      const tree = await gh.call('POST', `${gh.path}/git/trees`, { tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) });
      if (!tree.ok) throw new HttpError(502, `파일 올리기 실패 (tree ${tree.status})`);
      const cm = await gh.call('POST', `${gh.path}/git/commits`, {
        message: `${c.name}: BMR APPS 개발 환경 (안내 페이지)`, tree: tree.data.sha, parents: [ref.data.object.sha],
        author: { name: 'BMR APPS 봇', email: 'bot@bmrschool.net' },
      });
      if (!cm.ok) throw new HttpError(502, `파일 올리기 실패 (commit ${cm.status})`);
      const up = await gh.call('PATCH', `${gh.path}/git/refs/heads/main`, { sha: cm.data.sha, force: false });
      if (!up.ok) throw new HttpError(502, `파일 올리기 실패 (ref ${up.status})`);
      c.steps.commit = String(cm.data.sha).slice(0, 12);
      return true;
    }
    case 'hub': {
      const tag = `[bmr-app:${n.slug} v2]`;
      const note = `${c.r.has_student_pii ? '학생 개인정보 처리: ' + c.r.data_handled + ' ' : c.r.data_handled ? c.r.data_handled + ' ' : ''}${tag} 스키마 ${n.schema} · DB 역할 ${n.dev} · 버킷 ${n.slug} · 함수 ${n.fn} · 신청 #${c.r.id}`.slice(0, 1000);
      await db.begin(async (t) => {
        const [ex] = await t`select id from public.apps where slug = ${n.slug}`;
        let appId: number;
        if (ex) {
          if (Number(ex.id) !== Number(c.r.app_id)) throw new HttpError(409, `허브에 같은 주소의 앱이 이미 있어 멈췄습니다`);
          appId = Number(ex.id);
        } else {
          const [a] = await t`insert into public.apps (slug, name, description, url, repo_url, supabase_ref, status, note)
            values (${n.slug}, ${c.name}, ${c.r.purpose.slice(0, 1000)}, ${n.url}, ${n.repoUrl}, ${REF}, 'preparing', ${note}) returning id`;
          appId = Number(a.id);
          await t`update public.app_requests set app_id = ${appId} where id = ${c.r.id}`;
          c.r.app_id = appId;
        }
        const [o] = await t`select id from public.app_owners where app_id = ${appId} and lower(coalesce(github_username, '')) = lower(${c.r.github_username})`;
        if (!o) await t`insert into public.app_owners (app_id, name, email, github_username, role)
          values (${appId}, ${c.r.requester_name}, ${c.r.requester_email}, ${c.r.github_username}, '책임')`;
      });
      return true;
    }
    case 'invite': {
      const [o] = await db`select id from public.app_owners where app_id = ${c.r.app_id} and lower(coalesce(github_username, '')) = lower(${c.r.github_username}) order by id limit 1`;
      const st = o ? await syncOwnerRow(Number(o.id)) : null;
      c.steps.invite_result = st?.status ?? 'none';
      if (st?.status === 'failed') c.steps.invite_error = st.error ?? '';
      return true;
    }
    case 'dbcred': {
      await mark();
      let last = 0;
      for (let i = 0; i < 4; i++) {
        const r = await fetch(`${SB_URL}/functions/v1/hub-dbcred`, { method: 'POST', headers: { Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stage', slug: n.slug }) });
        last = r.status; await r.body?.cancel();
        if (r.ok) return true;
        await sleep(2000);
      }
      throw new HttpError(502, `처음 DB 비밀번호를 준비하지 못했습니다 (hub-dbcred ${last})`);
    }
    case 'health': {
      for (let i = 0; i < 6; i++) {
        try {
          const r = await fetch(`${SB_URL}/functions/v1/${n.fn}/health`);
          if (r.ok && (await r.json()).db === true) return true;
          else await r.body?.cancel();
        } catch { /* 다시 */ }
        if (Date.now() - c.t0 > BUDGET_MS) break;
        await sleep(3000);
      }
      const tries = Number(c.steps.health_tries ?? 0) + 1;
      c.steps.health_tries = tries;
      if (tries >= 5) throw new HttpError(502, `서버 함수 ${n.fn} 가 DB 에 붙지 않습니다 (/health). 잠시 뒤 다시 시도하세요.`);
      return false;
    }
  }
  throw new HttpError(500, '알 수 없는 단계');
}

async function provision(r: Req, u: Me): Promise<{ more: boolean }> {
  const n = names(r.slug);
  const name = r.app_name.trim();
  if (!NAME_RE.test(name)) throw new HttpError(400, '앱 이름은 40자 이내로, 따옴표·꺾쇠·중괄호 없이 적어 주세요.');
  // 한 번에 하나만 (프로젝트 설정·비밀값을 동시에 바꾸면 하나가 사라질 수 있음)
  const [lease] = await db`update bmr_admin.provision_lease set request_id = ${r.id}, until = now() + interval '3 minutes'
    where id = 1 and (until < now() or request_id = ${r.id}) returning id`;
  if (!lease) throw new HttpError(409, '다른 앱을 만드는 중입니다. 잠시 뒤 다시 시도하세요.');
  const tk = await tokens();
  const c: Ctx = { r, n, name, mgmt: new Mgmt(n, tk.mgmt), gh: new GitHub(n.slug, tk.gh), store: new Store(n, SB_URL, SERVICE), steps: { ...(r.provision_steps ?? {}) }, u, t0: Date.now() };
  await db`update public.app_requests set provision_status = 'running', provision_error = null, provision_attempts = provision_attempts + 1,
      provision_started_at = coalesce(provision_started_at, now()), provision_lease_until = now() + interval '3 minutes' where id = ${r.id}`;
  try {
    for (const step of STEPS) {
      if (c.steps[step] === 'done') continue;
      if (Date.now() - c.t0 > BUDGET_MS) { await saveSteps(c); return { more: true }; }
      let ok: boolean;
      try { ok = await runStep(c, step); }
      catch (e) {
        const msg = e instanceof HttpError ? e.message : `서버 오류 (${String((e as Error)?.message ?? e).slice(0, 160)})`;
        c.steps.failed_step = step;
        await saveSteps(c, { status: 'failed', error: `[${step}] ${msg}`, finished: true });
        await audit(u, `provision:${step}`, n.slug, 'error', msg);
        throw new HttpError(e instanceof HttpError && e.status < 500 ? e.status : 502, msg);
      }
      if (!ok) { await saveSteps(c); return { more: true }; }
      c.steps[step] = 'done'; delete c.steps.failed_step;
      await saveSteps(c);
      if (step !== 'check') await audit(u, `provision:${step}`, n.slug, 'ok', step === 'code' ? `commit ${c.steps.commit ?? ''}` : step === 'invite' ? `GitHub ${c.r.github_username}: ${c.steps.invite_result}${c.steps.invite_error ? ' · ' + c.steps.invite_error : ''}` : '');
    }
    const warn = c.steps.invite_result === 'failed' ? `GitHub 초대 실패: ${c.steps.invite_error ?? ''} (담당 개발자에서 다시 시도)` : null;
    await saveSteps(c, { status: 'done', error: warn, finished: true });
    await audit(u, 'provision:done', n.slug, 'ok', `${name} · ${n.url}`);
    return { more: false };
  } finally {
    await db`update bmr_admin.provision_lease set until = '-infinity' where id = 1 and request_id = ${r.id}`;
    await db`update public.app_requests set provision_lease_until = null where id = ${r.id}`;
  }
}

// ---------- 담당자 입력 검사 ----------
function ownerInput(b: Record<string, unknown>) {
  const name = String(b.name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase() || null;
  const gh = String(b.github_username ?? '').trim().replace(/^@/, '') || null;
  const role = String(b.role ?? '').trim() || '담당';
  if (name.length < 1 || name.length > 100) throw new HttpError(400, '이름을 1~100자로 적어 주세요.');
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, '이메일 형식을 확인해 주세요.');
  if (gh && !GH_RE.test(gh)) throw new HttpError(400, 'GitHub 아이디 형식을 확인해 주세요.');
  if (role.length > 30) throw new HttpError(400, '역할은 30자 이내로 적어 주세요.');
  return { name, email, gh, role };
}
async function ownerApp(ownerId: unknown) {
  if (!Number.isSafeInteger(Number(ownerId)) || Number(ownerId) <= 0) throw new HttpError(400, '담당자를 확인해 주세요.');
  const [o] = await db`select o.id, o.app_id, o.name, o.github_username, a.slug from public.app_owners o join public.apps a on a.id = o.app_id where o.id = ${Number(ownerId)}`;
  if (!o) throw new HttpError(404, '담당자를 찾을 수 없습니다.');
  return o as unknown as { id: number; app_id: number; name: string; github_username: string | null; slug: string };
}
/** 같은 앱에 같은 GitHub 아이디를 쓰는 다른 담당자가 없을 때만 권한 회수 */
async function maybeRevoke(appId: number, slug: string, user: string, exceptOwner: number): Promise<string> {
  const [other] = await db`select 1 from public.app_owners where app_id = ${appId} and id <> ${exceptOwner} and lower(coalesce(github_username, '')) = lower(${user})`;
  if (other) return '같은 아이디의 다른 담당자가 있어 권한을 그대로 둠';
  try { names(slug); return await revokeAccess(new GitHub(slug, (await tokens()).gh), slug, user); }
  catch (e) { return e instanceof HttpError ? e.message : 'GitHub 연결 오류'; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 만 됩니다.' });
  let u: Me | null = null; let action = '';
  try {
    const text = await req.text();
    if (text.length > 8192) throw new HttpError(413, '요청이 너무 큽니다.');
    let b: Record<string, unknown> = {};
    try { b = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'JSON 형식이 아닙니다.'); }
    action = String(b.action ?? '').slice(0, 40);
    u = await me(req).catch(async (e) => { await rateLimit(req, null, action || '?'); throw e; });
    if (u.role !== 'admin') {
      await rateLimit(req, u, 'denied');
      await audit(u, action || '?', String(b.request_id ?? b.app_id ?? b.owner_id ?? ''), 'denied', `역할 ${u.role || '없음'}`);
      throw new HttpError(403, u.role === 'disabled' ? '사용이 중지된 계정입니다.' : '관리자만 승인·앱 만들기·담당자 변경을 할 수 있습니다.');
    }
    await rateLimit(req, u, action || '?');

    if (action === 'approve') {
      const r0 = await getReq(b.request_id);
      if (r0.status !== 'pending') throw new HttpError(409, '대기 중인 신청이 아닙니다.');
      const name = String(b.app_name ?? r0.app_name).trim();
      if (!NAME_RE.test(name)) throw new HttpError(400, '앱 이름은 40자 이내로, 따옴표·꺾쇠·중괄호 없이 적어 주세요. (승인 칸에서 고칠 수 있어요)');
      const note = String(b.note ?? '').slice(0, 2000);
      const p = await slugProblem(r0.slug); if (p) throw new HttpError(400, p);
      if (!GH_RE.test(r0.github_username)) throw new HttpError(400, '신청서의 GitHub 아이디 형식이 올바르지 않습니다.');
      const n = names(r0.slug); const tk = await tokens();
      const col = await collisions(n, new Mgmt(n, tk.mgmt), new GitHub(n.slug, tk.gh), new Store(n, SB_URL, SERVICE), null);
      if (col.length) { await audit(u, 'approve', n.slug, 'error', col.join(' · ')); throw new HttpError(409, `승인하지 않았습니다 — 이미 있는 자원과 겹칩니다: ${col.join(' · ')}`); }
      const [upd] = await db`update public.app_requests set status = 'approved', app_name = ${name}, review_note = ${note}, reviewed_by = ${u.id}, reviewed_at = now(),
          provision_status = 'running', provision_steps = '{"check":"done"}'::jsonb, provision_error = null, provision_started_at = now(), provision_finished_at = null
        where id = ${r0.id} and status = 'pending' returning id`;
      if (!upd) throw new HttpError(409, '대기 중인 신청이 아닙니다.');
      await audit(u, 'approve', n.slug, 'ok', `신청 #${r0.id} ${name}${r0.has_student_pii ? ' · 학생 개인정보' : ''}`);
      const res = await provision(await getReq(r0.id), u);
      return json(req, 200, { ok: true, ...res, request: await getReq(r0.id) });
    }

    if (action === 'run') {
      const r = await getReq(b.request_id);
      if (r.status !== 'approved') throw new HttpError(409, '승인된 신청만 이어서 만들 수 있습니다.');
      if (r.provision_status === 'done') return json(req, 200, { ok: true, more: false, request: r });
      const res = await provision(r, u);
      return json(req, 200, { ok: true, ...res, request: await getReq(r.id) });
    }

    if (action === 'add_owner') {
      const appId = Number(b.app_id);
      if (!Number.isSafeInteger(appId) || appId <= 0) throw new HttpError(400, '앱을 확인해 주세요.');
      const [a] = await db`select id, slug from public.apps where id = ${appId}`;
      if (!a) throw new HttpError(404, '앱을 찾을 수 없습니다.');
      const f = ownerInput(b);
      const [row] = await db`insert into public.app_owners (app_id, name, email, github_username, role) values (${appId}, ${f.name}, ${f.email}, ${f.gh}, ${f.role}) returning id`;
      const st = f.gh ? await syncOwnerRow(Number(row.id)) : null;
      await audit(u, 'add_owner', `${a.slug} · ${f.name}${f.gh ? ' @' + f.gh : ''}`, st?.status === 'failed' ? 'error' : 'ok', st ? `${st.status} ${st.error ?? st.detail ?? ''}` : 'GitHub 아이디 없음');
      return json(req, 200, { ok: true, owner_id: row.id, github: st });
    }

    if (action === 'update_owner') {
      const o0 = await ownerApp(b.owner_id);
      const f = ownerInput(b);
      const changed = (o0.github_username ?? '').toLowerCase() !== (f.gh ?? '').toLowerCase();
      await db`update public.app_owners set name = ${f.name}, email = ${f.email}, github_username = ${f.gh}, role = ${f.role} where id = ${o0.id}`;
      let revoked = '';
      if (changed && o0.github_username) revoked = await maybeRevoke(o0.app_id, o0.slug, o0.github_username, o0.id);
      const st = changed ? await syncOwnerRow(o0.id) : null;
      await audit(u, 'update_owner', `${o0.slug} · ${f.name}`, st?.status === 'failed' ? 'error' : 'ok',
        changed ? `GitHub ${o0.github_username ?? '없음'} → ${f.gh ?? '없음'}${revoked ? ' · 옛 아이디: ' + revoked : ''}${st ? ' · ' + st.status + ' ' + (st.error ?? st.detail ?? '') : ''}` : '이름·메일·역할 변경');
      return json(req, 200, { ok: true, github: st, revoked });
    }

    if (action === 'remove_owner') {
      const o0 = await ownerApp(b.owner_id);
      const revoked = o0.github_username ? await maybeRevoke(o0.app_id, o0.slug, o0.github_username, o0.id) : '';
      await db`delete from public.app_owners where id = ${o0.id}`;
      await audit(u, 'remove_owner', `${o0.slug} · ${o0.name}${o0.github_username ? ' @' + o0.github_username : ''}`, 'ok', revoked || 'GitHub 아이디 없음');
      return json(req, 200, { ok: true, revoked });
    }

    if (action === 'sync_owner') {
      const o0 = await ownerApp(b.owner_id);
      const st = await syncOwnerRow(o0.id);
      await audit(u, 'sync_owner', `${o0.slug} · ${o0.name}${o0.github_username ? ' @' + o0.github_username : ''}`, st?.status === 'failed' ? 'error' : 'ok', st ? `${st.status} ${st.error ?? st.detail ?? ''}` : '');
      return json(req, 200, { ok: true, github: st });
    }

    throw new HttpError(400, '알 수 없는 요청입니다.');
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error('hub-provision', action, (e as { code?: string })?.code ?? '', String((e as Error)?.message ?? e).slice(0, 200));
    await audit(u, action || '?', '', 'error', '서버 오류');
    return json(req, 500, { error: '서버 오류가 났습니다.' });
  }
});
