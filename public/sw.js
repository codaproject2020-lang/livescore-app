// LIVE UP · 최소 서비스워커 (PWA 설치 가능 조건 충족)
const CACHE = 'liveup-v342';
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
//  ⚠️ 중요: 네트워크 실패 시 app.js/styles.css 같은 리소스에 index.html(HTML)을 돌려주면 JS가 깨져 "자꾸 오류"가 남.
//      → 페이지(navigate)만 index 폴백, 스크립트/스타일/이미지는 폴백 금지. API는 항상 네트워크(캐시 오염 방지).
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  let url; try { url = new URL(e.request.url); } catch (_) { return; }
  if (url.pathname.indexOf('/api/') === 0) { e.respondWith(fetch(e.request)); return; }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then(r => {
      if (r) return r;
      if (e.request.mode === 'navigate') return caches.match('/');
      return new Response('', { status: 504, statusText: 'offline' });
    }))
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
