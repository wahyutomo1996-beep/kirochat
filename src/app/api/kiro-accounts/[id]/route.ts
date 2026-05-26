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
 * PATCH /api/kiro-accounts/[id] - Update account status or daily limit.
 *
 * Body keys handled (any combination):
 *   status: 'active'    Verified reactivate (probes Kiro)
 *   status: 'exhausted' Mark exhausted manually
 *   dailyLimit: number | null
 *     Per-account daily request limit. null = unlimited.
 *     Used for observability ("X / Y left today") - NOT a hard
 *     server-side gate, real exhaust still relies on actual Kiro 429s.
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

    // Handle dailyLimit update independently from status (can be set in
    // same call or alone).
    if (Object.prototype.hasOwnProperty.call(body, 'dailyLimit')) {
      const raw = body.dailyLimit;
      let dailyLimit: number | null = null;
      if (raw === null || raw === '' || raw === undefined) {
        dailyLimit = null;
      } else {
        const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return NextResponse.json(
            { error: 'dailyLimit must be a non-negative integer or null' },
            { status: 400 },
          );
        }
        // Cap at a sane ceiling so a typo cant store 999999999
        if (parsed > 1_000_000) {
          return NextResponse.json(
            { error: 'dailyLimit too large (max 1,000,000)' },
            { status: 400 },
          );
        }
        dailyLimit = parsed === 0 ? null : parsed;
      }
      await prisma.kiroAccount.update({
        where: { id },
        data: { dailyLimit },
      });
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
        dailyLimit: updated!.dailyLimit,
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
        dailyLimit: updated.dailyLimit,
      });
    }

    // No status change but dailyLimit may have been updated above.
    if (Object.prototype.hasOwnProperty.call(body, 'dailyLimit')) {
      const updated = await prisma.kiroAccount.findUnique({ where: { id } });
      return NextResponse.json({
        id: updated!.id,
        status: updated!.status,
        email: updated!.email,
        dailyLimit: updated!.dailyLimit,
      });
    }

    return NextResponse.json(
      { error: 'No supported field provided. Use status or dailyLimit.' },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
