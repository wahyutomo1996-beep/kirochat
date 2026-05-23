import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/http';

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '7d'; // 24h, 7d, 30d, all

    const now = new Date();
    let since: Date | null = null;
    if (range === '24h') since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    else if (range === '7d') since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (range === '30d') since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const where = {
      userId: session.userId,
      ...(since ? { createdAt: { gte: since } } : {}),
    };

    // Aggregate totals
    const [usages, totalConversations, totalProviders] = await Promise.all([
      prisma.usage.findMany({
        where,
        select: {
          providerId: true,
          providerName: true,
          model: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          latencyMs: true,
          cost: true,
          success: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.conversation.count({
        where: { userId: session.userId, ...(since ? { createdAt: { gte: since } } : {}) },
      }),
      prisma.provider.count({ where: { userId: session.userId, isActive: true } }),
    ]);

    // Compute totals
    const totalRequests = usages.length;
    const successCount = usages.filter(u => u.success).length;
    const errorCount = totalRequests - successCount;
    const totalPromptTokens = usages.reduce((s, u) => s + u.promptTokens, 0);
    const totalCompletionTokens = usages.reduce((s, u) => s + u.completionTokens, 0);
    const totalTokens = totalPromptTokens + totalCompletionTokens;
    const totalCost = usages.reduce((s, u) => s + u.cost, 0);
    const avgLatency = totalRequests > 0 ? Math.round(usages.reduce((s, u) => s + u.latencyMs, 0) / totalRequests) : 0;

    // Group by model
    const modelMap = new Map<string, { requests: number; tokens: number; cost: number }>();
    usages.forEach(u => {
      const cur = modelMap.get(u.model) || { requests: 0, tokens: 0, cost: 0 };
      cur.requests++;
      cur.tokens += u.totalTokens;
      cur.cost += u.cost;
      modelMap.set(u.model, cur);
    });
    const byModel = Array.from(modelMap.entries())
      .map(([model, stats]) => ({ model, ...stats, cost: Number(stats.cost.toFixed(4)) }))
      .sort((a, b) => b.requests - a.requests);

    // Group by provider. providerId may be null for the built-in
    // Prometheus virtual provider — in that case we use a sentinel string
    // so it groups separately and shows up clearly in the dashboard.
    const providerMap = new Map<string, { providerId: string; requests: number; tokens: number; cost: number }>();
    usages.forEach(u => {
      const cur = providerMap.get(u.providerName) || {
        providerId: u.providerId ?? '__prometheus__',
        requests: 0,
        tokens: 0,
        cost: 0,
      };
      cur.requests++;
      cur.tokens += u.totalTokens;
      cur.cost += u.cost;
      providerMap.set(u.providerName, cur);
    });
    const byProvider = Array.from(providerMap.entries())
      .map(([name, stats]) => ({ providerName: name, ...stats, cost: Number(stats.cost.toFixed(4)) }))
      .sort((a, b) => b.requests - a.requests);

    // Time series - daily buckets
    const dailyMap = new Map<string, { requests: number; tokens: number; cost: number }>();
    usages.forEach(u => {
      const day = u.createdAt.toISOString().slice(0, 10);
      const cur = dailyMap.get(day) || { requests: 0, tokens: 0, cost: 0 };
      cur.requests++;
      cur.tokens += u.totalTokens;
      cur.cost += u.cost;
      dailyMap.set(day, cur);
    });
    const timeline = Array.from(dailyMap.entries())
      .map(([date, stats]) => ({ date, ...stats, cost: Number(stats.cost.toFixed(4)) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Recent activity
    const recent = usages.slice(0, 20).map(u => ({
      providerName: u.providerName,
      model: u.model,
      tokens: u.totalTokens,
      cost: Number(u.cost.toFixed(6)),
      latencyMs: u.latencyMs,
      success: u.success,
      createdAt: u.createdAt,
    }));

    return NextResponse.json({
      range,
      summary: {
        totalRequests,
        successCount,
        errorCount,
        successRate: totalRequests > 0 ? Number((successCount / totalRequests * 100).toFixed(1)) : 0,
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        totalCost: Number(totalCost.toFixed(4)),
        avgLatency,
        totalConversations,
        totalProviders,
      },
      byModel,
      byProvider,
      timeline,
      recent,
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
