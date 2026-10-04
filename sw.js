// Service worker AS Mésanger – Feuille de match
// Incrémente VERSION à chaque mise en ligne pour que les téléphones récupèrent la nouvelle version.
const VERSION = 'asm-v134';
const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './icons/logo.webp',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/notif-192.png',
  './icons/badge-96.png'
];

self.addEventListener('install', event => {
  // cache: 'reload' : toujours les fichiers frais du serveur (jamais une vieille copie du navigateur)
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(APP_SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Page : copie du téléphone d'abord (ouverture immédiate même avec peu de réseau).
  // Les fichiers en cache sont ceux de cette VERSION : une mise en ligne installe un nouveau service worker
  // avec les nouveaux fichiers, et l'appli propose de relancer.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(VERSION).then(c => c.match('./index.html')).then(hit => hit || fetch(req))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Base de données (Supabase) et fonction d'envoi : jamais en cache, toujours en direct
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  // Fichiers de l'appli : copie de cette VERSION d'abord (pas d'attente du réseau), sinon réseau
  if (sameOrigin) {
    event.respondWith(caches.open(VERSION).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }))
    ));
    return;
  }

  // Polices Google et bibliothèque Supabase : cache d'abord, mis à jour en arrière-plan
  const libs = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
    || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase'));
  if (libs) {
    event.respondWith(
      caches.open(VERSION).then(cache =>
        cache.match(req).then(hit => {
          const net = fetch(req).then(res => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(() => hit);
          return hit || net;
        })
      )
    );
  }
});

// Notifications de but
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'AS Mésanger', {
    body: d.body || '', icon: 'icons/notif-192.png', badge: 'icons/badge-96.png',
    tag: d.tag, data: { url: d.url || './' }, vibrate: [200, 100, 200]
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url || './', self.registration.scope).href;
  // Appli déjà ouverte : on la met au premier plan et on lui dit quelle page afficher
  // (message + navigation en secours) ; sinon on l'ouvre directement sur la bonne page.
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const c = list.find(w => w.url.startsWith(self.registration.scope));
    if (!c) return clients.openWindow(url);
    const w = await c.focus().catch(() => c);
    try { (w || c).postMessage({ type: 'ouvrir', url }); } catch (e) {}
    if (c.navigate && new URL(c.url).hash !== new URL(url).hash) c.navigate(url).catch(() => {});
    return w;
  }));
});
