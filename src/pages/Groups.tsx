import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Ctx } from '../App';
import { directoryApi, fmtTime, type DirGroup, type DirGroupList, type DirMember, type DirMembers } from '../sb';
import { Modal } from '../ui';

type Edit = { id?: number; slug: string; name: string; kind: string; description: string };
const EMPTY: Edit = { slug: '', name: '', kind: 'grade', description: '' };

/** 관리자 전용: 학교 그룹(교직원·학년·동아리…)과 명부 관리 — 앱은 hub-directory 로 이 명부를 읽는다 */
export function GroupsPage({ ctx }: { ctx: Ctx }) {
  const [groups, setGroups] = useState<DirGroup[]>([]);
  const [kinds, setKinds] = useState<{ kind: string; label: string }[]>([]);
  const [folder, setFolder] = useState('bmr-files');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [detail, setDetail] = useState<DirGroup | null>(null);
  const [members, setMembers] = useState<DirMember[]>([]);
  const [add, setAdd] = useState('');
  const [addRole, setAddRole] = useState<'member' | 'leader'>('member');

  const load = useCallback(async () => {
    if (!ctx.session) return;
    try {
      const r = await directoryApi<DirGroupList>(ctx.session, 'list_groups');
      setGroups(r.groups); setKinds(r.kinds); setFolder(r.file_bucket);
    } catch (e) { setErr((e as Error).message); }
  }, [ctx.session]);
  useEffect(() => { load(); }, [load]);

  const loadMembers = useCallback(async (g: DirGroup) => {
    if (!ctx.session) return;
    try {
      const r = await directoryApi<DirMembers>(ctx.session, 'members', { group: g.slug });
      setMembers(r.members);
      setDetail(r.group);
    } catch (e) { setErr((e as Error).message); }
  }, [ctx.session]);

  if (!ctx.isAdmin) return <div className="card">관리자만 볼 수 있습니다.</div>;

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); setMsg(okText); await load(); if (detail) await loadMembers(detail); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    await run(
      () => directoryApi(ctx.session!, 'group_save', { id: edit.id, slug: edit.slug.trim().toLowerCase(), name: edit.name.trim(), kind: edit.kind, description: edit.description.trim() }),
      edit.id ? '그룹을 고쳤습니다.' : '그룹을 만들었습니다.',
    );
    setEdit(null);
  };

  const removeGroup = async (g: DirGroup) => {
    if (!confirm(`'${g.name}' 그룹을 지울까요? 구성원 ${g.members}명의 소속도 함께 지워집니다. (공용 파일은 지우지 않습니다)`)) return;
    // 지운 그룹의 명부를 다시 불러오지 않도록 run() 대신 직접 (지운 뒤 404 안내가 뜨지 않게)
    setBusy(true); setErr(''); setMsg('');
    try {
      await directoryApi(ctx.session!, 'group_delete', { id: g.id });
      setMsg('그룹을 지웠습니다.');
      setDetail(null); setMembers([]);
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const addMembers = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    const emails = add.replace(/\n/g, ',').split(/[,\s;]+/).filter(Boolean);
    if (!emails.length) { setErr('추가할 메일을 적어 주세요.'); return; }
    await run(() => directoryApi(ctx.session!, 'member_add', { group_id: detail.id, emails, role: addRole }), `${emails.length}명을 추가했습니다.`);
    setAdd('');
  };

  const removeMember = async (email: string) => {
    if (!detail) return;
    await run(() => directoryApi(ctx.session!, 'member_remove', { group_id: detail.id, emails: [email] }), '명부에서 뺐습니다.');
  };

  return (
    <section aria-busy={busy}>
      <div className="section-head">
        <h2>👥 그룹·명부</h2>
        <button onClick={() => { setErr(''); setMsg(''); setEdit({ ...EMPTY }); }}>➕ 새 그룹</button>
      </div>
      <p className="muted">
        교직원·학년·동아리 같은 소속을 허브에서 한 번만 정해 두면, 앱은 <code>hub-directory</code> 로 <b>“이 사람이 10학년인가”</b>만 물어보면 됩니다.
        그룹 폴더(<code>{folder}/&lt;주소 이름&gt;/</code>)는 <b>그 그룹 구성원만</b> 보고 올릴 수 있는 공용 파일 자리입니다 (그룹장은 다른 사람 파일도 지울 수 있음).
      </p>
      {err && <p className="error" role="alert">{err}</p>}{msg && <p className="ok" role="status">{msg}</p>}

      {groups.length === 0 ? <div className="card empty">아직 그룹이 없습니다. <b>➕ 새 그룹</b>으로 교직원·학년부터 만들어 보세요.</div> : (
        <div className="card flush" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>그룹</th><th>종류</th><th>구성원</th><th>공용 파일 폴더</th><th>설명</th><th>할 일</th></tr></thead>
            <tbody>{groups.map((g) => (
              <tr key={g.id}>
                <td><b>{g.name}</b></td>
                <td><span className="badge role-staff">{g.kind_label}</span></td>
                <td>{g.members}명</td>
                <td><code>{g.file_folder}</code></td>
                <td className="muted">{g.description || '—'}</td>
                <td className="actions">
                  <button className="ghost small" onClick={() => { setErr(''); setMsg(''); setDetail(g); setMembers([]); loadMembers(g); }}>명부</button>
                  <button className="ghost small" onClick={() => { setErr(''); setMsg(''); setEdit({ id: g.id, slug: g.slug, name: g.name, kind: g.kind, description: g.description }); }}>고치기</button>
                  <button className="ghost small" onClick={() => removeGroup(g)} disabled={busy}>지우기</button>
                </td>
              </tr>))}</tbody>
          </table>
        </div>)}

      <p className="muted" style={{ marginTop: 12 }}>
        앱에서 쓰기: <code>{`{ action: 'check', user_email, groups: ['10학년', '정보동아리'] }`}</code> → <code>{`{ member_of, leader_of, asked }`}</code>.
        시작 틀의 <code>lib/hub.ts</code> 에 <code>checkHubGroups()</code> 가 들어 있습니다.
      </p>

      {edit && (
        <Modal onClose={() => setEdit(null)} label={edit.id ? '그룹 고치기' : '새 그룹'}>
          <h2>{edit.id ? '그룹 고치기' : '새 그룹'}</h2>
          <form onSubmit={save}>
            <label>이름 (한글 가능)<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required maxLength={60} placeholder="10학년" /></label>
            <label>주소 이름 (폴더 이름 · 영문 소문자·숫자·하이픈)
              <input value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} required pattern="[a-z0-9][a-z0-9-]{1,38}" placeholder="grade-10" />
            </label>
            <label>종류
              <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                {(kinds.length ? kinds : [{ kind: 'grade', label: '학년' }, { kind: 'class', label: '반' }, { kind: 'club', label: '동아리' }, { kind: 'staff', label: '교직원' }, { kind: 'custom', label: '기타' }])
                  .map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </label>
            <label>설명 (선택)<input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={300} placeholder="고등부 10학년 (담임·학생)" /></label>
            <div className="actions" style={{ marginTop: 12 }}>
              <button disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
              <button type="button" className="ghost" onClick={() => setEdit(null)}>취소</button>
            </div>
          </form>
        </Modal>
      )}

      {detail && (
        <Modal onClose={() => setDetail(null)} label={`${detail.name} 명부`} wide>
          <h2>{detail.name} <small className="muted">{detail.members}명 · {detail.kind_label} · <code>{detail.file_folder}</code></small></h2>
          <form onSubmit={addMembers}>
            <label>메일 추가 (쉼표·줄바꿈·공백으로 여러 명)
              <textarea value={add} onChange={(e) => setAdd(e.target.value)} rows={3} placeholder="student1@bmrschool.org, student2@bmrschool.org" />
            </label>
            <div className="actions">
              <select value={addRole} onChange={(e) => setAddRole(e.target.value as 'member' | 'leader')} aria-label="추가할 역할">
                <option value="member">구성원</option>
                <option value="leader">그룹장 (공용 파일 관리)</option>
              </select>
              <button disabled={busy}>{busy ? '추가 중…' : '➕ 추가'}</button>
            </div>
          </form>
          <h3 style={{ marginTop: 16 }}>명부</h3>
          {members.length === 0 ? <div className="card empty">아직 구성원이 없습니다.</div> : (
            <div className="card flush" style={{ overflowX: 'auto', maxHeight: '42vh' }}>
              <table>
                <thead><tr><th>메일</th><th>역할</th><th>추가한 때</th><th /></tr></thead>
                <tbody>{members.map((m) => (
                  <tr key={m.email}>
                    <td>{m.email}</td>
                    <td>{m.role === 'leader' ? <span className="badge role-admin">그룹장</span> : <span className="badge role-staff">구성원</span>}</td>
                    <td className="muted">{fmtTime(m.added_at)}</td>
                    <td><button className="ghost small" onClick={() => removeMember(m.email)} disabled={busy}>빼기</button></td>
                  </tr>))}</tbody>
              </table>
            </div>)}
        </Modal>
      )}
    </section>
  );
}
