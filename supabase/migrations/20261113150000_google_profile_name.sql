-- 구글 로그인으로 처음 들어온 사람도 이메일 가입과 똑같이 프로필을 만든다.
-- 역할은 넣지 않으므로 기본값 'pending'(일반 사용자). 개발자·관리자는 관리자가 사용자 관리에서만 올린다.
-- 이름: 가입 때 넣은 name → 구글의 full_name/name → 빈 값
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    lower(coalesce(new.email, new.raw_user_meta_data->>'email', '')),
    left(coalesce(nullif(new.raw_user_meta_data->>'name', ''), nullif(new.raw_user_meta_data->>'full_name', ''), ''), 100)
  )
  on conflict (id) do nothing;
  return new;
end $$;
