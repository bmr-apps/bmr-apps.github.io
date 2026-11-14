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

console.log(`\n결과: ${pass} 통과, ${fail} 실패`); process.exit(fail ? 1 : 0);
