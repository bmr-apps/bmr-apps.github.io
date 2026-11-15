import { useCallback, useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { errMsg, fmtTime, opsOverview, STATUS_LABEL, type OpsApp, type OpsHealth, type OpsOverview } from '../sb';
import { Pills, Stat } from '../ui';

const n = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : '–');
const SRC_LABEL: Record<string, string> = { mail: '메일', ai: 'AI', audit: '감사' };
const SRC_TONE: Record<string, string> = { mail: 'k-amber', ai: 'k-green', audit: 'k-red' };
const RESULT_LABEL: Record<string, string> = { error: '실패', denied: '거부' };

/** /health 배지: 살아 있음 · DB 끊김(함수는 떠 있음) · 응답 없음 */
function HealthBadge({ h }: { h: OpsHealth | null }) {
  if (!h) return <span className="badge h-none">확인 안 함</span>;
  if (h.state === 'ok') return <span className="badge h-ok" title={`HTTP ${h.http} · DB ${h.db ? '연결됨' : '알 수 없음'}`}>● 정상</span>;
  if (h.state === 'warn') return <span className="badge h-warn" title={`HTTP ${h.http} · DB 연결 안 됨`}>● DB 끊김</span>;
  return <span className="badge h-bad" title={h.http == null ? '응답 없음 (시간 초과·연결 실패)' : `HTTP ${h.http}`}>● 응답 없음</span>;
}

/** 앱 행에서 24시간 사용량을 한 눈에: 메일 보냄/실패, AI 호출/토큰 */
function Usage({ app }: { app: OpsApp }) {
  const mailFail = app.mail.error + app.mail.denied;
  const aiCalls = app.ai.ok + app.ai.error;
  const aiFail = app.ai.error + app.ai.denied;
  return (
    <>
      <td style={{ whiteSpace: 'nowrap' }}>
        <b>{n(app.mail.sent)}</b>{mailFail > 0 && <> <span className="badge h-bad" title={`실패 ${app.mail.error} · 거부 ${app.mail.denied}`}>실패 {n(mailFail)}</span></>}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <b>{n(aiCalls)}</b> <span className="muted">{app.ai.tokens ? `${n(app.ai.tokens)}토큰` : ''}</span>
        {aiFail > 0 && <> <span className="badge h-bad" title={`실패 ${app.ai.error} · 거부 ${app.ai.denied}`}>실패 {n(aiFail)}</span></>}
      </td>
    </>
  );
}

/** 관리자 전용: 전체 앱의 상태·메일·AI 사용량·최근 오류를 한 화면에 */
export function MonitorPage({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<OpsOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'all' | 'ok' | 'warn' | 'down' | 'none'>('all');

  const load = useCallback(async () => {
    if (!ctx.session) return;
    setBusy(true); setErr('');
    try { setData(await opsOverview(ctx.session)); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  }, [ctx.session]);

  useEffect(() => { load(); }, [load]);

  if (!ctx.isAdmin) return <div className="card">관리자만 볼 수 있습니다.</div>;

  const apps = data?.apps ?? [];
  const kindOf = (a: OpsApp) => (!a.health ? 'none' : a.health.state);
  const cnt = (k: string) => apps.filter((a) => kindOf(a) === k).length;
  const shown = apps.filter((a) => tab === 'all' || kindOf(a) === tab);
  const t = data?.totals;
  const last = data ? fmtTime(data.at) : '';

  return (
    <section aria-busy={busy}>
      <div className="section-head">
        <h2>📊 운영 현황</h2>
        <button disabled={busy} onClick={load}>{busy ? '확인 중…' : '🔄 다시 확인'}</button>
      </div>
      <p className="muted">
        앱마다 최근 {data?.window_hours ?? 24}시간 메일·AI 사용량과 오류를 모으고, <b>운영 중인 앱의 서버 함수 <code>/health</code></b>를
        {' '}{data ? (data.probe.timeout_ms / 1000).toFixed(1) : '2.5'}초 안에 병렬로 확인합니다. 10초 안에 다시 누르면 같은 결과입니다.
      </p>
      {err && <p className="error" role="alert">{err}</p>}
      {data && (!data.mail_ready || !data.ai_ready || !data.errors_ready) && (
        <p className="warn" role="status">
          일부 기록 표를 읽지 못했습니다{!data.mail_ready ? ' · 메일 발송 기록' : ''}{!data.ai_ready ? ' · AI 호출 기록' : ''}{!data.errors_ready ? ' · 최근 오류' : ''}.
          서버 함수(hub-devtools)를 새로 배포했는지, 마이그레이션이 적용됐는지 확인해 주세요.
        </p>
      )}

      <div className="stats">
        <Stat tone="green" icon="🧩" label="운영 중 앱" value={n(t?.apps_active)} sub={`전체 ${n(t?.apps_total)}개 · 준비·중지 ${n(t?.apps_problem)}개`} />
        <Stat tone="blue" icon="✉️" label="24시간 메일" value={<>{n(t?.mail_sent)}<small>통</small></>} sub={t?.mail_failed ? `실패·거부 ${n(t.mail_failed)}건` : '실패 없음'} />
        <Stat tone="violet" icon="🤖" label="24시간 AI 호출" value={<>{n(t?.ai_calls)}<small>번</small></>} sub={`${n(t?.ai_tokens)} 토큰${t?.ai_failed ? ` · 실패·거부 ${n(t.ai_failed)}` : ''}`} />
        <Stat tone={t?.errors ? 'red' : 'amber'} icon="🚨" label="24시간 오류" value={n(t?.errors)} sub={t?.errors ? '아래 최근 오류를 확인하세요' : '오류 없음'} />
      </div>

      <div className="section-head">
        <h3>앱별 상태·사용량</h3>
        <Pills value={tab} onChange={setTab} items={[['all', '전체', apps.length], ['ok', '정상', cnt('ok')], ['down', '응답 없음', cnt('down')], ['warn', 'DB 끊김', cnt('warn')], ['none', '확인 안 함', cnt('none')]]} />
      </div>
      {!data ? <div className="card empty">{busy ? '불러오는 중…' : '자료가 없습니다.'}</div> : shown.length === 0 ? <div className="card empty">해당하는 앱이 없습니다.</div> : (
        <div className="card flush" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>앱</th><th>상태</th><th>/health</th><th>응답</th><th>메일 24h</th><th>AI 24h</th><th>열기</th></tr></thead>
            <tbody>{shown.map((a) => (
              <tr key={a.id}>
                <td>
                  <b>{a.name}</b> <code>/{a.slug}</code>
                  <br /><small className="muted">{a.health ? `메일 ${a.health.mail_ready ? '준비' : '미준비'} · AI ${a.health.ai_hub ? '허브' : '미연결'}` : '서버 함수 확인 대상 아님'}</small>
                </td>
                <td><span className={`badge s-${a.status}`}>{STATUS_LABEL[a.status]}</span></td>
                <td><HealthBadge h={a.health} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{a.health ? `${n(a.health.ms)}ms` : '–'}</td>
                <Usage app={a} />
                <td><a href={a.url} target="_blank" rel="noopener noreferrer">열기 ↗</a></td>
              </tr>))}</tbody>
          </table>
        </div>)}
      {data && <p className="muted">/health 확인 {n(data.probe.probed)}개 · {n(data.probe.took_ms)}ms 걸림{data.probe.skipped ? ` · ${data.probe.skipped}개는 한 번에 확인할 수 있는 수를 넘어 건너뜀` : ''}{data.cached ? ' · 10초 안에 다시 눌러 저장된 결과' : ''} · {last}</p>}

      <div className="section-head"><h3>최근 오류·알림</h3></div>
      <p className="muted">메일 실패·거부, AI 실패·거부, 감사 기록의 실패를 한 줄기로 모았습니다 (최근 7일 안에서 {data?.recent_errors.length ?? 0}건).</p>
      {(data?.recent_errors.length ?? 0) === 0 ? <div className="card empty">최근 오류가 없습니다. 🎉</div> : (
        <div className="card flush" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>때</th><th>곳</th><th>앱</th><th>결과</th><th>내용</th></tr></thead>
            <tbody>{(data?.recent_errors ?? []).map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(e.at)}</td>
                <td><span className={`badge ${SRC_TONE[e.src] ?? 'k-gray'}`}>{SRC_LABEL[e.src] ?? e.src}</span></td>
                <td><code>{e.slug || '—'}</code></td>
                <td><span className={`badge ${e.status === 'denied' ? 'r-pending' : 'r-rejected'}`}>{RESULT_LABEL[e.status] ?? e.status}</span></td>
                <td className="pre" style={{ fontSize: 13 }}>{e.detail || e.extra}</td>
              </tr>))}</tbody>
          </table>
        </div>)}
    </section>
  );
}
