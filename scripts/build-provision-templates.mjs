#!/usr/bin/env node
// hub-provision 함수에 넣을 시작 틀(templates.ts)을 bmr-app-templates 에서 만든다.
// 사용: node scripts/build-provision-templates.mjs [템플릿 폴더 (기본 /workspace/bmr-app-templates)]
// 안내 README 는 여기서 미리 HTML 로 바꿔 둔다({{변수}} 는 그대로 남고, 함수가 앱마다 채운다).
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const SRC = process.argv[2] || '/workspace/bmr-app-templates';
const req = createRequire(join(SRC, 'package.json'));
const { marked } = req('marked');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

const repoDir = join(SRC, 'starter', 'repo');
const files = {};
for (const p of walk(repoDir)) {
  const rel = relative(repoDir, p).replace(/\.tpl$/, '');
  if (rel === 'package-lock.json') continue;
  files[rel] = readFileSync(p, 'utf8');
}
// package-lock.json: 자리표시 이름으로 만든 뒤 {{SLUG}} 로 바꾼다
{
  const tmp = mkdtempSync(join(tmpdir(), 'bmr-lock-'));
  const PH = 'bmr-slug-placeholder';
  writeFileSync(join(tmp, 'package.json'), files['package.json'].replaceAll('{{SLUG}}', PH));
  execFileSync('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund', '--silent'], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
  files['package-lock.json'] = readFileSync(join(tmp, 'package-lock.json'), 'utf8').replaceAll(PH, '{{SLUG}}');
  rmSync(tmp, { recursive: true, force: true });
}
const guide = marked.parse(files['README.md'], { gfm: true });
files['index.html'] = readFileSync(join(SRC, 'starter', 'layout.html'), 'utf8').replace('{{GUIDE_HTML}}', guide);
const fn = readFileSync(join(SRC, 'starter', 'fn', 'index.ts'), 'utf8');
const sql = { app: readFileSync(join(SRC, 'sql', '10_app.sql'), 'utf8'), starter: readFileSync(join(SRC, 'sql', '20_starter.sql'), 'utf8') };

const out = `// 자동 생성 파일 — 고치지 마세요. 원본: bmr-app-templates (node scripts/build-provision-templates.mjs)
// 저장소 시작 틀 · 앱 서버 함수 · 앱 DB SQL. {{변수}} 는 hub-provision 이 검증한 값으로만 채운다.
export const TEMPLATE_VERSION = 'bmr-app-templates v2';
export const REPO_FILES: Record<string, string> = ${JSON.stringify(files, null, 0)};
export const FN_SOURCE: string = ${JSON.stringify(fn)};
export const SQL_APP: string = ${JSON.stringify(sql.app)};
export const SQL_STARTER: string = ${JSON.stringify(sql.starter)};
`;
const dest = new URL('../supabase/functions/hub-provision/templates.ts', import.meta.url);
writeFileSync(dest, out);
console.log(`templates.ts: 저장소 파일 ${Object.keys(files).length}개, ${(out.length / 1024).toFixed(0)}KB`);
