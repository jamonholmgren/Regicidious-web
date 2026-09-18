const CACHE = 'regicidious-v33';
const ASSETS = ['./', './index.html', './style.css', './extras.css', './arena.css?v=20', './polish.css?v=23', './codec.js?v=19', './link.js', './scores.js?v=1', './rating.js?v=1', './app.js?v=33', './manifest.webmanifest', './icon.svg', './icon-180.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request,response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
});
