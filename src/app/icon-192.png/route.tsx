/**
 * Dynamic 192×192 PNG icon, served at /icon-192.png.
 *
 * Linear lavender background + white flame mark — the same artwork
 * as components/BrandLogo so web and home-screen / APK match exactly.
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
        }}
      >
        <svg
          width="140"
          height="140"
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M 50 8 C 32 22, 18 44, 22 64 C 25 82, 38 92, 50 92 C 62 92, 75 82, 78 64 C 82 44, 68 22, 50 8 Z"
            fill="#ffffff"
            opacity="0.95"
          />
          <path
            d="M 50 35 C 42 45, 40 56, 44 66 C 47 74, 52 75, 55 71 C 60 64, 58 47, 50 35 Z"
            fill="#5e6ad2"
          />
        </svg>
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
