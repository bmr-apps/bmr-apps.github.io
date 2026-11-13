import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtTime, runHealth, healthState, STATUS_LABEL, type App, type Health } from '../sb';
import { Pills, Stat, appIcon } from '../ui';
import { ChecksSummary } from './Checks';

export function StatusPage({ ctx }: { ctx: Ctx }) {
  const [apps, setApps] = useState<App[]>([]); const [latest, setLatest] = useState<Record<number, Health>>({});
  const [recent, setRecent] = useState<Health[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<'all' | 'ok' | 'checking' | 'down' | 'none'>('all');
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
    try { const r = await runHealth(ctx.session); setMsg(`${fmtTime(r.checked_at)} 점검 완료: ${r.results.filter((x) => x.ok).length}/${r.results.length}개 정상`); await load(); ctx.refreshCounts?.(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const kind = (a: App) => healthState(latest[a.id]);
  const cnt = (k: string) => apps.filter((a) => kind(a) === k).length;
  const times = apps.map((a) => latest[a.id]?.response_ms).filter((x): x is number => x != null);
  const avg = times.length ? Math.round(times.reduce((s, x) => s + x, 0) / times.length) : null;
  const lastAt = Object.values(latest).map((h) => h.checked_at).sort().pop() ?? null;
  return (
    <section aria-busy={busy}>
      <div className="section-head"><h2>📡 운영 상태</h2>{ctx.isAdmin && <button disabled={busy} onClick={run}>{busy ? '점검 중…' : '🩺 지금 점검'}</button>}</div>
      <p className="muted">운영 중인 앱 주소를 매시 정각에 자동으로 열어 봅니다. 응답 코드 200~399면 정상입니다. 한 번 실패하면 <b>확인 중</b>, 2번 연속 실패하면 <b>장애</b>로 표시합니다. 기록은 30일 동안 보관합니다.</p>
      {err && <p className="error" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}
      <div className="stats">
        <Stat tone="green" icon="✅" label="정상" value={cnt('ok')} sub={`점검 대상 ${apps.length}개`} />
        <Stat tone="red" icon="🚨" label="장애" value={cnt('down')} sub={cnt('down') ? '2번 연속 실패 · 확인이 필요해요' : cnt('checking') ? `확인 중 ${cnt('checking')}개 (한 번 실패)` : '문제 없음'} />
        <Stat tone="blue" icon="⚡" label="평균 응답" value={avg != null ? <>{avg}<small>ms</small></> : '–'} sub="마지막 점검 기준" />
        <Stat tone="violet" icon="🕒" label="마지막 점검" value={lastAt ? new Date(lastAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }) : '–'} sub={lastAt ? fmtTime(lastAt) : '기록 없음'} />
      </div>
      <div className="section-head"><h3>앱별 점검 결과</h3>
        <Pills value={tab} onChange={setTab} items={[['all', '전체', apps.length], ['ok', '정상', cnt('ok')], ['checking', '확인 중', cnt('checking')], ['down', '장애', cnt('down')], ['none', '기록 없음', cnt('none')]]} />
      </div>
      {apps.filter((a) => tab === 'all' || kind(a) === tab).map((a) => {
        const h = latest[a.id]; const hist = recent.filter((x) => x.app_id === a.id).slice(0, 24).reverse(); const k = kind(a);
        return (
          <div key={a.id} className={`card item row-item b-${k === 'ok' ? 'green' : k === 'down' ? 'red' : k === 'checking' ? 'amber' : 'gray'}`}>
            <span className="tile-ico sm">{appIcon(a.slug)}</span>
            <div className="grow">
              <h3><a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a> <span className={`badge s-${a.status}`}>{STATUS_LABEL[a.status]}</span></h3>
              <small className="muted">{a.url.replace(/^https?:\/\//, '')} · 마지막 점검 {fmtTime(h?.checked_at ?? null) || '-'}</small>
            </div>
            <div className="metrics">
              <span><small>HTTP</small><b>{h?.http_status ?? '-'}</b></span>
              <span><small>응답</small><b>{h?.response_ms != null ? `${h.response_ms}ms` : '-'}</b></span>
              <span><small>최근 24회</small><span className="spark">{hist.length ? hist.map((x, i) => <i key={i} className={x.ok ? 'ok' : 'bad'} title={`${fmtTime(x.checked_at)} ${x.http_status ?? x.error}`} />) : <em className="muted">없음</em>}</span></span>
            </div>
            {k === 'none' ? <span className="badge h-none">기록 없음</span> : k === 'ok' ? <span className="badge h-ok">● 정상</span>
              : k === 'checking' ? <span className="badge h-warn" title={h?.error ?? ''}>● 확인 중 (한 번 실패{h?.error ? ` · ${h.error}` : ''})</span>
              : <span className="badge h-bad" title={h?.error ?? ''}>● 장애 ({h?.fail_streak ?? 2}번 연속 실패{h?.error ? ` · ${h.error}` : ''})</span>}
          </div>);
      })}
      {ctx.isAdmin && <ChecksSummary apps={apps} />}
    </section>
  );
}
