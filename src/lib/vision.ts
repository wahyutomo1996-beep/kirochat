/**
 * Vision capability detection.
 *
 * Kiro/CodeWhisperer (the backend powering the built-in Prometheus provider)
 * does NOT accept images over its public HTTP API - the IDE uses AWS SDK
 * binary serialization we can't replicate. When users attach images to a
 * Prometheus chat, we auto-route the request to the first vision-capable
 * external provider they've added.
 *
 * This module centralizes the heuristics for "is this provider/model
 * vision-capable" so the chat route stays readable.
 */

/**
 * Model identifier substrings (case-insensitive) known to support image
 * input over OpenAI-compatible JSON. The match is intentionally loose
 * because providers prefix/suffix differently:
 *   - OpenRouter: "openai/gpt-4o", "anthropic/claude-3.5-sonnet"
 *   - OpenAI:     "gpt-4o", "gpt-4-vision-preview"
 *   - Gemini:     "gemini-1.5-pro", "gemini-2.0-flash"
 *   - Groq:       "llama-3.2-90b-vision"
 */
const VISION_MODEL_PATTERNS = [
  // OpenAI
  /gpt-?4o/i,
  /gpt-?4-vision/i,
  /gpt-?4-turbo/i,
  /gpt-?5/i,
  /o1\b/i,
  /o3\b/i,
  /o4\b/i,
  // Anthropic Claude (via OpenRouter / direct)
  /claude-3/i,
  /claude-?3\.5/i,
  /claude-?3\.7/i,
  /claude-?4/i,
  /claude-(opus|sonnet|haiku)/i,
  // Google Gemini
  /gemini-1\.5/i,
  /gemini-2/i,
  /gemini-pro-vision/i,
  // Meta Llama Vision
  /llama-?3\.2.*vision/i,
  /llama-?4/i,
  // Mistral Pixtral
  /pixtral/i,
  // Generic vision marker
  /vision/i,
];

/**
 * Provider types that are KNOWN to be vision-incapable regardless of model.
 * The built-in Prometheus pool and any direct Kiro proxy fall here.
 */
const VISION_BLOCKLIST_TYPES = new Set(['kiro_refresh_token', 'prometheus_builtin']);

/**
 * BaseURL substrings (case-insensitive) that indicate a Kiro-proxy
 * regardless of provider type label.
 */
const KIRO_PROXY_PATTERNS = [
  /amazonaws\.com/i,
  /137\.184\.195\.229/i, // WIR Cloud
  /\bkiro\b/i,
];

export interface ProviderLike {
  id: string;
  name: string;
  type: string;
  baseUrl?: string | null;
  models?: string | null; // JSON-encoded array
  isActive?: boolean;
}

/**
 * Returns true if the given (provider, model) pair can accept image input.
 */
export function isVisionCapable(provider: ProviderLike, model?: string): boolean {
  if (VISION_BLOCKLIST_TYPES.has(provider.type)) return false;
  if (provider.baseUrl && KIRO_PROXY_PATTERNS.some(rx => rx.test(provider.baseUrl!))) return false;
  if (!model) return false;
  return VISION_MODEL_PATTERNS.some(rx => rx.test(model));
}

/**
 * Returns true if a Kiro-backed provider (built-in Prometheus, refresh
 * token, or proxy) - meaning images must be re-routed elsewhere.
 */
export function isKiroBacked(provider: ProviderLike | null, isBuiltin = false): boolean {
  if (isBuiltin) return true;
  if (!provider) return false;
  if (VISION_BLOCKLIST_TYPES.has(provider.type)) return true;
  if (provider.baseUrl && KIRO_PROXY_PATTERNS.some(rx => rx.test(provider.baseUrl!))) return true;
  return false;
}

/**
 * Pick the best vision-capable (provider, model) pair from the user's
 * configured external providers. Returns null if none available.
 *
 * Strategy: prefer the user's default provider if it qualifies, otherwise
 * scan all active providers and pick the first one with a vision model.
 */
export function pickVisionFallback(providers: ProviderLike[]): { provider: ProviderLike; model: string } | null {
  // Sort: default first, then most recently created (assuming input order)
  const candidates = providers
    .filter(p => p.isActive !== false)
    .filter(p => !VISION_BLOCKLIST_TYPES.has(p.type))
    .filter(p => !p.baseUrl || !KIRO_PROXY_PATTERNS.some(rx => rx.test(p.baseUrl!)));

  for (const provider of candidates) {
    let modelList: string[] = [];
    try { modelList = JSON.parse(provider.models || '[]'); } catch {}

    const visionModel = modelList.find(m => VISION_MODEL_PATTERNS.some(rx => rx.test(m)));
    if (visionModel) return { provider, model: visionModel };
  }

  return null;
}
