// Service worker PWA relawan: cangkang aplikasi tersedia tanpa jaringan,
// sehingga halaman "Bawa data" tetap terbuka saat ponsel jauh dari sekolah.
const CACHE = 'lentera-relawan-v1';
const SHELL = ['/relawan', '/staf.js', '/staf.css', '/ui/lentera.css', '/ui/app.js', '/ui/chart.js', '/ui/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isShell = SHELL.includes(url.pathname);
  if (!isShell) return; // data API selalu ke jaringan
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
