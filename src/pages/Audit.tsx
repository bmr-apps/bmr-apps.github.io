import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtTime, deprovisionApi, type AuditLog, type AppDeletion } from '../sb';
import { BackupFiles, DelSteps } from './DeleteApp';
import { Pills } from '../ui';

const RESULT: Record<AuditLog['result'], string> = { ok: '성공', error: '실패', denied: '거부' };
const ACTION: Record<string, string> = {
  approve: '신청 승인', run: '이어서 만들기', add_owner: '담당자 추가', update_owner: '담당자 수정', remove_owner: '담당자 빼기', sync_owner: 'GitHub 권한 확인',
  'provision:done': '앱 만들기 완료', remove_app: '앱 목록에서 삭제', unreserve_slug: '주소 예약 해제',
  'fn:deploy': '서버 함수 자동 배포', 'fn:auto_deploy': '자동 배포 켜기·끄기', 'dbcred:reveal': 'DB 비밀번호 처음 받기', 'dbcred:rotate': 'DB 비밀번호 새로 발급',
  'user:role': '사용자 역할 변경', 'user:disable': '사용자 사용 중지', 'user:enable': '사용자 다시 사용', 'user:reset_password': '사용자 비밀번호 초기화', 'user:delete': '사용자 계정 삭제',
};
const DEL: Record<string, string> = { 'delete:start': '앱 삭제 시작', 'delete:done': '앱 삭제 완료', 'delete:preview': '삭제 미리 보기', 'delete:run': '이어서 삭제' };
const label = (a: string) => ACTION[a] ?? DEL[a] ?? (a.startsWith('provision:') ? `만들기 · ${a.slice(10)}` : a.startsWith('delete:') ? `삭제 · ${a.slice(7)}` : a);
const DSTATUS = { running: '진행 중', done: '삭제 완료', failed: '멈춤' } as const;

/** 삭제된 앱과 백업(관리자만 내려받기). 멈춘 삭제는 여기서 이어서 할 수 있음 */
function Deletions({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<AppDeletion[]>([]); const [busy, setBusy] = useState<number | null>(null); const [err, setErr] = useState('');
  const load = () => sb.from('app_deletions').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => setRows((data as AppDeletion[]) ?? []));
  useEffect(() => { load(); }, []);
  const resume = async (d: AppDeletion) => {
    if (!ctx.session) return; setErr(''); setBusy(d.id);
    try { for (let i = 0; i < 15; i++) { const r = await deprovisionApi<{ more: boolean; deletion: AppDeletion }>(ctx.session, 'run', { deletion_id: d.id }); setRows((x) => x.map((y) => (y.id === d.id ? r.deletion : y))); if (!r.more) break; } }
    catch (e) { setErr((e as Error).message); }
    setBusy(null); load();
  };
  if (!rows.length) return null;
  return (<>
    <h3>🗑️ 삭제된 앱 · 백업</h3>
    <p className="muted">앱을 지우기 전에 받아 둔 백업입니다 (비공개 버킷 hub-backups, 관리자만 내려받기 · 링크는 10분 동안 유효).</p>
    {err && <p className="error">{err}</p>}
    {rows.map((d) => (
      <div className="card" key={d.id} style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><b>{d.app_name}</b> <code>/{d.slug}</code> <span className={`badge ${d.status === 'done' ? 'r-approved' : d.status === 'failed' ? 'r-rejected' : 'r-pending'}`}>{DSTATUS[d.status]}</span></div>
          <span className="muted">{fmtTime(d.created_at)} · {d.created_by_email}{d.note ? ` · ${d.note}` : ''}</span>
        </div>
        {d.status !== 'done' && <DelSteps d={d} running={busy === d.id} />}
        {d.error && <p className="error">{d.error}</p>}
        {d.status !== 'done' && <button disabled={busy !== null} onClick={() => resume(d)}>{busy === d.id ? '진행 중…' : '🔁 이어서 하기'}</button>}
        <BackupFiles d={d} />
      </div>))}
  </>);
}

/** 관리자 전용: 서버 함수(hub-provision)가 한 모든 권한 작업 기록 */
export function AuditPage({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<AuditLog[]>([]); const [err, setErr] = useState('');
  const [f, setF] = useState<'all' | AuditLog['result']>('all');
  useEffect(() => {
    if (!ctx.isAdmin) return;
    sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) setErr(errMsg(error)); setRows((data as AuditLog[]) ?? []); });
  }, [ctx.isAdmin]);
  if (!ctx.isAdmin) return <div className="card">관리자만 볼 수 있습니다.</div>;
  const n = (r: AuditLog['result']) => rows.filter((x) => x.result === r).length;
  const shown = rows.filter((x) => f === 'all' || x.result === f);
  return (
    <section>
      <div className="section-head"><h2>🧾 감사 기록</h2>
        <Pills value={f} onChange={setF} items={[['all', '전체', rows.length], ['ok', '성공', n('ok')], ['error', '실패', n('error')], ['denied', '거부', n('denied')]]} /></div>
      <p className="muted">승인·앱 만들기·앱 삭제·담당자 GitHub 권한 변경 등 서버가 대신한 작업과, 권한 없이 시도한 요청을 모두 남깁니다 (최근 300개).</p>
      {err && <p className="error">{err}</p>}
      <Deletions ctx={ctx} />
      <h3>기록</h3>
      {shown.length === 0 ? <div className="card empty">기록이 없습니다.</div> : (
        <div className="card flush" style={{ overflowX: "auto" }}><table>
          <thead><tr><th>때</th><th>누가</th><th>무엇</th><th>대상</th><th>결과</th><th>내용</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtTime(r.at)}</td><td>{r.actor_email || '—'}</td><td>{label(r.action)}</td><td><code>{r.target}</code></td>
              <td><span className={`badge ${r.result === 'ok' ? 'r-approved' : r.result === 'denied' ? 'r-rejected' : 'r-pending'}`}>{RESULT[r.result]}</span></td>
              <td className="pre" style={{ fontSize: 13 }}>{r.detail}</td>
            </tr>))}</tbody>
        </table></div>)}
    </section>
  );
}
