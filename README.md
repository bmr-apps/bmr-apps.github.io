# BMR APPS

**별무리 개발자들이 함께 만들고 나누는 공간**

- 서비스: <https://apps.bmrschool.net>
- 시작 가이드: <https://apps.bmrschool.net/guide> · 바쁘면 **빠른 시작** <https://apps.bmrschool.net/guide/quick>
- 관리자: dev@bmrschool.org

이 저장소는 BMR APPS 의 **허브**입니다. 앱 목록을 보여 주고, 새 앱 신청을 받아 승인하면 저장소·주소·데이터베이스·파일 저장소·서버 함수를 자동으로 만들어 주는 화면(React + TypeScript)과, 그 일을 하는 Supabase 함수들이 여기에 있습니다.

앱 하나하나는 각자의 저장소(`bmr-apps/<주소 이름>`)에서 만들어지고 `https://apps.bmrschool.net/<주소 이름>/` 로 올라갑니다. 모든 앱이 **한 주소를 함께 씁니다.**

| 이 문서에서 | 이런 분께 |
|---|---|
| [1. BMR APPS 소개](#1-bmr-apps-소개) · [2. 사용하기](#2-사용하기-교직원누구나) | 앱을 쓰러 오신 선생님·교직원 |
| [3. 새 앱 만들기](#3-새-앱-만들기-개발자) | 직접 앱을 만들고 싶은 개발자 |
| [4. 허브 자체 개발·운영](#4-허브-자체-개발운영-관리자기여자) · [5. 보안](#5-보안--비밀값-다루는-규칙) | 허브를 고치거나 운영하는 관리자·기여자 |

---

## 1. BMR APPS 소개

학교에서 필요한 작은 도구들(도서 대출, 활동 기록, 공지, 설문…)을 선생님들이 직접 만들어 함께 쓰는 곳입니다. 앱을 하나 만들 때마다 서버·데이터베이스·배포 설정을 처음부터 준비하지 않아도 되도록, **허브가 개발 환경을 통째로 만들어 줍니다.** 만든 사람은 화면과 데이터만 만들면 됩니다.

### 역할

가입하면 누구나 **일반 사용자**로 시작하고, 관리자가 역할을 올려 줍니다.

| 역할 | 저장소의 값 | 할 수 있는 일 |
|---|---|---|
| 일반 사용자 | `pending` | 운영 중인 앱 보기·열기, 내 계정(비밀번호) 관리 |
| 개발자 | `staff` | + 새 앱 신청, 내 서비스의 **개발 정보**·**DB 접속 정보**, 개발자 셀프서비스(비밀값·함수·로그), 운영 상태 보기 |
| 관리자 | `admin` | + 앱 신청 승인, 사용자 관리, 앱 정보·담당자·삭제, 감사 기록, 서버 함수 자동 배포 켜고 끄기 |
| 사용 중지 | `disabled` | 로그인은 되지만 화면이 막힙니다 |

### 화면 지도

| 주소 | 화면 | 볼 수 있는 사람 |
|---|---|---|
| `/` | 메인 — 운영 중인 앱 카드 | 누구나 (로그인 없이) |
| `/guide` · `/guide/quick` | 시작 가이드 · 빠른 시작 | 누구나 |
| `/hub/login` | 로그인 · 가입 | 누구나 |
| `/hub/apps` | 대시보드(내 서비스·앱 목록) | 로그인한 사람 |
| `/hub/account` | 내 계정 | 로그인한 사람 |
| `/hub/requests` | 앱 신청 (관리자는 전체 신청 검토) | 개발자 · 관리자 |
| `/hub/status` | 운영 상태 (매시 자동 점검) | 개발자 · 관리자 |
| `/hub/db` | 앱별 DB 접속 정보 모아 보기 | 개발자 · 관리자 |
| `/hub/members` | 사용자 관리(역할·비밀번호·사용 중지·삭제) | 관리자 |
| `/hub/audit` | 감사 기록(승인·생성·권한·비밀번호·배포) | 관리자 |

> 예전의 `/hub/tokens`(토큰 발급 기록) 화면은 이제 안내만 보여 줍니다. 그런 기록은 **감사 기록**에 남습니다.

---

## 2. 사용하기 (교직원·누구나)

### 2-1. 앱 둘러보고 열기

메인 화면(<https://apps.bmrschool.net>)에 지금 운영 중인 앱이 카드로 나옵니다. **로그인하지 않아도** 볼 수 있고, 카드를 누르면 새 탭에서 앱이 열립니다.

- 카드마다 앱 이름·설명·주소와 상태가 함께 보입니다.
- **`Ctrl` + `K`** (맥은 `⌘` + `K`) 를 누르면 검색 팔레트가 열립니다. 앱 이름 일부로 찾아 바로 열거나, 화면을 옮길 수 있어요.
- 오른쪽 위 🌙 / ☀️ 버튼으로 밝은 화면·어두운 화면을 바꿉니다.

### 2-2. 가입하고 로그인하기

<https://apps.bmrschool.net/hub/login> 에서 두 가지 방법 중 편한 쪽을 쓰세요.

1. **구글로 로그인 / 구글로 가입하기** — 구글 계정이 있으면 버튼 한 번으로 끝납니다.
2. **이메일·비밀번호** — 이름, 이메일, 비밀번호(8자 이상)를 넣고 **가입하기**.

가입은 바로 되고, 지금은 확인 메일 없이 그대로 로그인됩니다(나중에 확인 메일이 오도록 바뀔 수 있어요 — 메일이 오면 링크를 눌러 마무리해 주세요). 처음에는 누구나 **일반 사용자**입니다.

> **학교 메일로 가입해 주세요.** 나중에 앱을 만들 때 그 앱의 **담당자 메일**과 지금 로그인한 메일이 같아야 대시보드의 **내 서비스**에 내 앱이 나타납니다.
>
> 같은 메일로 이미 가입한 적이 있으면, 구글로 로그인해도 같은 계정으로 들어갑니다.

### 2-3. 앱마다 로그인은 따로입니다

허브에 로그인했다고 앱에도 로그인되는 것은 아닙니다. 앱마다 로그인 칸이 따로 있어서, 각 앱에서 한 번 더 로그인합니다(구글 또는 이메일 — 앱이 정한 방법). 계정 자체는 BMR APPS 전체가 함께 쓰므로 **아이디는 하나**입니다.

- 앱에서 **로그아웃**하면 그 앱에서만 로그아웃됩니다. 허브와 다른 앱, 다른 기기의 로그인은 그대로 유지돼요.
- 허브에서 로그아웃해도 마찬가지입니다.

### 2-4. 내 계정

`/hub/account` 에서 이름, 이메일, 역할, 로그인 방법(구글 / 이메일)을 확인하고 **허브 로그인 비밀번호**를 바꿀 수 있습니다. 구글로만 가입한 계정은 여기서 비밀번호를 **만들면** 같은 메일·비밀번호로도 로그인할 수 있게 됩니다.

### 2-5. 앱이 안 보이거나 열리지 않으면

- **메인에 앱이 없어요** → 아직 '운영 중'이 아닐 수 있습니다(준비 중·일시 중지·종료). 관리자에게 상태를 물어보세요.
- **앱 화면이 하얗거나 '준비 중'이에요** → 그 앱이 아직 화면을 올리지 않았습니다. 앱 담당 개발자에게 알려 주세요.
- **로그인이 안 돼요** → 사용이 중지된 계정이면 관리자만 풀 수 있습니다. 관리자(dev@bmrschool.org)에게 문의하세요.

---

## 3. 새 앱 만들기 (개발자)

앱 하나를 처음부터 배포까지. 전체 흐름은 **가입 → 개발자 승급 → GitHub 준비 → 앱 신청 → 승인(자동 생성) → 개발 정보·DB 비밀번호 → 개발 → push 하면 배포** 입니다. 같은 내용을 화면으로 보고 싶으면 [시작 가이드](https://apps.bmrschool.net/guide), 급하면 [빠른 시작](https://apps.bmrschool.net/guide/quick)을 보세요.

### 3-1. 가입 → 3-2. 개발자 승급 요청

1. 위 2-2 처럼 가입합니다. **앱 담당자로 쓸 메일**(학교 메일)로 가입하세요.
2. 관리자에게 "BMR APPS **개발자**로 올려 주세요"라고 가입한 메일과 함께 알려 주세요. 관리자가 **사용자 관리** 화면에서 역할을 **개발자**로 바꾸면, 다시 로그인하지 않아도 **앱 신청** 메뉴가 열립니다.

### 3-3. GitHub 계정 준비

코드는 GitHub 의 **`bmr-apps` 조직** 저장소에 둡니다. GitHub 계정이 없으면 <https://github.com/signup> 에서 먼저 만들어 두세요.

- 앱이 만들어지면 그 저장소에 **쓰기(push) 권한 초대**가 GitHub 메일로 갑니다. 메일이나 github.com 알림에서 **초대 수락**을 눌러야 push 할 수 있습니다.
- 앱 저장소는 **공개**입니다. 비밀번호·키 같은 비밀값은 절대 올리지 마세요.

### 3-4. 앱 신청하기

허브 → **앱 신청**(`/hub/requests`) → **새 앱 신청하기** 에서 아래를 채웁니다.

| 칸 | 적을 내용 |
|---|---|
| 신청자 이름 · 연락 이메일 | 자동으로 채워집니다. 다르게 연락받고 싶으면 고치세요. |
| 앱 이름 | 화면에 보일 이름. 예: `도서 대출 관리` (나중에 관리자가 바꿀 수 있음) |
| 원하는 주소 이름 | 아래 규칙을 꼭 지켜 주세요. **만든 뒤에는 바꿀 수 없습니다.** |
| GitHub 아이디 | 저장소에 초대할 내 GitHub 계정 |
| 목적·주요 기능 | 누가 무엇을 하려고 쓰는지 짧게 |
| 다루는 데이터 | 예: 활동 기록, 공지 글, 학생 이름·학번 |
| 학생 개인정보를 다루나요? | 이름·학번·연락처·성적 등을 다루면 **예**. 관리자가 접근 범위·보관 방법을 함께 검토합니다. |

**주소 이름(slug) 규칙**

- 영문 소문자로 **시작**, 영문 소문자·숫자·하이픈으로 **2~39자**. 끝이 하이픈이거나 하이픈이 두 번 연속이면 안 됩니다. (`^[a-z][a-z0-9-]{1,38}$`)
- 앱 주소, 저장소 이름, DB 스키마 이름이 모두 이 값으로 정해집니다. 하이픈이 있으면 DB 이름에서는 밑줄이 됩니다 (`my-app` → 스키마 `my_app`).
- 이미 쓰는 이름과 **예약어**는 안 됩니다. 예약어 예: `hub`, `guide`, `login`, `admin`, `api`, `www`, `static`, `assets`, `auth`, `storage`, `functions`, `test`, `docs`, `help`, `designer`, `apps`, `supabase` 로 시작하는 이름, `-fn`·`-dev`·`-priv`·`-svc` 로 끝나는 이름 등.
- 신청은 **취소**할 수 있지만, 승인된 뒤에는 주소를 바꿀 수 없습니다. 이름을 다시 고르고 싶으면 새로 신청해 주세요.

### 3-5. 승인되면 자동으로 생기는 것

관리자가 **승인하고 바로 만들기**를 누르면 몇 분 안에 아래가 만들어집니다. 신청 화면에 단계별 진행(✓)이 보이고, 중간에 멈추면 관리자가 **멈춘 단계부터 이어서** 다시 시도할 수 있습니다. (주소 이름이 `library` 인 경우)

| 만들어지는 것 | 내용 |
|---|---|
| GitHub 저장소 | `bmr-apps/library` — Vite 시작 코드, README, 자동 배포·함수 검사·공용 주소 점검 워크플로 포함 (**공개**) |
| 앱 주소 | `https://apps.bmrschool.net/library/` — 처음에는 '준비 중인 페이지입니다' 안내만 |
| DB 스키마 | `library` — 이 안에서는 표·뷰·함수·정책을 마음대로 |
| 내 DB 계정 | `library_dev` — 내 스키마만 만들고 고칠 수 있는 계정 |
| 함수 전용 DB 계정 | `library_fn` — 서버 함수가 쓰는 계정 (내 비밀번호를 바꿔도 함수는 계속 동작) |
| 시작 표 `documents` | 표를 설계하지 않고 JSON 으로 바로 저장할 수 있는 표 |
| 파일 버킷 | `library` (비공개) |
| 서버 함수 | `library-fn` — 비밀 키·외부 API 호출용 |
| 허브 등록 · 담당자 | 앱 목록에 오르고, 신청한 사람이 담당 개발자로 등록됩니다 |
| GitHub 초대 | 알려 준 GitHub 아이디로 저장소 쓰기 권한 초대 |
| DB 비밀번호 | 첫 비밀번호가 준비되어 대기 (아직 아무도 받지 않은 상태) |

### 3-6. 개발 정보와 DB 비밀번호

1. 대시보드(`/hub/apps`) → **내 서비스** 탭 → 내 앱 카드를 누릅니다.
2. **🛠️ 개발 정보** — 앱 주소, 저장소, Supabase 주소, 공개 키, 내 스키마, DB 계정, 접속 호스트·포트, 버킷, 서버 함수, 함수 비밀값 접두어, 복사해서 쓸 수 있는 예제 코드가 있습니다. **담당자와 관리자만** 볼 수 있어요.
3. 같은 창의 **🗄️ DB 접속 정보** → **🔑 처음 비밀번호 받기** — 비밀번호가 **딱 한 번** 보입니다. 바로 복사해 안전한 곳(`.env.local`, 비밀번호 관리 프로그램)에 두세요. 화면을 닫으면 서버 사본도 지워집니다.
4. 잊어버렸다면 **♻️ 새 비밀번호 발급** — 이전 비밀번호는 바로 못 쓰게 됩니다. (서버 함수는 별도 계정이라 영향 없음)
5. 직접 바꾸고 싶으면 내 계정으로 접속해 psql 에서 `\password library_dev` 를 쓰세요. (`alter role ... password '...'` 는 평문이 서버로 가므로 `\password` 를 권합니다.)

### 3-7. 내려받아 실행하기

```bash
git clone https://github.com/bmr-apps/library.git
cd library
npm install
cp .env.example .env.local     # DATABASE_URL 의 <비밀번호> 칸만 채우기
npm run dev                    # http://localhost:5173/library/
```

- 시작 코드는 **Vite** 입니다. React·Vue·Svelte 등 원하는 도구를 더해도 되지만, `vite.config.js` 의 `base: '/library/'` 는 바꾸지 마세요.
- `.env.local` 은 저장소에 올라가지 않습니다. `VITE_` 로 시작하는 값은 전부 브라우저에 공개되므로 **공개(publishable) 키만** 넣으세요.
- DB 접속은 개발 정보 창의 주소를 그대로 쓰면 됩니다. 사용자 이름은 `library_dev.<프로젝트ref>` 처럼 뒤에 프로젝트 이름이 붙고, `5432` 는 일반(세션) 접속, `6543` 은 짧은 요청용입니다. 개발할 때는 5432 를 쓰세요.

### 3-8. 데이터 다루기 — 표를 만들고 지키기

```bash
# supabase/migrations/ 에 SQL 파일을 만들고 (예: 20261112093000_create_events.sql)
npm run db:migrate      # 아직 안 한 파일만 이름 순서대로 실행
```

> ⚠️ **이름이 헷갈리기 쉬운 부분**: 앱 저장소의 명령은 **`npm run db:migrate`** 입니다. 이 허브 저장소의 `npm run migrate`(허브 자기 DB용)와 다릅니다.

표를 만들 때 꼭 알아 둘 것:

- **RLS 는 자동으로 켜집니다.** 새 표는 브라우저 역할에 **읽기(select)** 만 주어집니다. 정책이 없으면 아무것도 안 보이고 아무것도 못 씁니다. 쓰기는 `grant insert, update, delete ...` 를 직접 하세요.
- 정책 안에서 로그인한 사람 아이디는 `auth.uid()` 대신 **`bmr.uid()`** 를 씁니다. 개발자 DB 계정은 `auth` 스키마 권한이 없어서 `auth.uid()` 를 쓰면 `permission denied for schema auth` 오류가 납니다. (`bmr.jwt()`, `bmr.role()`, `bmr.email()` 도 같은 방식)
- **`security definer` 함수**는 RLS 를 건너뜁니다. `is_member()` 처럼 참/거짓만 돌려주는 도우미로만 쓰고, `set search_path = ''` 를 붙이세요.
- **`auth.uid()`·`bmr.uid()` 는 값이에요.** RLS 정책에서 `auth.uid()` 를 그대로 호출하면 행마다 다시 계산되어 느려질 수 있으니 `(select bmr.uid())` 처럼 한 번만 읽게 쓰세요.
- AI 코딩 도구(Cursor, Claude Code 등)에 맡길 때도 "`auth.uid()` 대신 `bmr.uid()` 를 써 줘"라고 꼭 알려 주세요. 연결 문자열은 도구 설정에만 넣고 코드에는 적지 마세요.
- 브라우저에서 쓰는 예 (시작 코드의 `src/supabase.js` 가 내 스키마로 연결되어 있습니다):

```js
import { supabase } from './supabase.js';

await supabase.from('documents').insert({ collection: 'notice', data: { title: '첫 공지' } });
const { data } = await supabase.from('documents')
  .select('id, data, created_at').eq('collection', 'notice').order('created_at', { ascending: false });
```

### 3-9. 로그인

관리자가 BMR APPS 전체에 **구글 로그인을 켜 두었습니다.** 개발자는 따로 설정할 것 없이 코드만 넣으면 됩니다. 새 앱 저장소의 `src/auth.js` 에 같은 도우미가 들어 있어요.

```js
import { supabase } from './supabase.js';

// 이 앱 자기 주소로 돌아오기 (배포·로컬 모두)
const APP_URL = new URL(import.meta.env.BASE_URL, location.origin).href;

await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: APP_URL } });

const { data: { user } } = await supabase.auth.getUser();
await supabase.auth.signOut({ scope: 'local' });   // 이 앱에서만 (그냥 signOut() 은 모든 앱·기기 로그인을 끊음)
```

- 돌아올 수 있는 주소: `https://apps.bmrschool.net/**`, `http://localhost:5173/**`, `http://localhost:3000/**`. 다른 주소가 필요하면 관리자에게 요청하세요(허용 안 된 주소면 사이트 첫 화면으로 돌아갑니다).
- **계정은 모든 앱이 함께 씁니다.** `auth.users` 는 BMR APPS 전체에 하나라서 구글 계정만 있으면 누구나 내 앱에도 로그인할 수 있습니다. '로그인했다'만으로 권한을 주지 말고 **내 스키마의 멤버 표**로 이 앱 사람을 따로 관리하세요. (첫 멤버는 SQL 로 넣습니다)
- 카카오 등 다른 소셜 로그인은 아직 꺼져 있습니다.

### 3-10. 파일 저장

버킷은 **비공개**이고, 로그인한 사람은 `<내 아이디>/…` 폴더에 올릴 수 있습니다. **파일 경로(키)에 한글은 쓸 수 없어요** — 영문·숫자로 이름을 바꿔 올리고 원래 이름은 표에 따로 저장하세요. 한 파일 10MB 까지입니다.

### 3-11. 배포 — push 하면 끝

- **화면**: `main` 브랜치에 push 하면 GitHub Actions 가 빌드해서 **1~2분 뒤** 앱 주소에 반영합니다. 저장소의 '준비 중' 페이지(`index.html`)를 내 화면으로 바꾸면 됩니다.
- **서버 함수**: `supabase/functions/library-fn/` 을 고쳐 `main` 에 push 하면, 그 앱의 **서버 함수 자동 배포**가 켜져 있을 때 검사(`deno check`) 뒤 자동으로 배포됩니다(1~2분, 결과는 저장소 Actions 의 Summary). 꺼져 있으면 배포되지 않고 Summary 에 안내만 남습니다.
- 저장소에는 비밀값이 필요 없습니다. GitHub 가 서명한 **1회용 신분증(OIDC)** 으로 허브가 '이 저장소의 main' 인지 확인한 뒤, **이 앱 몫의 함수만** 배포합니다. 워크플로 파일 이름(`functions-check.yml`)을 바꾸면 허브가 배포를 거부합니다.

### 3-12. 개발자 셀프서비스 — 관리자에게 부탁하지 않고 직접

대시보드 → 내 서비스 → 앱 정보 창 아래 **🧰 개발자 셀프서비스**. 서버가 '이 앱 담당 개발자(또는 관리자)인지' 확인하고, 모든 변경은 감사 기록에 남깁니다.

| 할 수 있는 일 | 내용 |
|---|---|
| 🙋 **자동 배포 켜 달라고 요청** | 자동 배포가 꺼져 있으면 요청을 남깁니다. 관리자가 1클릭으로 승인하면 켜집니다. **켜고 끄기 자체는 관리자만** 합니다. |
| 🔑 **함수 비밀값** | 이름은 `<접두어>_` 로 시작해야 합니다 (`library` → `LIBRARY_`, `my-app` → `MY_APP_`). 값은 **쓰기 전용** — 저장하면 다시 볼 수 없고 감사 기록에도 이름만 남습니다. `SUPABASE_`·`BMR_`·`HUB_` 로 시작하는 이름과 허브가 관리하는 `<접두어>DB_URL` 은 쓸 수 없습니다. 함수에서는 `Deno.env.get('LIBRARY_API_KEY')` 로 읽습니다. |
| ⚙️ **새 서버 함수** | 저장소에 `supabase/functions/library-이름/index.ts` 를 만들고 `main` 에 push 하면 자동 배포가 켜진 앱에서는 새 함수가 만들어집니다. 끝부분은 영문 소문자·숫자(하이픈으로 이음) 20자까지, **앱마다 3개까지**. push 때는 바뀐 함수만, Actions 에서 수동 실행하면 모두 다시 배포합니다. 안 쓰는 함수는 셀프서비스에서 지우고 저장소 폴더도 지우세요(남아 있으면 다음 push 때 다시 만들어집니다). |
| 📜 **로그 보기** | 서버 함수(콘솔 출력·요청 결과)와 내 DB 계정(`library_dev`, `library_fn`) 로그를 최근 **1·6·24시간** 범위로 봅니다. **이 앱 것만** 보이고 비밀값처럼 보이는 글자는 가려집니다. 그래도 로그에 학생 개인정보·비밀값을 찍지 마세요. |

### 3-13. 메일 보내기

앱이 알림·안내 메일을 보낼 때는 **서버 함수 안에서** 허브의 `hub-mail` 을 부릅니다. **보내는 주소는 허브가 정합니다** — `library@mail.bmrschool.net` (표시 이름만 앱이 정할 수 있음). Resend 키는 앱이 갖지 않고, 함수 비밀값 `<접두어>MAIL_TOKEN`(예: `LIBRARY_MAIL_TOKEN`)으로 이 앱 신분만 증명합니다.

- 한도: **앱마다 하루 100통, 한 시간 20통, 한 통에 받는 사람 10명**. 학교 전체도 하루 100통입니다.
- 앱이 **활성 상태**가 아니면 보낼 수 없습니다. 본문은 남기지 않고 제목·받는 사람 수·결과만 감사 기록에 남습니다.
- 선택: `reply_to`(회신 주소), `from_name`(표시 이름, 기본은 앱 이름).
- 시작 틀의 `supabase/functions/library-fn/mail.ts` 에 `sendMail()` 도우미가 들어 있습니다. 토큰을 브라우저·저장소·로그에 넣지 마세요.

### 3-14. 공용 주소에서 꼭 지킬 규칙

모든 앱이 `apps.bmrschool.net/<주소 이름>/` 처럼 **한 주소**를 함께 씁니다. 브라우저 입장에서는 한 사이트라서, 조심하지 않으면 서로의 저장값·로그인·화면을 망가뜨릴 수 있어요.

1. **브라우저 저장소는 같은 서랍입니다.** localStorage·sessionStorage·IndexedDB·쿠키를 모든 앱이 같이 씁니다. 이름 앞에 꼭 `library:` 처럼 **내 주소 이름**을 붙이세요. 새 앱의 `src/store.js` 를 쓰면 자동으로 붙습니다.
2. **`localStorage.clear()` · `sessionStorage.clear()` 는 쓰지 않기.** 다른 앱의 저장값과 로그인까지 다 지워집니다. 내 것만 지우는 `local.clear()` 를 쓰세요.
3. **경로는 상대 경로나 `/library/` 로.** `'/data.json'` 처럼 `/` 로 시작하면 사이트 맨 앞을 가리켜 다른 앱이나 허브로 갑니다. `'./data.json'` 이나 `import.meta.env.BASE_URL + 'data.json'` 을 쓰세요.
4. **서비스 워커(PWA)는 범위를 내 주소로.** `register('/library/sw.js', { scope: '/library/' })` — 범위가 넓으면 다른 앱의 요청까지 가로챕니다.
5. **외부 스크립트 조심.** 외부 주소에서 불러온 스크립트는 같은 주소의 **모든 앱** 저장값·로그인 정보를 읽을 수 있어요. npm 으로 설치해 함께 빌드하고, 꼭 필요하면 관리자와 상의하세요.
6. **로그인·로그아웃은 앱마다.** 로그인 저장 칸이 앱마다 따로라서 허브와 내 앱은 각각 로그인합니다. 로그아웃은 `signOut({ scope: 'local' })` 로 — 그냥 `signOut()` 은 모든 앱·기기의 로그인을 끊어요.
7. **무료 한도는 모두가 나눠 씁니다.** DB 500MB · 파일 1GB · 서버 함수 호출 월 50만 번 · 메일 하루 100통(학교 전체). 큰 파일·대량 데이터·잦은 자동 호출은 미리 상의해 주세요.

**자동 점검 (경고만)** — push 할 때마다 앱 저장소의 GitHub Actions '공용 주소 점검'이 위 규칙을 살펴보고, 경고와 고치는 법을 실행 화면 Summary 와 **허브 → 내 서비스 → 앱 정보 → 공용 주소 점검**에 보여 줍니다. **배포는 막지 않아요.** 일부러 그렇게 쓴 줄은 그 줄 끝(또는 바로 윗줄)에 `// bmr-allow: 이유` 를 달면 건너뜁니다.

### 3-15. 자주 막히는 곳

| 증상 | 대부분의 이유와 해결 |
|---|---|
| '내 서비스'에 내 앱이 안 보여요 | 앱 담당자로 등록된 메일과 지금 로그인한 메일이 달라서입니다. 관리자에게 담당자 메일 확인을 요청하세요. 개발자 승급 전이라면 승급부터! |
| push 했는데 화면이 그대로예요 | 저장소 **Actions** 탭에서 배포가 끝났는지 확인하고 브라우저를 새로고침하세요. `vite.config.js` 의 `base` 는 바꾸지 마세요. |
| DB 비밀번호를 잃어버렸어요 | 대시보드 → 내 서비스 → 앱 → **앱 정보 → DB 접속 정보** → **새 비밀번호 발급**. 이전 비밀번호는 바로 끊깁니다. |
| 화면에 데이터가 안 나와요 | 대부분 RLS 정책이 없어서입니다. 그 표에 select 정책이 있는지, 쓰기라면 `grant` 까지 했는지 확인하세요. |
| 서버 함수를 고쳤는데 반영이 안 돼요 | 그 앱의 **자동 배포가 꺼져 있으면** push 해도 배포되지 않습니다. 셀프서비스에서 **자동 배포 켜 달라고 요청**하세요. |
| React·Vue 를 써도 되나요? | 네. 시작 코드가 Vite 라서 원하는 도구를 더하면 됩니다. |
| Supabase 대시보드 화면은 왜 못 쓰나요? | 대시보드 권한은 프로젝트 전체에 걸려서 개발자 계정에는 주지 않습니다. 필요한 설정은 관리자에게 요청하세요. |

---

## 4. 허브 자체 개발·운영 (관리자·기여자)

여기부터는 **이 저장소(허브)** 를 고치는 이야기입니다. 앱을 만드는 이야기는 3장에 있습니다.

### 4-1. 무엇으로 만들었나

- **화면**: Vite 8 + React 19 + TypeScript, 자체 CSS(`src/style.css`), 폰트 Pretendard·Figtree
- **서버**: Supabase 한 프로젝트 — Auth(구글·이메일), Postgres(허브 표 + 앱별 스키마), Storage(앱 버킷·`hub-assets`·`hub-backups`), Edge Functions(Deno), pg_cron(매시 점검)
- **배포**: GitHub Pages (`apps.bmrschool.net`, `public/CNAME`)
- 화면 라우팅은 아주 작은 자체 경로 처리입니다(`src/App.tsx`). 관리 화면은 모두 `/hub/` 아래에, 공개 안내는 `/guide`·`/guide/quick` 에 두어 앱 주소 `/<slug>` 와 겹치지 않습니다.

### 4-2. 폴더

```
index.html                 진입점 (Vite)
src/
  main.tsx, App.tsx        라우팅·레이아웃·로그인 화면·사이드바
  sb.ts                    Supabase 클라이언트 + 타입 + 함수 호출 도우미
  ui.tsx, style.css        공용 UI(모달·검색 팔레트·카드 아이콘/색)와 스타일
  pages/                   화면별 컴포넌트
    Apps.tsx               메인(운영 중 앱) · 대시보드 · 앱 상세 모달 · 담당자
    Guide.tsx              /guide 시작 가이드 · /guide/quick 빠른 시작
    Requests.tsx           앱 신청 · 관리자 승인/반려 · 만들기 진행 단계
    DevInfo.tsx            개발 정보(담당자·관리자만)
    SelfService.tsx        개발자 셀프서비스(요청·비밀값·함수·로그)
    DbCred.tsx             DB 접속 정보(1회 발급·재발급·초대)
    Checks.tsx             공용 주소 점검 결과
    DeleteApp.tsx          앱 삭제(백업 후)
    CardStyle.tsx          카드 꾸미기(이모지·로고·색)
    Members.tsx            사용자 관리(관리자)
    Audit.tsx              감사 기록(관리자)
    Status.tsx             운영 상태
    Account.tsx            내 계정
supabase/
  config.toml              함수별 verify_jwt 설정 (전부 false, 함수 안에서 직접 확인)
  migrations/*.sql         허브 DB 스키마 (아래 4-5)
  functions/<이름>/         Edge Functions (아래 4-6)
scripts/                   관리·배포·시험 스크립트 (아래 4-4)
.github/workflows/         deploy.yml · functions-check.yml (아래 4-8)
public/CNAME               apps.bmrschool.net
```

### 4-3. 로컬에서 띄우기

```bash
npm install
cp .env.example .env.local     # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 채우기
npm run dev                    # http://localhost:5173
```

- 두 값이 없으면 화면에 "환경 변수 … 가 없습니다" 안내만 나옵니다. **공개(anon/publishable) 키만** 넣으세요. `service_role` 키·DB 비밀번호는 절대 브라우저 쪽에 넣지 않습니다.
- `.env.local` 은 `.gitignore` 에 있어 저장소에 올라가지 않습니다.
- 로컬에서도 **진짜 Supabase 프로젝트에 붙습니다.** 운영 데이터를 건드리지 않으려면 개발용 프로젝트를 따로 두고 그 주소·키를 넣으세요.
- 로컬에서 구글 로그인이 돌아오는 주소는 `http://localhost:5173` 이 허용 목록에 있습니다(`scripts/auth_config.mjs`). `npm run preview`(4173)도 함수 CORS 허용 목록에 있습니다.

### 4-4. 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (Vite) |
| `npm run build` | `tsc --noEmit` 타입 검사 + `vite build` → `dist/` |
| `npm run preview` | 빌드 결과 미리 보기 (`http://localhost:4173`) |
| `npm run migrate` | `supabase/migrations/*.sql` 을 순서대로 적용 (Management API) |
| `node scripts/sql.mjs "select 1"` | 운영 DB 에 SQL 한 번 (`-f 파일.sql` 도 가능) |
| `node scripts/deploy-fn.mjs <함수이름>` | 허브 함수 하나 배포 (배포 기록은 감사 기록 `hub:deploy`) |
| `node scripts/setup-provision.mjs` | 열쇠 만들기 + 관리 토큰 암호문 저장 + 핵심 5개 함수 배포 |
| `node scripts/setup-mail.mjs` | 메일 비밀값·앱별 토큰 준비 + `hub-mail` 배포 + Auth SMTP + `--test` 시험 발송 |
| `node scripts/setup_cron_secret.mjs` | 매시 점검용 비밀값을 Vault 와 함수 비밀값에 넣기 |
| `node scripts/auth_config.mjs` | Auth 설정(가입 허용·돌아올 주소·비밀번호 8자·확인 메일 없이 로그인) |
| `node scripts/build-provision-templates.mjs` | 새 앱 시작 틀 템플릿(`templates.ts`) 다시 만들기 |
| `node scripts/screenshot.mjs` · `node scripts/redesign-shots.mjs` | 화면 캡처 (Playwright, 관리자 작업 환경 전용 — 경로가 그 환경 기준으로 박혀 있습니다) |

**환경변수** (스크립트에서만 씁니다. 절대 커밋·채팅에 올리지 마세요)

| 이름 | 쓰는 곳 | 설명 |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN_DEVAPPS` | `sql.mjs`·`migrate.mjs`·`deploy-fn.mjs`·`setup-provision.mjs`·`setup-mail.mjs` | Supabase Management API 토큰. `HUB_TOKEN_ENV` 로 변수 이름을 바꿀 수 있습니다. |
| `GITHUB_BMR_APPS_TOKEN` | `setup-provision.mjs` | `bmr-apps` 조직 저장소를 만들고 초대하는 GitHub 토큰 |
| `RESEND_API_KEY` | `setup-mail.mjs` | 메일 발송 전용 키 (`RESEND_ADMIN_KEY` 는 저장하지 않습니다) |
| `HUB_REF` | `sql.mjs`·`deploy-fn.mjs` | 대상 프로젝트 ref (기본값은 코드에 있는 허브 프로젝트) |
| `HUB_DEPLOY_BY` | `deploy-record.mjs` | 배포 기록의 `actor_email` (기본 `admin-script`) |
| `HUB_ADMIN_PASSWORD` | 캡처 스크립트 | 캡처용 관리자 로그인 (선택) |

### 4-5. DB 마이그레이션

```bash
SUPABASE_ACCESS_TOKEN_DEVAPPS=... node scripts/migrate.mjs   # 또는 npm run migrate
```

- `supabase/migrations/` 의 `*.sql` 을 **파일 이름 순서**로 적용하고, 적용한 것은 `supabase_migrations.schema_migrations` 에 기록합니다(이미 한 파일은 건너뜀). Supabase CLI `db push` 와 같은 기록표를 씁니다.
- 마이그레이션은 **한 파일씩 트랜잭션**으로 들어갑니다. 한 파일이 실패하면 그 파일만 되돌아가고 멈춥니다.
- 새 마이그레이션은 `날짜시각_이름.sql` 로 추가하세요 (`20261114090000_dev_selfservice.sql` 처럼). **이미 적용된 파일은 고치지 마세요** — 다른 환경에 반영되지 않습니다.
- 주요 마이그레이션: 기본 스키마·보안(RLS)·시드·cron → DB 접속 정보 → 사용자 관리 → 앱 만들기/지우기 → 개발 정보 → 공용 주소 점검 → 자동 배포 → 셀프서비스 → 메일 → 카드 꾸미기.

### 4-6. Edge Functions

| 함수 | 하는 일 | 부르는 쪽 / 확인 방법 |
|---|---|---|
| `hub-provision` | 신청 승인 시 개발 환경 만들기(DB·버킷·함수·저장소·Pages·허브 등록), 담당자 GitHub 권한 맞추기 | 허브(관리자 로그인 토큰). 관리자 역할 확인 + 허용 목록(`guard.ts`) 밖의 외부 호출 금지 + 한 번에 하나 + 시간당 횟수 제한 |
| `hub-deprovision` | 앱 삭제 — **먼저 전부 백업**한 뒤 저장소·함수·비밀값·버킷·DB·Vault·허브 행 삭제 | 허브(관리자) |
| `hub-dbcred` | DB 접속 정보 1회 발급·재발급, 담당자 가입 초대 메일 | 허브(담당자·관리자) |
| `hub-devtools` | 개발자 셀프서비스 — 비밀값 넣기/지우기, 추가 함수 지우기, 로그 보기, 자동 배포 요청 | 허브(담당자·관리자). 비밀값 값은 DB·로그에 남기지 않음 |
| `hub-fn-deploy` | 앱 저장소 `main` push 때 그 앱 함수 자동 배포 | 앱 저장소 GitHub Actions — **GitHub OIDC 토큰**을 직접 검증(서명·저장소·워크플로 이름) |
| `hub-checks` | 앱 저장소가 보낸 '공용 주소 점검' 결과 받기 | 앱 저장소 GitHub Actions — OIDC 검증 |
| `hub-health` | 운영 중 앱 주소를 열어 보는 점검 | pg_cron(매시) 의 Vault 비밀값, 또는 관리자의 '지금 점검' |
| `hub-mail` | 앱 대신 학교 메일 발송 | 앱 서버 함수 — `<접두어>MAIL_TOKEN` 으로 앱 신분만 확인 |
| `hub-users` | 사용자 역할 변경·비밀번호 초기화·사용 중지·삭제 | 허브(관리자) |
| `hub-favicon` | 카드 꾸미기 결과를 앱 파비콘으로 (`?slug=`), 인증 없음 | 누구나 |

모든 함수는 `verify_jwt = false` 이고(`supabase/config.toml`), 토큰·역할 확인을 **함수 안에서 직접** 합니다. 허브 함수는 앱 저장소가 아니라 **이 저장소에서 손으로 배포**합니다.

### 4-7. 함수 배포

```bash
# 처음 준비(열쇠·암호문 비밀값 저장 + provision/deprovision/fn-deploy/devtools/mail 배포)
node scripts/setup-provision.mjs

# 하나만 다시 배포
node scripts/setup-provision.mjs --deploy --only hub-devtools

# 열쇠가 없는 함수 하나만 배포 (스크립트가 바뀐 경우)
node scripts/deploy-fn.mjs hub-checks
```

- `setup-provision.mjs` 는 `.secrets/hub-provision.key`(이 컴퓨터에만, git 제외)를 만들고, `SUPABASE_ACCESS_TOKEN_DEVAPPS`·`GITHUB_BMR_APPS_TOKEN`(과 있으면 `RESEND_API_KEY`)을 **AES-GCM 암호문**으로 함수 비밀값에 넣습니다. 푸는 열쇠는 배포본 `_key.ts` 에만 있습니다.
- 열쇠를 새로 만들면(`--rotate-key`) 기존 암호문을 풀 수 없으므로 토큰을 다시 넣어야 합니다.
- 배포에 성공하면 감사 기록에 `hub:deploy`(함수·버전·커밋)가 남습니다.

### 4-8. GitHub Actions

| 워크플로 | 언제 | 하는 일 |
|---|---|---|
| `deploy.yml` | `main` 에 push (또는 수동) | `npm ci` → `npm run build`(저장소 변수 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY` 사용) → `dist/` 를 GitHub Pages 로 배포. **README 만 고쳐도 이 워크플로가 돕니다.** |
| `functions-check.yml` | `supabase/functions/**` 나 이 워크플로를 건드렸을 때 (PR 포함) | `_key.ts.example` 을 빈 값으로 채운 뒤 `deno check */index.ts` 로 **타입 검사만**. **배포하지 않고 비밀값도 쓰지 않습니다.** |

- 저장소 설정 → Pages 는 **GitHub Actions** 소스, 사용자 지정 도메인은 `apps.bmrschool.net`(`public/CNAME`). 저장소 변수(Variables)에 빌드용 두 값이 있어야 배포가 성공합니다.
- 허브 함수 배포는 자동화되어 있지 않습니다(4-7 의 스크립트로 손으로). 앱 저장소의 자동 배포와 헷갈리지 마세요.

### 4-9. 시험 스크립트

| 스크립트 | 확인하는 것 | 성격 |
|---|---|---|
| `node scripts/test-selfservice-rules.mjs` | 셀프서비스 규칙만 — 비밀값 이름 접두어·다른 앱 이름 공간·추가 함수 이름·로그 SQL·비밀값 가리기 | **네트워크 없음** (안전) |
| `node scripts/test-fn-deploy.mjs` | 자동 배포 함수가 토큰 없음·엉터리·서명 없는·위조 서명 토큰을 모두 거부하는지 | 아무것도 배포하지 않음 |
| `node scripts/test-hub-provision.mjs` | 시험 앱 `zztest-auto` 를 실제로 만들고 단계·결과 확인 | **실제 생성** · 정리 `--cleanup` |
| `node scripts/test-hub-deprovision.mjs` | `zztest-del` 을 만들고 데이터·파일을 넣은 뒤 백업→삭제 확인 (기존 앱은 건드리지 않고 비교만) | **실제 생성·삭제** · 정리 `--cleanup` |
| `node scripts/test-hub-users.mjs` | 사용자 관리 — 역할 변경·비밀번호 초기화·사용 중지·삭제 (실제 계정은 보호) | 실제 계정 생성 |
| `node scripts/test-dev-info.mjs` | 새 앱 '준비 중' 공개 페이지 + 개발 정보가 담당자·관리자에게만 보이는지 | **실제 생성** |
| `node scripts/test-checks.mjs` | 공용 주소 점검 끝까지 — 일부러 문제 있는 파일을 push → 결과 수신 → 화면 → 삭제 | **실제 생성** |

- 이 시험들은 **진짜 프로젝트와 GitHub 를 건드립니다.** 관리자 작업 환경에서만 돌리고, 시험용 계정(`*@example.com`)·앱(`zztest-*`)만 만들고 지웁니다.
- 공용 도우미 `../../bmr-app-templates/lib/common.mjs`(관리자 작업 환경에 함께 받아 둔 저장소)와 관리 토큰이 필요합니다.
- 어느 스크립트도 비밀번호·토큰 값을 출력하지 않습니다. 시험 뒤에는 `--cleanup` 으로 남은 계정·신청·백업·기록을 정리하세요.

### 4-10. 운영

- **운영 상태 점검**: pg_cron 이 매시 정각에 `hub-health` 를 부릅니다. 응답 200~399면 정상, **한 번 실패하면 '확인 중'**, **2번 연속 실패하면 '장애'**. 기록은 30일 보관하고 매일 03:40 에 지웁니다. 관리자는 화면에서 **지금 점검**을 눌러 직접 돌릴 수 있습니다.
- **앱 삭제**: 관리자가 지우면 `hub-backups` 버킷에 허브 기록·DB 구조와 데이터·버킷 파일·서버 함수·저장소 zip 을 **먼저 백업**하고, 그다음 지웁니다. 중간에 멈추면 감사 기록 화면의 삭제 목록에서 **이어서** 할 수 있습니다. 백업은 서명된 10분짜리 링크로 내려받습니다. 가볍게 숨기고 싶으면 상태를 **종료**로만 바꾸면 됩니다(되살릴 수 있음).
- **감사 기록**: 승인·생성·담당자 권한·DB 비밀번호 발급·함수 비밀값(이름만)·자동 배포 켜기·삭제·사용자 역할 변경이 모두 남습니다.
- **무료 한도**를 학교 전체가 나눠 씁니다. 일주일 동안 아무도 쓰지 않으면 프로젝트가 잠시 멈출 수 있습니다.

---

## 5. 보안 · 비밀값 다루는 규칙

이 저장소는 **공개**입니다. 그리고 앱 저장소도 공개입니다. 아래는 "여기에 있으면 안 되는 것" 목록입니다.

**절대 저장소·채팅·메일·화면 캡처에 올리지 않는 것**

- `BMR_MGMT_TOKEN` (Supabase Management 토큰), `BMR_GH_TOKEN` (GitHub 조직 토큰), `BMR_RESEND_API_KEY` (메일 키)
- `SUPABASE_ACCESS_TOKEN_DEVAPPS`, `GITHUB_BMR_APPS_TOKEN`, `RESEND_API_KEY` 같은 환경변수 값
- 앱의 **DB 비밀번호**, `service_role` 키, 외부 API 키
- `.secrets/hub-provision.key` (열쇠 파일 — `.secrets/` 는 git 제외)
- `supabase/functions/*/_key.ts` — **저장소에 없습니다.** `_key.ts.example`(빈 값)만 있고, 실제 열쇠는 배포 스크립트가 **배포본에만** 넣습니다. 검사 워크플로도 예시를 복사해 타입만 봅니다.

**이렇게 되어 있습니다**

- 관리 토큰·GitHub 토큰·메일 키는 **AES-GCM 암호문**으로 함수 비밀값에 있고, 푸는 열쇠는 `hub-provision`·`hub-deprovision`·`hub-fn-deploy`·`hub-devtools`·`hub-mail` 배포본의 `_key.ts` 에만 있습니다. 같은 프로젝트의 다른 함수가 환경변수를 읽어도 이 토큰들은 쓸 수 없습니다.
- **DB 비밀번호**는 화면에 한 번만 보이고 서버 사본은 그 순간 지워집니다. 발급·재발급 기록은 남기되 값은 남기지 않습니다.
- **함수 비밀값**은 쓰기 전용입니다(값을 다시 보여 주지 않고, 감사 기록엔 이름만).
- 브라우저에는 **공개(anon/publishable) 키만** 둡니다. `VITE_` 로 시작하는 값은 모두 공개됩니다.
- 허브 표는 전부 RLS 가 켜져 있고, 역할 판정은 노출되지 않는 `private` 스키마의 `security definer` 함수로 합니다. 앱 담당자 이메일 같은 값은 직원에게만 보입니다.

**꼭 기억할 두 가지 위험**

1. **서버 함수 자동 배포를 켠 앱**은, 그 저장소에 push 할 수 있는 사람이 함수 코드로 **프로젝트 공용 비밀값**을 읽을 수 있습니다(함수 비밀값은 프로젝트 공용). 그래서 켜고 끄기는 관리자만 하고, 믿을 수 있는 개발자에게만 켭니다. 바꿀 때마다 감사 기록에 남습니다.
2. **`security definer` 함수와 RLS 를 끄는 것은 곧 데이터를 여는 것**입니다. 앱을 만들 때도 이 저장소를 고칠 때도, "이 표를 누가 읽고 쓸 수 있나"를 먼저 정하고 코드를 쓰세요.

---

## 6. 도움이 필요하면

- 화면으로 보는 안내: [시작 가이드](https://apps.bmrschool.net/guide) · [빠른 시작](https://apps.bmrschool.net/guide/quick)
- 새 앱 신청: [앱 신청](https://apps.bmrschool.net/hub/requests)
- 그 밖의 요청(개발자 승급, 다른 소셜 로그인, 돌아올 주소 추가, 버킷 정책, 확장 기능 등)은 허브 관리자 **dev@bmrschool.org** 에게. 요청할 때 비밀번호·키 값은 적지 마세요.

즐거운 개발 되세요! 🙌
