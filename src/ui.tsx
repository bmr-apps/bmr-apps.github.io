// 공통 화면 조각: 테마, 시계, 명령 팔레트, 아이콘, 모달
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE, type ReactNode } from 'react';

/* ---------- 테마 (localStorage 저장, 없으면 시스템 설정 따름) ---------- */
export type Theme = 'light' | 'dark';
const THEME_KEY = 'bmr-theme';
const sysDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
export function initialTheme(): Theme {
  const s = localStorage.getItem(THEME_KEY);
  return s === 'light' || s === 'dark' ? s : sysDark() ? 'dark' : 'light';
}
export function applyTheme(t: Theme) { document.documentElement.dataset.theme = t; }
export function useTheme(): [Theme, () => void] {
  const [t, setT] = useState<Theme>(initialTheme);
  useEffect(() => { applyTheme(t); }, [t]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const f = () => { if (!localStorage.getItem(THEME_KEY)) setT(mq.matches ? 'dark' : 'light'); };
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f);
  }, []);
  const toggle = () => setT((x) => { const n = x === 'dark' ? 'light' : 'dark'; localStorage.setItem(THEME_KEY, n); return n; });
  return [t, toggle];
}

/* ---------- 시계 ---------- */
export function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(i); }, []);
  const time = now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' });
  return <div className="clock" aria-label="현재 시각(서울)"><b>{time}</b><span>{date}</span></div>;
}

/* ---------- BMR APPS 워드마크 (글자로 만든 자체 표시) ---------- */
export function Mark({ className = '' }: { className?: string }) {
  return <span className={`mark ${className}`} aria-hidden="true"><span>BMR</span><span>APPS</span></span>;
}

/* ---------- 앱 아이콘 ---------- */
const ICONS: Record<string, string> = { library: '📚', lib: '📚', attendance: '🗓️', meal: '🍱', survey: '📋', calendar: '🗓️', notice: '📢', grade: '📊' };
const POOL = ['🚀', '🧩', '🌱', '🔭', '🧪', '📒', '🎒', '🛠️', '💡', '🌟'];
export function appIcon(slug: string) {
  if (ICONS[slug]) return ICONS[slug];
  let h = 0; for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return POOL[h % POOL.length];
}
const TONES = ['violet', 'blue', 'teal', 'pink', 'amber', 'green'];
export function appTone(slug: string) { let h = 7; for (const c of slug) h = (h * 17 + c.charCodeAt(0)) >>> 0; return TONES[h % TONES.length]; }

/* ---------- 모달 ---------- */
export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <button className="icon-btn close" aria-label="닫기" onClick={onClose}>✕</button>
        {children}
      </div>
    </div>
  );
}

/* ---------- 필터 알약 ---------- */
export function Pills<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string, number?][] }) {
  return (
    <div className="pills" role="tablist">
      {items.map(([k, label, n]) => (
        <button key={k} role="tab" aria-selected={value === k} className={`pill${value === k ? ' on' : ''}`} onClick={() => onChange(k)}>
          {label}{n !== undefined && <span className="cnt">{n}</span>}
        </button>))}
    </div>
  );
}

/* ---------- 요약 카드 ---------- */
export function Stat({ icon, label, value, sub, tone, onClick }: { icon: string; label: string; value: ReactNode; sub?: ReactNode; tone: string; onClick?: () => void }) {
  return (
    <button type="button" className={`stat t-${tone}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-label"><span className="emo">{icon}</span>{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </button>
  );
}

/* ---------- 명령 팔레트 (Ctrl+K) ---------- */
export type Cmd = { id: string; group: string; icon: string; title: string; sub?: string; run: () => void };
export function Palette({ cmds, onClose }: { cmds: Cmd[]; onClose: () => void }) {
  const [q, setQ] = useState(''); const [i, setI] = useState(0);
  const inp = useRef<HTMLInputElement>(null); const list = useRef<HTMLDivElement>(null);
  useEffect(() => { inp.current?.focus(); }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? cmds.filter((c) => (c.title + ' ' + (c.sub ?? '') + ' ' + c.group).toLowerCase().includes(s)) : cmds;
  }, [q, cmds]);
  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { list.current?.querySelector('.cmd.on')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const pick = (c?: Cmd) => { if (!c) return; onClose(); c.run(); };
  const key = (e: RKE) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(x + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[i]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let last = '';
  return (
    <div className="overlay blur" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="빠른 이동">
        <div className="palette-in"><span>🔎</span>
          <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="메뉴로 이동하거나, 앱을 열거나, 동작을 실행…" aria-label="검색" />
        </div>
        <div className="palette-list" ref={list}>
          {shown.length === 0 && <p className="muted pad">찾는 항목이 없습니다.</p>}
          {shown.map((c, n) => {
            const head = c.group !== last ? (last = c.group) : null;
            return (
              <div key={c.id}>
                {head && <div className="grp">{head}</div>}
                <button className={`cmd${n === i ? ' on' : ''}`} onMouseEnter={() => setI(n)} onClick={() => pick(c)}>
                  <span className="cmd-ico">{c.icon}</span><span className="cmd-t"><b>{c.title}</b>{c.sub && <small>{c.sub}</small>}</span>
                </button>
              </div>);
          })}
        </div>
        <div className="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> 선택 <kbd>Enter</kbd> 열기 <kbd>Esc</kbd> 닫기</div>
      </div>
    </div>
  );
}
