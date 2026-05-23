/**
 * Health check endpoint.
 *
 * Public, unauthenticated, designed for uptime monitors and load balancers.
 * Reports:
 *   - DB reachability
 *   - Pool depth (active vs exhausted Kiro accounts across all users)
 *   - Build/process info
 *
 * Response is always JSON. Status code:
 *   200  fully healthy
 *   200  degraded (db OK, pool empty/all-exhausted) — still up, just no quota
 *   503  hard failure (db unreachable)
 *
 * Detail level:
 *   GET /api/health           — minimal (no per-user data)
 *   GET /api/health?detail=1  — adds aggregate pool stats
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const startedAt = Date.now();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const detail = url.searchParams.get('detail') === '1';

  let dbOk = false;
  let dbLatencyMs = 0;
  let dbError: string | undefined;

  try {
    const t = Date.now();
    // Cheapest possible read - confirms the connection works.
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

  if (!detail) {
    return NextResponse.json(base, { status: 200 });
  }

  // Aggregate pool depth across all users (no PII - just counts).
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

  // Degraded but up: db works but the pool has no active accounts to dispatch.
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
