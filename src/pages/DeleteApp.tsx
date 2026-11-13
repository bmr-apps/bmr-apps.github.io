import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { backupLink, deprovisionApi, fmtBytes, DEL_STEP_LABEL, type App, type AppDeletion, type DelInfo } from '../sb';
import { Modal } from '../ui';

/** 삭제 단계 표시 (만들기와 같은 모양) */
export function DelSteps({ d, running }: { d: AppDeletion; running: boolean }) {
  const st = d.steps || {};
  const failed = d.status === 'failed' ? String(st.failed_step ?? '') : '';
  const firstTodo = DEL_STEP_LABEL.find(([k]) => st[k] !== 'done')?.[0];
  return (
    <ul className="steps">{DEL_STEP_LABEL.map(([k, label]) => {
      const cls = st[k] === 'done' ? 'done' : k === failed ? 'failed' : running && k === firstTodo ? 'now' : '';
      const note = st[`${k}_note`] ? String(st[`${k}_note`]) : '';
      return <li key={k} className={cls} title={note}>{cls === 'done' ? '✓' : cls === 'failed' ? '✗' : cls === 'now' ? '⏳' : '·'} {label}</li>;
    })}</ul>
  );
}

/** 백업 파일 목록 + 내려받기 (관리자만: 백업 버킷은 관리자만 읽을 수 있음) */
export function BackupFiles({ d }: { d: AppDeletion }) {
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  if (!d.backup_prefix || !d.backup_files?.length) return null;
  const files = [...d.backup_files].sort((a, b) => a.path.localeCompare(b.path));
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  const dl = async (p: string) => { setErr(''); try { location.href = await backupLink(`${d.backup_prefix}/${p}`); } catch (e) { setErr((e as Error).message); } };
  const main = files.filter((f) => !f.path.startsWith('bucket/') || f.path === 'bucket/_list.json');
  const shown = open ? files : main;
  return (
    <div className="backup">
      <b>💾 백업</b> <code>hub-backups/{d.backup_prefix}</code> · 파일 {files.length}개 · {fmtBytes(total)}
      <ul>{shown.map((f) => <li key={f.path}><button className="link" onClick={() => dl(f.path)}>{f.path}</button> <span className="muted">{fmtBytes(f.size)}</span></li>)}</ul>
      {files.length > main.length && <button className="ghost small" onClick={() => setOpen(!open)}>{open ? '버킷 파일 접기' : `버킷 파일 ${files.length - main.length}개 모두 보기`}</button>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

const Row = ({ on, children }: { on: boolean; children: React.ReactNode }) => <li className={on ? '' : 'muted'}>{on ? '🗑️' : '—'} {children}</li>;

/** 앱 삭제: 무엇이 지워지는지 보여 주고, 주소 이름을 그대로 입력해야 시작. 먼저 백업하고, 백업이 실패하면 아무것도 지우지 않음 */
export function DeleteAppModal({ app, ctx, onClose, onDone, onSoftDelete }: { app: App; ctx: Ctx; onClose: () => void; onDone: () => void; onSoftDelete: () => void }) {
  const [info, setInfo] = useState<DelInfo | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(''); const [note, setNote] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [d, setD] = useState<AppDeletion | null>(null);
  useEffect(() => {
    if (!ctx.session) return;
    deprovisionApi<{ info: DelInfo; active_deletion: number | null }>(ctx.session, 'preview', { app_id: app.id })
      .then((r) => { setInfo(r.info); setActive(r.active_deletion); }).catch((e) => setErr((e as Error).message));
  }, [app.id]);
  const drive = async (first: 'start' | 'run', id?: number) => {
    if (!ctx.session) return;
    setErr(''); setBusy(true);
    try {
      let r = await deprovisionApi<{ more: boolean; deletion: AppDeletion }>(ctx.session, first, first === 'start' ? { app_id: app.id, confirm_slug: confirm, note } : { deletion_id: id });
      setD(r.deletion);
      for (let i = 0; r.more && i < 15; i++) { r = await deprovisionApi(ctx.session, 'run', { deletion_id: r.deletion.id }); setD(r.deletion); }
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const i = info;
  const done = d?.status === 'done';
  return (
    <Modal onClose={() => { if (!busy) { if (d) onDone(); else onClose(); } }} wide>
      <h2>🗑️ 앱 삭제 · {app.name} <code>/{app.slug}</code></h2>
      {!d && <>
        <p className="alert">먼저 전부 <b>백업</b>(비공개 버킷 hub-backups, 관리자만 내려받기)한 뒤 지웁니다. 백업이 하나라도 실패하면 <b>아무것도 지우지 않아요</b>. 지운 뒤에는 앱 주소가 열리지 않습니다.</p>
        {!i ? <p className="muted">{err ? '' : '지울 것을 확인하는 중…'}</p> : (
          <ul className="del-list">
            <Row on={i.repo === 'ours'}>GitHub 저장소 <code>bmr-apps/{app.slug}</code>와 Pages 사이트 {i.repo === 'foreign' ? '(BMR APPS 표시가 없어 그대로 둠)' : i.repo === 'none' ? '(없음)' : '(zip 으로 백업)'}</Row>
            <Row on={i.appOurs && i.fn}>서버 함수 <code>{app.slug}-fn</code> {i.fn ? '' : '(없음)'}</Row>
            <Row on={i.appOurs && i.secrets.length > 0}>함수 비밀값 {i.secrets.length ? i.secrets.map((s) => <code key={s}>{s}</code>) : '(없음)'}</Row>
            <Row on={i.appOurs && i.bucket}>파일 버킷 <code>{app.slug}</code> {i.bucket ? `(파일 ${i.bucketFiles}개 · ${fmtBytes(i.bucketBytes)})` : '(없음)'}</Row>
            <Row on={i.schemaOurs}>DB 스키마 <code>{i.schema}</code>와 모든 데이터 {i.schemaExists ? (i.schemaOurs ? `(표 ${i.tables}개 · ${fmtBytes(i.dbBytes)})` : '(BMR APPS 표시가 없어 그대로 둠)') : '(없음)'}</Row>
            <Row on={i.devOurs || i.fnRoleOurs}>DB 계정 <code>{i.schema}_dev</code>, <code>{i.schema}_fn</code> {i.devOurs || i.fnRoleOurs ? '' : '(없음)'}</Row>
            <Row on={i.vault}>아직 받지 않은 DB 비밀번호 (Vault)</Row>
            <Row on={i.schemaOurs && i.exposed}>Data API 노출 목록의 <code>{i.schema}</code></Row>
            <Row on>허브 앱 행·담당자 (신청 기록은 남기고 "앱 삭제됨" 표시)</Row>
          </ul>)}
        {active && <p className="warn">진행 중이던 삭제(#{active})가 있습니다. <button className="ghost small" disabled={busy} onClick={() => drive('run', active)}>이어서 하기</button></p>}
        <p className="muted">지우지 않고 숨기기만 하려면 <button className="link" onClick={onSoftDelete}>상태를 '종료'로 바꾸기</button> (나중에 되살릴 수 있음).</p>
        <label><span>확인을 위해 주소 이름 <b>{app.slug}</b> 을(를) 그대로 입력하세요</span><input value={confirm} onChange={(e) => setConfirm(e.target.value.trim())} placeholder={app.slug} autoComplete="off" /></label>
        <label>메모 (선택)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 시험용 앱 정리" /></label>
      </>}
      {d && <>
        <p>{done ? <b className="ok-text">✅ 삭제 완료</b> : d.status === 'failed' ? <b className="error-text">⚠️ 멈춤</b> : <b>⏳ 백업하고 지우는 중… (창을 닫지 마세요)</b>}</p>
        <DelSteps d={d} running={busy} />
        {d.error && <p className="error" role="alert">{d.error}</p>}
        <BackupFiles d={d} />
        {done && <p className="muted">감사 기록 화면의 '삭제된 앱 · 백업'에서도 언제든 내려받을 수 있어요.</p>}
      </>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row">
        {!d && <button className="danger" disabled={busy || !i || confirm !== app.slug || !!active} onClick={() => drive('start')}>{busy ? '진행 중…' : '백업하고 삭제'}</button>}
        {d && d.status === 'failed' && <button disabled={busy} onClick={() => drive('run', d.id)}>🔁 다시 시도</button>}
        <button className="ghost" disabled={busy} onClick={() => (d ? onDone() : onClose())}>{done ? '닫기' : '취소'}</button>
      </div>
    </Modal>
  );
}
