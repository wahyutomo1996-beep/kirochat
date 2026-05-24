/**
 * Combo CRUD endpoints.
 *
 * GET    /api/combos              - list user's combos
 * POST   /api/combos              - create custom combo (steps from request)
 * POST   /api/combos?from=<slug>  - instantiate from template
 *
 * Templates live at /api/combos/templates (read-only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { findTemplate, type ComboStepDef } from '@/lib/combo-templates';
import { apiError } from '@/lib/http';

interface CreateComboPayload {
  slug?: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  steps: ComboStepDef[];
  isActive?: boolean;
}

/** Lowercase, hyphen-separated slug. Allowed: a-z 0-9 - */
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function validateSteps(steps: unknown): { ok: true; steps: ComboStepDef[] } | { ok: false; error: string } {
  if (!Array.isArray(steps)) return { ok: false, error: 'steps must be an array' };
  if (steps.length === 0) return { ok: false, error: 'at least one step required' };
  if (steps.length > 10) return { ok: false, error: 'maximum 10 steps per combo' };

  const cleaned: ComboStepDef[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as Record<string, unknown>;
    if (!s || typeof s !== 'object') return { ok: false, error: `step ${i} must be an object` };
    const providerId = typeof s.providerId === 'string' ? s.providerId : null;
    const model = typeof s.model === 'string' ? s.model : null;
    if (!providerId) return { ok: false, error: `step ${i}: providerId required` };
    if (!model) return { ok: false, error: `step ${i}: model required` };
    cleaned.push({
      providerId,
      model,
      label: typeof s.label === 'string' ? s.label : undefined,
    });
  }
  return { ok: true, steps: cleaned };
}

export async function GET() {
  try {
    const session = await requireAuth();
    const combos = await prisma.combo.findMany({
      where: { userId: session.userId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({
      combos: combos.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        category: c.category,
        icon: c.icon,
        steps: JSON.parse(c.steps || '[]') as ComboStepDef[],
        isActive: c.isActive,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const url = new URL(request.url);
    const fromSlug = url.searchParams.get('from');

    // Template instantiation path
    if (fromSlug) {
      const template = findTemplate(fromSlug);
      if (!template) {
        return NextResponse.json({ error: `Template "${fromSlug}" not found` }, { status: 404 });
      }

      // Avoid duplicate slug - if user already instantiated this template,
      // append a numeric suffix.
      let slug = template.slug;
      let suffix = 1;
      while (
        await prisma.combo.findUnique({ where: { userId_slug: { userId: session.userId, slug } } })
      ) {
        slug = `${template.slug}-${++suffix}`;
        if (suffix > 50) {
          return NextResponse.json({ error: 'Too many instances of this template' }, { status: 400 });
        }
      }

      const created = await prisma.combo.create({
        data: {
          userId: session.userId,
          slug,
          name: template.name + (suffix > 1 ? ` (${suffix})` : ''),
          description: template.description,
          category: template.category,
          icon: template.icon,
          steps: JSON.stringify(template.steps),
        },
      });
      return NextResponse.json({
        combo: {
          id: created.id,
          slug: created.slug,
          name: created.name,
          description: created.description,
          category: created.category,
          icon: created.icon,
          steps: template.steps,
          isActive: created.isActive,
        },
      }, { status: 201 });
    }

    // Custom combo path
    const body = (await request.json()) as CreateComboPayload;
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }

    const stepsCheck = validateSteps(body.steps);
    if (!stepsCheck.ok) {
      return NextResponse.json({ error: stepsCheck.error }, { status: 400 });
    }

    let slug = body.slug?.trim() || slugify(body.name);
    if (!SLUG_REGEX.test(slug)) {
      return NextResponse.json(
        { error: 'slug must be lowercase letters, numbers, and hyphens only' },
        { status: 400 },
      );
    }

    // Auto-suffix on slug collision instead of failing
    let suffix = 1;
    const baseSlug = slug;
    while (
      await prisma.combo.findUnique({ where: { userId_slug: { userId: session.userId, slug } } })
    ) {
      slug = `${baseSlug}-${++suffix}`;
      if (suffix > 50) {
        return NextResponse.json({ error: 'Too many combos with this base slug' }, { status: 400 });
      }
    }

    const created = await prisma.combo.create({
      data: {
        userId: session.userId,
        slug,
        name: body.name.trim().slice(0, 80),
        description: (body.description ?? '').slice(0, 500),
        category: body.category ?? 'custom',
        icon: body.icon ?? '\u2728',
        steps: JSON.stringify(stepsCheck.steps),
        isActive: body.isActive !== false,
      },
    });

    return NextResponse.json({
      combo: {
        id: created.id,
        slug: created.slug,
        name: created.name,
        description: created.description,
        category: created.category,
        icon: created.icon,
        steps: stepsCheck.steps,
        isActive: created.isActive,
      },
    }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
