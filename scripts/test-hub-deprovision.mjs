// hub-deprovision 끝까지 시험: zztest-del 을 hub-provision 으로 만들고 → 데이터·파일 넣고 → 관리자로 삭제 → 백업·삭제 확인.
// beri·altsis·designer 는 지우지 않고 "그대로인지"만 비교한다. 비밀번호·토큰은 출력하지 않는다.
// 정리: node scripts/test-hub-deprovision.mjs --cleanup  (시험 백업·계정·신청·삭제 기록·감사 기록)
import { randomBytes } from 'node:crypto';
import { SB_URL, apiKeys, sql, sbApi, ghJson, listSecretNames, listFunctions } from '../../bmr-app-templates/lib/common.mjs';

const SLUG = 'zztest-del', SCHEMA = 'zztest_del', PREFIX = 'hub-del-test';
let pass = 0, fail = 0; const fails = [];
const ok = (c, l, extra = '') => { if (c) { pass++; console.log('  ✓', l); } else { fail++; fails.push(l); console.log('  ✗', l, extra); } };
const { pub, service } = await apiKeys();
const authH = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
const adm = (p, o = {}) => fetch(`${SB_URL}/auth/v1/admin/${p}`, { ...o, headers: authH });
const storage = (p, o = {}) => fetch(`${SB_URL}/storage/v1${p}`, { ...o, headers: { ...authH, ...(o.headers || {}) } });

async function cleanup() {
  // 시험 백업(hub-backups/zztest-del/...)만 지움
  const objs = await sql(`select name from storage.objects where bucket_id = 'hub-backups' and name like '${SLUG}/%'`);
  for (let i = 0; i < objs.length; i += 500) {
    const r = await storage('/object/hub-backups', { method: 'DELETE', body: JSON.stringify({ prefixes: objs.slice(i, i + 500).map((o) => o.name) }) });
    if (!r.ok) console.log('백업 삭제 실패', r.status);
  }
  console.log(`시험 백업 파일 ${objs.length}개 삭제`);
  await sql(`delete from bmr_admin.provision_attempts where user_id in (select id from auth.users where email like '${PREFIX}-%@example.com')`);
  for (const u of await sql(`select id, email from auth.users where email like '${PREFIX}-%@example.com'`)) { const r = await adm(`users/${u.id}`, { method: 'DELETE' }); console.log('시험 계정 삭제', u.email, r.status); }
  await sql(`delete from public.app_deletions where slug = '${SLUG}'`);
  await sql(`delete from public.app_requests where slug = '${SLUG}'`);
  await sql(`delete from public.audit_log where target in ('${SLUG}') or actor_email like '${PREFIX}-%@example.com'`);
  console.log('시험 신청·삭제 기록·감사 기록 삭제');
}
if (process.argv.includes('--cleanup')) { await cleanup(); process.exit(0); }

const token = async (email, pw) => (await (await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: pub, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json()).access_token;
const mk = async (local, role) => {
  const email = `${PREFIX}-${local}@example.com`, pw = randomBytes(18).toString('base64url');
  const u = await (await adm('users', { method: 'POST', body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { name: local } }) })).json();
  if (!u.id) throw new Error('계정 실패');
  await sql(`update public.profiles set role = '${role}', name = '${local}' where id = '${u.id}'`);
  return { id: u.id, email, at: await token(email, pw) };
};
const rest = (tok, path, init = {}) => fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: pub, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
const call = (name) => async (tok, action, body = {}) => {
  const r = await fetch(`${SB_URL}/functions/v1/${name}`, { method: 'POST', headers: { apikey: pub, ...(tok ? { Authorization: `Bearer ${tok}` } : {}), Origin: 'https://apps.bmrschool.net', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const prov = call('hub-provision'), del = call('hub-deprovision');

// ---- 다른 앱 상태(비교용) ----
async function snapshot() {
  const [s] = await sql(`select
    (select json_agg(row_to_json(a) order by a.id) from (select id, slug, name, status, url, repo_url, note, updated_at from public.apps where slug <> '${SLUG}') a) as apps,
    (select json_agg(row_to_json(o) order by o.id) from (select o.* from public.app_owners o join public.apps a on a.id = o.app_id where a.slug <> '${SLUG}') o) as owners,
    (select json_agg(n.nspname order by n.nspname) from pg_namespace n where n.nspname not like 'pg_%' and n.nspname <> '${SCHEMA}') as schemas,
    (select json_agg(rolname order by rolname) from pg_roles where rolname not like '${SCHEMA}%') as roles,
    (select json_agg(name order by name) from vault.secrets where name not like '%${SLUG}%') as vault,
    (select json_agg(b order by b) from (select id || ':' || (select count(*) from storage.objects o where o.bucket_id = b.id) as b from storage.buckets b where id not in ('${SLUG}', 'hub-backups')) x) as buckets,
    (select json_agg(t order by t) from (select table_schema || '.' || table_name as t from information_schema.tables where table_schema = 'beri') x) as beri_tables,
    (select json_agg(p order by p) from (select schemaname || '.' || tablename || ':' || policyname as p from pg_policies where policyname not like '${SLUG}: %' and schemaname <> '${SCHEMA}') x) as policies,
    (select count(*) from public.app_requests where slug <> '${SLUG}') as requests`);
  s.secrets = (await listSecretNames()).filter((x) => !x.startsWith('ZZTEST_DEL_')).sort();
  s.functions = (await listFunctions()).filter((x) => x !== `${SLUG}-fn`).sort();
  const pg = await (await sbApi('/postgrest')).json();
  s.exposed = String(pg.db_schema).split(',').map((x) => x.trim()).filter((x) => x !== SCHEMA).sort();
  s.repos = [];
  for (const r of ['beri', 'bmr-apps.github.io']) { const g = await ghJson(`/repos/bmr-apps/${r}`); s.repos.push(`${r}:${g.status}:${g.data?.pushed_at}`); }
  return s;
}

const leftover = (await sql(`select a.id, r.id as req from public.apps a left join public.app_requests r on r.app_id = a.id where a.slug = '${SLUG}'`))[0];
if (!leftover) await cleanup();
else { console.log(`(지난 시험에서 만든 ${SLUG} 앱 #${leftover.id} 를 이어서 씀)`); for (const u of await sql(`select id from auth.users where email like '${PREFIX}-%@example.com'`)) await adm(`users/${u.id}`, { method: 'DELETE' }); }
const admin = await mk('admin', 'admin'), staff = await mk('staff', 'staff'), pend = await mk('pending', 'pending');
console.log('시험 계정 3개 준비 (관리자·개발자·일반 사용자)');

console.log('\n[1. zztest-del 만들기 (hub-provision)]');
let r, req, f, appId;
if (leftover) { req = { id: leftover.req }; appId = leftover.id; await sql(`delete from ${SCHEMA}.documents`); ok(true, '이미 만들어진 시험 앱 사용'); }
else {
r = await rest(staff.at, 'app_requests', { method: 'POST', body: JSON.stringify({ requester_name: '시험 개발자', requester_email: staff.email, app_name: '삭제 시험', slug: SLUG, purpose: 'hub-deprovision 삭제 시험 (곧 지움)', data_handled: '', has_student_pii: false, github_username: 'devgoodway' }) });
req = (await r.json())[0]; ok(r.ok && req?.id, `신청 #${req?.id}`);
f = await prov(admin.at, 'approve', { request_id: req.id, note: '삭제 시험' });
for (let i = 0; f.status === 200 && f.j.more && i < 10; i++) f = await prov(admin.at, 'run', { request_id: req.id });
const [rq] = await sql(`select provision_status, provision_error, app_id from public.app_requests where id = ${req.id}`);
ok(rq.provision_status === 'done', `생성 완료 (${rq.provision_status} ${rq.provision_error ?? ''})`);
appId = rq.app_id;
}

console.log('\n[2. 데이터·파일 넣기]');
await sql(`insert into ${SCHEMA}.documents (collection, data, owner) values ('notes', '{"title":"삭제 시험 문서","n":42}', null)`);
const [cnt] = await sql(`select count(*)::int as c from ${SCHEMA}.documents`); ok(cnt.c === 1, '문서 1행');
// Storage 는 한글 파일 이름(키)을 받지 않음
const FILE = 'folder/hello test.txt', BODY = `삭제 시험 파일 ${randomBytes(6).toString('hex')}`;
r = await storage(`/object/${SLUG}/${encodeURI(FILE)}`, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', 'x-upsert': 'true' }, body: BODY });
ok(r.ok, `버킷 파일 업로드 (${r.status})`);

const before = await snapshot();
console.log(`  다른 앱 기준 상태: 앱 ${before.apps.length}개, 함수 ${before.functions.length}, 비밀값 ${before.secrets.length}, 버킷 ${before.buckets.length}, 노출 스키마 ${before.exposed.join(',')}`);

console.log('\n[3. 권한·안전 장치]');
for (const [who, u] of [['개발자', staff], ['일반 사용자', pend]]) {
  f = await del(u.at, 'preview', { app_id: appId }); ok(f.status === 403, `${who} 미리 보기 → 403 (${f.status})`);
  f = await del(u.at, 'start', { app_id: appId, confirm_slug: SLUG }); ok(f.status === 403, `${who} 삭제 시작 → 403 (${f.status})`);
}
f = await del(null, 'preview', { app_id: appId }); ok(f.status === 401, `로그인 없이 → 401 (${f.status})`);
const den = await sql(`select count(*)::int as c from public.audit_log where action like 'delete:%' and result = 'denied' and actor_email like '${PREFIX}-%'`);
ok(den[0].c >= 4, `거부 시도 감사 기록 ${den[0].c}건`);
r = await rest(staff.at, 'app_deletions?select=id'); ok(r.ok && (await r.json()).length === 0, '개발자는 삭제 기록을 볼 수 없음');
r = await storage('/object/list/hub-backups', { method: 'POST', headers: { apikey: pub, Authorization: `Bearer ${staff.at}` }, body: JSON.stringify({ prefix: '', limit: 10 }) });
ok(r.ok ? (await r.json()).length === 0 : true, `개발자는 백업 버킷을 볼 수 없음 (${r.status})`);
f = await del(admin.at, 'start', { app_id: appId, confirm_slug: 'zztest-de' }); ok(f.status === 400, `주소 이름 틀림 → 400 (${f.status})`);
f = await del(admin.at, 'start', { app_id: 1, confirm_slug: 'designer' }); ok(f.status === 400, `designer(예약 주소) 삭제 거부 (${f.status})`);
f = await del(admin.at, 'start', { app_id: 999999, confirm_slug: 'x' }); ok(f.status === 404, `없는 앱 → 404 (${f.status})`);
f = await del(admin.at, 'preview', { app_id: 28 });
ok(f.status === 200 && f.j.info && f.j.info.repo === 'none' && !f.j.info.schemaExists && !f.j.info.bucket && !f.j.info.fn, `altsis 미리 보기 (읽기만): 저장소·스키마·버킷·함수 없음 → 허브 행만 해당`);
f = await del(admin.at, 'preview', { app_id: 16 });
ok(f.status === 200, `beri 미리 보기 (읽기만): 저장소 ${f.j.info?.repo}, 스키마 ${f.j.info?.schemaOurs ? '표시 있음' : '표시 없음'}, 버킷 ${f.j.info?.bucket}`);
f = await del(admin.at, 'preview', { app_id: appId });
const pi = f.j.info;
ok(f.status === 200 && pi.repo === 'ours' && pi.schemaOurs && pi.fn && pi.bucket && pi.bucketFiles === 1 && pi.vault && pi.exposed && pi.devOurs && pi.fnRoleOurs, `zztest-del 미리 보기: 모두 찾음 (비밀값 ${pi?.secrets?.join(',')})`);

console.log('\n[4. 관리자 삭제 (백업 → 삭제)]');
const t0 = Date.now();
f = await del(admin.at, 'start', { app_id: appId, confirm_slug: SLUG, note: '삭제 시험' });
console.log(`  start → ${f.status} more=${f.j.more} ${f.j.error ?? ''} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
let dl = f.j.deletion;
for (let i = 0; f.status === 200 && f.j.more && i < 15; i++) {
  f = await del(admin.at, 'run', { deletion_id: dl.id }); dl = f.j.deletion ?? dl;
  console.log(`  run → ${f.status} more=${f.j.more} ${f.j.error ?? ''} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
}
[dl] = await sql(`select * from public.app_deletions where slug = '${SLUG}' order by id desc limit 1`);
ok(dl.status === 'done', `삭제 완료 (${dl.status} ${dl.error ?? ''})`);
console.log('  단계 메모:'); for (const [k, v] of Object.entries(dl.steps)) if (k.endsWith('_note')) console.log(`    ${k.replace('_note', '')}: ${v}`);

console.log('\n[5. 백업 확인]');
const files = Object.fromEntries((dl.backup_files || []).map((x) => [x.path, x.size]));
console.log(`  hub-backups/${dl.backup_prefix}: ${Object.keys(files).join(', ')}`);
const get = async (p) => { const x = await storage(`/object/hub-backups/${dl.backup_prefix}/${p.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'Content-Type': '' } }); return x.ok ? Buffer.from(await x.arrayBuffer()) : null; };
const man = JSON.parse((await get('manifest.json'))?.toString() || 'null');
ok(man && man.slug === SLUG, 'manifest.json');
const ddl = (await get('db/schema.sql'))?.toString() || '';
ok(/create table[^\n]*documents/i.test(ddl) && /enable row level security/i.test(ddl), `db/schema.sql 에 documents 표·RLS (${ddl.length}자)`);
const data = JSON.parse((await get('db/data/documents.json'))?.toString() || 'null');
const rows = Array.isArray(data) ? data : data?.rows;
ok(rows?.length === 1 && JSON.stringify(rows[0]).includes('삭제 시험 문서'), 'db/data/documents.json 에 넣은 행');
const bf = await get(`bucket/${FILE}`); ok(bf?.toString() === BODY, '버킷 파일 내용 그대로');
ok(!!(await get('bucket/_list.json')), 'bucket/_list.json');
const zip = await get(`repo/${SLUG}.zip`); ok(zip && zip.subarray(0, 2).toString() === 'PK' && zip.length > 1000, `저장소 zip (${zip?.length}B)`);
const es = Object.keys(files).find((p) => p.startsWith('function/') && p.endsWith('.eszip'));
ok(!!es && files[es] > 100, `서버 함수 원본 ${es} (${files[es]}B)`);
ok(!!(await get('hub.json')), 'hub.json (허브 앱 행·담당자·신청)');

console.log('\n[6. 모두 지워졌는지]');
const repo = await ghJson(`/repos/bmr-apps/${SLUG}`); ok(repo.status === 404, `저장소 없음 (${repo.status})`);
ok(!(await listFunctions()).includes(`${SLUG}-fn`), '서버 함수 없음');
ok(!(await listSecretNames()).some((x) => x.startsWith('ZZTEST_DEL_')), '함수 비밀값 없음');
r = await storage(`/bucket/${SLUG}`); ok(r.status === 400 || r.status === 404, `버킷 없음 (${r.status})`);
const [g] = await sql(`select exists (select 1 from pg_namespace where nspname = '${SCHEMA}') as s,
  (select count(*)::int from pg_roles where rolname in ('${SCHEMA}_dev','${SCHEMA}_fn')) as roles,
  exists (select 1 from vault.secrets where name = 'bmr_dbcred:${SLUG}') as v,
  (select count(*)::int from pg_policies where policyname like '${SLUG}: %') as pol,
  exists (select 1 from public.apps where slug = '${SLUG}') as app,
  (select count(*)::int from public.app_owners where app_id = ${appId}) as owners,
  (select app_deleted_at is not null from public.app_requests where id = ${req.id}) as marked`);
ok(!g.s, '스키마 없음'); ok(g.roles === 0, 'DB 계정 없음'); ok(!g.v, 'Vault 항목 없음'); ok(g.pol === 0, '버킷 정책 없음');
ok(!g.app && g.owners === 0, '허브 앱 행·담당자 없음'); ok(g.marked, '신청 기록은 남고 "앱 삭제됨" 표시');
const pg = await (await sbApi('/postgrest')).json();
ok(!String(pg.db_schema).split(',').map((x) => x.trim()).includes(SCHEMA), 'Data API 목록에서 빠짐');
f = await del(admin.at, 'run', { deletion_id: dl.id }); ok(f.status === 200 && f.j.more === false, '완료된 삭제 다시 실행 → 아무것도 안 함');
const aud = await sql(`select action, result from public.audit_log where target = '${SLUG}' and action like 'delete:%'`);
ok(aud.some((a) => a.action === 'delete:done') && aud.filter((a) => a.result === 'ok').length >= 14, `단계별 감사 기록 ${aud.length}건`);

console.log('\n[7. 다른 앱 그대로인지]');
const after = await snapshot();
for (const k of Object.keys(before)) ok(JSON.stringify(before[k]) === JSON.stringify(after[k]), `${k} 그대로`, JSON.stringify(after[k]).slice(0, 300));

console.log(`\n결과: ${pass} 통과, ${fail} 실패${fails.length ? '\n  - ' + fails.join('\n  - ') : ''}`);
process.exit(fail ? 1 : 0);
