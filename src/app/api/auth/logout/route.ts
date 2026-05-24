/**
 * Logout endpoint.
 *
 * Clears the auth + CSRF cookies. The session JWT itself can't be
 * revoked (we don't keep a denylist) but expiring the cookie is enough
 * for normal logout — attacker would need to have stolen the cookie
 * before this call to keep using it.
 */

import { NextResponse } from 'next/server';
import { CSRF_COOKIE_NAME } from '@/lib/csrf';

export async function POST() {
  const response = NextResponse.json({ ok: true });

  // Both cookies cleared by setting maxAge=0
  response.cookies.set('token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  response.cookies.set(CSRF_COOKIE_NAME, '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  return response;
}
