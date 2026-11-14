import { useEffect, useState } from 'react';
import { Link, type Ctx } from '../App';
import { sb, fmtTime, type App } from '../sb';
import { AppGlyph } from '../ui';

/** 공용 주소 점검 (경고만) — 앱 저장소의 GitHub Actions 가 GitHub OIDC 로 hub-checks 함수에 보낸 최신 결과 */
export type CheckWarning = { rule: string; file: string; line: number; message: string; fix: string; blocking: boolean };
export type AppCheck = { app_id: number; received_at: string; commit_sha: string; run_url: string | null; files: number; total: number; new_count: number;
  by_rule: Record<string, number>; warnings: CheckWarning[]; new_keys: string[]; block_dangerous: boolean };
export const RULE_LABEL: Record<string, string> = {
  'storage-clear': '저장소 전체 지우기', 'storage-key': '이름표 없는 저장 이름', 'abs-path': '사이트 맨 앞 경로', 'sw-scope': '범위 없는 서비스 워커', 'ext-script': '외부 스크립트',
};
const keyOf = (w: CheckWarning) => `${w.rule}|${w.file}|${w.message}`;
const repoOf = (run: string | null) => run?.replace(/\/actions\/runs\/\d+$/, '') ?? null;

/** 앱 상세 창 안: 담당 개발자·관리자에게만 (RLS 로 서버에서 거름) */
export function ChecksSection({ ctx, appId, appUrl }: { ctx: Ctx; appId: number; appUrl: string }) {
  const [c, setC] = useState<AppCheck | null | undefined>(undefined);
  useEffect(() => { sb.from('app_checks').select('*').eq('app_id', appId).maybeSingle().then(({ data }) => setC((data as AppCheck) ?? null)); }, [appId]);
  if (c === undefined) return null;
  if (c === null) return ctx.isAdmin && /apps\.bmrschool\.net\//.test(appUrl)
    ? <div className="checks"><h4>🛡️ 공용 주소 점검</h4><p className="muted">아직 받은 결과가 없습니다. 저장소에 '공용 주소 점검' 워크플로가 있으면 main 에 push 할 때마다 여기에 보입니다.</p></div> : null;
  const repo = repoOf(c.run_url); const isNew = new Set(c.new_keys);
  return (
    <div className="checks">
      <div className="row between"><h4>🛡️ 공용 주소 점검 <span className="badge">경고만</span></h4>
        {c.total ? <span className="badge c-warn">경고 {c.total}건{c.new_count ? ` · 새 경고 ${c.new_count}` : ''}</span> : <span className="badge c-ok">✓ 경고 없음</span>}</div>
      <p className="muted">apps.bmrschool.net 을 여러 앱이 함께 쓰므로 서로 방해할 수 있는 코드를 push 때마다 살펴봅니다. 배포는 막지 않아요.
        {' '}커밋 <code>{c.commit_sha.slice(0, 7)}</code> · {fmtTime(c.received_at)} · 파일 {c.files}개{c.run_url && <> · <a href={c.run_url} target="_blank" rel="noopener noreferrer">실행 기록 ↗</a></>}</p>
      {c.warnings.length > 0 && <ul className="check-list">
        {c.warnings.map((w, i) => (
          <li key={i} className={w.blocking && c.block_dangerous ? 'block' : ''}>
            <div className="check-head"><span className="badge">{RULE_LABEL[w.rule] ?? w.rule}</span>{isNew.has(keyOf(w)) && <span className="badge c-new">새 경고</span>}
              {repo ? <a href={`${repo}/blob/${c.commit_sha}/${w.file}#L${w.line}`} target="_blank" rel="noopener noreferrer"><code>{w.file}:{w.line}</code></a> : <code>{w.file}:{w.line}</code>}</div>
            <p>{w.message}</p><p className="fix">💡 {w.fix}</p>
          </li>))}
      </ul>}
      <p className="muted small">일부러 그렇게 쓴 줄은 그 줄 끝에 <code>// bmr-allow: 이유</code> 를 달면 건너뜁니다. 규칙: <Link to="/guide#shared-origin">공용 주소에서 지킬 규칙</Link></p>
    </div>
  );
}

/** 운영 상태 화면(관리자): 앱별 요약 */
export function ChecksSummary({ apps }: { apps: App[] }) {
  const [rows, setRows] = useState<AppCheck[] | null>(null);
  useEffect(() => { sb.from('app_checks').select('app_id, received_at, commit_sha, run_url, files, total, new_count, by_rule, block_dangerous').then(({ data }) => setRows((data as AppCheck[]) ?? [])); }, []);
  if (!rows) return null;
  const byId = new Map(rows.map((r) => [r.app_id, r]));
  const list = apps.filter((a) => byId.has(a.id) || /apps\.bmrschool\.net\//.test(a.url));
  const total = rows.reduce((s, r) => s + r.total, 0), fresh = rows.reduce((s, r) => s + r.new_count, 0);
  return (
    <>
      <div className="section-head"><h3>🛡️ 공용 주소 점검 (경고만)</h3><span className="muted">경고 {total}건 · 새 경고 {fresh}건</span></div>
      <p className="muted">앱 저장소가 main 에 push 할 때마다 보내는 결과입니다 (GitHub 가 서명한 1회용 토큰으로 확인). 자세한 위치·고치는 법은 대시보드에서 앱을 눌러 보세요.</p>
      <div className="card flush"><table>
        <thead><tr><th>앱</th><th>경고</th><th>새 경고</th><th>규칙별</th><th>커밋 · 받은 시각</th></tr></thead>
        <tbody>{list.map((a) => { const r = byId.get(a.id); return (
          <tr key={a.id}>
            <td><AppGlyph app={a} className="sm" /> {a.name}</td>
            <td>{r ? (r.total ? <span className="badge c-warn">{r.total}</span> : <span className="badge c-ok">0</span>) : <span className="muted">결과 없음</span>}</td>
            <td>{r ? (r.new_count ? <span className="badge c-new">{r.new_count}</span> : '0') : '-'}</td>
            <td>{r && Object.keys(r.by_rule).length ? Object.entries(r.by_rule).map(([k, v]) => <span key={k} className="badge">{RULE_LABEL[k] ?? k} {v}</span>) : '-'}</td>
            <td>{r ? <>{r.run_url ? <a href={r.run_url} target="_blank" rel="noopener noreferrer"><code>{r.commit_sha.slice(0, 7)}</code></a> : <code>{r.commit_sha.slice(0, 7)}</code>} · {fmtTime(r.received_at)}</> : '-'}</td>
          </tr>); })}</tbody>
      </table></div>
    </>
  );
}
