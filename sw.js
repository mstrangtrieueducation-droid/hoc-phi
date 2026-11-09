// Keeps this app's own files on the device so the page opens at once, even after a long pause (owner 09/11: "vẫn bị một khoảng trắng
// khi mở web... lần sau thì mới nhanh"). Each open shows the copy kept here and fetches the files again behind it; when a file has
// changed, the page is told and reloads itself while it is still just opening. Only this app's own files are kept: data from Google
// (Apps Script, Sheets) and sign-in never pass through here, and fonts are kept only as the browser fetched them.
const CACHE = 'app-' + new URL(self.registration.scope).pathname.replace(/\W+/g, '-');
const SHELL = ['./', './index.html'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keep = new Set([CACHE, 'fonts']);
  for (const k of await caches.keys()) if (k.startsWith('app-') && !keep.has(k)) await caches.delete(k);
  await self.clients.claim();
})()));
const isFont = u => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
async function tell(msg) { for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(msg); }
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET') return;
  if (isFont(u)) {
    e.respondWith(caches.open('fonts').then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })));
    return;
  }
  if (u.origin !== self.location.origin || !u.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (/\/dev\//.test(u.pathname)) return;
  const page = req.mode === 'navigate';
  const key = new Request(u.origin + u.pathname + (page ? '' : u.search));
  e.respondWith((async () => {
    const cache = await caches.open(CACHE), kept = await cache.match(key);
    const fresh = fetch(req.url.split('#')[0], { cache: 'no-cache' }).then(async r => {
      if (r.ok && r.type === 'basic') {
        if (kept && /html|javascript|css/.test(r.headers.get('content-type') || '')) {
          const [a, b] = await Promise.all([kept.clone().text(), r.clone().text()]);
          if (a !== b) tell({ type: 'app-updated', path: u.pathname });
        }
        await cache.put(key, r.clone());
      }
      return r;
    });
    if (kept) { e.waitUntil(fresh.catch(() => {})); return kept; }
    return fresh;
  })());
});
