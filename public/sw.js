/* GrandMaster dependency-free offline worker.
 * The install caches the shell. A player-triggered CACHE_APP message crawls
 * Vite's emitted module graph so lazy routes, workers and artwork are cached
 * without relying on a build-time manifest plugin. */
const VERSION = 'gm-offline-v1';
const CORE_CACHE = `${VERSION}-core`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const APP_CACHE = `${VERSION}-app`;
const SCOPE = self.registration.scope;
const scoped = (path) => new URL(path, SCOPE).toString();
const CORE = ['', 'index.html', 'manifest.webmanifest', 'favicon.svg', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/maskable-512.png'].map(scoped);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then(async (cache) => {
        const responses = await Promise.allSettled(CORE.map(async (url) => {
          const response = await fetch(url, { cache: 'reload' });
          if (response.ok) await cache.put(url, response);
        }));
        return responses;
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('gm-offline-') && ![CORE_CACHE, RUNTIME_CACHE, APP_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      )),
      self.clients.claim(),
    ]),
  );
});

function isWithinApp(url) {
  return url.origin === self.location.origin && url.href.startsWith(SCOPE);
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request)
      || await caches.match(scoped('index.html'))
      || await caches.match(scoped(''));
    return cached || new Response('GrandMaster is offline.', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  // Full-library downloads live in APP_CACHE, while previously visited assets
  // may live in RUNTIME_CACHE. Search every current cache before going online.
  const cached = await caches.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.ok) void cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await refresh || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isWithinApp(url)) return;
  if (url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (/\.(?:js|css)$/i.test(url.pathname)
    || /\.(?:webp|png|svg|woff2?|wasm)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

function discoverUrls(text, baseUrl) {
  const found = new Set();
  const patterns = [
    /(?:src|href)=["']([^"'#]+)["']/gi,
    /["'`](\.{0,2}\/[^"'`?#]+\.(?:js|css|webp|png|svg|woff2?|wasm))[^"'`]*["'`]/gi,
    /["'`](\/[^"'`?#]+\.(?:js|css|webp|png|svg|woff2?|wasm))[^"'`]*["'`]/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      try {
        const url = new URL(match[1], baseUrl);
        if (isWithinApp(url)) found.add(url.toString());
      } catch {
        // Ignore malformed source fragments from minified modules.
      }
    }
  }
  return [...found];
}

async function cacheCompleteApp() {
  const cache = await caches.open(APP_CACHE);
  const queue = [scoped(''), scoped('index.html'), ...CORE];
  const seen = new Set();
  let cachedCount = 0;
  while (queue.length && seen.size < 420) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) continue;
      await cache.put(url, response.clone());
      cachedCount += 1;
      const type = response.headers.get('content-type') || '';
      if (type.includes('javascript') || type.includes('css') || type.includes('html')) {
        const text = await response.text();
        for (const discovered of discoverUrls(text, url)) {
          if (!seen.has(discovered)) queue.push(discovered);
        }
      }
    } catch {
      // One optional asset should not abort the rest of the offline library.
    }
  }
  return cachedCount > CORE.length;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
  if (event.data?.type !== 'CACHE_APP') return;
  const port = event.ports?.[0];
  event.waitUntil(
    cacheCompleteApp()
      .then((ok) => port?.postMessage({ type: 'CACHE_APP_DONE', ok }))
      .catch(() => port?.postMessage({ type: 'CACHE_APP_DONE', ok: false })),
  );
});
