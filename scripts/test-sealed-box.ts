// GitHub Actions 비밀값 봉인(sealed box)이 libsodium 과 같은 값인지 시험한다.
// 실행: deno test -A scripts/test-sealed-box.ts
// (hub-provision 에는 tweetnacl + @noble/hashes 로 넣고, 시험에서만 libsodium 을 써서 서로 열리는지 본다)
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import sodium from 'npm:libsodium-wrappers@0.7.15';
import { sealBox, sealBoxBase64 } from '../supabase/functions/hub-provision/sealed.ts';

await sodium.ready;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

Deno.test('봉인 값은 libsodium crypto_box_seal_open 으로 열린다 (GitHub 이 이 방식으로 푼다)', () => {
  const kp = sodium.crypto_box_keypair();
  const msg = 'postgresql://demo_app_dev.psupfmarnyxontorftio:0123456789abcdef@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres';
  const sealed = sealBox(new TextEncoder().encode(msg), kp.publicKey);
  assertEquals(sealed.length, 32 + 16 + msg.length);
  const opened = sodium.crypto_box_seal_open(sealed, kp.publicKey, kp.privateKey);
  assertEquals(new TextDecoder().decode(opened), msg);
});

Deno.test('libsodium 이 봉인한 값도 같은 규칙으로 만들어 진다 (epk 32바이트 + 암호문)', () => {
  const kp = sodium.crypto_box_keypair();
  const theirs = sodium.crypto_box_seal(new TextEncoder().encode('가로 24바이트 nonce 확인'), kp.publicKey);
  assertEquals(theirs.length, 32 + 16 + new TextEncoder().encode('가로 24바이트 nonce 확인').length);
  // 우리 구현과 같은 길이·구조 (epk 먼저, 그 뒤 암호문)
  const mine = sealBox(new TextEncoder().encode('가로 24바이트 nonce 확인'), kp.publicKey);
  assertEquals(mine.length, theirs.length);
});

Deno.test('base64 값은 GitHub encrypted_value 형식이다', () => {
  const kp = sodium.crypto_box_keypair();
  const s = sealBoxBase64('hello', b64(kp.publicKey));
  assert(/^[A-Za-z0-9+/]+={0,2}$/.test(s), 'base64 문자만');
  const raw = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  assertEquals(new TextDecoder().decode(sodium.crypto_box_seal_open(raw, kp.publicKey, kp.privateKey)), 'hello');
});

Deno.test('공개 키 길이가 다르면 만들지 않는다', () => {
  assertThrows(() => sealBoxBase64('x', btoa('short')), Error, '공개 키 길이');
});
