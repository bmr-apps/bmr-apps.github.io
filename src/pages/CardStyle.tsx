import { useEffect, useRef, useState, type FormEvent } from 'react';
import { sb, errMsg, type App } from '../sb';
import {
  AppGlyph, CARD_TONES, CARD_TONE_LABEL, EMOJI_PICKER,
  appIcon, appTone, cardTone, cardToneStyle, isEmojiIcon, isHexColor, safeLogoUrl, type CardStyle,
} from '../ui';

const MAX_BYTES = 512 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

type IconMode = 'auto' | 'emoji' | 'logo';
type ColorMode = 'auto' | 'palette' | 'custom';

function init(app: App) {
  const logo = safeLogoUrl(app.card_logo_url);
  const color = app.card_color;
  return {
    iconMode: (logo ? 'logo' : app.card_icon ? 'emoji' : 'auto') as IconMode,
    emoji: (app.card_icon && isEmojiIcon(app.card_icon) ? app.card_icon : appIcon(app.slug)),
    colorMode: (!color ? 'auto' : isHexColor(color) ? 'custom' : 'palette') as ColorMode,
    tone: (color && (CARD_TONES as readonly string[]).includes(color) ? color : appTone(app.slug)) as (typeof CARD_TONES)[number],
    hex: color && isHexColor(color) ? color : '#7e65c1',
  };
}

async function removeLogos(slug: string, keep?: string) {
  const { data } = await sb.storage.from('hub-assets').list(`logos/${slug}`);
  const rest = (data ?? []).map((f) => `logos/${slug}/${f.name}`).filter((p) => p !== keep);
  if (rest.length) await sb.storage.from('hub-assets').remove(rest);
}


const HUB_ORIGIN = 'https://apps.bmrschool.net';
function isHttpUrl(s: string) {
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}
function isDataOrHubFavicon(href: string) {
  if (href.startsWith('data:')) return true;
  try {
    const u = new URL(href);
    return u.hostname === 'psupfmarnyxontorftio.supabase.co' && /\/functions\/v1\/hub-favicon\/?$/.test(u.pathname);
  } catch { return false; }
}
function looksLikeHubShell(html: string) {
  return /<title>BMR APPS · 앱 관리<\/title>/.test(html);
}
function pickFaviconHref(html: string, base: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = [...doc.querySelectorAll('link[rel]')];
  const has = (el: Element, token: string) => (el.getAttribute('rel') || '').split(/\s+/).some((r) => r.toLowerCase() === token);
  const apple = links.find((el) => has(el, 'apple-touch-icon') && el.getAttribute('href'));
  const icon = links.find((el) => (has(el, 'icon') || has(el, 'shortcut')) && el.getAttribute('href'));
  const href = apple?.getAttribute('href') || icon?.getAttribute('href') || new URL('favicon.ico', base).href;
  return new URL(href, base).href;
}
async function toPngFile(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('파비콘 이미지를 읽지 못했어요.'));
      i.src = url;
    });
    const max = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height) || 128;
    let size = max;
    if (size > 256) size = 256;
    if (size < 128) size = 128;
    const scale = size / max;
    const w = Math.max(1, Math.round((img.naturalWidth || img.width || size) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height || size) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이미지를 변환하지 못했어요.');
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('PNG로 바꾸지 못했어요.')), 'image/png');
    });
    if (out.size > MAX_BYTES) throw new Error('로고는 512KB 이하만 올릴 수 있어요.');
    return new File([out], 'favicon.png', { type: 'image/png' });
  } finally { URL.revokeObjectURL(url); }
}

/** 앱 정보 창: 관리자 또는 그 앱 담당 개발자가 카드 아이콘·색을 정함. 기본은 자동 지정. */
export function CardStyleSection({ app, onSaved }: { app: App; onSaved: () => void }) {
  const [s, setS] = useState(() => init(app));
  const [file, setFile] = useState<File | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    setS(init(app)); setFile(null); setPreviewSrc(null); setErr(''); setMsg('');
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
  }, [app.id, app.card_icon, app.card_logo_url, app.card_color, app.updated_at]);
  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const pickFile = (f: File | null) => {
    setErr(''); setMsg('');
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    if (!f) { setFile(null); setPreviewSrc(null); return; }
    if (!EXT[f.type]) { setFile(null); setPreviewSrc(null); return setErr('PNG, JPG, WebP 이미지만 올릴 수 있어요. SVG는 사용할 수 없습니다.'); }
    if (f.size > MAX_BYTES) { setFile(null); setPreviewSrc(null); return setErr('로고는 512KB 이하만 올릴 수 있어요.'); }
    const url = URL.createObjectURL(f);
    blobRef.current = url;
    setFile(f); setPreviewSrc(url); setS((x) => ({ ...x, iconMode: 'logo' }));
  };

  const importFavicon = async () => {
    setErr(''); setMsg('');
    setImporting(true);
    try {
      const sameOrigin = `${HUB_ORIGIN}/${app.slug}/`;
      let html = '';
      let base = sameOrigin;
      try {
        const r = await fetch(sameOrigin, { credentials: 'omit' });
        if (r.ok || r.status === 404) { html = await r.text(); base = r.url || sameOrigin; }
      } catch { /* 앱이 다른 주소면 아래에서 한 번 더 시도 */ }
      const onHubShell = !html || looksLikeHubShell(html);
      if (onHubShell && isHttpUrl(app.url) && new URL(app.url).origin !== HUB_ORIGIN) {
        try {
          const r = await fetch(app.url, { credentials: 'omit' });
          if (!r.ok) throw new Error(`앱 페이지를 열지 못했어요 (${r.status}).`);
          html = await r.text();
          base = r.url || app.url;
        } catch (e) {
          if (e instanceof TypeError) throw new Error('앱이 다른 주소에 있어서 파비콘을 가져오지 못했어요. 브라우저가 막을 수 있어요. 파일을 직접 올려 주세요.');
          throw e;
        }
      } else if (!html) {
        throw new Error('앱 페이지를 열지 못했어요. 주소가 열려 있는지 확인해 주세요.');
      }
      const href = pickFaviconHref(html, base.endsWith('/') ? base : `${base}/`);
      if (isDataOrHubFavicon(href)) {
        setMsg('앱에 따로 정한 파비콘이 없어요. 지금은 카드 아이콘이 파비콘으로 쓰이고 있어요.');
        return;
      }
      let blob: Blob;
      try {
        const ir = await fetch(href, { credentials: 'omit', mode: 'cors' });
        if (!ir.ok) throw new Error('파비콘 파일을 받지 못했어요.');
        blob = await ir.blob();
      } catch (e) {
        if (e instanceof TypeError) throw new Error('파비콘 이미지가 다른 사이트에 있어서 가져오지 못했어요. 파일을 직접 올려 주세요.');
        throw e;
      }
      const f = await toPngFile(blob);
      pickFile(f);
      setMsg('파비콘을 가져왔어요. 미리보기를 확인하고 「카드 모습 저장」을 눌러 주세요.');
    } catch (er) { setErr(errMsg(er)); }
    finally { setImporting(false); }
  };

  const preview: CardStyle = {
    slug: app.slug, name: app.name,
    card_icon: s.iconMode === 'emoji' ? s.emoji : null,
    card_logo_url: s.iconMode === 'logo' ? (previewSrc ? null : app.card_logo_url) : null,
    card_color: s.colorMode === 'auto' ? null : s.colorMode === 'custom' ? s.hex : s.tone,
  };
  const tone = cardTone(app.slug, preview.card_color);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    try {
      let card_icon: string | null = null;
      let card_logo_url: string | null = null;
      if (s.iconMode === 'emoji') {
        const icon = s.emoji.trim();
        if (!isEmojiIcon(icon)) throw new Error('이모지를 하나 골라 주세요. 글자나 기호는 넣을 수 없어요.');
        card_icon = icon;
      } else if (s.iconMode === 'logo') {
        if (file) {
          const ext = EXT[file.type];
          const path = `logos/${app.slug}/logo-${Date.now()}.${ext}`;
          const up = await sb.storage.from('hub-assets').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
          if (up.error) throw up.error;
          card_logo_url = sb.storage.from('hub-assets').getPublicUrl(path).data.publicUrl;
          if (!safeLogoUrl(card_logo_url)) throw new Error('로고 주소를 확인하지 못했습니다. 다시 시도해 주세요.');
        } else if (safeLogoUrl(app.card_logo_url)) {
          card_logo_url = safeLogoUrl(app.card_logo_url);
        } else {
          throw new Error('로고 이미지 파일을 올려 주세요.');
        }
        if (app.card_icon && isEmojiIcon(app.card_icon)) card_icon = app.card_icon; // 로고를 빼면 쓰던 이모지로 돌아가게
      }
      let card_color: string | null = null;
      if (s.colorMode === 'palette') card_color = s.tone;
      if (s.colorMode === 'custom') {
        if (!isHexColor(s.hex)) throw new Error('색 값은 #과 16진수 6자리로 적어 주세요. 예: #7e65c1');
        card_color = s.hex;
      }
      const { error } = await sb.from('apps').update({ card_icon, card_logo_url, card_color }).eq('id', app.id);
      if (error) throw error;
      if (s.iconMode !== 'logo' || file) {
        const keep = card_logo_url ? new URL(card_logo_url).pathname.split('/storage/v1/object/public/hub-assets/').pop() : undefined;
        await removeLogos(app.slug, keep && keep.startsWith(`logos/${app.slug}/`) ? keep : undefined);
      }
      setFile(null);
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
      setPreviewSrc(null);
      setMsg('카드 모습을 저장했어요.');
      onSaved();
    } catch (er) { setErr(errMsg(er)); }
    finally { setBusy(false); }
  };

  const resetAuto = async () => {
    if (!confirm('아이콘과 색을 모두 자동 지정으로 되돌릴까요? 올려 둔 로고는 지워집니다.')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const { error } = await sb.from('apps').update({ card_icon: null, card_logo_url: null, card_color: null }).eq('id', app.id);
      if (error) throw error;
      await removeLogos(app.slug);
      setS(init({ ...app, card_icon: null, card_logo_url: null, card_color: null }));
      setFile(null); setPreviewSrc(null);
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
      setMsg('자동 지정으로 되돌렸어요.');
      onSaved();
    } catch (er) { setErr(errMsg(er)); }
    finally { setBusy(false); }
  };

  return (
    <form className="card-style" onSubmit={save}>
      <h4>🎨 카드 꾸미기</h4>
      <p className="muted">첫 화면과 서비스 목록에 보이는 아이콘과 색을 정해요. 고르지 않으면 주소 이름으로 자동 지정됩니다.</p>

      <div className={`tile preview tone-${tone}`} style={cardToneStyle(preview.card_color)} aria-hidden="true">
        <AppGlyph app={preview} previewSrc={s.iconMode === 'logo' ? previewSrc : null} alt="" />
        <b className="tile-title">{app.name}</b>
        <span className="tile-desc">{app.description || '설명이 없습니다.'}</span>
      </div>

      <fieldset>
        <legend>아이콘</legend>
        <div className="pills" role="radiogroup" aria-label="아이콘 종류">
          {([['auto', '자동'], ['emoji', '이모지'], ['logo', '로고']] as const).map(([k, label]) => (
            <button type="button" key={k} role="radio" aria-checked={s.iconMode === k} className={`pill${s.iconMode === k ? ' on' : ''}`}
              onClick={() => setS((x) => ({ ...x, iconMode: k }))}>{label}</button>
          ))}
        </div>
        {s.iconMode === 'auto' && <p className="muted small-note">지금 자동 아이콘은 {appIcon(app.slug)} 입니다.</p>}
        {s.iconMode === 'emoji' && <>
          <div className="emoji-grid" role="listbox" aria-label="이모지 고르기">
            {EMOJI_PICKER.map((e) => (
              <button type="button" key={e} role="option" aria-selected={s.emoji === e} aria-label={`이모지 ${e}`}
                className={s.emoji === e ? 'on' : ''} onClick={() => setS((x) => ({ ...x, emoji: e }))}>{e}</button>
            ))}
          </div>
          <label>다른 이모지 직접 넣기
            <input value={s.emoji} onChange={(e) => setS((x) => ({ ...x, emoji: e.target.value }))} maxLength={32} aria-label="이모지 직접 입력" />
          </label>
        </>}
        {s.iconMode === 'logo' && <>
          <label>로고 이미지 (PNG, JPG, WebP, 최대 512KB)
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </label>
          <div className="logo-actions">
            <button type="button" className="ghost" disabled={busy || importing} onClick={importFavicon}>
              {importing ? '가져오는 중…' : '앱 파비콘 가져오기'}
            </button>
          </div>
          {(previewSrc || safeLogoUrl(app.card_logo_url)) && <p className="muted small-note">아이콘 칸에 맞춰 줄어 보여요. SVG는 보안상 쓸 수 없습니다.</p>}
        </>}
      </fieldset>

      <fieldset>
        <legend>색</legend>
        <div className="pills" role="radiogroup" aria-label="색 지정 방식">
          {([['auto', '자동'], ['palette', '팔레트'], ['custom', '직접 고르기']] as const).map(([k, label]) => (
            <button type="button" key={k} role="radio" aria-checked={s.colorMode === k} className={`pill${s.colorMode === k ? ' on' : ''}`}
              onClick={() => setS((x) => ({ ...x, colorMode: k }))}>{label}</button>
          ))}
        </div>
        {s.colorMode === 'auto' && <p className="muted small-note">주소 이름으로 색이 정해집니다.</p>}
        {s.colorMode === 'palette' && (
          <div className="swatches" role="radiogroup" aria-label="카드 색">
            {CARD_TONES.map((t) => (
              <button type="button" key={t} role="radio" aria-checked={s.tone === t} aria-label={CARD_TONE_LABEL[t]}
                title={CARD_TONE_LABEL[t]} className={`swatch tone-${t}${s.tone === t ? ' on' : ''}`}
                onClick={() => setS((x) => ({ ...x, tone: t }))} />
            ))}
          </div>
        )}
        {s.colorMode === 'custom' && (
          <div className="row hex-row">
            <label>색 고르기
              <input type="color" value={isHexColor(s.hex) ? s.hex : '#7e65c1'} aria-label="색 고르기"
                onChange={(e) => setS((x) => ({ ...x, hex: e.target.value }))} />
            </label>
            <label>색 값
              <input value={s.hex} onChange={(e) => setS((x) => ({ ...x, hex: e.target.value }))} placeholder="#7e65c1" aria-label="색 값" spellCheck={false} />
            </label>
          </div>
        )}
      </fieldset>

      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      <div className="row">
        <button disabled={busy || importing}>{busy ? '저장 중…' : '카드 모습 저장'}</button>
        <button type="button" className="ghost" disabled={busy || importing} onClick={resetAuto}>자동으로 되돌리기</button>
      </div>
    </form>
  );
}
