import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Ctx } from '../App';
import {
  ROLE_LABEL, chatMarkRead, chatMessages, chatPeople, chatSend, chatStart, chatThreads, fmtTime, sb,
  type ChatMessage, type ChatPerson, type ChatThread,
} from '../sb';
import { Modal } from '../ui';

/** 머리글·사이드바 배지에 쓰는 '안 읽은 대화' 수. 준비 전(마이그레이션 X)이거나 로그아웃이면 조용히 0 */
export function useChatUnread(session: Session | null) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!session) { setN(0); return; }
    let live = true;
    const load = async () => {
      try { const t = await chatThreads(); if (live) setN(t.filter((x) => Number(x.unread) > 0).length); } catch { /* 준비 전이면 그냥 0 */ }
    };
    load();
    const i = setInterval(load, 60000);
    const f = () => load();
    addEventListener('bmr-chat-updated', f);
    return () => { live = false; clearInterval(i); removeEventListener('bmr-chat-updated', f); };
  }, [session]);
  return n;
}

const initial = (s: string) => (s || '?').trim().slice(0, 1) || '?';
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });

/** 새 대화 상대 고르기 — 이름·역할만 보여 준다 (메일 주소는 서버가 돌려주지 않는다) */
function PeoplePicker({ onPick, onClose, busyPeer }: { onPick: (p: ChatPerson) => void; onClose: () => void; busyPeer: string }) {
  const [people, setPeople] = useState<ChatPerson[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    chatPeople().then((p) => { if (live) setPeople(p); }).catch((e) => { if (live) { setErr((e as Error).message); setPeople([]); } });
    return () => { live = false; };
  }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = people ?? [];
    return s ? list.filter((p) => `${p.label} ${p.name} ${ROLE_LABEL[p.role] ?? ''}`.toLowerCase().includes(s)) : list;
  }, [people, q]);
  return (
    <Modal onClose={onClose}>
      <h2>새 대화</h2>
      <p className="muted">이야기할 회원을 고르세요. 대화는 두 사람만 볼 수 있고, 관리자도 내용을 볼 수 없습니다.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름으로 찾기" aria-label="이름으로 찾기" autoComplete="off" />
      {err && <p className="error" role="alert">{err}</p>}
      {!people && !err && <p className="muted">불러오는 중…</p>}
      {people && !shown.length && !err && <p className="muted">찾는 회원이 없습니다.</p>}
      <ul className="chat-people">
        {shown.map((p) => (
          <li key={p.id}>
            <span className="avatar" aria-hidden="true">{initial(p.label)}</span>
            <span className="grow"><b>{p.label}</b>{p.name && p.name !== p.label && <small> · {p.name}</small>}
              <span className={`badge role-${p.role}`}>{ROLE_LABEL[p.role] ?? p.role}</span></span>
            <button type="button" className="small" disabled={busyPeer === p.id} onClick={() => onPick(p)}>
              {busyPeer === p.id ? '여는 중…' : '대화'}
            </button>
          </li>))}
      </ul>
    </Modal>
  );
}

export function ChatPage({ ctx }: { ctx: Ctx }) {
  const me = ctx.me;
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [msgErr, setMsgErr] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [pick, setPick] = useState(false);
  const [busyPeer, setBusyPeer] = useState('');
  const [q, setQ] = useState('');
  const openRef = useRef<number | null>(null);
  openRef.current = openId;
  const endRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try { setThreads(await chatThreads()); setErr(''); } catch (e) { setErr((e as Error).message); setThreads([]); }
  }, []);
  const loadMsgs = useCallback(async (thread: number) => {
    try {
      const list = await chatMessages(thread);
      if (openRef.current !== thread) return;   // 그 사이 다른 대화를 열었으면 버린다
      setMsgs(list);
      setMsgErr('');
      const last = list.length ? list[list.length - 1].id : 0;
      if (last) { chatMarkRead(thread, last).then(() => dispatchEvent(new Event('bmr-chat-updated'))).catch(() => {}); }
    } catch (e) {
      if (openRef.current === thread) { setMsgErr((e as Error).message); setMsgs([]); }
    }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // 열린 대화가 바뀌면 그 대화 메시지를 읽는다
  useEffect(() => {
    if (openId === null) { setMsgs(null); return; }
    setMsgs(null);
    loadMsgs(openId);
  }, [openId, loadMsgs]);

  // 실시간: 새 쪽지가 오면 목록·열린 대화를 다시 읽는다 (신호로만 쓰고 본문은 REST 로 — RLS 가 그대로 적용된다)
  useEffect(() => {
    const ch = sb.channel('bmr-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => {
        loadThreads();
        if (openRef.current !== null) loadMsgs(openRef.current);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads' }, () => loadThreads())
      .subscribe();
    // 실시간이 막혀 있어도(준비 전·네트워크) 새로고침 없이 보이게 20초마다 한 번 더 확인
    const i = setInterval(() => {
      loadThreads();
      if (openRef.current !== null) loadMsgs(openRef.current);
    }, 20000);
    return () => { clearInterval(i); sb.removeChannel(ch); };
  }, [loadThreads, loadMsgs]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  const openPeer = async (p: ChatPerson) => {
    setBusyPeer(p.id);
    try {
      const id = await chatStart(p.id);
      setPick(false);
      setOpenId(id);
      await loadThreads();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusyPeer(''); }
  };

  const send = async () => {
    const text = body.trim();
    if (!text || openId === null || sending) return;
    setSending(true); setMsgErr('');
    try {
      await chatSend(openId, text);
      setBody('');
      await Promise.all([loadMsgs(openId), loadThreads()]);
      dispatchEvent(new Event('bmr-chat-updated'));
    } catch (e) { setMsgErr((e as Error).message); }
    finally { setSending(false); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  const shownThreads = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = threads ?? [];
    return s ? list.filter((t) => `${t.peer_label} ${t.peer_name}`.toLowerCase().includes(s)) : list;
  }, [threads, q]);
  const open = threads?.find((t) => t.thread_id === openId) ?? null;
  const myName = me?.name || (me?.email ?? '').split('@')[0];

  return (
    <section className="chat-page">
      <div className="section-head">
        <h2>💬 회원 쪽지</h2>
        <button type="button" onClick={() => setPick(true)}>✏️ 새 대화</button>
      </div>
      <p className="muted chat-note">BMR APPS 에 가입한 회원끼리 1:1로 이야기합니다. 대화는 두 사람만 볼 수 있고, 관리자도 내용을 볼 수 없습니다.</p>
      {err && <div className="card warn">{err}</div>}
      <div className={`chat-wrap${openId !== null ? ' has-open' : ''}`}>
        <aside className="chat-list" aria-label="대화 목록">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="대화 찾기" aria-label="대화 찾기" autoComplete="off" />
          {threads === null && !err && <p className="muted pad">불러오는 중…</p>}
          {threads && !shownThreads.length && !err && (
            <div className="chat-empty">
              <p><b>아직 대화가 없습니다.</b></p>
              <p className="muted">✏️ 새 대화로 회원을 골라 첫 쪽지를 보내 보세요.</p>
            </div>)}
          <ul>
            {shownThreads.map((t) => (
              <li key={t.thread_id}>
                <button type="button" className={`chat-item${t.thread_id === openId ? ' on' : ''}`} onClick={() => setOpenId(t.thread_id)}>
                  <span className="avatar" aria-hidden="true">{initial(t.peer_label)}</span>
                  <span className="chat-item-t">
                    <span className="chat-item-top">
                      <b>{t.peer_label}</b>
                      <span className={`badge role-${t.peer_role}`}>{ROLE_LABEL[t.peer_role] ?? t.peer_role}</span>
                      {t.unread > 0 && <span className="count c-amber" aria-label={`안 읽은 쪽지 ${t.unread}개`}>{t.unread}</span>}
                    </span>
                    <small>{t.last_from === me?.id ? '나: ' : ''}{t.last_body || '아직 쪽지가 없습니다'}</small>
                  </span>
                </button>
              </li>))}
          </ul>
        </aside>

        <div className={`chat-room${open ? ' open' : ''}`} aria-label="대화">
          {!open && (
            <div className="chat-placeholder">
              <div className="logo big">💬</div>
              <h3>대화를 골라 주세요</h3>
              <p className="muted">왼쪽 목록에서 대화를 고르거나 <b>✏️ 새 대화</b>로 회원을 찾아보세요.</p>
            </div>)}
          {open && (
            <>
              <header className="chat-room-head">
                <button type="button" className="icon-btn chat-back" aria-label="대화 목록으로" onClick={() => setOpenId(null)}>←</button>
                <span className="avatar" aria-hidden="true">{initial(open.peer_label)}</span>
                <div className="grow">
                  <b>{open.peer_label}</b>
                  <span className={`badge role-${open.peer_role}`}>{ROLE_LABEL[open.peer_role] ?? open.peer_role}</span>
                  <small className="block muted">{fmtTime(open.last_at)}</small>
                </div>
              </header>
              <div className="chat-scroll">
                {msgs === null && !msgErr && <p className="muted pad">불러오는 중…</p>}
                {msgErr && <div className="card warn">{msgErr}</div>}
                {msgs && !msgs.length && <p className="muted pad">첫 쪽지를 보내 보세요.</p>}
                {(() => {
                  let day = '';
                  return (msgs ?? []).map((m) => {
                    const mine = m.sender === me?.id;
                    const d = dayLabel(m.created_at);
                    const head = d !== day ? (day = d) : '';
                    return (
                      <div key={m.id}>
                        {head && <div className="chat-day"><span>{head}</span></div>}
                        <div className={`chat-msg${mine ? ' mine' : ''}`}>
                          {!mine && <span className="avatar sm" aria-hidden="true">{initial(open.peer_label)}</span>}
                          <div className="chat-bubble">
                            <p>{m.body}</p>
                            <small>{timeLabel(m.created_at)}</small>
                          </div>
                        </div>
                      </div>);
                  });
                })()}
                <div ref={endRef} />
              </div>
              <div className="chat-compose">
                <textarea value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey}
                  placeholder={`${open.peer_label}에게 보낼 쪽지 (Enter 로 보내기, Shift+Enter 줄바꿈)`} aria-label="쪽지 내용" maxLength={2000} rows={2} />
                <button type="button" onClick={send} disabled={sending || !body.trim()}>{sending ? '보내는 중…' : '보내기'}</button>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="muted small">쪽지는 최대 2,000자입니다. 학생 개인정보·비밀번호·키는 쪽지로 주고받지 마세요. 나: {myName}</p>
      {pick && <PeoplePicker onPick={openPeer} onClose={() => setPick(false)} busyPeer={busyPeer} />}
    </section>
  );
}
