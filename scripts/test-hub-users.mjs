// 허브 사용자 관리(hub-users) 시험. 비밀번호·토큰은 출력하지 않는다.
// 실제 계정(dev@bmrschool.org, mrgoodway@bmrschool.org)은 바꾸지 않는다.
import { randomBytes } from 'node:crypto';
import { SB_URL, apiKeys, sql } from '../../bmr-app-templates/lib/common.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchR = async (url, init, tries = 5) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
};
const PROTECTED = new Set(['dev@bmrschool.org', 'mrgoodway@bmrschool.org']);
const prefix = `hub-users-test-${randomBytes(3).toString('hex')}`;
const tag = `${prefix}@example.com`;
let pass = 0, fail = 0; const fails = [];
const ok = (c, l) => { if (c) { pass++; console.log('  ✓', l); } else { fail++; fails.push(l); console.log('  ✗', l); } };
const { pub, service } = await apiKeys();
const authH = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
const adm = (p, o = {}) => fetchR(`${SB_URL}/auth/v1/admin/${p}`, { ...o, headers: authH });
const token = async (email, pw) => {
  const r = await fetchR(`${SB_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: pub, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, at: j.access_token, error: j.error_description || j.msg || j.error || '' };
};
const mk = async (local, role = 'pending') => {
  const email = `${prefix}-${local}@example.com`;
  const pw = randomBytes(18).toString('base64url');
  const cr = await adm('users', { method: 'POST', body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { name: local } }) });
  const u = await cr.json();
  if (!u.id) throw new Error(`가입 실패 ${email} ${cr.status}`);
  if (role !== 'pending') await sql(`update public.profiles set role = '${role}', name = '${local}' where id = '${u.id}'`);
  else await sql(`update public.profiles set name = '${local}' where id = '${u.id}'`);
  const t = await token(email, pw);
  return { id: u.id, email, pw, at: t.at };
};
const call = (tok, action, body = {}) => fetchR(`${SB_URL}/functions/v1/hub-users`, {
  method: 'POST', cache: 'no-store',
  headers: { apikey: pub, ...(tok ? { Authorization: `Bearer ${tok}` } : {}), Origin: 'https://apps.bmrschool.net', 'Content-Type': 'application/json' },
  body: JSON.stringify({ action, ...body }),
});
const guard = (email, action) => { if (PROTECTED.has(String(email).toLowerCase())) throw new Error(`보호된 계정을 ${action} 하려 했습니다: ${email}`); };

// 관리자(dev@) 로그인
const adminEmail = 'dev@bmrschool.org';
const adminPw = process.env.HUB_ADMIN_PASSWORD;
if (!adminPw) { console.error('HUB_ADMIN_PASSWORD 가 없습니다'); process.exit(1); }
const adminTok = await token(adminEmail, adminPw);
if (!adminTok.at) { console.error('관리자 로그인 실패'); process.exit(1); }
const created = [];
const remember = await sql(`select email, role from public.profiles where email in ('dev@bmrschool.org','mrgoodway@bmrschool.org') order by email`);

try {
  // 이전 시험 잔여 정리
  const leftover = await sql(`select id, email from auth.users where email like 'hub-users-test-%@example.com'`);
  for (const u of leftover) { await adm(`users/${u.id}`, { method: 'DELETE' }); }

  const pending = await mk('pending'); created.push(pending);
  const staffU = await mk('staff', 'staff'); created.push(staffU);
  const extraAdmin = await mk('admin2', 'admin'); created.push(extraAdmin);
  const doomed = await mk('doomed'); created.push(doomed);
  ok(pending.at && staffU.at && extraAdmin.at && doomed.at, '임시 계정 4명 (일반·개발자·관리자·삭제대상)');

  console.log('1) 권한');
  let r = await call(null, 'list'); ok(r.status === 401, `로그인 없이 → ${r.status}`);
  r = await fetchR(`${SB_URL}/functions/v1/hub-users`, { method: 'POST', headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' }, body: '{}' });
  ok(r.status === 403, `다른 출처 → ${r.status}`);
  r = await call(pending.at, 'list'); let j = await r.json();
  ok(r.status === 403 && /관리자만/.test(j.error || ''), '일반 사용자: 목록 거부');
  r = await call(staffU.at, 'set_role', { user_id: pending.id, role: 'staff' });
  ok(r.status === 403, `개발자: 역할 변경 거부 → ${r.status}`);
  r = await call(staffU.at, 'reset_password', { user_id: pending.id });
  ok(r.status === 403, `개발자: 비밀번호 초기화 거부 → ${r.status}`);
  r = await call(staffU.at, 'delete', { user_id: pending.id, confirm_email: pending.email });
  ok(r.status === 403, `개발자: 삭제 거부 → ${r.status}`);

  console.log('2) 목록');
  r = await call(adminTok.at, 'list'); j = await r.json();
  const emails = (j.users || []).map((u) => u.email);
  ok(r.status === 200 && emails.includes(pending.email) && emails.includes(staffU.email) && emails.includes('dev@bmrschool.org') && emails.includes('mrgoodway@bmrschool.org'),
    '관리자 목록에 시험 계정과 실제 계정');
  const row = (j.users || []).find((u) => u.email === pending.email);
  ok(row && row.role === 'pending' && Array.isArray(row.owned_apps) && 'last_sign_in_at' in row, '일반 사용자 행 필드');

  console.log('3) 역할 변경');
  guard(pending.email, 'set_role');
  r = await call(adminTok.at, 'set_role', { user_id: pending.id, role: 'staff' }); j = await r.json();
  ok(r.status === 200 && j.role === 'staff', '일반 → 개발자');
  const [pr] = await sql(`select role from public.profiles where id = '${pending.id}'`);
  ok(pr.role === 'staff', 'DB 역할이 개발자');

  r = await call(adminTok.at, 'set_role', { user_id: adminTok /* invalid */ });
  // self
  const [adminRow] = await sql(`select id, email from public.profiles where email = 'dev@bmrschool.org'`);
  r = await call(adminTok.at, 'set_role', { user_id: adminRow.id, role: 'staff' }); j = await r.json();
  ok(r.status === 400 && /자기 자신/.test(j.error || ''), '자기 역할 변경 거부');

  console.log('4) 비밀번호 초기화');
  guard(pending.email, 'reset_password');
  const oldPw = pending.pw;
  r = await call(adminTok.at, 'reset_password', { user_id: pending.id }); j = await r.json();
  const temp = j.password;
  ok(r.status === 200 && typeof temp === 'string' && temp.length >= 16 && j.once === true, '임시 비밀번호 1회 발급');
  ok(!(r.headers.get('cache-control') || '').includes('store') || (r.headers.get('cache-control') || '').includes('no-store'), '응답 캐시 금지');
  const loginNew = await token(pending.email, temp);
  ok(!!loginNew.at, '임시 비밀번호로 로그인');
  const loginOld = await token(pending.email, oldPw);
  ok(!loginOld.at, '이전 비밀번호는 실패');
  pending.pw = temp; pending.at = loginNew.at;

  const custom = 'Tmp-' + randomBytes(8).toString('base64url');
  r = await call(adminTok.at, 'reset_password', { user_id: pending.id, password: custom }); j = await r.json();
  ok(r.status === 200 && j.password === custom, '관리자가 지정한 비밀번호로 변경');
  const loginCustom = await token(pending.email, custom);
  ok(!!loginCustom.at, '지정한 비밀번호로 로그인');
  pending.pw = custom;

  r = await call(adminTok.at, 'reset_password', { user_id: adminRow.id }); j = await r.json();
  ok(r.status === 400 && /내 계정/.test(j.error || ''), '관리자 본인 초기화는 내 계정 화면으로 안내');

  console.log('5) 사용 중지 · 다시 사용');
  guard(pending.email, 'disable');
  r = await call(adminTok.at, 'set_role', { user_id: pending.id, role: 'disabled' });
  ok(r.status === 200, '사용 중지');
  const banned = await token(pending.email, pending.pw);
  ok(!banned.at, `중지된 계정 로그인 실패 (${banned.status})`);
  const [ban] = await sql(`select (banned_until is not null and banned_until > now()) as banned, p.role from auth.users u join public.profiles p on p.id = u.id where u.id = '${pending.id}'`);
  ok(ban.banned === true && ban.role === 'disabled', 'Auth 로그인 차단 + 역할 사용 중지');

  r = await call(adminTok.at, 'set_role', { user_id: pending.id, role: 'pending' });
  ok(r.status === 200, '다시 사용 (일반 사용자)');
  const unban = await token(pending.email, pending.pw);
  ok(!!unban.at, '다시 사용 후 로그인');
  pending.at = unban.at;

  console.log('6) 삭제');
  r = await call(adminTok.at, 'delete', { user_id: doomed.id, confirm_email: 'wrong@example.com' }); j = await r.json();
  ok(r.status === 400 && /이메일/.test(j.error || ''), '이메일 확인 틀리면 삭제 거부');
  r = await call(adminTok.at, 'delete', { user_id: adminRow.id, confirm_email: 'dev@bmrschool.org' }); j = await r.json();
  ok(r.status === 400 && /자기 자신/.test(j.error || ''), '자기 자신 삭제 거부');
  r = await call(extraAdmin.at, 'delete', { user_id: extraAdmin.id, confirm_email: extraAdmin.email }); j = await r.json();
  ok(r.status === 400 && /자기 자신/.test(j.error || ''), '시험 관리자 자기 삭제 거부');
  r = await call(extraAdmin.at, 'set_role', { user_id: extraAdmin.id, role: 'staff' }); j = await r.json();
  ok(r.status === 400 && /자기 자신/.test(j.error || ''), '시험 관리자 자기 역할 변경 거부');

  // 실제 관리자가 남아 있으므로 시험 관리자는 삭제 가능
  guard(extraAdmin.email, 'delete');
  r = await call(adminTok.at, 'delete', { user_id: extraAdmin.id, confirm_email: extraAdmin.email }); j = await r.json();
  ok(r.status === 200 && j.ok, '시험 관리자 삭제 (실제 관리자가 남아 있음)');
  created.splice(created.findIndex((x) => x.id === extraAdmin.id), 1);

  // 신청 기록이 있는 사용자 삭제 후에도 신청이 남는지
  await sql(`insert into public.app_requests (requested_by, requester_name, requester_email, app_name, slug, purpose, data_handled, has_student_pii, github_username, status)
    values ('${doomed.id}', '시험', '${doomed.email}', '시험앱', 'hub-users-tmp', '시험', '', false, 'hub-users-tmp', 'pending')`);
  guard(doomed.email, 'delete');
  r = await call(adminTok.at, 'delete', { user_id: doomed.id, confirm_email: doomed.email }); j = await r.json();
  ok(r.status === 200, '계정 삭제');
  const [gone] = await sql(`select count(*)::int n from auth.users where id = '${doomed.id}'`);
  const [kept] = await sql(`select count(*)::int n, count(requested_by)::int linked from public.app_requests where slug = 'hub-users-tmp'`);
  ok(gone.n === 0 && kept.n === 1 && kept.linked === 0, '계정은 지워지고 신청 기록은 남음 (requested_by 비움)');
  await sql(`delete from public.app_requests where slug = 'hub-users-tmp'`);
  created.splice(created.findIndex((x) => x.id === doomed.id), 1);

  // 감사 기록에 비밀값 없음
  const logs = await sql(`select label, issued_to, memo from public.token_logs where kind = 'hub_user' and issued_to like '${prefix}-%' order by id`);
  ok(logs.length >= 3 && logs.every((x) => !/Tmp-|password=/i.test(JSON.stringify(x))), `감사 기록 ${logs.length}건, 비밀값 없음`);
} finally {
  for (const u of created) {
    try { await adm(`users/${u.id}`, { method: 'DELETE' }); } catch {}
  }
  const rest = await sql(`select id from auth.users where email like '${prefix}-%@example.com' or email like 'hub-users-test-%@example.com'`);
  for (const u of rest) { try { await adm(`users/${u.id}`, { method: 'DELETE' }); } catch {} }
  // 실제 계정 역할 원상 복구
  for (const p of remember) {
    await sql(`update public.profiles set role = '${p.role}' where email = '${p.email}'`);
  }
  const now = await sql(`select email, role from public.profiles where email in ('dev@bmrschool.org','mrgoodway@bmrschool.org') order by email`);
  const same = JSON.stringify(now) === JSON.stringify(remember);
  if (!same) {
    console.error('✗ 실제 계정 역할이 달라졌습니다. 복구를 다시 시도합니다.');
    await sql(`update public.profiles set role = 'admin' where email = 'dev@bmrschool.org'`);
    await sql(`update public.profiles set role = 'staff' where email = 'mrgoodway@bmrschool.org'`);
    fail++; fails.push('실제 계정 역할 보존');
  } else { pass++; console.log('  ✓ 실제 계정 역할 보존'); }
}
console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
if (fails.length) console.log('실패:', fails.join(' / '));
process.exit(fail ? 1 : 0);
