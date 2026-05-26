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
import { resolveCombo, parseComboRef, isFallThroughError } from '@/lib/combo-dispatch';
import { compressMessages } from '@/lib/rtk-compression';
import {
  normalizeWorkspaceId,
  resolveWorkspaceSettings,
  parseUserWorkspaceSettings,
} from '@/lib/workspaces';

interface ChatPayload {
  conversationId?: string | null;
  message?: string;
  images?: string[];
  providerId: string;
  model: string;
  /** Workspace id ('general' | 'coding' | 'trading') for new conversations */
  workspace?: string;
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

interface BridgeNotice {
  /** Provider that ran the vision call (e.g. "Gemini") */
  providerName: string;
  /** Total ms spent across all bridge calls in this request */
  totalLatencyMs: number;
  /** How many images were processed via the bridge */
  imageCount: number;
  /** Number of images served from cache */
  fromCacheCount: number;
  /** Soft warning when no vision provider exists or call failed */
  warning?: string;
}

/**
 * Convert DB messages into the API shape (string or content-array).
 *
 * Three modes:
 *   - target supports images: pass content blocks through verbatim
 *   - target doesnt support images + bridge ENABLED: call vision-bridge
 *     for each image, inline the description, return text content only
 *   - target doesnt support images + bridge DISABLED: append a note
 *     "[Image attached but backend doesnt support it]"
 *
 * Returns the rebuilt messages plus a notice describing what happened
 * (if any bridging occurred), so the chat route can surface it via SSE.
 */
async function buildApiMessages(
  dbMessages: DbMessage[],
  targetSupportsImages: boolean,
  bridgeEnabled: boolean,
  userId: string,
  workspace: string,
): Promise<{ messages: ChatMessage[]; bridgeNotice: BridgeNotice | null }> {
  // Pull bridge lazily so we never import it when no images are around
  let bridgeImage: typeof import('@/lib/vision-bridge').bridgeImage | null = null;
  let formatBridgedDescription:
    | typeof import('@/lib/vision-bridge').formatBridgedDescription
    | null = null;

  let totalLatencyMs = 0;
  let imageCount = 0;
  let fromCacheCount = 0;
  let providerName = '';
  let warning: string | undefined;

  const out: ChatMessage[] = [];

  for (const msg of dbMessages) {
    const msgImages = parseJsonArray<string>(msg.images);

    if (msgImages.length === 0) {
      out.push({ role: msg.role as ChatMessage['role'], content: msg.content });
      continue;
    }

    // Native vision-capable target: pass through as content blocks.
    if (targetSupportsImages) {
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const img of msgImages) content.push({ type: 'image_url', image_url: { url: img } });
      out.push({ role: msg.role as ChatMessage['role'], content });
      continue;
    }

    // Target is text-only AND bridge enabled -> describe each image
    if (bridgeEnabled) {
      if (!bridgeImage) {
        const mod = await import('@/lib/vision-bridge');
        bridgeImage = mod.bridgeImage;
        formatBridgedDescription = mod.formatBridgedDescription;
      }
      const descriptions: string[] = [];
      for (let i = 0; i < msgImages.length; i++) {
        const result = await bridgeImage(userId, msgImages[i], workspace);
        descriptions.push(formatBridgedDescription!(result, i));
        imageCount++;
        if ('error' in result) {
          warning = result.error;
        } else {
          totalLatencyMs += result.latencyMs;
          if (result.fromCache) fromCacheCount++;
          if (!providerName) providerName = result.providerName;
        }
      }
      // Combine: original user text + bridged descriptions, all as one text msg
      const combined = [msg.content, ...descriptions].filter(Boolean).join('\n\n');
      out.push({ role: msg.role as ChatMessage['role'], content: combined });
      continue;
    }

    // Bridge disabled fallback: append a note so the model knows images
    // were attached but werent forwarded.
    const note =
      `\n\n[Note: user attached ${msgImages.length} image${msgImages.length > 1 ? 's' : ''} ` +
      `but the current backend doesnt support image input. Please describe the image ` +
      `in text or enable image bridging in Settings.]`;
    out.push({ role: msg.role as ChatMessage['role'], content: (msg.content || '') + note });
  }

  const bridgeNotice: BridgeNotice | null =
    imageCount > 0 || warning
      ? { providerName, totalLatencyMs, imageCount, fromCacheCount, warning }
      : null;

  return { messages: out, bridgeNotice };
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

/**
 * Combo-aware dispatch. If `comboSteps` is provided, walks the chain:
 * try step 0; on rate-limit / quota / transient error, try step 1; etc.
 *
 * Returns the FIRST successful step's stream + records which step won
 * via the `winningStepIndex` field so the UI can show "served from
 * fallback step 2 (Claude Sonnet)".
 *
 * If all steps fail, throws the last error.
 */
async function dispatchComboStream(
  userId: string,
  steps: Array<{ provider: ResolvedProvider; model: string }>,
  messages: ChatMessage[],
): Promise<{
  stream: ReadableStream;
  getUsage: () => { promptTokens: number; completionTokens: number; totalTokens: number };
  kiroAccountId: string | null;
  winningStepIndex: number;
  winningProviderName: string;
  winningModel: string;
  attemptErrors: Array<{ stepIndex: number; providerName: string; model: string; error: string }>;
}> {
  const errors: Array<{ stepIndex: number; providerName: string; model: string; error: string }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const decision: VisionRouteDecision = {
      provider: step.provider,
      model: step.model,
      rerouted: false,
    };
    try {
      const result = await dispatchStream(userId, decision, messages);
      return {
        ...result,
        winningStepIndex: i,
        winningProviderName: step.provider.name,
        winningModel: step.model,
        attemptErrors: errors,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({
        stepIndex: i,
        providerName: step.provider.name,
        model: step.model,
        error: msg.slice(0, 200),
      });

      // Only fall through on transient/quota errors. Hard errors
      // (model-not-found, malformed payload) bubble immediately.
      if (!isFallThroughError(err) || i === steps.length - 1) {
        throw err;
      }
      // Otherwise continue to next step
    }
  }

  // Unreachable - the loop either returns or throws on last iteration
  throw new Error('Combo dispatch exhausted with no result');
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
    const { conversationId, message, images = [], providerId, model, workspace } = payload;
    modelUsed = model;

    // ---- Validate ----
    if (!message?.trim() && images.length === 0) {
      return NextResponse.json({ error: 'Message or image required' }, { status: 400 });
    }
    if (!providerId || !model) {
      return NextResponse.json({ error: 'Provider and model required' }, { status: 400 });
    }

    // ---- Combo detection ----
    // If providerId is "combo", resolve the model field as a combo slug.
    // Combos let users define ordered chains of (provider, model) tried in
    // sequence with auto-fallback on rate-limit / quota / transient errors.
    let comboSteps: Array<{ provider: ResolvedProvider; model: string }> | null = null;
    let comboName = '';
    if (providerId === 'combo') {
      const slug = parseComboRef(model);
      if (!slug) {
        return NextResponse.json(
          {
            error: `Invalid combo slug "${model}". Slugs must be lowercase letters/digits/hyphens (e.g. "coding-premium" or "coding").`,
          },
          { status: 400 },
        );
      }
      const combo = await resolveCombo(userId, slug);
      if (!combo) {
        return NextResponse.json(
          {
            error: `Combo "${slug}" not found or inactive. Recreate it in Settings or pick a different one.`,
          },
          { status: 404 },
        );
      }
      comboName = combo.name;

      // Resolve each step's provider once up-front so we don't re-query DB
      // per fall-through attempt.
      const resolved: Array<{ provider: ResolvedProvider; model: string }> = [];
      for (const step of combo.steps) {
        const r = await resolveProvider(userId, step.providerId);
        if ('error' in r) {
          // Skip steps whose provider was deleted/disabled, but log
          continue;
        }
        resolved.push({ provider: r, model: step.model });
      }
      if (resolved.length === 0) {
        return NextResponse.json(
          {
            error: `Combo "${combo.name}" has no usable steps. All referenced providers were deleted or disabled.`,
          },
          { status: 400 },
        );
      }
      comboSteps = resolved;
      // For tracking purposes we use the FIRST step initially. We'll
      // overwrite with the actual winning step after dispatch.
      trackingProviderId = comboSteps[0].provider.isBuiltin ? null : comboSteps[0].provider.row?.id ?? null;
      trackingProviderName = `combo:${combo.name}`;
    }

    // ---- Resolve selected provider (non-combo path) ----
    let decision: VisionRouteDecision | null = null;
    if (!comboSteps) {
      const selectedResult = await resolveProvider(userId, providerId);
      if ('error' in selectedResult) {
        return NextResponse.json({ error: selectedResult.error }, { status: selectedResult.status });
      }

      // ---- Vision routing decision ----
      decision = await resolveVisionRoute(userId, selectedResult, model, images.length > 0);
      trackingProviderId = decision.provider.isBuiltin ? null : decision.provider.row?.id ?? null;
      trackingProviderName = decision.provider.name;
    }

    // ---- Get or create conversation ----
    convId = conversationId ?? null;
    if (!convId) {
      const conv = await prisma.conversation.create({
        data: {
          userId,
          title: message?.slice(0, 50) || 'Image Analysis',
          model,
          provider: trackingProviderName,
          workspace: normalizeWorkspaceId(workspace),
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

    // For combo: use first step to decide image support; the dispatcher
    // will reroute internally if a step doesn't support images.
    const firstProvider = comboSteps ? comboSteps[0].provider : decision!.provider;
    const targetSupportsImages = !isKiroBacked(firstProvider.row, firstProvider.isBuiltin);

    // Resolve user's per-workspace settings (incl. bridgeImages toggle)
    const userRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { workspaceSettings: true },
    });
    const userSettings = parseUserWorkspaceSettings(userRow?.workspaceSettings);
    const wsSettings = resolveWorkspaceSettings(normalizeWorkspaceId(workspace), userSettings);

    // Async because bridge may need network calls
    const { messages: rawApiMessages, bridgeNotice } = await buildApiMessages(
      dbMessages,
      targetSupportsImages,
      wsSettings.bridgeImages,
      userId,
      normalizeWorkspaceId(workspace),
    );

    // ---- RTK compression (saves 20-40% tokens on tool-output content) ----
    const { messages: apiMessages, stats: rtkStats } = compressMessages(rawApiMessages);

    // ---- Dispatch ----
    let upstreamStream: ReadableStream;
    let getUsage: () => { promptTokens: number; completionTokens: number; totalTokens: number };
    let kiroAccountId: string | null;
    let winningProviderName = trackingProviderName;
    let winningModel = model;
    let comboFallbackInfo: {
      stepIndex: number;
      attemptErrors: Array<{ stepIndex: number; providerName: string; model: string; error: string }>;
    } | null = null;

    if (comboSteps) {
      const result = await dispatchComboStream(userId, comboSteps, apiMessages);
      upstreamStream = result.stream;
      getUsage = result.getUsage;
      kiroAccountId = result.kiroAccountId;
      winningProviderName = result.winningProviderName;
      winningModel = result.winningModel;
      // Update tracking provider to the actual winner
      const winner = comboSteps[result.winningStepIndex].provider;
      trackingProviderId = winner.isBuiltin ? null : winner.row?.id ?? null;
      comboFallbackInfo = {
        stepIndex: result.winningStepIndex,
        attemptErrors: result.attemptErrors,
      };
    } else {
      const result = await dispatchStream(userId, decision!, apiMessages);
      upstreamStream = result.stream;
      getUsage = result.getUsage;
      kiroAccountId = result.kiroAccountId;
      winningProviderName = decision!.provider.name;
      winningModel = decision!.model;
    }

    // ---- Pipe through SSE transformer ----
    let fullResponse = '';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Pre-emit metadata: combo fallback notice OR vision rerouted notice.
    // Bridge notice (when an image was auto-described via a vision provider)
    // is appended separately so users see both signals when relevant.
    const prefixEvents: string[] = [];
    if (comboFallbackInfo && comboFallbackInfo.stepIndex > 0) {
      prefixEvents.push(`data: ${JSON.stringify({
        comboFallback: true,
        stepIndex: comboFallbackInfo.stepIndex,
        winningProvider: winningProviderName,
        winningModel,
        skippedSteps: comboFallbackInfo.attemptErrors,
        comboName,
        conversationId: convId,
      })}\n\n`);
    } else if (decision?.rerouted) {
      prefixEvents.push(`data: ${JSON.stringify({
        rerouted: true,
        from: decision.originalProviderName,
        to: decision.provider.name,
        model: decision.model,
        conversationId: convId,
      })}\n\n`);
    }
    if (bridgeNotice) {
      prefixEvents.push(`data: ${JSON.stringify({
        visionBridge: true,
        providerName: bridgeNotice.providerName,
        imageCount: bridgeNotice.imageCount,
        fromCacheCount: bridgeNotice.fromCacheCount,
        latencyMs: bridgeNotice.totalLatencyMs,
        warning: bridgeNotice.warning ?? null,
        conversationId: convId,
      })}\n\n`);
    }

    const transformStream = new TransformStream({
      start(controller) {
        for (const event of prefixEvents) {
          controller.enqueue(encoder.encode(event));
        }
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

        const cost = estimateCost(winningModel, usage.promptTokens, usage.completionTokens);

        if (!fullResponse || !convId) return;

        await prisma.message.create({
          data: {
            conversationId: convId,
            role: 'assistant',
            content: fullResponse,
            model: winningModel,
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
            model: winningModel,
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

    // Build response headers - include vision rerouted flags only on the
    // non-combo path (combo handles its own routing internally)
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Conversation-Id': convId!,
    };

    if (rtkStats && rtkStats.blocksCompressed > 0) {
      responseHeaders['X-RTK-Saved'] = String(rtkStats.bytesBefore - rtkStats.bytesAfter);
      responseHeaders['X-RTK-Blocks'] = String(rtkStats.blocksCompressed);
    }

    if (decision?.rerouted) {
      responseHeaders['X-Vision-Rerouted'] = '1';
      responseHeaders['X-Vision-From'] = encodeURIComponent(decision.originalProviderName ?? '');
      responseHeaders['X-Vision-To'] = encodeURIComponent(decision.provider.name);
    }
    if (comboFallbackInfo && comboFallbackInfo.stepIndex > 0) {
      responseHeaders['X-Combo-Fallback'] = String(comboFallbackInfo.stepIndex);
      responseHeaders['X-Combo-Winner'] = encodeURIComponent(`${winningProviderName}/${winningModel}`);
    }
    if (bridgeNotice) {
      responseHeaders['X-Vision-Bridge'] = '1';
      responseHeaders['X-Vision-Bridge-Provider'] = encodeURIComponent(bridgeNotice.providerName);
      responseHeaders['X-Vision-Bridge-Images'] = String(bridgeNotice.imageCount);
    }

    return new Response(transformStream.readable, { headers: responseHeaders });
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
