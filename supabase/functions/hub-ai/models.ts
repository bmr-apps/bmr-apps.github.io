// hub-ai 의 순수 규칙 (Deno.env·네트워크 없음) — hub-ai/index.ts 가 쓰고, scripts/test-selfservice-rules.mjs 가 시험한다.
// hub-devtools/rules.ts 의 AI 부분과 같은 결과여야 한다 (시험이 두 파일을 같은 입력으로 비교한다).
// 값(기본 모델·한도·상한)은 hub-ai/index.ts 의 LIMIT·기본값과 같아야 한다 (시험이 확인).

export type Provider = 'gemini' | 'openai' | 'anthropic' | 'xai';
export const PROVIDERS: readonly Provider[] = ['gemini', 'openai', 'anthropic', 'xai'] as const;
export const PROVIDER_LABEL: Record<Provider, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', xai: 'Grok' };

/** 학교 전체 기본값 — 마이그레이션 20261115100000_hub_ai 의 ai_config 기본값과 같아야 한다 */
export const AI_DEFAULTS = {
  defaultModel: 'gemini:gemini-2.5-flash',
  defaultAppHourly: 60,
  defaultAppDaily: 500,
  defaultAppDailyTokens: 500_000,
  globalDailyRequests: 3_000,
  globalDailyTokens: 5_000_000,
  /** 앱 하나의 허용 모델 목록은 이만큼까지 */
  allowedModelsMax: 50,
} as const;

/** 허용 모델 목록의 시작값 (새 설정을 만들 때 화면에서 제안)
 *  · 텍스트 모델과 함께 음성(-tts)·이미지(-image) 모델도 넣는다 (hub-ai/tts · hub-ai/image) */
export const STARTER_MODELS: readonly string[] = [
  'gemini:gemini-2.5-flash',
  'gemini:gemini-2.5-pro',
  'gemini:gemini-2.5-flash-lite',
  'gemini:gemini-2.5-flash-preview-tts',
  'gemini:gemini-2.5-flash-image',
  'gemini:gemini-3.1-flash-tts-preview',
  'gemini:gemini-3.1-flash-image',
  'openai:gpt-4o-mini',
  'openai:gpt-4o',
  'openai:gpt-4o-mini-tts',
  'anthropic:claude-3-5-haiku-latest',
  'anthropic:claude-sonnet-4-5',
  'xai:grok-3-mini',
  'xai:grok-3',
] as const;

// ---------- 음성(TTS)·이미지 생성 ----------
/** 요청에 모델을 안 적었을 때 쓰는 음성 모델 (Gemini TTS) */
export const TTS_DEFAULT_MODEL = 'gemini:gemini-2.5-flash-preview-tts';
/** 요청에 모델을 안 적었을 때 쓰는 이미지 모델 (Gemini 이미지) */
export const IMAGE_DEFAULT_MODEL = 'gemini:gemini-2.5-flash-image';
/** 음성을 만들 수 있는 업체 — Gemini 는 generateContent, OpenAI 는 /v1/audio/speech */
export const TTS_PROVIDERS: readonly Provider[] = ['gemini', 'openai'] as const;
/** 이미지를 만들 수 있는 업체 (지금은 Gemini 만) */
export const IMAGE_PROVIDERS: readonly Provider[] = ['gemini'] as const;
/** 업체별 기본 음성 이름 — Gemini prebuilt voice(Kore·Puck…)와 OpenAI voice(alloy·nova…) */
export const TTS_DEFAULT_VOICE: Record<'gemini' | 'openai', string> = { gemini: 'Kore', openai: 'alloy' };
/** 음성 이름 모양 (Kore · Puck · alloy …) — 있는 이름인지는 업체가 최종 판정한다 */
export const VOICE_RE = /^[A-Za-z][A-Za-z0-9_-]{1,29}$/;
/** 한 번에 읽어 줄 글자 수 상한 (TTS 는 글자 수가 곧 길이·값이다) */
export const MAX_TTS_CHARS = 8_000;
/** 이미지 비율 — 업체가 받는 값만 통과시킨다 (생략하면 모델이 정한다) */
export const IMAGE_ASPECTS: readonly string[] = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1',
] as const;

export type Tts = { text: string; voice: string; format: '' | 'wav' | 'mp3' };
export type TtsResult = { ok: true; tts: Tts } | { ok: false; status: number; message: string };
/**
 * 음성 요청 본문 → 읽을 글·음성·형식. 형식이 틀리면 400, 글이 너무 길면 413.
 *  · text (또는 prompt) · voice · format('wav'|'mp3', 비우면 업체 기본)
 */
export function normalizeTts(b: Record<string, unknown>): TtsResult {
  const bad = (status: number, message: string): TtsResult => ({ ok: false, status, message });
  const raw = typeof b.text === 'string' ? b.text : typeof b.prompt === 'string' ? b.prompt : '';
  const text = raw.trim();
  if (!text) return bad(400, '읽어 줄 글을 text(또는 prompt)에 적어 주세요.');
  if (text.length > MAX_TTS_CHARS) return bad(413, `한 번에 읽어 줄 글은 ${MAX_TTS_CHARS.toLocaleString('en-US')}자까지입니다.`);
  const voice = typeof b.voice === 'string' ? b.voice.trim() : '';
  if (voice && !VOICE_RE.test(voice)) return bad(400, "voice 는 영문으로 시작하는 2~30자입니다 (예: 'Kore', 'Puck', 'alloy').");
  const f = typeof b.format === 'string' ? b.format.trim().toLowerCase() : '';
  if (f && f !== 'wav' && f !== 'mp3') return bad(400, "format 은 'wav' 또는 'mp3' 입니다. (비우면 업체 기본)");
  return { ok: true, tts: { text, voice, format: f as Tts['format'] } };
}

export type Img = { prompt: string; aspect: string };
export type ImgResult = { ok: true; img: Img } | { ok: false; status: number; message: string };
/**
 * 이미지 요청 본문 → 그릴 글·비율. 형식이 틀리면 400, 글이 너무 길면 413.
 *  · prompt (또는 text) · aspect_ratio(예: '1:1', '16:9')
 */
export function normalizeImage(b: Record<string, unknown>): ImgResult {
  const bad = (status: number, message: string): ImgResult => ({ ok: false, status, message });
  const raw = typeof b.prompt === 'string' ? b.prompt : typeof b.text === 'string' ? b.text : '';
  const prompt = raw.trim();
  if (!prompt) return bad(400, '그릴 내용을 prompt 에 적어 주세요.');
  if (prompt.length > MAX_CHARS) return bad(413, `한 번에 보내는 글이 너무 깁니다 (${MAX_CHARS}자까지).`);
  if (b.aspect_ratio !== undefined && b.aspect_ratio !== null && typeof b.aspect_ratio !== 'string') {
    return bad(400, "aspect_ratio 는 '16:9' 같은 글자입니다. (비우면 모델이 정함)");
  }
  const aspect = typeof b.aspect_ratio === 'string' ? b.aspect_ratio.trim() : '';
  if (aspect && !IMAGE_ASPECTS.includes(aspect)) {
    return bad(400, `aspect_ratio 는 ${IMAGE_ASPECTS.join(' · ')} 중 하나입니다. (비우면 모델이 정함)`);
  }
  return { ok: true, img: { prompt, aspect } };
}

/**
 * Gemini 가 돌려주는 PCM(보통 audio/L16;codec=pcm;rate=24000)을 브라우저가 바로 재생하는 wav 로 감싼다.
 * 44바이트 RIFF 헤더를 앞에 붙이고 나머지는 원본 바이트 그대로다.
 */
export function pcmToWav(pcm: Uint8Array, opts: { sampleRate?: number; channels?: number; bits?: number } = {}): Uint8Array {
  const rate = opts.sampleRate && opts.sampleRate > 0 ? Math.trunc(opts.sampleRate) : 24_000;
  const ch = opts.channels && opts.channels > 0 ? Math.trunc(opts.channels) : 1;
  const bits = opts.bits ?? 16;
  const block = ch * Math.max(1, Math.trunc(bits / 8));
  const out = new Uint8Array(44 + pcm.length);
  const dv = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length, true); tag(8, 'WAVE');
  tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * block, true); dv.setUint16(32, block, true); dv.setUint16(34, bits, true);
  tag(36, 'data'); dv.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** 업체가 알려 준 mimeType 에서 샘플레이트를 읽는다 (audio/L16;codec=pcm;rate=24000 → 24000) */
export function sampleRateOf(mime: string): number | null {
  const m = String(mime ?? '');
  const rate = /rate=(\d{3,6})/i.exec(m)?.[1];
  if (rate) return Number(rate);
  return null;
}

/** 업체가 돌려준 오디오 mimeType 이 이미 wav·mp3 같은 그릇인지 (아니면 PCM 이라 wav 로 감싸야 한다) */
export function isContainerAudio(mime: string): boolean {
  return /^audio\/(wav|x-wav|mpeg|mp3|ogg|opus|webm|flac|aac|mp4)/i.test(String(mime ?? '').trim());
}

/** max_tokens 를 안 적었을 때 */
export const AI_DEFAULT_TOKENS = 1024;

export type AskMsg = { role: 'user' | 'assistant'; content: string };
export type Ask = { messages: AskMsg[]; system: string; temperature: number | null; max_tokens: number; mime: string };
export type AskResult = { ok: true; ask: Ask } | { ok: false; status: number; message: string };

/**
 * 요청 본문 → 부를 내용. 앱이 보낸 값을 그대로 업체에 넘기지 않고 여기서 한 번 검사한다.
 *  · messages: [{ role: 'user'|'assistant', content }] · prompt · system · temperature(0~2) · max_tokens(1~MAX_TOKENS_CAP) · response_mime_type
 *  · 글자 수(프롬프트+시스템+대화) 합계가 MAX_CHARS 를 넘으면 413, 형식이 틀리면 400
 */
export function normalizeAsk(b: Record<string, unknown>): AskResult {
  const bad = (status: number, message: string): AskResult => ({ ok: false, status, message });
  const sysRaw = typeof b.system === 'string' ? b.system : '';
  const list: AskMsg[] = [];
  const push = (role: unknown, content: unknown): AskResult | null => {
    const r = role === 'assistant' || role === 'model' ? 'assistant' : role === 'user' ? 'user' : null;
    if (!r) return bad(400, "messages 의 role 은 'user' 또는 'assistant' 만 됩니다. (system 은 system 칸에)");
    if (typeof content !== 'string') return bad(400, 'messages 의 content 는 글자여야 합니다.');
    const c = content.trim();
    if (!c) return bad(400, '비어 있는 메시지가 있습니다.');
    list.push({ role: r, content: c });
    return null;
  };
  if (b.messages !== undefined && b.messages !== null) {
    if (!Array.isArray(b.messages)) return bad(400, 'messages 는 [{ role, content }] 배열이어야 합니다.');
    if (b.messages.length > MAX_MESSAGES) return bad(400, `한 번에 ${MAX_MESSAGES}개 메시지까지 보낼 수 있습니다.`);
    for (const m of b.messages) {
      if (!m || typeof m !== 'object') return bad(400, 'messages 안에 잘못된 값이 있습니다.');
      const o = m as { role?: unknown; content?: unknown };
      const err = push(o.role ?? 'user', o.content);
      if (err) return err;
    }
  }
  if (typeof b.prompt === 'string' && b.prompt.trim()) {
    const err = push('user', b.prompt);
    if (err) return err;
  }
  if (!list.length) return bad(400, 'prompt 또는 messages 를 적어 주세요.');
  const chars = list.reduce((n, m) => n + m.content.length, 0) + sysRaw.length;
  if (chars > MAX_CHARS) return bad(413, `한 번에 보내는 글이 너무 깁니다 (${MAX_CHARS}자까지).`);
  const temp = b.temperature === undefined || b.temperature === null ? null : Number(b.temperature);
  if (temp !== null && (!Number.isFinite(temp) || temp < 0 || temp > 2)) return bad(400, 'temperature 는 0 ~ 2 사이 숫자입니다.');
  const mt = b.max_tokens === undefined || b.max_tokens === null ? AI_DEFAULT_TOKENS : Number(b.max_tokens);
  if (!Number.isFinite(mt) || mt < 1) return bad(400, 'max_tokens 는 1 이상 숫자입니다.');
  if (mt > MAX_TOKENS_CAP) return bad(400, `max_tokens 는 ${MAX_TOKENS_CAP}까지입니다.`);
  const mime = typeof b.response_mime_type === 'string' ? b.response_mime_type.trim().slice(0, 60) : '';
  return { ok: true, ask: { messages: list, system: sysRaw.trim(), temperature: temp, max_tokens: Math.trunc(mt), mime } };
}

/** 업체가 받는 모델 이름 모양: 영문·숫자로 시작, 영문·숫자·점·하이픈·밑줄 100자까지 (예: gemini-2.5-flash) */
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** 한 요청의 전체 글자 수 상한 (프롬프트·시스템·이전 대화 모두) */
export const MAX_CHARS = 100_000;
/** 한 요청의 메시지 수 상한 */
export const MAX_MESSAGES = 50;
/** max_tokens 상한 */
export const MAX_TOKENS_CAP = 32_000;
export const MODEL_SPEC_MAX = 120;

/** 업체 이름이 없을 때 모델 이름으로 업체를 짐작한다 */
export function inferProvider(model: string): Provider | null {
  const m = String(model ?? '').trim().toLowerCase();
  if (!m) return null;
  if (m.startsWith('gemini-')) return 'gemini';
  if (/^(gpt-|chatgpt-|o1|o3|o4)/.test(m)) return 'openai';
  if (m.startsWith('claude-')) return 'anthropic';
  if (m.startsWith('grok-')) return 'xai';
  return null;
}

export type ModelSpec = { provider: Provider; model: string; spec: string };

/**
 * 'provider:model' 또는 'model' 하나를 { provider, model, spec } 로 푼다. 못 풀면 null.
 *   'gemini:gemini-2.5-flash' → gemini + gemini-2.5-flash
 *   'gpt-4o-mini'            → openai + gpt-4o-mini (이름으로 업체 짐작)
 *   'claude-3-5-haiku-latest'→ anthropic
 */
export function parseModelSpec(raw: unknown): ModelSpec | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > MODEL_SPEC_MAX) return null;
  const i = s.indexOf(':');
  if (i > 0) {
    const p = s.slice(0, i).trim().toLowerCase();
    const model = s.slice(i + 1).trim();
    if (!(PROVIDERS as readonly string[]).includes(p)) return null;
    if (!MODEL_RE.test(model)) return null;
    return { provider: p as Provider, model, spec: `${p}:${model}` };
  }
  if (!MODEL_RE.test(s)) return null;
  const p = inferProvider(s);
  return p ? { provider: p, model: s, spec: `${p}:${s}` } : null;
}

/** 허용 목록 비교용 열쇠: 업체 이름 대소문자·앞뒤 공백을 없앤 'provider:model' */
export const specKey = (raw: unknown): string => parseModelSpec(raw)?.spec.toLowerCase() ?? '';

/**
 * 허용 목록(배열 또는 줄바꿈·쉼표로 이은 글)을 정리한다.
 *  · 맞는 것만 남기고 중복은 버린다
 *  · bad 에는 형식이 틀린 입력(최대 5개)을 담아 화면에 보여 준다
 */
export function normalizeModelList(input: unknown): { list: string[]; bad: string[] } {
  const parts: string[] = [];
  if (typeof input === 'string') parts.push(...input.split(/[\n,]+/));
  else if (Array.isArray(input)) for (const x of input) if (typeof x === 'string') parts.push(...x.split(/[\n,]+/));
  const list: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const m = parseModelSpec(t);
    if (!m) { if (bad.length < 5 && !bad.includes(t.slice(0, 60))) bad.push(t.slice(0, 60)); continue; }
    const k = m.spec.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(m.spec);
  }
  return { list, bad };
}

/** 이 앱이 쓸 수 있는 모델: 앱 목록이 있으면 그것, 없으면 학교 전체 목록 */
export function effectiveModels(appAllowed: string[] | null | undefined, globalAllowed: unknown): string[] {
  const own = Array.isArray(appAllowed) && appAllowed.length ? appAllowed : null;
  return normalizeModelList(own ?? globalAllowed).list;
}

/** 요청한 모델이 허용 목록에 있는지 (업체 이름 생략·대소문자 차이는 같은 것으로 본다) */
export function modelAllowed(spec: ModelSpec, allowed: string[]): boolean {
  const k = spec.spec.toLowerCase();
  return allowed.some((x) => specKey(x) === k);
}

/** 앱 한도: 앱이 정한 값이 있으면 그것, 없으면 학교 전체 기본값 */
export const limitOf = (own: unknown, fallback: number): number => (typeof own === 'number' && Number.isFinite(own) && own >= 0 ? Math.trunc(own) : fallback);

/**
 * AI 토큰 상태: 활성 = 해시와 비밀값이 둘 다 있음 · 미발급 = 둘 다 없음 · 불일치 = 한쪽만 있어 토큰이 맞지 않음(재발급 필요)
 * (hub-mail 의 mailState 와 같은 기준)
 */
export function aiState(hasTokenHash: boolean, hasSecret: boolean): 'active' | 'none' | 'mismatch' {
  if (hasTokenHash && hasSecret) return 'active';
  if (!hasTokenHash && !hasSecret) return 'none';
  return 'mismatch';
}
