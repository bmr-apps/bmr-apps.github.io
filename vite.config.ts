import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

// GitHub Pages는 응답 헤더를 못 바꾸므로 CSP를 meta 태그로 넣는다 (개발 서버는 React 새로고침용 인라인 스크립트가 있어 빌드에만 적용).
const cspFor = (SB: string) => [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
  `connect-src 'self' ${SB} ${SB.replace('https://', 'wss://')}`, "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');
const csp = (CSP: string): Plugin => ({
  name: 'csp-meta', apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer" content="strict-origin-when-cross-origin">`),
});
// SPA: GitHub Pages가 없는 경로에 404.html을 주므로 index.html을 복사한다
const spa404 = (): Plugin => ({
  name: 'spa-404', apply: 'build',
  closeBundle() { copyFileSync(resolve('dist/index.html'), resolve('dist/404.html')); },
});

export default defineConfig(({ mode, command }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const SB = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (command === 'build' && !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SB)) throw new Error('VITE_SUPABASE_URL 이 없거나 형식이 다릅니다');
  return {
  base: '/', // 조직 사이트(bmr-apps.github.io)라서 도메인 루트
  plugins: [react(), csp(cspFor(SB)), spa404()],
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: false },
  server: { port: 5173 }, preview: { port: 4173 },
};
});
