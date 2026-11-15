-- 쪽지 남용 방지: 한 사람이 한 시간에 메시지 60개, 새로 여는 대화 20개까지.
-- 왜: 대화는 1:1 이라 한 번에 전체를 뿌릴 수는 없지만, 스크립트로 회원 목록(chat_people)을 돌며
--     쪽지를 대량으로 넣을 수 있다. 본문을 지우는 기능은 없으므로 한도를 서버에서 막는다.
-- 이미 있는 chat_start 를 같은 이름으로 다시 만들어 한도만 더한다 (권한·거절 규칙은 그대로).

create or replace function private.chat_message_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.chat_messages
      where sender = new.sender and created_at > now() - interval '1 hour') >= 60 then
    raise exception '한 시간에 쪽지는 60개까지 보낼 수 있습니다. 잠시 뒤 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.chat_message_rate() from public, anon, authenticated;
drop trigger if exists chat_messages_rate on public.chat_messages;
create trigger chat_messages_rate before insert on public.chat_messages
  for each row execute function private.chat_message_rate();

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
    if (select count(*) from public.chat_threads where created_by = me and created_at > now() - interval '1 hour') >= 20 then
      raise exception '한 시간에 새 대화는 20개까지 시작할 수 있습니다. 잠시 뒤 다시 시도해 주세요.' using errcode = 'P0001';
    end if;
    begin
      insert into public.chat_threads (user_lo, user_hi, created_by) values (lo, hi, me) returning id into v_id;
    exception when unique_violation then
      select t.id into v_id from public.chat_threads t where t.user_lo = lo and t.user_hi = hi;
    end;
  end if;
  return v_id;
end $$;
-- 권한은 기존 마이그레이션과 같게 다시 맞춘다 (replace 해도 기본 권한이 바뀔 수 있음)
revoke all on function public.chat_start(uuid) from public, anon;
grant execute on function public.chat_start(uuid) to authenticated;
