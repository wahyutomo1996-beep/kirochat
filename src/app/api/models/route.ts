/**
 * Cookie-authenticated /api/models — used by the dashboard UI.
 *
 * Same data shape as /v1/models but uses session auth instead of Bearer
 * API key, so the browser doesn't have to expose the user's API key just
 * to render a model catalog.
 *
 * Returns expanded list (includes -thinking variants).
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAllModels } from '@/lib/models';
import { apiError } from '@/lib/http';

export async function GET() {
  try {
    await requireAuth();
    const all = getAllModels();
    return NextResponse.json({
      models: all.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        provider: m.provider,
        tier: m.tier,
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
        supportsThinking: m.supportsThinking,
        thinking: m.id.endsWith('-thinking'),
      })),
    });
  } catch (err) {
    return apiError(err);
  }
}
