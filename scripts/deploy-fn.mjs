#!/usr/bin/env node
// 허브 Edge Function 배포. 비밀값은 출력하지 않는다.
// 사용: node scripts/deploy-fn.mjs <함수이름>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordDeploy } from './deploy-record.mjs';

const REF = process.env.HUB_REF || 'psupfmarnyxontorftio'; // bmr-dev-apps (서울)
const TOKEN_ENV = process.env.HUB_TOKEN_ENV || 'SUPABASE_ACCESS_TOKEN_DEVAPPS';
const TOKEN = process.env[TOKEN_ENV];
const slug = process.argv[2];
if (!slug || !/^[a-z][a-z0-9-]{1,48}$/.test(slug)) { console.error('사용: node scripts/deploy-fn.mjs <함수이름>'); process.exit(1); }
if (!TOKEN) { console.error(`환경변수 ${TOKEN_ENV} 가 없습니다`); process.exit(1); }

const dir = join(dirname(fileURLToPath(import.meta.url)), `../supabase/functions/${slug}`);
function walk(base, prefix = '') {
  const out = {};
  for (const name of readdirSync(join(base, prefix))) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(base, rel)).isDirectory()) Object.assign(out, walk(base, rel));
    else out[rel] = readFileSync(join(base, rel));
  }
  return out;
}
const files = walk(dir);
if (!files['index.ts']) { console.error(`${slug}/index.ts 가 없습니다`); process.exit(1); }
const fd = new FormData();
fd.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: false }));
for (const [path, content] of Object.entries(files)) fd.append('file', new Blob([content]), path);
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${encodeURIComponent(slug)}`, {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd,
});
if (!r.ok) { console.error(`배포 실패 ${r.status}:`, (await r.text()).slice(0, 800)); process.exit(1); }
console.log(`함수 ${slug} 배포 완료`);
if (REF === 'psupfmarnyxontorftio') await recordDeploy(slug, dir);
