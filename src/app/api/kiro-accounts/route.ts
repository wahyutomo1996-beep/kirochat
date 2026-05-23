import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encryption';
import { validateKiroToken } from '@/lib/kiro-pool';

/**
 * GET /api/kiro-accounts - List all Kiro accounts for the current user.
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const accounts = await prisma.kiroAccount.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
    });

    // Mask refresh tokens in response
    const safe = accounts.map(a => ({
      id: a.id,
      email: a.email,
      status: a.status,
      usageCount: a.usageCount,
      lastUsed: a.lastUsed,
      tokenExpiresAt: a.tokenExpiresAt,
      exhaustedAt: a.exhaustedAt,
      createdAt: a.createdAt,
      // Show only first/last chars of token
      refreshTokenPreview: (() => {
        try {
          const dec = decrypt(a.refreshToken);
          return `${dec.slice(0, 12)}...${dec.slice(-8)}`;
        } catch { return '***'; }
      })(),
    }));

    return NextResponse.json({ accounts: safe });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

/**
 * POST /api/kiro-accounts - Add one or more Kiro refresh tokens.
 * Body: { refreshToken: string } or { refreshTokens: string[] }
 *       Supports newline-separated tokens too.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json();

    // Accept multiple input formats
    let tokens: string[] = [];
    if (body.refreshToken) {
      tokens = String(body.refreshToken)
        .split(/\r?\n/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(body.refreshTokens)) {
      tokens = body.refreshTokens.map((t: unknown) => String(t).trim()).filter(Boolean);
    }

    if (tokens.length === 0) {
      return NextResponse.json({ error: 'refreshToken required' }, { status: 400 });
    }

    const added: Array<{ id: string; email: string | null }> = [];
    const errors: Array<{ token: string; error: string }> = [];

    for (const token of tokens) {
      try {
        const validation = await validateKiroToken(token);
        if (!validation.valid) {
          errors.push({ token: token.slice(0, 16) + '...', error: validation.error || 'invalid' });
          continue;
        }

        const finalRefreshToken = validation.newRefreshToken || token;

        // Skip duplicate (same encrypted refresh token by email)
        if (validation.email) {
          const existing = await prisma.kiroAccount.findFirst({
            where: { userId: session.userId, email: validation.email },
          });
          if (existing) {
            errors.push({ token: token.slice(0, 16) + '...', error: `duplicate (already exists for ${validation.email})` });
            continue;
          }
        }

        const account = await prisma.kiroAccount.create({
          data: {
            userId: session.userId,
            refreshToken: encrypt(finalRefreshToken),
            accessToken: validation.accessToken ? encrypt(validation.accessToken) : null,
            tokenExpiresAt: validation.accessToken ? new Date(Date.now() + 3600_000) : null,
            email: validation.email || null,
            status: 'active',
          },
        });
        added.push({ id: account.id, email: account.email });
      } catch (e) {
        errors.push({ token: token.slice(0, 16) + '...', error: (e as Error).message });
      }
    }

    return NextResponse.json({
      total: added.length,
      added,
      errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

/**
 * DELETE /api/kiro-accounts - Delete all accounts for the user.
 */
export async function DELETE() {
  try {
    const session = await requireAuth();
    const result = await prisma.kiroAccount.deleteMany({
      where: { userId: session.userId },
    });
    return NextResponse.json({ deleted: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
