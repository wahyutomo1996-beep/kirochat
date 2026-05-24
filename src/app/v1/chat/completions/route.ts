import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-key-auth';
import { streamKiroChat, generateKiroChat, type ChatMessage } from '@/lib/kiro-chat';
import { findModel } from '@/lib/models';
import { prisma } from '@/lib/prisma';
import { recordKiroUsage } from '@/lib/kiro-pool';
import { estimateTokens } from '@/lib/providers';
import { estimateCost } from '@/lib/pricing';
import { rateLimit } from '@/lib/ratelimit';
import { readJsonBody, corsHeaders, PayloadTooLargeError } from '@/lib/http';
import { compressMessages } from '@/lib/rtk-compression';

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

const GATEWAY_RPM = Math.max(1, parseInt(process.env.GATEWAY_RPM || '60', 10));
const RATE_WINDOW_MS = 60_000;
/** 5MB body limit for chat completions - room for base64 images, blocks DoS */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(c => c.text || '').join(' ');
}

/**
 * OpenAI-compatible: POST /v1/chat/completions
 *
 * Routes chat requests to the appropriate provider based on model ID.
 * Supports both streaming (SSE) and non-streaming responses.
 *
 * SECURITY:
 *   - API key auth required (Bearer pmt-...)
 *   - 5MB body limit (DoS protection)
 *   - Per-API-key rate limit (configurable via GATEWAY_RPM)
 *   - CORS off by default - opt in via GATEWAY_CORS_ORIGINS env
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  let userId = '';
  let modelUsed = '';
  const cors = corsHeaders(request);

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
            ...cors,
            'Retry-After': String(Math.ceil(limit.resetIn / 1000)),
            'X-RateLimit-Limit': String(GATEWAY_RPM),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil((Date.now() + limit.resetIn) / 1000)),
          },
        },
      );
    }

    const body = await readJsonBody<ChatCompletionRequest>(request, MAX_BODY_BYTES);
    const { model, messages: rawMessages, stream } = body;

    if (!model) {
      return NextResponse.json(
        { error: { message: 'model is required', type: 'invalid_request_error' } },
        { status: 400, headers: cors },
      );
    }
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return NextResponse.json(
        { error: { message: 'messages array is required', type: 'invalid_request_error' } },
        { status: 400, headers: cors },
      );
    }

    // Apply RTK compression unless user opts out via x-rtk-disable header.
    // Saves 20-40% input tokens on requests carrying tool_result blocks
    // (git diff, grep, ls, file dumps from coding agents).
    const rtkDisabled = request.headers.get('x-rtk-disable') === '1';
    const { messages, stats: rtkStats } = rtkDisabled
      ? { messages: rawMessages, stats: null }
      : compressMessages(rawMessages);

    const found = findModel(model);
    if (!found) {
      return NextResponse.json(
        { error: { message: `Model ${model} not found. Use /v1/models to list available models.`, type: 'invalid_request_error', code: 'model_not_found' } },
        { status: 404, headers: cors },
      );
    }

    modelUsed = model;

    if (found.model.provider !== 'kiro') {
      return NextResponse.json(
        { error: { message: `Provider ${found.model.provider} is not yet implemented. Only Kiro models are currently supported.`, type: 'invalid_request_error' } },
        { status: 501, headers: cors },
      );
    }

    const promptText = messages.map(m => flattenContent(m.content)).join(' ');
    const promptTokens = estimateTokens(promptText);

    /* --------------------------------- Streaming -------------------------- */

    if (stream) {
      const result = await streamKiroChat(userId, model, messages);
      const accountId = result.accountId;

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let sseLineBuffer = '';

      const accountingStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
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
            } catch { /* ignore */ }
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
          ...cors,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-RateLimit-Limit': String(GATEWAY_RPM),
          'X-RateLimit-Remaining': String(limit.remaining),
          ...(rtkStats && rtkStats.blocksCompressed > 0
            ? {
                'X-RTK-Saved': String(rtkStats.bytesBefore - rtkStats.bytesAfter),
                'X-RTK-Blocks': String(rtkStats.blocksCompressed),
              }
            : {}),
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
          ...cors,
          'X-RateLimit-Limit': String(GATEWAY_RPM),
          'X-RateLimit-Remaining': String(limit.remaining),
          ...(rtkStats && rtkStats.blocksCompressed > 0
            ? {
                'X-RTK-Saved': String(rtkStats.bytesBefore - rtkStats.bytesAfter),
                'X-RTK-Blocks': String(rtkStats.blocksCompressed),
              }
            : {}),
        },
      },
    );
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { error: { message: err.message, type: 'invalid_request_error', code: 'payload_too_large' } },
        { status: 413, headers: cors },
      );
    }

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
      { status, headers: cors },
    );
  }
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
