#!/usr/bin/env node
// 이미 만들어진 앱 저장소에 웹 AI 개발 규칙(CLAUDE.md · AGENTS.md)을 넣는다.
// 새 앱은 hub-provision 이 자동으로 넣으므로 이 스크립트는 '예전에 만든 앱'에 한 번만 쓰면 된다.
//
//   node scripts/sync-ai-docs.mjs hannah smartfarm            무엇을 바꿀지 보여 주기만 한다 (기본: 미리보기)
//   node scripts/sync-ai-docs.mjs hannah --write              실제로 커밋·푸시 (내 GitHub 권한으로)
//   node scripts/sync-ai-docs.mjs --all --write               허브에 등록된 앱 중 v2 앱 전부
//   node scripts/sync-ai-docs.mjs hannah --out /tmp/preview   파일만 만들어 보기 (경로 지정)
//
// 원본: templates/ai-docs/CLAUDE.md · AGENTS.md ({{SLUG}} 같은 자리는 저장소의 .bmr-app.json 으로 채운다)
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'templates', 'ai-docs');
const ORG = 'bmr-apps';
const DOMAIN = 'apps.bmrschool.net';
const DOCS = ['CLAUDE.md', 'AGENTS.md'];

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null;
const list = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');

const render = (t, vars) => t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));

async function appInfo(slug) {
  if (!/^[a-z][a-z0-9-]{1,38}$/.test(slug)) throw new Error(`주소 이름 형식이 아닙니다: ${slug}`);
  const url = `https://raw.githubusercontent.com/${ORG}/${slug}/main/.bmr-app.json`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${slug}: .bmr-app.json 을 읽지 못했습니다 (HTTP ${r.status}) — BMR APPS 가 만든 v2 앱인지 확인해 주세요`);
  const a = await r.json();
  return {
    slug, name: String(a.name ?? slug), schema: String(a.schema ?? slug.replace(/-/g, '_')),
    fn: String(a.function ?? `${slug}-fn`), prefix: String(a.secret_prefix ?? `${slug.replace(/-/g, '_').toUpperCase()}_`),
  };
}

async function hasDoc(slug, file) {
  const r = await fetch(`https://raw.githubusercontent.com/${ORG}/${slug}/main/${file}`, { method: 'HEAD', cache: 'no-store' });
  return r.ok;
}

async function allSlugs() {
  const r = await fetch(`https://api.github.com/orgs/${ORG}/repos?per_page=100&sort=name`, { headers: { 'User-Agent': 'bmr-sync-ai-docs' } });
  if (!r.ok) throw new Error(`앱 목록을 읽지 못했습니다 (${r.status}). 앱 이름을 직접 적어 주세요.`);
  return (await r.json()).filter((x) => !x.archived).map((x) => x.name).sort();
}

const slugs = flags.has('--all') ? await allSlugs() : list;
if (!slugs.length) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 9).join('\n'));
  process.exit(0);
}

let changed = 0, skipped = 0, failed = 0;
for (const slug of slugs) {
  try {
    const a = await appInfo(slug);
    const vars = { SLUG: a.slug, APP_NAME: a.name, SCHEMA: a.schema, FN: a.fn, PREFIX: a.prefix, ORG, DOMAIN, SB_URL: `https://${a.slug}.supabase.co` };
    const files = Object.fromEntries(DOCS.map((f) => [f, render(readFileSync(join(SRC, f), 'utf8'), vars)]));
    const have = await Promise.all(DOCS.map((f) => hasDoc(slug, f)));
    if (have.every(Boolean)) { console.log(`= ${slug}: 이미 CLAUDE.md · AGENTS.md 가 있습니다 (건너뜀)`); skipped++; continue; }

    if (!flags.has('--write')) {
      const dir = OUT ? join(OUT, slug) : null;
      if (dir) { mkdirSync(dir, { recursive: true }); for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t); }
      console.log(`+ ${slug}: ${DOCS.filter((_, i) => !have[i]).join(', ')} 을(를) 추가합니다${dir ? ` (미리보기: ${dir})` : ' — 실제로 넣으려면 --write'}`);
      changed++;
      continue;
    }

    const tmp = mkdtempSync(join(tmpdir(), `bmr-ai-docs-${slug}-`));
    try {
      execFileSync('git', ['clone', '--depth', '1', `https://github.com/${ORG}/${slug}.git`, tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
      for (const [f, t] of Object.entries(files)) writeFileSync(join(tmp, f), t);
      const add = DOCS.filter((_, i) => !have[i]);
      execFileSync('git', ['add', ...add], { cwd: tmp, stdio: 'inherit' });
      execFileSync('git', ['-c', 'user.name=BMR APPS', '-c', 'user.email=bot@bmrschool.net', 'commit', '-m', `웹 AI 개발 규칙 추가: ${add.join(', ')} (Codex·Claude Code 공용 규칙)`], { cwd: tmp, stdio: 'inherit' });
      execFileSync('git', ['push', 'origin', 'HEAD:main'], { cwd: tmp, stdio: 'inherit' });
      console.log(`✓ ${slug}: ${add.join(', ')} 커밋·푸시 완료`);
      changed++;
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  } catch (e) {
    console.error(`✗ ${slug}: ${e?.message ?? e}`);
    failed++;
  }
}
console.log(`\n결과: 바꿈 ${changed} · 건너뜀 ${skipped} · 실패 ${failed}`);
process.exit(failed ? 1 : 0);
