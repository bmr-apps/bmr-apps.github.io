-- BMR APPS 알림 — 웹 푸시 · 메일 알림 · 안 읽은 배지 (2026-11-15)
--
-- 왜: 쪽지·신청 결과를 화면을 열어야만 알 수 있었다. 앱을 닫아 둬도 알림이 오고, 안 읽은 것이 몇 개인지
--     배지(탭 제목·홈 화면 아이콘)로 보이게 한다. 알림은 사람마다 켜고 끌 수 있고, 기본값은
--     '푸시 켬 · 메일 끔 · 쪽지 켬 · 관리 알림 켬' 이다 (메일은 원할 때만 켜게 한다).
--
-- 무엇을 만드나
--   public.notification_prefs   사람마다 알림 스위치 (푸시·메일·쪽지·관리 알림)
--   public.push_subscriptions   브라우저 푸시 구독 — 본인 것만 보고 넣고 지운다 (RLS)
--   public.notification_log     알림함 (신청 승인·반려, 개발자 승인, 이용 중지). 본인 것만 읽고 '읽음'만 표시
--   bmr_admin.push_config       VAPID 열쇠쌍. 비밀키는 함수만 읽는다 (브라우저에는 공개키만)
--   bmr_admin.notify_grants     hub-notify → hub-mail 일회용 메일 표 (2분·한 번만, 받는 사람 고정)
--   bmr_admin.notify_attempts   호출·발송 횟수 (사람·IP 한도, 메일 쿨다운 계산)
--
-- 누가 쓰나
--   브라우저(authenticated): 자기 설정·구독·알림함만. 알림함에 직접 넣을 수는 없다 (트리거·함수만 넣는다).
--   hub-notify 함수: 구독에 푸시를 보내고, 설정을 읽어 메일을 보낼지 정한다. VAPID 비밀키·발송 기록은 여기에만.
--   hub-mail 함수: notify_grants 한 줄을 확인하고 그 받는 사람에게만 알림 메일을 보낸다.

-- ---------- 1. 알림 설정 ----------
create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default false,
  notify_chat boolean not null default true,
  notify_admin boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.notification_prefs is '사람별 알림 스위치. 줄이 없으면 기본값(푸시 켬 · 메일 끔 · 쪽지 켬 · 관리 알림 켬)으로 본다.';
comment on column public.notification_prefs.email_enabled is '기본값 끔 — 메일은 사용자가 직접 켜야 온다 (스팸·실수 방지).';

alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from anon, authenticated;
grant select, insert, update on public.notification_prefs to authenticated;

drop policy if exists notif_prefs_select on public.notification_prefs;
create policy notif_prefs_select on public.notification_prefs for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists notif_prefs_insert on public.notification_prefs;
create policy notif_prefs_insert on public.notification_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists notif_prefs_update on public.notification_prefs;
create policy notif_prefs_update on public.notification_prefs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- 2. 브라우저 푸시 구독 ----------
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 20 and 1000 and endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) between 16 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text not null default '' check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_subscriptions_uniq unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, id desc);
create index if not exists push_subscriptions_endpoint_idx on public.push_subscriptions (endpoint);
comment on table public.push_subscriptions is '브라우저 푸시 구독. 한 사람당 최대 10개(기기를 바꿔도 쌓이지 않게 오래된 것부터 지운다). 만료(404·410) 구독은 hub-notify 가 지운다.';
comment on column public.push_subscriptions.endpoint is '브라우저가 준 푸시 주소. 같은 기기에서 두 사람이 쓰면 줄이 두 개 생길 수 있어 (사람, 주소) 로만 유일하다.';

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists push_subs_select on public.push_subscriptions;
create policy push_subs_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_subs_insert on public.push_subscriptions;
create policy push_subs_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists push_subs_update on public.push_subscriptions;
create policy push_subs_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists push_subs_delete on public.push_subscriptions;
create policy push_subs_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- 한 사람당 10개까지만 (넘으면 오래된 것부터 지운다)
create or replace function private.push_sub_keep10() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions s
   where s.user_id = new.user_id
     and s.id not in (
       select x.id from public.push_subscriptions x
        where x.user_id = new.user_id
        order by x.created_at desc, x.id desc
        limit 10
     );
  return null;
end $$;
revoke all on function private.push_sub_keep10() from public, anon, authenticated;
drop trigger if exists push_subscriptions_keep10 on public.push_subscriptions;
create trigger push_subscriptions_keep10 after insert on public.push_subscriptions
  for each row execute function private.push_sub_keep10();

-- ---------- 3. 알림함 ----------
create table if not exists public.notification_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('app_request', 'dev_request', 'member', 'health')),
  ref text not null default '' check (char_length(ref) <= 60),
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 300),
  url text not null default '/hub/requests' check (url ~ '^/[A-Za-z0-9/_-]*$' and char_length(url) <= 120),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notification_log_user_idx on public.notification_log (user_id, created_at desc);
create index if not exists notification_log_unread_idx on public.notification_log (user_id) where read_at is null;
comment on table public.notification_log is '알림함. 넣는 것은 트리거(신청 승인·반려, 역할 변경)와 함수만 — 브라우저는 자기 것만 읽고 읽음 표시만 한다. 본문에 개인정보를 넣지 않는다(앱 이름·결정만).';

alter table public.notification_log enable row level security;
revoke all on public.notification_log from anon, authenticated;
grant select on public.notification_log to authenticated;
grant update (read_at) on public.notification_log to authenticated;

drop policy if exists notify_log_select on public.notification_log;
create policy notify_log_select on public.notification_log for select to authenticated
  using (user_id = (select auth.uid()));

-- 읽음 표시만 (read_at 한 칸만 바꿀 수 있다 — 다른 칸은 권한이 없다)
drop policy if exists notify_log_update on public.notification_log;
create policy notify_log_update on public.notification_log for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- 4. 알림을 만드는 트리거 (알림 실패가 신청 처리를 막지 않게 감싼다) ----------
create or replace function private.notify_app_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    begin
      insert into public.notification_log (user_id, kind, ref, title, body, url)
      values (
        new.requested_by,
        'app_request',
        new.id::text,
        case when new.status = 'approved' then '앱 신청이 승인되었습니다' else '앱 신청이 반려되었습니다' end,
        left(new.app_name || case when btrim(new.review_note) <> '' then ' · ' || new.review_note else '' end, 300),
        '/hub/requests'
      );
    exception when others then
      raise warning 'notify_app_request: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function private.notify_app_request() from public, anon, authenticated;
drop trigger if exists app_requests_notify on public.app_requests;
create trigger app_requests_notify after update on public.app_requests
  for each row execute function private.notify_app_request();

create or replace function private.notify_dev_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_app text;
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') and new.requested_by is not null then
    begin
      select a.name into v_app from public.apps a where a.id = new.app_id;
      insert into public.notification_log (user_id, kind, ref, title, body, url)
      values (
        new.requested_by,
        'dev_request',
        new.id::text,
        case when new.status = 'approved' then '개발자 요청이 승인되었습니다' else '개발자 요청이 반려되었습니다' end,
        left(coalesce(v_app, '앱') || case when btrim(new.decision_note) <> '' then ' · ' || new.decision_note else '' end, 300),
        '/hub/requests'
      );
    exception when others then
      raise warning 'notify_dev_request: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function private.notify_dev_request() from public, anon, authenticated;
drop trigger if exists dev_requests_notify on public.dev_requests;
create trigger dev_requests_notify after update on public.dev_requests
  for each row execute function private.notify_dev_request();

create or replace function private.notify_member_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and new.role in ('staff', 'admin', 'disabled') then
    begin
      insert into public.notification_log (user_id, kind, ref, title, body, url)
      values (
        new.id,
        'member',
        new.role,
        case new.role
          when 'staff' then '개발자로 승인되었습니다'
          when 'admin' then '관리자로 지정되었습니다'
          else '이용이 중지되었습니다'
        end,
        case new.role
          when 'staff' then '이제 앱을 신청하고 내 앱을 관리할 수 있습니다.'
          when 'admin' then '앱 신청·개발자 요청을 검토할 수 있습니다.'
          else '자세한 내용은 관리자에게 물어보세요.'
        end,
        case when new.role = 'disabled' then '/hub/account' else '/guide' end
      );
    exception when others then
      raise warning 'notify_member_role: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function private.notify_member_role() from public, anon, authenticated;
drop trigger if exists profiles_notify_role on public.profiles;
create trigger profiles_notify_role after update on public.profiles
  for each row execute function private.notify_member_role();

-- ---------- 5. VAPID 열쇠 (서버만) ----------
create table if not exists bmr_admin.push_config (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  subject text not null default 'mailto:bmrapps@bmrschool.org',
  created_at timestamptz not null default now()
);
revoke all on bmr_admin.push_config from public, anon, authenticated;
comment on table bmr_admin.push_config is 'Web Push VAPID 열쇠쌍. hub-notify 가 처음 필요할 때 Web Crypto 로 만들어 한 번 저장한다. private_jwk 는 함수만 읽는다.';

-- ---------- 6. hub-notify → hub-mail 일회용 메일 표 ----------
-- 왜: 메일 비밀번호(Gmail 앱 비밀번호)를 푸는 열쇠는 hub-mail 배포본에만 있다. hub-notify 는 새 열쇠를 만들지 않고
--     이 표에 한 줄(받는 사람·제목·본문)을 넣은 뒤 그 값을 헤더로 보내 메일을 부탁한다. 값은 2분·한 번만 쓸 수 있고,
--     받는 사람이 표에 적힌 한 사람으로 고정되므로 값이 새어도 그 사람에게 한 통만 갈 수 있다.
create table if not exists bmr_admin.notify_grants (
  id bigint generated always as identity primary key,
  nonce text not null unique check (nonce ~ '^[0-9a-f]{64}$'),
  to_email text not null check (char_length(to_email) <= 254),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index if not exists notify_grants_created_idx on bmr_admin.notify_grants (created_at desc);
create index if not exists notify_grants_email_idx on bmr_admin.notify_grants (to_email, created_at desc);
revoke all on bmr_admin.notify_grants from public, anon, authenticated;
comment on table bmr_admin.notify_grants is 'hub-notify 가 hub-mail 에 알림 메일을 부탁할 때 쓰는 일회용 표(2분·한 번). 받는 사람 고정.';

-- ---------- 7. 호출·발송 횟수 (사람·IP 한도, 메일 쿨다운) ----------
create table if not exists bmr_admin.notify_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  ip text not null default '' check (char_length(ip) <= 60),
  action text not null check (char_length(action) <= 30),
  ref text not null default '' check (char_length(ref) <= 60),
  ok boolean not null default true
);
create index if not exists notify_attempts_at_idx on bmr_admin.notify_attempts (at desc);
create index if not exists notify_attempts_user_idx on bmr_admin.notify_attempts (user_id, action, at desc);
create index if not exists notify_attempts_ref_idx on bmr_admin.notify_attempts (user_id, action, ref, at desc);
revoke all on bmr_admin.notify_attempts from public, anon, authenticated;
comment on table bmr_admin.notify_attempts is '알림 호출·발송 횟수. 한도(사람·IP)와 메일 쿨다운(같은 대화 10분에 1통)을 세는 데만 쓴다. 메일 주소·본문은 남기지 않는다.';

-- ---------- 8. 실시간: 새 알림이 배지·종에 바로 뜨게 (본문은 REST 로 다시 읽는다 — RLS 그대로) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_log') then
    alter publication supabase_realtime add table public.notification_log;
  end if;
end $$;

-- 새 표를 PostgREST 가 바로 알아보게 한다
notify pgrst, 'reload schema';
