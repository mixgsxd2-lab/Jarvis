/* Service worker: deixa a tela abrir mesmo sem internet. */
const VERSION = 'ideias-v3';
const SHELL = ['/', '/static/css/app.css', '/static/js/app.js', '/static/icons/icon-192.png', '/static/icons/apple-touch-icon.png', '/manifest.webmanifest'];

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
  if (url.pathname.startsWith('/api/')) return; // dados sempre da rede
  // rede primeiro, cache como reserva (interface sempre atualizada, mas abre offline)
  e.respondWith(fetch(e.request).then((resp) => {
    if (resp.ok && (url.pathname.startsWith('/static/') || url.pathname === '/')) {
      const copy = resp.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return resp;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
