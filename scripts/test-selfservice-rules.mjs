#!/usr/bin/env node
// 개발자 셀프서비스 규칙 시험 (네트워크 없음): 비밀값 이름 접두어 · 다른 앱 이름 공간 · 추가 함수 이름 · 로그 SQL · 비밀값 가리기.
// 사용: node scripts/test-selfservice-rules.mjs
import { readFileSync } from 'node:fs';
const R = await import('../supabase/functions/hub-devtools/rules.ts');
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗', l, x); } };
const ALL = ['class-designer', 'class', 'beri', 'zz-a', 'zz-a-b'];

console.log('[비밀값 이름]');
const sn = (slug, name) => R.secretNameProblem(slug, name, ALL);
ok(sn('class-designer', 'CLASS_DESIGNER_SELFTEST') === null, 'CLASS_DESIGNER_SELFTEST: 자기 접두어 → 허용');
ok(sn('class-designer', 'CLASS_DESIGNER_GEMINI_API_KEY') === null, '긴 이름도 허용');
ok(sn('class-designer', 'BERI_KEY') !== null, '다른 앱 접두어(BERI_) → 거부');
ok(sn('class-designer', 'API_KEY') !== null, '접두어 없음 → 거부');
ok(sn('class-designer', 'CLASS_DESIGNER_') !== null, '접두어만 → 거부');
ok(sn('class-designer', 'CLASS_DESIGNER_DB_URL') !== null, '허브 관리 값(<접두어>DB_URL) → 거부');
ok(sn('class-designer', 'SUPABASE_SERVICE_ROLE_KEY') !== null, 'SUPABASE_* → 거부');
ok(sn('class-designer', 'BMR_MGMT_TOKEN') !== null && sn('class-designer', 'HUB_CRON_SECRET') !== null, 'BMR_* · HUB_* → 거부');
ok(sn('class-designer', 'class_designer_key') !== null, '소문자 → 거부');
ok(sn('class-designer', 'CLASS_DESIGNER_A-B') !== null && sn('class-designer', 'CLASS_DESIGNER_A B') !== null, '하이픈·공백 → 거부');
ok(sn('class-designer', 'CLASS_DESIGNER__X') !== null && sn('class-designer', 'CLASS_DESIGNER_X_') !== null, '밑줄로 시작·끝 → 거부');
ok(sn('class-designer', 'CLASS_DESIGNER_' + 'A'.repeat(100)) !== null, '100자 넘음 → 거부');
ok(sn('class', 'CLASS_KEY') === null, '앱 class: CLASS_KEY 허용');
ok(sn('class', 'CLASS_DESIGNER_KEY') !== null, '앱 class: CLASS_DESIGNER_KEY(앱 class-designer 몫) → 거부');
ok(sn('class-designer', 'CLASS_KEY') !== null, '앱 class-designer: CLASS_KEY(짧은 앱 몫) → 거부');
ok(sn('zz-a', 'ZZ_A_B_KEY') !== null && sn('zz-a-b', 'ZZ_A_B_KEY') === null, '겹치는 접두어(zz-a / zz-a-b): 긴 쪽 몫');
ok(R.secretNameProblem('beri', 'beri'.toUpperCase() + '_X') === null, '목록 없이도 자기 접두어는 허용');
ok(R.secretValueProblem('') !== null && R.secretValueProblem(undefined) !== null && R.secretValueProblem(123) !== null, '빈 값·문자 아님 → 거부');
ok(R.secretValueProblem('x'.repeat(R.SECRET_VALUE_MAX + 1)) !== null && R.secretValueProblem('ok-value') === null, `값 길이 ${R.SECRET_VALUE_MAX}자까지`);

console.log('[추가 함수 이름]');
const fk = (slug, fn) => R.fnKind(slug, fn, ALL);
ok(fk('class-designer', 'class-designer-fn') === 'main', '<slug>-fn → 기본 함수');
ok(fk('class-designer', 'class-designer-api') === 'extra' && fk('class-designer', 'class-designer-pdf-export') === 'extra', '<slug>-이름 → 추가 함수');
ok(fk('class-designer', 'class-designer-API') === null && fk('class-designer', 'class-designer-a_b') === null, '대문자·밑줄 → 아님');
ok(fk('class-designer', 'class-designer-') === null && fk('class-designer', 'class-designer--x') === null && fk('class-designer', 'class-designer-x-') === null, '빈 끝부분·이중 하이픈 → 아님');
ok(fk('class-designer', 'class-designer-' + 'a'.repeat(21)) === null && fk('class-designer', 'class-designer-' + 'a'.repeat(20)) === 'extra', '끝부분 20자까지');
ok(fk('class', 'class-designer') === null && fk('class', 'class-designer-x') === null, '앱 class: class-designer(-…) 는 다른 앱 몫 → 아님');
ok(fk('class', 'class-api') === 'extra', '앱 class: class-api 는 자기 몫');
ok(fk('class-designer', 'hub-provision') === null && fk('class-designer', 'beri-fn') === null, '허브·다른 앱 함수 → 아님');
ok(R.extraFnProblem('class-designer', 'class-designer-api', ALL) === null && R.extraFnProblem('class', 'class-designer-x', ALL) !== null, 'extraFnProblem 이유 문구');

console.log('[hub-fn-deploy · hub-deprovision 규칙이 같은지]');
const dep = readFileSync(new URL('../supabase/functions/hub-fn-deploy/index.ts', import.meta.url), 'utf8');
ok(dep.includes(`const EXTRA_FN_MAX = ${R.EXTRA_FN_MAX};`), `hub-fn-deploy EXTRA_FN_MAX = ${R.EXTRA_FN_MAX}`);
ok(dep.includes(`const EXTRA_FN_SUFFIX_RE = ${R.EXTRA_FN_SUFFIX_RE};`) && dep.includes(`const EXTRA_FN_SUFFIX_MAX = ${R.EXTRA_FN_SUFFIX_MAX};`), 'hub-fn-deploy 끝부분 규칙 같음');
const g = readFileSync(new URL('../supabase/functions/hub-deprovision/guard.ts', import.meta.url), 'utf8');
ok(g.includes(`suffix.length > ${R.EXTRA_FN_SUFFIX_MAX}`) && g.includes(String(R.EXTRA_FN_SUFFIX_RE)), 'hub-deprovision 추가 함수 규칙 같음');
// hub-fn-deploy 의 fnKind 를 꺼내 같은 결과인지
const body = dep.slice(dep.indexOf('function fnKind('), dep.indexOf("return 'extra';\n}") + "return 'extra';\n}".length)
  .replace(/\(slug: string, fn: string, allSlugs: string\[\] = \[\]\): 'main' \| 'extra' \| null/, '(slug, fn, allSlugs = [])');
const depKind = new Function('EXTRA_FN_SUFFIX_RE', 'EXTRA_FN_SUFFIX_MAX', `${body}; return fnKind;`)(R.EXTRA_FN_SUFFIX_RE, R.EXTRA_FN_SUFFIX_MAX);
const cases = [['class-designer', 'class-designer-fn'], ['class-designer', 'class-designer-api'], ['class', 'class-designer-x'], ['class', 'class-api'], ['class-designer', 'class-designer-A'], ['zz-a', 'zz-a-b'], ['zz-a', 'zz-a-c']];
ok(cases.every(([s, f]) => depKind(s, f, ALL) === R.fnKind(s, f, ALL)), 'hub-fn-deploy fnKind 결과 = rules.ts', JSON.stringify(cases.map(([s, f]) => [f, depKind(s, f, ALL), R.fnKind(s, f, ALL)])));

console.log('[로그 SQL]');
const id = 'f00af562-86ab-4fa0-9dca-0fb8f76ac5b6';
const q = R.logSql('fn', [id]);
ok(q.includes(`in ('${id}')`) && q.includes("source in ('function_logs', 'function_edge_logs')") && /limit 200$/.test(q), '함수 로그: 그 함수 id 만');
let threw = false; try { R.logSql('fn', ["x' or 1=1 --"]); } catch { threw = true; } ok(threw, '함수 id 에 따옴표·SQL → 거부');
threw = false; try { R.logSql('fn', []); } catch { threw = true; } ok(threw, '함수 id 없음 → 거부 (전체 로그 안 나감)');
threw = false; try { R.logSql('db', ["postgres' or '1'='1"]); } catch { threw = true; } ok(threw, 'DB 역할에 따옴표 → 거부');
const d = R.logSql('db', ['class_designer_dev', 'class_designer_fn'], { errorsOnly: true, limit: 5000 });
ok(d.includes("in ('class_designer_dev', 'class_designer_fn')") && d.includes("source = 'postgres_logs'") && /limit 300$/.test(d) && d.includes('ERROR'), 'DB 로그: 그 앱 역할만, 최대 300줄, 오류만');

console.log('[앱 메일]');
const MAIL_TS = R.mailSecretOf('class-designer');
ok(MAIL_TS === 'CLASS_DESIGNER_MAIL_TOKEN', '비밀값 이름 = <접두어>MAIL_TOKEN', MAIL_TS);
ok(R.mailSecretOf('my-app') === 'MY_APP_MAIL_TOKEN', '하이픈 앱 이름 → 밑줄 접두어', R.mailSecretOf('my-app'));
ok(R.secretNameProblem('class-designer', MAIL_TS, ALL) === null, 'MAIL_TOKEN 은 비밀값 이름 검사를 통과 (셀프서비스 발급 가능)');
ok(R.secretNameProblem('zz-a', R.mailSecretOf('zz-a-b'), ALL) !== null, '다른 앱의 MAIL_TOKEN 이름은 거부');
ok(R.mailAddressOf('class-designer') === 'bmrapps@bmrschool.org', '보내는 주소 = bmrapps@bmrschool.org', R.mailAddressOf('class-designer'));
ok(R.mailState(true, true) === 'active' && R.mailState(false, false) === 'none' && R.mailState(true, false) === 'mismatch' && R.mailState(false, true) === 'mismatch', '상태: 활성(둘 다) · 미발급(둘 다 없음) · 불일치(한쪽만)');
const hubMail = readFileSync(new URL('../supabase/functions/hub-mail/index.ts', import.meta.url), 'utf8');
ok(['perAppHour', 'perAppDay', 'globalDay', 'globalRecipientsDay', 'maxTo'].every((k) => hubMail.includes(`${k}: ${R.MAIL_LIMITS[k]}`)), `hub-mail 한도 = MAIL_LIMITS (${JSON.stringify(R.MAIL_LIMITS)})`);
ok(hubMail.includes('sum(recipient_count)') && hubMail.includes('global_recipients_day') && hubMail.includes('used + addRecipients > LIMIT.globalRecipientsDay'), '학교 전체 받는 사람 한도는 보낸 메일의 recipient_count 합 + 이번 수신자 수가 8,000을 넘으면 거절');

console.log('[앱 AI]');
const A = await import('../supabase/functions/hub-ai/models.ts');
const aiSecret = R.aiSecretOf('class-designer');
ok(aiSecret === 'CLASS_DESIGNER_AI_TOKEN', '비밀값 이름 = <접두어>AI_TOKEN', aiSecret);
ok(R.aiSecretOf('my-app') === 'MY_APP_AI_TOKEN', '하이픈 앱 이름 → 밑줄 접두어', R.aiSecretOf('my-app'));
ok(R.secretNameProblem('class-designer', aiSecret, ALL) === null, 'AI_TOKEN 은 비밀값 이름 검사를 통과 (셀프서비스 발급 가능)');
ok(R.secretNameProblem('zz-a', R.aiSecretOf('zz-a-b'), ALL) !== null, '다른 앱의 AI_TOKEN 이름은 거부');
ok(R.aiState(true, true) === 'active' && R.aiState(false, false) === 'none' && R.aiState(true, false) === 'mismatch' && R.aiState(false, true) === 'mismatch', 'AI 상태: 활성(둘 다) · 미발급(둘 다 없음) · 불일치(한쪽만)');
ok(A.aiState(true, true) === 'active' && A.aiState(false, false) === 'none' && A.aiState(true, false) === 'mismatch', 'hub-ai/models.ts 상태 판정 = hub-devtools/rules.ts');
ok(R.AI_DEFAULTS.defaultModel === 'gemini:gemini-2.5-flash' && R.AI_DEFAULTS.defaultAppHourly === 60 && R.AI_DEFAULTS.defaultAppDaily === 500
  && R.AI_DEFAULTS.defaultAppDailyTokens === 500000 && R.AI_DEFAULTS.globalDailyRequests === 3000 && R.AI_DEFAULTS.globalDailyTokens === 5000000,
  'AI_DEFAULTS 가 마이그레이션 기본값과 같음', JSON.stringify(R.AI_DEFAULTS));
ok(JSON.stringify(A.AI_DEFAULTS) === JSON.stringify(R.AI_DEFAULTS), 'hub-ai/models.ts AI_DEFAULTS = hub-devtools/rules.ts AI_DEFAULTS');
const mig = readFileSync(new URL('../supabase/migrations/20261115100000_hub_ai.sql', import.meta.url), 'utf8');
ok(["default 'gemini:gemini-2.5-flash'", 'default_app_hourly int not null default 60', 'default_app_daily int not null default 500',
  'default_app_daily_tokens int not null default 500000', 'global_daily_requests int not null default 3000', 'global_daily_tokens int not null default 5000000']
  .every((x) => mig.includes(x)), '마이그레이션 20261115100000 기본값 = AI_DEFAULTS');
ok(mig.includes('bmrai_') === false && mig.includes('ai_tokens') && mig.includes('ai_log') && mig.includes('ai_config'), '마이그레이션에 세 표가 있고 토큰 평문·접두어는 없음');
ok(R.AI_STARTER_MODELS.every((m) => R.parseAiModelSpec(m)?.spec === m), '시작 모델 목록은 모두 형식이 맞음', R.AI_STARTER_MODELS.join(','));
ok(JSON.stringify(A.STARTER_MODELS) === JSON.stringify(R.AI_STARTER_MODELS), 'hub-ai/models.ts 시작 모델 = hub-devtools/rules.ts');

const modelCases = [
  'gemini:gemini-2.5-flash', 'gemini-2.5-flash', 'openai:gpt-4o-mini', 'gpt-4o-mini', 'GPT-4O', 'o3-mini', 'o1-preview', 'chatgpt-4o-latest',
  'claude-3-5-haiku-latest', 'anthropic:claude-sonnet-4-5', 'grok-3', 'xai:grok-3-mini', 'gemini-2.5-pro',
  // 형식이 틀린 것
  '', '   ', 'gemini:', ':gemini-2.5-flash', 'unknown:gpt-4o', 'gemini:gem ini', 'gemini-2.5-flash ', 'mystery-model', 'a'.repeat(130), 'gemini:gemini-2.5/flash',
];
const one = (f, x) => JSON.stringify(f(x));
ok(modelCases.every((x) => one(R.parseAiModelSpec, x) === one(A.parseModelSpec, x)), '모델 해석: hub-ai/models.ts = hub-devtools/rules.ts (정상·오류 모두)',
  JSON.stringify(modelCases.filter((x) => one(R.parseAiModelSpec, x) !== one(A.parseModelSpec, x))));
ok(one(R.parseAiModelSpec, null) === one(A.parseModelSpec, null) && one(R.parseAiModelSpec, 5) === one(A.parseModelSpec, 5), '모델 해석: 글자가 아니면 null (두 파일 같음)');
const gp = R.parseAiModelSpec('gpt-4o-mini');
ok(gp?.provider === 'openai' && gp.model === 'gpt-4o-mini' && gp.spec === 'openai:gpt-4o-mini', '업체 생략: gpt-* → openai', JSON.stringify(gp));
ok(R.parseAiModelSpec('gemini:gemini-2.5-flash')?.provider === 'gemini' && R.parseAiModelSpec('claude-3-5-haiku-latest')?.provider === 'anthropic'
  && R.parseAiModelSpec('grok-3')?.provider === 'xai' && R.parseAiModelSpec('o3-mini')?.provider === 'openai', '업체 짐작: gemini-*/claude-*/grok-*/o3*');
ok(R.parseAiModelSpec('gemini:') === null && R.parseAiModelSpec(':gemini-2.5-flash') === null && R.parseAiModelSpec('unknown:gpt-4o') === null
  && R.parseAiModelSpec('mystery-model') === null && R.parseAiModelSpec('gemini:gem ini') === null, '업체 없음·모델 없음·모르는 업체·공백 → 거부');

const nl = R.normalizeAiModelList('gemini:gemini-2.5-flash\ngpt-4o-mini, gemini:gemini-2.5-flash  , bad model');
ok(nl.list.length === 2 && nl.list[0] === 'gemini:gemini-2.5-flash' && nl.list[1] === 'openai:gpt-4o-mini' && nl.bad.length === 1, '목록 정리: 중복·앞뒤 공백 정리, 틀린 값은 bad', JSON.stringify(nl));
ok(JSON.stringify(R.normalizeAiModelList('grok-3\n\nclaude-3-5-haiku-latest')) === JSON.stringify(A.normalizeModelList('grok-3\n\nclaude-3-5-haiku-latest')), '목록 정리: 두 파일 결과 같음');
ok(R.normalizeAiModelList(['gemini:gemini-2.5-flash,openai:gpt-4o']).list.length === 2, '목록 정리: 배열 안의 쉼표도 나눔');
ok(R.normalizeAiModelList(null).list.length === 0 && R.normalizeAiModelList('').list.length === 0, '빈 값 → 빈 목록');

ok(JSON.stringify(R.effectiveAiModels(null, ['gemini:gemini-2.5-flash'])) === JSON.stringify(['gemini:gemini-2.5-flash']), '앱 목록 없으면 학교 전체 목록');
ok(JSON.stringify(R.effectiveAiModels(['openai:gpt-4o'], ['gemini:gemini-2.5-flash'])) === JSON.stringify(['openai:gpt-4o']), '앱 목록이 있으면 그것만');
ok(JSON.stringify(R.effectiveAiModels([], ['gemini:gemini-2.5-flash'])) === JSON.stringify(['gemini:gemini-2.5-flash']), '빈 앱 목록은 학교 전체 따름');
ok(R.aiLimitOf(null, 60) === 60 && R.aiLimitOf(undefined, 500) === 500 && R.aiLimitOf(0, 500) === 0 && R.aiLimitOf(-1, 500) === 500 && R.aiLimitOf('30', 60) === 60, '한도: null·음수·글자는 기본값, 0 은 0(막음)');

const hubAi = readFileSync(new URL('../supabase/functions/hub-ai/index.ts', import.meta.url), 'utf8');
ok(hubAi.includes("'bmrai_'") === false && hubAi.includes('from \'./models.ts\'') && hubAi.includes('BMR_GEMINI_API_KEY') && hubAi.includes('BMR_OPENAI_API_KEY')
  && hubAi.includes('BMR_ANTHROPIC_API_KEY') && hubAi.includes('BMR_XAI_API_KEY'), 'hub-ai: 모델 규칙은 models.ts, 업체 키는 BMR_*_API_KEY 넷');
ok(hubAi.includes('bmr_admin.ai_log') && hubAi.includes('denied') && hubAi.includes("'denied'"), 'hub-ai: 호출 기록(ai_log)에 거부도 남김');
ok(hubAi.includes('MAX_CHARS') && hubAi.includes('MAX_TOKENS_CAP') && hubAi.includes('MAX_MESSAGES'), 'hub-ai: 글자·토큰·메시지 상한을 models.ts 에서 가져옴');
const devtoolsSrc = readFileSync(new URL('../supabase/functions/hub-devtools/index.ts', import.meta.url), 'utf8');
ok(devtoolsSrc.includes("'bmrai_' + ") && devtoolsSrc.includes('ai_status') && devtoolsSrc.includes('ai_token_issue') && devtoolsSrc.includes('ai_settings_update'), 'hub-devtools: AI 세 동작 + bmrai_ 토큰 발급');
const provSrc = readFileSync(new URL('../supabase/functions/hub-provision/index.ts', import.meta.url), 'utf8');ok(provSrc.includes("'ai'") && provSrc.includes("'bmrai_' + ") && provSrc.includes('ai_result'), 'hub-provision: 새 앱 승인 때 AI 토큰 자동 발급 단계');
ok(provSrc.indexOf("'mail', 'ai'") > 0, 'hub-provision: AI 단계는 메일 단계 바로 뒤', provSrc.slice(provSrc.indexOf('export const STEPS'), provSrc.indexOf('export const STEPS') + 200));
// hub-ai 도 다른 키 함수처럼 _key.ts 에서 열쇠를 가져온다 (저장소에는 없고, 배포 스크립트가 배포본에만 넣음)
const keyed = readFileSync(new URL('../supabase/functions/hub-ai/index.ts', import.meta.url), 'utf8');
ok(keyed.includes("from './_key.ts'"), 'hub-ai: _key.ts 모듈에서 열쇠를 가져옴');
ok(!/(?:const|let)\s+PROVISION_KEY\s*=\s*'[A-Za-z0-9+/=]{20,}'/.test(keyed), 'hub-ai: 저장소 코드에 진짜 열쇠가 없음');
const setupAi = readFileSync(new URL('./setup-ai.mjs', import.meta.url), 'utf8');
ok(setupAi.includes("export const PROVISION_KEY = '${key.toString('base64')}';") && setupAi.includes("'_key.ts'"), 'setup-ai.mjs: 배포할 때 _key.ts 에 열쇠를 넣음');
ok(setupAi.includes('MIGRATION_VERSION = \'20261115100000\'') && setupAi.includes('hub-ai'), 'setup-ai.mjs: AI 마이그레이션 확인 + hub-ai 배포');

console.log('[AI 요청 검사]');
const ask = (b) => A.normalizeAsk(b);
const askErr = (b) => { const r = ask(b); return r.ok ? null : r.status; };
const a1 = ask({ prompt: '안녕' });
ok(a1.ok && a1.ask.messages.length === 1 && a1.ask.messages[0].role === 'user' && a1.ask.messages[0].content === '안녕', 'prompt 만 → user 메시지 하나');
ok(a1.ok && a1.ask.max_tokens === A.AI_DEFAULT_TOKENS && a1.ask.temperature === null && a1.ask.mime === '', '기본값: max_tokens 1024 · temperature 없음 · mime 없음');
const a2 = ask({ messages: [{ role: 'user', content: ' 하이 ' }, { role: 'model', content: '네' }], prompt: '그럼?' });
ok(a2.ok && a2.ask.messages.length === 3 && a2.ask.messages[1].role === 'assistant' && a2.ask.messages[0].content === '하이' && a2.ask.messages[2].content === '그럼?', 'messages(role model→assistant, 앞뒤 공백 제거) + prompt 는 마지막 user');
ok(a2.ok && a2.ask.max_tokens === 1024, 'messages 경로도 기본 토큰 1024');
const a3 = ask({ prompt: '요약', system: ' 너는 도우미 ', temperature: 0.3, max_tokens: 500, response_mime_type: 'application/json' });
ok(a3.ok && a3.ask.system === '너는 도우미' && a3.ask.temperature === 0.3 && a3.ask.max_tokens === 500 && a3.ask.mime === 'application/json', 'system·temperature·max_tokens·mime 통과');
ok(askErr({}) === 400 && askErr({ prompt: '   ' }) === 400 && askErr({ system: 'x' }) === 400, 'prompt·messages 없음 → 400');
ok(askErr({ messages: [{ role: 'system', content: 'x' }] }) === 400, "role 'system' 은 messages 에 못 넣음 → 400");
ok(askErr({ messages: [{ role: 'user', content: '' }] }) === 400 && askErr({ messages: [{ role: 'user', content: 5 }] }) === 400, '빈 내용·글자가 아닌 content → 400');
ok(askErr({ messages: 'hi' }) === 400 && askErr({ messages: [null] }) === 400, 'messages 형식 오류 → 400');
ok(askErr({ messages: Array.from({ length: A.MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })) }) === 400, `메시지 ${A.MAX_MESSAGES}개 초과 → 400`);
ok(askErr({ prompt: 'x'.repeat(A.MAX_CHARS + 1) }) === 413, `글자 ${A.MAX_CHARS}자 초과 → 413`);
ok(askErr({ prompt: 'x', temperature: 3 }) === 400 && askErr({ prompt: 'x', temperature: -1 }) === 400 && askErr({ prompt: 'x', temperature: 'warm' }) === 400, 'temperature 0~2 밖 → 400');
ok(askErr({ prompt: 'x', max_tokens: 0 }) === 400 && askErr({ prompt: 'x', max_tokens: A.MAX_TOKENS_CAP + 1 }) === 400 && askErr({ prompt: 'x', max_tokens: 'many' }) === 400, `max_tokens 1~${A.MAX_TOKENS_CAP} 밖 → 400`);
ok(ask({ prompt: 'x', max_tokens: A.MAX_TOKENS_CAP }).ok, `max_tokens ${A.MAX_TOKENS_CAP} 까지 허용`);

console.log('[비밀값 가리기]');
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4eHh4eHh4eCJ9.c2lnbmF0dXJlc2lnbmF0dXJl';
const m = R.maskSecrets(`url postgresql://class_designer_fn.ref:Sup3rS3cret@host:5432/postgres auth Bearer ${'a'.repeat(30)} jwt ${jwt} key sbp_${'b'.repeat(30)} g AIza${'c'.repeat(30)} long ${'Z9'.repeat(30)}`);
ok(!m.includes('Sup3rS3cret') && !m.includes(jwt) && !m.includes('b'.repeat(30)) && !m.includes('c'.repeat(30)) && !m.includes('Z9'.repeat(30)) && !m.includes('a'.repeat(30)), '비밀번호·JWT·키·긴 토큰 가림', m);
ok(R.maskSecrets('booted (time: 47ms) GET /class-designer-fn/health 200 f00af562-86ab-4fa0-9dca-0fb8f76ac5b6') === 'booted (time: 47ms) GET /class-designer-fn/health 200 f00af562-86ab-4fa0-9dca-0fb8f76ac5b6', '보통 글·경로·UUID 는 그대로');

console.log('[학교 그룹·명부 (hub-directory)]');
const D = await import('../supabase/functions/hub-directory/rules.ts');
ok(D.GROUP_KINDS.join(',') === 'grade,class,club,staff,custom', '그룹 종류 다섯 가지', D.GROUP_KINDS.join(','));
ok(D.groupSlugProblem('grade-10') === null && D.groupSlugProblem('staff') === null, '주소 이름: 영문 소문자·하이픈 허용');
ok(D.groupSlugProblem('Grade') !== null && D.groupSlugProblem('10학년') !== null && D.groupSlugProblem('') !== null, '주소 이름: 대문자·한글·빈 값 거부');
ok(D.groupSlugProblem('hub') !== null && D.groupSlugProblem('admin') !== null, '주소 이름: 허브 화면과 겹치는 이름 거부');
ok(D.groupNameProblem('10학년') === null && D.groupNameProblem('정보동아리') === null, '이름: 한글 허용');
ok(D.groupNameProblem('') !== null && D.groupNameProblem('a'.repeat(61)) !== null && D.groupNameProblem('가<b>') !== null, '이름: 빈 값·60자 넘음·꺾쇠 거부');
ok(D.groupKindProblem('club') === null && D.groupKindProblem('') === null && D.groupKindProblem('x') !== null, '종류: 다섯 가지 또는 비움');
ok(D.groupDescProblem('') === null && D.groupDescProblem('고등부 10학년') === null && D.groupDescProblem('x'.repeat(301)) !== null, '설명: 300자까지');
ok(D.normalizeEmail(' Ab@Bmrschool.org ') === 'ab@bmrschool.org' && D.normalizeEmail('no-at') === null && D.normalizeEmail(5) === null, '메일 정리: 소문자·공백 제거, 형식 검사');
const emails = D.normalizeEmails('A@x.org, b@x.org\nb@x.org  a@x.org', 10);
ok(emails.list.length === 2 && emails.list[0] === 'a@x.org' && emails.list[1] === 'b@x.org', '메일 여러 개: 중복·공백 정리', JSON.stringify(emails.list));
const emailsBad = D.normalizeEmails(['ok@x.org', 'bad', 'also-bad']);
ok(emailsBad.list.length === 1 && emailsBad.bad.length === 2, '메일 여러 개: 틀린 것은 bad 에', JSON.stringify(emailsBad));
ok(D.normalizeEmails(Array.from({ length: 5 }, (_, i) => `s${i}@x.org`), 3).list.length === 3, '한 번에 넣는 메일 수 상한');
const rowsM = [
  { slug: 'grade-10', name: '10학년', kind: 'grade', role: 'member' },
  { slug: 'info-club', name: '정보동아리', kind: 'club', role: 'leader' },
];
const mem = D.membershipsOf(rowsM);
ok(mem.member_of.length === 2 && mem.leader_of[0] === 'info-club' && mem.roles['grade-10'] === 'member' && mem.roles['info-club'] === 'leader', '소속 정리: member_of · leader_of · roles', JSON.stringify(mem));
ok(D.membershipsOf([]).member_of.length === 0 && D.membershipsOf([{ slug: '', name: '', kind: '', role: '' }]).groups.length === 0, '빈 소속·빈 줄은 버림');
const askedM = D.checkAsked(['10학년', 'staff', '정보동아리'], rowsM);
ok(askedM[0].member && askedM[0].slug === 'grade-10' && askedM[1].member === false && askedM[1].slug === null && askedM[2].role === 'leader', '물어본 그룹: 이름으로도 찾고, 없는 그룹은 member=false', JSON.stringify(askedM));
ok(D.checkAsked(['10학년', '10학년'], rowsM).length === 1, '같은 질문은 한 번만');
ok(D.normalizeGroupList('10학년, staff\n10학년').join('|') === '10학년|staff', '물어볼 그룹 목록 정리', D.normalizeGroupList('10학년, staff\n10학년').join('|'));
ok(D.groupFolderOf('grade-10') === 'grade-10/' && D.FILES_BUCKET === 'bmr-files', '공용 파일: 버킷 이름·그룹 폴더', D.groupFolderOf('grade-10'));
const dirSrc = readFileSync(new URL('../supabase/functions/hub-directory/index.ts', import.meta.url), 'utf8');
ok(['list_groups', 'check', 'members', 'me', 'group_save', 'group_delete', 'member_add', 'member_remove'].every((a) => dirSrc.includes(`action === '${a}'`)), 'hub-directory: 여덟 동작');
ok(dirSrc.includes('bmr_admin.mail_tokens') && dirSrc.includes('bmr_admin.ai_tokens') && !dirSrc.includes('token_issue'), '앱 신분은 이미 있는 메일·AI 토큰 해시로 확인 (새 토큰 발급 없음)');
ok(dirSrc.includes("me.role !== 'admin'") && dirSrc.indexOf("me.role !== 'admin'") < dirSrc.indexOf("action === 'group_save'"), '그룹 고치기는 관리자만');
ok(!dirSrc.includes("from './_key.ts'") && dirSrc.includes('directory_attempts'), 'hub-directory: 열쇠를 풀지 않고(키 없는 함수) 호출 횟수를 남김');
ok(dirSrc.includes('MEMBER_LIST_MAX') && dirSrc.includes('directory:member_add'), '구성원 목록에 상한, 변경은 감사 기록에');
const dirMig = readFileSync(new URL('../supabase/migrations/20261115120000_hub_groups_files.sql', import.meta.url), 'utf8');
ok(/create table if not exists bmr_admin\.groups/.test(dirMig) && /create table if not exists bmr_admin\.group_members/.test(dirMig), '마이그레이션: groups · group_members 표');
ok(dirMig.includes("kind in ('grade', 'class', 'club', 'staff', 'custom')") && dirMig.includes("role in ('leader', 'member')"), '마이그레이션: 종류·역할 값이 rules.ts 와 같음');
ok(dirMig.includes("values ('bmr-files', 'bmr-files', false") && dirMig.includes('private.group_member') && dirMig.includes('private.group_leader'), '마이그레이션: 비공개 버킷 bmr-files + 소속 도우미');
ok(['읽기', '올리기', '바꾸기', '지우기'].every((k) => dirMig.includes(`create policy "bmr-files: `) && dirMig.includes(k)), '마이그레이션: 버킷 정책 네 가지(읽기·올리기·바꾸기·지우기)');
ok(/revoke all on bmr_admin\.groups from public, anon, authenticated/.test(dirMig) && /revoke all on bmr_admin\.group_members from public, anon, authenticated/.test(dirMig), '그룹 표는 브라우저에서 직접 읽지 못함 (함수를 거쳐야)');

console.log('[운영 현황 (ops_overview)]');
const O = await import('../supabase/functions/hub-devtools/ops.ts');
ok(O.OPS_PROBE_TIMEOUT_MS === 2500 && O.OPS_ERROR_ROWS === 20 && O.OPS_WINDOW_HOURS === 24, '2.5초 제한 · 오류 20건 · 24시간 창', `${O.OPS_PROBE_TIMEOUT_MS}/${O.OPS_ERROR_ROWS}/${O.OPS_WINDOW_HOURS}`);
ok(O.healthUrl('https://psupfmarnyxontorftio.supabase.co/', 'demo') === 'https://psupfmarnyxontorftio.supabase.co/functions/v1/demo-fn/health', '/health 주소 모양', O.healthUrl('https://x.supabase.co/', 'demo'));
ok(O.probeState(200, { db: true }) === 'ok' && O.probeState(200, {}) === 'ok' && O.probeState(204, {}) === 'ok', '정상: 2xx (db 를 안 알려 주는 함수도 정상)');
ok(O.probeState(200, { db: false }) === 'warn', '함수는 떴는데 DB 가 끊기면 warn');
ok(O.probeState(500, { db: true }) === 'down' && O.probeState(404, {}) === 'down' && O.probeState(null, null) === 'down', '5xx·4xx·무응답은 down');
const mailAgg = O.emptyMail();
O.addMailRow(mailAgg, 'sent', 3); O.addMailRow(mailAgg, 'error', 2); O.addMailRow(mailAgg, 'denied', 1); O.addMailRow(mailAgg, 'other', 9); O.addMailRow(mailAgg, 'sent', 'x');
ok(mailAgg.sent === 3 && mailAgg.error === 2 && mailAgg.denied === 1, '메일 집계: sent·error·denied 만 셈', JSON.stringify(mailAgg));
const aiAgg = O.emptyAi();
O.addAiRow(aiAgg, 'ok', 2, 150); O.addAiRow(aiAgg, 'error', 1, 40); O.addAiRow(aiAgg, 'denied', 3, 0); O.addAiRow(aiAgg, 'ok', 1, -5);
ok(aiAgg.ok === 3 && aiAgg.error === 1 && aiAgg.denied === 3 && aiAgg.tokens === 150, 'AI 집계: ok 만 토큰을 세고 음수는 0', JSON.stringify(aiAgg));
const opsT = O.opsTotals([
  { status: 'active', mail: { sent: 5, error: 1, denied: 0 }, ai: { ok: 2, error: 0, denied: 1, tokens: 100 } },
  { status: 'active', mail: { sent: 0, error: 0, denied: 0 }, ai: { ok: 0, error: 0, denied: 0, tokens: 0 } },
  { status: 'preparing', mail: { sent: 0, error: 0, denied: 0 }, ai: { ok: 0, error: 0, denied: 0, tokens: 0 } },
  { status: 'retired', mail: { sent: 0, error: 0, denied: 0 }, ai: { ok: 0, error: 0, denied: 0, tokens: 0 } },
], 4);
ok(opsT.apps_total === 4 && opsT.apps_active === 2 && opsT.apps_problem === 1, '요약: 전체·운영 중·준비/중지 앱 수 (종료는 문제로 안 셈)', JSON.stringify(opsT));
ok(opsT.mail_sent === 5 && opsT.mail_failed === 1 && opsT.ai_calls === 2 && opsT.ai_tokens === 100 && opsT.ai_failed === 1, '요약: 메일·AI 사용량');
ok(opsT.errors === 1 + 1 + 4, '요약: 오류 = 메일 실패·거부 + AI 실패·거부 + 감사 실패', String(opsT.errors));
const tidy = O.tidyError({ src: 'mail', at: new Date('2026-11-15T00:00:00Z'), slug: 'demo', status: 'error', detail: 'a\nb\u0001', extra: '제목' });
ok(tidy.at === '2026-11-15T00:00:00.000Z' && tidy.src === 'mail' && !/\n/.test(tidy.detail), '최근 오류 한 줄: 때·출처·내용 다듬기', JSON.stringify(tidy));
const dvSrc = readFileSync(new URL('../supabase/functions/hub-devtools/index.ts', import.meta.url), 'utf8');
ok(dvSrc.includes("action === 'ops_overview'") && !dvSrc.includes("error: '관리자만 운영 현황을 볼 수 있습니다.'"), 'hub-devtools: ops_overview 는 개발자도 부를 수 있음');
ok(dvSrc.includes('await opsOverview(u)'), 'ops_overview 는 부른 사람(u)을 넘겨 담당 앱으로 거름');
ok(dvSrc.includes('public.app_owners') && dvSrc.includes('lower(o.email) = ${u.email}'), 'ops_overview: 앱 담당자 명부(app_owners)로 담당 앱만');
ok(dvSrc.includes('${admin}::boolean or') && (dvSrc.match(/\$\{admin\}::boolean or/g) ?? []).length >= 6, 'ops_overview: 앱·메일·AI·감사·최근 오류 모두 담당 범위 조건을 붙임', String((dvSrc.match(/\$\{admin\}::boolean or/g) ?? []).length));
ok(dvSrc.includes('const key = opsCacheKey(u)') && dvSrc.includes('opsCache.get(key)') && dvSrc.includes('OPS_CACHE_MAX_KEYS'), '운영 현황 캐시는 사람마다 따로 (관리자·개발자 결과가 섞이지 않게)');
ok(dvSrc.indexOf("action === 'ops_overview'") < dvSrc.indexOf('const a = await appFor(u, Number(b.app_id))'), 'ops_overview 는 앱(app_id) 확인 전에 처리 (앱 하나에 매이지 않으므로)');
ok(dvSrc.includes('AbortSignal.timeout(OPS_PROBE_TIMEOUT_MS)') && dvSrc.includes('Promise.all'), '/health 는 2.5초 제한으로 병렬 확인');
ok(dvSrc.includes("from './ops.ts'"), 'hub-devtools: 계산은 ops.ts (시험이 같은 함수를 확인)');
ok(O.opsCacheKey({ admin: true, id: 'a' }) === O.opsCacheKey({ admin: true, id: 'b' }) && O.opsCacheKey({ admin: true, id: 'a' }) !== O.opsCacheKey({ admin: false, id: 'a' })
  && O.opsCacheKey({ admin: false, id: 'x' }) !== O.opsCacheKey({ admin: false, id: 'y' }) && O.opsCacheKey({ admin: false, id: 'x' }) === O.opsCacheKey({ admin: false, id: 'x' }), '캐시 열쇠: 관리자는 하나, 개발자는 사람마다', O.opsCacheKey({ admin: false, id: 'x' }));
ok(O.OPS_CACHE_MAX_KEYS >= 2 && O.OPS_CACHE_MAX_KEYS <= 1000, '캐시는 담아 둘 사람 수에 상한이 있음', String(O.OPS_CACHE_MAX_KEYS));

console.log('[권한 경계: 일반 사용자 차단 · 개발자는 담당 앱만]');
const S = await import('../src/scope.ts');
ok(S.sameEmail(' A@Bmrschool.org ', 'a@bmrschool.org') && !S.sameEmail('', '') && !S.sameEmail(null, 'a@b.org'), '메일 비교: 공백·대문자 무시, 빈 값은 같지 않음');
const OWN = [{ app_id: 1, email: 'me@bmrschool.org' }, { app_id: 2, email: 'other@bmrschool.org' }, { app_id: 3, email: null }];
const mineIds = S.ownedAppIds(OWN, ' ME@bmrschool.org ');
ok(mineIds.size === 1 && mineIds.has(1), '담당 앱 id: 내 메일이 담당자로 있는 앱만', JSON.stringify([...mineIds]));
ok(S.ownedAppIds(OWN, '').size === 0 && S.ownedAppIds(null, 'me@bmrschool.org').size === 0, '메일이 없거나 명부가 비면 담당 앱 없음');
const allApps = [{ id: 1 }, { id: 2 }, { id: 3 }];
ok(S.scopeToOwned(allApps, true, mineIds).length === 3 && S.scopeToOwned(allApps, false, mineIds).length === 1 && S.scopeToOwned(allApps, false, mineIds)[0].id === 1, '관리자는 전체, 개발자는 담당 앱만');
ok(S.scopeToOwned(null, true, mineIds).length === 0 && S.scopeToOwned(undefined, false, mineIds).length === 0, '목록이 없으면 빈 목록');
const appSrc = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
ok(/const inHub = !!ctx\.session && ctx\.isStaff &&/.test(appSrc), '허브 틀(사이드바·헤더 허브)은 개발자 승인 뒤에만');
ok(appSrc.includes('<StaffOnly ctx={ctx}><AppsPage ctx={ctx} /></StaffOnly>') && appSrc.includes('<StaffOnly ctx={ctx}><StatusPage ctx={ctx} /></StaffOnly>')
  && appSrc.includes('<StaffOnly ctx={ctx}><MonitorPage ctx={ctx} /></StaffOnly>') && appSrc.includes('<StaffOnly ctx={ctx}><RequestsPage ctx={ctx} /></StaffOnly>'), '허브 화면은 StaffOnly 로 감쌈 (대시보드·운영 상태·운영 현황·앱 신청)');
ok(appSrc.includes('<AdminRoute ctx={ctx}><GroupsPage ctx={ctx} /></AdminRoute>') && appSrc.includes('<AdminRoute ctx={ctx}><MembersPage ctx={ctx} /></AdminRoute>')
  && appSrc.includes('<AdminRoute ctx={ctx}><AuditPage ctx={ctx} /></AdminRoute>'), '관리자 화면(그룹·명부·사용자 관리·감사 기록)은 AdminRoute');
ok(appSrc.includes('if (ctx.isStaff) tabs.forEach'), '명령 팔레트의 허브 탭은 개발자 승인 뒤에만');
ok(appSrc.includes('관리 허브 접근 권한이 없습니다') && appSrc.includes('개발자 승인 후 이용할 수 있어요') && appSrc.includes('<Link to="/" className="btn">메인으로</Link>'), '일반 사용자 안내 카드: 잠금 안내 + 메인으로');
ok(appSrc.includes('ctx.isStaff ? <Link to="/hub/apps">관리 허브</Link>'), '헤더·푸터의 관리 허브 링크는 개발자에게만');
ok((appSrc.match(/useCounts\(!!session && isStaff, isAdmin, me\?\.email/g) ?? []).length === 1 && appSrc.includes('scopeToOwned((a.data ?? []) as Counts'), '요약 숫자도 개발자는 담당 앱만 셈');
const staSrc = readFileSync(new URL('../src/pages/Status.tsx', import.meta.url), 'utf8');
ok(staSrc.includes('ownedAppIds') && staSrc.includes('scopeToOwned') && staSrc.includes("sb.from('app_owners')"), '/hub/status: 개발자에게는 담당 앱 점검 결과만');
const monSrc = readFileSync(new URL('../src/pages/Monitor.tsx', import.meta.url), 'utf8');
ok(!/if \(!ctx\.isAdmin\) return/.test(monSrc) && monSrc.includes('담당 중인 서비스의 최근 24시간'), '/hub/monitor: 개발자도 열리며 담당 서비스만이라고 알림');
const appsSrc = readFileSync(new URL('../src/pages/Apps.tsx', import.meta.url), 'utf8');
ok(appsSrc.includes('(ctx.isAdmin || mineIds.has(a.id)) && <HealthDot'), '대시보드 점검 배지도 개발자는 담당 앱만');
const guideSrc = readFileSync(new URL('../src/pages/Guide.tsx', import.meta.url), 'utf8');
ok(!guideSrc.includes("'관리 허브로'"), '가이드: 일반 사용자에게 관리 허브로 보내지 않음');

console.log('[허브 배포 스크립트 (deploy-hub.mjs)]');
const H = await import('./deploy-hub.mjs');
const a0 = H.parseArgs([]);
ok(a0.only === null && a0.migrate === false && a0.dryRun === false && a0.verify === true && a0.help === false, '인자 없음: 모두 배포 · 마이그레이션 안 함 · 확인 함');
ok(JSON.stringify(H.parseArgs(['--only', 'hub-devtools, hub-directory']).only) === '["hub-devtools","hub-directory"]', '--only 는 쉼표로 여러 개 (공백 무시)');
ok(JSON.stringify(H.parseArgs(['--only=hub-mail']).only) === '["hub-mail"]', '--only=이름 형태도 됨');
ok(H.parseArgs(['--migrate', '--dry-run', '--no-verify']).migrate === true && H.parseArgs(['--dry-run']).dryRun === true && H.parseArgs(['--no-verify']).verify === false, '--migrate · --dry-run · --no-verify');
let argThrew = false; try { H.parseArgs(['--only']); } catch { argThrew = true; } ok(argThrew, '--only 뒤에 이름이 없으면 거절');
argThrew = false; try { H.parseArgs(['--wat']); } catch { argThrew = true; } ok(argThrew, '모르는 옵션 거절');
argThrew = false; try { H.parseArgs(['hub-mail']); } catch { argThrew = true; } ok(argThrew, '함수 이름을 그냥 주면 --only 를 쓰라고 거절');
const hubFns = H.discoverFunctions();
ok(hubFns.length >= 12 && hubFns.some((f) => f.name === 'hub-directory'), 'supabase/functions 아래 허브 함수를 찾음', `${hubFns.length}개`);
ok(JSON.stringify(hubFns.filter((f) => f.keyed).map((f) => f.name).sort()) === JSON.stringify([...H.KEYED].sort()), '열쇠를 쓰는 함수 목록 = KEYED', hubFns.filter((f) => f.keyed).map((f) => f.name).join(','));
ok(hubFns.find((f) => f.name === 'hub-directory').keyed === false, 'hub-directory 는 열쇠 없이 배포되는 함수');
ok(hubFns.every((f) => f.files.includes('index.ts') && !f.files.includes('_key.ts') && !f.files.includes('_key.ts.example')), '배포 파일에 _key.ts 를 넣지 않음 (열쇠는 배포본에만 따로)');
const hubDeploySrc = readFileSync(new URL('./deploy-hub.mjs', import.meta.url), 'utf8');
ok(!/writeFileSync\s*\(/.test(hubDeploySrc) && !hubDeploySrc.includes('randomBytes'), '스크립트는 열쇠 파일을 쓰지 않는다 (새 열쇠를 만들지 않음)');
ok(hubDeploySrc.includes('mkdirSync') === false && hubDeploySrc.includes('setup-provision.mjs'), '열쇠가 없으면 멈추고 setup-provision.mjs 로 안내');
ok(hubDeploySrc.includes('await recordDeploy(fn.name, fn.dir)') && !hubDeploySrc.includes('insert into public.audit_log'), '배포 기록은 deploy-record.mjs 에 맡김 (감사 기록 hub:deploy)');
ok(hubDeploySrc.includes('pendingMigrations') && hubDeploySrc.includes('migrate.mjs'), '--migrate 는 scripts/migrate.mjs 로 미적용 파일만 적용');
const wf = readFileSync(new URL('../.github/workflows/functions-check.yml', import.meta.url), 'utf8');
ok(H.KEYED.every((k) => wf.includes(k)), 'CI 검사 워크플로의 _key.ts 채우기 목록과 같은 함수들');

console.log('[새 앱 시작 틀 (lib/hub.ts)]');
const T = await import('../supabase/functions/hub-provision/templates.ts');
ok(Object.keys(T.REPO_FILES).includes('supabase/functions/{{FN}}/lib/hub.ts'), '시작 틀에 supabase/functions/<함수>/lib/hub.ts 가 들어감');
const libSrc = T.REPO_FILES['supabase/functions/{{FN}}/lib/hub.ts'] ?? '';
ok(['sendHubMail', 'askHubAi', 'checkHubGroups', 'hubGroupMembers', 'checkHubAuth', 'healthJson'].every((f) => new RegExp(`export (async )?function ${f}`).test(libSrc) || libSrc.includes(`export const ${f}`)), '도우미 여섯 가지 (메일·AI·그룹·그룹 구성원·로그인 확인·/health)');
ok(libSrc.includes("secret('MAIL_TOKEN')") && libSrc.includes("secret('AI_TOKEN')") && libSrc.includes("secret('MAIL_TOKEN') || secret('AI_TOKEN')"), '토큰은 <PREFIX>MAIL_TOKEN · <PREFIX>AI_TOKEN 에서만');
ok(libSrc.includes('mail_ready') && libSrc.includes('ai_hub') && libSrc.includes('app: SLUG'), '/health 표준 모양에 mail_ready · ai_hub');
ok(!/bmr_|sb_secret_|SERVICE_ROLE/.test(libSrc), '시작 틀 도우미에 허브 전용 비밀값 이름이 없음');
ok(T.MAIL_SOURCE.includes('export { sendHubMail as sendMail'), 'mail.ts 는 lib/hub.ts 를 다시 내보냄 (예전 이름 sendMail 유지)');
ok(T.FN_SOURCE.includes("from './lib/hub.ts'") && T.FN_SOURCE.includes('healthJson(true)') && T.FN_SOURCE.includes('checkHubAuth(req)'), '시작 함수가 lib/hub.ts 를 씀 (로그인 확인·/health)');
ok(T.REPO_FILES['README.md'].includes('bmr-files') && T.REPO_FILES['README.md'].includes('lib/hub.ts') && T.REPO_FILES['README.md'].includes('checkHubGroups'), 'README 에 그룹 공용 파일 · 허브 도우미 안내');
ok(T.REPO_FILES['README.md'].includes('{{PREFIX}}MAIL_TOKEN'), 'README 도 {{PREFIX}} 같은 자리표시자를 그대로 씀 (앱마다 채워짐)');
const provRenderSrc = readFileSync(new URL('../supabase/functions/hub-provision/index.ts', import.meta.url), 'utf8');
ok(provRenderSrc.includes('files[render(p, rv)] = render(t, rv)'), 'hub-provision: 파일 경로도 {{FN}} 을 채운다 (lib/hub.ts 가 제자리에 올라감)');

console.log(`\n결과: ${pass} 통과, ${fail} 실패`); process.exit(fail ? 1 : 0);
