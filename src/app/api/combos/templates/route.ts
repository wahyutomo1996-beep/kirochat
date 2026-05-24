/**
 * Public list of combo templates.
 *
 * GET /api/combos/templates                - all templates
 * GET /api/combos/templates?category=coding - filter by category
 *
 * Returns the static template definitions. Users instantiate via
 * POST /api/combos?from=<slug>.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { COMBO_TEMPLATES } from '@/lib/combo-templates';
import { apiError } from '@/lib/http';

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const url = new URL(request.url);
    const category = url.searchParams.get('category');

    const templates = category
      ? COMBO_TEMPLATES.filter((t) => t.category === category)
      : COMBO_TEMPLATES;

    return NextResponse.json({ templates });
  } catch (err) {
    return apiError(err);
  }
}
