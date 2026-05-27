/**
 * Service Worker — minimal PWA shell + offline fallback.
 *
 * Strategy:
 *   1. Pre-cache the app shell (manifest, icons, root HTML) on install
 *      so the user can launch the app offline and see the chrome.
 *   2. Network-first for everything else with a cache fallback. Most
 *      pages are dynamic (chat history, dashboard data) so we always
 *      try the network first; only when offline do we serve a cached
 *      copy or the offline page.
 *   3. Bypass the SW for /api/* entirely — chat streams (SSE) cannot
 *      be intercepted reliably and we don't want stale auth responses.
 *   4. Bypass for Next.js _next/static/* — those have content-hashed
 *      filenames that browsers cache themselves.
 *
 * Bumping CACHE_VERSION invalidates old caches on next install,
 * triggering a clean re-cache (use after major UI updates).
 */

const CACHE_VERSION = 'prometheus-v2-flame';
const PRECACHE_URLS = [
  '/',
  '/login',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Precache the shell. addAll is atomic — if any URL fails the whole
  // cache is rejected, which is what we want: a half-broken cache is
  // worse than no cache.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  // Activate this SW immediately on install instead of waiting for
  // existing tabs to close. Combined with clients.claim() below, the
  // first install behaves like the user expects: refresh the page,
  // PWA installable.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Drop old cache versions when a new SW activates.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Always bypass for API routes — chat SSE, auth, anything stateful.
  if (url.pathname.startsWith('/api/')) return;

  // 2. Bypass for /v1 OpenAI-compat endpoints (streamed Bearer auth).
  if (url.pathname.startsWith('/v1/')) return;

  // 3. Bypass for Next.js content-hashed static chunks — they have their
  //    own immutable cache headers, double-caching only wastes space.
  if (url.pathname.startsWith('/_next/static/')) return;

  // 4. Bypass for non-GET — POST/PUT/DELETE never cache.
  if (request.method !== 'GET') return;

  // 5. Bypass for cross-origin requests (Telegram API, sentry, etc.).
  if (url.origin !== self.location.origin) return;

  // Network-first with cache fallback for everything else (HTML pages,
  // RSC payloads, fonts, dynamic icons).
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache complete 200 OK responses.
        if (response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // No network + no cache: for navigations, fall back to root
          // page (which is itself cached); for assets, let it fail.
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('', { status: 504 });
        }),
      ),
  );
});
