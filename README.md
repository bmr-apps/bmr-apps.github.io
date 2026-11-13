# BMR APPS 앱 관리 허브 (apps.bmrschool.net)

별무리학교 앱 목록·담당 개발자·새 앱 신청/승인·토큰 발급 기록·운영 상태를 한곳에서 관리합니다.
GitHub Pages 조직 사이트(`bmr-apps/bmr-apps.github.io`)로 배포되고, 백엔드는 허브 전용 Supabase 프로젝트입니다.

## 화면 (허브 화면은 /hub/ 아래, 앱 주소 /<slug> 와 겹치지 않음)
- `/` 누구나 보는 운영 중 앱 바로가기
- `/hub/login` 로그인·가입 (이름·이메일·비밀번호, 확인 메일 없이 바로 로그인)
- `/hub/account` 내 계정 · 허브 로그인 비밀번호 바꾸기 (사이드바 아래 사용자 상자를 누르거나 Ctrl K)
- `/hub/apps` 서비스 목록·담당 개발자 (관리자: 앱 정보 수정 — slug 는 만든 뒤 잠김, 담당자 추가·수정·빼기 → GitHub push 권한 초대·회수, 초대됨/권한 있음/실패 표시)
- `/hub/requests` 새 앱 신청(개발자) / 관리자 **'승인하고 바로 만들기'**·반려. 승인하면 `hub-provision` 이 개발 환경 전체를 바로 만들고 단계별 진행·오류·'다시 시도'를 보여 줌
- `/hub/audit` 감사 기록 (관리자 전용: 승인·생성·담당자 GitHub 권한 변경·거부된 시도)
- `/hub/status` 운영 상태 (Edge Function `hub-health`, 매시 정각 pg_cron)
- `/hub/members` 사용자 관리 (관리자 전용: 역할·비밀번호 초기화·사용 중지·삭제)
- `/hub/db` **DB 접속 정보 모아 보기** — 사이드바에서는 뺐고(Ctrl K·옛 링크·초대 메일로는 열림), 같은 기능(처음 받기·새로 발급·직접 바꾸기·관리자 초대)은 앱 상세 **앱 정보 → DB 접속 정보**(DbCredSection, 같은 DbCredCard)에 있음. 개발자(staff)·관리자만, 허브 계정 메일이 앱 담당자 메일과 같으면(관리자는 전체) 그 앱이 보임.
  '처음 비밀번호 받기'(한 번만, 받으면 서버 사본 삭제) · '새 비밀번호 발급'(즉시 이전 값 무효, 저장 안 함) · 직접 바꾸는 SQL 안내 · 최근 기록.
  관리자는 앱 상세(`/hub/apps` → 앱)에서도 같은 카드를 보고, 담당자 계정·개발자 여부 확인과 **가입 안내 메일**(누를 때만 발송)을 할 수 있음.

## 역할
가입하면 `pending`(일반 사용자)로 바로 허브를 볼 수 있습니다. 앱 신청·DB 접속 정보·운영 상태는 관리자가 `staff`(개발자) 또는 `admin`(관리자)으로 올린 뒤에만 쓸 수 있습니다. `disabled`는 사용 중지. (이메일은 확인하지 않으므로, 메일만 같다고 개발자 권한을 자동으로 주지 않습니다.)

**첫 관리자 만들기**: 사이트에서 가입한 뒤, Supabase SQL 편집기에서 한 줄 실행
```sql
update public.profiles set role = 'admin' where email = 'dev@bmrschool.org';
```

## 백엔드 설정 (토큰은 출력되지 않음)
백엔드: Supabase **bmr-dev-apps** (`psupfmarnyxontorftio`, 서울 ap-northeast-2). 2026-11-12에 옛 프로젝트 `zogddpjesatjmvrshrgr`(뭄바이)에서 옮김 — 옛 프로젝트는 예비로만 남아 있고 쓰지 않음.
스크립트 기본값은 새 프로젝트입니다. 다른 프로젝트면 `HUB_REF`, 토큰 환경변수 이름이 다르면 `HUB_TOKEN_ENV`(기본 `SUPABASE_ACCESS_TOKEN_DEVAPPS`).
```bash
node scripts/migrate.mjs            # 테이블·RLS·시드·cron
node scripts/auth_config.mjs        # site_url, 리디렉트 허용, 가입 허용, 이메일 확인 없음(바로 로그인)
node scripts/setup_cron_secret.mjs  # Vault + 함수 비밀값 HUB_CRON_SECRET
node scripts/deploy-fn.mjs hub-health && node scripts/deploy-fn.mjs hub-dbcred && node scripts/deploy-fn.mjs hub-users
node scripts/build-provision-templates.mjs && node scripts/setup-provision.mjs   # hub-provision: 시작 틀 묶기 + 암호화 토큰 + 배포
```
`hub-dbcred` 가 알려 주는 공용 접속기 주소는 `aws-1-ap-northeast-2.pooler.supabase.com`(서울). 지역이 바뀌면 함수 비밀값 `BMR_POOL_HOST` 로 바꿉니다.

### `hub-dbcred` (앱 DB 비밀번호 전달)
- 마이그레이션 `20261112070000_dbcred.sql`: (옛 token_logs 종류 `supabase_db_password` → 지금은 audit_log `dbcred:reveal`·`dbcred:rotate`), 시도 기록표 `bmr_admin.dbcred_attempts`(권한 없음, 함수만 씀).
- 동작 `list`·`reveal`·`rotate`·`invite`(로그인 JWT 확인 후 서버에서 담당자/관리자 확인), `stage`(서버용 키만 — `bmr-app-templates/provision.mjs` 가 부름).
- 1회용 비밀번호는 Vault `bmr_dbcred:<slug>`. 역할 비밀번호는 SCRAM 값으로만 넣어 평문이 DB 로그에 남지 않음. 출처 허용: apps.bmrschool.net, localhost.
- 시험: `bmr-app-templates/test/dbcred.mjs`.

### `hub-users` (사용자 관리)
- 마이그레이션 `20261112103000_hub_users.sql`: (옛 token_logs 종류 `hub_user` → 지금은 audit_log `user:*`), 신청 기록은 계정 삭제 뒤에도 남김(`requested_by` 빈 값), 역할 변경은 서버 함수만, 시도 기록표 `bmr_admin.users_attempts`.
- 동작 `list`·`set_role`·`reset_password`·`delete` — 관리자 JWT 만. 사용 중지는 Auth 로그인 차단. 임시 비밀번호는 한 번만 돌려 주고 저장하지 않음. 본인·마지막 관리자는 삭제/강등 불가.
- 시험: `node scripts/test-hub-users.mjs`.

### `hub-provision` (승인 즉시 앱 만들기 · 담당자 GitHub 권한)
- 마이그레이션 `20261113090000_provision.sql`: 신청 진행 칸(`provision_status/steps/error/...`), 담당자 `gh_status`, `public.audit_log`(관리자만 봄),
  slug 규칙 `private.slug_problem()`(예약어·시스템 이름·`-fn/-dev` 끝 금지, 이미 쓰는 주소·스키마·역할 거부), 개발자는 신청서 칸만 insert,
  옛 `approve_request` RPC 막음, `apps.slug` 잠금 트리거, 담당자 표 쓰기는 함수만, 공개 RPC `app_public_info(slug)`(앱 화면이 이름·설명을 읽음).
- 동작 `approve`·`run`(이어서/다시 시도)·`add_owner`·`update_owner`·`remove_owner`·`sync_owner` — 모두 **관리자 JWT + DB 역할 admin** 만. 나머지는 403 + 감사 기록.
- 단계: check → db → fn_secret → starter → expose → bucket → function → repo → pages → vars → code → hub → invite → dbcred → health.
  각 단계는 신청 행에 기록되어 실패하면 그 단계부터 이어서 함. 이미 있는 저장소·스키마·함수·버킷이 '이 신청이 만든 것'이 아니면 멈춤(덮어쓰지 않음). 한 번에 약 95초씩, 화면이 자동으로 이어 부름.
- 안전장치(`guard.ts`): Supabase 관리 API 는 이 프로젝트의 고정 SQL·`<slug>-fn` 배포·`<SCHEMA>_DB_URL` 비밀값 하나·Data API 노출 '추가'만, GitHub 는 `bmr-apps/<slug>` 저장소 하나(만들기·파일·Pages·변수·push 초대/회수)만,
  Storage 는 그 버킷 만들기만. 지우기 경로 없음(담당자 권한 회수 제외, 앱 삭제는 별도 함수 `hub-deprovision`). 동시에 하나만(lease), 새 앱 시간당 6개, 모든 동작 `audit_log`.
- 토큰: 함수 비밀값 `BMR_MGMT_TOKEN`·`BMR_GH_TOKEN` 은 **AES-GCM 암호문**이고, 푸는 열쇠는 상자의 `.secrets/hub-provision.key`(git 제외)에서 배포할 때만 함수 배포본(`_key.ts`)에 들어감.
  같은 프로젝트의 다른 앱 함수가 환경변수를 읽어도 토큰을 쓸 수 없음. 토큰을 바꾸면 `node scripts/setup-provision.mjs --secrets`.
- 시작 틀: `templates.ts` 는 `bmr-app-templates` 에서 만든 자동 생성 파일 (`node scripts/build-provision-templates.mjs`).
- 시험: `node scripts/test-hub-provision.mjs` (시험 계정·`zztest-auto`), 정리: `node ../bmr-app-templates/teardown.mjs --slug zztest-auto --yes --delete-repo --delete-hub-row && node scripts/test-hub-provision.mjs --cleanup`.
### `hub-deprovision` (앱 삭제 · 먼저 백업)
- 대시보드 → 앱 → **🗑️ 앱 삭제** (관리자만). 무엇이 지워지는지 미리 보여 주고, 주소 이름(slug)을 그대로 입력해야 시작. 숨기기만 하려면 상태 '종료'.
- 마이그레이션 `20261113110000_deprovision.sql`: `public.app_deletions`(진행·단계·백업 목록, 관리자만 봄), `app_requests.app_deleted_at`,
  비공개 버킷 `hub-backups`(관리자만 읽기), 삭제 중인 주소로는 새 신청 불가.
- 단계: check → backup_hub → backup_db → backup_bucket → backup_fn → backup_repo → backup_manifest → del_repo → del_fn → del_secrets → del_bucket → del_db → del_expose → del_hub.
  백업은 `hub-backups/<slug>/<YYYYMMDD-HHMMSS>/`(hub.json · db/schema.sql · db/data/<표>.json · bucket/… · function/*.eszip · repo/<slug>.zip · manifest.json).
  백업이 끝나고 파일 수가 확인되기 전에는 아무것도 지우지 않음. 실패하면 그 단계부터 이어서(감사 기록 화면 '삭제된 앱 · 백업'에서 다시 시도·내려받기).
- 안전장치(`guard.ts`): 앱 행이 있는 slug 만, 예약 주소(designer 등) 거부. 지우기 대상은 그 앱 이름에서 정해진 것만이고, 각각 'BMR APPS 표시'(스키마·역할 주석, 저장소 `.bmr-app.json`, 허브 메모 태그)가 맞을 때만 지움.
  표시 없는 것·없는 것은 건너뛰고 '없음'으로 기록(예: altsis 는 허브 행만). 다른 앱·허브 표·프로젝트 설정·Auth 설정은 건드리는 경로가 없음. hub-provision 과 같은 lease, 실제 삭제 시간당 3개, 모든 단계 `audit_log`.
- 한도: DB 100MB · 버킷 300MB/5000개 · 저장소 zip 80MB 를 넘으면 백업 단계에서 멈춤(아무것도 안 지움) → 직접 백업 후 처리.
- 시험: `node scripts/test-hub-deprovision.mjs` (zztest-del 생성 → 삭제 → 백업·삭제·다른 앱 비교), 정리: `node scripts/test-hub-deprovision.mjs --cleanup`.

## 시작 가이드 · 개발 정보 · 준비 중 페이지
- `/guide/quick` 빠른 시작 (가입 → 승급 → 신청 → 초대 수락·개발 정보·DB 비밀번호 → clone·push, documents 저장 예제). 가이드 위쪽·사이드바(시작 가이드 아래)·꼬리말·Ctrl K 에서 연결.
- `/guide` (src/pages/Guide.tsx): 로그인 없이 보는 9단계 시작 가이드. 메인·상단/하단·사이드바·Ctrl K 에서 연결. `guide`, `guides`, `start`, `getting-started` 는 예약 slug.
- 허브 앱 상세의 **개발 정보** (src/pages/DevInfo.tsx): `public.app_dev_info(p_app_id)` RPC 가 그 앱 담당 개발자(app_owners 이메일 일치 + staff)와 관리자에게만 값을 돌려주고 나머지는 null (서버에서 막음). 비밀값은 없음. DB 비밀번호는 기존 'DB 접속 정보'에서 처음 한 번만 받음.
- 대시보드 **내 서비스** 필터: 내가 담당자인 앱만.
- 새 앱 공개 주소(index.html)는 `starter/layout.html` 의 '준비 중' 안내만 보여 줌 (허브의 이름·설명을 실시간으로 반영). 자세한 개발 정보는 저장소 README 와 허브 개발 정보에 있음. `scripts/build-provision-templates.mjs` 가 공개 페이지에 개발 정보가 섞이면 빌드를 멈춤.
- **구글 로그인**: bmr-dev-apps 프로젝트 전체에 켜져 있음 (Auth 설정 `external_google_enabled`, 클라이언트 비밀값은 Supabase 에만 있음 — 저장소에 두지 않음). 허용된 돌아올 주소: `https://apps.bmrschool.net/**`, `http://localhost:5173/**`, `http://localhost:3000/**`. 안내는 `/guide#google-login`, 새 앱 저장소의 `src/auth.js`.
- **공용 주소 점검(경고만)**: 새 앱 저장소의 `.github/workflows/bmr-check.yml` → `scripts/bmr-check.mjs` 가 push 때마다 규칙(저장소 clear·이름표·맨 앞 경로·서비스 워커 범위·외부 스크립트)을 살펴 Job Summary 에 경고를 쓰고, main 이면 **GitHub OIDC 토큰**(aud `bmr-apps-hub`)으로 `hub-checks` 함수에 보냄. 함수는 GitHub 서명·조직(bmr-apps)·main·워크플로 파일·등록된 repo_url 을 확인하고 `public.app_checks`(앱마다 최신 1건, RLS: 관리자 전체·담당 개발자만)에 저장. 저장소·허브에 새 비밀값 없음. 화면: 앱 상세 '공용 주소 점검', 운영 상태(관리자) 요약. 시험: `node scripts/test-checks.mjs`.
- 처음부터 끝까지 시험: `node scripts/test-dev-info.mjs` (zztest-guide 앱을 만들고 확인한 뒤 hub-deprovision 으로 지우고 시험 계정을 정리함).

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

## 운영 상태 판정·보관 (2026-11-13)
- `public.app_health_latest` 보기에 `fail_streak`(마지막 성공 뒤 연속 실패 횟수)·`state`(`ok` 정상 · `checking` 한 번 실패 = 확인 중 · `down` 2번 이상 연속 실패 = 장애)를 더함. 원본 `health_checks` 행은 그대로이고, 대시보드·운영 상태·사이드바 배지는 `state` 로 셈 (장애만 빨간 숫자).
- 보관: pg_cron `hub-health-prune` 이 매일 03:40(한국 시간) `private.prune_health_checks()` 로 30일 지난 `health_checks` 행을 지움.
- 토큰 기록(`token_logs`)은 없앰(마이그레이션 `20261113180000`). DB 비밀번호 받기·새로 발급은 `audit_log` 의 `dbcred:reveal`·`dbcred:rotate`(target = 앱 주소), 사용자 관리는 `user:*`(target = 대상 이메일)로 남김. 옛 주소 `/hub/tokens` 는 안내 화면.
