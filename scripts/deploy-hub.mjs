#!/usr/bin/env node
// 허브 서버 함수를 한 번에 배포한다 (허브는 앱과 달리 자동 배포가 아니라 이 스크립트로 올린다).
//   node scripts/deploy-hub.mjs                     모든 허브 함수 배포 + /health 확인
//   node scripts/deploy-hub.mjs --only hub-devtools,hub-directory   고른 함수만
//   node scripts/deploy-hub.mjs --migrate           마이그레이션 먼저 적용하고 배포
//   node scripts/deploy-hub.mjs --dry-run           무엇을 올릴지만 보여 주고 아무것도 하지 않음
//
// 열쇠(.secrets/hub-provision.key)를 쓰는 함수(_key.ts 를 import 하는 함수: hub-provision·hub-deprovision·
// hub-fn-deploy·hub-devtools·hub-mail·hub-ai)는 그 열쇠를 배포본에만 넣는다 — 저장소에는 절대 넣지 않는다.
// **이 스크립트는 열쇠를 새로 만들지 않는다.** 열쇠 파일이 없으면 멈춘다 (새 열쇠로 배포하면 이미 배포된 함수들이
// 암호문(BMR_MGMT_TOKEN·BMR_GH_TOKEN·업체 키)을 풀지 못하게 되기 때문). 처음 준비는 setup-provision.mjs 가 한다.
//
// 필요한 것: SUPABASE_ACCESS_TOKEN_DEVAPPS (Supabase 관리 API 토큰). 비밀값은 출력하지 않는다.
// 마이그레이션은 scripts/migrate.mjs 가 한다 (같은 토큰). 배포 기록은 감사 기록(hub:deploy)에 남는다.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { recordDeploy } from './deploy-record.mjs';
import { sql } from './sql.mjs';

export const REF = 'psupfmarnyxontorftio';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUNC_DIR = join(ROOT, 'supabase', 'functions');
const KEY_FILE = join(ROOT, '.secrets', 'hub-provision.key');
/** 열쇠를 쓰는 함수 목록 — 배포할 때 _key.ts 를 여기에만 넣는다 (CI 검사 워크플로와 같은 목록) */
export const KEYED = ['hub-provision', 'hub-deprovision', 'hub-fn-deploy', 'hub-devtools', 'hub-mail', 'hub-ai'];
const HELP = `허브 서버 함수 배포

  node scripts/deploy-hub.mjs [--only f1,f2] [--migrate] [--dry-run] [--no-verify]

  --only      쉼표로 고른 함수만 배포 (예: --only hub-devtools,hub-directory)
  --migrate   supabase/migrations/ 의 아직 안 한 파일을 먼저 적용 (scripts/migrate.mjs)
  --dry-run   무엇을 올릴지·열쇠가 있는지만 보여 주고 배포하지 않음 (네트워크 안 씀)
  --no-verify 배포 뒤 /health 확인 생략

  환경변수 SUPABASE_ACCESS_TOKEN_DEVAPPS 가 필요합니다. 열쇠(.secrets/hub-provision.key)는 새로 만들지 않습니다.`;

/** 명령줄 인자 → { only: string[]|null, migrate, dryRun, verify, help } */
export function parseArgs(argv = []) {
  const out = { only: null, migrate: false, dryRun: false, verify: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--migrate') out.migrate = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-verify') out.verify = false;
    else if (a === '--verify') out.verify = true;
    else if (a === '--only' || a.startsWith('--only=')) {
      const v = a.startsWith('--only=') ? a.slice('--only='.length) : String(argv[++i] ?? '');
      const names = v.split(',').map((x) => x.trim()).filter(Boolean);
      if (!names.length) throw new Error('--only 뒤에 함수 이름을 적어 주세요 (예: --only hub-devtools,hub-directory)');
      out.only = names;
    } else if (a.startsWith('-')) throw new Error(`모르는 옵션입니다: ${a}`);
    else throw new Error(`모르는 인자입니다: ${a} (함수는 --only 로 고릅니다)`);
  }
  return out;
}

/** 함수 폴더 안의 파일 목록 (상대 경로, '/' 구분). _key.ts 와 예시 파일은 올리지 않는다 */
function filesIn(dir) {
  const out = [];
  const walk = (base, prefix = '') => {
    for (const name of readdirSync(join(base, prefix))) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = statSync(join(base, rel));
      if (st.isDirectory()) walk(base, rel);
      else if (name === '_key.ts' || name === '_key.ts.example') continue;
      else out.push(rel);
    }
  };
  walk(dir);
  return out;
}

/** supabase/functions/ 아래에서 배포할 함수를 찾는다. _key.ts 를 쓰는지(keyed)도 본다 */
export function discoverFunctions(funcDir = FUNC_DIR) {
  const items = [];
  for (const name of readdirSync(funcDir)) {
    const dir = join(funcDir, name);
    if (!statSync(dir).isDirectory()) continue;
    if (!existsSync(join(dir, 'index.ts'))) continue;
    const files = filesIn(dir);
    const keyed = files.some((f) => /\.ts$/.test(f)
      && /from\s+['"]\.\/_key\.ts['"]/.test(readFileSync(join(dir, f), 'utf8')));
    items.push({ name, dir, files, keyed });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** 열쇠 파일 읽기 — 없거나 형식이 다르면 null (새로 만들지 않는다) */
function readKey() {
  if (!existsSync(KEY_FILE)) return { key: null, why: '열쇠 파일이 없습니다 (.secrets/hub-provision.key)' };
  try {
    const raw = readFileSync(KEY_FILE, 'utf8').trim();
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) return { key: null, why: '열쇠 파일 형식이 다릅니다 (base64 32바이트가 아님)' };
    return { key, why: '' };
  } catch (e) { return { key: null, why: `열쇠 파일을 읽지 못했습니다: ${String(e.message).slice(0, 120)}` }; }
}

const api = (p, o = {}) => fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, {
  ...o, headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN_DEVAPPS}`, ...(o.headers || {}) },
});

/** 함수 하나 배포. 열쇠를 쓰는 함수는 _key.ts 를 배포본에만 넣는다 */
async function deployOne(fn, key) {
  const fd = new FormData();
  fd.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: fn.name, verify_jwt: false }));
  for (const rel of fn.files) fd.append('file', new Blob([readFileSync(join(fn.dir, rel))]), rel);
  if (fn.keyed) fd.append('file', new Blob([`export const PROVISION_KEY = '${key.toString('base64')}';\n`]), '_key.ts');
  const r = await api(`/functions/deploy?slug=${encodeURIComponent(fn.name)}`, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`${fn.name} 배포 실패 (${r.status}): ${(await r.text()).slice(0, 600)}`);
  let version = 0;
  try { version = Number((await r.json())?.version) || 0; } catch { /* 아래에서 다시 확인 */ }
  await recordDeploy(fn.name, fn.dir);
  return version;
}

/** 배포된 함수의 버전을 관리 API 에서 다시 읽는다 (배포가 실제로 반영됐는지 확인) */
async function versions() {
  const r = await api('/functions');
  if (!r.ok) { await r.body?.cancel(); throw new Error(`함수 목록을 읽지 못했습니다 (${r.status})`); }
  const list = await r.json();
  return new Map((Array.isArray(list) ? list : []).map((f) => [String(f.slug), Number(f.version) || 0]));
}

/** /health 확인 (5초). 함수가 POST 만 받아도 '살아 있음'으로 본다 (5xx·무응답만 문제) */
async function healthOf(name) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://${REF}.supabase.co/functions/v1/${name}/health`, { signal: AbortSignal.timeout(5000) });
    await r.body?.cancel();
    const ms = Date.now() - t0;
    return r.status < 500 ? { ok: true, what: `HTTP ${r.status}`, ms } : { ok: false, what: `HTTP ${r.status}`, ms };
  } catch { return { ok: false, what: '응답 없음', ms: Date.now() - t0 }; }
}

/** 아직 안 한 마이그레이션 목록 (읽기 전용) */
async function pendingMigrations() {
  const dir = join(ROOT, 'supabase', 'migrations');
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let done = new Set();
  try {
    const rows = await sql('select version from supabase_migrations.schema_migrations');
    done = new Set((rows ?? []).map((r) => String(r.version)));
  } catch {
    // 기록 표가 아직 없으면 전부 미적용 (migrate.mjs 가 표부터 만든다)
  }
  return all.filter((f) => !done.has(f.replace(/\.sql$/, '').split('_')[0]));
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (e) { console.error(e.message); console.error(HELP); return 2; }
  if (args.help) { console.log(HELP); return 0; }

  const all = discoverFunctions();
  let targets = all;
  if (args.only) {
    const known = new Set(all.map((f) => f.name));
    const unknown = args.only.filter((n) => !known.has(n));
    if (unknown.length) {
      console.error(`그런 함수가 없습니다: ${unknown.join(', ')}`);
      console.error(`있 는 함수: ${all.map((f) => f.name).join(' · ')}`);
      return 2;
    }
    const want = new Set(args.only);
    targets = all.filter((f) => want.has(f.name));
  }
  const keyedTargets = targets.filter((f) => f.keyed);
  const token = process.env.SUPABASE_ACCESS_TOKEN_DEVAPPS || '';
  const { key, why } = readKey();

  console.log(`허브 함수 ${targets.length}개 (${REF})${args.only ? ` — 고른 것만: ${targets.map((f) => f.name).join(', ')}` : ''}`);
  for (const f of targets) {
    console.log(`  · ${f.name.padEnd(18)} ${f.keyed ? '열쇠 사용' : '열쇠 없음'} · 파일 ${f.files.length}개`);
  }

  if (args.dryRun) {
    console.log('\n[미리 보기] 아무것도 배포하지 않았습니다.');
    console.log(`  Supabase 토큰: ${token ? '있음' : '없음 (배포하려면 SUPABASE_ACCESS_TOKEN_DEVAPPS 필요)'}`);
    console.log(`  열쇠 파일: ${key ? '있음 (그대로 씀 — 새로 만들지 않음)' : `없음 — ${why}`}`);
    if (keyedTargets.length && !key) console.log('  ⚠️ 열쇠를 쓰는 함수가 있는데 열쇠 파일이 없어 실제 배포는 멈춥니다. 먼저 setup-provision.mjs 로 열쇠를 준비하세요.');
    if (args.migrate) console.log('  --migrate: 실행할 때 아직 안 한 마이그레이션을 확인해 먼저 적용합니다.');
    return 0;
  }

  if (!token) { console.error('\nSUPABASE_ACCESS_TOKEN_DEVAPPS 가 없습니다. 허브 관리 토큰을 넣고 다시 실행하세요.'); return 2; }
  // 열쇠를 쓰는 함수를 하나라도 올리는데 열쇠가 없으면 아무것도 올리지 않는다 (일부만 새 열쇠로 올라가면 더 위험)
  if (keyedTargets.length && !key) {
    console.error(`\n멈췄습니다 — ${why}`);
    console.error('열쇠를 쓰는 함수: ' + keyedTargets.map((f) => f.name).join(', '));
    console.error('이 스크립트는 열쇠를 새로 만들지 않습니다 (이미 배포된 함수가 암호문을 풀지 못하게 되기 때문).');
    console.error('열쇠가 있는 컴퓨터에서 실행하거나, 처음 준비라면 node scripts/setup-provision.mjs 를 먼저 실행하세요.');
    return 1;
  }

  // 1) 마이그레이션 (--migrate)
  if (args.migrate) {
    console.log('\n[마이그레이션]');
    let pending = [];
    try { pending = await pendingMigrations(); }
    catch (e) { console.error('  확인 실패: ' + String(e.message).slice(0, 200)); return 1; }
    if (!pending.length) console.log('  아직 안 한 파일이 없습니다.');
    else {
      console.log(`  적용할 파일 ${pending.length}개: ${pending.join(', ')}`);
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'migrate.mjs')], { cwd: ROOT, stdio: 'inherit', env: process.env });
      if (r.status !== 0) { console.error('  마이그레이션이 실패해 배포를 멈춥니다.'); return 1; }
    }
  }

  // 2) 배포
  console.log('\n[배포]');
  const before = await versions().catch(() => new Map());
  const failed = [];
  for (const f of targets) {
    try {
      const v = await deployOne(f, key);
      const was = before.get(f.name);
      console.log(`  ✓ ${f.name}${v ? ` v${v}` : ''}${was ? ` (이전 v${was})` : ' (새 함수)'}`);
    } catch (e) {
      console.error(`  ✗ ${String(e.message).slice(0, 400)}`);
      failed.push(f.name);
    }
  }
  if (failed.length) console.error(`\n배포 실패: ${failed.join(', ')}`);

  // 3) 반영 확인 — 관리 API 의 버전 + /health
  console.log('\n[확인]');
  let after = new Map();
  try { after = await versions(); } catch (e) { console.error(`  버전 확인 실패: ${String(e.message).slice(0, 200)}`); }
  for (const f of targets) {
    if (failed.includes(f.name)) { console.log(`  · ${f.name}: 배포 실패 — 건너뜀`); continue; }
    const v = after.get(f.name);
    if (!args.verify) { console.log(`  · ${f.name}: ${v ? `v${v}` : '버전 확인 안 함'}`); continue; }
    const h = await healthOf(f.name);
    console.log(`  ${h.ok ? '✓' : '✗'} ${f.name}: ${v ? `v${v}` : '버전 ?'} · /health ${h.what} (${h.ms}ms)`);
  }

  if (args.migrate) {
    const left = await pendingMigrations().catch(() => []);
    console.log(`\n마이그레이션 남은 파일: ${left.length ? left.join(', ') : '없음'}`);
  }
  console.log(failed.length ? `\n끝났지만 실패 ${failed.length}개가 있습니다.` : '\n끝났습니다.');
  return failed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(String(e?.message ?? e).slice(0, 600)); process.exit(1); });
}
