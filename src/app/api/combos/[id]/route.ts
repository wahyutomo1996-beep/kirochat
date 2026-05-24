/**
 * Combo individual CRUD - update, delete.
 *
 * PUT    /api/combos/[id]  - update name/steps/isActive
 * DELETE /api/combos/[id]  - hard delete
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/http';
import type { ComboStepDef } from '@/lib/combo-templates';

interface UpdateComboPayload {
  name?: string;
  description?: string;
  icon?: string;
  steps?: ComboStepDef[];
  isActive?: boolean;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await requireAuth();
    const { id } = params;

    const existing = await prisma.combo.findFirst({
      where: { id, userId: session.userId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Combo not found' }, { status: 404 });
    }

    const body = (await request.json()) as UpdateComboPayload;
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name.trim().slice(0, 80);
    if (body.description !== undefined) updates.description = body.description.slice(0, 500);
    if (body.icon !== undefined) updates.icon = body.icon.slice(0, 4);
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    if (body.steps !== undefined) {
      if (!Array.isArray(body.steps) || body.steps.length === 0) {
        return NextResponse.json({ error: 'steps must be a non-empty array' }, { status: 400 });
      }
      if (body.steps.length > 10) {
        return NextResponse.json({ error: 'max 10 steps per combo' }, { status: 400 });
      }
      // Sanity check each step shape
      for (let i = 0; i < body.steps.length; i++) {
        const s = body.steps[i] as unknown as Record<string, unknown>;
        if (!s.providerId || !s.model) {
          return NextResponse.json({ error: `step ${i} missing providerId or model` }, { status: 400 });
        }
      }
      updates.steps = JSON.stringify(body.steps);
    }

    const updated = await prisma.combo.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json({
      combo: {
        id: updated.id,
        slug: updated.slug,
        name: updated.name,
        description: updated.description,
        category: updated.category,
        icon: updated.icon,
        steps: JSON.parse(updated.steps || '[]'),
        isActive: updated.isActive,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await requireAuth();
    const { id } = params;

    const existing = await prisma.combo.findFirst({
      where: { id, userId: session.userId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Combo not found' }, { status: 404 });
    }

    await prisma.combo.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return apiError(err);
  }
}
