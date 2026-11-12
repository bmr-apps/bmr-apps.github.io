import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Ctx } from '../App';
import { fmtTime, ROLE_LABEL, usersApi, type HubUser, type Role } from '../sb';
import { Modal, Pills } from '../ui';

function Copy({ text, label = '복사' }: { text: string; label?: string }) {
  const [t, setT] = useState(label);
  return <button type="button" className="ghost small" onClick={async () => { try { await navigator.clipboard.writeText(text); setT('복사됨'); } catch { setT('복사 실패'); } setTimeout(() => setT(label), 1500); }}>{t}</button>;
}

function TempPassword({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <h2>임시 비밀번호</h2>
      <p className="muted"><b>{email}</b> 계정에 임시 비밀번호를 발급했습니다. <b>지금 한 번만</b> 보입니다. 이 값을 당사자에게 전하고, 로그인 후 <b>내 계정</b>에서 바로 바꾸라고 안내하세요.</p>
      <dl className="meta">
        <dt>비밀번호</dt>
        <dd><code className="pw-once">{password}</code> <Copy text={password} /></dd>
      </dl>
      <p className="warn">채팅·메일·화면 캡처에 올리지 마세요. 이 창을 닫으면 다시 볼 수 없습니다.</p>
      <div className="row end"><button type="button" onClick={onClose}>전달했어요, 닫기</button></div>
    </Modal>
  );
}

function ResetDialog({ user, session, onClose, onDone }: { user: HubUser; session: Session; onClose: () => void; onDone: (pw: string) => void }) {
  const [mode, setMode] = useState<'gen' | 'set'>('gen'); const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const j = await usersApi<{ password: string }>(session, 'reset_password', { user_id: user.id, ...(mode === 'set' ? { password: pw } : {}) });
      onDone(j.password);
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <h2>비밀번호 초기화</h2>
      <p className="muted"><b>{user.name || user.email}</b> ({user.email}) 계정의 로그인 비밀번호를 바꿉니다. 이전 비밀번호는 바로 쓸 수 없고, 새 비밀번호는 한 번만 보입니다.</p>
      <form onSubmit={go}>
        <div className="pills" role="tablist" style={{ margin: '8px 0 12px' }}>
          <button type="button" role="tab" aria-selected={mode === 'gen'} className={`pill${mode === 'gen' ? ' on' : ''}`} onClick={() => setMode('gen')}>임시 비밀번호 만들기</button>
          <button type="button" role="tab" aria-selected={mode === 'set'} className={`pill${mode === 'set' ? ' on' : ''}`} onClick={() => setMode('set')}>직접 지정</button>
        </div>
        {mode === 'set' && <label>새 비밀번호<input type="password" minLength={8} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8자 이상" /></label>}
        {err && <p className="error">{err}</p>}
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>취소</button>
          <button disabled={busy}>{busy ? '처리 중…' : mode === 'gen' ? '임시 비밀번호 발급' : '이 비밀번호로 바꾸기'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ user, session, onClose, onDone }: { user: HubUser; session: Session; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ok = email.trim().toLowerCase() === user.email.toLowerCase();
  const go = async (e: FormEvent) => {
    e.preventDefault(); if (!ok) return; setErr(''); setBusy(true);
    try { await usersApi(session, 'delete', { user_id: user.id, confirm_email: email.trim() }); onDone(); }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  return (
    <Modal onClose={onClose}>
      <h2>계정 삭제</h2>
      <p><b>{user.name || user.email}</b> ({user.email}) 계정을 삭제할까요? 이 작업은 되돌릴 수 없습니다.</p>
      {user.owned_apps.length > 0 && (
        <p className="alert">이 사람은 앱 담당자로 등록되어 있습니다: {user.owned_apps.map((a) => a.name).join(', ')}. 앱과 담당자 기록은 그대로 남습니다.</p>
      )}
      <p className="muted">확인을 위해 이메일 주소를 그대로 입력하세요.</p>
      <form onSubmit={go}>
        <label>이메일 확인<input type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={user.email} /></label>
        {err && <p className="error">{err}</p>}
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>취소</button>
          <button className="danger" disabled={!ok || busy}>{busy ? '삭제 중…' : '삭제'}</button>
        </div>
      </form>
    </Modal>
  );
}

type Filter = 'all' | Role;

/** 사용자 관리: 역할 변경, 비밀번호 초기화, 사용 중지, 삭제 (관리자 전용) */
export function MembersPage({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<HubUser[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''); const [filter, setFilter] = useState<Filter>('all');
  const [resetFor, setResetFor] = useState<HubUser | null>(null);
  const [delFor, setDelFor] = useState<HubUser | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);
  const session = ctx.session;

  const load = useCallback(async () => {
    if (!session) return;
    try { const j = await usersApi<{ users: HubUser[] }>(session, 'list'); setRows(j.users); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  }, [session]);
  useEffect(() => { if (ctx.isAdmin) load(); }, [ctx.isAdmin, load]);

  const act = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); await load(); ctx.refreshCounts?.(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const setRole = (u: HubUser, role: Role) => {
    if (u.role === role) return;
    const ask = role === 'disabled'
      ? `${u.email} 계정을 사용 중지할까요? 바로 로그인할 수 없게 됩니다.`
      : u.role === 'disabled' ? `${u.email} 계정을 다시 사용할 수 있게 하고, 역할을 ${ROLE_LABEL[role]}(으)로 할까요?` : null;
    if (ask && !confirm(ask)) return;
    return act(() => usersApi(session!, 'set_role', { user_id: u.id, role }));
  };

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter((r) => r.role === 'pending').length,
    staff: rows.filter((r) => r.role === 'staff').length,
    admin: rows.filter((r) => r.role === 'admin').length,
    disabled: rows.filter((r) => r.role === 'disabled').length,
  }), [rows]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (filter === 'all' || r.role === filter)
      && (!s || r.email.toLowerCase().includes(s) || (r.name || '').toLowerCase().includes(s)
        || r.owned_apps.some((a) => a.name.toLowerCase().includes(s) || a.slug.includes(s))));
  }, [rows, q, filter]);

  if (!ctx.isAdmin) return <div className="card">관리자만 볼 수 있습니다.</div>;
  if (!session) return null;

  return (
    <section>
      <div className="section-head"><h2>👥 사용자 관리</h2></div>
      <p className="muted">역할을 바꾸고, 비밀번호를 초기화하고, 사용을 중지하거나 계정을 삭제할 수 있습니다. 임시 비밀번호는 한 번만 보이며 서버에 저장되지 않습니다.</p>
      {counts.pending > 0 && <p className="warn">일반 사용자 {counts.pending}명이 있습니다. 개발자로 올리면 앱 신청과 DB 접속 정보를 쓸 수 있습니다.</p>}
      {err && <p className="error">{err}</p>}
      <div className="section-head">
        <input className="filter-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름, 이메일, 담당 앱 검색" aria-label="사용자 검색" />
        <Pills value={filter} onChange={setFilter} items={[
          ['all', '전체', counts.all], ['pending', '일반 사용자', counts.pending],
          ['staff', '개발자', counts.staff], ['admin', '관리자', counts.admin], ['disabled', '사용 중지', counts.disabled],
        ]} />
      </div>
      <div className="card flush"><table>
        <thead><tr><th>이름</th><th>이메일</th><th>가입</th><th>최근 로그인</th><th>역할</th><th>담당 앱</th><th>동작</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan={7} className="muted">맞는 사용자가 없습니다.</td></tr>}
          {shown.map((p) => {
            const mine = p.id === session.user.id;
            return (
              <tr key={p.id} className={p.role === 'pending' ? 'soon' : p.role === 'disabled' ? 'off' : ''}>
                <td><span className="avatar sm">{(p.name || p.email).slice(0, 1)}</span> {p.name || '—'}</td>
                <td>{p.email}</td>
                <td>{fmtTime(p.created_at)}</td>
                <td>{fmtTime(p.last_sign_in_at) || '—'}</td>
                <td>
                  <span className={`badge role-${p.role}`}>{ROLE_LABEL[p.role]}</span>
                  {mine && <span className="muted"> (나)</span>}
                  {p.banned && p.role !== 'disabled' && <span className="badge role-disabled">로그인 차단</span>}
                </td>
                <td>{p.owned_apps.length ? p.owned_apps.map((a) => a.name).join(', ') : <span className="muted">—</span>}</td>
                <td>{mine ? <span className="muted">내 비밀번호는 내 계정에서</span> : (
                  <div className="actions">
                    <select aria-label="역할 변경" disabled={busy} value={p.role} onChange={(e) => setRole(p, e.target.value as Role)}>
                      {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    {p.role === 'pending' && <button type="button" className="small" disabled={busy} onClick={() => setRole(p, 'staff')}>개발자로 올리기</button>}
                    {p.role === 'disabled'
                      ? <button type="button" className="ghost small" disabled={busy} onClick={() => setRole(p, 'pending')}>다시 사용</button>
                      : <button type="button" className="ghost small" disabled={busy} onClick={() => setRole(p, 'disabled')}>사용 중지</button>}
                    <button type="button" className="ghost small" disabled={busy} onClick={() => setResetFor(p)}>비밀번호 초기화</button>
                    <button type="button" className="danger small" disabled={busy} onClick={() => setDelFor(p)}>삭제</button>
                  </div>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {resetFor && <ResetDialog user={resetFor} session={session} onClose={() => setResetFor(null)} onDone={(password) => { const email = resetFor.email; setResetFor(null); load(); setRevealed({ email, password }); }} />}
      {delFor && <DeleteDialog user={delFor} session={session} onClose={() => setDelFor(null)} onDone={() => { setDelFor(null); load(); ctx.refreshCounts?.(); }} />}
      {revealed && <TempPassword email={revealed.email} password={revealed.password} onClose={() => setRevealed(null)} />}
    </section>
  );
}
