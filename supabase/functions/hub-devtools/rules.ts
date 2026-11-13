// 개발자 셀프서비스 규칙 (순수 함수 — hub-devtools 가 쓰고, scripts/test-selfservice-rules.mjs 가 시험한다).
// hub-fn-deploy/index.ts 의 EXTRA_FN_* 값과 같아야 한다 (시험이 같은지 확인).

export const SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/;
/** 앱마다 <slug>-fn 말고 더 만들 수 있는 서버 함수 수 */
export const EXTRA_FN_MAX = 3;
/** 추가 함수 이름 끝부분: 영문 소문자·숫자, 하이픈으로 이음, 1~20자 */
export const EXTRA_FN_SUFFIX_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const EXTRA_FN_SUFFIX_MAX = 20;
/** 앱마다 넣을 수 있는 함수 비밀값 수 (<SCHEMA>_DB_URL 제외) */
export const SECRET_MAX_PER_APP = 20;
export const SECRET_VALUE_MAX = 8000;
/** 접두어와 상관없이 쓸 수 없는 이름 앞부분 (Supabase·허브 예약) */
export const RESERVED_SECRET_PREFIXES = ['SUPABASE_', 'BMR_', 'HUB_', 'DENO_', 'SB_'];

export const schemaOf = (slug: string) => slug.replaceAll('-', '_');
export const prefixOf = (slug: string) => schemaOf(slug).toUpperCase() + '_';
/** 허브가 직접 관리하는 그 앱 비밀값 (개발자는 바꾸거나 지울 수 없음) */
export const managedSecrets = (slug: string) => [`${prefixOf(slug)}DB_URL`];

/** 다른 앱의 이름 공간과 겹치는지: 예) 앱 class 가 CLASS_DESIGNER_X(앱 class-designer 몫)를 넣으려 함 */
function otherOwns(name: string, own: string, others: string[], of: (s: string) => string) {
  return others.some((o) => o !== own && of(o).length > of(own).length && name.startsWith(of(o)));
}

/** 함수 비밀값 이름 검사. 문제가 있으면 한국어 이유, 괜찮으면 null */
export function secretNameProblem(slug: string, name: string, allSlugs: string[] = []): string | null {
  const p = prefixOf(slug);
  if (typeof name !== 'string' || !name) return '이름을 적어 주세요.';
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(name)) return '이름은 영문 대문자·숫자·밑줄(_)만, 100자까지 씁니다.';
  if (RESERVED_SECRET_PREFIXES.some((r) => name.startsWith(r))) return `${RESERVED_SECRET_PREFIXES.join(', ')} 로 시작하는 이름은 쓸 수 없습니다.`;
  if (!name.startsWith(p) || name.length === p.length) return `이 앱의 비밀값 이름은 ${p} 로 시작해야 합니다 (예: ${p}API_KEY).`;
  if (name.slice(p.length).startsWith('_') || name.endsWith('_')) return '이름 끝부분은 밑줄로 시작하거나 끝나지 않게 해 주세요.';
  if (managedSecrets(slug).includes(name)) return `${name} 은 허브가 관리하는 값이라 바꿀 수 없습니다.`;
  if (otherOwns(name, slug, allSlugs, prefixOf)) return '다른 앱의 비밀값 이름과 겹칩니다.';
  return null;
}

export function secretValueProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return '값을 적어 주세요.';
  if (value.length > SECRET_VALUE_MAX) return `값이 너무 깁니다 (${SECRET_VALUE_MAX}자까지).`;
  if (/[\u0000]/.test(value)) return '값에 쓸 수 없는 문자가 있습니다.';
  return null;
}

/** 이 앱 몫의 함수인지 (<slug>-fn 또는 <slug>-<끝부분>, 다른 앱 이름 공간 제외) */
export function fnKind(slug: string, fn: string, allSlugs: string[] = []): 'main' | 'extra' | null {
  if (fn === `${slug}-fn`) return 'main';
  if (!fn.startsWith(`${slug}-`)) return null;
  const suffix = fn.slice(slug.length + 1);
  if (!suffix || suffix.length > EXTRA_FN_SUFFIX_MAX || !EXTRA_FN_SUFFIX_RE.test(suffix)) return null;
  // 더 긴 다른 앱 slug 와 같거나 그 앱 이름 공간(<다른slug>-…)이면 그 앱 몫 (예: 앱 class 의 class-designer-x 는 앱 class-designer 몫)
  for (const o of allSlugs) if (o !== slug && o.length > slug.length && (fn === o || fn.startsWith(`${o}-`))) return null;
  return 'extra';
}

export function extraFnProblem(slug: string, fn: string, allSlugs: string[] = []): string | null {
  if (fn === `${slug}-fn`) return null;
  if (!fn.startsWith(`${slug}-`)) return `함수 이름은 ${slug}- 로 시작해야 합니다.`;
  const suffix = fn.slice(slug.length + 1);
  if (!suffix || suffix.length > EXTRA_FN_SUFFIX_MAX || !EXTRA_FN_SUFFIX_RE.test(suffix)) return `함수 이름 끝부분은 영문 소문자·숫자(하이픈으로 이음) ${EXTRA_FN_SUFFIX_MAX}자까지입니다: ${slug}-이름`;
  if (fnKind(slug, fn, allSlugs) === null) return '다른 앱의 이름과 겹치는 함수 이름입니다.';
  return null;
}

// ---------- 로그 ----------
export const LOG_HOURS = [1, 6, 24] as const;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLE_RE = /^[a-z][a-z0-9_]{1,60}$/;

/** 로그 조회 SQL (ClickHouse). 넣는 값은 모두 형식 검사를 통과한 것만 — 문자열 이어 붙이기 전에 검사 */
export function logSql(kind: 'fn' | 'db', ids: string[], opts: { errorsOnly?: boolean; limit?: number } = {}): string {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 200), 1), 300);
  if (kind === 'fn') {
    if (!ids.length || !ids.every((x) => UUID_RE.test(x))) throw new Error('함수 id 형식');
    const inList = ids.map((x) => `'${x}'`).join(', ');
    const err = opts.errorsOnly ? ` and (lower(log_attributes['level']) in ('error', 'warning') or toInt32OrZero(log_attributes['response.status_code']) >= 500)` : '';
    return `select timestamp, source, log_attributes['function_id'] as function_id, log_attributes['level'] as level, log_attributes['request.method'] as method, log_attributes['request.pathname'] as path, log_attributes['response.status_code'] as status, log_attributes['execution_time_ms'] as ms, substring(event_message, 1, 2000) as message from logs where source in ('function_logs', 'function_edge_logs') and log_attributes['function_id'] in (${inList})${err} order by timestamp desc limit ${limit}`;
  }
  if (!ids.length || !ids.every((x) => ROLE_RE.test(x))) throw new Error('DB 역할 형식');
  const inList = ids.map((x) => `'${x}'`).join(', ');
  const err = opts.errorsOnly ? ` and log_attributes['parsed.error_severity'] in ('ERROR', 'FATAL', 'PANIC', 'WARNING')` : '';
  return `select timestamp, source, log_attributes['parsed.user_name'] as role, log_attributes['parsed.error_severity'] as level, log_attributes['parsed.sql_state_code'] as code, substring(event_message, 1, 2000) as message from logs where source = 'postgres_logs' and log_attributes['parsed.user_name'] in (${inList})${err} order by timestamp desc limit ${limit}`;
}

/** 로그 글에서 비밀값처럼 보이는 것을 가린다 */
export function maskSecrets(s: string): string {
  return String(s ?? '')
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1••••@')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '••••(JWT)')
    .replace(/\b(?:sb_secret_|sb_publishable_|sbp_|ghp_|gho_|ghs_|github_pat_|sk-|sk_|rk_|AIza)[A-Za-z0-9_-]{10,}/g, '••••(키)')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, '$1••••')
    .replace(/[A-Za-z0-9+_=-]{40,}/g, '••••');
}
