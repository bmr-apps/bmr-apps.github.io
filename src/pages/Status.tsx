import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtTime, runHealth, STATUS_LABEL, type App, type Health } from '../sb';

export function StatusPage({ ctx }: { ctx: Ctx }) {
  const [apps, setApps] = useState<App[]>([]); const [latest, setLatest] = useState<Record<number, Health>>({});
  const [recent, setRecent] = useState<Health[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = async () => {
    const [a, l, r] = await Promise.all([
      sb.from('apps').select('*').neq('status', 'retired').order('sort'), sb.from('app_health_latest').select('*'),
      sb.from('health_checks').select('app_id, checked_at, url, http_status, ok, response_ms, error').order('checked_at', { ascending: false }).limit(200),
    ]);
    if (a.error) setErr(errMsg(a.error));
    setApps((a.data as App[]) ?? []); setLatest(Object.fromEntries(((l.data as Health[]) ?? []).map((x) => [x.app_id, x]))); setRecent((r.data as Health[]) ?? []);
  };
  useEffect(() => { load(); }, []);
  const run = async () => {
    if (!ctx.session) return; setBusy(true); setErr(''); setMsg('');
    try { const r = await runHealth(ctx.session); setMsg(`${fmtTime(r.checked_at)} 점검 완료: ${r.results.filter((x) => x.ok).length}/${r.results.length}개 정상`); await load(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section>
      <div className="head"><h2>운영 상태</h2>{ctx.isAdmin && <button disabled={busy} onClick={run}>{busy ? '점검 중…' : '지금 점검'}</button>}</div>
      <p className="muted">운영 중인 앱 주소를 매시 정각에 자동으로 열어 봅니다. 응답 코드 200~399면 정상입니다.</p>
      {err && <p className="error">{err}</p>}{msg && <p className="ok">{msg}</p>}
      <table className="card">
        <thead><tr><th>앱</th><th>상태</th><th>점검 결과</th><th>HTTP</th><th>응답 시간</th><th>최근 24회 기록</th><th>마지막 점검</th></tr></thead>
        <tbody>{apps.map((a) => {
          const h = latest[a.id]; const hist = recent.filter((x) => x.app_id === a.id).slice(0, 24).reverse();
          return (
            <tr key={a.id}>
              <td><a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a></td>
              <td><span className={`badge s-${a.status}`}>{STATUS_LABEL[a.status]}</span></td>
              <td>{!h ? <span className="muted">기록 없음</span> : h.ok ? <span className="ok">정상</span> : <span className="error">이상{h.error ? ` (${h.error})` : ''}</span>}</td>
              <td>{h?.http_status ?? '-'}</td><td>{h?.response_ms != null ? `${h.response_ms}ms` : '-'}</td>
              <td><span className="spark">{hist.map((x, i) => <i key={i} className={x.ok ? 'ok' : 'bad'} title={`${fmtTime(x.checked_at)} ${x.http_status ?? x.error}`} />)}</span></td>
              <td>{fmtTime(h?.checked_at ?? null)}</td>
            </tr>);
        })}</tbody>
      </table>
    </section>
  );
}
