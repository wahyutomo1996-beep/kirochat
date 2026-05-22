import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { rateLimit, getClientIp } from '@/lib/ratelimit';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 3 registrations per hour per IP
    const ip = getClientIp(request);
    const rl = rateLimit(`register:${ip}`, 3, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Terlalu banyak registrasi dari IP ini. Coba lagi nanti.` },
        { status: 429 }
      );
    }

    const { email, username, password } = await request.json();

    if (!email || !username || !password) {
      return NextResponse.json({ error: 'Semua field wajib diisi' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
      return NextResponse.json({ error: 'Username hanya boleh huruf, angka, _, - (3-30 karakter)' }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 });
    }

    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return NextResponse.json({ error: 'Email sudah terdaftar' }, { status: 409 });
    }

    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      return NextResponse.json({ error: 'Username sudah dipakai' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        role: 'user',
        status: 'pending',
      },
    });

    return NextResponse.json({
      message: 'Registrasi berhasil. Akun menunggu approval dari admin.',
    });
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
