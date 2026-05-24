/**
 * HTTP utilities — error responses, request body limits, CORS helpers.
 */

import { NextResponse } from 'next/server';

/**
 * Standard error response for API routes.
 *
 * Maps known auth errors to 401, everything else to 500. Truncates long
 * error messages to keep response payloads sane.
 */
export function apiError(error: unknown, fallback = 'Internal server error'): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  const isAuthError =
    message === 'Unauthorized' ||
    message === 'Account not approved' ||
    message === 'Admin access required';
  const status = isAuthError ? 401 : 500;
  return NextResponse.json({ error: message.slice(0, 500) }, { status });
}

/**
 * Extract a safe error message string from an unknown thrown value.
 */
export function errorMessage(error: unknown, fallback = 'Internal server error'): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Read JSON body with an enforced size limit. Prevents DoS via giant
 * payloads — without this, an attacker can post a 100MB body and exhaust
 * server memory parsing it.
 *
 * @param request the incoming Request
 * @param maxBytes maximum bytes (default 5MB - room for base64 image upload)
 * @throws Error 'Payload too large' if body exceeds the limit
 */
export async function readJsonBody<T = unknown>(
  request: Request,
  maxBytes: number = 5 * 1024 * 1024,
): Promise<T> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const len = parseInt(contentLength, 10);
    if (Number.isFinite(len) && len > maxBytes) {
      throw new PayloadTooLargeError(maxBytes);
    }
  }

  // Defensive read with running total - some clients omit content-length
  // or lie about it. Stream the body and abort if we exceed the limit.
  const reader = request.body?.getReader();
  if (!reader) {
    return (await request.json()) as T;
  }

  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  const text = new TextDecoder().decode(merged);
  return JSON.parse(text) as T;
}

export class PayloadTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Payload exceeds ${maxBytes} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Compute the CORS origin to allow on a given request.
 *
 * Behavior:
 *   - If GATEWAY_CORS_ORIGINS env is unset or empty, NO CORS header is
 *     emitted. Same-origin browser calls work; cross-origin browser calls
 *     are blocked. This is the safer default.
 *   - If set to '*', echoes wildcard (permissive — only use for fully public APIs)
 *   - Otherwise, treats it as a comma-separated whitelist. If the request's
 *     Origin header matches one entry, that origin is echoed. Otherwise no
 *     header.
 *
 * Echoing the actual origin (not '*') is required when credentials are
 * involved, but our gateway is API-key based so we don't strictly need that.
 * The whitelist still gives operators control.
 */
export function corsOrigin(request: Request): string | null {
  const allow = process.env.GATEWAY_CORS_ORIGINS;
  if (!allow) return null;
  if (allow.trim() === '*') return '*';

  const origin = request.headers.get('origin');
  if (!origin) return null;

  const list = allow.split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

/**
 * Build a header object with CORS headers if a matching origin is allowed.
 * Returns empty object when no CORS should be applied.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = corsOrigin(request);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    Vary: 'Origin',
  };
}
