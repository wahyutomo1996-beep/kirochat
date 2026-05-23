import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-key-auth';
import { streamKiroChat, generateKiroChat, type ChatMessage } from '@/lib/kiro-chat';
import { findModel } from '@/lib/models';
import { prisma } from '@/lib/prisma';

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
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

    // Currently only Kiro provider is supported
    if (found.model.provider !== 'kiro') {
      return NextResponse.json(
        { error: { message: `Provider ${found.model.provider} is not yet implemented. Only Kiro models are currently supported.`, type: 'invalid_request_error' } },
        { status: 501 },
      );
    }

    // Streaming response
    if (stream) {
      const result = await streamKiroChat(userId, model, messages);

      // Track usage in background (don't block streaming)
      const promptText = messages.map(m =>
        typeof m.content === 'string' ? m.content : '',
      ).join(' ');

      // Fire-and-forget usage tracking
      Promise.resolve().then(async () => {
        try {
          await prisma.usage.create({
            data: {
              userId,
              providerId: '',
              providerName: 'kiro-pool',
              model: modelUsed,
              promptTokens: Math.ceil(promptText.length / 4),
              completionTokens: 0,
              totalTokens: Math.ceil(promptText.length / 4),
              latencyMs: Date.now() - startTime,
              success: true,
            },
          }).catch(() => {});
        } catch {}
      });

      return new Response(result.stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Non-streaming response
    const result = await generateKiroChat(userId, model, messages);
    const promptText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');
    const promptTokens = Math.ceil(promptText.length / 4);
    const completionTokens = Math.ceil(result.content.length / 4);

    // Track usage
    await prisma.usage.create({
      data: {
        userId,
        providerId: '',
        providerName: 'kiro-pool',
        model: modelUsed,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        latencyMs: Date.now() - startTime,
        success: true,
      },
    }).catch(() => {});

    const completionId = `chatcmpl-${Date.now()}`;
    return NextResponse.json({
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
        total_tokens: promptTokens + completionTokens,
      },
    }, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const isAuth = message.includes('Authorization') || message.includes('API key') || message.includes('not approved');
    const status = isAuth ? 401 : message.includes('not found') ? 404 : 500;

    // Track failed request
    if (userId) {
      await prisma.usage.create({
        data: {
          userId,
          providerId: '',
          providerName: 'kiro-pool',
          model: modelUsed || 'unknown',
          latencyMs: Date.now() - startTime,
          success: false,
          errorMessage: message.slice(0, 500),
        },
      }).catch(() => {});
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
