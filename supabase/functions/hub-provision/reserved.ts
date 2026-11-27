// 주소(slug)로 쓸 수 없는 이름 — PostgreSQL 예약어와 시스템 스키마 이름.
// 예: slug 'check' → 스키마 'check' → `create schema if not exists check` 가 구문 오류로 멈춘다 (2026-11-28 '별무리 출석 프로그램').
// 이 파일 하나를 서버(guard.ts · index.ts)와 허브 화면(src/pages/Requests.tsx)이 같이 쓴다.
// 같은 규칙이 DB 에도 있다: private.request_guard (supabase/migrations/20261128100000_reserve_sql_keywords.sql) — 목록을 바꾸면 그쪽도 같이 고친다.

export const RESERVED_HINT = 'DB 예약어 또는 시스템 이름이라 사용할 수 없는 주소입니다. 다른 이름(예: bmr-check, attendance)을 써 주세요.';

/** PostgreSQL 예약어(keyword) — 따옴표 없이 스키마·역할 이름으로 쓰면 문장이 깨진다 */
const SQL_RESERVED = new Set(`
  all analyse analyze and any array as asc authorize begin between both by case cast check collate column commit
  constraint create cross current_date current_time current_timestamp current_user delete desc distinct do drop else end
  except exists false fetch first for foreign freeze from full grant group having ilike in index inner insert intersect
  into is join lateral left like limit natural next not null nullif offset on only or order outer over partition primary
  references returning revoke right role rollback row rows schema select session_user set some table then to
  true union unique update user using values verbose when where window with
`.trim().split(/\s+/));

/** Supabase·PostgreSQL 시스템 스키마 — 앱 이름으로 쓰면 안 되는 이름 */
const SYSTEM_SCHEMAS = new Set([
  'public', 'auth', 'storage', 'vault', 'bmr', 'bmr_admin', 'private', 'extensions', 'realtime', 'supabase_functions',
  'pg_catalog', 'information_schema', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks', 'supabase_migrations',
  'cron', 'net', 'pgbouncer', 'topology', 'pgtle', 'pgmq',
]);

/**
 * 주소가 DB 이름으로 쓸 수 없는 예약어·시스템 이름이면 안내 문구, 아니면 null.
 * 검사는 슬러그의 하이픈을 밑줄로 바꾼 스키마 이름 기준이다 (bmr-admin → bmr_admin).
 */
export function reservedProblem(slug: string): string | null {
  const schema = String(slug ?? '').trim().toLowerCase().replaceAll('-', '_');
  if (!schema) return null;
  return SQL_RESERVED.has(schema) || SYSTEM_SCHEMAS.has(schema) ? RESERVED_HINT : null;
}
