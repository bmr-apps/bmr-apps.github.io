// hub-deprovision — 관리자가 허브에서 앱을 '백업한 뒤' 지운다. (만들기 함수 hub-provision 에는 지우기 경로가 없다)
// 호출: POST { action, ... }  Authorization: Bearer <허브 로그인 토큰> — 모두 관리자만 (DB 역할로 확인), 나머지는 403 + 감사 기록
//   preview  { app_id }                              무엇이 있고 무엇을 지우게 되는지 (읽기만)
//   start    { app_id, confirm_slug, note? }          백업 → 삭제 시작 (confirm_slug 가 정확히 같아야 함)
//   run      { deletion_id }                          이어서 / 실패한 단계부터 다시 시도
// 순서: 백업(허브 행 → DB 구조·데이터 → 버킷 파일 → 서버 함수 → 저장소 zip → 목록 확인) 이 모두 끝나야 지우기 시작.
// 지우는 것은 '그 앱 것'이라는 표시가 있을 때만: 스키마·역할 주석 bmr-app:<slug>:…, 저장소 .bmr-app.json, 허브 메모 [bmr-app:<slug> …].
// 표시가 없거나 없는 자원은 건너뛰고 기록한다 (예: 외부 앱은 허브 행만 지움).
import postgres from 'npm:postgres@3.4.5';
import { BACKUP_BUCKET, GitHub, HttpError, Mgmt, names, ORG, REF, Store, type Names } from './guard.ts';
import { PROVISION_KEY } from './_key.ts';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
const LIMIT = { startPerHour: 3, runPerUserHour: 60, previewPerUserHour: 120, perIpHour: 200 };
const CAP = { dbBytes: 100 * 1024 * 1024, bucketBytes: 300 * 1024 * 1024, bucketFiles: 5000, repoBytes: 80 * 1024 * 1024 };
const BUDGET_MS = 95_000;
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-deprovision: 다른 프로젝트에서는 실행하지 않습니다');

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : HUB, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 토큰 (hub-provision 과 같은 암호문·열쇠) ----------
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let tokenCache: { mgmt: string; gh: string } | null = null;
async function tokens() {
  if (tokenCache) return tokenCache;
  const key = await crypto.subtle.importKey('raw', b64d(PROVISION_KEY), 'AES-GCM', false, ['decrypt']);
  const dec = async (name: string) => {
    const v = Deno.env.get(name) ?? '';
    if (!v.startsWith('enc:v1:')) throw new HttpError(500, `서버 설정(${name})이 없습니다.`);
    const raw = b64d(v.slice(7));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(name) }, key, raw.slice(12)));
  };
  tokenCache = { mgmt: await dec('BMR_MGMT_TOKEN'), gh: await dec('BMR_GH_TOKEN') };
  return tokenCache;
}

// ---------- 누가 / 기록 / 횟수 ----------
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
  const a = `del:${action}`.slice(0, 40);
  const [c] = await db`select count(*) filter (where ip = ${ip}) as by_ip,
      count(*) filter (where user_id = ${u?.id ?? null}::uuid and action = ${a}) as mine
    from bmr_admin.provision_attempts where at > now() - interval '1 hour'`;
  if (Number(c.by_ip) >= LIMIT.perIpHour) throw new HttpError(429, '요청이 너무 많습니다. 한 시간 뒤 다시 시도하세요.');
  if (action === 'start' && Number(c.mine) >= 20) throw new HttpError(429, '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.');
  if (action === 'run' && Number(c.mine) >= LIMIT.runPerUserHour) throw new HttpError(429, '다시 시도를 너무 많이 했습니다. 잠시 뒤 다시 시도하세요.');
  if (action === 'preview' && Number(c.mine) >= LIMIT.previewPerUserHour) throw new HttpError(429, '요청이 너무 많습니다.');
  await db`insert into bmr_admin.provision_attempts (user_id, ip, action) values (${u?.id ?? null}, ${ip}, ${a})`;
}

// ---------- 지금 무엇이 있나 (그 앱 것인지 표시로 판단) ----------
type Inspect = {
  slug: string; schema: string; schemaExists: boolean; schemaOurs: boolean; devOurs: boolean; fnRoleOurs: boolean; rolesForeign: string[];
  repo: 'ours' | 'foreign' | 'none'; hubTag: boolean; appOurs: boolean; fn: boolean; secrets: string[]; bucket: boolean;
  bucketFiles: number; bucketBytes: number; policies: number; vault: boolean; exposed: boolean; tables: number; dbBytes: number;
};
async function otherPrefixes(n: Names): Promise<string[]> {
  const rows = await db`select nspname from pg_namespace where obj_description(oid, 'pg_namespace') like 'bmr-app:%' and nspname <> ${n.schema}`;
  return rows.map((r) => String(r.nspname).toUpperCase() + '_');
}
async function inspect(n: Names, note: string, mgmt: Mgmt, gh: GitHub, store: Store | null): Promise<Inspect> {
  const tag = `bmr-app:${n.slug}:`;
  const [d] = await db`select
      exists (select 1 from pg_namespace where nspname = ${n.schema}) as schema_exists,
      coalesce((select obj_description(oid, 'pg_namespace') from pg_namespace where nspname = ${n.schema}), '') as schema_comment,
      coalesce((select shobj_description(oid, 'pg_authid') from pg_roles where rolname = ${n.dev}), '') as dev_comment,
      exists (select 1 from pg_roles where rolname = ${n.dev}) as dev_exists,
      coalesce((select shobj_description(oid, 'pg_authid') from pg_roles where rolname = ${n.fnRole}), '') as fn_comment,
      exists (select 1 from pg_roles where rolname = ${n.fnRole}) as fn_exists,
      (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like ${n.slug + ': %'}) as policies,
      exists (select 1 from vault.secrets where name = ${n.vault}) as vault,
      (select count(*)::int from storage.objects where bucket_id = ${n.slug}) as files,
      (select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects where bucket_id = ${n.slug}) as bytes,
      (select count(*)::int from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = ${n.schema} and c.relkind in ('r', 'p')) as tables,
      (select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = ${n.schema} and c.relkind in ('r', 'p', 'm')) as db_bytes`;
  const schemaOurs = String(d.schema_comment).startsWith(tag);
  const devOurs = d.dev_exists && String(d.dev_comment).startsWith(tag);
  const fnRoleOurs = d.fn_exists && String(d.fn_comment).startsWith(tag);
  const rolesForeign = [d.dev_exists && !devOurs && n.dev, d.fn_exists && !fnRoleOurs && n.fnRole].filter(Boolean) as string[];
  let repo: Inspect['repo'] = 'none';
  const r = await gh.json('GET', gh.path);
  if (r.ok) {
    repo = 'foreign';
    const m = await gh.json('GET', `${gh.path}/contents/.bmr-app.json`);
    if (m.ok && m.data?.content) { try { if (JSON.parse(new TextDecoder().decode(b64d(String(m.data.content).replace(/\s/g, '')))).slug === n.slug) repo = 'ours'; } catch { /* 표시 아님 */ } }
  } else if (r.status !== 404) throw new HttpError(502, `저장소 확인 실패 (${r.status})`);
  const hubTag = note.includes(`[bmr-app:${n.slug} `) || note.includes(`[bmr-app:${n.slug}]`);
  const appOurs = schemaOurs || repo === 'ours' || hubTag;
  return {
    slug: n.slug, schema: n.schema, schemaExists: d.schema_exists, schemaOurs, devOurs, fnRoleOurs, rolesForeign, repo, hubTag, appOurs,
    fn: await mgmt.functionExists(), secrets: await mgmt.appSecretNames(), bucket: store ? await store.bucketExists() : false,
    bucketFiles: Number(d.files), bucketBytes: Number(d.bytes), policies: Number(d.policies), vault: d.vault, exposed: (await mgmt.exposed()).includes(n.schema),
    tables: Number(d.tables), dbBytes: Number(d.db_bytes),
  };
}

// ---------- DB 구조를 SQL 로 (pg_dump 비슷하게, 카탈로그에서) ----------
async function schemaDDL(schema: string): Promise<string> {
  const out: string[] = [`-- BMR APPS 백업: 스키마 ${schema} 구조 (${new Date().toISOString()})`, `-- 데이터는 data/<표>.json. 권한(grant)·소유자는 담지 않음 (다시 만들 때 provision 이 맞춤)`, `create schema if not exists ${schema};`, ''];
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const enums = await db`select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace s on s.oid = t.typnamespace where s.nspname = ${schema} group by t.typname`;
  for (const e of enums) out.push(`create type ${schema}.${q(e.typname)} as enum (${(e.labels as string[]).map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')});`);
  const seqs = await db`select c.relname, s.seqstart, s.seqincrement from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_sequence s on s.seqrelid = c.oid
    where n.nspname = ${schema} and c.relkind = 'S' and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'i')`;
  for (const s of seqs) out.push(`create sequence if not exists ${schema}.${q(s.relname)} start ${s.seqstart} increment ${s.seqincrement};`);
  const tables = await db`select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, obj_description(c.oid, 'pg_class') as comment
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${schema} and c.relkind in ('r', 'p') order by c.relname`;
  for (const t of tables) {
    const cols = await db`select a.attname, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull, a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) as def
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = ${t.oid} and a.attnum > 0 and not a.attisdropped order by a.attnum`;
    const lines = cols.map((c) => `  ${q(c.attname)} ${c.type}${c.attidentity === 'a' ? ' generated always as identity' : c.attidentity === 'd' ? ' generated by default as identity' : ''}${c.attgenerated === 's' ? ` generated always as (${c.def}) stored` : c.def && !c.attidentity ? ` default ${c.def}` : ''}${c.attnotnull ? ' not null' : ''}`);
    out.push('', `create table ${schema}.${q(t.relname)} (\n${lines.join(',\n')}\n);`);
    if (t.comment) out.push(`comment on table ${schema}.${q(t.relname)} is '${String(t.comment).replace(/'/g, "''")}';`);
    if (t.relrowsecurity) out.push(`alter table ${schema}.${q(t.relname)} enable row level security;`);
    if (t.relforcerowsecurity) out.push(`alter table ${schema}.${q(t.relname)} force row level security;`);
  }
  const cons = await db`select c.relname, k.conname, k.contype, pg_get_constraintdef(k.oid) as def from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and k.contype in ('p', 'u', 'c', 'x', 'f') order by (k.contype = 'f'), c.relname, k.conname`;
  if (cons.length) out.push('', '-- 제약 조건');
  for (const k of cons) out.push(`alter table ${schema}.${q(k.relname)} add constraint ${q(k.conname)} ${k.def};`);
  const idx = await db`select pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)`;
  if (idx.length) out.push('', '-- 인덱스');
  for (const i of idx) out.push(`${i.def};`);
  const views = await db`select c.relname, c.relkind, pg_get_viewdef(c.oid, true) as def from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${schema} and c.relkind in ('v', 'm') order by c.oid`;
  if (views.length) out.push('', '-- 뷰');
  for (const v of views) out.push(`create ${v.relkind === 'm' ? 'materialized view' : 'view'} ${schema}.${q(v.relname)}${v.relkind === 'v' ? ' with (security_invoker = true)' : ''} as\n${String(v.def).replace(/;\s*$/, '')};`);
  const fns = await db`select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = ${schema} and p.prokind in ('f', 'p') order by p.proname`;
  if (fns.length) out.push('', '-- 함수');
  for (const f of fns) out.push(`${String(f.def).trim()};`, '');
  const trg = await db`select pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = ${schema} and not t.tgisinternal`;
  if (trg.length) out.push('', '-- 트리거');
  for (const t of trg) out.push(`${t.def};`);
  const pol = await db`select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname = ${schema} order by tablename, policyname`;
  if (pol.length) out.push('', '-- RLS 정책');
  for (const p of pol) {
    out.push(`create policy ${q(p.policyname)} on ${schema}.${q(p.tablename)} as ${p.permissive === 'PERMISSIVE' ? 'permissive' : 'restrictive'} for ${String(p.cmd).toLowerCase()} to ${(p.roles as string[]).join(', ')}${p.qual ? ` using (${p.qual})` : ''}${p.with_check ? ` with check (${p.with_check})` : ''};`);
  }
  return out.join('\n') + '\n';
}

// ---------- 단계 ----------
export const STEPS = ['check', 'backup_hub', 'backup_db', 'backup_bucket', 'backup_fn', 'backup_repo', 'backup_manifest',
  'del_repo', 'del_fn', 'del_secrets', 'del_bucket', 'del_db', 'del_expose', 'del_hub'] as const;
type Del = { id: number; app_id: number; slug: string; app_name: string; snapshot: any; status: string; steps: Record<string, unknown>; backup_prefix: string; backup_files: { path: string; size: number }[] };
type Ctx = { d: Del; n: Names; mgmt: Mgmt; gh: GitHub; store: Store; u: Me; t0: number; files: Map<string, number>; info?: Inspect };

async function getDel(id: unknown): Promise<Del> {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new HttpError(400, '삭제 번호를 확인해 주세요.');
  const [d] = await db`select * from public.app_deletions where id = ${Number(id)}`;
  if (!d) throw new HttpError(404, '삭제 기록을 찾을 수 없습니다.');
  return d as unknown as Del;
}
async function save(c: Ctx, extra: { status?: string; error?: string | null; finished?: boolean } = {}) {
  c.d.backup_files = [...c.files].map(([path, size]) => ({ path, size }));
  await db`update public.app_deletions set steps = ${db.json(c.d.steps as Record<string, never>)}, backup_files = ${db.json(c.d.backup_files as never)},
      status = coalesce(${extra.status ?? null}, status), error = ${extra.error === undefined ? db`error` : extra.error},
      finished_at = ${extra.finished ? db`now()` : db`finished_at`}, lease_until = now() + interval '3 minutes' where id = ${c.d.id}`;
}
const put = async (c: Ctx, rel: string, body: Uint8Array | string, type: string) => { c.files.set(rel, await c.store.put(rel, body, type)); };

async function runStep(c: Ctx, step: string): Promise<boolean> {
  const { n, mgmt, gh, store } = c;
  // 처음 확인한 상태를 기록해 두고 끝까지 그 기준으로 (이어서 할 때 이미 지운 것 때문에 판단이 바뀌지 않게)
  if (!c.info) c.info = (c.d.steps.info as Inspect | undefined) ?? await inspect(n, String(c.d.snapshot?.app?.note ?? ''), mgmt, gh, store);
  c.d.steps.info = c.info;
  const info = c.info;
  const note = (why: string) => { c.d.steps[`${step}_note`] = why; return true; };
  switch (step) {
    case 'check': {
      if (info.rolesForeign.length) note(`앱 표시가 없는 DB 역할(${info.rolesForeign.join(', ')})은 지우지 않음`);
      return true;
    }
    case 'backup_hub': {
      await put(c, 'hub.json', JSON.stringify({ ...c.d.snapshot, inspected: info }, null, 2), 'application/json');
      return true;
    }
    case 'backup_db': {
      if (!info.schemaExists) return note('스키마 없음');
      if (!info.schemaOurs) return note('앱 표시가 없는 스키마라 백업·삭제하지 않음');
      if (info.dbBytes > CAP.dbBytes) throw new HttpError(413, `DB 데이터가 ${Math.round(info.dbBytes / 1048576)}MB 라 자동 백업 한도(${CAP.dbBytes / 1048576}MB)를 넘습니다. 관리자 봇에게 수동 백업을 요청하세요.`);
      await put(c, 'db/schema.sql', await schemaDDL(n.schema), 'application/sql');
      const tables = await db`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = ${n.schema} and c.relkind in ('r', 'p') order by c.relname`;
      let rows = 0;
      for (const t of tables) {
        const [r] = await db`select count(*)::int as n, coalesce(json_agg(x), '[]'::json)::text as j from ${db(n.schema)}.${db(String(t.relname))} x`;
        rows += Number(r.n);
        await put(c, `db/data/${t.relname}.json`, r.j, 'application/json');
      }
      return note(`표 ${tables.length}개 · 행 ${rows}개`);
    }
    case 'backup_bucket': {
      if (!info.bucket) return note('버킷 없음');
      if (!info.appOurs) return note('앱 표시가 없어 버킷을 건드리지 않음');
      if (info.bucketBytes > CAP.bucketBytes || info.bucketFiles > CAP.bucketFiles) throw new HttpError(413, `버킷 파일이 ${info.bucketFiles}개·${Math.round(info.bucketBytes / 1048576)}MB 라 자동 백업 한도(${CAP.bucketFiles}개·${CAP.bucketBytes / 1048576}MB)를 넘습니다.`);
      const objs = await db`select name, coalesce((metadata->>'size')::bigint, 0) as size from storage.objects where bucket_id = ${n.slug} order by name`;
      const done = new Set((c.d.steps.bucket_done as string[] | undefined) ?? []);
      for (const o of objs) {
        if (done.has(o.name)) continue;
        if (Date.now() - c.t0 > BUDGET_MS) { c.d.steps.bucket_done = [...done]; return false; }
        await store.copyObject(String(o.name), Number(o.size));
        c.files.set(`bucket/${o.name}`, Number(o.size)); done.add(o.name);
      }
      await put(c, 'bucket/_list.json', JSON.stringify(objs, null, 1), 'application/json');
      delete c.d.steps.bucket_done;
      return note(`파일 ${objs.length}개 · ${Math.round(info.bucketBytes / 1024)}KB`);
    }
    case 'backup_fn': {
      if (!info.fn) return note('서버 함수 없음');
      if (!info.appOurs) return note('앱 표시가 없어 함수를 건드리지 않음');
      await put(c, 'function/meta.json', JSON.stringify({ meta: await mgmt.functionMeta(), secret_names: info.secrets }, null, 2), 'application/json');
      await put(c, `function/${n.fn}.eszip`, await mgmt.functionBody(), 'application/octet-stream');
      return note('함수 정보·배포본(eszip) — 원본 코드는 저장소 zip 에도 있음');
    }
    case 'backup_repo': {
      if (info.repo === 'none') return note('저장소 없음');
      if (info.repo === 'foreign') return note('.bmr-app.json 표시가 없는 저장소라 백업·삭제하지 않음');
      const meta = await gh.json('GET', gh.path);
      const col = await gh.json('GET', `${gh.path}/collaborators?per_page=100`);
      const inv = await gh.json('GET', `${gh.path}/invitations?per_page=100`);
      await put(c, 'repo/meta.json', JSON.stringify({
        full_name: meta.data?.full_name, description: meta.data?.description, homepage: meta.data?.homepage, default_branch: meta.data?.default_branch, pushed_at: meta.data?.pushed_at,
        collaborators: Array.isArray(col.data) ? col.data.map((x: any) => ({ login: x.login, role: x.role_name })) : col.status,
        invitations: Array.isArray(inv.data) ? inv.data.map((x: any) => ({ login: x.invitee?.login, permissions: x.permissions })) : inv.status,
      }, null, 2), 'application/json');
      const z = await gh.raw('GET', `${gh.path}/zipball`);
      if (!z.ok) { await z.body?.cancel(); throw new HttpError(502, `저장소 zip 내려받기 실패 (${z.status})`); }
      const len = Number(z.headers.get('content-length') ?? 0);
      if (len > CAP.repoBytes) { await z.body?.cancel(); throw new HttpError(413, `저장소가 ${Math.round(len / 1048576)}MB 라 자동 백업 한도를 넘습니다.`); }
      const buf = new Uint8Array(await z.arrayBuffer());
      if (buf.byteLength > CAP.repoBytes || buf.byteLength < 22) throw new HttpError(502, '저장소 zip 크기가 올바르지 않습니다.');
      await put(c, `repo/${n.slug}.zip`, buf, 'application/zip');
      return note(`zip ${Math.round(buf.byteLength / 1024)}KB (main 브랜치)`);
    }
    case 'backup_manifest': {
      await put(c, 'manifest.json', JSON.stringify({
        app: c.d.snapshot?.app, slug: n.slug, deletion_id: c.d.id, by: c.u.email, at: new Date().toISOString(), inspected: info,
        files: [...c.files].map(([path, size]) => ({ path, size })), steps: c.d.steps,
      }, null, 2), 'application/json');
      // 백업 버킷에 실제로 다 있는지 다시 확인 (하나라도 없으면 지우지 않음)
      const [r] = await db`select count(*)::int as n from storage.objects where bucket_id = ${BACKUP_BUCKET} and name like ${c.d.backup_prefix + '/%'}`;
      if (Number(r.n) < c.files.size) throw new HttpError(502, `백업 파일 확인 실패 (${r.n}/${c.files.size}) — 아무것도 지우지 않았습니다.`);
      return note(`백업 파일 ${r.n}개 확인`);
    }
    case 'del_repo': {
      if (info.repo !== 'ours') return note(info.repo === 'none' ? '저장소 없음' : '표시 없는 저장소는 그대로 둠');
      // 지우기 직전에 표시를 한 번 더 확인
      const again = await inspect(n, String(c.d.snapshot?.app?.note ?? ''), mgmt, gh, store);
      if (again.repo !== 'ours') return note('저장소 표시를 다시 확인하지 못해 그대로 둠');
      const r = await gh.raw('DELETE', gh.path); await r.body?.cancel();
      if (r.status !== 204 && r.status !== 404) throw new HttpError(502, `저장소 삭제 실패 (GitHub ${r.status})`);
      return note(`저장소 ${ORG}/${n.slug} 삭제 (GitHub Pages 사이트도 함께 내려감)`);
    }
    case 'del_fn': {
      if (!info.appOurs) return note('앱 표시가 없어 건너뜀');
      if (!(await mgmt.functionExists())) return note('서버 함수 없음');
      await mgmt.deleteFunction();
      return note(`서버 함수 ${n.fn} 삭제`);
    }
    case 'del_secrets': {
      if (!info.appOurs) return note('앱 표시가 없어 건너뜀');
      const list = await mgmt.appSecretNames();
      if (!list.length) return note('함수 비밀값 없음');
      await mgmt.deleteSecrets(list);
      return note(`함수 비밀값 ${list.join(', ')} 삭제`);
    }
    case 'del_bucket': {
      if (!info.appOurs) return note('앱 표시가 없어 건너뜀');
      if (!(await store.bucketExists())) return note('버킷 없음');
      if (!(await store.deleteBucket())) throw new HttpError(502, `버킷 ${n.slug} 삭제 실패`);
      return note(`버킷 ${n.slug}(파일 포함) 삭제`);
    }
    case 'del_db': {
      const tag = `bmr-app:${n.slug}:%`;
      // 이름은 검증된 slug 에서만 나온다 (영문 소문자·숫자·하이픈/밑줄)
      await mgmt.query(`do $$ declare p record; begin
  if ${info.appOurs ? 'true' : 'false'} then
    for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like '${n.slug}: %' loop
      execute format('drop policy %I on storage.objects', p.policyname);
    end loop;
  end if;
  if exists (select from pg_namespace where nspname = '${n.schema}' and obj_description(oid, 'pg_namespace') like '${tag}') then
    execute 'drop schema ${n.schema} cascade';
  end if;
  if exists (select from pg_roles where rolname = '${n.fnRole}' and shobj_description(oid, 'pg_authid') like '${tag}') then
    perform pg_terminate_backend(pid) from pg_stat_activity where usename = '${n.fnRole}';
    execute 'drop owned by ${n.fnRole}'; execute 'drop role ${n.fnRole}';
  end if;
  if exists (select from pg_roles where rolname = '${n.dev}' and shobj_description(oid, 'pg_authid') like '${tag}') then
    perform pg_terminate_backend(pid) from pg_stat_activity where usename = '${n.dev}';
    execute 'drop owned by ${n.dev}'; execute 'drop role ${n.dev}';
  end if;
  delete from vault.secrets where name = '${n.vault}';
end $$;`);
      const parts = [info.appOurs && info.policies ? `버킷 정책 ${info.policies}개` : '', info.schemaOurs ? `스키마 ${n.schema}` : '', info.devOurs ? n.dev : '', info.fnRoleOurs ? n.fnRole : '', info.vault ? 'Vault DB 비밀번호' : ''].filter(Boolean);
      return note(parts.length ? `${parts.join(' · ')} 삭제` : '지울 DB 자원 없음');
    }
    case 'del_expose': {
      if (!info.schemaOurs && !info.exposed) return note('Data API 목록에 없음');
      if (!info.schemaOurs) return note('앱 표시가 없는 스키마라 Data API 목록을 그대로 둠');
      return note((await mgmt.unexpose()) ? `Data API 목록에서 ${n.schema} 뺌` : 'Data API 목록에 없음');
    }
    case 'del_hub': {
      await db.begin(async (t) => {
        await t`update public.app_requests set app_deleted_at = now() where app_id = ${c.d.app_id} or (slug = ${n.slug} and status = 'approved' and app_deleted_at is null)`;
        await t`delete from public.apps where id = ${c.d.app_id} and slug = ${n.slug}`;
      });
      return note('허브 앱 행·담당자 삭제, 신청 기록은 남기고 "앱 삭제됨" 표시');
    }
  }
  throw new HttpError(500, '알 수 없는 단계');
}

async function runDeletion(d: Del, u: Me): Promise<{ more: boolean }> {
  const n = names(d.slug);
  const [lease] = await db`update bmr_admin.provision_lease set request_id = ${-d.id}, until = now() + interval '3 minutes'
    where id = 1 and (until < now() or request_id = ${-d.id}) returning id`;
  if (!lease) throw new HttpError(409, '다른 앱을 만들거나 지우는 중입니다. 잠시 뒤 다시 시도하세요.');
  const tk = await tokens();
  const c: Ctx = {
    d: { ...d, steps: { ...(d.steps ?? {}) } }, n, mgmt: new Mgmt(n, tk.mgmt, await otherPrefixes(n)), gh: new GitHub(n.slug, tk.gh),
    store: new Store(n, SB_URL, SERVICE, d.backup_prefix), u, t0: Date.now(), files: new Map((d.backup_files ?? []).map((f) => [f.path, f.size])),
  } as Ctx;
  await db`update public.app_deletions set status = 'running', error = null, lease_until = now() + interval '3 minutes' where id = ${d.id}`;
  try {
    for (const step of STEPS) {
      if (c.d.steps[step] === 'done') continue;
      if (step.startsWith('del_') && c.d.steps.backup_manifest !== 'done') throw new HttpError(500, '백업이 끝나지 않아 지우지 않습니다.');
      if (Date.now() - c.t0 > BUDGET_MS) { await save(c); return { more: true }; }
      let ok: boolean;
      try { ok = await runStep(c, step); }
      catch (e) {
        const msg = e instanceof HttpError ? e.message : `서버 오류 (${String((e as Error)?.message ?? e).slice(0, 160)})`;
        c.d.steps.failed_step = step;
        await save(c, { status: 'failed', error: `[${step}] ${msg}${step.startsWith('backup') || step === 'check' ? ' — 아무것도 지우지 않았습니다.' : ''}`, finished: true });
        await audit(u, `delete:${step}`, n.slug, 'error', msg);
        throw new HttpError(e instanceof HttpError && e.status < 500 ? e.status : 502, msg);
      }
      if (!ok) { await save(c); return { more: true }; }
      c.d.steps[step] = 'done'; delete c.d.steps.failed_step;
      await save(c);
      await audit(u, `delete:${step}`, n.slug, 'ok', String(c.d.steps[`${step}_note`] ?? ''));
    }
    await save(c, { status: 'done', error: null, finished: true });
    await audit(u, 'delete:done', n.slug, 'ok', `${d.app_name} 삭제 완료 · 백업 ${BACKUP_BUCKET}/${d.backup_prefix} (${c.files.size}개)`);
    return { more: false };
  } finally {
    await db`update bmr_admin.provision_lease set until = '-infinity' where id = 1 and request_id = ${-d.id}`;
    await db`update public.app_deletions set lease_until = null where id = ${d.id}`;
  }
}

async function appRow(appId: unknown) {
  if (!Number.isSafeInteger(Number(appId)) || Number(appId) <= 0) throw new HttpError(400, '앱을 확인해 주세요.');
  const [a] = await db`select * from public.apps where id = ${Number(appId)}`;
  if (!a) throw new HttpError(404, '앱을 찾을 수 없습니다.');
  const [p] = await db`select private.slug_problem(${a.slug}) as p`;
  if (p?.p) throw new HttpError(400, `이 앱(${a.slug})은 예약된 주소라 여기서 지울 수 없습니다. 상태를 '종료'로 바꿔 숨기세요.`);
  return a as Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 만 됩니다.' });
  let u: Me | null = null; let action = '';
  try {
    const text = await req.text();
    if (text.length > 4096) throw new HttpError(413, '요청이 너무 큽니다.');
    let b: Record<string, unknown> = {};
    try { b = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'JSON 형식이 아닙니다.'); }
    action = String(b.action ?? '').slice(0, 20);
    u = await me(req).catch(async (e) => { await rateLimit(req, null, action || '?'); throw e; });
    if (u.role !== 'admin') {
      await rateLimit(req, u, 'denied');
      await audit(u, `delete:${action || '?'}`, String(b.app_id ?? b.deletion_id ?? ''), 'denied', `역할 ${u.role || '없음'}`);
      throw new HttpError(403, '관리자만 앱을 삭제할 수 있습니다.');
    }
    await rateLimit(req, u, action || '?');

    if (action === 'preview') {
      const a = await appRow(b.app_id); const n = names(a.slug); const tk = await tokens();
      const info = await inspect(n, String(a.note ?? ''), new Mgmt(n, tk.mgmt, await otherPrefixes(n)), new GitHub(n.slug, tk.gh), new Store(n, SB_URL, SERVICE, `${n.slug}/preview`));
      const [active] = await db`select id from public.app_deletions where slug = ${n.slug} and status <> 'done'`;
      return json(req, 200, { ok: true, app: { id: a.id, slug: a.slug, name: a.name }, info, active_deletion: active?.id ?? null, caps: CAP });
    }

    if (action === 'start') {
      const a = await appRow(b.app_id); const n = names(a.slug);
      if (String(b.confirm_slug ?? '') !== a.slug) throw new HttpError(400, `확인을 위해 주소 이름(${a.slug})을 정확히 입력해 주세요.`);
      const [busy] = await db`select 1 from public.app_requests where slug = ${n.slug} and provision_status = 'running' and provision_lease_until > now()`;
      if (busy) throw new HttpError(409, '이 앱을 만드는 중입니다. 끝난 뒤 다시 시도하세요.');
      const [ex] = await db`select id from public.app_deletions where slug = ${n.slug} and status <> 'done'`;
      if (ex) throw new HttpError(409, `이미 진행 중인 삭제가 있습니다 (#${ex.id}). 감사 기록 화면에서 다시 시도하세요.`);
      // 실제로 시작한 삭제는 한 시간에 몇 번까지만 (확인 실패한 시도는 세지 않음)
      const [recent] = await db`select count(*)::int as c from public.app_deletions where created_at > now() - interval '1 hour'`;
      if (recent.c >= LIMIT.startPerHour) throw new HttpError(429, `앱 삭제는 한 시간에 ${LIMIT.startPerHour}개까지만 할 수 있습니다. 잠시 뒤 다시 시도하세요.`);
      const owners = await db`select name, email, github_username, role, gh_status from public.app_owners where app_id = ${a.id}`;
      const reqs = await db`select id, requester_name, requester_email, app_name, purpose, data_handled, has_student_pii, github_username, status, created_at, reviewed_at from public.app_requests where app_id = ${a.id}`;
      const ts = new Date(Date.now() + 9 * 3600_000).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const [d] = await db`insert into public.app_deletions (app_id, slug, app_name, snapshot, backup_prefix, note, created_by, created_by_email)
        values (${a.id}, ${n.slug}, ${a.name}, ${db.json({ app: a, owners, requests: reqs } as never)}, ${`${n.slug}/${ts}`}, ${String(b.note ?? '').slice(0, 1000)}, ${u.id}, ${u.email})
        returning *`;
      await audit(u, 'delete:start', n.slug, 'ok', `${a.name} · 백업 위치 ${BACKUP_BUCKET}/${n.slug}/${ts}`);
      const res = await runDeletion(d as unknown as Del, u);
      return json(req, 200, { ok: true, ...res, deletion: await getDel(d.id) });
    }

    if (action === 'run') {
      const d = await getDel(b.deletion_id);
      if (d.status === 'done') return json(req, 200, { ok: true, more: false, deletion: d });
      const res = await runDeletion(d, u);
      return json(req, 200, { ok: true, ...res, deletion: await getDel(d.id) });
    }
    throw new HttpError(400, '알 수 없는 요청입니다.');
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error('hub-deprovision', action, String((e as Error)?.message ?? e).slice(0, 200));
    await audit(u, `delete:${action || '?'}`, '', 'error', '서버 오류');
    return json(req, 500, { error: '서버 오류가 났습니다.' });
  }
});
