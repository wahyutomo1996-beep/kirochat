import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encryption';
import { validateKiroToken } from '@/lib/kiro-pool';
import { createHash } from 'crypto';

/**
 * Compute a stable fingerprint for a refresh token (for duplicate detection
 * without storing the plain token). We use SHA-256 of the original token.
 */
function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

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
 *
 * Accepts:
 *   - { refreshToken: "tok" } - single token
 *   - { refreshToken: "tok1\ntok2\n..." } - newline-separated batch
 *   - { refreshTokens: ["tok1", "tok2"] } - array of tokens
 *
 * Each token is validated by attempting a refresh. Duplicates are detected
 * via SHA-256 fingerprint of the original token (not the rotated one).
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

    // De-duplicate within the input batch first
    const seenFp = new Set<string>();
    tokens = tokens.filter(t => {
      const fp = tokenFingerprint(t);
      if (seenFp.has(fp)) return false;
      seenFp.add(fp);
      return true;
    });

    // Get existing fingerprints for this user (to detect duplicates against DB)
    const existing = await prisma.kiroAccount.findMany({
      where: { userId: session.userId },
      select: { refreshToken: true },
    });
    const existingFps = new Set<string>();
    for (const e of existing) {
      try {
        const dec = decrypt(e.refreshToken);
        existingFps.add(tokenFingerprint(dec));
      } catch {}
    }

    const added: Array<{ id: string; email: string | null; index: number }> = [];
    const errors: Array<{ index: number; preview: string; error: string }> = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const preview = token.slice(0, 16) + '...';

      try {
        // Skip duplicate by fingerprint
        if (existingFps.has(tokenFingerprint(token))) {
          errors.push({ index: i, preview, error: 'duplicate (already in pool)' });
          continue;
        }

        const validation = await validateKiroToken(token);
        if (!validation.valid) {
          errors.push({ index: i, preview, error: validation.error || 'invalid' });
          continue;
        }

        // After Kiro rotates the refresh token, also check if rotated version is dup
        const finalRefreshToken = validation.newRefreshToken || token;
        const rotatedFp = tokenFingerprint(finalRefreshToken);
        if (existingFps.has(rotatedFp)) {
          errors.push({ index: i, preview, error: 'duplicate (rotated to existing token)' });
          continue;
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
        added.push({ id: account.id, email: account.email, index: i });
        existingFps.add(rotatedFp);
      } catch (e) {
        errors.push({ index: i, preview, error: (e as Error).message });
      }
    }

    return NextResponse.json({
      total: added.length,
      added,
      errors,
      summary: `${added.length} added, ${errors.length} skipped`,
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
