/**
 * Apple touch icon — 180×180 PNG served at /apple-icon.png.
 *
 * iOS Safari uses this for "Add to Home Screen". Without it, iOS
 * generates a screenshot thumbnail which looks bad. 180×180 is the
 * canonical iOS touch icon size since iPhone 6 Plus.
 *
 * iOS doesn't use rounded corners or the maskable spec — we ship a
 * simple full-bleed lavender + wordmark.
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
      width: 180,
      height: 180,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  );
}
