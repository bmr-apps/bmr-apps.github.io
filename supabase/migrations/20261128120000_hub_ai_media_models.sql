-- hub-ai: 학교 전체 허용 모델 목록에 최신 Gemini 모델과 음성(TTS)·이미지 모델을 더한다 (2026-11-28)
-- hub-ai/models.ts · hub-devtools/rules.ts 의 STARTER_MODELS 와 같은 목록이다.
-- 허용 목록은 관리자 화면(앱 정보 → 🤖 앱 AI → 학교 전체 AI 기본값)에서 언제든 바꿀 수 있으므로,
-- 이 마이그레이션은 **없는 것만 뒤에 붙인다**(이미 있으면 순서 그대로, 관리자가 지운 것을 되살리지 않는다).
-- 목록이 이미 50개(ai_config 상한)면 더 넣지 않는다.

do $$
declare
  add_models text[] := array[
    'gemini:gemini-2.5-flash-lite',
    'gemini:gemini-2.5-flash-preview-tts',
    'gemini:gemini-2.5-flash-image',
    'gemini:gemini-3.1-flash-tts-preview',
    'gemini:gemini-3.1-flash-image',
    'openai:gpt-4o-mini-tts'
  ];
  cur jsonb;
  next_list jsonb;
  m text;
  has boolean;
begin
  select allowed_models into cur from bmr_admin.ai_config where id = 1;
  if cur is null or jsonb_typeof(cur) <> 'array' then
    return;   -- 설정 줄이 없거나 모양이 다르면 건드리지 않는다 (관리자 화면에서 넣는다)
  end if;
  next_list := cur;
  foreach m in array add_models loop
    select exists (
      select 1 from jsonb_array_elements_text(next_list) as x where lower(x) = lower(m)
    ) into has;
    if not has and jsonb_array_length(next_list) < 50 then
      next_list := next_list || to_jsonb(m);
    end if;
  end loop;
  if next_list is distinct from cur then
    update bmr_admin.ai_config set allowed_models = next_list, updated_at = now() where id = 1;
  end if;
end $$;
