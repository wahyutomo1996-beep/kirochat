import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { streamChat, estimateTokens } from '@/lib/providers';
import { streamKiroChat, type ChatMessage } from '@/lib/kiro-chat';
import { findModel } from '@/lib/models';
import { estimateCost } from '@/lib/pricing';

const PROMETHEUS_PROVIDER_ID = '__prometheus__';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let convId: string | null = null;
  let providerId = '';
  let providerName = '';
  let modelUsed = '';
  let userId = '';

  try {
    const session = await requireAuth();
    userId = session.userId;
    const { conversationId, message, images, providerId: pId, model } = await request.json();
    providerId = pId;
    modelUsed = model;

    if (!message && (!images || images.length === 0)) {
      return NextResponse.json({ error: 'Message or image required' }, { status: 400 });
    }

    if (!providerId || !model) {
      return NextResponse.json({ error: 'Provider and model required' }, { status: 400 });
    }

    // ============ Built-in Prometheus provider (Kiro Pool) ============
    //
    // Special-cased path: instead of looking up a row in the Provider table,
    // we route the request through the user's KiroAccount pool directly.
    // The model id we get here is something like "claude-opus-4.7" (just the
    // raw kiro model id), so we wrap it in "kiro/<id>" before handing off to
    // streamKiroChat which expects the OpenAI-compatible identifier.
    const isBuiltin = providerId === PROMETHEUS_PROVIDER_ID;

    let provider:
      | {
          id: string;
          name: string;
          type: string;
          baseUrl: string;
          apiKey: string;
        }
      | null = null;

    if (isBuiltin) {
      const activeAccountCount = await prisma.kiroAccount.count({
        where: { userId, status: 'active' },
      });
      if (activeAccountCount === 0) {
        return NextResponse.json(
          { error: 'Prometheus has no active Kiro accounts. Add at least one refresh token in Settings → Kiro Account Pool.' },
          { status: 400 },
        );
      }
      providerName = 'Prometheus';
    } else {
      provider = await prisma.provider.findFirst({
        where: { id: providerId, userId: session.userId, isActive: true },
      });

      if (!provider) {
        return NextResponse.json({ error: 'Provider not found or inactive' }, { status: 404 });
      }

      providerName = provider.name;
    }

    // Get or create conversation
    convId = conversationId;
    if (!convId) {
      const conv = await prisma.conversation.create({
        data: {
          userId: session.userId,
          title: message?.slice(0, 50) || 'Image Analysis',
          model,
          provider: providerName,
        },
      });
      convId = conv.id;
    }

    // Save user message
    await prisma.message.create({
      data: {
        conversationId: convId!,
        role: 'user',
        content: message || '',
        images: JSON.stringify(images || []),
        model,
      },
    });

    // Build messages for API.
    //
    // Image support note: Kiro/CodeWhisperer (the primary backend powering
    // both kiro_refresh_token, the built-in Prometheus pool, and any
    // Kiro-proxy provider) does NOT accept images in the JSON wire format
    // we use. The Kiro IDE itself uses AWS SDK with binary Smithy
    // serialization, which we can't replicate over plain HTTP.
    //
    // Detection: the built-in Prometheus provider OR provider type
    // kiro_refresh_token OR baseUrl pointing at a Kiro-proxy is treated
    // as Kiro-backed. We strip the image and append a note so the model
    // knows the user attempted to share one.
    const dbMessages = await prisma.message.findMany({
      where: { conversationId: convId! },
      orderBy: { createdAt: 'asc' },
    });

    const isKiroBacked =
      isBuiltin ||
      provider?.type === 'kiro_refresh_token' ||
      /amazonaws\.com|kiro|137\.184\.195\.229/i.test(provider?.baseUrl || '');

    const apiMessages: ChatMessage[] = dbMessages.map((msg) => {
      const msgImages = JSON.parse(msg.images || '[]') as string[];

      if (msgImages.length === 0) {
        return { role: msg.role as 'user' | 'assistant' | 'system', content: msg.content };
      }

      if (isKiroBacked) {
        const note = `\n\n[Note: user attached ${msgImages.length} image${msgImages.length > 1 ? 's' : ''} but the current backend (Kiro) doesn't support image input over its public API. Please describe the image in text or switch to a vision-capable provider.]`;
        return {
          role: msg.role as 'user' | 'assistant' | 'system',
          content: (msg.content || '') + note,
        };
      }

      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const img of msgImages) content.push({ type: 'image_url', image_url: { url: img } });
      return { role: msg.role as 'user' | 'assistant' | 'system', content };
    });

    // ============ Dispatch to backend ============
    let upstreamStream: ReadableStream;
    let getUsage: () => { promptTokens: number; completionTokens: number; totalTokens: number };

    if (isBuiltin) {
      // Route through Kiro pool. Wrap raw model id in "kiro/<id>" for the
      // OpenAI-compatible identifier streamKiroChat expects.
      const openaiModelId = model.startsWith('kiro/') ? model : `kiro/${model}`;
      if (!findModel(openaiModelId)) {
        return NextResponse.json(
          { error: `Unknown built-in model: ${model}. Use one of the kiro/* models.` },
          { status: 400 },
        );
      }
      const result = await streamKiroChat(userId, openaiModelId, apiMessages);
      upstreamStream = result.stream;
      // Pool doesn't surface token counts - we estimate in flush()
      getUsage = () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    } else {
      // Existing path through external provider (OpenAI-compatible / WIR Cloud / etc)
      const sc = await streamChat(
        { type: provider!.type, baseUrl: provider!.baseUrl, apiKey: provider!.apiKey },
        model,
        apiMessages,
      );
      upstreamStream = sc.stream;
      getUsage = sc.getUsage;
    }

    let fullResponse = '';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = decoder.decode(chunk);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullResponse += content;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content, conversationId: convId })}\n\n`));
              }
            } catch {}
          }
        }
      },
      async flush() {
        const latencyMs = Date.now() - startTime;
        let usage = getUsage();

        // Fallback: estimate tokens if provider didn't return usage
        if (usage.totalTokens === 0 && fullResponse) {
          const promptText = apiMessages.map(m =>
            typeof m.content === 'string' ? m.content : (m.content as Array<{ text?: string }>).map(c => c.text || '').join(' ')
          ).join(' ');
          usage = {
            promptTokens: estimateTokens(promptText),
            completionTokens: estimateTokens(fullResponse),
            totalTokens: estimateTokens(promptText) + estimateTokens(fullResponse),
          };
        }

        const cost = estimateCost(model, usage.promptTokens, usage.completionTokens);

        if (fullResponse) {
          await prisma.message.create({
            data: {
              conversationId: convId!,
              role: 'assistant',
              content: fullResponse,
              model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              latencyMs,
            },
          });

          // Track usage. For the built-in provider we store providerId=null
          // (Usage.providerId is optional; the FK to Provider is satisfied
          // by either pointing at a real row or staying null).
          await prisma.usage.create({
            data: {
              userId,
              providerId: isBuiltin ? null : providerId,
              providerName,
              model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              latencyMs,
              cost,
              success: true,
            },
          });

          // Update title if first response
          const msgCount = await prisma.message.count({ where: { conversationId: convId! } });
          if (msgCount <= 2) {
            const firstUserMsg = await prisma.message.findFirst({
              where: { conversationId: convId!, role: 'user' },
              orderBy: { createdAt: 'asc' },
            });
            const title = firstUserMsg?.content?.slice(0, 50).replace(/\n/g, ' ') || fullResponse.slice(0, 50).replace(/\n/g, ' ') || 'New Chat';
            await prisma.conversation.update({
              where: { id: convId! },
              data: { title },
            });
          }
        }
      },
    });

    upstreamStream.pipeThrough(transformStream);

    return new Response(transformStream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Conversation-Id': convId!,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Unauthorized' || message === 'Account not approved' ? 401 : 500;

    // Track failed request. For the virtual built-in provider we set
    // providerId=null since '__prometheus__' isn't a real FK target.
    if (userId && providerId) {
      const isVirtual = providerId === PROMETHEUS_PROVIDER_ID;
      await prisma.usage.create({
        data: {
          userId,
          providerId: isVirtual ? null : providerId,
          providerName: providerName || 'unknown',
          model: modelUsed || 'unknown',
          latencyMs: Date.now() - startTime,
          success: false,
          errorMessage: message.slice(0, 500),
        },
      }).catch(() => {});
    }

    return NextResponse.json({ error: message }, { status });
  }
}
