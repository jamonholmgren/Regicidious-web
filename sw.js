const CACHE = 'regicidious-v61';
const ASSETS = ['./', './index.html', './style.css?v=61', './extras.css?v=61', './arena.css?v=61', './polish.css?v=61', './codec.js?v=61', './link.js?v=61', './scores.js?v=61', './rating.js?v=61', './app.js?v=61', './manifest.webmanifest?v=61', './icon.svg', './icon-180.png'];
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
