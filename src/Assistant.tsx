import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { askAssistant, type AssistantMsg } from './sb';

/** 자료에 없는 것을 지어내지 않게, 화면에서도 무엇을 물을 수 있는지 먼저 보여 준다 */
const SUGGEST = [
  'BMR APPS 는 뭐예요?',
  '앱은 어떻게 신청해요?',
  '메일 보내는 방법 알려 줘',
  '내 앱이 목록에 안 보여요',
  '회원 쪽지는 어디서 써요?',
];

const GREETING = '안녕하세요, BMR APPS 도우미예요. BMR APPS 사용법·앱·개발 방법을 안내합니다. 로그인하면 역할에 맞는 안내(개발자: 내 담당 앱, 관리자: 운영 집계)까지 해 드려요.';

/** 다른 화면(명령 팔레트 등)에서 도우미를 열 때 쓰는 이름 */
export const OPEN_ASSISTANT = 'bmr-assistant-open';
export function openAssistant() { dispatchEvent(new Event(OPEN_ASSISTANT)); }

/** 어디서나 뜨는 BMR 도우미 — 손님(로그인 전)도 공개 안내를 물어볼 수 있다 */
export function Assistant({ session, page }: { session: Session | null; page?: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<AssistantMsg[]>([]);
  const [roleLabel, setRoleLabel] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState('');
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const f = () => setOpen(true);
    addEventListener(OPEN_ASSISTANT, f);
    return () => removeEventListener(OPEN_ASSISTANT, f);
  }, []);
  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', f);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => { removeEventListener('keydown', f); clearTimeout(t); };
  }, [open]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [msgs, open, busy]);

  // 로그아웃하면 역할 안내가 남지 않게 대화를 접는다 (질문·답은 저장하지 않는다)
  useEffect(() => { if (!session) { setMsgs([]); setRoleLabel(''); } }, [session]);

  const ask = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    const next: AssistantMsg[] = [...msgs, { role: 'user', content: t }];
    setBusy(true); setErr(''); setPending(t);
    try {
      const a = await askAssistant(session, next);
      setMsgs([...next, { role: 'assistant', content: a.text }]);
      setRoleLabel(a.role_label ?? '');
      setQ('');
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); setPending(''); }
  }, [msgs, session, busy]);

  const onSubmit = () => { if (!busy) ask(q); };

  return (
    <>
      <button type="button" className={`assist-fab${open ? ' on' : ''}`} aria-expanded={open} aria-controls="bmr-assistant"
        onClick={() => setOpen((x) => !x)} title="BMR 도우미에게 묻기">
        <span aria-hidden="true">{open ? '✕' : '✨'}</span><b>도우미</b>
      </button>
      {open && (
        <section id="bmr-assistant" className="assist" role="dialog" aria-label="BMR APPS 도우미">
          <header className="assist-head">
            <span className="assist-ico" aria-hidden="true">✨</span>
            <div className="grow">
              <b>BMR APPS 도우미</b>
              <small>{roleLabel ? `${roleLabel} 권한으로 안내합니다` : session ? '로그인한 역할에 맞춰 안내합니다' : '로그인 전에는 공개 안내만 해 드려요'}</small>
            </div>
            <button type="button" className="icon-btn" aria-label="닫기" onClick={() => setOpen(false)}>✕</button>
          </header>

          <div className="assist-body" ref={scrollRef}>
            <div className="chat-msg"><div className="chat-bubble"><p>{GREETING}</p></div></div>
            {msgs.map((m, i) => (
              <div key={i} className={`chat-msg${m.role === 'user' ? ' mine' : ''}`}>
                <div className="chat-bubble"><p>{m.content}</p></div>
              </div>))}
            {busy && pending && <div className="chat-msg mine"><div className="chat-bubble"><p>{pending}</p></div></div>}
            {busy && <div className="chat-msg"><div className="chat-bubble typing" aria-label="답을 만드는 중"><span /><span /><span /></div></div>}
            {err && <div className="card warn assist-err">{err}</div>}
            {!msgs.length && !busy && !err && (
              <div className="assist-suggest">
                <b>이런 걸 물어보세요</b>
                {SUGGEST.map((s) => <button key={s} type="button" className="ghost small" onClick={() => ask(s)}>{s}</button>)}
              </div>)}
            <div ref={endRef} />
          </div>

          <div className="assist-in">
            <textarea ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} rows={2} maxLength={2000}
              placeholder={page ? `궁금한 것을 물어보세요 (지금 화면: ${page})` : '궁금한 것을 물어보세요'}
              aria-label="도우미에게 물어보기"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit(); } }} />
            <button type="button" onClick={onSubmit} disabled={busy || !q.trim()}>{busy ? '생각 중…' : '묻기'}</button>
          </div>
          <div className="assist-foot">
            <span>AI 가 답합니다. 틀릴 수 있어요.</span>
            <span>개인정보·비밀번호는 넣지 마세요.</span>
            {msgs.length > 0 && <button type="button" className="link" onClick={() => { setMsgs([]); setErr(''); }}>새 대화</button>}
          </div>
        </section>
      )}
    </>
  );
}
