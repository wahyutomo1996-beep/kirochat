import { NextResponse } from 'next/server';

/**
 * Standard error response for API routes.
 *
 * Maps known auth errors to 401, everything else to 500. Truncates long
 * error messages to keep response payloads sane.
 */
export function apiError(error: unknown, fallback = 'Internal server error'): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  const isAuthError = message === 'Unauthorized' || message === 'Account not approved';
  const status = isAuthError ? 401 : 500;
  return NextResponse.json({ error: message.slice(0, 500) }, { status });
}

/**
 * Extract a safe error message string from an unknown thrown value.
 */
export function errorMessage(error: unknown, fallback = 'Internal server error'): string {
  return error instanceof Error ? error.message : fallback;
}
