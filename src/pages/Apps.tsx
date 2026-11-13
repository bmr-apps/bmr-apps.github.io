import { useEffect, useState, type FormEvent } from 'react';
import { go, Link, type Ctx } from '../App';
import { sb, errMsg, fmtTime, provisionApi, GH_LABEL, STATUS_LABEL, type App, type GhStatus, type Health, type Owner, type Status } from '../sb';
import { Modal, Pills, Stat, appIcon, appTone } from '../ui';
import { DeleteAppModal } from './DeleteApp';
import { DbCredSection } from './DbCred';
import { ChecksSection } from './Checks';
import { DevInfoSection } from './DevInfo';

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
        <div className="hero-copy">
          <Link to="/" className="eyebrow brand-title">BMR APPS</Link>
          <h2>별무리 개발자들이 만든 서비스</h2>
          <p className="muted">필요한 앱을 눌러 바로 여세요. 새 앱이 필요하면 가입한 뒤, 개발자로 승인되면 신청할 수 있어요.</p>
          <div className="hero-cta">
            <a className="btn" href="#apps">서비스 둘러보기</a>
            <Link to="/guide" className="btn">개발 시작 가이드</Link>
            {ctx.session ? <Link to="/hub/apps" className="btn alt">관리 허브</Link> : <Link to="/hub/login" className="btn alt">로그인 · 가입</Link>}
          </div>
        </div>
        {/* 색과 도형만으로 그린 격자 (이모지·글자 없음, CSS 만) */}
        <div className="hero-art" aria-hidden="true">
          <i className="b-paper s-coral q2" /><i className="b-yellow s-green q-bl" /><i className="b-purple n" /><i className="b-cyan s-paper arch" /><i className="b-green s-yellow stairs" /><i className="b-yellow s-cyan squares" /><i className="b-coral s-yellow q-tr" /><i className="b-paper s-purple dots" /><i className="b-navy s-yellow zigzag" /><i className="b-cyan n" /><i className="b-paper s-green ring" /><i className="b-yellow s-coral q-br" />
        </div>
      </div>
      <div className="band" id="apps">
      <div className="section-head"><h2>운영 중인 앱 {apps && <span className="cnt">{apps.length}</span>}</h2></div>
      {err && <p className="error">{err}</p>}
      {apps === null ? <p className="muted">불러오는 중…</p> : apps.length === 0 ? <div className="card empty">🌙 아직 운영 중인 앱이 없습니다.</div> : (
        <div className="tiles">{apps.map((a) => (
          <a key={a.id} className={`tile tone-${appTone(a.slug)}`} href={a.url} target="_blank" rel="noopener noreferrer">
            <span className="tile-ico">{appIcon(a.slug)}</span>
            <b className="tile-title">{a.name}</b>
            <span className="tile-desc">{a.description}</span>
            <span className="tile-foot"><span className="sdot s-active" />운영 중<span className="tile-url">{a.url.replace(/^https?:\/\//, '')}</span></span>
            <span className="tile-cta" aria-hidden="true">열기 ↗</span>
          </a>))}
        </div>)}
      </div>
    </section>
  );
}

const empty = { slug: '', name: '', description: '', url: '', repo_url: '', supabase_ref: '', status: 'active' as Status, note: '', sort: 100 };
type F = 'all' | 'mine' | Status;

/** 대시보드: 요약 카드 + 서비스 목록 + 담당 개발자 (관리자는 추가·수정) */
export function AppsPage({ ctx }: { ctx: Ctx }) {
  const [apps, setApps] = useState<App[]>([]); const [owners, setOwners] = useState<Owner[]>([]);
  const [health, setHealth] = useState<Record<number, Health>>({});
  const [edit, setEdit] = useState<(typeof empty & { id?: number }) | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [del, setDel] = useState<App | null>(null);
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
    const { id, slug, ...rest } = row;
    const { error } = id ? await sb.from('apps').update(rest).eq('id', id) : await sb.from('apps').insert({ slug, ...rest });
    if (error) return setErr(errMsg(error));
    setEdit(null); load(); ctx.refreshCounts?.();
  };
  const c = ctx.counts;
  const n = (s: Status) => apps.filter((a) => a.status === s).length;
  // 내 서비스: 담당자 메일이 지금 로그인한 메일과 같은 앱
  const myEmail = (ctx.session?.user.email ?? '').toLowerCase();
  const mineIds = new Set(owners.filter((o) => myEmail && (o.email ?? '').toLowerCase() === myEmail).map((o) => o.app_id));
  const shown = apps.filter((a) => filter === 'all' || (filter === 'mine' ? mineIds.has(a.id) : a.status === filter));
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
        <div className="section-head"><h2>운영 중인 앱 {active.length ? <span className="cnt">{active.length}</span> : null}</h2></div>
        {err && <p className="error">{err}</p>}
        {active.length === 0 ? <div className="card empty">🌙 아직 운영 중인 앱이 없습니다.</div> : (
          <div className="tiles">{active.map((a) => (
            <a key={a.id} className={`tile tone-${appTone(a.slug)}`} href={a.url} target="_blank" rel="noopener noreferrer">
              <span className="tile-ico">{appIcon(a.slug)}</span>
              <b className="tile-title">{a.name}</b>
              <span className="tile-desc">{a.description}</span>
              <span className="tile-foot"><span className="sdot s-active" />운영 중<span className="tile-url">{a.url.replace(/^https?:\/\//, '')}</span></span>
              <span className="tile-cta" aria-hidden="true">열기 ↗</span>
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
        <h2>서비스 · 담당 개발자</h2>
        <Pills value={filter} onChange={setFilter} items={[['all', '전체', apps.length], ...(ctx.isStaff ? [['mine', '내 서비스', apps.filter((a) => mineIds.has(a.id)).length] as [F, string, number]] : []), ['active', '운영 중', n('active')], ['preparing', '준비 중', n('preparing')], ['paused', '일시 중지', n('paused')], ['retired', '종료', n('retired')]]} />
        {ctx.isAdmin && <button onClick={() => setEdit({ ...empty })}>+ 앱 추가</button>}
      </div>
      {err && <p className="error">{err}</p>}
      {shown.length === 0 ? <div className="card empty">{filter === 'mine' ? <>담당으로 등록된 서비스가 없습니다. 담당자 메일이 지금 로그인한 메일(<b>{myEmail}</b>)과 같아야 해요. <Link to="/guide">시작 가이드</Link>에서 앱 신청 방법을 볼 수 있어요.</> : '해당하는 서비스가 없습니다.'}</div> : (
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
                {mineIds.has(a.id) && <span className="badge s-preparing">내 서비스</span>}
                <span className="tile-url">{own.length ? `🧑‍💻 ${own.map((o) => o.name).join(', ')}` : '담당자 없음'}</span>
              </span>
              <span className="tile-cta" aria-hidden="true">자세히 →</span>
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
          <Owners app={cur} owners={owners.filter((o) => o.app_id === cur.id)} ctx={ctx} reload={load} />
          <DevInfoSection ctx={ctx} appId={cur.id} />
          <DbCredSection ctx={ctx} appId={cur.id} />
          <ChecksSection ctx={ctx} appId={cur.id} appUrl={cur.url} />
          {ctx.isAdmin && <div className="row end">
            <button className="ghost" onClick={() => setEdit({ ...cur, repo_url: cur.repo_url ?? '', supabase_ref: cur.supabase_ref ?? '' })}>✏️ 앱 정보 수정</button>
            <button className="danger" onClick={() => { setDel(cur); setOpen(null); }}>🗑️ 앱 삭제</button>
          </div>}
        </Modal>)}

      {del && ctx.isAdmin && (
        <DeleteAppModal app={del} ctx={ctx} onClose={() => { setOpen(del.id); setDel(null); }} onDone={() => { setDel(null); load(); }}
          onSoftDelete={async () => {
            if (!confirm(`'${del.name}'을(를) 지우지 않고 상태만 '종료'로 바꿀까요? 저장소·DB·파일은 그대로 남습니다.`)) return;
            const { error } = await sb.from('apps').update({ status: 'retired' }).eq('id', del.id);
            if (error) { alert(errMsg(error)); return; }
            setDel(null); load();
          }} />)}

      {edit && (
        <Modal onClose={() => setEdit(null)} wide>
          <form className="form" onSubmit={save}>
            <h2>{edit.id ? '앱 수정' : '앱 추가'}</h2>
            <div className="cols">
              <label>앱 이름<input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label>주소 이름(slug){edit.id
                ? <><input readOnly value={edit.slug} /><small className="muted">만든 뒤에는 바꿀 수 없어요 (주소·저장소·DB 이름이 함께 묶여 있음)</small></>
                : <input required pattern="[a-z][a-z0-9\-]{1,38}" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase() })} placeholder="예: library" />}</label>
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

type OwnerForm = { id?: number; name: string; email: string; github_username: string; role: string };
function Owners({ app, owners, ctx, reload }: { app: App; owners: Owner[]; ctx: Ctx; reload: () => void }) {
  const isAdmin = ctx.isAdmin;
  const [f, setF] = useState<OwnerForm | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const call = async (action: string, body: Record<string, unknown>) => {
    if (!ctx.session) return null;
    setErr(''); setMsg(''); setBusy(true);
    try { return await provisionApi<{ github?: { status: GhStatus; error?: string; detail?: string } | null; revoked?: string }>(ctx.session, action, body); }
    catch (e) { setErr((e as Error).message); return null; }
    finally { setBusy(false); }
  };
  const ghMsg = (r: { github?: { status: GhStatus; error?: string; detail?: string } | null; revoked?: string } | null) => {
    if (!r) return;
    const parts = [];
    if (r.revoked) parts.push(`옛 권한: ${r.revoked}`);
    if (r.github) parts.push(`GitHub: ${GH_LABEL[r.github.status]}${r.github.error || r.github.detail ? ` (${r.github.error ?? r.github.detail})` : ''}`);
    setMsg(parts.join(' · ') || '저장했습니다.');
  };
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (!f) return;
    const body = { name: f.name, email: f.email || null, github_username: f.github_username || null, role: f.role || '담당' };
    const r = f.id ? await call('update_owner', { owner_id: f.id, ...body }) : await call('add_owner', { app_id: app.id, ...body });
    if (r) { ghMsg(r); setF(null); reload(); }
  };
  const del = async (o: Owner) => {
    if (!confirm(`${o.name} 님을 담당에서 뺄까요?${o.github_username ? `\nGitHub @${o.github_username} 의 이 저장소 권한도 회수합니다.` : ''}`)) return;
    const r = await call('remove_owner', { owner_id: o.id }); if (r) { ghMsg(r); reload(); }
  };
  const sync = async (o: Owner) => { const r = await call('sync_owner', { owner_id: o.id }); if (r) { ghMsg(r); reload(); } };
  const form = (
    <form className="row wrap" onSubmit={save}>
      <input required placeholder="이름" value={f?.name ?? ''} onChange={(e) => f && setF({ ...f, name: e.target.value })} />
      <input placeholder="역할(예: 책임, 개발)" value={f?.role ?? ''} onChange={(e) => f && setF({ ...f, role: e.target.value })} />
      <input type="email" placeholder="이메일 (허브 계정 메일)" value={f?.email ?? ''} onChange={(e) => f && setF({ ...f, email: e.target.value })} />
      <input placeholder="GitHub 아이디 (저장소 쓰기 권한 초대)" value={f?.github_username ?? ''} onChange={(e) => f && setF({ ...f, github_username: e.target.value.trim() })} />
      <button disabled={busy}>{busy ? '저장 중…' : f?.id ? '저장' : '추가'}</button><button type="button" className="ghost" onClick={() => setF(null)}>취소</button>
    </form>
  );
  return (
    <div className="owners">
      <h4>🧑‍💻 담당 개발자</h4>
      {owners.length === 0 ? <p className="muted">등록된 담당자가 없습니다.</p> : (
        <div className="owner-list">{owners.map((o) => (
          <div key={o.id} className="owner">
            <span className="avatar">{o.name.slice(0, 1)}</span>
            <span className="grow"><b>{o.name}</b> <span className="badge">{o.role}</span>
              {o.github_username && o.gh_status && <span className={`gh gh-${o.gh_status}`} title={o.gh_error ?? ''}>{o.gh_status === 'active' ? '✓' : o.gh_status === 'invited' ? '✉️' : o.gh_status === 'failed' ? '⚠️' : '—'} {GH_LABEL[o.gh_status]}</span>}
              <small className="muted block">{o.email}{o.github_username && <> · <a href={`https://github.com/${o.github_username}`} target="_blank" rel="noopener noreferrer">@{o.github_username}</a></>}
                {o.gh_status === 'failed' && o.gh_error && <> · <span className="error-text">{o.gh_error}</span></>}</small></span>
            {isAdmin && <>
              {o.github_username && <button className="ghost small" disabled={busy} onClick={() => sync(o)} title="GitHub 권한 상태를 다시 확인하고, 없으면 초대합니다">{o.gh_status === 'failed' ? '다시 시도' : '권한 확인'}</button>}
              <button className="ghost small" disabled={busy} onClick={() => setF({ id: o.id, name: o.name, email: o.email ?? '', github_username: o.github_username ?? '', role: o.role })}>수정</button>
              <button className="ghost small" disabled={busy} onClick={() => del(o)}>빼기</button>
            </>}
          </div>))}
        </div>)}
      {err && <p className="error">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      {isAdmin && (f ? form : <button className="ghost small" onClick={() => setF({ name: '', email: '', github_username: '', role: '담당' })}>+ 담당자 추가</button>)}
      {isAdmin && <p className="muted" style={{ fontSize: 12.5 }}>GitHub 아이디를 넣거나 바꾸면 이 앱 저장소에 쓰기(push) 권한으로 바로 초대하고, 빼면 권한을 회수합니다.</p>}
    </div>
  );
}
