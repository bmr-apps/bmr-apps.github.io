-- 앱 AI 게이트웨이 (허브 함수 hub-ai)
-- 앱은 AI 업체 키를 갖지 않는다. 함수 비밀값 <PREFIX>AI_TOKEN 으로 이 앱 신분만 증명하고,
-- 실제 업체 키(BMR_GEMINI_API_KEY · BMR_OPENAI_API_KEY · BMR_ANTHROPIC_API_KEY · BMR_XAI_API_KEY)는
-- 암호문으로 두고 hub-ai 만 푼다. 프롬프트·응답 본문은 저장하지 않고 토큰 수·결과만 남긴다.

-- ---------- 1. 학교 전체 AI 설정 (한 줄) ----------
create table if not exists bmr_admin.ai_config (
  id int primary key default 1 check (id = 1),
  default_model text not null default 'gemini:gemini-2.5-flash' check (char_length(default_model) between 3 and 120),
  allowed_models jsonb not null default '[
    "gemini:gemini-2.5-flash",
    "gemini:gemini-2.5-pro",
    "openai:gpt-4o-mini",
    "openai:gpt-4o",
    "anthropic:claude-3-5-haiku-latest",
    "anthropic:claude-sonnet-4-5",
    "xai:grok-3-mini",
    "xai:grok-3"
  ]'::jsonb check (jsonb_typeof(allowed_models) = 'array'),
  default_app_hourly int not null default 60 check (default_app_hourly between 0 and 100000),
  default_app_daily int not null default 500 check (default_app_daily between 0 and 100000),
  default_app_daily_tokens int not null default 500000 check (default_app_daily_tokens between 0 and 100000000),
  global_daily_requests int not null default 3000 check (global_daily_requests between 0 and 1000000),
  global_daily_tokens int not null default 5000000 check (global_daily_tokens between 0 and 1000000000),
  updated_at timestamptz not null default now()
);
insert into bmr_admin.ai_config (id) values (1) on conflict (id) do nothing;
revoke all on bmr_admin.ai_config from public, anon, authenticated;

-- ---------- 2. 앱별 AI 토큰·허용 모델·한도 (null = 학교 전체 설정을 따름) ----------
create table if not exists bmr_admin.ai_tokens (
  app_id bigint primary key references public.apps (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  allowed_models text[] check (allowed_models is null or cardinality(allowed_models) between 1 and 50),
  hourly_limit int check (hourly_limit is null or hourly_limit between 0 and 100000),
  daily_limit int check (daily_limit is null or daily_limit between 0 and 100000),
  daily_token_limit int check (daily_token_limit is null or daily_token_limit between 0 and 100000000),
  set_at timestamptz not null default now()
);
revoke all on bmr_admin.ai_tokens from public, anon, authenticated;

-- ---------- 3. AI 호출 기록 (프롬프트·응답 본문은 남기지 않음) ----------
create table if not exists bmr_admin.ai_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  app_id bigint references public.apps (id) on delete set null,
  slug text not null default '' check (char_length(slug) <= 40),
  provider text not null check (char_length(provider) <= 20),
  model text not null default '' check (char_length(model) <= 120),
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  total_tokens int not null default 0 check (total_tokens >= 0),
  status text not null check (status in ('ok', 'denied', 'error')),
  error text not null default '' check (char_length(error) <= 500),
  actor text not null default '' check (char_length(actor) <= 200)
);
create index if not exists ai_log_app_at_idx on bmr_admin.ai_log (app_id, at desc);
create index if not exists ai_log_at_idx on bmr_admin.ai_log (at desc);
revoke all on bmr_admin.ai_log from public, anon, authenticated;

comment on table bmr_admin.ai_config is '학교 전체 AI 기본값: 기본 모델·허용 모델·앱별 기본 한도·전체 한도. 관리자만 hub-devtools 로 바꾼다.';
comment on table bmr_admin.ai_tokens is '앱 AI 토큰의 SHA-256 해시와 앱별 허용 모델·한도(덮어쓰기). 평문은 함수 비밀값 <PREFIX>AI_TOKEN 에만 둔다.';
comment on table bmr_admin.ai_log is '허브 AI 게이트웨이 호출 기록. 업체·모델·토큰 수·결과·오류만, 프롬프트와 응답 본문은 남기지 않는다.';
