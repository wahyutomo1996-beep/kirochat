import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireAuth();
    const {
      name,
      type,
      baseUrl,
      apiKey,
      isDefault,
      isActive,
      isShared,
      sharedModels,
    } = await request.json();

    const provider = await prisma.provider.findFirst({
      where: { id: params.id, userId: session.userId },
    });

    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (baseUrl !== undefined) updateData.baseUrl = baseUrl;
    if (apiKey !== undefined) updateData.apiKey = encrypt(apiKey);
    if (isActive !== undefined) updateData.isActive = isActive;

    /*
     * Sharing controls — only the provider owner can flip these flags.
     * The findFirst above already gates by userId, so we know the
     * caller owns the row. Validation:
     *   - isShared: boolean toggle
     *   - sharedModels: array of model id strings, must each appear in
     *     the provider's `models` JSON (can't share what you haven't
     *     fetched yet)
     */
    if (isShared !== undefined) {
      updateData.isShared = Boolean(isShared);
    }
    if (sharedModels !== undefined) {
      if (!Array.isArray(sharedModels)) {
        return NextResponse.json(
          { error: 'sharedModels must be an array of model id strings' },
          { status: 400 },
        );
      }
      let ownModels: string[] = [];
      try { ownModels = JSON.parse(provider.models || '[]'); } catch {}
      const invalid = sharedModels.filter((m: unknown) => typeof m !== 'string' || !ownModels.includes(m));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `sharedModels contains entries not present in provider catalog: ${invalid.join(', ')}` },
          { status: 400 },
        );
      }
      updateData.sharedModels = JSON.stringify(sharedModels);
    }

    if (isDefault === true) {
      // Unset other defaults
      await prisma.provider.updateMany({
        where: { userId: session.userId },
        data: { isDefault: false },
      });
      updateData.isDefault = true;
    } else if (isDefault === false) {
      updateData.isDefault = false;
    }

    const updated = await prisma.provider.update({
      where: { id: params.id },
      data: updateData,
    });

    return NextResponse.json({
      provider: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        baseUrl: updated.baseUrl,
        isDefault: updated.isDefault,
        isActive: updated.isActive,
        isShared: updated.isShared,
        sharedModels: updated.sharedModels,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
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

    await prisma.provider.delete({ where: { id: params.id } });

    return NextResponse.json({ message: 'Provider deleted' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
