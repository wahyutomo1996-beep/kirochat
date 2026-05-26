/**
 * Per-account usage stats for the Kiro Account Pool.
 *
 * Returns aggregate token consumption (today / 7d / total) per account so
 * the Settings UI can surface credit consumption and let users anticipate
 * which accounts are about to be exhausted.
 *
 * Query strategy: read pre-aggregated counters from KiroAccount for the
 * "total" view (cheap, O(N) where N = account count) and run a grouped
 * count over the Usage table for time-windowed views.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/http';

interface AccountStats {
  id: string;
  email: string | null;
  status: string;
  createdAt: string;
  lastUsed: string | null;

  /** Aggregate counters mirrored from KiroAccount table */
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  failedRequests: number;

  /** Time-windowed views computed on the fly from Usage table */
  todayRequests: number;
  todayTokens: number;
  weekRequests: number;
  weekTokens: number;

  /**
   * Per-account daily request limit (null = unlimited).
   * UI uses this to show "X / Y left today" + warn at 80% headroom.
   * NOT enforced server-side as a hard block — exhaust still relies on
   * actual Kiro 429/403 responses.
   */
  dailyLimit: number | null;
  /** Computed: dailyLimit - todayRequests, or null if no limit set. */
  dailyRemaining: number | null;
  /** Computed: 0..1 fraction of dailyLimit consumed today. null if no limit. */
  dailyUsagePct: number | null;

  /** Last error/exhaust info for surfacing in UI */
  lastError: string | null;
  lastErrorAt: string | null;
  exhaustedAt: string | null;
}

export async function GET() {
  try {
    const session = await requireAuth();

    const accounts = await prisma.kiroAccount.findMany({
      where: { userId: session.userId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });

    if (accounts.length === 0) {
      return NextResponse.json({
        accounts: [],
        summary: {
          totalAccounts: 0,
          activeAccounts: 0,
          exhaustedAccounts: 0,
          totalTokensToday: 0,
          totalTokensWeek: 0,
          totalTokensAllTime: 0,
        },
      });
    }

    const accountIds = accounts.map(a => a.id);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Time-windowed aggregations from Usage table
    const [todayAgg, weekAgg] = await Promise.all([
      prisma.usage.groupBy({
        by: ['kiroAccountId'],
        where: {
          userId: session.userId,
          kiroAccountId: { in: accountIds },
          createdAt: { gte: todayStart },
          success: true,
        },
        _count: { id: true },
        _sum: { totalTokens: true },
      }),
      prisma.usage.groupBy({
        by: ['kiroAccountId'],
        where: {
          userId: session.userId,
          kiroAccountId: { in: accountIds },
          createdAt: { gte: weekStart },
          success: true,
        },
        _count: { id: true },
        _sum: { totalTokens: true },
      }),
    ]);

    const todayMap = new Map(todayAgg.map(a => [a.kiroAccountId, a]));
    const weekMap = new Map(weekAgg.map(a => [a.kiroAccountId, a]));

    const accountStats: AccountStats[] = accounts.map(a => {
      const today = todayMap.get(a.id);
      const week = weekMap.get(a.id);
      const todayReq = today?._count.id ?? 0;
      const dailyLimit = a.dailyLimit ?? null;
      // Derive remaining + percent here so UI doesnt have to redo arithmetic
      const dailyRemaining = dailyLimit !== null ? Math.max(0, dailyLimit - todayReq) : null;
      const dailyUsagePct = dailyLimit !== null && dailyLimit > 0
        ? Math.min(1, todayReq / dailyLimit)
        : null;
      return {
        id: a.id,
        email: a.email,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        lastUsed: a.lastUsed?.toISOString() ?? null,
        totalRequests: a.totalRequests,
        totalTokens: a.totalTokens,
        totalPromptTokens: a.totalPromptTokens,
        totalCompletionTokens: a.totalCompletionTokens,
        failedRequests: a.failedRequests,
        todayRequests: todayReq,
        todayTokens: today?._sum.totalTokens ?? 0,
        weekRequests: week?._count.id ?? 0,
        weekTokens: week?._sum.totalTokens ?? 0,
        dailyLimit,
        dailyRemaining,
        dailyUsagePct,
        lastError: a.lastError,
        lastErrorAt: a.lastErrorAt?.toISOString() ?? null,
        exhaustedAt: a.exhaustedAt?.toISOString() ?? null,
      };
    });

    const summary = accountStats.reduce(
      (acc, a) => {
        acc.totalAccounts += 1;
        if (a.status === 'active') acc.activeAccounts += 1;
        if (a.status === 'exhausted') acc.exhaustedAccounts += 1;
        acc.totalTokensToday += a.todayTokens;
        acc.totalTokensWeek += a.weekTokens;
        acc.totalTokensAllTime += a.totalTokens;
        return acc;
      },
      {
        totalAccounts: 0,
        activeAccounts: 0,
        exhaustedAccounts: 0,
        totalTokensToday: 0,
        totalTokensWeek: 0,
        totalTokensAllTime: 0,
      },
    );

    return NextResponse.json({ accounts: accountStats, summary });
  } catch (error) {
    return apiError(error);
  }
}
