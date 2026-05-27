/**
 * Dynamic 192×192 PNG icon, served at /icon-192.png.
 *
 * Renders a Linear-lavender square with the Prometheus "P" wordmark
 * via Next.js ImageResponse — no binary PNG assets in the repo.
 *
 * Used by manifest.ts (PWA install icon) + browsers as a favicon
 * fallback at standard Android home-screen size.
 */

import { ImageResponse } from 'next/og';

// Force runtime generation; @vercel/og's prerender path resolver
// breaks on Windows directory paths containing spaces. Generated on
// first request + cached via Cache-Control header below.
export const dynamic = 'force-dynamic';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #5e6ad2 0%, #828fff 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 130,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '-0.05em',
        }}
      >
        P
      </div>
    ),
    {
      width: 192,
      height: 192,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  );
}
