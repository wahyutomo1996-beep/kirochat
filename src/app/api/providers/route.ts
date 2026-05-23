import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { fetchModels } from '@/lib/providers';
import { MODEL_REGISTRY } from '@/lib/models';
import { PROMETHEUS_PROVIDER_ID } from '@/lib/constants';
import { apiError } from '@/lib/http';

/**
 * Built-in virtual provider that uses the Kiro Account Pool directly.
 * Always present in the providers list - users don't need to "add" it.
 *
 * Identified by id="__prometheus__". The chat handler recognizes this
 * special ID and routes through the Kiro pool instead of the Provider
 * table lookup.
 */

function buildPrometheusVirtualProvider(activeAccountCount: number) {
  // Expose only Kiro models (the pool serves these)
  const kiroModels = MODEL_REGISTRY
    .filter(m => m.provider === 'kiro')
    .map(m => m.kiroModelId!)
    .filter(Boolean);

  return {
    id: PROMETHEUS_PROVIDER_ID,
    name: 'Prometheus',
    type: 'prometheus_builtin',
    baseUrl: '',
    models: JSON.stringify(kiroModels),
    modelsLastFetched: new Date().toISOString(),
    isDefault: activeAccountCount > 0,
    isActive: activeAccountCount > 0,
    createdAt: new Date(0).toISOString(),
    accountCount: activeAccountCount,
    builtin: true,
  };
}

export async function GET() {
  try {
    const session = await requireAuth();
    const [providers, activeAccountCount] = await Promise.all([
      prisma.provider.findMany({
        where: { userId: session.userId },
        select: {
          id: true,
          name: true,
          type: true,
          baseUrl: true,
          models: true,
          modelsLastFetched: true,
          isDefault: true,
          isActive: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.kiroAccount.count({
        where: { userId: session.userId, status: 'active' },
      }),
    ]);

    // If user has at least one active Kiro account, the built-in provider
    // is the default unless an explicit DB provider is marked default.
    const hasExplicitDefault = providers.some(p => p.isDefault);
    const builtin = buildPrometheusVirtualProvider(activeAccountCount);
    if (hasExplicitDefault) builtin.isDefault = false;

    return NextResponse.json({
      providers: [builtin, ...providers],
      activeKiroAccounts: activeAccountCount,
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { name, type, baseUrl, apiKey } = await request.json();

    if (!name || !type || !apiKey) {
      return NextResponse.json({ error: 'Name, type, dan API key wajib diisi' }, { status: 400 });
    }

    if (type !== 'kiro_refresh_token' && !baseUrl) {
      return NextResponse.json({ error: 'Base URL wajib untuk provider non-Kiro' }, { status: 400 });
    }

    const encryptedKey = encrypt(apiKey);

    // Auto-fetch models on creation
    let models: string[] = [];
    let fetchedAt: Date | null = null;
    try {
      models = await fetchModels({ type, baseUrl: baseUrl || '', apiKey: encryptedKey });
      if (models.length > 0) fetchedAt = new Date();
    } catch (err) {
      console.error('Auto-fetch models failed:', err);
      // Don't block creation if model fetch fails - user can retry
    }

    const provider = await prisma.provider.create({
      data: {
        userId: session.userId,
        name,
        type,
        baseUrl: baseUrl || '',
        apiKey: encryptedKey,
        models: JSON.stringify(models),
        modelsLastFetched: fetchedAt,
      },
    });

    return NextResponse.json({
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl,
        models: provider.models,
        modelsLastFetched: provider.modelsLastFetched,
        isDefault: provider.isDefault,
        isActive: provider.isActive,
      },
      modelsCount: models.length,
      message: models.length > 0
        ? `Provider added with ${models.length} models auto-detected`
        : 'Provider added but no models detected. Try refreshing manually.',
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
