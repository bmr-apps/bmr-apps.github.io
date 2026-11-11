import { useEffect, useState, type FormEvent } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtTime, STATUS_LABEL, type App, type Health, type Owner, type Status } from '../sb';

/** 첫 화면: 누구나 보는 운영 중 앱 바로가기 */
export function Landing({ ctx }: { ctx: Ctx }) {
  const [apps, setApps] = useState<Pick<App, 'id' | 'slug' | 'name' | 'description' | 'url'>[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    sb.from('apps').select('id, slug, name, description, url').eq('status', 'active').order('sort').order('name')
      .then(({ data, error }) => { if (error) setErr(errMsg(error)); setApps(data ?? []); });
  }, [ctx.session]);
  return (
    <section>
      <div className="hero"><h1>별무리 앱</h1><p className="muted">별무리학교 선생님들이 만들어 운영하는 서비스 모음입니다.</p></div>
      {err && <p className="error">{err}</p>}
      {apps === null ? <p className="muted">불러오는 중…</p> : apps.length === 0 ? <p className="muted">아직 운영 중인 앱이 없습니다.</p> : (
        <div className="grid">{apps.map((a) => (
          <a key={a.id} className="card app" href={a.url} target="_blank" rel="noopener noreferrer">
            <h3>{a.name}</h3><p>{a.description}</p><span className="url">{a.url.replace(/^https?:\/\//, '')} ↗</span>
          </a>))}
        </div>)}
    </section>
  );
}

const empty = { slug: '', name: '', description: '', url: '', repo_url: '', supabase_ref: '', status: 'active' as Status, note: '', sort: 100 };

/** 서비스 목록 + 담당 교사 (관리자는 추가·수정) */
export function AppsPage({ ctx }: { ctx: Ctx }) {
  const [apps, setApps] = useState<App[]>([]); const [owners, setOwners] = useState<Owner[]>([]);
  const [health, setHealth] = useState<Record<number, Health>>({});
  const [edit, setEdit] = useState<(typeof empty & { id?: number }) | null>(null);
  const [err, setErr] = useState('');
  const load = async () => {
    const [a, o, h] = await Promise.all([
      sb.from('apps').select('*').order('sort').order('name'), sb.from('app_owners').select('*').order('id'), sb.from('app_health_latest').select('*'),
    ]);
    setErr(a.error ? errMsg(a.error) : ''); setApps((a.data as App[]) ?? []); setOwners((o.data as Owner[]) ?? []);
    setHealth(Object.fromEntries(((h.data as Health[]) ?? []).map((x) => [x.app_id, x])));
  };
  useEffect(() => { load(); }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!edit) return;
    const row = { ...edit, url: edit.url || `https://apps.bmrschool.net/${edit.slug}`, repo_url: edit.repo_url || null, supabase_ref: edit.supabase_ref || null };
    const { id, ...body } = row;
    const { error } = id ? await sb.from('apps').update(body).eq('id', id) : await sb.from('apps').insert(body);
    if (error) return setErr(errMsg(error));
    setEdit(null); load();
  };
  return (
    <section>
      <div className="head"><h2>서비스 목록 · 담당 교사</h2>{ctx.isAdmin && <button onClick={() => setEdit({ ...empty })}>+ 앱 추가</button>}</div>
      {err && <p className="error">{err}</p>}
      {edit && (
        <form className="card form" onSubmit={save}>
          <h3>{edit.id ? '앱 수정' : '앱 추가'}</h3>
          <div className="cols">
            <label>앱 이름<input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>주소 이름(slug)<input required pattern="[a-z0-9][a-z0-9-]{1,38}" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase() })} placeholder="예: library" /></label>
            <label>앱 주소 (비우면 apps.bmrschool.net/slug)<input value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder={`https://apps.bmrschool.net/${edit.slug || 'slug'}`} /></label>
            <label>저장소 주소<input value={edit.repo_url} onChange={(e) => setEdit({ ...edit, repo_url: e.target.value })} placeholder="https://github.com/bmr-apps/..." /></label>
            <label>Supabase 프로젝트 ref<input value={edit.supabase_ref} onChange={(e) => setEdit({ ...edit, supabase_ref: e.target.value })} /></label>
            <label>상태<select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Status })}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>정렬 순서<input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} /></label>
          </div>
          <label>설명<textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
          <label>메모<textarea value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
          <div className="row"><button>저장</button><button type="button" className="ghost" onClick={() => setEdit(null)}>취소</button></div>
        </form>
      )}
      {apps.map((a) => (
        <div key={a.id} className="card">
          <div className="head">
            <h3>{a.name} <span className={`badge s-${a.status}`}>{STATUS_LABEL[a.status]}</span> <HealthDot h={health[a.id]} /></h3>
            {ctx.isAdmin && <button className="ghost" onClick={() => setEdit({ ...a, repo_url: a.repo_url ?? '', supabase_ref: a.supabase_ref ?? '' })}>수정</button>}
          </div>
          <p>{a.description}</p>
          <dl className="meta">
            <dt>주소</dt><dd><a href={a.url} target="_blank" rel="noopener noreferrer">{a.url}</a></dd>
            {a.repo_url && <><dt>저장소</dt><dd><a href={a.repo_url} target="_blank" rel="noopener noreferrer">{a.repo_url.replace('https://github.com/', '')}</a></dd></>}
            {a.supabase_ref && <><dt>Supabase</dt><dd><code>{a.supabase_ref}</code></dd></>}
            {a.note && <><dt>메모</dt><dd>{a.note}</dd></>}
          </dl>
          <Owners app={a} owners={owners.filter((o) => o.app_id === a.id)} isAdmin={ctx.isAdmin} reload={load} />
        </div>
      ))}
    </section>
  );
}

export function HealthDot({ h }: { h?: Health }) {
  if (!h) return <span className="dot none" title="점검 기록 없음">●</span>;
  return <span className={`dot ${h.ok ? 'ok' : 'bad'}`} title={`${fmtTime(h.checked_at)} · ${h.http_status ?? h.error} · ${h.response_ms ?? '-'}ms`}>●</span>;
}

function Owners({ app, owners, isAdmin, reload }: { app: App; owners: Owner[]; isAdmin: boolean; reload: () => void }) {
  const [f, setF] = useState<{ name: string; email: string; github_username: string; role: string } | null>(null);
  const [err, setErr] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault(); if (!f) return;
    const { error } = await sb.from('app_owners').insert({ app_id: app.id, name: f.name, email: f.email || null, github_username: f.github_username || null, role: f.role || '담당' });
    if (error) return setErr(errMsg(error));
    setF(null); setErr(''); reload();
  };
  const del = async (o: Owner) => {
    if (!confirm(`${o.name} 님을 담당에서 뺄까요?`)) return;
    const { error } = await sb.from('app_owners').delete().eq('id', o.id); if (error) setErr(errMsg(error)); else reload();
  };
  return (
    <div className="owners">
      <h4>담당 교사</h4>
      {owners.length === 0 ? <p className="muted">등록된 담당자가 없습니다.</p> : (
        <table><thead><tr><th>이름</th><th>역할</th><th>이메일</th><th>GitHub</th>{isAdmin && <th />}</tr></thead>
          <tbody>{owners.map((o) => (
            <tr key={o.id}><td>{o.name}</td><td>{o.role}</td><td>{o.email}</td>
              <td>{o.github_username && <a href={`https://github.com/${o.github_username}`} target="_blank" rel="noopener noreferrer">@{o.github_username}</a>}</td>
              {isAdmin && <td><button className="ghost small" onClick={() => del(o)}>빼기</button></td>}</tr>))}
          </tbody></table>)}
      {err && <p className="error">{err}</p>}
      {isAdmin && (f ? (
        <form className="row wrap" onSubmit={add}>
          <input required placeholder="이름" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input placeholder="역할(예: 책임, 개발)" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} />
          <input type="email" placeholder="이메일" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input placeholder="GitHub 아이디" value={f.github_username} onChange={(e) => setF({ ...f, github_username: e.target.value })} />
          <button>추가</button><button type="button" className="ghost" onClick={() => setF(null)}>취소</button>
        </form>) : <button className="ghost small" onClick={() => setF({ name: '', email: '', github_username: '', role: '담당' })}>+ 담당자 추가</button>)}
    </div>
  );
}
