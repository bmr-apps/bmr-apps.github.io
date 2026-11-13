// hub-provision 의 외부 호출 허용 목록(allowlist). 여기 적힌 주소·방법 말고는 아예 보낼 수 없다.
//  · Supabase 관리 API: 프로젝트 psupfmarnyxontorftio 하나, 그 앱의 함수 <slug>-fn 만들기·배포, 그 앱 비밀값 <SCHEMA>_DB_URL 하나,
//    Data API 노출 스키마에 그 앱 스키마 '추가'만, 고정 SQL 실행. 지우기(DELETE) 경로는 없다.
//  · GitHub API: 조직 bmr-apps 의 그 앱 저장소 하나. 저장소 지우기·설정 바꾸기·조직 멤버 관리 없음. 초대는 push 권한만.
//  · Storage: 그 앱 버킷 하나 만들기(비공개). 지우기 없음.

export const REF = 'psupfmarnyxontorftio';
export const ORG = 'bmr-apps';
export const DOMAIN = 'apps.bmrschool.net';
export const SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/;
export const GH_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export type Names = {
  slug: string; schema: string; dev: string; fnRole: string; fn: string; prefix: string; dbSecret: string; vault: string; url: string; repoUrl: string;
};
export function names(slug: string): Names {
  if (!SLUG_RE.test(slug) || slug.endsWith('-') || slug.includes('--')) throw new HttpError(400, '주소(slug) 형식이 올바르지 않습니다.');
  const schema = slug.replaceAll('-', '_');
  return {
    slug, schema, dev: `${schema}_dev`, fnRole: `${schema}_fn`, fn: `${slug}-fn`, prefix: `${schema.toUpperCase()}_`,
    dbSecret: `${schema.toUpperCase()}_DB_URL`, vault: `bmr_dbcred:${slug}`, url: `https://${DOMAIN}/${slug}/`, repoUrl: `https://github.com/${ORG}/${slug}`,
  };
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function blocked(what: string, method: string, path: string): never {
  console.error('hub-provision blocked', what, method, path.slice(0, 120));
  throw new HttpError(500, `허용되지 않은 ${what} 요청을 막았습니다.`);
}

// ---------------- Supabase 관리 API ----------------
export class Mgmt {
  constructor(private n: Names, private token: string) {}
  private rules(): [string, RegExp][] {
    const fn = esc(this.n.fn);
    return [
      ['POST', /^\/database\/query$/],
      ['GET', /^\/secrets$/],
      ['POST', /^\/secrets$/],
      ['GET', /^\/functions$/],
      ['GET', new RegExp(`^/functions/${fn}$`)],
      ['POST', new RegExp(`^/functions/deploy\\?slug=${fn}$`)],
      ['GET', /^\/postgrest$/],
      ['PATCH', /^\/postgrest$/],
    ];
  }
  private async call(method: string, path: string, body?: BodyInit, json = true): Promise<Response> {
    if (!this.rules().some(([m, re]) => m === method && re.test(path))) blocked('Supabase 관리', method, path);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (json && body !== undefined) headers['Content-Type'] = 'application/json';
    return await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, { method, headers, body });
  }
  /** 고정 SQL 틀만 (호출하는 쪽에서 검증된 이름만 끼워 넣음) */
  async query(sql: string): Promise<unknown[]> {
    const r = await this.call('POST', '/database/query', JSON.stringify({ query: sql }));
    const t = await r.text();
    if (!r.ok) throw new HttpError(502, `DB 작업 실패 (${r.status}): ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : [];
  }
  async secretNames(): Promise<string[]> {
    const r = await this.call('GET', '/secrets');
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `비밀값 목록 실패 (${r.status})`); }
    return ((await r.json()) as { name: string }[]).map((x) => x.name);
  }
  /** 이 앱 함수의 DB 접속 비밀값 하나만 넣는다 (다른 이름은 못 넣음) */
  async setFnDbSecret(value: string) {
    const body = [{ name: this.n.dbSecret, value }];
    if (body.length !== 1 || body[0].name !== this.n.dbSecret) blocked('비밀값', 'POST', '/secrets');
    const r = await this.call('POST', '/secrets', JSON.stringify(body));
    await r.body?.cancel();
    if (!r.ok) throw new HttpError(502, `함수 비밀값 저장 실패 (${r.status})`);
  }
  async functionSlugs(): Promise<string[]> {
    const r = await this.call('GET', '/functions');
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `함수 목록 실패 (${r.status})`); }
    return ((await r.json()) as { slug: string }[]).map((f) => f.slug);
  }
  /** 이 앱의 시작 함수 <slug>-fn 만 배포 */
  async deployFn(source: string) {
    const fd = new FormData();
    fd.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: this.n.fn, verify_jwt: false }));
    fd.append('file', new Blob([source], { type: 'application/typescript' }), 'index.ts');
    const r = await this.call('POST', `/functions/deploy?slug=${this.n.fn}`, fd, false);
    const t = await r.text();
    if (!r.ok) throw new HttpError(502, `함수 ${this.n.fn} 배포 실패 (${r.status}): ${t.slice(0, 300)}`);
  }
  async exposedSchemas(): Promise<string[]> {
    const r = await this.call('GET', '/postgrest');
    if (!r.ok) { await r.body?.cancel(); throw new HttpError(502, `Data API 설정 읽기 실패 (${r.status})`); }
    const j = await r.json() as { db_schema?: string };
    return String(j.db_schema || '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  /** Data API 노출 목록에 이 앱 스키마를 '더하기'만 (빼거나 다른 설정은 안 바꿈) */
  async exposeSchema() {
    const cur = await this.exposedSchemas();
    if (cur.includes(this.n.schema)) return false;
    if (!cur.includes('public')) throw new HttpError(500, 'Data API 설정이 예상과 달라 바꾸지 않았습니다.');
    const next = [...cur, this.n.schema];
    const r = await this.call('PATCH', '/postgrest', JSON.stringify({ db_schema: next.join(',') }));
    await r.body?.cancel();
    if (!r.ok) throw new HttpError(502, `Data API 노출 실패 (${r.status})`);
    return true;
  }
}

// ---------------- Storage (서버 키) ----------------
export class Store {
  constructor(private n: Names, private sbUrl: string, private service: string) {}
  private async call(method: string, path: string, body?: unknown) {
    const ok = (method === 'GET' && path === `/bucket/${this.n.slug}`) ||
      (method === 'POST' && path === '/bucket' && (body as { id?: string })?.id === this.n.slug && (body as { public?: boolean })?.public === false);
    if (!ok) blocked('Storage', method, path);
    return await fetch(`${this.sbUrl}/storage/v1${path}`, {
      method, headers: { apikey: this.service, Authorization: `Bearer ${this.service}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async exists(): Promise<boolean> {
    const r = await this.call('GET', `/bucket/${this.n.slug}`);
    await r.body?.cancel();
    if (r.ok) return true;
    if (r.status === 404 || r.status === 400) return false;
    throw new HttpError(502, `버킷 확인 실패 (${r.status})`);
  }
  async create() {
    const r = await this.call('POST', '/bucket', { id: this.n.slug, name: this.n.slug, public: false, file_size_limit: 10 * 1024 * 1024 });
    const t = await r.text();
    if (!r.ok) throw new HttpError(502, `버킷 만들기 실패 (${r.status}): ${t.slice(0, 200)}`);
  }
}

// ---------------- GitHub ----------------
export type GhRes = { status: number; ok: boolean; data: any };
export class GitHub {
  private base: string;
  constructor(private repo: string, private token: string) {
    if (!SLUG_RE.test(repo)) throw new HttpError(400, '저장소 이름이 올바르지 않습니다.');
    this.base = `/repos/${ORG}/${repo}`;
  }
  private allowed(method: string, path: string, body: any): boolean {
    const b = esc(this.base);
    const user = '[A-Za-z0-9-]{1,39}';
    const rules: [string, RegExp, ((x: any) => boolean)?][] = [
      ['GET', new RegExp(`^${b}$`)],
      ['GET', new RegExp(`^${b}/contents/\\.bmr-app\\.json$`)],
      ['GET', new RegExp(`^${b}/branches/main$`)],
      ['GET', new RegExp(`^${b}/git/ref/heads/main$`)],
      ['POST', /^\/orgs\/bmr-apps\/repos$/, (x) => x?.name === this.repo && x?.private === false],
      ['POST', new RegExp(`^${b}/git/trees$`)],
      ['POST', new RegExp(`^${b}/git/commits$`)],
      ['PATCH', new RegExp(`^${b}/git/refs/heads/main$`), (x) => x?.force === false],
      ['GET', new RegExp(`^${b}/pages$`)],
      ['POST', new RegExp(`^${b}/pages$`), (x) => x?.build_type === 'workflow'],
      ['PATCH', new RegExp(`^${b}/actions/variables/(VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY)$`)],
      ['POST', new RegExp(`^${b}/actions/variables$`), (x) => ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].includes(x?.name)],
      ['GET', new RegExp(`^${b}/collaborators/${user}/permission$`)],
      ['PUT', new RegExp(`^${b}/collaborators/${user}$`), (x) => x?.permission === 'push'],
      ['DELETE', new RegExp(`^${b}/collaborators/${user}$`)],
      ['GET', new RegExp(`^${b}/invitations\\?per_page=100$`)],
      ['DELETE', new RegExp(`^${b}/invitations/\\d+$`)],
      ['GET', new RegExp(`^/users/${user}$`)], // 아이디가 있는지 확인만 (읽기)
    ];
    return rules.some(([m, re, check]) => m === method && re.test(path) && (!check || check(body)));
  }
  async call(method: string, path: string, body?: unknown): Promise<GhRes> {
    if (!this.allowed(method, path, body)) blocked('GitHub', method, path);
    const r = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bmr-apps-hub-provision', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await r.text();
    let data: any = null; try { data = t ? JSON.parse(t) : null; } catch { data = t; }
    return { status: r.status, ok: r.ok, data };
  }
  get path() { return this.base; }
}
