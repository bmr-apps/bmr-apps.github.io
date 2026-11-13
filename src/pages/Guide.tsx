import { useEffect, type ReactNode } from 'react';
import { Link, type Ctx } from '../App';

/** /guide — 누구나 읽는 시작 가이드 (가입 전에도). 비밀값은 넣지 않는다 */
const STEPS: { id: string; t: string; tone: string }[] = [
  { id: 'signup', t: '회원가입', tone: 'cyan' }, { id: 'staff', t: '개발자 승급 요청', tone: 'yellow' }, { id: 'github', t: 'GitHub 계정 준비', tone: 'green' },
  { id: 'request', t: '앱 신청', tone: 'coral' }, { id: 'provision', t: '승인 후 생기는 것', tone: 'purple' }, { id: 'devinfo', t: '개발 정보 확인 · DB 비밀번호', tone: 'cyan' },
  { id: 'develop', t: '개발 시작', tone: 'yellow' }, { id: 'manage', t: '앱 정보 · 담당자 · 삭제', tone: 'green' }, { id: 'rules', t: '지켜야 할 것 · 자주 묻는 질문', tone: 'coral' },
];
const C = ({ children }: { children: string }) => <div className="codeblock"><pre><code>{children}</code></pre></div>;
function Step({ n, children }: { n: number; children: ReactNode }) {
  const s = STEPS[n - 1];
  return (
    <section id={s.id} className="g-step">
      <div className={`g-num g-${s.tone}`} aria-hidden="true">{n}</div>
      <div className="g-body"><h2>{s.t}</h2>{children}</div>
    </section>
  );
}

export function GuidePage({ ctx }: { ctx: Ctx }) {
  const role = ctx.me?.role;
  // /guide#google-login 처럼 들어오면 그 부분으로 이동 (앱 안 이동 때도)
  useEffect(() => { const id = decodeURIComponent(location.hash.slice(1)); if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView(), 50); }, []);
  return (
    <article className="guide">
      <header className="g-hero">
        <div className="g-hero-copy">
          <span className="eyebrow">시작 가이드</span>
          <h1>BMR APPS 로 개발 시작하기</h1>
          <p>BMR APPS 는 <b>별무리 개발자들이 만들어 운영하는 서비스</b>를 한곳에 모으는 곳입니다. 앱을 신청해 승인되면 저장소·주소·데이터베이스·파일 저장소·서버 함수가 자동으로 준비되고, 선생님은 화면과 데이터만 만들면 됩니다.</p>
          <div className="hero-cta">
            {!ctx.session ? <Link to="/hub/login" className="btn alt">가입하고 시작하기</Link> : <Link to={role === 'staff' || role === 'admin' ? '/hub/requests' : '/hub/apps'} className="btn alt">{role === 'staff' || role === 'admin' ? '앱 신청하러 가기' : '관리 허브로'}</Link>}
            <Link to="/guide/quick" className="btn">⚡ 빠른 시작</Link>
            <a className="btn" href="#signup">1단계부터 읽기</a>
          </div>
        </div>
        <nav className="g-toc" aria-label="차례">
          <b>차례</b>
          <ol>{STEPS.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.t}</a></li>)}</ol>
        </nav>
      </header>

      <Link to="/guide/quick" className="g-quick-link">
        <span className="g-quick-badge" aria-hidden="true">⚡</span>
        <span><b>바쁘다면 빠른 시작부터</b><small>가입부터 첫 배포까지 꼭 필요한 5단계만 한 화면에 모았어요.</small></span>
        <span className="g-quick-go" aria-hidden="true">→</span>
      </Link>

      <Step n={1}>
        <p><Link to="/hub/login">로그인 화면</Link>에서 <b>처음이면 가입하기</b>를 눌러 이름·이메일·비밀번호(8자 이상)를 넣으면 바로 가입됩니다. 처음에는 <b>일반 사용자</b>로 시작해요.</p>
        <ul><li>일반 사용자는 운영 중인 서비스를 보고 쓸 수 있습니다.</li><li>학교 메일처럼 <b>앱 담당자로 등록할 메일</b>로 가입하세요. 담당자 메일과 로그인 메일이 같아야 '내 서비스'가 연결됩니다.</li></ul>
      </Step>

      <Step n={2}>
        <p>앱 신청·DB 접속 정보·운영 상태는 <b>개발자</b>만 쓸 수 있습니다. 관리자에게 "BMR APPS 개발자로 올려 주세요"라고 가입한 메일과 함께 요청하세요. 관리자가 사용자 관리 화면에서 역할을 <b>개발자</b>로 바꾸면 다시 로그인하지 않아도 메뉴가 열립니다.</p>
      </Step>

      <Step n={3}>
        <p>코드는 GitHub 의 <code>bmr-apps</code> 조직 저장소에 둡니다. <a href="https://github.com/signup" target="_blank" rel="noopener noreferrer">GitHub 계정</a>이 없다면 먼저 만들어 두세요.</p>
        <ul>
          <li>앱이 만들어지면 그 저장소에 <b>쓰기(push) 권한 초대</b>가 GitHub 메일로 갑니다. 메일이나 github.com 알림에서 <b>초대 수락</b>을 눌러야 push 할 수 있어요.</li>
          <li>저장소는 <b>공개</b>입니다. 비밀번호·키 같은 비밀값은 절대 올리지 마세요.</li>
        </ul>
      </Step>

      <Step n={4}>
        <p>허브 → <b>앱 신청</b> → <b>새 앱 신청하기</b>에서 아래 칸을 채웁니다.</p>
        <dl className="meta g-fields">
          <dt>앱 이름</dt><dd>화면에 보일 이름. 예: 도서 대출 관리 (나중에 관리자가 바꿀 수 있음)</dd>
          <dt>주소 이름</dt><dd>영문 소문자로 시작, 영문 소문자·숫자·하이픈 2~39자. 앱 주소 <code>apps.bmrschool.net/&lt;주소 이름&gt;</code>, 저장소·DB 이름이 모두 이것으로 정해지고 <b>나중에 바꿀 수 없습니다.</b> 예약어(hub, guide 등)·이미 쓰는 이름은 안 돼요.</dd>
          <dt>GitHub 아이디</dt><dd>저장소에 초대할 내 GitHub 계정</dd>
          <dt>목적·주요 기능</dt><dd>누가 무엇을 하려고 쓰는지 짧게</dd>
          <dt>다루는 데이터</dt><dd>예: 활동 기록, 공지 글, 학생 이름·학번</dd>
          <dt>학생 개인정보</dt><dd>이름·학번·연락처·성적 등을 다루면 <b>예</b>. 관리자가 보관 방법·접근 범위를 함께 검토합니다.</dd>
        </dl>
        <p className="warn">학생 개인정보는 꼭 필요한 만큼만, 관리자와 상의한 방법으로만 다뤄 주세요.</p>
      </Step>

      <Step n={5}>
        <p>관리자가 승인하면 몇 분 안에 아래가 <b>자동으로</b> 만들어집니다. (주소 이름이 <code>library</code> 라면)</p>
        <div className="g-grid">
          <div><b>GitHub 저장소</b><span><code>bmr-apps/library</code> — 시작 코드·README·자동 배포 설정 포함</span></div>
          <div><b>앱 주소</b><span><code>apps.bmrschool.net/library</code> — 처음에는 '준비 중인 페이지입니다' 안내만 보임</span></div>
          <div><b>DB 스키마</b><span><code>library</code> — 이 안에서는 표·뷰·함수를 마음대로</span></div>
          <div><b>DB 계정</b><span><code>library_dev</code> — 내 스키마만 만들고 고칠 수 있는 계정</span></div>
          <div><b>documents 표</b><span>JSON 으로 바로 저장할 수 있는 시작 표</span></div>
          <div><b>파일 버킷</b><span><code>library</code> (비공개)</span></div>
          <div><b>서버 함수</b><span><code>library-fn</code> — 비밀 키·외부 API 용</span></div>
        </div>
        <p className="muted">하이픈이 있는 주소(<code>my-app</code>)는 DB 이름에서 밑줄(<code>my_app</code>)이 됩니다.</p>
      </Step>

      <Step n={6}>
        <ol className="g-ol">
          <li>허브 <b>대시보드</b>에서 <b>내 서비스</b> 탭을 누르고 내 앱 카드를 엽니다.</li>
          <li><b>🛠️ 개발 정보</b>에 저장소·주소·Supabase 주소·공개 키·스키마·DB 계정·접속 주소·버킷·함수와 예제 코드가 있습니다. <b>담당자와 관리자만</b> 볼 수 있어요.</li>
          <li>같은 앱 정보 창의 <b>DB 접속 정보</b>(앱 정보 → DB 접속 정보)에서 <b>처음 비밀번호 받기</b>를 누르면 비밀번호가 <b>딱 한 번</b> 보입니다. 바로 복사해 안전한 곳(<code>.env.local</code>, 비밀번호 관리 프로그램)에 두세요.</li>
          <li>잊어버렸다면 <b>새 비밀번호 발급</b>을 누르세요. 이전 비밀번호는 바로 못 쓰게 됩니다.</li>
        </ol>
      </Step>

      <Step n={7}>
        <h3>내려받고 실행하기</h3>
        <C>{`git clone https://github.com/bmr-apps/library.git
cd library
npm install
cp .env.example .env.local     # DATABASE_URL 의 <비밀번호> 칸만 채우기
npm run dev                    # http://localhost:5173/library/`}</C>
        <h3>브라우저에서 데이터 쓰기 (supabase-js + 공개 키)</h3>
        <p>시작 코드의 <code>src/supabase.js</code> 가 공개 키와 내 스키마로 연결되어 있어요. 공개(publishable) 키는 브라우저에 넣어도 되는 값입니다.</p>
        <C>{`import { supabase } from './supabase.js';

// documents 표에 JSON 저장 (로그인한 사람만, owner 는 자동)
await supabase.from('documents').insert({ collection: 'notice', data: { title: '첫 공지', body: '안녕하세요' } });

// 읽기
const { data } = await supabase.from('documents')
  .select('id, data, created_at').eq('collection', 'notice').order('created_at', { ascending: false });`}</C>
        <h3>내 스키마에 표 만들기 (DB 접속)</h3>
        <p><code>supabase/migrations/</code> 에 SQL 파일을 만들고 <code>npm run db:migrate</code> 를 실행하세요. psql 이나 AI 코딩 도구에 <code>.env.local</code> 의 <code>DATABASE_URL</code> 을 알려 줘도 됩니다.</p>
        <C>{`create table library.books (
  id bigint generated always as identity primary key,
  title text not null,
  owner uuid not null default bmr.uid(),
  created_at timestamptz not null default now()
);
alter table library.books enable row level security;
create policy "누구나 읽기" on library.books for select to anon, authenticated using (true);
create policy "내 것 쓰기" on library.books for insert to authenticated with check (owner = (select bmr.uid()));
grant insert on library.books to authenticated;`}</C>
        <ul>
          <li><b>RLS 기본</b>: 새 표는 RLS 가 자동으로 켜지고 브라우저에는 '읽기'만 주어집니다. 정책이 없으면 아무것도 안 보이니 정책부터 만드세요.</li>
          <li>정책에는 <code>auth.uid()</code> 대신 <b><code>bmr.uid()</code></b> 를 씁니다 (선생님 DB 계정은 auth 스키마 권한이 없음).</li>
          <li>'로그인했다'와 '학교 사람이다'는 다릅니다. 학교 사람만 쓰게 하려면 <code>bmr.is_staff()</code> 나 멤버 표로 막으세요.</li>
        </ul>
        <div id="google-login" className="g-google">
          <h3>구글 로그인</h3>
          <p>관리자가 BMR APPS 전체에 <b>구글 로그인을 켜 두었습니다.</b> 개발자는 따로 설정할 것 없이 코드만 넣으면 됩니다. 새 앱 저장소의 <code>src/auth.js</code> 에 같은 도우미가 들어 있어요.</p>
          <C>{`import { supabase } from './supabase.js';

// 이 앱 자기 주소로 돌아오기 (배포·로컬 모두)
const APP_URL = new URL(import.meta.env.BASE_URL, location.origin).href;

// 로그인: 구글 화면 → https://apps.bmrschool.net/library/ 로 돌아옴
await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: APP_URL } });

// 지금 로그인한 사람 · 로그아웃
const { data: { user } } = await supabase.auth.getUser();
await supabase.auth.signOut({ scope: 'local' });   // 이 앱에서만 (그냥 signOut() 은 모든 앱·기기 로그인을 끊음)`}</C>
          <ul>
            <li><b>돌아올 수 있는 주소</b>: <code>https://apps.bmrschool.net/**</code>, <code>http://localhost:5173/**</code>, <code>http://localhost:3000/**</code>. 다른 주소가 필요하면 관리자에게 요청하세요 (허용 안 된 주소면 사이트 첫 화면으로 돌아갑니다).</li>
            <li><b>계정은 모든 앱이 함께 씁니다.</b> 로그인 사용자(<code>auth.users</code>)는 BMR APPS 전체에 하나라서, 구글 계정만 있으면 누구나 내 앱에도 로그인할 수 있어요. '로그인했다'만으로 권한을 주지 말고, <b>내 스키마의 멤버 표</b>로 이 앱 사람을 따로 관리하세요.</li>
          </ul>
          <C>{`-- 이 앱 멤버 (앱마다 내 스키마에 따로 → 다른 앱과 섞이지 않음)
create table library.members (
  user_id uuid primary key,
  role text not null default 'member' check (role in ('member', 'admin'))
);
create function library.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from library.members where user_id = (select bmr.uid()))
$$;
create policy "멤버만 읽기" on library.books for select to authenticated using ((select library.is_member()));`}</C>
          <p className="muted">정책 안에서 로그인한 사람 아이디는 <code>auth.uid()</code> 와 같은 값인 <code>bmr.uid()</code> 로 씁니다. 첫 멤버는 SQL 로 넣고(<code>insert into library.members …</code>), 카카오 등 다른 소셜 로그인은 아직 꺼져 있습니다.</p>
        </div>
        <h3>파일 저장</h3>
        <p>버킷은 비공개이고, 로그인한 사람은 <code>&lt;내 아이디&gt;/…</code> 폴더에 올릴 수 있습니다. <b>파일 경로(키)에 한글은 쓸 수 없어요</b> — 영문·숫자로 이름을 바꿔 올리세요(원래 이름은 표에 따로 저장).</p>
        <h3>배포</h3>
        <ul>
          <li><b>화면</b>: <code>main</code> 브랜치에 push 하면 GitHub Actions 가 빌드해서 1~2분 뒤 앱 주소에 반영합니다. '준비 중' 페이지(<code>index.html</code>)를 내 화면으로 바꾸면 됩니다.</li>
          <li><b>서버 함수</b>: <code>supabase/functions/&lt;주소 이름&gt;-fn/</code> 을 고쳐 올린 뒤 관리자에게 배포를 요청하세요. 관리자가 코드를 검토한 뒤 배포합니다. 함수 비밀값은 이름만 알려 주고 값은 안전하게 전달하세요.</li>
        </ul>
        <p className="muted">더 자세한 설명(로그인, 정책 예시, 함수 예제)은 저장소의 <code>README.md</code> 에 있습니다.</p>
      </Step>

      <Step n={8}>
        <ul>
          <li><b>앱 이름·설명</b>은 관리자가 허브에서 고치며, 앱 화면에는 새로고침만으로 반영됩니다. <b>주소 이름은 바꿀 수 없습니다.</b></li>
          <li><b>담당자</b>를 더하거나 빼는 것도 관리자에게 요청하세요. GitHub 아이디를 넣으면 저장소 쓰기 권한 초대가 자동으로 갑니다.</li>
          <li><b>그만 쓰기</b>: 먼저 상태를 '종료'로 바꿔 숨길 수 있습니다(되살리기 가능). 완전히 지우면 관리자가 <b>먼저 전부 백업</b>한 뒤 저장소·주소·DB·파일·함수를 지웁니다.</li>
        </ul>
      </Step>

      <Step n={9}>
        <div id="shared-origin" className="g-shared">
          <h3>🛡️ 공용 주소에서 지킬 규칙</h3>
          <p>모든 앱이 <code>apps.bmrschool.net/&lt;주소 이름&gt;/</code> 처럼 <b>한 주소</b>를 함께 씁니다. 브라우저 입장에서는 한 사이트라서, 조심하지 않으면 서로의 저장값·로그인·화면을 망가뜨릴 수 있어요.</p>
          <ol className="g-ol">
            <li><b>브라우저 저장소는 같은 서랍입니다.</b> localStorage·sessionStorage·IndexedDB·쿠키를 모든 앱이 같이 써요. 이름 앞에 꼭 <code>library:</code> 처럼 <b>내 주소 이름</b>을 붙이세요. 새 앱의 <code>src/store.js</code> 를 쓰면 자동으로 붙습니다.</li>
            <li><b><code>localStorage.clear()</code> · <code>sessionStorage.clear()</code> 는 쓰지 않기.</b> 다른 앱의 저장값과 로그인까지 다 지워집니다. 내 것만 지우는 <code>local.clear()</code> 를 쓰세요.</li>
            <li><b>경로는 상대 경로나 <code>/library/</code> 로.</b> <code>'/data.json'</code> 처럼 <code>/</code> 로 시작하면 사이트 맨 앞을 가리켜 다른 앱이나 허브로 갑니다. <code>'./data.json'</code> 이나 <code>import.meta.env.BASE_URL + 'data.json'</code> 을 쓰세요.</li>
            <li><b>서비스 워커(PWA)는 범위를 내 주소로.</b> <code>{"register('/library/sw.js', { scope: '/library/' })"}</code> — 범위가 넓으면 다른 앱의 요청까지 가로챕니다.</li>
            <li><b>외부 스크립트 조심.</b> 외부 주소에서 불러온 스크립트는 같은 주소의 <b>모든 앱</b> 저장값·로그인 정보를 읽을 수 있어요. npm 으로 설치해 함께 빌드하고, 꼭 필요하면 관리자와 상의하세요.</li>
            <li><b>로그인·로그아웃은 앱마다.</b> 로그인 저장 칸이 앱마다 따로라 허브와 내 앱은 각각 로그인합니다. 로그아웃은 <code>{"signOut({ scope: 'local' })"}</code> 로 — 그냥 <code>signOut()</code> 은 모든 앱·기기의 로그인을 끊어요.</li>
            <li><b>무료 한도는 모두가 나눠 씁니다.</b> DB 500MB · 파일 1GB · 서버 함수 호출 월 50만 번. 큰 파일·대량 데이터·잦은 자동 호출은 미리 상의해 주세요.</li>
          </ol>
          <C>{`import { local } from './store.js';   // 새 앱 시작 코드에 들어 있음
local.set('theme', 'dark');            // 실제 이름 'library:theme'
local.get('theme', 'light');
local.clear();                         // 내 앱 것만 지움`}</C>
          <p><b>자동 점검 (경고만)</b> — push 할 때마다 GitHub Actions 의 '공용 주소 점검'이 위 규칙을 살펴보고, 경고와 고치는 법을 실행 화면 Summary 와 <b>허브 → 내 서비스 → 앱 정보 → 공용 주소 점검</b>에 보여 줍니다. <b>배포는 막지 않아요.</b> 일부러 그렇게 쓴 줄은 그 줄 끝에 <code>// bmr-allow: 이유</code> 를 달면 건너뜁니다.</p>
        </div>
        <ul>
          <li><b>비밀값은 코드·저장소·채팅·캡처에 올리지 않기.</b> 브라우저 코드에는 공개 키만. <code>VITE_</code> 로 시작하는 값은 모두 공개됩니다.</li>
          <li>모든 앱이 <code>apps.bmrschool.net</code> 한 주소를 같이 씁니다. 아래 <a href="#shared-origin">공용 주소에서 지킬 규칙</a>을 꼭 지켜 주세요.</li>
          <li>무료 한도를 모든 앱이 나눠 씁니다 (DB 500MB · 파일 1GB). 큰 파일·대량 데이터는 미리 상의해 주세요.</li>
        </ul>
        <div className="g-faq">
          <details><summary>'내 서비스'에 내 앱이 안 보여요</summary><p>앱 담당자로 등록된 메일과 지금 로그인한 메일이 같아야 합니다. 다르면 관리자에게 담당자 메일 확인을 요청하세요. 개발자 승급 전이라면 승급부터!</p></details>
          <details><summary>push 했는데 화면이 그대로예요</summary><p>저장소의 Actions 탭에서 배포가 끝났는지 확인하고, 브라우저에서 새로고침하세요. <code>vite.config.js</code> 의 <code>base</code> 는 바꾸지 마세요.</p></details>
          <details><summary>DB 비밀번호를 잃어버렸어요</summary><p>대시보드 → 내 서비스 → 내 앱을 눌러 <b>앱 정보 → DB 접속 정보</b>에서 '새 비밀번호 발급'을 누르세요. 이전 비밀번호는 바로 끊깁니다.</p></details>
          <details><summary>화면에 데이터가 안 나와요</summary><p>대부분 RLS 정책이 없어서입니다. 그 표에 select 정책이 있는지 확인하세요.</p></details>
          <details><summary>React·Vue 를 써도 되나요?</summary><p>네. 시작 코드는 Vite 라서 원하는 도구를 더하면 됩니다.</p></details>
          <details><summary>Supabase 대시보드나 소셜 로그인 설정은요?</summary><p>구글 로그인은 이미 켜져 있어요(<a href="#google-login">구글 로그인</a>). 그 밖의 프로젝트 전체 설정은 관리자가 합니다. 필요하면 요청해 주세요.</p></details>
        </div>
        <p>더 궁금한 점은 관리자에게 물어보세요. 즐거운 개발 되세요! 🙌</p>
      </Step>
    </article>
  );
}

/** /guide/quick — 빠른 시작: 꼭 필요한 단계만 */
const QUICK: { t: string; tone: string; body: ReactNode }[] = [
  { t: '가입', tone: 'cyan', body: <><Link to="/hub/login">로그인 화면</Link> → <b>처음이면 가입하기</b>. 앱 담당자로 쓸 메일(학교 메일)로 가입하세요.</> },
  { t: '개발자 승급 요청', tone: 'yellow', body: <>관리자에게 가입한 메일과 함께 "개발자로 올려 주세요"라고 요청합니다. 승급되면 <b>앱 신청</b> 메뉴가 열려요.</> },
  { t: '앱 신청', tone: 'green', body: <>허브 → <b>앱 신청</b> → <b>새 앱 신청하기</b>. 앱 이름, <b>주소 이름</b>(영문 소문자·숫자·하이픈, <b>나중에 못 바꿈</b>), GitHub 아이디, 목적, 다루는 데이터, 학생 개인정보 여부를 적습니다.</> },
  { t: '승인 후: 초대 수락 · 개발 정보 · DB 비밀번호', tone: 'coral', body: <>
    <ul>
      <li>GitHub 메일(또는 github.com 알림)의 <b>저장소 초대를 수락</b>해야 push 할 수 있어요.</li>
      <li>허브 <b>대시보드 → 내 서비스</b> → 내 앱을 누르면 <b>🛠️ 개발 정보</b>(주소·키·스키마·예제 코드)가 보입니다.</li>
      <li>같은 창의 <b>DB 접속 정보</b>에서 <b>처음 비밀번호 받기</b> — <b>딱 한 번</b> 보이니 바로 <code>.env.local</code> 에 저장하세요. (표를 직접 만들 때 필요, 잊으면 새로 발급)</li>
    </ul></> },
  { t: 'clone → 고치기 → push = 배포', tone: 'purple', body: <>
    <C>{`git clone https://github.com/bmr-apps/<주소 이름>.git
cd <주소 이름>
npm install
cp .env.example .env.local     # DATABASE_URL 의 비밀번호 칸만 채우기
npm run dev                    # 내 컴퓨터에서 확인
git add -A && git commit -m "첫 화면" && git push   # 1~2분 뒤 apps.bmrschool.net/<주소 이름>/ 에 반영`}</C>
    <p className="muted">처음에는 '준비 중' 안내가 보이는 <code>index.html</code> 을 내 화면으로 바꾸면 됩니다.</p></> },
];

export function QuickStartPage({ ctx }: { ctx: Ctx }) {
  const staff = ctx.me?.role === 'staff' || ctx.me?.role === 'admin';
  return (
    <article className="guide quick">
      <header className="g-hero q-hero">
        <div className="g-hero-copy">
          <Link to="/guide" className="eyebrow">시작 가이드 · 빠른 시작</Link>
          <h1>⚡ 빠른 시작</h1>
          <p>가입부터 첫 배포까지 꼭 필요한 것만. 자세한 설명은 <Link to="/guide">전체 시작 가이드</Link>에 있어요.</p>
          <div className="hero-cta">
            {!ctx.session ? <Link to="/hub/login" className="btn alt">가입하기</Link> : <Link to={staff ? '/hub/requests' : '/hub/apps'} className="btn alt">{staff ? '앱 신청하러 가기' : '관리 허브로'}</Link>}
            <Link to="/guide" className="btn">전체 가이드</Link>
          </div>
        </div>
      </header>
      <ol className="q-steps">
        {QUICK.map((q, i) => (
          <li key={q.t} className="g-step">
            <div className={`g-num g-${q.tone}`} aria-hidden="true">{i + 1}</div>
            <div className="g-body"><h2>{q.t}</h2>{typeof q.body === 'string' ? <p>{q.body}</p> : <div className="q-body">{q.body}</div>}</div>
          </li>))}
      </ol>
      <section className="g-step q-code">
        <div className="g-num g-yellow" aria-hidden="true">{'{ }'}</div>
        <div className="g-body">
          <h2>JSON 문서 하나 저장해 보기</h2>
          <p>앱마다 <code>documents</code> 표가 준비되어 있어 표를 만들지 않고 바로 저장할 수 있어요. 쓰기는 BMR APPS 계정으로 <b>로그인한 사람</b>만, 읽기는 누구나 (기본 정책).</p>
          <C>{`import { supabase } from './supabase.js';   // 시작 코드에 들어 있음

await supabase.from('documents')
  .insert({ collection: 'notice', data: { title: '첫 공지', body: '안녕하세요' } });

const { data } = await supabase.from('documents')
  .select('id, data, created_at').eq('collection', 'notice');`}</C>
          <p className="muted">로그인이 필요하면 <b>구글 로그인</b>이 이미 켜져 있어요: <code>{"supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 내 앱 주소 } })"}</code> · <Link to="/guide#google-login">자세히</Link></p>
        </div>
      </section>
      <div className="q-foot">
        <p><b>지킬 것 두 가지</b> · 비밀번호·키는 저장소·채팅·캡처에 올리지 않기 (저장소는 공개) · 학생 개인정보는 관리자와 상의한 방법으로만.</p>
        <Link to="/guide" className="btn">전체 시작 가이드 읽기 →</Link>
      </div>
    </article>
  );
}
