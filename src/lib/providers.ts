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

// ============ KIRO TOKEN MANAGEMENT ============

const KIRO_AUTH_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken';
const KIRO_CHAT_ENDPOINT = 'https://q.us-east-1.amazonaws.com/generateAssistantResponse';
const KIRO_PROFILE_ARN = 'arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK';

// Available Kiro models
// IDs use the lowercase-with-dot format that Kiro's CodeWhisperer backend accepts.
// This list is kept in sync with src/lib/models.ts MODEL_REGISTRY (kiro provider entries).
const KIRO_MODELS = [
  'auto',
  // Claude Opus
  'claude-opus-4.7',
  'claude-opus-4.6',
  'claude-opus-4.5',
  // Claude Sonnet
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-sonnet-4',
  // Claude Haiku
  'claude-haiku-4.5',
  // DeepSeek
  'deepseek-3.2',
  // Qwen
  'qwen3-coder-next',
  // MiniMax
  'minimax-m2.5',
  // GLM
  'glm-5',
];

// Cache for Kiro access tokens
const kiroTokenCache = new Map<string, { token: string; refreshToken: string; expiresAt: number }>();

async function getKiroAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const cached = kiroTokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return { accessToken: cached.token, refreshToken: cached.refreshToken };
  }

  // Also check if we have a newer refresh token cached (token rotation)
  const entries = Array.from(kiroTokenCache.entries());
  for (const [, value] of entries) {
    if (value.refreshToken !== refreshToken && value.expiresAt > Date.now() + 60000) {
      return { accessToken: value.token, refreshToken: value.refreshToken };
    }
  }

  const response = await fetch(KIRO_AUTH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Prometheus/1.0',
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Kiro token refresh failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const newRefreshToken = data.refreshToken || refreshToken;

  kiroTokenCache.set(refreshToken, {
    token: data.accessToken,
    refreshToken: newRefreshToken,
    expiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
  });

  // Also cache under new refresh token key
  if (newRefreshToken !== refreshToken) {
    kiroTokenCache.set(newRefreshToken, {
      token: data.accessToken,
      refreshToken: newRefreshToken,
      expiresAt: Date.now() + (data.expiresIn || 3600) * 1000,
    });
  }

  return { accessToken: data.accessToken, refreshToken: newRefreshToken };
}

// ============ KIRO CHAT (AWS Event Stream) ============

function parseAwsEventStream(buffer: Uint8Array): Array<{ content?: string; modelId?: string }> {
  const events: Array<{ content?: string; modelId?: string }> = [];

  // AWS Event Stream format: binary frames with embedded JSON
  // Each frame has: total_length(4) + headers_length(4) + prelude_crc(4) + headers + payload + message_crc(4)
  // We extract JSON payloads from the binary stream
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  // Match full JSON objects that contain "content" field
  const jsonRegex = /\{"content":"((?:[^"\\]|\\.)*)","modelId":"([^"]*)"\}/g;
  let match: RegExpExecArray | null;
  while ((match = jsonRegex.exec(text)) !== null) {
    try {
      const content = match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      events.push({ content, modelId: match[2] });
    } catch {}
  }

  return events;
}

async function streamKiroChat(
  refreshToken: string,
  model: string,
  messages: ChatMessage[],
): Promise<StreamResult> {
  const { accessToken } = await getKiroAccessToken(refreshToken);

  // Convert messages to Kiro format (last user message as content)
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const content = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : (lastUserMsg?.content as Array<{ text?: string }>)?.map(c => c.text || '').join('\n') || '';

  // Build conversation history for context
  const history = messages.slice(0, -1).map(msg => {
    const msgContent = typeof msg.content === 'string'
      ? msg.content
      : (msg.content as Array<{ text?: string }>)?.map(c => c.text || '').join('\n') || '';
    if (msg.role === 'user') {
      return { userInputMessage: { content: msgContent } };
    }
    return { assistantResponseMessage: { content: msgContent } };
  });

  const requestBody: Record<string, unknown> = {
    conversationState: {
      currentMessage: {
        userInputMessage: { content },
      },
      chatTriggerType: 'MANUAL',
      ...(history.length > 0 ? { history } : {}),
    },
    profileArn: KIRO_PROFILE_ARN,
  };

  // If model is not 'auto', specify it
  if (model && model !== 'auto') {
    (requestBody.conversationState as Record<string, unknown>).customization = { modelId: model };
  }

  const response = await fetch(KIRO_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'Kiro/1.0.0',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => '');
    throw new Error(`Kiro API error (${response.status}): ${error}`);
  }

  // Transform AWS Event Stream to SSE format
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let totalContent = '';
  let pendingBuffer = new Uint8Array(0);
  const encoder = new TextEncoder();

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Concatenate with any pending buffer from previous chunk
      const combined = new Uint8Array(pendingBuffer.length + chunk.length);
      combined.set(pendingBuffer);
      combined.set(chunk, pendingBuffer.length);
      pendingBuffer = new Uint8Array(0);

      const events = parseAwsEventStream(combined);
      for (const event of events) {
        if (event.content) {
          totalContent += event.content;
          const sseData = JSON.stringify({
            choices: [{ delta: { content: event.content } }],
          });
          controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
        }
      }

      // If the chunk ends mid-JSON, keep trailing bytes
      // Check if there's an incomplete JSON at the end
      const text = new TextDecoder('utf-8', { fatal: false }).decode(combined);
      const lastBrace = text.lastIndexOf('{"content"');
      const lastClose = text.lastIndexOf('"}');
      if (lastBrace > lastClose) {
        // Incomplete JSON at end - buffer it
        const incompleteStart = new TextEncoder().encode(text.substring(lastBrace)).length;
        pendingBuffer = combined.slice(combined.length - incompleteStart);
      }
    },
    flush(controller) {
      // Estimate tokens
      usage = {
        promptTokens: estimateTokens(content),
        completionTokens: estimateTokens(totalContent),
        totalTokens: estimateTokens(content) + estimateTokens(totalContent),
      };
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
    },
  });

  const piped = response.body!.pipeThrough(transformStream);

  return {
    stream: piped,
    getUsage: () => usage,
  };
}

// ============ GENERIC OPENAI-COMPATIBLE ============

function resolveBaseUrl(provider: ProviderConfig): string {
  let baseUrl = provider.baseUrl;
  if (provider.type === 'kiro_refresh_token' && (!baseUrl || baseUrl === '')) {
    baseUrl = KIRO_CHAT_ENDPOINT;
  }
  return baseUrl.replace(/\/+$/, '');
}

async function resolveApiKey(provider: ProviderConfig): Promise<string> {
  const decryptedKey = decrypt(provider.apiKey);
  if (provider.type === 'kiro_refresh_token') {
    const { accessToken } = await getKiroAccessToken(decryptedKey);
    return accessToken;
  }
  return decryptedKey;
}

export async function streamChat(
  provider: ProviderConfig,
  model: string,
  messages: ChatMessage[],
): Promise<StreamResult> {
  // Kiro uses its own protocol (AWS Event Stream), not OpenAI-compatible
  if (provider.type === 'kiro_refresh_token') {
    const decryptedKey = decrypt(provider.apiKey);
    return streamKiroChat(decryptedKey, model, messages);
  }

  // Standard OpenAI-compatible flow
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
  // Kiro models are hardcoded (no /models endpoint)
  if (provider.type === 'kiro_refresh_token') {
    // Validate token works
    try {
      const decryptedKey = decrypt(provider.apiKey);
      await getKiroAccessToken(decryptedKey);
      return KIRO_MODELS;
    } catch {
      return [];
    }
  }

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
