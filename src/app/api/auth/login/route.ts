/**
 * Login endpoint.
 *
 * SECURITY:
 *   - Per-IP rate limit (5/min) to slow credential stuffing
 *   - Constant-time bcrypt compare against a dummy hash if user not found,
 *     so response time doesn't leak whether email is registered
 *   - mustChangePassword flag forces password change on next login - the
 *     UI sees this in the response and routes to a change-password screen
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/ratelimit';
import { generateCsrfToken, CSRF_COOKIE_NAME } from '@/lib/csrf';

/**
 * Pre-computed dummy bcrypt hash so the not-found path performs the same
 * work as the real path (constant-time defense). The hash is for the
 * literal string "dummy" with cost 12.
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

    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email dan password wajib diisi' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Constant-time path: ALWAYS run bcrypt.compare. If user not found, run
    // it against a dummy hash. Total wall-clock time is ~150ms either way,
    // so attackers can't enumerate emails by timing.
    const valid = user
      ? await bcrypt.compare(password, user.password)
      : (await bcrypt.compare(password, DUMMY_HASH), false);

    if (!user || !valid) {
      return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 });
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    // Set CSRF cookie alongside session — frontend reads this and echoes
    // it back in X-CSRF-Token on every mutating request.
    response.cookies.set(CSRF_COOKIE_NAME, await generateCsrfToken(user.id), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
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
