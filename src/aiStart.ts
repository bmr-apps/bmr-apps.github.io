// 웹 AI(ChatGPT Codex · Claude Code)에게 그대로 붙여 넣는 '앱 개발 프롬프트'.
// 앱 주소·저장소·slug·DB 스키마와 BMR APPS 규칙을 자동으로 채운다 (허브의 🤖 AI로 개발 시작하기 카드에서 복사).

export type AiAppRef = { name: string; slug: string; repoUrl?: string | null };

/** 새 앱 저장소의 기본 주소 (허브 행의 repo_url 이 비어 있어도 같은 규칙) */
export const repoUrlOf = (slug: string) => `https://github.com/bmr-apps/${slug}`;

export function aiPrompt({ name, slug, repoUrl }: AiAppRef): string {
  const schema = slug.replace(/-/g, '_');
  return `BMR APPS 앱을 웹 AI로 개발합니다. 아래 규칙을 지켜 주세요.

[앱]
- 이름: ${name.trim() || slug}
- 저장소: ${repoUrl || repoUrlOf(slug)} — 이 저장소에서만 작업합니다.
- 배포 주소: https://apps.bmrschool.net/${slug}/
- DB 스키마: ${schema}

[꼭 지킬 것]
1. 새 프로젝트·새 저장소를 만들지 말고, 이 저장소의 파일을 고쳐서 작업하세요. README.md 와 CLAUDE.md(또는 AGENTS.md)를 먼저 읽어 주세요.
2. 앱은 https://apps.bmrschool.net/${slug}/ 아래에서 열립니다. base 경로 '/${slug}/' 를 그대로 두고, 모든 경로는 './' 상대 경로로 쓰세요.
3. 로고는 글자 대신 자체 SVG 로 그리고, 누르면 './' (이 앱 첫 화면)로 돌아오게 하세요.
4. 인라인 style 속성과 <style> 은 쓰지 마세요(CSP: style-src 'self'). 외부 CDN 스크립트·폰트도 막힙니다. 라이브러리는 npm 으로 설치해 함께 빌드하세요.
5. 브라우저 저장소(localStorage·sessionStorage) 이름 앞에 '${slug}:' 를 붙이고 clear() 는 쓰지 마세요. 로그아웃은 supabase.auth.signOut({ scope: 'local' }) 로만 하세요.
6. DB 표가 필요하면 supabase/migrations/<날짜시간>_<이름>.sql 파일만 추가해 커밋·푸시하세요. GitHub Actions 가 자동으로 DB 에 반영합니다(로컬 psql·npm run db:migrate 불필요). 정책에서는 auth.uid() 대신 bmr.uid() 를 쓰세요.
7. 끝내기 전에 \`npm run build\` 성공과 \`node scripts/bmr-check.mjs\` 경고 0건을 확인하고 push 하세요(1~2분 뒤 배포).

[만들 것]
- (여기에 만들 화면과 기능을 적어 주세요. 예: 10학년 현장학습 신청 — 학생은 신청서를 내고, 담당 교사는 신청 명단을 본다)`;
}

/** 클립보드 복사: https 가 아닌 곳·권한 거부면 예전 방식으로 한 번 더 시도한다 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 아래로 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}
