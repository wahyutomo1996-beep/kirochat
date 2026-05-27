/**
 * Dynamic 512×512 PNG icon, served at /icon-512.png.
 *
 * Standard "any" purpose icon — full bleed lavender, no safe-zone
 * inset. Used for desktop install + iOS home screen + PWABuilder
 * APK packaging at the largest required size.
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
          fontSize: 350,
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: '-0.05em',
        }}
      >
        P
      </div>
    ),
    {
      width: 512,
      height: 512,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  );
}
