/**
 * API Key Authentication
 *
 * Authenticates requests via Bearer API key in Authorization header.
 * Used by OpenAI-compatible /v1 endpoints.
 */

import { prisma } from './prisma';

export interface ApiKeyAuthResult {
  userId: string;
  username: string;
  email: string;
  role: string;
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Authenticate a request using API key.
 * Returns the user info or throws.
 */
export async function requireApiKey(req: Request): Promise<ApiKeyAuthResult> {
  const apiKey = extractBearerToken(req);
  if (!apiKey) {
    throw new Error('Missing Authorization header');
  }

  if (!apiKey.startsWith('pmt-')) {
    throw new Error('Invalid API key format. Expected: pmt-<...>');
  }

  const user = await prisma.user.findUnique({
    where: { apiKey },
  });

  if (!user) {
    throw new Error('Invalid API key');
  }

  if (user.status !== 'approved') {
    throw new Error('Account not approved');
  }

  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}
