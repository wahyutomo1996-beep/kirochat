/**
 * Combo dispatcher.
 *
 * Resolves a combo slug (or "combo:<slug>") to its ordered steps, then yields
 * each step as a tuple (provider, model). Caller iterates these and tries
 * them in order — falling back on rate-limit, auth-fail, or network error.
 *
 * The dispatcher itself is provider-agnostic. It just gives you the chain;
 * the chat route is responsible for actually invoking each step and deciding
 * when to fall through.
 */

import { prisma } from './prisma';
import type { ComboStepDef } from './combo-templates';

export interface ResolvedCombo {
  slug: string;
  name: string;
  steps: ComboStepDef[];
}

/**
 * Strip the optional "combo:" prefix used in chat dropdowns to disambiguate
 * combos from raw model IDs. Returns the bare slug.
 *
 * Slug spec — must match what the combo create API accepts:
 *   ^[a-z0-9]+(-[a-z0-9]+)*$
 *
 * Single-word slugs ARE valid (e.g. "coding"). Earlier this regex required
 * at least one hyphen which silently broke any single-word combo at chat
 * time even though they were creatable in Settings — fixed here.
 */
export function parseComboRef(ref: string): string | null {
  if (!ref) return null;
  const candidate = ref.startsWith('combo:') ? ref.slice(6) : ref;
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(candidate)) {
    return candidate;
  }
  return null;
}

/**
 * Resolve a slug to a combo for a given user. Returns null if the user
 * doesn't have this combo, OR the combo has no steps.
 */
export async function resolveCombo(userId: string, slug: string): Promise<ResolvedCombo | null> {
  const row = await prisma.combo.findUnique({
    where: { userId_slug: { userId, slug } },
  });
  if (!row || !row.isActive) return null;

  let steps: ComboStepDef[] = [];
  try {
    const parsed = JSON.parse(row.steps);
    if (Array.isArray(parsed)) {
      steps = parsed.filter(
        (s) => s && typeof s === 'object' && typeof s.providerId === 'string' && typeof s.model === 'string',
      );
    }
  } catch {
    /* malformed JSON in DB - treat as no steps */
  }

  if (steps.length === 0) return null;

  return {
    slug: row.slug,
    name: row.name,
    steps,
  };
}

/**
 * Classify whether an error is a "fall through to next step" condition.
 * - Rate limit (429)
 * - Auth/quota exhausted (403, 401 from upstream)
 * - Pool empty for built-in (503-ish)
 * - Network/timeout
 *
 * Errors NOT in this set (4xx model-not-found, malformed request) bubble up
 * because retrying with the next step won't help.
 */
export function isFallThroughError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Upstream rate limit / quota exhausted
  if (msg.includes('429') || lower.includes('rate limit') || lower.includes('quota')) return true;
  // Upstream forbidden (often quota in disguise)
  if (msg.includes('403')) return true;
  // Pool exhausted - try next step which may use a different provider
  if (lower.includes('no active kiro accounts') || lower.includes('all kiro accounts failed')) return true;
  // Transient
  if (lower.includes('timeout') || lower.includes('econnreset') || lower.includes('fetch failed')) return true;
  // 5xx upstream
  if (/\b5\d\d\b/.test(msg)) return true;

  return false;
}
