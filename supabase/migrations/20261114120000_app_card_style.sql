-- 서비스 카드 꾸미기: 아이콘(이모지)·로고·색. 기본값은 비움(주소 이름으로 자동 지정).
-- 관리자와 그 앱 담당 개발자만 바꿀 수 있음. 로고는 공개 버킷 hub-assets/logos/<slug>/ 에 둠.

alter table public.apps
  add column if not exists card_icon text
    check (card_icon is null or (
      char_length(card_icon) between 1 and 32
      and card_icon !~ '[<>&''"/\\`@]|[A-Za-z0-9]|[[:cntrl:]]'
    )),
  add column if not exists card_logo_url text
    check (card_logo_url is null or char_length(card_logo_url) between 20 and 300),
  add column if not exists card_color text
    check (card_color is null
      or card_color in ('violet', 'blue', 'teal', 'pink', 'amber', 'green', 'navy')
      or card_color ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.apps.card_icon is '카드 이모지. 비우면 주소 이름으로 자동 지정. 로고가 있으면 로고가 우선.';
comment on column public.apps.card_logo_url is '카드 로고 공개 주소 (hub-assets/logos/<slug>/...). 비우면 이모지 또는 자동 아이콘.';
comment on column public.apps.card_color is '카드 색(팔레트 이름 또는 #RRGGBB). 비우면 주소 이름으로 자동 지정.';

grant select (card_icon, card_logo_url, card_color) on public.apps to anon;

-- 담당 개발자는 카드 세 칸만 바꿀 수 있고, 로고 주소는 이 앱 경로만 허용한다.
create or replace function private.apps_card_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.card_logo_url is not null
     and new.card_logo_url !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/hub-assets/logos/' || new.slug || '/[A-Za-z0-9._-]+$') then
    raise exception '로고 주소가 올바르지 않습니다.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and not (select private.is_admin()) then
    if new.slug is distinct from old.slug
      or new.name is distinct from old.name
      or new.description is distinct from old.description
      or new.url is distinct from old.url
      or new.repo_url is distinct from old.repo_url
      or new.supabase_ref is distinct from old.supabase_ref
      or new.status is distinct from old.status
      or new.note is distinct from old.note
      or new.sort is distinct from old.sort
      or new.fn_auto_deploy is distinct from old.fn_auto_deploy
      or new.created_at is distinct from old.created_at
    then
      raise exception '담당 개발자는 카드 아이콘·색·로고만 바꿀 수 있습니다.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.apps_card_guard() from public, anon, authenticated;
drop trigger if exists apps_card_guard on public.apps;
create trigger apps_card_guard before insert or update on public.apps
  for each row execute function private.apps_card_guard();

drop policy if exists apps_owner_update_card on public.apps;
create policy apps_owner_update_card on public.apps for update to authenticated
  using ((select private.owns_app(id)))
  with check ((select private.owns_app(id)));

-- 로고 파일: 공개 읽기, 올리기·지우기는 관리자 또는 그 앱 담당 개발자. png/jpg/webp, 최대 512KB. SVG 는 넣지 않음.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hub-assets', 'hub-assets', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = 524288,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_manage_hub_logo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    coalesce(p_name, '') ~ '^logos/[a-z0-9][a-z0-9-]{1,38}/[A-Za-z0-9._-]+$'
    and (
      (select private.is_admin())
      or exists (
        select 1 from public.apps a
        where a.slug = split_part(p_name, '/', 2)
          and (select private.owns_app(a.id))
      )
    )
$$;
revoke all on function private.can_manage_hub_logo(text) from public, anon;
grant execute on function private.can_manage_hub_logo(text) to authenticated;

drop policy if exists "hub-assets: 모두 읽기" on storage.objects;
create policy "hub-assets: 모두 읽기" on storage.objects for select to anon, authenticated
  using (bucket_id = 'hub-assets');

drop policy if exists "hub-assets: 담당자 올리기" on storage.objects;
create policy "hub-assets: 담당자 올리기" on storage.objects for insert to authenticated
  with check (bucket_id = 'hub-assets' and (select private.can_manage_hub_logo(name)));

drop policy if exists "hub-assets: 담당자 수정" on storage.objects;
create policy "hub-assets: 담당자 수정" on storage.objects for update to authenticated
  using (bucket_id = 'hub-assets' and (select private.can_manage_hub_logo(name)))
  with check (bucket_id = 'hub-assets' and (select private.can_manage_hub_logo(name)));

drop policy if exists "hub-assets: 담당자 삭제" on storage.objects;
create policy "hub-assets: 담당자 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'hub-assets' and (select private.can_manage_hub_logo(name)));
