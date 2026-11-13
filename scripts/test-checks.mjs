// 공용 주소 점검(경고만) 끝까지 시험: zztest-check 를 만들고 → 일부러 문제 있는 파일을 push → GitHub Actions 가 OIDC 로 hub-checks 에 보냄
// → app_checks 저장·RLS(담당자·관리자만)·화면 확인 → 캡처 → hub-deprovision 으로 삭제 → 정리.
// 비밀번호·토큰은 출력하지 않는다. 사용: node scripts/test-checks.mjs [캡처 폴더]
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { SB_URL, apiKeys, sql, ghJson } from '../../bmr-app-templates/lib/common.mjs';
const SLUG = 'zztest-check', PREFIX = 'hub-check-test', OUT = process.argv[2] || '/workspace/bmr-apps-hub-shots', HUB = 'https://apps.bmrschool.net';
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
const rest = async (tok, q) => { const r = await fetch(`${SB_URL}/rest/v1/${q}`, { headers: { apikey: pub, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } }); return { status: r.status, j: await r.json().catch(() => null) }; };
const waitCheck = async (sha, label) => {
  for (let i = 0; i < 36; i++) { const [row] = await sql(`select * from public.app_checks where app_id = ${appId}`); if (row && (!sha || row.commit_sha === sha)) return row; await sleep(10000); }
  ok(false, `${label}: 6분 안에 결과가 오지 않음`); return null;
};
const BAD = `// 공용 주소 점검 시험용 (일부러 문제 있는 코드)
localStorage.clear();
localStorage.setItem('theme', 'dark');
localStorage.setItem('zztest-check:theme', 'dark');
sessionStorage.clear(); // bmr-allow: 시험 — 이 줄은 건너뛰어야 함
fetch('/data.json');
navigator.serviceWorker.register('/sw.js');
import('https://esm.sh/lodash');
`;
try {
  console.log('[1. zztest-check 만들기]');
  const r = await fetch(`${SB_URL}/rest/v1/app_requests`, { method: 'POST', headers: { apikey: pub, Authorization: `Bearer ${owner.at}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ requester_name: '점검 시험', requester_email: owner.email, app_name: '점검 시험 앱', slug: SLUG, purpose: '공용 주소 점검 시험 (곧 지움)', data_handled: '', has_student_pii: false, github_username: 'devgoodway' }) });
  reqId = (await r.json())[0]?.id; ok(!!reqId, `신청 #${reqId}`);
  let f = await prov(admin.at, 'approve', { request_id: reqId, note: '시험' });
  for (let i = 0; f.status === 200 && f.j.more && i < 10; i++) f = await prov(admin.at, 'run', { request_id: reqId });
  const [rq] = await sql(`select provision_status, provision_error, app_id from public.app_requests where id = ${reqId}`);
  ok(rq.provision_status === 'done', `생성 완료 ${rq.provision_error ?? ''}`); appId = rq.app_id;
  const cfg = JSON.parse(Buffer.from((await ghJson(`/repos/bmr-apps/${SLUG}/contents/.bmr-check.json`)).data.content, 'base64').toString());
  ok(cfg.slug === SLUG && cfg.hub === `${SB_URL}/functions/v1/hub-checks` && cfg.block_dangerous === false, '새 저장소에 점검 설정(.bmr-check.json) 들어감');
  ok((await ghJson(`/repos/bmr-apps/${SLUG}/contents/src/store.js`)).status === 200 && (await ghJson(`/repos/bmr-apps/${SLUG}/contents/.github/workflows/bmr-check.yml`)).status === 200, '새 저장소에 store.js · 점검 워크플로 들어감');

  console.log('[2. 처음 push 결과 (시작 코드는 경고 0)]');
  let row = await waitCheck(null, '처음 결과');
  ok(row && row.total === 0, `처음 결과: 경고 ${row?.total}건 (커밋 ${row?.commit_sha?.slice(0, 7)})`);

  console.log('[3. 문제 있는 파일 push → 경고]');
  const put = await ghJson(`/repos/bmr-apps/${SLUG}/contents/src/demo-bad.js`, { method: 'PUT', body: JSON.stringify({ message: '점검 시험: 일부러 문제 있는 코드', content: Buffer.from(BAD).toString('base64'), committer: { name: 'BMR APPS 봇', email: 'bot@bmrschool.net' } }) });
  const sha = put.data?.commit?.sha; ok(!!sha, `push ${sha?.slice(0, 7)}`);
  row = await waitCheck(sha, '두 번째 결과');
  const rules = (row?.warnings ?? []).map((w) => w.rule).sort().join(',');
  ok(row && row.total === 5 && rules === 'abs-path,ext-script,storage-clear,storage-key,sw-scope', `경고 5건 · 규칙 5종 (${rules})`);
  ok(row && !row.warnings.some((w) => w.line === 5), 'bmr-allow 줄은 건너뜀');
  ok(row && row.new_count === 5 && row.run_url?.includes(`/bmr-apps/${SLUG}/actions/runs/`) && row.warnings.every((w) => w.fix), '새 경고 5건 · 실행 링크 · 고치는 법 포함');
  const runs = (await ghJson(`/repos/bmr-apps/${SLUG}/actions/runs?head_sha=${sha}`)).data.workflow_runs;
  const run = runs.find((x) => x.name === '공용 주소 점검'); ok(run?.conclusion === 'success', `경고가 있어도 워크플로는 통과 (${run?.conclusion})`);

  console.log('[4. 보는 권한]');
  let q = await rest(owner.at, `app_checks?app_id=eq.${appId}&select=total`); ok(q.status === 200 && q.j?.length === 1, '담당 개발자: 보임');
  q = await rest(other.at, `app_checks?app_id=eq.${appId}&select=total`); ok(q.status === 200 && q.j?.length === 0, '다른 개발자: 안 보임');
  q = await rest(admin.at, `app_checks?select=app_id`); ok(q.status === 200 && q.j?.some((x) => x.app_id === appId), '관리자: 전체 보임');
  q = await rest(null, `app_checks?select=app_id`); ok(q.status !== 200 || q.j?.length === 0, `로그인 없이: 안 보임 (${q.status})`);
  const forged = await fetch(`${SB_URL}/functions/v1/hub-checks`, { method: 'POST', headers: { Authorization: `Bearer ${owner.at}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ warnings: [] }) });
  ok(forged.status === 401, `허브 로그인 토큰으로 결과 위조 시도: 거부 (${forged.status})`);

  console.log('[5. 화면 · 캡처]');
  const require = createRequire('/workspace/bmr-designer-supabase/package.json');
  const { chromium } = require('@playwright/test');
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const page = async (u, w, h) => { const c = await b.newContext({ viewport: { width: w, height: h }, locale: 'ko-KR', deviceScaleFactor: w < 500 ? 2 : 1 }); if (u) await c.addInitScript((s) => { localStorage.setItem('bmr-apps-hub-auth', JSON.stringify(s)); localStorage.setItem('bmr-theme', 'light'); }, u.sess); return [c, await c.newPage()]; };
  const openApp = async (u, file) => {
    const [c, p] = await page(u, 1280, 3000); await p.goto(`${HUB}/hub/`); await p.waitForSelector('.tile', { timeout: 20000 });
    await p.getByText('점검 시험 앱').first().click(); await p.waitForTimeout(3000);
    const n = await p.locator('.checks .check-list li').count();
    if (file && n) await p.locator('.checks').screenshot({ path: `${OUT}/${file}` });
    await c.close(); return n;
  };
  ok(await openApp(owner, 'fix8-app-detail-checks-owner.png') === 5, '앱 정보: 담당 개발자에게 경고 5건 보임');
  ok(await openApp(other) === 0, '앱 정보: 다른 개발자에게는 안 보임');
  ok(await openApp(admin, 'fix8-app-detail-checks-admin.png') === 5, '앱 정보: 관리자에게 보임');
  { const [c, p] = await page(admin, 1280, 900); await p.goto(`${HUB}/hub/status`); await p.waitForSelector('text=공용 주소 점검 (경고만)', { timeout: 20000 }); await p.waitForTimeout(1500);
    const sec = p.locator('h3', { hasText: '공용 주소 점검' }); await sec.scrollIntoViewIfNeeded();
    const txt = await p.locator('.card.flush').last().innerText(); ok(txt.includes('점검 시험 앱') && txt.includes('별무리 교육 연구소'), '운영 상태: 관리자 요약에 앱별 경고');
    await p.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.includes('공용 주소 점검')); window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 90); }); await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/fix8-status-checks-admin.png` }); await c.close(); }
  { const [c, p] = await page(null, 1280, 900); await p.goto(run.html_url); await p.waitForTimeout(4000); await p.screenshot({ path: `${OUT}/fix8-github-run-summary.png`, fullPage: true }); await c.close(); }
  await b.close();
} finally {
  console.log('[5. 삭제 · 정리]');
  if (appId) {
    let f = await del(admin.at, 'start', { app_id: appId, confirm_slug: SLUG, note: '점검 시험 정리' });
    let dl = f.j.deletion;
    for (let i = 0; f.status === 200 && f.j.more && i < 15; i++) { f = await del(admin.at, 'run', { deletion_id: dl.id }); dl = f.j.deletion ?? dl; }
    ok(f.status === 200 && (f.j.deletion?.status ?? dl?.status) === 'done', `hub-deprovision 삭제 ${f.status} ${f.j.error ?? ''}`);
    const repo = await ghJson(`/repos/bmr-apps/${SLUG}`); ok(repo.status === 404, '저장소 삭제됨');
    const [g] = await sql(`select exists (select 1 from pg_namespace where nspname='zztest_check') s, exists (select 1 from public.apps where slug='${SLUG}') a`); ok(!g.s && !g.a, '스키마·허브 행 삭제됨');
    const [cc] = await sql(`select count(*)::int n from public.app_checks where app_id = ${appId}`); ok(cc.n === 0, '점검 결과도 함께 삭제됨');
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
