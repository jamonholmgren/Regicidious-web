const CACHE = 'regicidious-v58';
const ASSETS = ['./', './index.html', './style.css?v=58', './extras.css?v=58', './arena.css?v=58', './polish.css?v=58', './codec.js?v=58', './link.js?v=58', './scores.js?v=58', './rating.js?v=58', './app.js?v=58', './manifest.webmanifest?v=58', './icon.svg', './icon-180.png'];
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
