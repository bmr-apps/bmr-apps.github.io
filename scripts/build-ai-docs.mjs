#!/usr/bin/env node
// hub-provision 함수에 넣을 '웹 AI 개발 규칙'(CLAUDE.md · AGENTS.md)을 만든다.
// 원본: templates/ai-docs/*.md  →  결과: supabase/functions/hub-provision/ai-docs.ts
// 사용: node scripts/build-ai-docs.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'templates', 'ai-docs');
const DEST = join(ROOT, 'supabase', 'functions', 'hub-provision', 'ai-docs.ts');

const files = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();
if (!files.includes('CLAUDE.md') || !files.includes('AGENTS.md')) throw new Error('templates/ai-docs 에 CLAUDE.md 와 AGENTS.md 가 모두 있어야 합니다');
const docs = Object.fromEntries(files.map((f) => [f, readFileSync(join(SRC, f), 'utf8')]));

const out = `// 자동 생성 파일 — 고치지 마세요. 원본: templates/ai-docs/ (node scripts/build-ai-docs.mjs)
// 새 앱 저장소에 함께 넣는 웹 AI 개발 규칙(Codex 용 AGENTS.md · Claude Code 용 CLAUDE.md).
// {{변수}} 는 hub-provision 이 검증한 값(SLUG·APP_NAME·SCHEMA·FN·PREFIX·DOMAIN·ORG …)으로 채운다.
export const AI_DOCS: Record<string, string> = ${JSON.stringify(docs, null, 0)};
`;
writeFileSync(DEST, out);
console.log(`ai-docs.ts: ${files.join(', ')} (${(out.length / 1024).toFixed(1)}KB)`);
