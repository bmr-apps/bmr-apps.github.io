import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, sb, login, signUp, daysLeft, ROLE_LABEL, type Profile, type Status } from './sb';
import { Landing, AppsPage } from './pages/Apps';
import { RequestsPage } from './pages/Requests';
import { TokensPage } from './pages/Tokens';
import { StatusPage } from './pages/Status';
import { MembersPage } from './pages/Members';
import { DbCredPage } from './pages/DbCred';
import { Clock, Palette, appIcon, useTheme, type Cmd } from './ui';

// 아주 작은 경로 처리 (허브 화면은 /hub/ 아래: 앱 주소 /<slug> 와 겹치지 않게)
export function go(path: string) { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }
export function Link({ to, children, className, onClick }: { to: string; children: ReactNode; className?: string; onClick?: () => void }) {
  return <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); onClick?.(); go(to); }}>{children}</a>;
}
function usePath() {
  const [p, setP] = useState(location.pathname);
  useEffect(() => { const f = () => setP(location.pathname); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  return p.replace(/\/+$/, '') || '/';
}

/** 사이드바 배지·대시보드 요약에 쓰는 숫자 (읽기 전용 조회) */
export type Counts = {
  apps: { id: number; slug: string; name: string; url: string; status: Status }[];
  healthOk: number; healthBad: number; healthNone: number;
  reqPending: number; tokSoon: number | null; memPending: number | null;
};
export type Ctx = { session: Session | null; isAdmin: boolean; isStaff: boolean; me: Profile | null; counts?: Counts | null; refreshCounts?: () => void };

function useCounts(enabled: boolean, isAdmin: boolean, path: string) {
  const [c, setC] = useState<Counts | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) { setC(null); return; }
    let live = true;
    (async () => {
      const [a, h, r, t, m] = await Promise.all([
        sb.from('apps').select('id, slug, name, url, status').order('sort').order('name'),
        sb.from('app_health_latest').select('app_id, ok'),
        sb.from('app_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        isAdmin ? sb.from('token_logs').select('expires_at, revoked_at') : Promise.resolve(null),
        isAdmin ? sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'pending') : Promise.resolve(null),
      ]);
      if (!live) return;
      const apps = (a.data ?? []) as Counts['apps'];
      const hl = new Map(((h.data ?? []) as { app_id: number; ok: boolean }[]).map((x) => [x.app_id, x.ok]));
      const watched = apps.filter((x) => x.status !== 'retired');
      setC({
        apps,
        healthOk: watched.filter((x) => hl.get(x.id) === true).length,
        healthBad: watched.filter((x) => hl.get(x.id) === false).length,
        healthNone: watched.filter((x) => !hl.has(x.id)).length,
        reqPending: r.count ?? 0,
        tokSoon: t ? ((t.data ?? []) as { expires_at: string | null; revoked_at: string | null }[]).filter((x) => !x.revoked_at && (daysLeft(x.expires_at) ?? 99) <= 14).length : null,
        memPending: m ? m.count ?? 0 : null,
      });
    })();
    return () => { live = false; };
  }, [enabled, isAdmin, path, tick]);
  return [c, () => setTick((x) => x + 1)] as const;
}

export function App() {
  const path = usePath();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) { setMe(null); return; }
    sb.from('profiles').select('*').eq('id', uid).maybeSingle().then(({ data }) => setMe((data as Profile) ?? null));
  }, [uid]);

  const isAdmin = me?.role === 'admin'; const isStaff = isAdmin || me?.role === 'staff';
  const [counts, refreshCounts] = useCounts(!!session && isStaff, isAdmin, path);
  const ctx: Ctx = { session, isAdmin, isStaff, me, counts, refreshCounts };
  if (!configured) return <Shell ctx={ctx} path={path}><div className="card warn">환경 변수 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 가 없습니다.</div></Shell>;
  if (!ready) return <Shell ctx={ctx} path={path}><p className="muted">불러오는 중…</p></Shell>;

  let page: ReactNode;
  if (path === '/') page = <Landing ctx={ctx} />;
  else if (path === '/hub/login') page = <LoginPage session={session} />;
  else if (!session) page = <LoginPage session={null} />;
  else if (path === '/hub/db' && me?.role !== 'disabled') page = <DbCredPage ctx={ctx} />;
  else if (me && !ctx.isStaff) page = <div className="card narrow center"><div className="logo big">{me.role === 'pending' ? '⏳' : '🚫'}</div><h2>{ROLE_LABEL[me.role]}</h2><p>{me.role === 'pending' ? '가입은 됐습니다. 관리자가 직원으로 승인하면 허브를 쓸 수 있습니다.' : '사용이 중지된 계정입니다. 관리자에게 문의하세요.'}</p><p className="muted">{me.email}</p>{me.role === 'pending' && <Link to="/hub/db" className="btn">내가 담당인 앱의 DB 접속 정보</Link>}</div>;
  else if (path === '/hub' || path === '/hub/apps') page = <AppsPage ctx={ctx} />;
  else if (path === '/hub/requests') page = <RequestsPage ctx={ctx} />;
  else if (path === '/hub/tokens') page = <TokensPage ctx={ctx} />;
  else if (path === '/hub/status') page = <StatusPage ctx={ctx} />;
  else if (path === '/hub/members') page = <MembersPage ctx={ctx} />;
  else page = <div className="card narrow center"><div className="logo big">🧭</div><h2>페이지를 찾을 수 없습니다</h2><p className="muted">주소({path})에 해당하는 앱이 아직 배포되지 않았을 수 있습니다.</p><Link to="/" className="btn">처음으로</Link></div>;
  return <Shell ctx={ctx} path={path}>{page}</Shell>;
}

/** 인사말에 쓸 이름: 프로필 이름(일반 명칭 '관리자' 등 제외) → 가입 때 넣은 이름 → 이메일 앞부분 */
const GENERIC = new Set(['관리자', 'admin', '직원', 'staff', '사용자', 'user']);
function displayName(ctx: Ctx) {
  const u = ctx.session?.user;
  const meta = (u?.user_metadata ?? {}) as { name?: string; full_name?: string };
  const cands = [ctx.me?.name, meta.name, meta.full_name].map((x) => (x ?? '').trim());
  return cands.find((x) => x && !GENERIC.has(x.toLowerCase())) || (u?.email ?? ctx.me?.email ?? '').split('@')[0] || '선생';
}

type Tab = { to: string; icon: string; label: string; sub: string; show: boolean; badge?: number | null; tone?: string };

function Shell({ ctx, path, children }: { ctx: Ctx; path: string; children: ReactNode }) {
  const [theme, toggleTheme] = useTheme();
  const [pal, setPal] = useState(false);
  const [menu, setMenu] = useState(false);
  const c = ctx.counts;
  const inHub = !!ctx.session && ctx.isStaff && path !== '/' && path !== '/hub/login';
  const groups: [string, Tab[]][] = [
    ['둘러보기', [
      { to: '/hub/apps', icon: '🏠', label: '대시보드', sub: '서비스·담당 교사', show: true },
      { to: '/hub/db', icon: '🗄️', label: 'DB 접속 정보', sub: '내 앱 비밀번호 받기', show: true },
      { to: '/', icon: '🌐', label: '공개 첫 화면', sub: '누구나 보는 바로가기', show: true },
    ]],
    ['운영', [
      { to: '/hub/requests', icon: '📝', label: '앱 신청', sub: '새 앱 신청·승인', show: true, badge: c?.reqPending, tone: 'amber' },
      { to: '/hub/status', icon: '📡', label: '운영 상태', sub: '매시 자동 점검', show: true, badge: c?.healthBad, tone: 'red' },
    ]],
    ['관리자', [
      { to: '/hub/tokens', icon: '🔑', label: '토큰 기록', sub: '발급·만료 관리', show: ctx.isAdmin, badge: c?.tokSoon, tone: 'red' },
      { to: '/hub/members', icon: '👥', label: '역할 관리', sub: '가입자 승인', show: ctx.isAdmin, badge: c?.memPending, tone: 'amber' },
    ]],
  ];
  const tabs = groups.flatMap(([, t]) => t.filter((x) => x.show));
  const logout = useCallback(async () => { await sb.auth.signOut(); go('/'); }, []);

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((x) => !x); } };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, []);
  useEffect(() => { setMenu(false); }, [path]);

  // 공개 화면용 운영 중 앱 (팔레트 검색용)
  const [pubApps, setPubApps] = useState<Counts['apps']>([]);
  useEffect(() => {
    if (inHub || !configured) return;
    sb.from('apps').select('id, slug, name, url, status').eq('status', 'active').order('sort').then(({ data }) => setPubApps((data ?? []) as Counts['apps']));
  }, [inHub]);

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];
    if (ctx.session && ctx.isStaff) tabs.forEach((t) => list.push({ id: 'tab' + t.to, group: '메뉴', icon: t.icon, title: t.label, sub: t.sub, run: () => go(t.to) }));
    else list.push({ id: 'home', group: '메뉴', icon: '🌐', title: '첫 화면', sub: '운영 중인 앱 바로가기', run: () => go('/') });
    const apps = (inHub ? c?.apps : pubApps)?.filter((a) => a.status !== 'retired') ?? [];
    apps.forEach((a) => list.push({ id: 'app' + a.id, group: '서비스 열기', icon: appIcon(a.slug), title: a.name, sub: a.url.replace(/^https?:\/\//, ''), run: () => { open(a.url, '_blank', 'noopener'); } }));
    list.push({ id: 'theme', group: '동작', icon: theme === 'dark' ? '☀️' : '🌙', title: theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로', sub: '테마 바꾸기', run: toggleTheme });
    if (ctx.session && ctx.isStaff) {
      list.push({ id: 'new', group: '동작', icon: '✨', title: '새 앱 신청하기', sub: '앱 신청 화면으로', run: () => go('/hub/requests') });
      if (ctx.isAdmin) list.push({ id: 'chk', group: '동작', icon: '🩺', title: '운영 상태 점검하러 가기', sub: '운영 상태 화면의 “지금 점검”', run: () => go('/hub/status') });
    }
    if (ctx.session) list.push({ id: 'out', group: '동작', icon: '🚪', title: '로그아웃', run: logout });
    else list.push({ id: 'in', group: '동작', icon: '🔐', title: '직원 로그인', run: () => go('/hub/login') });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.session, ctx.isStaff, ctx.isAdmin, c, pubApps, theme, inHub]);

  const name = displayName(ctx);
  const isActive = (to: string) => path === to || (to === '/hub/apps' && path === '/hub');

  return (
    <div className={`layout${inHub ? ' with-side' : ''}`}>
      {inHub && <>
        <aside className={`side${menu ? ' open' : ''}`}>
          <Link to="/hub/apps" className="side-brand"><span className="logo">✨</span><span><b>BMR APPS</b><small>앱 관리</small></span></Link>
          <nav>
            {groups.map(([g, t]) => t.some((x) => x.show) && (
              <div key={g} className="side-group">
                <div className="side-label">{g}</div>
                {t.filter((x) => x.show).map((x) => (
                  <Link key={x.to} to={x.to} className={`side-item${isActive(x.to) ? ' on' : ''}`}>
                    <span className="emo">{x.icon}</span><span className="grow0">{x.label}</span>
                    {!!x.badge && <span className={`count c-${x.tone}`}>{x.badge}</span>}
                  </Link>))}
              </div>))}
          </nav>
          <div className="side-foot">
            <div className="me"><span className="avatar">{(name || '?').slice(0, 1)}</span><span><b>{name}</b><small>{ctx.me ? ROLE_LABEL[ctx.me.role] : ''} · {ctx.session?.user.email}</small></span></div>
          </div>
        </aside>
        {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      </>}
      <div className="body">
        <header className="top">
          {inHub && <button className="icon-btn burger" aria-label="메뉴 열기" onClick={() => setMenu(true)}>☰</button>}
          {!inHub && <Link to="/" className="logo" ><span>✨</span></Link>}
          <div className="greet">
            {inHub ? <><h1>안녕하세요, {name}님 <span className="wave">👋</span></h1><p>오늘도 BMR APPS를 살펴볼까요?</p></>
              : <><h1>BMR APPS</h1><p>별무리학교 선생님들이 만들어 운영하는 서비스 모음</p></>}
          </div>
          <button className="search" onClick={() => setPal(true)} aria-label="검색 (Ctrl+K)"><span>🔎</span><span className="ph">검색하거나 이동…</span><kbd>Ctrl K</kbd></button>
          <Clock />
          <button className="icon-btn" onClick={toggleTheme} aria-label="테마 바꾸기" title={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          {ctx.session ? <>
            {!inHub && ctx.isStaff && <Link to="/hub/apps" className="btn">관리 허브</Link>}
            <button className="icon-btn" onClick={logout} aria-label="로그아웃" title="로그아웃">🚪</button>
          </> : path !== '/hub/login' && <Link to="/hub/login" className="btn">직원 로그인</Link>}
        </header>
        <main>{children}</main>
        <footer className="muted">별무리학교 · apps.bmrschool.net · <kbd>Ctrl K</kbd> 빠른 이동</footer>
      </div>
      {pal && <Palette cmds={cmds} onClose={() => setPal(false)} />}
    </div>
  );
}

function LoginPage({ session }: { session: Session | null }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (session && location.pathname === '/hub/login') go('/hub/apps'); }, [session]);
  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true);
    try {
      if (mode === 'login') { await login(email, pw); if (location.pathname === '/hub/login') go('/hub/apps'); }
      else {
        const r = await signUp(email, pw, name);
        setMsg(r.needsConfirm ? '확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요. 관리자 승인 후 허브를 쓸 수 있습니다.' : '가입했습니다. 관리자 승인 후 허브를 쓸 수 있습니다.');
        setMode('login');
      }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }, [mode, email, pw, name]);
  return (
    <form className="card narrow login" onSubmit={submit}>
      <div className="logo big">✨</div>
      <h2>{mode === 'login' ? '직원 로그인' : '직원 가입'}</h2>
      <p className="muted">{mode === 'login' ? '이메일과 비밀번호로 로그인합니다.' : '학교 이메일로 가입하세요. 가입 후 관리자가 직원으로 승인해야 쓸 수 있습니다.'}</p>
      {mode === 'signup' && <label>이름<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>}
      <label>이메일<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required placeholder="name@bmrschool.org" /></label>
      <label>비밀번호<input type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
      {err && <p className="error">{err}</p>}{msg && <p className="ok">{msg}</p>}
      <button disabled={busy}>{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}</button>
      <button type="button" className="ghost" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }}>{mode === 'login' ? '처음이면 가입하기' : '로그인으로 돌아가기'}</button>
    </form>
  );
}
