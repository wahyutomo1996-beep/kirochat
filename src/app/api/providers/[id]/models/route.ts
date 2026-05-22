import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchModels } from '@/lib/providers';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireAuth();

    const provider = await prisma.provider.findFirst({
      where: { id: params.id, userId: session.userId },
    });

    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    const models = await fetchModels({
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
    });

    await prisma.provider.update({
      where: { id: params.id },
      data: {
        models: JSON.stringify(models),
        modelsLastFetched: new Date(),
      },
    });

    return NextResponse.json({ models, count: models.length, fetchedAt: new Date() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
