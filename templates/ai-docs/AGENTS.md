# {{APP_NAME}} — 웹 AI 개발 규칙 (Codex)

이 저장소는 Codex 를 포함한 웹 AI 로 개발하는 **승인된 BMR APPS 앱 저장소**입니다.
**새 프로젝트·새 저장소를 만들지 말고, 항상 이 저장소에서 작업하세요.**
(`npm create`, `git init`, 새 GitHub 저장소 생성 금지 — 화면과 데이터만 만들면 됩니다.)
Claude Code 를 쓴다면 같은 내용이 `CLAUDE.md` 에도 있습니다.

| 항목 | 값 |
|---|---|
| 앱 주소 | https://{{DOMAIN}}/{{SLUG}}/ |
| 저장소 | https://github.com/{{ORG}}/{{SLUG}} |
| DB 스키마 | `{{SCHEMA}}` |
| 서버 함수 | `{{FN}}` |
| 함수 비밀값 접두어 | `{{PREFIX}}` |

## 작업 순서

1. `README.md`(접속 정보·예제)와 `.bmr-app.json`(앱 정보)을 먼저 읽습니다.
2. 화면·서버 함수를 고칩니다. **새 프로젝트를 만들지 않습니다.**
3. DB 표가 필요하면 `supabase/migrations/<날짜시간>_<이름>.sql` 파일만 추가합니다.
4. `npm run build` 와 `node scripts/bmr-check.mjs` 를 통과시키고 커밋·푸시합니다.

## 지킬 규칙

- `vite.config.js` 의 `base: '/{{SLUG}}/'` 를 바꾸지 않고, 경로는 `./` 상대 경로를 씁니다(`'/data.json'` 금지).
- 로고는 자체 SVG. 누르면 `./` 로. 외부 이미지·아이콘 CDN 금지.
- CSP: 인라인 `style`·`<style>` 금지(`style-src 'self'`), 외부 CDN 스크립트 금지. 라이브러리는 `npm install` 로 함께 빌드.
- 브라우저 저장소 이름 앞에 `{{SLUG}}:` 를 붙이고, `localStorage.clear()`·`sessionStorage.clear()` 는 쓰지 않습니다.
- 로그아웃은 `supabase.auth.signOut({ scope: 'local' })` 만.
- 데이터는 `supabase/migrations/*.sql` 로만 바꿉니다. **푸시하면 GitHub Actions 가 자동으로 DB 에 반영하니 로컬 `psql`·`npm run db:migrate` 는 쓰지 않습니다.**
- 정책에서는 `auth.uid()` 대신 `bmr.uid()`. 모든 객체는 `{{SCHEMA}}.` 스키마 안에만.
- 비밀값(비밀번호·키·토큰)은 코드·커밋·로그에 넣지 않습니다. 저장소는 공개입니다.

## 확인 기준

- `npm run build` 성공 (타입 오류 0건)
- `node scripts/bmr-check.mjs` 경고 0건
- 서버 함수를 고쳤으면 `deno check` 통과
