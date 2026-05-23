import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * DELETE /api/kiro-accounts/[id] - Remove a specific Kiro account.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const session = await requireAuth();
    const { id } = params;

    const account = await prisma.kiroAccount.findFirst({
      where: { id, userId: session.userId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await prisma.kiroAccount.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

/**
 * PATCH /api/kiro-accounts/[id] - Update account status (e.g. reactivate).
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const session = await requireAuth();
    const { id } = params;
    const body = await request.json();

    const account = await prisma.kiroAccount.findFirst({
      where: { id, userId: session.userId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (body.status === 'active') {
      updates.status = 'active';
      updates.exhaustedAt = null;
    } else if (body.status === 'exhausted') {
      updates.status = 'exhausted';
      updates.exhaustedAt = new Date();
    }

    const updated = await prisma.kiroAccount.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      email: updated.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
