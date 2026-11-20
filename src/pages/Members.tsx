import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Ctx } from '../App';
import { fmtDate, fmtTime, ROLE_LABEL, usersApi, type HubAppSummary, type HubUser, type HubUsersRes, type Role } from '../sb';
import { appIcon, Modal, Pills } from '../ui';

function Copy({ text, label = '복사' }: { text: string; label?: string }) {
  const [t, setT] = useState(label);
  return <button type="button" className="ghost small" aria-live="polite" onClick={async () => { try { await navigator.clipboard.writeText(text); setT('복사됨'); } catch { setT('복사 실패'); } setTimeout(() => setT(label), 1500); }}>{t}</button>;
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
        {err && <p className="error" role="alert">{err}</p>}
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
  const apps = user.app_names ?? [];
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
      {apps.length > 0 && (
        <p className="alert">가입한 앱: {apps.map((a) => a.name).join(', ')}. 앱 안의 기록은 그대로 남고, 이 계정으로는 다시 들어올 수 없습니다.</p>
      )}
      <p className="muted">확인을 위해 이메일 주소를 그대로 입력하세요.</p>
      <form onSubmit={go}>
        <label>이메일 확인<input type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={user.email} /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>취소</button>
          <button className="danger" disabled={!ok || busy}>{busy ? '삭제 중…' : '삭제'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** 보기: 전체(통괄) · 허브 회원(개발·운영) · 앱별 사용자 */
type View = 'all' | 'hub' | 'app';
const ALL_APPS = '*';
/** 앱 이름표 하나 */
type AppTag = { slug: string; name: string; icon: string; members: number };

/** 이 사람이 가입한 앱 주소 목록 (옛 서버 응답이면 빈 배열) */
const appsOf = (u: HubUser): string[] => u.app_slugs ?? (u.app_names ?? []).map((a) => a.slug);
/** 허브 회원: 관리자·개발자이거나 앱 소속이 없는 허브 가입자 */
const isHubMember = (u: HubUser) => u.is_hub_member ?? (u.role === 'staff' || u.role === 'admin' || appsOf(u).length === 0);

/** 앱 배지 (한 줄에 3개까지, 나머지는 +N) */
function AppBadges({ user, index }: { user: HubUser; index: Map<string, AppTag> }) {
  const slugs = appsOf(user);
  if (!slugs.length) return <span className="badge hub-badge">🏠 허브</span>;
  const shown = slugs.slice(0, 3), rest = slugs.length - shown.length;
  return (
    <span className="app-badges">
      {shown.map((s) => {
        const a = index.get(s);
        return <span key={s} className="badge app-badge" title={a?.name ?? s}>{a?.icon ?? appIcon(s)} {a?.name ?? s}</span>;
      })}
      {rest > 0 && <span className="badge app-badge" title={slugs.slice(3).map((s) => index.get(s)?.name ?? s).join(', ')}>+{rest}</span>}
    </span>
  );
}

/** 사용자 관리: 역할 변경, 비밀번호 초기화, 사용 중지, 삭제 (관리자 전용) */
export function MembersPage({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<HubUsersRes | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''); const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [view, setView] = useState<View>('all'); const [appSel, setAppSel] = useState<string>(ALL_APPS);
  const [resetFor, setResetFor] = useState<HubUser | null>(null);
  const [delFor, setDelFor] = useState<HubUser | null>(null);
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null);
  const session = ctx.session;
  const rows = useMemo(() => data?.users ?? [], [data]);
  /** 허브 서버가 앱별 소속 정보를 주는지 (옛 판이면 false → 전체 사용자만) */
  const appsReady = data?.apps_ready === true;

  const load = useCallback(async () => {
    if (!session) return;
    try { setData(await usersApi<HubUsersRes>(session, 'list')); setErr(''); }
    catch (e) { setErr((e as Error).message); }
  }, [session]);
  useEffect(() => { if (ctx.isAdmin) load(); }, [ctx.isAdmin, load]);

  const act = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); await load(); ctx.refreshCounts?.(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const setRole = (u: HubUser, next: Role) => {
    if (u.role === next) return;
    const ask = next === 'disabled'
      ? `${u.email} 계정을 사용 중지할까요? 바로 로그인할 수 없게 됩니다.`
      : u.role === 'disabled' ? `${u.email} 계정을 다시 사용할 수 있게 하고, 역할을 ${ROLE_LABEL[next]}(으)로 할까요?` : null;
    if (ask && !confirm(ask)) return;
    return act(() => usersApi(session!, 'set_role', { user_id: u.id, role: next }));
  };

  /** 앱 목록: 서버가 준 앱(이름·인원) → 화면에 보이는 앱(아이콘) 순으로 합친다 */
  const appTags = useMemo<AppTag[]>(() => {
    const m = new Map<string, AppTag>();
    const counts = new Map((data?.apps ?? []).map((a: HubAppSummary) => [a.slug, a.members]));
    for (const a of ctx.counts?.apps ?? []) {
      if (m.has(a.slug)) continue;
      m.set(a.slug, { slug: a.slug, name: a.name, icon: a.card_icon || appIcon(a.slug), members: counts.get(a.slug) ?? 0 });
    }
    for (const a of data?.apps ?? []) {
      const cur = m.get(a.slug);
      if (cur) { cur.name = a.name; cur.members = a.members; }
      else m.set(a.slug, { slug: a.slug, name: a.name, icon: appIcon(a.slug), members: a.members });
    }
    // 옛 서버(앱 목록 없음)여도 사용자 행에 앱 주소가 오면 칩을 만든다
    for (const u of rows) {
      for (const a of u.app_names ?? []) {
        if (m.has(a.slug)) continue;
        m.set(a.slug, { slug: a.slug, name: a.name, icon: appIcon(a.slug), members: rows.filter((x) => appsOf(x).includes(a.slug)).length });
      }
    }
    return [...m.values()].sort((x, y) => x.name.localeCompare(y.name, 'ko'));
  }, [ctx.counts?.apps, data?.apps, rows]);
  const appIndex = useMemo(() => new Map(appTags.map((a) => [a.slug, a])), [appTags]);

  const counts = useMemo(() => ({
    all: rows.length,
    hub: rows.filter(isHubMember).length,
    app: rows.filter((r) => appsOf(r).length > 0).length,
    pending: rows.filter((r) => r.role === 'pending').length,
    staff: rows.filter((r) => r.role === 'staff').length,
    admin: rows.filter((r) => r.role === 'admin').length,
    disabled: rows.filter((r) => r.role === 'disabled').length,
  }), [rows]);

  const inView = useCallback((r: HubUser) => {
    if (view === 'hub') return isHubMember(r);
    if (view === 'app') return appSel === ALL_APPS ? appsOf(r).length > 0 : appsOf(r).includes(appSel);
    return true;
  }, [view, appSel]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => inView(r) && (roleFilter === 'all' || r.role === roleFilter)
      && (!s || r.email.toLowerCase().includes(s) || (r.name || '').toLowerCase().includes(s)
        || appsOf(r).some((slug) => slug.includes(s) || (appIndex.get(slug)?.name ?? '').toLowerCase().includes(s))
        || r.owned_apps.some((a) => a.name.toLowerCase().includes(s) || a.slug.includes(s))));
  }, [rows, q, roleFilter, inView, appIndex]);

  if (!ctx.isAdmin) return <div className="card">관리자만 볼 수 있습니다.</div>;
  if (!session) return null;

  const selectedApp = appSel === ALL_APPS ? null : appIndex.get(appSel) ?? null;
  const head = view === 'hub'
    ? '허브 회원(관리자·개발자, 앱 소속 없는 허브 가입자)만 봅니다.'
    : view === 'app'
      ? (selectedApp ? `‘${selectedApp.name}’에 가입한 사용자만 봅니다.` : '앱에 가입한 사용자를 앱별로 모아 봅니다.')
      : '모든 계정을 한곳에서 — 앱 이용자까지 검색·조회·중지·삭제·비밀번호 초기화.';

  return (
    <section>
      <div className="section-head"><h2>👥 사용자 관리</h2></div>
      <p className="muted">역할을 바꾸고, 비밀번호를 초기화하고, 사용을 중지하거나 계정을 삭제할 수 있습니다. 임시 비밀번호는 한 번만 보이며 서버에 저장되지 않습니다.</p>
      {!appsReady && data && (
        <p className="warn">앱별 소속 정보를 아직 받지 못했습니다(허브 서버 업데이트 전). 지금은 <b>전체 사용자</b>로만 나눠 볼 수 있고, 앱 배지는 서버를 새로 올리면 나타납니다.</p>
      )}
      {err && <p className="error" role="alert">{err}</p>}

      <div className="section-head" style={{ marginBottom: 8 }}>
        <Pills value={view} onChange={(v) => setView(v)} items={[
          ['all', '전체 사용자', counts.all],
          ['hub', '허브 회원', counts.hub],
          ['app', '앱별 사용자', counts.app],
        ]} />
      </div>
      {view === 'app' && (
        <div className="pills app-chips" role="tablist" aria-label="앱 선택">
          <button role="tab" aria-selected={appSel === ALL_APPS} className={`pill${appSel === ALL_APPS ? ' on' : ''}`} onClick={() => setAppSel(ALL_APPS)}>
            전체 앱<span className="cnt">{counts.app}</span>
          </button>
          {appTags.map((a) => (
            <button key={a.slug} role="tab" aria-selected={appSel === a.slug} className={`pill${appSel === a.slug ? ' on' : ''}`} onClick={() => setAppSel(a.slug)} title={a.slug}>
              <span aria-hidden="true">{a.icon}</span> {a.name}<span className="cnt">{a.members}</span>
            </button>
          ))}
          {appTags.length === 0 && <button type="button" className="pill" disabled>등록된 앱이 없습니다</button>}
        </div>
      )}
      <p className="muted small-note">{head}</p>

      <div className="section-head">
        <input className="filter-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름, 이메일, 앱 이름 검색" aria-label="사용자 검색" />
        <Pills value={roleFilter} onChange={setRoleFilter} items={[
          ['all', '전체 역할', counts.all],
          ['pending', '일반 사용자', counts.pending],
          ['staff', '개발자', counts.staff],
          ['admin', '관리자', counts.admin],
          ['disabled', '사용 중지', counts.disabled],
        ]} />
      </div>
      <div className="card flush"><table>
        <thead><tr><th>이름</th><th>이메일</th><th>허브 역할</th><th>앱 소속</th><th>가입 · 최근 로그인</th><th>동작</th></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan={6} className="muted">맞는 사용자가 없습니다.</td></tr>}
          {shown.map((p) => {
            const mine = p.id === session.user.id;
            const owner = p.owned_apps.map((a) => a.name).join(', ');
            return (
              <tr key={p.id} className={p.role === 'pending' ? 'soon' : p.role === 'disabled' ? 'off' : ''}>
                <td>
                  <span className="avatar sm">{(p.name || p.email).slice(0, 1)}</span> {p.name || '—'}
                  {owner && <small className="cell-sub">🛠 담당: {owner}</small>}
                </td>
                <td>{p.email}</td>
                <td>
                  <span className={`badge role-${p.role}`}>{ROLE_LABEL[p.role]}</span>
                  {mine && <span className="muted"> (나)</span>}
                  {p.banned && p.role !== 'disabled' && <span className="badge role-disabled">로그인 차단</span>}
                </td>
                <td><AppBadges user={p} index={appIndex} /></td>
                <td>
                  <span className="cell-sub">가입 {fmtDate(p.created_at) || '—'}</span>
                  <span className="cell-sub">로그인 {fmtTime(p.last_sign_in_at) || '—'}</span>
                </td>
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
