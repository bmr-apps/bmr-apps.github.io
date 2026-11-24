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

export type MigrateRef = { name?: string; slug?: string; repoUrl?: string | null; source?: string | null };

/** 다른 곳(Lovable · v0 · Cursor · 개인 저장소)에서 만든 앱을 승인된 저장소로 옮길 때 쓰는 프롬프트 */
export function migratePrompt({ name, slug, repoUrl, source }: MigrateRef = {}): string {
  const nm = name?.trim() || '[앱 이름]';
  const sl = slug?.trim() || '[주소 이름]';
  const sc = slug?.trim() ? slug.replace(/-/g, '_') : '[주소 이름의 - 를 _ 로 바꾼 스키마 이름]';
  const repo = (repoUrl || '').trim() || (slug?.trim() ? repoUrlOf(slug) : '[승인된 새 저장소 주소]');
  const src = source?.trim() || '[원래 앱 주소나 저장소 주소 — 또는 이 자리에 원래 코드를 붙여 넣습니다]';
  return `다른 곳(Lovable · v0 · Cursor · 내 개인 저장소)에서 만든 앱을 BMR APPS 승인 저장소로 옮깁니다. 아래 순서와 규칙을 그대로 지켜 주세요.

[옮길 곳]
- 앱 이름: ${nm}
- 저장소: ${repo} — 이 저장소에서만 작업합니다. 새 프로젝트·새 저장소를 만들지 마세요.
- 배포 주소: https://apps.bmrschool.net/${sl}/
- DB 스키마: ${sc}
- 원래 앱: ${src}

[순서]
1. README.md 와 CLAUDE.md(또는 AGENTS.md)를 먼저 읽고, 지금 저장소의 파일 목록과 지켜야 할 규칙을 요약해 주세요.
2. 그다음 옮길 계획(어떤 파일을 어디로, 어떤 표를 어떤 이름으로)만 먼저 보여 주세요. 제가 '그대로 해'라고 하면 옮기세요.
3. 옮긴 뒤에는 npm run build 와 node scripts/bmr-check.mjs 를 통과시키고 push 해 주세요.

[절대 덮어쓰지 말 것 — 이 저장소에 이미 준비되어 있습니다]
1. vite.config.js — base('/${sl}/') 와 CSP 설정이 들어 있습니다. base 를 바꾸면 흰 화면이 됩니다.
2. .github/workflows/ — Pages 배포·DB 자동 반영·서버 함수 배포 설정입니다. 손대지 마세요.
3. src/supabase.js — 허브 DB 연결(공개 키·스키마 지정)입니다. 이 파일을 그대로 씁니다.
4. package.json 의 scripts — 특히 bmr-check · db:migrate 항목입니다.
5. CLAUDE.md · AGENTS.md — 이 저장소의 개발 규칙입니다. 지우지 말고 그대로 따릅니다.

[옮기는 규칙]
1. 화면과 기능은 옮기되 공용 주소 규칙에 맞게 고칩니다. 원래 디자인(색·모양)은 살려도 됩니다.
2. 로그인: 원래 앱의 Auth(자체 회원가입·비밀번호 로그인, Firebase·Supabase Auth·Clerk 등)는 가져오지 말고 걷어냅니다. 로그인은 허브의 공용 구글 로그인으로 바꿉니다 — src/supabase.js 의 supabase 에서 supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 내 앱 주소 } }), 로그아웃은 signOut({ scope: 'local' }). 원래 회원 정보(이름·역할)는 auth.users 를 읽지 말고 이 앱 스키마의 표로 옮깁니다.
3. DB: 원래 앱의 표·뷰·정책을 supabase/migrations/<날짜시간>_<이름>.sql 파일로 옮깁니다.
   - public 스키마 대신 이 앱 전용 스키마 ${sc} 를 씁니다 (예: create table ${sc}.books (...)).
   - 정책에서는 auth.uid() 대신 bmr.uid() 를 씁니다.
   - RLS 정책과 grant insert, update, delete 를 함께 씁니다. 다른 앱의 스키마·표는 건드리지 않습니다.
4. 스타일: Tailwind CDN · Bootstrap CDN · 구글 폰트 · 아이콘 CDN 같은 외부 CDN 을 걷어내고, 필요한 라이브러리는 npm install 로 받아 함께 빌드합니다. 인라인 style="..." 과 <style> 태그도 CSS 클래스로 바꿉니다(CSP: style-src 'self').
5. 공용 주소 규칙: 모든 경로는 './' 상대 경로('/data.json' 같은 맨 앞 / 금지), 로고는 글자 대신 자체 SVG(누르면 './'), 브라우저 저장소 이름 앞에 '${sl}:' 를 붙이고 localStorage.clear() 는 쓰지 않습니다.
6. 비밀 키·외부 API 키는 브라우저 코드에 넣지 않습니다. 서버가 필요한 기능은 supabase/functions/${sl}-<이름>/ 로 옮기고 키는 Deno.env.get() 으로 읽습니다.

[데이터 옮기기]
- 원래 앱 데이터는 제가 CSV/JSON 으로 내보내서 붙여 넣습니다. 표 구조에 맞는 임포트 SQL(supabase/migrations/ 새 파일)을 만들어 주세요. 많으면 500행씩 나눠도 됩니다.
- 원래 앱의 로그인 사용자 id(uuid)는 BMR APPS 계정과 다릅니다. owner 같은 칸은 이메일로 다시 잇고, 첫 관리자는 SQL 로 넣어 주세요.

[하지 말 것]
- 새 프로젝트·새 저장소 만들기, 원래 앱의 옛 주소·외부 서비스에 계속 의존하기
- 원래 앱의 Auth 설정·비밀 키를 그대로 가져오기 (저장소는 공개입니다)
- 확인 없이 화면을 완전히 새로 그리기 (바꾸고 싶으면 먼저 시안을 보여 주세요)`;
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
