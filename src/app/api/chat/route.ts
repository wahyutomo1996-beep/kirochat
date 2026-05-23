import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { streamChat, estimateTokens } from '@/lib/providers';
import { streamKiroChat, type ChatMessage } from '@/lib/kiro-chat';
import { recordKiroUsage } from '@/lib/kiro-pool';
import { findModel } from '@/lib/models';
import { estimateCost } from '@/lib/pricing';
import {
  isVisionCapable,
  isKiroBacked,
  pickVisionFallback,
  type ProviderLike,
} from '@/lib/vision';
import { PROMETHEUS_PROVIDER_ID } from '@/lib/constants';
import { apiError, errorMessage } from '@/lib/http';

interface ChatPayload {
  conversationId?: string | null;
  message?: string;
  images?: string[];
  providerId: string;
  model: string;
}

interface ResolvedProvider {
  /** Database row, or null when using the built-in Prometheus pool */
  row: {
    id: string;
    name: string;
    type: string;
    baseUrl: string;
    apiKey: string;
  } | null;
  /** Display name (used in usage tracking) */
  name: string;
  /** True iff this resolved to the built-in Prometheus pool */
  isBuiltin: boolean;
}

interface VisionRouteDecision {
  /** The provider we should actually send the request to */
  provider: ResolvedProvider;
  /** The model id (already in provider-native format) */
  model: string;
  /** True iff we silently rerouted away from the user's selection */
  rerouted: boolean;
  /** Provider name the user originally selected (for UI banner) */
  originalProviderName?: string;
}

/* -------------------------------------------------------------------------- */
/*  Provider resolution                                                       */
/* -------------------------------------------------------------------------- */

async function resolveProvider(
  userId: string,
  providerId: string,
): Promise<ResolvedProvider | { error: string; status: number }> {
  if (providerId === PROMETHEUS_PROVIDER_ID) {
    const activeAccountCount = await prisma.kiroAccount.count({
      where: { userId, status: 'active' },
    });
    if (activeAccountCount === 0) {
      return {
        error:
          'Prometheus has no active Kiro accounts. Add at least one refresh token in Settings → Kiro Account Pool.',
        status: 400,
      };
    }
    return { row: null, name: 'Prometheus', isBuiltin: true };
  }

  const row = await prisma.provider.findFirst({
    where: { id: providerId, userId, isActive: true },
  });

  if (!row) return { error: 'Provider not found or inactive', status: 404 };

  return {
    row: {
      id: row.id,
      name: row.name,
      type: row.type,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
    },
    name: row.name,
    isBuiltin: false,
  };
}

/**
 * Decide where to actually send the request when images are involved.
 *
 * If the selected provider can handle images directly, return it as-is.
 * Otherwise, scan the user's other providers for a vision-capable one
 * and reroute. Returns null if no fallback exists - the caller will then
 * strip images and append a note instead.
 */
async function resolveVisionRoute(
  userId: string,
  selected: ResolvedProvider,
  selectedModel: string,
  hasImages: boolean,
): Promise<VisionRouteDecision> {
  if (!hasImages) {
    return { provider: selected, model: selectedModel, rerouted: false };
  }

  // Selected provider already supports images
  if (selected.row && isVisionCapable(selected.row, selectedModel)) {
    return { provider: selected, model: selectedModel, rerouted: false };
  }
  if (!isKiroBacked(selected.row, selected.isBuiltin)) {
    // Non-Kiro provider but its model doesn't match vision patterns.
    // We let it through anyway - the user picked it explicitly.
    return { provider: selected, model: selectedModel, rerouted: false };
  }

  // Selected is Kiro-backed -> need fallback
  const candidates = await prisma.provider.findMany({
    where: { userId, isActive: true },
    select: { id: true, name: true, type: true, baseUrl: true, models: true, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

  const fallback = pickVisionFallback(candidates as ProviderLike[]);
  if (!fallback) {
    return {
      provider: selected,
      model: selectedModel,
      rerouted: false,
      originalProviderName: selected.name,
    };
  }

  // Load the FK record (we need apiKey which the projection above omits)
  const full = await prisma.provider.findFirst({
    where: { id: fallback.provider.id, userId },
  });
  if (!full) {
    return { provider: selected, model: selectedModel, rerouted: false };
  }

  return {
    provider: {
      row: {
        id: full.id,
        name: full.name,
        type: full.type,
        baseUrl: full.baseUrl,
        apiKey: full.apiKey,
      },
      name: full.name,
      isBuiltin: false,
    },
    model: fallback.model,
    rerouted: true,
    originalProviderName: selected.name,
  };
}

/* -------------------------------------------------------------------------- */
/*  Message building                                                          */
/* -------------------------------------------------------------------------- */

interface DbMessage {
  role: string;
  content: string;
  images: string;
}

function buildApiMessages(dbMessages: DbMessage[], targetSupportsImages: boolean): ChatMessage[] {
  return dbMessages.map((msg): ChatMessage => {
    const msgImages = parseJsonArray<string>(msg.images);

    if (msgImages.length === 0) {
      return { role: msg.role as ChatMessage['role'], content: msg.content };
    }

    if (!targetSupportsImages) {
      const note =
        `\n\n[Note: user attached ${msgImages.length} image${msgImages.length > 1 ? 's' : ''} ` +
        `but the current backend doesn't support image input. ` +
        `Please describe the image in text or switch to a vision-capable provider.]`;
      return { role: msg.role as ChatMessage['role'], content: (msg.content || '') + note };
    }

    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const img of msgImages) content.push({ type: 'image_url', image_url: { url: img } });
    return { role: msg.role as ChatMessage['role'], content };
  });
}

function parseJsonArray<T>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function flattenContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(c => c.text || '').join(' ');
}

/* -------------------------------------------------------------------------- */
/*  Stream dispatch                                                           */
/* -------------------------------------------------------------------------- */

async function dispatchStream(
  userId: string,
  decision: VisionRouteDecision,
  messages: ChatMessage[],
): Promise<{
  stream: ReadableStream;
  getUsage: () => { promptTokens: number; completionTokens: number; totalTokens: number };
  kiroAccountId: string | null;
}> {
  const { provider, model } = decision;

  if (provider.isBuiltin) {
    const openaiModelId = model.startsWith('kiro/') ? model : `kiro/${model}`;
    if (!findModel(openaiModelId)) {
      throw new Error(`Unknown built-in model: ${model}`);
    }
    const result = await streamKiroChat(userId, openaiModelId, messages);
    return {
      stream: result.stream,
      getUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
      kiroAccountId: result.accountId,
    };
  }

  if (!provider.row) {
    throw new Error('Provider row missing for non-builtin route');
  }

  const result = await streamChat(
    { type: provider.row.type, baseUrl: provider.row.baseUrl, apiKey: provider.row.apiKey },
    model,
    messages,
  );
  return { ...result, kiroAccountId: null };
}

/* -------------------------------------------------------------------------- */
/*  Route handler                                                             */
/* -------------------------------------------------------------------------- */

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let convId: string | null = null;
  let userId = '';
  let trackingProviderId: string | null = null;
  let trackingProviderName = '';
  let modelUsed = '';

  try {
    const session = await requireAuth();
    userId = session.userId;

    const payload = (await request.json()) as ChatPayload;
    const { conversationId, message, images = [], providerId, model } = payload;
    modelUsed = model;

    // ---- Validate ----
    if (!message?.trim() && images.length === 0) {
      return NextResponse.json({ error: 'Message or image required' }, { status: 400 });
    }
    if (!providerId || !model) {
      return NextResponse.json({ error: 'Provider and model required' }, { status: 400 });
    }

    // ---- Resolve selected provider ----
    const selectedResult = await resolveProvider(userId, providerId);
    if ('error' in selectedResult) {
      return NextResponse.json({ error: selectedResult.error }, { status: selectedResult.status });
    }

    // ---- Vision routing decision ----
    const decision = await resolveVisionRoute(userId, selectedResult, model, images.length > 0);
    trackingProviderId = decision.provider.isBuiltin ? null : decision.provider.row?.id ?? null;
    trackingProviderName = decision.provider.name;

    // ---- Get or create conversation ----
    convId = conversationId ?? null;
    if (!convId) {
      const conv = await prisma.conversation.create({
        data: {
          userId,
          title: message?.slice(0, 50) || 'Image Analysis',
          model,
          provider: trackingProviderName,
        },
      });
      convId = conv.id;
    }

    // ---- Save user message ----
    await prisma.message.create({
      data: {
        conversationId: convId,
        role: 'user',
        content: message || '',
        images: JSON.stringify(images),
        model,
      },
    });

    // ---- Build API messages ----
    const dbMessages = await prisma.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: 'asc' },
    });

    const targetSupportsImages = !isKiroBacked(decision.provider.row, decision.provider.isBuiltin);
    const apiMessages = buildApiMessages(dbMessages, targetSupportsImages);

    // ---- Dispatch ----
    const {
      stream: upstreamStream,
      getUsage,
      kiroAccountId,
    } = await dispatchStream(userId, decision, apiMessages);

    // ---- Pipe through SSE transformer ----
    let fullResponse = '';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Pre-emit a routing notice if we silently rerouted
    const routingPrefix = decision.rerouted
      ? `data: ${JSON.stringify({
          rerouted: true,
          from: decision.originalProviderName,
          to: decision.provider.name,
          model: decision.model,
          conversationId: convId,
        })}\n\n`
      : null;

    const transformStream = new TransformStream({
      start(controller) {
        if (routingPrefix) controller.enqueue(encoder.encode(routingPrefix));
      },
      transform(chunk, controller) {
        const text = decoder.decode(chunk);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            const content: string = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content, conversationId: convId })}\n\n`),
              );
            }
          } catch {
            /* ignore malformed SSE chunks */
          }
        }
      },
      async flush() {
        const latencyMs = Date.now() - startTime;
        let usage = getUsage();

        if (usage.totalTokens === 0 && fullResponse) {
          const promptText = apiMessages.map(m => flattenContent(m.content)).join(' ');
          usage = {
            promptTokens: estimateTokens(promptText),
            completionTokens: estimateTokens(fullResponse),
            totalTokens: estimateTokens(promptText) + estimateTokens(fullResponse),
          };
        }

        const cost = estimateCost(decision.model, usage.promptTokens, usage.completionTokens);

        if (!fullResponse || !convId) return;

        await prisma.message.create({
          data: {
            conversationId: convId,
            role: 'assistant',
            content: fullResponse,
            model: decision.model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            latencyMs,
          },
        });

        await prisma.usage.create({
          data: {
            userId,
            providerId: trackingProviderId,
            providerName: trackingProviderName,
            kiroAccountId,
            model: decision.model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            latencyMs,
            cost,
            success: true,
          },
        });

        // Aggregate per-account counters for fast Settings rendering
        if (kiroAccountId) {
          await recordKiroUsage(
            kiroAccountId,
            usage.promptTokens,
            usage.completionTokens,
          );
        }

        const msgCount = await prisma.message.count({ where: { conversationId: convId } });
        if (msgCount <= 2) {
          const firstUserMsg = await prisma.message.findFirst({
            where: { conversationId: convId, role: 'user' },
            orderBy: { createdAt: 'asc' },
          });
          const title =
            firstUserMsg?.content?.slice(0, 50).replace(/\n/g, ' ') ||
            fullResponse.slice(0, 50).replace(/\n/g, ' ') ||
            'New Chat';
          await prisma.conversation.update({ where: { id: convId }, data: { title } });
        }
      },
    });

    upstreamStream.pipeThrough(transformStream);

    return new Response(transformStream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Conversation-Id': convId!,
        ...(decision.rerouted
          ? {
              'X-Vision-Rerouted': '1',
              'X-Vision-From': encodeURIComponent(decision.originalProviderName ?? ''),
              'X-Vision-To': encodeURIComponent(decision.provider.name),
            }
          : {}),
      },
    });
  } catch (error: unknown) {
    const message = errorMessage(error);

    if (userId) {
      await prisma.usage
        .create({
          data: {
            userId,
            providerId: trackingProviderId,
            providerName: trackingProviderName || 'unknown',
            model: modelUsed || 'unknown',
            latencyMs: Date.now() - startTime,
            success: false,
            errorMessage: message.slice(0, 500),
          },
        })
        .catch(() => {});
    }

    return apiError(error);
  }
}
