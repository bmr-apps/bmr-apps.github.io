import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Ctx } from '../App';
import { dbcred, fmtTime, type DbApp, type DbConn } from '../sb';

type List = { apps: DbApp[]; me: { email: string; admin: boolean; staff?: boolean } };

function useDbApps(session: Session | null) {
  const [data, setData] = useState<List | null>(null); const [err, setErr] = useState('');
  const load = useCallback(() => { if (session) dbcred<List>(session, 'list').then(setData).catch((e) => setErr((e as Error).message)); }, [session]);
  useEffect(load, [load]);
  return { data, err, load };
}

function Copy({ text, label = '복사' }: { text: string; label?: string }) {
  const [t, setT] = useState(label);
  return <button type="button" className="ghost small" onClick={async () => { try { await navigator.clipboard.writeText(text); setT('복사됨'); } catch { setT('복사 실패'); } setTimeout(() => setT(label), 1500); }}>{t}</button>;
}

/** 한 번만 보여 주는 접속 정보. 닫으면 화면 메모리에서도 지운다. */
function Revealed({ conn, onClose }: { conn: DbConn; onClose: () => void }) {
  return (
    <div className="card warn" style={{ marginTop: 12 }}>
      <b>🔐 지금 한 번만 보입니다. 바로 안전한 곳에 저장하세요.</b>
      <p className="muted" style={{ margin: '4px 0 10px' }}>이 창을 닫으면 다시 볼 수 없습니다. 저장소·채팅·메일·화면 캡처에 올리지 마세요. 잃어버리면 '새 비밀번호 발급'을 누르세요.</p>
      <dl className="meta">
        <dt>비밀번호</dt><dd><code>{conn.password}</code> <Copy text={conn.password || ''} /></dd>
        <dt>.env.local</dt><dd><code>DATABASE_URL={conn.database_url}</code> <Copy text={`DATABASE_URL=${conn.database_url}`} /></dd>
        <dt>호스트</dt><dd><code>{conn.host}</code> · 포트 <code>{conn.port}</code> (세션) / <code>{conn.port_transaction}</code> (트랜잭션)</dd>
        <dt>사용자</dt><dd><code>{conn.user}</code> (직접 접속은 <code>{conn.user_direct}</code> @ <code>{conn.direct_host}</code>, IPv6 전용)</dd>
        <dt>DB · 스키마</dt><dd><code>{conn.database}</code> · <code>{conn.schema}</code></dd>
      </dl>
      <p className="muted small">쓰는 곳: <code>npm run db:migrate</code> · <code>psql "$DATABASE_URL"</code> · AI 코딩 도구의 DB 연결 설정</p>
      <div className="row end"><button type="button" onClick={onClose}>저장했어요, 닫기</button></div>
    </div>
  );
}

export function DbCredCard({ app, session, admin, reload }: { app: DbApp; session: Session; admin: boolean; reload: () => void }) {
  const [conn, setConn] = useState<DbConn | null>(null); const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const act = async (action: 'reveal' | 'rotate') => {
    if (action === 'rotate' && !confirm(`${app.name}: 새 비밀번호를 발급할까요?\n\n이전 비밀번호를 쓰던 곳(.env.local, AI 도구 등)은 바로 끊깁니다. 서버 함수는 영향 없습니다.`)) return;
    if (action === 'reveal' && !confirm('처음 비밀번호는 딱 한 번만 보입니다. 지금 저장할 준비가 됐나요?')) return;
    setBusy(action); setErr(''); setMsg('');
    try { const j = await dbcred<{ conn: DbConn }>(session, action, { app_id: app.app_id }); setConn(j.conn); reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const invite = async (id: number, email: string | null) => {
    if (!confirm(`${email} 로 BMR APPS 가입 초대 메일을 보낼까요?`)) return;
    setErr(''); setMsg('');
    try { await dbcred(session, 'invite', { owner_id: id }); setMsg(`${email} 로 초대 메일을 보냈습니다.`); reload(); } catch (e) { setErr((e as Error).message); }
  };
  const c = app.conn;
  return (
    <div className="card" id={`db-${app.app_id}`}>
      <h3>🗄️ {app.name} <span className="badge">{app.schema}</span></h3>
      <dl className="meta">
        <dt>DB 계정</dt><dd><code>{c.user}</code></dd>
        <dt>접속</dt><dd><code>{c.host}:{c.port}</code> · DB <code>{c.database}</code> · 스키마 <code>{c.schema}</code></dd>
        <dt>비밀번호</dt><dd>{app.pending_initial ? <span className="ok">처음 비밀번호가 준비되어 있습니다 (아직 아무도 받지 않음)</span> : <span className="muted">이미 전달됨 — 잊었으면 새로 발급하세요</span>}</dd>
      </dl>
      <div className="row wrap">
        {app.pending_initial && <button disabled={!!busy} onClick={() => act('reveal')}>{busy === 'reveal' ? '여는 중…' : '🔑 처음 비밀번호 받기'}</button>}
        <button className={app.pending_initial ? 'ghost' : ''} disabled={!!busy} onClick={() => act('rotate')}>{busy === 'rotate' ? '발급 중…' : '♻️ 새 비밀번호 발급'}</button>
      </div>
      {err && <p className="error">{err}</p>}{msg && <p className="ok">{msg}</p>}
      {conn && <Revealed conn={conn} onClose={() => setConn(null)} />}
      <details style={{ marginTop: 12 }}>
        <summary>비밀번호를 직접 바꾸려면</summary>
        <p>내 계정으로 접속해서 psql 의 <code>\password</code> 를 쓰면 새 비밀번호가 암호화된 형태로만 서버에 갑니다.</p>
        <pre className="pre"><code>{`psql "$DATABASE_URL"\n=> \\password ${app.role}`}</code></pre>
        <p className="muted">SQL 로는 <code>alter role current_user password '새-비밀번호';</code> (평문이 서버로 가므로 <code>\password</code> 권장). 바꾸면 예전 비밀번호를 쓰던 곳이 모두 끊깁니다. 서버 함수 <code>{app.slug}-fn</code> 는 별도 계정이라 영향이 없습니다.</p>
      </details>
      {app.recent.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>최근 기록: {app.recent.map((r) => `${r.label} · ${r.issued_to} · ${fmtTime(r.created_at)}`).join(' / ')}</p>}
      {admin && app.owners.length > 0 && (
        <div className="owners"><h4>담당자 허브 계정 (관리자만 보임)</h4>
          <div className="owner-list">{app.owners.map((o) => (
            <div key={o.id} className="owner">
              <span className="avatar">{o.name.slice(0, 1)}</span>
              <span className="grow"><b>{o.name}</b><small className="muted block">{o.email || '메일 없음'} · {o.has_account ? (o.staff ? '허브 계정 있음 · 개발자 ✓' : '허브 계정 있음 · 일반 사용자 (개발자로 올리면 DB를 받을 수 있음)') : '허브 계정 없음'}</small></span>
              {!o.has_account && o.email && <button className="ghost small" onClick={() => invite(o.id, o.email)}>✉️ 가입 안내 메일 보내기</button>}
            </div>))}
          </div>
        </div>)}
    </div>
  );
}

/** 앱 상세 창 안에 넣는 부분: 담당자·관리자에게만 보인다 */
export function DbCredSection({ ctx, appId }: { ctx: Ctx; appId: number }) {
  const { data, load } = useDbApps(ctx.session);
  const app = data?.apps.find((a) => Number(a.app_id) === Number(appId)); // 함수는 bigint 를 문자열로 돌려줌
  if (!ctx.session || !app) return null;
  return <div style={{ marginTop: 14 }}><h4>🗄️ DB 접속 정보</h4><DbCredCard app={app} session={ctx.session} admin={!!data?.me.admin} reload={load} /></div>;
}

/** /hub/db — 내가 담당인 앱의 DB 접속 정보 (개발자·관리자만, 담당 메일이 맞거나 관리자) */
export function DbCredPage({ ctx }: { ctx: Ctx }) {
  const { data, err, load } = useDbApps(ctx.session);
  if (!ctx.session) return null;
  return (
    <section>
      <div className="section-head"><h3>🗄️ 내 앱 DB 접속 정보</h3></div>
      <p className="card">이제 앱마다 <b>대시보드 → 내 서비스 → 내 앱 → 앱 정보 → DB 접속 정보</b>에서 같은 일(처음 받기·새로 발급·직접 바꾸기)을 할 수 있어요. 이 화면은 담당 앱을 한꺼번에 볼 때 쓰세요.</p>
      <p className="muted">BMR APPS 가 만든 앱의 데이터베이스 계정입니다. 처음 비밀번호는 담당자가 <b>한 번</b> 받을 수 있고, 언제든 새로 발급할 수 있습니다. 모든 받기·발급은 기록됩니다(비밀번호 값은 기록하지 않음).</p>
      {err && <p className="error">{err}</p>}
      {!data ? <p className="muted">불러오는 중…</p> : data.apps.length === 0 ? (
        <div className="card empty">
          <p>담당인 앱이 없습니다.</p>
          <p className="muted">앱 담당자로 등록된 메일과 지금 로그인한 메일(<b>{data.me.email}</b>)이 같아야 합니다. 다르면 관리자(dev@bmrschool.org)에게 담당자 메일을 확인해 달라고 하세요.</p>
        </div>) : data.apps.map((a) => <DbCredCard key={a.app_id} app={a} session={ctx.session!} admin={data.me.admin} reload={load} />)}
      <div className="card"><p>허브 로그인 비밀번호는 <a href="/hub/account">내 계정</a>에서 바꿀 수 있습니다.</p></div>
      <div className="card">
        <h3>허브 계정이 없는 담당자라면</h3>
        <p className="muted">담당자로 등록된 메일로 <a href="/hub/login">가입</a>한 뒤, 관리자가 개발자로 올리면 이 화면에 앱이 나타납니다.</p>
      </div>
    </section>
  );
}

