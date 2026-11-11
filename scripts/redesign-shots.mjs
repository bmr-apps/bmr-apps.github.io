// 실제 Supabase(읽기 전용)로 새 디자인 캡처. 사용: npm run build && npx vite preview & HUB_ADMIN_PASSWORD=... node scripts/redesign-shots.mjs
import { createRequire } from 'node:module';
const require = createRequire('/workspace/bmr-designer-supabase/package.json');
const { chromium } = require('@playwright/test');
const BASE = 'http://localhost:4173';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const errs = [];
async function ctxFor(theme, state, vp = { width: 1440, height: 900 }) {
  const c = await b.newContext({ viewport: vp, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: state, deviceScaleFactor: 1 });
  await c.addInitScript((t) => localStorage.setItem('bmr-theme', t), theme);
  return c;
}
async function page(c) { const p = await c.newPage(); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e))); return p; }
// 로그인 (비밀번호는 환경 변수에서만)
const lc = await ctxFor('light'); const lp = await page(lc);
await lp.goto(BASE + '/hub/login'); await lp.waitForTimeout(800);
await lp.screenshot({ path: 'redesign-login-light.png' });
await lp.fill('input[type=email]', 'dev@bmrschool.org'); await lp.fill('input[type=password]', process.env.HUB_ADMIN_PASSWORD || '');
await lp.click('form button:not(.ghost)'); await lp.waitForURL('**/hub/apps', { timeout: 15000 }); await lp.waitForTimeout(2000);
const state = await lc.storageState(); await lc.close();

async function shot(theme, path, file, opts = {}) {
  const c = await ctxFor(theme, opts.anon ? undefined : state, opts.vp); const p = await page(c);
  await p.goto(BASE + path); await p.waitForTimeout(2200);
  if (opts.act) await opts.act(p);
  await p.screenshot({ path: file, fullPage: !!opts.full }); await c.close(); console.log('saved', file);
}
await shot('dark', '/hub/apps', 'redesign-dashboard-dark.png');
await shot('light', '/hub/apps', 'redesign-dashboard-light.png');
await shot('light', '/hub/apps', 'redesign-app-detail-light.png', { act: async (p) => { await p.click('.tile'); await p.waitForTimeout(500); } });
await shot('dark', '/hub/status', 'redesign-status-dark.png');
await shot('light', '/hub/status', 'redesign-status-light.png');
await shot('light', '/hub/requests', 'redesign-requests-light.png', { full: true });
await shot('dark', '/hub/tokens', 'redesign-tokens-dark.png', { full: true });
await shot('light', '/hub/members', 'redesign-members-light.png');
await shot('dark', '/hub/apps', 'redesign-palette-dark.png', { act: async (p) => { await p.keyboard.press('Control+K'); await p.waitForTimeout(400); } });
await shot('light', '/', 'redesign-landing-light.png', { anon: true });
await shot('dark', '/', 'redesign-landing-dark.png', { anon: true });
await shot('dark', '/hub/login', 'redesign-login-dark.png', { anon: true });
await shot('light', '/hub/apps', 'redesign-mobile-light.png', { vp: { width: 390, height: 844 }, full: true });
await shot('dark', '/hub/apps', 'redesign-mobile-menu-dark.png', { vp: { width: 390, height: 844 }, act: async (p) => { await p.click('.burger'); await p.waitForTimeout(400); } });
await b.close();
console.log(errs.length ? '콘솔 오류: ' + [...new Set(errs)].join(' | ') : '콘솔 오류 없음');
