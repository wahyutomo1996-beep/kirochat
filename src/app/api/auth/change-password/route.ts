/**
 * Change password endpoint.
 *
 * Required when mustChangePassword=true on the user record (default admin
 * after first seed). Also usable as a regular self-service password change.
 *
 * Verifies the current password before accepting the new one. Updates the
 * hash, clears mustChangePassword, and returns success.
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/ratelimit';
import { apiError } from '@/lib/http';

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Rate-limit per-user to slow brute force of current password
    const ip = getClientIp(request);
    const rl = rateLimit(`pwchg:${session.userId}:${ip}`, 5, 5 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(rl.resetIn / 1000)} detik.` },
        { status: 429 },
      );
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'currentPassword and newPassword required' },
        { status: 400 },
      );
    }

    if (newPassword.length < 10) {
      return NextResponse.json(
        { error: 'Password baru minimal 10 karakter' },
        { status: 400 },
      );
    }
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: 'Password baru tidak boleh sama dengan password lama' },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const currentValid = await bcrypt.compare(currentPassword, user.password);
    if (!currentValid) {
      return NextResponse.json({ error: 'Password lama salah' }, { status: 401 });
    }

    const hashedNew = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: session.userId },
      data: {
        password: hashedNew,
        mustChangePassword: false,
      },
    });

    return NextResponse.json({ ok: true, message: 'Password berhasil diubah' });
  } catch (err) {
    return apiError(err);
  }
}
