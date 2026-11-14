#!/usr/bin/env node
// 허브 AI 게이트웨이(hub-ai) 준비·배포. 업체 키는 화면·파일·저장소에 남기지 않는다.
//  1) 업체 키: 환경변수로 준 값만 AES-GCM 암호문으로 함수 비밀값에 저장
//       GEMINI_API_KEY → BMR_GEMINI_API_KEY   (Google AI Studio 키, AIza…)
//       OPENAI_API_KEY → BMR_OPENAI_API_KEY   (sk-…)
//       ANTHROPIC_API_KEY → BMR_ANTHROPIC_API_KEY (sk-ant-…)
//       XAI_API_KEY → BMR_XAI_API_KEY         (xai-…)
//  2) 마이그레이션(20261115100000_hub_ai) 적용·확인
//  3) hub-ai 함수 배포 (열쇠는 업로드하는 index.ts 의 빈 자리에만 채운다 — 저장소에는 빈 값)
//  4) --test 이면 배포 확인(/health)과 이번에 준 키로 업체에 짧은 시험 호출
// 사용: node scripts/setup-ai.mjs [--secrets] [--migrate] [--deploy] [--test]
//       (인자 없으면 --secrets --migrate --deploy)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes, createCipheriv } from 'node:crypto';
import { recordDeploy } from './deploy-record.mjs';
import { sql, REF } from './sql.mjs';

const MIGRATION_VERSION = '20261115100000';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN_DEVAPPS;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const all = ![...args].some((a) => a !== '--test');
const doSecrets = all || args.has('--secrets');
const doMigrate = all || args.has('--migrate');
const doDeploy = all || args.has('--deploy');
const doTest = args.has('--test');

/** 환경변수 이름 → 함수 비밀값 이름 */
const PROVIDERS = [
  ['gemini', 'GEMINI_API_KEY', 'BMR_GEMINI_API_KEY', 'Gemini', 'gemini-2.5-flash'],
  ['openai', 'OPENAI_API_KEY', 'BMR_OPENAI_API_KEY', 'OpenAI', 'gpt-4o-mini'],
  ['anthropic', 'ANTHROPIC_API_KEY', 'BMR_ANTHROPIC_API_KEY', 'Claude', 'claude-3-5-haiku-latest'],
  ['xai', 'XAI_API_KEY', 'BMR_XAI_API_KEY', 'Grok', 'grok-3-mini'],
];

if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN_DEVAPPS 가 없습니다'); process.exit(1); }
const api = (p, o = {}) => fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, ...(o.headers || {}) } });

const keyFile = join(ROOT, '.secrets', 'hub-provision.key');
if (!existsSync(keyFile)) { console.error('열쇠 파일(.secrets/hub-provision.key)이 없습니다. 먼저 node scripts/setup-provision.mjs 를 실행하세요.'); process.exit(1); }
const key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
if (key.length !== 32) { console.error('열쇠 파일 형식이 다릅니다'); process.exit(1); }
function enc(name, value) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(name));
  const ct = Buffer.concat([c.update(value, 'utf8'), c.final(), c.getAuthTag()]);
  return 'enc:v1:' + Buffer.concat([iv, ct]).toString('base64');
}

/** 준 키만 (평문은 메모리에서만, 출력·파일로 남기지 않음) */
const provided = PROVIDERS.map(([id, env, secret, label]) => {
  const raw = (process.env[env] || process.env[secret] || '').trim();
  return { id, env, secret, label, value: raw };
}).filter((p) => p.value);

if (doSecrets) {
  if (!provided.length) {
    console.log('업체 키를 주지 않아 비밀값은 건너뜁니다. 예: GEMINI_API_KEY=... node scripts/setup-ai.mjs --secrets');
  } else {
    const body = provided.map((p) => ({ name: p.secret, value: enc(p.secret, p.value) }));
    const r = await api('/secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { console.error('업체 키 저장 실패', r.status, (await r.text()).slice(0, 300)); process.exit(1); }
    const names = (await (await api('/secrets')).json()).map((x) => x.name);
    console.log('함수 비밀값(암호문) 저장:', body.map((x) => `${x.name} ${names.includes(x.name) ? '✓' : '✗'}`).join(', '));
  }
}

if (doMigrate) {
  try {
    const rows = await sql(`select version from supabase_migrations.schema_migrations where version = '${MIGRATION_VERSION}'`);
    if (rows.length) console.log(`마이그레이션 ${MIGRATION_VERSION}_hub_ai 이미 적용됨`);
    else {
      console.log(`마이그레이션 ${MIGRATION_VERSION}_hub_ai 적용 중…`);
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'migrate.mjs')], { stdio: 'inherit', env: process.env });
      if (r.status !== 0) { console.error('마이그레이션 실패 — node scripts/migrate.mjs 를 직접 실행해 원인을 보세요'); process.exit(1); }
    }
    const [c] = await sql('select count(*)::int as n from bmr_admin.ai_config');
    const [t] = await sql(`select to_regclass('bmr_admin.ai_tokens') is not null as t, to_regclass('bmr_admin.ai_log') is not null as l`);
    console.log(`확인: ai_config ${c?.n ?? 0}행 · ai_tokens ${t?.t ? '✓' : '✗'} · ai_log ${t?.l ? '✓' : '✗'}`);
    if (Number(c?.n ?? 0) !== 1 || !t?.t || !t?.l) { console.error('AI 표가 기대와 다릅니다. 마이그레이션을 확인하세요.'); process.exit(1); }
  } catch (e) {
    console.error('마이그레이션 확인 실패:', String(e?.message ?? e).slice(0, 300));
    process.exit(1);
  }
}

if (doDeploy) {
  const dir = join(ROOT, 'supabase', 'functions', 'hub-ai');
  // 열쇠는 별도 모듈(_key.ts) 대신 index.ts 안의 빈 자리에 채워 올린다 (저장소에는 빈 값만, 검사 워크플로는 그것으로 통과).
  const PLACEHOLDER = "const PROVISION_KEY = '';";
  const keyed = readFileSync(join(dir, 'index.ts'), 'utf8').replace(PLACEHOLDER, `const PROVISION_KEY = '${key.toString('base64')}';`);
  if (!keyed.includes(`const PROVISION_KEY = '${key.toString('base64')}';`)) { console.error(`index.ts 에서 열쇠 자리(${PLACEHOLDER})를 찾지 못했습니다`); process.exit(1); }
  const fd = new FormData();
  fd.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: 'hub-ai', verify_jwt: false }));
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f === '_key.ts') continue;
    fd.append('file', new Blob([f === 'index.ts' ? keyed : readFileSync(join(dir, f))]), f);
  }
  const r = await api(`/functions/deploy?slug=hub-ai`, { method: 'POST', body: fd });
  if (!r.ok) { console.error('hub-ai 배포 실패', r.status, (await r.text()).slice(0, 600)); process.exit(1); }
  console.log('함수 hub-ai 배포 완료');
  await recordDeploy('hub-ai', dir);
}

if (doTest) {
  let failed = 0;
  const url = `https://${REF}.supabase.co/functions/v1/hub-ai`;
  let health = null;
  for (let i = 0; i < 8; i++) {
    try {
      const h = await fetch(url + '/health', { signal: AbortSignal.timeout(10_000) });
      if (h.ok) { health = await h.json(); break; }
      await h.body?.cancel();
    } catch { /* 다시 */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!health) { console.log('hub-ai /health 가 아직 준비되지 않았습니다.'); failed++; }
  else console.log('hub-ai /health:', '등록된 업체 키', Object.entries(health.providers ?? {}).map(([k, v]) => `${k}=${v ? '✓' : '—'}`).join(' '));

  // 이번에 준 키로 업체에 짧은 시험 호출 (본문·키는 출력하지 않음)
  for (const p of provided) {
    const t0 = Date.now();
    try {
      const r = p.id === 'gemini'
        ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.value },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '핑' }] }], generationConfig: { maxOutputTokens: 8 } }),
          signal: AbortSignal.timeout(30_000),
        })
        : p.id === 'anthropic'
          ? await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': p.value, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: p.model, max_tokens: 8, messages: [{ role: 'user', content: '핑' }] }),
            signal: AbortSignal.timeout(30_000),
          })
          : await fetch(p.id === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.value}` },
            body: JSON.stringify({ model: p.model, max_tokens: 8, messages: [{ role: 'user', content: '핑' }] }),
            signal: AbortSignal.timeout(30_000),
          });
      const t = await r.text();
      let j = {}; try { j = t ? JSON.parse(t) : {}; } catch { /* 그대로 */ }
      const msg = j?.error?.message || j?.message || '';
      if (r.ok) console.log(`시험 호출 ${p.label}(${p.model}): ok (${Date.now() - t0}ms, ${j?.usageMetadata?.totalTokenCount ?? j?.usage?.total_tokens ?? j?.usage?.input_tokens ?? '?'} tokens)`);
      else { console.log(`시험 호출 ${p.label}(${p.model}): 실패 ${r.status} ${String(msg).slice(0, 200)}`); failed++; }
    } catch (e) {
      console.log(`시험 호출 ${p.label}(${p.model}): 실패 ${String(e?.message ?? e).slice(0, 200)}`);
      failed++;
    }
  }
  if (failed) { console.error(`시험 실패 ${failed}건`); process.exit(1); }
  console.log('시험 통과');
}
