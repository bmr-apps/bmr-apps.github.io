#!/usr/bin/env node
// 허브 메일(hub-mail) 준비·배포. 비밀값(토큰·키)은 화면·파일·저장소에 남기지 않는다.
//  1) BMR_RESEND_API_KEY: RESEND_API_KEY(발송 전용)를 기존 열쇠로 암호문 저장 (RESEND_ADMIN_KEY 는 저장하지 않음)
//  2) 앱마다 <PREFIX>MAIL_TOKEN 발급(없을 때만, --rotate-tokens 로 모두 새로) · 해시는 bmr_admin.mail_tokens
//  3) hub-mail 배포(_key.ts 는 배포본에만)
//  4) 도메인이 인증되어 있으면 Auth SMTP 설정 (가입 확인·autoconfirm 은 건드리지 않음)
//  5) --test 이면 class-designer 신분으로 bmrdev@bmrschool.org 에 시험 메일 한 통
// 사용: node scripts/setup-mail.mjs [--secrets] [--tokens] [--rotate-tokens] [--deploy] [--smtp] [--test]
//       (인자 없으면 --secrets --tokens --deploy --smtp)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv, createHash } from 'node:crypto';
import { recordDeploy } from './deploy-record.mjs';
import { sql, REF } from './sql.mjs';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN_DEVAPPS;
const RESEND = process.env.RESEND_API_KEY;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const all = ![...args].some((a) => a !== '--test' && a !== '--rotate-tokens');
const doSecrets = all || args.has('--secrets');
const doTokens = all || args.has('--tokens') || args.has('--rotate-tokens');
const rotateTokens = args.has('--rotate-tokens');
const doDeploy = all || args.has('--deploy');
const doSmtp = all || args.has('--smtp');
const doTest = args.has('--test');
const TEST_TO = 'bmrdev@bmrschool.org';
const TEST_SLUG = 'class-designer';

if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN_DEVAPPS 가 없습니다'); process.exit(1); }
const api = (p, o = {}) => fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, ...(o.headers || {}) } });
if ((doSecrets || doSmtp || doTest) && !RESEND) { console.error('RESEND_API_KEY 가 없습니다'); process.exit(1); }

const keyFile = join(ROOT, '.secrets', 'hub-provision.key');
if (!existsSync(keyFile)) { console.error('열쇠 파일(.secrets/hub-provision.key)이 없습니다'); process.exit(1); }
const key = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
if (key.length !== 32) { console.error('열쇠 파일 형식이 다릅니다'); process.exit(1); }

function enc(name, value) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(name));
  const ct = Buffer.concat([c.update(value, 'utf8'), c.final(), c.getAuthTag()]);
  return 'enc:v1:' + Buffer.concat([iv, ct]).toString('base64');
}
const mailSecret = (slug) => `${slug.replaceAll('-', '_').toUpperCase()}_MAIL_TOKEN`;
const hashToken = (t) => createHash('sha256').update(t).digest('hex');

async function secretNames() {
  const r = await api('/secrets');
  if (!r.ok) throw new Error(`비밀값 목록 실패 ${r.status}`);
  return (await r.json()).map((x) => x.name);
}

if (doSecrets) {
  const body = [{ name: 'BMR_RESEND_API_KEY', value: enc('BMR_RESEND_API_KEY', RESEND) }];
  const r = await api('/secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { console.error('BMR_RESEND_API_KEY 저장 실패', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
  const names = await secretNames();
  console.log('함수 비밀값(암호문) 저장: BMR_RESEND_API_KEY', names.includes('BMR_RESEND_API_KEY') ? '✓' : '✗');
}

// 이번에 발급한 평문 토큰은 시험 발송에만 메모리에서 쓰고, 출력·파일로 남기지 않는다.
const issued = new Map();

if (doTokens) {
  const apps = await sql("select id, slug, name, status from public.apps where status <> 'retired' order by id");
  const have = rotateTokens ? [] : (await sql('select app_id from bmr_admin.mail_tokens')).map((r) => Number(r.app_id));
  const haveSet = new Set(have);
  let nNew = 0, nSkip = 0;
  for (const a of apps) {
    if (haveSet.has(Number(a.id))) { nSkip++; continue; }
    const tok = 'bmrmt_' + randomBytes(32).toString('hex');
    const name = mailSecret(a.slug);
    const r = await api('/secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ name, value: tok }]) });
    if (!r.ok) { console.error(`메일 토큰 저장 실패 (${a.slug})`, r.status); process.exit(1); }
    const h = hashToken(tok);
    await sql(`insert into bmr_admin.mail_tokens (app_id, token_hash, set_at) values (${Number(a.id)}, '${h}', now())
      on conflict (app_id) do update set token_hash = excluded.token_hash, set_at = excluded.set_at`);
    issued.set(a.slug, tok);
    nNew++;
    console.log(`메일 토큰 발급: ${a.slug} → 비밀값 ${name}`);
  }
  console.log(`메일 토큰: 새로 ${nNew}개, 이미 있음 ${nSkip}개`);
}

if (doDeploy) {
  const dir = join(ROOT, 'supabase', 'functions', 'hub-mail');
  const fd = new FormData();
  fd.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: 'hub-mail', verify_jwt: false }));
  for (const f of readdirSync(dir)) if (f.endsWith('.ts') && f !== '_key.ts') fd.append('file', new Blob([readFileSync(join(dir, f))]), f);
  fd.append('file', new Blob([`export const PROVISION_KEY = '${key.toString('base64')}';\n`]), '_key.ts');
  const r = await api(`/functions/deploy?slug=hub-mail`, { method: 'POST', body: fd });
  if (!r.ok) { console.error('hub-mail 배포 실패', r.status, (await r.text()).slice(0, 600)); process.exit(1); }
  console.log('함수 hub-mail 배포 완료');
  await recordDeploy('hub-mail', dir);
}

if (doSmtp) {
  const domainId = 'e58a4d75-539c-47c8-bf60-bae7e234f50c';
  const admin = process.env.RESEND_ADMIN_KEY;
  if (!admin) { console.error('RESEND_ADMIN_KEY 가 없어 Auth SMTP 설정을 건너뜁니다'); }
  else {
    const dr = await fetch(`https://api.resend.com/domains/${domainId}`, { headers: { Authorization: `Bearer ${admin}` } });
    const dj = await dr.json();
    const status = dj?.status;
    const sending = dj?.capabilities?.sending;
    console.log(`Resend 도메인 상태: ${status} (발송 ${sending})`);
    if (status !== 'verified') {
      console.log('도메인이 아직 인증되지 않아 Auth SMTP 설정을 건너뜁니다. 인증 후 --smtp 로 다시 실행하세요.');
    } else {
      const body = {
        smtp_admin_email: 'noreply@mail.bmrschool.net',
        smtp_host: 'smtp.resend.com',
        smtp_port: '465',
        smtp_user: 'resend',
        smtp_pass: RESEND,
        smtp_sender_name: 'BMR APPS',
      };
      const r = await api('/config/auth', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { console.error('Auth SMTP 설정 실패', r.status, JSON.stringify(d).slice(0, 300)); process.exit(1); }
      const check = ['smtp_admin_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_sender_name'];
      for (const k of check) console.log(k, '=', d[k]);
      console.log('smtp_pass', d.smtp_pass ? '설정됨' : '비어 있음');
      if (d.mailer_autoconfirm !== undefined) console.log('(확인) mailer_autoconfirm 은 바꾸지 않음:', d.mailer_autoconfirm);
    }
  }
}

if (doTest) {
  let tok = issued.get(TEST_SLUG);
  if (!tok) {
    console.error(`시험 메일을 보내려면 ${TEST_SLUG} 토큰을 이번 실행에서 발급해야 합니다. 같은 실행에 --tokens(또는 --rotate-tokens)와 --test 를 함께 주세요.`);
    process.exit(1);
  }
  const url = `https://${REF}.supabase.co/functions/v1/hub-mail`;
  let ready = false;
  for (let i = 0; i < 8; i++) {
    try {
      const h = await fetch(url + '/health', { signal: AbortSignal.timeout(10_000) });
      await h.body?.cancel();
      if (h.ok) { ready = true; break; }
    } catch { /* 다시 */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) console.log('hub-mail /health 가 아직 준비되지 않았지만 시험 발송을 시도합니다.');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: TEST_TO,
      subject: 'BMR APPS 메일 시험',
      text: '별무리 수업 디자이너(class-designer) 신분으로 보낸 시험 메일입니다. 이 메일이 도착했다면 공용 발송 함수가 정상 동작합니다.',
      html: '<p>별무리 수업 디자이너(<code>class-designer</code>) 신분으로 보낸 시험 메일입니다.</p><p>이 메일이 도착했다면 공용 발송 함수가 정상 동작합니다.</p>',
      from_name: '별무리 수업 디자이너',
    }),
  });
  const t = await r.text();
  let parsed = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* 그대로 */ }
  // 본문·토큰은 출력하지 않고 결과만
  console.log('시험 메일:', r.status, parsed.ok ? 'ok' : '실패', parsed.id ? `id=${parsed.id}` : '', parsed.from ? `from=${parsed.from}` : '', parsed.error ? `error=${String(parsed.error).slice(0, 200)}` : '');
  if (!r.ok || !parsed.ok) process.exit(1);
}
