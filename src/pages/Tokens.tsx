import { useEffect, useState, type FormEvent } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtDate, daysLeft, KIND_LABEL, type App, type TokenLog } from '../sb';
import { Pills } from '../ui';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const blank = () => ({ app_id: '', kind: 'github_pat', label: '', issued_to: '', issued_at: today(), expires_at: '', memo: '' });

export function TokensPage({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<TokenLog[]>([]); const [apps, setApps] = useState<Pick<App, 'id' | 'name'>[]>([]);
  const [f, setF] = useState(blank()); const [err, setErr] = useState(''); const [showAll, setShowAll] = useState(false);
  const load = async () => {
    const [t, a] = await Promise.all([sb.from('token_logs').select('*').order('expires_at', { ascending: true, nullsFirst: false }), sb.from('apps').select('id, name').order('sort')]);
    if (t.error) setErr(errMsg(t.error)); setRows((t.data as TokenLog[]) ?? []); setApps(a.data ?? []);
  };
  useEffect(() => { if (ctx.isAdmin) load(); }, [ctx.isAdmin]);
  if (!ctx.isAdmin) return <div className="card">관리자만 볼 수 있습니다.</div>;

  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    const { error } = await sb.from('token_logs').insert({ ...f, app_id: f.app_id ? Number(f.app_id) : null, expires_at: f.expires_at || null });
    if (error) return setErr(errMsg(error));
    setF(blank()); load(); ctx.refreshCounts?.();
  };
  const revoke = async (t: TokenLog) => {
    if (!confirm('폐기했다고 기록할까요? (실제 폐기는 GitHub·Supabase 화면에서 먼저 하세요)')) return;
    const { error } = await sb.from('token_logs').update({ revoked_at: today() }).eq('id', t.id); if (error) setErr(errMsg(error)); else { load(); ctx.refreshCounts?.(); }
  };
  const appName = (id: number | null) => apps.find((a) => a.id === id)?.name ?? '공통';
  const shown = rows.filter((r) => showAll || !r.revoked_at);
  const soon = rows.filter((r) => !r.revoked_at && (daysLeft(r.expires_at) ?? 99) <= 14).length;
  return (
    <section>
      <div className="section-head"><h2>🔑 토큰 발급 기록</h2></div>
      <p className="warn">🙅 토큰·키 값은 절대 적지 마세요. 누구에게 어떤 종류를 언제까지 줬는지만 기록합니다.</p>
      {soon > 0 && <p className="alert">⏰ 14일 안에 만료되거나 이미 만료된 토큰이 {soon}개 있습니다.</p>}
      <form className="card form accent" onSubmit={add}>
        <h3>새 기록</h3>
        <div className="cols">
          <label>앱<select value={f.app_id} onChange={(e) => setF({ ...f, app_id: e.target.value })}><option value="">공통</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>종류<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>이름표<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="예: bmr-apps-bot" /></label>
          <label>받은 사람<input required value={f.issued_to} onChange={(e) => setF({ ...f, issued_to: e.target.value })} /></label>
          <label>발급일<input type="date" required value={f.issued_at} onChange={(e) => setF({ ...f, issued_at: e.target.value })} /></label>
          <label>만료일<input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></label>
        </div>
        <label>메모<input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="권한 범위 등 (값은 적지 않음)" /></label>
        {err && <p className="error">{err}</p>}
        <div className="row"><button>기록 추가</button></div>
      </form>
      <div className="section-head"><h3>발급 목록</h3>
        <Pills value={showAll ? 'all' : 'live'} onChange={(v) => setShowAll(v === 'all')} items={[['live', '사용 중', rows.filter((r) => !r.revoked_at).length], ['all', '폐기 포함 전체', rows.length]]} />
      </div>
      {shown.length === 0 && <div className="card empty">기록이 없습니다.</div>}
      {shown.map((t) => {
        const d = daysLeft(t.expires_at);
        const state = t.revoked_at ? `폐기 ${fmtDate(t.revoked_at)}` : d === null ? '만료 없음' : d < 0 ? '만료됨' : d <= 14 ? `${d}일 남음` : '사용 중';
        const cls = t.revoked_at ? 'revoked' : d !== null && d < 0 ? 'expired' : d !== null && d <= 14 ? 'soon' : 'live';
        const b = { revoked: 'gray', expired: 'red', soon: 'amber', live: 'green' }[cls];
        return (
          <div key={t.id} className={`card item row-item b-${b} ${cls}`}>
            <span className="tile-ico sm">🔑</span>
            <div className="grow">
              <h3>{t.label || KIND_LABEL[t.kind] || t.kind} <span className={`badge k-${b}`}>{state}</span></h3>
              <small className="muted">{appName(t.app_id)} · {KIND_LABEL[t.kind] ?? t.kind} · 받은 사람 {t.issued_to}{t.memo && ` · ${t.memo}`}</small>
            </div>
            <div className="metrics">
              <span><small>발급일</small><b>{fmtDate(t.issued_at)}</b></span>
              <span><small>만료일</small><b>{fmtDate(t.expires_at) || '-'}</b></span>
            </div>
            {!t.revoked_at ? <button className="ghost small" onClick={() => revoke(t)}>폐기 기록</button> : <span className="small-gap" />}
          </div>);
      })}
    </section>
  );
}
