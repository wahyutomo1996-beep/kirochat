import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { fetchModels } from '@/lib/providers';

export async function GET() {
  try {
    const session = await requireAuth();
    const providers = await prisma.provider.findMany({
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
    });

    return NextResponse.json({ providers });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Unauthorized' || message === 'Account not approved' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
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
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Unauthorized' || message === 'Account not approved' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
