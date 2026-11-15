-- 가입 회원 간 1:1 쪽지 — public.chat_threads · chat_messages · chat_reads
--
-- 왜: 허브에 가입한 회원끼리 짧은 이야기를 나눌 곳이 없었다. 대화는 그 대화의 두 사람만 읽을 수 있고,
--     관리자라도 대화에 끼어 있지 않으면 내용을 볼 수 없다 (감사 기록에도 본문을 남기지 않는다).
-- 구조: 대화(threads)는 두 사람을 늘 작은 쪽(user_lo) / 큰 쪽(user_hi) 으로 정렬해 한 쌍에 하나만 둔다
--       → 같은 두 사람이 대화를 여러 개 만들 수 없고, 참여자 확인이 'id 가 lo 또는 hi' 한 줄로 끝난다.
--       메시지(messages)는 대화에만 매단다. 읽음(reads)은 사람마다 '마지막으로 읽은 메시지 번호'만 둔다.
-- 권한: 표에는 직접 insert/update 권한을 주지 않는다. 대화 만들기·읽음 표시는 함수(chat_start · chat_mark_read)로만 하고,
--       메시지 insert 만 sender = auth.uid() 조건으로 직접 허용한다(화면이 한 번에 보내고, 트리거가 대화 시각·읽음을 갱신).
--       읽기는 RLS 정책이 '이 대화의 참여자인가'를 확인한다.

-- ---------- 1. 대화 ----------
create table if not exists public.chat_threads (
  id bigint generated always as identity primary key,
  user_lo uuid not null references auth.users (id) on delete cascade,
  user_hi uuid not null references auth.users (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint chat_threads_pair_order check (user_lo < user_hi)
);
create unique index if not exists chat_threads_pair_uniq on public.chat_threads (user_lo, user_hi);
create index if not exists chat_threads_hi_idx on public.chat_threads (user_hi);
create index if not exists chat_threads_last_idx on public.chat_threads (last_message_at desc);
comment on table public.chat_threads is '1:1 쪽지 대화. 두 사람을 (user_lo < user_hi) 로 정렬해 한 쌍에 하나만 둔다.';
comment on column public.chat_threads.last_message_at is '마지막 메시지 시각. 메시지 insert 트리거가 갱신한다 (목록 정렬용).';

-- ---------- 2. 메시지 ----------
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.chat_threads (id) on delete cascade,
  sender uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, id desc);
comment on table public.chat_messages is '쪽지 본문. 대화 참여자만 읽을 수 있고, 최대 2,000자.';

-- ---------- 3. 읽음 ----------
create table if not exists public.chat_reads (
  thread_id bigint not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_id bigint not null default 0 check (last_read_id >= 0),
  read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
comment on table public.chat_reads is '사람별 마지막으로 읽은 메시지 번호. 이보다 큰 남의 메시지가 안 읽은 쪽지다.';

-- ---------- 4. 참여자 확인 도우미 (RLS 정책이 쓴다) ----------
create or replace function private.chat_member(p_thread bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_threads t
    where t.id = p_thread
      and (select auth.uid()) is not null
      and (select auth.uid()) in (t.user_lo, t.user_hi)
  )
$$;
revoke all on function private.chat_member(bigint) from public, anon;
grant execute on function private.chat_member(bigint) to authenticated;

-- ---------- 5. RLS ----------
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;

revoke all on public.chat_threads, public.chat_messages, public.chat_reads from anon, authenticated;
grant select on public.chat_threads to authenticated;
grant select, insert on public.chat_messages to authenticated;
grant select, insert, update on public.chat_reads to authenticated;
-- 메시지 id 는 브라우저가 직접 넣으므로(트리거 없이) 그 시퀀스만 따로 허용한다
grant usage, select on sequence public.chat_threads_id_seq, public.chat_messages_id_seq to authenticated;

drop policy if exists chat_threads_select on public.chat_threads;
create policy chat_threads_select on public.chat_threads for select to authenticated
  using (user_lo = (select auth.uid()) or user_hi = (select auth.uid()));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated
  using ((select private.chat_member(thread_id)));

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (sender = (select auth.uid()) and (select private.chat_member(thread_id)));

drop policy if exists chat_reads_select on public.chat_reads;
create policy chat_reads_select on public.chat_reads for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists chat_reads_insert on public.chat_reads;
create policy chat_reads_insert on public.chat_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.chat_member(thread_id)));

drop policy if exists chat_reads_update on public.chat_reads;
create policy chat_reads_update on public.chat_reads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select private.chat_member(thread_id)));

-- ---------- 6. 메시지를 넣으면 대화 시각·보낸 사람 읽음이 함께 바뀐다 ----------
create or replace function private.chat_after_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_threads set last_message_at = new.created_at where id = new.thread_id;
  insert into public.chat_reads as r (thread_id, user_id, last_read_id, read_at)
  values (new.thread_id, new.sender, new.id, now())
  on conflict (thread_id, user_id) do update
    set last_read_id = greatest(r.last_read_id, excluded.last_read_id),
        read_at = now();
  return null;
end $$;
revoke all on function private.chat_after_message() from public, anon, authenticated;
drop trigger if exists chat_messages_after_insert on public.chat_messages;
create trigger chat_messages_after_insert after insert on public.chat_messages
  for each row execute function private.chat_after_message();

-- ---------- 7. 화면이 부르는 함수 ----------
-- 대화 시작(이미 있으면 그 대화 번호). 상대가 없거나 사용 중지면 거절한다.
create or replace function public.chat_start(p_peer uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  lo uuid; hi uuid; v_id bigint; my_role text; peer_role text;
begin
  if me is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_peer is null or p_peer = me then raise exception '대화할 상대를 골라 주세요.' using errcode = '22023'; end if;
  select role into my_role from public.profiles where id = me;
  if coalesce(my_role, '') = '' then raise exception '프로필을 찾지 못했습니다. 다시 로그인해 주세요.'; end if;
  if my_role = 'disabled' then raise exception '사용이 중지된 계정입니다.' using errcode = '42501'; end if;
  select role into peer_role from public.profiles where id = p_peer;
  if coalesce(peer_role, '') = '' then raise exception '그런 회원이 없습니다.'; end if;
  if peer_role = 'disabled' then raise exception '사용이 중지된 회원과는 대화할 수 없습니다.'; end if;
  if me < p_peer then lo := me; hi := p_peer; else lo := p_peer; hi := me; end if;
  select t.id into v_id from public.chat_threads t where t.user_lo = lo and t.user_hi = hi;
  if v_id is null then
    begin
      insert into public.chat_threads (user_lo, user_hi, created_by) values (lo, hi, me) returning id into v_id;
    exception when unique_violation then
      select t.id into v_id from public.chat_threads t where t.user_lo = lo and t.user_hi = hi;
    end;
  end if;
  return v_id;
end $$;

-- 내 대화 목록 (상대 이름·마지막 글·안 읽은 수). 남의 대화는 나오지 않는다.
create or replace function public.chat_inbox()
returns table (
  thread_id bigint, peer_id uuid, peer_name text, peer_label text, peer_role text,
  last_at timestamptz, last_body text, last_from uuid, unread integer
)
language sql stable security definer set search_path = '' as $$
  select t.id,
    case when t.user_lo = (select auth.uid()) then t.user_hi else t.user_lo end as peer_id,
    coalesce(p.name, '')::text as peer_name,
    coalesce(nullif(btrim(p.name), ''), split_part(coalesce(p.email, ''), '@', 1))::text as peer_label,
    coalesce(p.role, '')::text as peer_role,
    t.last_message_at as last_at,
    coalesce((select m.body from public.chat_messages m where m.thread_id = t.id order by m.id desc limit 1), '') as last_body,
    (select m.sender from public.chat_messages m where m.thread_id = t.id order by m.id desc limit 1) as last_from,
    (select count(*)::int from public.chat_messages m
      where m.thread_id = t.id
        and m.sender <> (select auth.uid())
        and m.id > coalesce((select r.last_read_id from public.chat_reads r
                             where r.thread_id = t.id and r.user_id = (select auth.uid())), 0)) as unread
  from public.chat_threads t
  join public.profiles p on p.id = case when t.user_lo = (select auth.uid()) then t.user_hi else t.user_lo end
  where (select auth.uid()) is not null
    and (t.user_lo = (select auth.uid()) or t.user_hi = (select auth.uid()))
  order by t.last_message_at desc
  limit 200
$$;

-- 대화 상대로 고를 수 있는 회원 (이름·역할만. 메일 주소는 돌려주지 않는다)
create or replace function public.chat_people()
returns table (id uuid, name text, label text, role text)
language sql stable security definer set search_path = '' as $$
  select p.id,
    coalesce(p.name, '')::text as name,
    coalesce(nullif(btrim(p.name), ''), split_part(coalesce(p.email, ''), '@', 1))::text as label,
    coalesce(p.role, '')::text as role
  from public.profiles p
  where p.role <> 'disabled'
    and p.id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
    and exists (select 1 from public.profiles me where me.id = (select auth.uid()) and me.role <> 'disabled')
  order by case p.role when 'admin' then 0 when 'staff' then 1 else 2 end,
    coalesce(nullif(btrim(p.name), ''), p.email)
  limit 500
$$;

-- 읽음 표시 (번호를 안 주면 지금까지 온 것 전부)
create or replace function public.chat_mark_read(p_thread bigint, p_last_id bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v_last bigint;
begin
  if me is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if not private.chat_member(p_thread) then raise exception '이 대화를 볼 수 없습니다.' using errcode = '42501'; end if;
  v_last := coalesce(p_last_id, (select max(m.id) from public.chat_messages m where m.thread_id = p_thread), 0);
  insert into public.chat_reads as r (thread_id, user_id, last_read_id, read_at)
  values (p_thread, me, greatest(coalesce(v_last, 0), 0), now())
  on conflict (thread_id, user_id) do update
    set last_read_id = greatest(r.last_read_id, excluded.last_read_id),
        read_at = now();
end $$;

revoke all on function public.chat_start(uuid), public.chat_inbox(), public.chat_people(), public.chat_mark_read(bigint, bigint) from public, anon;
grant execute on function public.chat_start(uuid), public.chat_inbox(), public.chat_people(), public.chat_mark_read(bigint, bigint) to authenticated;

-- ---------- 8. 실시간(Realtime): 새 쪽지·대화 순서가 화면에 바로 뜨게 ----------
-- 화면은 바뀌었다는 신호로만 쓰고 본문은 REST(RLS 적용)로 다시 읽는다 (RLS 는 Realtime 에서도 그대로 적용된다).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_threads') then
    alter publication supabase_realtime add table public.chat_threads;
  end if;
end $$;

-- 새 표·함수를 PostgREST(Supabase API)가 바로 알아보게 한다 (앱은 chat_inbox·chat_people·chat_start·chat_mark_read 를 부른다)
notify pgrst, 'reload schema';
