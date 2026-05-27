import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from './lib/auth';
import {
  requiresCsrf,
  readCsrfCookie,
  readCsrfHeader,
  verifyCsrfToken,
  generateCsrfToken,
  CSRF_COOKIE_NAME,
} from './lib/csrf';

/**
 * Auth + CSRF middleware.
 *
 * - Public routes pass through untouched (login/register/health/v1/*).
 * - Protected routes verify the JWT cookie. On failure, redirect to /login
 *   for HTML requests, return 401 JSON for /api requests.
 * - Mutating /api requests (POST/PUT/PATCH/DELETE) must carry a valid
 *   X-CSRF-Token header that matches the 'csrf' cookie. The token is
 *   HMAC-bound to the user, so even leaked tokens from one user can't be
 *   replayed against another.
 * - Authenticated GETs that don't already have a csrf cookie get one set,
 *   so the frontend can read it and echo it back on subsequent mutations.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes - skip everything
  const publicPaths = [
    '/login',
    '/register',
    '/api/auth/login',
    '/api/auth/register',
    '/api/health',
    // Telegram webhook is authenticated by URL secret + X-Telegram-Bot-Api-Secret-Token
    // header (verified inside the route). It must be reachable without our cookie.
    '/api/telegram/webhook/',
  ];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // The /v1 OpenAI gateway uses Bearer-token auth, not cookies. CSRF is
  // not applicable (no ambient credential to confuse-deputy).
  if (pathname.startsWith('/v1/')) {
    return NextResponse.next();
  }

  const token = request.cookies.get('token')?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const payload = await verifyToken(token);
  if (!payload) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Approved-only gate - applies to most routes except /me (so user can
  // read their own approval status) and /change-password (so admin can
  // satisfy mustChangePassword on first login).
  if (
    payload.status !== 'approved' &&
    !pathname.startsWith('/api/auth/me') &&
    !pathname.startsWith('/api/auth/change-password')
  ) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Account not approved' }, { status: 403 });
    }
  }

  // CSRF check on mutating requests. We do this AFTER auth so we know the
  // userId for HMAC verification.
  if (requiresCsrf(request)) {
    const cookieToken = readCsrfCookie(request);
    const headerToken = readCsrfHeader(request);

    // Both must be present and equal AND validate against userId
    if (
      !cookieToken ||
      !headerToken ||
      cookieToken !== headerToken ||
      !(await verifyCsrfToken(headerToken, payload.userId))
    ) {
      return NextResponse.json(
        {
          error: 'CSRF token missing or invalid. Refresh the page and try again.',
          code: 'csrf_failed',
        },
        { status: 403 },
      );
    }
  }

  // Ensure the user has a CSRF cookie on every authenticated response.
  // We set it once per session (when missing). The cookie is NOT httpOnly
  // because the frontend needs to read it to echo back in the header.
  const response = NextResponse.next();
  if (!request.cookies.get(CSRF_COOKIE_NAME)) {
    const csrfToken = await generateCsrfToken(payload.userId);
    response.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
      // NOT httpOnly - frontend reads this to send back as header
      httpOnly: false,
      secure: process.env.AUTH_COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
  }
  return response;
}

export const config = {
  // Cover everything except static assets and the public minimal endpoints
  // (which bail out at the top of the function anyway).
  matcher: [
    '/chat/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/dashboard/:path*',
    '/quota-tracker/:path*',
    '/models/:path*',
    '/api/((?!auth/login|auth/register|health).*)',
  ],
};
