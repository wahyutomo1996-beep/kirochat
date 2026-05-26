/**
 * Vision Bridge - image describer.
 *
 * Calls the picked vision provider's OpenAI-compatible /chat/completions
 * with a workspace-tuned system prompt + the image, returns a textual
 * description that can be injected into the conversation for downstream
 * text-only models (Kiro, etc).
 *
 * Includes an in-memory cache keyed by SHA-256 of image data URL so
 * re-prompts of the same image don't pay the API cost again. TTL 1 hour.
 */

import crypto from 'crypto';
import { decrypt } from './encryption';
import { pickVisionProvider, type VisionProvider } from './vision-bridge-picker';

/** Workspace-tuned describe prompt. The vision provider sees this + image only. */
const DESCRIBE_PROMPTS: Record<string, string> = {
  coding:
    'Describe this image with technical precision for a software engineer. Focus on: code blocks (transcribe exactly, preserve indentation), error messages, stack traces, file/folder structure, line numbers, terminal output, UI elements that are part of an app being built. Be exhaustive about textual content. Brief about visual styling unless it is the topic.',
  trading:
    'Describe this image for a trading analyst. Focus on: chart pattern (head-and-shoulders, flag, triangle, etc), candlestick formation, price levels with numbers (support, resistance, current), indicators visible (RSI, MACD, MA), timeframe, volume bars, ticker symbol, exchange. List concrete numbers. Be terse on aesthetics.',
  general:
    'Describe this image comprehensively. Cover the main subject, surrounding context, any visible text (transcribe verbatim), notable objects, colors, and mood. If it is a diagram or chart, explain what it represents.',
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_DESCRIPTION_LEN = 8000;

interface CacheEntry {
  text: string;
  providerName: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Periodic cleanup so the cache doesn't grow without bound */
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    cache.forEach((entry, key) => {
      if (entry.expiresAt < now) cache.delete(key);
    });
  }, 5 * 60 * 1000);
}

function cacheKey(workspace: string, dataUrl: string): string {
  return crypto.createHash('sha256').update(workspace + '|' + dataUrl).digest('hex');
}

export interface BridgeResult {
  /** Text description ready to inject into the conversation */
  description: string;
  /** True when description came from cache (free) */
  fromCache: boolean;
  /** Display name of the vision provider used (for UI banner) */
  providerName: string;
  /** ms spent on the vision call (0 if cached) */
  latencyMs: number;
}

export interface BridgeFailure {
  /** Reason the bridge failed - shown in UI as a soft warning */
  error: string;
  /** Whether this is recoverable (no provider) or transient (provider failed) */
  kind: 'no-provider' | 'call-failed';
}

/**
 * Describe a single image via the user's best vision provider.
 *
 * dataUrl: standard `data:image/png;base64,...` form. We pass it straight
 * to the OpenAI-compatible content array.
 *
 * Returns a description string OR a failure reason. Caller decides how
 * to surface to user (we suggest a soft banner + continue with placeholder
 * text so the conversation doesn't dead-end).
 */
export async function bridgeImage(
  userId: string,
  dataUrl: string,
  workspace: string,
): Promise<BridgeResult | BridgeFailure> {
  // Cache check
  const key = cacheKey(workspace, dataUrl);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      description: cached.text,
      fromCache: true,
      providerName: cached.providerName,
      latencyMs: 0,
    };
  }

  const provider = await pickVisionProvider(userId);
  if (!provider) {
    return {
      error: 'No vision-capable provider configured. Add OpenAI, Gemini, or OpenRouter in Settings to enable image bridging.',
      kind: 'no-provider',
    };
  }

  const prompt = DESCRIBE_PROMPTS[workspace] ?? DESCRIBE_PROMPTS.general;
  const apiKey = decrypt(provider.apiKey);
  const start = Date.now();

  try {
    const response = await callVisionApi(provider, apiKey, prompt, dataUrl);
    const latencyMs = Date.now() - start;

    const text = response.slice(0, MAX_DESCRIPTION_LEN);
    cache.set(key, {
      text,
      providerName: provider.name,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return {
      description: text,
      fromCache: false,
      providerName: provider.name,
      latencyMs,
    };
  } catch (err) {
    return {
      error: `Vision call to ${provider.name} failed: ${(err as Error).message}`,
      kind: 'call-failed',
    };
  }
}

/**
 * Send the OpenAI-compatible /chat/completions call to the vision provider.
 * Non-streaming, single-turn. Image goes as image_url part.
 */
async function callVisionApi(
  provider: VisionProvider,
  apiKey: string,
  prompt: string,
  dataUrl: string,
): Promise<string> {
  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: provider.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 2048,
    temperature: 0.2,
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await r.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('Empty response from vision provider');
  }
  return text;
}

/**
 * Format a bridge result as a single text snippet that gets injected
 * into the user's message in place of the image. The downstream model
 * (Kiro) will see this text and can reason about the image content.
 */
export function formatBridgedDescription(
  result: BridgeResult | BridgeFailure,
  imageIndex?: number,
): string {
  const tag = imageIndex !== undefined ? ` ${imageIndex + 1}` : '';
  if ('error' in result) {
    return `[Image${tag} attached but vision bridge failed: ${result.error}]`;
  }
  const cacheTag = result.fromCache ? ' (cached)' : '';
  return `[Image${tag} analyzed via ${result.providerName}${cacheTag}]\n${result.description}`;
}
