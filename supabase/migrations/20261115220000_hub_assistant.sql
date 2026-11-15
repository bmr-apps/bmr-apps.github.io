-- BMR APPS 도우미(hub-assistant) 호출 횟수 기록
-- 왜: 로그인하지 않은 손님도 쓸 수 있는 AI 창구라서 사람·IP·학교 전체 단위로 횟수를 세어 남용을 막는다.
-- 무엇을 남기나: 누가(회원 아이디 또는 IP)·언제·역할만. 질문과 답 본문은 남기지 않는다 (hub-ai 도 본문을 남기지 않는다).
-- 누가 쓰나: hub-assistant 함수만 (브라우저에서는 읽지도 쓰지도 못한다)
create table if not exists bmr_admin.assistant_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('user', 'ip')),
  who text not null default '' check (char_length(who) <= 200),
  ip text not null default '' check (char_length(ip) <= 60),
  role text not null default 'guest' check (role in ('guest', 'user', 'staff', 'admin'))
);
create index if not exists assistant_attempts_at_idx on bmr_admin.assistant_attempts (at desc);
create index if not exists assistant_attempts_ip_idx on bmr_admin.assistant_attempts (ip, at desc);
create index if not exists assistant_attempts_who_idx on bmr_admin.assistant_attempts (who, at desc);
revoke all on bmr_admin.assistant_attempts from public, anon, authenticated;

comment on table bmr_admin.assistant_attempts is '허브 도우미(hub-assistant) 호출 횟수. 사람·IP·학교 전체 한도 계산에만 쓰고 질문·답 본문은 남기지 않는다.';
comment on column bmr_admin.assistant_attempts.kind is 'user = 로그인한 사람(회원 아이디) · ip = 손님(IP)';

-- ---------- 일회용 표: hub-assistant → hub-ai '허브 내부 도우미' 임을 알리는 값 ----------
-- 왜: 도우미 함수는 앱도 아니고 사람도 아닌 허브 공용 호출이라, hub-ai 에 자신을 증명할 방법이 필요하다.
--     새 비밀값(환경변수)을 만들지 않고, DB 에 무작위 값을 한 줄 넣었다가 60초 안에 한 번만 쓰게 한다.
--     값은 64자 무작위 hex 라 짐작할 수 없고, 한 번 쓰이면(used_at) 바로 효력이 없어진다.
-- 누가 쓰나: hub-assistant 가 넣고 hub-ai 가 확인한다 (브라우저에서는 읽지도 쓰지도 못한다)
create table if not exists bmr_admin.assistant_grants (
  id bigint generated always as identity primary key,
  nonce text not null unique check (nonce ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists assistant_grants_created_idx on bmr_admin.assistant_grants (created_at desc);
revoke all on bmr_admin.assistant_grants from public, anon, authenticated;

comment on table bmr_admin.assistant_grants is '도우미 함수가 hub-ai 를 부를 때 쓰는 일회용 표(60초·한 번). 비밀값을 새로 만들지 않으려고 DB 로만 주고받는다.';
