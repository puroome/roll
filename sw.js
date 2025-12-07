// sw.js (네트워크 전용 모드)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // 캐시를 사용하지 않고 무조건 네트워크 요청
  event.respondWith(fetch(event.request));
});