/**
 * Test connection to a single model.
 *
 * POST /api/models/test
 * Body: { modelId: string }
 *
 * Sends a tiny "ping" prompt through the standard chat dispatcher to
 * verify:
 *   - User auth + CSRF
 *   - Active Kiro account exists in pool
 *   - Refresh token still valid (token refresh works)
 *   - Kiro endpoint accepts the requested model
 *   - Response time
 *
 * Returns latency + first reply chunk so the UI can show "OK 480ms"
 * or surface the actual error from upstream.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { generateKiroChat } from '@/lib/kiro-chat';
import { findModel } from '@/lib/models';
import { apiError } from '@/lib/http';

interface TestRequest {
  modelId: string;
}

interface TestResult {
  ok: boolean;
  modelId: string;
  latencyMs: number;
  /** Truncated first 80 chars of model reply for visual confirmation */
  sampleReply?: string;
  /** Token usage estimation */
  promptTokens?: number;
  completionTokens?: number;
  /** Error message when ok=false */
  error?: string;
  /** HTTP status if upstream returned a structured error */
  upstreamStatus?: number;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = (await request.json()) as TestRequest;

    if (!body.modelId || typeof body.modelId !== 'string') {
      return NextResponse.json<TestResult>(
        {
          ok: false,
          modelId: body.modelId ?? '',
          latencyMs: 0,
          error: 'modelId required',
        },
        { status: 400 },
      );
    }

    const found = findModel(body.modelId);
    if (!found) {
      return NextResponse.json<TestResult>(
        {
          ok: false,
          modelId: body.modelId,
          latencyMs: 0,
          error: 'Unknown model id',
        },
        { status: 404 },
      );
    }

    if (found.model.provider !== 'kiro') {
      // External providers test would need a different code path - skip for now.
      return NextResponse.json<TestResult>(
        {
          ok: false,
          modelId: body.modelId,
          latencyMs: 0,
          error: `Test connection currently supports only Kiro models. Provider: ${found.model.provider}`,
        },
        { status: 400 },
      );
    }

    const start = Date.now();
    try {
      const result = await generateKiroChat(session.userId, body.modelId, [
        {
          role: 'user',
          content: 'Reply with just the single word "ready" (lowercase).',
        },
      ]);
      const latencyMs = Date.now() - start;

      // Cheap token estimation - we just want to show order of magnitude
      const promptText = 'Reply with just the single word "ready" (lowercase).';
      const promptTokens = Math.ceil(promptText.length / 4);
      const completionTokens = Math.ceil(result.content.length / 4);

      return NextResponse.json<TestResult>({
        ok: true,
        modelId: body.modelId,
        latencyMs,
        sampleReply: result.content.slice(0, 80).trim(),
        promptTokens,
        completionTokens,
      });
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : 'unknown error';
      // Try to pull HTTP status from "Kiro API error (xxx)" messages
      const m = message.match(/\((\d{3})\)/);
      const upstreamStatus = m ? parseInt(m[1], 10) : undefined;
      return NextResponse.json<TestResult>(
        {
          ok: false,
          modelId: body.modelId,
          latencyMs,
          error: message.slice(0, 300),
          upstreamStatus,
        },
        { status: 200 }, // 200 because the test ITSELF succeeded (we got an answer about the model)
      );
    }
  } catch (err) {
    return apiError(err);
  }
}
