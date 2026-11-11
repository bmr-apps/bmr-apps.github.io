import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtTime, ROLE_LABEL, type Profile, type Role } from '../sb';

/** 역할 관리: 일반 사용자를 직원·관리자로 올리거나 사용 중지 */
export function MembersPage({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<Profile[]>([]); const [err, setErr] = useState('');
  const load = () => sb.from('profiles').select('*').order('created_at', { ascending: false }).then(({ data, error }) => { if (error) setErr(errMsg(error)); setRows((data as Profile[]) ?? []); });
  useEffect(() => { if (ctx.isAdmin) load(); }, [ctx.isAdmin]);
  if (!ctx.isAdmin) return <div className="card">관리자만 볼 수 있습니다.</div>;
  const setRole = async (p: Profile, role: Role) => {
    const { error } = await sb.from('profiles').update({ role }).eq('id', p.id); if (error) setErr(errMsg(error)); else { load(); ctx.refreshCounts?.(); }
  };
  const regular = rows.filter((r) => r.role === 'pending').length;
  return (
    <section>
      <div className="section-head"><h2>👥 역할 관리</h2></div>
      {regular > 0 && <p className="warn">일반 사용자 {regular}명이 있습니다. 직원으로 올리면 앱 신청과 DB 접속 정보를 쓸 수 있습니다.</p>}
      {err && <p className="error">{err}</p>}
      <div className="card flush"><table>
        <thead><tr><th>이름</th><th>이메일</th><th>가입</th><th>역할</th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id} className={p.role === 'pending' ? 'soon' : ''}>
            <td><span className="avatar sm">{(p.name || p.email).slice(0, 1)}</span> {p.name}</td><td>{p.email}</td><td>{fmtTime(p.created_at)}</td>
            <td>{p.id === ctx.session?.user.id ? `${ROLE_LABEL[p.role]} (나)` : (
              <div className="row wrap">
                {p.role === 'pending' && <button type="button" className="small" onClick={() => setRole(p, 'staff')}>직원으로 올리기</button>}
                <select value={p.role} onChange={(e) => setRole(p, e.target.value as Role)}>
                  {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>)}</td>
          </tr>))}</tbody>
      </table></div>
    </section>
  );
}
