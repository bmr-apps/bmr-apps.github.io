// 허브 함수 배포 기록: audit_log 에 hub:deploy (함수·버전·git 커밋·고치지 않은 변경 여부). 비밀값은 남기지 않는다.
// deploy-fn.mjs · setup-provision.mjs 가 배포 성공 뒤 부른다. 기록에 실패해도 배포는 실패로 보지 않는다.
import { execFileSync } from 'node:child_process';
import { sql, api } from './sql.mjs';

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
function gitInfo(dir) {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: dir }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', dir], { cwd: dir }).toString().trim() !== '';
    return { sha, dirty };
  } catch { return { sha: '?', dirty: true }; }
}
export async function recordDeploy(fnName, dir) {
  try {
    const { sha, dirty } = gitInfo(dir);
    let version = '?';
    const r = await api(`/functions/${encodeURIComponent(fnName)}`);
    if (r.ok) version = String((await r.json()).version ?? '?'); else await r.body?.cancel();
    const who = process.env.HUB_DEPLOY_BY || 'admin-script';
    const detail = `v${version} · 커밋 ${sha}${dirty ? ' (커밋 안 된 변경 있음)' : ''}`;
    await sql(`insert into public.audit_log (actor, actor_email, action, target, result, detail) values (null, ${lit(who)}, 'hub:deploy', ${lit(fnName)}, 'ok', ${lit(detail)})`);
    console.log(`  배포 기록: ${fnName} ${detail}`);
  } catch (e) { console.log(`  (배포 기록 실패: ${String(e.message).slice(0, 120)})`); }
}
