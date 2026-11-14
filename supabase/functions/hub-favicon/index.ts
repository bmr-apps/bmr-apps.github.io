// 공개 파비콘: 허브 카드 꾸미기(로고 > 이모지 > 자동)를 앱 탭 아이콘으로 돌려준다.
// GET /functions/v1/hub-favicon?slug=<주소이름>  (인증 없음)
// 아이콘·색 계산은 허브 src/ui.tsx 와 같게 유지한다.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const SB_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}$/;
const CACHE = 'public, max-age=3600, stale-while-revalidate=86400';
const HUB_HOST = 'psupfmarnyxontorftio.supabase.co';

// src/ui.tsx 와 동일
const ICONS: Record<string, string> = { library: '📚', lib: '📚', attendance: '🗓️', meal: '🍱', survey: '📋', calendar: '🗓️', notice: '📢', grade: '📊' };
const POOL = ['🚀', '🧩', '🌱', '🔭', '🧪', '📒', '🎒', '🛠️', '💡', '🌟'];
function appIcon(slug: string) {
  if (ICONS[slug]) return ICONS[slug];
  let h = 0; for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return POOL[h % POOL.length];
}
const TONES = ['violet', 'blue', 'teal', 'pink', 'amber', 'green'];
function appTone(slug: string) { let h = 7; for (const c of slug) h = (h * 17 + c.charCodeAt(0)) >>> 0; return TONES[h % TONES.length]; }
const CARD_TONES = ['violet', 'blue', 'teal', 'pink', 'amber', 'green', 'navy'] as const;
/** src/style.css 의 --tone-strong 값 */
const TONE_HEX: Record<string, string> = {
  violet: '#7e65c1', blue: '#0abbee', teal: '#02c245', pink: '#ff614a',
  amber: '#ffdc1a', green: '#02c245', navy: '#053d6b',
};
function isHexColor(s: string) { return /^#[0-9A-Fa-f]{6}$/.test(s); }
function isEmojiIcon(s: string) {
  const t = s.trim();
  return t.length >= 1 && t.length <= 32 && !/[<>&'"`@A-Za-z0-9\\\x00-\x1f\/]/.test(t);
}
function cardBg(slug: string, color?: string | null): string {
  if (color && isHexColor(color)) return color;
  if (color && (CARD_TONES as readonly string[]).includes(color) && TONE_HEX[color]) return TONE_HEX[color];
  return TONE_HEX[appTone(slug)] ?? '#0abbee';
}
function safeLogoUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const hostOk = u.hostname === HUB_HOST || (SB_URL && u.origin === SB_URL);
    if (!hostOk) return null;
    if (!/^\/storage\/v1\/object\/public\/hub-assets\/logos\/[a-z0-9][a-z0-9-]{1,38}\/[A-Za-z0-9._-]+$/.test(u.pathname)) return null;
    if (u.search || u.hash) return null;
    return `${u.origin}${u.pathname}`;
  } catch { return null; }
}

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function svgIcon(bg: string, emoji: string) {
  const fill = isHexColor(bg) ? bg : '#0abbee';
  const e = escXml(emoji.trim().slice(0, 32));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">`
    + `<rect width="128" height="128" fill="${fill}"/>`
    + `<text x="64" y="80" text-anchor="middle" font-size="72">${e}</text>`
    + `</svg>`;
}
const defaultSvg = () => svgIcon('#0abbee', '🌟');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey',
};
function svgRes(svg: string, head = false) {
  const headers = { ...cors, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': CACHE, 'X-Content-Type-Options': 'nosniff' };
  return new Response(head ? null : svg, { status: 200, headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { ...cors, 'Cache-Control': 'public, max-age=86400' } });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('GET만 받습니다.', { status: 405, headers: cors });
  }
  const head = req.method === 'HEAD';
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!SLUG_RE.test(slug) || !SERVICE) return svgRes(defaultSvg(), head);
  try {
    const { data, error } = await admin.from('apps')
      .select('slug, card_icon, card_logo_url, card_color')
      .eq('slug', slug).eq('status', 'active').maybeSingle();
    if (error || !data) return svgRes(defaultSvg(), head);
    const logo = safeLogoUrl(data.card_logo_url);
    if (logo) {
      return new Response(null, { status: 302, headers: { ...cors, Location: logo, 'Cache-Control': CACHE } });
    }
    const emoji = (data.card_icon && isEmojiIcon(data.card_icon) ? data.card_icon.trim() : appIcon(data.slug));
    return svgRes(svgIcon(cardBg(data.slug, data.card_color), emoji), head);
  } catch {
    return svgRes(defaultSvg(), head);
  }
});
