// hub-deprovision 의 외부 호출 허용 목록. '그 앱 하나'의 자원만 읽고(백업) 지울 수 있다.
//  · Supabase 관리 API: 이 프로젝트만. 함수 <slug>-fn 읽기·본문 내려받기·지우기, 비밀값은 <SCHEMA>_ 로 시작하는 이름만 지우기
//    (다른 앱의 더 긴 접두어는 제외), Data API 목록에서 그 스키마 '빼기'만, 고정 SQL. 프로젝트·Auth·설정 변경 경로 없음.
//  · GitHub: bmr-apps/<slug> 저장소 하나 (읽기·zip 내려받기·지우기 — 지우기는 .bmr-app.json 표시가 맞을 때만, 호출하는 쪽에서 확인)
//  · Storage: 그 앱 버킷 <slug> 읽기·비우기·지우기, 백업 버킷 hub-backups 의 <slug>/ 아래에만 쓰기.
export const REF = 'psupfmarnyxontorftio';
export const ORG = 'bmr-apps';
export const BACKUP_BUCKET = 'hub-backups';
export const SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/;
// 어떤 경우에도 지우지 않는 스키마
const PROTECTED_SCHEMAS = new Set(['public', 'private', 'auth', 'storage', 'vault', 'extensions', 'graphql', 'graphql_public', 'realtime', 'cron', 'net',
  'supabase_functions', 'supabase_migrations', 'pgbouncer', 'bmr', 'bmr_admin', 'pgsodium', 'pgsodium_masks', 'information_schema', '_realtime', '_analytics', 'pgmq', 'pgtle']);

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export type Names = { slug: string; schema: string; dev: string; fnRole: string; fn: string; prefix: string; dbSecret: string; vault: string };
export function names(slug: string): Names {
  if (!SLUG_RE.test(slug) || slug.endsWith('-') || slug.includes('--') || /^(hub|pg|supabase|bmr)(-|$)/.test(slug) || slug.startsWith('supabase')) {
    throw new HttpError(400, '이 주소(slug)는 삭제 대상이 될 수 없습니다.');
  }
  const schema = slug.replaceAll('-', '_');
  if (PROTECTED_SCHEMAS.has(schema) || schema.startsWith('pg_')) throw new HttpError(400, '시스템 스키마와 같은 이름이라 삭제할 수 없습니다.');
  return { slug, schema, dev: `${schema}_dev`, fnRole: `${schema}_fn`, fn: `${slug}-fn`, prefix: `${schema.toUpperCase()}_`, dbSecret: `${schema.toUpperCase()}_DB_URL`, vault: `bmr_dbcred:${slug}` };
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function blocked(what: string, method: string, path: string): never {
  console.error('hub-deprovision blocked', what, method, path.slice(0, 120));
  throw new HttpError(500, `허용되지 않은 ${what} 요청을 막았습니다.`);
}

export class Mgmt {
  constructor(private n: Names, private token: string, private otherPrefixes: string[]) {}
  private rules(): [string, RegExp][] {
    const fn = esc(this.n.fn);
    return [
      ['POST', /^\/database\/query$/], ['GET', /^\/secrets$/], ['DELETE', /^\/secrets$/], ['GET', /^\/functions$/],
      ['GET', new RegExp(`^/functions/${fn}$`)], ['GET', new RegExp(`^/functions/${fn}/body$`)], ['DELETE', new RegExp(`^/functions/${fn}$`)],
      ['GET', /^\/postgrest$/], ['PATCH', /^\/postgrest$/],
    ];
  }
  private async call(method: string, path: string, body?: string): Promise<Response> {
    if (!this.rules().some(([m, re]) => m === method && re.test(path))) blocked('Supabase 관리', method, path);
    return await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
      method, body, headers: { Authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    });
  }
  async query(sql: string): Promise<any[]> {
    const r = await this.call('POST', '/database/query', JSON.stringify({ query: sql }));
    const t = await r.text();
    if (!r.ok) throw new HttpError(502, `DB 작업 실패 (${r.status}): ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : [];
  }
  /** 이 앱 것인 비밀값 이름만 (다른 앱의 더 긴 접두어와 겹치는 것은 제외) */
  mine(name: string) {
    return name.startsWith(this.n.prefix) && !this.otherPrefixes.some((o) => o.length > this.n.prefix.length && o.startsWith(this.n.prefix) && name.startsWith(o));
  }
  async appSecretNames(): Promise<string[]> {
    const r = await this.call('GET', '/secrets');
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `비밀값 목록 실패 (${r.status})`); }
    return ((await r.json()) as { name: string }[]).map((x) => x.name).filter((x) => this.mine(x));
  }
  async deleteSecrets(list: string[]) {
    if (!list.length) return;
    if (!list.every((x) => this.mine(x))) blocked('비밀값', 'DELETE', '/secrets');
    const r = await this.call('DELETE', '/secrets', JSON.stringify(list));
    await r.body?.cancel();
    if (!r.ok) throw new HttpError(502, `비밀값 삭제 실패 (${r.status})`);
  }
  async functionExists(): Promise<boolean> {
    const r = await this.call('GET', '/functions');
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `함수 목록 실패 (${r.status})`); }
    return ((await r.json()) as { slug: string }[]).some((f) => f.slug === this.n.fn);
  }
  async functionMeta(): Promise<unknown> {
    const r = await this.call('GET', `/functions/${this.n.fn}`);
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `함수 정보 실패 (${r.status})`); }
    return await r.json();
  }
  async functionBody(): Promise<Uint8Array> {
    const r = await this.call('GET', `/functions/${this.n.fn}/body`);
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `함수 본문 내려받기 실패 (${r.status})`); }
    return new Uint8Array(await r.arrayBuffer());
  }
  async deleteFunction() {
    const r = await this.call('DELETE', `/functions/${this.n.fn}`);
    await r.body?.cancel();
    if (!r.ok && r.status !== 404) throw new HttpError(502, `함수 삭제 실패 (${r.status})`);
  }
  async exposed(): Promise<string[]> {
    const r = await this.call('GET', '/postgrest');
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `Data API 설정 읽기 실패 (${r.status})`); }
    return String((await r.json()).db_schema || '').split(',').map((s: string) => s.trim()).filter(Boolean);
  }
  /** Data API 목록에서 이 앱 스키마 하나만 뺀다 */
  async unexpose(): Promise<boolean> {
    const cur = await this.exposed();
    if (!cur.includes(this.n.schema)) return false;
    const next = cur.filter((s) => s !== this.n.schema);
    if (!next.includes('public') || next.length !== cur.length - 1) throw new HttpError(500, 'Data API 설정이 예상과 달라 바꾸지 않았습니다.');
    const r = await this.call('PATCH', '/postgrest', JSON.stringify({ db_schema: next.join(',') }));
    await r.body?.cancel();
    if (!r.ok) throw new HttpError(502, `Data API 목록 변경 실패 (${r.status})`);
    return true;
  }
}

export class Store {
  constructor(private n: Names, private sbUrl: string, private service: string, private prefix: string) {
    if (!prefix.startsWith(`${n.slug}/`)) throw new HttpError(500, '백업 위치가 올바르지 않습니다.');
  }
  private h(extra: Record<string, string> = {}) { return { apikey: this.service, Authorization: `Bearer ${this.service}`, ...extra }; }
  private enc(p: string) { return p.split('/').map(encodeURIComponent).join('/'); }
  async bucketExists(): Promise<boolean> {
    const r = await fetch(`${this.sbUrl}/storage/v1/bucket/${this.n.slug}`, { headers: this.h() });
    await r.body?.cancel();
    return r.ok;
  }
  /** 백업 버킷의 <slug>/<시각>/ 아래에만 쓴다 */
  async put(rel: string, body: Uint8Array | string, type: string): Promise<number> {
    if (rel.includes('..') || rel.startsWith('/')) blocked('Storage', 'POST', rel);
    const key = `${this.prefix}/${rel}`;
    const data = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    const r = await fetch(`${this.sbUrl}/storage/v1/object/${BACKUP_BUCKET}/${this.enc(key)}`, {
      method: 'POST', headers: this.h({ 'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'no-store' }), body: data as BodyInit,
    });
    const t = await r.text();
    if (!r.ok) throw new HttpError(502, `백업 저장 실패 (${rel}, ${r.status}): ${t.slice(0, 160)}`);
    return data.byteLength;
  }
  /** 앱 버킷 파일 → 백업 버킷 (서버 안에서 복사, 실패하면 내려받아 올리기) */
  async copyObject(name: string, size: number): Promise<void> {
    if (name.includes('..')) blocked('Storage', 'COPY', name);
    const dest = `${this.prefix}/bucket/${name}`;
    const r = await fetch(`${this.sbUrl}/storage/v1/object/copy`, {
      method: 'POST', headers: this.h({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ bucketId: this.n.slug, sourceKey: name, destinationBucket: BACKUP_BUCKET, destinationKey: dest }),
    });
    const t = await r.text();
    if (r.ok || /already exists|Duplicate/i.test(t)) return;
    if (size > 25 * 1024 * 1024) throw new HttpError(502, `파일 복사 실패 (${name}, ${r.status})`);
    const g = await fetch(`${this.sbUrl}/storage/v1/object/authenticated/${this.n.slug}/${this.enc(name)}`, { headers: this.h() });
    if (!g.ok) { await g.body?.cancel(); throw new HttpError(502, `파일 내려받기 실패 (${name}, ${g.status})`); }
    await this.put(`bucket/${name}`, new Uint8Array(await g.arrayBuffer()), g.headers.get('content-type') ?? 'application/octet-stream');
  }
  async deleteBucket(): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      const e = await fetch(`${this.sbUrl}/storage/v1/bucket/${this.n.slug}/empty`, { method: 'POST', headers: this.h() }); await e.body?.cancel();
      await new Promise((res) => setTimeout(res, i ? 2000 : 500));
      const d = await fetch(`${this.sbUrl}/storage/v1/bucket/${this.n.slug}`, { method: 'DELETE', headers: this.h() }); await d.body?.cancel();
      if (d.ok || d.status === 404) return true;
    }
    return false;
  }
}

export class GitHub {
  private base: string;
  constructor(private repo: string, private token: string) { this.base = `/repos/${ORG}/${repo}`; }
  private allowed(method: string, path: string) {
    const b = esc(this.base);
    return ([
      ['GET', new RegExp(`^${b}$`)], ['GET', new RegExp(`^${b}/contents/\\.bmr-app\\.json$`)], ['GET', new RegExp(`^${b}/zipball$`)],
      ['GET', new RegExp(`^${b}/collaborators\\?per_page=100$`)], ['GET', new RegExp(`^${b}/invitations\\?per_page=100$`)],
      ['DELETE', new RegExp(`^${b}$`)],
    ] as [string, RegExp][]).some(([m, re]) => m === method && re.test(path));
  }
  async raw(method: string, path: string): Promise<Response> {
    if (!this.allowed(method, path)) blocked('GitHub', method, path);
    return await fetch(`https://api.github.com${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bmr-apps-hub-deprovision' },
    });
  }
  async json(method: string, path: string): Promise<{ status: number; ok: boolean; data: any }> {
    const r = await this.raw(method, path); const t = await r.text();
    let data: any = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
    return { status: r.status, ok: r.ok, data };
  }
  get path() { return this.base; }
}
