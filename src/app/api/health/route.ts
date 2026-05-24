/**
 * Health check endpoint.
 *
 * Public minimal version (no auth):
 *   GET /api/health  → { status, db, uptime }  - safe for uptime monitors
 *
 * Admin-gated detail version (auth required, role=admin):
 *   GET /api/health?detail=1  → adds pool depth, user counts
 *
 * Why detail is admin-only: leaking total user count and pool depth helps
 * attackers reconnaissance ("does this site have many users? is the pool
 * exhausted? perfect time to attack"). Public minimal info is enough for
 * load balancers and uptime monitors.
 *
 * Status codes:
 *   200  fully healthy
 *   200  degraded (db OK, pool empty/all-exhausted) — still up, no quota
 *   503  hard failure (db unreachable)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const startedAt = Date.now();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wantsDetail = url.searchParams.get('detail') === '1';

  let dbOk = false;
  let dbLatencyMs = 0;
  let dbError: string | undefined;

  try {
    const t = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - t;
    dbOk = true;
  } catch (err) {
    dbError = (err as Error).message?.slice(0, 200);
  }

  const base = {
    status: dbOk ? 'ok' : 'down',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || 'dev',
    db: {
      ok: dbOk,
      latencyMs: dbLatencyMs,
      ...(dbError ? { error: dbError } : {}),
    },
  };

  if (!dbOk) {
    return NextResponse.json(base, { status: 503 });
  }

  if (!wantsDetail) {
    return NextResponse.json(base, { status: 200 });
  }

  // Detail requires admin auth - prevents reconnaissance via public endpoint.
  const session = await getSession().catch(() => null);
  if (!session || session.role !== 'admin') {
    return NextResponse.json(
      {
        ...base,
        error: 'detail=1 requires admin authentication',
      },
      { status: 403 },
    );
  }

  let pool: {
    totalAccounts: number;
    activeAccounts: number;
    exhaustedAccounts: number;
    totalUsers: number;
  } | null = null;

  try {
    const [active, exhausted, total, users] = await Promise.all([
      prisma.kiroAccount.count({ where: { status: 'active' } }),
      prisma.kiroAccount.count({ where: { status: 'exhausted' } }),
      prisma.kiroAccount.count(),
      prisma.user.count({ where: { status: 'approved' } }),
    ]);
    pool = {
      totalAccounts: total,
      activeAccounts: active,
      exhaustedAccounts: exhausted,
      totalUsers: users,
    };
  } catch {
    /* pool stats best-effort - don't fail health on this */
  }

  const degraded = pool !== null && pool.totalAccounts > 0 && pool.activeAccounts === 0;

  return NextResponse.json(
    {
      ...base,
      status: degraded ? 'degraded' : 'ok',
      pool,
    },
    { status: 200 },
  );
}
