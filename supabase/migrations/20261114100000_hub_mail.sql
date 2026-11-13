-- 앱 메일 발송 (허브 함수 hub-mail, Resend)
-- 보내는 주소는 허브가 <slug>@mail.bmrschool.net 으로 정함. 토큰 해시·발송 기록만 남기고 본문·토큰 값은 저장하지 않음.

create table if not exists bmr_admin.mail_tokens (
  app_id bigint primary key references public.apps (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  set_at timestamptz not null default now()
);
revoke all on bmr_admin.mail_tokens from public, anon, authenticated;

create table if not exists bmr_admin.mail_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  app_id bigint references public.apps (id) on delete set null,
  slug text not null check (char_length(slug) <= 40),
  recipient_count int not null check (recipient_count >= 0 and recipient_count <= 20),
  subject text not null default '' check (char_length(subject) <= 200),
  status text not null check (status in ('sent', 'error', 'denied')),
  error text not null default '' check (char_length(error) <= 500),
  resend_id text not null default '' check (char_length(resend_id) <= 80),
  actor text not null default '' check (char_length(actor) <= 200)
);
create index if not exists mail_log_at_idx on bmr_admin.mail_log (at desc);
create index if not exists mail_log_app_at_idx on bmr_admin.mail_log (app_id, at desc);
create index if not exists mail_log_sent_at_idx on bmr_admin.mail_log (at desc) where status = 'sent';
revoke all on bmr_admin.mail_log from public, anon, authenticated;

comment on table bmr_admin.mail_tokens is '앱 메일 토큰의 SHA-256 해시. 평문은 함수 비밀값 <PREFIX>MAIL_TOKEN 에만 둔다.';
comment on table bmr_admin.mail_log is '허브 메일 발송 기록. 제목·건수·결과만, 본문은 남기지 않는다.';
