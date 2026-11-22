/* Service worker da central JARVIS: abre offline (interface) e recebe notificações push. */
const VERSION = 'jarvis-v2';
const SHELL = [
  '/', '/static/css/app.css', '/static/js/app.js', '/static/js/core.js', '/static/js/item.js',
  '/static/js/v-today.js', '/static/js/v-tasks.js', '/static/js/v-projects.js', '/static/js/v-ideas.js',
  '/static/js/v-notes.js', '/static/js/v-agenda.js', '/static/js/v-focus.js', '/static/js/v-search.js',
  '/static/js/v-settings.js', '/static/icons/icon-192.png', '/static/icons/icon-512.png',
  '/static/icons/apple-touch-icon.png', '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cron/')) return; // dados sempre da rede
  // rede primeiro, cache como reserva (interface sempre atualizada, mas abre offline)
  e.respondWith(fetch(e.request).then((resp) => {
    if (resp.ok && (url.pathname.startsWith('/static/') || url.pathname === '/')) {
      const copy = resp.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return resp;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: 'JARVIS', body: e.data && e.data.text() }; }
  const title = data.title || 'JARVIS';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/static/icons/icon-192.png',
    badge: '/static/icons/icon-192.png',
    tag: data.tag || undefined,
    requireInteraction: data.kind === 'alarme',
    vibrate: data.kind === 'alarme' ? [400, 200, 400, 200, 400] : [200],
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
