// 웹 AI(ChatGPT Codex · Claude Code)로 앱을 만드는 안내 — 앱 정보 창의 🤖 카드와 /guide/ai 화면이 함께 쓴다.
import { useState, type ReactNode } from 'react';
import { Link, type Ctx } from '../App';
import { aiPrompt, copyText, repoUrlOf, type AiAppRef } from '../aiStart';

const C = ({ children }: { children: string }) => <div className="codeblock"><pre><code>{children}</code></pre></div>;

/** 프롬프트 복사 카드 — 앱 상세(앱 정보 창)·승인 완료 화면·가이드에서 같은 것을 쓴다 */
export function AiStartCard({ name, slug, repoUrl, compact = false }: AiAppRef & { compact?: boolean }) {
  const [state, setState] = useState<'' | 'ok' | 'fail'>('');
  const [show, setShow] = useState(false);
  const text = aiPrompt({ name, slug, repoUrl });
  const copy = async () => { setState((await copyText(text)) ? 'ok' : 'fail'); };
  return (
    <div className={`ai-start${compact ? ' compact' : ''}`}>
      <div className="ai-start-head">
        <span className="ai-start-badge" aria-hidden="true">🤖</span>
        <div className="ai-start-txt">
          <b>AI로 개발 시작하기</b>
          <p>ChatGPT Codex · Claude Code 같은 웹 AI 에 이 저장소를 열고, 아래 프롬프트를 붙여 넣으세요. 앱 주소·저장소·DB 규칙이 이미 들어 있어요.</p>
        </div>
      </div>
      <div className="ai-start-btns">
        <button type="button" onClick={copy}>📋 프롬프트 복사</button>
        <a className="btn ghost" href={repoUrl || repoUrlOf(slug)} target="_blank" rel="noopener noreferrer">저장소 열기 ↗</a>
        <Link to="/guide/ai" className="btn ghost">웹 AI 가이드</Link>
      </div>
      {state === 'ok' && <p className="ok ai-start-msg" role="status">복사했습니다. 웹 AI 채팅창에 붙여 넣고 [만들 것]에 원하는 기능을 적어 주세요.</p>}
      {state === 'fail' && <p className="error ai-start-msg" role="alert">복사하지 못했습니다. 아래 ‘프롬프트 보기’에서 직접 골라 복사해 주세요.</p>}
      <details className="ai-start-view" open={show} onToggle={(e) => setShow((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>프롬프트 보기</summary>
        <pre className="ai-prompt" aria-label="복사할 프롬프트">{text}</pre>
      </details>
    </div>
  );
}

const STEPS: { id: string; t: string; tone: string }[] = [
  { id: 'request', t: '앱 신청하고 승인받기', tone: 'cyan' },
  { id: 'open', t: '웹 AI 에 저장소 열기', tone: 'yellow' },
  { id: 'copy', t: '허브에서 프롬프트 복사', tone: 'green' },
  { id: 'ask', t: '만들 기능 적어 보내기', tone: 'coral' },
  { id: 'db', t: 'DB 는 SQL 파일만 올리기', tone: 'purple' },
  { id: 'ship', t: '확인하고 배포하기', tone: 'cyan' },
  { id: 'help', t: '자주 막히는 문제', tone: 'yellow' },
];
function Step({ n, children }: { n: number; children: ReactNode }) {
  const s = STEPS[n - 1];
  return (
    <section id={s.id} className="g-step">
      <div className={`g-num g-${s.tone}`} aria-hidden="true">{n}</div>
      <div className="g-body"><h2>{s.t}</h2>{children}</div>
    </section>
  );
}

/** /guide/ai — 선생님께 그대로 나눠 줄 수 있는 웹 AI 개발 안내 (로그인 없이 열린다) */
export function AiGuidePage({ ctx }: { ctx: Ctx }) {
  const staff = ctx.me?.role === 'staff' || ctx.me?.role === 'admin';
  return (
    <article className="guide ai-guide">
      <header className="g-hero">
        <div className="g-hero-copy ai-hero-copy">
          <span className="eyebrow">시작 가이드 · 웹 AI</span>
          <h1>🤖 웹 AI 로 앱 만들기</h1>
          <p>내 PC 에 개발 도구를 설치하지 않아도 됩니다. <b>ChatGPT Codex</b> 나 <b>Claude Code</b> 에 승인된 저장소를 열고, 허브가 만들어 주는 <b>프롬프트를 붙여 넣으면</b> 화면과 데이터베이스를 함께 만듭니다. 배포와 DB 반영은 GitHub Actions 가 알아서 합니다.</p>
          <div className="hero-cta">
            {staff ? <Link to="/hub/requests" className="btn alt">앱 신청하러 가기</Link> : <Link to="/hub/login" className="btn alt">가입하고 시작하기</Link>}
            <Link to="/guide" className="btn">전체 시작 가이드</Link>
            <a className="btn" href="#copy">프롬프트부터 보기</a>
          </div>
        </div>
        <nav className="g-toc" aria-label="차례">
          <b>차례</b>
          <ol>{STEPS.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.t}</a></li>)}</ol>
        </nav>
      </header>

      <Step n={1}>
        <p>순서는 평소와 같습니다. 허브에 가입하고 <b>개발자</b>로 승인받은 뒤, <b>앱 신청</b>에서 앱 이름·주소 이름·GitHub 아이디·목적을 적습니다. 관리자가 승인하면 몇 분 안에 저장소·주소·DB·파일 저장소·서버 함수가 <b>자동으로</b> 만들어집니다.</p>
        <ul>
          <li>저장소 초대 메일(GitHub)이 오면 <b>수락</b>해야 웹 AI 가 저장소에 올릴 수 있습니다.</li>
          <li>새로 만든 앱은 <b>DB 접속 정보(DATABASE_URL)</b> 가 저장소의 Actions 비밀값으로 자동 등록됩니다. 그래서 로컬 명령 없이도 SQL 파일이 DB 에 반영됩니다.</li>
          <li>이 기능 전에 만든 앱은 저장소 <b>Settings → Secrets and variables → Actions</b> 에 <code>DATABASE_URL</code> 을 한 번 넣어 주세요(허브 → 내 서비스 → 앱 정보 → DB 접속 정보의 비밀번호로 만든 접속 주소).</li>
        </ul>
      </Step>

      <Step n={2}>
        <p>웹 AI 에 <b>내 저장소</b>를 엽니다. 새 저장소를 만들지 마세요 — 이미 있는 저장소에서 작업해야 배포·DB 가 그대로 이어집니다.</p>
        <div className="g-grid">
          <div><b>ChatGPT Codex</b><span>Codex 에서 GitHub 계정을 연결하고 <code>bmr-apps/&lt;주소 이름&gt;</code> 저장소를 고릅니다.</span></div>
          <div><b>Claude Code</b><span>claude.ai 의 Code / Claude Code 에서 GitHub 를 연결하고 같은 저장소를 엽니다.</span></div>
          <div><b>둘 다</b><span>저장소의 <code>CLAUDE.md</code>·<code>AGENTS.md</code> 를 먼저 읽으라고 하면 규칙을 지킵니다.</span></div>
          <div><b>처음 한 번</b><span>“README.md 와 CLAUDE.md, AGENTS.md 를 읽고 이 저장소 구조를 요약해 줘” 부터 시키면 좋습니다.</span></div>
        </div>
        <p className="muted">웹 AI 가 GitHub 에 push 할 수 있어야 배포됩니다. 저장소 쓰기 권한이 없다면 관리자에게 담당자 등록을 요청하세요.</p>
      </Step>

      <Step n={3}>
        <p>허브 → <b>대시보드</b> → <b>내 서비스</b> → 내 앱 카드를 엽니다. 앱 정보 창의 <b>🤖 AI로 개발 시작하기 → 프롬프트 복사</b>를 누르면, 이 앱의 주소·저장소·DB 스키마와 꼭 지킬 규칙이 들어간 프롬프트가 복사됩니다. 승인이 끝난 신청 카드에도 같은 카드가 있습니다.</p>
        <AiStartCard name="도서 대출 관리" slug="library" compact />
        <p className="muted">프롬프트에는 ① 새 프로젝트를 만들지 말 것 ② <code>/&lt;주소 이름&gt;/</code> 경로와 <code>./</code> 상대 경로 ③ 자체 SVG 로고 ④ 인라인 style·외부 CDN 금지(CSP) ⑤ <code>localStorage</code> 접두어·<code>signOut({'{ scope: \'local\' }'})</code> ⑥ <code>supabase/migrations/*.sql</code> 자동 반영 ⑦ <code>npm run build</code>·<code>bmr-check</code> 통과 가 들어 있습니다.</p>
      </Step>

      <Step n={4}>
        <p>복사한 프롬프트의 <b>[만들 것]</b> 칸에 원하는 화면과 기능을 적어 보냅니다. 한 번에 다 시키기보다 <b>작은 단위로</b> 나누면 결과가 좋습니다.</p>
        <C>{`[만들 것]
- 첫 화면: 우리 반 도서 목록 (표 대신 카드 3열, 모바일은 1열)
- 로그인한 사람만 책을 추가할 수 있게 (제목·지은이·한 줄 소개)
- 표: supabase/migrations/20261124120000_create_books.sql`}</C>
        <ul>
          <li>“먼저 계획만 보여 줘”, “이 부분만 고쳐 줘” 처럼 범위를 좁히면 엉뚱한 파일을 건드리지 않습니다.</li>
          <li>화면이 마음에 안 들면 스크린샷을 붙이고 “이 부분만” 이라고 말하세요.</li>
          <li>웹 AI 가 <b>새 프로젝트를 만들려 하면</b> “새 프로젝트 만들지 말고 지금 저장소에서 고쳐 줘” 라고 다시 말해 주세요.</li>
        </ul>
      </Step>

      <Step n={5}>
        <p>표·뷰·정책이 필요하면 <b>SQL 파일만 추가</b>하면 됩니다. 커밋·푸시하면 GitHub Actions 가 <code>npm run db:migrate</code> 를 자동 실행해 DB 에 반영합니다. <b>내 PC 에서 psql 을 켤 필요가 없습니다.</b></p>
        <C>{`supabase/migrations/20261124120000_create_books.sql

create table library.books (
  id bigint generated always as identity primary key,
  title text not null,
  owner uuid not null default bmr.uid(),        -- auth.uid() 대신 bmr.uid()
  created_at timestamptz not null default now()
);
alter table library.books enable row level security;
create policy "누구나 읽기" on library.books for select to anon, authenticated using (true);
create policy "내 것 쓰기" on library.books for insert to authenticated with check (owner = (select bmr.uid()));
grant insert on library.books to authenticated;`}</C>
        <ul>
          <li>이미 반영된 파일은 다시 실행하지 않습니다. 고칠 때는 <b>새 파일</b>을 추가하세요(이름 순서로 실행).</li>
          <li>SQL 오류·연결 오류로 실패하면 저장소 <b>Actions</b> 실행 화면의 <b>Summary</b> 에 이유가 나옵니다.</li>
          <li>DB 비밀번호를 <b>새로 발급</b>하면 Actions 의 <code>DATABASE_URL</code> 도 새 값으로 바꿔야 합니다.</li>
        </ul>
      </Step>

      <Step n={6}>
        <p>웹 AI 에 마무리를 이렇게 시키면 확인까지 해 줍니다.</p>
        <C>{`npm run build                  # 타입 오류 0
node scripts/bmr-check.mjs     # 공용 주소 규칙 경고 0건
git add -A && git commit -m "첫 화면" && git push`}</C>
        <ul>
          <li>push 하면 <b>GitHub Pages 배포</b>(<code>deploy.yml</code>)가 1~2분 안에 https://apps.bmrschool.net/&lt;주소 이름&gt;/ 에 올립니다.</li>
          <li><b>DB 자동 반영</b> 스텝이 같은 실행에서 <code>supabase/migrations</code> 를 처리합니다. Secret 이 없으면 건너뛰고 안내만 남깁니다(배포는 정상).</li>
          <li>Actions 실행 화면의 <b>Summary</b> 에서 배포·DB 반영 결과를 확인하세요.</li>
        </ul>
      </Step>

      <Step n={7}>
        <div className="g-faq">
          <details><summary>웹 AI 가 새 프로젝트를 만들려고 해요</summary><p>“새 프로젝트·새 저장소를 만들지 말고, 지금 저장소의 파일을 고쳐 줘” 라고 말하세요. 그래도 새로 만들면 그 결과는 버리고 저장소의 <code>index.html</code>·<code>src/</code> 를 고치게 하면 됩니다.</p></details>
          <details><summary>push 했는데 화면이 그대로예요</summary><p>저장소 <b>Actions</b> 에서 배포가 성공했는지 보고, 브라우저를 새로고침하세요. <code>vite.config.js</code> 의 <code>base: '/&lt;주소 이름&gt;/'</code> 를 바꾸면 흰 화면이 됩니다.</p></details>
          <details><summary>데이터가 안 보여요</summary><p>대부분 RLS 정책이 없어서입니다. 화면에 안 보이는 것이 안전한 기본값이에요. <code>select</code> 정책과 <code>grant</code> 를 확인하세요.</p></details>
          <details><summary>DB 반영이 실패했어요</summary><p>Actions 실행의 Summary 를 보세요. ① SQL 오류면 새 마이그레이션 파일로 고칩니다. ② 연결 오류(비밀번호)면 Settings → Secrets 의 <code>DATABASE_URL</code> 을 지금 비밀번호로 바꿉니다.</p></details>
          <details><summary>스타일이 하나도 안 먹어요</summary><p>CSP 가 인라인 style 을 막습니다. <code>style="…"</code> 대신 CSS 파일의 클래스를 쓰게 하세요. 외부 CDN 폰트·아이콘도 막힙니다.</p></details>
          <details><summary>로그아웃하면 다른 앱도 로그아웃돼요</summary><p><code>signOut()</code> 대신 <code>{"signOut({ scope: 'local' })"}</code> 를 쓰게 하세요. 이 앱에서만 로그아웃됩니다.</p></details>
          <details><summary>다른 앱 화면이 깨졌어요</summary><p>맨 앞 <code>/</code> 경로(<code>'/data.json'</code>)나 범위가 넓은 서비스 워커, <code>localStorage.clear()</code> 가 원인입니다. <code>bmr-check.mjs</code> 경고를 0건으로 만드세요.</p></details>
          <details><summary>비밀 키는 어디에 넣어요?</summary><p>브라우저 코드에는 공개 키만. 외부 API 키·발송 토큰은 허브 → 내 서비스 → 앱 정보 → <b>개발자 셀프서비스</b>의 함수 비밀값에 넣고 서버 함수에서 <code>Deno.env.get()</code> 으로 읽습니다.</p></details>
        </div>
        <p>더 자세한 내용은 <Link to="/guide">전체 시작 가이드</Link> 와 저장소의 <code>README.md</code>·<code>CLAUDE.md</code> 에 있습니다.</p>
      </Step>
    </article>
  );
}
