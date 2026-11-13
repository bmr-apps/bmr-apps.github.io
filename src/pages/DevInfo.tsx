import { useEffect, useState, type ReactNode } from 'react';
import type { Ctx } from '../App';
import { Link } from '../App';
import { sb, ANON, SUPABASE_URL } from '../sb';

/** 서버(app_dev_info)가 담당자·관리자에게만 돌려주는 개발 정보. 비밀값은 없음 */
export type DevInfo = {
  app_id: number; slug: string; name: string; url: string; repo_url: string | null; status: string; is_owner: boolean; v2: boolean;
  schema: string | null; dev_role: string | null; bucket: string | null; fn: string | null; secret_prefix: string | null;
  ref: string; pool_host: string; tables: string[] | null; pending_initial: boolean | null;
};

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="ghost small copy-btn" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1400); } catch { /* 복사 실패는 조용히 */ } }}>{ok ? '복사됨' : '복사'}</button>;
}
function Code({ children }: { children: string }) {
  return <div className="codeblock"><pre><code>{children}</code></pre><Copy text={children} /></div>;
}
const Row = ({ k, children }: { k: string; children: ReactNode }) => <><dt>{k}</dt><dd>{children}</dd></>;

export function DevInfoSection({ ctx, appId }: { ctx: Ctx; appId: number }) {
  const [d, setD] = useState<DevInfo | null | undefined>(undefined);
  const [health, setHealth] = useState<string>('');
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!ctx.session) return;
    sb.rpc('app_dev_info', { p_app_id: appId }).then(({ data, error }) => setD(error ? null : (data as DevInfo | null)));
  }, [appId, ctx.session]);
  useEffect(() => {
    if (!d?.fn) return;
    const c = new AbortController();
    fetch(`${SUPABASE_URL}/functions/v1/${d.fn}/health`, { signal: c.signal }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      setHealth(r.ok ? (j.db ? '정상 (DB 연결됨)' : '응답함 (DB 확인 필요)') : `응답 ${r.status}`);
    }).catch(() => setHealth('응답 없음'));
    return () => c.abort();
  }, [d?.fn]);
  if (!d) return null;   // 담당자·관리자가 아니면 서버가 아무것도 주지 않음
  const site = d.url.endsWith('/') ? d.url : d.url + '/';
  const repo = d.repo_url;
  const dbUrl = d.dev_role ? `postgresql://${d.dev_role}.${d.ref}:<비밀번호>@${d.pool_host}:5432/postgres` : '';
  const fnUrl = d.fn ? `${SUPABASE_URL}/functions/v1/${d.fn}` : '';
  return (
    <div className="devinfo">
      <div className="devinfo-head">
        <h4>🛠️ 개발 정보 {d.is_owner ? <span className="badge s-preparing">내 서비스</span> : <span className="badge role-admin">관리자 보기</span>}</h4>
        <button type="button" className="ghost small" onClick={() => setOpen(!open)}>{open ? '접기' : '펼치기'}</button>
      </div>
      {open && <>
        <p className="muted">이 서비스 담당자와 관리자만 볼 수 있습니다. 공개 앱 주소에는 '준비 중' 안내만 보입니다. 처음이라면 <Link to="/guide">시작 가이드</Link>를 먼저 읽어 보세요.</p>
        {!d.v2 ? <div className="warn">이 앱은 BMR APPS 자동 개발 환경(v2)으로 만들어지지 않아 DB·버킷·함수 정보가 없습니다.{repo && <> 저장소: <a href={repo} target="_blank" rel="noopener noreferrer">{repo.replace('https://github.com/', '')}</a></>}</div> : <>
          <dl className="meta">
            <Row k="앱 주소"><a href={site} target="_blank" rel="noopener noreferrer">{site}</a></Row>
            {repo && <Row k="저장소"><a href={repo} target="_blank" rel="noopener noreferrer">{repo.replace('https://github.com/', '')}</a> <span className="muted">· main 에 push 하면 1~2분 뒤 자동 배포</span></Row>}
            <Row k="Supabase"><code>{SUPABASE_URL}</code></Row>
            <Row k="공개 키"><code className="wrap-any">{ANON}</code> <span className="muted">(브라우저에 넣어도 되는 공개 값 · 저장소 .env.example 에도 있음)</span></Row>
            <Row k="스키마"><code>{d.schema}</code>{d.tables && <span className="muted"> · 표 {d.tables.length ? d.tables.join(', ') : '없음'}</span>}</Row>
            <Row k="DB 계정"><code>{d.dev_role}</code> <span className="muted">· 비밀번호는 이 창 아래 'DB 접속 정보'(앱 정보 → DB 접속 정보)에서 {d.pending_initial ? '처음 한 번 받기' : '새로 발급'}</span></Row>
            <Row k="접속"><code>{d.pool_host}</code> · 포트 <code>5432</code>(세션) / <code>6543</code>(짧은 요청) · DB <code>postgres</code> · 사용자 <code>{d.dev_role}.{d.ref}</code></Row>
            {d.bucket && <Row k="파일 버킷"><code>{d.bucket}</code> <span className="muted">(비공개 · 한글 파일 이름 불가)</span></Row>}
            {d.fn && <Row k="서버 함수"><code>{d.fn}</code> <span className="muted">· 상태 {health || '확인 중…'}</span><br /><code className="wrap-any">{fnUrl}/hello</code></Row>}
            {d.secret_prefix && <Row k="함수 비밀값"><code>{d.secret_prefix}…</code> <span className="muted">로 시작하는 이름만 (값은 관리자가 넣음)</span></Row>}
          </dl>
          <h5>1. 내려받고 실행하기</h5>
          <Code>{`git clone ${repo ?? `https://github.com/bmr-apps/${d.slug}`}.git
cd ${d.slug}
npm install
cp .env.example .env.local   # DATABASE_URL 의 <비밀번호> 칸만 채우기
npm run dev                  # http://localhost:5173/${d.slug}/`}</Code>
          <h5>2. DB 직접 접속 (.env.local)</h5>
          <Code>{`DATABASE_URL=${dbUrl}`}</Code>
          <p className="muted">비밀번호는 저장소·채팅·캡처에 올리지 마세요. 표는 <code>supabase/migrations/</code> 에 SQL 파일을 만들고 <code>npm run db:migrate</code> 로 만듭니다. 정책에는 <code>auth.uid()</code> 대신 <code>bmr.uid()</code> 를 씁니다.</p>
          <h5>3. 브라우저에서 documents 표 쓰기 (supabase-js)</h5>
          <Code>{`import { supabase } from './supabase.js';   // 스키마 ${d.schema} 로 연결되어 있음

// 쓰기 (로그인한 사람만, owner 는 자동)
await supabase.from('documents').insert({ collection: 'notice', data: { title: '첫 글', body: '안녕하세요' } });

// 읽기
const { data } = await supabase.from('documents')
  .select('id, data, created_at').eq('collection', 'notice').order('created_at', { ascending: false });`}</Code>
          {d.bucket && <><h5>4. 파일 올리기</h5>
          <Code>{`const { data: { user } } = await supabase.auth.getUser();
const path = \`\${user.id}/\${Date.now()}.png\`;   // 키에 한글·공백 대신 영문·숫자 사용
await supabase.storage.from('${d.bucket}').upload(path, file);`}</Code></>}
          <ul className="devnotes">
            <li><b>화면 배포</b>: <code>main</code> 에 push → GitHub Actions 가 빌드해 {site} 에 올립니다.</li>
            <li><b>서버 함수</b>: <code>supabase/functions/{d.fn}/</code> 를 고쳐 <code>main</code> 에 push → 검사 후 <code>{d.fn}</code> 가 자동 배포됩니다 (저장소 Actions → 서버 함수 검사·배포).</li>
            <li><b>자세한 설명</b>: 저장소 <code>README.md</code> · <Link to="/guide">시작 가이드</Link></li>
          </ul>
        </>}
      </>}
    </div>
  );
}
