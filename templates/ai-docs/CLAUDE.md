# {{APP_NAME}} — 웹 AI 개발 규칙

이 저장소는 BMR APPS 가 미리 만들어 둔 **승인된 앱 저장소**입니다.
**새 프로젝트·새 저장소를 만들지 말고, 항상 이 저장소에서 작업하세요.**
(`npm create`, `git init`, 새 GitHub 저장소 생성 금지 — 화면과 데이터만 만들면 됩니다.)

| 항목 | 값 |
|---|---|
| 앱 주소 | https://{{DOMAIN}}/{{SLUG}}/ |
| 저장소 | https://github.com/{{ORG}}/{{SLUG}} |
| DB 스키마 | `{{SCHEMA}}` (이 안에서만 표·뷰·정책을 만든다) |
| 서버 함수 | `{{FN}}` |
| 함수 비밀값 접두어 | `{{PREFIX}}` (예: `{{PREFIX}}EXAMPLE_KEY`) |

## 1. 화면

- `vite.config.js` 의 `base: '/{{SLUG}}/'` 를 바꾸지 마세요. 모든 경로는 `./` 상대 경로나 `import.meta.env.BASE_URL` 로 씁니다(`'/data.json'` 같은 맨 앞 `/` 경로 금지).
- **로고는 글자·이모지 대신 자체 SVG** 로 그립니다(외부 이미지·아이콘 CDN 금지). 머리글 로고를 누르면 `./` (이 앱 첫 화면)로 돌아오게 하세요.
- **CSP 를 지킵니다**: `style-src 'self'` 라서 인라인 `style="…"`·`<style>` 은 막힙니다. 스타일은 CSS 파일과 클래스로 쓰세요. 외부 CDN 스크립트·폰트도 막히니, 필요한 라이브러리는 `npm install` 로 받아 함께 빌드합니다.
- 브라우저 저장소 이름 앞에는 반드시 **`{{SLUG}}:`** 를 붙입니다(`src/store.js` 의 `local`·`session` 사용). `localStorage.clear()`·`sessionStorage.clear()` 는 쓰지 마세요 — 같은 주소를 쓰는 다른 앱의 저장값까지 지워집니다.
- 로그아웃은 **`supabase.auth.signOut({ scope: 'local' })`** 만. 그냥 `signOut()` 은 이 사이트의 모든 앱 로그인을 끊습니다.

## 2. 데이터베이스 — SQL 파일만 올리면 자동 반영

표·뷰·함수·정책이 필요하면 **`supabase/migrations/<날짜시간>_<이름>.sql`** 파일만 추가하고 커밋·푸시하세요.

```
supabase/migrations/20261124120000_create_books.sql
```

- 푸시하면 GitHub Actions(`deploy.yml`)가 `npm run db:migrate` 를 자동 실행해 DB 에 반영합니다.
- **로컬 명령(psql, `npm run db:migrate`)은 필요 없습니다.** DATABASE_URL 은 저장소의 Actions 비밀값으로 이미 들어 있습니다.
- 이미 적용된 파일은 다시 실행하지 않습니다(이름 순서, `{{SCHEMA}}._migrations` 에 기록). 올린 파일은 고치지 말고 **새 파일**로 추가하세요.
- SQL 규칙: 모든 객체 이름에 `{{SCHEMA}}.` 를 붙이고, 정책에서는 `auth.uid()` 대신 **`bmr.uid()`** 를 씁니다(개발자 DB 계정은 `auth` 스키마 권한이 없음). 새 표에는 RLS 정책과 필요한 `grant insert, update, delete` 를 함께 쓰세요.
- 브라우저 코드에서는 `src/supabase.js` 의 `supabase` 로 읽고 씁니다(공개 키, 스키마 `{{SCHEMA}}` 지정됨). 비밀 키·DB 비밀번호는 브라우저 코드에 넣지 마세요.

## 3. 끝내기 전에 스스로 확인

- `npm run build` 성공 (타입 오류 0건)
- `node scripts/bmr-check.mjs` 경고 0건
- 둘 다 통과하면 커밋하고 `main` 에 푸시하세요. 1~2분 뒤 https://{{DOMAIN}}/{{SLUG}}/ 에 배포됩니다.
- 서버 함수(`supabase/functions/{{FN}}/`)를 고쳤다면 `deno check` 가 통과하는지 확인하세요.

## 4. 하지 말 것

- `.env.local`, DB 비밀번호, `service_role` 키를 저장소·코드·로그에 넣기 (저장소는 공개입니다)
- `{{DOMAIN}}` 의 다른 앱·허브를 가리키는 맨 앞 `/` 경로, 서비스 워커를 `/{{SLUG}}/` 밖 범위로 등록
- 다른 앱의 스키마·표, `auth.users` 를 직접 읽거나 고치기
- 학생 개인정보를 관리자와 상의 없이 새로 모으기
