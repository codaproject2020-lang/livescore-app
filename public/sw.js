// LIVE UP · 최소 서비스워커 (PWA 설치 가능 조건 충족)
const CACHE = 'liveup-v174';
const CORE = ['/', '/index.html', '/logo.png.jpg', '/manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {})));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// 네트워크 우선 + 오프라인 시 캐시 폴백
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

// 🔔 웹 푸시 수신 (앱이 완전히 닫혀 있어도 동작)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'LIVE UP', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'LIVE UP';
  const opts = {
    body: d.body || '',
    icon: '/logo-t.png',
    badge: '/logo-t.png',
    tag: d.gameId ? 'liveup-' + d.gameId : undefined,
    renotify: true,
    data: { gameId: d.gameId || '', sport: d.sport || '' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// 알림 클릭 → 앱 열고 해당 경기 상세로
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const gid = e.notification.data && e.notification.data.gameId;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if (gid) c.postMessage({ type: 'openEvent', gameId: gid }); return; }
    }
    await self.clients.openWindow(gid ? '/?ev=' + encodeURIComponent(gid) : '/');
  })());
});
