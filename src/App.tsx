import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, sb, login, signUp, loginWithGoogle, oauthError, ROLE_LABEL, healthState, type HealthState, type Profile, type Status } from './sb';
import { Landing, AppsPage } from './pages/Apps';
import { GuidePage, QuickStartPage } from './pages/Guide';
import { RequestsPage } from './pages/Requests';
import { StatusPage } from './pages/Status';
import { MembersPage } from './pages/Members';
import { AuditPage } from './pages/Audit';
import { DbCredPage } from './pages/DbCred';
import { AccountPage } from './pages/Account';
import { Clock, Palette, appIcon, useTheme, type Cmd } from './ui';

// 아주 작은 경로 처리 (허브 화면은 /hub/ 아래: 앱 주소 /<slug> 와 겹치지 않게)
export function go(path: string) { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }
export function Link({ to, children, className, onClick, title, 'aria-label': ariaLabel }: { to: string; children: ReactNode; className?: string; onClick?: () => void; title?: string; 'aria-label'?: string }) {
  return <a href={to} className={className} title={title} aria-label={ariaLabel} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); onClick?.(); go(to); }}>{children}</a>;
}
function usePath() {
  const [p, setP] = useState(location.pathname);
  useEffect(() => { const f = () => setP(location.pathname); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  return p.replace(/\/+$/, '') || '/';
}

/** 사이드바 배지·대시보드 요약에 쓰는 숫자 (읽기 전용 조회) */
export type Counts = {
  apps: { id: number; slug: string; name: string; url: string; status: Status }[];
  healthOk: number; healthChecking: number; healthBad: number; healthNone: number;
  reqPending: number; memPending: number | null;
};
export type Ctx = { session: Session | null; isAdmin: boolean; isStaff: boolean; me: Profile | null; counts?: Counts | null; refreshCounts?: () => void };

function useCounts(enabled: boolean, isAdmin: boolean, path: string) {
  const [c, setC] = useState<Counts | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) { setC(null); return; }
    let live = true;
    (async () => {
      const [a, h, r, dr, m] = await Promise.all([
        sb.from('apps').select('id, slug, name, url, status').order('sort').order('name'),
        sb.from('app_health_latest').select('app_id, ok, state'),
        sb.from('app_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        isAdmin ? sb.from('dev_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve(null),
        isAdmin ? sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'pending') : Promise.resolve(null),
      ]);
      if (!live) return;
      const apps = (a.data ?? []) as Counts['apps'];
      const hl = new Map(((h.data ?? []) as { app_id: number; ok: boolean; state?: HealthState }[]).map((x) => [x.app_id, healthState(x)]));
      const watched = apps.filter((x) => x.status !== 'retired');
      setC({
        apps,
        healthOk: watched.filter((x) => hl.get(x.id) === 'ok').length,
        healthChecking: watched.filter((x) => hl.get(x.id) === 'checking').length,
        healthBad: watched.filter((x) => hl.get(x.id) === 'down').length,
        healthNone: watched.filter((x) => !hl.has(x.id)).length,
        reqPending: (r.count ?? 0) + (dr ? dr.count ?? 0 : 0),
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
  const [meReady, setMeReady] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) { setMe(null); setMeReady(true); return; }
    let live = true;
    setMeReady(false);
    (async () => {
      for (let i = 0; i < 8 && live; i++) {
        const { data } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
        if (!live) return;
        if (data) { setMe(data as Profile); setMeReady(true); return; }
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
      if (live) { setMe(null); setMeReady(true); }
    })();
    return () => { live = false; };
  }, [uid]);

  const isAdmin = me?.role === 'admin'; const isStaff = isAdmin || me?.role === 'staff';
  const [counts, refreshCounts] = useCounts(!!session && isStaff, isAdmin, path);
  const ctx: Ctx = { session, isAdmin, isStaff, me, counts, refreshCounts };
  if (!configured) return <Shell ctx={ctx} path={path}><div className="card warn">환경 변수 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 가 없습니다.</div></Shell>;
  if (!ready) return <Shell ctx={ctx} path={path}><p className="muted">불러오는 중…</p></Shell>;

  let page: ReactNode;
  if (path === '/') page = <Landing ctx={ctx} />;
  else if (path === '/hub/login') page = <LoginPage session={session} />;
  else if (path === '/guide') page = <GuidePage ctx={ctx} />;
  else if (path === '/guide/quick') page = <QuickStartPage ctx={ctx} />;
  else if (!session) page = <LoginPage session={null} />;
  else if (!meReady) page = <p className="muted">불러오는 중…</p>;
  else if (!me) page = <div className="card narrow center"><h2>프로필을 찾지 못했습니다</h2><p>다시 로그인하거나 관리자에게 문의하세요.</p></div>;
  else if (me.role === 'disabled') page = <div className="card narrow center"><div className="logo big">🚫</div><h2>사용 중지</h2><p>사용이 중지된 계정입니다. 관리자에게 문의하세요.</p><p className="muted">{me.email}</p></div>;
  else if (path === '/hub/account') page = <AccountPage ctx={ctx} />;
  else if (path === '/hub/db') page = <StaffOnly ctx={ctx}><DbCredPage ctx={ctx} /></StaffOnly>;
  else if (path === '/hub' || path === '/hub/apps') page = <AppsPage ctx={ctx} />;
  else if (path === '/hub/requests') page = <StaffOnly ctx={ctx}><RequestsPage ctx={ctx} /></StaffOnly>;
  else if (path === '/hub/tokens') page = <div className="card narrow center"><div className="logo big">🧾</div><h2>토큰 기록은 없어졌습니다</h2><p className="muted">DB 비밀번호 받기·사용자 관리 같은 기록은 이제 감사 기록에 남습니다.</p>{ctx.isAdmin ? <Link to="/hub/audit" className="btn">감사 기록 보기</Link> : <Link to="/hub/apps" className="btn">대시보드로</Link>}</div>;
  else if (path === '/hub/status') page = <StaffOnly ctx={ctx}><StatusPage ctx={ctx} /></StaffOnly>;
  else if (path === '/hub/members') page = <MembersPage ctx={ctx} />;
  else if (path === '/hub/audit') page = <AuditPage ctx={ctx} />;
  else page = <div className="card narrow center"><div className="logo big">🧭</div><h2>페이지를 찾을 수 없습니다</h2><p className="muted">주소({path})에 해당하는 앱이 아직 배포되지 않았을 수 있습니다.</p><Link to="/" className="btn">처음으로</Link></div>;
  return <Shell ctx={ctx} path={path}>{page}</Shell>;
}

/** 개발자 전용 화면: 일반 사용자에게는 안내만 보여 준다 */
function StaffOnly({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  if (ctx.isStaff) return children;
  return (
    <div className="card narrow center">
      <div className="logo big">🔒</div>
      <h2>개발자 승인 후 이용할 수 있어요</h2>
      <p>관리자에게 요청하세요.</p>
      <p className="muted">{ctx.me?.email}</p>
      <Link to="/hub/apps" className="btn">대시보드로</Link>
    </div>
  );
}

/** 인사말에 쓸 이름: 프로필 이름(일반 명칭 '관리자' 등 제외) → 가입 때 넣은 이름 → 이메일 앞부분 */
const GENERIC = new Set(['관리자', 'admin', '직원', '개발자', 'staff', '사용자', 'user']);
function displayName(ctx: Ctx) {
  const u = ctx.session?.user;
  const meta = (u?.user_metadata ?? {}) as { name?: string; full_name?: string };
  const cands = [ctx.me?.name, meta.name, meta.full_name].map((x) => (x ?? '').trim());
  return cands.find((x) => x && !GENERIC.has(x.toLowerCase())) || (u?.email ?? ctx.me?.email ?? '').split('@')[0] || '선생';
}

type Tab = { to: string; icon: string; label: string; sub: string; show: boolean; badge?: number | null; tone?: string; child?: boolean };

function Shell({ ctx, path, children }: { ctx: Ctx; path: string; children: ReactNode }) {
  const [theme, toggleTheme] = useTheme();
  const [pal, setPal] = useState(false);
  const [menu, setMenu] = useState(false);
  const c = ctx.counts;
  const inHub = !!ctx.session && ctx.me?.role !== 'disabled' && path !== '/' && path !== '/hub/login';
  const groups: [string, Tab[]][] = [
    ['둘러보기', [
      { to: '/guide', icon: '🧭', label: '시작 가이드', sub: 'BMR APPS 로 개발 시작하기', show: true },
      { to: '/hub/apps', icon: '🏠', label: '대시보드', sub: '서비스·담당 개발자', show: true },
    ]],
    ['운영', [
      { to: '/hub/requests', icon: '📝', label: '앱 신청', sub: '새 앱 신청·개발자 요청 승인', show: true, badge: c?.reqPending, tone: 'amber' },
      { to: '/hub/status', icon: '📡', label: '운영 상태', sub: '매시 자동 점검', show: true, badge: c?.healthBad, tone: 'red' },
    ]],
    ['관리자', [
      { to: '/hub/members', icon: '👥', label: '사용자 관리', sub: '역할·비밀번호·삭제', show: ctx.isAdmin, badge: c?.memPending, tone: 'amber' },
      { to: '/hub/audit', icon: '🧾', label: '감사 기록', sub: '승인·생성·권한·비밀번호 기록', show: ctx.isAdmin },
    ]],
  ];
  const tabs = groups.flatMap(([, t]) => t.filter((x) => x.show));
  const logout = useCallback(async () => { await sb.auth.signOut({ scope: 'local' }); go('/'); /* 허브에서만 로그아웃 (다른 앱·기기 로그인은 유지) */ }, []);

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
    list.push({ id: 'home', group: '메뉴', icon: '🌐', title: '메인', sub: '누구나 보는 서비스 모음', run: () => go('/') });
    if (ctx.session && ctx.me?.role !== 'disabled') {
      tabs.forEach((t) => list.push({ id: 'tab' + t.to, group: '메뉴', icon: t.icon, title: t.label, sub: t.sub, run: () => go(t.to) }));
      list.push({ id: 'quick', group: '메뉴', icon: '⚡', title: '빠른 시작', sub: '꼭 필요한 단계만 빠르게', run: () => go('/guide/quick') });
      list.push({ id: 'account', group: '메뉴', icon: '👤', title: '내 계정', sub: '허브 로그인 비밀번호 바꾸기', run: () => go('/hub/account') });
      if (ctx.isStaff) list.push({ id: 'db', group: '메뉴', icon: '🗄️', title: 'DB 접속 정보 모아 보기', sub: '앱마다 앱 정보 → DB 접속 정보에서도 할 수 있어요', run: () => go('/hub/db') });
    } else {
      list.push({ id: 'guide', group: '메뉴', icon: '🧭', title: '시작 가이드', sub: 'BMR APPS 로 개발 시작하기', run: () => go('/guide') });
      list.push({ id: 'quick', group: '메뉴', icon: '⚡', title: '빠른 시작', sub: '꼭 필요한 단계만 빠르게', run: () => go('/guide/quick') });
    }
    const apps = (inHub ? c?.apps : pubApps)?.filter((a) => a.status !== 'retired') ?? [];
    apps.forEach((a) => list.push({ id: 'app' + a.id, group: '서비스 열기', icon: appIcon(a.slug), title: a.name, sub: a.url.replace(/^https?:\/\//, ''), run: () => { open(a.url, '_blank', 'noopener'); } }));
    list.push({ id: 'theme', group: '동작', icon: theme === 'dark' ? '☀️' : '🌙', title: theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로', sub: '테마 바꾸기', run: toggleTheme });
    if (ctx.session && ctx.isStaff) {
      list.push({ id: 'new', group: '동작', icon: '✨', title: '새 앱 신청하기', sub: '앱 신청 화면으로', run: () => go('/hub/requests') });
      if (ctx.isAdmin) list.push({ id: 'chk', group: '동작', icon: '🩺', title: '운영 상태 점검하러 가기', sub: '운영 상태 화면의 “지금 점검”', run: () => go('/hub/status') });
    }
    if (ctx.session) list.push({ id: 'out', group: '동작', icon: '🚪', title: '로그아웃', run: logout });
    else list.push({ id: 'in', group: '동작', icon: '🔐', title: '로그인', run: () => go('/hub/login') });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.session, ctx.isStaff, ctx.isAdmin, c, pubApps, theme, inHub]);

  const name = displayName(ctx);
  const isActive = (to: string) => path === to || (to === '/hub/apps' && path === '/hub');

  return (
    <div className={`layout${inHub ? ' with-side' : ''}`}>
      {inHub && <>
        <aside className={`side${menu ? ' open' : ''}`}>
          <div className="side-brand"><Link to="/" className="mark" aria-label="BMR APPS 메인 화면"><span>BMR</span><span>APPS</span></Link></div>
          <nav>
            {groups.map(([g, t]) => t.some((x) => x.show) && (
              <div key={g} className="side-group">
                <div className="side-label">{g}</div>
                {t.filter((x) => x.show).map((x) => (
                  <Link key={x.to} to={x.to} className={`side-item${x.child ? ' sub' : ''}${isActive(x.to) ? ' on' : ''}`}>
                    <span className="emo">{x.icon}</span><span className="grow0">{x.label}</span>
                    {!!x.badge && <span className={`count c-${x.tone}`}>{x.badge}</span>}
                  </Link>))}
              </div>))}
          </nav>
          <div className="side-foot">
            <Link to="/hub/account" className={`me${path === '/hub/account' ? ' on' : ''}`} title="내 계정 · 비밀번호 바꾸기" aria-label={`내 계정: ${name}`}><span className="avatar">{(name || '?').slice(0, 1)}</span><span className="me-txt"><b>{name}</b><small>{ctx.me ? ROLE_LABEL[ctx.me.role] : ''} · {ctx.session?.user.email}</small></span><span className="me-go" aria-hidden="true">›</span></Link>
            <button type="button" className="ghost small side-logout" onClick={logout}>🚪 로그아웃</button>
          </div>
        </aside>
        {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      </>}
      <div className="body">
        <header className="top">
          {inHub && <button className="icon-btn burger" aria-label="메뉴 열기" onClick={() => setMenu(true)}>☰</button>}
          {!inHub && <Link to="/" className="mark" aria-label="BMR APPS 메인 화면"><span>BMR</span><span>APPS</span></Link>}
          {inHub ? <div className="greet"><h1>안녕하세요, {name}님 <span className="wave">👋</span></h1><p>오늘도 BMR APPS를 살펴볼까요?</p></div> : <div className="grow" />}
          <button className="search" onClick={() => setPal(true)} aria-label="검색 (Ctrl+K)"><span>🔎</span><span className="ph">검색하거나 이동…</span><kbd>Ctrl K</kbd></button>
          <Clock />
          <button className="icon-btn" onClick={toggleTheme} aria-label="테마 바꾸기" title={theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로'}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          {ctx.session ? <>
            {!inHub && ctx.me && ctx.me.role !== 'disabled' && <Link to="/hub/apps" className="btn">관리 허브</Link>}
            <button className="icon-btn" onClick={logout} aria-label="로그아웃" title="로그아웃">🚪</button>
          </> : path !== '/hub/login' && <Link to="/hub/login" className="btn">로그인</Link>}
        </header>
        <main>{children}</main>
        <footer className="foot">
          <div className="foot-in">
            <div className="foot-brand"><Link to="/" className="mark" aria-label="BMR APPS 메인 화면"><span>BMR</span><span>APPS</span></Link><p>별무리 개발자들이 함께 만들고 나누는 공간<small>별무리학교 · apps.bmrschool.net</small></p></div>
            <nav aria-label="바로가기"><b>둘러보기</b><Link to="/">메인</Link><Link to="/guide">시작 가이드</Link><Link to="/guide/quick">빠른 시작</Link>{ctx.session ? <Link to="/hub/apps">관리 허브</Link> : <Link to="/hub/login">로그인 · 가입</Link>}</nav>
            {ctx.session && ctx.isStaff && <nav aria-label="개발자 메뉴"><b>개발자</b><Link to="/hub/requests">앱 신청</Link><Link to="/hub/account">내 계정</Link><Link to="/hub/status">운영 상태</Link></nav>}
          </div>
        </footer>
      </div>
      {pal && <Palette cmds={cmds} onClose={() => setPal(false)} />}
    </div>
  );
}

function LoginPage({ session }: { session: Session | null }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('');
  const [err, setErr] = useState(oauthError ?? ''); const [busy, setBusy] = useState(false); const [gBusy, setGBusy] = useState(false);
  useEffect(() => { if (session && location.pathname === '/hub/login') go('/hub/apps'); }, [session]);
  const google = async () => { setErr(''); setGBusy(true); try { await loginWithGoogle(); } catch (x) { setErr((x as Error).message); setGBusy(false); } };
  const submit = useCallback(async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'login') { await login(email, pw); if (location.pathname === '/hub/login') go('/hub/apps'); }
      else { await signUp(email, pw, name); if (location.pathname === '/hub/login') go('/hub/apps'); }
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }, [mode, email, pw, name]);
  return (
    <form className="card narrow login" onSubmit={submit}>
      <Link to="/" className="logo big mark" aria-label="BMR APPS 메인 화면"><span>BMR</span><span>APPS</span></Link>
      <h2>{mode === 'login' ? '로그인' : '가입'}</h2>
      <p className="muted">{mode === 'login' ? '구글 계정이나 이메일·비밀번호로 로그인합니다.' : '구글 계정으로 바로 가입하거나, 이름·이메일·비밀번호를 입력하세요.'}</p>
      <button type="button" className="gbtn" onClick={google} disabled={gBusy}>
        <svg className="g-logo" viewBox="0 0 48 48" aria-hidden="true" width="20" height="20"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        <span>{gBusy ? '구글로 이동 중…' : mode === 'login' ? '구글로 로그인' : '구글로 가입하기'}</span>
      </button>
      <div className="or"><span>또는 이메일로</span></div>
      {mode === 'signup' && <label>이름<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>}
      <label>이메일<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required placeholder="name@bmrschool.org" /></label>
      <label>비밀번호<input type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
      {err && <p className="error" role="alert">{err}</p>}
      <button disabled={busy}>{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}</button>
      <button type="button" className="ghost" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }}>{mode === 'login' ? '처음이면 가입하기' : '로그인으로 돌아가기'}</button>
      <p className="muted small-note">처음 가입하면 <b>일반 사용자</b>로 시작해요. 앱 신청은 관리자가 <b>개발자</b>로 올린 뒤에 할 수 있어요. 같은 메일로 이미 가입했다면 구글로 로그인해도 같은 계정으로 들어갑니다.</p>
    </form>
  );
}
