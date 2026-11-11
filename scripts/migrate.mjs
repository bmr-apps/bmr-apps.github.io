// supabase/migrations/*.sql 을 순서대로 적용하고 supabase_migrations.schema_migrations 에 기록 (CLI db push 와 호환)
import { readdirSync, readFileSync } from 'node:fs';
import { sql } from './sql.mjs';
const dir = new URL('../supabase/migrations/', import.meta.url);
await sql(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
const done = new Set((await sql('select version from supabase_migrations.schema_migrations')).map((r) => r.version));
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
  if (done.has(version)) { console.log('건너뜀', f); continue; }
  const body = readFileSync(new URL(f, dir), 'utf8');
  await sql(`begin;\n${body}\ninsert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${rest.join('_')}', '{}');\ncommit;`);
  console.log('적용', f);
}
