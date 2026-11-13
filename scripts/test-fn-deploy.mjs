#!/usr/bin/env node
// 서버 함수 자동 배포(hub-fn-deploy) 거부 시험 — 아무것도 배포하지 않는다. 토큰은 출력하지 않는다.
// 진짜 배포 확인은 앱 저장소 Actions(서버 함수 검사·배포)의 Summary 와 허브 감사 기록(fn:deploy)으로 한다.
// 사용: node scripts/test-fn-deploy.mjs
const U = 'https://psupfmarnyxontorftio.supabase.co/functions/v1/hub-fn-deploy';
let fail = 0;
const ok = (c, l, x = '') => { console.log(c ? '  ✓' : '  ✗', l, c ? '' : x); if (!c) fail++; };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const claims = { iss: 'https://token.actions.githubusercontent.com', aud: 'bmr-apps-fn-deploy', repository: 'bmr-apps/class-designer', repository_owner: 'bmr-apps',
  ref: 'refs/heads/main', event_name: 'push', workflow_ref: 'bmr-apps/class-designer/.github/workflows/functions-check.yml@refs/heads/main', exp: 9999999999 };
const call = async (auth, method = 'POST') => { const r = await fetch(U, { method, headers: auth ? { Authorization: `Bearer ${auth}` } : {} }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
let r = await call(null); ok(r.s === 401, `토큰 없음 → 401`, r.s);
r = await call(null, 'GET'); ok(r.s === 405, `GET → 405`, r.s);
r = await call('abc.def.ghi'); ok(r.s === 401, `엉터리 토큰 → 401`, r.s);
r = await call(`${b64({ alg: 'none' })}.${b64(claims)}.`); ok(r.s === 401, `서명 없는 토큰(alg none) → 401`, r.s);
r = await call(`${b64({ alg: 'RS256', kid: 'x' })}.${b64(claims)}.${Buffer.from('sig').toString('base64url')}`); ok(r.s === 401, `위조 서명 → 401`, r.s);
r = await call(`${b64({ alg: 'HS256' })}.${b64(claims)}.${Buffer.from('sig').toString('base64url')}`); ok(r.s === 401, `HS256 토큰 → 401`, r.s);
console.log(fail ? `✗ ${fail}개 실패` : '✓ 모두 통과'); process.exit(fail ? 1 : 0);
