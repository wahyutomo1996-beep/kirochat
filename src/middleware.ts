import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from './lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes
  const publicPaths = ['/login', '/register', '/api/auth/login', '/api/auth/register'];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check auth for protected routes
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

  // Check if user is approved (except for /api/auth/me)
  if (payload.status !== 'approved' && !pathname.startsWith('/api/auth/me')) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Account not approved' }, { status: 403 });
    }
    // Could redirect to a "pending" page
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/chat/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/api/chat/:path*',
    '/api/conversations/:path*',
    '/api/providers/:path*',
    '/api/admin/:path*',
    '/api/auth/me',
  ],
};
