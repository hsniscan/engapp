/* Engapp Web Push handlers (v0.3 İP8, docs/decisions/0024-web-push.md).
 * Loaded into the generated service worker with workbox `importScripts` (vite.config.ts).
 * Plain JS on purpose: it runs in the worker as is. Tested by src/features/notify/sw.test.ts.
 */
(function (sw) {
  'use strict';

  /** Only same-site paths; anything else opens the study screen. */
  function safePath(url) {
    return typeof url === 'string' && url.charAt(0) === '/' && url.charAt(1) !== '/'
      ? url
      : '/study';
  }

  sw.addEventListener('push', function (event) {
    var data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      data = { body: event.data ? event.data.text() : '' };
    }
    var title = typeof data.title === 'string' && data.title ? data.title : 'Engapp';
    event.waitUntil(
      sw.registration.showNotification(title, {
        body: typeof data.body === 'string' ? data.body : '',
        tag: typeof data.tag === 'string' && data.tag ? data.tag : 'engapp',
        lang: 'tr',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: safePath(data.url) },
      }),
    );
  });

  sw.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var path = safePath(event.notification.data && event.notification.data.url);
    event.waitUntil(
      sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        for (var i = 0; i < list.length; i++) {
          var client = list[i];
          if (new URL(client.url).origin === sw.location.origin && 'focus' in client) {
            // The open app routes in place (src/features/notify/start.ts): no reload, no lost state.
            client.postMessage({ type: 'engapp:navigate', url: path });
            return client.focus();
          }
        }
        return sw.clients.openWindow(path);
      }),
    );
  });
})(self);
