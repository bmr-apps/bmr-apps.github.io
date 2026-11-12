// Supabase Management API로 SQL 실행. 토큰은 환경변수(기본 SUPABASE_ACCESS_TOKEN_DEVAPPS, HUB_TOKEN_ENV로 바꿀 수 있음)이며 출력하지 않는다.
// 사용: HUB_REF=<프로젝트 ref> node scripts/sql.mjs "select 1"   |   node scripts/sql.mjs -f file.sql
import { readFileSync } from 'node:fs';
export const REF = process.env.HUB_REF || 'psupfmarnyxontorftio'; // bmr-dev-apps (서울)
export const TOKEN = process.env[process.env.HUB_TOKEN_ENV || 'SUPABASE_ACCESS_TOKEN_DEVAPPS'];
export const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
export const api = (p, o = {}) => fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, { headers: H, ...o });
export async function sql(query, { readOnly = false } = {}) {
  if (!REF) throw new Error('HUB_REF(허브 Supabase 프로젝트 ref)가 없습니다');
  if (!TOKEN) throw new Error('Supabase 액세스 토큰 환경변수가 없습니다');
  const r = await api('/database/query', { method: 'POST', body: JSON.stringify({ query, read_only: readOnly }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL 오류 ${r.status}: ${t.slice(0, 2000)}`);
  return t ? JSON.parse(t) : null;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const q = a[0] === '-f' ? readFileSync(a[1], 'utf8') : a.join(' ');
  sql(q).then((r) => console.log(JSON.stringify(r, null, 1))).catch((e) => { console.error(e.message); process.exit(1); });
}
