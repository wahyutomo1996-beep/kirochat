import { NextResponse } from 'next/server';
import { requireAuth, generateApiKey } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/api-key - Get the current user's API key (creates one if missing).
 */
export async function GET() {
  try {
    const session = await requireAuth();

    let user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { apiKey: true },
    });

    if (!user?.apiKey) {
      const newKey = generateApiKey();
      user = await prisma.user.update({
        where: { id: session.userId },
        data: { apiKey: newKey },
        select: { apiKey: true },
      });
    }

    return NextResponse.json({ apiKey: user.apiKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

/**
 * POST /api/api-key - Regenerate the user's API key.
 */
export async function POST() {
  try {
    const session = await requireAuth();
    const newKey = generateApiKey();
    await prisma.user.update({
      where: { id: session.userId },
      data: { apiKey: newKey },
    });
    return NextResponse.json({ apiKey: newKey });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
