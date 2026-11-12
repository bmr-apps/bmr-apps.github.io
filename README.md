# BMR APPS 앱 관리 허브 (apps.bmrschool.net)

별무리학교 앱 목록·담당 개발자·새 앱 신청/승인·토큰 발급 기록·운영 상태를 한곳에서 관리합니다.
GitHub Pages 조직 사이트(`bmr-apps/bmr-apps.github.io`)로 배포되고, 백엔드는 허브 전용 Supabase 프로젝트입니다.

## 화면 (허브 화면은 /hub/ 아래, 앱 주소 /<slug> 와 겹치지 않음)
- `/` 누구나 보는 운영 중 앱 바로가기
- `/hub/login` 로그인·가입 (이름·이메일·비밀번호, 확인 메일 없이 바로 로그인)
- `/hub/account` 내 계정 · 허브 로그인 비밀번호 바꾸기
- `/hub/apps` 서비스 목록·담당 개발자 (관리자: 추가·수정)
- `/hub/requests` 새 앱 신청 / 관리자 승인·반려 (승인하면 apps 행과 책임 담당자가 생김, 상태 '준비 중')
- `/hub/tokens` 토큰 발급 기록 (관리자 전용, **값은 저장하지 않음**, 14일 안 만료 강조)
- `/hub/status` 운영 상태 (Edge Function `hub-health`, 매시 정각 pg_cron)
- `/hub/members` 사용자 관리 (관리자 전용: 역할·비밀번호 초기화·사용 중지·삭제)
- `/hub/db` **DB 접속 정보** — 개발자(staff)·관리자만. 허브 계정 메일이 앱 담당자 메일과 같으면(관리자는 전체) 그 앱이 보임.
  '처음 비밀번호 받기'(한 번만, 받으면 서버 사본 삭제) · '새 비밀번호 발급'(즉시 이전 값 무효, 저장 안 함) · 직접 바꾸는 SQL 안내 · 최근 기록.
  관리자는 앱 상세(`/hub/apps` → 앱)에서도 같은 카드를 보고, 담당자 계정·개발자 여부 확인과 **가입 안내 메일**(누를 때만 발송)을 할 수 있음.

## 역할
가입하면 `pending`(일반 사용자)로 바로 허브를 볼 수 있습니다. 앱 신청·DB 접속 정보·운영 상태는 관리자가 `staff`(개발자) 또는 `admin`(관리자)으로 올린 뒤에만 쓸 수 있습니다. `disabled`는 사용 중지. (이메일은 확인하지 않으므로, 메일만 같다고 개발자 권한을 자동으로 주지 않습니다.)

**첫 관리자 만들기**: 사이트에서 가입한 뒤, Supabase SQL 편집기에서 한 줄 실행
```sql
update public.profiles set role = 'admin' where email = 'dev@bmrschool.org';
```

## 백엔드 설정 (새 프로젝트 기준, 토큰은 출력되지 않음)
```bash
export HUB_REF=<허브 프로젝트 ref>  HUB_TOKEN_ENV=SUPABASE_ACCESS_TOKEN_NEW
node scripts/migrate.mjs            # 테이블·RLS·시드·cron
node scripts/auth_config.mjs        # site_url, 리디렉트 허용, 가입 허용, 이메일 확인 없음(바로 로그인)
node scripts/setup_cron_secret.mjs  # Vault + 함수 비밀값 HUB_CRON_SECRET
(cd supabase && SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN_NEW npx supabase functions deploy hub-health --project-ref $HUB_REF --use-api)
(cd supabase && SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN_NEW npx supabase functions deploy hub-dbcred --project-ref $HUB_REF --use-api --no-verify-jwt)
(cd supabase && SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN_NEW npx supabase functions deploy hub-users --project-ref $HUB_REF --use-api --no-verify-jwt)
# 또는: node scripts/deploy-fn.mjs hub-users
```

### `hub-dbcred` (앱 DB 비밀번호 전달)
- 마이그레이션 `20261112070000_dbcred.sql`: token_logs 종류 `supabase_db_password`, 시도 기록표 `bmr_admin.dbcred_attempts`(권한 없음, 함수만 씀).
- 동작 `list`·`reveal`·`rotate`·`invite`(로그인 JWT 확인 후 서버에서 담당자/관리자 확인), `stage`(서버용 키만 — `bmr-app-templates/provision.mjs` 가 부름).
- 1회용 비밀번호는 Vault `bmr_dbcred:<slug>`. 역할 비밀번호는 SCRAM 값으로만 넣어 평문이 DB 로그에 남지 않음. 출처 허용: apps.bmrschool.net, localhost.
- 시험: `bmr-app-templates/test/dbcred.mjs`.

### `hub-users` (사용자 관리)
- 마이그레이션 `20261112103000_hub_users.sql`: token_logs 종류 `hub_user`, 신청 기록은 계정 삭제 뒤에도 남김(`requested_by` 빈 값), 역할 변경은 서버 함수만, 시도 기록표 `bmr_admin.users_attempts`.
- 동작 `list`·`set_role`·`reset_password`·`delete` — 관리자 JWT 만. 사용 중지는 Auth 로그인 차단. 임시 비밀번호는 한 번만 돌려 주고 저장하지 않음. 본인·마지막 관리자는 삭제/강등 불가.
- 시험: `node scripts/test-hub-users.mjs`.

## 배포
`main`에 push하면 `.github/workflows/deploy.yml`이 빌드해 Pages로 배포합니다.
저장소 Settings → Pages → Source: **GitHub Actions**, Actions 변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`(공개 키만).
CSP는 빌드 때 meta 태그로 들어가고, SPA 새로고침을 위해 `404.html`을 복사합니다. `public/CNAME` = apps.bmrschool.net.

## 로컬
```bash
cp .env.example .env.local   # 값 채우기
npm ci && npm run dev        # http://localhost:5173
npm run build && npx vite preview && node scripts/screenshot.mjs   # 가짜 데이터로 화면 캡처
```
