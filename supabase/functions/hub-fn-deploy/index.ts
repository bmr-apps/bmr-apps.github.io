// hub-fn-deploy — 앱 저장소 main 에 올린 서버 함수를 자동으로 배포한다. 개발자는 Supabase 토큰을 갖지 않는다.
// 인증: GitHub Actions OIDC 토큰만 받는다 (저장소에 비밀값 없음).
//   iss = token.actions.githubusercontent.com, aud = bmr-apps-fn-deploy, repository_owner = bmr-apps, ref = refs/heads/main,
//   이벤트 push/workflow_dispatch, 워크플로 = <저장소>/.github/workflows/functions-check.yml@refs/heads/main,
//   repository 가 허브 apps 표의 repo_url 과 같아야 한다 → 그 앱 몫의 함수만 배포 (요청 본문은 읽지 않음).
//   관리자가 그 앱의 '서버 함수 자동 배포'(apps.fn_auto_deploy)를 켜 둔 경우에만 배포한다 (꺼져 있으면 403 disabled).
// 함수: 기본 함수 <slug>-fn 과, 개발자가 새로 만든 추가 함수 <slug>-<이름> (앱마다 3개까지, 처음 push 때 새로 만듦).
//   다른 앱 이름 공간(<다른slug>-…)과 겹치는 이름, 규칙에 맞지 않는 <slug>-… 폴더는 거부한다.
//   push 때는 지난 배포 뒤 폴더가 바뀐 함수만 배포하고(bmr_admin.fn_deploy_state), 수동 실행은 모두 다시 배포한다.
// 코드: 업로드를 받지 않고, 토큰에 서명된 커밋의 supabase/functions/<함수>/ 폴더를 GitHub 에서 직접 읽어 올린다
//   (그 사이 main 에 그 함수 폴더를 바꾼 더 새 커밋이 있으면 그 함수는 건너뜀 — 그 커밋의 실행이 배포).
// 안전장치: 허용 목록 밖 외부 호출 불가(관리 API 는 함수 목록 보기 + 그 앱 몫 함수 배포만, 지우기·비밀값 없음), 파일 수·크기 제한,
//   허브 전용 비밀값 이름을 쓰는 코드는 거부(실수 방지용, 완전한 격리는 아님), 시간당 횟수 제한, 모든 결과를 audit_log 에 기록.
//   추가 함수 지우기는 허브(hub-devtools, 담당 개발자·관리자)에서 한다.
// 관리 토큰(BMR_MGMT_TOKEN)·GitHub 토큰(BMR_GH_TOKEN)은 hub-provision 과 같은 암호문 비밀값이고, 푸는 열쇠는 배포본(_key.ts)에만 있다.
import postgres from 'npm:postgres@3.4.5';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { PROVISION_KEY } from './_key.ts';

const REF = 'psupfmarnyxontorftio';
const ORG = 'bmr-apps';
const SB_URL = Deno.env.get('SUPABASE_URL')!;
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-fn-deploy: 다른 프로젝트에서는 실행하지 않습니다');
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
const ISSUER = 'https://token.actions.githubusercontent.com';
const AUD = 'bmr-apps-fn-deploy';
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const LIMIT = { perAppHour: 20, files: 80, fileBytes: 4 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 };
const OFF_MSG = '이 앱은 서버 함수 자동 배포가 꺼져 있습니다. 관리자에게 요청하세요.';
const SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/;
const PATH_RE = /^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/;
const CODE_RE = /\.(?:[cm]?[jt]sx?)$/i;
// 추가 함수 규칙 — hub-devtools/rules.ts 와 같아야 한다 (scripts/test-selfservice-rules.mjs 가 확인)
const EXTRA_FN_MAX = 3;
const EXTRA_FN_SUFFIX_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTRA_FN_SUFFIX_MAX = 20;
const PROJECT_FN_MAX = 100;   // 프로젝트 전체 함수 수 (무료 한도 기준, 넉넉히 둠)
/** 이 앱 몫의 함수인지: <slug>-fn 또는 <slug>-<끝부분>. 다른 앱 slug 이름 공간(<다른slug>, <다른slug>-…)은 제외 */
function fnKind(slug: string, fn: string, allSlugs: string[] = []): 'main' | 'extra' | null {
  if (fn === `${slug}-fn`) return 'main';
  if (!fn.startsWith(`${slug}-`)) return null;
  const suffix = fn.slice(slug.length + 1);
  if (!suffix || suffix.length > EXTRA_FN_SUFFIX_MAX || !EXTRA_FN_SUFFIX_RE.test(suffix)) return null;
  for (const o of allSlugs) if (o !== slug && o.length > slug.length && (fn === o || fn.startsWith(`${o}-`))) return null;
  return 'extra';
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- 토큰 (암호문 → 메모리에서만 풂) ----------
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let tokenCache: { mgmt: string; gh: string } | null = null;
async function tokens() {
  if (tokenCache) return tokenCache;
  const key = await crypto.subtle.importKey('raw', b64d(PROVISION_KEY), 'AES-GCM', false, ['decrypt']);
  const dec = async (name: string) => {
    const v = Deno.env.get(name) ?? '';
    if (!v.startsWith('enc:v1:')) throw new HttpError(500, `서버 설정(${name})이 없습니다. 관리자에게 알려 주세요.`);
    const raw = b64d(v.slice(7));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(name) }, key, raw.slice(12));
    return new TextDecoder().decode(pt);
  };
  tokenCache = { mgmt: await dec('BMR_MGMT_TOKEN'), gh: await dec('BMR_GH_TOKEN') };
  return tokenCache;
}

// ---------- 허용 목록: 그 앱 저장소 읽기 + 그 앱 함수 조회·배포만 ----------
function blocked(what: string, method: string, path: string): never {
  console.error('hub-fn-deploy blocked', what, method, path.slice(0, 120));
  throw new HttpError(500, `허용되지 않은 ${what} 요청을 막았습니다.`);
}
function mgmt(slug: string, allSlugs: string[], token: string) {
  // 함수 목록 보기 + 이 앱 몫(<slug>-fn, <slug>-이름) 함수 배포만. 지우기·비밀값·다른 앱 함수는 안 됨
  return async (method: string, path: string, body?: BodyInit) => {
    const m = /^\/functions\/deploy\?slug=([a-z0-9-]+)$/.exec(path);
    const ok = (method === 'GET' && path === '/functions') || (method === 'POST' && !!m && fnKind(slug, m[1], allSlugs) !== null);
    if (!ok) blocked('Supabase 관리', method, path);
    return await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, body });
  };
}
function github(slug: string, token: string) {
  const base = `/repos/${ORG}/${slug}`;
  const rules = [new RegExp(`^${esc(base)}/commits/main$`), new RegExp(`^${esc(base)}/git/trees/[0-9a-f]{40}\\?recursive=1$`), new RegExp(`^${esc(base)}/git/blobs/[0-9a-f]{40}$`)];
  return async (path: string, raw = false) => {
    if (!rules.some((re) => re.test(path))) blocked('GitHub', 'GET', path);
    const r = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bmr-apps-hub-fn-deploy' } });
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `GitHub 읽기 실패 (${r.status})`); }
    return r;
  };
}

type Claims = { repository?: string; repository_owner?: string; ref?: string; sha?: string; event_name?: string; workflow_ref?: string; run_id?: string; run_attempt?: string; actor?: string };
type Tree = { tree: { path: string; type: string; sha: string; size?: number }[]; truncated?: boolean };

async function audit(who: string, target: string, result: 'ok' | 'error' | 'denied', detail: string) {
  try {
    await db`insert into public.audit_log (actor, actor_email, action, target, result, detail)
      values (null, ${clean(who, 200)}, 'fn:deploy', ${target.slice(0, 200)}, ${result}, ${detail.slice(0, 2000)})`;
  } catch (e) { console.error('audit', String((e as Error)?.message ?? e).slice(0, 200)); }
}

// 실수로 허브 전용 비밀값·다른 앱 비밀값을 읽는 코드를 막는다 (문자열을 쪼개면 피할 수 있으므로 '격리'는 아님)
function lint(path: string, src: string, own: string, others: string[]): string | null {
  const bad: [RegExp, string][] = [
    [/SERVICE_ROLE/, 'SUPABASE_SERVICE_ROLE_KEY'], [/SUPABASE_SECRET_KEYS/, 'SUPABASE_SECRET_KEYS'], [/SUPABASE_DB_URL/, 'SUPABASE_DB_URL'],
    [/\bBMR_(?:MGMT|GH)_TOKEN\b/, '허브 토큰'], [/\bBMR_RESEND_API_KEY\b/, '허브 메일 키'], [/\bRESEND_(?:API|ADMIN)_KEY\b/, 'Resend 키'], [/\bHUB_CRON_SECRET\b/, '허브 비밀값'], [/Deno\s*\.\s*env\s*\.\s*toObject/, 'Deno.env.toObject()'],
  ];
  for (const [re, what] of bad) if (re.test(src)) return `${path}: ${what} 는 앱 함수에서 쓸 수 없습니다.`;
  const rest = src.replaceAll(own, '');
  for (const p of others) if (p !== own && new RegExp(`\\b${esc(p)}`).test(rest)) return `${path}: 다른 앱 비밀값(${p}…)은 쓸 수 없습니다.`;
  return null;
}

async function healthOf(fn: string) {
  for (let i = 0; i < 6; i++) {
    try { const r = await fetch(`${SB_URL}/functions/v1/${fn}/health`, { signal: AbortSignal.timeout(10_000) }); await r.body?.cancel(); if (r.status < 500 || i === 5) return r.status; } catch { /* 다시 */ }
    await new Promise((res) => setTimeout(res, 3000));
  }
  return 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST 만 받습니다.' });
  const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!tok) return json(401, { error: '토큰이 없습니다.' });
  let c: Claims;
  try {
    ({ payload: c } = await jwtVerify(tok, JWKS, { issuer: ISSUER, audience: AUD, algorithms: ['RS256'] }) as unknown as { payload: Claims });
  } catch { return json(401, { error: '토큰을 확인하지 못했습니다.' }); }
  await req.body?.cancel();
  const repo = String(c.repository ?? '').toLowerCase();
  const who = `github:${clean(c.actor, 60)}`;
  if (c.repository_owner?.toLowerCase() !== ORG || !repo.startsWith(`${ORG}/`)) return json(403, { error: '허용되지 않은 저장소입니다.' });
  const runId = clean(c.run_id, 20);
  const runUrl = runId ? `https://github.com/${c.repository}/actions/runs/${runId}` : '';
  let slug = '';
  try {
    const apps = await db`select slug, repo_url, fn_auto_deploy from public.apps`;
    const app = apps.find((a) => String(a.repo_url ?? '').toLowerCase().replace(/\.git$/, '').replace(/\/$/, '') === `https://github.com/${repo}`);
    if (!app || !SLUG_RE.test(String(app.slug))) return json(404, { error: '허브에 등록된 앱 저장소가 아닙니다.' });
    slug = String(app.slug);
    if (c.ref !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(String(c.event_name))) {
      await audit(who, slug, 'denied', `main 이 아님 (${clean(c.ref, 80)} · ${clean(c.event_name, 30)}) ${runUrl}`);
      return json(403, { error: 'main 브랜치 push(또는 수동 실행)만 배포합니다.' });
    }
    if (String(c.workflow_ref ?? '').toLowerCase() !== `${repo}/.github/workflows/functions-check.yml@refs/heads/main`) {
      await audit(who, slug, 'denied', `다른 워크플로 (${clean(c.workflow_ref, 200)}) ${runUrl}`);
      return json(403, { error: '서버 함수 검사·배포 워크플로(functions-check.yml)가 아닙니다.' });
    }
    if (app.fn_auto_deploy !== true) {
      // 꺼진 앱: 같은 앱에 한 시간 안에 같은 기록이 없을 때만 남긴다 (push 마다 쌓이지 않게)
      const [{ n: seen }] = await db`select count(*)::int as n from public.audit_log where action = 'fn:deploy' and target = ${slug} and result = 'denied' and detail like '자동 배포 꺼짐%' and at > now() - interval '1 hour'`;
      if (!seen) await audit(who, slug, 'denied', `자동 배포 꺼짐 · 커밋 ${clean(c.sha, 7)} · ${runUrl}`);
      return json(403, { ok: false, disabled: true, error: OFF_MSG });
    }
    const [{ n }] = await db`select count(*)::int as n from public.audit_log where action = 'fn:deploy' and target = ${slug} and result <> 'denied' and at > now() - interval '1 hour'`;
    if (n >= LIMIT.perAppHour) { await audit(who, slug, 'denied', `시간당 ${LIMIT.perAppHour}회 넘음 ${runUrl}`); return json(429, { error: `한 시간에 ${LIMIT.perAppHour}번까지 배포합니다. 잠시 뒤 다시 실행하세요.` }); }

    const schema = slug.replaceAll('-', '_'), prefix = `${schema.toUpperCase()}_`;
    const sha = clean(c.sha, 40);
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new HttpError(400, '커밋 정보가 없습니다.');
    const allSlugs = (await db`select slug from public.apps`).map((a) => String(a.slug));
    const t = await tokens();
    const gh = github(slug, t.gh), sb = mgmt(slug, allSlugs, t.mgmt);
    const main = `${slug}-fn`;

    // 이 커밋의 supabase/functions/ 아래에서 이 앱 몫의 폴더(<slug>-fn, <slug>-이름)만 고른다
    const treeOf = async (s: string) => { const tr = await (await gh(`/repos/${ORG}/${slug}/git/trees/${s}?recursive=1`)).json() as Tree; if (tr.truncated) throw new HttpError(413, '저장소 파일이 너무 많습니다.'); return tr; };
    const tree = await treeOf(sha);
    const dirSha = (tr: Tree, fn: string) => tr.tree.find((x) => x.type === 'tree' && x.path === `supabase/functions/${fn}`)?.sha ?? '';
    const dirs = tree.tree.filter((x) => x.type === 'tree' && /^supabase\/functions\/[^/]+$/.test(x.path)).map((x) => x.path.slice('supabase/functions/'.length));
    const mine = dirs.filter((d) => fnKind(slug, d, allSlugs) !== null && tree.tree.some((x) => x.type === 'blob' && x.path === `supabase/functions/${d}/index.ts`));
    const odd = dirs.filter((d) => d.startsWith(`${slug}-`) && d !== main && fnKind(slug, d, allSlugs) === null);
    if (odd.length) throw new HttpError(422, `함수 폴더 이름을 쓸 수 없습니다: ${odd.slice(0, 3).join(', ')} (${slug}-영문소문자·숫자, ${EXTRA_FN_SUFFIX_MAX}자까지)`);
    if (!mine.length) throw new HttpError(400, `supabase/functions/${main}/index.ts 가 없습니다.`);

    // 지금 프로젝트에 있는 함수 · 추가 함수 한도
    const lr = await sb('GET', '/functions');
    if (!lr.ok) { await lr.body?.cancel(); throw new HttpError(502, `함수 목록 확인 실패 (${lr.status})`); }
    const existing = await lr.json() as { slug: string; version: number }[];
    const have = new Map(existing.map((f) => [f.slug, Number(f.version) || 0]));
    if (!have.has(main)) throw new HttpError(404, `${main} 함수가 아직 없습니다 (허브에서 만든 앱만 배포).`);
    const extrasNow = existing.filter((f) => fnKind(slug, f.slug, allSlugs) === 'extra').map((f) => f.slug);
    const newOnes = mine.filter((d) => !have.has(d));
    const extrasAfter = new Set([...extrasNow, ...newOnes.filter((d) => d !== main)]);
    if (extrasAfter.size > EXTRA_FN_MAX) throw new HttpError(422, `추가 서버 함수는 앱마다 ${EXTRA_FN_MAX}개까지입니다 (지금 ${extrasNow.length}개, 새로 ${newOnes.length}개). 안 쓰는 함수는 허브 개발 정보에서 지우세요.`);
    if (newOnes.length && existing.length + newOnes.length > PROJECT_FN_MAX) throw new HttpError(422, '프로젝트 전체 함수 수 한도에 가까워 새 함수를 만들 수 없습니다. 관리자에게 알려 주세요.');

    // 바뀐 함수만 (수동 실행은 모두). 그 사이 main 에 그 함수를 바꾼 더 새 커밋이 있으면 그 함수는 건너뜀
    const head = String((await (await gh(`/repos/${ORG}/${slug}/commits/main`)).json()).sha ?? '');
    const headTree = head && head !== sha ? await treeOf(head) : null;
    const state = new Map((await db`select fn, dir_sha from bmr_admin.fn_deploy_state where app_slug = ${slug}`).map((r) => [String(r.fn), String(r.dir_sha)]));
    const others = allSlugs.map((a) => a.replaceAll('-', '_').toUpperCase() + '_');
    type Result = { fn: string; status: 'deployed' | 'created' | 'unchanged' | 'skipped'; version_before: number; version: number; files: number; health?: number; note?: string };
    const results: Result[] = [];
    for (const fn of mine.sort((x, y) => (x === main ? -1 : y === main ? 1 : x.localeCompare(y)))) {
      const ds = dirSha(tree, fn), before = have.get(fn) ?? 0;
      if (headTree && dirSha(headTree, fn) !== ds) { results.push({ fn, status: 'skipped', version_before: before, version: before, files: 0, note: `더 새 커밋 ${head.slice(0, 7)} 이 이 함수를 바꿈` }); continue; }
      if (c.event_name === 'push' && have.has(fn) && state.get(fn) === ds) { results.push({ fn, status: 'unchanged', version_before: before, version: before, files: 0 }); continue; }
      const [{ n: used }] = await db`select count(*)::int as n from public.audit_log where action = 'fn:deploy' and target = ${slug} and result <> 'denied' and at > now() - interval '1 hour'`;
      if (used >= LIMIT.perAppHour) throw new HttpError(429, `한 시간에 ${LIMIT.perAppHour}번까지 배포합니다. 잠시 뒤 다시 실행하세요.`);
      const base = `supabase/functions/${fn}`;
      const blobs = tree.tree.filter((x) => x.type === 'blob' && x.path.startsWith(base + '/'));
      if (blobs.length > LIMIT.files) throw new HttpError(413, `${fn}: 파일이 너무 많습니다 (${blobs.length}개, ${LIMIT.files}개까지).`);
      let total = 0;
      for (const b of blobs) {
        const rel = b.path.slice(base.length + 1);
        if (!PATH_RE.test(rel) || rel.split('/').some((p) => p === '..' || p === '.')) throw new HttpError(400, `파일 이름을 쓸 수 없습니다: ${clean(rel, 120)}`);
        if ((b.size ?? 0) > LIMIT.fileBytes) throw new HttpError(413, `${fn}/${rel} 가 너무 큽니다 (파일당 4MB 까지).`);
        total += b.size ?? 0;
      }
      if (total > LIMIT.totalBytes) throw new HttpError(413, `${fn} 폴더가 너무 큽니다 (${(total / 1048576).toFixed(1)}MB, 10MB 까지).`);
      const fd = new FormData();
      fd.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: fn, verify_jwt: false }));
      for (const b of blobs) {
        const rel = b.path.slice(base.length + 1);
        const buf = new Uint8Array(await (await gh(`/repos/${ORG}/${slug}/git/blobs/${b.sha}`, true)).arrayBuffer());
        if (CODE_RE.test(rel)) { const why = lint(`${fn}/${rel}`, new TextDecoder().decode(buf), prefix, others); if (why) throw new HttpError(422, why); }
        fd.append('file', new Blob([buf]), rel);
      }
      const r = await sb('POST', `/functions/deploy?slug=${fn}`, fd);
      const txt = await r.text();
      if (!r.ok) throw new HttpError(502, `${fn} 배포 실패 (${r.status}): ${clean(txt, 600)}`);
      let version = 0; try { version = Number(JSON.parse(txt).version) || 0; } catch { /* 아래에서 다시 */ }
      if (!version) { const g = await sb('GET', '/functions'); version = g.ok ? Number(((await g.json()) as { slug: string; version: number }[]).find((x) => x.slug === fn)?.version) || 0 : 0; }
      const health = await healthOf(fn);
      await db`insert into bmr_admin.fn_deploy_state (fn, app_slug, dir_sha, commit_sha, version) values (${fn}, ${slug}, ${ds}, ${sha}, ${version})
        on conflict (fn) do update set dir_sha = excluded.dir_sha, commit_sha = excluded.commit_sha, version = excluded.version, app_slug = excluded.app_slug, at = now()`;
      const created = !have.has(fn);
      await audit(who, slug, 'ok', `${fn} ${created ? '새로 만듦' : ''} v${before} → v${version} · 커밋 ${sha.slice(0, 7)} · 파일 ${blobs.length}개 · /health ${health || '응답 없음'} · ${runUrl}`);
      results.push({ fn, status: created ? 'created' : 'deployed', version_before: before, version, files: blobs.length, health });
    }
    // 예전 워크플로(Summary 가 .fn/.version 만 읽음)와 맞추려고 기본 함수 결과를 맨 위에도 둔다
    const m = results.find((x) => x.fn === main) ?? results[0];
    const allSkipped = results.every((x) => x.status === 'skipped');
    if (allSkipped) {
      await audit(who, slug, 'ok', `건너뜀: 커밋 ${sha.slice(0, 7)} 뒤에 함수가 바뀐 커밋 ${head.slice(0, 7)} 이 있음 · ${runUrl}`);
      return json(409, { ok: false, skipped: true, results, error: `더 새 커밋(${head.slice(0, 7)})이 함수를 바꿨습니다. 그 커밋의 실행이 배포합니다.` });
    }
    return json(200, { ok: true, app: slug, commit: sha, fn: m.fn, version_before: m.version_before, version: m.version, files: m.files, health: m.health ?? '바뀌지 않아 건너뜀', results });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = e instanceof HttpError ? e.message : '서버 오류';
    if (!(e instanceof HttpError)) console.error('hub-fn-deploy', String((e as Error)?.message ?? e).slice(0, 300));
    if (slug) await audit(who, slug, status === 422 ? 'denied' : 'error', `${msg} · ${runUrl}`);
    return json(status, { ok: false, error: msg });
  }
});
