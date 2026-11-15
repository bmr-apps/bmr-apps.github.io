/* BMR APPS 서비스 워커 — 범위는 허브 화면('/hub/')입니다 (다른 앱의 서비스 워커를 가리지 않게).
   · push: 서버(hub-notify)가 보낸 알림을 브라우저에 띄웁니다 (앱을 닫아 둬도 도착).
   · notificationclick: 이미 열린 BMR APPS 탭을 앞으로 가져와 그 화면(쪽지 등)으로 보냅니다.
   · 배지: 새 알림이 오면 홈 화면 아이콘에 점을 찍습니다. 정확한 숫자는 열린 화면이 다시 계산합니다.
   저장소(캐시)는 쓰지 않습니다 — 화면은 늘 네트워크에서 새로 받습니다(쪽지·권한이 섞이지 않게). */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try { data = { body: event.data.text() }; } catch { data = {}; }
  }
  const title = String(data.title || 'BMR APPS');
  const body = String(data.body || '새 알림이 도착했어요.');
  const url = String(data.url || '/');
  const tag = String(data.tag || 'bmr-apps');
  const icon = data.icon ? String(data.icon) : '/favicon-192x192.png';

  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      tag,
      icon,
      badge: icon,
      data: { url },
      renotify: false,
      silent: false,
    });
    // 홈 화면 아이콘 배지: 숫자는 열린 화면이 정확히 다시 계산한다. 여기서는 '새 알림 있음'만.
    try {
      if (self.navigator && typeof self.navigator.setAppBadge === 'function') await self.navigator.setAppBadge();
    } catch { /* 배지를 지원하지 않는 브라우저 */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.includes(self.location.origin)) {
        await client.focus();
        if ('navigate' in client) { try { await client.navigate(target); } catch { /* 무시 */ } }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

// 설치형(PWA)으로 인정받기 위한 최소 처리. 캐시는 하지 않습니다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => new Response('오프라인입니다. 연결을 확인해 주세요.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })));
});
