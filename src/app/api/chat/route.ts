import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { streamChat, estimateTokens } from '@/lib/providers';
import { estimateCost } from '@/lib/pricing';

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

    const provider = await prisma.provider.findFirst({
      where: { id: providerId, userId: session.userId, isActive: true },
    });

    if (!provider) {
      return NextResponse.json({ error: 'Provider not found or inactive' }, { status: 404 });
    }

    providerName = provider.name;

    // Get or create conversation
    convId = conversationId;
    if (!convId) {
      const conv = await prisma.conversation.create({
        data: {
          userId: session.userId,
          title: message?.slice(0, 50) || 'Image Analysis',
          model,
          provider: provider.name,
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

    // Build messages for API
    const dbMessages = await prisma.message.findMany({
      where: { conversationId: convId! },
      orderBy: { createdAt: 'asc' },
    });

    const apiMessages = dbMessages.map((msg) => {
      const msgImages = JSON.parse(msg.images || '[]');
      if (msgImages.length > 0) {
        const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const img of msgImages) content.push({ type: 'image_url', image_url: { url: img } });
        return { role: msg.role as 'user' | 'assistant' | 'system', content };
      }
      return { role: msg.role as 'user' | 'assistant' | 'system', content: msg.content };
    });

    // Stream response
    const { stream, getUsage } = await streamChat(
      { type: provider.type, baseUrl: provider.baseUrl, apiKey: provider.apiKey },
      model,
      apiMessages,
    );

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

          // Track usage
          await prisma.usage.create({
            data: {
              userId,
              providerId,
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

    stream.pipeThrough(transformStream);

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

    // Track failed request
    if (userId && providerId) {
      await prisma.usage.create({
        data: {
          userId,
          providerId,
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
