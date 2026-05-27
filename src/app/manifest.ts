/**
 * Dynamic Web App Manifest.
 *
 * Generated at build time and served at /manifest.webmanifest. Tells
 * the browser this is a PWA and how it should behave when installed
 * to the home screen / desktop / app drawer.
 *
 * Why dynamic (not static JSON)?
 *   - Single source of truth: name + theme + icons referenced via
 *     code instead of hand-keeping a JSON in sync with the design.
 *   - Type-checked: missing fields surface at build time.
 *   - Future: per-deploy / per-host overrides if we add multi-tenant.
 *
 * Reference: https://web.dev/articles/add-manifest
 */

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Prometheus — AI Chat & Gateway',
    short_name: 'Prometheus',
    description:
      'Self-hosted multi-provider AI chat with Kiro pool, vision bridge, ' +
      'workspace combos, and OpenAI-compatible gateway.',
    start_url: '/chat',
    display: 'standalone',
    orientation: 'portrait',
    /*
     * Linear DESIGN.md tokens — keep in sync with tailwind.config.js.
     * theme_color colors the Android status bar; background_color is
     * the splash screen behind the launch icon.
     */
    background_color: '#010102',
    theme_color: '#5e6ad2',
    categories: ['productivity', 'developer'],
    icons: [
      // Standard "any" icons — used for home-screen, app drawer, task switcher.
      // Two sizes are the bare minimum required for installability +
      // PWABuilder APK packaging.
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Maskable: Android adaptive icons crop to a circle/squircle. Keep
      // logo content in the inner 80% (safe zone) so cropping doesn't
      // chop the wordmark. We render the same lavender bg with "P"
      // shrunk to fit safe zone in the maskable variant.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Quick-actions when the user long-presses the home screen icon
    // (Android) / right-clicks the dock icon (desktop).
    shortcuts: [
      {
        name: 'New chat',
        short_name: 'Chat',
        url: '/chat',
        description: 'Start a new chat',
      },
      {
        name: 'Quota tracker',
        short_name: 'Quota',
        url: '/quota-tracker',
        description: 'Monitor Kiro account quota',
      },
      {
        name: 'Dashboard',
        short_name: 'Stats',
        url: '/dashboard',
        description: 'Usage analytics',
      },
    ],
  };
}
