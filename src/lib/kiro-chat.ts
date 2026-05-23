/**
 * Kiro Chat Streaming
 *
 * Sends a chat request to Kiro's CodeWhisperer endpoint and streams the
 * response back as Server-Sent Events (SSE) in OpenAI-compatible format.
 */

import { pickKiroAccount, markAccountExhausted, refreshKiroToken } from './kiro-pool';
import { findModel } from './models';
import { encrypt } from './encryption';
import { prisma } from './prisma';

const KIRO_CHAT_ENDPOINT = 'https://q.us-east-1.amazonaws.com/generateAssistantResponse';
const KIRO_PROFILE_ARN = 'arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface KiroStreamResult {
  stream: ReadableStream;
  accountId: string;
  modelUsed: string;
}

/**
 * Parse AWS Event Stream binary frames into JSON content events.
 * Handles partial chunks at frame boundaries.
 */
function parseEventStreamChunk(buffer: Uint8Array): {
  events: Array<{ content?: string; modelId?: string }>;
  remaining: Uint8Array;
} {
  const events: Array<{ content?: string; modelId?: string }> = [];
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  // Match complete JSON objects
  const jsonRegex = /\{"content":"((?:[^"\\]|\\.)*)","modelId":"([^"]*)"\}/g;
  let match: RegExpExecArray | null;
  let lastEnd = 0;
  while ((match = jsonRegex.exec(text)) !== null) {
    try {
      const content = match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      events.push({ content, modelId: match[2] });
      lastEnd = match.index + match[0].length;
    } catch {}
  }

  // Check if there's incomplete JSON at the end
  const tailStart = text.lastIndexOf('{"content"');
  if (tailStart >= 0 && tailStart >= lastEnd) {
    // Incomplete - buffer it
    const tail = new Uint8Array(new TextEncoder().encode(text.substring(tailStart)));
    return { events, remaining: tail };
  }

  return { events, remaining: new Uint8Array(0) };
}

/**
 * Build the conversation state from chat messages.
 */
function buildConversationState(messages: ChatMessage[], modelId: string | undefined) {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const content = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : (lastUserMsg?.content as Array<{ text?: string }>)?.map(c => c.text || '').join('\n') || '';

  // History excludes the current message
  const history = messages.slice(0, -1).map(msg => {
    const msgContent = typeof msg.content === 'string'
      ? msg.content
      : (msg.content as Array<{ text?: string }>)?.map(c => c.text || '').join('\n') || '';
    if (msg.role === 'user' || msg.role === 'system') {
      return { userInputMessage: { content: msgContent, modelId } };
    }
    return { assistantResponseMessage: { content: msgContent } };
  });

  return {
    conversationState: {
      currentMessage: {
        userInputMessage: {
          content,
          modelId,
          origin: 'AI_EDITOR',
        },
      },
      chatTriggerType: 'MANUAL',
      ...(history.length > 0 ? { history } : {}),
    },
    profileArn: KIRO_PROFILE_ARN,
  };
}

/**
 * Stream a chat completion from Kiro using the user's account pool.
 * Returns OpenAI-compatible SSE stream.
 */
export async function streamKiroChat(
  userId: string,
  modelIdParam: string,
  messages: ChatMessage[],
): Promise<KiroStreamResult> {
  // Resolve the model
  const found = findModel(modelIdParam);
  if (!found) {
    throw new Error(`Unknown model: ${modelIdParam}. Use /v1/models to list available models.`);
  }
  const { model, thinking } = found;

  if (model.provider !== 'kiro') {
    throw new Error(`Model ${modelIdParam} is not a Kiro model`);
  }

  // Pick an account from the pool
  const account = await pickKiroAccount(userId);

  // Build request - thinking variant doesn't change the modelId on the wire,
  // it's handled via extra params (TODO: enable thinking mode via system message
  // or stop sequence patterns once we've confirmed Kiro's actual thinking trigger)
  const kiroModelId = model.kiroModelId;
  const requestBody = buildConversationState(messages, kiroModelId);
  void thinking; // currently unused, reserved for future thinking-mode dispatch

  const response = await fetch(KIRO_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${account.accessToken}`,
      'User-Agent': 'Prometheus/1.0',
      'x-amzn-kiro-agent-mode': 'q-developer-converse',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    // Mark account exhausted on quota / rate limit errors
    if (response.status === 429 || response.status === 403) {
      await markAccountExhausted(account.accountId, `Kiro ${response.status}: ${errText.slice(0, 200)}`);
    }
    throw new Error(`Kiro API error (${response.status}): ${errText}`);
  }

  // Transform AWS Event Stream to OpenAI-compatible SSE
  let pendingBuffer: Uint8Array = new Uint8Array(new ArrayBuffer(0));
  const encoder = new TextEncoder();
  const completionId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let firstChunk = true;

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const combinedBuffer = new ArrayBuffer(pendingBuffer.length + chunk.length);
      const combined = new Uint8Array(combinedBuffer);
      combined.set(pendingBuffer);
      combined.set(chunk, pendingBuffer.length);

      const { events, remaining } = parseEventStreamChunk(combined);
      pendingBuffer = remaining as Uint8Array;

      // Emit initial role chunk on first event
      if (firstChunk && events.length > 0) {
        firstChunk = false;
        const roleChunk = {
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: modelIdParam,
          choices: [{
            index: 0,
            delta: { role: 'assistant', content: '' },
            finish_reason: null,
          }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));
      }

      for (const event of events) {
        if (event.content) {
          const sseChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model: modelIdParam,
            choices: [{
              index: 0,
              delta: { content: event.content },
              finish_reason: null,
            }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(sseChunk)}\n\n`));
        }
      }
    },
    flush(controller) {
      const finalChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: modelIdParam,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });

  return {
    stream: response.body!.pipeThrough(transformStream),
    accountId: account.accountId,
    modelUsed: modelIdParam,
  };
}

/**
 * Non-streaming chat completion (collects full response).
 */
export async function generateKiroChat(
  userId: string,
  modelIdParam: string,
  messages: ChatMessage[],
): Promise<{
  content: string;
  accountId: string;
  modelUsed: string;
}> {
  const found = findModel(modelIdParam);
  if (!found) {
    throw new Error(`Unknown model: ${modelIdParam}`);
  }
  const { model, thinking } = found;
  if (model.provider !== 'kiro') {
    throw new Error(`Model ${modelIdParam} is not a Kiro model`);
  }

  const account = await pickKiroAccount(userId);
  const kiroModelId = model.kiroModelId;
  const requestBody = buildConversationState(messages, kiroModelId);
  void thinking;

  const response = await fetch(KIRO_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${account.accessToken}`,
      'User-Agent': 'Prometheus/1.0',
      'x-amzn-kiro-agent-mode': 'q-developer-converse',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    if (response.status === 429 || response.status === 403) {
      await markAccountExhausted(account.accountId, `Kiro ${response.status}: ${errText.slice(0, 200)}`);
    }
    throw new Error(`Kiro API error (${response.status}): ${errText}`);
  }

  // Read entire stream and parse
  const reader = response.body!.getReader();
  let allBytes: Uint8Array = new Uint8Array(new ArrayBuffer(0));
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const nextBuffer = new ArrayBuffer(allBytes.length + value.length);
    const next = new Uint8Array(nextBuffer);
    next.set(allBytes);
    next.set(value, allBytes.length);
    allBytes = next;
  }

  const { events } = parseEventStreamChunk(allBytes);
  const content = events.map(e => e.content || '').join('');

  return {
    content,
    accountId: account.accountId,
    modelUsed: modelIdParam,
  };
}

// Suppress unused warnings for imports we may want later
void encrypt;
void prisma;
void refreshKiroToken;
