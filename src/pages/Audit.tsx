import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtTime, type AuditLog } from '../sb';
import { Pills } from '../ui';

const RESULT: Record<AuditLog['result'], string> = { ok: '성공', error: '실패', denied: '거부' };
const ACTION: Record<string, string> = {
  approve: '신청 승인', run: '이어서 만들기', add_owner: '담당자 추가', update_owner: '담당자 수정', remove_owner: '담당자 빼기', sync_owner: 'GitHub 권한 확인',
  'provision:done': '앱 만들기 완료',
};
const label = (a: string) => ACTION[a] ?? (a.startsWith('provision:') ? `만들기 · ${a.slice(10)}` : a);

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
      <p className="muted">승인·앱 만들기·담당자 GitHub 권한 변경 등 서버가 대신한 작업과, 권한 없이 시도한 요청을 모두 남깁니다 (최근 300개).</p>
      {err && <p className="error">{err}</p>}
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
