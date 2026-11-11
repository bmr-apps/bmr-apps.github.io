# 별무리 앱 관리 허브 (apps.bmrschool.net)

별무리학교 앱 목록·담당 교사·새 앱 신청/승인·토큰 발급 기록·운영 상태를 한곳에서 관리합니다.
GitHub Pages 조직 사이트(`bmr-apps/bmr-apps.github.io`)로 배포되고, 백엔드는 허브 전용 Supabase 프로젝트입니다.

## 화면 (허브 화면은 /hub/ 아래, 앱 주소 /<slug> 와 겹치지 않음)
- `/` 누구나 보는 운영 중 앱 바로가기
- `/hub/login` 직원 로그인·가입 (이메일·비밀번호)
- `/hub/apps` 서비스 목록·담당 교사 (관리자: 추가·수정)
- `/hub/requests` 새 앱 신청 / 관리자 승인·반려 (승인하면 apps 행과 책임 담당자가 생김, 상태 '준비 중')
- `/hub/tokens` 토큰 발급 기록 (관리자 전용, **값은 저장하지 않음**, 14일 안 만료 강조)
- `/hub/status` 운영 상태 (Edge Function `hub-health`, 매시 정각 pg_cron)
- `/hub/members` 역할 관리 (관리자 전용)

## 역할
가입하면 `pending`(승인 대기) → 관리자가 `staff`(직원) 또는 `admin`(관리자)으로 올립니다. `disabled`는 사용 중지.

**첫 관리자 만들기**: 사이트에서 가입하고 이메일 확인을 마친 뒤, Supabase SQL 편집기에서 한 줄 실행
```sql
update public.profiles set role = 'admin' where email = 'bmrdev@bmrschool.org';
```

## 백엔드 설정 (새 프로젝트 기준, 토큰은 출력되지 않음)
```bash
export HUB_REF=<허브 프로젝트 ref>  HUB_TOKEN_ENV=SUPABASE_ACCESS_TOKEN_NEW
node scripts/migrate.mjs            # 테이블·RLS·시드·cron
node scripts/auth_config.mjs        # site_url, 리디렉트 허용, 가입 허용+이메일 확인
node scripts/setup_cron_secret.mjs  # Vault + 함수 비밀값 HUB_CRON_SECRET
(cd supabase && SUPABASE_ACCESS_TOKEN=$SUPABASE_ACCESS_TOKEN_NEW npx supabase functions deploy hub-health --project-ref $HUB_REF --use-api)
```

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
