import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtTime, ROLE_LABEL, type Profile, type Role } from '../sb';

/** 역할 관리: 가입자(승인 대기)를 직원·관리자로 올리거나 사용 중지 */
export function MembersPage({ ctx }: { ctx: Ctx }) {
  const [rows, setRows] = useState<Profile[]>([]); const [err, setErr] = useState('');
  const load = () => sb.from('profiles').select('*').order('created_at', { ascending: false }).then(({ data, error }) => { if (error) setErr(errMsg(error)); setRows((data as Profile[]) ?? []); });
  useEffect(() => { if (ctx.isAdmin) load(); }, [ctx.isAdmin]);
  if (!ctx.isAdmin) return <div className="card">관리자만 볼 수 있습니다.</div>;
  const setRole = async (p: Profile, role: Role) => {
    const { error } = await sb.from('profiles').update({ role }).eq('id', p.id); if (error) setErr(errMsg(error)); else load();
  };
  const pending = rows.filter((r) => r.role === 'pending').length;
  return (
    <section>
      <h2>역할 관리</h2>
      {pending > 0 && <p className="warn">승인을 기다리는 가입자가 {pending}명 있습니다.</p>}
      {err && <p className="error">{err}</p>}
      <table className="card">
        <thead><tr><th>이름</th><th>이메일</th><th>가입</th><th>역할</th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id} className={p.role === 'pending' ? 'soon' : ''}>
            <td>{p.name}</td><td>{p.email}</td><td>{fmtTime(p.created_at)}</td>
            <td>{p.id === ctx.session?.user.id ? `${ROLE_LABEL[p.role]} (나)` : (
              <select value={p.role} onChange={(e) => setRole(p, e.target.value as Role)}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>)}</td>
          </tr>))}</tbody>
      </table>
    </section>
  );
}
