// 새 앱 '준비 중' 공개 페이지 + 허브 '개발 정보'(담당자·관리자만) 시험. zztest-guide 를 만들고 → 확인 → 캡처 → hub-deprovision 으로 삭제 → 정리.
// 비밀번호·토큰은 출력하지 않는다. 사용: node scripts/test-dev-info.mjs [캡처 폴더]
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { SB_URL, apiKeys, sql, ghJson } from '../../bmr-app-templates/lib/common.mjs';
const SLUG = 'zztest-guide', PREFIX = 'hub-guide-test', OUT = process.argv[2] || '/workspace/bmr-apps-hub-shots', HUB = 'https://apps.bmrschool.net';
let pass = 0, fail = 0; const fails = [];
const ok = (c, l, x = '') => { if (c) { pass++; console.log('  ✓', l); } else { fail++; fails.push(l); console.log('  ✗', l, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { pub, service } = await apiKeys();
const H = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
const adm = (p, o = {}) => fetch(`${SB_URL}/auth/v1/admin/${p}`, { ...o, headers: H });
const rmUsers = async () => { await sql(`delete from bmr_admin.provision_attempts where user_id in (select id from auth.users where email like '${PREFIX}-%@example.com')`); for (const u of await sql(`select id from auth.users where email like '${PREFIX}-%@example.com'`)) await adm(`users/${u.id}`, { method: 'DELETE' }); };
await rmUsers();
const mk = async (local, role) => {
  const email = `${PREFIX}-${local}@example.com`, pw = randomBytes(18).toString('base64url');
  const u = await (await adm('users', { method: 'POST', body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { name: local } }) })).json();
  await sql(`update public.profiles set role = '${role}', name = '${local}' where id = '${u.id}'`);
  const s = await (await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: pub, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })).json();
  return { id: u.id, email, at: s.access_token, sess: s };
};
const rpc = async (tok, appId) => { const r = await fetch(`${SB_URL}/rest/v1/rpc/app_dev_info`, { method: 'POST', headers: { apikey: pub, ...(tok ? { Authorization: `Bearer ${tok}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ p_app_id: appId }) }); return { status: r.status, j: await r.json().catch(() => null) }; };
const fn = (name) => async (tok, action, body = {}) => { const r = await fetch(`${SB_URL}/functions/v1/${name}`, { method: 'POST', headers: { apikey: pub, Authorization: `Bearer ${tok}`, Origin: HUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const prov = fn('hub-provision'), del = fn('hub-deprovision');

const admin = await mk('admin', 'admin'), owner = await mk('owner', 'staff'), other = await mk('other', 'staff');
let appId, reqId;
try {
  console.log('[1. zztest-guide 만들기]');
  const r = await fetch(`${SB_URL}/rest/v1/app_requests`, { method: 'POST', headers: { apikey: pub, Authorization: `Bearer ${owner.at}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ requester_name: '가이드 시험', requester_email: owner.email, app_name: '가이드 시험 앱', slug: SLUG, purpose: '준비 중 페이지·개발 정보 시험 (곧 지움)', data_handled: '', has_student_pii: false, github_username: 'devgoodway' }) });
  reqId = (await r.json())[0]?.id; ok(!!reqId, `신청 #${reqId}`);
  let f = await prov(admin.at, 'approve', { request_id: reqId, note: '시험' });
  for (let i = 0; f.status === 200 && f.j.more && i < 10; i++) f = await prov(admin.at, 'run', { request_id: reqId });
  const [rq] = await sql(`select provision_status, provision_error, app_id from public.app_requests where id = ${reqId}`);
  ok(rq.provision_status === 'done', `생성 완료 ${rq.provision_error ?? ''}`); appId = rq.app_id;
  await sql(`update public.apps set description = '준비 중 페이지 시험용 설명입니다' where id = ${appId}`);

  console.log('[2. 공개 페이지는 준비 중 안내만]');
  const idx = await ghJson(`/repos/bmr-apps/${SLUG}/contents/index.html`);
  const html = Buffer.from(idx.data.content, 'base64').toString();
  ok(html.includes('준비 중인 페이지입니다'), '저장소 index.html: 준비 중 안내');
  ok(!/_dev|functions\/v1|zztest_guide|DATABASE_URL|supabase\.co|<code>/.test(html), '저장소 index.html: 스키마·계정·함수 주소·코드 없음');
  let live = '';
  for (let i = 0; i < 40; i++) { const x = await fetch(`${HUB}/${SLUG}/`, { cache: 'no-store' }); live = x.ok ? await x.text() : ''; if (live.includes('준비 중인 페이지입니다')) break; await sleep(10000); }
  ok(live.includes('준비 중인 페이지입니다') && !/_dev|functions\/v1|zztest_guide/.test(live), `배포된 ${HUB}/${SLUG}/ : 준비 중 안내만`);
  const readme = Buffer.from((await ghJson(`/repos/bmr-apps/${SLUG}/contents/README.md`)).data.content, 'base64').toString();
  ok(readme.includes('zztest_guide_dev') && readme.includes('/guide'), 'README.md 에는 개발 안내 유지 (+ 가이드 링크)');

  console.log('[3. 개발 정보는 담당자·관리자만]');
  let d = await rpc(owner.at, appId); ok(d.status === 200 && d.j?.schema === 'zztest_guide' && d.j?.dev_role === 'zztest_guide_dev' && d.j?.is_owner === true && d.j?.bucket === SLUG && d.j?.fn === `${SLUG}-fn`, `담당자: 개발 정보 받음 (표 ${d.j?.tables?.join(',')}, 처음 비밀번호 대기 ${d.j?.pending_initial})`);
  d = await rpc(other.at, appId); ok(d.status === 200 && d.j === null, '다른 개발자: 아무것도 못 받음 (null)');
  d = await rpc(admin.at, appId); ok(d.status === 200 && d.j?.schema === 'zztest_guide' && d.j?.is_owner === false, '관리자: 받음 (관리자 보기)');
  d = await rpc(null, appId); ok(d.status !== 200 || d.j === null, `로그인 없이: 거부 (${d.status})`);
  ok(!JSON.stringify((await rpc(admin.at, appId)).j).match(/password|secret_value|sb_secret|eyJ/), '응답에 비밀값 없음');

  console.log('[4. 캡처]');
  const require = createRequire('/workspace/bmr-designer-supabase/package.json');
  const { chromium } = require('@playwright/test');
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const page = async (u, w, h, full = true) => { const c = await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', deviceScaleFactor: w < 500 ? 2 : 1 }); if (u) await c.addInitScript((s) => { localStorage.setItem('bmr-apps-hub-auth', JSON.stringify(s)); localStorage.setItem('bmr-theme', 'light'); }, u.sess); return [c, await c.newPage()]; };
  let [c, p] = await page(null, 1280, 800); await p.goto(`${HUB}/${SLUG}/`); await p.waitForTimeout(2500); await p.screenshot({ path: `${OUT}/fix3-placeholder-page.png`, fullPage: true });
  ok((await p.locator('h1').innerText()).includes('가이드 시험 앱') && (await p.locator('.desc').innerText()).includes('시험용 설명'), '준비 중 페이지: 허브의 이름·설명 반영'); await c.close();
  [c, p] = await page(null, 390, 800); await p.goto(`${HUB}/${SLUG}/`); await p.waitForTimeout(2000); await p.screenshot({ path: `${OUT}/fix3-placeholder-page-mobile.png`, fullPage: true }); await c.close();
  const openApp = async (u, file, mine = false) => {
    [c, p] = await page(u, 1280, 900); await p.goto(`${HUB}/hub/`); await p.waitForSelector('.tile', { timeout: 20000 });
    if (mine) await p.getByRole('tab', { name: /내 서비스/ }).click();
    await p.getByText('가이드 시험 앱').first().click(); await p.waitForTimeout(2500);
    const has = await p.locator('.devinfo').count();
    if (file) { await p.locator('.modal').screenshot({ path: `${OUT}/${file}` }); }
    await c.close(); return has;
  };
  ok(await openApp(owner, 'fix3-app-detail-devinfo-owner.png', true) === 1, '허브 화면: 담당자에게 개발 정보 보임');
  ok(await openApp(other, 'fix3-app-detail-other-staff.png') === 0, '허브 화면: 다른 개발자에게는 안 보임');
  ok(await openApp(admin, 'fix3-app-detail-devinfo-admin.png') === 1, '허브 화면: 관리자에게 보임');
  [c, p] = await page(other, 1280, 900); await p.goto(`${HUB}/hub/`); await p.waitForSelector('.tile'); await p.getByRole('tab', { name: /내 서비스/ }).click(); await p.waitForTimeout(400);
  ok(await p.locator('.tile').count() === 0, "다른 개발자 '내 서비스' 탭: 비어 있음"); await c.close();
  [c, p] = await page(owner, 1280, 900); await p.goto(`${HUB}/hub/`); await p.waitForSelector('.tile'); await p.getByRole('tab', { name: /내 서비스/ }).click(); await p.waitForTimeout(500);
  ok(await p.locator('.tile').count() === 1, "대시보드 '내 서비스' 탭: 내 앱만"); await p.screenshot({ path: `${OUT}/fix3-dashboard-mine.png` }); await c.close();
  await b.close();
} finally {
  console.log('[5. 삭제 · 정리]');
  if (appId) {
    let f = await del(admin.at, 'start', { app_id: appId, confirm_slug: SLUG, note: '가이드 시험 정리' });
    let dl = f.j.deletion;
    for (let i = 0; f.status === 200 && f.j.more && i < 15; i++) { f = await del(admin.at, 'run', { deletion_id: dl.id }); dl = f.j.deletion ?? dl; }
    ok(f.status === 200 && (f.j.deletion?.status ?? dl?.status) === 'done', `hub-deprovision 삭제 ${f.status} ${f.j.error ?? ''}`);
    const repo = await ghJson(`/repos/bmr-apps/${SLUG}`); ok(repo.status === 404, '저장소 삭제됨');
    const [g] = await sql(`select exists (select 1 from pg_namespace where nspname='zztest_guide') s, exists (select 1 from public.apps where slug='${SLUG}') a`); ok(!g.s && !g.a, '스키마·허브 행 삭제됨');
  }
  const objs = await sql(`select name from storage.objects where bucket_id = 'hub-backups' and name like '${SLUG}/%'`);
  if (objs.length) await fetch(`${SB_URL}/storage/v1/object/hub-backups`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: objs.map((o) => o.name) }) });
  await sql(`delete from public.app_deletions where slug = '${SLUG}'`); await sql(`delete from public.app_requests where slug = '${SLUG}'`);
  await sql(`delete from public.audit_log where target = '${SLUG}' or actor_email like '${PREFIX}-%@example.com' or target = '${reqId ?? -1}'`);
  await rmUsers();
  const [left] = await sql(`select (select count(*) from storage.objects where bucket_id='hub-backups' and name like '${SLUG}/%') b, (select count(*) from auth.users where email like '${PREFIX}-%') u`);
  ok(Number(left.b) === 0 && Number(left.u) === 0, `시험 백업 ${objs.length}개·계정 정리`);
  console.log(`\n결과: ${pass} 통과, ${fail} 실패${fails.length ? '\n  - ' + fails.join('\n  - ') : ''}`);
}
