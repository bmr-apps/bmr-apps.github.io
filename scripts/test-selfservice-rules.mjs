#!/usr/bin/env node
// 개발자 셀프서비스 규칙 시험 (네트워크 없음): 비밀값 이름 접두어 · 다른 앱 이름 공간 · 추가 함수 이름 · 로그 SQL · 비밀값 가리기.
// 사용: node scripts/test-selfservice-rules.mjs
import { readFileSync, existsSync } from 'node:fs';
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
ok(/action === 'list_groups'[\s\S]{0,500}me\.role !== 'admin'/.test(dirSrc), 'list_groups: 사람은 관리자만 (앱 토큰은 me 가 없어 통과)');
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

console.log('[처음 함수 배포 (lib/hub.ts 함께)]');
const G = await import('../supabase/functions/hub-provision/deploy-files.ts');
const df = G.deployFiles('// index', { 'lib/hub.ts': '// lib', 'mail.ts': '// mail' });
ok(df.map(([p]) => p).join(',') === 'index.ts,lib/hub.ts,mail.ts', '배포 파일: index.ts + lib/hub.ts + mail.ts (index.ts 가 먼저)', JSON.stringify(df.map(([p]) => p)));
ok(df[0][1] === '// index' && df[1][1] === '// lib' && df[2][1] === '// mail', '배포 파일 내용이 그대로 들어감');
ok(G.deployFiles('// index').map(([p]) => p).join(',') === 'index.ts', '함께 넣을 파일이 없으면 index.ts 하나');
let dfThrew = false; try { G.deployFiles('x', { '../evil.ts': 'x' }); } catch { dfThrew = true; } ok(dfThrew, '배포 파일 이름에 .. → 거부');
dfThrew = false; try { G.deployFiles('x', { 'index.ts': 'y' }); } catch { dfThrew = true; } ok(dfThrew, 'index.ts 를 또 넣으면 → 거부');
const guardSrc = readFileSync(new URL('../supabase/functions/hub-provision/guard.ts', import.meta.url), 'utf8');
const deployBody = guardSrc.slice(guardSrc.indexOf('async deployFn('), guardSrc.indexOf('async exposedSchemas('));
ok(deployBody.includes('deployFiles(source, extra)') && /for \(const \[rel, text\] of files\)/.test(deployBody), 'deployFn 은 deployFiles 목록(index.ts·lib/hub.ts·mail.ts)을 모두 FormData 에 넣는다', deployBody.replace(/\s+/g, ' ').slice(0, 200));
ok(guardSrc.includes("from './deploy-files.ts'"), 'guard.ts 는 deploy-files.ts 의 목록을 씀');
const fnStep = provRenderSrc.slice(provRenderSrc.indexOf("case 'function':"), provRenderSrc.indexOf("case 'repo':"));
ok(fnStep.includes("'lib/hub.ts': render(REPO_FILES['supabase/functions/{{FN}}/lib/hub.ts'], rv)") && fnStep.includes("'mail.ts': render(MAIL_SOURCE, rv)"), 'hub-provision function 단계: lib/hub.ts · mail.ts 를 함께 배포 (400 Module not found 방지)', fnStep.replace(/\s+/g, ' ').slice(0, 240));
ok(T.FN_SOURCE.includes("from './lib/hub.ts'") && fnStep.includes("'lib/hub.ts'"), '시작 함수가 가져오는 lib/hub.ts 를 배포 목록에 넣음');

console.log('[BMR 도우미 (hub-assistant)]');
const AS = await import('../supabase/functions/hub-assistant/rules.ts');
ok(AS.roleOf('admin') === 'admin' && AS.roleOf('staff') === 'staff' && AS.roleOf('pending') === 'user' && AS.roleOf('') === 'guest'
  && AS.roleOf('disabled') === 'guest' && AS.roleOf(null) === 'guest' && AS.roleOf('ADMIN') === 'admin', '역할: profiles.role → 손님·일반 사용자·개발자·관리자 (모르는 값은 손님)');
ok(AS.canSeeInternalApps('staff') && AS.canSeeInternalApps('admin') && !AS.canSeeInternalApps('user') && !AS.canSeeInternalApps('guest'), '경계: 준비 중 앱·담당 앱은 개발자·관리자만');
ok(AS.canSeeStats('admin') && !AS.canSeeStats('staff') && AS.canSeeDevGuide('staff') && !AS.canSeeDevGuide('user'), '경계: 운영 집계는 관리자만, 개발 가이드는 개발자부터');
ok(AS.hourLimitOf('guest') < AS.hourLimitOf('user') && AS.hourLimitOf('user') < AS.hourLimitOf('staff') && AS.hourLimitOf('staff') < AS.hourLimitOf('admin'), '한도: 손님 < 일반 < 개발자 < 관리자', [AS.hourLimitOf('guest'), AS.hourLimitOf('user'), AS.hourLimitOf('admin')].join('/'));
const askOne = AS.checkAsk({ messages: [{ role: 'user', content: ' 안녕 ' }] });
ok(askOne.ok && askOne.messages.length === 1 && askOne.messages[0].content === '안녕', '질문 한 개: 앞뒤 공백을 지우고 통과');
const askBad = (b) => { const r = AS.checkAsk(b); return r.ok ? null : r.status; };
ok(askBad({}) === 400 && askBad({ messages: [] }) === 400 && askBad({ messages: 'hi' }) === 400, '질문이 없거나 형식이 틀리면 400');
ok(askBad({ messages: [{ role: 'system', content: 'x' }] }) === 400 && askBad({ messages: [{ role: 'user', content: '   ' }] }) === 400 && askBad({ messages: [{ role: 'user', content: 5 }] }) === 400, 'role system·빈 내용·글자 아님 → 400');
ok(askBad({ messages: [{ role: 'assistant', content: '네' }] }) === 400, '마지막이 내 질문이 아니면 400');
ok(askBackLength(AS) && askBackLength(AS) === 413, `한 메시지 ${AS.ASK.maxCharsPerMessage}자·전체 ${AS.ASK.maxChars}자를 넘기면 413`);
ok(askBad({ messages: Array.from({ length: AS.ASK.maxMessages + 1 }, () => ({ role: 'user', content: 'x' })) }) === 400, `메시지 ${AS.ASK.maxMessages}개를 넘기면 400`);
function askBackLength(A) {
  const long1 = A.checkAsk({ messages: [{ role: 'user', content: 'x'.repeat(A.ASK.maxCharsPerMessage + 1) }] });
  const longAll = A.checkAsk({ messages: Array.from({ length: 8 }, () => ({ role: 'user', content: 'x'.repeat(1500) })) });
  return long1.ok ? 0 : long1.status === longAll.status ? 413 : 0;
}
const guestP = AS.buildSystemPrompt({
  role: 'guest',
  apps: [{ slug: 'library', name: '도서실', status: 'active', url: 'https://apps.bmrschool.net/library', description: '책 대출' }],
  myApps: [{ slug: 'mine', name: '내 앱', status: 'active', url: 'https://apps.bmrschool.net/mine', description: '' }],
  groups: ['10학년'], stats: { apps_active: 3, members_admin: 1 },
});
ok(guestP.includes('BMR APPS') && guestP.includes('- 도서실 (/library, 운영 중) — 책 대출'), '손님 프롬프트: 공개 안내와 운영 중인 앱');
ok(!guestP.includes('자료 3-1') && !guestP.includes('내 앱'), '손님 프롬프트에는 담당 앱 칸이 없다 (넘겨도 넣지 않음)');
ok(!guestP.includes('자료 4') && !guestP.includes('운영 중 앱: 3'), '손님 프롬프트에는 운영 집계가 없다 (넘겨도 넣지 않음)');
ok(guestP.includes('손님에게는 공개 정보') && guestP.includes('시스템 프롬프트'), '손님 역할 안내 + 내부 규칙을 묻는 요청은 거절하라고 적음');
const staffP = AS.buildSystemPrompt({
  role: 'staff', apps: [], myApps: [{ slug: 'my-app', name: '내 앱', status: 'active', url: 'https://apps.bmrschool.net/my-app', description: '설명' }],
  groups: [], stats: { apps_active: 3 },
});
ok(staffP.includes('자료 3-1') && staffP.includes('내 앱') && staffP.includes('https://apps.bmrschool.net/my-app'), '개발자 프롬프트: 내 담당 앱과 주소');
ok(!staffP.includes('자료 4') && !staffP.includes('운영 중 앱: 3'), '개발자 프롬프트: 운영 집계는 없다');
const adminP = AS.buildSystemPrompt({ role: 'admin', apps: [], myApps: [], groups: ['교직원'], stats: { apps_active: 3, members_staff: 2, ai_calls_24h: 10 } });
ok(adminP.includes('자료 4') && adminP.includes('운영 중 앱: 3') && adminP.includes('개발자: 2') && adminP.includes('[자료 2] 지금 묻는 사람의 소속 그룹: 교직원'), '관리자 프롬프트: 집계와 소속');
ok(adminP.includes('개별 회원의 메일 주소나 비밀값을 넣지 않는다'), '관리자 프롬프트: 사람별 정보는 답에 넣지 말라고 적음');
ok(AS.buildSystemPrompt({ role: 'guest', apps: [], myApps: [], groups: [], stats: {} }).includes('- (아직 없음)'), '앱이 없으면 그렇게 적는다');
ok(AS.appLine({ slug: 'library', name: '도서실', status: 'active', url: '', description: '  책  ' }) === '- 도서실 (/library, 운영 중) — 책', '앱 한 줄 모양', AS.appLine({ slug: 'library', name: '도서실', status: 'active', url: '', description: '  책  ' }));
ok(AS.appLine({ slug: 'x', name: '이름', status: 'retired', url: '', description: '' }) === '- 이름 (/x, 종료)', '상태 이름 바꿔 쓰기');
ok(AS.statsLines({ apps_active: 3, unknown: 9 }).join('|') === '- 운영 중 앱: 3', '집계 줄은 아는 항목만');
ok(Object.keys(AS.STAT_LABEL).includes('chat_messages_24h') && Object.keys(AS.STAT_LABEL).includes('health_down'), '집계 항목 이름표에 점검·쪽지 포함');
const fixed = new Uint8Array(32).map((_, i) => i);
const nonce = AS.newNonce(fixed);
ok(AS.NONCE_RE.test(nonce) && nonce.length === 64 && nonce.startsWith('00010203'), '일회용 표: 무작위 32바이트 → 64자 hex', nonce.slice(0, 12));
ok(AS.newNonce() !== AS.newNonce() && AS.NONCE_RE.test(AS.newNonce()), '표는 매번 새로 만든다');
let nonceThrew = false; try { AS.newNonce(new Uint8Array(16)); } catch { nonceThrew = true; } ok(nonceThrew, '32바이트가 아니면 거부');
ok(AS.GRANT_HEADER === 'x-hub-assistant-grant' && AS.GRANT_TTL_SECONDS === 60, '헤더 이름·60초 유효', AS.GRANT_HEADER);
const aiS = readFileSync(new URL('../supabase/functions/hub-ai/index.ts', import.meta.url), 'utf8');
ok(aiS.includes(`const ASSIST_HEADER = '${AS.GRANT_HEADER}'`) && aiS.includes(`const ASSIST_TTL = ${AS.GRANT_TTL_SECONDS}`) && aiS.includes(`const NONCE_RE = ${AS.NONCE_RE.toString()}`), 'hub-ai 와 도우미가 같은 헤더·60초·64자 규칙을 쓴다');
ok((aiS.includes('takeAssistantGrant(assistGrant)') || aiS.includes('takeAssistantGrant(req.headers.get(ASSIST_HEADER)')) && aiS.includes('used_at is null') && aiS.includes('return rows.length === 1'), 'hub-ai: 표를 한 번만 쓰이게 표시하며 확인(동시에 두 번 못 씀)');
ok(/if \(!rawTok && !NONCE_RE\.test\(assistGrant\)\)/.test(aiS), 'hub-ai: 일회용 표가 있으면 Bearer 없이도 도우미 호출을 받는다 (표 없으면 401)');
ok(aiS.includes('app = null;') && aiS.includes("actor = { kind: 'user', email: 'hub-assistant'"), 'hub-ai: 도우미는 앱 하나에 매이지 않는다');
ok(aiS.includes('async function usage(appId: number | null)') && aiS.includes('usage(app?.id ?? null)'), 'hub-ai: 앱 없이 학교 전체 한도만 세도록 계산');
ok(aiS.includes("'hub-assistant'") && !aiS.includes("'bmrai_'"), 'hub-ai: 기록에 hub-assistant 로 남기고, 토큰 접두어 평문은 여전히 없다');
const aS = readFileSync(new URL('../supabase/functions/hub-assistant/index.ts', import.meta.url), 'utf8');
ok(aS.includes("from './rules.ts'") && !aS.includes("from './_key.ts'"), 'hub-assistant: 열쇠(_key.ts)를 쓰지 않는다 (배포가 가볍고 CI 목록도 그대로)');
ok(aS.includes('assistant_attempts') && aS.includes('RATE.dayAll') && aS.includes('RATE.ipHour'), 'hub-assistant: 호출 횟수를 남기고 사람·IP·전체 한도를 지킨다');
ok(aS.includes('assistant_grants') && aS.includes('[GRANT_HEADER]: grant'), 'hub-assistant: 일회용 표를 넣고 헤더로 보낸다');
ok(aS.includes('roleOf(me?.role)') && aS.includes("me?.role === 'disabled'"), 'hub-assistant: 역할은 profiles 에서 읽고 사용 중지 계정은 거절');
ok(aS.includes("status = 'active'") && aS.includes('canSeeInternalApps'), 'hub-assistant: 손님·일반 사용자에게는 운영 중인 앱만 모은다');
ok(aS.includes("role === 'admin'") && aS.includes("status in ('active', 'preparing', 'paused')"), 'hub-assistant: 준비·중지 앱 전체 목록은 관리자만 (개발자는 담당 앱으로만)');
ok(aS.includes('buildSystemPrompt') && aS.includes('functions/v1/hub-ai'), 'hub-assistant: 프롬프트를 만들어 hub-ai 로 넘긴다');
ok(!/BMR_(GEMINI|OPENAI|ANTHROPIC|XAI)_API_KEY/.test(aS) && !aS.includes('crypto.subtle.decrypt'), 'hub-assistant: 업체 키를 풀지 않는다 (키는 hub-ai 만)');
ok(aS.includes('질문·답 본문은 남기지 않는다') || aS.includes('남기지 않는 것'), 'hub-assistant: 질문·답 본문을 남기지 않는다고 적혀 있음');
const aMig = readFileSync(new URL('../supabase/migrations/20261115220000_hub_assistant.sql', import.meta.url), 'utf8');
ok(aMig.includes('bmr_admin.assistant_attempts') && aMig.includes("kind in ('user', 'ip')") && aMig.includes('revoke all'), '도우미 마이그레이션: 호출 기록 표 + 브라우저 권한 회수');
ok(aMig.includes('bmr_admin.assistant_grants') && aMig.includes("nonce ~ '^[0-9a-f]{64}$'") && aMig.includes('used_at'), '도우미 마이그레이션: 일회용 표(64자 hex·한 번)');
ok(aMig.includes("role in ('guest', 'user', 'staff', 'admin')"), '도우미 마이그레이션: 역할 값이 rules.ts 와 같음');
ok(!H.KEYED.includes('hub-assistant') && hubFns.some((f) => f.name === 'hub-assistant' && !f.keyed), '배포: hub-assistant 는 열쇠 없이 배포되는 함수 (KEYED 목록 그대로)');
ok(!wf.includes('hub-assistant'), 'CI 검사 워크플로는 손대지 않아도 된다 (열쇠 자리 채우기 목록 그대로)');

console.log('[회원 쪽지 (1:1)]');
const cMig = readFileSync(new URL('../supabase/migrations/20261115230000_member_chat.sql', import.meta.url), 'utf8');
ok(['public.chat_threads', 'public.chat_messages', 'public.chat_reads'].every((t) => cMig.includes(`create table if not exists ${t}`)), '쪽지 마이그레이션: 대화·메시지·읽음 세 표');
ok(cMig.includes('check (user_lo < user_hi)') && cMig.includes('chat_threads_pair_uniq'), '두 사람을 정렬해 한 쌍에 대화 하나 (중복 대화 없음)');
ok(cMig.includes('alter table public.chat_threads enable row level security') && cMig.includes('alter table public.chat_messages enable row level security')
  && cMig.includes('alter table public.chat_reads enable row level security'), '세 표 모두 RLS 켬');
ok(['chat_threads_select', 'chat_messages_select', 'chat_messages_insert', 'chat_reads_select', 'chat_reads_insert', 'chat_reads_update'].every((p) => cMig.includes(`policy ${p}`)), '표마다 정책 (읽기·쓰기)');
ok(cMig.includes('private.chat_member') && cMig.includes('create policy chat_messages_insert') && cMig.includes('sender = (select auth.uid())'), '참여자만 읽고, 보낸 사람은 자기 자신으로만 넣는다');
ok(cMig.includes("raise exception '이 대화를 볼 수 없습니다.'"), '읽음 표시도 참여자만');
ok(['chat_start', 'chat_inbox()', 'chat_people()', 'chat_mark_read'].every((f) => cMig.includes(f)), '화면이 부르는 함수 네 가지');
ok(cMig.includes('grant execute on function public.chat_start(uuid), public.chat_inbox(), public.chat_people(), public.chat_mark_read(bigint, bigint) to authenticated')
  && cMig.includes('from public, anon'), '함수는 로그인한 사람에게만 (anon 은 실행 불가)');
ok(cMig.includes("p.role <> 'disabled'") && cMig.includes("split_part(coalesce(p.email, ''), '@', 1)") && !cMig.includes('p.email as'), '상대 목록: 사용 중지 회원 제외, 메일 전체는 돌려주지 않음');
ok(cMig.includes('supabase_realtime') && cMig.includes('chat_messages_after_insert'), '실시간 발행 + 메시지 트리거(대화 시각·읽음 갱신)');
ok(cMig.includes('greatest(r.last_read_id, excluded.last_read_id)') && (cMig.match(/greatest\(r\.last_read_id/g) ?? []).length === 2, '읽음 번호는 뒤로 가지 않는다 (greatest, 트리거·함수 둘 다)');
ok(cMig.includes("notify pgrst, 'reload schema'"), '마이그레이션 뒤 PostgREST 스키마를 새로 읽게 한다');
const sbS = readFileSync(new URL('../src/sb.ts', import.meta.url), 'utf8');
ok(['chatThreads', 'chatPeople', 'chatStart', 'chatSend', 'chatMarkRead', 'chatMessages', 'askAssistant'].every((f) => sbS.includes(`export async function ${f}`)), '화면 호출 함수: 쪽지 일곱 가지·도우미');
ok(sbS.includes('functions/v1/hub-assistant') && sbS.includes('session ? { Authorization'), '도우미 호출: 로그인했으면 토큰을 붙여 역할을 서버가 가른다');
const chatUi = readFileSync(new URL('../src/pages/Chat.tsx', import.meta.url), 'utf8');
ok(chatUi.includes("sb.channel('bmr-chat')") && chatUi.includes("'postgres_changes'") && chatUi.includes('removeChannel'), '쪽지 화면: 실시간 구독과 정리');
ok(chatUi.includes('chatMarkRead') && chatUi.includes('unread'), '쪽지 화면: 안 읽은 수 표시·읽음 처리');
ok(chatUi.includes('PeoplePicker') && chatUi.includes('ROLE_LABEL'), '쪽지 화면: 회원 고르기(이름·역할 배지)');
ok(chatUi.includes('2000') && chatUi.includes('maxLength={2000}'), '쪽지 화면: 2,000자 상한을 화면에서도 지킴');
const appS2 = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
ok(appS2.includes("path === '/hub/chat'" ) && appS2.includes("to: '/hub/chat'") && appS2.includes('useChatUnread'), '허브: /hub/chat 갈래·사이드바·안 읽은 배지');
ok(appS2.indexOf("path === '/hub/chat'") < appS2.indexOf('<StaffOnly ctx={ctx}><AppsPage'), '쪽지는 개발자 승인 전 일반 사용자도 연다 (StaffOnly 앞)');
ok(appS2.includes('<Assistant session={ctx.session}') && appS2.includes('openAssistant'), '허브: 어디서나 도우미를 열 수 있다');
const asUi = readFileSync(new URL('../src/Assistant.tsx', import.meta.url), 'utf8');
ok(asUi.includes('askAssistant') && asUi.includes('개인정보') && asUi.includes('개인정보·비밀번호는 넣지 마세요'), '도우미 화면: hub-assistant 호출 + 개인정보 주의 문구');
ok(asUi.includes('roleLabel') && asUi.includes('권한으로 안내합니다'), '도우미 화면: 어느 역할로 답하는지 보여 준다');

console.log('[파비콘]');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
ok(html.includes('rel="icon" href="/favicon.svg" type="image/svg+xml"') && html.includes('rel="apple-touch-icon"') && !html.includes('href="data:,"'), 'index.html: SVG 파비콘 + PNG 대체본을 연결 (빈 파비콘 제거)');
const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
ok(svg.includes('viewBox="0 0 32 32"') && svg.includes('#0abbee') && svg.includes('#ffdc1a') && svg.includes('stroke="#000" stroke-width="2"'), '파비콘 SVG: 32 격자 · 시안 · 노랑 · 2px 검은 테두리');
ok((svg.match(/<rect/g) ?? []).length >= 8 && svg.includes('<title>BMR APPS</title>'), '파비콘 SVG: 각진 사각형으로 만든 B + 이름');
const pngSize = (p) => { const b = readFileSync(new URL(`../public/${p}`, import.meta.url)); return [b.readUInt32BE(16), b.readUInt32BE(20)].join('x'); };
ok(['favicon-32x32.png', 'favicon-192x192.png', 'apple-touch-icon.png'].every((f) => existsSync(new URL(`../public/${f}`, import.meta.url))), '파비콘 PNG 대체본 세 개가 있다');
ok(pngSize('favicon-32x32.png') === '32x32' && pngSize('apple-touch-icon.png') === '180x180' && pngSize('favicon-192x192.png') === '192x192', 'PNG 크기: 32 · 180 · 192', `${pngSize('favicon-32x32.png')} ${pngSize('apple-touch-icon.png')} ${pngSize('favicon-192x192.png')}`);

console.log('[알림 (웹 푸시·메일·배지)]');
const N = await import('../supabase/functions/hub-notify/rules.ts');
// 기본값·정리
ok(JSON.stringify(N.DEFAULT_PREFS) === JSON.stringify({ push_enabled: true, email_enabled: false, notify_chat: true, notify_admin: true }), '기본값: 푸시 켬 · 메일 끔 · 쪽지 켬 · 관리 알림 켬 (메일은 직접 켜야 온다)');
ok(JSON.stringify(N.normalizePrefs(null)) === JSON.stringify(N.DEFAULT_PREFS) && JSON.stringify(N.normalizePrefs('x')) === JSON.stringify(N.DEFAULT_PREFS), '설정 줄이 없거나 이상하면 기본값');
ok(N.normalizePrefs({ push_enabled: false, email_enabled: 'yes', extra: true }).push_enabled === false
  && N.normalizePrefs({ email_enabled: 'yes' }).email_enabled === false, '참·거짓이 아닌 값은 버리고 기본값 (문자열 "yes" 를 켬으로 읽지 않음)');
ok(N.normalizePrefs({ ...N.DEFAULT_PREFS, next: 1 }).notify_chat === true, '모르는 칸은 무시');
ok(N.prefsProblem({ push_enabled: true }) === null && N.prefsProblem({}) !== null && N.prefsProblem(null) !== null, '빈 설정·빈 몸통은 거부');
ok(N.prefsProblem({ nope: true }) !== null && N.prefsProblem({ push_enabled: 'on' }) !== null && N.prefsProblem([1]) !== null, '모르는 칸·문자열·배열은 거부');
ok(N.prefsProblem({ push_enabled: false, email_enabled: true }) === null, '여러 칸을 한 번에 바꾸는 것은 허용');
// 누구에게 무엇을 보내나
const P = (o) => ({ ...N.DEFAULT_PREFS, ...o });
ok(N.canPush(P({}), 'chat') && N.canPush(P({}), 'admin'), '기본값이면 쪽지·관리 알림 모두 푸시');
ok(!N.canPush(P({ notify_chat: false }), 'chat') && N.canPush(P({ notify_chat: false }), 'admin'), '쪽지 알림을 끄면 쪽지만 안 온다');
ok(!N.canPush(P({ push_enabled: false }), 'chat') && !N.canPush(P({ push_enabled: false }), 'admin'), '푸시를 끄면 둘 다 안 온다');
ok(!N.canPush(P({ notify_admin: false }), 'admin') && N.canPush(P({ notify_admin: false }), 'chat'), '관리 알림을 끄면 신청 소식만 안 온다');
ok(!N.canEmail(P({}), 'chat') && N.canEmail(P({ email_enabled: true }), 'chat'), '메일은 email_enabled 를 켜야만');
ok(!N.canEmail(P({ email_enabled: true, notify_chat: false }), 'chat'), '쪽지 알림을 껐으면 메일도 안 온다');
ok(N.canEmail(P({ email_enabled: true, push_enabled: false }), 'chat'), '푸시를 껐어도 메일을 켜 두면 메일로 받는다 (기기 푸시·메일은 따로 켜고 끈다)');
// 미리보기
ok(N.previewText('a\nb\n\nc') === 'a b c', '줄바꿈은 한 칸으로');
ok(N.previewText('   ') === '' && N.previewText(null) === '', '빈 본문');
ok(N.previewText('x'.repeat(200)).length === N.LIMITS.previewLen && N.previewText('x'.repeat(200)).endsWith('…'), `미리보기 ${N.LIMITS.previewLen}자에서 자름`);
ok([...N.previewText('가'.repeat(200))].length === N.LIMITS.previewLen, '한글도 글자 수로 센다');
const cp = N.chatPayload({ sender: '은길', body: '안녕하세요\n두 번째 줄', thread: 12 });
ok(cp.title === '💬 은길' && cp.body === '안녕하세요 두 번째 줄' && cp.url === '/hub/chat' && cp.tag === 'chat-12', '쪽지 알림: 보낸 사람 + 짧은 미리보기 + /hub/chat + 대화별 tag', JSON.stringify(cp));
ok(N.chatPayload({ sender: '', body: '', thread: 0 }).body === '새 쪽지가 도착했어요.', '빈 쪽지도 제목·본문이 비지 않는다');
const mb = N.mailBody({ sender: '은길', preview: '안녕', hubUrl: 'https://apps.bmrschool.net/' });
ok(mb.includes('https://apps.bmrschool.net/hub/chat') && mb.includes('알림 끄기') && !mb.includes('//hub/chat'), '메일 본문: 링크 + 끄는 방법 (주소 끝 슬래시 정리)');
ok(N.mailSubject({ sender: '은길' }).includes('은길') && N.mailSubject({ sender: '은길' }).startsWith('[BMR APPS]'), '메일 제목에 보낸 사람·서비스 이름');
// 쿨다운·배지
const now = new Date('2026-11-15T12:00:00Z');
ok(N.emailAllowed(null, now) && N.emailAllowed(undefined, now), '보낸 적 없으면 보낸다');
ok(!N.emailAllowed(new Date(now.getTime() - 9 * 60000), now) && N.emailAllowed(new Date(now.getTime() - 11 * 60000), now), `같은 대화 10분 쿨다운 (${N.LIMITS.emailCooldownMin}분)`);
ok(N.emailAllowed('이상한 값', now), '읽을 수 없는 시각은 막지 않는다 (알림이 조용히 사라지지 않게)');
ok(N.badgeTotal({ chats: 2, notifications: 3 }) === 5 && N.badgeTotal({}) === 0 && N.badgeTotal({ chats: -4, notifications: 1 }) === 1, '배지 = 안 읽은 쪽지 + 알림');
ok(N.badgeTotal({ chats: 5000, notifications: 5000 }) === 999 && N.badgeTotal({ chats: 1.9 }) === 1, '배지는 999 까지·소수 버림');
ok(N.badgeText(0) === 'BMR APPS' && N.badgeText(3) === '(3) BMR APPS' && N.badgeText(150) === '(99+) BMR APPS', '탭 제목: (N) BMR APPS · 99+');
// 기기·구독
ok(N.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Version/17 Safari/604') === '아이폰 사파리', '아이폰 사파리');
ok(N.deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120').startsWith('안드로이드'), '안드로이드');
ok(N.deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120') === '윈도우 PC' && N.deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)').startsWith('맥'), '데스크톱');
ok(N.deviceLabel('') === '브라우저' && N.deviceLabel(undefined) === '브라우저', '알 수 없으면 브라우저');
ok(N.endpointHost('https://web.push.apple.com/QGVsbG8') === 'Apple 푸시' && N.endpointHost('https://fcm.googleapis.com/fcm/send/x') === 'Google 푸시', '구독 서비스 이름 (주소 전체는 화면에 보이지 않게)');
ok(N.endpointHost('쓰레기') === '브라우저', '주소가 아니면 브라우저');
ok(N.subProblem('https://fcm.googleapis.com/fcm/send/abc123456', 'B'.repeat(87), 'A'.repeat(22)) === null, '정상 구독은 통과');
ok(N.subProblem('http://x/y', 'B'.repeat(87), 'A'.repeat(22)) !== null && N.subProblem('https://a', 'B'.repeat(87), 'A'.repeat(22)) !== null, 'http·짧은 주소는 거부');
ok(N.subProblem('https://fcm.googleapis.com/fcm/send/abc123456', 'short', 'A'.repeat(22)) !== null && N.subProblem('https://fcm.googleapis.com/fcm/send/abc123456', 'B'.repeat(87), 'x') !== null, '열쇠 길이가 다르면 거부');
// 함수 지키는 선
const nS = readFileSync(new URL('../supabase/functions/hub-notify/index.ts', import.meta.url), 'utf8');
ok(!nS.includes("from './_key.ts'") && hubFns.some((f) => f.name === 'hub-notify' && !f.keyed), '배포: hub-notify 는 열쇠 없이 배포된다 (CI 목록 그대로, 열쇠 자리 채우기 불필요)');
ok(!wf.includes('hub-notify'), 'CI 검사 워크플로는 손대지 않아도 된다 (deno check */index.ts 에 자동으로 들어간다)');
ok(nS.includes("if (u.id !== lo && u.id !== hi) throw new HttpError(403, '이 대화의 참여자가 아닙니다.')"), '쪽지 알림: 대화 참여자만 (아니면 403)');
ok(nS.includes('select id, sender, body from public.chat_messages where thread_id = ${threadId} order by id desc limit 1')
  && nS.includes("if (!m || String(m.sender) !== u.id) return json(req, 200, { ok: true, skipped: 'not_my_message' });"), '알림 내용은 DB 의 마지막 쪽지로, 그것도 내가 보낸 것일 때만');
ok(nS.includes("skipped: 'already_read'") && nS.includes('Number(rd.last_read_id) >= Number(m.id)'), '상대가 이미 읽은 쪽지는 알리지 않는다');
ok(nS.includes("if (!prefs.notify_chat) return json(req, 200, { ok: true, skipped: 'peer_off' });"), '상대가 꺼 두었으면 보내지 않는다');
ok(nS.includes("else if (push.sent > 0) email = 'skipped:push_sent';"), '메일은 푸시가 한 대도 닿지 않았을 때만');
ok(nS.includes("'chat:email'") && nS.includes('emailAllowed(await lastMailAt(peerId, String(threadId)), new Date())'), '메일 쿨다운·시간 한도를 서버가 센다');
ok(nS.includes('LIMITS.emailPerRecipientHour') && nS.includes('LIMITS.emailPerDay') && nS.includes('LIMITS.pushPerUserHour') && nS.includes('LIMITS.testPerHour'), '한도는 rules.ts 의 LIMITS 하나에서 온다');
ok(nS.includes('bmr_admin.notify_attempts') && nS.includes('bmr_admin.notify_grants') && nS.includes('bmr_admin.push_config'), '횟수·일회용 표·VAPID 열쇠 표를 쓴다');
ok(nS.includes("'x-bmr-notify-grant': nonce"), '메일은 hub-mail 에 일회용 표(헤더)로만 부탁한다');
ok(nS.includes("else if (await usedIn(who, 'event:email', 3600)") && nS.includes("lastMailAt(who, ref, 'event:email')"), '신청 결과도 푸시가 안 닿았을 때만 메일로 (같은 신청 10분 한 통)');
ok(nS.includes("return r.ok && j?.ok === true ? 'sent' : 'error';"), '메일 결과는 hub-mail 의 ok 값을 보고 센다 (한도 거절 200 을 보냄으로 세지 않음)');
ok(nS.includes('const payload = chatPayload({ sender') && N.LIMITS.previewLen === 80, '알림에 실리는 쪽지는 짧은 미리보기로 만든다 (chatPayload, 80자)');
ok((nS.match(/getVapid|vipid\(\)/g) ?? []).length >= 2 && nS.includes("namedCurve: 'P-256'") && nS.includes('bmr_admin.push_config'), 'VAPID 열쇠는 Web Crypto 로 만들어 서버 표에만 (공개키만 내보냄)');
ok(nS.includes("if (u.role !== 'admin') throw new HttpError(403, '관리자만 신청 결과를 알릴 수 있습니다.')"), '신청 결과 알림은 관리자만');
ok(nS.includes("if (String(r.status) === 'pending') return json(req, 200, { ok: true, skipped: 'not_decided' });"), '결정된 신청만 알린다 (화면이 보낸 글을 믿지 않고 DB 를 다시 읽는다)');
ok(nS.includes("where endpoint in ${db(expired)}") && nS.includes('code === 404 || code === 410'), '만료된 구독(404·410)은 지운다');
ok(nS.includes('function dedupe(') && nS.includes('seen.has(endpoint)'), '같은 기기(주소)에는 한 번만 보낸다');
// 메일 함수 쪽 문
const mailS = readFileSync(new URL('../supabase/functions/hub-mail/index.ts', import.meta.url), 'utf8');
ok(mailS.includes("const notifyGrant = req.headers.get('x-bmr-notify-grant') ?? ''") && mailS.includes('if (notifyGrant) return await sendNotify(req, notifyGrant);'), 'hub-mail: 알림 메일은 일회용 표 값이 있을 때만');
ok(mailS.includes("where nonce = ${nonce} and used_at is null and created_at > now() - make_interval(secs => ${NOTIFY.grantTtlSec})")
  && mailS.includes('returning to_email, subject, body'), 'hub-mail: 표를 한 번만 쓰이게 표시하고 받는 사람·제목·본문을 그 표에서만 읽는다');
ok(mailS.includes('grantTtlSec: 120') && mailS.includes('perRecipientHour: 6') && mailS.includes('perDay: 200'), '알림 메일 한도: 2분·한 사람 6통/시간·하루 200통');
ok(mailS.includes('const to = emails(g.to_email') && mailS.includes('mailLog(null, 1, subject') && mailS.includes("html: '', replyTo: []"), '알림 메일: 받는 사람은 표에 적힌 한 사람, 기록에는 건수만');
ok(mailS.includes("slug = 'hub-notify' and status = 'sent'"), '알림 메일도 학교 전체 하루 한도에 함께 센다');
// DB
const nMig = readFileSync(new URL('../supabase/migrations/20261115250000_hub_notify.sql', import.meta.url), 'utf8');
ok(['public.notification_prefs', 'public.push_subscriptions', 'public.notification_log', 'bmr_admin.push_config', 'bmr_admin.notify_grants', 'bmr_admin.notify_attempts'].every((t) => nMig.includes(t)), '마이그레이션: 설정·구독·알림함·열쇠·일회용 표·횟수 표');
ok(['notification_prefs', 'push_subscriptions', 'notification_log'].every((t) => nMig.includes(`alter table public.${t} enable row level security`)), '세 표 모두 RLS 켬');
ok(['notif_prefs_select', 'notif_prefs_insert', 'notif_prefs_update', 'push_subs_select', 'push_subs_insert', 'push_subs_update', 'push_subs_delete', 'notify_log_select', 'notify_log_update'].every((p) => nMig.includes(`policy ${p}`)), '정책: 설정·구독·알림함 모두 본인 줄만');
ok((nMig.match(/user_id = \(select auth\.uid\(\)\)/g) ?? []).length >= 8, '모든 정책이 본인(user_id = auth.uid())만');
ok(nMig.includes('grant update (read_at) on public.notification_log to authenticated') && !nMig.includes('grant insert on public.notification_log'), '알림함: 읽음 표시만 (브라우저가 알림을 지어낼 수 없다)');
ok(nMig.includes('revoke all on bmr_admin.push_config from public, anon, authenticated') && nMig.includes('private_jwk jsonb'), 'VAPID 비밀키는 브라우저 권한 없음');
ok(nMig.includes('revoke all on bmr_admin.notify_grants') && nMig.includes("nonce ~ '^[0-9a-f]{64}$'") && nMig.includes('used_at'), '일회용 메일 표도 브라우저 권한 없음 (64자 hex·한 번)');
ok(nMig.includes('private.push_sub_keep10') && nMig.includes('limit 10'), '기기는 한 사람당 10개 (오래된 것부터 정리)');
ok(['notify_app_request', 'notify_dev_request', 'notify_member_role'].every((f) => nMig.includes(`private.${f}()`)), '신청 승인·반려·역할 변경은 DB 트리거가 알림함에 넣는다');
ok(nMig.includes("raise warning 'notify_app_request: %', sqlerrm"), '알림을 만들지 못해도 신청 처리는 막지 않는다');
ok(nMig.includes('supabase_realtime') && nMig.includes("notify pgrst, 'reload schema'"), '실시간 발행 + PostgREST 스키마 새로 읽기');
ok(nMig.includes('bmr_admin.notify_attempts') && nMig.includes('(user_id, action, ref, at desc)'), '쿨다운을 셀 수 있는 인덱스 (사람·동작·대화별)');
// 화면·서비스 워커·설치
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
ok(sw.includes("addEventListener('push'") && sw.includes('showNotification') && sw.includes("addEventListener('notificationclick'"), '서비스 워커: 푸시 표시 + 클릭으로 화면 열기');
ok(sw.includes('setAppBadge') && sw.includes('data: { url }'), '서비스 워커: 홈 화면 배지 + 알림마다 갈 주소');
ok(!/caches\.open|cache\.put/.test(sw), '서비스 워커는 캐시를 쓰지 않는다 (쪽지·권한이 섞이지 않게)');
const mf = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
ok(mf.display === 'standalone' && mf.scope === '/hub/' && mf.start_url.startsWith('/hub/') && mf.icons.length >= 2 && mf.icons.some((i) => i.sizes === '192x192'), 'manifest: 설치형 + /hub/ 범위(다른 앱을 가리지 않음) + 192 아이콘 (아이폰 푸시 조건)');
ok(html.includes('rel="manifest" href="/manifest.webmanifest"') && html.includes('apple-mobile-web-app-capable'), 'index.html: manifest·아이폰 앱 선언');
const nUi = readFileSync(new URL('../src/notify.ts', import.meta.url), 'utf8');
ok(nUi.includes('hub-notify/rules') && nUi.includes("'/sw.js'") && nUi.includes("SW_SCOPE = '/hub/'"), '화면: 서버와 같은 규칙 파일, 서비스 워커 범위 /hub/ (다른 앱의 서비스 워커와 겹치지 않게)');
ok(nUi.includes('setAppBadge') && nUi.includes('document.title = n > 0 ? badgeText(n) : pageTitle'), '화면: 탭 제목(안 읽은 것이 있을 때만 (N))·홈 화면 배지');
ok(nUi.includes('userVisibleOnly: true') && nUi.includes('applicationServerKey'), '푸시 구독: 공개키로 구독 (userVisibleOnly)');
ok(nUi.includes("upsert(") && nUi.includes("onConflict: 'user_id,endpoint'"), '구독은 RLS 로 내 줄만 upsert');
ok(nUi.includes('isIOS() && !isStandalone()'), '아이폰은 홈 화면 추가 전에는 켤 수 없다고 안내');
ok(nUi.includes('export async function disablePush(): Promise<void>') && !/disablePush[\s\S]{0,400}savePrefs\(session, \{ push_enabled: false \}\)/.test(nUi), '이 기기 알림 끄기는 그 기기 구독만 지운다 (다른 기기는 그대로)');
ok(nUi.includes('Notification.requestPermission') && nUi.includes('perm !== \'granted\''), '권한을 거절하면 이유를 알려 준다');
const pUi = readFileSync(new URL('../src/pages/Notify.tsx', import.meta.url), 'utf8');
ok(pUi.includes('export function NotificationBell') && pUi.includes('export function NotifySettings') && pUi.includes('export function NotifyQuickToggle'), '화면: 🔔 종·알림 설정·쪽지 화면 빠른 켜기');
ok(pUi.includes('markAll') && pUi.includes('update({ read_at'), '알림 읽음/모두 읽음');
ok(pUi.includes('시험 알림') && pUi.includes('홈 화면에 추가'), '안내: 시험 발송·아이폰 홈 화면 추가');
ok(pUi.includes('setSubscribed(Boolean(await currentSubscription()))') && pUi.includes('on={subscribed}'), '화면의 켜짐/꺼짐은 이 브라우저의 구독 상태 (기기마다 따로)');
ok(appS2.includes('<NotificationBell session={ctx.session} />') && appS2.includes('useBadge(ctx.session, chat.messages)'), '허브 머리에 🔔 + 배지(쪽지+알림)');
const accUi = readFileSync(new URL('../src/pages/Account.tsx', import.meta.url), 'utf8');
ok(accUi.includes('<NotifySettings session={ctx.session} />'), '내 계정에 알림 설정');
ok(chatUi.includes('notifyChat(ctx.session, openId)') && chatUi.includes('<NotifyQuickToggle'), '쪽지: 보낸 뒤 상대에게 알림 + 화면에서 바로 켜고 끄기');
const reqUi = readFileSync(new URL('../src/pages/Requests.tsx', import.meta.url), 'utf8');
ok(reqUi.includes("notifyEvent(ctx.session, 'app_request', r.id)"), '신청 승인·반려 뒤 신청자에게 알림');

console.log('[알림 · 운영 점검 연결]');
const hp = N.healthPayload({ name: '도서 대출', slug: 'library', ok: false });
ok(hp.url === '/hub/status' && hp.tag === 'health-library' && hp.title.includes('점검 실패'), '점검 실패 알림: 제목·/hub/status·앱별 tag', JSON.stringify(hp));
ok(N.healthPayload({ name: 'x', slug: 'library', ok: true }).title.includes('회복'), '회복 알림은 제목이 다르다');
const healthS = readFileSync(new URL('../supabase/functions/hub-health/index.ts', import.meta.url), 'utf8');
ok(healthS.includes('app_health_latest') && healthS.includes('notifyTransitions(appById, prev, rows)'), '점검: 넣기 전 판정을 읽어 바뀐 앱만 고른다');
ok(healthS.includes("now === 'down' && was !== 'down'") && healthS.includes("now === 'ok' && was === 'down'"), '알림 기준: 장애가 될 때·장애에서 회복할 때만');
ok(healthS.includes("kind: 'health', ref: app.slug") && healthS.includes("url: '/hub/status'"), '알림함에 health 줄 (앱 담당자만)');
ok(healthS.includes('recentHealthNotice') && healthS.includes('12 * 3600_000'), '같은 앱 알림은 12시간에 한 번');
ok(healthS.includes("'x-hub-cron': CRON") && healthS.includes("action: 'health', app_id: app.id, ok: now === 'ok'"), '푸시는 점검 비밀값으로 hub-notify 에 부탁 (실패해도 점검은 그대로)');
ok(nS.includes("if (action === 'health') return json(req, 200, await healthAlert(req, b));") && nS.includes('safeEqual(req.headers.get(\'x-hub-cron\') ?? \'\', CRON)'), 'hub-notify: 점검 알림은 비밀값을 먼저 확인 (사람 토큰 없이)');
ok(nS.includes("where o.app_id = ${appId} and p.role <> 'disabled'") && nS.includes("if (!canPush(normalizePrefs(prefsRow), 'admin')) { off++; continue; }"), '점검 알림도 담당자·설정(관리 알림·푸시)을 지킨다');

console.log(`\n결과: ${pass} 통과, ${fail} 실패`); process.exit(fail ? 1 : 0);
