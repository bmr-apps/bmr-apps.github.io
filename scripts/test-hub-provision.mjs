// hub-provision 끝까지 시험 (시험용 계정·시험 앱 zztest-auto). 비밀번호·토큰은 출력하지 않는다.
// 실제 계정·beri 는 건드리지 않는다. 정리는 따로: node scripts/test-hub-provision.mjs --cleanup
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SB_URL, apiKeys, sql, ghJson } from '../../bmr-app-templates/lib/common.mjs';

const SLUG = 'zztest-auto', SCHEMA = 'zztest_auto';
const PREFIX = 'hub-prov-test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ok = (c, l, extra = '') => { if (c) { pass++; console.log('  ✓', l); } else { fail++; fails.push(l); console.log('  ✗', l, extra); } };
const { pub, service } = await apiKeys();
const authH = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
const adm = (p, o = {}) => fetch(`${SB_URL}/auth/v1/admin/${p}`, { ...o, headers: authH });

if (process.argv.includes('--cleanup')) {
  const users = await sql(`select id, email from auth.users where email like '${PREFIX}-%@example.com'`);
  for (const u of users) { const r = await adm(`users/${u.id}`, { method: 'DELETE' }); console.log('시험 계정 삭제', u.email, r.status); }
  await sql(`delete from public.app_requests where slug in ('${SLUG}', 'zztest-pending', 'zztest-hack')`);
  console.log('시험 신청 행 삭제');
  process.exit(0);
}

const token = async (email, pw) => {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: pub, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
  return (await r.json()).access_token;
};
const mk = async (local, role) => {
  const email = `${PREFIX}-${local}@example.com`, pw = randomBytes(18).toString('base64url');
  const cr = await adm('users', { method: 'POST', body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { name: local } }) });
  const u = await cr.json(); if (!u.id) throw new Error(`계정 실패 ${cr.status}`);
  await sql(`update public.profiles set role = '${role}', name = '${local}' where id = '${u.id}'`);
  return { id: u.id, email, at: await token(email, pw) };
};
const rest = (tok, path, init = {}) => fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: pub, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
const fn = async (tok, action, body = {}) => {
  const r = await fetch(`${SB_URL}/functions/v1/hub-provision`, { method: 'POST', headers: { apikey: pub, Authorization: `Bearer ${tok}`, Origin: 'https://apps.bmrschool.net', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

// 이전 잔여 계정 정리
for (const u of await sql(`select id from auth.users where email like '${PREFIX}-%@example.com'`)) await adm(`users/${u.id}`, { method: 'DELETE' });
const admin = await mk('admin', 'admin'), staff = await mk('staff', 'staff'), pend = await mk('pending', 'pending');
console.log('시험 계정 3개 준비 (관리자·개발자·일반 사용자)');

console.log('\n[권한]');
const reqBody = { requester_name: '시험 개발자', requester_email: staff.email, app_name: '자동 생성 시험', slug: SLUG, purpose: 'hub-provision 자동 생성 시험 (곧 지움)', data_handled: '', has_student_pii: false, github_username: 'devgoodway' };
let r = await rest(pend.at, 'app_requests', { method: 'POST', body: JSON.stringify({ ...reqBody, slug: 'zztest-pending' }) });
ok(!r.ok, `일반 사용자는 신청할 수 없음 (${r.status})`);
r = await rest(staff.at, 'app_requests', { method: 'POST', body: JSON.stringify({ ...reqBody, slug: 'zztest-hack', provision_status: 'done', status: 'approved' }) });
ok(!r.ok, `개발자가 상태·진행 칸을 넣을 수 없음 (${r.status})`);
r = await rest(staff.at, 'app_requests', { method: 'POST', body: JSON.stringify({ ...reqBody, slug: 'hub' }) });
ok(!r.ok, `예약 주소(hub) 신청 거부 (${r.status})`);
r = await rest(staff.at, 'app_requests', { method: 'POST', body: JSON.stringify({ ...reqBody, slug: 'altsis' }) });
ok(!r.ok, `이미 있는 주소(altsis) 신청 거부 (${r.status})`);
r = await rest(staff.at, 'app_requests', { method: 'POST', body: JSON.stringify(reqBody) });
const req = (await r.json())[0];
ok(r.ok && req?.id, `개발자는 신청 가능 (#${req?.id})`);
r = await rest(staff.at, `app_requests?id=eq.${req.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });
ok(!r.ok, `개발자가 직접 승인 상태로 바꿀 수 없음 (${r.status})`);
r = await rest(staff.at, 'rpc/approve_request', { method: 'POST', body: JSON.stringify({ p_request_id: req.id }) });
ok(!r.ok, `개발자가 옛 승인 RPC 를 쓸 수 없음 (${r.status})`);
let f = await fn(staff.at, 'approve', { request_id: req.id });
ok(f.status === 403, `개발자 승인 요청 → 403 (${f.status})`);
f = await fn(pend.at, 'approve', { request_id: req.id });
ok(f.status === 403, `일반 사용자 승인 요청 → 403 (${f.status})`);
f = await fn(staff.at, 'add_owner', { app_id: 28, name: 'x', github_username: 'devgoodway' });
ok(f.status === 403, `개발자 담당자 추가 → 403 (${f.status})`);
f = await fn(null, 'approve', { request_id: req.id });
ok(f.status === 401, `로그인 없이 → 401 (${f.status})`);
r = await rest(staff.at, 'audit_log?select=id&limit=1');
ok(r.ok && (await r.json()).length === 0, '개발자는 감사 기록을 볼 수 없음');
r = await rest(staff.at, `app_requests?select=id&id=eq.${req.id}`);
ok(r.ok && (await r.json()).length === 1, '개발자는 내 신청을 볼 수 있음');

console.log('\n[승인 → 자동 생성]');
const t0 = Date.now();
f = await fn(admin.at, 'approve', { request_id: req.id, note: '자동 생성 시험' });
console.log(`  approve → ${f.status} more=${f.j.more} status=${f.j.request?.provision_status} ${f.j.error ?? ''} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
for (let i = 0; f.status === 200 && f.j.more && i < 10; i++) {
  f = await fn(admin.at, 'run', { request_id: req.id });
  console.log(`  run → ${f.status} more=${f.j.more} status=${f.j.request?.provision_status} ${f.j.error ?? ''} (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
}
const [rq] = await sql(`select status, provision_status, provision_steps, provision_error, app_id from public.app_requests where id = ${req.id}`);
ok(rq.status === 'approved' && rq.provision_status === 'done', `승인·생성 완료 (${rq.provision_status}) ${rq.provision_error ?? ''}`);
console.log('  단계:', Object.entries(rq.provision_steps).map(([k, v]) => `${k}=${v}`).join(' '));

console.log('\n[확인]');
const [d] = await sql(`select obj_description((select oid from pg_namespace where nspname='${SCHEMA}'),'pg_namespace') as c,
  (select count(*)::int from pg_roles where rolname in ('${SCHEMA}_dev','${SCHEMA}_fn')) as roles,
  to_regclass('${SCHEMA}.documents') is not null as docs,
  exists (select 1 from vault.secrets where name = 'bmr_dbcred:${SLUG}') as vault,
  (select count(*)::int from pg_policies where schemaname='storage' and policyname like '${SLUG}: %') as pol,
  (select row_to_json(a) from (select id, name, status, url, repo_url from public.apps where slug='${SLUG}') a) as app,
  (select json_agg(o) from (select github_username, gh_status, gh_error from public.app_owners o join public.apps a on a.id=o.app_id where a.slug='${SLUG}') o) as owners`);
ok(d.c === `bmr-app:${SLUG}:v2`, '스키마 + 표시');
ok(d.roles === 2, 'DB 역할 _dev, _fn');
ok(d.docs, '시작 표 documents');
ok(d.vault, '처음 DB 비밀번호 Vault 보관 (1회 받기 대기)');
ok(d.pol === 4, `버킷 정책 4개 (${d.pol})`);
ok(d.app?.status === 'preparing' && d.app?.id === rq.app_id, `허브 앱 행 (준비 중, id ${d.app?.id})`);
ok(d.owners?.[0]?.github_username === 'devgoodway' && ['active', 'invited'].includes(d.owners?.[0]?.gh_status), `담당자 + GitHub 상태 (${d.owners?.[0]?.gh_status} ${d.owners?.[0]?.gh_error ?? ''})`);
const b = await fetch(`${SB_URL}/storage/v1/bucket/${SLUG}`, { headers: authH }); const bj = await b.json();
ok(b.ok && bj.public === false, '비공개 버킷');
const h = await fetch(`${SB_URL}/functions/v1/${SLUG}-fn/health`); const hj = await h.json().catch(() => ({}));
ok(h.ok && hj.db === true, `서버 함수 /health db=true (${h.status})`);
const repo = await ghJson(`/repos/bmr-apps/${SLUG}`);
ok(repo.ok, '저장소 bmr-apps/zztest-auto');
const mark = await ghJson(`/repos/bmr-apps/${SLUG}/contents/.bmr-app.json`);
ok(mark.ok && JSON.parse(Buffer.from(mark.data.content, 'base64').toString()).slug === SLUG, '저장소 표시 .bmr-app.json');
const tree = await ghJson(`/repos/bmr-apps/${SLUG}/git/trees/main?recursive=1`);
const paths = (tree.data?.tree ?? []).map((t) => t.path);
ok(['index.html', 'src/app-info.js', 'package-lock.json', `supabase/functions/${SLUG}-fn/index.ts`, '.github/workflows/deploy.yml'].every((p) => paths.includes(p)), `저장소 파일 ${paths.filter((p) => !p.includes('/') || p.split('/').length < 5).length}개`);
const pages = await ghJson(`/repos/bmr-apps/${SLUG}/pages`);
ok(pages.ok && pages.data.build_type === 'workflow', 'GitHub Pages (Actions)');
const vars = await ghJson(`/repos/bmr-apps/${SLUG}/actions/variables`);
ok((vars.data?.variables ?? []).length === 2, 'Actions 변수 2개');
const perm = await ghJson(`/repos/bmr-apps/${SLUG}/collaborators/devgoodway/permission`);
console.log(`  devgoodway 권한: ${perm.data?.role_name ?? perm.status}`);

console.log('\n[다시 시도·멱등]');
f = await fn(admin.at, 'run', { request_id: req.id });
ok(f.status === 200 && f.j.more === false, '완료된 신청 다시 실행 → 아무것도 안 함');
f = await fn(admin.at, 'approve', { request_id: req.id });
ok(f.status === 409, `이미 승인된 신청 다시 승인 → 409 (${f.status})`);

console.log('\n[앱 정보 실시간 반영 · slug 잠금]');
const info = async () => (await (await fetch(`${SB_URL}/rest/v1/rpc/app_public_info`, { method: 'POST', headers: { apikey: pub, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_slug: SLUG }) })).json());
ok((await info())?.name === '자동 생성 시험', '공개 키로 앱 이름 읽기');
r = await rest(admin.at, `apps?id=eq.${rq.app_id}`, { method: 'PATCH', body: JSON.stringify({ name: '자동 생성 시험 (이름 바꿈)', description: '설명도 바꿈' }) });
const i2 = await info();
ok(r.ok && i2?.name === '자동 생성 시험 (이름 바꿈)' && i2?.description === '설명도 바꿈', '허브에서 고친 이름·설명이 바로 반영');
r = await rest(admin.at, `apps?id=eq.${rq.app_id}`, { method: 'PATCH', body: JSON.stringify({ slug: 'zztest-renamed' }) });
ok(!r.ok, `관리자도 화면(API)에서 slug 못 바꿈 (${r.status})`);
r = await rest(admin.at, 'app_owners', { method: 'POST', body: JSON.stringify({ app_id: rq.app_id, name: 'x' }) });
ok(!r.ok, `담당자 표는 서버 함수로만 바꿈 (직접 추가 ${r.status})`);

console.log('\n[담당자 GitHub 동기화]');
const ghost = 'bmr-nouser-7f3k9q2x';
const gu = await fetch(`https://api.github.com/users/${ghost}`); await gu.body?.cancel();
if (gu.status !== 404) console.log('  (가짜 아이디가 실제로 있어 실패 시험을 건너뜀)');
else {
  f = await fn(admin.at, 'add_owner', { app_id: rq.app_id, name: '없는 사용자', github_username: ghost });
  ok(f.status === 200 && f.j.github?.status === 'failed', `없는 GitHub 아이디 → 실패 표시 (${f.j.github?.status} ${f.j.github?.error ?? ''})`);
  const oid = f.j.owner_id;
  f = await fn(admin.at, 'update_owner', { owner_id: oid, name: '아이디 없음', github_username: '' });
  ok(f.status === 200, `담당자 수정 (GitHub 아이디 지움) ${f.status}`);
  f = await fn(admin.at, 'remove_owner', { owner_id: oid });
  ok(f.status === 200, `담당자 빼기 ${f.status}`);
}
const [own] = await sql(`select o.id from public.app_owners o where o.app_id = ${rq.app_id} and github_username = 'devgoodway'`);
f = await fn(admin.at, 'sync_owner', { owner_id: own.id });
ok(f.status === 200 && f.j.github?.status === 'active', `권한 확인 → ${f.j.github?.status} (${f.j.github?.detail ?? f.j.github?.error ?? ''})`);
f = await fn(admin.at, 'add_owner', { app_id: rq.app_id, name: '나쁜 입력', github_username: 'a/../../x' });
ok(f.status === 400, `잘못된 GitHub 아이디 형식 → 400 (${f.status})`);

const aud = await sql(`select action, result from public.audit_log where target like '${SLUG}%' or target = '${req.id}' order by id`);
ok(aud.some((a) => a.result === 'denied') && aud.some((a) => a.action === 'provision:done'), `감사 기록 ${aud.length}건 (거부 ${aud.filter((a) => a.result === 'denied').length})`);

console.log(`\n결과: ${pass} 통과, ${fail} 실패${fails.length ? '\n  - ' + fails.join('\n  - ') : ''}`);
process.exit(fail ? 1 : 0);
