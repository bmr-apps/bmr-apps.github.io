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

console.log('[비밀값 가리기]');
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4eHh4eHh4eCJ9.c2lnbmF0dXJlc2lnbmF0dXJl';
const m = R.maskSecrets(`url postgresql://class_designer_fn.ref:Sup3rS3cret@host:5432/postgres auth Bearer ${'a'.repeat(30)} jwt ${jwt} key sbp_${'b'.repeat(30)} g AIza${'c'.repeat(30)} long ${'Z9'.repeat(30)}`);
ok(!m.includes('Sup3rS3cret') && !m.includes(jwt) && !m.includes('b'.repeat(30)) && !m.includes('c'.repeat(30)) && !m.includes('Z9'.repeat(30)) && !m.includes('a'.repeat(30)), '비밀번호·JWT·키·긴 토큰 가림', m);
ok(R.maskSecrets('booted (time: 47ms) GET /class-designer-fn/health 200 f00af562-86ab-4fa0-9dca-0fb8f76ac5b6') === 'booted (time: 47ms) GET /class-designer-fn/health 200 f00af562-86ab-4fa0-9dca-0fb8f76ac5b6', '보통 글·경로·UUID 는 그대로');

console.log(`\n결과: ${pass} 통과, ${fail} 실패`); process.exit(fail ? 1 : 0);
