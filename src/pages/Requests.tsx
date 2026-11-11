import { useEffect, useState, type FormEvent } from 'react';
import type { Ctx } from '../App';
import { sb, errMsg, fmtTime, type Request } from '../sb';

const ST = { pending: '검토 대기', approved: '승인', rejected: '반려' } as const;
const blank = { requester_name: '', requester_email: '', app_name: '', slug: '', purpose: '', data_handled: '', has_student_pii: '' as '' | 'yes' | 'no', github_username: '' };

export function RequestsPage({ ctx }: { ctx: Ctx }) {
  const [list, setList] = useState<Request[]>([]);
  const [f, setF] = useState({ ...blank, requester_name: ctx.me?.name ?? '', requester_email: ctx.me?.email ?? '' });
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const load = () => sb.from('app_requests').select('*').order('created_at', { ascending: false }).then(({ data, error }) => {
    if (error) setErr(errMsg(error)); setList((data as Request[]) ?? []);
  });
  useEffect(() => { load(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    if (!f.has_student_pii) return setErr('학생 개인정보를 다루는지 골라 주세요.');
    const { error } = await sb.from('app_requests').insert({
      requester_name: f.requester_name, requester_email: f.requester_email || null, app_name: f.app_name, slug: f.slug,
      purpose: f.purpose, data_handled: f.data_handled, has_student_pii: f.has_student_pii === 'yes', github_username: f.github_username,
    });
    if (error) return setErr(errMsg(error));
    setMsg('신청했습니다. 관리자가 검토한 뒤 결과가 이 화면에 표시됩니다.'); setF({ ...blank, requester_name: f.requester_name }); load();
  };
  const mine = list.filter((r) => r.requested_by === ctx.session?.user.id);
  const others = ctx.isAdmin ? list : mine;
  return (
    <section>
      <h2>새 앱 신청</h2>
      <form className="card form" onSubmit={submit}>
        <div className="cols">
          <label>신청자 이름<input required value={f.requester_name} onChange={(e) => setF({ ...f, requester_name: e.target.value })} /></label>
          <label>연락 이메일<input type="email" value={f.requester_email} onChange={(e) => setF({ ...f, requester_email: e.target.value })} /></label>
          <label>앱 이름<input required value={f.app_name} onChange={(e) => setF({ ...f, app_name: e.target.value })} placeholder="예: 도서 대출 관리" /></label>
          <label>원하는 주소 이름<input required pattern="[a-z0-9][a-z0-9-]{1,38}" title="영문 소문자·숫자·하이픈 2~39자" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="예: library" />
            <small className="muted">apps.bmrschool.net/{f.slug || '주소이름'}</small></label>
          <label>GitHub 아이디<input required value={f.github_username} onChange={(e) => setF({ ...f, github_username: e.target.value })} placeholder="bmr-apps 조직에 초대할 계정" /></label>
          <fieldset><legend>학생 개인정보를 다루나요?</legend>
            <label className="inline"><input type="radio" name="pii" checked={f.has_student_pii === 'yes'} onChange={() => setF({ ...f, has_student_pii: 'yes' })} /> 예</label>
            <label className="inline"><input type="radio" name="pii" checked={f.has_student_pii === 'no'} onChange={() => setF({ ...f, has_student_pii: 'no' })} /> 아니오</label>
          </fieldset>
        </div>
        <label>목적·주요 기능<textarea required value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></label>
        <label>다루는 데이터<textarea value={f.data_handled} onChange={(e) => setF({ ...f, data_handled: e.target.value })} placeholder="예: 학생 이름·학번, 대출 기록" /></label>
        {f.has_student_pii === 'yes' && <p className="warn">학생 개인정보를 다루는 앱은 접근 권한(RLS)과 보관 기간을 승인 전에 함께 검토합니다.</p>}
        {err && <p className="error">{err}</p>}{msg && <p className="ok">{msg}</p>}
        <button>신청하기</button>
      </form>
      <h2>{ctx.isAdmin ? '전체 신청 (관리자)' : '내 신청'}</h2>
      {others.length === 0 ? <p className="muted">신청 내역이 없습니다.</p> : others.map((r) => <RequestCard key={r.id} r={r} ctx={ctx} reload={load} />)}
    </section>
  );
}

function RequestCard({ r, ctx, reload }: { r: Request; ctx: Ctx; reload: () => void }) {
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const act = async (kind: 'approve' | 'reject') => {
    setErr(''); setBusy(true);
    const { error } = kind === 'approve'
      ? await sb.rpc('approve_request', { p_request_id: r.id, p_note: note })
      : await sb.rpc('reject_request', { p_request_id: r.id, p_note: note });
    setBusy(false); if (error) setErr(errMsg(error)); else reload();
  };
  const cancel = async () => { if (!confirm('신청을 취소할까요?')) return; const { error } = await sb.from('app_requests').delete().eq('id', r.id); if (error) setErr(errMsg(error)); else reload(); };
  return (
    <div className={`card req s-${r.status}`}>
      <div className="head"><h3>{r.app_name} <code>/{r.slug}</code> <span className={`badge r-${r.status}`}>{ST[r.status]}</span>{r.has_student_pii && <span className="badge pii">학생 개인정보</span>}</h3>
        <span className="muted">{fmtTime(r.created_at)}</span></div>
      <dl className="meta">
        <dt>신청자</dt><dd>{r.requester_name}{r.requester_email && ` · ${r.requester_email}`} · GitHub @{r.github_username}</dd>
        <dt>목적</dt><dd className="pre">{r.purpose}</dd>
        {r.data_handled && <><dt>데이터</dt><dd className="pre">{r.data_handled}</dd></>}
        {r.status !== 'pending' && <><dt>검토</dt><dd>{fmtTime(r.reviewed_at)} {r.review_note && `· ${r.review_note}`}</dd></>}
      </dl>
      {err && <p className="error">{err}</p>}
      {r.status === 'pending' && ctx.isAdmin && (
        <div className="row wrap">
          <input className="grow" placeholder="검토 메모 (반려 시 필수)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button disabled={busy} onClick={() => act('approve')}>승인 (앱 등록)</button>
          <button disabled={busy} className="danger" onClick={() => act('reject')}>반려</button>
        </div>)}
      {r.status === 'pending' && !ctx.isAdmin && r.requested_by === ctx.session?.user.id && <button className="ghost small" onClick={cancel}>신청 취소</button>}
    </div>
  );
}
