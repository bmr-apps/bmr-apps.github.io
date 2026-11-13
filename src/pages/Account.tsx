import { useEffect, useState, type FormEvent } from 'react';
import type { Ctx } from '../App';
import { sb, ROLE_LABEL, loginMethods } from '../sb';

const METHOD_LABEL: Record<string, string> = { email: '이메일·비밀번호', google: '구글' };

/** 로그인한 사람이 허브 로그인 비밀번호를 직접 바꾼다. */
export function HubPassword({ create = false }: { create?: boolean }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setMsg(''); setErr('');
    if (pw !== pw2) { setErr('새 비밀번호가 서로 다릅니다.'); return; }
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(/should be|least|weak|characters/i.test(error.message) ? '비밀번호는 8자 이상으로 해 주세요.' : '바꾸지 못했습니다. 다시 로그인한 뒤 시도하세요.');
    else { setMsg(create ? '비밀번호를 만들었습니다. 이제 이메일·비밀번호로도 로그인할 수 있어요.' : '허브 로그인 비밀번호를 바꿨습니다.'); setPw(''); setPw2(''); }
  };
  return (
    <div className="card">
      <h3>{create ? '비밀번호 만들기 (선택)' : '비밀번호 바꾸기'}</h3>
      <p className="muted">{create ? '지금은 구글로만 로그인하는 계정입니다. 비밀번호를 만들면 같은 메일과 비밀번호로도 로그인할 수 있어요.' : '허브에 로그인할 때 쓰는 비밀번호입니다. 바꾼 뒤에는 다른 기기에서 다시 로그인해야 할 수 있습니다.'}</p>
      <form onSubmit={save} style={{ marginTop: 10 }}>
        <label>새 비밀번호<input type="password" minLength={8} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>새 비밀번호 확인<input type="password" minLength={8} required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {err && <p className="error" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
        <div className="row end"><button disabled={busy}>{busy ? '저장 중…' : '저장'}</button></div>
      </form>
    </div>
  );
}

export function AccountPage({ ctx }: { ctx: Ctx }) {
  const me = ctx.me;
  const [methods, setMethods] = useState<string[]>(() => loginMethods(ctx.session?.user));
  useEffect(() => { sb.auth.getUser().then(({ data }) => { if (data.user) setMethods(loginMethods(data.user)); }); }, []);
  const googleOnly = methods.length > 0 && !methods.includes('email');
  return (
    <section>
      <div className="section-head"><h2>👤 내 계정</h2></div>
      <div className="card">
        <dl className="meta">
          <dt>이름</dt><dd>{me?.name || '—'}</dd>
          <dt>이메일</dt><dd>{me?.email}</dd>
          <dt>역할</dt><dd>{me ? ROLE_LABEL[me.role] : ''}</dd>
          <dt>로그인 방법</dt><dd className="methods">{methods.length ? methods.map((m) => <span key={m} className={`badge m-${m}`}>{METHOD_LABEL[m] ?? m}</span>) : '—'}</dd>
        </dl>
      </div>
      <HubPassword create={googleOnly} />
    </section>
  );
}
