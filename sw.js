/* Study Planner – Service Worker (offline-first)
   Đặt cùng thư mục với index.html. Khi sửa index.html, tăng số phiên bản CACHE để dọn cache cũ. */
const CACHE = 'study-planner-v1';
const SCOPE = self.registration.scope;
const ROOT = SCOPE;                                  // "https://site/"
const INDEX = new URL('./index.html', SCOPE).href;   // "https://site/index.html"
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* Response đã qua redirect không dùng được cho điều hướng -> tạo bản sạch */
async function clean(res) {
  if (!res || !res.redirected) return res;
  const body = await res.clone().blob();
  return new Response(body, { status: 200, statusText: 'OK', headers: res.headers });
}

/* Tải và lưu 1 URL, lỗi thì bỏ qua (không làm hỏng quá trình cài đặt) */
async function safeAdd(cache, url, key) {
  try {
    const res = await clean(await fetch(url, { cache: 'reload' }));
    if (res && res.ok) { await cache.put(key || url, res); return res; }
  } catch (e) { /* offline hoặc tài nguyên lỗi: bỏ qua */ }
  return null;
}

/* Tải trước CSS font + các file woff2 trong đó để font hiện cả khi mất mạng */
async function precacheFonts(cache) {
  try {
    const res = await fetch(FONT_CSS, { mode: 'cors' });
    if (!res.ok) return;
    const css = await res.clone().text();
    await cache.put(FONT_CSS, res);
    const urls = [...new Set([...css.matchAll(/url\(\s*['"]?(https:[^)'"\s]+)['"]?\s*\)/g)].map(m => m[1]))];
    await Promise.all(urls.map(u => safeAdd(cache, u)));
  } catch (e) { /* bỏ qua */ }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all([
      safeAdd(cache, ROOT),
      safeAdd(cache, INDEX),
      precacheFonts(cache)
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('study-planner-') && k !== CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Stale-while-revalidate: trả bản cache ngay, đồng thời cập nhật nền */
async function swr(event, req, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key || req, { ignoreVary: true });
  const update = fetch(req).then(async res => {
    const r = await clean(res);
    if (r && (r.ok || r.type === 'opaque')) {
      await cache.put(key || req, r.clone());
      if (key === INDEX) await cache.put(ROOT, r.clone());
    }
    return r;
  }).catch(() => null);
  if (cached) { event.waitUntil(update); return cached; }
  return (await update) || null;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* Điều hướng (mở app): cache trước, mất mạng vẫn mở được index.html */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const res = await swr(event, req, INDEX);
      if (res) return res;
      const cache = await caches.open(CACHE);
      return (await cache.match(ROOT, { ignoreVary: true })) ||
        new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  /* File nội bộ + Google Fonts: stale-while-revalidate */
  if (url.origin === self.location.origin || FONT_HOSTS.includes(url.hostname)) {
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith((async () => {
      const res = await swr(event, req);
      return res || new Response('', { status: 504, statusText: 'Offline' });
    })());
  }
  /* Các yêu cầu khác: để trình duyệt xử lý bình thường */
});
