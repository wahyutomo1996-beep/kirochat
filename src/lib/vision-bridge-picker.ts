/**
 * Vision Bridge - provider picker logic.
 *
 * Picks a vision-capable provider from the user's external providers
 * with a priority list (cheapest + fastest first). Used by the chat
 * route to bridge images from text-only models like Kiro.
 */

import { prisma } from './prisma';

/** Pattern detector: provider model id likely supports vision input. */
const VISION_MODEL_PATTERNS = [
  /gpt-?4o/i,
  /gpt-?4-vision/i,
  /gpt-?4-turbo/i,
  /gpt-?5/i,
  /o1\b/i,
  /claude-3/i,
  /claude-?3\.5/i,
  /claude-?3\.7/i,
  /claude-?4/i,
  /claude-(opus|sonnet|haiku)/i,
  /gemini-1\.5/i,
  /gemini-2/i,
  /gemini-pro-vision/i,
  /llama-?3\.2.*vision/i,
  /llama-?4/i,
  /pixtral/i,
  /vision/i,
];

/**
 * Preference order for vision provider. Cheaper + faster first.
 * Matched by base URL substring.
 */
const VISION_PROVIDER_PRIORITY: Array<{ urlMatch: RegExp; modelHint: string }> = [
  { urlMatch: /generativelanguage\.googleapis|gemini/i, modelHint: 'gemini-2.0-flash-exp' },
  { urlMatch: /api\.openai\.com/i, modelHint: 'gpt-4o-mini' },
  { urlMatch: /openrouter\.ai/i, modelHint: 'google/gemini-2.0-flash-exp:free' },
  { urlMatch: /api\.anthropic\.com/i, modelHint: 'claude-3-5-haiku-20241022' },
  { urlMatch: /api\.x\.ai/i, modelHint: 'grok-2-vision-1212' },
  { urlMatch: /api\.together\.xyz/i, modelHint: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo' },
  { urlMatch: /api\.hyperbolic\.xyz/i, modelHint: 'meta-llama/Llama-3.2-90B-Vision-Instruct' },
];

export interface VisionProvider {
  id: string;
  name: string;
  baseUrl: string;
  /** Encrypted API key from DB, decrypt before use */
  apiKey: string;
  model: string;
}

/**
 * Pick the best vision provider from the user's external providers.
 * Returns null when no vision-capable provider exists.
 */
export async function pickVisionProvider(userId: string): Promise<VisionProvider | null> {
  const providers = await prisma.provider.findMany({
    where: { userId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

  if (providers.length === 0) return null;

  // First pass: priority order based on baseUrl match
  for (const tier of VISION_PROVIDER_PRIORITY) {
    const match = providers.find((p) => tier.urlMatch.test(p.baseUrl));
    if (match) {
      const model = pickVisionModel(match.models, tier.modelHint);
      if (model) {
        return {
          id: match.id,
          name: match.name,
          baseUrl: match.baseUrl,
          apiKey: match.apiKey,
          model,
        };
      }
    }
  }

  // Fallback: any provider whose detected models match a vision pattern
  for (const p of providers) {
    let list: string[] = [];
    try { list = JSON.parse(p.models || '[]'); } catch { /* ignore */ }
    const visionModel = list.find((m) => VISION_MODEL_PATTERNS.some((rx) => rx.test(m)));
    if (visionModel) {
      return { id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: p.apiKey, model: visionModel };
    }
  }

  return null;
}

function pickVisionModel(modelsJson: string, preferredHint: string): string | null {
  let list: string[] = [];
  try { list = JSON.parse(modelsJson || '[]'); } catch { return preferredHint; }
  if (list.length === 0) return preferredHint;
  if (list.includes(preferredHint)) return preferredHint;
  const visionMatch = list.find((m) => VISION_MODEL_PATTERNS.some((rx) => rx.test(m)));
  return visionMatch ?? preferredHint;
}
