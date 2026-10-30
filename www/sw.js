// Offline-Fähigkeit und "Teilen an Terminus" unter Android.
const VERSION = 'terminus-v10';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/dates.js', 'js/events.js', 'js/parse.js', 'js/llm.js', 'js/ics.js', 'js/share.js', 'js/store.js', 'js/ocr.js', 'js/config.js', 'js/native.js', 'js/contacts.js', 'js/holidays.js', 'js/hub.js', 'js/calendar.js', 'js/desc.js', 'js/icsimport.js', 'js/unzip.js', 'js/quick.js', 'js/backup.js', 'js/setup.js', 'js/setupdata.js', 'js/abo.js', 'js/aboexport.js', 'js/kanal.js', 'js/kanalui.js', 'js/dokument.js', 'js/pdf.js', 'js/umfrage.js', 'js/umfrageui.js', 'vendor/qrcode/qrcode.js', 'data/ferien.json', 'vendor/capacitor/capacitor.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'terminus-share' && k !== 'terminus-vendor').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function receiveShare(request) {
  const form = await request.formData();
  const cache = await caches.open('terminus-share');
  const file = form.get('image');
  const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n');
  if (file && typeof file !== 'string') await cache.put('shared-image', new Response(file, { headers: { 'Content-Type': file.type } }));
  else if (text) await cache.put('shared-text', new Response(text));
  return Response.redirect('./?shared=1', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;

  // Texterkennung (groß, ändert sich selten): einmal laden, dann aus dem Cache.
  if (url.pathname.includes('/vendor/')) {
    e.respondWith(caches.open('terminus-vendor').then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // App selbst: erst Netz (damit Updates ankommen), sonst Cache.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
