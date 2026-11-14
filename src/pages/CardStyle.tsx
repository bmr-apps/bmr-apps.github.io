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

/** 앱 정보 창: 관리자 또는 그 앱 담당 개발자가 카드 아이콘·색을 정함. 기본은 자동 지정. */
export function CardStyleSection({ app, onSaved }: { app: App; onSaved: () => void }) {
  const [s, setS] = useState(() => init(app));
  const [file, setFile] = useState<File | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
        <button disabled={busy}>{busy ? '저장 중…' : '카드 모습 저장'}</button>
        <button type="button" className="ghost" disabled={busy} onClick={resetAuto}>자동으로 되돌리기</button>
      </div>
    </form>
  );
}
