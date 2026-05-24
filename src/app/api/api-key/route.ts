/**
 * API Key management.
 *
 * SECURITY: We never store plain API keys. The plain key is generated on
 * demand, hashed via SHA-256, and only the hash is persisted. The user
 * sees their plain key once (at GET if first-time, or at POST regenerate)
 * — after that we can only show whether one is set.
 */

import { NextResponse } from 'next/server';
import { requireAuth, generateApiKey, hashApiKey } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/http';

/**
 * GET /api/api-key
 *
 * Returns the user's API key. Behavior:
 *   - If the user has no key yet, we mint one, hash+store it, and return
 *     the plain key (this is the only chance to see it).
 *   - If the user already has a key (hash present), we cannot recover the
 *     plain value. We return a sentinel masked indicator instead. The user
 *     must regenerate (POST) to get a new plain key.
 *
 * The first-time mint path is necessary so users get a key automatically
 * on first visit to Settings without an explicit "create key" action.
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { apiKeyHash: true },
    });

    // First-time mint: generate, hash+store, return the plain key
    if (!user?.apiKeyHash) {
      const plain = generateApiKey();
      await prisma.user.update({
        where: { id: session.userId },
        data: { apiKeyHash: hashApiKey(plain) },
      });
      return NextResponse.json({ apiKey: plain, isNew: true });
    }

    // Existing key: we don't have the plain value anymore. Return a masked
    // marker so the UI can show "•••••••" and offer regenerate.
    return NextResponse.json({ apiKey: null, hasKey: true, isNew: false });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * POST /api/api-key
 *
 * Regenerate. Returns the plain key (shown once). Old key stops working
 * immediately because we overwrite the hash.
 */
export async function POST() {
  try {
    const session = await requireAuth();
    const plain = generateApiKey();
    await prisma.user.update({
      where: { id: session.userId },
      data: { apiKeyHash: hashApiKey(plain) },
    });
    return NextResponse.json({ apiKey: plain, isNew: true });
  } catch (err) {
    return apiError(err);
  }
}
