// hub-checks — 앱 저장소의 '공용 주소 점검'(경고만) 결과를 받아 public.app_checks 에 앱마다 최신 1건으로 저장한다.
// 인증: GitHub Actions OIDC 토큰만 받는다 (저장소·허브에 비밀값 없음).
//   iss = token.actions.githubusercontent.com, aud = bmr-apps-hub, repository_owner = bmr-apps,
//   ref = refs/heads/main, 이벤트 push/workflow_dispatch, 워크플로 = .github/workflows/bmr-check.yml,
//   repository 가 허브에 등록된 앱의 저장소(repo_url)와 같아야 한다. 커밋·실행 번호는 토큰 값을 쓴다(본문 값은 믿지 않음).
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const ORG = 'bmr-apps';
const RULES = new Set(['storage-clear', 'storage-key', 'abs-path', 'sw-scope', 'ext-script']);
const MAX_BODY = 300_000, MAX_WARN = 200;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);

type Claims = { repository?: string; repository_owner?: string; ref?: string; sha?: string; event_name?: string; workflow_ref?: string; run_id?: string; run_attempt?: string };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST 만 받습니다.' });
  const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!tok) return json(401, { error: '토큰이 없습니다.' });
  let c: Claims;
  try {
    ({ payload: c } = await jwtVerify(tok, JWKS, { issuer: ISSUER, audience: 'bmr-apps-hub', algorithms: ['RS256'] }) as unknown as { payload: Claims });
  } catch { return json(401, { error: '토큰을 확인하지 못했습니다.' }); }
  const repo = String(c.repository ?? '').toLowerCase();
  if (c.repository_owner?.toLowerCase() !== ORG || !repo.startsWith(`${ORG}/`)) return json(403, { error: '허용되지 않은 저장소입니다.' });
  if (c.ref !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(String(c.event_name))) return json(403, { error: 'main 브랜치 push 결과만 받습니다.' });
  if (!String(c.workflow_ref ?? '').toLowerCase().startsWith(`${repo}/.github/workflows/bmr-check.yml@`)) return json(403, { error: '공용 주소 점검 워크플로가 아닙니다.' });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: '결과가 너무 큽니다.' });
  let body: { files?: number; block_dangerous?: boolean; warnings?: unknown[] };
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'JSON 이 아닙니다.' }); }

  const { data: apps } = await admin.from('apps').select('id, slug, repo_url');
  const app = (apps ?? []).find((a) => String(a.repo_url ?? '').toLowerCase().replace(/\.git$/, '').replace(/\/$/, '') === `https://github.com/${repo}`);
  if (!app) return json(404, { error: '허브에 등록된 앱 저장소가 아닙니다.' });

  const warnings = (Array.isArray(body.warnings) ? body.warnings : []).slice(0, MAX_WARN).flatMap((w0) => {
    const w = w0 as Record<string, unknown>;
    const rule = String(w.rule ?? '');
    if (!RULES.has(rule)) return [];
    const line = Math.max(1, Math.min(1_000_000, Math.trunc(Number(w.line) || 1)));
    return [{ rule, file: clean(w.file, 200), line, message: clean(w.message, 400), fix: clean(w.fix, 400), blocking: w.blocking === true }];
  });
  const by_rule: Record<string, number> = {};
  for (const w of warnings) by_rule[w.rule] = (by_rule[w.rule] ?? 0) + 1;
  const key = (w: { rule: string; file: string; message: string }) => `${w.rule}|${w.file}|${w.message}`;

  const runId = Number(c.run_id) || null;
  const { data: prev } = await admin.from('app_checks').select('run_id, first_seen').eq('app_id', app.id).maybeSingle();
  if (prev?.run_id && runId && runId < prev.run_id) return json(200, { ok: true, skipped: '더 새 결과가 이미 있습니다.' });
  const now = new Date().toISOString();
  const prevSeen = (prev?.first_seen ?? {}) as Record<string, string>;
  const first_seen: Record<string, string> = {};
  const new_keys: string[] = [];
  for (const w of warnings) { const k = key(w); if (first_seen[k]) continue; first_seen[k] = prevSeen[k] ?? now; if (!prevSeen[k]) new_keys.push(k); }

  const row = {
    app_id: app.id, received_at: now, commit_sha: clean(c.sha, 64), run_id: runId,
    run_url: runId ? `https://github.com/${c.repository}/actions/runs/${runId}` : null, workflow_ref: clean(c.workflow_ref, 300),
    files: Math.max(0, Math.trunc(Number(body.files) || 0)), total: warnings.length, new_count: new_keys.length,
    by_rule, warnings, new_keys, block_dangerous: body.block_dangerous === true, first_seen,
  };
  const { error } = await admin.from('app_checks').upsert(row, { onConflict: 'app_id' });
  if (error) return json(500, { error: '저장하지 못했습니다.' });
  return json(200, { ok: true, app: app.slug, total: row.total, new: row.new_count });
});
