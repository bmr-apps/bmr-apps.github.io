// 개발자 셀프서비스 (1단계): 자동 배포 요청 · 함수 비밀값 · 서버 함수 · 로그 보기.
// 권한은 서버(hub-devtools, DB 함수)가 확인한다. 이 화면은 보여 주기만 한다.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Ctx } from '../App';
import { sb, devtools, errMsg, fmtTime, DEV_REQ_KIND, DEV_REQ_STATUS, type DevInfoRes, type DevRequest, type LogRow } from '../sb';

const kst = (d: Date) => d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const logTime = (s: string) => { const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z'); return isNaN(+d) ? s : kst(d); };
const epoch = (v: number | string) => { const d = new Date(typeof v === 'number' ? v : Number(v) || v); return isNaN(+d) ? '' : fmtTime(d.toISOString()); };

export function SelfServiceSection({ ctx, appId, onChanged }: { ctx: Ctx; appId: number; onChanged?: () => void }) {
  const [d, setD] = useState<DevInfoRes | null>(null);
  const [hidden, setHidden] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    if (!ctx.session) return;
    try { setD(await devtools<DevInfoRes>(ctx.session, 'info', { app_id: appId })); setErr(''); }
    catch (e) { const st = (e as { status?: number }).status; if (st === 403 || st === 404) setHidden(true); else setErr((e as Error).message); }
  }, [ctx.session, appId]);
  useEffect(() => { load(); }, [load]);
  if (hidden || !ctx.session) return null;
  if (!d) return err ? <div className="devinfo"><p className="error" role="alert">셀프서비스 정보를 읽지 못했습니다: {err}</p></div> : null;
  return (
    <div className="devinfo selfservice">
      <div className="devinfo-head"><h4>🧰 개발자 셀프서비스 <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>관리자에게 부탁하지 않고 직접</span></h4></div>
      <p className="muted">비밀값·서버 함수·로그를 이 앱 몫만 직접 다룹니다. 모든 변경은 감사 기록에 남습니다 (비밀값은 이름만). 자세한 내용은 <a href="/guide#selfservice">시작 가이드 · 개발자 셀프서비스</a>.</p>
      <AutoDeployRequest ctx={ctx} d={d} reload={async () => { await load(); onChanged?.(); }} />
      <Secrets ctx={ctx} d={d} reload={load} />
      <Functions ctx={ctx} d={d} reload={load} />
      <Logs ctx={ctx} d={d} />
    </div>
  );
}

function AutoDeployRequest({ ctx, d, reload }: { ctx: Ctx; d: DevInfoRes; reload: () => void }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const lr = d.last_request;
  if (d.app.fn_auto_deploy) return (
    <><h5>서버 함수 자동 배포</h5><p className="muted" style={{ margin: 0 }}><span className="badge r-approved">켜짐</span> main 에 push 하면 검사 후 이 앱의 서버 함수가 자동으로 배포됩니다.</p></>);
  const ask = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('');
    const { error } = await sb.rpc('request_fn_auto_deploy', { p_app_id: d.app.id, p_note: note.trim() });
    setBusy(false); if (error) return setErr(errMsg(error));
    setNote(''); setMsg('요청했습니다. 관리자가 승인하면 바로 켜집니다.'); reload();
  };
  const cancel = async () => { if (!lr) return; setBusy(true); const { error } = await sb.rpc('cancel_dev_request', { p_request_id: lr.id }); setBusy(false); if (error) return setErr(errMsg(error)); reload(); };
  const decide = async (approve: boolean) => {
    if (!lr) return;
    const n = approve ? '' : prompt('반려 이유 (개발자에게 보입니다)', '') ?? null;
    if (n === null) return;
    if (approve && !confirm(`'${d.app.name}'의 서버 함수 자동 배포를 켤까요?\n\n켜면 이 저장소에 push 할 수 있는 사람은 함수 코드로 프로젝트 공용 키를 읽을 수 있습니다.`)) return;
    setBusy(true); const { error } = await sb.rpc('decide_dev_request', { p_request_id: lr.id, p_approve: approve, p_note: n }); setBusy(false);
    if (error) return setErr(errMsg(error)); reload(); ctx.refreshCounts?.();
  };
  return (
    <>
      <h5>서버 함수 자동 배포 <span className="badge r-rejected">꺼짐</span></h5>
      {lr?.status === 'pending' ? (
        <div className="card" style={{ padding: 12 }}>
          <b>⏳ 켜 달라고 요청함</b> <span className="muted">#{lr.id} · {lr.requested_name} · {fmtTime(lr.created_at)}</span>
          {lr.note && <p className="muted" style={{ margin: '4px 0 0' }}>메모: {lr.note}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            {ctx.isAdmin && <><button type="button" className="small" disabled={busy} onClick={() => decide(true)}>✅ 승인하고 켜기</button><button type="button" className="ghost small" disabled={busy} onClick={() => decide(false)}>반려</button></>}
            {d.app.is_owner && <button type="button" className="ghost small" disabled={busy} onClick={cancel}>요청 취소</button>}
          </div>
        </div>
      ) : d.app.is_owner ? (
        <form className="row" onSubmit={ask} style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label="요청 메모" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="메모 (선택) 예: 수업안 생성 함수를 직접 배포하고 싶어요" style={{ flex: '1 1 260px' }} />
          <button disabled={busy}>🙋 자동 배포 켜 달라고 요청</button>
        </form>
      ) : <p className="muted" style={{ margin: 0 }}>담당 개발자가 요청하면 여기와 '앱 신청' 화면에서 1클릭으로 승인할 수 있습니다.</p>}
      {lr && lr.status === 'rejected' && <p className="muted small">지난 요청 #{lr.id} 은 반려되었습니다{lr.decision_note ? ` (이유: ${lr.decision_note})` : ''}. 다시 요청할 수 있습니다.</p>}
      <p className="muted small" style={{ marginTop: 6 }}>꺼져 있으면 push 해도 서버 함수가 배포되지 않고, 추가 함수도 만들 수 없습니다. 켜고 끄기는 관리자만 합니다.</p>
      {msg && <p className="ok" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
    </>
  );
}

function Secrets({ ctx, d, reload }: { ctx: Ctx; d: DevInfoRes; reload: () => void }) {
  const [suffix, setSuffix] = useState(''); const [value, setValue] = useState(''); const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const name = d.secret_prefix + suffix;
  const own = d.secrets.filter((s) => !s.managed);
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!ctx.session) return;
    const exists = d.secrets.some((s) => s.name === name);
    if (exists && !confirm(`${name} 의 값을 새 값으로 바꿀까요? (예전 값은 되돌릴 수 없습니다)`)) return;
    setBusy('save'); setErr(''); setMsg('');
    try { await devtools(ctx.session, 'secret_set', { app_id: d.app.id, name, value }); setValue(''); setSuffix(''); setMsg(`${name} 저장했습니다. 값은 다시 볼 수 없습니다.`); reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); setValue(''); }
  };
  const del = async (n: string) => {
    if (!ctx.session || !confirm(`${n} 을 지울까요? 이 값을 쓰는 서버 함수가 있으면 동작하지 않습니다.`)) return;
    setBusy(n); setErr(''); setMsg('');
    try { await devtools(ctx.session, 'secret_delete', { app_id: d.app.id, name: n }); setMsg(`${n} 지웠습니다.`); reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  return (
    <>
      <h5>함수 비밀값 <span className="muted" style={{ fontWeight: 500 }}>· {own.length}/{d.limits.secret_max}개</span></h5>
      <p className="muted small" style={{ margin: '0 0 6px' }}>서버 함수에서 <code>Deno.env.get('{d.secret_prefix}이름')</code> 으로 읽습니다. 이름은 <code>{d.secret_prefix}</code> 로 시작해야 하고, 값은 저장하면 다시 볼 수 없습니다(쓰기 전용).</p>
      {d.secrets.length > 0 && <table className="compact"><thead><tr><th>이름</th><th>바뀐 때</th><th /></tr></thead><tbody>
        {d.secrets.map((s) => <tr key={s.name}><td><code>{s.name}</code>{s.managed && <span className="muted"> · 허브가 관리 (서버 함수 DB 접속)</span>}</td><td className="muted">{s.updated_at ? fmtTime(s.updated_at) : '—'}</td>
          <td style={{ textAlign: 'right' }}>{!s.managed && <button type="button" className="ghost small" disabled={!!busy} onClick={() => del(s.name)}>{busy === s.name ? '지우는 중…' : '지우기'}</button>}</td></tr>)}
      </tbody></table>}
      <form className="form secret-form" onSubmit={save} autoComplete="off" style={{ marginTop: 8 }}>
        <div className="cols">
          <label>이름<span className="prefixed"><code>{d.secret_prefix}</code><input required aria-label="비밀값 이름 끝부분" value={suffix} maxLength={100 - d.secret_prefix.length} pattern="[A-Z0-9]+(_[A-Z0-9]+)*" title="영문 대문자·숫자, 밑줄로 이음"
            onChange={(e) => setSuffix(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder="API_KEY" spellCheck={false} /></span></label>
          <label>값<input required type="password" autoComplete="new-password" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder="붙여 넣기 (화면·기록에 남지 않음)" /></label>
        </div>
        <div className="row"><button disabled={!!busy || !suffix || !value}>{busy === 'save' ? '저장 중…' : d.secrets.some((s) => s.name === name) ? '값 바꾸기' : '저장'}</button></div>
      </form>
      <p className="muted small">⚠️ 공용 프로젝트라 자동 배포가 켜진 다른 앱의 함수 코드도 이론상 이 값을 읽을 수 있습니다. 학교 전체에 중요한 키는 관리자와 먼저 상의하세요.</p>
      {msg && <p className="ok" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
    </>
  );
}

function Functions({ ctx, d, reload }: { ctx: Ctx; d: DevInfoRes; reload: () => void }) {
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const extras = d.functions.filter((f) => f.kind === 'extra');
  const del = async (fn: string) => {
    if (!ctx.session || !confirm(`${fn} 함수를 지울까요?\n\n저장소의 supabase/functions/${fn}/ 폴더도 지우세요. 남아 있으면 다음 push 때 다시 만들어집니다.`)) return;
    setBusy(fn); setErr(''); setMsg('');
    try { await devtools(ctx.session, 'fn_delete', { app_id: d.app.id, fn }); setMsg(`${fn} 지웠습니다.`); reload(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  return (
    <>
      <h5>서버 함수 <span className="muted" style={{ fontWeight: 500 }}>· 추가 함수 {extras.length}/{d.limits.extra_fn_max}개</span></h5>
      <table className="compact"><thead><tr><th>함수</th><th>종류</th><th>버전</th><th>배포</th><th /></tr></thead><tbody>
        {d.functions.map((f) => <tr key={f.slug}><td><code>{f.slug}</code></td><td>{f.kind === 'main' ? '기본' : '추가'}</td><td>v{f.version}</td><td className="muted">{epoch(f.updated_at)}</td>
          <td style={{ textAlign: 'right' }}>{f.kind === 'extra' && <button type="button" className="ghost small" disabled={!!busy} onClick={() => del(f.slug)}>{busy === f.slug ? '지우는 중…' : '지우기'}</button>}</td></tr>)}
      </tbody></table>
      <p className="muted small">새 함수: 저장소에 <code>supabase/functions/{d.app.slug}-이름/index.ts</code> 를 만들고 main 에 push 하면 {d.app.fn_auto_deploy ? '검사 후 새로 만들어집니다' : '— 자동 배포가 켜진 뒤에 만들어집니다'}. 이름은 영문 소문자·숫자(하이픈으로 이음) 20자까지, 앱마다 {d.limits.extra_fn_max}개까지.</p>
      {msg && <p className="ok" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
    </>
  );
}

function Logs({ ctx, d }: { ctx: Ctx; d: DevInfoRes }) {
  const [kind, setKind] = useState<'fn' | 'db'>('fn'); const [fn, setFn] = useState(''); const [hours, setHours] = useState(1); const [errorsOnly, setErrorsOnly] = useState(false);
  const [rows, setRows] = useState<LogRow[] | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [at, setAt] = useState('');
  const run = async () => {
    if (!ctx.session) return; setBusy(true); setErr('');
    try { const r = await devtools<{ rows: LogRow[]; note?: string }>(ctx.session, 'logs', { app_id: d.app.id, kind, fn: kind === 'fn' ? fn : undefined, hours, errors_only: errorsOnly }); setRows(r.rows); setAt(kst(new Date())); if (r.note) setErr(r.note); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <h5>로그 보기</h5>
      <div className="row logs-ctl" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select aria-label="로그 종류" value={kind} onChange={(e) => { setKind(e.target.value as 'fn' | 'db'); setRows(null); }}><option value="fn">서버 함수</option><option value="db">DB ({d.db_roles.join(', ')})</option></select>
        {kind === 'fn' && <select aria-label="함수" value={fn} onChange={(e) => setFn(e.target.value)}><option value="">모든 함수</option>{d.functions.map((f) => <option key={f.slug} value={f.slug}>{f.slug}</option>)}</select>}
        <select aria-label="기간" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{d.limits.log_hours.map((h) => <option key={h} value={h}>최근 {h}시간</option>)}</select>
        <label className="inline" style={{ margin: 0 }}><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> 오류·경고만</label>
        <button type="button" className="small" disabled={busy} onClick={run}>{busy ? '불러오는 중…' : rows ? '새로 불러오기' : '불러오기'}</button>
      </div>
      <p className="muted small" style={{ margin: '6px 0' }}>이 앱의 함수({d.functions.map((f) => f.slug).join(', ')})와 DB 계정 로그만 보입니다. 비밀값처럼 보이는 글자는 가려집니다. 최근 것부터 200줄{at && ` · ${at} 기준`}.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {rows && (rows.length === 0 ? <p className="muted">이 기간에 로그가 없습니다.</p> : (
        <div className="logs-wrap"><table className="compact logs"><thead><tr><th>시각 (KST)</th><th>{kind === 'fn' ? '함수' : '계정'}</th><th>수준</th><th>내용</th></tr></thead><tbody>
          {rows.map((r, i) => <tr key={i} className={/error|fatal|panic/i.test(r.level) || Number(r.status) >= 500 ? 'log-bad' : /warn/i.test(r.level) || Number(r.status) >= 400 ? 'log-warn' : ''}>
            <td className="muted nowrap">{logTime(r.at)}</td><td><code>{kind === 'fn' ? r.fn : r.role}</code></td>
            <td>{r.source === 'function_edge_logs' ? `요청 ${r.status}` : r.level || '—'}</td>
            <td className="logmsg">{r.source === 'function_edge_logs' ? <><b>{r.method}</b> {r.path} <span className="muted">· {r.ms}ms</span></> : r.message}</td></tr>)}
        </tbody></table></div>))}
    </>
  );
}

/** 관리자: 개발자 요청 목록 (앱 신청 화면 위) — 1클릭 승인·반려 */
export function DevRequestsPanel({ ctx }: { ctx: Ctx }) {
  type Row = DevRequest & { apps: { name: string; slug: string } | null };
  const [list, setList] = useState<Row[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(0);
  const load = useCallback(() => { sb.from('dev_requests').select('*, apps(name, slug)').order('created_at', { ascending: false }).limit(30).then(({ data, error }) => { if (error) setErr(errMsg(error)); setList((data as Row[]) ?? []); }); }, []);
  useEffect(load, [load]);
  const decide = async (r: Row, approve: boolean) => {
    const n = approve ? '' : prompt('반려 이유 (개발자에게 보입니다)', '') ?? null;
    if (n === null) return;
    if (approve && !confirm(`'${r.apps?.name ?? r.app_id}'의 서버 함수 자동 배포를 켤까요?\n\n켜면 이 저장소에 push 할 수 있는 사람은 함수 코드로 프로젝트 공용 키를 읽을 수 있습니다.`)) return;
    setBusy(r.id); const { error } = await sb.rpc('decide_dev_request', { p_request_id: r.id, p_approve: approve, p_note: n }); setBusy(0);
    if (error) return setErr(errMsg(error)); load(); ctx.refreshCounts?.();
  };
  const cancel = async (r: Row) => { setBusy(r.id); const { error } = await sb.rpc('cancel_dev_request', { p_request_id: r.id }); setBusy(0); if (error) return setErr(errMsg(error)); load(); };
  const pending = list.filter((r) => r.status === 'pending');
  if (!list.length && !err) return null;
  return (
    <div className="card dev-requests" style={{ marginBottom: 18 }}>
      <div className="section-head" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>🙋 개발자 요청 {pending.length > 0 && <span className="badge r-pending">대기 {pending.length}</span>}</h3></div>
      {err && <p className="error" role="alert">{err}</p>}
      <table className="compact" style={{ marginTop: 8 }}><thead><tr><th>앱</th><th>요청</th><th>요청한 개발자</th><th>상태</th><th /></tr></thead><tbody>
        {list.slice(0, 12).map((r) => <tr key={r.id}>
          <td><b>{r.apps?.name ?? `#${r.app_id}`}</b> <span className="muted">{r.apps?.slug}</span></td>
          <td>{DEV_REQ_KIND[r.kind]}{r.note && <div className="muted small">“{r.note}”</div>}</td>
          <td>{r.requested_name || r.requested_email}<div className="muted small">{fmtTime(r.created_at)}</div></td>
          <td><span className={`badge ${r.status === 'pending' ? 'r-pending' : r.status === 'approved' ? 'r-approved' : 'r-rejected'}`}>{DEV_REQ_STATUS[r.status]}</span>{r.decision_note && <div className="muted small">{r.decision_note}</div>}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{r.status === 'pending' && (ctx.isAdmin
            ? <><button type="button" className="small" disabled={busy === r.id} onClick={() => decide(r, true)}>✅ 승인하고 켜기</button> <button type="button" className="ghost small" disabled={busy === r.id} onClick={() => decide(r, false)}>반려</button></>
            : <button type="button" className="ghost small" disabled={busy === r.id} onClick={() => cancel(r)}>취소</button>)}</td>
        </tr>)}
      </tbody></table>
    </div>
  );
}
