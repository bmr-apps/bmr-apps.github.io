insert into public.apps (slug, name, description, url, repo_url, supabase_ref, status, note, sort)
values ('designer', '별무리 수업 디자이너', '교과 수업 설계와 역량 루브릭을 돕는 도구',
        'https://bmr-designer.vercel.app', null, 'vzrfjqazgufhiucdsjga', 'active',
        'https://apps.bmrschool.net/designer (bmr-apps/designer 저장소)로 옮길 예정', 10)
on conflict (slug) do nothing;
-- 첫 관리자는 가입 후 SQL 한 줄로 올린다 (README 참고):
--   update public.profiles set role = 'admin' where email = 'dev@bmrschool.org';
