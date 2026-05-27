'use client';

/**
 * Service Worker registration. Mounted once at the app root so the
 * browser knows about /sw.js after the first page load. After
 * installation, all subsequent navigations go through the SW shell
 * cache for offline fallback.
 *
 * Why a client component instead of inline <script>?
 *   - useEffect ensures registration runs only on the client (SW
 *     APIs don't exist server-side).
 *   - Production-only guard: dev builds register a dummy SW that
 *     can leave the app stuck on stale chunks.
 *   - One-time registration; React's StrictMode double-mount is
 *     idempotent because navigator.serviceWorker.register() returns
 *     the existing registration when called twice.
 */

import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      process.env.NODE_ENV !== 'production'
    ) {
      return;
    }
    // Register on idle / page-load idle to avoid blocking initial paint.
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // Non-fatal — app works without the SW, user just doesn't get
          // offline shell. Log for debugging in production console.
          // eslint-disable-next-line no-console
          console.warn('[Prometheus] SW registration failed:', err);
        });
    };
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  }, []);

  return null;
}
