import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-key-auth';
import { streamKiroChat, generateKiroChat, type ChatMessage } from '@/lib/kiro-chat';
import { findModel } from '@/lib/models';
import { prisma } from '@/lib/prisma';
import { recordKiroUsage } from '@/lib/kiro-pool';
import { estimateTokens } from '@/lib/providers';
import { estimateCost } from '@/lib/pricing';
import { rateLimit } from '@/lib/ratelimit';

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

/**
 * Per-API-key rate limit for the OpenAI-compatible gateway.
 *
 * Defaults to 60 req/min — enough for normal interactive chat clients but low
 * enough to keep abusive tight loops from burning the whole pool. Configurable
 * via env: GATEWAY_RPM (requests per minute).
 */
const GATEWAY_RPM = Math.max(1, parseInt(process.env.GATEWAY_RPM || '60', 10));
const RATE_WINDOW_MS = 60_000;

function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(c => c.text || '').join(' ');
}

/**
 * OpenAI-compatible: POST /v1/chat/completions
 *
 * Routes chat requests to the appropriate provider based on model ID.
 * Supports both streaming (SSE) and non-streaming responses.
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  let userId = '';
  let modelUsed = '';

  try {
    const auth = await requireApiKey(request);
    userId = auth.userId;

    // Rate limit per API key (per user) to protect the shared pool.
    const limit = rateLimit(`gw:${userId}`, GATEWAY_RPM, RATE_WINDOW_MS);
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: {
            message: `Rate limit exceeded. Max ${GATEWAY_RPM} requests/minute. Retry in ${Math.ceil(limit.resetIn / 1000)}s.`,
            type: 'rate_limit_exceeded',
            code: 'rate_limit',
          },
        },
        {
          status: 429,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Retry-After': String(Math.ceil(limit.resetIn / 1000)),
            'X-RateLimit-Limit': String(GATEWAY_RPM),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil((Date.now() + limit.resetIn) / 1000)),
          },
        },
      );
    }

    const body: ChatCompletionRequest = await request.json();
    const { model, messages, stream } = body;

    if (!model) {
      return NextResponse.json(
        { error: { message: 'model is required', type: 'invalid_request_error' } },
        { status: 400 },
      );
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: { message: 'messages array is required', type: 'invalid_request_error' } },
        { status: 400 },
      );
    }

    const found = findModel(model);
    if (!found) {
      return NextResponse.json(
        { error: { message: `Model ${model} not found. Use /v1/models to list available models.`, type: 'invalid_request_error', code: 'model_not_found' } },
        { status: 404 },
      );
    }

    modelUsed = model;

    // Currently only Kiro provider is supported via the public gateway
    if (found.model.provider !== 'kiro') {
      return NextResponse.json(
        { error: { message: `Provider ${found.model.provider} is not yet implemented. Only Kiro models are currently supported.`, type: 'invalid_request_error' } },
        { status: 501 },
      );
    }

    const promptText = messages.map(m => flattenContent(m.content)).join(' ');
    const promptTokens = estimateTokens(promptText);

    /* --------------------------------- Streaming -------------------------- */

    if (stream) {
      const result = await streamKiroChat(userId, model, messages);
      const accountId = result.accountId;

      // Tee the upstream SSE so we can read the assistant content for token
      // accounting while still forwarding it byte-for-byte to the client.
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let sseLineBuffer = '';

      const accountingStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          // Forward raw bytes immediately - don't slow down the stream
          controller.enqueue(chunk);

          // Parse OpenAI SSE chunks to recover assistant text for usage
          sseLineBuffer += decoder.decode(chunk, { stream: true });
          const lines = sseLineBuffer.split('\n');
          sseLineBuffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta: string = parsed.choices?.[0]?.delta?.content || '';
              if (delta) fullResponse += delta;
            } catch {
              /* ignore non-JSON lines */
            }
          }
        },
        async flush() {
          const completionTokens = estimateTokens(fullResponse);
          const totalTokens = promptTokens + completionTokens;
          const latencyMs = Date.now() - startTime;
          const cost = estimateCost(model, promptTokens, completionTokens);

          await prisma.usage
            .create({
              data: {
                userId,
                providerId: null,
                providerName: 'kiro-pool',
                kiroAccountId: accountId,
                model,
                promptTokens,
                completionTokens,
                totalTokens,
                latencyMs,
                cost,
                success: true,
              },
            })
            .catch(() => {});

          if (accountId) {
            await recordKiroUsage(accountId, promptTokens, completionTokens);
          }
        },
      });

      return new Response(result.stream.pipeThrough(accountingStream), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
          'X-RateLimit-Limit': String(GATEWAY_RPM),
          'X-RateLimit-Remaining': String(limit.remaining),
        },
      });
    }

    /* ------------------------------ Non-streaming ------------------------- */

    const result = await generateKiroChat(userId, model, messages);
    const accountId = result.accountId;
    const completionTokens = estimateTokens(result.content);
    const totalTokens = promptTokens + completionTokens;
    const latencyMs = Date.now() - startTime;
    const cost = estimateCost(model, promptTokens, completionTokens);

    await prisma.usage
      .create({
        data: {
          userId,
          providerId: null,
          providerName: 'kiro-pool',
          kiroAccountId: accountId,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          latencyMs,
          cost,
          success: true,
        },
      })
      .catch(() => {});

    if (accountId) {
      await recordKiroUsage(accountId, promptTokens, completionTokens);
    }

    const completionId = `chatcmpl-${Date.now()}`;
    return NextResponse.json(
      {
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.content,
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        },
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'X-RateLimit-Limit': String(GATEWAY_RPM),
          'X-RateLimit-Remaining': String(limit.remaining),
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const isAuth = message.includes('Authorization') || message.includes('API key') || message.includes('not approved');
    const isExhausted = message.includes('No active Kiro accounts') || message.includes('All Kiro accounts failed');
    const status = isAuth ? 401 : isExhausted ? 503 : message.includes('not found') ? 404 : 500;

    if (userId) {
      await prisma.usage
        .create({
          data: {
            userId,
            providerId: null,
            providerName: 'kiro-pool',
            model: modelUsed || 'unknown',
            latencyMs: Date.now() - startTime,
            success: false,
            errorMessage: message.slice(0, 500),
          },
        })
        .catch(() => {});
    }

    return NextResponse.json(
      { error: { message, type: 'api_error' } },
      { status, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}
