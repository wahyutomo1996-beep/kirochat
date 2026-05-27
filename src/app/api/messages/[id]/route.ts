/**
 * /api/messages/[id] — single-message operations.
 *
 * DELETE: remove the message + every message after it in the same
 * conversation. This is the "edit" rewind operation: when a user
 * edits their last user prompt, we delete from that point forward
 * so the next /api/chat call generates a fresh assistant turn.
 *
 * Auth: cookie session — only the message's owner (via the
 * conversation's userId) can mutate it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/http';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await requireAuth();

    // Verify the message exists + belongs to a conversation owned by
    // the requesting user. Prisma findFirst with the join ensures
    // we don't leak existence of messages from other users.
    const message = await prisma.message.findFirst({
      where: {
        id: params.id,
        conversation: { userId: session.userId },
      },
      select: { id: true, conversationId: true, createdAt: true },
    });

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 },
      );
    }

    // Delete this message AND every message in the same conversation
    // that came after it. createdAt comparison covers the common case
    // where edit-rewind is invoked on the user's most recent turn.
    const result = await prisma.message.deleteMany({
      where: {
        conversationId: message.conversationId,
        createdAt: { gte: message.createdAt },
      },
    });

    return NextResponse.json({ deleted: result.count });
  } catch (err) {
    return apiError(err);
  }
}
