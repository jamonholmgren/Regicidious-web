const CACHE = 'regicidious-v57';
const ASSETS = ['./', './index.html', './style.css?v=57', './extras.css?v=57', './arena.css?v=57', './polish.css?v=57', './codec.js?v=57', './link.js?v=57', './scores.js?v=57', './rating.js?v=57', './app.js?v=57', './manifest.webmanifest?v=57', './icon.svg', './icon-180.png'];
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
