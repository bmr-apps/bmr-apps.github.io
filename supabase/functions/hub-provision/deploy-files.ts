// 처음 함수를 배포할 때 FormData 에 넣을 파일 목록.
// index.ts 는 늘 넣고, index.ts 가 './lib/hub.ts' 를 가져오므로 lib/hub.ts 도 반드시 함께 넣는다
// (빠지면 관리 API 가 400 Module not found ".../source/lib/hub.ts" 로 배포를 거절한다).
// mail.ts 는 index.ts 가 쓰지 않지만, 배포본을 저장소(supabase/functions/<함수>/)와 같게 두려고 함께 넣는다.
// Deno·네트워크에 기대지 않는 순수 함수라 Node 시험(scripts/test-selfservice-rules.mjs)에서 그대로 부를 수 있다.

/** 배포 파일 이름 규칙 — 함수 폴더 안의 상대 경로만 (예: index.ts, lib/hub.ts) */
export const DEPLOY_FILE_RE = /^[a-z][a-z0-9_./-]{0,80}\.ts$/;

export class DeployFilesError extends Error {}

/** [상대 경로, 내용] 목록. index.ts 가 맨 앞 */
export function deployFiles(source: string, extra: Record<string, string> = {}): [string, string][] {
  const out: [string, string][] = [['index.ts', source]];
  for (const [rel, text] of Object.entries(extra)) {
    if (rel === 'index.ts') throw new DeployFilesError('배포 파일 이름이 겹칩니다 (index.ts).');
    if (!DEPLOY_FILE_RE.test(rel) || rel.includes('..') || rel.includes('//')) {
      throw new DeployFilesError(`배포 파일 이름을 쓸 수 없습니다: ${String(rel).slice(0, 60)}`);
    }
    out.push([rel, String(text)]);
  }
  return out;
}
