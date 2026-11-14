// hub-ai — 앱 서버 함수 대신 여러 AI 업체(Gemini · OpenAI · Claude · Grok)를 부르는 학교 공용 게이트웨이.
// 호출: POST { model?, prompt?, system?, messages?: [{ role, content }], temperature?, max_tokens?, response_mime_type?, slug? }
//   Authorization: Bearer <앱 AI_TOKEN>   (bmrai_…)
//     또는 허브 로그인 토큰(관리자, 또는 그 앱 담당 개발자 — 이때 slug 필요)
// 정하는 것: 업체 키는 허브만 갖고(암호문 BMR_*_API_KEY), 앱은 이 앱 신분만 증명한다.
//            모델은 학교 전체(또는 이 앱) 허용 목록 안에서만, 요청·토큰 수는 앱별·학교 전체 한도 안에서만.
// 남기는 것: 업체·모델·토큰 수·결과·오류만 (bmr_admin.ai_log). 프롬프트와 응답 본문은 남기지 않는다.
// 업체 키를 푸는 열쇠(PROVISION_KEY)는 이 파일에 들어 있다. 저장소에는 빈 값이고, 배포할 때
// scripts/setup-ai.mjs 가 .secrets/hub-provision.key 의 값을 아래 자리에만 채워 올린다 (다른 함수는 읽을 수 없음).
// 열쇠 없이 배포되면(예: deploy-fn.mjs) 함수가 아예 뜨지 않게 아래에서 막는다 — 조용히 503 만 돌려주는 것보다 낫다.
import postgres from 'npm:postgres@3.4.5';
import {
  AI_DEFAULTS, MAX_CHARS, MAX_MESSAGES, MAX_TOKENS_CAP, PROVIDER_LABEL, PROVIDERS, type Provider, type Ask,
  parseModelSpec, effectiveModels, limitOf, modelAllowed, normalizeAsk,
} from './models.ts';

/** 배포할 때 setup-ai.mjs 가 이 자리에 열쇠(base64 32바이트)를 채운다. 저장소에는 빈 문자열 */
const PROVISION_KEY = '';
if (!PROVISION_KEY) throw new Error('hub-ai: 열쇠가 없습니다 — node scripts/setup-ai.mjs --deploy 로 배포하세요');

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const REF = 'psupfmarnyxontorftio';
const HUB = 'https://apps.bmrschool.net';
const ORIGINS = [HUB, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];
/** 업체 키 이름 — 값은 'enc:v1:' 암호문이고 관리자가 scripts/setup-ai.mjs 로 넣는다 */
const KEY_ENV: Record<Provider, string> = { gemini: 'BMR_GEMINI_API_KEY', openai: 'BMR_OPENAI_API_KEY', anthropic: 'BMR_ANTHROPIC_API_KEY', xai: 'BMR_XAI_API_KEY' };
const LIMIT = {
  maxBody: 400_000,          // 요청 본문 상한 (글자)
  maxChars: MAX_CHARS,       // 프롬프트·시스템·대화 전체 글자 수 (models.ts)
  maxMessages: MAX_MESSAGES,
  maxTokens: MAX_TOKENS_CAP,
  maxLogRows: 10,
  timeouts: { gemini: 90_000, openai: 90_000, anthropic: 90_000, xai: 90_000 },
} as const;
const db = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
if (new URL(SB_URL).hostname.split('.')[0] !== REF) throw new Error('hub-ai: 다른 프로젝트에서는 실행하지 않습니다');

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': !o ? HUB : (ORIGINS.includes(o) ? o : HUB),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** 업체 키는 필요할 때만 풀고 이 실행 동안만 메모리에 둔다 */
const keyCache = new Map<Provider, string>();
async function providerKey(p: Provider): Promise<string> {
  const hit = keyCache.get(p);
  if (hit) return hit;
  const name = KEY_ENV[p];
  const v = Deno.env.get(name) ?? '';
  if (!v) throw new HttpError(503, `${PROVIDER_LABEL[p]} 키가 아직 등록되지 않았습니다. 관리자에게 알려 주세요.`);
  if (!v.startsWith('enc:v1:')) throw new HttpError(503, `${PROVIDER_LABEL[p]} 키 설정이 올바르지 않습니다. 관리자에게 알려 주세요.`);
  if (!PROVISION_KEY) throw new HttpError(503, '서버 설정(열쇠)이 없습니다. 관리자에게 알려 주세요.');
  try {
    const key = await crypto.subtle.importKey('raw', b64d(PROVISION_KEY), 'AES-GCM', false, ['decrypt']);
    const raw = b64d(v.slice(7));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(name) }, key, raw.slice(12));
    const k = new TextDecoder().decode(pt).trim();
    if (!k) throw new Error('empty');
    keyCache.set(p, k);
    return k;
  } catch {
    throw new HttpError(503, `${PROVIDER_LABEL[p]} 키를 풀지 못했습니다. 관리자에게 알려 주세요.`);
  }
}
/** 어떤 업체 키가 등록되어 있는지 (값은 절대 돌려주지 않음) */
function configuredProviders(): Record<Provider, boolean> {
  const out = {} as Record<Provider, boolean>;
  for (const p of PROVIDERS) out[p] = (Deno.env.get(KEY_ENV[p]) ?? '').startsWith('enc:v1:');
  return out;
}

async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** 키처럼 보이는 글자는 기록에 남기지 않는다 */
function scrub(s: unknown): string {
  return String(s ?? '')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,})/g, '••••')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
const missingTable = (e: unknown) => /does not exist|relation .*ai_(config|tokens|log)/i.test(String((e as Error)?.message ?? e));

type AppRow = { id: number; slug: string; name: string; status: string };
type AiRow = {
  enabled: boolean; allowed_models: string[] | null;
  hourly_limit: number | null; daily_limit: number | null; daily_token_limit: number | null;
};
type Actor = { kind: 'token' | 'user'; email: string; id: string | null };

async function audit(actor: Actor | null, action: string, target: string, result: 'ok' | 'error' | 'denied', detail = '') {
  try {
    await db`insert into public.audit_log (actor, actor_email, action, target, result, detail)
      values (${actor?.id ?? null}, ${(actor?.email ?? '').slice(0, 200)}, ${action.slice(0, 60)}, ${target.slice(0, 200)}, ${result}, ${detail.slice(0, 2000)})`;
  } catch (e) { console.error('audit', String((e as Error)?.message ?? e).slice(0, 200)); }
}

/** 호출 기록 — 본문(프롬프트·응답)은 넘기지 않는다 */
async function aiLog(app: AppRow | null, provider: string, model: string, tokens: { input: number; output: number; total: number }, status: 'ok' | 'error' | 'denied', error: string, actor: string) {
  try {
    await db`insert into bmr_admin.ai_log (app_id, slug, provider, model, input_tokens, output_tokens, total_tokens, status, error, actor)
      values (${app?.id ?? null}, ${(app?.slug ?? '').slice(0, 40)}, ${provider.slice(0, 20)}, ${model.slice(0, 120)},
        ${Math.max(0, Math.trunc(tokens.input))}, ${Math.max(0, Math.trunc(tokens.output))}, ${Math.max(0, Math.trunc(tokens.total))},
        ${status}, ${scrub(error).slice(0, 500)}, ${actor.slice(0, 200)})`;
  } catch (e) { console.error('ai_log', String((e as Error)?.message ?? e).slice(0, 200)); }
}

async function appByToken(tok: string): Promise<{ app: AppRow; ai: AiRow } | null> {
  if (!tok || tok.length < 20 || tok.length > 200 || tok.split('.').length === 3) return null;
  const hash = await sha256hex(tok);
  const [r] = await db`select a.id, a.slug, a.name, a.status,
      t.enabled, t.allowed_models, t.hourly_limit, t.daily_limit, t.daily_token_limit
    from bmr_admin.ai_tokens t join public.apps a on a.id = t.app_id
    where t.token_hash = ${hash}`;
  if (!r) return null;
  return {
    app: { id: Number(r.id), slug: String(r.slug), name: String(r.name), status: String(r.status) },
    ai: {
      enabled: r.enabled !== false,
      allowed_models: Array.isArray(r.allowed_models) ? (r.allowed_models as string[]).map(String) : null,
      hourly_limit: r.hourly_limit == null ? null : Number(r.hourly_limit),
      daily_limit: r.daily_limit == null ? null : Number(r.daily_limit),
      daily_token_limit: r.daily_token_limit == null ? null : Number(r.daily_token_limit),
    },
  };
}

async function userByJwt(tok: string): Promise<{ id: string; email: string; role: string } | null> {
  if (!tok || tok.split('.').length !== 3) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) { await r.body?.cancel(); return null; }
  const u = await r.json();
  if (!u?.id) return null;
  const [p] = await db`select role, email from public.profiles where id = ${u.id}`;
  return { id: u.id, email: String(p?.email || u.email || '').toLowerCase(), role: String(p?.role ?? '') };
}

async function appForUser(u: { id: string; email: string; role: string }, slug: unknown): Promise<AppRow> {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,38}$/.test(slug)) throw new HttpError(400, '앱 주소 이름(slug)을 적어 주세요.');
  const [a] = await db`select id, slug, name, status from public.apps where slug = ${slug}`;
  if (!a) throw new HttpError(404, '앱을 찾을 수 없습니다.');
  const app = { id: Number(a.id), slug: String(a.slug), name: String(a.name), status: String(a.status) };
  if (u.role === 'admin') return app;
  if (u.role !== 'staff') throw new HttpError(403, '권한이 없습니다.');
  const [own] = await db`select exists (
    select 1 from public.app_owners o where o.app_id = ${a.id} and lower(o.email) = ${u.email} and ${u.email} <> ''
  ) as ok`;
  if (!own?.ok) throw new HttpError(403, '이 앱의 담당 개발자만 쓸 수 있습니다.');
  return app;
}

type Config = {
  default_model: string; allowed_models: string[]; default_app_hourly: number; default_app_daily: number;
  default_app_daily_tokens: number; global_daily_requests: number; global_daily_tokens: number;
};
let cfgCache: { at: number; v: Config } | null = null;
/** 학교 전체 설정 — 30초 동안만 기억한다 (관리자가 바꾸면 곧 반영) */
async function config(): Promise<Config> {
  if (cfgCache && Date.now() - cfgCache.at < 30_000) return cfgCache.v;
  const [r] = await db`select default_model, allowed_models, default_app_hourly, default_app_daily, default_app_daily_tokens,
      global_daily_requests, global_daily_tokens from bmr_admin.ai_config where id = 1`;
  if (!r) throw new HttpError(503, 'AI 설정이 아직 준비되지 않았습니다. 관리자에게 알려 주세요.');
  const v: Config = {
    default_model: String(r.default_model ?? AI_DEFAULTS.defaultModel),
    allowed_models: effectiveModels(null, r.allowed_models),
    default_app_hourly: limitOf(Number(r.default_app_hourly), AI_DEFAULTS.defaultAppHourly),
    default_app_daily: limitOf(Number(r.default_app_daily), AI_DEFAULTS.defaultAppDaily),
    default_app_daily_tokens: limitOf(Number(r.default_app_daily_tokens), AI_DEFAULTS.defaultAppDailyTokens),
    global_daily_requests: limitOf(Number(r.global_daily_requests), AI_DEFAULTS.globalDailyRequests),
    global_daily_tokens: limitOf(Number(r.global_daily_tokens), AI_DEFAULTS.globalDailyTokens),
  };
  cfgCache = { at: Date.now(), v };
  return v;
}

/** 요청 본문 → 부를 내용 (models.ts 의 normalizeAsk 가 형식·길이를 검사한다) */
function readAsk(b: Record<string, unknown>): Ask {
  const r = normalizeAsk(b);
  if (!r.ok) throw new HttpError(r.status, r.message);
  return r.ask;
}

/** 최근 24시간 사용량 (요청은 '거부'를 빼고 센다 — 막힌 요청이 한도를 먹지 않게) */
async function usage(appId: number) {
  const [c] = await db`select
      count(*) filter (where app_id = ${appId} and status <> 'denied') as app_24h,
      count(*) filter (where app_id = ${appId} and status <> 'denied' and at > now() - interval '1 hour') as app_hour,
      coalesce(sum(total_tokens) filter (where app_id = ${appId} and status = 'ok'), 0) as app_tokens,
      count(*) filter (where status <> 'denied') as global_24h,
      coalesce(sum(total_tokens) filter (where status = 'ok'), 0) as global_tokens
    from bmr_admin.ai_log where at > now() - interval '24 hours'`;
  return {
    app_hour: Number(c?.app_hour ?? 0), app_24h: Number(c?.app_24h ?? 0), app_tokens: Number(c?.app_tokens ?? 0),
    global_24h: Number(c?.global_24h ?? 0), global_tokens: Number(c?.global_tokens ?? 0),
  };
}
function overLimit(u: Awaited<ReturnType<typeof usage>>, l: { hourly: number; daily: number; tokens: number }, c: Config): string | null {
  if (u.global_24h >= c.global_daily_requests) return `학교 전체 하루 AI 요청 한도(${c.global_daily_requests.toLocaleString('en-US')}번)에 닿았습니다. 내일 다시 시도하세요.`;
  if (u.global_tokens >= c.global_daily_tokens) return `학교 전체 하루 토큰 한도(${c.global_daily_tokens.toLocaleString('en-US')})에 닿았습니다. 내일 다시 시도하세요.`;
  if (u.app_hour >= l.hourly) return `이 앱은 한 시간에 ${l.hourly}번까지만 AI를 부를 수 있습니다. 잠시 뒤 다시 시도하세요.`;
  if (u.app_24h >= l.daily) return `이 앱은 하루(24시간)에 ${l.daily}번까지만 AI를 부를 수 있습니다. 내일 다시 시도하세요.`;
  if (u.app_tokens >= l.tokens) return `이 앱의 하루 토큰 한도(${l.tokens.toLocaleString('en-US')})에 닿았습니다. 내일 다시 시도하세요.`;
  return null;
}

type Answer = { text: string; input: number; output: number; total: number };
/** 업체 응답을 공통 모양으로. 업체가 거절하면 상태에 맞는 한국어 오류로 바꾼다 */
function upstreamError(p: Provider, status: number, message: string, model: string): HttpError {
  const m = scrub(message);
  if (status === 429) return new HttpError(429, `${PROVIDER_LABEL[p]} 쪽 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.${m ? ` (${m.slice(0, 160)})` : ''}`);
  if (status === 401 || status === 403) return new HttpError(503, `${PROVIDER_LABEL[p]} 키가 올바르지 않거나 권한이 없습니다. 관리자에게 알려 주세요.${m ? ` (${m.slice(0, 160)})` : ''}`);
  if (status === 404) return new HttpError(502, `${PROVIDER_LABEL[p]} 에 '${model}' 모델이 없다고 합니다. 관리자에게 알려 주세요.${m ? ` (${m.slice(0, 160)})` : ''}`);
  if (status === 400 || status === 422) return new HttpError(502, `${PROVIDER_LABEL[p]} 가 요청을 받아 주지 않았습니다. 모델 이름·요청 내용을 확인해 주세요.${m ? ` (${m.slice(0, 200)})` : ''}`);
  return new HttpError(502, `${PROVIDER_LABEL[p]} 응답을 받지 못했습니다 (${status}). 잠시 뒤 다시 시도하세요.`);
}
async function post(url: string, headers: Record<string, string>, body: unknown, timeout: number): Promise<{ status: number; ok: boolean; j: Record<string, unknown> }> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const t = await r.text();
  let j: Record<string, unknown> = {};
  try { j = t ? JSON.parse(t) as Record<string, unknown> : {}; } catch { /* 그대로 */ }
  return { status: r.status, ok: r.ok, j };
}
function errText(j: Record<string, unknown>): string {
  const e = j.error;
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (m) return String(m);
  }
  if (typeof e === 'string') return e;
  return String(j.message ?? j.type ?? '');
}

async function callGemini(key: string, model: string, a: ReturnType<typeof readAsk>): Promise<Answer> {
  const body: Record<string, unknown> = {
    contents: a.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: {
      maxOutputTokens: a.max_tokens,
      ...(a.temperature !== null ? { temperature: a.temperature } : {}),
      ...(a.mime ? { responseMimeType: a.mime } : {}),
    },
  };
  if (a.system) body.systemInstruction = { parts: [{ text: a.system }] };
  const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key }, body, LIMIT.timeouts.gemini);
  if (!r.ok) throw upstreamError('gemini', r.status, errText(r.j), model);
  const cands = (Array.isArray(r.j.candidates) ? r.j.candidates : []) as { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  const text = (cands[0]?.content?.parts ?? []).map((p) => String(p?.text ?? '')).join('').trim();
  const u = (r.j.usageMetadata && typeof r.j.usageMetadata === 'object' ? r.j.usageMetadata : {}) as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  if (!text) {
    const pf = (r.j.promptFeedback && typeof r.j.promptFeedback === 'object' ? r.j.promptFeedback : null) as { blockReason?: string } | null;
    throw new HttpError(400, pf?.blockReason ? `요청이 안전 정책에 걸려 답을 받지 못했습니다 (${pf.blockReason}).` : '답이 비어 있습니다. 요청을 조금 바꿔 보세요.');
  }
  const input = Number(u.promptTokenCount ?? 0), output = Number(u.candidatesTokenCount ?? 0);
  return { text, input, output, total: Number(u.totalTokenCount ?? input + output) };
}

async function callOpenAiCompatible(p: 'openai' | 'xai', key: string, model: string, a: ReturnType<typeof readAsk>): Promise<Answer> {
  const url = p === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
  // OpenAI 의 추론 모델(o1·o3·o4)은 max_tokens·temperature 를 받지 않는다 (max_completion_tokens 만)
  const reasoning = p === 'openai' && /^o\d/.test(model.toLowerCase());
  const body: Record<string, unknown> = {
    model,
    messages: [...(a.system ? [{ role: 'system', content: a.system }] : []), ...a.messages],
    ...(reasoning ? { max_completion_tokens: a.max_tokens } : { max_tokens: a.max_tokens }),
    ...(!reasoning && a.temperature !== null ? { temperature: a.temperature } : {}),
    ...(a.mime === 'application/json' ? { response_format: { type: 'json_object' } } : {}),
  };
  const r = await post(url, { Authorization: `Bearer ${key}` }, body, LIMIT.timeouts[p]);
  if (!r.ok) throw upstreamError(p, r.status, errText(r.j), model);
  const ch = (Array.isArray(r.j.choices) ? r.j.choices : []) as { message?: { content?: string } }[];
  const text = String(ch[0]?.message?.content ?? '').trim();
  const u = (r.j.usage && typeof r.j.usage === 'object' ? r.j.usage : {}) as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  if (!text) throw new HttpError(400, '답이 비어 있습니다. 요청을 조금 바꿔 보세요.');
  const input = Number(u.prompt_tokens ?? 0), output = Number(u.completion_tokens ?? 0);
  return { text, input, output, total: Number(u.total_tokens ?? input + output) };
}

async function callAnthropic(key: string, model: string, a: ReturnType<typeof readAsk>): Promise<Answer> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: a.max_tokens,
    messages: a.messages,
    ...(a.system ? { system: a.system } : {}),
    ...(a.temperature !== null ? { temperature: a.temperature } : {}),
  };
  const r = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body, LIMIT.timeouts.anthropic);
  if (!r.ok) throw upstreamError('anthropic', r.status, errText(r.j), model);
  const blocks = (Array.isArray(r.j.content) ? r.j.content : []) as { type?: string; text?: string }[];
  const text = blocks.filter((x) => x.type === 'text' || x.text).map((x) => String(x.text ?? '')).join('').trim();
  const u = (r.j.usage && typeof r.j.usage === 'object' ? r.j.usage : {}) as { input_tokens?: number; output_tokens?: number };
  if (!text) throw new HttpError(400, '답이 비어 있습니다. 요청을 조금 바꿔 보세요.');
  const input = Number(u.input_tokens ?? 0), output = Number(u.output_tokens ?? 0);
  return { text, input, output, total: input + output };
}

const route = (req: Request) => {
  const p = new URL(req.url).pathname;
  const i = p.indexOf('/hub-ai');
  return (i < 0 ? '/' : p.slice(i + '/hub-ai'.length)).replace(/\/+$/, '') || '/';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const o = req.headers.get('Origin');
  if (o && !ORIGINS.includes(o)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  const path = route(req);
  if (req.method === 'GET' && path === '/health') {
    return json(req, 200, { ok: true, providers: configuredProviders(), default_model: AI_DEFAULTS.defaultModel });
  }
  if (req.method !== 'POST' || (path !== '/' && path !== '/chat')) return json(req, 405, { error: 'POST 만 받습니다.' });

  let actor: Actor | null = null;
  let app: AppRow | null = null;
  let picked: { provider: Provider; model: string; spec: string } | null = null;
  try {
    const rawTok = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1] ?? '';
    if (!rawTok) throw new HttpError(401, 'AI 토큰 또는 로그인이 필요합니다.');

    const t = await req.text();
    if (t.length > LIMIT.maxBody) throw new HttpError(413, '요청이 너무 큽니다.');
    let b: Record<string, unknown>;
    try { b = t ? JSON.parse(t) as Record<string, unknown> : {}; } catch { throw new HttpError(400, 'JSON 형식이 아닙니다.'); }

    // 1) 누가 부르나 — 앱 토큰 또는 허브 로그인(관리자·담당 개발자)
    let ai: AiRow = { enabled: true, allowed_models: null, hourly_limit: null, daily_limit: null, daily_token_limit: null };
    let byTok: Awaited<ReturnType<typeof appByToken>> = null;
    try { byTok = await appByToken(rawTok); }
    catch (e) {
      if (missingTable(e)) throw new HttpError(503, 'AI 기록 표가 아직 준비되지 않았습니다(마이그레이션). 관리자에게 알려 주세요.');
      throw e;
    }
    if (byTok) {
      if (typeof b.slug === 'string' && b.slug && b.slug !== byTok.app.slug) throw new HttpError(403, '토큰과 앱 주소 이름이 맞지 않습니다.');
      app = byTok.app; ai = byTok.ai;
      actor = { kind: 'token', email: `${byTok.app.slug}-fn`, id: null };
    } else {
      const u = await userByJwt(rawTok);
      if (!u) throw new HttpError(401, 'AI 토큰 또는 로그인이 필요합니다.');
      app = await appForUser(u, b.slug);
      actor = { kind: 'user', email: u.email, id: u.id };
      const [row] = await db`select enabled, allowed_models, hourly_limit, daily_limit, daily_token_limit from bmr_admin.ai_tokens where app_id = ${app.id}`;
      if (row) {
        ai = {
          enabled: row.enabled !== false,
          allowed_models: Array.isArray(row.allowed_models) ? (row.allowed_models as string[]).map(String) : null,
          hourly_limit: row.hourly_limit == null ? null : Number(row.hourly_limit),
          daily_limit: row.daily_limit == null ? null : Number(row.daily_limit),
          daily_token_limit: row.daily_token_limit == null ? null : Number(row.daily_token_limit),
        };
      }
    }

    if (app.status !== 'active' && app.status !== 'preparing') {
      await aiLog(app, '', '', { input: 0, output: 0, total: 0 }, 'denied', '앱이 일시 중지·종료 상태', actor?.email ?? '');
      throw new HttpError(403, '이 앱은 지금 AI를 쓸 수 없습니다. (일시 중지·종료 상태)');
    }
    if (!ai.enabled) {
      await aiLog(app, '', '', { input: 0, output: 0, total: 0 }, 'denied', '관리자가 이 앱의 AI 사용을 멈춤', actor?.email ?? '');
      throw new HttpError(403, '이 앱의 AI 사용이 관리자에 의해 멈춰 있습니다. 관리자에게 문의하세요.');
    }

    // 2) 어떤 모델인가 — 허용 목록 안에서만
    const c = await config();
    const allowed = effectiveModels(ai.allowed_models, c.allowed_models);
    if (!allowed.length) throw new HttpError(503, '허용된 AI 모델이 없습니다. 관리자에게 알려 주세요.');
    const want = b.model === undefined || b.model === null || b.model === '' ? c.default_model : b.model;
    picked = parseModelSpec(want);
    if (!picked) throw new HttpError(400, `model 은 '업체:모델' 또는 모델 이름입니다 (예: gemini:gemini-2.5-flash). 받은 값: ${String(want).slice(0, 60)}`);
    if (!modelAllowed(picked, allowed)) {
      await aiLog(app, picked.provider, picked.model, { input: 0, output: 0, total: 0 }, 'denied', `허용되지 않은 모델 ${picked.spec}`, actor?.email ?? '');
      await audit(actor, 'ai:deny', app.slug, 'denied', `허용되지 않은 모델 ${picked.spec}`);
      throw new HttpError(403, `이 앱은 '${picked.spec}' 모델을 쓸 수 없습니다. 쓸 수 있는 모델: ${allowed.slice(0, 6).join(', ')}${allowed.length > 6 ? ' …' : ''}`);
    }
    if (!configuredProviders()[picked.provider]) {
      throw new HttpError(503, `${PROVIDER_LABEL[picked.provider]} 키가 아직 등록되지 않았습니다. 관리자에게 알려 주세요.`);
    }

    // 3) 얼마나 썼나 — 앱별·학교 전체 한도
    const ask = readAsk(b);
    const eff = {
      hourly: limitOf(ai.hourly_limit, c.default_app_hourly),
      daily: limitOf(ai.daily_limit, c.default_app_daily),
      tokens: limitOf(ai.daily_token_limit, c.default_app_daily_tokens),
    };
    const u = await usage(app.id);
    const limited = overLimit(u, eff, c);
    if (limited) {
      await aiLog(app, picked.provider, picked.model, { input: 0, output: 0, total: 0 }, 'denied', limited, actor?.email ?? '');
      await audit(actor, 'ai:deny', app.slug, 'denied', `한도 · ${picked.spec} · ${limited}`);
      throw new HttpError(429, limited);
    }

    // 4) 부르기
    const key = await providerKey(picked.provider);
    let ans: Answer;
    try {
      ans = picked.provider === 'gemini' ? await callGemini(key, picked.model, ask)
        : picked.provider === 'anthropic' ? await callAnthropic(key, picked.model, ask)
          : await callOpenAiCompatible(picked.provider, key, picked.model, ask);
    } catch (e) {
      if (e instanceof HttpError) {
        await aiLog(app, picked.provider, picked.model, { input: 0, output: 0, total: 0 }, 'error', `${e.status} ${e.message}`, actor?.email ?? '');
        await audit(actor, 'ai:call', app.slug, 'error', `${picked.spec} · ${e.status} ${e.message}`.slice(0, 400));
        throw e;
      }
      throw e;
    }

    await aiLog(app, picked.provider, picked.model, { input: ans.input, output: ans.output, total: ans.total }, 'ok', '', actor?.email ?? '');
    await audit(actor, 'ai:call', app.slug, 'ok', `${picked.spec} · ${ans.total} 토큰`);
    return json(req, 200, {
      ok: true,
      app: app.slug,
      provider: picked.provider,
      model: picked.model,
      text: ans.text,
      usage: { input_tokens: ans.input, output_tokens: ans.output, total_tokens: ans.total },
    });
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    if (missingTable(e)) return json(req, 503, { error: 'AI 기록 표가 아직 준비되지 않았습니다(마이그레이션). 관리자에게 알려 주세요.' });
    console.error('hub-ai', (e as Error)?.name ?? '', String((e as Error)?.message ?? e).slice(0, 200));
    if (app && picked) await aiLog(app, picked.provider, picked.model, { input: 0, output: 0, total: 0 }, 'error', '서버 오류', actor?.email ?? '');
    const timedOut = /abort|timeout/i.test(String((e as Error)?.name ?? '') + String((e as Error)?.message ?? ''));
    return json(req, timedOut ? 502 : 500, { error: timedOut ? 'AI 응답이 너무 늦습니다. 잠시 뒤 다시 시도하세요.' : '서버 오류가 났습니다.' });
  }
});
