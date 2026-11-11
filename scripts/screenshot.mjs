// 로컬 미리보기 캡처 (Supabase 응답은 가짜 데이터로 대신한다). 사용: npm run build 후 vite preview 를 띄우고 node scripts/screenshot.mjs
import { createRequire } from 'node:module';
const require = createRequire('/workspace/bmr-designer-supabase/package.json');
const { chromium } = require('@playwright/test');
const BASE = 'http://localhost:4173';
const now = new Date().toISOString();
const apps = [
  { id: 1, slug: 'designer', name: '별무리 수업 디자이너', description: '교과 수업 설계와 역량 루브릭을 돕는 도구', url: 'https://bmr-designer.vercel.app', repo_url: null, supabase_ref: 'vzrfjqazgufhiucdsjga', status: 'active', note: 'https://apps.bmrschool.net/designer (bmr-apps/designer 저장소)로 옮길 예정', sort: 10, created_at: now, updated_at: now },
  { id: 2, slug: 'library', name: '도서 대출 관리(예시)', description: '학교 도서관 대출·반납 기록', url: 'https://apps.bmrschool.net/library', repo_url: 'https://github.com/bmr-apps/library', supabase_ref: null, status: 'preparing', note: '', sort: 100, created_at: now, updated_at: now },
];
const data = {
  apps, profiles: [{ id: 'u1', email: 'bmrdev@bmrschool.org', name: '관리자', role: 'admin', created_at: now }],
  app_owners: [{ id: 1, app_id: 1, name: '조은길', email: 'bmrdev@bmrschool.org', github_username: 'devgoodway', role: '책임' }],
  app_health_latest: [{ app_id: 1, checked_at: now, url: apps[0].url, http_status: 200, ok: true, response_ms: 605, error: null }],
  health_checks: Array.from({ length: 12 }, (_, i) => ({ app_id: 1, checked_at: now, url: apps[0].url, http_status: 200, ok: i !== 3, response_ms: 600, error: null })),
  token_logs: [
    { id: 1, app_id: null, kind: 'github_pat', label: 'bmr-apps-bot', issued_to: '조은길', issued_at: '2026-11-11', expires_at: '2027-02-09', revoked_at: null, memo: 'bmr-apps 전체 저장소', created_at: now },
    { id: 2, app_id: 1, kind: 'supabase_service_role', label: 'designer 서버', issued_to: '조은길', issued_at: '2026-08-20', expires_at: '2026-11-20', revoked_at: null, memo: '', created_at: now },
  ],
  app_requests: [{ id: 1, requested_by: 'u1', requester_name: '김선생', requester_email: null, app_name: '도서 대출 관리', slug: 'library', purpose: '도서 대출·반납 기록', data_handled: '학생 이름·학번', has_student_pii: true, github_username: 'kim-teacher', status: 'pending', review_note: '', reviewed_at: null, app_id: null, created_at: now }],
};
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
async function shot(path, file, loggedIn, height = 900) {
  const ctx = await b.newContext({ viewport: { width: 1280, height }, locale: 'ko-KR' });
  if (loggedIn) await ctx.addInitScript(() => localStorage.setItem('bmr-apps-hub-auth', JSON.stringify({
    access_token: 'x.eyJzdWIiOiJ1MSJ9.x', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
    user: { id: 'u1', email: 'bmrdev@bmrschool.org', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-11T00:00:00Z' } })));
  const p = await ctx.newPage();
  const errs = []; p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.route('https://abcdefghijklmnopqrst.supabase.co/**', (r) => {
    const u = new URL(r.request().url()); const t = u.pathname.split('/').pop();
    let body = data[t] ?? [];
    if (t === 'profiles' && /single|vnd\.pgrst\.object/.test(r.request().headers()['accept'] || '')) body = data.profiles[0];
    if (t === 'apps' && !loggedIn) body = apps.filter((a) => a.status === 'active');
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.goto(BASE + path); await p.waitForTimeout(1200);
  await p.screenshot({ path: file, fullPage: true }); await ctx.close();
  console.log(file, errs.length ? '콘솔 오류: ' + errs.join(' | ') : '콘솔 오류 없음');
}
await shot('/', 'screenshot.png', false, 700);
await shot('/hub/apps', 'screenshot-apps.png', true);
await shot('/hub/requests', 'screenshot-requests.png', true);
await shot('/hub/tokens', 'screenshot-tokens.png', true);
await shot('/hub/status', 'screenshot-status.png', true, 600);
await shot('/hub/login', 'screenshot-login.png', false, 700);
await b.close();
