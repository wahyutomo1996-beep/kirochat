/**
 * Login endpoint.
 *
 * Accepts EITHER email OR username in the `identifier` field (also still
 * accepts legacy `email` field for backward compat). The lookup uses
 * findFirst with an OR clause so users can log in with whichever they
 * remember.
 *
 * SECURITY:
 *   - Per-IP rate limit (5/min) to slow credential stuffing
 *   - Constant-time bcrypt compare against a dummy hash if user not found
 *     so response time doesnt leak whether the identifier is registered
 *   - mustChangePassword flag forces password change on next login
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/ratelimit';
import { generateCsrfToken, CSRF_COOKIE_NAME } from '@/lib/csrf';

/**
 * Pre-computed dummy bcrypt hash so the not-found path performs the same
 * work as the real path (constant-time defense).
 */
const DUMMY_HASH = '$2a$12$Y4Zj3yTvSXP3y1i6L0fnruhSh.qVFc.8wuk.2d1r3o2j9xkF5pQXa';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = rateLimit(`login:${ip}`, 5, 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(rl.resetIn / 1000)} detik.` },
        { status: 429 },
      );
    }

    const body = await request.json();
    // Accept either `identifier` (new) or `email` (legacy). Whichever is
    // present, treat it as "either email or username".
    const identifierRaw: unknown = body.identifier ?? body.email ?? body.username;
    const password: unknown = body.password;

    if (typeof identifierRaw !== 'string' || typeof password !== 'string' || !identifierRaw.trim() || !password) {
      return NextResponse.json(
        { error: 'Email/username dan password wajib diisi' },
        { status: 400 },
      );
    }

    // Normalize: trim + lowercase email portion so case differences dont
    // block login. Username we keep as-is because schema enforces uniqueness
    // case-insensitively at app layer (lowercase only allowed via register).
    const identifier = identifierRaw.trim();
    const looksLikeEmail = identifier.includes('@');

    // Use findFirst with OR — still O(1) because both columns are unique
    // indexed. The whichever-wins lookup means typing email or username
    // both resolve to the same row.
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: looksLikeEmail ? identifier.toLowerCase() : identifier },
          { username: identifier },
        ],
      },
    });

    // Constant-time bcrypt compare to defeat timing-based enumeration
    const valid = user
      ? await bcrypt.compare(password, user.password)
      : (await bcrypt.compare(password, DUMMY_HASH), false);

    if (!user || !valid) {
      return NextResponse.json({ error: 'Email/username atau password salah' }, { status: 401 });
    }

    if (user.status === 'pending') {
      return NextResponse.json({ error: 'Akun belum di-approve oleh admin' }, { status: 403 });
    }
    if (user.status === 'banned') {
      return NextResponse.json({ error: 'Akun telah dinonaktifkan' }, { status: 403 });
    }

    const token = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    });

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.AUTH_COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    response.cookies.set(CSRF_COOKIE_NAME, await generateCsrfToken(user.id), {
      httpOnly: false,
      secure: process.env.AUTH_COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
