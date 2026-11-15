import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { go } from '../App';
import { sb } from '../sb';
import {
  disablePush, enablePush, isIOS, isStandalone, notificationPermission, notifyState, pushSupported,
  savePrefs, sendTestPush, syncSubscription, type NotifyState,
} from '../notify';

export type NotiItem = { id: number; kind: string; title: string; body: string; url: string; created_at: string; read_at: string | null };

const KIND_ICON: Record<string, string> = { app_request: '📝', dev_request: '🛠️', member: '👥', health: '📡' };
const bump = () => dispatchEvent(new Event('bmr-notify-updated'));
const when = (iso: string) => {
  const t = new Date(iso).getTime();
  const mins = Math.round((Date.now() - t) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  if (mins < 1440) return `${Math.round(mins / 60)}시간 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });
};

/** 알림함 (알림 표를 읽는다 — RLS 로 내 것만 온다). 새 알림은 실시간 + 60초마다 한 번 더 확인 */
export function useInbox(session: Session | null, limit = 20) {
  const [items, setItems] = useState<NotiItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    if (!session) { setItems(null); setUnread(0); return; }
    const [list, count] = await Promise.all([
      sb.from('notification_log').select('id, kind, title, body, url, created_at, read_at')
        .order('created_at', { ascending: false }).limit(limit),
      sb.from('notification_log').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]);
    if (list.error) {
      setErr(/does not exist|schema cache/i.test(list.error.message) ? '알림 기능이 아직 준비되지 않았습니다(마이그레이션). 관리자에게 알려 주세요.' : '알림을 불러오지 못했습니다.');
      setItems([]);
      setUnread(0);
      return;
    }
    setErr('');
    setItems((list.data ?? []) as NotiItem[]);
    setUnread(Number(count.count ?? 0));
  }, [session, limit]);

  useEffect(() => {
    if (!session) { setItems(null); setUnread(0); return; }
    let live = true;
    const run = () => { if (live) load(); };
    run();
    const i = setInterval(run, 60000);
    addEventListener('bmr-notify-updated', run);
    const ch = sb.channel('bmr-notify-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_log' }, run)
      .subscribe();
    return () => { live = false; clearInterval(i); removeEventListener('bmr-notify-updated', run); sb.removeChannel(ch); };
  }, [session, load]);

  const markRead = useCallback(async (id: number) => {
    await sb.from('notification_log').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null);
    bump();
  }, []);
  const markAll = useCallback(async () => {
    await sb.from('notification_log').update({ read_at: new Date().toISOString() }).is('read_at', null);
    bump();
  }, []);

  return { items, unread, err, reload: load, markRead, markAll };
}

/** 머리글의 🔔 — 최근 알림 몇 줄과 알림 설정으로 가는 길 */
export function NotificationBell({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const { items, unread, err, markRead, markAll } = useInbox(session, 20);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('mousedown', away);
    addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); };
  }, [open]);

  const pick = async (n: NotiItem) => {
    setOpen(false);
    if (!n.read_at) await markRead(n.id);
    go(n.url || '/hub/requests');
  };

  return (
    <div className="bell-wrap" ref={box}>
      <button type="button" className="icon-btn bell-btn" onClick={() => setOpen((x) => !x)}
        aria-label={`알림${unread ? ` · 안 읽은 알림 ${unread}개` : ''}`} aria-expanded={open} title="알림">
        🔔{unread > 0 && <span className="icon-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="알림">
          <div className="bell-head">
            <b>🔔 알림</b>
            {unread > 0 && <button type="button" className="ghost small" onClick={() => { void markAll(); }}>모두 읽음</button>}
          </div>
          {err && <p className="error pad" role="alert">{err}</p>}
          {!items && !err && <p className="muted pad">불러오는 중…</p>}
          {items && !items.length && !err && (
            <div className="bell-empty">
              <p><b>새 알림이 없습니다</b></p>
              <p className="muted small">쪽지를 받거나 신청이 결정되면 여기에 쌓입니다.</p>
            </div>)}
          <ul className="bell-list">
            {(items ?? []).map((n) => (
              <li key={n.id}>
                <button type="button" className={`bell-item${n.read_at ? '' : ' unread'}`} onClick={() => { void pick(n); }}>
                  <span className="emo" aria-hidden="true">{KIND_ICON[n.kind] ?? '🔔'}</span>
                  <span className="grow">
                    <b>{n.title}</b>
                    {n.body && <small className="block">{n.body}</small>}
                    <small className="muted">{when(n.created_at)}</small>
                  </span>
                </button>
              </li>))}
          </ul>
          <div className="bell-foot">
            <button type="button" className="ghost small" onClick={() => { setOpen(false); go('/hub/account'); }}>🔔 알림 설정</button>
          </div>
        </div>)}
    </div>
  );
}

function Toggle({ on, onClick, label, hint, busy }: { on: boolean; onClick: () => void; label: string; hint?: string; busy?: boolean }) {
  return (
    <div className="toggle-row">
      <div className="grow">
        <b>{label}</b>
        {hint && <small className="block muted">{hint}</small>}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy}
        className={`toggle${on ? ' on' : ''}`} onClick={onClick}>{busy ? '…' : on ? '켜짐' : '꺼짐'}</button>
    </div>
  );
}

/** /hub/account 의 🔔 알림 설정 — 켜고 끄기, 기기 목록, 시험 발송, 기기별 안내 */
export function NotifySettings({ session }: { session: Session }) {
  const [st, setSt] = useState<NotifyState | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [perm, setPerm] = useState(notificationPermission());
  const supported = pushSupported();

  const load = useCallback(async () => {
    try {
      const s = await notifyState(session);
      setSt(s);
      syncSubscription(session);   // 구독이 살아 있는데 서버 표가 비었으면 다시 넣는다
    } catch (e) { setErr((e as Error).message); }
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr(''); setMsg('');
    try { await fn(); bump(); await load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(''); setPerm(notificationPermission()); }
  };

  const onPush = () => run('push', async () => {
    if (!st) return;
    if (st.prefs.push_enabled && perm === 'granted') { await disablePush(session); setMsg('이 브라우저의 푸시 알림을 껐습니다. 다른 기기는 그대로입니다.'); }
    else { await enablePush(session); setMsg('이 브라우저에 알림을 켰습니다. 아래 “시험 알림”으로 확인해 보세요.'); }
  });
  const flip = (k: keyof NotifyState['prefs']) => run(k, async () => {
    if (!st) return;
    await savePrefs(session, { [k]: !st.prefs[k] });
    setMsg('알림 설정을 저장했습니다.');
  });
  const test = () => run('test', async () => {
    const r = await sendTestPush(session);
    if (r.ok) setMsg(`시험 알림을 ${r.sent}대에 보냈습니다. 10초 안에 보이지 않으면 브라우저 알림 권한과 홈 화면 추가 상태를 확인해 주세요.`);
    else setErr(r.hint || '시험 알림을 보내지 못했습니다.');
  });

  const p = st?.prefs;
  return (
    <div className="card" id="알림">
      <div className="section-head"><h3>🔔 알림</h3>{st && <span className="muted small">기기 {st.devices.length}대</span>}</div>
      <p className="muted">쪽지와 신청 결과를 앱을 닫아 둬도 알려 드립니다. 알림은 이 기기의 브라우저에만 켜지고, 기기마다 따로 켜고 끕니다.</p>
      {!supported && <p className="warn">이 브라우저는 웹 푸시를 지원하지 않습니다. 크롬·엣지·사파리(16.4 이상)에서 켜 주세요.</p>}
      {supported && isIOS() && !isStandalone() && (
        <p className="warn">📱 아이폰은 <b>홈 화면에 추가</b>한 뒤에 알림을 켤 수 있습니다. 사파리에서 공유 → “홈 화면에 추가” 후 그 아이콘으로 열어 주세요.</p>)}
      {st && !st.push_ready && <p className="warn">푸시 발송 준비가 아직 안 됐습니다(서버). 관리자에게 알려 주세요.</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {msg && <p className="ok" role="status">{msg}</p>}
      {!st && !err && <p className="muted">불러오는 중…</p>}
      {st && p && (
        <>
          <div className="toggles">
            <Toggle on={p.push_enabled && perm === 'granted'} busy={busy === 'push'} onClick={() => { void onPush(); }}
              label={`이 브라우저 알림 (${perm === 'granted' ? '허용됨' : perm === 'denied' ? '차단됨' : '아직 허용 안 함'})`}
              hint={perm === 'denied' ? '브라우저가 이 사이트 알림을 차단했습니다. 주소창 옆 자물쇠 → 알림 → 허용으로 바꿔 주세요.' : '켜면 이 기기에서 알림이 옵니다. 끄면 이 기기만 조용해집니다.'} />
            <Toggle on={p.notify_chat} busy={busy === 'notify_chat'} onClick={() => { void flip('notify_chat'); }}
              label="새 쪽지 알림" hint="가입 회원끼리 주고받는 1:1 쪽지를 알립니다." />
            <Toggle on={p.notify_admin} busy={busy === 'notify_admin'} onClick={() => { void flip('notify_admin'); }}
              label="신청·승인 알림" hint="앱 신청 승인·반려, 개발자 승인, 이용 중지 같은 소식을 알립니다." />
            <Toggle on={p.email_enabled} busy={busy === 'email_enabled'} onClick={() => { void flip('email_enabled'); }}
              label="메일로도 받기 (푸시가 닿지 않을 때)" hint="푸시가 한 대도 닿지 않았을 때만 학교 메일로 보냅니다. 같은 대화는 10분에 한 통까지입니다." />
          </div>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <button type="button" className="ghost small" disabled={!p.push_enabled || busy === 'test'} onClick={() => { void test(); }}>{busy === 'test' ? '보내는 중…' : '🔔 시험 알림 보내기'}</button>
            <span className="muted small">알림이 오지 않으면 ① 브라우저 알림 권한 ② 아이폰은 홈 화면 추가 ③ 방해 금지 모드를 확인하세요.</span>
          </div>
          <h4>알림이 켜진 기기</h4>
          {!st.devices.length ? <p className="muted small">아직 없습니다. 위에서 “이 브라우저 알림”을 켜면 이 기기가 목록에 생깁니다.</p> : (
            <ul className="device-list">
              {st.devices.map((d) => (
                <li key={d.id}>
                  <span className="emo" aria-hidden="true">📱</span>
                  <span className="grow"><b>{d.label}</b><small className="block muted">{d.service} · {when(d.created_at)} 등록</small></span>
                </li>))}
            </ul>)}
          <p className="muted small">기기는 최대 {st.limits.max_devices}대까지 기억합니다(오래된 것부터 지웁니다). 다른 기기 알림은 그 기기에서 직접 꺼 주세요.</p>
        </>
      )}
    </div>
  );
}

/** 쪽지 화면 머리의 작은 🔔 — 새 쪽지 알림만 바로 켜고 끈다 */
export function NotifyQuickToggle({ session }: { session: Session }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    notifyState(session).then((s) => { if (live) setOn(s.prefs.notify_chat); }).catch(() => { if (live) setOn(null); });
    return () => { live = false; };
  }, [session]);
  if (on === null) return null;
  const flip = async () => {
    setBusy(true);
    try { const next = !on; await savePrefs(session, { notify_chat: next }); setOn(next); bump(); } catch { /* 화면은 그대로 */ }
    finally { setBusy(false); }
  };
  return (
    <button type="button" className={`ghost small${on ? ' on' : ''}`} disabled={busy} onClick={() => { void flip(); }}
      aria-pressed={on} title="새 쪽지 알림 켜기/끄기">{on ? '🔔 알림 켜짐' : '🔕 알림 꺼짐'}</button>
  );
}
