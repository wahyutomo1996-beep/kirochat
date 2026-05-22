import { decrypt } from './encryption';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface ProviderConfig {
  type: string;
  baseUrl: string;
  apiKey: string;
}

export interface StreamResult {
  stream: ReadableStream;
  getUsage: () => { promptTokens: number; completionTokens: number; totalTokens: number };
}

// Cache for Kiro access tokens
const kiroTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getKiroAccessToken(refreshToken: string): Promise<string> {
  const cached = kiroTokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const endpoints = [
    'https://prod.us-east-1.birdseye.amazon.dev/oauth/token',
    'https://authenticate.kiro.dev/oauth/token',
  ];

  let lastError = '';
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: 'kiro-ide',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        kiroTokenCache.set(refreshToken, {
          token: data.access_token,
          expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        });
        return data.access_token;
      }

      lastError = `${endpoint}: ${response.status} ${await response.text()}`;
    } catch (err) {
      lastError = `${endpoint}: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  }

  throw new Error(`Kiro token refresh failed. ${lastError}`);
}

function resolveBaseUrl(provider: ProviderConfig): string {
  let baseUrl = provider.baseUrl;
  if (provider.type === 'kiro_refresh_token' && (!baseUrl || baseUrl === '')) {
    baseUrl = 'https://api.kiro.dev/v1';
  }
  return baseUrl.replace(/\/+$/, '');
}

async function resolveApiKey(provider: ProviderConfig): Promise<string> {
  const decryptedKey = decrypt(provider.apiKey);
  if (provider.type === 'kiro_refresh_token') {
    return await getKiroAccessToken(decryptedKey);
  }
  return decryptedKey;
}

export async function streamChat(
  provider: ProviderConfig,
  model: string,
  messages: ChatMessage[],
): Promise<StreamResult> {
  const apiKey = await resolveApiKey(provider);
  const baseUrl = resolveBaseUrl(provider);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Provider error (${response.status}): ${error}`);
  }

  // Track usage from stream
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let buffer = '';
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            controller.enqueue(encoder.encode(`${line}\n`));
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            // OpenAI format: usage is in last chunk
            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.prompt_tokens || 0,
                completionTokens: parsed.usage.completion_tokens || 0,
                totalTokens: parsed.usage.total_tokens || 0,
              };
            }
          } catch {}
          controller.enqueue(encoder.encode(`${line}\n`));
        } else {
          controller.enqueue(encoder.encode(`${line}\n`));
        }
      }
    },
  });

  const piped = response.body!.pipeThrough(transformStream);

  return {
    stream: piped,
    getUsage: () => usage,
  };
}

export async function fetchModels(provider: ProviderConfig): Promise<string[]> {
  try {
    const apiKey = await resolveApiKey(provider);
    const baseUrl = resolveBaseUrl(provider);

    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) return [];

    const data = await response.json();

    let models: string[] = [];
    if (data.data && Array.isArray(data.data)) {
      models = data.data.map((m: { id: string }) => m.id);
    } else if (Array.isArray(data)) {
      models = data.map((m: { id?: string; name?: string }) => m.id || m.name || '').filter(Boolean);
    }

    return models.sort();
  } catch (err) {
    console.error('fetchModels failed:', err);
    return [];
  }
}

// Estimate tokens for fallback when API doesn't return usage
// Rough heuristic: ~4 chars per token for English/code
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
