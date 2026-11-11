// 허브 Auth 설정: 이메일·비밀번호 로그인, 가입 허용(가입자는 pending=일반 사용자, 관리자가 staff/admin으로 올림). 이메일 확인 없음(바로 로그인).
import { api } from './sql.mjs';
const body = {
  site_url: 'https://apps.bmrschool.net',
  uri_allow_list: ['https://apps.bmrschool.net/**', 'http://localhost:5173/**'].join(','),
  disable_signup: false, external_email_enabled: true, mailer_autoconfirm: true, password_min_length: 8,
};
const r = await api('/config/auth', { method: 'PATCH', body: JSON.stringify(body) });
const d = await r.json();
if (!r.ok) { console.error(r.status, JSON.stringify(d).slice(0, 300)); process.exit(1); }
for (const k of Object.keys(body)) console.log(k, '=', d[k]);
