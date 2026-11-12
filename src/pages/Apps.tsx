import { useEffect, useState, type FormEvent } from 'react';
import { go, type Ctx } from '../App';
import { sb, errMsg, fmtTime, STATUS_LABEL, type App, type Health, type Owner, type Status } from '../sb';
import { Modal, Pills, Stat, appIcon, appTone } from '../ui';
import { DbCredSection } from './DbCred';

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
      <div className="hero">
        <span className="eyebrow">✨ BMR APPS</span>
        <h2>별무리 개발자들이 만든 서비스</h2>
        <p className="muted">필요한 앱을 눌러 바로 여세요. 새 앱이 필요하면 가입한 뒤, 개발자로 승인되면 신청할 수 있어요.</p>
      </div>
      <div className="section-head"><h3>운영 중인 앱 {apps && <span className="cnt">{apps.length}</span>}</h3></div>
      {err && <p className="error">{err}</p>}
      {apps === null ? <p className="muted">불러오는 중…</p> : apps.length === 0 ? <div className="card empty">🌙 아직 운영 중인 앱이 없습니다.</div> : (
        <div className="tiles">{apps.map((a) => (
          <a key={a.id} className={`tile tone-${appTone(a.slug)}`} href={a.url} target="_blank" rel="noopener noreferrer">
            <span className="tile-ico">{appIcon(a.slug)}</span>
            <b className="tile-title">{a.name}</b>
            <span className="tile-desc">{a.description}</span>
            <span className="tile-foot"><span className="sdot s-active" />운영 중<span className="tile-url">{a.url.replace(/^https?:\/\//, '')} ↗</span></span>
          </a>))}
        </div>)}
    </section>
  );
}

const empty = { slug: '', name: '', description: '', url: '', repo_url: '', supabase_ref: '', status: 'active' as Status, note: '', sort: 100 };
type F = 'all' | Status;

/** 대시보드: 요약 카드 + 서비스 목록 + 담당 개발자 (관리자는 추가·수정) */
export function AppsPage({ ctx }: { ctx: Ctx }) {
  const [apps, setApps] = useState<App[]>([]); const [owners, setOwners] = useState<Owner[]>([]);
  const [health, setHealth] = useState<Record<number, Health>>({});
  const [edit, setEdit] = useState<(typeof empty & { id?: number }) | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<F>('all');
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
    setEdit(null); load(); ctx.refreshCounts?.();
  };
  const c = ctx.counts;
  const n = (s: Status) => apps.filter((a) => a.status === s).length;
  const shown = apps.filter((a) => filter === 'all' || a.status === filter);
  const cur = apps.find((a) => a.id === open);
  const watched = (c?.healthOk ?? 0) + (c?.healthBad ?? 0) + (c?.healthNone ?? 0);
  if (!ctx.isStaff) {
    const active = apps.filter((a) => a.status === 'active');
    return (
      <section>
        <div className="card warn">
          <h3>개발자 승인 후 이용할 수 있어요</h3>
          <p>일반 사용자로 가입되었습니다. 앱 신청, DB 접속 정보, 운영 상태는 관리자가 개발자로 올리면 쓸 수 있습니다. 관리자에게 요청하세요.</p>
        </div>
        <div className="section-head"><h3>운영 중인 앱 {active.length ? <span className="cnt">{active.length}</span> : null}</h3></div>
        {err && <p className="error">{err}</p>}
        {active.length === 0 ? <div className="card empty">🌙 아직 운영 중인 앱이 없습니다.</div> : (
          <div className="tiles">{active.map((a) => (
            <a key={a.id} className={`tile tone-${appTone(a.slug)}`} href={a.url} target="_blank" rel="noopener noreferrer">
              <span className="tile-ico">{appIcon(a.slug)}</span>
              <b className="tile-title">{a.name}</b>
              <span className="tile-desc">{a.description}</span>
              <span className="tile-foot"><span className="sdot s-active" />운영 중<span className="tile-url">{a.url.replace(/^https?:\/\//, '')} ↗</span></span>
            </a>))}</div>)}
      </section>
    );
  }
  return (
    <section>
      <div className="stats">
        <Stat tone="amber" icon="📝" label="승인 대기 신청" value={c ? c.reqPending : '–'} sub={ctx.isAdmin ? '검토가 필요한 새 앱 신청' : '내가 낸 신청 중 검토 대기'} onClick={() => go('/hub/requests')} />
        {ctx.isAdmin
          ? <Stat tone="red" icon="🔑" label="만료 임박 토큰" value={c?.tokSoon ?? '–'} sub="14일 안에 만료 · 이미 만료" onClick={() => go('/hub/tokens')} />
          : <Stat tone="blue" icon="🧑‍💻" label="담당 개발자" value={owners.length} sub="등록된 담당자 수" />}
        <Stat tone="green" icon="📡" label="운영 상태" value={c ? <>{c.healthOk}<small>/{watched}</small></> : '–'} sub={c ? (c.healthBad ? `⚠️ 이상 ${c.healthBad}개` : c.healthNone ? `기록 없음 ${c.healthNone}개` : '모두 정상') : ''} onClick={() => go('/hub/status')} />
        <Stat tone="violet" icon="🧩" label="서비스" value={<>{n('active')}<small>/{apps.length}</small></>} sub={`운영 중 · 준비 중 ${n('preparing')}개`} />
      </div>

      <div className="section-head">
        <h3>서비스 · 담당 개발자</h3>
        <Pills value={filter} onChange={setFilter} items={[['all', '전체', apps.length], ['active', '운영 중', n('active')], ['preparing', '준비 중', n('preparing')], ['paused', '일시 중지', n('paused')], ['retired', '종료', n('retired')]]} />
        {ctx.isAdmin && <button onClick={() => setEdit({ ...empty })}>+ 앱 추가</button>}
      </div>
      {err && <p className="error">{err}</p>}
      {shown.length === 0 ? <div className="card empty">해당하는 서비스가 없습니다.</div> : (
        <div className="tiles">{shown.map((a) => {
          const own = owners.filter((o) => o.app_id === a.id);
          return (
            <button key={a.id} className={`tile tone-${appTone(a.slug)}`} onClick={() => setOpen(a.id)}>
              <span className="tile-ico">{appIcon(a.slug)}</span>
              <b className="tile-title">{a.name}</b>
              <span className="tile-desc">{a.description || '설명이 없습니다.'}</span>
              <span className="tile-foot">
                <span className={`sdot s-${a.status}`} />{STATUS_LABEL[a.status]}
                <HealthDot h={health[a.id]} />
                <span className="tile-url">{own.length ? `🧑‍💻 ${own.map((o) => o.name).join(', ')}` : '담당자 없음'}</span>
              </span>
            </button>);
        })}</div>)}

      {cur && !edit && (
        <Modal onClose={() => setOpen(null)} wide>
          <div className="modal-head">
            <span className={`tile-ico tone-${appTone(cur.slug)}`}>{appIcon(cur.slug)}</span>
            <div><h2>{cur.name}</h2><span className={`badge s-${cur.status}`}>{STATUS_LABEL[cur.status]}</span> <HealthDot h={health[cur.id]} label /></div>
          </div>
          {cur.description && <p>{cur.description}</p>}
          <dl className="meta">
            <dt>주소</dt><dd><a href={cur.url} target="_blank" rel="noopener noreferrer">{cur.url} ↗</a></dd>
            {cur.repo_url && <><dt>저장소</dt><dd><a href={cur.repo_url} target="_blank" rel="noopener noreferrer">{cur.repo_url.replace('https://github.com/', '')}</a></dd></>}
            {cur.supabase_ref && <><dt>Supabase</dt><dd><code>{cur.supabase_ref}</code></dd></>}
            {cur.note && <><dt>메모</dt><dd>{cur.note}</dd></>}
          </dl>
          <Owners app={cur} owners={owners.filter((o) => o.app_id === cur.id)} isAdmin={ctx.isAdmin} reload={load} />
          <DbCredSection ctx={ctx} appId={cur.id} />
          {ctx.isAdmin && <div className="row end"><button className="ghost" onClick={() => setEdit({ ...cur, repo_url: cur.repo_url ?? '', supabase_ref: cur.supabase_ref ?? '' })}>✏️ 앱 정보 수정</button></div>}
        </Modal>)}

      {edit && (
        <Modal onClose={() => setEdit(null)} wide>
          <form className="form" onSubmit={save}>
            <h2>{edit.id ? '앱 수정' : '앱 추가'}</h2>
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
            {err && <p className="error">{err}</p>}
            <div className="row"><button>저장</button><button type="button" className="ghost" onClick={() => setEdit(null)}>취소</button></div>
          </form>
        </Modal>)}
    </section>
  );
}

export function HealthDot({ h, label }: { h?: Health; label?: boolean }) {
  if (!h) return <span className="hpill none" title="점검 기록 없음">● {label ? '점검 기록 없음' : '기록 없음'}</span>;
  return <span className={`hpill ${h.ok ? 'ok' : 'bad'}`} title={`${fmtTime(h.checked_at)} · ${h.http_status ?? h.error} · ${h.response_ms ?? '-'}ms`}>● {h.ok ? '정상' : '이상'}{label && h.response_ms != null ? ` · ${h.response_ms}ms` : ''}</span>;
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
      <h4>🧑‍💻 담당 개발자</h4>
      {owners.length === 0 ? <p className="muted">등록된 담당자가 없습니다.</p> : (
        <div className="owner-list">{owners.map((o) => (
          <div key={o.id} className="owner">
            <span className="avatar">{o.name.slice(0, 1)}</span>
            <span className="grow"><b>{o.name}</b> <span className="badge">{o.role}</span><small className="muted block">{o.email}{o.github_username && <> · <a href={`https://github.com/${o.github_username}`} target="_blank" rel="noopener noreferrer">@{o.github_username}</a></>}</small></span>
            {isAdmin && <button className="ghost small" onClick={() => del(o)}>빼기</button>}
          </div>))}
        </div>)}
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
