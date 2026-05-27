/**
 * Maskable 512×512 PNG icon — Android adaptive icon variant.
 *
 * Android crops adaptive icons to a circle, squircle, rounded square,
 * etc. depending on the launcher. The "safe zone" for content is the
 * inner 80% (40% radius from center). Anything outside may be clipped.
 *
 * This icon shrinks the wordmark + adds bleed padding so the lavender
 * background fills the maskable canvas while the "P" stays visible
 * regardless of the launcher's mask shape.
 *
 * Reference: https://web.dev/articles/maskable-icon
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
          background: '#5e6ad2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/*
          Inner safe-zone block. 80% of the canvas guarantees the
          wordmark survives every Android mask shape.
        */}
        <div
          style={{
            width: '80%',
            height: '80%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #5e6ad2 0%, #828fff 100%)',
            borderRadius: '20%',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 240,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-0.05em',
          }}
        >
          P
        </div>
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
