#!/usr/bin/env node
// hub-provision 준비·배포. 비밀값은 화면·파일·저장소에 남기지 않는다.
//  1) 열쇠: .secrets/hub-provision.key (이 컴퓨터에만, git 제외). 없으면 새로 만든다 (--rotate-key 로 새로).
//  2) 비밀값: SUPABASE_ACCESS_TOKEN_DEVAPPS → BMR_MGMT_TOKEN, GITHUB_BMR_APPS_TOKEN → BMR_GH_TOKEN 을 AES-GCM 암호문으로 함수 비밀값에 저장
//  3) 배포: hub-provision · hub-deprovision · hub-fn-deploy 함수 파일 + 열쇠 모듈(_key.ts, 배포본에만)을 올린다.
// 사용: node scripts/setup-provision.mjs [--secrets] [--deploy [--only <함수>]] [--rotate-key]   (인자 없으면 둘 다)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv } from 'node:crypto';

const REF = 'psupfmarnyxontorftio';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN_DEVAPPS;
const GH = process.env.GITHUB_BMR_APPS_TOKEN;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const all = !args.has('--secrets') && !args.has('--deploy');
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
if (only && !['hub-provision', 'hub-deprovision', 'hub-fn-deploy'].includes(only)) { console.error('--only 는 hub-provision · hub-deprovision · hub-fn-deploy 중 하나'); process.exit(1); }
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN_DEVAPPS 가 없습니다'); process.exit(1); }
const api = (p, o = {}) => fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, ...(o.headers || {}) } });

const keyFile = join(ROOT, '.secrets', 'hub-provision.key');
mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
let fresh = false;
if (!existsSync(keyFile) || args.has('--rotate-key')) { writeFileSync(keyFile, randomBytes(32).toString('base64'), { mode: 0o600 }); fresh = true; }
const key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
if (key.length !== 32) { console.error('열쇠 파일 형식이 다릅니다'); process.exit(1); }

function enc(name, value) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(name));
  const ct = Buffer.concat([c.update(value, 'utf8'), c.final(), c.getAuthTag()]);
  return 'enc:v1:' + Buffer.concat([iv, ct]).toString('base64');
}

if (all || args.has('--secrets') || fresh) {
  if (!GH) { console.error('GITHUB_BMR_APPS_TOKEN 이 없습니다'); process.exit(1); }
  const body = [{ name: 'BMR_MGMT_TOKEN', value: enc('BMR_MGMT_TOKEN', TOKEN) }, { name: 'BMR_GH_TOKEN', value: enc('BMR_GH_TOKEN', GH) }];
  const r = await api('/secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { console.error('비밀값 저장 실패', r.status); process.exit(1); }
  const names = (await (await api('/secrets')).json()).map((x) => x.name);
  console.log('함수 비밀값(암호문) 저장:', ['BMR_MGMT_TOKEN', 'BMR_GH_TOKEN'].map((n) => `${n} ${names.includes(n) ? '✓' : '✗'}`).join(', '));
}

if (all || args.has('--deploy') || fresh) {
  // 같은 열쇠로 세 함수 배포: hub-provision(만들기, 지우기 없음) · hub-deprovision(백업 후 지우기) · hub-fn-deploy(앱 함수 자동 배포)
  //   --only <함수> 로 하나만 배포
  for (const fnName of only ? [only] : ['hub-provision', 'hub-deprovision', 'hub-fn-deploy']) {
    const dir = join(ROOT, 'supabase', 'functions', fnName);
    const fd = new FormData();
    fd.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: fnName, verify_jwt: false }));
    for (const f of readdirSync(dir)) if (f.endsWith('.ts') && f !== '_key.ts') fd.append('file', new Blob([readFileSync(join(dir, f))]), f);
    fd.append('file', new Blob([`export const PROVISION_KEY = '${key.toString('base64')}';\n`]), '_key.ts');
    const r = await api(`/functions/deploy?slug=${fnName}`, { method: 'POST', body: fd });
    if (!r.ok) { console.error(`${fnName} 배포 실패`, r.status, (await r.text()).slice(0, 600)); process.exit(1); }
    console.log(`함수 ${fnName} 배포 완료`);
  }
}
