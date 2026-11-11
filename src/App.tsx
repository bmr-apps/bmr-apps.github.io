import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, sb, login, signUp, ROLE_LABEL, type Profile } from './sb';
import { Landing, AppsPage } from './pages/Apps';
import { RequestsPage } from './pages/Requests';
import { TokensPage } from './pages/Tokens';
import { StatusPage } from './pages/Status';
import { MembersPage } from './pages/Members';

// 아주 작은 경로 처리 (허브 화면은 /hub/ 아래: 앱 주소 /<slug> 와 겹치지 않게)
export function go(path: string) { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')); }
export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}>{children}</a>;
}
function usePath() {
  const [p, setP] = useState(location.pathname);
  useEffect(() => { const f = () => setP(location.pathname); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  return p.replace(/\/+$/, '') || '/';
}

export type Ctx = { session: Session | null; isAdmin: boolean; isStaff: boolean; me: Profile | null };

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

  const ctx: Ctx = { session, isAdmin: me?.role === 'admin', isStaff: me?.role === 'admin' || me?.role === 'staff', me };
  if (!configured) return <Shell ctx={ctx} path={path}><div className="card warn">환경 변수 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 가 없습니다.</div></Shell>;
  if (!ready) return <Shell ctx={ctx} path={path}><p className="muted">불러오는 중…</p></Shell>;

  let page: ReactNode;
  if (path === '/' ) page = <Landing ctx={ctx} />;
  else if (path === '/hub/login') page = <LoginPage session={session} />;
  else if (!session) page = <LoginPage session={null} />;
  else if (me && !ctx.isStaff) page = <div className="card narrow"><h2>{ROLE_LABEL[me.role]}</h2><p>{me.role === 'pending' ? '가입은 됐습니다. 관리자가 직원으로 승인하면 허브를 쓸 수 있습니다.' : '사용이 중지된 계정입니다. 관리자에게 문의하세요.'}</p><p className="muted">{me.email}</p></div>;
  else if (path === '/hub' || path === '/hub/apps') page = <AppsPage ctx={ctx} />;
  else if (path === '/hub/requests') page = <RequestsPage ctx={ctx} />;
  else if (path === '/hub/tokens') page = <TokensPage ctx={ctx} />;
  else if (path === '/hub/status') page = <StatusPage ctx={ctx} />;
  else if (path === '/hub/members') page = <MembersPage ctx={ctx} />;
  else page = <div className="card"><h2>페이지를 찾을 수 없습니다</h2><p className="muted">주소({path})에 해당하는 앱이 아직 배포되지 않았을 수 있습니다.</p><Link to="/">처음으로</Link></div>;
  return <Shell ctx={ctx} path={path}>{page}</Shell>;
}

function Shell({ ctx, path, children }: { ctx: Ctx; path: string; children: ReactNode }) {
  const tabs: [string, string, boolean][] = [
    ['/hub/apps', '서비스·담당 교사', true], ['/hub/requests', '앱 신청', true], ['/hub/status', '운영 상태', true],
    ['/hub/tokens', '토큰 기록', ctx.isAdmin], ['/hub/members', '역할 관리', ctx.isAdmin],
  ];
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">별무리 앱</Link>
        {ctx.session && ctx.isStaff && <nav>{tabs.filter((t) => t[2]).map(([to, label]) => <Link key={to} to={to} className={path === to || (to === '/hub/apps' && path === '/hub') ? 'on' : ''}>{label}</Link>)}</nav>}
        <div className="who">
          {ctx.session ? <>
            <span className="muted">{ctx.me?.name || ctx.session.user.email}{ctx.me ? ` · ${ROLE_LABEL[ctx.me.role]}` : ''}</span>
            <button className="ghost" onClick={async () => { await sb.auth.signOut(); go('/'); }}>로그아웃</button>
          </> : <Link to="/hub/login" className="btn">직원 로그인</Link>}
        </div>
      </header>
      <main>{children}</main>
      <footer className="muted">별무리학교 · apps.bmrschool.net</footer>
    </>
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
    <form className="card narrow" onSubmit={submit}>
      <h2>{mode === 'login' ? '직원 로그인' : '직원 가입'}</h2>
      <p className="muted">{mode === 'login' ? '이메일과 비밀번호로 로그인합니다.' : '학교 이메일로 가입하세요. 가입 후 관리자가 직원으로 승인해야 쓸 수 있습니다.'}</p>
      {mode === 'signup' && <label>이름<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>}
      <label>이메일<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
      <label>비밀번호<input type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
      {err && <p className="error">{err}</p>}{msg && <p className="ok">{msg}</p>}
      <button disabled={busy}>{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하기'}</button>
      <button type="button" className="ghost" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }}>{mode === 'login' ? '처음이면 가입하기' : '로그인으로 돌아가기'}</button>
    </form>
  );
}
