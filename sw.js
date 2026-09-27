// Service worker AS Mésanger – Feuille de match
// Incrémente VERSION à chaque mise en ligne pour que les téléphones récupèrent la nouvelle version.
const VERSION = 'asm-v4';
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
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
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

  // Page : réseau d'abord (pour avoir la dernière version), cache si pas de réseau
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Base de données (Supabase) : jamais en cache, toujours en direct
  // Polices Google, bibliothèque Supabase et fichiers de l'appli : cache d'abord, mis à jour en arrière-plan
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
    || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase'));
  if (sameOrigin || fonts) {
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
