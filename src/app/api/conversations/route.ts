import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeWorkspaceId, WORKSPACE_IDS } from '@/lib/workspaces';

/**
 * GET /api/conversations
 * Optional query: ?workspace=coding (filters), default = all.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const workspaceParam = searchParams.get('workspace');

    const where: { userId: string; workspace?: string } = { userId: session.userId };
    if (workspaceParam && WORKSPACE_IDS.includes(workspaceParam)) {
      where.workspace = workspaceParam;
    }

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        model: true,
        provider: true,
        workspace: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ conversations });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { title, model, provider, workspace } = await request.json();

    const conversation = await prisma.conversation.create({
      data: {
        userId: session.userId,
        title: title || 'New Chat',
        model: model || '',
        provider: provider || '',
        workspace: normalizeWorkspaceId(workspace),
      },
    });

    return NextResponse.json({ conversation });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
