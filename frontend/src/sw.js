import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

precacheAndRoute(self.__WB_MANIFEST);

// 오프라인 1단계: 현재 사용자 조회(GET /api/auth/me)를 NetworkFirst로 캐싱.
// 온라인이면 항상 서버 응답을 쓰고 캐시를 갱신, 오프라인(또는 5초 무응답)이면
// 마지막 성공 응답을 반환한다. 실패 응답(401 등)은 Workbox 기본 동작상 캐시되지 않는다.
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    request.method === 'GET' &&
    url.pathname === '/api/auth/me',
  new NetworkFirst({
    cacheName: 'api-read-cache',
    networkTimeoutSeconds: 5,
  })
);

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '알림', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || '알림', {
      body: data.body || '',
      icon: '/icon.svg',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
