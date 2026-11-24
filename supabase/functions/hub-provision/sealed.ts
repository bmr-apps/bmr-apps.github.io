// GitHub Actions 비밀값(DATABASE_URL)을 저장소 공개 키로 '봉인(sealed box)'한다.
// GitHub 은 libsodium sealed box 로 암호화한 값만 받는다:
//   ephemeral X25519 키쌍 → nonce = BLAKE2b-24(epk ‖ 저장소 공개 키) → XSalsa20-Poly1305
// libsodium(WASM)을 이 함수에 넣지 않으려고 순수 JS(tweetnacl) + BLAKE2b(@noble/hashes)로 만든다.
// libsodium 의 crypto_box_seal 로 만든 값과 서로 열리는 것을 확인했다 (scripts/test-sealed-box.ts).
import nacl from 'npm:tweetnacl@1.0.3';
import { blake2b } from 'npm:@noble/hashes@1.8.0/blake2b';

const enc = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return s; };
const toB64 = (u: Uint8Array) => btoa(enc(u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** libsodium crypto_box_seal 과 같은 봉인 값 (epk 32바이트 ‖ 암호문) */
export function sealBox(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== nacl.box.publicKeyLength) throw new Error('GitHub 공개 키 길이가 올바르지 않습니다.');
  const eph = nacl.box.keyPair();
  const nonce = blake2b(cat(eph.publicKey, recipientPublicKey), { dkLen: nacl.box.nonceLength });
  return cat(eph.publicKey, nacl.box(message, nonce, recipientPublicKey, eph.secretKey));
}

/** GitHub API 의 encrypted_value (base64) 로 바로 쓰는 값 */
export function sealBoxBase64(message: string, recipientPublicKeyB64: string): string {
  return toB64(sealBox(new TextEncoder().encode(message), fromB64(recipientPublicKeyB64)));
}
