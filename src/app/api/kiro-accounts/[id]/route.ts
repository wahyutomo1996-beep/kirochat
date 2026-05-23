import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tryReviveAccount } from '@/lib/kiro-pool';

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
 * PATCH /api/kiro-accounts/[id] - Update account status.
 *
 * When the user reactivates, we don't just blindly flip the status flag —
 * we probe Kiro to verify the refresh token actually works. If it does,
 * the account comes back with fresh tokens; if not, we surface the auth
 * error so the user knows why it's still dead.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const session = await requireAuth();
    const { id } = params;
    const body = await request.json().catch(() => ({}));

    const account = await prisma.kiroAccount.findFirst({
      where: { id, userId: session.userId },
    });
    if (!account) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (body.status === 'active') {
      // Verified reactivate: actually probe Kiro to confirm token still works.
      const result = await tryReviveAccount(id);
      if (!result.revived) {
        return NextResponse.json(
          {
            error: 'Reactivation failed - Kiro refused the refresh token',
            detail: result.error,
          },
          { status: 400 },
        );
      }
      const updated = await prisma.kiroAccount.findUnique({ where: { id } });
      return NextResponse.json({
        id: updated!.id,
        status: updated!.status,
        email: updated!.email,
        revived: true,
      });
    }

    if (body.status === 'exhausted') {
      const updated = await prisma.kiroAccount.update({
        where: { id },
        data: { status: 'exhausted', exhaustedAt: new Date() },
      });
      return NextResponse.json({
        id: updated.id,
        status: updated.status,
        email: updated.email,
      });
    }

    return NextResponse.json(
      { error: 'Unsupported status. Use "active" or "exhausted".' },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
